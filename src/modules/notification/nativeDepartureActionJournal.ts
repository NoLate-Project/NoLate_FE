import AsyncStorage from "@react-native-async-storage/async-storage";

import { markScheduleDeparted } from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import {
    createScheduleDepartureMutationEvent,
    emitScheduleMutation,
} from "../schedule/scheduleMutationEvents";
import {
    getPendingNativeDepartureActionEvents,
    enqueueNativeDepartureActionEvent,
    markNativeDepartureActionNavigationDelivered,
    removePendingNativeDepartureActionEvent,
    type NativeDepartureActionEvent,
    type NativeDepartureActionInput,
} from "./departureAlarm";
import { recoverDepartureAlarmsAfterMutation } from "./departureAlarmMutationRecovery";
import { isDepartureAlarmAccountCleanupPending } from "./departureAlarmSync";
import { acknowledgePushDelivery } from "./pushDeliveryAck";

export type NativeDepartureActionDrainResult = {
    discovered: number;
    completed: number;
    terminal: number;
    unresolved: number;
    accountMismatch: number;
    failed: number;
    blocked: boolean;
};

export type NativeDepartureActionNavigationHandler = (
    scheduleId: string,
) => void | Promise<void>;

export type NativeDepartureActionTerminalHandler = (
    event: NativeDepartureActionEvent,
    message: string,
) => void;

class PermanentDepartureActionIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PermanentDepartureActionIntegrityError";
    }
}

const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const FALLBACK_STORAGE_PREFIX = "nolate_departure_action_fallback_v1:";
const MAX_FALLBACK_EVENTS = 100;
type QueuedDepartureAction = {
    source: "native" | "fallback";
    event: NativeDepartureActionEvent;
};
let drainFlight: {
    epoch: number;
    promise: Promise<NativeDepartureActionDrainResult>;
} | undefined;
let navigationHandler: NativeDepartureActionNavigationHandler | undefined;
let terminalHandler: NativeDepartureActionTerminalHandler | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
let lifecycleEpoch = 0;
let fallbackStorageTail: Promise<void> = Promise.resolve();

function normalizeMemberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

export function configureNativeDepartureActionNavigation(
    navigation: NativeDepartureActionNavigationHandler,
    onTerminal?: NativeDepartureActionTerminalHandler,
): () => void {
    navigationHandler = navigation;
    terminalHandler = onTerminal;
    activateNativeDepartureActionJournalForAuthenticatedMember().catch(() => undefined);
    return () => {
        if (navigationHandler === navigation) navigationHandler = undefined;
        if (terminalHandler === onTerminal) terminalHandler = undefined;
    };
}

/**
 * STANDARD notification actions use the same authenticated drain as native alarm actions. New
 * binaries persist in device-protected native storage; an older/temporarily unavailable native
 * module falls back to account-scoped AsyncStorage without losing the canonical idempotency key.
 */
export async function enqueueStandardDepartureAction(
    input: NativeDepartureActionInput & { actionEventKey: string },
): Promise<boolean> {
    if (await enqueueNativeDepartureActionEvent({
        ...input,
        requiresRouteNavigation: input.requiresRouteNavigation === true,
    })) return true;

    const event: NativeDepartureActionEvent = {
        eventId: `standard:${input.actionEventKey}`,
        alarmId: input.alarmId ??
            `schedule:${input.scheduleId}:member:${input.recipientMemberId}`,
        scheduleId: input.scheduleId,
        generation: input.generation ?? 0,
        recipientMemberId: input.recipientMemberId,
        ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
        actionEventKey: input.actionEventKey,
        occurredAt: new Date().toISOString(),
        requiresRouteNavigation: input.requiresRouteNavigation === true,
        routeNavigationDelivered: false,
    };
    return serializeFallback(async () => {
        const current = await readFallbackEvents(input.recipientMemberId);
        if (current.some((candidate) => candidate.actionEventKey === event.actionEventKey)) {
            return true;
        }
        await writeFallbackEvents(
            input.recipientMemberId,
            [...current, event].slice(-MAX_FALLBACK_EVENTS),
        );
        return true;
    });
}

export function drainNativeDepartureActionJournal(
): Promise<NativeDepartureActionDrainResult> {
    const epoch = lifecycleEpoch;
    if (drainFlight?.epoch === epoch) return drainFlight.promise;
    const request = drainEpoch(epoch).finally(() => {
        if (drainFlight?.epoch === epoch && drainFlight.promise === request) {
            drainFlight = undefined;
        }
    });
    drainFlight = { epoch, promise: request };
    return request;
}

async function drainEpoch(epoch: number): Promise<NativeDepartureActionDrainResult> {
    const result: NativeDepartureActionDrainResult = {
        discovered: 0,
        completed: 0,
        terminal: 0,
        unresolved: 0,
        accountMismatch: 0,
        failed: 0,
        blocked: false,
    };
    if (epoch !== lifecycleEpoch || await isDepartureAlarmAccountCleanupPending()) {
        result.blocked = true;
        return result;
    }
    if (epoch !== lifecycleEpoch) {
        result.blocked = true;
        return result;
    }

    const currentMemberId = normalizeMemberId((await getAuthMember())?.id);
    if (epoch !== lifecycleEpoch) {
        result.blocked = true;
        return result;
    }
    if (!currentMemberId) {
        return result;
    }

    const nativeEvents = await getPendingNativeDepartureActionEvents();
    if (epoch !== lifecycleEpoch) {
        result.unresolved = nativeEvents.length;
        result.blocked = true;
        return result;
    }
    const fallbackEvents = await serializeFallback(() => readFallbackEvents(currentMemberId));
    if (epoch !== lifecycleEpoch) {
        result.unresolved = nativeEvents.length + fallbackEvents.length;
        result.blocked = true;
        return result;
    }
    const events: QueuedDepartureAction[] = [
        ...nativeEvents.map((event) => ({ source: "native" as const, event })),
        ...fallbackEvents.map((event) => ({ source: "fallback" as const, event })),
    ];
    result.discovered = events.length;

    for (let index = 0; index < events.length; index += 1) {
        const queued = events[index];
        const event = queued.event;
        if (event.recipientMemberId !== currentMemberId) {
            result.accountMismatch += 1;
            continue;
        }
        if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
            result.unresolved += events.length - index;
            result.blocked = true;
            break;
        }
        // The durable native journal itself proves the notification action was tapped. Record
        // that evidence before the business mutation so retryable and terminal API outcomes keep
        // the same RECEIVED/PRESENTED/ACTIONED telemetry. ACK failure is deliberately best-effort.
        await acknowledgeNotificationInteractionBestEffort(
            event,
            "schedule_depart_now_action",
        );

        try {
            // This is the final account/cleanup check before the authenticated mutation. Navigation
            // is deliberately later and independent so a UI callback can never delay depart-now.
            if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
                result.unresolved += events.length - index;
                result.blocked = true;
                break;
            }
            const updatedSchedule = await markScheduleDeparted(
                event.scheduleId,
                event.actionEventKey,
                event.recipientMemberId,
            );
            if (updatedSchedule.id !== event.scheduleId) {
                throw new PermanentDepartureActionIntegrityError(
                    "Departure mutation returned a different schedule identity.",
                );
            }
            if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
                result.unresolved += 1;
                result.blocked = true;
                continue;
            }
            // Publish the server-returned state at the successful mutation boundary so mounted
            // detail/agenda consumers update before slower alarm reconciliation/navigation.
            emitScheduleMutation(createScheduleDepartureMutationEvent(updatedSchedule));
            await recoverDepartureAlarmsAfterMutation();
            if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
                result.unresolved += 1;
                result.blocked = true;
                continue;
            }

            const navigationDelivered = await deliverRouteNavigationBestEffort(queued, epoch);
            if (!navigationDelivered) {
                result.unresolved += 1;
                continue;
            }
            if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
                result.unresolved += 1;
                result.blocked = true;
                continue;
            }
            if (await removeQueuedEvent(queued)) {
                result.completed += 1;
            } else {
                result.failed += 1;
            }
        } catch (error) {
            if (!isTerminalActionError(error)) {
                result.failed += 1;
                continue;
            }
            if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
                result.unresolved += 1;
                result.blocked = true;
                continue;
            }
            await deliverRouteNavigationBestEffort(queued, epoch).catch(() => false);
            if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) {
                result.unresolved += 1;
                result.blocked = true;
                continue;
            }
            if (await removeQueuedEvent(queued)) {
                result.terminal += 1;
                terminalHandler?.(
                    event,
                    error instanceof Error
                        ? error.message
                        : "출발 완료 요청을 처리할 수 없어요.",
                );
            } else {
                result.failed += 1;
            }
        }
    }
    return result;
}

async function acknowledgeNotificationInteractionBestEffort(
    event: NativeDepartureActionEvent,
    actionIdentifier: string,
): Promise<void> {
    if (!event.notificationLogicalEventKey) return;
    const notificationData = {
        logicalEventKey: event.notificationLogicalEventKey,
        recipientMemberId: String(event.recipientMemberId),
    };
    await Promise.all([
        acknowledgePushDelivery(notificationData, "RECEIVED", {
            providerMessageId: event.providerMessageId,
            occurredAt: event.occurredAt,
        }),
        acknowledgePushDelivery(notificationData, "PRESENTED", {
            providerMessageId: event.providerMessageId,
            occurredAt: event.occurredAt,
        }),
        acknowledgePushDelivery(notificationData, "ACTIONED", {
            providerMessageId: event.providerMessageId,
            actionIdentifier,
            occurredAt: event.occurredAt,
        }),
    ]).then(() => undefined, () => undefined);
}

async function isCurrentEpochAccount(epoch: number, memberId: number): Promise<boolean> {
    if (epoch !== lifecycleEpoch) return false;
    const cleanupBlocked = await isDepartureAlarmAccountCleanupPending();
    if (epoch !== lifecycleEpoch || cleanupBlocked) return false;
    const currentMemberId = normalizeMemberId((await getAuthMember())?.id);
    return epoch === lifecycleEpoch && currentMemberId === memberId;
}

async function deliverRouteNavigationBestEffort(
    queued: QueuedDepartureAction,
    epoch: number,
): Promise<boolean> {
    const event = queued.event;
    if (!event.requiresRouteNavigation || event.routeNavigationDelivered) return true;
    const handler = navigationHandler;
    if (!handler || !(await isCurrentEpochAccount(epoch, event.recipientMemberId))) return false;
    try {
        await handler(event.scheduleId);
        if (!(await isCurrentEpochAccount(epoch, event.recipientMemberId))) return false;
        return markQueuedNavigationDelivered(queued);
    } catch {
        return false;
    }
}

async function markQueuedNavigationDelivered(queued: QueuedDepartureAction): Promise<boolean> {
    if (queued.source === "native") {
        return markNativeDepartureActionNavigationDelivered(queued.event.eventId);
    }
    return serializeFallback(async () => {
        const events = await readFallbackEvents(queued.event.recipientMemberId);
        const current = events.find((event) => event.eventId === queued.event.eventId);
        if (!current) return false;
        await writeFallbackEvents(
            queued.event.recipientMemberId,
            events.map((event) => event.eventId === queued.event.eventId
                ? { ...event, routeNavigationDelivered: true }
                : event),
        );
        queued.event = { ...queued.event, routeNavigationDelivered: true };
        return true;
    });
}

async function removeQueuedEvent(queued: QueuedDepartureAction): Promise<boolean> {
    if (queued.source === "native") {
        return removePendingNativeDepartureActionEvent(queued.event.eventId);
    }
    return serializeFallback(async () => {
        const events = await readFallbackEvents(queued.event.recipientMemberId);
        if (!events.some((event) => event.eventId === queued.event.eventId)) return false;
        await writeFallbackEvents(
            queued.event.recipientMemberId,
            events.filter((event) => event.eventId !== queued.event.eventId),
        );
        return true;
    });
}

export async function clearStandardDepartureActionFallbackForCurrentAccount(): Promise<void> {
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    lifecycleEpoch += 1;
    cancelRetry(true);
    if (!memberId) return;
    await serializeFallback(() => AsyncStorage.removeItem(fallbackStorageKey(memberId)));
}

function fallbackStorageKey(memberId: number): string {
    return `${FALLBACK_STORAGE_PREFIX}${memberId}`;
}

function serializeFallback<T>(operation: () => Promise<T>): Promise<T> {
    const result = fallbackStorageTail.then(operation, operation);
    fallbackStorageTail = result.then(() => undefined, () => undefined);
    return result;
}

async function readFallbackEvents(memberId: number): Promise<NativeDepartureActionEvent[]> {
    const raw = await AsyncStorage.getItem(fallbackStorageKey(memberId));
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isFallbackEvent).slice(-MAX_FALLBACK_EVENTS);
    } catch {
        return [];
    }
}

async function writeFallbackEvents(
    memberId: number,
    events: NativeDepartureActionEvent[],
): Promise<void> {
    if (events.length === 0) {
        await AsyncStorage.removeItem(fallbackStorageKey(memberId));
        return;
    }
    await AsyncStorage.setItem(fallbackStorageKey(memberId), JSON.stringify(events));
}

function isFallbackEvent(value: unknown): value is NativeDepartureActionEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const event = value as Partial<NativeDepartureActionEvent>;
    return typeof event.eventId === "string" && event.eventId.length <= 200 &&
        typeof event.alarmId === "string" && event.alarmId.length > 0 && event.alarmId.length <= 200 &&
        typeof event.scheduleId === "string" && /^[1-9]\d*$/.test(event.scheduleId) &&
        Number.isSafeInteger(event.generation) && (event.generation ?? -1) >= 0 &&
        Number.isSafeInteger(event.recipientMemberId) && (event.recipientMemberId ?? 0) > 0 &&
        typeof event.actionEventKey === "string" &&
        (/^key:[a-f0-9]{64}$/.test(event.actionEventKey) ||
            /^event:[0-9a-f-]{36}$/i.test(event.actionEventKey)) &&
        typeof event.occurredAt === "string" && Number.isFinite(Date.parse(event.occurredAt)) &&
        typeof event.requiresRouteNavigation === "boolean" &&
        typeof event.routeNavigationDelivered === "boolean";
}

function isTerminalActionError(error: unknown): boolean {
    if (error instanceof PermanentDepartureActionIntegrityError) return true;
    if (!(error instanceof ApiResponseError)) return false;
    const status = error.status;
    if (status === undefined || status === 401 || status === 408 || status === 429 || status >= 500) {
        return false;
    }
    return status >= 400 && status < 500;
}

function cancelRetry(resetAttempt: boolean): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    if (resetAttempt) retryAttempt = 0;
}

function scheduleRetry(): void {
    if (retryTimer) return;
    const epoch = lifecycleEpoch;
    const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (epoch !== lifecycleEpoch) return;
        activateNativeDepartureActionJournalForAuthenticatedMember().catch(() => undefined);
    }, delay);
}

export async function activateNativeDepartureActionJournalForAuthenticatedMember(
): Promise<NativeDepartureActionDrainResult> {
    try {
        const result = await drainNativeDepartureActionJournal();
        if (!result.blocked && result.failed + result.unresolved > 0) {
            scheduleRetry();
        } else {
            cancelRetry(true);
        }
        return result;
    } catch (error) {
        scheduleRetry();
        throw error;
    }
}

export function deactivateNativeDepartureActionJournalRetry(): void {
    lifecycleEpoch += 1;
    cancelRetry(true);
}

export function resetNativeDepartureActionJournalForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    drainFlight = undefined;
    navigationHandler = undefined;
    terminalHandler = undefined;
    lifecycleEpoch += 1;
    cancelRetry(true);
    fallbackStorageTail = Promise.resolve();
}

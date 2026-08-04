import { getAuthMember } from "../auth/authStorage";
import { postDepartureAlarmFiredEvent } from "../../api/notification";
import {
    getPendingNativeAlarmFireEvents,
    removePendingNativeAlarmFireEvent,
    type NativeAlarmFireEvent,
} from "./departureAlarm";
import { isDepartureAlarmAccountCleanupPending } from "./departureAlarmSync";
import { acknowledgePushDelivery } from "./pushDeliveryAck";
import { getOrCreatePushDeviceId } from "./pushDeviceIdentity";

export type NativeAlarmFireDrainResult = {
    discovered: number;
    acknowledged: number;
    unresolved: number;
    accountMismatch: number;
    failed: number;
    blocked: boolean;
};

export type NativeAlarmFireEventHandler = (
    event: NativeAlarmFireEvent,
) => Promise<boolean>;

let drainInFlight: Promise<NativeAlarmFireDrainResult> | undefined;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
let lifecycleGeneration = 0;

function memberId(value: unknown): number | undefined {
    const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : undefined;
}

async function deliveryAckHandler(event: NativeAlarmFireEvent): Promise<boolean> {
    const scheduleId = Number(event.scheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) return false;
    const lifecycleRequest = postDepartureAlarmFiredEvent({
        eventId: event.eventId,
        alarmId: event.alarmId,
        scheduleId,
        generation: event.generation,
        recipientMemberId: event.recipientMemberId,
        scheduledFor: event.scheduledFor,
        ...(event.sourceTriggerAt ? { sourceTriggerAt: event.sourceTriggerAt } : {}),
        occurredAt: event.occurredAt,
        timingBasis: event.timingBasis,
        deviceId: await getOrCreatePushDeviceId(),
        ...(event.occurrenceId ? { occurrenceId: event.occurrenceId } : {}),
    });
    // Snapshot-origin alarms intentionally have no logicalEventKey. Never infer
    // one from alarmId; their dedicated lifecycle event is sufficient.
    if (!event.logicalEventKey) {
        await lifecycleRequest;
        return true;
    }

    // Both independently idempotent endpoints are attempted on every drain.
    // Partial success deliberately retains the native journal for convergence.
    const [lifecycleResult, deliveryResult] = await Promise.allSettled([
        lifecycleRequest,
        acknowledgePushDelivery(
            {
                logicalEventKey: event.logicalEventKey,
                recipientMemberId: String(event.recipientMemberId),
            },
            "ALARM_FIRED",
            { alarmId: event.alarmId, occurredAt: event.occurredAt },
        ),
    ]);
    return lifecycleResult.status === "fulfilled" &&
        deliveryResult.status === "fulfilled" &&
        deliveryResult.value;
}

/**
 * Drains native execution evidence at least once. Native deletion happens only
 * after the authenticated handler succeeds; crashes, offline retries, and
 * account transitions therefore leave recoverable evidence on the device.
 */
export function drainNativeAlarmFireJournal(
    handler: NativeAlarmFireEventHandler = deliveryAckHandler,
): Promise<NativeAlarmFireDrainResult> {
    if (drainInFlight) return drainInFlight;
    const request = (async () => {
        const result: NativeAlarmFireDrainResult = {
            discovered: 0,
            acknowledged: 0,
            unresolved: 0,
            accountMismatch: 0,
            failed: 0,
            blocked: false,
        };
        if (await isDepartureAlarmAccountCleanupPending()) {
            result.blocked = true;
            return result;
        }
        const events = await getPendingNativeAlarmFireEvents();
        result.discovered = events.length;
        const currentMemberId = memberId((await getAuthMember())?.id);
        if (!currentMemberId) {
            result.accountMismatch = events.length;
            return result;
        }

        for (let index = 0; index < events.length; index += 1) {
            const event = events[index];
            if (await isDepartureAlarmAccountCleanupPending()) {
                result.unresolved += events.length - index;
                result.blocked = true;
                break;
            }
            if (event.recipientMemberId !== currentMemberId) {
                result.accountMismatch += 1;
                continue;
            }
            try {
                if (!(await handler(event))) {
                    result.unresolved += 1;
                    continue;
                }
                if (await removePendingNativeAlarmFireEvent(event.eventId)) {
                    result.acknowledged += 1;
                } else {
                    result.failed += 1;
                }
            } catch {
                result.failed += 1;
            }
        }
        return result;
    })().finally(() => {
        if (drainInFlight === request) drainInFlight = undefined;
    });
    drainInFlight = request;
    return request;
}

function cancelRetry(resetAttempt: boolean): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    if (resetAttempt) retryAttempt = 0;
}

function scheduleRetry(): void {
    if (retryTimer) return;
    const generation = lifecycleGeneration;
    const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (generation !== lifecycleGeneration) return;
        activateNativeAlarmFireJournalForAuthenticatedMember().catch(() => undefined);
    }, delay);
}

/**
 * Starts an authenticated drain and retains one bounded foreground retry timer while recoverable
 * uploads remain. This recovery path is independent of profile/token registration.
 */
export async function activateNativeAlarmFireJournalForAuthenticatedMember(): Promise<
    NativeAlarmFireDrainResult
> {
    try {
        const result = await drainNativeAlarmFireJournal();
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

export function deactivateNativeAlarmFireJournalRetry(): void {
    lifecycleGeneration += 1;
    cancelRetry(true);
}

export function resetNativeAlarmFireJournalDrainForTests(): void {
    if (process.env.NODE_ENV === "test") {
        drainInFlight = undefined;
        deactivateNativeAlarmFireJournalRetry();
    }
}

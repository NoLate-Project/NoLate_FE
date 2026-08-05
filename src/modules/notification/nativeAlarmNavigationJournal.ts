import { getAuthMember } from "../auth/authStorage";
import {
    getPendingNativeAlarmNavigationEvents,
    removePendingNativeAlarmNavigationEvent,
} from "./departureAlarm";
import { isDepartureAlarmAccountCleanupPending } from "./departureAlarmSync";
import { acknowledgePushDelivery } from "./pushDeliveryAck";

export type NativeAlarmNavigationDrainResult = {
    discovered: number;
    delivered: number;
    unresolved: number;
    accountMismatch: number;
    blocked: boolean;
};

export type NativeAlarmNavigationHandler = (scheduleId: string) => void | Promise<void>;

let handler: NativeAlarmNavigationHandler | undefined;
let lifecycleEpoch = 0;
let drainFlight: { epoch: number; promise: Promise<NativeAlarmNavigationDrainResult> } | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function currentMemberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

export function configureNativeAlarmNavigation(
    navigationHandler: NativeAlarmNavigationHandler,
): () => void {
    handler = navigationHandler;
    activateNativeAlarmNavigationJournal().catch(() => undefined);
    return () => {
        if (handler === navigationHandler) handler = undefined;
    };
}

export function drainNativeAlarmNavigationJournal(
): Promise<NativeAlarmNavigationDrainResult> {
    const epoch = lifecycleEpoch;
    if (drainFlight?.epoch === epoch) return drainFlight.promise;
    const promise = drainEpoch(epoch).finally(() => {
        if (drainFlight?.epoch === epoch && drainFlight.promise === promise) {
            drainFlight = undefined;
        }
    });
    drainFlight = { epoch, promise };
    return promise;
}

async function drainEpoch(epoch: number): Promise<NativeAlarmNavigationDrainResult> {
    const result: NativeAlarmNavigationDrainResult = {
        discovered: 0,
        delivered: 0,
        unresolved: 0,
        accountMismatch: 0,
        blocked: false,
    };
    const navigationHandler = handler;
    if (!navigationHandler || epoch !== lifecycleEpoch ||
        await isDepartureAlarmAccountCleanupPending()) {
        result.blocked = true;
        return result;
    }
    const memberId = currentMemberId((await getAuthMember())?.id);
    if (!memberId || epoch !== lifecycleEpoch) {
        result.blocked = epoch !== lifecycleEpoch;
        return result;
    }
    const events = await getPendingNativeAlarmNavigationEvents();
    result.discovered = events.length;
    if (epoch !== lifecycleEpoch) {
        result.unresolved = events.length;
        result.blocked = true;
        return result;
    }

    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (event.recipientMemberId !== memberId) {
            result.accountMismatch += 1;
            continue;
        }
        if (!(await isCurrentAccount(epoch, memberId))) {
            result.unresolved += events.length - index;
            result.blocked = true;
            break;
        }
        await acknowledgeNotificationInteractionBestEffort(event);
        try {
            await navigationHandler(event.scheduleId);
        } catch {
            result.unresolved += 1;
            continue;
        }
        if (!(await isCurrentAccount(epoch, memberId))) {
            result.unresolved += 1;
            result.blocked = true;
            continue;
        }
        if (await removePendingNativeAlarmNavigationEvent(event.eventId)) {
            result.delivered += 1;
        } else {
            result.unresolved += 1;
        }
    }
    return result;
}

async function acknowledgeNotificationInteractionBestEffort(
    event: Awaited<ReturnType<typeof getPendingNativeAlarmNavigationEvents>>[number],
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
            actionIdentifier: "DEFAULT",
            occurredAt: event.occurredAt,
        }),
    ]).then(() => undefined, () => undefined);
}

async function isCurrentAccount(epoch: number, memberId: number): Promise<boolean> {
    if (epoch !== lifecycleEpoch || await isDepartureAlarmAccountCleanupPending()) return false;
    const activeMemberId = currentMemberId((await getAuthMember())?.id);
    return epoch === lifecycleEpoch && activeMemberId === memberId;
}

function scheduleRetry(): void {
    if (retryTimer) return;
    const epoch = lifecycleEpoch;
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (epoch !== lifecycleEpoch) return;
        activateNativeAlarmNavigationJournal().catch(() => undefined);
    }, 15_000);
}

export async function activateNativeAlarmNavigationJournal(
): Promise<NativeAlarmNavigationDrainResult> {
    try {
        const result = await drainNativeAlarmNavigationJournal();
        if (!result.blocked && result.unresolved > 0) scheduleRetry();
        else if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
        }
        return result;
    } catch (error) {
        scheduleRetry();
        throw error;
    }
}

export function deactivateNativeAlarmNavigationJournal(): void {
    lifecycleEpoch += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
}

export function resetNativeAlarmNavigationJournalForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    handler = undefined;
    drainFlight = undefined;
    deactivateNativeAlarmNavigationJournal();
}

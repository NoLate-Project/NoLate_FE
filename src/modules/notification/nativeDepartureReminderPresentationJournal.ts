import { getAuthMember } from "../auth/authStorage";
import { acknowledgePushDelivery } from "./pushDeliveryAck";
import {
    getPendingNativeDepartureReminderPresentationEvents,
    markNativeDepartureReminderPresentationDelivered,
} from "./departureAlarm";
import {
    activateDepartureReminderAccountForAuthenticatedSession,
    isDepartureAlarmAccountCleanupPending,
} from "./departureAlarmSync";

export type NativeDepartureReminderPresentationDrainResult = {
    discovered: number;
    acknowledged: number;
    unresolved: number;
    accountMismatch: number;
    blocked: boolean;
};

let lifecycleEpoch = 0;
let drainFlight: {
    epoch: number;
    promise: Promise<NativeDepartureReminderPresentationDrainResult>;
} | undefined;

function memberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

export function activateNativeDepartureReminderPresentationJournal(
): Promise<NativeDepartureReminderPresentationDrainResult> {
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

async function drainEpoch(
    epoch: number,
): Promise<NativeDepartureReminderPresentationDrainResult> {
    const result: NativeDepartureReminderPresentationDrainResult = {
        discovered: 0,
        acknowledged: 0,
        unresolved: 0,
        accountMismatch: 0,
        blocked: false,
    };
    if (await isDepartureAlarmAccountCleanupPending() || epoch !== lifecycleEpoch) {
        result.blocked = true;
        return result;
    }
    const activeMemberId = memberId((await getAuthMember())?.id);
    if (!activeMemberId || epoch !== lifecycleEpoch) return result;
    if (!(await activateDepartureReminderAccountForAuthenticatedSession(activeMemberId))) {
        result.blocked = true;
        return result;
    }
    const events = await getPendingNativeDepartureReminderPresentationEvents();
    result.discovered = events.length;
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (event.recipientMemberId !== activeMemberId) {
            result.accountMismatch += 1;
            continue;
        }
        if (epoch !== lifecycleEpoch || await isDepartureAlarmAccountCleanupPending()) {
            result.unresolved += events.length - index;
            result.blocked = true;
            break;
        }
        const notificationData = {
            logicalEventKey: event.logicalEventKey,
            recipientMemberId: String(event.recipientMemberId),
        };
        // A committed native presentation proves both FCM receipt and NotificationManager
        // acceptance even when RN headless JS never ran. Keep the evidence until both idempotent
        // stages are durable so last-mile metrics do not undercount background delivery.
        const [received, presented] = await Promise.all([
            acknowledgePushDelivery(notificationData, "RECEIVED", {
                providerMessageId: event.providerMessageId,
                occurredAt: event.occurredAt,
            }),
            acknowledgePushDelivery(notificationData, "PRESENTED", {
                providerMessageId: event.providerMessageId,
                occurredAt: event.occurredAt,
            }),
        ]);
        if (!received || !presented || epoch !== lifecycleEpoch) {
            result.unresolved += 1;
            continue;
        }
        if (await markNativeDepartureReminderPresentationDelivered(event.notificationTag)) {
            result.acknowledged += 1;
        } else {
            result.unresolved += 1;
        }
    }
    return result;
}

export function deactivateNativeDepartureReminderPresentationJournal(): void {
    lifecycleEpoch += 1;
    drainFlight = undefined;
}

export function resetNativeDepartureReminderPresentationJournalForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    deactivateNativeDepartureReminderPresentationJournal();
}

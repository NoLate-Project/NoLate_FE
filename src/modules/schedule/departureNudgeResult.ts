import type { NotificationSendResult } from "../../api/schedule";

export type DepartureNudgeResultOutcome =
    | "accepted"
    | "no_registered_device"
    | "failed";

/**
 * Departure nudges are written to the durable outbox before provider dispatch.
 * `sentCount` is consequently zero in a normal queued response. Treat the
 * persisted notification snapshot as the acceptance receipt, while preserving
 * the legacy synchronous-response fallbacks for older servers.
 */
export function classifyDepartureNudgeResult(
    result: NotificationSendResult,
): DepartureNudgeResultOutcome {
    if (result.fenceRejected === true || result.recipientInactive === true) {
        return "failed";
    }
    if (result.eventSnapshot != null || result.sentCount > 0) {
        return "accepted";
    }
    if (result.requestedCount === 0) {
        return "no_registered_device";
    }
    return "failed";
}

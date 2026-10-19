import { markScheduleDeparted } from "../../api/schedule";
import { recoverDepartureAlarmsAfterMutation } from "../notification/departureAlarmMutationRecovery";
import { endLiveActivityForSchedule } from "../notification/liveActivitySync";
import type { ScheduleItem } from "./types";
import { isJourneyGuidanceEnabled } from "../journey/journeyFeature";

/**
 * Completes departure on the server before reconciling the current device's
 * native alarm snapshot. Recovery is deliberately skipped when the mutation
 * itself fails.
 */
export async function completeScheduleDeparture(
    scheduleId: string,
): Promise<ScheduleItem> {
    const updated = await markScheduleDeparted(scheduleId);
    await Promise.all([
        recoverDepartureAlarmsAfterMutation(),
        // With journeys enabled, the server owns departure-vs-journey termination.
        // A delayed legacy departure acknowledgement must not retire the new journey token.
        (isJourneyGuidanceEnabled() ? Promise.resolve() : endLiveActivityForSchedule(scheduleId)).catch((error) => {
            if (__DEV__) console.warn("[live-activity] departure completion cleanup failed", error);
        }),
    ]);
    return updated;
}

import { markScheduleDeparted } from "../../api/schedule";
import { recoverDepartureAlarmsAfterMutation } from "../notification/departureAlarmMutationRecovery";
import type { ScheduleItem } from "./types";

/**
 * Completes departure on the server before reconciling the current device's
 * native alarm snapshot. Recovery is deliberately skipped when the mutation
 * itself fails.
 */
export async function completeScheduleDeparture(
    scheduleId: string,
): Promise<ScheduleItem> {
    const updated = await markScheduleDeparted(scheduleId);
    await recoverDepartureAlarmsAfterMutation();
    return updated;
}

import {
    updateScheduleCalendar,
    type ScheduleCalendar,
} from "../../api/scheduleCalendars";
import { recoverDepartureAlarmsAfterMutation } from "../notification/departureAlarmMutationRecovery";
import type { ScheduleShareContentMode } from "../schedule/types";

/**
 * Updates a shared calendar's content mode and reconciles local native alarms
 * only when travel-plan access has actually been removed.
 */
export async function updateCalendarContentModeWithAlarmRecovery(
    calendarId: number | string,
    previousMode: ScheduleShareContentMode | undefined,
    nextMode: ScheduleShareContentMode,
): Promise<ScheduleCalendar> {
    const updated = await updateScheduleCalendar(calendarId, {
        defaultContentMode: nextMode,
    });
    if (
        previousMode === "SCHEDULE_AND_TRAVEL"
        && nextMode === "SCHEDULE_ONLY"
    ) {
        await recoverDepartureAlarmsAfterMutation();
    }
    return updated;
}

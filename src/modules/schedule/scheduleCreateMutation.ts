import {
    createSchedule,
    type SchedulePayload,
} from "../../api/schedule";
import { recoverDepartureAlarmsAfterMutation } from "../notification/departureAlarmMutationRecovery";
import type { ScheduleItem } from "./types";

/**
 * Shared mutation boundary for both the manual and Quick schedule forms.
 */
export async function createScheduleForAddItem(
    payload: SchedulePayload,
): Promise<ScheduleItem> {
    const item = await createSchedule(payload);
    await recoverDepartureAlarmsAfterMutation();
    return item;
}

import { clearCalendarScheduleCache } from "../schedule/calendarScheduleCache";
import { invalidateScheduleDepartureStatus } from "../schedule/departureStatusCache";
import { getScheduleIdFromNotificationData } from "./pushNavigation";
import {
    isScheduleNotificationAllowedBySharingPolicy,
} from "../share/scheduleSharingPolicy";

const SCHEDULE_VISIBILITY_TYPES = new Set([
    "SCHEDULE_SHARE_RECEIVED",
    "CATEGORY_SHARE_RECEIVED",
    "CALENDAR_SHARE_RECEIVED",
    "SCHEDULE_CACHE_INVALIDATED",
]);
const DEPARTURE_STATUS_CHANGE_TYPES = new Set([
    "SCHEDULE_TRAFFIC",
    "SCHEDULE_DEPARTURE_REMINDER",
    "SCHEDULE_PARTICIPANT_DEPARTED",
    "SCHEDULE_DEPARTURE_NUDGE",
]);

export function refreshForegroundPushCaches(
    data?: Record<string, unknown>,
): void {
    if (!isScheduleNotificationAllowedBySharingPolicy(data)) return;
    const type = typeof data?.type === "string" ? data.type : undefined;
    if (
        (type && DEPARTURE_STATUS_CHANGE_TYPES.has(type)) ||
        (type && SCHEDULE_VISIBILITY_TYPES.has(type))
    ) {
        clearCalendarScheduleCache();
    }
    if (!type || !DEPARTURE_STATUS_CHANGE_TYPES.has(type)) return;

    const scheduleId = getScheduleIdFromNotificationData(data);
    if (scheduleId) invalidateScheduleDepartureStatus(scheduleId);
}

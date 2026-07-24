import { clearCalendarScheduleCache } from "../schedule/calendarScheduleCache";
import { invalidateScheduleDepartureStatus } from "../schedule/departureStatusCache";
import { getScheduleIdFromNotificationData } from "./pushNavigation";

const SCHEDULE_VISIBILITY_TYPES = new Set([
    "SCHEDULE_SHARE_RECEIVED",
    "CATEGORY_SHARE_RECEIVED",
    "CALENDAR_SHARE_RECEIVED",
    "SCHEDULE_CACHE_INVALIDATED",
]);

export function refreshForegroundPushCaches(
    data?: Record<string, unknown>,
): void {
    const type = typeof data?.type === "string" ? data.type : undefined;
    if (type === "SCHEDULE_TRAFFIC" || (type && SCHEDULE_VISIBILITY_TYPES.has(type))) {
        clearCalendarScheduleCache();
    }
    if (type !== "SCHEDULE_TRAFFIC") return;

    const scheduleId = getScheduleIdFromNotificationData(data);
    if (scheduleId) invalidateScheduleDepartureStatus(scheduleId);
}

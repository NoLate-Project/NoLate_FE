import type { ScheduleAlertMode } from "./types";

export function normalizeScheduleAlertMode(
    value: ScheduleAlertMode | null | undefined,
): ScheduleAlertMode {
    return value === "ALARM" ? "ALARM" : "STANDARD";
}

/**
 * The backend persists ALARM independently from notificationEnabled and can
 * create a route preference row for disabled alarms. Never send a dormant
 * strong-alarm preference when there is no active route notification.
 */
export function resolveScheduleAlertModePayload({
    hasRoutePlan,
    notificationEnabled,
    selectedMode,
}: {
    hasRoutePlan: boolean;
    notificationEnabled: boolean;
    selectedMode: ScheduleAlertMode;
}): ScheduleAlertMode {
    if (!hasRoutePlan || !notificationEnabled) return "STANDARD";
    return normalizeScheduleAlertMode(selectedMode);
}

import type { ScheduleAlertMode } from "./types";

export const SCHEDULE_ALERT_MODE_PRESENTATION: Record<
    ScheduleAlertMode,
    {
        label: string;
        accessibilityLabel: string;
        description: string;
    }
> = {
    STANDARD: {
        label: "푸시 알림",
        accessibilityLabel: "푸시 알림 선택",
        description: "알림 배너로 알려드려요.",
    },
    ALARM: {
        label: "출발 알람",
        accessibilityLabel: "출발 알람 선택",
        description: "출발 시간에 알람이 울려요.",
    },
};

export function getScheduleAlertModeLabel(mode: ScheduleAlertMode): string {
    return SCHEDULE_ALERT_MODE_PRESENTATION[mode].label;
}

export function normalizeScheduleAlertMode(value: ScheduleAlertMode | null | undefined): ScheduleAlertMode {
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

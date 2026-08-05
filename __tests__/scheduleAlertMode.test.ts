import {
    getScheduleAlertModeLabel,
    normalizeScheduleAlertMode,
    resolveScheduleAlertModePayload,
    SCHEDULE_ALERT_MODE_PRESENTATION,
} from "../src/modules/schedule/scheduleAlertMode";

describe("schedule alert mode payload policy", () => {
    test("legacy or missing values normalize to STANDARD", () => {
        expect(normalizeScheduleAlertMode(undefined)).toBe("STANDARD");
        expect(normalizeScheduleAlertMode(null)).toBe("STANDARD");
        expect(normalizeScheduleAlertMode("STANDARD")).toBe("STANDARD");
        expect(normalizeScheduleAlertMode("ALARM")).toBe("ALARM");
    });

    test.each([
        {
            hasRoutePlan: false,
            notificationEnabled: true,
            selectedMode: "ALARM" as const,
        },
        {
            hasRoutePlan: true,
            notificationEnabled: false,
            selectedMode: "ALARM" as const,
        },
        {
            hasRoutePlan: false,
            notificationEnabled: false,
            selectedMode: "ALARM" as const,
        },
    ])("disabled or no-route payload is always STANDARD: %o", input => {
        expect(resolveScheduleAlertModePayload(input)).toBe("STANDARD");
    });

    test("enabled route notification preserves the selected mode", () => {
        expect(
            resolveScheduleAlertModePayload({
                hasRoutePlan: true,
                notificationEnabled: true,
                selectedMode: "ALARM",
            }),
        ).toBe("ALARM");
        expect(
            resolveScheduleAlertModePayload({
                hasRoutePlan: true,
                notificationEnabled: true,
                selectedMode: "STANDARD",
            }),
        ).toBe("STANDARD");
    });

    test("UI에서 푸시 알림과 출발 알람을 간결하게 구분한다", () => {
        expect(getScheduleAlertModeLabel("STANDARD")).toBe("푸시 알림");
        expect(getScheduleAlertModeLabel("ALARM")).toBe("출발 알람");
        expect(SCHEDULE_ALERT_MODE_PRESENTATION.STANDARD.description).toBe("알림 배너로 알려드려요.");
        expect(SCHEDULE_ALERT_MODE_PRESENTATION.ALARM.description).toBe("출발 시간에 알람이 울려요.");
        expect(SCHEDULE_ALERT_MODE_PRESENTATION.ALARM.description).not.toContain("AlarmKit");
    });
});

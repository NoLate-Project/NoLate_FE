import {
    normalizeScheduleAlertMode,
    resolveScheduleAlertModePayload,
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
    ])("disabled or no-route payload is always STANDARD: %o", (input) => {
        expect(resolveScheduleAlertModePayload(input)).toBe("STANDARD");
    });

    test("enabled route notification preserves the selected mode", () => {
        expect(resolveScheduleAlertModePayload({
            hasRoutePlan: true,
            notificationEnabled: true,
            selectedMode: "ALARM",
        })).toBe("ALARM");
        expect(resolveScheduleAlertModePayload({
            hasRoutePlan: true,
            notificationEnabled: true,
            selectedMode: "STANDARD",
        })).toBe("STANDARD");
    });
});

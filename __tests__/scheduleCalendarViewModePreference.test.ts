const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const scheduleIndexSource = readFileSync("app/schedule/index.tsx", "utf8");

function sourceBetween(start: string, end: string) {
    const startIndex = scheduleIndexSource.indexOf(start);
    const endIndex = scheduleIndexSource.indexOf(end, startIndex);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return scheduleIndexSource.slice(startIndex, endIndex);
}

describe("schedule calendar view mode preference wiring", () => {
    test("restores the preference before mounting the calendar screen", () => {
        const preferenceGate = sourceBetween(
            "export default function ScheduleIndex()",
            "function ScheduleIndexContent"
        );

        expect(preferenceGate).toContain("getCachedCalendarViewModePreference()");
        expect(preferenceGate).toContain("loadCalendarViewModePreference()");
        expect(preferenceGate).toContain("if (!initialCalendarViewMode)");
        expect(preferenceGate).toContain(
            "<ScheduleIndexContent initialCalendarViewMode={initialCalendarViewMode} />"
        );
    });

    test("initializes the mode, retained panel, and motion values from one preference", () => {
        const initialization = sourceBetween(
            "function ScheduleIndexContent",
            "const monthViewTransitionGenerationRef"
        );

        expect(initialization).toContain(
            "useState<CalendarViewMode>(\n        initialCalendarViewMode"
        );
        expect(initialization).toContain(
            "getMonthAgendaPanelKind(initialCalendarViewMode) ?? \"detail\""
        );
        expect(initialization).toContain(
            "CALENDAR_DAY_HEIGHTS[initialCalendarViewMode]"
        );
    });

    test("persists selections only through the shared view-mode handler", () => {
        const handler = sourceBetween(
            "const handleCalendarViewModeChange",
            "const handleDayViewMenuSelect"
        );

        expect(handler).toContain("rememberCalendarViewModePreference(nextMode)");
        expect(handler).toContain("setCalendarViewMode(nextMode)");
    });
});

import {
    getCalendarScopePresentation,
    getScheduleCreationCalendarId,
    getScheduleTargetCalendarId,
    isCategoryAvailableForScheduleCreation,
    isCategoryInCalendarScope,
    isScheduleInCalendarScope,
    normalizeCalendarScope,
} from "../src/modules/schedule/calendarScope";

describe("calendarScope", () => {
    const personal = { calendarId: null };
    const shared = { calendarId: 21 };

    it("filters personal and shared schedules independently", () => {
        expect(isScheduleInCalendarScope(personal as never, "all")).toBe(true);
        expect(isScheduleInCalendarScope(personal as never, "personal")).toBe(true);
        expect(isScheduleInCalendarScope(shared as never, "personal")).toBe(false);
        expect(isScheduleInCalendarScope(shared as never, 21)).toBe(true);
        expect(isScheduleInCalendarScope(shared as never, 22)).toBe(false);
    });

    it("uses personal categories in all view and calendar categories in a shared view", () => {
        expect(isCategoryInCalendarScope(personal, "all")).toBe(true);
        expect(isCategoryInCalendarScope(shared, "all")).toBe(false);
        expect(isCategoryInCalendarScope(shared, 21)).toBe(true);
    });

    it("targets only an explicitly selected shared calendar for creation", () => {
        expect(getScheduleTargetCalendarId("all")).toBeNull();
        expect(getScheduleTargetCalendarId("personal")).toBeNull();
        expect(getScheduleTargetCalendarId(21)).toBe(21);
    });

    it("keeps a moved direct-share category writable outside calendar membership", () => {
        const directCategory = { calendarId: 21, shared: true };
        expect(isCategoryAvailableForScheduleCreation(
            directCategory,
            "personal",
            new Set(),
        )).toBe(true);
        expect(isCategoryAvailableForScheduleCreation(
            directCategory,
            "personal",
            new Set([21]),
        )).toBe(false);
        expect(getScheduleCreationCalendarId("personal", directCategory)).toBe(21);
        expect(getScheduleCreationCalendarId(30, { calendarId: 30 })).toBe(30);
        expect(getScheduleCreationCalendarId("personal", { calendarId: null })).toBeNull();
    });

    it("falls back to all when a selected calendar is no longer visible", () => {
        const calendars = [{ id: 21 }] as never[];
        expect(normalizeCalendarScope(21, calendars)).toBe(21);
        expect(normalizeCalendarScope(22, calendars)).toBe("all");
    });

    it("returns the full selected calendar identity for the separate context label", () => {
        const calendars = [{
            id: 21,
            title: "가족 캘린더",
            color: "#2F80FF",
        }] as never[];

        expect(getCalendarScopePresentation(21, calendars)).toEqual({
            title: "가족 캘린더",
            color: "#2F80FF",
        });
        expect(getCalendarScopePresentation("all", calendars)).toEqual({ title: "전체 일정" });
        expect(getCalendarScopePresentation("personal", calendars)).toEqual({ title: "개인 일정" });
    });
});

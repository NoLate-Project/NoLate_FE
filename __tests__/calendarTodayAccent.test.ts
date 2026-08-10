import {
    CALENDAR_TODAY_ACCENT,
    getCalendarTodayAccent,
} from "../src/modules/schedule/components/calendar/calendarTodayAccent";

describe("calendar today accent", () => {
    test("년·월·일 화면이 같은 NoLate 파랑을 사용한다", () => {
        expect(getCalendarTodayAccent("light")).toBe("#2979FF");
        expect(getCalendarTodayAccent("dark")).toBe("#4B9DFF");
        expect(CALENDAR_TODAY_ACCENT).toEqual({
            light: "#2979FF",
            dark: "#4B9DFF",
        });
    });
});

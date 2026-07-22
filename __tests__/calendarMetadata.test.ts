import {
    formatLunarCalendarDay,
    getCalendarMetadataRange,
    indexCalendarDays,
    type CalendarDayMetadata,
} from "../src/modules/schedule/calendarMetadata";

describe("calendar metadata presentation", () => {
    test("월간 달력의 앞뒤 주 날짜까지 API 조회 범위에 포함한다", () => {
        expect(getCalendarMetadataRange("2026-07-14", 0)).toEqual({
            startDate: "2026-06-28",
            endDate: "2026-08-01",
        });
        expect(getCalendarMetadataRange("2026-07-14", 1)).toEqual({
            startDate: "2026-06-29",
            endDate: "2026-08-02",
        });
    });

    test("일반 음력과 윤달을 짧은 월간 셀 문구로 만든다", () => {
        expect(formatLunarCalendarDay({
            date: "2026-09-25",
            lunarMonth: 8,
            lunarDay: 15,
            leapMonth: false,
            holidays: [],
        })).toBe("음 8.15");
        expect(formatLunarCalendarDay({
            date: "2026-05-31",
            lunarMonth: 4,
            lunarDay: 15,
            leapMonth: true,
            holidays: [],
        })).toBe("음 윤4.15");
    });

    test("날짜별 인덱스를 만들어 기존 성공 데이터와 병합할 수 있다", () => {
        const day: CalendarDayMetadata = {
            date: "2026-08-15",
            lunarMonth: 7,
            lunarDay: 3,
            holidays: [{ name: "광복절", type: "PUBLIC_HOLIDAY" }],
        };

        expect(indexCalendarDays([day])).toEqual({ "2026-08-15": day });
    });
});


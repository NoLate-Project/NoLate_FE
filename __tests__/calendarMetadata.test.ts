import {
    formatLunarCalendarDay,
    getCalendarMetadataPrefetchMonthKeys,
    getCalendarMetadataPrefetchRange,
    getCalendarMetadataRange,
    indexCalendarDays,
    isCalendarMetadataMonthComplete,
    mergeCalendarMetadataDays,
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

    test("상세 월 이동 전에 이전·현재·다음 달의 메타데이터 범위를 준비한다", () => {
        expect(getCalendarMetadataPrefetchMonthKeys("2026-07-14")).toEqual([
            "2026-06",
            "2026-07",
            "2026-08",
        ]);
        expect(getCalendarMetadataPrefetchRange("2026-07-14", 0)).toEqual({
            startDate: "2026-05-31",
            endDate: "2026-09-05",
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

    test("SWR snapshot은 월 전체 refresh 완료 여부를 구분한다", () => {
        const completeFebruary: Record<string, CalendarDayMetadata> = Object.fromEntries(
            Array.from({ length: 28 }, (_, index) => {
                const date = `2026-02-${String(index + 1).padStart(2, "0")}`;
                return [date, {
                    date,
                    holidays: [],
                    metadataComplete: true,
                } satisfies CalendarDayMetadata];
            })
        );
        expect(isCalendarMetadataMonthComplete(
            completeFebruary,
            "2026-02"
        )).toBe(true);

        completeFebruary["2026-02-14"] = {
            ...completeFebruary["2026-02-14"],
            metadataComplete: false,
        };
        expect(isCalendarMetadataMonthComplete(
            completeFebruary,
            "2026-02"
        )).toBe(false);
    });

    test("늦게 도착한 partial 응답이 이미 완료된 날짜를 덮지 않는다", () => {
        const completeDay: CalendarDayMetadata = {
            date: "2027-02-09",
            lunarMonth: 1,
            lunarDay: 3,
            holidays: [{ name: "대체공휴일(설날)", type: "PUBLIC_HOLIDAY" }],
            metadataComplete: true,
        };
        const current = { [completeDay.date]: completeDay };
        const partialDay: CalendarDayMetadata = {
            date: completeDay.date,
            holidays: [],
            metadataComplete: false,
        };

        expect(mergeCalendarMetadataDays(current, {
            [partialDay.date]: partialDay,
        })).toBe(current);
    });

    test("완료 응답은 partial 날짜를 교체하고 동일 응답은 참조를 유지한다", () => {
        const partialDay: CalendarDayMetadata = {
            date: "2027-02-09",
            holidays: [],
            metadataComplete: false,
        };
        const completeDay: CalendarDayMetadata = {
            ...partialDay,
            lunarMonth: 1,
            lunarDay: 3,
            metadataComplete: true,
        };
        const current = { [partialDay.date]: partialDay };
        const completed = mergeCalendarMetadataDays(current, {
            [completeDay.date]: completeDay,
        });

        expect(completed).not.toBe(current);
        expect(completed[completeDay.date]).toBe(completeDay);
        expect(mergeCalendarMetadataDays(completed, {
            [completeDay.date]: { ...completeDay },
        })).toBe(completed);
    });
});

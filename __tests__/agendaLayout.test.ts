import {
    buildMonthAgendaSections,
    formatAgendaDetailScheduleTime,
    formatAgendaDetailTimeColumn,
    formatAgendaMultiDayTimeRange,
    formatAgendaSectionHeader,
    getAgendaMultiDaySummary,
    getSelectedDayAgendaItems,
    getVisibleMonthAgendaItems,
} from "../src/modules/schedule/agendaLayout";
import type { ScheduleItem } from "../src/modules/schedule/types";

const category = { id: "work", title: "업무", color: "#2563EB" };

function localIso(
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0
): string {
    return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function item(
    id: string,
    startAt: string,
    endAt: string,
    title = id
): ScheduleItem {
    return { id, title, startAt, endAt, category };
}

describe("agenda layout", () => {
    test("보이는 달과 겹치는 일정을 ID 중복 없이 시작 시각 순으로 반환한다", () => {
        const items: ScheduleItem[] = [
            item("later", localIso(2026, 7, 20, 9), localIso(2026, 7, 20, 10)),
            item("crosses-start", localIso(2026, 6, 30, 23), localIso(2026, 7, 1, 1)),
            item("duplicate", localIso(2026, 7, 8, 12), localIso(2026, 7, 8, 13), "이전 데이터"),
            item("outside-before", localIso(2026, 6, 30, 22), localIso(2026, 7, 1, 0)),
            item("duplicate", localIso(2026, 7, 8, 11), localIso(2026, 7, 8, 12), "최신 데이터"),
            item("outside-after", localIso(2026, 8, 1, 0), localIso(2026, 8, 1, 1)),
            item("invalid", "not-a-date", "also-invalid"),
        ];

        const result = getVisibleMonthAgendaItems(items, "2026-07");

        expect(result.map((schedule) => schedule.id)).toEqual([
            "crosses-start",
            "duplicate",
            "later",
        ]);
        expect(result.find((schedule) => schedule.id === "duplicate")?.title).toBe("최신 데이터");
    });

    test("여러 날 일정도 시작 날짜 section에 한 번만 넣는다", () => {
        const overnight = item(
            "overnight",
            localIso(2026, 7, 8, 23),
            localIso(2026, 7, 10, 0)
        );
        const meeting = item(
            "meeting",
            localIso(2026, 7, 9, 9),
            localIso(2026, 7, 9, 10)
        );

        const sections = buildMonthAgendaSections([meeting, overnight], "2026-07-15");

        expect(sections).toEqual([
            {
                dateKey: "2026-07-08",
                header: "7월 8일 수요일",
                itemCount: 1,
                items: [overnight],
            },
            {
                dateKey: "2026-07-09",
                header: "7월 9일 목요일",
                itemCount: 1,
                items: [meeting],
            },
        ]);
    });

    test("달 경계를 가로지르는 일정은 보이는 달 안의 section에만 포함한다", () => {
        const spansMonth = item(
            "spans-month",
            localIso(2026, 6, 30, 18),
            localIso(2026, 7, 2, 0)
        );

        const sections = buildMonthAgendaSections([spansMonth], "2026-07");

        expect(sections.map((section) => section.dateKey)).toEqual([
            "2026-07-01",
        ]);
        expect(sections[0].items).toEqual([spansMonth]);
    });

    test("선택일 목록도 end-exclusive 규칙, ID 중복 제거, 시작 시각 정렬을 적용한다", () => {
        const endedAtMidnight = item(
            "ended-at-midnight",
            localIso(2026, 7, 8, 22),
            localIso(2026, 7, 9, 0)
        );
        const spanning = item(
            "spanning",
            localIso(2026, 7, 8, 23),
            localIso(2026, 7, 10, 0)
        );
        const morningOld = item(
            "morning",
            localIso(2026, 7, 9, 10),
            localIso(2026, 7, 9, 11),
            "이전 데이터"
        );
        const morningLatest = { ...morningOld, title: "최신 데이터" };

        const result = getSelectedDayAgendaItems(
            [morningOld, endedAtMidnight, spanning, morningLatest],
            "2026-07-09"
        );

        expect(result.map((schedule) => schedule.id)).toEqual(["spanning", "morning"]);
        expect(result[1].title).toBe("최신 데이터");
    });

    test("종료 시각이 없는 점 일정은 시작 날짜에 표시한다", () => {
        const point = item(
            "point",
            localIso(2026, 7, 12, 9),
            localIso(2026, 7, 12, 9)
        );

        expect(getSelectedDayAgendaItems([point], "2026-07-12")).toEqual([point]);
        expect(getSelectedDayAgendaItems([point], "2026-07-13")).toEqual([]);
    });

    test("연속 일정은 end-exclusive 로컬 날짜 범위와 N박 N일을 계산한다", () => {
        const summary = getAgendaMultiDaySummary(item(
            "trip",
            localIso(2026, 7, 14),
            localIso(2026, 7, 17)
        ));

        expect(summary).toEqual({
            dayCount: 3,
            nightCount: 2,
            stayLabel: "2박 3일",
            dateRangeLabel: "7월 14일–16일",
        });
    });

    test("당일·자정 종료·잘못된 범위에는 숙박 정보를 만들지 않는다", () => {
        expect(getAgendaMultiDaySummary(item(
            "same-day",
            localIso(2026, 7, 14, 9),
            localIso(2026, 7, 14, 10)
        ))).toBeNull();
        expect(getAgendaMultiDaySummary(item(
            "ends-at-midnight",
            localIso(2026, 7, 14, 23),
            localIso(2026, 7, 15, 0)
        ))).toBeNull();
        expect(getAgendaMultiDaySummary(item(
            "invalid",
            "invalid",
            "also-invalid"
        ))).toBeNull();
        expect(getAgendaMultiDaySummary(item(
            "reversed",
            localIso(2026, 7, 15),
            localIso(2026, 7, 14)
        ))).toBeNull();
    });

    test("월·연도 경계에서도 전체 날짜 범위를 유지한다", () => {
        expect(getAgendaMultiDaySummary(item(
            "month-boundary",
            localIso(2026, 7, 31, 10),
            localIso(2026, 8, 2, 10)
        ))).toMatchObject({
            stayLabel: "2박 3일",
            dateRangeLabel: "7월 31일–8월 2일",
        });
        expect(getAgendaMultiDaySummary(item(
            "year-boundary",
            localIso(2026, 12, 31, 10),
            localIso(2027, 1, 2, 10)
        ))).toMatchObject({
            stayLabel: "2박 3일",
            dateRangeLabel: "2026년 12월 31일–2027년 1월 2일",
        });
    });

    test("날짜를 넘기는 시간 일정은 양쪽 날짜와 오전·오후를 함께 표시한다", () => {
        expect(formatAgendaMultiDayTimeRange(item(
            "overnight-timed",
            localIso(2026, 7, 14, 23, 55),
            localIso(2026, 7, 15, 0, 10)
        ))).toBe("7월 14일 오후 11:55 → 7월 15일 오전 12:10");

        expect(formatAgendaMultiDayTimeRange(item(
            "ends-at-midnight",
            localIso(2026, 7, 14, 23),
            localIso(2026, 7, 15, 0)
        ))).toBe("7월 14일 오후 11:00 → 7월 15일 오전 12:00");

        expect(formatAgendaMultiDayTimeRange(item(
            "year-boundary-timed",
            localIso(2026, 12, 31, 23, 30),
            localIso(2027, 1, 1, 0, 30)
        ))).toBe("2026년 12월 31일 오후 11:30 → 2027년 1월 1일 오전 12:30");
    });

    test("당일·종일·종료 미설정 일정은 다일 시간 범위를 만들지 않는다", () => {
        expect(formatAgendaMultiDayTimeRange(item(
            "same-day-timed",
            localIso(2026, 7, 14, 9),
            localIso(2026, 7, 14, 10)
        ))).toBeNull();
        expect(formatAgendaMultiDayTimeRange({
            ...item(
                "all-day",
                localIso(2026, 7, 14),
                localIso(2026, 7, 16)
            ),
            allDay: true,
        })).toBeNull();
        expect(formatAgendaMultiDayTimeRange({
            ...item(
                "no-end",
                localIso(2026, 7, 14, 9),
                localIso(2026, 7, 16, 9)
            ),
            hasEndTime: false,
        })).toBeNull();
        expect(getAgendaMultiDaySummary({
            ...item(
                "no-end-summary",
                localIso(2026, 7, 14, 9),
                localIso(2026, 7, 16, 9)
            ),
            hasEndTime: false,
        })).toBeNull();
    });

    test("상세형 카드의 5가지 일정 유형을 한 줄 날짜·시간 문구로 정리한다", () => {
        expect(formatAgendaDetailScheduleTime({
            ...item(
                "start-only",
                localIso(2026, 7, 14, 15, 20),
                localIso(2026, 7, 14, 16, 20)
            ),
            hasEndTime: false,
        })).toBe("7월 14일 오후 3:20");

        expect(formatAgendaDetailScheduleTime(item(
            "same-day-timed",
            localIso(2026, 7, 14, 15, 40),
            localIso(2026, 7, 14, 16, 10)
        ))).toBe("7월 14일 오후 3:40 → 오후 4:10");

        expect(formatAgendaDetailScheduleTime(item(
            "multi-day-timed",
            localIso(2026, 7, 14, 23, 55),
            localIso(2026, 7, 15, 0, 10)
        ))).toBe("7월 14일 오후 11:55 → 7월 15일 오전 12:10");

        expect(formatAgendaDetailScheduleTime({
            ...item(
                "single-all-day",
                localIso(2026, 7, 17),
                localIso(2026, 7, 18)
            ),
            allDay: true,
        })).toBe("7월 17일 · 종일");

        expect(formatAgendaDetailScheduleTime({
            ...item(
                "multi-all-day",
                localIso(2026, 7, 18),
                localIso(2026, 7, 21)
            ),
            allDay: true,
        })).toBe("7월 18일–20일 · 종일");
    });

    test("상세형 우측 시간열은 당일은 시각만, 다일은 날짜와 시각을 나눈다", () => {
        expect(formatAgendaDetailTimeColumn(item(
            "same-day",
            localIso(2026, 7, 14, 15, 40),
            localIso(2026, 7, 14, 16, 10)
        ))).toEqual({
            startLabel: "오후 3:40",
            endLabel: "오후 4:10",
        });

        expect(formatAgendaDetailTimeColumn(item(
            "multi-day",
            localIso(2026, 7, 14, 23, 55),
            localIso(2026, 7, 15, 0, 10)
        ))).toEqual({
            startLabel: "7/14 오후 11:55",
            endLabel: "7/15 오전 12:10",
        });

        expect(formatAgendaDetailTimeColumn({
            ...item(
                "start-only",
                localIso(2026, 7, 14, 15, 20),
                localIso(2026, 7, 14, 16, 20)
            ),
            hasEndTime: false,
        })).toEqual({
            startLabel: "오후 3:20",
            endLabel: null,
        });
    });

    test("상세형 우측 시간열은 종일 일정의 단일일·기간을 구분한다", () => {
        expect(formatAgendaDetailTimeColumn({
            ...item(
                "single-all-day",
                localIso(2026, 7, 17),
                localIso(2026, 7, 18)
            ),
            allDay: true,
        })).toEqual({
            startLabel: "종일",
            endLabel: null,
        });

        expect(formatAgendaDetailTimeColumn({
            ...item(
                "multi-all-day",
                localIso(2026, 7, 18),
                localIso(2026, 7, 21)
            ),
            allDay: true,
        })).toEqual({
            startLabel: "7/18 시작",
            endLabel: "7/20 종료",
        });
    });

    test("한국어 header와 잘못된 날짜 입력을 안정적으로 처리한다", () => {
        expect(formatAgendaSectionHeader("2026-07-08")).toBe("7월 8일 수요일");
        expect(formatAgendaSectionHeader("invalid")).toBe("invalid");
        expect(getVisibleMonthAgendaItems([], "2026-13")).toEqual([]);
        expect(buildMonthAgendaSections([], "2026-02-30")).toEqual([]);
        expect(getSelectedDayAgendaItems([], "2026-02-30")).toEqual([]);
    });
});

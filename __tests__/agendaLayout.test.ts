import {
    buildMonthAgendaSections,
    formatAgendaSectionHeader,
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

    test("한국어 header와 잘못된 날짜 입력을 안정적으로 처리한다", () => {
        expect(formatAgendaSectionHeader("2026-07-08")).toBe("7월 8일 수요일");
        expect(formatAgendaSectionHeader("invalid")).toBe("invalid");
        expect(getVisibleMonthAgendaItems([], "2026-13")).toEqual([]);
        expect(buildMonthAgendaSections([], "2026-02-30")).toEqual([]);
        expect(getSelectedDayAgendaItems([], "2026-02-30")).toEqual([]);
    });
});

import {
    createStackCalendarLayout,
    enumerateStackScheduleDays,
} from "../src/modules/schedule/components/calendar/stackCalendarLayout";
import type { ScheduleItem } from "../src/modules/schedule/types";

function allDayItem(
    id: string,
    startDay: string,
    endExclusiveDay: string
): ScheduleItem {
    return {
        id,
        title: id,
        startAt: `${startDay}T00:00:00+09:00`,
        endAt: `${endExclusiveDay}T00:00:00+09:00`,
        allDay: true,
        travelMode: "TRANSIT",
        category: { id: "travel", title: "여행", color: "#ff3b30" },
    };
}

function timedItem(id: string, day: string, hour: number): ScheduleItem {
    return {
        id,
        title: id,
        startAt: `${day}T${String(hour).padStart(2, "0")}:00:00+09:00`,
        endAt: `${day}T${String(hour + 1).padStart(2, "0")}:00:00+09:00`,
        category: { id: "normal", title: "일반", color: "#0a84ff" },
    };
}

function visibleIds(layout: ReturnType<typeof createStackCalendarLayout>, day: string) {
    return layout.byDate[day].lanes.map((event) => event?.id ?? null);
}

describe("stack calendar stable lanes", () => {
    test("종료일을 exclusive로 처리하고 겹친 연속 일정을 같은 lane으로 연결한다", () => {
        const a = allDayItem("A", "2026-07-22", "2026-07-28");
        const b = allDayItem("B", "2026-07-23", "2026-07-27");
        const c = allDayItem("C", "2026-07-24", "2026-07-26");
        const layout = createStackCalendarLayout([
            a,
            b,
            c,
            timedItem("S1", "2026-07-24", 9),
            timedItem("S2", "2026-07-24", 11),
        ], 0);

        expect(enumerateStackScheduleDays(a)).toEqual([
            "2026-07-22",
            "2026-07-23",
            "2026-07-24",
            "2026-07-25",
            "2026-07-26",
            "2026-07-27",
        ]);
        expect(layout.byDate["2026-07-28"]).toBeUndefined();
        expect(visibleIds(layout, "2026-07-22")).toEqual(["A", null]);
        expect(visibleIds(layout, "2026-07-23")).toEqual(["A", "B"]);
        expect(visibleIds(layout, "2026-07-24")).toEqual(["A", "B"]);
        expect(layout.byDate["2026-07-24"].overflowCount).toBe(3);

        expect(layout.byDate["2026-07-22"].lanes[0]?.position).toBe("start");
        expect(layout.byDate["2026-07-23"].lanes[0]?.position).toBe("middle");
        expect(layout.byDate["2026-07-27"].lanes[0]?.position).toBe("end");
        expect(layout.byDate["2026-07-25"].lanes[0]?.connectsAfter).toBe(true);
        expect(layout.byDate["2026-07-26"].lanes[0]?.connectsBefore).toBe(true);
        expect(layout.byDate["2026-07-22"].lanes[0]?.showsLabel).toBe(true);
        expect(layout.byDate["2026-07-23"].lanes[0]?.showsLabel).toBe(false);
        expect(layout.byDate["2026-07-25"].lanes[0]?.showsLabel).toBe(false);
        expect(layout.byDate["2026-07-26"].lanes[0]?.showsLabel).toBe(true);
        expect(layout.byDate["2026-07-27"].lanes[0]?.showsLabel).toBe(false);
    });

    test("위 일정이 끝나도 진행 중인 두 번째 일정의 lane을 당기지 않는다", () => {
        const layout = createStackCalendarLayout([
            allDayItem("shortA", "2026-07-20", "2026-07-23"),
            allDayItem("longB", "2026-07-21", "2026-07-26"),
            allDayItem("newC", "2026-07-23", "2026-07-25"),
        ], 0);

        expect(visibleIds(layout, "2026-07-21")).toEqual(["shortA", "longB"]);
        expect(visibleIds(layout, "2026-07-22")).toEqual(["shortA", "longB"]);
        expect(visibleIds(layout, "2026-07-23")).toEqual(["newC", "longB"]);
        expect(visibleIds(layout, "2026-07-24")).toEqual(["newC", "longB"]);
        expect(layout.byDate["2026-07-23"].lanes[1]?.connectsBefore).toBe(true);
        expect(layout.byDate["2026-07-23"].lanes[1]?.connectsAfter).toBe(true);
    });

    test("단일 일정은 비어 있는 lane의 둥근 single pill로 배치한다", () => {
        const layout = createStackCalendarLayout([
            timedItem("single", "2026-07-29", 9),
        ], 0);
        const event = layout.byDate["2026-07-29"].lanes[0];

        expect(event).toMatchObject({
            id: "single",
            lane: 0,
            position: "single",
            connectsBefore: false,
            connectsAfter: false,
            showsLabel: true,
        });
        expect(layout.byDate["2026-07-29"].overflowCount).toBe(0);
    });
});

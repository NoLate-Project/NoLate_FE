import type { ScheduleItem } from "../src/modules/schedule/types";
import {
    emitScheduleDepartureMutation,
    subscribeScheduleDepartureMutation,
} from "../src/modules/schedule/scheduleDepartureMutationEvents";

const item: ScheduleItem = {
    id: "42",
    title: "출발 일정",
    startAt: "2026-07-24T10:00:00+09:00",
    endAt: "2026-07-24T11:00:00+09:00",
    myDepartedAt: "2026-07-24T09:20:00+09:00",
    category: { id: "1", title: "기본", color: "#2979FF" },
};

test("authoritative depart 응답은 후속 status GET이 offline이어도 refreshing event에 지워지지 않는다", () => {
    let mountedItem: ScheduleItem | undefined;
    let refreshing = false;
    const unsubscribe = subscribeScheduleDepartureMutation((event) => {
        if (event.item) mountedItem = event.item;
        refreshing = event.refreshing === true;
    });

    emitScheduleDepartureMutation({
        kind: "departed",
        scheduleId: "42",
        item,
        refreshing: true,
    });
    emitScheduleDepartureMutation({
        kind: "snoozed",
        scheduleId: "42",
        refreshing: true,
    });

    expect(mountedItem?.myDepartedAt).toBe("2026-07-24T09:20:00+09:00");
    expect(refreshing).toBe(true);
    unsubscribe();
});

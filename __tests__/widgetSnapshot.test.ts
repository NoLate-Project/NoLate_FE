import {
    buildNoLateWidgetSnapshot,
    NO_LATE_WIDGET_MAX_SCHEDULES,
} from "../src/modules/widget/widgetSnapshot";
import type { ScheduleItem } from "../src/modules/schedule/types";

const now = new Date("2026-08-24T09:00:00+09:00");

function schedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
    return {
        id: "schedule-1",
        title: "팀 주간 회의",
        startAt: "2026-08-24T11:00:00+09:00",
        endAt: "2026-08-24T12:00:00+09:00",
        category: {
            id: "work",
            title: "업무",
            color: "#17c",
        },
        ...overrides,
    };
}

describe("NoLate widget snapshot", () => {
    it("projects only widget-safe fields and derives the recommended departure", () => {
        const snapshot = buildNoLateWidgetSnapshot([
            schedule({
                title: "  팀   주간 회의  ",
                travelMinutes: 35,
                travelMode: "TRANSIT",
                destination: {
                    name: "NoLate 오피스",
                    address: "위젯에 공유하면 안 되는 전체 주소",
                    lat: 37.5,
                    lng: 127,
                },
                notes: "위젯에 공유하면 안 되는 메모",
                route: { coordinates: [37.5, 127] },
            }),
        ], now);

        expect(snapshot).toEqual({
            version: 1,
            generatedAt: now.toISOString(),
            schedules: [expect.objectContaining({
                id: "schedule-1",
                title: "팀 주간 회의",
                categoryTitle: "업무",
                categoryColor: "#1177CC",
                destinationName: "NoLate 오피스",
                travelMinutes: 35,
                travelMode: "TRANSIT",
                departAt: "2026-08-24T01:25:00.000Z",
            })],
        });
        expect(JSON.stringify(snapshot)).not.toContain("전체 주소");
        expect(JSON.stringify(snapshot)).not.toContain("공유하면 안 되는 메모");
        expect(JSON.stringify(snapshot)).not.toContain("coordinates");
    });

    it("keeps an explicit departure time but minimizes completion evidence to a boolean", () => {
        const snapshot = buildNoLateWidgetSnapshot([
            schedule({
                departAt: "2026-08-24T10:10:00+09:00",
                departedAt: "2026-08-24T10:08:00+09:00",
                myDepartedAt: "2026-08-24T10:09:00+09:00",
                travelMinutes: 35,
            }),
        ], now);

        expect(snapshot.schedules[0]).toEqual(expect.objectContaining({
            departAt: "2026-08-24T01:10:00.000Z",
            departureCompleted: true,
        }));
        expect(JSON.stringify(snapshot)).not.toContain("2026-08-24T01:08:00.000Z");
        expect(JSON.stringify(snapshot)).not.toContain("2026-08-24T01:09:00.000Z");
    });

    it("normalizes a zero-duration all-day schedule through the following midnight", () => {
        const snapshot = buildNoLateWidgetSnapshot([
            schedule({
                allDay: true,
                hasEndTime: false,
                startAt: "2026-08-24T00:00:00+09:00",
                endAt: "2026-08-24T00:00:00+09:00",
            }),
        ], now);

        expect(snapshot.schedules[0]).toEqual(expect.objectContaining({
            allDay: true,
            hasEndTime: false,
            endAt: "2026-08-24T15:00:00.000Z",
        }));
    });

    it("preserves an explicit missing end time instead of inferring it from endAt", () => {
        const snapshot = buildNoLateWidgetSnapshot([
            schedule({ hasEndTime: false }),
        ], now);

        expect(snapshot.schedules[0].hasEndTime).toBe(false);
    });

    it("sorts, deduplicates and excludes expired, invalid and far-future schedules", () => {
        const snapshot = buildNoLateWidgetSnapshot([
            schedule({ id: "later", startAt: "2026-08-25T10:00:00+09:00", endAt: "2026-08-25T11:00:00+09:00" }),
            schedule({ id: "expired", startAt: "2026-08-23T22:00:00+09:00", endAt: "2026-08-24T00:00:00+09:00" }),
            schedule({ id: "invalid", startAt: "not-a-date" }),
            schedule({ id: "far", startAt: "2026-10-20T10:00:00+09:00", endAt: "2026-10-20T11:00:00+09:00" }),
            schedule({ id: "first", startAt: "2026-08-24T10:00:00+09:00", endAt: "2026-08-24T11:00:00+09:00" }),
            schedule({ id: "first", title: "최신 제목", startAt: "2026-08-24T10:00:00+09:00", endAt: "2026-08-24T11:00:00+09:00" }),
        ], now);

        expect(snapshot.schedules.map((item) => item.id)).toEqual(["first", "later"]);
        expect(snapshot.schedules[0].title).toBe("최신 제목");
    });

    it("caps the App Group payload to the supported schedule count", () => {
        const items = Array.from({ length: NO_LATE_WIDGET_MAX_SCHEDULES + 5 }, (_, index) =>
            schedule({
                id: `schedule-${index}`,
                startAt: new Date(now.getTime() + index * 60_000).toISOString(),
                endAt: new Date(now.getTime() + (index + 30) * 60_000).toISOString(),
            })
        );

        expect(buildNoLateWidgetSnapshot(items, now).schedules).toHaveLength(
            NO_LATE_WIDGET_MAX_SCHEDULES,
        );
    });
});

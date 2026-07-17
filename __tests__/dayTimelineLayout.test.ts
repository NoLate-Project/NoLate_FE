import {
    DAY_TIMELINE_CARD_VERTICAL_PADDING,
    DAY_TIMELINE_COMPACT_EVENT_HEIGHT,
    DAY_TIMELINE_META_LINE_HEIGHT,
    DAY_TIMELINE_MIN_EVENT_HEIGHT,
    DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT,
    DAY_TIMELINE_TITLE_LINE_HEIGHT,
    DAY_TIMELINE_TRAVEL_LINE_HEIGHT,
    buildPositionedEvents,
    formatDayTimelineDeparture,
    formatDayTimelineTimeRange,
    getDayTimelineEventMetadata,
} from "../src/modules/schedule/dayTimelineLayout";
import type { ScheduleItem } from "../src/modules/schedule/types";

function makeItem(
    id: string,
    startAt: string,
    endAt: string,
    overrides: Partial<ScheduleItem> = {}
): ScheduleItem {
    return {
        id,
        title: `일정 ${id}`,
        startAt,
        endAt,
        hasEndTime: true,
        category: {
            id: "category",
            title: "약속",
            color: "#ff3b30",
        },
        ...overrides,
    };
}

describe("day timeline layout", () => {
    test("선택한 날짜와 겹치지 않는 일정은 타임라인에 배치하지 않는다", () => {
        const previousDay = makeItem(
            "previous",
            "2026-07-09T09:00:00",
            "2026-07-09T10:00:00"
        );
        const nextDay = makeItem(
            "next",
            "2026-07-11T09:00:00",
            "2026-07-11T10:00:00"
        );

        expect(buildPositionedEvents([previousDay, nextDay], "2026-07-10")).toEqual([]);
    });

    test("짧은 일정도 제목과 시간 두 줄이 잘리지 않는 최소 높이를 가진다", () => {
        const item = makeItem(
            "short",
            "2026-07-10T20:03:00",
            "2026-07-10T20:26:00"
        );
        const [positioned] = buildPositionedEvents([item], "2026-07-10");

        expect(positioned.height).toBe(DAY_TIMELINE_MIN_EVENT_HEIGHT);
        expect(positioned.visualEndMinute).toBe(20 * 60 + 3 + 60);
        expect(formatDayTimelineTimeRange(item)).toBe("8:03 - 8:26");
        expect(DAY_TIMELINE_MIN_EVENT_HEIGHT).toBeGreaterThanOrEqual(
            DAY_TIMELINE_CARD_VERTICAL_PADDING * 2
            + DAY_TIMELINE_TITLE_LINE_HEIGHT
            + DAY_TIMELINE_META_LINE_HEIGHT
        );
    });

    test("최소 표시 높이가 겹치는 짧은 일정은 서로 다른 lane을 사용한다", () => {
        const first = makeItem(
            "first",
            "2026-07-10T20:03:00",
            "2026-07-10T20:06:00"
        );
        const second = makeItem(
            "second",
            "2026-07-10T20:30:00",
            "2026-07-10T20:35:00"
        );
        const positioned = buildPositionedEvents([first, second], "2026-07-10");

        expect(positioned.map((event) => event.lane)).toEqual([0, 1]);
        expect(positioned.every((event) => event.laneCount === 2)).toBe(true);
    });

    test("이동 일정은 시안의 세 번째 정보 줄을 위한 높이와 메타데이터를 가진다", () => {
        const item = makeItem(
            "travel",
            "2026-07-10T19:00:00",
            "2026-07-10T19:30:00",
            {
                title: "강남역 약속",
                departAt: "2026-07-10T18:12:00",
                travelMinutes: 43,
                travelMode: "TRANSIT",
                locationName: "기존 장소",
                destination: { name: "강남역" },
            }
        );
        const metadata = getDayTimelineEventMetadata(item);
        const [positioned] = buildPositionedEvents([item], "2026-07-10");

        expect(positioned.height).toBe(DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT);
        expect(metadata).toMatchObject({
            travelMinutes: 43,
            travelMode: "TRANSIT",
            isTravel: true,
        });
        expect(metadata.location).toBeUndefined();
        expect(formatDayTimelineDeparture(metadata.departureAt)).toBe("오후 6:12");
        expect(DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT).toBeGreaterThanOrEqual(
            DAY_TIMELINE_CARD_VERTICAL_PADDING * 2
            + DAY_TIMELINE_TITLE_LINE_HEIGHT
            + DAY_TIMELINE_META_LINE_HEIGHT
            + DAY_TIMELINE_TRAVEL_LINE_HEIGHT
        );
    });

    test("출발 시각이 없으면 일정 시작과 이동 시간으로 계산한다", () => {
        const item = makeItem(
            "computed-travel",
            "2026-07-10T09:00:00",
            "2026-07-10T10:00:00",
            { travelMinutes: 20, travelMode: "CAR" }
        );
        const metadata = getDayTimelineEventMetadata(item);

        expect(formatDayTimelineDeparture(metadata.departureAt)).toBe("오전 8:40");
    });

    test("레거시 raw route의 현재 시각 대신 일정 기준 출발 시각을 사용한다", () => {
        const item = makeItem(
            "legacy-route",
            "2026-07-10T09:00:00",
            "2026-07-10T10:00:00",
            {
                travelMinutes: 20,
                route: {
                    id: "legacy-route-option",
                    mode: "CAR",
                    minutes: 20,
                    source: "fallback",
                },
            }
        );

        expect(formatDayTimelineDeparture(getDayTimelineEventMetadata(item).departureAt)).toBe("오전 8:40");
    });

    test("nested routeInfo가 오래된 현재 시각이어도 일정 기준 출발 시각을 사용한다", () => {
        const item = makeItem(
            "stale-nested-route",
            "2026-07-10T09:00:00",
            "2026-07-10T10:00:00",
            {
                travelMinutes: 20,
                route: {
                    routeInfo: {
                        id: "stale-nested-route-info",
                        originName: "서울역",
                        destinationName: "금천구청역",
                        totalDurationMinutes: 20,
                        departureTime: "2026-07-09T01:20:00.000Z",
                        arrivalTime: "2026-07-09T01:40:00.000Z",
                        timeBasis: "estimated",
                        steps: [],
                    },
                },
            }
        );

        expect(formatDayTimelineDeparture(getDayTimelineEventMetadata(item).departureAt)).toBe("오전 8:40");
    });

    test("빈 목적지는 장소 fallback을 막지 않고 다일 보기는 compact 높이를 쓴다", () => {
        const item = makeItem(
            "location-fallback",
            "2026-07-10T12:30:00",
            "2026-07-10T12:35:00",
            {
                title: "점심 약속",
                destination: { name: "   " },
                locationName: "강남역",
            }
        );
        const [compact] = buildPositionedEvents([item], "2026-07-10", { compact: true });

        expect(getDayTimelineEventMetadata(item).location).toBe("강남역");
        expect(compact.height).toBe(DAY_TIMELINE_COMPACT_EVENT_HEIGHT);
    });
});

import {
    buildLiveActivityRouteSegments,
    buildLiveActivityTravelSnapshot,
    LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS,
} from "../src/modules/notification/liveActivityRoute";
import type { RouteInfo, RouteStep } from "../src/modules/schedule/routeInfo";

function routeInfo(steps: RouteStep[], totalDurationMinutes = 60): RouteInfo {
    return {
        id: "route-live-activity",
        originName: "집",
        destinationName: "강남역",
        totalDurationMinutes,
        departureTime: "2026-08-06T09:00:00+09:00",
        arrivalTime: "2026-08-06T10:00:00+09:00",
        timeBasis: "provider_schedule",
        steps,
    };
}

function step(
    id: string,
    type: RouteStep["type"],
    durationMinutes: number,
    lineName?: string,
    lineColor?: string,
    waitingMinutes?: number,
): RouteStep {
    return {
        id,
        type,
        title: lineName ?? type,
        durationMinutes,
        lineName,
        lineColor,
        waitingMinutes,
    };
}

describe("Live Activity route compression", () => {
    test("keeps a 60-minute door-to-door ETA at 60 when the first wait is 20", () => {
        const route = routeInfo([
            step("walk", "WALK", 10),
            step("bus", "BUS", 35, "간선 402", "#2979FF", 20),
            step("subway", "SUBWAY", 15, "2호선", "#00B140"),
        ]);

        expect(buildLiveActivityTravelSnapshot({ route, travelMinutes: 60 })).toEqual({
            travelMinutes: 60,
            firstWaitMinutes: 20,
            routeSegments: [
                { kind: "WALK", label: "도보", colorHex: "#9CA3AF" },
                { kind: "BUS", label: "402", colorHex: "#2979FF" },
                { kind: "SUBWAY", label: "2호선", colorHex: "#00B140" },
            ],
        });
    });

    test("merges only identical adjacent route identities and preserves transfer color", () => {
        const route = routeInfo([
            step("walk-1", "WALK", 2),
            step("walk-2", "TRANSFER", 3),
            step("bus-1", "BUS", 8, "143", "#2979FF"),
            step("bus-1-cont", "BUS", 4, "143", "#2979FF"),
            step("bus-2", "BUS", 9, "421", "#22C55E"),
        ]);

        expect(buildLiveActivityRouteSegments(route)).toEqual([
            { kind: "WALK", label: "도보", colorHex: "#9CA3AF" },
            { kind: "TRANSFER", label: "환승", colorHex: "#22C55E" },
            { kind: "BUS", label: "143", colorHex: "#2979FF" },
            { kind: "BUS", label: "421", colorHex: "#22C55E" },
        ]);
    });

    test("reserves destination and omission slots without reordering retained transfers", () => {
        const route = routeInfo([
            step("walk-0", "WALK", 2),
            step("bus-1", "BUS", 20, "100", "#111111"),
            step("walk-2", "WALK", 1),
            step("subway-3", "SUBWAY", 18, "2호선", "#222222"),
            step("walk-4", "WALK", 1),
            step("bus-5", "BUS", 16, "402", "#333333"),
            step("walk-6", "WALK", 1),
            step("subway-7", "SUBWAY", 14, "9호선", "#444444"),
            step("walk-8", "WALK", 2),
        ], 75);

        const segments = buildLiveActivityRouteSegments(route);

        expect(segments).toHaveLength(LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS);
        expect(segments[0]).toMatchObject({ kind: "WALK" });
        expect(segments.map((segment) => segment.label)).toEqual([
            "도보",
            "100",
            "5구간 생략",
            "9호선",
            "도보",
        ]);
        expect(segments[2]).toMatchObject({
            kind: "TRANSFER",
            colorHex: "#94A3B8",
        });
    });

    test("compresses to one contiguous omitted range at narrow limits", () => {
        const route = routeInfo([
            step("walk-0", "WALK", 2),
            step("bus-1", "BUS", 20, "100", "#111111"),
            step("walk-2", "WALK", 3),
            step("subway-3", "SUBWAY", 18, "2호선", "#222222"),
            step("walk-4", "WALK", 4),
        ]);

        expect(buildLiveActivityRouteSegments(route, 3)).toEqual([
            { kind: "WALK", label: "도보", colorHex: "#9CA3AF" },
            { kind: "TRANSFER", label: "3구간 생략", colorHex: "#94A3B8" },
            { kind: "WALK", label: "도보", colorHex: "#9CA3AF" },
        ]);
    });

    test("normalizes a non-finite maximum instead of leaking an unbounded payload", () => {
        const steps = Array.from({ length: 16 }, (_, index) => step(
            `segment-${index}`,
            index % 2 === 0 ? "WALK" : "BUS",
            index + 1,
            index % 2 === 0 ? undefined : String(100 + index),
        ));

        expect(buildLiveActivityRouteSegments(routeInfo(steps), Number.NaN).length)
            .toBeLessThanOrEqual(LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS);
    });
});

import {
    getNaverLikeRouteRecommendationLabel,
    selectNaverLikeRouteAlternatives,
} from "../src/modules/schedule/routeAlternativeRanking";
import type { RouteAlternativeOption } from "../src/modules/map/tmapApi";

function subwayRoute(
    id: string,
    minutes: number,
    plausibility: RouteAlternativeOption["routePlausibility"]
): RouteAlternativeOption {
    return {
        id,
        mode: "TRANSIT",
        minutes,
        distanceMeters: 20_000,
        source: "api",
        provider: "tmap",
        routePlausibility: plausibility,
        transitLegs: [{
            kind: "SUBWAY",
            label: "2호선",
            lineName: "2호선",
            startName: "잠실역",
            endName: "홍대입구역",
        }],
        pathCoords: [
            { lat: 37.5133, lng: 127.1001 },
            { lat: 37.5572, lng: 126.9254 },
        ],
    };
}

function busRoute(id: string, minutes: number, walkMeters: number): RouteAlternativeOption {
    return {
        id,
        mode: "TRANSIT",
        minutes,
        distanceMeters: 7_000,
        walkMeters,
        source: "api",
        provider: "tmap",
        transitLegs: [{
            kind: "WALK",
            label: "정류장까지 도보",
            distanceMeters: Math.round(walkMeters / 2),
        }, {
            kind: "BUS",
            label: id,
            lineName: id,
            startName: "서울역버스환승센터",
            endName: "남산도서관",
        }, {
            kind: "WALK",
            label: "도착지까지 도보",
            distanceMeters: Math.round(walkMeters / 2),
        }],
        pathCoords: [
            { lat: 37.5547, lng: 126.9706 },
            { lat: 37.5512, lng: 126.9882 },
        ],
    };
}

function variedTransitRoute(
    id: string,
    minutes: number,
    transferCount: number,
    walkMeters: number,
    geometrySource: "TRANSIT_PASS_SHAPE_LINESTRING" | "PASS_STOP_LIST" = "TRANSIT_PASS_SHAPE_LINESTRING"
): RouteAlternativeOption {
    const rideLegs = Array.from({ length: transferCount + 1 }, (_, index) => ({
        kind: "SUBWAY" as const,
        label: `${id}-${index + 1}호선`,
        lineName: `${id}-${index + 1}호선`,
        startName: `${id}-출발-${index}`,
        endName: `${id}-도착-${index}`,
        distanceMeters: 4_000,
        pathCoordsIsExact: geometrySource === "TRANSIT_PASS_SHAPE_LINESTRING",
        pathGeometrySource: geometrySource,
        pathCoords: [
            { lat: 37.50 + (index * 0.01), lng: 127.00 + (index * 0.01) },
            { lat: 37.505 + (index * 0.01), lng: 127.005 + (index * 0.01) },
            { lat: 37.51 + (index * 0.01), lng: 127.01 + (index * 0.01) },
        ],
    }));
    return {
        id,
        mode: "TRANSIT",
        minutes,
        transferCount,
        walkMeters,
        distanceMeters: 12_000,
        source: "api",
        provider: "tmap",
        transitLegs: rideLegs,
        pathCoords: rideLegs.flatMap((leg) => leg.pathCoords),
    };
}

describe("route alternative ranking", () => {
    it("정상 후보가 있으면 조금 빠른 우회 의심 경로보다 먼저 고른다", () => {
        const result = selectNaverLikeRouteAlternatives([
            subwayRoute("broken-geometry", 42, "geometry_suspected"),
            subwayRoute("normal", 46, "normal"),
        ], "TRANSIT");

        expect(result[0].id).toBe("normal");
    });

    it("몇 분 빠르더라도 2km를 걷는 버스 경로를 자동 추천하지 않는다", () => {
        const result = selectNaverLikeRouteAlternatives([
            busRoute("402", 49, 2_000),
            busRoute("8100", 51, 320),
        ], "TRANSIT");

        expect(result[0].id).toBe("8100");
        expect(result.map((route) => route.id)).not.toContain("402");
    });

    it("긴 도보 후보밖에 없으면 경로 자체를 숨기지는 않는다", () => {
        const result = selectNaverLikeRouteAlternatives([
            busRoute("only-route", 49, 2_000),
        ], "TRANSIT");

        expect(result[0].id).toBe("only-route");
    });

    it("정류장 직선뿐인 빠른 후보보다 정밀 형상이 있는 후보를 우선한다", () => {
        const result = selectNaverLikeRouteAlternatives([
            variedTransitRoute("stop-only", 40, 0, 300, "PASS_STOP_LIST"),
            variedTransitRoute("precise", 44, 0, 300),
        ], "TRANSIT");

        expect(result[0].id).toBe("precise");
    });

    it("추천 뒤에 최소 환승과 최소 도보 대표 경로를 보존한다", () => {
        const result = selectNaverLikeRouteAlternatives([
            variedTransitRoute("fast", 40, 2, 600),
            variedTransitRoute("near-fast", 41, 2, 550),
            variedTransitRoute("least-transfer", 46, 0, 700),
            variedTransitRoute("least-walk", 47, 1, 67),
            variedTransitRoute("another", 43, 2, 500),
        ], "TRANSIT", "ALL", 3);

        expect(result.map((route) => route.id)).toEqual([
            "fast",
            "least-transfer",
            "least-walk",
        ]);
        expect(result.map((route, index) => (
            getNaverLikeRouteRecommendationLabel(route, result, index)
        ))).toEqual([
            "추천",
            "최소 환승",
            "도보 적음",
        ]);
    });
});

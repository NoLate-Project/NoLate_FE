import {
    applyFocusedTransitRideOverlayOwnership,
    getNormalizedFallbackRouteMode,
    getNormalizedTransitLegMode,
    shouldRenderNormalizedTransitDirection,
    shouldUseRouteInfoStepOverlays,
} from "../src/modules/map/transitRouteSegmentPolicy";
import type { TransitLegDetail } from "../src/modules/map/routingService";

describe("transit route segment policy", () => {
    const legs: TransitLegDetail[] = [
        { kind: "WALK", label: "출발 도보" },
        { kind: "SUBWAY", label: "2호선" },
        { kind: "WALK", label: "환승 도보" },
        { kind: "ETC", label: "셔틀" },
        { kind: "BUS", label: "간선버스" },
        { kind: "WALK", label: "도착 도보" },
    ];

    it("ETC와 no-leg TRANSIT을 도보/UNKNOWN으로 잃지 않는다", () => {
        expect(getNormalizedTransitLegMode(legs[0], 0, legs)).toBe("WALK");
        expect(getNormalizedTransitLegMode(legs[2], 2, legs)).toBe("TRANSFER");
        expect(getNormalizedTransitLegMode(legs[3], 3, legs)).toBe("ETC");
        expect(getNormalizedFallbackRouteMode("TRANSIT")).toBe("TRANSIT");
    });

    it("ride와 no-leg TRANSIT만 z11부터 방향표를 허용한다", () => {
        expect(shouldRenderNormalizedTransitDirection("SUBWAY", 10.9)).toBe(false);
        expect(shouldRenderNormalizedTransitDirection("SUBWAY", 11)).toBe(true);
        expect(shouldRenderNormalizedTransitDirection("TRANSIT", 11)).toBe(true);
        expect(shouldRenderNormalizedTransitDirection("ETC", 18)).toBe(false);
        expect(shouldRenderNormalizedTransitDirection("WALK", 18)).toBe(false);
    });

    it("no-leg TRANSIT의 정규화 실선이 있으면 호환용 RouteInfo 점선을 우선하지 않는다", () => {
        expect(shouldUseRouteInfoStepOverlays({
            routeMode: "TRANSIT",
            routeInfoOverlayCount: 1,
            hasTransitLegOverlays: false,
            hasSelectedMainPath: true,
            hasRenderableNormalizedTransitRoute: true,
        })).toBe(false);
        expect(shouldUseRouteInfoStepOverlays({
            routeMode: "TRANSIT",
            routeInfoOverlayCount: 1,
            hasTransitLegOverlays: false,
            hasSelectedMainPath: false,
            hasRenderableNormalizedTransitRoute: false,
        })).toBe(true);
        expect(shouldUseRouteInfoStepOverlays({
            routeMode: "WALK",
            routeInfoOverlayCount: 1,
            hasTransitLegOverlays: false,
            hasSelectedMainPath: true,
            hasRenderableNormalizedTransitRoute: false,
        })).toBe(false);
    });

    it("포커스 ride는 base와 같은 geometry를 쓰고 방향표 소유자는 하나만 둔다", () => {
        const coords = [
            { latitude: 37.5, longitude: 127 },
            { latitude: 37.51, longitude: 127.01 },
            { latitude: 37.52, longitude: 127.02 },
        ];
        const result = applyFocusedTransitRideOverlayOwnership([{
            id: "route-segment-1",
            coords,
            width: 7.2,
            nativeDirection: true,
            zIndex: 42,
        }], {
            mode: "SUBWAY",
            zoom: 17,
            focused: true,
            directionEnabled: true,
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ nativeDirection: false, coords });
        expect(result[1]).toMatchObject({
            id: "route-segment-1-focused",
            coords,
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
            zIndex: 180,
        });
        expect(result[1].width).toBeCloseTo(7.6);
        expect(result.filter((overlay) => overlay.nativeDirection)).toHaveLength(1);
        expect(result[1].coords).toBe(result[0].coords);
    });

    it("ETC 포커스에는 강조선이나 화살표를 추가하지 않는다", () => {
        const overlays = [{
            id: "route-segment-etc",
            coords: [
                { latitude: 37.5, longitude: 127 },
                { latitude: 37.51, longitude: 127.01 },
            ],
            nativeDirection: false,
        }];

        expect(applyFocusedTransitRideOverlayOwnership(overlays, {
            mode: "ETC",
            zoom: 18,
            focused: true,
            directionEnabled: true,
        })).toBe(overlays);
    });
});

import {
    getRouteMapTileFilter,
    ROUTE_MAP_TILE_FILTERS,
} from "../src/modules/map/routeMapPresentation";

describe("route map tile presentation", () => {
    it("경로 화면이 아니면 기본 지도 표현을 유지한다", () => {
        expect(getRouteMapTileFilter({
            enabled: false,
            isDark: true,
            nativeDarkMapTypeApplied: false,
        })).toBe("none");
    });

    it("native dark mapType이 없을 때만 타일용 dark fallback을 사용한다", () => {
        expect(getRouteMapTileFilter({
            enabled: true,
            isDark: true,
            nativeDarkMapTypeApplied: false,
        })).toBe(ROUTE_MAP_TILE_FILTERS.darkFallback);
    });

    it("native dark mapType과 라이트 지도에는 각각 낮은 강도의 필터를 사용한다", () => {
        expect(getRouteMapTileFilter({
            enabled: true,
            isDark: true,
            nativeDarkMapTypeApplied: true,
        })).toBe(ROUTE_MAP_TILE_FILTERS.darkNative);
        expect(getRouteMapTileFilter({
            enabled: true,
            isDark: false,
            nativeDarkMapTypeApplied: false,
        })).toBe(ROUTE_MAP_TILE_FILTERS.light);
    });
});

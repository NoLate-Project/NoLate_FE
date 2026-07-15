export const ROUTE_MAP_TILE_FILTERS = {
    // 경로 화면에서는 지도 문맥을 남기되 POI 색과 도로 대비를 한 단계 낮춘다.
    // 필터는 타일 pane에만 적용되어 경로선·방향표·마커의 색은 변하지 않는다.
    darkFallback: "invert(0.9) hue-rotate(180deg) brightness(0.64) saturate(0.5) contrast(0.98)",
    darkNative: "saturate(0.58) brightness(0.82) contrast(0.94)",
    light: "saturate(0.62) brightness(1.03) contrast(0.88)",
} as const;

type RouteMapTilePresentationInput = {
    enabled: boolean;
    isDark: boolean;
    nativeDarkMapTypeApplied: boolean;
};

export function getRouteMapTileFilter({
    enabled,
    isDark,
    nativeDarkMapTypeApplied,
}: RouteMapTilePresentationInput): string {
    if (!enabled) return "none";
    if (!isDark) return ROUTE_MAP_TILE_FILTERS.light;
    return nativeDarkMapTypeApplied
        ? ROUTE_MAP_TILE_FILTERS.darkNative
        : ROUTE_MAP_TILE_FILTERS.darkFallback;
}

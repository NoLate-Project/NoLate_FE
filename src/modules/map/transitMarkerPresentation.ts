export type TransitEventIntent = "board" | "alight" | "transfer";
export type TransitModeMarkerStyle = "bus" | "subway" | "walk";

export type TransitEventMarkerPresentation = {
    visible: boolean;
    nodeSize: number;
    showRouteLabel: boolean;
    stationVariant?: "compact";
};

const ROUTE_NODE_MIN_ZOOM = 11.4;
const ROUTE_IDENTITY_MIN_ZOOM = 11.8;
export const TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM = 16.8;

function interpolateNodeSize(from: number, to: number, mapZoom: number): number {
    if (mapZoom <= ROUTE_NODE_MIN_ZOOM) return from;
    if (mapZoom >= TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM) return to;
    const progress = (mapZoom - ROUTE_NODE_MIN_ZOOM) /
        (TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM - ROUTE_NODE_MIN_ZOOM);
    return Math.round(from + ((to - from) * progress));
}

export function shouldPreserveTransitBoundaryEvents(mapZoom: number): boolean {
    return Number.isFinite(mapZoom) && mapZoom >= TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM;
}

/** 전체 경로에서는 노선별 중앙 태그 하나가 노선 식별 정보를 담당한다. */
export function shouldShowTransitRouteIdentityLabel(mapZoom: number): boolean {
    return Number.isFinite(mapZoom) &&
        mapZoom >= ROUTE_IDENTITY_MIN_ZOOM &&
        mapZoom < TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM;
}

/** 환승 여부와 무관하게 사용자가 다음에 탈 실제 교통수단 아이콘을 반환한다. */
export function getTransitModeMarkerStyle(kind: string): TransitModeMarkerStyle {
    if (kind === "BUS") return "bus";
    if (kind === "SUBWAY") return "subway";
    return "walk";
}

/**
 * 전체 경로에서는 승차·환승 아이콘만 유지한다. 정류장 상세 배율부터 이 마커가
 * 정류장명과 진행 방향을 맡아 본선 중앙의 노선 태그와 정보가 중복되지 않게 한다.
 */
export function getTransitEventMarkerPresentation(
    intent: TransitEventIntent,
    mapZoom: number,
    isTransferExitBoundary = false
): TransitEventMarkerPresentation {
    const zoom = Number.isFinite(mapZoom) ? mapZoom : 0;
    const visible = zoom >= ROUTE_NODE_MIN_ZOOM && (
        intent !== "alight" || zoom >= TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM
    );
    const usesCompactBoundaryNode = intent === "alight" && isTransferExitBoundary;
    const nodeSize = usesCompactBoundaryNode
        ? 16
        : intent === "alight"
            ? 22
            : interpolateNodeSize(20, 26, zoom);

    return {
        visible,
        nodeSize,
        showRouteLabel: visible && zoom >= TRANSIT_BOUNDARY_DETAIL_MIN_ZOOM && intent !== "alight",
        ...(usesCompactBoundaryNode ? { stationVariant: "compact" as const } : {}),
    };
}

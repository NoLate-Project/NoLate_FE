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
// 도시 내 전체 경로를 z10으로 맞출 때도 환승 지점은 남긴다.
const TRANSFER_NODE_MIN_ZOOM = 10;
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
    if (["BUS", "EXPRESS_BUS", "INTERCITY_BUS", "COACH"].includes(kind)) return "bus";
    if (kind === "SUBWAY" || kind === "TRAIN") return "subway";
    return "walk";
}

/**
 * 전체 경로에서는 색이 바뀌는 지점에서 환승역 이름을 보여준다.
 * 상세 배율에서는 승차·환승 지점에 노선과 진행 방향도 표시한다.
 */
export function getTransitEventMarkerPresentation(
    intent: TransitEventIntent,
    mapZoom: number,
    isTransferExitBoundary = false
): TransitEventMarkerPresentation {
    const zoom = Number.isFinite(mapZoom) ? mapZoom : 0;
    const minimumZoom = intent === "transfer" ? TRANSFER_NODE_MIN_ZOOM : ROUTE_NODE_MIN_ZOOM;
    const visible = zoom >= minimumZoom && (
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
        showRouteLabel: visible && (intent === "transfer" || (intent === "board" && shouldPreserveTransitBoundaryEvents(zoom))),
        ...(usesCompactBoundaryNode ? { stationVariant: "compact" as const } : {}),
    };
}

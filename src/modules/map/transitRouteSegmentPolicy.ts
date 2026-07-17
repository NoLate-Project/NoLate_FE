import type { TransitLegDetail } from "./routingService";
import type { TmapPathOverlay } from "./TmapMapView";
import {
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    shouldRenderTransitNativeDirection,
} from "./transitRoutePresentation";

export type NormalizedTransitSegmentMode =
    | "WALK"
    | "BUS"
    | "SUBWAY"
    | "TRANSFER"
    | "ETC"
    | "TRANSIT"
    | "UNKNOWN";

export function getNormalizedTransitLegMode(
    leg: TransitLegDetail,
    index: number,
    legs: TransitLegDetail[] | undefined
): NormalizedTransitSegmentMode {
    if (leg.kind === "BUS") return "BUS";
    if (leg.kind === "SUBWAY") return "SUBWAY";
    if (leg.kind === "ETC") return "ETC";
    if (leg.kind === "WALK") {
        const hasRideBefore = Array.isArray(legs) && legs
            .slice(0, index)
            .some((item) => item.kind === "BUS" || item.kind === "SUBWAY");
        const hasRideAfter = Array.isArray(legs) && legs
            .slice(index + 1)
            .some((item) => item.kind === "BUS" || item.kind === "SUBWAY");
        return hasRideBefore && hasRideAfter ? "TRANSFER" : "WALK";
    }
    return "UNKNOWN";
}

export function getNormalizedFallbackRouteMode(
    routeMode: string
): NormalizedTransitSegmentMode {
    if (routeMode === "WALK") return "WALK";
    if (routeMode === "TRANSIT") return "TRANSIT";
    return "UNKNOWN";
}

export function shouldRenderNormalizedTransitDirection(
    mode: NormalizedTransitSegmentMode,
    zoom: number,
    enabled = true
): boolean {
    const directionMode = mode === "TRANSIT" ? "BUS" : mode;
    return shouldRenderTransitNativeDirection(directionMode, zoom, enabled);
}

type RouteInfoOverlayOwnershipInput = {
    routeMode: string;
    routeInfoOverlayCount: number;
    hasTransitLegOverlays: boolean;
    hasSelectedMainPath: boolean;
    hasRenderableNormalizedTransitRoute: boolean;
};

/**
 * no-leg TRANSIT는 RouteInfo에서 TRANSFER 호환 step으로도 표현되지만, 지도선은 정규화된
 * TRANSIT segment가 소유해야 실선과 z11 방향표 정책을 잃지 않는다.
 */
export function shouldUseRouteInfoStepOverlays({
    routeMode,
    routeInfoOverlayCount,
    hasTransitLegOverlays,
    hasSelectedMainPath,
    hasRenderableNormalizedTransitRoute,
}: RouteInfoOverlayOwnershipInput): boolean {
    if (routeInfoOverlayCount <= 0 || hasTransitLegOverlays) return false;
    if (routeMode === "TRANSIT" && hasRenderableNormalizedTransitRoute) return false;
    if (routeMode !== "TRANSIT" && hasSelectedMainPath) return false;
    return true;
}

type FocusedTransitRideOverlayOptions = {
    mode: NormalizedTransitSegmentMode;
    zoom: number;
    focused: boolean;
    directionEnabled: boolean;
    directionColor?: string;
    focusedZIndex?: number;
};

/**
 * 선택된 승차 구간은 base와 강조선이 동일 geometry를 공유하고 강조선만 방향표를 가진다.
 * WALK/TRANSFER/ETC 및 선택되지 않은 구간은 원본 overlay를 그대로 유지한다.
 */
export function applyFocusedTransitRideOverlayOwnership(
    overlays: TmapPathOverlay[],
    {
        mode,
        zoom,
        focused,
        directionEnabled,
        directionColor = "#FFFFFF",
        focusedZIndex = 180,
    }: FocusedTransitRideOverlayOptions
): TmapPathOverlay[] {
    const ride = mode === "BUS" || mode === "SUBWAY";
    if (!focused || !ride || overlays.length === 0) return overlays;

    const base = overlays.map((overlay) => ({ ...overlay, nativeDirection: false }));
    const line = getTransitRouteLinePresentation(zoom);
    return [
        ...base,
        ...base.map((overlay, partIndex): TmapPathOverlay => ({
            ...overlay,
            id: `${overlay.id}-focused`,
            width: (overlay.width ?? line.rideWidth) + 0.4,
            outlineColor: "rgba(255,255,255,0.18)",
            outlineWidth: Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
            outlineOpacity: 1,
            nativeDirection: shouldRenderNormalizedTransitDirection(mode, zoom, directionEnabled),
            nativeDirectionColor: directionColor,
            nativeDirectionOpacity: getTransitNativeDirectionOpacity(zoom),
            zIndex: focusedZIndex + partIndex,
        })),
    ];
}

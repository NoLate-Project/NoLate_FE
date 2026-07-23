import { getZoomStyleValue, type ZoomStyleStops } from "./routeZoomStyle";

// 네이버의 현재 길찾기 화면과 각 SDK의 screen-space 패턴 정책처럼, 줌이 바뀌어도
// 같은 둥근 점 리듬을 유지한다. TMAP iOS는 임의 dash 배열을 지원하지 않으므로
// 숫자 배열로 dash/dot을 전환하지 않고 native `.dot` 한 종류만 요청한다.
export const TRANSIT_WALK_DASH_PATTERN = [1, 13] as const;

export function getTransitWalkGuidePresentation(_zoom: number) {
    return {
        dashPattern: TRANSIT_WALK_DASH_PATTERN,
        strokeStyle: "dot" as const,
        outlineStrokeStyle: "dot" as const,
    };
}

export function shouldRenderTransitStopAccessLinks(zoom: number): boolean {
    // 카카오 Route LOD처럼 개요 지도에서는 짧은 역사 내부 연결선을 생략한다.
    // 저장 화면과 경로 탐색 화면 모두 같은 경계에서 표시해야 확대 중 선이 튀지 않는다.
    return Number.isFinite(zoom) && zoom >= 14;
}

const TRANSIT_ROUTE_LINE_LOD = {
    overview: { rideWidth: 6.4, walkWidth: 3.8 },
    standard: { rideWidth: 7.2, walkWidth: 4.2 },
    detail: { rideWidth: 8, walkWidth: 4.6 },
} as const;

export const TRANSIT_ROUTE_ZOOM_STYLE = {
    // 지도 SDK의 화면 픽셀 기반 선 폭은 매 프레임 보간하지 않고 LOD 경계에서만 바꾼다.
    // 아래 stop은 기존 설정 소비자의 타입을 유지하고, 실제 선택은 getTransitRouteLinePresentation이
    // z6~10 / z11~15 / z16~18 세 구간으로 고정한다.
    rideWidth: {
        zoom12: TRANSIT_ROUTE_LINE_LOD.standard.rideWidth,
        zoom15: 7.2,
        zoom17: TRANSIT_ROUTE_LINE_LOD.detail.rideWidth,
        zoom18: TRANSIT_ROUTE_LINE_LOD.detail.rideWidth,
    },
    rideCasingExtraWidth: 1.6,
    walkWidth: {
        zoom12: TRANSIT_ROUTE_LINE_LOD.standard.walkWidth,
        zoom15: TRANSIT_ROUTE_LINE_LOD.standard.walkWidth,
        zoom17: TRANSIT_ROUTE_LINE_LOD.detail.walkWidth,
        zoom18: TRANSIT_ROUTE_LINE_LOD.detail.walkWidth,
    },
    // TMAP iOS는 casing과 본선을 서로 다른 polyline으로 그려 native dot 위상을
    // 동기화할 수 없다. 도보 점에는 별도 casing을 두지 않아 사다리 모양을 방지한다.
    walkCasingExtraWidth: 0,
    // 카카오 실제 웹 경로의 줌별 반복 표시와 사용자 요구를 반영해 z11부터 진행 방향을 읽게 한다.
    // 확대 중 native layer signature가 바뀌지 않도록 방향표 투명도는 전 구간에서 고정한다.
    directionMinZoom: 11,
    directionOpacity: 0.96,
    fallbackMainWidth: {
        zoom12: 6.4,
        zoom15: 7.2,
        zoom17: 7.6,
        zoom18: 7.8,
    },
    fallbackCasingWidth: {
        zoom12: 9.6,
        zoom15: 10.4,
        zoom17: 10.8,
        zoom18: 11,
    },
} as const satisfies Record<string, ZoomStyleStops | number>;

export type TransitRouteThemeVariant = "light" | "dark";

export const TRANSIT_ROUTE_THEME_STYLE = {
    light: {
        rideCasingColor: "#FFFFFF",
        rideCasingOpacity: 0.92,
        walkCasingColor: "#FFFFFF",
        walkCasingOpacity: 0.9,
        directionColor: "#FFFFFF",
        directionOpacity: 0.96,
    },
    dark: {
        rideCasingColor: "#0F172A",
        rideCasingOpacity: 0.76,
        walkCasingColor: "#0F172A",
        walkCasingOpacity: 0.72,
        directionColor: "#FFFFFF",
        directionOpacity: 0.96,
    },
} as const;

type TransitThemeOverlay = {
    id?: string;
    renderMode?: "native" | "screen";
    strokeStyle?: string;
    dashPattern?: readonly number[];
    outlineColor?: string;
    outlineOpacity?: number;
    nativeDirection?: boolean;
    nativeDirectionColor?: string;
    nativeDirectionOpacity?: number;
};

function isWalkLikeTransitOverlay(overlay: TransitThemeOverlay): boolean {
    return overlay.strokeStyle === "dash" ||
        overlay.strokeStyle === "dot" ||
        !!overlay.dashPattern?.length ||
        /(?:walk|connector|access-link|transfer)/i.test(overlay.id ?? "");
}

export function getTransitRouteThemePresentation(
    zoom: number,
    variant: TransitRouteThemeVariant
) {
    const theme = TRANSIT_ROUTE_THEME_STYLE[variant];
    return {
        rideCasingColor: theme.rideCasingColor,
        rideCasingOpacity: theme.rideCasingOpacity,
        walkCasingColor: theme.walkCasingColor,
        walkCasingOpacity: theme.walkCasingOpacity,
        directionColor: theme.directionColor,
        directionOpacity: theme.directionOpacity,
    };
}

export function applyTransitRouteThemeToOverlay<T extends TransitThemeOverlay>(
    overlay: T,
    zoom: number,
    variant: TransitRouteThemeVariant
): T {
    // 라이트는 현재 화면을 그대로 유지하고 다크에서만 별도 광학 스타일을 입힌다.
    if (variant === "light" || overlay.renderMode === "screen") return overlay;
    const theme = getTransitRouteThemePresentation(zoom, variant);
    const walk = isWalkLikeTransitOverlay(overlay);
    return {
        ...overlay,
        outlineColor: walk ? theme.walkCasingColor : theme.rideCasingColor,
        outlineOpacity: walk ? theme.walkCasingOpacity : theme.rideCasingOpacity,
        nativeDirectionColor: overlay.nativeDirection
            ? theme.directionColor
            : overlay.nativeDirectionColor,
        nativeDirectionOpacity: overlay.nativeDirection
            ? theme.directionOpacity
            : overlay.nativeDirectionOpacity,
    };
}

export function getTransitRouteLinePresentation(zoom: number) {
    const safeZoom = Number.isFinite(zoom) ? zoom : 15;
    const lod = safeZoom < 11
        ? TRANSIT_ROUTE_LINE_LOD.overview
        : safeZoom < 16
            ? TRANSIT_ROUTE_LINE_LOD.standard
            : TRANSIT_ROUTE_LINE_LOD.detail;
    const { rideWidth, walkWidth } = lod;
    return {
        rideWidth,
        rideCasingWidth: Math.round(
            (rideWidth + TRANSIT_ROUTE_ZOOM_STYLE.rideCasingExtraWidth) * 10
        ) / 10,
        walkWidth,
        walkCasingWidth: Math.round(
            (walkWidth + TRANSIT_ROUTE_ZOOM_STYLE.walkCasingExtraWidth) * 10
        ) / 10,
    };
}

export function getFallbackRouteStrokePresentation(zoom: number) {
    const mainWidth = getZoomStyleValue(TRANSIT_ROUTE_ZOOM_STYLE.fallbackMainWidth, zoom);
    const casingWidth = getZoomStyleValue(TRANSIT_ROUTE_ZOOM_STYLE.fallbackCasingWidth, zoom);
    return {
        mainWidth,
        casingWidth,
        outlineWidth: (casingWidth - mainWidth) / 2,
    };
}

export function getTransitNativeDirectionOpacity(zoom: number): number {
    return getTransitRouteThemePresentation(zoom, "light").directionOpacity;
}

export function shouldRenderTransitNativeDirection(
    mode: string,
    zoom: number,
    segmentDirectionEnabled = true
): boolean {
    return segmentDirectionEnabled &&
        (mode === "BUS" || mode === "SUBWAY") &&
        zoom >= TRANSIT_ROUTE_ZOOM_STYLE.directionMinZoom;
}

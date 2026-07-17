import { getZoomStyleValue, type ZoomStyleStops } from "./routeZoomStyle";

// 네이버 배포 자산 측정과 카카오 실제 경로 확인처럼 본선보다 가벼운 둥근 점과
// 명확한 빈칸을 유지한다. 확인된 14~16px 중심 간격 중 낮은 쪽에 맞춰 짧은
// 도보 구간도 읽히면서 뭉치지 않게 한다.
export const TRANSIT_WALK_DASH_PATTERN = [1, 13] as const;

export const TRANSIT_ROUTE_ZOOM_STYLE = {
    // TMAP Polyline strokeWeight는 화면 픽셀 단위다. 배율별 값을 바꾸면 native Polyline이
    // 재생성되어 direction 위상이 다시 시작된다. 비교 화면에서 본선이 지도를 가리지 않는
    // 광학 비율을 참고해 7.2px 폭을 모든 지원 배율에서 유지한다.
    rideWidth: {
        zoom12: 7.2,
        zoom15: 7.2,
        zoom17: 7.2,
        zoom18: 7.2,
    },
    rideCasingRatio: 1.22,
    walkWidth: {
        zoom12: 4.4,
        zoom15: 4.4,
        zoom17: 4.4,
        zoom18: 4.4,
    },
    walkCasingRatio: 1.3,
    // 카카오 실제 웹 경로의 줌별 반복 표시와 사용자 요구를 반영해 z11부터 진행 방향을 읽게 한다.
    // TMAP 자동차 내비 표시는 대중교통 기준과 혼용하지 않고, 흰색 대비만 확대할수록 조금 높인다.
    directionMinZoom: 11,
    directionOpacity: {
        zoom12: 0.9,
        zoom15: 0.94,
        zoom17: 0.96,
        zoom18: 0.96,
    },
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
        directionOpacity: {
            zoom12: 0.9,
            zoom15: 0.94,
            zoom17: 0.96,
            zoom18: 0.96,
        },
    },
    dark: {
        rideCasingColor: "#0F172A",
        rideCasingOpacity: 0.76,
        walkCasingColor: "#0F172A",
        walkCasingOpacity: 0.72,
        directionColor: "#FFFFFF",
        directionOpacity: {
            zoom12: 0.9,
            zoom15: 0.94,
            zoom17: 0.96,
            zoom18: 0.96,
        },
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
        directionOpacity: getZoomStyleValue(theme.directionOpacity, zoom),
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
    const rideWidth = getZoomStyleValue(TRANSIT_ROUTE_ZOOM_STYLE.rideWidth, zoom);
    const walkWidth = getZoomStyleValue(TRANSIT_ROUTE_ZOOM_STYLE.walkWidth, zoom);
    return {
        rideWidth,
        rideCasingWidth: rideWidth * TRANSIT_ROUTE_ZOOM_STYLE.rideCasingRatio,
        walkWidth,
        walkCasingWidth: walkWidth * TRANSIT_ROUTE_ZOOM_STYLE.walkCasingRatio,
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

import { getZoomStyleValue, type ZoomStyleStops } from "./routeZoomStyle";

export const TRANSIT_ROUTE_ZOOM_STYLE = {
    // TMAP Polyline strokeWeight는 화면 픽셀 단위다. 배율별 값을 바꾸면 native Polyline이
    // 재생성되어 direction 위상이 다시 시작된다. 지도 3사의 광학 비율에 맞춘 같은 폭을 유지한다.
    rideWidth: {
        zoom12: 8.4,
        zoom15: 8.4,
        zoom17: 8.4,
        zoom18: 8.4,
    },
    rideCasingRatio: 1.22,
    walkWidth: {
        zoom12: 5.2,
        zoom15: 5.2,
        zoom17: 5.2,
        zoom18: 5.2,
    },
    walkCasingRatio: 1.3,
    // 장거리 전체 경로에서도 진행 방향을 잃지 않도록 SDK가 지원하는 모든 지도 배율에서 유지한다.
    // 간격과 크기는 직접 계산하지 않고 같은 TMAP native Polyline이 담당한다.
    directionMinZoom: 6,
    directionOpacity: {
        zoom12: 0.52,
        zoom15: 0.62,
        zoom17: 0.7,
        zoom18: 0.72,
    },
    fallbackMainWidth: {
        zoom12: 6.2,
        zoom15: 7.2,
        zoom17: 8.4,
        zoom18: 8.8,
    },
    fallbackCasingWidth: {
        zoom12: 9.8,
        zoom15: 11.2,
        zoom17: 12.8,
        zoom18: 13.2,
    },
} as const satisfies Record<string, ZoomStyleStops | number>;

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
    return getZoomStyleValue(TRANSIT_ROUTE_ZOOM_STYLE.directionOpacity, zoom);
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

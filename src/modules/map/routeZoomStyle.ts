export type ZoomStyleStops = {
    readonly zoom12: number;
    readonly zoom15: number;
    readonly zoom17: number;
    readonly zoom18: number;
};

function interpolate(from: number, to: number, progress: number): number {
    return from + ((to - from) * progress);
}

/**
 * Keeps route stroke metrics continuous while the map crosses SDK zoom levels.
 * The named stops remain the visual QA anchors used by the route planner.
 */
export function getZoomStyleValue(values: ZoomStyleStops, zoom: number): number {
    const safeZoom = Number.isFinite(zoom) ? zoom : 15;
    if (safeZoom <= 12) return values.zoom12;
    if (safeZoom < 15) {
        return interpolate(values.zoom12, values.zoom15, (safeZoom - 12) / 3);
    }
    if (safeZoom < 17) {
        return interpolate(values.zoom15, values.zoom17, (safeZoom - 15) / 2);
    }
    if (safeZoom < 18) {
        return interpolate(values.zoom17, values.zoom18, safeZoom - 17);
    }
    return values.zoom18;
}

export type GeographicBounds = {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
};

export type MapViewportPadding = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

export type PaddedBoundsCamera = {
    latitude: number;
    longitude: number;
    zoom: number;
};

type PaddedBoundsCameraOptions = {
    minZoom?: number;
    maxZoom?: number;
    minimumSpanMeters?: number;
    boundsPaddingFactor?: number;
};

type InitialRouteCameraReadiness = {
    isRouteDetailMode: boolean;
    hasOrigin: boolean;
    hasDestination: boolean;
    routeLoading: boolean;
    bottomSheetVisible: boolean;
    bottomSheetMeasured: boolean;
};

/** 상세 진입 중 임시 좌표나 추정 시트 높이로 카메라를 먼저 움직이지 않게 한다. */
export function shouldDeferInitialRouteCamera({
    isRouteDetailMode,
    hasOrigin,
    hasDestination,
    routeLoading,
    bottomSheetVisible,
    bottomSheetMeasured,
}: InitialRouteCameraReadiness): boolean {
    if (!isRouteDetailMode || !hasOrigin || !hasDestination) return false;
    if (routeLoading) return true;
    return bottomSheetVisible && !bottomSheetMeasured;
}

const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const WEB_MERCATOR_TILE_SIZE = 256;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function longitudeToWorldX(longitude: number): number {
    return (longitude + 180) / 360;
}

function latitudeToWorldY(latitude: number): number {
    const safeLatitude = clamp(latitude, -WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE);
    const radians = (safeLatitude * Math.PI) / 180;
    return (1 - (Math.log(Math.tan(radians) + (1 / Math.cos(radians))) / Math.PI)) / 2;
}

function worldXToLongitude(worldX: number): number {
    return (((worldX % 1) + 1) % 1) * 360 - 180;
}

function worldYToLatitude(worldY: number): number {
    const mercator = Math.PI * (1 - (2 * clamp(worldY, 0, 1)));
    return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI;
}

/**
 * 경로 bounds를 헤더와 바텀시트를 제외한 실제 화면 사각형에 맞춘다.
 * Web Mercator 화면 좌표를 사용하므로 경로 방향이나 기기 비율에 따른 경험적 배율이 필요 없다.
 */
export function getPaddedBoundsCamera(
    bounds: GeographicBounds,
    viewport: { width: number; height: number; padding: MapViewportPadding },
    options: PaddedBoundsCameraOptions = {}
): PaddedBoundsCamera | undefined {
    const values = [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, viewport.width, viewport.height];
    if (values.some((value) => !Number.isFinite(value)) || viewport.width <= 0 || viewport.height <= 0) {
        return undefined;
    }

    const minZoom = clamp(Math.floor(options.minZoom ?? 6), 0, 22);
    const maxZoom = clamp(Math.floor(options.maxZoom ?? 18), minZoom, 22);
    const minimumSpanMeters = Math.max(0, options.minimumSpanMeters ?? 0);
    const boundsPaddingFactor = Math.max(1, options.boundsPaddingFactor ?? 1);
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const lngMetersPerDegree = Math.max(1, 111_320 * Math.cos((centerLat * Math.PI) / 180));
    const latitudeDelta = Math.max(
        Math.max(0, bounds.maxLat - bounds.minLat),
        minimumSpanMeters / 111_320
    ) * boundsPaddingFactor;
    const longitudeDelta = Math.max(
        Math.max(0, bounds.maxLng - bounds.minLng),
        minimumSpanMeters / lngMetersPerDegree
    ) * boundsPaddingFactor;
    const northWorldY = latitudeToWorldY(centerLat + (latitudeDelta / 2));
    const southWorldY = latitudeToWorldY(centerLat - (latitudeDelta / 2));
    const westWorldX = longitudeToWorldX(centerLng - (longitudeDelta / 2));
    const eastWorldX = longitudeToWorldX(centerLng + (longitudeDelta / 2));
    const worldWidth = Math.max(0, eastWorldX - westWorldX);
    const worldHeight = Math.max(0, southWorldY - northWorldY);

    const padding = viewport.padding;
    const top = Math.max(0, padding.top);
    const right = Math.max(0, padding.right);
    const bottom = Math.max(0, padding.bottom);
    const left = Math.max(0, padding.left);
    const usableWidth = Math.max(1, viewport.width - left - right);
    const usableHeight = Math.max(1, viewport.height - top - bottom);
    const zoomX = worldWidth > 0
        ? Math.log2(usableWidth / (WEB_MERCATOR_TILE_SIZE * worldWidth))
        : maxZoom;
    const zoomY = worldHeight > 0
        ? Math.log2(usableHeight / (WEB_MERCATOR_TILE_SIZE * worldHeight))
        : maxZoom;
    // native fitBounds 호출 전 화면 축척을 준비할 때 쓰는 연속 추정값이다.
    // 항상 내림하면 SDK가 선택할 수 있는 가장 가까운 레벨까지 미리 축소된다.
    const zoom = clamp(Math.min(zoomX, zoomY), minZoom, maxZoom);
    const worldSize = WEB_MERCATOR_TILE_SIZE * (2 ** zoom);
    const boundsCenterWorldX = (westWorldX + eastWorldX) / 2;
    const boundsCenterWorldY = (northWorldY + southWorldY) / 2;
    const safeAreaCenterX = left + (usableWidth / 2);
    const safeAreaCenterY = top + (usableHeight / 2);
    const mapCenterWorldX = boundsCenterWorldX - ((safeAreaCenterX - (viewport.width / 2)) / worldSize);
    const mapCenterWorldY = boundsCenterWorldY - ((safeAreaCenterY - (viewport.height / 2)) / worldSize);

    return {
        latitude: worldYToLatitude(mapCenterWorldY),
        longitude: worldXToLongitude(mapCenterWorldX),
        zoom,
    };
}

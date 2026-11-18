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
    wholeZoomLevels?: boolean;
    cameraScaleSample?: { latitude: number; zoom: number; metersPerPixel?: number };
};

type InitialRouteCameraReadiness = {
    isRouteDetailMode: boolean;
    mapInitialized: boolean;
    hasOrigin: boolean;
    hasDestination: boolean;
    routeLoading: boolean;
    bottomSheetVisible: boolean;
    bottomSheetMeasured: boolean;
};

export type RouteOverviewFitIdentity = {
    routeId?: string;
    routeRevision: string;
    routeMode: "detail" | "edit";
    travelMode: string;
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    sheetSnap: string;
    sheetHidden: boolean;
    bottomPanelHeight: number;
    animatedSheetOffset: number;
    visibleSheetTopY: number;
    padding: MapViewportPadding;
};

/** 상세 진입 중 지도나 시트가 준비되기 전 임시 화면으로 카메라를 움직이지 않게 한다. */
export function shouldDeferInitialRouteCamera({
    isRouteDetailMode,
    mapInitialized,
    hasOrigin,
    hasDestination,
    routeLoading,
    bottomSheetMeasured,
}: InitialRouteCameraReadiness): boolean {
    if (!isRouteDetailMode || !hasOrigin || !hasDestination) return false;
    if (!mapInitialized) return true;
    if (routeLoading) return true;
    return !bottomSheetMeasured;
}

/**
 * 같은 경로의 비동기 보행 형상 보강은 카메라 재이동 사유가 아니다.
 * 경로/OD/시트처럼 사용자가 보는 화면 구성이 바뀐 경우만 새 overview fit을 허용한다.
 */
export function getRouteOverviewFitKey(identity: RouteOverviewFitIdentity): string {
    const { padding } = identity;
    return [
        "fit-v20-stable-route-overview",
        identity.routeId ?? "none",
        identity.routeRevision,
        identity.routeMode,
        identity.travelMode,
        identity.origin.latitude.toFixed(5),
        identity.origin.longitude.toFixed(5),
        identity.destination.latitude.toFixed(5),
        identity.destination.longitude.toFixed(5),
        identity.sheetSnap,
        identity.sheetHidden ? "hidden" : "shown",
        Math.round(identity.bottomPanelHeight).toString(),
        Math.round(identity.animatedSheetOffset).toString(),
        Math.round(identity.visibleSheetTopY).toString(),
        Math.round(padding.top).toString(),
        Math.round(padding.bottom).toString(),
        Math.round(padding.left).toString(),
        Math.round(padding.right).toString(),
    ].join(":");
}

const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const WEB_MERCATOR_TILE_SIZE = 256;
const EQUATOR_METERS_PER_PIXEL_AT_ZOOM_ZERO = 156_543.033928;

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

function getMeasuredWorldScale(sample: PaddedBoundsCameraOptions["cameraScaleSample"]): number {
    const measured = sample?.metersPerPixel;
    if (!sample || typeof measured !== "number" || !Number.isFinite(measured) || measured <= 0 ||
        !Number.isFinite(sample.zoom) || !Number.isFinite(sample.latitude)) return 1;
    const latitude = clamp(sample.latitude, -WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE);
    const mercatorMetersPerPixel = EQUATOR_METERS_PER_PIXEL_AT_ZOOM_ZERO *
        Math.cos(latitude * Math.PI / 180) / (2 ** sample.zoom);
    const scale = mercatorMetersPerPixel / measured;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
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
    // Native renderers can draw a different number of screen points per zoom
    // level. Use their measured scale for both zoom selection and inset centering.
    const tileSize = WEB_MERCATOR_TILE_SIZE * getMeasuredWorldScale(options.cameraScaleSample);
    const zoomX = worldWidth > 0
        ? Math.log2(usableWidth / (tileSize * worldWidth))
        : maxZoom;
    const zoomY = worldHeight > 0
        ? Math.log2(usableHeight / (tileSize * worldHeight))
        : maxZoom;
    // SDK의 정수 확대 단계로 직접 이동할 때는 경로가 잘리지 않도록 내린다.
    const fitZoom = Math.min(zoomX, zoomY);
    const zoom = clamp(options.wholeZoomLevels ? Math.floor(fitZoom) : fitZoom, minZoom, maxZoom);
    const worldSize = tileSize * (2 ** zoom);
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

export type RouteMarkerCoordinate = {
    lat: number;
    lng: number;
};

export type RouteEndpointMarkerPresentation = {
    showLabels: boolean;
    markerScale: number;
    projectedDistancePx?: number;
};

const EARTH_RADIUS_METERS = 6_371_000;
const MIN_ENDPOINT_LABEL_DISTANCE_PX = 84;
const OVERVIEW_MARKER_SCALE = 0.84;
const OVERVIEW_MARKER_MAX_ZOOM = 12;
const STANDARD_MARKER_SCALE = 0.92;
const DETAIL_MARKER_MIN_ZOOM = 16.5;

function getEndpointMarkerScale(mapZoom: number): number {
    if (!Number.isFinite(mapZoom) || mapZoom <= OVERVIEW_MARKER_MAX_ZOOM) {
        return OVERVIEW_MARKER_SCALE;
    }
    if (mapZoom >= DETAIL_MARKER_MIN_ZOOM) return 1;
    return STANDARD_MARKER_SCALE;
}

function distanceMeters(from: RouteMarkerCoordinate, to: RouteMarkerCoordinate): number {
    const toRadians = Math.PI / 180;
    const startLat = from.lat * toRadians;
    const endLat = to.lat * toRadians;
    const deltaLat = (to.lat - from.lat) * toRadians;
    const deltaLng = (to.lng - from.lng) * toRadians;
    const haversine = (
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2
    );
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

/** 저배율에서 두 핀의 텍스트 몸체가 겹칠 때만 작은 핀 형태로 축약한다. */
export function getRouteEndpointMarkerPresentation(
    origin: RouteMarkerCoordinate | undefined,
    destination: RouteMarkerCoordinate | undefined,
    mapZoom: number
): RouteEndpointMarkerPresentation {
    const markerScale = getEndpointMarkerScale(mapZoom);
    if (!origin || !destination || !Number.isFinite(mapZoom)) {
        return { showLabels: true, markerScale };
    }
    const latitude = (origin.lat + destination.lat) / 2;
    const metersPerPixel = (
        156_543.03392 * Math.cos((latitude * Math.PI) / 180)
    ) / (2 ** mapZoom);
    const projectedDistancePx = distanceMeters(origin, destination) / Math.max(0.01, metersPerPixel);
    return {
        showLabels: projectedDistancePx >= MIN_ENDPOINT_LABEL_DISTANCE_PX,
        markerScale,
        projectedDistancePx: Math.round(projectedDistancePx),
    };
}

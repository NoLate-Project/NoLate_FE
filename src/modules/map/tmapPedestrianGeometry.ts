import type { RoutePathCoord } from './tmapApiCore';

/** A local, request-bound geometry check, NOT authenticated provider or navigation admission. */
export type PedestrianGeometryResult =
    | { ok: false; reason: 'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'INPUT_LIMIT' | 'INVALID_COORDINATE'
        | 'FEATURE_ORDER' | 'DISCONNECTED_LINES' | 'SEGMENT_TOO_LONG' | 'ENDPOINT_MISMATCH' | 'EMPTY_PATH' }
    | { ok: true; provider: 'tmap'; source: 'PEDESTRIAN_FEATURE_COLLECTION'; version: 1;
        request: { origin: RoutePathCoord; destination: RoutePathCoord };
        coordinates: RoutePathCoord[]; rawLinePointCount: number; lineCount: number; lengthMeters: number };

const object = (v: unknown): Record<string, unknown> | null =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
function coordinate(v: unknown): RoutePathCoord | null {
    const c = object(v);
    return c && typeof c.lat === 'number' && Number.isFinite(c.lat) && Math.abs(c.lat) <= 90
        && typeof c.lng === 'number' && Number.isFinite(c.lng) && Math.abs(c.lng) <= 180
        ? { lat: c.lat, lng: c.lng } : null;
}
function pair(v: unknown): RoutePathCoord | null {
    return Array.isArray(v) && v.length === 2 ? coordinate({ lng: v[0], lat: v[1] }) : null;
}
const equal = (a: RoutePathCoord, b: RoutePathCoord) => a.lat === b.lat && a.lng === b.lng;
function meters(a: RoutePathCoord, b: RoutePathCoord): number {
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/**
 * WGS84GEO / sort=index only. Never sorts, reverses, samples, repairs or inserts connectors.
 * Unknown/malformed rows reject the whole result, not just that row. Only adjacent exact
 * duplicate coordinates are collapsed. Limits are conservative internal policy, not a GPS SLA.
 * The separate source is deliberately NOT a trusted native WALK_STEPS_LINESTRING source.
 */
export function parseTmapPedestrianGeometry(data: unknown, originValue: unknown, destinationValue: unknown): PedestrianGeometryResult {
    const fail = (reason: Extract<PedestrianGeometryResult, { ok: false }>['reason']): PedestrianGeometryResult => ({ ok: false, reason });
    const origin = coordinate(originValue), destination = coordinate(destinationValue);
    if (!origin || !destination || equal(origin, destination)) return fail('INVALID_REQUEST');
    const root = object(data);
    if (root?.type !== 'FeatureCollection' || !Array.isArray(root.features) || !root.features.length
        || root.error !== undefined) return fail('INVALID_RESPONSE');
    if (root.features.length > 4096) return fail('INPUT_LIMIT');
    const coordinates: RoutePathCoord[] = [];
    let previousIndex = -1, rawLinePointCount = 0, lineCount = 0, lengthMeters = 0;
    for (const raw of root.features) {
        const feature = object(raw), geometry = object(feature?.geometry), properties = object(feature?.properties);
        if (feature?.type !== 'Feature' || !geometry || !properties) return fail('INVALID_RESPONSE');
        const index = properties.index;
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index <= previousIndex) return fail('FEATURE_ORDER');
        previousIndex = index;
        if (geometry.type === 'Point') {
            if (!pair(geometry.coordinates)) return fail('INVALID_COORDINATE');
            continue;
        }
        if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2)
            return fail('INVALID_RESPONSE');
        rawLinePointCount += geometry.coordinates.length;
        if (rawLinePointCount > 2000) return fail('INPUT_LIMIT');
        lineCount++;
        let first = true;
        for (const rawPoint of geometry.coordinates) {
            const point = pair(rawPoint);
            if (!point) return fail('INVALID_COORDINATE');
            const tail = coordinates[coordinates.length - 1];
            // Any gap between provider lines is unproven, even if the gap is only a metre.
            if (first && tail && !equal(tail, point)) return fail('DISCONNECTED_LINES');
            first = false;
            if (tail && equal(tail, point)) continue;
            if (tail) {
                const segment = meters(tail, point);
                if (segment > 150) return fail('SEGMENT_TOO_LONG');
                lengthMeters += segment;
            }
            coordinates.push(point);
        }
    }
    if (coordinates.length < 2 || lengthMeters <= 0) return fail('EMPTY_PATH');
    if (meters(origin, coordinates[0]) > 30 || meters(destination, coordinates[coordinates.length - 1]) > 30)
        return fail('ENDPOINT_MISMATCH');
    return { ok: true, provider: 'tmap', source: 'PEDESTRIAN_FEATURE_COLLECTION', version: 1,
        request: { origin, destination }, coordinates, rawLinePointCount, lineCount, lengthMeters };
}

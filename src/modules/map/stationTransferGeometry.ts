import type { RoutePathCoord } from "./tmapApi";

const MIN_INDOOR_TRANSFER_DISTANCE_METERS = 80;
const MIN_DETOUR_RATIO = 2.2;
const MIN_ENDPOINT_BASELINE_METERS = 12;
const MAX_SIMPLIFIED_SEGMENT_METERS = 110;
const DEDUPE_DISTANCE_METERS = 2.4;

type StationTransferDisplayPathInput = {
    pathCoords: RoutePathCoord[];
    startName?: string;
    endName?: string;
    distanceMeters?: number;
    previousRideCoord?: RoutePathCoord;
    nextRideCoord?: RoutePathCoord;
};

function normalizeStationName(value?: string): string {
    return (value ?? "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\s+/g, "")
        .replace(/역$/u, "")
        .trim()
        .toLowerCase();
}

function distanceMeters(from: RoutePathCoord, to: RoutePathCoord): number {
    const earthRadiusMeters = 6_371_000;
    const toRadians = (degree: number) => (degree * Math.PI) / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pathDistanceMeters(pathCoords: RoutePathCoord[]): number {
    return pathCoords.slice(1).reduce((total, point, index) => (
        total + distanceMeters(pathCoords[index], point)
    ), 0);
}

function dedupeSequentialCoords(pathCoords: RoutePathCoord[]): RoutePathCoord[] {
    return pathCoords.reduce<RoutePathCoord[]>((result, point) => {
        const previous = result[result.length - 1];
        if (!previous || distanceMeters(previous, point) > DEDUPE_DISTANCE_METERS) result.push(point);
        return result;
    }, []);
}

/**
 * 동일 역사 내부 환승은 공급자 선형이 플랫폼 동선을 왕복해 지도 위에서 큰 고리로 보일 수 있다.
 * 실제 도로 보행은 유지하고, 동일 역의 과도한 우회 선형만 승하차 anchor 사이의 짧은 연결로 정리한다.
 */
export function getStationTransferDisplayPath({
    pathCoords,
    startName,
    endName,
    distanceMeters: providerDistanceMeters,
    previousRideCoord,
    nextRideCoord,
}: StationTransferDisplayPathInput): RoutePathCoord[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return pathCoords;

    const normalizedStart = normalizeStationName(startName);
    const normalizedEnd = normalizeStationName(endName);
    if (!normalizedStart || normalizedStart !== normalizedEnd) return pathCoords;

    const rawDistanceMeters = pathDistanceMeters(pathCoords);
    const endpointDistanceMeters = distanceMeters(pathCoords[0], pathCoords[pathCoords.length - 1]);
    const statedDistanceMeters = Number.isFinite(providerDistanceMeters)
        ? Math.max(0, providerDistanceMeters!)
        : 0;
    const transferDistanceMeters = Math.max(rawDistanceMeters, statedDistanceMeters);
    const detourRatio = rawDistanceMeters / Math.max(MIN_ENDPOINT_BASELINE_METERS, endpointDistanceMeters);
    if (
        transferDistanceMeters < MIN_INDOOR_TRANSFER_DISTANCE_METERS ||
        detourRatio < MIN_DETOUR_RATIO
    ) {
        return pathCoords;
    }

    const simplified = dedupeSequentialCoords([
        previousRideCoord ?? pathCoords[0],
        nextRideCoord ?? pathCoords[pathCoords.length - 1],
    ]);
    if (simplified.length < 2) return pathCoords;

    const hasUnsafeGap = simplified.slice(1).some((point, index) => (
        distanceMeters(simplified[index], point) > MAX_SIMPLIFIED_SEGMENT_METERS
    ));
    if (hasUnsafeGap || pathDistanceMeters(simplified) >= rawDistanceMeters * 0.85) return pathCoords;

    return simplified;
}

import type { Place } from "../schedule/types";
import type { RouteAlternativeOption, RoutePathCoord } from "./tmapApi";

export type RoutePlausibilityStatus = "normal" | "geometry_suspected";

export type RoutePlausibilityAssessment = {
    status: RoutePlausibilityStatus;
    reason?: "extreme_detour" | "path_discontinuity";
    directDistanceMeters: number;
    routeDistanceMeters: number;
    detourRatio: number;
};

const EARTH_RADIUS_METERS = 6_371_000;
const LONG_ROUTE_MIN_DIRECT_METERS = 3_000;
// 대중교통망은 직선보다 크게 돌아가는 경우가 흔하다. 일반적인 망 굴곡은 허용하고
// 공급자 오류나 좌표계 혼입에 가까운 극단적인 결과만 화면 경고 대상으로 삼는다.
const LONG_ROUTE_DETOUR_RATIO = 3.2;
const LONG_ROUTE_MIN_EXTRA_METERS = 15_000;
const SHORT_ROUTE_DETOUR_RATIO = 4;
const SHORT_ROUTE_MIN_EXTRA_METERS = 6_000;
const MIN_DISCONTINUITY_METERS = 4_000;

function isFiniteCoord(coord: RoutePathCoord | undefined): coord is RoutePathCoord {
    return !!coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng);
}

function distanceMeters(from: RoutePathCoord, to: RoutePathCoord): number {
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

function pathDistanceMeters(pathCoords: RoutePathCoord[] | undefined): number | undefined {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return undefined;
    let total = 0;
    for (let index = 1; index < pathCoords.length; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        if (!isFiniteCoord(from) || !isFiniteCoord(to)) continue;
        total += distanceMeters(from, to);
    }
    return total > 0 ? total : undefined;
}

function hasPathDiscontinuity(
    pathCoords: RoutePathCoord[] | undefined,
    directDistanceMeters: number
): boolean {
    if (!Array.isArray(pathCoords) || pathCoords.length < 3) return false;
    const thresholdMeters = Math.max(MIN_DISCONTINUITY_METERS, directDistanceMeters * 0.75);
    for (let index = 1; index < pathCoords.length; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        if (!isFiniteCoord(from) || !isFiniteCoord(to)) continue;
        if (distanceMeters(from, to) > thresholdMeters) return true;
    }
    return false;
}

function placeCoord(place: Place): RoutePathCoord | undefined {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return undefined;
    return { lat: place.lat as number, lng: place.lng as number };
}

/**
 * 공급자 경로의 좌표 단절 또는 극단적인 거리 이상을 판정한다.
 * 철도·버스망의 자연스러운 우회는 허용하고, 화면 bounds를 망가뜨릴 수준의 결과만 후순위로 보낸다.
 */
export function assessRoutePlausibility(
    option: RouteAlternativeOption,
    origin: Place,
    destination: Place
): RoutePlausibilityAssessment | undefined {
    if (option.mode !== "TRANSIT") return undefined;
    const start = placeCoord(origin);
    const end = placeCoord(destination);
    if (!start || !end) return undefined;

    const directDistanceMeters = distanceMeters(start, end);
    if (!Number.isFinite(directDistanceMeters) || directDistanceMeters < 300) return undefined;

    const providerDistance = typeof option.distanceMeters === "number" && option.distanceMeters > 0
        ? option.distanceMeters
        : undefined;
    const routeDistanceMeters = providerDistance ?? pathDistanceMeters(option.pathCoords);
    if (!routeDistanceMeters || routeDistanceMeters < directDistanceMeters) return undefined;

    const detourRatio = routeDistanceMeters / directDistanceMeters;
    const extraDistanceMeters = routeDistanceMeters - directDistanceMeters;
    const extremeDetour = directDistanceMeters >= LONG_ROUTE_MIN_DIRECT_METERS
        ? detourRatio >= LONG_ROUTE_DETOUR_RATIO && extraDistanceMeters >= LONG_ROUTE_MIN_EXTRA_METERS
        : detourRatio >= SHORT_ROUTE_DETOUR_RATIO && extraDistanceMeters >= SHORT_ROUTE_MIN_EXTRA_METERS;
    const pathDiscontinuity = hasPathDiscontinuity(option.pathCoords, directDistanceMeters);
    const suspected = extremeDetour || pathDiscontinuity;

    return {
        status: suspected ? "geometry_suspected" : "normal",
        reason: pathDiscontinuity ? "path_discontinuity" : extremeDetour ? "extreme_detour" : undefined,
        directDistanceMeters: Math.round(directDistanceMeters),
        routeDistanceMeters: Math.round(routeDistanceMeters),
        detourRatio: Math.round(detourRatio * 100) / 100,
    };
}

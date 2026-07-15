import type { RoutePathCoord } from "./tmapApi";

const EARTH_RADIUS_METERS = 6_371_000;
const SAMPLE_START_RATIO = 0.2;
const SAMPLE_END_RATIO = 0.8;
const SAMPLE_STEP_RATIO = 0.05;

function isValidCoord(coord: RoutePathCoord | undefined): coord is RoutePathCoord {
    return !!coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng);
}

function distanceMeters(from: RoutePathCoord, to: RoutePathCoord): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const latitudeDelta = toRadians(to.lat - from.lat);
    const longitudeDelta = toRadians(to.lng - from.lng);
    const fromLatitude = toRadians(from.lat);
    const toLatitude = toRadians(to.lat);
    const haversine = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function coordAtDistance(
    coords: RoutePathCoord[],
    segmentLengths: number[],
    targetDistance: number
): RoutePathCoord {
    let traveled = 0;
    for (let index = 1; index < coords.length; index += 1) {
        const segmentLength = segmentLengths[index - 1];
        if (traveled + segmentLength >= targetDistance && segmentLength > 0) {
            const ratio = (targetDistance - traveled) / segmentLength;
            const from = coords[index - 1];
            const to = coords[index];
            return {
                lat: from.lat + ((to.lat - from.lat) * ratio),
                lng: from.lng + ((to.lng - from.lng) * ratio),
            };
        }
        traveled += segmentLength;
    }
    return coords[coords.length - 1];
}

/**
 * 노선 태그를 실제 본선 위에 두되, 루프형 노선에서도 승하차 마커 주변으로 되돌아오지 않는
 * 내부 지점을 고른다. 양 끝점과의 분리를 우선하고 중앙 진행률을 보조 점수로 사용한다.
 */
export function selectTransitRouteLabelCoordinate(
    pathCoords: RoutePathCoord[] | undefined
): RoutePathCoord | undefined {
    const coords = Array.isArray(pathCoords) ? pathCoords.filter(isValidCoord) : [];
    if (coords.length === 0) return undefined;
    if (coords.length === 1) return coords[0];

    const segmentLengths = coords.slice(1).map((coord, index) => (
        distanceMeters(coords[index], coord)
    ));
    const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
    if (!Number.isFinite(totalLength) || totalLength <= 0) return coords[0];

    const start = coords[0];
    const end = coords[coords.length - 1];
    let best: { coord: RoutePathCoord; score: number } | undefined;

    for (let ratio = SAMPLE_START_RATIO; ratio <= SAMPLE_END_RATIO + 0.001; ratio += SAMPLE_STEP_RATIO) {
        const coord = coordAtDistance(coords, segmentLengths, totalLength * ratio);
        const endpointSeparation = Math.min(
            distanceMeters(start, coord),
            distanceMeters(end, coord)
        );
        const centerPreference = 1 - (Math.abs(0.5 - ratio) / 0.3);
        const score = endpointSeparation + (Math.max(0, centerPreference) * totalLength * 0.04);
        if (!best || score > best.score) best = { coord, score };
    }

    return best?.coord;
}

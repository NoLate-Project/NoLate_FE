import type { RoutePathCoord } from "./tmapApi";

export type TransitMapCoordinate = {
    latitude: number;
    longitude: number;
};

export type TransitStopAnchorLike = {
    rawCoordinate?: TransitMapCoordinate;
    stopCoordinate?: TransitMapCoordinate;
    routeAnchorCoordinate?: TransitMapCoordinate;
    snapDistanceMeters?: number;
};

export const TRANSIT_CONNECTOR_POLICY = {
    // API가 도로 가장자리 좌표를 반환하는 정도의 오차만 끝점 보정으로 허용한다.
    snapEndpointMeters: 16,
    // 보행선과 승차점 사이에 실제 geometry가 없을 때 그릴 수 있는 최장 직선 거리다.
    maxDirectConnectorMeters: 24,
    // 출발·도착 POI는 보행 API 끝점이 건물/역 출입구에 스냅될 수 있어 조금 더 넓게 보정한다.
    // 승하차 접점에는 적용하지 않아 도로·선로를 가로지르는 가짜 연결을 만들지 않는다.
    maxTerminalConnectorMeters: 45,
    // 정류장 좌표와 운행 선형이 이 거리 안에 있을 때만 같은 화면 좌표로 합친다.
    stopToRouteSnapMeters: 20,
    // 역 POI와 선로가 다른 좌표일 때 표시할 수 있는 도식적 역사 내부 연결선 상한이다.
    maxSchematicAccessLinkMeters: 80,
} as const;

export type WalkPathJoinAction = "unchanged" | "snapped" | "connected" | "trimmed" | "rejected";

export type WalkPathJoinResult = {
    pathCoords: RoutePathCoord[];
    gapMeters?: number;
    action: WalkPathJoinAction;
};

export type TransitWalkPathStitchOptions = {
    terminalStart?: boolean;
    terminalEnd?: boolean;
};

export type TransitWalkRequestEndpointInput = {
    legIndex: number;
    legCount: number;
    origin: RoutePathCoord;
    destination: RoutePathCoord;
    legStart?: RoutePathCoord;
    legEnd?: RoutePathCoord;
    previousIsRide: boolean;
    previousRideAlight?: RoutePathCoord;
    nextIsRide: boolean;
    nextRideBoard?: RoutePathCoord;
};

export type TransitWalkRequestEndpoints = {
    from: RoutePathCoord;
    to: RoutePathCoord;
    snapFrom: boolean;
    snapTo: boolean;
};

export type TransitConnectorRequestFilterInput = {
    firstWalkRequestId?: string;
    lastWalkRequestId?: string;
    successfulWalkRequestIds: ReadonlySet<string>;
    successfulWalkLegIndexes: ReadonlySet<number>;
    legKinds: readonly string[];
};

export type LegacyOdsayWalkPathRepairInput = {
    pathCoords: RoutePathCoord[];
    expectedFrom: RoutePathCoord | undefined;
    expectedTo: RoutePathCoord | undefined;
    reportedDistanceMeters?: number;
};

function isFiniteRouteCoord(coord: RoutePathCoord | undefined): coord is RoutePathCoord {
    return !!coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng);
}

/**
 * 정밀 geometry가 없는 WALK leg의 보행 API 조회 범위를 정한다.
 * 연속 WALK를 가장 가까운 두 ride 사이 전체 구간으로 반복 조회하지 않고, 각 leg의
 * 실제 경계만 사용한다. 실제 출발·도착 좌표 치환은 첫/마지막 leg에만 허용한다.
 */
export function resolveTransitWalkRequestEndpoints({
    legIndex,
    legCount,
    origin,
    destination,
    legStart,
    legEnd,
    previousIsRide,
    previousRideAlight,
    nextIsRide,
    nextRideBoard,
}: TransitWalkRequestEndpointInput): TransitWalkRequestEndpoints | undefined {
    const first = legIndex === 0;
    const last = legIndex === legCount - 1;
    const from = first
        ? origin
        : previousIsRide
            ? (previousRideAlight ?? legStart)
            : legStart;
    const to = last
        ? destination
        : nextIsRide
            ? (nextRideBoard ?? legEnd)
            : legEnd;
    if (!isFiniteRouteCoord(from) || !isFiniteRouteCoord(to)) return undefined;
    return {
        from,
        to,
        snapFrom: first,
        snapTo: last,
    };
}

/**
 * 보행 상세 조회가 실제로 성공해 같은 범위를 완전히 대신할 때만 connector를 제거한다.
 * 연속 WALK 사이 gap과 실패한 WALK의 fallback은 항상 보존한다.
 */
export function filterTransitConnectorRequestsForSuccessfulWalks<T extends { id: string }>(
    requests: T[],
    {
        firstWalkRequestId,
        lastWalkRequestId,
        successfulWalkRequestIds,
        successfulWalkLegIndexes,
        legKinds,
    }: TransitConnectorRequestFilterInput
): T[] {
    return requests.filter((request) => {
        if (
            firstWalkRequestId &&
            successfulWalkRequestIds.has(firstWalkRequestId) &&
            request.id.endsWith("-walk-boundary-start")
        ) {
            return false;
        }
        if (
            lastWalkRequestId &&
            successfulWalkRequestIds.has(lastWalkRequestId) &&
            request.id.endsWith("-walk-boundary-end")
        ) {
            return false;
        }
        const gapMatch = request.id.match(/-walk-gap-(\d+)$/);
        if (!gapMatch) return true;
        const gapIndex = Number(gapMatch[1]);
        if (legKinds[gapIndex] === "WALK" && legKinds[gapIndex + 1] === "WALK") {
            return true;
        }
        return !(
            successfulWalkLegIndexes.has(gapIndex) ||
            successfulWalkLegIndexes.has(gapIndex + 1)
        );
    });
}

export function routeCoordDistanceMeters(from: RoutePathCoord, to: RoutePathCoord): number {
    const earthRadiusMeters = 6_371_000;
    const toRadians = Math.PI / 180;
    const startLat = from.lat * toRadians;
    const endLat = to.lat * toRadians;
    const deltaLat = (to.lat - from.lat) * toRadians;
    const deltaLng = (to.lng - from.lng) * toRadians;
    const haversine = (
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2
    );
    return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function routePathLengthMeters(pathCoords: RoutePathCoord[]): number {
    return pathCoords.slice(1).reduce((total, coordinate, index) => (
        total + routeCoordDistanceMeters(pathCoords[index], coordinate)
    ), 0);
}

function routePathMaxSegmentMeters(pathCoords: RoutePathCoord[]): number {
    return pathCoords.slice(1).reduce((maximum, coordinate, index) => (
        Math.max(maximum, routeCoordDistanceMeters(pathCoords[index], coordinate))
    ), 0);
}

function appendDistinctRouteCoordinate(
    pathCoords: RoutePathCoord[],
    coordinate: RoutePathCoord,
    toleranceMeters = 0.75
): void {
    const previous = pathCoords[pathCoords.length - 1];
    if (!previous || routeCoordDistanceMeters(previous, coordinate) > toleranceMeters) {
        pathCoords.push(coordinate);
    }
}

/**
 * 2026-07 parser correction before saved ODsay WALK geometry with the shape
 * `... E, F, T, E, ..., F` was persisted. `T` is the actual following ride or
 * destination anchor, while the repeated E/F tail belongs before T. Repair only
 * that exact structural signature; arbitrary malformed paths remain untouched.
 */
export function repairLegacyOdsayWalkPath({
    pathCoords,
    expectedFrom,
    expectedTo,
    reportedDistanceMeters,
}: LegacyOdsayWalkPathRepairInput): RoutePathCoord[] {
    if (
        !Array.isArray(pathCoords) ||
        pathCoords.length < 6 ||
        pathCoords.some((coordinate) => !isFiniteRouteCoord(coordinate)) ||
        !isFiniteRouteCoord(expectedFrom) ||
        !isFiniteRouteCoord(expectedTo) ||
        routeCoordDistanceMeters(pathCoords[0], expectedFrom) > 2
    ) {
        return pathCoords;
    }

    const originalLengthMeters = routePathLengthMeters(pathCoords);
    const originalMaxSegmentMeters = routePathMaxSegmentMeters(pathCoords);
    const hasReportedDistance = typeof reportedDistanceMeters === "number" &&
        Number.isFinite(reportedDistanceMeters) && reportedDistanceMeters >= 20;
    let best: { pathCoords: RoutePathCoord[]; score: number } | undefined;

    // Two coordinates must precede T, and its tail must contain at least the
    // repeated E/F pair. This excludes already-correct paths whose anchor is last.
    for (let targetIndex = 2; targetIndex <= pathCoords.length - 3; targetIndex += 1) {
        const target = pathCoords[targetIndex];
        if (routeCoordDistanceMeters(target, expectedTo) > 2) continue;

        const repeatedStart = pathCoords[targetIndex - 2];
        const repeatedEnd = pathCoords[targetIndex - 1];
        const tail = pathCoords.slice(targetIndex + 1);
        if (
            routeCoordDistanceMeters(repeatedStart, tail[0]) > 1 ||
            routeCoordDistanceMeters(repeatedEnd, tail[tail.length - 1]) > 1
        ) {
            continue;
        }

        const repaired: RoutePathCoord[] = [];
        [
            ...pathCoords.slice(0, targetIndex - 1),
            ...tail,
            target,
        ].forEach((coordinate) => appendDistinctRouteCoordinate(repaired, coordinate));
        if (
            repaired.length < 2 ||
            routeCoordDistanceMeters(repaired[0], expectedFrom) > 2 ||
            routeCoordDistanceMeters(repaired[repaired.length - 1], expectedTo) > 2
        ) {
            continue;
        }

        const repairedLengthMeters = routePathLengthMeters(repaired);
        const removedLoopMeters = originalLengthMeters - repairedLengthMeters;
        if (removedLoopMeters < 3) continue;
        if (routePathMaxSegmentMeters(repaired) > originalMaxSegmentMeters + 0.5) continue;

        const originalDistanceError = hasReportedDistance
            ? Math.abs(originalLengthMeters - reportedDistanceMeters)
            : originalLengthMeters;
        const repairedDistanceError = hasReportedDistance
            ? Math.abs(repairedLengthMeters - reportedDistanceMeters)
            : repairedLengthMeters;
        if (repairedDistanceError >= originalDistanceError) continue;

        if (!best || repairedDistanceError < best.score) {
            best = { pathCoords: repaired, score: repairedDistanceError };
        }
    }

    return best?.pathCoords ?? pathCoords;
}

/**
 * WALK geometry에서 역사 내부처럼 공급자가 생략한 긴 구간을 분리한다.
 * 80m를 넘는 좌표 점프는 하나의 보행 선분으로 그리지 않고, 호출부가 보행 API로 보완하게 한다.
 */
export function splitWalkPathAtDiscontinuities(
    pathCoords: RoutePathCoord[] | undefined,
    maxGapMeters = TRANSIT_CONNECTOR_POLICY.maxSchematicAccessLinkMeters
): RoutePathCoord[][] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return [];

    const parts: RoutePathCoord[][] = [];
    let currentPart: RoutePathCoord[] = [];
    pathCoords.forEach((coord) => {
        if (!isFiniteRouteCoord(coord)) return;
        const previous = currentPart[currentPart.length - 1];
        if (
            previous &&
            routeCoordDistanceMeters(previous, coord) > maxGapMeters
        ) {
            if (currentPart.length >= 2) parts.push(currentPart);
            currentPart = [coord];
            return;
        }
        currentPart.push(coord);
    });
    if (currentPart.length >= 2) parts.push(currentPart);
    return parts;
}

type PathProjection = {
    segmentIndex: number;
    coordinate: RoutePathCoord;
    distanceMeters: number;
    discardedLengthMeters: number;
};

const TERMINAL_TAIL_TRIM_MIN_METERS = 18;
const TERMINAL_PROJECTION_IMPROVEMENT_MIN_METERS = 8;

function projectEndpointToPath(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord,
    position: "start" | "end"
): PathProjection | undefined {
    const latitudeMetersPerDegree = 111_320;
    const longitudeMetersPerDegree = Math.max(
        1,
        latitudeMetersPerDegree * Math.cos((endpoint.lat * Math.PI) / 180)
    );
    const cumulativeLengths = [0];
    for (let index = 1; index < pathCoords.length; index += 1) {
        cumulativeLengths[index] = cumulativeLengths[index - 1] +
            routeCoordDistanceMeters(pathCoords[index - 1], pathCoords[index]);
    }
    const totalLengthMeters = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;

    let nearest: PathProjection | undefined;
    for (let index = 0; index < pathCoords.length - 1; index += 1) {
        const start = pathCoords[index];
        const end = pathCoords[index + 1];
        if (!isFiniteRouteCoord(start) || !isFiniteRouteCoord(end)) continue;

        const startX = (start.lng - endpoint.lng) * longitudeMetersPerDegree;
        const startY = (start.lat - endpoint.lat) * latitudeMetersPerDegree;
        const endX = (end.lng - endpoint.lng) * longitudeMetersPerDegree;
        const endY = (end.lat - endpoint.lat) * latitudeMetersPerDegree;
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const segmentLengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
        const ratio = segmentLengthSquared > 0
            ? Math.max(0, Math.min(1, -((startX * deltaX) + (startY * deltaY)) / segmentLengthSquared))
            : 0;
        const projectedX = startX + (deltaX * ratio);
        const projectedY = startY + (deltaY * ratio);
        const coordinate = {
            lat: start.lat + ((end.lat - start.lat) * ratio),
            lng: start.lng + ((end.lng - start.lng) * ratio),
        };
        const distanceMeters = Math.hypot(projectedX, projectedY);
        const distanceAlongPath = cumulativeLengths[index] + routeCoordDistanceMeters(start, coordinate);
        const discardedLengthMeters = position === "end"
            ? totalLengthMeters - distanceAlongPath
            : distanceAlongPath;

        if (!nearest || distanceMeters < nearest.distanceMeters) {
            nearest = { segmentIndex: index, coordinate, distanceMeters, discardedLengthMeters };
        }
    }
    return nearest;
}

function appendDistinctCoordinate(pathCoords: RoutePathCoord[], coordinate: RoutePathCoord): void {
    const previous = pathCoords[pathCoords.length - 1];
    if (!previous || routeCoordDistanceMeters(previous, coordinate) > 0.5) {
        pathCoords.push(coordinate);
    }
}

function trimTerminalLoopTowardEndpoint(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord,
    position: "start" | "end",
    maxConnectorMeters: number
): RoutePathCoord[] | undefined {
    const terminal = position === "start" ? pathCoords[0] : pathCoords[pathCoords.length - 1];
    const terminalGapMeters = routeCoordDistanceMeters(terminal, endpoint);
    const projection = projectEndpointToPath(pathCoords, endpoint, position);
    if (!projection) return undefined;

    // 최소 한 개의 완전한 선분을 되돌아가는 꼬리만 잘라 정상적인 마지막 코너는 보존한다.
    const projectionIsBeforeTerminalSegment = position === "end"
        ? projection.segmentIndex < pathCoords.length - 2
        : projection.segmentIndex > 0;
    const meaningfullyCloser = terminalGapMeters - projection.distanceMeters >=
        TERMINAL_PROJECTION_IMPROVEMENT_MIN_METERS;
    if (
        !projectionIsBeforeTerminalSegment ||
        !meaningfullyCloser ||
        projection.distanceMeters > maxConnectorMeters ||
        projection.discardedLengthMeters < TERMINAL_TAIL_TRIM_MIN_METERS
    ) {
        return undefined;
    }

    const trimmed: RoutePathCoord[] = [];
    if (position === "end") {
        pathCoords.slice(0, projection.segmentIndex + 1).forEach((coord) => {
            appendDistinctCoordinate(trimmed, coord);
        });
        appendDistinctCoordinate(trimmed, projection.coordinate);
    } else {
        appendDistinctCoordinate(trimmed, projection.coordinate);
        pathCoords.slice(projection.segmentIndex + 1).forEach((coord) => {
            appendDistinctCoordinate(trimmed, coord);
        });
    }
    return trimmed.length >= 2 ? trimmed : undefined;
}

/**
 * 정류장 POI와 도로/철도 선형은 서로 다른 의미의 좌표다.
 * 가까울 때만 선형 위 좌표를 쓰고, 그보다 멀면 사용자가 실제로 찾아갈 정류장 POI를 유지한다.
 */
export function resolveTransitStopAccessCoordinate(
    anchor: TransitStopAnchorLike | undefined,
    maxSnapMeters = TRANSIT_CONNECTOR_POLICY.stopToRouteSnapMeters
): TransitMapCoordinate | undefined {
    if (!anchor) return undefined;
    const stopCoordinate = anchor.stopCoordinate ?? anchor.rawCoordinate;
    const routeCoordinate = anchor.routeAnchorCoordinate;
    const snapDistanceMeters = anchor.snapDistanceMeters;

    if (
        routeCoordinate &&
        Number.isFinite(routeCoordinate.latitude) &&
        Number.isFinite(routeCoordinate.longitude) &&
        typeof snapDistanceMeters === "number" &&
        Number.isFinite(snapDistanceMeters) &&
        snapDistanceMeters <= maxSnapMeters
    ) {
        return routeCoordinate;
    }

    if (
        stopCoordinate &&
        Number.isFinite(stopCoordinate.latitude) &&
        Number.isFinite(stopCoordinate.longitude)
    ) {
        return stopCoordinate;
    }
    return routeCoordinate;
}

/**
 * 노선 위에 표시하는 통과 정류장 노드는 실제 POI보다 운행 선형과의 연결성이 우선이다.
 * 공급자 좌표 오차로 볼 수 있는 범위까지만 본선에 붙이고, 그 이상이면 실제 POI를 유지한다.
 */
export function resolveTransitRouteNodeCoordinate(
    anchor: TransitStopAnchorLike | undefined,
    maxSnapMeters = TRANSIT_CONNECTOR_POLICY.maxSchematicAccessLinkMeters
): TransitMapCoordinate | undefined {
    if (!anchor) return undefined;
    const stopCoordinate = anchor.stopCoordinate ?? anchor.rawCoordinate;
    const routeCoordinate = anchor.routeAnchorCoordinate;
    const snapDistanceMeters = anchor.snapDistanceMeters;

    if (
        routeCoordinate &&
        Number.isFinite(routeCoordinate.latitude) &&
        Number.isFinite(routeCoordinate.longitude) &&
        typeof snapDistanceMeters === "number" &&
        Number.isFinite(snapDistanceMeters) &&
        snapDistanceMeters <= maxSnapMeters
    ) {
        return routeCoordinate;
    }

    if (
        stopCoordinate &&
        Number.isFinite(stopCoordinate.latitude) &&
        Number.isFinite(stopCoordinate.longitude)
    ) {
        return stopCoordinate;
    }
    return routeCoordinate;
}

/**
 * 역 POI와 운행 선형을 합치기에는 멀지만 같은 역사로 볼 수 있는 범위만 반환한다.
 * 호출부는 이를 보행선이 아닌 노선색 점선으로 표시해야 한다.
 */
export function getTransitStopAccessLink(
    anchor: TransitStopAnchorLike | undefined
): [TransitMapCoordinate, TransitMapCoordinate] | undefined {
    if (!anchor) return undefined;
    const stopCoordinate = anchor.stopCoordinate ?? anchor.rawCoordinate;
    const routeCoordinate = anchor.routeAnchorCoordinate;
    const distance = anchor.snapDistanceMeters;
    if (
        !stopCoordinate ||
        !routeCoordinate ||
        typeof distance !== "number" ||
        !Number.isFinite(distance) ||
        distance <= TRANSIT_CONNECTOR_POLICY.stopToRouteSnapMeters ||
        distance > TRANSIT_CONNECTOR_POLICY.maxSchematicAccessLinkMeters
    ) {
        return undefined;
    }
    return [stopCoordinate, routeCoordinate];
}

/**
 * 지하철 보행 선형이 역사 입구에서 끝나는 경우 역 POI까지의 내부 이동을 도식선으로 분리한다.
 * 실제 보행선에 합칠 수 있는 24m 이하는 호출부의 endpoint 보정이 담당한다.
 */
export function getTransitWalkAccessLink(
    walkPath: RoutePathCoord[] | undefined,
    stopCoordinate: RoutePathCoord | undefined,
    position: "board" | "alight"
): [TransitMapCoordinate, TransitMapCoordinate] | undefined {
    if (!Array.isArray(walkPath) || walkPath.length < 2 || !isFiniteRouteCoord(stopCoordinate)) {
        return undefined;
    }
    const walkEndpoint = position === "board" ? walkPath[walkPath.length - 1] : walkPath[0];
    if (!isFiniteRouteCoord(walkEndpoint)) return undefined;

    const distance = routeCoordDistanceMeters(walkEndpoint, stopCoordinate);
    if (
        !Number.isFinite(distance) ||
        distance <= TRANSIT_CONNECTOR_POLICY.maxDirectConnectorMeters ||
        distance > TRANSIT_CONNECTOR_POLICY.maxSchematicAccessLinkMeters
    ) {
        return undefined;
    }
    const walkMapCoordinate = { latitude: walkEndpoint.lat, longitude: walkEndpoint.lng };
    const stopMapCoordinate = { latitude: stopCoordinate.lat, longitude: stopCoordinate.lng };
    return position === "board"
        ? [walkMapCoordinate, stopMapCoordinate]
        : [stopMapCoordinate, walkMapCoordinate];
}

/**
 * 보행 API path 끝점은 짧은 좌표 오차만 보정한다.
 * 장거리 gap은 직선으로 꾸며내지 않고 원본 path를 유지해 잘못된 보행 안내를 막는다.
 */
function joinWalkPathEndpointWithin(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord | undefined,
    position: "start" | "end",
    maxDirectConnectorMeters: number
): WalkPathJoinResult {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2 || !isFiniteRouteCoord(endpoint)) {
        return { pathCoords, action: "unchanged" };
    }

    const targetIndex = position === "start" ? 0 : pathCoords.length - 1;
    const target = pathCoords[targetIndex];
    if (!isFiniteRouteCoord(target)) return { pathCoords, action: "unchanged" };

    const gapMeters = routeCoordDistanceMeters(target, endpoint);
    if (!Number.isFinite(gapMeters) || gapMeters > maxDirectConnectorMeters) {
        return { pathCoords, gapMeters, action: "rejected" };
    }

    const nextPath = pathCoords.slice();
    if (gapMeters <= TRANSIT_CONNECTOR_POLICY.snapEndpointMeters) {
        nextPath[targetIndex] = endpoint;
        return { pathCoords: nextPath, gapMeters, action: "snapped" };
    }

    if (position === "start") nextPath.unshift(endpoint);
    else nextPath.push(endpoint);
    return { pathCoords: nextPath, gapMeters, action: "connected" };
}

export function joinWalkPathEndpoint(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord | undefined,
    position: "start" | "end"
): WalkPathJoinResult {
    return joinWalkPathEndpointWithin(
        pathCoords,
        endpoint,
        position,
        TRANSIT_CONNECTOR_POLICY.maxDirectConnectorMeters
    );
}

/**
 * 실제 출발·도착 POI와 첫/마지막 보행 경로만 잇는다.
 * 일반 승하차 연결보다 넓은 허용치는 terminal 경계에서만 명시적으로 사용한다.
 */
export function joinTerminalWalkPathEndpoint(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord | undefined,
    position: "start" | "end"
): WalkPathJoinResult {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2 || !isFiniteRouteCoord(endpoint)) {
        return { pathCoords, action: "unchanged" };
    }
    const trimmedPath = trimTerminalLoopTowardEndpoint(
        pathCoords,
        endpoint,
        position,
        TRANSIT_CONNECTOR_POLICY.maxTerminalConnectorMeters
    );
    const result = joinWalkPathEndpointWithin(
        trimmedPath ?? pathCoords,
        endpoint,
        position,
        TRANSIT_CONNECTOR_POLICY.maxTerminalConnectorMeters
    );
    if (trimmedPath && result.action !== "rejected") {
        return { ...result, action: "trimmed" };
    }
    return result;
}

/**
 * 공급자 WALK geometry를 실제 이동 방향으로 정렬한 뒤 양 끝의 표시 좌표만 보정한다.
 * 출발·도착 터미널은 경로가 POI를 지나친 꼬리까지 반환한 경우 이를 잘라낼 수 있지만,
 * 일반 환승 경계는 기존의 짧은 endpoint 오차만 허용한다.
 */
export function stitchTransitWalkPathToAnchors(
    pathCoords: RoutePathCoord[],
    from: RoutePathCoord | undefined,
    to: RoutePathCoord | undefined,
    options: TransitWalkPathStitchOptions = {}
): RoutePathCoord[] {
    if (
        !Array.isArray(pathCoords) ||
        pathCoords.length < 2 ||
        pathCoords.some((coord) => !isFiniteRouteCoord(coord)) ||
        (from !== undefined && !isFiniteRouteCoord(from)) ||
        (to !== undefined && !isFiniteRouteCoord(to)) ||
        (!from && !to)
    ) {
        return pathCoords;
    }

    const first = pathCoords[0];
    const last = pathCoords[pathCoords.length - 1];
    let shouldReverse = false;
    if (from && to) {
        const forwardDistance =
            routeCoordDistanceMeters(first, from) + routeCoordDistanceMeters(last, to);
        const reverseDistance =
            routeCoordDistanceMeters(last, from) + routeCoordDistanceMeters(first, to);
        shouldReverse = reverseDistance < forwardDistance;
    } else if (from) {
        shouldReverse = routeCoordDistanceMeters(last, from) <
            routeCoordDistanceMeters(first, from);
    } else if (to) {
        shouldReverse = routeCoordDistanceMeters(first, to) <
            routeCoordDistanceMeters(last, to);
    }

    let displayPath = shouldReverse ? pathCoords.slice().reverse() : pathCoords;
    if (from) {
        displayPath = (options.terminalStart
            ? joinTerminalWalkPathEndpoint(displayPath, from, "start")
            : joinWalkPathEndpoint(displayPath, from, "start")).pathCoords;
    }
    if (to) {
        displayPath = (options.terminalEnd
            ? joinTerminalWalkPathEndpoint(displayPath, to, "end")
            : joinWalkPathEndpoint(displayPath, to, "end")).pathCoords;
    }
    return displayPath;
}

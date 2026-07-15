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

function isFiniteRouteCoord(coord: RoutePathCoord | undefined): coord is RoutePathCoord {
    return !!coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng);
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

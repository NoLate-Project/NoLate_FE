import type { RoutePathCoord } from "./tmapApi";
import {
    joinWalkPathEndpoint,
    routeCoordDistanceMeters,
    TRANSIT_CONNECTOR_POLICY,
} from "./transitRouteGeometry";

export const ROUTE_ENDPOINT_ACCESS_POLICY = {
    // 지도에서 체감되지 않는 공급자 좌표 오차는 별도 접근선으로 만들지 않는다.
    minGapMeters: 10,
    // 이보다 먼 도로망 끝점은 짧은 승하차 접근 구간이 아니라 공급자 형상 오류로 본다.
    maxGapMeters: 300,
    // 서로 다른 도로망의 스냅 지점끼리만 제한적으로 연결하는 도식선 상한이다.
    maxSchematicGapMeters: 120,
    // 짧은 끝점 보정이 과도한 우회 보행 경로로 바뀌지 않도록 길이를 이중 제한한다.
    maxProviderPathMeters: 700,
    maxProviderDetourRatio: 4,
    maxProviderDetourExtraMeters: 180,
} as const;

export type RouteEndpointAccessPosition = "start" | "end";

export type RouteEndpointAccessRequest = {
    id: string;
    position: RouteEndpointAccessPosition;
    from: RoutePathCoord;
    to: RoutePathCoord;
    gapMeters: number;
};

export type RouteEndpointAccessPath = {
    id: string;
    position: RouteEndpointAccessPosition;
    pathCoords: RoutePathCoord[];
    schematicPaths: RoutePathCoord[][];
};

function isFiniteCoord(coord: RoutePathCoord | undefined): coord is RoutePathCoord {
    return !!coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng);
}

function createRequest(
    id: string,
    position: RouteEndpointAccessPosition,
    from: RoutePathCoord | undefined,
    to: RoutePathCoord | undefined
): RouteEndpointAccessRequest | undefined {
    if (!isFiniteCoord(from) || !isFiniteCoord(to)) return undefined;
    const gapMeters = routeCoordDistanceMeters(from, to);
    if (
        !Number.isFinite(gapMeters) ||
        gapMeters < ROUTE_ENDPOINT_ACCESS_POLICY.minGapMeters ||
        gapMeters > ROUTE_ENDPOINT_ACCESS_POLICY.maxGapMeters
    ) {
        return undefined;
    }
    return { id, position, from, to, gapMeters };
}

function pathDistanceMeters(pathCoords: RoutePathCoord[]): number {
    let distanceMeters = 0;
    for (let index = 1; index < pathCoords.length; index += 1) {
        distanceMeters += routeCoordDistanceMeters(pathCoords[index - 1], pathCoords[index]);
    }
    return distanceMeters;
}

function orientProviderPath(
    pathCoords: RoutePathCoord[],
    request: RouteEndpointAccessRequest
): RoutePathCoord[] {
    const first = pathCoords[0];
    const last = pathCoords[pathCoords.length - 1];
    const forwardGap = routeCoordDistanceMeters(request.from, first) +
        routeCoordDistanceMeters(last, request.to);
    const reverseGap = routeCoordDistanceMeters(request.from, last) +
        routeCoordDistanceMeters(first, request.to);
    return reverseGap < forwardGap ? pathCoords.slice().reverse() : pathCoords.slice();
}

function isPlausibleProviderPath(
    request: RouteEndpointAccessRequest,
    pathCoords: RoutePathCoord[],
    schematicPaths: RoutePathCoord[][]
): boolean {
    const renderedDistanceMeters = pathDistanceMeters(pathCoords) +
        schematicPaths.reduce((total, path) => total + pathDistanceMeters(path), 0);
    const relativeLimit = Math.max(
        request.gapMeters * ROUTE_ENDPOINT_ACCESS_POLICY.maxProviderDetourRatio,
        request.gapMeters + ROUTE_ENDPOINT_ACCESS_POLICY.maxProviderDetourExtraMeters
    );
    const allowedDistanceMeters = Math.min(
        ROUTE_ENDPOINT_ACCESS_POLICY.maxProviderPathMeters,
        relativeLimit
    );
    return Number.isFinite(renderedDistanceMeters) && renderedDistanceMeters <= allowedDistanceMeters;
}

/**
 * 선택 지점과 자동차/자전거 도로망 끝점 사이에서 실제 접근 안내가 필요한 구간만 만든다.
 * 반환 경로 방향은 항상 전체 이동 순서와 같다.
 */
export function buildRouteEndpointAccessRequests(
    routeId: string,
    routePath: RoutePathCoord[] | undefined,
    origin: RoutePathCoord | undefined,
    destination: RoutePathCoord | undefined
): RouteEndpointAccessRequest[] {
    if (!Array.isArray(routePath) || routePath.length < 2) return [];
    const start = createRequest(
        `${routeId}-endpoint-access-start`,
        "start",
        origin,
        routePath[0]
    );
    const end = createRequest(
        `${routeId}-endpoint-access-end`,
        "end",
        routePath[routePath.length - 1],
        destination
    );
    return [start, end].filter((item): item is RouteEndpointAccessRequest => !!item);
}

/**
 * 보행 API 선형을 선택 지점과 모드 경로 끝점에 맞춘다.
 * 24m를 넘는 오차는 보행선으로 꾸미지 않고 공급자 망 간 도식 연결선으로 분리한다.
 */
export function resolveRouteEndpointAccessPath(
    request: RouteEndpointAccessRequest,
    providerWalkPath?: RoutePathCoord[]
): RouteEndpointAccessPath | undefined {
    if (request.gapMeters <= TRANSIT_CONNECTOR_POLICY.maxDirectConnectorMeters) {
        return {
            id: request.id,
            position: request.position,
            pathCoords: [request.from, request.to],
            schematicPaths: [],
        };
    }
    if (!Array.isArray(providerWalkPath) || providerWalkPath.length < 2) return undefined;

    let pathCoords = orientProviderPath(providerWalkPath, request);
    const schematicPaths: RoutePathCoord[][] = [];
    const endpointJoins = [
        { endpoint: request.from, position: "start" as const },
        { endpoint: request.to, position: "end" as const },
    ];

    for (const join of endpointJoins) {
        const result = joinWalkPathEndpoint(pathCoords, join.endpoint, join.position);
        if (result.action !== "rejected") {
            pathCoords = result.pathCoords;
            continue;
        }

        const gapMeters = result.gapMeters ?? Number.POSITIVE_INFINITY;
        if (gapMeters > ROUTE_ENDPOINT_ACCESS_POLICY.maxSchematicGapMeters) return undefined;
        const providerEndpoint = join.position === "start"
            ? pathCoords[0]
            : pathCoords[pathCoords.length - 1];
        schematicPaths.push(join.position === "start"
            ? [join.endpoint, providerEndpoint]
            : [providerEndpoint, join.endpoint]);
    }

    if (!isPlausibleProviderPath(request, pathCoords, schematicPaths)) return undefined;

    return {
        id: request.id,
        position: request.position,
        pathCoords,
        schematicPaths,
    };
}

/** 도보 접근 경로와 승하차 접점을 연결하고 표시 좌표를 정규화하는 모듈입니다. */
import {
  type RoutePathCoord,
  type TransitLegDetail,
} from '../../map/routingService';
import {
  TRANSIT_CONNECTOR_POLICY as CONNECTOR_POLICY,
  joinWalkPathEndpoint,
  resolveTransitStopAccessCoordinate,
} from '../../map/transitRouteGeometry';
import { getStationTransferDisplayPath } from '../../map/stationTransferGeometry';
import { warnRouteDebug } from './routeMapTypesAndStyle';
import { toRoutePathCoord } from './routeMapCoordinate';
import {
  getAdjacentWalkReferenceCoord,
  getTransitLegAlightAnchorOnPath,
  getTransitLegAlightCoord,
  getTransitLegBoardAnchorOnPath,
  getTransitLegBoardCoord,
  getTransitLegEndCoord,
  getTransitLegStartCoord,
  getTransitLegStopAnchor,
  getWalkLegEndCoord,
  getWalkLegStartCoord,
  isRideLegKind,
} from './routeTransitLegCoordinates';

/** 도보와 승차 경로를 직접 연결할 수 있는 최대 거리입니다. */
export const TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS =
  CONNECTOR_POLICY.maxDirectConnectorMeters;

/**
 * 승하차 정류장 좌표를 인접 도보 흐름에 맞춰 지도 표시용 위치로 보정합니다.
 * 입력 구간 목록은 변경하지 않으며 유효한 승차 구간이 아니면 좌표를 반환하지 않습니다.
 */
export function getRideStopVisualCoord(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  position: 'BOARD' | 'ALIGHT',
): RoutePathCoord | undefined {
  if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length)
    return undefined;
  const leg = legs[legIndex];
  if (!isRideLegKind(leg.kind)) return undefined;
  return getRideStopDisplayCoord(legs, legIndex, position);
}
import {
  interpolateRouteCoord,
  routeCoordDistanceMeters,
} from './routeDisplayPath';
export {
  buildEndpointPathCoords,
  filterDensePathCoords,
  interpolateRouteCoord,
  normalizeDisplayPathCoords,
  routeCoordDistanceMeters,
  smoothWalkPathForDisplay,
  toDisplayOverlayCoords,
} from './routeDisplayPath';

/** 경로 한쪽 끝과 목표 좌표를 직접 연결하거나 가장 가까운 방향으로 뒤집어 연속된 좌표를 만듭니다. 입력 좌표 배열은 변경하지 않습니다. */
export function connectPathEndpoint(
  pathCoords: RoutePathCoord[],
  endpoint: RoutePathCoord | undefined,
  position: 'start' | 'end',
): RoutePathCoord[] {
  const result = joinWalkPathEndpoint(pathCoords, endpoint, position);
  if (result.action === 'rejected') {
    warnRouteDebug('[route-walk-anchor] connector rejected', {
      position,
      distanceMeters: Number.isFinite(result.gapMeters)
        ? Math.round(result.gapMeters!)
        : undefined,
      reason: 'missing pedestrian geometry exceeds direct connector policy',
      target:
        position === 'start'
          ? pathCoords[0]
          : pathCoords[pathCoords.length - 1],
      endpoint,
      maxDirectConnectorMeters: TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS,
    });
  }
  return result.pathCoords;
}

/** 경로 시작점과 목표 좌표 사이가 짧을 때만 연결 좌표를 앞에 추가합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function prependShortConnectorIfNeeded(
  pathCoords: RoutePathCoord[],
  endpoint: RoutePathCoord | undefined,
): RoutePathCoord[] {
  return connectPathEndpoint(pathCoords, endpoint, 'start');
}

/** 경로 종료점과 목표 좌표 사이가 짧을 때만 연결 좌표를 뒤에 추가합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function appendShortConnectorIfNeeded(
  pathCoords: RoutePathCoord[],
  endpoint: RoutePathCoord | undefined,
): RoutePathCoord[] {
  return connectPathEndpoint(pathCoords, endpoint, 'end');
}

/** 도보 세그먼트의 시작·종료점을 인접 승차 앵커에 맞추고 표시 좌표와 품질 정보를 갱신합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function alignWalkSegmentEndpoints(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  pathCoords: RoutePathCoord[],
): RoutePathCoord[] {
  if (
    !Array.isArray(legs) ||
    !Array.isArray(pathCoords) ||
    pathCoords.length < 2
  )
    return pathCoords;

  let alignedPath = pathCoords.slice();
  for (let index = legIndex - 1; index >= 0; index -= 1) {
    const candidate = legs[index];
    if (!candidate || !isRideLegKind(candidate.kind)) continue;
    alignedPath = prependShortConnectorIfNeeded(
      alignedPath,
      getRideStopVisualCoord(legs, index, 'ALIGHT'),
    );
    break;
  }
  for (let index = legIndex + 1; index < legs.length; index += 1) {
    const candidate = legs[index];
    if (!candidate || !isRideLegKind(candidate.kind)) continue;
    alignedPath = appendShortConnectorIfNeeded(
      alignedPath,
      getRideStopVisualCoord(legs, index, 'BOARD'),
    );
    break;
  }

  return alignedPath;
}

/** 도보 경로를 앞뒤 승차 구간의 승하차 좌표와 연결해 끊김 없는 이동 경로를 만듭니다. 입력 좌표 배열은 변경하지 않습니다. */
export function alignWalkPathToRideEndpoints(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  pathCoords: RoutePathCoord[],
): RoutePathCoord[] {
  const leg = legs?.[legIndex];
  let previousRideCoord: RoutePathCoord | undefined;
  let nextRideCoord: RoutePathCoord | undefined;
  if (Array.isArray(legs)) {
    for (let index = legIndex - 1; index >= 0; index -= 1) {
      if (!isRideLegKind(legs[index]?.kind)) continue;
      previousRideCoord = getTransitLegAlightAnchorOnPath(legs[index]);
      break;
    }
    for (let index = legIndex + 1; index < legs.length; index += 1) {
      if (!isRideLegKind(legs[index]?.kind)) continue;
      nextRideCoord = getTransitLegBoardAnchorOnPath(legs[index]);
      break;
    }
  }
  const displayPath = getStationTransferDisplayPath({
    pathCoords,
    startName: leg?.startName,
    endName: leg?.endName,
    distanceMeters: leg?.distanceMeters,
    previousRideCoord,
    nextRideCoord,
  });
  if (displayPath !== pathCoords) return displayPath;
  return alignWalkSegmentEndpoints(legs, legIndex, displayPath);
}

/** 승하차 정류장의 원본·표시·경로 앵커 중 지도에 노출할 좌표를 선택합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function getRideStopDisplayCoord(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  position: 'BOARD' | 'ALIGHT',
): RoutePathCoord | undefined {
  if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length)
    return undefined;
  const leg = legs[legIndex];

  const stopCoord =
    position === 'BOARD'
      ? getTransitLegBoardCoord(leg)
      : getTransitLegAlightCoord(leg);
  const fallbackCoord =
    position === 'BOARD'
      ? getTransitLegStartCoord(leg)
      : getTransitLegEndCoord(leg);
  const anchor = getTransitLegStopAnchor(leg, position);
  // 보행 안내와 마커는 실제 정류장/역 POI를 따른다. 운행 선형이 20m 안에 있을 때만
  // 선형 위 좌표를 공유해 버스 정류장 마커와 노선선이 자연스럽게 맞닿게 한다.
  const accessCoordinate = toRoutePathCoord(
    resolveTransitStopAccessCoordinate(anchor),
  );
  return accessCoordinate ?? stopCoord ?? fallbackCoord;
}

/** 도보 연결선을 붙일 승하차 기준 좌표를 선택합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function getRideStopConnectorCoord(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  position: 'BOARD' | 'ALIGHT',
): RoutePathCoord | undefined {
  if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length)
    return undefined;
  const leg = legs[legIndex];
  const stopCoord =
    position === 'BOARD'
      ? getTransitLegBoardCoord(leg)
      : getTransitLegAlightCoord(leg);
  const fallbackCoord =
    position === 'BOARD'
      ? getTransitLegStartCoord(leg)
      : getTransitLegEndCoord(leg);
  const visualCoord = getRideStopVisualCoord(legs, legIndex, position);
  return visualCoord ?? stopCoord ?? fallbackCoord;
}

/** 대중교통 전체 경로에서 출발 직후 카메라가 포커스할 첫 유효 좌표를 찾습니다. 입력 좌표 배열은 변경하지 않습니다. */
export function getTransitRouteStartFocusCoord(
  legs: TransitLegDetail[] | undefined,
): RoutePathCoord | undefined {
  if (!Array.isArray(legs) || legs.length === 0) return undefined;

  const firstRideLegIndex = legs.findIndex(leg => isRideLegKind(leg.kind));
  if (firstRideLegIndex < 0) {
    return getWalkLegStartCoord(legs[0]) ?? getWalkLegEndCoord(legs[0]);
  }

  const firstRideLeg = legs[firstRideLegIndex];
  const visualCoord = getRideStopVisualCoord(legs, firstRideLegIndex, 'BOARD');
  const approachStartCoord = getWalkLegStartCoord(legs[firstRideLegIndex - 1]);
  if (visualCoord && approachStartCoord) {
    const approachDistanceMeters = routeCoordDistanceMeters(
      approachStartCoord,
      visualCoord,
    );
    if (
      Number.isFinite(approachDistanceMeters) &&
      approachDistanceMeters <= 900
    ) {
      return interpolateRouteCoord(approachStartCoord, visualCoord, 0.5);
    }
  }
  if (firstRideLeg.kind === 'BUS') {
    return (
      visualCoord ??
      getRideStopConnectorCoord(legs, firstRideLegIndex, 'BOARD') ??
      getRideStopDisplayCoord(legs, firstRideLegIndex, 'BOARD') ??
      getTransitLegBoardCoord(firstRideLeg) ??
      getTransitLegBoardAnchorOnPath(firstRideLeg)
    );
  }

  return (
    visualCoord ??
    getTransitLegBoardCoord(firstRideLeg) ??
    getAdjacentWalkReferenceCoord(legs, firstRideLegIndex, 'BOARD') ??
    getTransitLegBoardAnchorOnPath(firstRideLeg) ??
    getTransitLegStartCoord(firstRideLeg)
  );
}

/** 첫 지하철 승차 구간의 대표 좌표를 찾아 상세 포커스에 사용합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function getTransitRouteFirstSubwayFocusCoord(
  legs: TransitLegDetail[] | undefined,
): RoutePathCoord | undefined {
  if (!Array.isArray(legs) || legs.length === 0) return undefined;
  const firstSubwayLegIndex = legs.findIndex(leg => leg.kind === 'SUBWAY');
  const firstSubwayLeg =
    firstSubwayLegIndex >= 0 ? legs[firstSubwayLegIndex] : undefined;
  if (!firstSubwayLeg) return undefined;

  return (
    getRideStopVisualCoord(legs, firstSubwayLegIndex, 'BOARD') ??
    getTransitLegBoardCoord(firstSubwayLeg) ??
    getTransitLegBoardAnchorOnPath(firstSubwayLeg) ??
    getTransitLegStartCoord(firstSubwayLeg) ??
    getTransitLegMidCoord(firstSubwayLeg)
  );
}

/** 한 좌표와 폴리라인 사이의 최소 거리를 미터 단위로 계산합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function getMinimumDistanceToPathMeters(
  point: RoutePathCoord,
  pathCoords: RoutePathCoord[],
): number {
  if (!Array.isArray(pathCoords) || pathCoords.length === 0)
    return Number.POSITIVE_INFINITY;
  return pathCoords.reduce(
    (minimum, pathPoint) =>
      Math.min(minimum, routeCoordDistanceMeters(point, pathPoint)),
    Number.POSITIVE_INFINITY,
  );
}

/** 도보 접근 경로가 승차점 주변을 지나치게 통과하면 승차점에 가까운 지점에서 꼬리를 자릅니다. 입력 좌표 배열은 변경하지 않습니다. */
export function trimWalkApproachTail(
  rawPath: RoutePathCoord[] | undefined,
  stopCoord: RoutePathCoord | undefined,
  ridePath: RoutePathCoord[],
): RoutePathCoord[] | undefined {
  if (!Array.isArray(rawPath) || rawPath.length < 3 || !stopCoord)
    return rawPath;

  // 보행 API가 버스/지하철 선형 위로 살짝 들어가는 꼬리를 줄 때가 있어
  // 승차 직전/하차 직후의 "도로 중앙으로 파고드는" 마지막 몇 미터만 잘라낸다.
  const stopTrimDistanceMeters = ridePath.length > 0 ? 12 : 8;
  const ridePathTrimDistanceMeters = 5.5;
  let trimIdx = rawPath.length;

  while (trimIdx > 2) {
    const point = rawPath[trimIdx - 1];
    const distanceToStop = routeCoordDistanceMeters(point, stopCoord);
    if (distanceToStop >= stopTrimDistanceMeters) break;

    const distanceToRidePath =
      ridePath.length > 0
        ? getMinimumDistanceToPathMeters(point, ridePath)
        : distanceToStop;
    if (distanceToRidePath >= ridePathTrimDistanceMeters) break;

    trimIdx -= 1;
  }

  if (trimIdx >= rawPath.length) return rawPath;
  return rawPath.slice(0, trimIdx);
}

/** 구간 경로의 중간 지점 또는 시작·종료점의 중점을 대표 좌표로 반환합니다. 입력 좌표 배열은 변경하지 않습니다. */
export function getTransitLegMidCoord(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
    const midpointIndex = Math.floor((leg.pathCoords.length - 1) * 0.5);
    return (
      leg.pathCoords[midpointIndex] ?? leg.pathCoords[leg.pathCoords.length - 1]
    );
  }
  const start = getTransitLegStartCoord(leg);
  const end = getTransitLegEndCoord(leg);
  if (start && end) {
    return {
      lat: (start.lat + end.lat) / 2,
      lng: (start.lng + end.lng) / 2,
    };
  }
  return start ?? end;
}

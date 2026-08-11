/** 대중교통 구간의 승하차·도보 접점 좌표와 노선 색상 계산 모듈입니다. */
import {
  type RoutePathCoord,
  type TransitLegDetail,
} from '../../map/routingService';
import { resolveTransitRouteNodeCoordinate } from '../../map/transitRouteGeometry';
import { type TransitStopMarkerKind } from '../../map/transitStopVisibility';
import { TRANSIT_LEG_COLOR } from './presentation';
import {
  getMapBusRouteColor,
  type NormalizedRoute,
  SELECTED_ROUTE_COLOR,
  type TransitStopAnchor,
} from './routeMapTypesAndStyle';
import {
  routePathCoordsToCoordinates,
  toCoordinate,
  toRoutePathCoord,
} from './routeMapCoordinate';
import { createTransitStopAnchor } from './routeMapAnchors';
import { normalizeDisplayPathCoords } from './routeDisplayPath';
import {
  getTransitLegEndCoord,
  getTransitLegStartCoord,
} from './routeTransitLegEndpoints';
import {
  compactTransitLineLabel,
  getBusLineColor as getSharedBusLineColor,
  getSubwayLineColor as getSharedSubwayLineColor,
} from '../routeInfo';

export {
  getTransitLegEndCoord,
  getTransitLegStartCoord,
} from './routeTransitLegEndpoints';

/** 지하철 노선명을 공용 노선 색상 정책으로 변환합니다. 입력 구간은 변경하지 않습니다. */
export function getSubwayLineColor(lineName?: string): string {
  return getSharedSubwayLineColor(lineName);
}

/** 대중교통 구간의 수단·노선·API 색상을 조합해 카드와 타임라인용 색상을 결정합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegVisualColor(
  leg: Pick<TransitLegDetail, 'kind' | 'lineName' | 'lineColor'> & {
    label?: string;
  },
): string {
  const lineLabel =
    compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
  if (leg.kind === 'SUBWAY') return getSubwayLineColor(lineLabel);
  if (leg.kind === 'BUS')
    return getSharedBusLineColor(lineLabel, leg.lineColor);
  return TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR;
}

/** 대중교통 구간의 정보를 지도 노선 표현 정책에 맞는 색상으로 변환합니다. 입력 구간은 변경하지 않습니다. */
export function getMapTransitLegVisualColor(
  leg: Pick<TransitLegDetail, 'kind' | 'lineName' | 'lineColor'> & {
    label?: string;
  },
): string {
  const lineLabel =
    compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
  if (leg.kind === 'BUS') return getMapBusRouteColor(lineLabel);
  if (leg.kind === 'SUBWAY') return getSubwayLineColor(lineLabel);
  return TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR;
}

/** 이동 수단 종류와 노선 정보를 받아 일관된 경로 선 색상을 반환합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitKindLineColor(
  kind: TransitLegDetail['kind'],
  lineLabel?: string,
  lineColor?: string,
): string {
  if (kind === 'SUBWAY') return getSubwayLineColor(lineLabel);
  if (kind === 'BUS') return getSharedBusLineColor(lineLabel, lineColor);
  return TRANSIT_LEG_COLOR[kind] ?? SELECTED_ROUTE_COLOR;
}

/** 대중교통 구간이 버스 또는 지하철 승차 구간인지 타입 가드로 판별합니다. 입력 구간은 변경하지 않습니다. */
export function isRideLegKind(
  kind: TransitLegDetail['kind'],
): kind is TransitStopMarkerKind {
  return kind === 'SUBWAY' || kind === 'BUS';
}

/** 승차 지점 정보와 구간 시작점에서 지도에 사용할 승차 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegBoardCoord(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  const startCoord = getTransitLegStartCoord(leg);
  return (
    startCoord ??
    (Array.isArray(leg.pathCoords) ? leg.pathCoords[0] : undefined)
  );
}

/** 하차 지점 정보와 구간 종료점에서 지도에 사용할 하차 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegAlightCoord(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  const endCoord = getTransitLegEndCoord(leg);
  return (
    endCoord ??
    (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0
      ? leg.pathCoords[leg.pathCoords.length - 1]
      : undefined)
  );
}

/** 승차 또는 하차 정류장 정보로부터 경로에 스냅된 정류장 앵커를 생성합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegStopAnchor(
  leg: TransitLegDetail,
  position: 'BOARD' | 'ALIGHT',
): TransitStopAnchor | undefined {
  const stopCoord =
    position === 'BOARD'
      ? getTransitLegBoardCoord(leg)
      : getTransitLegAlightCoord(leg);
  const displayPath =
    Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
      ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
      : [];
  const routeCoordinates = routePathCoordsToCoordinates(displayPath);
  return createTransitStopAnchor(
    toCoordinate(stopCoord),
    routeCoordinates,
    position === 'BOARD' ? 'start' : 'end',
  );
}

/** 승차 앵커·구간 시작점·경로 첫 점 순서로 경로 위 승차 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegBoardAnchorOnPath(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  const anchor = getTransitLegStopAnchor(leg, 'BOARD');
  return (
    toRoutePathCoord(anchor?.routeAnchorCoordinate) ??
    getTransitLegStartCoord(leg) ??
    (Array.isArray(leg.pathCoords) ? leg.pathCoords[0] : undefined)
  );
}

/** 하차 앵커·구간 종료점·경로 마지막 점 순서로 경로 위 하차 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegAlightAnchorOnPath(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  const anchor = getTransitLegStopAnchor(leg, 'ALIGHT');
  return (
    toRoutePathCoord(anchor?.routeAnchorCoordinate) ??
    getTransitLegEndCoord(leg) ??
    (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0
      ? leg.pathCoords[leg.pathCoords.length - 1]
      : undefined)
  );
}

/** 도보 구간의 경로 첫 점 또는 시작 앵커 좌표를 반환합니다. 입력 구간은 변경하지 않습니다. */
export function getWalkLegStartCoord(
  leg: TransitLegDetail | undefined,
): RoutePathCoord | undefined {
  if (!leg || leg.kind !== 'WALK') return undefined;
  if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0)
    return leg.pathCoords[0];
  return getTransitLegStartCoord(leg) ?? getTransitLegBoardAnchorOnPath(leg);
}

/** 도보 구간의 경로 마지막 점 또는 종료 앵커 좌표를 반환합니다. 입력 구간은 변경하지 않습니다. */
export function getWalkLegEndCoord(
  leg: TransitLegDetail | undefined,
): RoutePathCoord | undefined {
  if (!leg || leg.kind !== 'WALK') return undefined;
  if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
    return leg.pathCoords[leg.pathCoords.length - 1];
  }
  return getTransitLegEndCoord(leg) ?? getTransitLegAlightAnchorOnPath(leg);
}

/** 승차 구간과 인접한 도보 구간에서 연결 방향을 판단할 기준 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getAdjacentWalkReferenceCoord(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  position: 'BOARD' | 'ALIGHT',
): RoutePathCoord | undefined {
  if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length)
    return undefined;
  if (position === 'BOARD') {
    return getWalkLegEndCoord(legs[legIndex - 1]);
  }
  return getWalkLegStartCoord(legs[legIndex + 1]);
}

/** 승하차 정류장의 경로 스냅 좌표를 지도 마커 위치로 변환합니다. 입력 구간은 변경하지 않습니다. */
export function getRideStopRouteMarkerCoord(
  route: NormalizedRoute | undefined,
  legIndex: number,
  position: 'BOARD' | 'ALIGHT',
): RoutePathCoord | undefined {
  const segment = route?.segments.find(
    candidate => candidate.sequence === legIndex,
  );
  const anchor =
    position === 'BOARD' ? segment?.boardAnchor : segment?.alightAnchor;
  return toRoutePathCoord(resolveTransitRouteNodeCoordinate(anchor));
}

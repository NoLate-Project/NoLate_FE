/** 경로 앵커 생성과 폴리라인 절단·품질 판정을 담당하는 순수 계산 모듈입니다. */
import { TRANSIT_CONNECTOR_POLICY as CONNECTOR_POLICY } from '../../map/transitRouteGeometry';
import {
  type Coordinate,
  type GeometrySource,
  getRenderableStopCoordinate,
  type RouteAnchor,
  type RouteAnchorType,
  type RouteGeometryQuality,
  type RouteMode,
  type RouteSegment,
  type TransitStopAnchor,
  type TransitStopAnchorSource,
} from './routeMapTypesAndStyle';
import {
  distanceMeters,
  getSegmentLengthMeters,
  interpolateCoordinate,
  isValidCoordinate,
  nearestPointOnPolyline,
} from './routeMapCoordinate';

export const TRANSIT_WALK_RIDE_SNAP_MAX_METERS =
  CONNECTOR_POLICY.snapEndpointMeters;

/** 정류장 원본 좌표를 경로에 스냅해 지도 표시 좌표와 스냅 거리·출처를 포함한 앵커를 만듭니다. 입력 객체와 배열은 변경하지 않습니다. */
export function createTransitStopAnchor(
  stopCoordinate: Coordinate | undefined,
  routeCoordinates: Coordinate[] | undefined,
  fallback: 'start' | 'end',
  meta?: {
    id?: string;
    name?: string;
    type?: 'BOARDING' | 'ALIGHTING' | 'BUS_STOP';
    segmentId?: string;
    relatedSegmentIds?: string[];
  },
): TransitStopAnchor | undefined {
  if (!isValidCoordinate(stopCoordinate)) return undefined;
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.filter(isValidCoordinate)
    : [];
  const anchorId =
    meta?.id ??
    `${meta?.segmentId ?? 'transit'}-${
      meta?.type ?? fallback
    }-${stopCoordinate.latitude.toFixed(5)}-${stopCoordinate.longitude.toFixed(
      5,
    )}`;
  const anchorType: RouteAnchorType =
    meta?.type ?? (fallback === 'start' ? 'BOARDING' : 'ALIGHTING');
  const nearest = nearestPointOnPolyline(stopCoordinate, coordinates);
  if (nearest) {
    const anchorSource: TransitStopAnchorSource =
      nearest.distanceMeters <= CONNECTOR_POLICY.maxSchematicAccessLinkMeters
        ? 'NEAREST_ON_ROUTE'
        : 'UNSNAPPED';
    return {
      id: anchorId,
      type: anchorType,
      name: meta?.name,
      rawCoordinate: stopCoordinate,
      renderCoordinate:
        nearest.distanceMeters <= CONNECTOR_POLICY.maxSchematicAccessLinkMeters
          ? nearest.coordinate
          : stopCoordinate,
      source: anchorSource,
      segmentId: meta?.segmentId,
      relatedSegmentIds: meta?.relatedSegmentIds,
      stopCoordinate,
      routeAnchorCoordinate:
        nearest.distanceMeters <= CONNECTOR_POLICY.maxSchematicAccessLinkMeters
          ? nearest.coordinate
          : stopCoordinate,
      snapDistanceMeters: nearest.distanceMeters,
      anchorSource,
    };
  }

  const endpoint =
    fallback === 'start' ? coordinates[0] : coordinates[coordinates.length - 1];
  if (endpoint) {
    const snapDistanceMeters = distanceMeters(stopCoordinate, endpoint);
    return {
      id: anchorId,
      type: anchorType,
      name: meta?.name,
      rawCoordinate: stopCoordinate,
      renderCoordinate: endpoint,
      source: 'ROUTE_ENDPOINT',
      segmentId: meta?.segmentId,
      relatedSegmentIds: meta?.relatedSegmentIds,
      stopCoordinate,
      routeAnchorCoordinate: endpoint,
      snapDistanceMeters,
      anchorSource: 'ROUTE_ENDPOINT',
    };
  }

  return {
    id: anchorId,
    type: anchorType,
    name: meta?.name,
    rawCoordinate: stopCoordinate,
    renderCoordinate: stopCoordinate,
    source: 'UNSNAPPED',
    segmentId: meta?.segmentId,
    relatedSegmentIds: meta?.relatedSegmentIds,
    stopCoordinate,
    routeAnchorCoordinate: stopCoordinate,
    snapDistanceMeters: 0,
    anchorSource: 'UNSNAPPED',
  };
}

/** 도보 구간 끝점을 인접 승차 경로에 맞춰 보정한 경로 앵커를 생성합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function createWalkEndpointAnchor(
  id: string,
  type: 'WALK_START' | 'WALK_END',
  rawCoordinate: Coordinate | undefined,
  renderCoordinate: Coordinate | undefined,
  segmentId?: string,
): RouteAnchor | undefined {
  if (!isValidCoordinate(rawCoordinate) || !isValidCoordinate(renderCoordinate))
    return undefined;
  const snapDistanceMeters = distanceMeters(rawCoordinate, renderCoordinate);
  return {
    id,
    type,
    rawCoordinate,
    renderCoordinate,
    snapDistanceMeters,
    source:
      snapDistanceMeters <= TRANSIT_WALK_RIDE_SNAP_MAX_METERS
        ? 'WALK_ENDPOINT'
        : 'SHORT_CONNECTOR',
    segmentId,
  };
}

/** 앵커가 폴리라인 전체에서 차지하는 누적 거리 위치를 계산합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function getAnchorPathPosition(
  point: Coordinate | undefined,
  polyline: Coordinate[] | undefined,
): { segmentIndex: number; ratio: number; distanceMeters: number } | undefined {
  if (
    !isValidCoordinate(point) ||
    !Array.isArray(polyline) ||
    polyline.length < 2
  )
    return undefined;
  const nearest = nearestPointOnPolyline(point, polyline);
  if (!nearest) return undefined;
  return {
    segmentIndex: nearest.segmentIndex,
    ratio: nearest.ratio,
    distanceMeters: nearest.distanceMeters,
  };
}

/** 두 앵커의 경로 위치 사이만 잘라 이동 순서가 보존된 좌표 목록을 반환합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function slicePolylineBetweenAnchors(
  coordinates: Coordinate[] | undefined,
  startAnchor: TransitStopAnchor | undefined,
  endAnchor: TransitStopAnchor | undefined,
): Coordinate[] {
  const validCoordinates = Array.isArray(coordinates)
    ? coordinates.filter(isValidCoordinate)
    : [];
  if (validCoordinates.length < 2) return validCoordinates;

  const startCoordinate = getRenderableStopCoordinate(startAnchor);
  const endCoordinate = getRenderableStopCoordinate(endAnchor);
  const startPosition = getAnchorPathPosition(
    startCoordinate,
    validCoordinates,
  );
  const endPosition = getAnchorPathPosition(endCoordinate, validCoordinates);
  if (!startPosition || !endPosition) return validCoordinates;

  if (
    startPosition.segmentIndex > endPosition.segmentIndex ||
    (startPosition.segmentIndex === endPosition.segmentIndex &&
      startPosition.ratio > endPosition.ratio)
  ) {
    const reversed = validCoordinates.slice().reverse();
    return slicePolylineBetweenAnchors(reversed, startAnchor, endAnchor);
  }

  const startPoint = startCoordinate ?? validCoordinates[0];
  const endPoint =
    endCoordinate ?? validCoordinates[validCoordinates.length - 1];
  const sliced: Coordinate[] = [startPoint];
  for (
    let index = startPosition.segmentIndex + 1;
    index <= endPosition.segmentIndex;
    index += 1
  ) {
    const point = validCoordinates[index];
    if (point && distanceMeters(sliced[sliced.length - 1], point) > 1) {
      sliced.push(point);
    }
  }
  if (distanceMeters(sliced[sliced.length - 1], endPoint) > 1) {
    sliced.push(endPoint);
  } else {
    sliced[sliced.length - 1] = endPoint;
  }
  return sliced.length >= 2 ? sliced : validCoordinates;
}

/** 세그먼트에 연결된 모든 앵커 중 가장 큰 스냅 거리를 계산합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function getRouteAnchorMaxSnapDistanceMeters(
  anchors: Array<RouteAnchor | undefined>,
): number | undefined {
  const distances = anchors
    .map(anchor => anchor?.snapDistanceMeters)
    .filter(
      (distance): distance is number =>
        typeof distance === 'number' && Number.isFinite(distance),
    );
  if (!distances.length) return undefined;
  return Math.max(...distances);
}

/** 앵커 스냅 거리가 허용 기준을 넘어 경로 형상 불일치로 보아야 하는지 판별합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function hasRouteAnchorGeometryMismatch(
  anchors: Array<RouteAnchor | undefined>,
): boolean {
  return anchors.some(anchor => {
    if (!anchor) return false;
    if (anchor.source === 'UNSNAPPED') return true;
    return (
      typeof anchor.snapDistanceMeters === 'number' &&
      anchor.snapDistanceMeters > 60
    );
  });
}

/** 원본 좌표와 표시 좌표가 의미 있게 달라졌는지 모든 앵커를 검사합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function hasRouteAnchorAdjustment(
  anchors: Array<RouteAnchor | undefined>,
): boolean {
  return anchors.some(anchor => {
    if (!anchor) return false;
    if (
      anchor.source === 'NEAREST_ON_ROUTE' &&
      typeof anchor.snapDistanceMeters === 'number'
    ) {
      return anchor.snapDistanceMeters > 0.5;
    }
    if (anchor.source === 'SHORT_CONNECTOR') return true;
    return (
      typeof anchor.snapDistanceMeters === 'number' &&
      anchor.snapDistanceMeters > 30
    );
  });
}

/** API 형상 출처·점 개수·앵커 보정 상태를 종합해 경로 품질 등급을 결정합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function getRouteGeometryQuality(
  mode: RouteMode,
  geometrySource: GeometrySource | undefined,
  pointCount: number,
  isManualSamplePath: boolean,
  anchors: Array<RouteAnchor | undefined> = [],
  anchorAdjusted = false,
): RouteGeometryQuality {
  if (isManualSamplePath) return 'MANUAL_SAMPLE';
  if (geometrySource === 'START_END_ONLY') return 'START_END_ONLY';
  if (geometrySource === 'PASS_STOP_LIST') return 'PASS_STOP_ONLY';
  if (hasRouteAnchorGeometryMismatch(anchors)) return 'GEOMETRY_MISMATCH';
  if (
    geometrySource === 'TRANSIT_PASS_SHAPE_LINESTRING' ||
    geometrySource === 'WALK_STEPS_LINESTRING' ||
    geometrySource === 'WALK_PASS_SHAPE_LINESTRING' ||
    geometrySource === 'WALK_API_DETAIL'
  ) {
    if (pointCount < (mode === 'WALK' || mode === 'TRANSFER' ? 3 : 10)) {
      return 'COARSE_API_GEOMETRY';
    }
    return anchorAdjusted ||
      hasRouteAnchorAdjustment(anchors) ||
      (getRouteAnchorMaxSnapDistanceMeters(anchors) ?? 0) > 30
      ? 'ANCHOR_ADJUSTED_GEOMETRY'
      : 'HIGH_API_GEOMETRY';
  }
  if (geometrySource === 'ITINERARY_PATH_SNAP') return 'COARSE_API_GEOMETRY';
  return 'UNKNOWN';
}

/** 인접 좌표가 최소 거리보다 가까우면 제거하되 경로의 첫 점과 끝 점은 유지합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function dedupeCoordinatesByDistance(
  coordinates: Coordinate[] | undefined,
  minDistanceMeters: number,
): Coordinate[] {
  const validCoordinates = Array.isArray(coordinates)
    ? coordinates.filter(isValidCoordinate)
    : [];
  if (validCoordinates.length < 2) return validCoordinates;

  const minimum = Math.max(0.5, minDistanceMeters);
  const result: Coordinate[] = [validCoordinates[0]];
  for (let index = 1; index < validCoordinates.length; index += 1) {
    const point = validCoordinates[index];
    const previous = result[result.length - 1];
    const isTail = index === validCoordinates.length - 1;
    if (isTail || distanceMeters(previous, point) >= minimum) {
      result.push(point);
    }
  }
  return result;
}

/** 세그먼트의 표시용 좌표를 복사해 후속 보정이 원본 좌표를 변경하지 않도록 합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function createRenderedCoordinates(segment: RouteSegment): Coordinate[] {
  const minDistanceMeters =
    segment.mode === 'WALK' || segment.mode === 'TRANSFER' ? 2.4 : 1.4;
  // 공급자 선형의 코너를 임의로 잘라내지 않는다. round lineJoin은 SDK가 화면에서 처리한다.
  return dedupeCoordinatesByDistance(segment.coordinates, minDistanceMeters);
}

/** 분리된 세그먼트 좌표 묶음을 깊은 복사해 표시용 좌표 그룹으로 만듭니다. 입력 객체와 배열은 변경하지 않습니다. */
export function createRenderedCoordinateParts(
  segment: RouteSegment,
): Coordinate[][] | undefined {
  if (!segment.coordinateParts?.length) return undefined;
  const minDistanceMeters =
    segment.mode === 'WALK' || segment.mode === 'TRANSFER' ? 2.4 : 1.4;
  const parts = segment.coordinateParts
    .map(part => dedupeCoordinatesByDistance(part, minDistanceMeters))
    .filter(part => part.length >= 2);
  return parts.length > 1 ? parts : undefined;
}

/** 폴리라인의 전체 거리를 기준으로 지정 비율 지점의 보간 좌표를 반환합니다. 입력 객체와 배열은 변경하지 않습니다. */
export function getCoordinateAtPathRatio(
  coordinates: Coordinate[] | undefined,
  ratio: number,
): Coordinate | undefined {
  const validCoordinates = Array.isArray(coordinates)
    ? coordinates.filter(isValidCoordinate)
    : [];
  if (validCoordinates.length === 0) return undefined;
  if (validCoordinates.length === 1) return validCoordinates[0];

  const totalLength = getSegmentLengthMeters(validCoordinates);
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return validCoordinates[
      Math.floor(
        (validCoordinates.length - 1) * Math.max(0, Math.min(1, ratio)),
      )
    ];
  }

  const targetDistance = totalLength * Math.max(0, Math.min(1, ratio));
  let traveled = 0;
  for (let index = 1; index < validCoordinates.length; index += 1) {
    const from = validCoordinates[index - 1];
    const to = validCoordinates[index];
    const segmentLength = distanceMeters(from, to);
    if (!Number.isFinite(segmentLength) || segmentLength <= 0) continue;
    if (traveled + segmentLength >= targetDistance) {
      return interpolateCoordinate(
        from,
        to,
        (targetDistance - traveled) / segmentLength,
      );
    }
    traveled += segmentLength;
  }
  return validCoordinates[validCoordinates.length - 1];
}

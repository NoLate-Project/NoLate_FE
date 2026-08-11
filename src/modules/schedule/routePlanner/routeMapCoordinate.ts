/** 경로 좌표의 검증, 거리 계산, 진행 방향 보정을 담당하는 순수 계산 모듈입니다. */
import { type RoutePathCoord } from '../../map/routingService';
import { haversineDistanceKm } from './presentation';
import {
  type Coordinate,
  FALLBACK_LAT,
  getRenderableStopCoordinate,
  isTransitRideSegmentMode,
  type RouteSegment,
  shouldRenderRouteSegmentGeometry,
  type TransitStopAnchor,
  warnRouteDebug,
} from './routeMapTypesAndStyle';

/** 위도와 줌을 바탕으로 화면 한 픽셀이 나타내는 실제 거리를 미터 단위로 추정합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function estimateMetersPerPixel(latitude: number, zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : 14;
  const safeLatitude = Number.isFinite(latitude) ? latitude : FALLBACK_LAT;
  return (
    (156543.03392 * Math.cos((safeLatitude * Math.PI) / 180)) /
    Math.pow(2, safeZoom)
  );
}

/** 위도·경도가 유한하며 지도 좌표 범위에 들어오는지 검사합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function isValidCoordinate(
  coord: Coordinate | undefined,
): coord is Coordinate {
  return (
    !!coord &&
    Number.isFinite(coord.latitude) &&
    Number.isFinite(coord.longitude)
  );
}

/** 두 지도 좌표 사이의 대권 거리를 미터 단위로 계산합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function distanceMeters(from: Coordinate, to: Coordinate): number {
  return haversineDistanceKm(from, to) * 1000;
}

/** 두 좌표와 0~1 비율을 사용해 선형 보간된 새 좌표를 반환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function interpolateCoordinate(
  from: Coordinate,
  to: Coordinate,
  ratio: number,
): Coordinate {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * clampedRatio,
    longitude: from.longitude + (to.longitude - from.longitude) * clampedRatio,
  };
}

/** 세그먼트 좌표를 순회해 전체 경로 길이를 미터 단위로 합산합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function getSegmentLengthMeters(
  coordinates: Coordinate[] | undefined,
): number {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
  let totalDistance = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    if (!isValidCoordinate(from) || !isValidCoordinate(to)) continue;
    const distance = distanceMeters(from, to);
    totalDistance += Number.isFinite(distance) ? distance : 0;
  }
  return totalDistance;
}

/** 렌더링 보정 좌표가 있으면 우선 사용하고 없으면 원본 좌표를 반환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function getSegmentRenderableCoordinates(
  segment: RouteSegment,
): Coordinate[] {
  if (!shouldRenderRouteSegmentGeometry(segment)) return [];
  return Array.isArray(segment.renderedCoordinates) &&
    segment.renderedCoordinates.length >= 2
    ? segment.renderedCoordinates
    : segment.coordinates;
}

/** 분리된 렌더링 좌표 묶음을 정규화해 지도 오버레이 단위로 반환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function getSegmentRenderableCoordinateParts(
  segment: RouteSegment,
): Coordinate[][] {
  if (!shouldRenderRouteSegmentGeometry(segment)) return [];
  const renderedParts =
    segment.renderedCoordinateParts?.filter(part => part.length >= 2) ?? [];
  if (renderedParts.length > 0) return renderedParts;
  const coordinateParts =
    segment.coordinateParts?.filter(part => part.length >= 2) ?? [];
  if (coordinateParts.length > 0) return coordinateParts;
  const coordinates = getSegmentRenderableCoordinates(segment);
  return coordinates.length >= 2 ? [coordinates] : [];
}

/** 승하차 기준점과 경로 양 끝의 거리를 비교해 정방향·역방향 순서 점수를 계산합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function getTransitPathOrderScores(
  coordinates: Coordinate[] | undefined,
  boardAnchor: TransitStopAnchor | undefined,
  alightAnchor: TransitStopAnchor | undefined,
): { forwardScore: number; reverseScore: number } | undefined {
  const validCoordinates = Array.isArray(coordinates)
    ? coordinates.filter(isValidCoordinate)
    : [];
  const boardCoordinate = getRenderableStopCoordinate(boardAnchor);
  const alightCoordinate = getRenderableStopCoordinate(alightAnchor);
  if (validCoordinates.length < 2 || !boardCoordinate || !alightCoordinate)
    return undefined;
  const first = validCoordinates[0];
  const last = validCoordinates[validCoordinates.length - 1];
  const forwardScore =
    distanceMeters(first, boardCoordinate) +
    distanceMeters(last, alightCoordinate);
  const reverseScore =
    distanceMeters(first, alightCoordinate) +
    distanceMeters(last, boardCoordinate);
  return { forwardScore, reverseScore };
}

/** 승하차 기준점 점수를 비교해 세그먼트 좌표를 뒤집어야 하는지 판별합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function shouldReverseSegmentCoordinatesForAnchors(
  segment: RouteSegment,
): boolean {
  if (!isTransitRideSegmentMode(segment.mode)) return false;
  const scores = getTransitPathOrderScores(
    segment.coordinates,
    segment.boardAnchor,
    segment.alightAnchor,
  );
  if (!scores) return false;
  return scores.reverseScore + 3 < scores.forwardScore;
}

/** 세그먼트 좌표 순서가 승하차 흐름과 일치하는지 검사하고 진단 정보를 반환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function validateSegmentPathOrder(segment: RouteSegment): boolean {
  if (!isTransitRideSegmentMode(segment.mode)) return true;
  const scores = getTransitPathOrderScores(
    getSegmentRenderableCoordinates(segment),
    segment.boardAnchor,
    segment.alightAnchor,
  );
  if (!scores) return true;
  return scores.forwardScore <= scores.reverseScore + 3;
}

/** 승하차 기준점과 반대인 좌표 배열을 뒤집어 이동 순서를 보정합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function ensureTransitSegmentPathOrder(
  segment: RouteSegment,
): RouteSegment {
  if (!shouldReverseSegmentCoordinatesForAnchors(segment)) return segment;
  warnRouteDebug(
    '[route-path-order] reversing segment coordinates by board/alight anchors',
    {
      id: segment.id,
      mode: segment.mode,
      lineName: segment.lineName,
      fromName: segment.fromName,
      toName: segment.toName,
      pointCount: segment.coordinates.length,
    },
  );
  return {
    ...segment,
    coordinates: segment.coordinates.slice().reverse(),
  };
}

/** API 경로 좌표를 화면 지도에서 사용하는 위도·경도 객체로 변환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function toCoordinate(
  coord: RoutePathCoord | undefined,
): Coordinate | undefined {
  if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lng))
    return undefined;
  return { latitude: coord.lat, longitude: coord.lng };
}

/** 화면 지도 좌표를 API 경로 형식의 lat·lng 객체로 변환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function toRoutePathCoord(
  coord: Coordinate | undefined,
): RoutePathCoord | undefined {
  if (
    !coord ||
    !Number.isFinite(coord.latitude) ||
    !Number.isFinite(coord.longitude)
  )
    return undefined;
  return { lat: coord.latitude, lng: coord.longitude };
}

/** API 경로 좌표 목록에서 유효한 값만 골라 화면 지도 좌표 목록으로 변환합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function routePathCoordsToCoordinates(
  pathCoords: RoutePathCoord[] | undefined,
): Coordinate[] {
  return Array.isArray(pathCoords)
    ? pathCoords.map(toCoordinate).filter(isValidCoordinate)
    : [];
}

/** 한 점을 선분에 투영해 가장 가까운 좌표와 선분 내 비율·거리를 계산합니다. 입력 배열과 객체는 변경하지 않습니다. */
export function projectPointToSegment(
  point: Coordinate,
  segStart: Coordinate,
  segEnd: Coordinate,
): { coordinate: Coordinate; ratio: number; distanceMeters: number } {
  const originLatRad = (segStart.latitude * Math.PI) / 180;
  const metersPerLng = Math.max(1, 111_320 * Math.cos(originLatRad));
  const start = { x: 0, y: 0 };
  const end = {
    x: (segEnd.longitude - segStart.longitude) * metersPerLng,
    y: (segEnd.latitude - segStart.latitude) * 111_320,
  };
  const target = {
    x: (point.longitude - segStart.longitude) * metersPerLng,
    y: (point.latitude - segStart.latitude) * 111_320,
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio =
    lengthSquared <= 0
      ? 0
      : Math.max(
          0,
          Math.min(1, (target.x * dx + target.y * dy) / lengthSquared),
        );
  const coordinate = interpolateCoordinate(segStart, segEnd, ratio);
  return {
    coordinate,
    ratio,
    distanceMeters: distanceMeters(point, coordinate),
  };
}

/** 폴리라인 전체에서 기준점과 가장 가까운 투영점과 누적 경로 위치를 찾습니다. 입력 배열과 객체는 변경하지 않습니다. */
export function nearestPointOnPolyline(
  point: Coordinate | undefined,
  polyline: Coordinate[] | undefined,
):
  | {
      coordinate: Coordinate;
      segmentIndex: number;
      ratio: number;
      distanceMeters: number;
    }
  | undefined {
  if (
    !isValidCoordinate(point) ||
    !Array.isArray(polyline) ||
    polyline.length === 0
  )
    return undefined;
  const coordinates = polyline.filter(isValidCoordinate);
  if (coordinates.length === 0) return undefined;
  if (coordinates.length === 1) {
    return {
      coordinate: coordinates[0],
      segmentIndex: 0,
      ratio: 0,
      distanceMeters: distanceMeters(point, coordinates[0]),
    };
  }

  let nearest:
    | {
        coordinate: Coordinate;
        segmentIndex: number;
        ratio: number;
        distanceMeters: number;
      }
    | undefined;
  for (let index = 1; index < coordinates.length; index += 1) {
    const projection = projectPointToSegment(
      point,
      coordinates[index - 1],
      coordinates[index],
    );
    if (!nearest || projection.distanceMeters < nearest.distanceMeters) {
      nearest = {
        coordinate: projection.coordinate,
        segmentIndex: index - 1,
        ratio: projection.ratio,
        distanceMeters: projection.distanceMeters,
      };
    }
  }
  return nearest;
}

/**
 * 위·동쪽 이동 거리를 미터 단위로 받아 위경도 좌표를 평행 이동합니다.
 * 입력 좌표는 변경하지 않으며 현재 위도의 경도 길이를 반영한 새 좌표를 반환합니다.
 */
export function offsetCoordByMeters(
  coord: RoutePathCoord,
  northMeters: number,
  eastMeters: number,
): RoutePathCoord {
  const latMetersPerDeg = 111_320;
  const lngMetersPerDeg = Math.max(
    1,
    111_320 * Math.cos((coord.lat * Math.PI) / 180),
  );
  return {
    lat: coord.lat + northMeters / latMetersPerDeg,
    lng: coord.lng + eastMeters / lngMetersPerDeg,
  };
}

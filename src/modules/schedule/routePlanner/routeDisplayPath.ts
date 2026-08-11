/** API 경로 좌표를 지도 오버레이에 적합한 밀도와 형식으로 정규화하는 순수 계산 모듈입니다. */
import {
  type RoutePathCoord,
  type TransitLegDetail,
} from '../../map/routingService';
import { type TmapLatLng } from '../../map/TmapMapView';
import { haversineDistanceKm } from './presentation';
import {
  getTransitLegEndCoord,
  getTransitLegStartCoord,
} from './routeTransitLegEndpoints';

export /** 두 API 경로 좌표 사이의 거리를 미터 단위로 계산합니다. 입력 좌표 배열은 변경하지 않습니다. */
function routeCoordDistanceMeters(
  from: RoutePathCoord,
  to: RoutePathCoord,
): number {
  return (
    haversineDistanceKm(
      { latitude: from.lat, longitude: from.lng },
      { latitude: to.lat, longitude: to.lng },
    ) * 1000
  );
}

export /** 두 API 경로 좌표 사이를 지정 비율로 보간한 새 좌표를 반환합니다. 입력 좌표 배열은 변경하지 않습니다. */
function interpolateRouteCoord(
  from: RoutePathCoord,
  to: RoutePathCoord,
  ratio: number,
): RoutePathCoord {
  const clamped = Math.max(0, Math.min(1, ratio));
  return {
    lat: from.lat + (to.lat - from.lat) * clamped,
    lng: from.lng + (to.lng - from.lng) * clamped,
  };
}

export /** 서로 지나치게 가까운 좌표를 제거해 지도 오버레이의 불필요한 점을 줄입니다. 입력 좌표 배열은 변경하지 않습니다. */
function filterDensePathCoords(
  pathCoords: RoutePathCoord[] | undefined,
  minSegmentMeters: number,
): RoutePathCoord[] {
  if (!Array.isArray(pathCoords) || pathCoords.length < 2) return [];
  const minimum = Math.max(0.5, minSegmentMeters);
  const filtered: RoutePathCoord[] = [pathCoords[0]];
  for (let index = 1; index < pathCoords.length; index += 1) {
    const point = pathCoords[index];
    const prev = filtered[filtered.length - 1];
    const isTail = index === pathCoords.length - 1;
    if (isTail || routeCoordDistanceMeters(prev, point) >= minimum) {
      filtered.push(point);
    }
  }
  return filtered;
}

export /** 도보 경로의 과도하게 조밀한 점을 정리해 안정적인 표시 좌표를 만듭니다. 입력 좌표 배열은 변경하지 않습니다. */
function smoothWalkPathForDisplay(
  pathCoords: RoutePathCoord[] | undefined,
): RoutePathCoord[] {
  return filterDensePathCoords(pathCoords, 2.8);
}

export /** 구간 종류에 맞춰 원본 경로를 표시용 좌표로 정규화하고 유효하지 않은 점을 제거합니다. 입력 좌표 배열은 변경하지 않습니다. */
function normalizeDisplayPathCoords(
  pathCoords: RoutePathCoord[] | undefined,
  kind?: TransitLegDetail['kind'],
): RoutePathCoord[] {
  return kind === 'WALK'
    ? smoothWalkPathForDisplay(pathCoords)
    : filterDensePathCoords(pathCoords, 1.6);
}

export /** API 경로 좌표를 지도 오버레이가 사용하는 위도·경도 배열로 변환합니다. 입력 좌표 배열은 변경하지 않습니다. */
function toDisplayOverlayCoords(
  pathCoords: RoutePathCoord[] | undefined,
  kind?: TransitLegDetail['kind'],
): TmapLatLng[] {
  const normalized = normalizeDisplayPathCoords(pathCoords, kind);
  if (!normalized.length) return [];
  return normalized.map(point => ({
    latitude: point.lat,
    longitude: point.lng,
  }));
}

export /** 시작·종료 좌표만 있는 경우 두 점으로 구성된 최소 경로를 생성합니다. 입력 좌표 배열은 변경하지 않습니다. */
function buildEndpointPathCoords(leg: TransitLegDetail): RoutePathCoord[] {
  const start = getTransitLegStartCoord(leg);
  const end = getTransitLegEndCoord(leg);
  if (start && end) return [start, end];
  if (start) return [start];
  if (end) return [end];
  return [];
}

/** 대중교통 구간의 시작·종료 좌표 선택 규칙을 제공하는 순수 계산 모듈입니다. */
import {
  type RoutePathCoord,
  type TransitLegDetail,
} from '../../map/routingService';

/** 구간 시작점·경로 첫 점 순서로 유효한 시작 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegStartCoord(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  if (
    typeof leg.startCoord?.lat === 'number' &&
    typeof leg.startCoord?.lng === 'number'
  ) {
    return leg.startCoord;
  }
  if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
    return leg.pathCoords[0];
  }
  return undefined;
}

/** 구간 종료점·경로 마지막 점 순서로 유효한 종료 좌표를 선택합니다. 입력 구간은 변경하지 않습니다. */
export function getTransitLegEndCoord(
  leg: TransitLegDetail,
): RoutePathCoord | undefined {
  if (
    typeof leg.endCoord?.lat === 'number' &&
    typeof leg.endCoord?.lng === 'number'
  ) {
    return leg.endCoord;
  }
  if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
    return leg.pathCoords[leg.pathCoords.length - 1];
  }
  return undefined;
}

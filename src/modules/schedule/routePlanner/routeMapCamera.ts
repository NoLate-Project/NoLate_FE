/** 경로 계획 화면의 카메라 bounds·포커스·QA 프리셋 계산 모듈입니다. */
import { type TransitLegDetail } from '../../map/routingService';
import { resolveTransitStopAccessCoordinate } from '../../map/transitRouteGeometry';
import { type QaCameraPresetId } from './params';
import {
  type Coordinate,
  isTransitRideSegmentMode,
  type NormalizedRoute,
  type RouteSegment,
} from './routeMapTypesAndStyle';
import {
  distanceMeters,
  isValidCoordinate,
  offsetCoordByMeters,
} from './routeMapCoordinate';
import { getCoordinateAtPathRatio } from './routeMapAnchors';

/** QA 카메라가 재현할 중심·범위·줌과 자동 맞춤 제어 정보를 담습니다. */
export type QaCameraPreset = {
  id: QaCameraPresetId;
  center: Coordinate;
  boundsCoordinates?: Coordinate[];
  zoom: number;
  description: string;
  disableAutoFit: boolean;
};

/** QA 프리셋 식별자와 이동 수단에 맞는 대표 세그먼트를 선택합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function findRouteSegmentForQaPreset(
  route: NormalizedRoute | undefined,
  presetId: QaCameraPresetId,
): RouteSegment | undefined {
  if (!route?.segments?.length) return undefined;
  if (presetId.startsWith('subway')) {
    return route.segments.find(segment => segment.mode === 'SUBWAY');
  }
  if (presetId.startsWith('bus')) {
    return route.segments.find(segment => segment.mode === 'BUS');
  }
  if (presetId === 'walkTransferZoom17' || presetId === 'walkTransferZoom18') {
    return (
      route.segments.find(segment => segment.mode === 'TRANSFER') ??
      route.segments.find(segment => segment.mode === 'WALK')
    );
  }
  return route.segments[0];
}

/** QA 프리셋 이름에 포함된 줌 단계를 숫자로 해석하고 허용 범위로 제한합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getQaPresetZoom(
  presetId: QaCameraPresetId,
  fallbackZoom?: number,
): number {
  if (presetId.endsWith('Zoom12')) return 12;
  if (presetId.endsWith('Zoom15')) return 15;
  if (presetId.endsWith('Zoom17')) return 17;
  if (presetId.endsWith('Zoom18')) return 18;
  return fallbackZoom ?? 12;
}

/** 세그먼트 통과 정류장 중 카메라 중심으로 사용할 대표 좌표를 선택합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getQaPassStopCenter(
  legs: TransitLegDetail[] | undefined,
  kind: 'BUS' | 'SUBWAY',
): Coordinate | undefined {
  const leg = legs?.find(candidate => candidate.kind === kind);
  const intermediateStops =
    leg?.passStops
      ?.slice(1, -1)
      .filter(
        stop =>
          !!stop.coord &&
          Number.isFinite(stop.coord.lat) &&
          Number.isFinite(stop.coord.lng),
      ) ?? [];
  const stop = intermediateStops[Math.floor(intermediateStops.length / 2)];
  return stop?.coord
    ? { latitude: stop.coord.lat, longitude: stop.coord.lng }
    : undefined;
}

/** 경로·세그먼트·프리셋 식별자를 조합해 재현 가능한 카메라 중심·범위·줌을 구성합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function buildQaCameraPreset(
  presetId: QaCameraPresetId | undefined,
  route: NormalizedRoute | undefined,
  fallbackZoom?: number,
  endpoints?: {
    origin?: Coordinate;
    destination?: Coordinate;
    transitLegs?: TransitLegDetail[];
  },
): QaCameraPreset | undefined {
  if (!presetId) return undefined;
  if (presetId === 'routeOverview') {
    const overviewCoordinates =
      route?.segments.flatMap(segment =>
        segment.renderedCoordinates?.length
          ? segment.renderedCoordinates
          : segment.coordinates,
      ) ?? [];
    const center = getCoordinateAtPathRatio(overviewCoordinates, 0.5);
    if (!center) return undefined;
    return {
      id: presetId,
      center,
      boundsCoordinates: overviewCoordinates,
      zoom: fallbackZoom ?? 11.4,
      description: 'route overview',
      disableAutoFit: true,
    };
  }
  if (
    presetId === 'routeStart' ||
    presetId === 'firstBoard' ||
    presetId === 'routeEnd'
  ) {
    const orderedSegments = route?.segments ?? [];
    const firstSegmentCoordinates = orderedSegments[0]?.renderedCoordinates
      ?.length
      ? orderedSegments[0].renderedCoordinates
      : orderedSegments[0]?.coordinates;
    const lastSegment = orderedSegments[orderedSegments.length - 1];
    const lastSegmentCoordinates = lastSegment?.renderedCoordinates?.length
      ? lastSegment.renderedCoordinates
      : lastSegment?.coordinates;
    const firstRideSegment = orderedSegments.find(segment =>
      isTransitRideSegmentMode(segment.mode),
    );
    const firstBoardAccessCoordinate = resolveTransitStopAccessCoordinate(
      firstRideSegment?.boardAnchor,
    );
    const center =
      presetId === 'routeStart'
        ? endpoints?.origin ?? firstSegmentCoordinates?.[0]
        : presetId === 'routeEnd'
        ? endpoints?.destination ??
          lastSegmentCoordinates?.[lastSegmentCoordinates.length - 1]
        : firstBoardAccessCoordinate;
    if (!center) return undefined;
    return {
      id: presetId,
      center,
      zoom: fallbackZoom ?? 17,
      description:
        presetId === 'routeStart'
          ? 'route start'
          : presetId === 'routeEnd'
          ? 'route end'
          : 'first boarding access point',
      disableAutoFit: true,
    };
  }
  const segment = findRouteSegmentForQaPreset(route, presetId);
  const coordinates = segment?.renderedCoordinates?.length
    ? segment.renderedCoordinates
    : segment?.coordinates;
  const isDetailZoomPreset =
    presetId.endsWith('Zoom17') || presetId.endsWith('Zoom18');
  const isStopDensityPreset =
    presetId === 'busStopsZoom18' || presetId === 'subwayStopsZoom18';
  const isTransferPreset = presetId.startsWith('walkTransfer');
  const transferCenter = isTransferPreset
    ? getCoordinateAtPathRatio(coordinates, 0.5)
    : undefined;
  const passStopCenter =
    presetId === 'busStopsZoom18'
      ? getQaPassStopCenter(endpoints?.transitLegs, 'BUS')
      : presetId === 'subwayStopsZoom18'
      ? getQaPassStopCenter(endpoints?.transitLegs, 'SUBWAY')
      : undefined;
  const midpointCenter = isStopDensityPreset
    ? passStopCenter ?? getCoordinateAtPathRatio(coordinates, 0.45)
    : undefined;
  const anchorCenter =
    transferCenter ??
    midpointCenter ??
    segment?.boardAnchor?.routeAnchorCoordinate ??
    segment?.startAnchor?.renderCoordinate ??
    (Array.isArray(coordinates) ? coordinates[0] : undefined);
  const center =
    isDetailZoomPreset && anchorCenter
      ? anchorCenter
      : getCoordinateAtPathRatio(coordinates, 0.45);
  if (!center) return undefined;
  const segmentFocusCoordinates = segment
    ? getSegmentFocusBounds(segment)
    : coordinates;
  const boundsCoordinates = isDetailZoomPreset
    ? getLocalFocusCoordinates(segmentFocusCoordinates, center, 540)
    : segmentFocusCoordinates;
  return {
    id: presetId,
    center,
    boundsCoordinates,
    zoom: getQaPresetZoom(presetId, fallbackZoom),
    description: `${presetId} ${segment?.mode ?? 'UNKNOWN'} ${
      segment?.lineName ?? ''
    }`.trim(),
    disableAutoFit: true,
  };
}

/** 세그먼트에 연결된 시작·종료·승하차 앵커를 중복 없이 수집합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getRouteAnchorsForSegment(
  segment: RouteSegment | undefined,
): Coordinate[] {
  if (!segment) return [];
  return [
    segment.startAnchor?.renderCoordinate,
    segment.endAnchor?.renderCoordinate,
    segment.boardAnchor?.routeAnchorCoordinate,
    segment.alightAnchor?.routeAnchorCoordinate,
  ].filter(isValidCoordinate);
}

/** 세그먼트의 표시 좌표와 앵커를 합쳐 포커스 카메라가 포함할 좌표 범위를 만듭니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getSegmentFocusBounds(
  segment: RouteSegment | undefined,
): Coordinate[] {
  if (!segment) return [];
  const renderedCoordinates = segment.renderedCoordinates?.length
    ? segment.renderedCoordinates
    : segment.coordinates;
  return [
    ...(Array.isArray(renderedCoordinates) ? renderedCoordinates : []),
    ...getRouteAnchorsForSegment(segment),
  ].filter(isValidCoordinate);
}

/** 선택 지점 주변의 일정 거리 구간만 골라 상세 포커스용 좌표를 반환합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getLocalFocusCoordinates(
  coordinates: Coordinate[] | undefined,
  center: Coordinate,
  radiusMeters: number,
): Coordinate[] {
  const validCoordinates = Array.isArray(coordinates)
    ? coordinates.filter(isValidCoordinate)
    : [];
  const local = validCoordinates.filter(
    coord => distanceMeters(center, coord) <= radiusMeters,
  );
  if (local.length >= 2) return [center, ...local];
  const nearest = validCoordinates
    .map(coord => ({ coord, distance: distanceMeters(center, coord) }))
    .filter(item => Number.isFinite(item.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 4)
    .map(item => item.coord);
  return [center, ...nearest].filter(isValidCoordinate);
}

/** 좌표 목록의 최소·최대 위도와 경도를 계산해 지도 bounds를 반환합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getCoordinateBounds(coordinates: Coordinate[] | undefined):
  | {
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
      center: Coordinate;
    }
  | undefined {
  const validCoordinates = Array.isArray(coordinates)
    ? coordinates.filter(isValidCoordinate)
    : [];
  if (validCoordinates.length === 0) return undefined;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  validCoordinates.forEach(coord => {
    minLat = Math.min(minLat, coord.latitude);
    maxLat = Math.max(maxLat, coord.latitude);
    minLng = Math.min(minLng, coord.longitude);
    maxLng = Math.max(maxLng, coord.longitude);
  });
  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
    center: {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
    },
  };
}

/** 지도 bounds와 상하 UI 가림 영역을 반영해 카메라가 경로를 모두 포함하도록 이동합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function fitCameraToBoundsWithUiPadding(
  coordinates: Coordinate[] | undefined,
  padding: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
):
  | {
      latitude: number;
      longitude: number;
      latitudeDelta: number;
      longitudeDelta: number;
      pivot: { x: number; y: number };
    }
  | undefined {
  const bounds = getCoordinateBounds(coordinates);
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return undefined;
  const usableWidth = Math.max(
    160,
    viewport.width - padding.left - padding.right,
  );
  const usableHeight = Math.max(
    160,
    viewport.height - padding.top - padding.bottom,
  );
  const centerLat = bounds.center.latitude;
  const lngMetersPerDegree = Math.max(
    1,
    111_320 * Math.cos((centerLat * Math.PI) / 180),
  );
  const minSpanMeters = 180;
  const rawLatDelta = Math.max(
    bounds.maxLat - bounds.minLat,
    minSpanMeters / 111_320,
  );
  const rawLngDelta = Math.max(
    bounds.maxLng - bounds.minLng,
    minSpanMeters / lngMetersPerDegree,
  );
  const latitudeDelta =
    rawLatDelta * 1.18 * Math.max(1, viewport.height / usableHeight);
  const longitudeDelta =
    rawLngDelta * 1.18 * Math.max(1, viewport.width / usableWidth);
  const pivot = {
    x: Math.max(
      0.18,
      Math.min(0.82, (padding.left + usableWidth / 2) / viewport.width),
    ),
    y: Math.max(
      0.18,
      Math.min(0.82, (padding.top + usableHeight / 2) / viewport.height),
    ),
  };
  return {
    latitude: bounds.minLat - (latitudeDelta - rawLatDelta) / 2,
    longitude: bounds.minLng - (longitudeDelta - rawLngDelta) / 2,
    latitudeDelta,
    longitudeDelta,
    pivot,
  };
}

/** 위도·경도 범위 크기에서 TMAP에 적용할 근사 줌 레벨을 계산합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function inferTmapZoomByRegionDelta(
  latitudeDelta: number,
  longitudeDelta: number,
): number {
  const maxDelta = Math.max(latitudeDelta || 0, longitudeDelta || 0);
  if (maxDelta > 2.2) return 8;
  if (maxDelta > 1.1) return 9;
  if (maxDelta > 0.65) return 10;
  if (maxDelta > 0.35) return 11;
  if (maxDelta > 0.18) return 12;
  if (maxDelta > 0.09) return 13;
  if (maxDelta > 0.045) return 14;
  if (maxDelta > 0.022) return 15;
  return 16;
}

/** 좌표 범위와 화면 여백을 반영해 TMAP 카메라 중심과 줌 목표를 계산합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getTmapRegionCameraTarget(region: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
  pivot?: { x: number; y: number };
  zoomOffset?: number;
}): { center: Coordinate; zoom: number } {
  const pivotX = Math.max(0, Math.min(1, region.pivot?.x ?? 0.5));
  const pivotY = Math.max(0, Math.min(1, region.pivot?.y ?? 0.5));
  const regionCenterLatitude = region.latitude + region.latitudeDelta / 2;
  const regionCenterLongitude = region.longitude + region.longitudeDelta / 2;
  return {
    center: {
      latitude: regionCenterLatitude - (0.5 - pivotY) * region.latitudeDelta,
      longitude: regionCenterLongitude - (pivotX - 0.5) * region.longitudeDelta,
    },
    zoom: Math.max(
      6,
      Math.min(
        18,
        inferTmapZoomByRegionDelta(
          region.latitudeDelta,
          region.longitudeDelta,
        ) + (region.zoomOffset ?? 0),
      ),
    ),
  };
}

/** 고정 줌에서 UI 여백만큼 지도 중심을 이동한 새 카메라 좌표를 반환합니다. 입력 경로와 좌표는 변경하지 않습니다. */
export function getPaddedCameraCenterForFixedZoom(
  coordinates: Coordinate[] | undefined,
  padding: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  zoom: number,
): Coordinate | undefined {
  const bounds = getCoordinateBounds(coordinates);
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return undefined;
  const center = bounds.center;
  const usableCenterX =
    padding.left + (viewport.width - padding.left - padding.right) / 2;
  const usableCenterY =
    padding.top + (viewport.height - padding.top - padding.bottom) / 2;
  const dxPixels = viewport.width / 2 - usableCenterX;
  const dyPixels = viewport.height / 2 - usableCenterY;
  const metersPerPixel =
    (156_543.03392 * Math.cos((center.latitude * Math.PI) / 180)) /
    2 ** Math.max(6, Math.min(18, zoom));
  const shifted = offsetCoordByMeters(
    { lat: center.latitude, lng: center.longitude },
    dyPixels * metersPerPixel,
    -dxPixels * metersPerPixel,
  );
  return { latitude: shifted.lat, longitude: shifted.lng };
}

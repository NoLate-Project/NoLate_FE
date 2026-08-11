/**
 * 경로 계획 지도의 공통 타입과 줌 기반 선 표현 정책입니다.
 * 이 모듈의 계산 함수는 입력 객체를 변경하지 않으며 화면 상태와 독립적으로 재사용할 수 있습니다.
 */
import { type TransitGeometrySource } from '../../map/routingService';
import { TRANSIT_CONNECTOR_POLICY as CONNECTOR_POLICY } from '../../map/transitRouteGeometry';
import {
  getZoomStyleValue,
  type ZoomStyleStops,
} from '../../map/routeZoomStyle';
import {
  getFallbackRouteStrokePresentation,
  getTransitNativeDirectionOpacity,
  getTransitRouteLinePresentation,
  TRANSIT_ROUTE_ZOOM_STYLE,
  TRANSIT_WALK_DASH_PATTERN,
} from '../../map/transitRoutePresentation';
import {
  shouldRenderNormalizedTransitDirection,
  type NormalizedTransitSegmentMode,
} from '../../map/transitRouteSegmentPolicy';
import { TRANSIT_LEG_COLOR } from './presentation';
import {
  getBusBadgeType,
  getSubwayLineColor as getSharedSubwayLineColor,
} from '../routeInfo';

/** 지하철 노선명을 공용 노선 색상 정책으로 변환합니다. */
function getSubwayLineColor(lineName?: string): string {
  return getSharedSubwayLineColor(lineName);
}

export const FALLBACK_LAT = 37.5665;

export const SELECTED_ROUTE_COLOR = '#2979FF';

export const MAP_GUIDE_ROUTE_BLUE = '#1DA7F2';

/** 개발 빌드에서만 경로 계산 진단 정보를 출력하며 운영 빌드에서는 아무 부작용도 만들지 않습니다. */
export function warnRouteDebug(...args: unknown[]) {
  if (typeof __DEV__ === 'boolean' && __DEV__) {
    console.warn(...args);
  }
}

export const MAP_BUS_ROUTE_COLORS = {
  trunk: '#1DA7F2',
  branch: '#28C76F',
  metro: '#FF4D57',
  circular: '#FF9F1C',
  village: '#2CCDB7',
  airport: '#8B5CF6',
} as const;

export const ENABLE_NATIVE_ROUTE_DIRECTION = true;

export const ROUTE_LINE_STYLE = {
  walk: {
    color: '#1A73E8',
    width: TRANSIT_ROUTE_ZOOM_STYLE.walkWidth,
    opacity: 0.94,
    dashPattern: [...TRANSIT_WALK_DASH_PATTERN],
    casing: true,
    arrows: false,
    zIndex: 30,
  },
  transfer: {
    color: '#1A73E8',
    width: TRANSIT_ROUTE_ZOOM_STYLE.walkWidth,
    opacity: 0.92,
    dashPattern: [...TRANSIT_WALK_DASH_PATTERN],
    casing: true,
    arrows: false,
    zIndex: 32,
  },
  transit: {
    mainWidth: TRANSIT_ROUTE_ZOOM_STYLE.rideWidth,
    opacity: 1,
    casingColor: '#FFFFFF',
    casingOpacity: 0.92,
    arrows: true,
    busZIndex: 40,
    subwayZIndex: 42,
  },
  drive: {
    color: SELECTED_ROUTE_COLOR,
    mainWidth: {
      zoom12: 5.8,
      zoom15: 6.2,
      zoom17: 6.6,
      zoom18: 6.8,
    },
    casingExtraWidth: {
      zoom12: 2.2,
      zoom15: 2.4,
      zoom17: 2.6,
      zoom18: 2.6,
    },
    opacity: 1,
    casingColor: 'rgba(255,255,255,0.96)',
    casingOpacity: 0.94,
    arrows: true,
    zIndex: 38,
  },
  bike: {
    color: '#00897B',
    mainWidth: {
      zoom12: 4.4,
      zoom15: 4.8,
      zoom17: 5.1,
      zoom18: 5.2,
    },
    casingExtraWidth: {
      zoom12: 1.9,
      zoom15: 2.1,
      zoom17: 2.3,
      zoom18: 2.3,
    },
    opacity: 0.98,
    casingColor: 'rgba(255,255,255,0.96)',
    casingOpacity: 0.94,
    arrows: true,
    zIndex: 36,
  },
  arrows: {
    color: '#FFFFFF',
  },
  markerZIndex: {
    routeBadge: 55,
    transitStop: 60,
    endpoint: 70,
    currentLocation: 80,
  },
} as const;

export const ROUTE_WALK_GUIDE_COLOR = ROUTE_LINE_STYLE.walk.color;

export const ROUTE_TRANSFER_GUIDE_COLOR = ROUTE_LINE_STYLE.transfer.color;

export const ROUTE_WALK_GUIDE_OPACITY = ROUTE_LINE_STYLE.walk.opacity;

export const ROUTE_WALK_CASING_COLOR = '#FFFFFF';

export const ROUTE_WALK_CASING_OPACITY = 0.9;

export const ROUTE_STYLE = {
  // 지도 라인 기본 두께/외곽선 설정.
  inactiveWidth: 5,
  inactiveOutlineWidth: 1.6,
  selectedWidth: 9.8,
  selectedOutlineWidth: 2.5,
  transitRideWidth: 5.55,
  transitRideOutlineWidth: 0.7,
  // 도보 보조선은 ride보다 얇게 유지하되, 지도 위에서 사라지지 않을 정도로 확보한다.
  transitWalkWidth: 1.35,
  transitWalkOutlineWidth: 0,
  connectorWalkWidth: 1.25,
} as const;

export type RouteStrokeStyle = {
  mainWidth: number;
  casingWidth: number;
  outlineWidth: number;
};

export type RouteMode = NormalizedTransitSegmentMode;

export type GeometrySource =
  | TransitGeometrySource
  | 'START_END_ONLY'
  | 'WALK_API_DETAIL';

export type TransitStopAnchorSource =
  | 'NEAREST_ON_ROUTE'
  | 'ROUTE_ENDPOINT'
  | 'UNSNAPPED';

export type RouteGeometryQuality =
  | 'HIGH_API_GEOMETRY'
  | 'ANCHOR_ADJUSTED_GEOMETRY'
  | 'COARSE_API_GEOMETRY'
  | 'PASS_STOP_ONLY'
  | 'MANUAL_SAMPLE'
  | 'START_END_ONLY'
  | 'GEOMETRY_MISMATCH'
  | 'UNKNOWN';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type RouteAnchorType =
  | 'ORIGIN'
  | 'DESTINATION'
  | 'BOARDING'
  | 'ALIGHTING'
  | 'TRANSFER'
  | 'WALK_START'
  | 'WALK_END'
  | 'STATION_EXIT'
  | 'BUS_STOP';

export type RouteAnchorSource =
  | 'RAW_API'
  | 'NEAREST_ON_ROUTE'
  | 'WALK_ENDPOINT'
  | 'TRANSIT_ENDPOINT'
  | 'STATION_EXIT'
  | 'SHORT_CONNECTOR'
  | 'ROUTE_ENDPOINT'
  | 'UNSNAPPED';

export type RouteAnchor = {
  id: string;
  type: RouteAnchorType;
  name?: string;
  rawCoordinate: Coordinate;
  renderCoordinate: Coordinate;
  snapDistanceMeters?: number;
  source: RouteAnchorSource;
  accessPoint?: AccessPoint;
  segmentId?: string;
  relatedSegmentIds?: string[];
};

export type AccessPoint = {
  id: string;
  type:
    | 'SUBWAY_EXIT'
    | 'BUS_STOP'
    | 'STATION_ENTRANCE'
    | 'PLATFORM'
    | 'UNKNOWN';
  name?: string;
  stationName?: string;
  exitNumber?: string;
  coordinate: Coordinate;
  source: 'TMAP_STEP' | 'POI_SEARCH' | 'STATIC_CACHE' | 'INFERRED';
};

export type TransitStopAnchor = RouteAnchor & {
  stopCoordinate: Coordinate;
  routeAnchorCoordinate: Coordinate;
  anchorSource: TransitStopAnchorSource;
};

export type RouteSegment = {
  id: string;
  mode: RouteMode;
  rawCoordinates?: Coordinate[];
  coordinates: Coordinate[];
  coordinateParts?: Coordinate[][];
  distance?: number;
  duration?: number;
  lineName?: string;
  lineColor?: string;
  routeColor?: string;
  displayColor?: string;
  busType?: string;
  fromName?: string;
  toName?: string;
  geometrySource?: GeometrySource;
  geometryQuality?: RouteGeometryQuality;
  isManualSamplePath?: boolean;
  nativeDirectionEnabled?: boolean;
  startAnchor?: RouteAnchor;
  endAnchor?: RouteAnchor;
  boardAnchor?: TransitStopAnchor;
  alightAnchor?: TransitStopAnchor;
  rawPointCount?: number;
  renderPointCount?: number;
  renderedCoordinates?: Coordinate[];
  renderedCoordinateParts?: Coordinate[][];
  sequence: number;
};

export type NormalizedRoute = {
  id: string;
  totalDuration?: number;
  totalDistance?: number;
  fare?: number;
  segments: RouteSegment[];
};

export type RouteSegmentStyle = {
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  dashPattern?: number[];
  outlineColor?: string;
  outlineWidth?: number;
  outlineOpacity?: number;
  zIndex: number;
};

export type TransitMapZoomTier = 'overview' | 'mid' | 'detail';

/** 현재 지도 줌을 개요·중간·상세 단계로 분류해 경로 선과 마커의 표현 정책에 사용합니다. */
export function getTransitMapZoomTier(mapZoom: number): TransitMapZoomTier {
  if (mapZoom >= 15.5) return 'detail';
  if (mapZoom >= 13.2) return 'mid';
  return 'overview';
}

/** 지도 줌에 맞는 기본 경로 본선·외곽선 두께를 공용 표현 정책에서 조회합니다. */
export function getRouteStrokeStyleForZoom(mapZoom: number): RouteStrokeStyle {
  return getFallbackRouteStrokePresentation(mapZoom);
}

/** 테마 명암에 맞춰 경로 외곽선이 지도 위에서 분리되어 보이는 색상을 반환합니다. */
export function getMapRouteCasingColor(isDark: boolean): string {
  return isDark ? '#F8FBFF' : '#EAF6FF';
}

/** 기본 선 두께를 저배율에서는 줄이고 고배율에서는 늘리되 허용 범위 안으로 제한합니다. */
export function getZoomAdjustedWidth(baseWidth: number, zoom: number): number {
  if (zoom <= 13) return Math.max(baseWidth - 1, 2);
  if (zoom >= 17) return Math.min(baseWidth + 1, 7);
  return baseWidth;
}

/** API가 전달한 6자리 HEX 또는 rgb 계열 색상을 지도에서 사용할 수 있는 문자열로 정규화합니다. */
export function normalizeRouteColor(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  if (/^rgba?\(/i.test(raw)) return raw;
  return undefined;
}

export type ZoomRouteValue = ZoomStyleStops;

/** 줌 단계별 값 정의에서 현재 줌에 해당하는 수치를 선택합니다. */
export function getRouteValueForZoom(
  values: ZoomRouteValue,
  zoom: number,
): number {
  return getZoomStyleValue(values, zoom);
}

/** 대중교통 본선의 현재 줌 두께를 계산합니다. */
export function getTransitMainWidth(zoom: number): number {
  return getTransitRouteLinePresentation(zoom).rideWidth;
}

/** 대중교통 외곽선이 본선보다 추가로 확보할 두께를 현재 줌에 맞춰 계산합니다. */
export function getTransitCasingExtraWidth(zoom: number): number {
  const line = getTransitRouteLinePresentation(zoom);
  return line.rideCasingWidth - line.rideWidth;
}

/** 대중교통 본선과 추가 외곽선 두께를 합산한 최종 casing 너비를 반환합니다. */
export function getTransitCasingWidth(zoom: number): number {
  return getTransitRouteLinePresentation(zoom).rideCasingWidth;
}

/** 도보 안내선의 현재 줌 두께를 계산합니다. */
export function getWalkWidth(zoom: number): number {
  return getTransitRouteLinePresentation(zoom).walkWidth;
}

/** 도보 안내선 외곽선의 현재 줌 두께를 계산합니다. */
export function getWalkOutlineWidth(zoom: number): number {
  const line = getTransitRouteLinePresentation(zoom);
  return (line.walkCasingWidth - line.walkWidth) / 2;
}

/** 도보 본선과 외곽선을 합친 최종 표시 너비를 반환합니다. */
export function getWalkCasingWidth(zoom: number): number {
  return getTransitRouteLinePresentation(zoom).walkCasingWidth;
}

/** 자동차 경로 본선의 현재 줌 두께를 계산합니다. */
export function getDriveWidth(zoom: number): number {
  return getRouteValueForZoom(ROUTE_LINE_STYLE.drive.mainWidth, zoom);
}

/** 자동차 경로 외곽선의 현재 줌 두께를 계산합니다. */
export function getDriveOutlineWidth(zoom: number): number {
  return (
    getRouteValueForZoom(ROUTE_LINE_STYLE.drive.casingExtraWidth, zoom) / 2
  );
}

/** 자전거 경로 본선의 현재 줌 두께를 계산합니다. */
export function getBikeWidth(zoom: number): number {
  return getRouteValueForZoom(ROUTE_LINE_STYLE.bike.mainWidth, zoom);
}

/** 자전거 경로 외곽선의 현재 줌 두께를 계산합니다. */
export function getBikeOutlineWidth(zoom: number): number {
  return getRouteValueForZoom(ROUTE_LINE_STYLE.bike.casingExtraWidth, zoom) / 2;
}

/** 버스 노선명에서 간선·지선·광역 등 유형을 판별해 지도용 의미 색상을 반환합니다. */
export function getMapBusRouteColor(
  lineName?: string,
  busType?: string,
): string {
  const inferredType = getBusBadgeType(lineName);
  const safeType =
    busType && busType in MAP_BUS_ROUTE_COLORS
      ? (busType as keyof typeof MAP_BUS_ROUTE_COLORS)
      : inferredType;
  return MAP_BUS_ROUTE_COLORS[safeType] ?? MAP_GUIDE_ROUTE_BLUE;
}

/** 경로 세그먼트의 수단·노선·API 색상을 우선순위에 따라 하나의 표시 색상으로 결정합니다. */
export function getSegmentColor(segment: RouteSegment): string {
  const displayColor = normalizeRouteColor(segment.displayColor);
  const routeColor = normalizeRouteColor(
    segment.routeColor ?? segment.lineColor,
  );
  if (segment.mode === 'BUS') {
    // 버스는 공급자 노선색을 우선해 TMAP 기본 지도 위의 유사한 청색 시설선과 구분한다.
    return (
      routeColor ??
      displayColor ??
      getMapBusRouteColor(segment.lineName, segment.busType)
    );
  }
  if (displayColor) return displayColor;
  if (routeColor) return routeColor;
  if (segment.mode === 'SUBWAY') return getSubwayLineColor(segment.lineName);
  if (segment.mode === 'WALK') return ROUTE_WALK_GUIDE_COLOR;
  if (segment.mode === 'TRANSFER') return ROUTE_TRANSFER_GUIDE_COLOR;
  if (segment.mode === 'ETC') return TRANSIT_LEG_COLOR.ETC;
  return MAP_GUIDE_ROUTE_BLUE;
}

/** 선택 상태와 줌을 반영해 세그먼트의 본선·외곽선·점선·z-index 표현값을 조립합니다. */
export function getSegmentStyle(
  segment: RouteSegment,
  zoom: number,
  selected: boolean,
): RouteSegmentStyle {
  const opacity = selected ? 1 : 0.3;
  switch (segment.mode) {
    case 'WALK':
      return {
        strokeColor: ROUTE_LINE_STYLE.walk.color,
        strokeWidth: getWalkWidth(zoom),
        opacity: selected ? ROUTE_LINE_STYLE.walk.opacity : 0.28,
        dashPattern: [...ROUTE_LINE_STYLE.walk.dashPattern],
        outlineColor: ROUTE_WALK_CASING_COLOR,
        outlineWidth: getWalkOutlineWidth(zoom),
        outlineOpacity: ROUTE_WALK_CASING_OPACITY,
        zIndex:
          ROUTE_LINE_STYLE.walk.zIndex + Math.min(segment.sequence, 9) * 0.1,
      };
    case 'TRANSFER':
      return {
        strokeColor: ROUTE_LINE_STYLE.transfer.color,
        strokeWidth: getWalkWidth(zoom),
        opacity: selected ? ROUTE_LINE_STYLE.transfer.opacity : 0.28,
        dashPattern: [...ROUTE_LINE_STYLE.transfer.dashPattern],
        outlineColor: ROUTE_WALK_CASING_COLOR,
        outlineWidth: getWalkOutlineWidth(zoom),
        outlineOpacity: ROUTE_WALK_CASING_OPACITY,
        zIndex:
          ROUTE_LINE_STYLE.transfer.zIndex +
          Math.min(segment.sequence, 9) * 0.1,
      };
    case 'BUS':
      return {
        strokeColor: getSegmentColor(segment),
        strokeWidth: getTransitMainWidth(zoom),
        opacity,
        outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
        outlineWidth:
          (getTransitCasingWidth(zoom) - getTransitMainWidth(zoom)) / 2,
        outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
        zIndex:
          ROUTE_LINE_STYLE.transit.busZIndex +
          Math.min(segment.sequence, 9) * 0.1,
      };
    case 'SUBWAY':
      return {
        strokeColor: getSegmentColor(segment),
        strokeWidth: getTransitMainWidth(zoom),
        opacity,
        outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
        outlineWidth:
          (getTransitCasingWidth(zoom) - getTransitMainWidth(zoom)) / 2,
        outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
        zIndex:
          ROUTE_LINE_STYLE.transit.subwayZIndex +
          Math.min(segment.sequence, 9) * 0.1,
      };
    case 'ETC':
      return {
        strokeColor: TRANSIT_LEG_COLOR.ETC,
        strokeWidth: getTransitMainWidth(zoom),
        opacity,
        outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
        outlineWidth:
          (getTransitCasingWidth(zoom) - getTransitMainWidth(zoom)) / 2,
        outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
        zIndex: 35 + segment.sequence,
      };
    case 'TRANSIT': {
      const stroke = getRouteStrokeStyleForZoom(zoom);
      return {
        strokeColor: MAP_GUIDE_ROUTE_BLUE,
        strokeWidth: stroke.mainWidth,
        opacity,
        outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
        outlineWidth: stroke.outlineWidth,
        outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
        zIndex: 40 + segment.sequence,
      };
    }
    case 'UNKNOWN':
    default:
      warnRouteDebug('[route-segment] unknown mode', {
        id: segment.id,
        mode: segment.mode,
        lineName: segment.lineName,
      });
      return {
        strokeColor: MAP_GUIDE_ROUTE_BLUE,
        strokeWidth: getZoomAdjustedWidth(4, zoom),
        opacity,
        zIndex: 34 + segment.sequence,
      };
  }
}

/** 세그먼트 이동 수단이 버스 또는 지하철 승차 구간인지 타입 가드로 판별합니다. */
export function isTransitRideSegmentMode(mode: RouteMode): boolean {
  return mode === 'BUS' || mode === 'SUBWAY';
}

/** 세그먼트가 TMAP 네이티브 방향 화살표를 사용할 수 있는 승차 구간인지 판별합니다. */
export function shouldUseNativeTransitDirection(
  segment: RouteSegment,
): boolean {
  return (
    ENABLE_NATIVE_ROUTE_DIRECTION &&
    (isTransitRideSegmentMode(segment.mode) || segment.mode === 'TRANSIT') &&
    segment.nativeDirectionEnabled !== false
  );
}

/** 현재 줌과 세그먼트 상태에서 네이티브 방향 화살표를 실제로 표시할지 결정합니다. */
export function shouldRenderNativeTransitDirection(
  segment: RouteSegment,
  zoom: number,
): boolean {
  return shouldRenderNormalizedTransitDirection(
    segment.mode,
    zoom,
    shouldUseNativeTransitDirection(segment),
  );
}

/** 세그먼트가 도보 또는 환승 보행 구간인지 판별합니다. */
export function isWalkTransferSegment(segment: RouteSegment): boolean {
  return segment.mode === 'WALK' || segment.mode === 'TRANSFER';
}

/** 현재 줌과 구간 유형을 바탕으로 지도에 경로 형상을 노출할지 결정합니다. */
export function shouldRenderRouteSegmentGeometry(
  segment: RouteSegment,
): boolean {
  if (
    segment.geometryQuality === 'START_END_ONLY' ||
    segment.geometrySource === 'START_END_ONLY'
  ) {
    return false;
  }
  if (
    isTransitRideSegmentMode(segment.mode) &&
    (segment.geometryQuality === 'PASS_STOP_ONLY' ||
      segment.geometrySource === 'PASS_STOP_LIST')
  ) {
    return false;
  }
  return true;
}

/** 네이티브 방향 화살표가 본선과 겹치지 않도록 전달용 선의 너비를 계산합니다. */
export function getNativeDirectionCarrierWidth(zoom: number): number {
  // 별도 carrier 없이 본선 자체가 native direction을 소유한다.
  return getTransitMainWidth(zoom);
}

/** 선택 상태와 줌을 반영해 네이티브 방향 화살표 레이어의 투명도를 반환합니다. */
export function getNativeDirectionOpacity(zoom: number): number {
  return getTransitNativeDirectionOpacity(zoom);
}

/** 정류장 원본 좌표와 경로 스냅 좌표 중 지도에 표시할 수 있는 유효 좌표를 선택합니다. */
export function getRenderableStopCoordinate(
  anchor: TransitStopAnchor | undefined,
): Coordinate | undefined {
  if (!anchor) return undefined;
  if (
    anchor.anchorSource === 'UNSNAPPED' &&
    (anchor.snapDistanceMeters ?? Number.POSITIVE_INFINITY) >
      CONNECTOR_POLICY.maxSchematicAccessLinkMeters
  ) {
    return anchor.stopCoordinate;
  }
  return anchor.routeAnchorCoordinate;
}

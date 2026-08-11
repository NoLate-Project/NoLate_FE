import type { Place, TravelMode } from '../types';

/** Expo Router에서 전달될 수 있는 단일 또는 반복 query parameter 값입니다. */
export type RoutePlannerQueryParam = string | string[] | undefined;

/** 사용자가 지도에서 다시 지정할 수 있는 경로 끝점입니다. */
export type RoutePointTarget = 'origin' | 'destination';

/** 대중교통 후보 목록에서 사용할 이동 수단 필터입니다. */
export type TransitRouteFilter = 'ALL' | 'BUS' | 'SUBWAY' | 'MIXED';

/** 개발용 카메라 포커스 query에서 허용하는 대상입니다. */
export type RoutePlannerFocusTarget =
  | 'origin'
  | 'destination'
  | 'startRide'
  | 'firstSubway';

/** 화면 진입 시 요청할 수 있는 바텀시트 상태입니다. */
export type DebugSheetState = 'collapsed' | 'middle' | 'hidden' | 'expanded';

/** 지도 경로 QA에서 선택적으로 노출할 레이어 묶음입니다. */
export type RouteQaLayerMode =
  | 'ALL'
  | 'BASE_ONLY'
  | 'APP_ROUTE_ONLY'
  | 'APP_ROUTE_DIM_BASE'
  | 'ANCHOR_DEBUG'
  | 'CONNECTOR_DEBUG'
  | 'ROUTE_VISIBILITY_DEBUG';

/** 시각 회귀 테스트에서 재현 가능한 카메라 위치 식별자입니다. */
export type QaCameraPresetId =
  | 'routeOverview'
  | 'routeStart'
  | 'firstBoard'
  | 'routeEnd'
  | 'subwayZoom12'
  | 'subwayZoom15'
  | 'subwayZoom17'
  | 'subwayStopsZoom18'
  | 'busZoom12'
  | 'busZoom15'
  | 'busZoom17'
  | 'busStopsZoom18'
  | 'walkTransferZoom17'
  | 'walkTransferZoom18';

/** 경로 계획 화면에서 사용자가 직접 선택할 수 있는 이동 수단 순서입니다. */
export const SELECTABLE_TRAVEL_MODES: TravelMode[] = [
  'CAR',
  'TRANSIT',
  'WALK',
  'BIKE',
];
const DEBUG_FOCUS_MIN_ZOOM = 6;
const DEBUG_FOCUS_MAX_ZOOM = 18;

/**
 * 장소가 지도와 길찾기에 사용할 수 있는 유효 좌표를 모두 갖고 있는지 확인합니다.
 *
 * 단순한 `typeof` 검사뿐 아니라 `NaN`과 무한대도 거부합니다. 반환값은 타입 가드이므로
 * 호출부에서는 검사 이후 `lat`, `lng`를 선택 값 없이 안전하게 사용할 수 있습니다.
 */
export function placeHasCoords(
  place: Place,
): place is Place & { lat: number; lng: number } {
  return (
    typeof place.lat === 'number' &&
    Number.isFinite(place.lat) &&
    typeof place.lng === 'number' &&
    Number.isFinite(place.lng)
  );
}

/**
 * Expo Router query 값을 하나의 문자열로 정규화합니다.
 *
 * 동일한 key가 여러 번 전달되면 Router가 배열을 만들 수 있으므로 첫 번째 값만 사용합니다.
 * 값의 공백 제거와 유효성 검사는 각 도메인 parser가 담당합니다.
 */
export function getSingleParam(
  value: RoutePlannerQueryParam,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

/**
 * query 문자열을 유한한 숫자로 변환합니다.
 *
 * 빈 문자열, `NaN`, `Infinity`는 좌표·인덱스로 전파되지 않도록 `undefined`로 처리합니다.
 */
export function parseNumberParam(
  value: RoutePlannerQueryParam,
): number | undefined {
  const raw = getSingleParam(value);
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * query 값을 정수 인덱스로 변환합니다.
 *
 * 소수점이 포함된 값은 임의로 반올림하지 않고 거부하여 다른 경로 후보가 선택되는 문제를 막습니다.
 */
export function parseIntegerParam(
  value: RoutePlannerQueryParam,
): number | undefined {
  const parsed = parseNumberParam(value);
  if (typeof parsed !== 'number') return undefined;
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * 외부에서 전달된 이동 수단을 앱의 `TravelMode`로 변환합니다.
 *
 * 대소문자는 허용하지만 지원 목록에 없는 값은 기본값을 여기서 추측하지 않고 `undefined`로 반환합니다.
 */
export function parseTravelModeParam(
  value: RoutePlannerQueryParam,
): TravelMode | undefined {
  const raw = getSingleParam(value)?.trim().toUpperCase();
  if (!raw) return undefined;
  return SELECTABLE_TRAVEL_MODES.includes(raw as TravelMode)
    ? (raw as TravelMode)
    : undefined;
}

/**
 * 출발 시각 query를 유효한 `Date`로 변환합니다.
 *
 * JavaScript가 만들 수 없는 날짜는 화면 상태에 넣지 않도록 `undefined`로 반환합니다.
 */
export function parseDepartureAtParam(
  value: RoutePlannerQueryParam,
): Date | undefined {
  const raw = getSingleParam(value)?.trim();
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/** 출발지·도착지 편집 query 중 실제로 지원하는 값만 반환합니다. */
export function parseRoutePointTargetParam(
  value: RoutePlannerQueryParam,
): RoutePointTarget | undefined {
  const raw = getSingleParam(value)?.trim();
  return raw === 'origin' || raw === 'destination' ? raw : undefined;
}

/** 개발용 강제 포커스 query를 허용 목록으로 제한합니다. */
export function parseFocusTargetParam(
  value: RoutePlannerQueryParam,
): RoutePlannerFocusTarget | undefined {
  const raw = getSingleParam(value)?.trim();
  if (
    raw === 'origin' ||
    raw === 'destination' ||
    raw === 'startRide' ||
    raw === 'firstSubway'
  )
    return raw;
  return undefined;
}

/**
 * 개발용 카메라 줌을 TMAP Web SDK가 안정적으로 처리하는 6~18 범위로 제한합니다.
 */
export function parseFocusZoomParam(
  value: RoutePlannerQueryParam,
): number | undefined {
  const parsed = parseNumberParam(value);
  if (typeof parsed !== 'number') return undefined;
  return Math.max(DEBUG_FOCUS_MIN_ZOOM, Math.min(DEBUG_FOCUS_MAX_ZOOM, parsed));
}

/**
 * 화면 진입 시 사용할 바텀시트 상태를 해석합니다.
 *
 * 운영 딥링크에는 실제 일정 화면이 사용하는 `middle`만 허용합니다. 나머지 상태는 시각 QA용이므로
 * 개발 빌드에서만 받아 사용자 입력이 운영 UI를 강제로 숨기거나 펼치지 못하게 합니다.
 */
export function parseSheetStateParam(
  value: RoutePlannerQueryParam,
): DebugSheetState | undefined {
  const raw = getSingleParam(value)?.trim().toLowerCase();
  if (raw === 'middle') return raw;
  if (
    typeof __DEV__ === 'boolean' &&
    __DEV__ &&
    (raw === 'collapsed' || raw === 'hidden' || raw === 'expanded')
  )
    return raw;
  return undefined;
}

/** 시각 회귀 테스트에서 정의한 카메라 프리셋만 통과시킵니다. */
export function parseQaCameraPresetParam(
  value: RoutePlannerQueryParam,
): QaCameraPresetId | undefined {
  const raw = getSingleParam(value)?.trim();
  const presets: QaCameraPresetId[] = [
    'routeOverview',
    'routeStart',
    'firstBoard',
    'routeEnd',
    'subwayZoom12',
    'subwayZoom15',
    'subwayZoom17',
    'subwayStopsZoom18',
    'busZoom12',
    'busZoom15',
    'busZoom17',
    'busStopsZoom18',
    'walkTransferZoom17',
    'walkTransferZoom18',
  ];
  return presets.includes(raw as QaCameraPresetId)
    ? (raw as QaCameraPresetId)
    : undefined;
}

/** 지도 QA 레이어 query를 허용 목록으로 제한하고, 잘못된 값은 전체 레이어로 되돌립니다. */
export function parseRouteQaLayerModeParam(
  value: RoutePlannerQueryParam,
): RouteQaLayerMode {
  const raw = getSingleParam(value)?.trim().toUpperCase();
  const modes: RouteQaLayerMode[] = [
    'ALL',
    'BASE_ONLY',
    'APP_ROUTE_ONLY',
    'APP_ROUTE_DIM_BASE',
    'ANCHOR_DEBUG',
    'CONNECTOR_DEBUG',
    'ROUTE_VISIBILITY_DEBUG',
  ];
  return modes.includes(raw as RouteQaLayerMode)
    ? (raw as RouteQaLayerMode)
    : 'ALL';
}

/**
 * `originName`, `originLat` 같은 평탄한 query 묶음을 하나의 `Place`로 조립합니다.
 *
 * 좌표 두 개가 모두 있어야 장소를 반환합니다. 이름과 주소가 빠진 경우에도 지도 선택 흐름이
 * 계속될 수 있도록 반대 필드를 재사용하고, 둘 다 없으면 출발지/도착지 기본 명칭을 부여합니다.
 */
export function parseRouteParamPlace(
  params: Record<string, RoutePlannerQueryParam>,
  prefix: 'origin' | 'destination',
): Place | undefined {
  const lat = parseNumberParam(params[`${prefix}Lat`]);
  const lng = parseNumberParam(params[`${prefix}Lng`]);
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;

  const name = getSingleParam(params[`${prefix}Name`])?.trim();
  const address = getSingleParam(params[`${prefix}Address`])?.trim();

  return {
    name: name || address || (prefix === 'origin' ? '출발지' : '도착지'),
    address: address || name || '',
    lat,
    lng,
  };
}

import type {
  RouteAlternativeOption,
  TransitLegDetail,
} from '../../map/routingService';
import {
  getNaverLikeRouteTransferCount,
  getNaverLikeTransitRouteCategory,
  selectNaverLikeRouteAlternatives,
} from '../routeAlternativeRanking';
import { compactTransitLineLabel } from '../routeInfo';
import type { TravelMode } from '../types';
import type { TransitRouteFilter } from './params';

/** 지도 선, 범례, 정류장 배지가 공유하는 이동 수단별 기본 색상입니다. */
export const TRANSIT_LEG_COLOR: Record<TransitLegDetail['kind'], string> = {
  SUBWAY: '#00B140',
  BUS: '#2979FF',
  WALK: '#9CA3AF',
  ETC: '#94A3B8',
};

export type TransitLegKindMeta = {
  label: string;
  short: string;
  color: string;
};

export type TransitRouteTimeMeta = {
  departureText: string;
  arrivalText?: string;
  timeRangeText?: string;
  fareText?: string;
  combinedText: string;
};

type CameraCoord = { latitude: number; longitude: number };

/**
 * 미터 단위 거리를 사람이 빠르게 읽을 수 있는 짧은 문자열로 바꿉니다.
 *
 * 1km 미만은 반올림한 미터, 그 이상은 소수점 한 자리의 km로 표시합니다. 값이 없으면
 * 호출부가 해당 항목 자체를 숨길 수 있도록 `undefined`를 반환합니다.
 */
export function formatDistance(distanceMeters?: number): string | undefined {
  if (typeof distanceMeters !== 'number') return undefined;
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
  return `${Math.round(distanceMeters)}m`;
}

/**
 * 분 단위 시간을 한국어 시간·분 표기로 변환합니다.
 *
 * 소수 분은 가장 가까운 정수로 반올림하고 음수는 0분으로 제한합니다. API 값이 없거나
 * 유한하지 않으면 UI에서 빈 값 대신 일관되게 `-`를 보여 줍니다.
 */
export function formatDuration(minutes?: number): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '-';
  const totalMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(totalMinutes / 60);
  const remainMinutes = totalMinutes % 60;
  if (hours === 0) return `${remainMinutes}분`;
  if (remainMinutes === 0) return `${hours}시간`;
  return `${hours}시간 ${remainMinutes}분`;
}

/**
 * 두 위경도 사이의 대권 거리를 km로 계산합니다.
 *
 * 카메라 bounds, 좌표 스냅 거리, 장거리 경로 판단이 같은 공식을 사용하도록 화면 밖으로
 * 분리했습니다. 짧은 거리에서도 충분히 안정적인 하버사인 공식을 사용합니다.
 */
export function haversineDistanceKm(
  from: CameraCoord,
  to: CameraCoord,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

/**
 * 경로 후보 한 건의 보조 정보를 한 줄 요약으로 만듭니다.
 *
 * API가 제공한 항목만 환승·도보·요금·거리 순서로 조합합니다. 표시할 지표가 하나도 없는
 * 경로도 빈 문자열이 되지 않도록 `경로 안내`를 기본 문구로 사용합니다.
 */
export function formatAlternativeInfo(option: RouteAlternativeOption): string {
  const chunks: string[] = [];

  if (typeof option.transferCount === 'number') {
    chunks.push(`환승 ${option.transferCount}회`);
  }

  const walkText = formatDistance(option.walkMeters);
  if (walkText) chunks.push(`도보 ${walkText}`);

  if (typeof option.fareWon === 'number') {
    chunks.push(`요금 ${option.fareWon.toLocaleString()}원`);
  }
  if (typeof option.tollFareWon === 'number' && option.tollFareWon > 0) {
    chunks.push(`통행료 ${option.tollFareWon.toLocaleString()}원`);
  }
  if (typeof option.taxiFareWon === 'number' && option.taxiFareWon > 0) {
    chunks.push(`택시 예상 ${option.taxiFareWon.toLocaleString()}원`);
  }

  const distanceText = formatDistance(option.distanceMeters);
  if (distanceText) chunks.push(distanceText);

  return chunks.length ? chunks.join(' · ') : '경로 안내';
}

/**
 * 선택된 경로 상단에 chip으로 노출할 지표 목록을 만듭니다.
 *
 * 한 줄 요약과 달리 각 항목을 배열로 유지해 화면 폭에 따라 chip을 줄바꿈할 수 있습니다.
 * 경로 형상이 의심스러운 경우에는 다른 수치보다 먼저 경고 tag를 배치합니다.
 */
export function getAlternativeMetricTags(
  option: RouteAlternativeOption,
): string[] {
  const metrics: string[] = [];
  if (option.routePlausibility === 'geometry_suspected') {
    metrics.push('경로 확인 필요');
  }
  if (typeof option.transferCount === 'number') {
    metrics.push(`환승 ${option.transferCount}회`);
  }

  const walkText = formatDistance(option.walkMeters);
  if (walkText) metrics.push(`도보 ${walkText}`);

  if (typeof option.fareWon === 'number') {
    metrics.push(`요금 ${option.fareWon.toLocaleString()}원`);
  }
  if (typeof option.tollFareWon === 'number' && option.tollFareWon > 0) {
    metrics.push(`통행료 ${option.tollFareWon.toLocaleString()}원`);
  }
  if (typeof option.taxiFareWon === 'number' && option.taxiFareWon > 0) {
    metrics.push(`택시 예상 ${option.taxiFareWon.toLocaleString()}원`);
  }

  const distanceText = formatDistance(option.distanceMeters);
  if (distanceText) metrics.push(`총 ${distanceText}`);
  return metrics;
}

/**
 * 대중교통 legs에 실제 포함된 이동 수단을 고정된 순서의 한국어 label로 반환합니다.
 *
 * API leg 순서가 달라져도 범례와 요약 chip의 순서는 지하철·버스·도보·기타로 유지됩니다.
 */
export function getTransitModeLabels(legs?: TransitLegDetail[]): string[] {
  if (!Array.isArray(legs) || !legs.length) return [];

  const labelsByKind: Record<TransitLegDetail['kind'], string> = {
    SUBWAY: '지하철',
    BUS: '버스',
    WALK: '도보',
    ETC: '기타',
  };
  const orderedKinds: TransitLegDetail['kind'][] = [
    'SUBWAY',
    'BUS',
    'WALK',
    'ETC',
  ];
  const used = new Set<TransitLegDetail['kind']>(legs.map(leg => leg.kind));
  return orderedKinds
    .filter(kind => used.has(kind))
    .map(kind => labelsByKind[kind]);
}

/**
 * 경로 후보 카드에 표시할 짧은 이동 순서 미리보기를 만듭니다.
 *
 * 빈 label을 제거하고 처음 세 단계만 연결해 카드가 지나치게 길어지는 것을 막습니다.
 */
export function buildTransitLegPreview(
  legs?: TransitLegDetail[],
): string | undefined {
  if (!Array.isArray(legs) || !legs.length) return undefined;
  const labels = legs
    .map(leg => leg.label?.trim())
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  if (!labels.length) return undefined;
  return labels.slice(0, 3).join(' → ');
}

/** 이동 수단 종류에 대응하는 긴 이름, 배지 한 글자, 기본 색상을 한 번에 반환합니다. */
export function getTransitLegKindMeta(
  kind: TransitLegDetail['kind'],
): TransitLegKindMeta {
  if (kind === 'SUBWAY')
    return { label: '지하철', short: '지', color: TRANSIT_LEG_COLOR.SUBWAY };
  if (kind === 'BUS')
    return { label: '버스', short: '버', color: TRANSIT_LEG_COLOR.BUS };
  if (kind === 'WALK')
    return { label: '도보', short: '도', color: TRANSIT_LEG_COLOR.WALK };
  return { label: '기타', short: '기', color: TRANSIT_LEG_COLOR.ETC };
}

/** 네이버형 추천 규칙이 계산한 대중교통 분류를 화면 필터 타입으로 반환합니다. */
export function getTransitRouteCategory(
  option: RouteAlternativeOption,
): TransitRouteFilter {
  return getNaverLikeTransitRouteCategory(option) as TransitRouteFilter;
}

/** 네이버형 추천 규칙과 동일한 기준으로 경로의 환승 횟수를 계산합니다. */
export function getTransitRouteTransferCount(
  option: RouteAlternativeOption,
): number {
  return getNaverLikeRouteTransferCount(option);
}

/**
 * 이동 수단에 맞춰 후보 경로를 정렬하고 화면에 필요한 개수로 제한합니다.
 *
 * 대중교통은 추천·환승·도보 기준을 함께 반영하는 공용 ranking 정책을 사용합니다. 자동차,
 * 도보, 자전거는 소요 시간이 짧은 순으로 최대 네 건만 유지합니다.
 */
export function sortRouteAlternativesForPlanner(
  options: RouteAlternativeOption[],
  mode: TravelMode,
): RouteAlternativeOption[] {
  if (mode === 'TRANSIT')
    return selectNaverLikeRouteAlternatives(options, mode, 'ALL');
  return [...options]
    .sort((a, b) => {
      const aMinutes =
        typeof a.minutes === 'number' ? a.minutes : Number.POSITIVE_INFINITY;
      const bMinutes =
        typeof b.minutes === 'number' ? b.minutes : Number.POSITIVE_INFINITY;
      return aMinutes - bMinutes;
    })
    .slice(0, 4);
}

/** leg 상세 행에 붙일 소요 시간·거리 보조 문구를 만듭니다. */
export function buildTransitLegMeta(leg: TransitLegDetail): string | undefined {
  const chunks: string[] = [];
  if (typeof leg.durationMinutes === 'number')
    chunks.push(formatDuration(leg.durationMinutes));
  const distanceText = formatDistance(leg.distanceMeters);
  if (distanceText) chunks.push(distanceText);
  return chunks.length ? chunks.join(' · ') : undefined;
}

/**
 * 대중교통 timeline의 주 제목을 leg 종류에 맞게 구성합니다.
 *
 * 도보는 API 설명을 그대로 사용합니다. 승차 leg는 이동 수단, 축약 노선명, 정거장 수를
 * 조합하되 일부 값이 빠져도 남아 있는 정보만으로 자연스러운 제목을 만듭니다.
 */
export function buildTransitTimelineTitle(leg: TransitLegDetail): string {
  if (leg.kind === 'WALK') return leg.label;
  const kindLabel = getTransitLegKindMeta(leg.kind).label;
  const lineName = leg.lineName?.trim() || compactTransitLineLabel(leg.label);
  const titleChunks = [kindLabel, lineName].filter(
    (value): value is string => !!value,
  );
  const stationText =
    typeof leg.stationCount === 'number'
      ? `${leg.stationCount}정거장`
      : undefined;
  return stationText
    ? `${titleChunks.join(' ')} · ${stationText}`
    : titleChunks.join(' ') || leg.label;
}

/**
 * 지도 배지에 들어갈 정류장명을 공백·괄호·연속 마침표 없이 짧게 정리합니다.
 *
 * 제한 길이를 넘으면 말줄임표를 붙이며, 정리 후 비어 있는 문자열은 렌더하지 않도록
 * `undefined`를 반환합니다.
 */
export function compactTransitStopLabel(
  stopName?: string,
  maxLength = 10,
): string | undefined {
  if (!stopName) return undefined;
  const normalized = stopName
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/\.+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized;
}

/** 현재 시각을 출발 시각 picker의 빠른 선택 문구로 표시합니다. */
export function formatTransitDepartureNow(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `오늘 ${hh}:${mm} 출발`;
}

/** `Date`를 오전·오후가 포함된 12시간제 한국어 시각으로 변환합니다. */
export function formatTransitClock(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours < 12 ? '오전' : '오후';
  const displayHour = hours % 12 || 12;
  return `${period} ${displayHour}:${minutes}`;
}

/** 기준일과 시각의 달력 날짜 차이를 로컬 시간 기준 일수로 계산합니다. */
function getTransitDayDiff(date: Date, referenceDate: Date): number {
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const referenceStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  ).getTime();
  return Math.round((dateStart - referenceStart) / (24 * 60 * 60 * 1000));
}

/**
 * 도착 시각이 출발일과 다를 때 `다음날`, `전날`, 날짜 접두어를 붙여 오해를 막습니다.
 */
export function formatTransitClockWithDayContext(
  date: Date,
  referenceDate: Date,
): string {
  const dayDiff = getTransitDayDiff(date, referenceDate);
  if (dayDiff === 0) return formatTransitClock(date);
  if (dayDiff === 1) return `다음날 ${formatTransitClock(date)}`;
  if (dayDiff === -1) return `전날 ${formatTransitClock(date)}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${formatTransitClock(date)}`;
}

/**
 * 경로 후보의 출발·예상 도착·요금을 카드와 상세 화면에서 함께 쓸 형태로 조립합니다.
 *
 * 운행 종료 경로에는 잘못된 예상 도착 시각을 계산하지 않습니다. 정상 경로는 출발 시각에
 * 소요 분을 더해 도착 시각을 만들고, 자정이 넘어가면 날짜 문맥을 포함합니다.
 */
export function buildTransitRouteTimeMeta(
  option: RouteAlternativeOption,
  departureAt: Date,
): TransitRouteTimeMeta {
  const fareText =
    typeof option.fareWon === 'number'
      ? `${option.fareWon.toLocaleString()}원`
      : undefined;
  if (option.transitServiceState === 'not_operating') {
    return {
      departureText: '운행 종료',
      fareText,
      combinedText: ['현재 운행 종료', fareText].filter(Boolean).join(' | '),
    };
  }

  const departureText = formatTransitClock(departureAt);
  let arrivalText: string | undefined;
  if (typeof option.minutes === 'number') {
    const arrivalAt = new Date(
      departureAt.getTime() + Math.max(0, option.minutes) * 60 * 1000,
    );
    arrivalText = formatTransitClockWithDayContext(arrivalAt, departureAt);
  }
  const timeRangeText = arrivalText
    ? `${departureText} 출발 - ${arrivalText} 예상 도착`
    : undefined;
  return {
    departureText,
    arrivalText,
    timeRangeText,
    fareText,
    combinedText: [timeRangeText, fareText].filter(Boolean).join(' | '),
  };
}

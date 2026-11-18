import { isTransitRideKind, transitModeLabel } from "../../map/transitModes";
import { validTotalDurationSeconds } from '../../map/routeDuration';
import type {
  RouteAlternativeOption,
  TransitLegDetail,
} from '../../map/routingService';
import {
  getNaverLikeRouteTransferCount,
  getNaverLikeTransitRouteCategory,
  selectNaverLikeRouteAlternatives,
} from '../routeAlternativeRanking';
import { compactTransitLineLabel, findTransitRideLineLabel, formatRouteDistance, formatRouteDuration, roundRouteArrivalMinute } from '../routeInfo';
import type { TravelMode } from '../types';
import type { TransitRouteFilter } from './params';

/** 지도 선, 범례, 정류장 배지가 공유하는 이동 수단별 기본 색상입니다. */
export const TRANSIT_LEG_COLOR: Record<TransitLegDetail['kind'], string> = {
  SUBWAY: '#00B140',
  BUS: '#2979FF',
  WALK: '#9CA3AF',
  ETC: '#94A3B8',
  TRAIN: '#2563EB', EXPRESS_BUS: '#7C3AED', INTERCITY_BUS: '#0F766E', COACH: '#7C3AED',
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

/** Shows the access walk only when it is the first actual route leg. */
export function getRouteOverviewAccessWalk(option?: RouteAlternativeOption, originName?: string) {
  if (option?.mode !== 'TRANSIT' || option.transitServiceState === 'not_operating') return undefined;
  const first = option.transitLegs?.[0];
  if (!first || first.kind !== 'WALK' || !option.transitLegs?.some(leg => isTransitRideKind(leg.kind))) return undefined;

  const distance = typeof first.distanceMeters === 'number' && first.distanceMeters > 0
    ? formatRouteDistance(first.distanceMeters)
    : undefined;
  const seconds = first.durationSeconds;
  const minutes = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? seconds / 60
    : first.durationMinutes;
  const duration = typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
    ? formatRouteDuration(Math.max(1, minutes))
    : undefined;
  if (!distance && !duration) return undefined;

  const from = first.startName?.trim() || originName?.trim();
  const to = first.endName?.trim();
  const next = option.transitLegs[1];
  const boarding = next && isTransitRideKind(next.kind) ? next.startName?.trim() : undefined;
  const subwayLine = next?.kind === 'SUBWAY'
    ? findTransitRideLineLabel(next)
    : undefined;
  return {
    origin: from,
    destination: to && to !== from ? to
      : boarding && boarding !== from ? boarding
      : subwayLine ? `${subwayLine} 타는 곳` : undefined,
    walking: `도보 ${[distance, duration].filter(Boolean).join(' · ')}`,
  };
}

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
    TRAIN: '기차', EXPRESS_BUS: '고속버스', INTERCITY_BUS: '시외버스', COACH: '고속·시외버스',
  };
  const orderedKinds: TransitLegDetail['kind'][] = [
    'SUBWAY',
    'BUS', 'TRAIN', 'EXPRESS_BUS', 'INTERCITY_BUS', 'COACH',
    'WALK',
    'ETC',
  ];
  const used = new Set<TransitLegDetail['kind']>(legs.map(leg => leg.kind));
  return orderedKinds
    .filter(kind => used.has(kind))
    .map(kind => labelsByKind[kind]);
}

/** 이동 수단 종류에 대응하는 긴 이름, 배지 한 글자, 기본 색상을 한 번에 반환합니다. */
export function getTransitLegKindMeta(
  kind: TransitLegDetail['kind'],
): TransitLegKindMeta {
  if (kind === 'SUBWAY')
    return { label: '지하철', short: '지', color: TRANSIT_LEG_COLOR.SUBWAY };
  if (kind === 'BUS')
    return { label: '버스', short: '버', color: TRANSIT_LEG_COLOR.BUS };
  if (isTransitRideKind(kind))
    return { label: transitModeLabel(kind), short: kind === 'TRAIN' ? '기' : '버', color: TRANSIT_LEG_COLOR[kind] };
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

/** Identify route choices using the line and, for tied choices, the relevant stop. */
export function getMapRouteChoiceLabels(
  options: RouteAlternativeOption[],
  { compareLinesAcrossDurations = true }: { compareLinesAcrossDurations?: boolean } = {},
): string[] {
  const choices = options.map(option => {
    const rides = (option.transitLegs ?? []).filter(leg => isTransitRideKind(leg.kind));
    return {
      category: getTransitRouteCategory(option),
      duration: option.transitServiceState === 'not_operating' ? '운행 종료' : formatRouteDuration(option.minutes),
      transfers: getNaverLikeRouteTransferCount(option),
      lines: rides.map(findTransitRideLineLabel),
      boardingStops: rides.map(leg => leg.startName?.trim() || undefined),
      alightingStops: rides.map(leg => leg.endName?.trim() || undefined),
    };
  });
  const labels = choices.map((choice, index) => {
    const { category, duration } = choice;
    const sameMode = choices.filter((peer, peerIndex) =>
      index !== peerIndex && peer.category === category);
    const sameDuration = sameMode.filter(peer => peer.duration === duration);
    const differentIndex = (field: 'lines' | 'boardingStops' | 'alightingStops', peers = sameDuration) =>
      peers.length > 0 ? choice[field].findIndex((value, legIndex) =>
        value && peers.every(peer => peer[field][legIndex] !== value)) : -1;
    const sameDurationLineIndex = differentIndex('lines');
    const lineIndex = sameDurationLineIndex >= 0 || !compareLinesAcrossDurations
      ? sameDurationLineIndex : differentIndex('lines', sameMode);
    const distinguishingLine = choice.lines[lineIndex];
    const boarding = lineIndex < 0 ? choice.boardingStops[differentIndex('boardingStops')] : undefined;
    const alighting = lineIndex < 0 && !boarding ? choice.alightingStops[differentIndex('alightingStops')] : undefined;
    const stopDistinction = boarding ? `${boarding} 승차` : alighting ? `${alighting} 하차` : undefined;
    let distinction = distinguishingLine ?? stopDistinction;
    if (category === 'SUBWAY') {
      const firstLine = choice.lines[0];
      if (!firstLine) {
        distinction = stopDistinction;
      } else if (lineIndex > 0) {
        distinction = choice.lines.slice(0, lineIndex + 1).map(line => line ?? '지하철').join('→');
      } else {
        const boardingLine = choice.transfers ? `${firstLine} + 환승 ${choice.transfers}회` : firstLine;
        distinction = [boardingLine, stopDistinction].filter(Boolean).join(' · ');
      }
    }
    const mode = category === 'BUS' ? '버스'
      : category === 'SUBWAY' ? '지하철'
      : category === 'MIXED' ? '버스+지하철'
      : '대중교통';
    const title = index === 0
      ? ['추천', distinction].filter(Boolean).join(' · ')
      : distinction ?? mode;
    return `${title} · ${duration}`;
  });
  return labels.map((label, index) => labels.indexOf(label) === labels.lastIndexOf(label)
    ? label
    : `${label} · ${index + 1}번 후보`);
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
  const lineName = leg.kind === 'SUBWAY'
    ? findTransitRideLineLabel(leg)
    : leg.lineName?.trim() || compactTransitLineLabel(leg.label);
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

export const TRANSIT_ESTIMATED_DURATION_LABEL = '예상 소요 시간';
export const TIMETABLE_DESTINATION_ARRIVAL_LABEL = '목적지 도착 (시간표 기준)';

/** Some saved itineraries have ride legs but no provider verified departure. */
export function isSavedTransitDurationEstimate(option?: RouteAlternativeOption): boolean {
  return option?.mode === 'TRANSIT' &&
    option.source === 'fallback' &&
    option.fallbackKind === undefined &&
    option.transitServiceState !== 'operating' &&
    option.transitServiceState !== 'not_operating' &&
    option.providerTimeBasis !== 'timetable' &&
    !option.intercityJourney &&
    Boolean(option.transitLegs?.some(leg => isTransitRideKind(leg.kind)));
}

export function shouldShowTransitDurationOnly(option?: RouteAlternativeOption): boolean {
  return option?.mode === 'TRANSIT' &&
    !option.odsayTimetablePreview &&
    !option.odsayBusPreview &&
    (option.transitServiceState === 'unknown' || isSavedTransitDurationEstimate(option));
}

/** Keep map discrepancies and unavailable service distinct from a duration estimate. */
export function getRoutePlannerQualityNotice(
  option: RouteAlternativeOption | undefined,
  qualityNotice: string | undefined,
  isRouteDetailMode: boolean,
): string | undefined {
  if (option?.routePlausibility === 'geometry_suspected') {
    return '지도에 표시된 경로가 실제 도로와 다를 수 있어요.';
  }
  if (option?.source === 'fallback' && option.fallbackKind === 'straight') {
    return qualityNotice;
  }
  if (isRouteDetailMode && shouldShowTransitDurationOnly(option)) return undefined;
  return qualityNotice;
}

/** 운행 미확인 시각은 숨기고, 검증된 시간표 또는 출발 기준의 예상시각과 요금을 조립한다. */
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
  if (shouldShowTransitDurationOnly(option)) {
    return {
      departureText: TRANSIT_ESTIMATED_DURATION_LABEL,
      fareText,
      combinedText: [TRANSIT_ESTIMATED_DURATION_LABEL, fareText].filter(Boolean).join(' · '),
    };
  }

  const timetablePreview = option.odsayTimetablePreview;
  const bus = option.odsayBusPreview;
  const departure = timetablePreview?.departureAt ?? bus?.departureAt ?? option.providerDepartureAt;
  const arrival = timetablePreview?.arrivalAt ?? bus?.arrivalAt ?? option.providerArrivalAt;
  const providerDeparture = departure ? new Date(departure) : undefined;
  const providerArrival = arrival ? new Date(arrival) : undefined;
  const hasTimetable = (timetablePreview || bus || option.providerTimeBasis === 'timetable') &&
    providerDeparture && providerArrival &&
    Number.isFinite(providerDeparture.getTime()) && Number.isFinite(providerArrival.getTime()) &&
    providerArrival.getTime() >= providerDeparture.getTime();
  const displayedDeparture = hasTimetable ? providerDeparture : departureAt;
  const departureText = formatTransitClock(displayedDeparture);
  let arrivalText: string | undefined;
  const departureMs = displayedDeparture.getTime();
  const exactSeconds = validTotalDurationSeconds(option.totalDurationSeconds, departureMs);
  const estimatedSeconds = exactSeconds ?? (
    typeof option.minutes === 'number' && Number.isFinite(option.minutes) ? Math.max(0, option.minutes) * 60 : undefined
  );
  const arrivalAt = hasTimetable ? providerArrival : estimatedSeconds === undefined
    ? undefined : new Date(departureMs + estimatedSeconds * 1000);
  if (arrivalAt && Number.isFinite(arrivalAt.getTime())) {
    const displayedArrival = timetablePreview ? roundRouteArrivalMinute(arrivalAt) ?? arrivalAt : arrivalAt;
    arrivalText = formatTransitClockWithDayContext(displayedArrival, displayedDeparture);
  }
  const timeRangeText = arrivalText
    ? `${departureText} 출발 - ${arrivalText} ${timetablePreview ? TIMETABLE_DESTINATION_ARRIVAL_LABEL : '예상 도착'}`
    : undefined;
  return {
    departureText,
    arrivalText,
    timeRangeText,
    fareText,
    combinedText: [timeRangeText, fareText].filter(Boolean).join(' | '),
  };
}

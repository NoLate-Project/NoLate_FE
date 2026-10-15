import type { ScheduleDepartureStatus } from '../../api/schedule';
import type { TravelMode } from './types';
import { getFreshDepartureTiming } from './effectiveTransitRoutePresentation';

/** 저장된 역산값은 유지하되, 운행·시간표 검증이 끝난 ETA처럼 안내하지 않는다. */
export function getTransitEtaTrustPresentation({
  travelMode,
  status,
  isInspectingTravelPlan = false,
  preservingEarlierDeparture = false,
  intercityJourneySelected = false,
  intercityTicketSelected = false,
}: {
  travelMode?: TravelMode | null;
  status?: ScheduleDepartureStatus | null;
  isInspectingTravelPlan?: boolean;
  preservingEarlierDeparture?: boolean;
  intercityJourneySelected?: boolean;
  intercityTicketSelected?: boolean;
}): { departureLabel: string; warning?: string } {
  if (travelMode !== 'TRANSIT') return { departureLabel: '권장 출발' };
  // 다른 참여자의 경로를 볼 때 현재 사용자의 정상 ETA를 빌려 쓰지 않는다.
  const ownStatus = isInspectingTravelPlan ? undefined : status;
  if (intercityTicketSelected) return { departureLabel: '연결 경로 예상 출발', warning: '승차권 입력 시각 · 앞뒤 이동 예상 · 예매 상태 미검증' };
  if (intercityJourneySelected) return { departureLabel: '연결 경로 예상 출발', warning: '선택 편 시간표 · 앞뒤 운행·예매 미확인' };
  const verifiedProvider = ownStatus?.source === 'LIVE_PROVIDER' || ownStatus?.source === 'TIMETABLE_PROVIDER';
  if (verifiedProvider && getFreshDepartureTiming(ownStatus)) {
    return { departureLabel: '권장 출발' };
  }
  const intercityUnverified = ownStatus?.failureReason?.startsWith('TRANSIT_INTERCITY_TIMETABLE_UNAVAILABLE:');
  const unsupported = ownStatus?.failureReason?.startsWith('TRANSIT_ITINERARY_REFRESH_UNSUPPORTED');
  const onTimeUnavailable = ownStatus?.failureReason?.startsWith('TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE');
  const missedTransfer = ownStatus?.failureReason?.startsWith('TRANSIT_TRANSFER_MISSED');
  const arrivalUnavailable = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_UNAVAILABLE:');
  const arrivalOutOfHorizon = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_OUT_OF_HORIZON:');
  const notObserved = ownStatus?.failureReason?.startsWith('TRANSIT_TRAIN_NOT_YET_OBSERVED:');
  const sourceStale = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_SOURCE_STALE:');
  const sourceUnverified = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_SOURCE_UNVERIFIED:');
  const rateLimited = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_RATE_LIMITED:');
  const apiTimeout = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_API_TIMEOUT:');
  const apiError = ownStatus?.failureReason?.startsWith('TRANSIT_ARRIVAL_API_ERROR:');
  const warning = intercityUnverified
      ? '시외 운행시각 미확인 · 예매편 확인 필요'
      : onTimeUnavailable
      ? '현재 확인된 경로로 정시 도착 불가'
      : missedTransfer
      ? '환승 불가 · 경로 재확인 필요'
      : unsupported
      ? '재조회 미지원 · 경로 재선택 필요'
      : notObserved
      ? '미래 열차 실시간 미확인 · 시간표 예측 단계'
      : sourceStale
      ? '차량 관측정보 오래됨 · 저장 경로 기준'
      : sourceUnverified
      ? '차량 관측시각 검증 불가 · 저장 경로 기준'
      : rateLimited
      ? '도착정보 API 한도 초과 · 저장 경로 기준'
      : apiTimeout
      ? '도착정보 API 응답 지연 · 저장 경로 기준'
      : apiError
      ? '도착정보 API 오류 · 저장 경로 기준'
      : arrivalUnavailable
      ? '실시간 도착정보 없음 · 저장 경로 기준'
      : arrivalOutOfHorizon
      ? '실시간 조회 범위 밖 · 저장 경로 기준'
      : '운행시각 미확인 · 저장 경로 기준';
  return {
    departureLabel: '예상 출발',
    warning: preservingEarlierDeparture && !isInspectingTravelPlan
      ? `출발 시각 안전 유지 · ${warning}` : warning,
  };
}

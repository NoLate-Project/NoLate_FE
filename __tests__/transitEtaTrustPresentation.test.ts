import { getTransitEtaTrustPresentation } from '../src/modules/schedule/transitEtaTrustPresentation';

test('protected earlier departure remains estimated and explains why the clock is retained', () => {
  expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status({ stale: true,
    failureReason: 'TRANSIT_ITINERARY_REFRESH_UNSUPPORTED: unsupported' }), preservingEarlierDeparture: true }))
    .toEqual({ departureLabel: '예상 출발', warning: '출발 시각 안전 유지 · 재조회 미지원 · 경로 재선택 필요' });
});
import type { ScheduleDepartureStatus } from '../src/api/schedule';

const status = (override: Partial<ScheduleDepartureStatus> = {}): ScheduleDepartureStatus => ({
  scheduleId: 363, travelMinutes: 65, recommendedDepartureAt: '2026-10-03T16:40:00Z',
  evaluatedAt: '2026-10-03T16:00:00Z', liveFetchedAt: '2026-10-03T16:00:00Z',
  source: 'LIVE_PROVIDER', stale: false, confidence: 'HIGH', failureReason: null,
  lastTrafficChangeMinutes: null, lastChangedAt: null, nextCheckAt: null,
  preparationMinutes: null, preparationStartAt: null, safetyBufferMinutes: null, timeZone: 'Asia/Seoul',
  ...override,
});

describe('transit ETA trust presentation', () => {
  it.each([
    ['TRANSIT_TRAIN_NOT_YET_OBSERVED', '미래 열차 실시간 미확인 · 시간표 예측 단계'],
    ['TRANSIT_ARRIVAL_SOURCE_STALE', '차량 관측정보 오래됨 · 저장 경로 기준'],
    ['TRANSIT_ARRIVAL_SOURCE_UNVERIFIED', '차량 관측시각 검증 불가 · 저장 경로 기준'],
    ['TRANSIT_ARRIVAL_API_ERROR', '도착정보 API 오류 · 저장 경로 기준'],
    ['TRANSIT_ARRIVAL_RATE_LIMITED', '도착정보 API 한도 초과 · 저장 경로 기준'],
    ['TRANSIT_ARRIVAL_API_TIMEOUT', '도착정보 API 응답 지연 · 저장 경로 기준'],
  ])('separates %s without promoting it to accepted realtime', (code, warning) => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status({ stale: true,
      failureReason: `${code}: safe diagnostic` }) })).toEqual({ departureLabel: '예상 출발', warning });
  });
  it.each(['LIVE_PROVIDER', 'TIMETABLE_PROVIDER'] as const)('accepts a fresh verified %s snapshot', source => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status({ source }) }))
      .toEqual({ departureLabel: '권장 출발' });
  });
  it.each([
    undefined,
    status({ source: 'SELECTED_ROUTE', stale: true }),
    status({ source: 'SELECTED_ROUTE' }),
    status({ stale: true }),
    status({ failureReason: 'TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY: safe diagnostic' }),
    status({ recommendedDepartureAt: null }),
  ])('does not present unknown or degraded timing as a verified recommendation', snapshot => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: snapshot }))
      .toEqual({ departureLabel: '예상 출발', warning: '운행시각 미확인 · 저장 경로 기준' });
  });
  it('guides unsupported legacy transit routes back to route selection', () => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status({
      source: 'SELECTED_ROUTE', stale: true, failureReason: 'TRANSIT_ITINERARY_REFRESH_UNSUPPORTED: safe diagnostic',
    }) })).toEqual({ departureLabel: '예상 출발', warning: '재조회 미지원 · 경로 재선택 필요' });
  });
  it('does not borrow current member ETA when inspecting another plan', () => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status(), isInspectingTravelPlan: true }).warning)
      .toBe('운행시각 미확인 · 저장 경로 기준');
  });
  it('preserves a confirmed late-arrival diagnostic instead of calling it unknown', () => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status({ stale: true,
      failureReason: 'TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE: safe diagnostic',
    }) }).warning).toBe('현재 확인된 경로로 정시 도착 불가');
  });
  it('preserves a missed-transfer diagnostic', () => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: status({ stale: true,
      failureReason: 'TRANSIT_TRANSFER_MISSED: safe diagnostic',
    }) }).warning).toBe('환승 불가 · 경로 재확인 필요');
  });
  it('leaves other travel modes unchanged', () => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'CAR' })).toEqual({ departureLabel: '권장 출발' });
  });
  it.each([
    ['TRANSIT_ARRIVAL_UNAVAILABLE', '실시간 도착정보 없음 · 저장 경로 기준'],
    ['TRANSIT_ARRIVAL_OUT_OF_HORIZON', '실시간 조회 범위 밖 · 저장 경로 기준'],
  ])('exposes %s without promoting a rejected timetable result', (code, warning) => {
    const snapshot = status({ source: 'TIMETABLE_PROVIDER', stale: true, confidence: 'LOW',
      predictedArrivalAt: null, failureReason: code + ': safe diagnostic' });
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: snapshot }))
      .toEqual({ departureLabel: '예상 출발', warning });
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', status: snapshot,
      isInspectingTravelPlan: true }).warning).toBe('운행시각 미확인 · 저장 경로 기준');
  });
});

  test('a selected public intercity timetable does not borrow an earlier live city ETA', () => {
    expect(getTransitEtaTrustPresentation({ travelMode: 'TRANSIT', intercityJourneySelected: true, status: status({ source: 'LIVE_PROVIDER' }) }))
      .toEqual({ departureLabel: '연결 경로 예상 출발', warning: '선택 편 시간표 · 앞뒤 운행·예매 미확인' });
  });

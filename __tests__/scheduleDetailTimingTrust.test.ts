import type { ScheduleDepartureStatus } from '../src/api/schedule';
import { buildSavedRouteDetailInfo } from '../src/modules/schedule/savedRouteDetailPresentation';
import { buildRouteInfoFromAlternative, type RouteInfo } from '../src/modules/schedule/routeInfo';
import type { RouteAlternativeOption } from '../src/modules/map/routingService';
import { buildScheduleDetailPresentation } from '../src/routeSupport/schedule/scheduleDetailPresentationModel';
import type { ScheduleDetailController } from '../src/routeSupport/schedule/useScheduleDetailController';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/modules/schedule/components/detail/PlainScheduleDetailView', () => ({
  PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT: 60,
}));

function detail(overrides: Partial<ScheduleDetailController> = {}) {
  // Only presentation inputs are needed; navigation and mutation callbacks are not invoked.
  const controller = {
    colors: { selectedDayBg: '#000000' },
    currentMemberId: 296,
    departureDisplayState: { kind: 'countdown', hours: 1, minutes: 0, seconds: 0 },
    departureParticipants: [],
    displayPathOverlays: [{ coords: [{ lat: 37.65, lng: 127.06 }, { lat: 37.48, lng: 126.93 }] }],
    displayTravelMode: 'TRANSIT',
    currentTravelMinutes: 65,
    savedDisplayTravelMinutes: 65,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    isDark: false,
    item: {
      id: '363',
      title: 'ETA regression',
      startAt: '2026-10-04T02:45:00+09:00',
      endAt: '2026-10-04T03:30:00+09:00',
      travelMinutes: 65,
    },
    mapCoords: [],
    nowMs: new Date('2026-10-04T00:40:00+09:00').getTime(),
    recommendedDepartureAt: new Date('2026-10-04T01:40:00+09:00'),
    routeOption: { id: 'saved-transit', minutes: 65, transferCount: 1 },
    ...overrides,
  } as unknown as ScheduleDetailController;
  return buildScheduleDetailPresentation(controller)!;
}

it('shows matching saved endpoints once in the standard route header', () => {
  const endpoints = {
    displayOrigin: { name: '서울역[KTX정차역]' },
    displayDestination: { name: '강남역[수도권2호선]' },
  };
  const item = { ...detail().item, locationName: '강남역' };

  expect(detail({ ...endpoints, item })).toMatchObject({
    routeTitle: '서울역 → 강남역',
    routeIdentityTitle: '서울역[KTX정차역] → 강남역[수도권2호선]',
    showRouteIdentityInSheet: false,
  });
  expect(detail({ ...endpoints, item, largeRouteHeader: true })).toMatchObject({
    routeTitle: '강남역',
    showRouteIdentityInSheet: true,
  });
  expect(detail({ ...endpoints, item: { ...item, locationName: '회의실' } })).toMatchObject({
    routeTitle: '회의실',
    showRouteIdentityInSheet: true,
  });
  expect(detail({ ...endpoints, displayOrigin: { name: '서울역[서부 출입구]' }, item }).routeTitle)
    .toBe('서울역[서부 출입구] → 강남역');
});

describe('schedule detail timing trust', () => {
  it('uses the same 137, 157 and 73 second walks as the refreshed Nowon timetable', () => {
    // Reproduce the old eight-minute total beside the three walk durations captured from the Worker.
    const option: RouteAlternativeOption = {
      id: 'nowon-sillim', mode: 'TRANSIT', provider: 'odsay', source: 'api', minutes: 60,
      transitLegs: [
        { kind: 'WALK', label: '접근 도보', durationMinutes: 1, durationSeconds: 173 },
        { kind: 'SUBWAY', label: '4호선', durationMinutes: 47 },
        { kind: 'WALK', label: '환승 도보', durationMinutes: 3, durationSeconds: 157 },
        { kind: 'SUBWAY', label: '2호선', durationMinutes: 8 },
        { kind: 'WALK', label: '도착 도보', durationMinutes: 1, durationSeconds: 150 },
      ],
    };
    const saved = buildRouteInfoFromAlternative(option);
    expect(detail({ routeOption: option, routeDetailInfo: saved }).routeFactLabels).toContain('도보 8분');
    const intervals = [137, 157, 73];
    let index = 0;
    const matched: RouteInfo = { ...saved, matchedTimeline: true, matchedTimelineBasis: 'TIMETABLE',
      totalDurationMinutes: 67,
      steps: saved.steps.map(step => {
        if (step.type !== 'WALK') return step;
        const durationSeconds = intervals[index++];
        return { ...step, durationSeconds, durationMinutes: Math.ceil(durationSeconds / 60) };
      }),
    };
    const revised = detail({ routeOption: option, routeDetailInfo: matched });
    expect(revised.displayedRouteMinutes).toBe(67);
    expect(revised.routeDurationLabel).toBe('67분');
    expect(revised.routeFactLabels).toContain('도보 7분');
    expect(revised.routeFactLabels).not.toContain('도보 8분');
  });

  it('summarizes the saved timetable walk rather than the older provider walk', () => {
    const option: RouteAlternativeOption = {
      id: 'odsay-subway', mode: 'TRANSIT', provider: 'odsay', source: 'api', minutes: 20,
      transitLegs: [
        { kind: 'SUBWAY', label: '2호선', durationMinutes: 18 },
        { kind: 'WALK', label: '목적지 도보', durationMinutes: 5 },
      ],
      odsayTimetablePreview: {
        departureAt: '2026-10-03T17:20:00Z', arrivalAt: '2026-10-03T17:40:00Z',
        rides: [{ boardingAt: '2026-10-03T17:22:00Z', arrivalAt: '2026-10-03T17:36:52Z' }],
        transferTimings: [],
      },
    };
    const routeDetailInfo = buildRouteInfoFromAlternative(option);
    const presentation = detail({ routeOption: { ...option, odsayTimetablePreview: undefined }, routeDetailInfo });
    expect(presentation.routeWalkingMinutes).toBe(4);
    expect(presentation.routeFactLabels).toContain('도보 4분');
  });

  it('keeps transit details when the saved route has stops but no drawable lines', () => {
    const route = {
      id: 'saved-transit', mode: 'TRANSIT', minutes: 41, transferCount: 2,
      transitLegs: [{
        kind: 'BUS', label: '361', lineName: '361', startName: '승차 정류장', endName: '하차 정류장',
        passStops: [{ name: '경유 정류장' }],
      }],
    };
    const routeDetailInfo = buildSavedRouteDetailInfo({ route });
    const presentation = detail({ displayPathOverlays: [], routeDetailInfo });
    expect(presentation.hasDetailedRoute).toBe(true);
    expect(presentation.shouldRenderMap).toBe(false);
    expect(presentation.routeDetailInfo?.steps.find(step => step.type === 'BUS')?.passStops)
      .toEqual([expect.objectContaining({ name: '경유 정류장' })]);

    const durationOnly = detail({ displayPathOverlays: [] });
    expect(durationOnly.hasDetailedRoute).toBe(false);
    expect(durationOnly.routeSummaryTitle).toBe('상세 경로 미설정');
  });

  it('shows an estimate without repeating an unverified-time warning or claiming an arrival', () => {
    const presentation = detail();

    expect(presentation.departureTimeLabel).toBe('예상 출발');
    expect(presentation.routeSummaryTitle).toBe('저장한 경로');
    expect(presentation.routeDetailMeta).toBe('환승 1회');
    expect(presentation.routeDetailMeta).not.toContain('02:45 도착');
    expect(presentation.routeArrivalSummary).toBeUndefined();
  });

  it('omits the generic timing warning for a rejected route estimate', () => {
    // 실제 실패 당시 공개 API 응답이다. 현재 운행 정확도를 증명하는 표본으로 사용하지 않는다.
    const captured = require('./fixtures/eta-unverified-route-20261120.json') as ScheduleDepartureStatus;
    const presentation = detail({ departureStatus: captured });

    expect(presentation.departureTimeLabel).toBe('예상 출발');
    expect(presentation.routeArrivalSummary).toBeUndefined();
    expect(presentation.routeDetailMeta).toBe('환승 1회');
    expect(presentation.effectiveTransitRoutePresentation).toBeUndefined();
  });

  it('does not apply my failed route lookup to another participant’s saved estimate', () => {
    const captured = require('./fixtures/eta-unverified-route-20261120.json') as ScheduleDepartureStatus;
    const presentation = detail({
      departureStatus: captured,
      inspectedTravelPlan: { memberId: 297 } as ScheduleDetailController['inspectedTravelPlan'],
    });

    expect(presentation.departureTimeLabel).toBe('예상 출발');
    expect(presentation.routeArrivalSummary).toBeUndefined();
    expect(presentation.routeDetailMeta).toBe('환승 1회');
  });

  it('keeps a saved plan separate from a current-departure lookup after departure is recorded', () => {
    const routeDetailInfo = {
      id: 'saved-bus', originName: '출발지', destinationName: '도착지',
      totalDurationMinutes: 12, totalDurationSeconds: 720,
      departureTime: '2026-10-04T01:40:00+09:00', arrivalTime: '2026-10-04T01:52:00+09:00',
      timeBasis: 'estimated' as const,
      steps: [{ id: 'bus', type: 'BUS' as const, title: '402', durationMinutes: 12 }],
    };
    const currentTransitEstimate = {
      id: 'current', mode: 'TRANSIT' as const, provider: 'odsay' as const, source: 'api' as const, minutes: 12,
      providerDepartureAt: '2026-10-04T10:07:00+09:00', providerArrivalAt: '2026-10-04T10:19:00+09:00',
    };
    const input = { routeDetailInfo, currentTransitEstimate,
      currentMemberDepartedAt: '2026-10-04T01:35:00+09:00' };
    const saved = detail(input);
    expect(saved.departureTimeLabel).toBe('실제 출발');
    expect(saved.recommendedDepartureTimeLabel).toBe('01:35');
    expect(saved.routePlanTimeLabel).toBe('01:40 출발 계획');
    expect(saved.routeArrivalSummary).toBeUndefined();
    expect(saved.currentTransitClock).toBe('10:07 출발 기준 · 10:19 도착 예상');
    expect(detail({ ...input, navigationMode: true }).routeArrivalSummary)
      .toBe('10:07 출발 기준 · 10:19 도착 예상');
    expect(detail({ ...input, largeRouteHeader: true }).routeArrivalSummary)
      .toBe('10:07 출발 기준 · 10:19 도착 예상');
    expect(detail({ ...input, routeDetailInfo: { ...routeDetailInfo, departureTime: 'invalid' } }).routePlanTimeLabel)
      .toBeUndefined();
  });

  it('keeps confirmed late-arrival diagnostics visible in the expanded route metadata', () => {
    const presentation = detail({
      departureStatus: {
        source: 'LIVE_PROVIDER',
        stale: true,
        failureReason: 'TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE: safe diagnostic',
      } as ScheduleDepartureStatus,
    });

    expect(presentation.routeSummaryTitle).toBe('저장한 경로');
    expect(presentation.routeDetailMeta).toBe('현재 확인된 경로로 정시 도착 불가 · 환승 1회');
  });

  it.each(['CAR', 'WALK', 'BIKE', 'ETC'] as const)('preserves %s route title and target metadata', displayTravelMode => {
    const presentation = detail({ displayTravelMode });

    expect(presentation.departureTimeLabel).toBe('권장 출발');
    expect(presentation.routeSummaryTitle).toBe('최적 경로');
    expect(presentation.routeDetailMeta).toBe('02:45 도착 · 환승 1회');
  });
});

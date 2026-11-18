import type { ScheduleDepartureStatus } from '../src/api/schedule';
import { buildSavedRouteDetailInfo } from '../src/modules/schedule/savedRouteDetailPresentation';
import { buildRouteInfoFromAlternative } from '../src/modules/schedule/routeInfo';
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

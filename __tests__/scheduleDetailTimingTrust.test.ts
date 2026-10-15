import type { ScheduleDepartureStatus } from '../src/api/schedule';
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

describe('schedule detail timing trust', () => {
  it('keeps the expanded route metadata consistent with the unverified ETA warning', () => {
    const presentation = detail();

    expect(presentation.departureTimeLabel).toBe('예상 출발');
    expect(presentation.routeSummaryTitle).toBe('저장한 경로');
    expect(presentation.routeDetailMeta).toBe('운행시각 미확인 · 저장 경로 기준 · 환승 1회');
    expect(presentation.routeDetailMeta).not.toContain('02:45 도착');
    expect(presentation.routeArrivalSummary).toBe('운행시각 미확인 · 저장 경로 기준');
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

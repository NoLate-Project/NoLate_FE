const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailControllerSource = readFileSync(
  'src/routeSupport/schedule/useScheduleDetailController.tsx',
  'utf8',
);
const departureStatusControllerSource = readFileSync(
  'src/routeSupport/schedule/useScheduleDepartureStatusController.ts',
  'utf8',
);
const mapControllerSource = readFileSync(
  'src/routeSupport/schedule/useScheduleDetailMapController.ts',
  'utf8',
);
const presentationSource = readFileSync(
  'src/routeSupport/schedule/scheduleDetailPresentationModel.ts',
  'utf8',
);
const routePresentationSource = [
  readFileSync('src/routeSupport/schedule/ScheduleDetailRouteQuickSummary.tsx', 'utf8'),
  readFileSync('src/routeSupport/schedule/ScheduleDetailRouteSheet.tsx', 'utf8'),
].join('\n');
const scheduleDetailSources = [
  detailControllerSource,
  departureStatusControllerSource,
  mapControllerSource,
  presentationSource,
  routePresentationSource,
].join('\n');

describe('schedule detail effective transit route integration', () => {
  it('loads departure status independently without replacing the saved schedule request', () => {
    expect(departureStatusControllerSource).toContain(
      'getScheduleDepartureStatus(requestedScheduleId)',
    );
    expect(detailControllerSource).toContain('getSchedule(id)');
    expect(departureStatusControllerSource).toContain(
      '보조 ETA 재조회 실패는 저장 일정 조회를 막지 않는다.',
    );
    expect(departureStatusControllerSource).toContain(
      'resolveAcceptedDepartureStatus(status)',
    );
  });

  it('refreshes on focus, foreground activation, and a bounded nextCheckAt timer', () => {
    expect(departureStatusControllerSource).toContain(
      'const isFocused = useIsFocused();',
    );
    expect(departureStatusControllerSource).toContain(
      "AppState.addEventListener('change'",
    );
    expect(departureStatusControllerSource).toContain(
      "appStateStatus === 'active'",
    );
    expect(departureStatusControllerSource).toContain(
      'refreshEligibleRef.current',
    );
    expect(departureStatusControllerSource).toContain(
      'getDepartureStatusRefreshDelay({',
    );
    expect(departureStatusControllerSource).toContain(
      'nextCheckAt: departureStatusNextCheckAt',
    );
    expect(departureStatusControllerSource).toContain(
      'const timeoutId = setTimeout(() => {',
    );
    expect(departureStatusControllerSource).toContain('requestRef.current');
    expect(departureStatusControllerSource).toContain(
      'requestGenerationRef.current === requestGeneration',
    );
    expect(departureStatusControllerSource).toContain(
      '포커스를 잃거나 경로 편집·저장에 진입하면 기존 요청 문맥을 즉시 무효화한다.',
    );
    expect(departureStatusControllerSource).toContain(
      'isDepartureStatusLocallyExpired({',
    );
    expect(departureStatusControllerSource).toContain(
      'etaRefreshDueAt: etaRefreshDueAtRef.current',
    );
    expect(departureStatusControllerSource).toContain(
      'evaluatedAt: evaluatedAtRef.current',
    );
    expect(departureStatusControllerSource).toContain(
      '만료된 요청 실패도 최소 주기로 반복하지 않고 기본 재시도 간격을 사용한다.',
    );
    expect(departureStatusControllerSource).toContain(
      'setAcceptedDepartureStatus(undefined)',
    );
  });

  it('keeps saved map geometry and renders an alternative only as text guidance', () => {
    expect(mapControllerSource).toContain(
      'const displayRoute = inspectedTravelPlan?.route ?? item?.route;',
    );
    expect(mapControllerSource).toContain('const savedDisplayTravelMinutes =');
    expect(detailControllerSource).toContain(
      'isInspectingTravelPlan: Boolean(inspectedTravelPlan)',
    );
    expect(presentationSource).toContain(
      "typeof savedDisplayTravelMinutes === 'number'",
    );
    expect(presentationSource).toContain(
      "typeof currentTravelMinutes === 'number'",
    );
    expect(detailControllerSource).toContain(
      'buildEffectiveTransitRoutePresentation(departureStatus)',
    );
    expect(routePresentationSource).toContain('실시간 추천 경로');
    expect(routePresentationSource).toContain(
      'effectiveTransitRoutePresentation.mapNote',
    );
    expect(scheduleDetailSources).not.toContain(
      'displayRoute = departureStatus',
    );
    expect(scheduleDetailSources).not.toContain(
      'route: departureStatus.effectiveTransitRoute',
    );
    expect(presentationSource).toContain(
      '`일정 ${arrivalTimeLabel} · 현재 이동 ${currentRouteDurationLabel}`',
    );
  });
});

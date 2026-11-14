const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const inboxSource = readFileSync('app/share/inbox.tsx', 'utf8');
const detailSource = [
  'app/schedule/[id].tsx',
  'src/routeSupport/schedule/ScheduleDetailLayout.tsx',
  'src/routeSupport/schedule/ScheduleDetailRouteSheet.tsx',
  'src/routeSupport/schedule/ScheduleDetailRouteQuickSummary.tsx',
  'src/routeSupport/schedule/ScheduleDetailBackground.tsx',
  'src/routeSupport/schedule/ScheduleDetailHeader.tsx',
  'src/routeSupport/schedule/ScheduleDetailChrome.tsx',
  'src/routeSupport/schedule/useScheduleDetailSheetController.ts',
  'src/routeSupport/schedule/scheduleDetailPresentationModel.ts',
]
  .map(path => readFileSync(path, 'utf8'))
  .join('\n');

describe('schedule departure nudge placement', () => {
  test('sharing membership management does not expose a departure nudge action', () => {
    expect(inboxSource).not.toContain('sendScheduleDepartureNudge');
    expect(inboxSource).not.toContain('에게 출발 알림 보내기');
  });

  test('the companion row keeps route selection and nudge confirmation separate', () => {
    const start = detailSource.indexOf('const renderRouteCompanions');
    const end = detailSource.indexOf('return (', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const participantProfiles = detailSource.slice(start, detailSource.indexOf('renderRouteCompanions={', end));
    expect(participantProfiles).toContain('onPress={() => confirmDepartureNudge(memberId, label)}');
    expect(participantProfiles).toContain('name="notifications-outline"');
  });

  test('the expandable companion summary shows the people count and departures', () => {
    expect(detailSource).toContain('함께하는 사람 {companionCount}명');
    expect(detailSource).toContain('${departureOverview.departedCount}명 출발');
    expect(detailSource).toContain('accessibilityState={{ expanded: participantsExpanded }}');
  });
});

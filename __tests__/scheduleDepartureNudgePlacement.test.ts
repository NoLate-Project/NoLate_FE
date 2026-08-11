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

  test('waiting participant profile owns the nudge interaction with a compact bell badge', () => {
    const start = detailSource.indexOf('const renderDepartureParticipantChips');
    const end = detailSource.indexOf('const renderTravelPlanRows', start);
    const participantProfiles = detailSource.slice(start, end);
    const compactParticipantProfiles = participantProfiles.replace(/\s+/g, '');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(compactParticipantProfiles).toContain(
      'onPress={()=>confirmDepartureNudge(participant.memberId,participant.label)}',
    );
    expect(participantProfiles).toContain('name="notifications"');
    expect(participantProfiles).toContain(
      '프로필을 누르면 해당 참가자의 기기로 출발 확인 푸시를 보냅니다.',
    );
  });

  test('shared people line uses the compact schedule mockup wording', () => {
    expect(detailSource).toContain(
      '함께하는 사람 {departureParticipants.length}',
    );
    expect(detailSource).toContain('{departureCountLabel} 출발');
    expect(detailSource).not.toContain(
      '{departureOverview.movingLabel} · {departureCountLabel} 출발',
    );
  });
});

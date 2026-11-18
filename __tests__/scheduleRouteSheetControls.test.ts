const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

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
const detailStyleSource = [
  'src/routeSupport/schedule/schedule-detail.styles.ts',
  'src/routeSupport/schedule/scheduleDetailStyles/improved.ts',
]
  .map(path => readFileSync(path, 'utf8'))
  .join('\n');

describe('schedule route sheet controls', () => {
  test('the sheet handle offers expand and collapse in both entry points', () => {
    const handleStart = detailSource.indexOf(
      'testID="schedule-route-sheet-handle"',
    );
    const handleEnd = detailSource.indexOf('</Pressable>', handleStart);
    const handleSource = detailSource.slice(handleStart, handleEnd);

    expect(handleStart).toBeGreaterThanOrEqual(0);
    expect(handleEnd).toBeGreaterThan(handleStart);
    expect(handleSource).toContain("expanded ? '경로 시트 접기' : '경로 시트 펼치기'");
    expect(handleSource).toContain("snapSheet(expanded ? 'compact' : 'expanded')");
    expect(handleSource).toContain("expanded ? 'chevron-down-outline' : 'chevron-up-outline'");
    expect(detailSource).toContain('const SHEET_HANDLE_HEIGHT = 44;');
  });

  test('shared people are always controlled by one animated disclosure', () => {
    expect(detailSource).not.toContain('hasParticipantTravelPlans');
    expect(detailSource).toMatch(/onPress=\{\(\) => \{\s*revealRequest\.current \+= 1;\s*shouldRevealCompanion\.current = !participantsExpanded;\s*toggleParticipantsExpanded\(\);/);
    expect(detailSource).toContain(
      'accessibilityState={{ expanded: participantsExpanded }}',
    );
    expect(detailSource).toMatch(
      /참여자 목록 \$\{\s*participantsExpanded \? ['"]접기['"] : ['"]보기['"]\s*\}/,
    );
    expect(detailSource).toContain('{participantsExpanded ? (');
    expect(detailSource).toContain(
      'configureParticipantDisclosureAnimation(nextExpanded)',
    );
    expect(detailSource).toContain('renderRouteCompanions(revealFirstCompanion,');
  });

  test('compact sheet keeps the safe area while removing forced body slack', () => {
    expect(detailSource).toContain(
      'const IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT = 196;',
    );
    expect(detailStyleSource).toContain('minHeight: 120,');
    expect(detailSource).toContain('IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT * Math.max(1, fontScale)');
    expect(detailSource).toContain(') + bottomInset');
  });
});

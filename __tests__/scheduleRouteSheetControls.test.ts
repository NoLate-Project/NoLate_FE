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
  test('expanded sheet exposes a dedicated collapse button', () => {
    const collapseStart = detailSource.indexOf(
      'testID="schedule-route-sheet-collapse"',
    );
    const collapseEnd = detailSource.indexOf('</Pressable>', collapseStart);
    const collapseButtonSource = detailSource.slice(collapseStart, collapseEnd);

    expect(collapseStart).toBeGreaterThanOrEqual(0);
    expect(collapseEnd).toBeGreaterThan(collapseStart);
    expect(detailSource).toContain('testID="schedule-route-sheet-collapse"');
    expect(detailSource).toContain('accessibilityLabel="일정 상세 시트 접기"');
    expect(collapseButtonSource).toMatch(
      /onPress=\{\(\) => snapSheet\(["']compact["']\)\}/,
    );
    expect(collapseButtonSource).toMatch(
      /name=["']chevron-down["']\s+size=\{16\}/,
    );
  });

  test('shared people are always controlled by one animated disclosure', () => {
    expect(detailSource).not.toContain('hasParticipantTravelPlans');
    expect(detailSource).toContain('onPress={toggleParticipantsExpanded}');
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
    expect(detailSource).toContain('{renderDepartureParticipantChips()}');
    expect(detailSource).toContain('{renderTravelPlanRows()}');
  });

  test('compact sheet keeps the safe area while removing forced body slack', () => {
    expect(detailSource).toContain(
      'const IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT = 196;',
    );
    expect(detailStyleSource).toContain('minHeight: 120,');
    expect(detailSource).toMatch(
      /IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT \+ (?:insets\.bottom|bottomInset)/,
    );
  });
});

const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = [
  'app/schedule/[id].tsx',
  'app/schedule/ScheduleDetailLayout.tsx',
  'app/schedule/ScheduleDetailRouteSheet.tsx',
  'app/schedule/ScheduleDetailRouteQuickSummary.tsx',
  'app/schedule/ScheduleDetailBackground.tsx',
  'app/schedule/ScheduleDetailHeader.tsx',
  'app/schedule/ScheduleDetailChrome.tsx',
  'app/schedule/useScheduleDetailSheetController.ts',
  'app/schedule/scheduleDetailPresentationModel.ts',
]
  .map(path => readFileSync(path, 'utf8'))
  .join('\n');
const detailStyleSource = [
  'app/schedule/schedule-detail.styles.ts',
  'app/schedule/scheduleDetailStyles/fallback.ts',
  'app/schedule/scheduleDetailStyles/header.ts',
  'app/schedule/scheduleDetailStyles/improved.ts',
  'app/schedule/scheduleDetailStyles/route.ts',
  'app/schedule/scheduleDetailStyles/sheetBase.ts',
  'app/schedule/scheduleDetailStyles/status.ts',
]
  .map(path => readFileSync(path, 'utf8'))
  .join('\n');
const detailModuleSource = `${detailSource}\n${detailStyleSource}`;
const compactDetailSource = detailModuleSource.replace(/\s+/g, ' ');
const previewSource = readFileSync(
  'app/internal/schedule-ui-preview.tsx',
  'utf8',
);
const previewStyleSource = readFileSync(
  'app/internal/schedule-ui-preview.styles.ts',
  'utf8',
);
const compactSyntax = (source: string) => source.replace(/\s+/g, '');

describe('plain schedule detail route layout', () => {
  test('일반 일정만 더 가까운 콘텐츠 시작점과 중앙 제목 슬롯을 사용한다', () => {
    expect(compactSyntax(detailModuleSource)).toContain(
      'contentTopInset={plainHeaderHeight+PLAIN_SCHEDULE_DETAIL_CONTENT_GAP}',
    );
    expect(compactDetailSource).toContain(
      'const plainHeaderHeight = insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT',
    );
    expect(compactDetailSource).toContain(
      '...(isPlainSchedule ? { height: plainHeaderHeight } : null)',
    );
    expect(detailModuleSource).toContain(
      'isPlainSchedule && styles.plainTopHeaderContent',
    );
    expect(detailModuleSource).toContain(
      'isPlainSchedule && styles.plainTopHeaderTitleRow',
    );
    expect(detailModuleSource).toContain(
      'isPlainSchedule && styles.plainTopHeaderActions',
    );
    expect(detailModuleSource).toContain('left: 88');
    expect(detailModuleSource).toContain('right: 88');
    expect(compactSyntax(detailModuleSource)).toMatch(
      /name=\{isPlainSchedule\?['"]pencil-outline['"]:['"]create-outline['"]\}/,
    );
    expect(compactSyntax(detailModuleSource)).toContain(
      'color={isPlainSchedule?topCardAccentText:primaryText}',
    );
  });

  test('내부 미리보기도 운영 상세와 같은 상단 간격과 편집 액션을 사용한다', () => {
    expect(compactSyntax(previewSource)).toContain(
      'contentTopInset={headerHeight+PLAIN_SCHEDULE_DETAIL_CONTENT_GAP}',
    );
    expect(previewSource).toContain(
      'const headerHeight = insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT',
    );
    expect(previewSource).toContain(
      'contentBottomInset={Math.max(insets.bottom + 32, 48)}',
    );
    expect(previewSource).toContain('accessibilityLabel="일정 공유"');
    expect(previewSource).toContain(
      '<Ionicons name="pencil-outline" size={19} color={accent} />',
    );
    expect(previewStyleSource).toContain('width: 44');
    expect(previewStyleSource).toContain('height: 44');
    expect(previewStyleSource).toContain('left: 88');
    expect(previewStyleSource).toContain('right: 88');
  });

  test('내부 미리보기에서 수정 화면과 빠른 일정의 개별 필드를 직접 검증할 수 있다', () => {
    expect(previewSource).toContain('function EditPreview({');
    expect(previewSource).toContain(
      'dispatch({ type: "UPDATE_ITEM", item: previewItem })',
    );
    expect(previewSource).toContain('initialPreviewField={quickPreviewField}');
    expect(previewSource).toContain('categories={previewCategories}');
    expect(previewSource).toContain('title: "업무"');
    expect(previewSource).toContain(
      'initialCategoryPickerOpen={params.category === "open"}',
    );
    expect(previewSource).toContain(
      'if (screen === "route") return <RouteInputPreview />',
    );
    expect(previewSource).toContain('return <RouteSelectScreen />');
    expect(previewSource).toContain(
      'router.setParams({ sessionId, editTarget: "destination" })',
    );
    expect(previewSource).toContain(
      'type QuickPreviewField = "title" | "date" | "time" | "location" | "notification" | "memo"',
    );
  });
});

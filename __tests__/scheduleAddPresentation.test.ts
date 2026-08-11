const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const scheduleIndexSource = readFileSync(
  'src/modules/schedule/components/list/ScheduleIndexScreenContent.tsx',
  'utf8',
);

describe('schedule add presentation', () => {
  test('직접 입력 일정은 플랫폼과 관계없이 모프 카드로 연다', () => {
    expect(scheduleIndexSource).toContain('presentation="morph"');
    expect(scheduleIndexSource).not.toContain(
      'presentation={usesLiquidViewModeControl ? "morph" : "sheet"}',
    );
  });
});

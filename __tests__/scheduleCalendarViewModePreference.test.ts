const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};

export {};

const scheduleRouteSource = readFileSync('app/schedule/index.tsx', 'utf8');
const scheduleStateSource = readFileSync(
  'src/modules/schedule/hooks/useScheduleIndexState.ts',
  'utf8',
);
const viewModeTransitionSource = readFileSync(
  'src/modules/schedule/hooks/useScheduleIndexViewModeTransition.ts',
  'utf8',
);

function normalizeSourceContract(value: string): string {
  return value.replace(/'/g, '"').replace(/\s+/g, ' ').trim();
}

expect.extend({
  toContain(received: unknown, expected: unknown) {
    const pass =
      typeof received === 'string' && typeof expected === 'string'
        ? normalizeSourceContract(received).includes(
            normalizeSourceContract(expected),
          )
        : Array.isArray(received) && received.includes(expected);
    return {
      pass,
      message: () =>
        `expected normalized source ${pass ? 'not ' : ''}to contain ${String(
          expected,
        )}`,
    };
  },
});

function sourceBetween(source: string, start: string, end: string) {
  const normalizedSource = normalizeSourceContract(source);
  const normalizedStart = normalizeSourceContract(start);
  const normalizedEnd = normalizeSourceContract(end);
  const startIndex = normalizedSource.indexOf(normalizedStart);
  const endIndex = normalizedSource.indexOf(normalizedEnd, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return normalizedSource.slice(startIndex, endIndex);
}

describe('schedule calendar view mode preference wiring', () => {
  test('mounts immediately from memory or the default while restoring storage', () => {
    const preferenceGate = scheduleRouteSource;

    expect(preferenceGate).toContain('getCachedCalendarViewModePreference()');
    expect(preferenceGate).toContain('?? DEFAULT_CALENDAR_VIEW_MODE');
    expect(preferenceGate).toContain('loadCalendarViewModePreference()');
    expect(preferenceGate).not.toContain('if (!initialCalendarViewMode)');
    expect(preferenceGate).toContain(
      'initialCalendarViewMode={initialCalendarViewMode}',
    );
  });

  test('initializes the mode, retained panel, and motion values from one preference', () => {
    const initialization = sourceBetween(
      scheduleStateSource,
      'export function useScheduleIndexState',
      'const monthViewTransitionGenerationRef',
    );

    expect(normalizeSourceContract(initialization)).toContain(
      normalizeSourceContract(
        'useState<CalendarViewMode>(\n        initialCalendarViewMode',
      ),
    );
    expect(initialization).toContain(
      'getMonthAgendaPanelKind(initialCalendarViewMode) ?? "detail"',
    );
    expect(initialization).toContain(
      'CALENDAR_DAY_HEIGHTS[initialCalendarViewMode]',
    );
  });

  test('persists selections only through the shared view-mode handler', () => {
    const handler = sourceBetween(
      viewModeTransitionSource,
      'const handleCalendarViewModeChange',
      'const handleDayViewMenuSelect',
    );

    expect(handler).toContain('rememberCalendarViewModePreference(nextMode)');
    expect(handler).toContain('setCalendarViewMode(nextMode)');
  });
});

import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../src/api/schedule', () => ({
  getCalendarSchedules: jest.fn(),
  synchronizeCalendarScheduleCacheRevision: jest.fn().mockResolvedValue(false),
}));
jest.mock('../src/api/calendar', () => ({ getCalendarDays: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/modules/auth/authStorage', () => ({
  getAuthMember: jest.fn().mockResolvedValue({ id: 6 }),
}));
jest.mock('../src/modules/performance/interactionPerformance', () => ({
  beginPerformanceInteraction: () => ({ finish: jest.fn() }),
  measurePerformanceInteraction: (_name: string, _route: string, work: () => Promise<unknown>) => work(),
}));

import { getCalendarSchedules } from '../src/api/schedule';
import { useScheduleIndexCalendarData } from '../src/modules/schedule/hooks/useScheduleIndexCalendarData';
import {
  CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS,
  readCalendarScheduleCache,
} from '../src/modules/schedule/calendarScheduleCache';
import { getMonthRange } from '../src/modules/schedule/calendarRange';
import { resetCalendarMetadataRetryState } from '../src/modules/schedule/calendarMetadataRetry';
import type { ScheduleItem } from '../src/modules/schedule/types';

type Options = Parameters<typeof useScheduleIndexCalendarData>[0];
type Action = Parameters<Options['dispatch']>[0];
function ref<T>(current: T) { return { current }; }
let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
  await CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS!.resetMemory();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('warms an unfocused calendar without replacing visible detail and publishes when focused', async () => {
  const range = getMonthRange('2026-11-01');
  const detail: ScheduleItem = {
    id: '16', title: '가져온 버스 일정', notes: '확인한 승차권 상세 메모',
    startAt: '2026-11-05T05:45:00Z', endAt: '2026-11-05T05:45:00Z',
    category: { id: '6', title: '업무', color: '#F00' },
  };
  const summary: ScheduleItem = { ...detail, notes: undefined };
  const items = ref<Record<string, ScheduleItem>>({ '16': detail });
  const dispatch: Options['dispatch'] = jest.fn((action: Action) => {
    if (action.type === 'SET_ITEMS') {
      items.current = Object.fromEntries(action.items.map(item => [item.id, item]));
    }
  });
  let resolveRows: ((rows: ScheduleItem[]) => void) | undefined;
  (getCalendarSchedules as jest.Mock).mockReturnValue(new Promise<ScheduleItem[]>(resolve => {
    resolveRows = resolve;
  }));
  const target = '2026-11';
  const options: Omit<Options, 'isFocused'> = {
    calendarMetadataInFlightMonthKeysRef: ref(new Set<string>()),
    calendarMetadataLoadPendingRef: ref(false),
    calendarMetadataLoadedMonthKeysRef: ref(new Set<string>()),
    calendarMetadataMountedRef: ref(true),
    calendarMetadataPrefetchMonthKeys: [], calendarMetadataRetrySequence: 0,
    calendarMetadataRetryStateRef: ref(resetCalendarMetadataRetryState(target)),
    calendarMetadataRetryTargetKey: target, calendarMetadataRetryTargetKeyRef: ref(target),
    calendarMetadataRetryTimerRef: ref(null), calendarRevisionSyncPromiseRef: ref(null),
    detailMonthMotionActiveRef: ref(false), dispatch, fetchVisibleMonth: '2026-11-01', firstDay: 0,
    getErrorMessage: String, pendingCalendarMetadataByDateRef: ref({}),
    pendingScheduleSnapshotRef: ref(null), scheduleFetchStartAt: range.startAt,
    scheduleFetchEndAt: range.endAt, scheduleItemsByIdRef: items, scheduleLoadSequenceRef: ref(0),
    setCalendarDaysByDate: jest.fn(), setCalendarMetadataRetrySequence: jest.fn(),
  };
  function Harness({ focused }: { focused: boolean }) {
    useScheduleIndexCalendarData({ ...options, isFocused: focused });
    return null;
  }
  await act(async () => { renderer = TestRenderer.create(<Harness focused={false} />); });
  expect(getCalendarSchedules).toHaveBeenCalledTimes(1);
  await act(async () => { resolveRows?.([summary]); });

  expect(readCalendarScheduleCache(range.startAt, range.endAt).items).toEqual([summary]);
  expect(items.current['16']).toBe(detail);
  expect(items.current['16'].notes).toBe('확인한 승차권 상세 메모');

  await act(async () => { renderer!.update(<Harness focused />); });
  expect(items.current['16']).toEqual(summary);
  expect(getCalendarSchedules).toHaveBeenCalledTimes(1);
});

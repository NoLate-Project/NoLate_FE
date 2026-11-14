import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../src/api/api', () => ({
  apiGet: jest.fn(), apiPost: jest.fn(), apiPut: jest.fn(), apiDelete: jest.fn(),
}));

import { apiGet } from '../src/api/api';
import { getCalendarSchedules, synchronizeCalendarScheduleCacheRevision } from '../src/api/schedule';
import {
  activateCalendarScheduleCacheForAuthenticatedAccount,
  CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS,
  getCalendarScheduleCacheServerRevision,
  readCalendarScheduleCache,
  refreshCalendarScheduleCache,
} from '../src/modules/schedule/calendarScheduleCache';
import { getMonthRange } from '../src/modules/schedule/calendarRange';
import type { ScheduleItem } from '../src/modules/schedule/types';

const constants = CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS!;

afterEach(async () => {
  await constants.resetMemory();
  await AsyncStorage.clear();
});

it('revalidates restored months with an unknown revision before trusting an external ticket addition', async () => {
  const range = getMonthRange('2026-08-01');
  const existing: ScheduleItem = {
    id: '101', title: '기존 일정',
    startAt: '2026-08-17T03:00:00Z', endAt: '2026-08-17T04:00:00Z',
    category: { id: '1', title: '개인', color: '#246BFE' },
  };
  await activateCalendarScheduleCacheForAuthenticatedAccount(7);
  await refreshCalendarScheduleCache(range.startAt, range.endAt, async () => [existing]);
  await constants.flushPersistence();
  await constants.resetMemory();
  await activateCalendarScheduleCacheForAuthenticatedAccount(7);
  expect(getCalendarScheduleCacheServerRevision()).toBeNull();
  expect(readCalendarScheduleCache(range.startAt, range.endAt).items.map(item => item.id)).toEqual(['101']);

  (apiGet as jest.Mock).mockResolvedValueOnce({ success: true, data: { revision: 22 } });
  await expect(synchronizeCalendarScheduleCacheRevision()).resolves.toBe(true);

  const imported: ScheduleItem = {
    ...existing, id: '202', title: '공유로 추가한 승차권', routeSetupRequired: true,
  };
  (apiGet as jest.Mock).mockResolvedValueOnce({ success: true, data: [existing, imported] });
  await refreshCalendarScheduleCache(range.startAt, range.endAt, getCalendarSchedules);
  expect(readCalendarScheduleCache(range.startAt, range.endAt).items.map(item => item.id).sort()).toEqual(['101', '202']);
  expect(apiGet).toHaveBeenLastCalledWith('/api/schedules/calendar', {
    params: { startAt: range.startAt, endAt: range.endAt },
  });
});

it('never persists old month data under a new revision if the app stops between storage writes', async () => {
  const cache = require('../src/modules/schedule/calendarScheduleCache') as typeof import('../src/modules/schedule/calendarScheduleCache');
  const range = getMonthRange('2026-08-01');
  await activateCalendarScheduleCacheForAuthenticatedAccount(8);
  cache.setCalendarScheduleCacheServerRevision(21);
  await refreshCalendarScheduleCache(range.startAt, range.endAt, async () => [{
    id: '101', title: '서버 갱신 전 캐시',
    startAt: '2026-08-17T03:00:00Z', endAt: '2026-08-17T04:00:00Z',
    category: { id: '1', title: '개인', color: '#246BFE' },
  }]);
  await constants.flushPersistence();
  (AsyncStorage.setItem as jest.Mock).mockClear();

  (apiGet as jest.Mock).mockResolvedValueOnce({ success: true, data: { revision: 22 } });
  await expect(synchronizeCalendarScheduleCacheRevision()).resolves.toBe(true);
  await constants.flushPersistence();

  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls
    .filter(([key]) => key === constants.persistedCacheKey(8))
    .map(([, value]) => JSON.parse(value));
  expect(writes.length).toBeGreaterThan(0);
  for (const snapshot of writes) {
    if (snapshot.serverRevision === 22) {
      expect(snapshot.months.flatMap((month: { items: ScheduleItem[] }) => month.items)).toEqual([]);
    }
  }
});

it('keeps legacy summaries as an offline fallback but never trusts their revision or freshness', async () => {
  const key = constants.persistedCacheKey(9);
  const range = getMonthRange('2026-08-01');
  const legacy = {
    id: '101', title: '오프라인에서 유지할 기존 일정',
    startAt: '2026-08-17T03:00:00Z', endAt: '2026-08-17T04:00:00Z',
    category: { id: '1', title: '개인', color: '#246BFE' },
  };
  await AsyncStorage.setItem(key, JSON.stringify({
    version: 1, memberId: 9, savedAt: Date.now(), serverRevision: 22,
    months: [{ key: '2026-08', fetchedAt: Date.now(), items: [legacy] }],
  }));
  await activateCalendarScheduleCacheForAuthenticatedAccount(9);
  expect(getCalendarScheduleCacheServerRevision()).toBeNull();
  const offline = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(refreshCalendarScheduleCache(range.startAt, range.endAt, offline)).rejects.toThrow('offline');
  expect(offline).toHaveBeenCalledTimes(1);
  expect(readCalendarScheduleCache(range.startAt, range.endAt).items).toEqual([legacy]);

  const online = jest.fn().mockResolvedValue([legacy, { ...legacy, id: '202', title: '나중에 공유한 표' }]);
  await refreshCalendarScheduleCache(range.startAt, range.endAt, online);
  expect(online).toHaveBeenCalledTimes(1);
  expect(readCalendarScheduleCache(range.startAt, range.endAt).items.map(item => item.id).sort()).toEqual(['101', '202']);
});

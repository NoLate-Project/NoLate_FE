import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  activateCalendarScheduleCacheForAuthenticatedAccount,
  CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS,
  clearPersistedCalendarScheduleCacheForAccount,
  getCalendarScheduleCacheServerRevision,
  hasCalendarScheduleMonthCache,
  prewarmCalendarScheduleCachePersistence,
  readCalendarScheduleCache,
  refreshCalendarScheduleCache,
  setCalendarScheduleCacheServerRevision,
} from '../src/modules/schedule/calendarScheduleCache';
import { getMonthRange } from '../src/modules/schedule/calendarRange';
import type { ScheduleItem } from '../src/modules/schedule/types';

const constants = CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS!;

function persistedSchedule(): ScheduleItem {
  return {
    id: '101',
    title: '복원할 일정',
    startAt: '2026-08-17T03:00:00.000Z',
    endAt: '2026-08-17T04:00:00.000Z',
    category: { id: '1', title: '개인', color: '#2F80FF' },
    notes: 'disk-cache-secret-note',
    origin: { name: '집', lat: 37.1, lng: 127.1 },
    destination: { name: '회사', lat: 37.2, lng: 127.2 },
    route: { encodedPath: 'disk-cache-secret-route' },
  };
}

describe('account-scoped persistent calendar schedule cache', () => {
  beforeEach(async () => {
    await constants.resetMemory();
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    await constants.resetMemory();
    await AsyncStorage.clear();
  });

  it('restores the signed-in account month and revision after a process restart', async () => {
    const august = getMonthRange('2026-08-01');
    await activateCalendarScheduleCacheForAuthenticatedAccount(7);
    setCalendarScheduleCacheServerRevision(31);
    await refreshCalendarScheduleCache(
      august.startAt,
      august.endAt,
      jest.fn().mockResolvedValue([persistedSchedule()]),
    );
    await constants.flushPersistence();

    const storageKey = constants.persistedCacheKey(7);
    const raw = await AsyncStorage.getItem(storageKey);
    expect(raw).toContain('복원할 일정');
    expect(raw).not.toContain('disk-cache-secret-note');
    expect(raw).not.toContain('disk-cache-secret-route');
    expect(raw).not.toContain('37.1');

    await constants.resetMemory();
    await activateCalendarScheduleCacheForAuthenticatedAccount(7);

    expect(hasCalendarScheduleMonthCache('2026-08-17')).toBe(true);
    expect(getCalendarScheduleCacheServerRevision()).toBe(31);
    expect(readCalendarScheduleCache(august.startAt, august.endAt).items).toEqual([
      expect.objectContaining({ id: '101', title: '복원할 일정' }),
    ]);
  });

  it('never hydrates another account cache and removes the current account cache on cleanup', async () => {
    const august = getMonthRange('2026-08-01');
    await activateCalendarScheduleCacheForAuthenticatedAccount(7);
    await refreshCalendarScheduleCache(
      august.startAt,
      august.endAt,
      jest.fn().mockResolvedValue([persistedSchedule()]),
    );
    await constants.flushPersistence();

    await activateCalendarScheduleCacheForAuthenticatedAccount(8);
    expect(hasCalendarScheduleMonthCache('2026-08-17')).toBe(false);

    await activateCalendarScheduleCacheForAuthenticatedAccount(7);
    expect(hasCalendarScheduleMonthCache('2026-08-17')).toBe(true);
    await clearPersistedCalendarScheduleCacheForAccount(7);

    expect(await AsyncStorage.getItem(constants.persistedCacheKey(7))).toBeNull();
    expect(hasCalendarScheduleMonthCache('2026-08-17')).toBe(false);
  });

  it('reads the durable cache ahead of route mount and reuses it after auth resolves', async () => {
    const storageKey = constants.persistedCacheKey(7);
    await AsyncStorage.setItem(storageKey, JSON.stringify({
      version: constants.persistedCacheVersion,
      memberId: 7,
      savedAt: Date.now(),
      serverRevision: 12,
      months: [{
        key: '2026-08',
        fetchedAt: Date.now(),
        items: [persistedSchedule()],
      }],
    }));

    await prewarmCalendarScheduleCachePersistence();
    await AsyncStorage.removeItem(storageKey);
    await activateCalendarScheduleCacheForAuthenticatedAccount(7);

    expect(hasCalendarScheduleMonthCache('2026-08-17')).toBe(true);
    expect(getCalendarScheduleCacheServerRevision()).toBe(12);
  });
});

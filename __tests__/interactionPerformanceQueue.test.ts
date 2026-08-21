import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { postInteractionPerformanceEvents } from '../src/api/performance';
import { getAuthMember } from '../src/modules/auth/authStorage';
import {
  activateInteractionPerformanceQueue,
  drainInteractionPerformanceQueue,
  INTERACTION_PERFORMANCE_QUEUE_TEST_CONSTANTS,
  recordInteractionPerformance,
  resetInteractionPerformanceQueueForTests,
} from '../src/modules/performance/interactionPerformanceQueue';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111'),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    nativeApplicationVersion: '1.2.0',
    nativeBuildVersion: '42',
  },
}));

jest.mock('../src/api/performance', () => ({
  INTERACTION_PERFORMANCE_OPERATIONS: [
    'schedule.detail_load',
    'quick_schedule.analyze',
  ],
  postInteractionPerformanceEvents: jest.fn().mockResolvedValue({
    acceptedCount: 1,
    storedCount: 1,
  }),
}));

jest.mock('../src/modules/auth/authStorage', () => ({
  getAuthMember: jest.fn().mockResolvedValue({ id: 7 }),
}));

const mockedPostEvents = jest.mocked(postInteractionPerformanceEvents);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedRandomUuid = jest.mocked(Crypto.randomUUID);

describe('interactionPerformanceQueue', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    resetInteractionPerformanceQueueForTests();
    await AsyncStorage.clear();
    mockedGetAuthMember.mockResolvedValue({ id: 7 });
    mockedRandomUuid.mockReturnValue('11111111-1111-4111-8111-111111111111');
    mockedPostEvents.mockResolvedValue({ acceptedCount: 1, storedCount: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('persists identifier-free operation data and removes it after delivery', async () => {
    await activateInteractionPerformanceQueue();
    await recordInteractionPerformance({
      route: '/schedule/739?source=calendar',
      operation: 'schedule.detail_load',
      kind: 'NETWORK',
      outcome: 'SUCCESS',
      durationMs: 842,
      startedAtEpochMs: Date.parse('2026-08-17T01:02:03Z'),
    });

    const key =
      INTERACTION_PERFORMANCE_QUEUE_TEST_CONSTANTS!.storageKeyForMember(7);
    const stored = await AsyncStorage.getItem(key);
    expect(stored).toContain('/schedule/[id]');
    expect(stored).not.toContain('739');

    expect(await drainInteractionPerformanceQueue()).toBe(1);
    expect(mockedPostEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        eventId: '11111111-1111-4111-8111-111111111111',
        route: '/schedule/[id]',
        operation: 'schedule.detail_load',
        kind: 'NETWORK',
        outcome: 'SUCCESS',
        durationMs: 842,
      }),
    ]);
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it('keeps the durable batch while the server is unavailable', async () => {
    mockedPostEvents.mockRejectedValueOnce(new Error('offline'));
    await activateInteractionPerformanceQueue();
    await recordInteractionPerformance({
      route: '/schedule',
      operation: 'quick_schedule.analyze',
      kind: 'INTERACTION',
      outcome: 'ERROR',
      durationMs: 1_500,
      startedAtEpochMs: Date.now(),
    });

    expect(await drainInteractionPerformanceQueue()).toBe(0);
    const key =
      INTERACTION_PERFORMANCE_QUEUE_TEST_CONSTANTS!.storageKeyForMember(7);
    expect(await AsyncStorage.getItem(key)).toContain(
      '11111111-1111-4111-8111-111111111111',
    );
  });
});

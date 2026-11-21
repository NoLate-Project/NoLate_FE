import { watchDrivingLocation } from '../src/modules/journey/drivingLocation';

type Event = {owner: string; samples?: unknown[]; error?: string};
const mockListen = jest.fn();
const mockRemove = jest.fn();
const mockStop = jest.fn(async () => undefined);
const mockStart = jest.fn();
const mockReplay = jest.fn();
const mockNative = jest.fn();
jest.mock('expo-crypto', () => ({randomUUID: () => 'drive'}));
jest.mock('expo-modules-core', () => ({requireOptionalNativeModule: () => mockNative()}));
beforeEach(() => {
  jest.clearAllMocks();
  mockListen.mockReturnValue({remove:mockRemove});
  mockReplay.mockResolvedValue(null);
  mockNative.mockReturnValue({addListener:mockListen, startDrivingLocation:mockStart, latestDrivingLocation:mockReplay, stopDrivingLocation:mockStop});
});

test('delivers scoped original samples and deduplicates initial replay and reordered events', async () => {
  const onFix = jest.fn(), onError = jest.fn();
  const p = {owner:'drive', latitude:37.5, longitude:127, observedAtMs:452000, accuracyMeters:3, courseDegrees:90};
  let event!: (e: Event) => void;
  mockStart.mockImplementation(async () => {
    event = mockListen.mock.lastCall[1];
    event({owner:'drive',samples:[p]});
    return 'STARTED';
  });
  mockReplay.mockResolvedValue(p);
  const handle = await watchDrivingLocation(onFix, onError);
  expect(onFix).toHaveBeenCalledTimes(1);
  expect(onFix.mock.lastCall?.[0]).toEqual({latitude:37.5, longitude:127, observedAtMs:452000, accuracyMeters:3, courseDegrees:90});
  event({owner:'another',samples:[{...p, observedAtMs:453000}]});
  event({owner:'drive',samples:[{...p, observedAtMs:451000},{...p, observedAtMs:454000}]});
  expect(onFix).toHaveBeenCalledTimes(2);
  event({owner:'drive',error:'LOCATION_UNAVAILABLE'});
  expect(onError).toHaveBeenCalledWith('LOCATION_UNAVAILABLE');
  handle?.remove(); handle?.remove();
  event({owner:'drive',samples:[{...p, observedAtMs:455000}]});
  expect(onFix).toHaveBeenCalledTimes(2);
  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(mockRemove).toHaveBeenCalledTimes(1);
});

test('legacy module falls back, denied start tears down without requesting another provider', async () => {
  mockNative.mockReturnValueOnce({});
  await expect(watchDrivingLocation(jest.fn(),jest.fn())).resolves.toBeNull();
  expect(mockListen).not.toHaveBeenCalled();
  mockStart.mockResolvedValue('PERMISSION_REQUIRED');
  await expect(watchDrivingLocation(jest.fn(),jest.fn())).rejects.toThrow('위치 접근');
  expect(mockStop).toHaveBeenCalledWith('drive');
  expect(mockRemove).toHaveBeenCalledTimes(1);
});

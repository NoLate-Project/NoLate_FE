import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { prepareDrivingGuidance } from '../src/modules/journey/drivingGuidance';
import { useDrivingNavigation } from '../src/modules/journey/useDrivingNavigation';

const mockWatch = jest.fn();
const mockPermission = jest.fn();
const mockNativeWatch = jest.fn();
const mockPublish = jest.fn();
jest.mock('../src/modules/journey/useDrivingPublication', () => ({
  publishBackgroundDrivingObservation:(...args:unknown[]) => mockPublish(...args)
}));
jest.mock('../src/modules/journey/drivingLocation', () => ({
  watchDrivingLocation: (...args: unknown[]) => mockNativeWatch(...args),
}));
const mockFetch = jest.fn();
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  watchPositionAsync: (...args: unknown[]) => mockWatch(...args),
}));
jest.mock('../src/modules/map/currentLocation', () => ({
  ensureForegroundPermission: () => mockPermission(),
}));
jest.mock('../src/modules/map/tmapRouteProviders', () => ({
  getDrivingRouteViaTmap: (...args: unknown[]) => mockFetch(...args),
}));

const origin = { lat: 37.5, lng: 127 };
const corner = { lat: 37.501, lng: 127 };
const destination = { lat: 37.501, lng: 127.001 };
const route = {
  mode: 'CAR',
  provider: 'tmap',
  source: 'api',
  minutes: 3,
  pathCoords: [origin, corner, destination],
  guideSteps: [
    { instruction: '첫길', pathCoords: [origin, corner] },
    {
      instruction: '교차로에서 우회전',
      turnType: '13',
      coordinate: corner,
      pathCoords: [corner, destination],
    },
  ],
};
type State = ReturnType<typeof useDrivingNavigation>;
let value: State;
function Probe({ saved = route }: { saved?: unknown }) {
  value = useDrivingNavigation(saved, origin, destination);
  return null;
}
async function mount(saved?: unknown) {
  let result!: ReactTestRenderer;
  await act(async () => {
    result = TestRenderer.create(<Probe saved={saved} />);
  });
  return result;
}
const originalAppState = AppState.currentState;
afterAll(() => {
  AppState.currentState = originalAppState;
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() =>
    ({ remove: jest.fn() }) as ReturnType<typeof AppState.addEventListener>);
  jest.useFakeTimers();
  AppState.currentState = 'active';
  mockPermission.mockResolvedValue(undefined);
  mockNativeWatch.mockResolvedValue(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('real watcher observations drive the selected maneuver; a GPS gap removes its instruction without a new callback', async () => {
  const remove = jest.fn();
  mockWatch.mockResolvedValue({ remove });
  const screen = await mount();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockWatch).toHaveBeenCalledTimes(1);
  const receive = mockWatch.mock.calls[0][1];
  const sample = (lat: number) =>
    receive({ timestamp: Date.now(), coords: { latitude: lat, longitude: 127, accuracy: 4 } });
  act(() => sample(37.5));
  act(() => {
    jest.advanceTimersByTime(2000);
    sample(37.5001);
  });
  expect(value.view.nextManeuver?.turnType).toBe('13');
  expect(value.view.metersToNext).toBeGreaterThan(80);
  act(() => jest.advanceTimersByTime(13000));
  expect(value.view.nextManeuver).toBeNull();
  expect(value.freshFix).toBeNull();
  act(() => screen.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
});

test('missing legacy maneuvers refresh from the saved endpoints; exiting during permission does not start GPS', async () => {
  let grant!: () => void;
  mockPermission.mockReturnValueOnce(
    new Promise<void>(resolve => {
      grant = resolve;
    }),
  );
  mockFetch.mockResolvedValue(route);
  const screen = await mount({ minutes: 3 });
  expect(mockFetch).toHaveBeenCalledWith(origin, destination, '0');
  expect(value.route).toBeTruthy();
  act(() => screen.unmount());
  await act(async () => grant());
  expect(mockWatch).not.toHaveBeenCalled();
});

test('late subscription handles are cleaned up even if the user closes immediately', async () => {
  let subscribe!: (s: { remove: () => void }) => void;
  mockWatch.mockReturnValueOnce(
    new Promise(resolve => {
      subscribe = resolve;
    }),
  );
  const screen = await mount();
  act(() => screen.unmount());
  const remove = jest.fn();
  await act(async () => subscribe({ remove }));
  expect(remove).toHaveBeenCalledTimes(1);
});

test('retains one authorized native location feed across lock and accepts only new, live observations', async () => {
  let change!: (state: string) => void;
  const appState = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener as typeof change;
    return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
  });
  const remove = jest.fn();
  mockNativeWatch.mockResolvedValue({ remove });
  const screen = await mount();
  try {
    const receive = mockNativeWatch.mock.calls[0][0];
    const sample = (lat: number) =>
      receive({ latitude: lat, longitude: 127, observedAtMs: Date.now(), accuracyMeters: 3 });
    act(() => sample(37.5));
    act(() => {
      jest.advanceTimersByTime(1000);
      sample(37.5001);
    });
    const firstDistance = value.view.metersToNext!;
    act(() => change('background'));
    act(() => {
      jest.advanceTimersByTime(2000);
      sample(37.5003);
    });
    expect(value.view.status).toBe('GUIDING');
    expect(value.view.metersToNext).toBeLessThan(firstDistance);
    expect(mockPublish.mock.lastCall?.[1].metersToNext).toBe(value.view.metersToNext);
    expect(remove).not.toHaveBeenCalled();
    expect(mockWatch).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(13000));
    expect(value.view.nextManeuver).toBeNull();
    act(() => change('active'));
    expect(mockNativeWatch).toHaveBeenCalledTimes(1);
  } finally {
    act(() => screen.unmount());
    appState.mockRestore();
  }
  expect(remove).toHaveBeenCalledTimes(1);
});

const sideStreet = { lat: 37.4998, lng: 127.0011 };
const replacement = {
  ...route,
  pathCoords: [sideStreet, destination],
  guideSteps: [
    { instruction: '우회 도로로 이동', pathCoords: [sideStreet, destination] },
    { turnType: '201', instruction: '도착', coordinate: destination },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function leaveRoad(native: boolean) {
  const remove = jest.fn();
  if (native) mockNativeWatch.mockResolvedValue({ remove });
  else mockWatch.mockResolvedValue({ remove });
  const screen = await mount();
  const send = (latitude: number, longitude: number) => act(() => {
    jest.advanceTimersByTime(2000);
    if (native) {
      mockNativeWatch.mock.calls[0][0]({ latitude, longitude, accuracyMeters: 4, observedAtMs: Date.now() });
    } else {
      mockWatch.mock.calls[0][1]({ timestamp: Date.now(), coords: { latitude, longitude, accuracy: 4 } });
    }
  });
  send(origin.lat, origin.lng);
  send(origin.lat + 0.0001, origin.lng);
  expect(value.view.status).toBe('GUIDING');
  send(37.4999, 127.0004);
  for (let i = 0; i < 8; i++) send(sideStreet.lat, sideStreet.lng);
  expect(value.view.status).toBe('OFF_ROUTE');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith(sideStreet, destination, '0');
  return { screen, send, remove };
}

test.each([true, false])('keeps the location feed and map while rerouting, then advances on the new road (native=%s)', async native => {
  const response = deferred<typeof replacement>();
  mockFetch.mockReturnValue(response.promise);
  const { screen, send, remove } = await leaveRoad(native);
  const old = value.route;
  expect(old).not.toBeNull();
  expect(value.rerouting).toBe(true);
  send(sideStreet.lat + 0.00003, sideStreet.lng);
  expect(value.route).toBe(old);
  expect(value.view.nextManeuver).toBeNull();
  expect(value.freshFix?.latitude).toBeCloseTo(sideStreet.lat + 0.00003, 7);
  act(() => value.refreshRoute());
  expect(mockFetch).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve(replacement));
  expect(value.rerouting).toBe(false);
  expect(value.route).not.toBe(old);
  expect(value.freshFix).not.toBeNull();
  send(sideStreet.lat + 0.00008, sideStreet.lng);
  send(sideStreet.lat + 0.00016, sideStreet.lng);
  expect(value.view.status).toBe('GUIDING');
  expect(value.view.nextManeuver?.turnType).toBe('201');
  expect(remove).not.toHaveBeenCalled();
  expect(mockNativeWatch).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});

test('a failed reroute retains the car and retries from the latest fix; a late reply after rejoining is discarded', async () => {
  const first = deferred<typeof replacement>();
  const retry = deferred<typeof replacement>();
  mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const { screen, send, remove } = await leaveRoad(false);
  const old = value.route;
  await act(async () => first.reject(new Error('offline')));
  expect(value.routeError).toBe(true);
  expect(value.route).toBe(old);
  send(37.4999, sideStreet.lng);
  expect(value.freshFix?.latitude).toBe(37.4999);
  act(() => value.refreshRoute());
  expect(mockFetch).toHaveBeenLastCalledWith({ lat: 37.4999, lng: sideStreet.lng }, destination, '0');
  expect(value.routeError).toBe(false);
  send(37.5002, 127.0006);
  send(37.50025, 127.00002);
  send(37.5003, 127);
  expect(value.rerouting).toBe(false);
  expect(value.view.status).toBe('GUIDING');
  await act(async () => retry.resolve(replacement));
  expect(value.route).toBe(old);
  expect(value.view.nextManeuver?.turnType).toBe('13');
  expect(remove).not.toHaveBeenCalled();
  act(() => screen.unmount());
});

test('a route for other endpoints keeps the current road and automatically retries after the cooldown', async () => {
  const invalid = deferred<typeof route>();
  const valid = deferred<typeof replacement>();
  mockFetch.mockReturnValueOnce(invalid.promise).mockReturnValueOnce(valid.promise);
  const { screen, send } = await leaveRoad(false);
  const original = value.route;
  // Structurally sound but returned for another city.
  const elsewhere = { lat: 36.8, lng: 126.9 };
  const otherEnd = { lat: 36.801, lng: 126.901 };
  const wrongRoad = {
    ...route, drivingGeometryComplete: true, pathCoords: [elsewhere, otherEnd],
    guideSteps: [{ instruction: '다른 도로', pathCoords: [elsewhere, otherEnd] }],
  };
  expect(prepareDrivingGuidance(wrongRoad)).not.toBeNull();
  await act(async () => invalid.resolve(wrongRoad));
  expect(value.route).toBe(original);
  expect(value.routeError).toBe(true);
  const retryLatitude = sideStreet.lat + 0.00004;
  for (let i = 0; i < 25; i++) send(retryLatitude, sideStreet.lng);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 6; i++) send(retryLatitude, sideStreet.lng);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenLastCalledWith({ lat: retryLatitude, lng: sideStreet.lng }, destination, '0');
  await act(async () => valid.resolve(replacement));
  expect(value.route).not.toBe(original);
  expect(value.routeError).toBe(false);
  act(() => screen.unmount());
});

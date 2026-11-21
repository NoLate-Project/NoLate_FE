import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';
import { drivingPublicationContent, publishBackgroundDrivingObservation, useDrivingPublication } from '../src/modules/journey/useDrivingPublication';
import { prepareDrivingGuidance, readDrivingGuidance, type DrivingGuidanceView } from '../src/modules/journey/drivingGuidance';

const mockOpen = jest.fn(async () => undefined);
const mockPublish = jest.fn(async () => undefined);
const mockClose = jest.fn(async () => undefined);
const mockReset = jest.fn(async () => undefined);
const mockId = jest.fn();
jest.mock('expo-crypto', () => ({randomUUID: () => mockId()}));
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    openDrivingPublication: mockOpen, publishDrivingGuidance: mockPublish, closeDrivingPublication: mockClose,
    resetDrivingPublicationRoute: mockReset,
  }),
}));

const origin = {lat: 37.5, lng: 127};
const corner = {lat: 37.501, lng: 127};
const destination = {lat: 37.501, lng: 127.001};
const route = prepareDrivingGuidance({
  mode: 'CAR', source: 'api', provider: 'tmap', drivingGeometryComplete: true,
  pathCoords: [origin, corner, destination], guideSteps: [
    {instruction: '첫길', pathCoords: [origin, corner]},
    {instruction: '중앙로에서 우회전', turnType: '13', roadName: '중앙로', coordinate: corner, pathCoords: [corner, destination]},
  ],
})!;
const waiting = readDrivingGuidance(null, 10);
const fresh: DrivingGuidanceView = {
  status: 'GUIDING', validUntilMs: 900012000, matchedCoordinate: route.coordinates[0], remainingMeters: 130,
  remainingSeconds: 50, nextManeuver: route.maneuvers[0], metersToNext: 42, followingManeuver: null, progress: 0.34,
};
function Probe({id, view = waiting, voice = false, selectedRoute = route}: {id: string; view?: DrivingGuidanceView; voice?: boolean; selectedRoute?: typeof route | null}) {
  useDrivingPublication(id, '목적지', selectedRoute, view, voice);
  return null;
}

test('projects only the matched provider occurrence and its source expiry, without coordinates or the saved path', () => {
  expect(drivingPublicationContent(route, fresh)).toEqual({
    status: 'GUIDING', validUntilMs: 900012000, remainingMeters: 130, remainingSeconds: 50,
    next: {title: '우회전', type: '13', road: '중앙로', index: 0, meters: 42}, following: null,
  });
  for (const view of [
    {...fresh, nextManeuver: {...route.maneuvers[0]}},
    {...fresh, validUntilMs: null}, {...fresh, remainingMeters: Infinity}, {...fresh, metersToNext: -1},
  ]) expect(drivingPublicationContent(route, view)).toEqual({status: 'UNCERTAIN'});
  expect(drivingPublicationContent(route, {...fresh, status: 'OFF_ROUTE'})).toEqual({status: 'OFF_ROUTE', validUntilMs: fresh.validUntilMs});
});

test('publishes each foreground view and voice opt-in to the active owner, then ends exactly that owner', async () => {
  mockId.mockReturnValueOnce('drive-a').mockReturnValueOnce('drive-b');
  let screen!: ReactTestRenderer;
  await act(async () => { screen = TestRenderer.create(<Probe id="8" />); });
  expect(mockOpen).toHaveBeenCalledWith('drive-a', '8', '목적지');
  expect(mockPublish).toHaveBeenLastCalledWith('drive-a', JSON.stringify({status:'ACQUIRING'}), false);
  await act(async () => { screen.update(<Probe id="8" view={fresh} voice />); });
  expect(mockPublish).toHaveBeenLastCalledWith('drive-a', JSON.stringify(drivingPublicationContent(route, fresh)), true);
  await act(async () => { screen.update(<Probe id="9" />); });
  expect(mockClose).toHaveBeenCalledWith('drive-a');
  expect(mockOpen).toHaveBeenLastCalledWith('drive-b', '9', '목적지');
  expect(mockPublish).toHaveBeenLastCalledWith('drive-b', JSON.stringify({status:'ACQUIRING'}), false);
  expect(mockClose.mock.invocationCallOrder[0]).toBeLessThan(mockOpen.mock.invocationCallOrder[1]);
  await act(async () => { screen.unmount(); });
  expect(mockClose).toHaveBeenLastCalledWith('drive-b');
});

test('a locked observation bypasses React rendering, and rerouting clears the old turn on the same activity owner', async () => {
  jest.clearAllMocks();
  mockId.mockReturnValueOnce('trip');
  const appState = AppState.currentState;
  let screen!: ReactTestRenderer;
  const replacement = {...route};
  try {
    AppState.currentState = 'active';
    await act(async () => { screen = TestRenderer.create(<Probe id="8" />); });
    AppState.currentState = 'background';
    await act(async () => { publishBackgroundDrivingObservation(route, fresh); });
    expect(mockPublish).toHaveBeenLastCalledWith('trip', JSON.stringify(drivingPublicationContent(route, fresh)), false);
    await act(async () => { screen.update(<Probe id="8" selectedRoute={null} />); });
    expect(mockReset).toHaveBeenLastCalledWith('trip');
    expect(mockPublish).toHaveBeenLastCalledWith('trip', JSON.stringify({status:'ACQUIRING'}), false);
    await act(async () => { screen.update(<Probe id="8" selectedRoute={replacement} />); });
    const priorCalls = mockPublish.mock.calls.length;
    await act(async () => { publishBackgroundDrivingObservation(route, fresh); });
    expect(mockPublish).toHaveBeenCalledTimes(priorCalls);
    await act(async () => { publishBackgroundDrivingObservation(replacement, fresh); });
    expect(mockPublish).toHaveBeenCalledTimes(priorCalls + 1);
    expect(mockReset).toHaveBeenCalledTimes(2);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
  } finally {
    await act(async () => { screen?.unmount(); });
    AppState.currentState = appState;
  }
});

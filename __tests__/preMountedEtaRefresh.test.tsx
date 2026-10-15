import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import type { ScheduleDepartureStatus } from '../src/api/schedule';
import {
  createSceneActivityStore,
  PreMountedSceneActivityContext,
} from '../src/modules/performance/preMountedSceneActivity';
import { useScheduleDepartureStatusController } from '../src/routeSupport/schedule/useScheduleDepartureStatusController';

const mockGetStatus = jest.fn();
const mockIsFocused = jest.fn();
jest.mock('../src/api/schedule', () => ({
  getScheduleDepartureStatus: (...args: unknown[]) => mockGetStatus(...args),
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused(),
}));

describe('visible pre-mounted detail ETA refresh', () => {
  let renderer: ReactTestRenderer;
  let result: ReturnType<typeof useScheduleDepartureStatusController>;
  let appStateDescriptor: PropertyDescriptor | undefined;
  const diagnostic = (failureReason: string) => ({
    source: 'TIMETABLE_PROVIDER', stale: true, failureReason,
    nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
  } as ScheduleDepartureStatus);
  function Probe() {
    result = useScheduleDepartureStatusController({
      scheduleId: '363', previewEnabled: false, routeSavePending: false,
    });
    return null;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockGetStatus.mockReset();
    mockIsFocused.mockReset().mockReturnValue(false);
    appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(async () => {
    if (renderer) await act(async () => { renderer.unmount(); });
    if (appStateDescriptor) Object.defineProperty(AppState, 'currentState', appStateDescriptor);
    jest.useRealTimers();
  });

  it('does not poll a hidden detail and fetches a fresh diagnosis on every reopen', async () => {
    const store = createSceneActivityStore();
    mockGetStatus.mockResolvedValueOnce(diagnostic('TRANSIT_ITINERARY_REFRESH_UNSUPPORTED: old'));
    await act(async () => {
      renderer = TestRenderer.create(<PreMountedSceneActivityContext.Provider value={store}><Probe /></PreMountedSceneActivityContext.Provider>);
    });
    expect(mockGetStatus).not.toHaveBeenCalled();
    await act(async () => { store.setActive(true); });
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(result.departureStatus?.failureReason).toContain('REFRESH_UNSUPPORTED');
    await act(async () => { store.setActive(false); });
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    mockGetStatus.mockResolvedValueOnce(diagnostic('TRANSIT_ARRIVAL_UNAVAILABLE: latest'));
    await act(async () => { store.setActive(true); });
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(result.departureStatus?.failureReason).toContain('TRANSIT_ARRIVAL_UNAVAILABLE');
    expect(result.acceptedDepartureStatus).toBeUndefined();
  });

  it('fences a response received after the scene closes', async () => {
    const store = createSceneActivityStore();
    let resolve!: (status: ScheduleDepartureStatus) => void;
    mockGetStatus.mockReturnValueOnce(new Promise<ScheduleDepartureStatus>(next => { resolve = next; }));
    await act(async () => {
      renderer = TestRenderer.create(<PreMountedSceneActivityContext.Provider value={store}><Probe /></PreMountedSceneActivityContext.Provider>);
      store.setActive(true);
    });
    await act(async () => { store.setActive(false); });
    await act(async () => { resolve(diagnostic('TRANSIT_ITINERARY_REFRESH_UNSUPPORTED: late')); });
    expect(result.departureStatus).toBeUndefined();
    mockGetStatus.mockResolvedValueOnce(diagnostic('TRANSIT_ARRIVAL_UNAVAILABLE: current'));
    await act(async () => { store.setActive(true); });
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(result.departureStatus?.failureReason).toContain('TRANSIT_ARRIVAL_UNAVAILABLE');
  });

  it('retains navigation-focus behavior for ordinary routed details', async () => {
    mockGetStatus.mockResolvedValue(diagnostic('TRANSIT_ARRIVAL_UNAVAILABLE: current'));
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    expect(mockGetStatus).not.toHaveBeenCalled();
    mockIsFocused.mockReturnValue(true);
    await act(async () => { renderer.update(<Probe />); });
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
  });
});

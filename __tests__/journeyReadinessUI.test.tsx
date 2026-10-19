import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import JourneyReadinessRoute from '../app/internal/journey-readiness';
const mockGet = jest.fn(); const mockProbe = jest.fn(); const mockBack = jest.fn();
jest.mock('expo-router', () => ({ Redirect: 'Redirect', useRouter: () => ({ back: mockBack }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/modules/journey/automaticJourney', () => ({ ...jest.requireActual('../src/modules/journey/automaticJourney'), getAutomaticJourneySnapshot: () => mockGet() }));
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({ getAutomaticJourneySyncState: () => ({ status: 'IDLE', paused: false, errorCode: null, pendingStopCount: 0 }) }));
jest.mock('../src/modules/journey/journeyDiagnostics', () => ({ getJourneyDiagnostics: () => mockProbe() }));
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalOS = Platform.OS; const originalDev = runtime.__DEV__;
beforeEach(() => {
    jest.clearAllMocks(); runtime.__DEV__ = true;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockGet.mockResolvedValue({ enabled: true, status: 'IDLE' });
    mockProbe.mockResolvedValue({ enabled: false, location: {}, liveActivity: {} });
});
afterEach(() => { runtime.__DEV__ = originalDev; Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }); });
it('mount is passive; explicit refresh reads snapshots and never turns unverified into PASS', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<JourneyReadinessRoute />); });
    expect(mockGet).not.toHaveBeenCalled(); expect(mockProbe).not.toHaveBeenCalled();
    await act(async () => { await view.root.findByProps({ accessibilityLabel: '진단 상태 새로고침' }).props.onPress(); });
    expect(mockGet).toHaveBeenCalledTimes(1); expect(mockProbe).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(view.root.findByProps({ testID: 'journey-readiness-APNS' }).props.children)).toContain('UNVERIFIED');
    expect(JSON.stringify(view.root.findByProps({ testID: 'journey-readiness-TRANSIT_RIDE' }).props.children)).toContain('PARTIAL');
    for (const code of ['SUBWAY_NAVIGATION', 'DEVICE_RELEASE']) {
        expect(JSON.stringify(view.root.findByProps({ testID: `journey-readiness-${code}` }).props.children)).toContain('UNSUPPORTED');
    }
    act(() => view.unmount());
});
it('a failed read removes old evidence without echoing native error details', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<JourneyReadinessRoute />); });
    const refresh = () => view.root.findByProps({ accessibilityLabel: '진단 상태 새로고침' }).props.onPress();
    await act(async () => { await refresh(); });
    mockGet.mockRejectedValue(new Error('PRIVATE_DEVICE_TOKEN'));
    await act(async () => { await refresh(); });
    expect(view.root.findAllByProps({ testID: 'journey-readiness-APNS' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'journey-readiness-error' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(view.toJSON())).not.toContain('PRIVATE_DEVICE_TOKEN');
    act(() => view.unmount());
});
it.each(['release', 'android'])('blocks %s before any diagnostic native read', async mode => {
    if (mode === 'release') runtime.__DEV__ = false;
    else Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<JourneyReadinessRoute />); });
    expect(mockGet).not.toHaveBeenCalled(); expect(mockProbe).not.toHaveBeenCalled();
    expect(view.root.findByProps({ href: '/schedule' }).props.href).toBe('/schedule');
    act(() => view.unmount());
});

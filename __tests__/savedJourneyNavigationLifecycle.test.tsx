import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import { useSavedJourneyNavigationLifecycle } from '../src/modules/journey/useSavedJourneyNavigationLifecycle';

const mockRead = jest.fn(), mockDetach = jest.fn(), mockAuthDetach = jest.fn();
const mockRenderedBinding = jest.fn(), mockCurrentBinding = jest.fn();
let mockEvent: (snapshot: AutomaticJourneySnapshot) => void;
let mockAuth: () => void;
jest.mock('../src/modules/journey/useSavedJourneyBinding', () => ({
    useSavedJourneyBinding: () => mockRenderedBinding(),
}));
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({
    getAutomaticJourneyTrialBinding: () => mockCurrentBinding(),
}));
jest.mock('../src/modules/journey/automaticJourney', () => ({
    ...jest.requireActual('../src/modules/journey/automaticJourney'),
    getAutomaticJourneySnapshot: () => mockRead(),
    subscribeAutomaticJourney: (callback: typeof mockEvent) => { mockEvent = callback; return mockDetach; },
}));
jest.mock('../src/modules/auth/authStorage', () => ({
    subscribeAuthInvalidation: (callback: typeof mockAuth) => { mockAuth = callback; return mockAuthDetach; },
}));
const point = { latitude: 37.5, longitude: 127 };
const input = { schemaVersion: 1, routeRevision: 1, context: 'SAVED_ROUTE', source: 'api', provider: 'odsay',
    plausibility: 'normal', serviceState: 'operating', origin: point, destination: point,
    legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ index, kind, exact: true,
        geometryInputComplete: true, coordinates: [point, point], start: point, end: point })),
} as JourneyRouteInput;
const binding: AutomaticJourneyBinding = {
    sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '363', generation: 1,
    routeRevision: 1, routeInputDigest: 'digest', clientOwnerId: 'owner',
    syncScope: 'AUTHENTICATED', authMemberId: 7, apiOrigin: 'http://127.0.0.1:5534', loginGeneration: 1,
    savedRouteValidated: true, guidanceEnabled: true, execution: 'SIMULATOR',
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600,
};
function snapshot(owner = binding, status: AutomaticJourneySnapshot['status'] = 'ACTIVE', reason = 'TRACKING') {
    return { enabled: true, status, sessionId: owner.sessionId, routeRevision: owner.routeRevision,
        syncScope: owner.syncScope, guidanceMemberId: owner.authMemberId, qualityReason: reason,
        guidance: { ...owner, status },
    } as unknown as AutomaticJourneySnapshot;
}
let value!: ReturnType<typeof useSavedJourneyNavigationLifecycle>;
function Detail({ route = input, id = '363', memberId = 7 }: {
    route?: JourneyRouteInput | null; id?: string; memberId?: number | null;
}) {
    value = useSavedJourneyNavigationLifecycle(route, id, memberId);
    return null;
}
beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    AppState.currentState = 'active';
    mockRead.mockResolvedValue(snapshot());
    mockRenderedBinding.mockReturnValue(binding); mockCurrentBinding.mockReturnValue(binding);
});
afterEach(() => jest.useRealTimers());

test('a compact reentered detail observes arrival even when coordinator cleanup removes its binding first', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    expect(value.navigationEnd).toBeUndefined();
    mockRenderedBinding.mockReturnValue(null); mockCurrentBinding.mockReturnValue(null);
    act(() => view.update(<Detail />));
    expect(value.sessionObserved).toBe(true);
    expect(value.navigationReconciling).toBe(true);
    act(() => mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')));
    expect(value.navigationEnd).toMatchObject({ scheduleId: '363', reason: 'DESTINATION_ARRIVED' });
    expect(value.navigationReconciling).toBe(false);
    const reads = mockRead.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(mockRead).toHaveBeenCalledTimes(reads);
    act(() => view.unmount());
});

test.each([
    ['member', { guidanceMemberId: 8 }], ['session', { sessionId: 'other' }],
    ['revision', { routeRevision: 2 }], ['scope', { syncScope: 'SANDBOX' }],
    ['schedule', { guidance: { ...binding, scheduleId: '364', status: 'STOPPED' } }],
    ['generation', { guidance: { ...binding, generation: 2, status: 'STOPPED' } }],
    ['digest', { guidance: { ...binding, routeInputDigest: 'changed', status: 'STOPPED' } }],
    ['contradictory status', { guidance: { ...binding, status: 'ACTIVE' } }],
] as const)('does not accept a terminal snapshot from a different %s', async (_label, changed) => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    act(() => mockEvent({ ...snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED'), ...changed } as AutomaticJourneySnapshot));
    expect(value.navigationEnd).toBeUndefined();
    act(() => view.unmount());
});

test('route/account changes and logout cannot inherit the previous arrival', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    act(() => mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')));
    expect(value.navigationEnd).toBeDefined();
    mockRenderedBinding.mockReturnValue(null); mockCurrentBinding.mockReturnValue(null);
    act(() => view.update(<Detail route={{ ...input, routeRevision: 2 }} />));
    expect(value.navigationEnd).toBeUndefined();
    act(() => view.update(<Detail memberId={8} />));
    expect(value.navigationEnd).toBeUndefined();
    act(() => view.unmount());

    mockRenderedBinding.mockReturnValue(binding); mockCurrentBinding.mockReturnValue(binding);
    await act(async () => { view = TestRenderer.create(<Detail />); });
    mockRenderedBinding.mockReturnValue(null); mockCurrentBinding.mockReturnValue(null);
    act(() => { mockAuth(); mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')); });
    expect(value.navigationEnd).toBeUndefined();
    act(() => view.unmount());
});

test('a replacement published before React renders rejects the old terminal event', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    const replacement = { ...binding, sessionId: '22222222-2222-4222-8222-222222222222', generation: 2 };
    mockCurrentBinding.mockReturnValue(replacement);
    act(() => mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')));
    expect(value.navigationEnd).toBeUndefined();
    mockRenderedBinding.mockReturnValue(replacement);
    act(() => view.update(<Detail />));
    act(() => mockEvent(snapshot(replacement, 'STOPPED', 'STOPPED')));
    expect(value.navigationEnd?.sessionId).toBe(replacement.sessionId);
    expect(value.navigationEnd?.reason).toBe('STOPPED');
    act(() => view.unmount());
});

test('an old read or cleanup stop cannot overwrite the first terminal arrival', async () => {
    let resolve!: (next: AutomaticJourneySnapshot) => void;
    mockRead.mockImplementation(() => new Promise<AutomaticJourneySnapshot>(done => { resolve = done; }));
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<Detail />); });
    const callback = mockEvent;
    act(() => mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')));
    await act(async () => { resolve(snapshot(binding, 'STOPPED', 'STOPPED')); });
    act(() => callback(snapshot(binding, 'STOPPED', 'STOPPED')));
    expect(value.navigationEnd?.reason).toBe('DESTINATION_ARRIVED');
    act(() => view.unmount());
});

test('foreground polling recovers a missed terminal event and unmount releases every read', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    mockRead.mockResolvedValue(snapshot(binding, 'EXPIRED', 'LEASE_EXPIRED'));
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(value.navigationEnd?.status).toBe('EXPIRED');
    const reads = mockRead.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(mockRead).toHaveBeenCalledTimes(reads);
    act(() => view.unmount());
    expect(mockDetach).toHaveBeenCalled(); expect(mockAuthDetach).toHaveBeenCalled();
});

test.each([null, { ...binding, authMemberId: 8 }, { ...binding, guidanceEnabled: undefined }])(
    'an unarmed or foreign detail does not subscribe or read native state', async candidate => {
        mockRenderedBinding.mockReturnValue(candidate); mockCurrentBinding.mockReturnValue(candidate);
        let view!: ReactTestRenderer;
        await act(async () => { view = TestRenderer.create(<Detail />); });
        expect(value.binding).toBeNull(); expect(value.navigationEnd).toBeUndefined();
        await act(async () => { jest.advanceTimersByTime(10_000); });
        expect(mockRead).not.toHaveBeenCalled();
        act(() => view.unmount());
    },
);

test('a newly armed session cannot inherit a previous session arrival', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    act(() => mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')));
    const replacement = { ...binding, sessionId: '33333333-3333-4333-8333-333333333333', generation: 3 };
    mockRenderedBinding.mockReturnValue(replacement); mockCurrentBinding.mockReturnValue(replacement);
    mockRead.mockResolvedValue(snapshot(replacement, 'ARMED'));
    await act(async () => { view.update(<Detail />); });
    expect(value.navigationEnd).toBeUndefined();
    mockRenderedBinding.mockReturnValue(null); mockCurrentBinding.mockReturnValue(null);
    act(() => { view.update(<Detail />); mockEvent(snapshot(replacement, 'EXPIRED', 'LEASE_EXPIRED')); });
    expect(value.navigationEnd?.reason).toBe('LEASE_EXPIRED');
    act(() => view.unmount());
});

test('logout also clears an arrival after the terminal observer has stopped', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Detail />); });
    act(() => mockEvent(snapshot(binding, 'STOPPED', 'DESTINATION_ARRIVED')));
    mockRenderedBinding.mockReturnValue(null); mockCurrentBinding.mockReturnValue(null);
    act(() => mockAuth());
    expect(value.navigationEnd).toBeUndefined();
    act(() => view.unmount());
});

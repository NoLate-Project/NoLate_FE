import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { useSavedJourneyPosition } from '../src/modules/journey/useSavedJourneyPosition';
import { SavedJourneyTrialControls } from '../src/modules/journey/SavedJourneyTrialControls';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import type { AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import * as journeyAuthentication from '../src/modules/journey/automaticJourneyAuthentication';
import { savedJourneyProviderFixture, savedJourneySubwayProviderFixture } from '../test-support/savedJourneyProviderFixture';
const mockRead = jest.fn(), mockDetach = jest.fn(), mockSyncDetach = jest.fn();
const mockBinding = jest.fn(), mockTrial = jest.fn();
jest.mock('../src/api/env', () => ({ getEnv: () => { throw new Error('NO_NETWORK_KEYS'); } }));
let mockEvent: (value: AutomaticJourneySnapshot) => void;
jest.mock('../src/modules/journey/automaticJourney', () => ({ ...jest.requireActual('../src/modules/journey/automaticJourney'),
    getAutomaticJourneySnapshot: () => mockRead(), subscribeAutomaticJourney: (callback: typeof mockEvent) => { mockEvent = callback; return mockDetach; } }));
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({ getAutomaticJourneyTrialBinding: () => mockBinding(),
    getAutomaticJourneyTrialInput: () => null, subscribeAutomaticJourneySync: () => mockSyncDetach }));
jest.mock('../src/modules/journey/useAutomaticJourneyTrial', () => ({ useAutomaticJourneyTrial: (...args: unknown[]) => ({sync:{errorCode:null},...mockTrial(...args)}) }));
const point = { latitude: 37.5, longitude: 127 };
const input = { schemaVersion: 1, context: 'SAVED_ROUTE', source: 'api', provider: 'tmap', plausibility: 'normal', serviceState: 'operating',
    origin: point, destination: point, legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ index, kind, exact: true,
        geometryInputComplete: true, geometrySource: kind === 'WALK' ? 'WALK_STEPS_LINESTRING' : 'TRANSIT_PASS_SHAPE_LINESTRING',
        coordinates: [point, point], start: point, end: point })) } as JourneyRouteInput;
const binding = { sessionId: 'x', scheduleId: '9001', generation: 1, routeRevision: 1, routeInputDigest: 'digest',
    syncScope: 'SANDBOX', savedRouteValidated: true, guidanceEnabled: true, preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600 };
const snapshot = { enabled: true, status: 'ACTIVE', sessionId: 'x', routeRevision: 1,
    guidance: { ...binding, status: 'ACTIVE', schemaVersion: 1, sequence: 1, phase: 'WAITING', quality: 'GOOD', boardingConfirmed: false,
        observedAt: 1020, validUntil: 1035, walkProgress: 1 },
    guidancePosition: { latitude: 37.5, longitude: 127, observedAt: 1020, validUntil: 1035, accuracyMeters: 5 } } as unknown as AutomaticJourneySnapshot;
function Location({ route = input, id = '9001' }: { route?: JourneyRouteInput | null; id?: string }) {
    const value = useSavedJourneyPosition(route, id);
    return <Text testID="position">{value ? JSON.stringify(value) : 'unknown'}</Text>;
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1021000); jest.clearAllMocks(); mockBinding.mockReturnValue(binding); mockRead.mockResolvedValue(snapshot); });
afterEach(() => jest.useRealTimers());
it('updates with native GPS, hides on original TTL and unmount releases only reads', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Location />); });
    expect(view.root.findByProps({ testID: 'position' }).props.children).toContain('37.5');
    act(() => mockEvent({ ...snapshot, guidancePosition: { ...snapshot.guidancePosition, longitude: 127.001 } }));
    expect(view.root.findByProps({ testID: 'position' }).props.children).toContain('127.001');
    act(() => jest.advanceTimersByTime(15000));
    expect(view.root.findByProps({ testID: 'position' }).props.children).toBe('unknown');
    act(() => view.unmount()); expect(mockDetach).toHaveBeenCalledTimes(1); expect(mockSyncDetach).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});
it('never displays another schedule and ignores a late read after a newer native event', async () => {
    let finish!: (value: AutomaticJourneySnapshot) => void;
    mockRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<Location />); });
    act(() => mockEvent({ ...snapshot, status: 'STOPPED' }));
    await act(async () => finish(snapshot));
    expect(view.root.findByProps({ testID: 'position' }).props.children).toBe('unknown');
    await act(async () => view.update(<Location id="9002" />));
    expect(view.root.findByProps({ testID: 'position' }).props.children).toBe('unknown');
    act(() => view.unmount());
});
it('detail entry has consent/prepare/stop but no manual departure or phase advance', async () => {
    const { input, route } = savedJourneyProviderFixture();
    const assess = jest.fn(), prepare = jest.fn(), stop = jest.fn(), consent = jest.fn();
    const trial = { snapshot: { status: 'IDLE' }, running: false, pending: false, eligible: false, canAssess: true,
        consented: false, canPrepare: false, assess, prepare, stop, setConsented: consent };
    mockTrial.mockReturnValue(trial);
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyTrialControls input={input} savedRoute={route} />); });
    expect(mockTrial).toHaveBeenCalledWith(input, 'SANDBOX', false, '9001', undefined);
    expect(view.root.findAll(node => node.props.accessibilityLabel === '위치 안내 준비')[0].props.disabled).toBe(true);
    mockTrial.mockReturnValue({ ...trial, eligible: true, canPrepare: true, consented: true });
    act(() => view.update(<SavedJourneyTrialControls input={input} savedRoute={route} />));
    await act(async () => view.root.findAll(node => node.props.testID === 'saved-detail-prepare')[0].props.onPress());
    expect(prepare).toHaveBeenCalledTimes(1);
    mockTrial.mockReturnValue({ ...trial, running: true, snapshot: { status: 'ACTIVE', sessionId: 'x' } });
    act(() => view.update(<SavedJourneyTrialControls input={input} savedRoute={route} />));
    expect(view.root.findAll(node => node.props.testID === 'saved-detail-prepare')).toHaveLength(0);
    await act(async () => view.root.findAll(node => node.props.testID === 'saved-detail-stop')[0].props.onPress());
    expect(stop).toHaveBeenCalledTimes(1); expect(JSON.stringify(view.toJSON())).not.toMatch(/출발했어요|다음 단계|탑승 완료/);
    act(() => view.unmount());
});
it('unsupported routes expose a reason but no assess, consent or prepare action', async () => {
    mockTrial.mockReturnValue({ snapshot: { status: 'IDLE' }, running: false });
    const unsupported = { ...input, legs: input.legs.map(leg => ({ ...leg, kind: leg.index === 1 ? 'SUBWAY' : leg.kind })) } as JourneyRouteInput;
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyTrialControls input={unsupported} />); });
    expect(mockTrial).toHaveBeenCalledWith(unsupported, 'SANDBOX', true, '9001', undefined);
    expect(view.root.findByProps({ testID: 'saved-detail-unsupported' }).props.children).toContain('지하철 탑승');
    for (const id of ['assess', 'consent', 'prepare', 'stop']) expect(view.root.findAllByProps({ testID: `saved-detail-${id}` })).toHaveLength(0);
    act(() => view.unmount());
});
it('owned saved single subway route can enter authenticated assessment without preview credentials', async () => {
    const {input,route}=savedJourneySubwayProviderFixture();
    mockTrial.mockReturnValue({snapshot:{status:'IDLE'},running:false,pending:false,eligible:false,canAssess:true,canPrepare:false});
    let view!:ReactTestRenderer;
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={input} savedRoute={route}
        authenticatedSchedule={{scheduleId:'42',memberId:7}}/>);});
    expect(mockTrial).toHaveBeenCalledWith(input,'AUTHENTICATED',false,'42',expect.any(Function));
    expect(view.root.findAllByProps({testID:'saved-detail-unsupported'})).toHaveLength(0);
    expect(view.root.findAllByProps({testID:'saved-detail-connect-walking'}).length).toBeGreaterThan(0);
    expect(view.root.findAllByProps({testID:'saved-detail-assess'}).length).toBeGreaterThan(0);
    act(()=>view.unmount());
});
it.each(['missing-identifiers', 'wrong-provider'])('provider preflight blocks %s even when the hook reports ready', async mode => {
    const f = savedJourneyProviderFixture();
    if (mode === 'missing-identifiers') delete f.route.transitLegs[1].navigationEvidence.busIdentifiers;
    const selected = mode === 'wrong-provider' ? { ...f.input, provider: 'tmap' as const } : f.input;
    mockTrial.mockReturnValue({ snapshot: { status: 'IDLE' }, running: false, canAssess: true, canPrepare: true, eligible: true });
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyTrialControls input={selected} savedRoute={f.route} />); });
    expect(mockTrial).toHaveBeenCalledWith(selected, 'SANDBOX', true, '9001', undefined);
    expect(view.root.findAllByProps({ testID: 'saved-detail-provider-preflight' }).length).toBeGreaterThan(0);
    for (const id of ['assess', 'consent', 'prepare']) expect(view.root.findAllByProps({ testID: `saved-detail-${id}` })).toHaveLength(0);
    act(() => view.unmount());
});
it.each(['schedule', 'route', 'session', 'scope', 'member'])('cannot stop another %s and rechecks ownership at action time', async mismatch => {
    const stop = jest.fn();
    const own = { ...binding, syncScope: 'AUTHENTICATED', authMemberId: 7 };
    mockBinding.mockReturnValue(own);
    mockTrial.mockReturnValue({ running: true, pending: false, snapshot: { status: 'ACTIVE', sessionId: 'x' }, stop });
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyTrialControls input={input} authenticatedSchedule={{ scheduleId: '9001', memberId: 7 }} />); });
    const action = view.root.findAllByProps({ testID: 'saved-detail-stop' })[0].props.onPress;
    mockBinding.mockReturnValue(mismatch === 'route' ? null : { ...own, ...({ schedule: { scheduleId: '9002' }, session: { sessionId: 'y' },
        scope: { syncScope: 'SANDBOX' }, member: { authMemberId: 8 } }[mismatch]) });
    await act(async () => action()); expect(stop).not.toHaveBeenCalled();
    act(() => view.update(<SavedJourneyTrialControls input={input} authenticatedSchedule={{ scheduleId: '9001', memberId: 7 }} />));
    expect(view.root.findAllByProps({ testID: 'saved-detail-stop' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'saved-detail-other-session' }).length).toBeGreaterThan(0);
    act(() => view.unmount());
});
it('authenticated detail entry uses the actual schedule and fences a stale displayed account', async () => {
    const { input, route } = savedJourneyProviderFixture();
    mockTrial.mockReturnValue({ snapshot: { status: 'IDLE' }, running: false, pending: false, eligible: false, canAssess: false, canPrepare: false });
    const auth = { apiOrigin: 'https://api.example.invalid', authMemberId: 7, loginGeneration: 2, expiresAtEpochSeconds: 1600, accessToken: 'fixture' };
    const read = jest.spyOn(journeyAuthentication, 'currentJourneyAuthentication').mockResolvedValue(auth);
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyTrialControls input={input} savedRoute={route} authenticatedSchedule={{ scheduleId: '42', memberId: 7 }} />); });
    expect(mockTrial).toHaveBeenCalledWith(input, 'AUTHENTICATED', false, '42', expect.any(Function));
    const source = mockTrial.mock.calls[0][4] as () => Promise<unknown>;
    await expect(source()).resolves.toEqual(auth);
    read.mockResolvedValue({ ...auth, authMemberId: 8 });
    await expect(source()).rejects.toThrow('AUTOMATIC_AUTH_CHANGED');
    act(() => view.unmount()); read.mockRestore();
});

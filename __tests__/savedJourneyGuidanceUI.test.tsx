import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";
import type { JourneyRouteInput } from "../src/modules/journey/journeyRouteInput";
import { SavedJourneyGuidanceCard } from "../src/modules/journey/SavedJourneyGuidanceCard";
import { SavedJourneyRouteTimeline } from "../src/modules/journey/SavedJourneyRouteTimeline";
import { SavedJourneyRouteBar } from "../src/modules/journey/SavedJourneyRouteBar";
import type { RouteInfo } from "../src/modules/schedule/routeInfo";

const mockRead = jest.fn(); const mockDetach = jest.fn(); const mockBinding = jest.fn();
const mockSyncDetach = jest.fn();
let mockSync: () => void;
let mockEvent: (snapshot: AutomaticJourneySnapshot) => void;
jest.mock("../src/modules/journey/automaticJourney", () => ({
    ...jest.requireActual("../src/modules/journey/automaticJourney"),
    getAutomaticJourneySnapshot: () => mockRead(),
    subscribeAutomaticJourney: (callback: typeof mockEvent) => { mockEvent = callback; return mockDetach; },
}));
jest.mock("../src/modules/journey/automaticJourneyTrial", () => ({ getAutomaticJourneyTrialBinding: (input: unknown) => mockBinding(input),
    getAutomaticJourneyTrialInput:()=>null,
    subscribeAutomaticJourneySync: (callback: () => void) => { mockSync = callback; return mockSyncDetach; } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/modules/theme/ThemeContext', () => ({ useTheme: () => ({ mode: 'light', colors: { textPrimary: '#111', textSecondary: '#666' } }) }));
jest.mock('../src/api/transitArrivals', () => ({ getBusArrivals: jest.fn(), getSubwayArrivals: jest.fn() }));
const binding: AutomaticJourneyBinding = {
    sessionId: "11111111-1111-4111-8111-111111111111", scheduleId: "9001", generation: 1, routeRevision: 1,
    clientOwnerId: "22222222-2222-4222-8222-222222222222", routeInputDigest: "a".repeat(64),
    execution: "SIMULATOR", syncScope: "SANDBOX", savedRouteValidated: true, guidanceEnabled: true,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600,
};
const input = { schemaVersion: 1, context: "SAVED_ROUTE", routeRevision: 1,
    legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ kind, index, stops: index === 1 ? [{ name: '구로역' }] : [] })) } as JourneyRouteInput;
const snapshot = { enabled: true, status: "ACTIVE", sessionId: binding.sessionId, routeRevision: 1, guidanceActivityState: "ACTIVE",
    guidanceRoute: { ...binding, legs: input.legs.map(leg => ({ index: leg.index, kind: leg.kind,
        ...(leg.index === 0 ? { walkingLengthMeters: 200 } : leg.index === 1 ? { boardingStopName: '구로역' } : {}) })) },
    guidance: { ...binding, schemaVersion: 1, sequence: 20, status: "ACTIVE", phase: "WAITING", quality: "GOOD",
        activeLegIndex: 1, walkProgress: 1, observedAt: 1020, validUntil: 1035, boardingConfirmed: false } } as unknown as AutomaticJourneySnapshot;
beforeEach(() => {
    jest.useFakeTimers(); jest.setSystemTime(1021_000); jest.clearAllMocks();
    mockBinding.mockReturnValue(binding); mockRead.mockResolvedValue(snapshot);
});
afterEach(() => jest.useRealTimers());
it.each([0,2])('waiting after walk %i highlights its next bus occurrence, not always the first bus',walkIndex=>{
    const route={...input,legs:['WALK','BUS','WALK','BUS','WALK'].map((kind,index)=>({kind,index}))} as JourneyRouteInput;
    let view!:ReactTestRenderer;
    act(()=>{view=TestRenderer.create(<SavedJourneyRouteBar input={route} position={{legIndex:walkIndex,legProgress:1,barFraction:(walkIndex+1)/5,waiting:true}}/>);});
    for(let index=0;index<5;index++){
        const label=view.root.findByProps({testID:`saved-journey-route-label-${index}`});
        expect(JSON.stringify(label.props.children).includes('●')).toBe(index===walkIndex+1);
    }
    act(()=>view.unmount());
});
it('an already mounted detail subscribes when preparation creates a binding, and clears on stop', async () => {
    mockBinding.mockReturnValue(null);
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    expect(view.root.findAllByProps({ testID: 'saved-journey-guidance' })).toHaveLength(0);
    mockBinding.mockReturnValue(binding);
    await act(async () => mockSync());
    expect(view.root.findAllByProps({ testID: 'saved-journey-guidance' }).length).toBeGreaterThan(0);
    mockBinding.mockReturnValue(null);
    act(() => mockSync());
    expect(view.root.findAllByProps({ testID: 'saved-journey-guidance' })).toHaveLength(0);
    act(() => view.unmount());
    expect(mockSyncDetach).toHaveBeenCalled();
    act(() => jest.runOnlyPendingTimers()); expect(jest.getTimerCount()).toBe(0);
});
it('keeps current action text readable on both guidance card themes', async () => {
    const luminance = (hex: string) => {
        const c = hex.replace('#', '').match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    for (const isDark of [false, true]) {
        let view!: ReactTestRenderer;
        await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" isDark={isDark} />); });
        const background = StyleSheet.flatten(view.root.findByProps({ testID: 'saved-journey-guidance' }).props.style).backgroundColor;
        const ink = StyleSheet.flatten(view.root.findByProps({ testID: 'saved-journey-progress' }).props.style).color;
        const [low, high] = [luminance(background), luminance(ink)].sort((a, b) => a - b);
        expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
        act(() => view.unmount());
    }
});
it("shares the native snapshot and invalidates stale progress even without a new bridge event", async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    expect(view.root.findByProps({ testID: "saved-journey-instruction" }).props.children).toBe("구로역");
    expect(view.root.findByProps({ testID: "saved-journey-progress" }).props.children).toBe("버스 대기 · 도착하면 탑승 준비");
    expect(view.root.findByProps({ testID: "saved-journey-route-marker" }).props.style[1].left).toBe(`${1 / 3 * 100}%`);
    expect(view.root.findByProps({ testID: "saved-journey-route-position" }).props.children).toContain('구로역 · 버스 대기');
    act(() => { jest.advanceTimersByTime(15000); });
    expect(view.root.findByProps({ testID: "saved-journey-progress" }).props.children).toBe("현재 경로와 위치를 확인해 주세요");
    expect(view.root.findByProps({ testID: "saved-journey-instruction" }).props.children).toBe("위치 확인 중");
    expect(view.root.findAllByProps({ testID: "saved-journey-route-marker" })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: "saved-journey-route-leg-2" }).length).toBeGreaterThan(0);
    act(() => view.unmount()); expect(mockDetach).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});
it('moves the marker only on matching native GPS progress; candidate hides it without dropping route', async () => {
    mockRead.mockResolvedValue({ ...snapshot, guidance: { ...snapshot.guidance, phase: 'WALKING_TO_STOP', activeLegIndex: 0, walkProgress: 0.25 } });
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    const left = () => view.root.findByProps({ testID: 'saved-journey-route-marker' }).props.style[1].left;
    expect(left()).toBe(`${0.25 / 3 * 100}%`);
    act(() => jest.advanceTimersByTime(3000)); expect(left()).toBe(`${0.25 / 3 * 100}%`);
    act(() => mockEvent({ ...snapshot, guidance: { ...snapshot.guidance, phase: 'APPROACHING_STOP', activeLegIndex: 0, walkProgress: 0.6 } }));
    expect(left()).toBe(`${0.6 / 3 * 100}%`);
    act(() => mockEvent({ ...snapshot, guidance: { ...snapshot.guidance, phase: 'BOARDING_CANDIDATE', quality: 'UNCERTAIN' } }));
    expect(view.root.findAllByProps({ testID: 'saved-journey-route-marker' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'saved-journey-route-leg-1' }).length).toBeGreaterThan(0);
    act(() => view.unmount());
});
it('compact detail uses the same marker without the diagnostic card and hides it when stale', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" compact isDark />); });
    expect(view.root.findAllByProps({ testID: 'saved-journey-instruction' })).toHaveLength(0);
    expect(view.root.findByProps({ testID: 'saved-journey-route-marker' }).props.style[1].left).toBe(`${1 / 3 * 100}%`);
    act(() => jest.advanceTimersByTime(15000));
    expect(view.root.findAllByProps({ testID: 'saved-journey-route-marker' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'saved-journey-route-leg-2' }).length).toBeGreaterThan(0);
    act(() => view.unmount());
});
it("never subscribes for an unarmed or different saved route", async () => {
    mockBinding.mockReturnValue(null);
    const interval = jest.spyOn(globalThis, "setInterval");
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    expect(view.toJSON()).toBeNull(); expect(mockRead).not.toHaveBeenCalled();
    act(() => view.unmount()); expect(mockDetach).not.toHaveBeenCalled(); expect(interval).not.toHaveBeenCalled(); interval.mockRestore();
});
it("different schedule and changed native binding cannot show old progress", async () => {
    let different!: ReactTestRenderer; let view!: ReactTestRenderer;
    await act(async () => { different = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9002" />); });
    expect(different.toJSON()).toBeNull(); act(() => different.unmount());
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    act(() => { mockEvent({ ...snapshot, guidance: { ...snapshot.guidance, generation: 2 } }); });
    expect(view.toJSON()).toBeNull(); act(() => view.unmount());
});
it("uses common native arrival, updates display countdown only, and hides after expiry or mismatch", async () => {
    const withArrival = { ...snapshot, guidance: { ...snapshot.guidance, arrivalStatus: "WAITING_INFORMATION",
        arrival: { providerRouteId: "999999", directionLabel: "합성 동쪽 방면", sourceUpdatedAt: 920, expectedAt: 1040, validUntil: 1040 } } };
    mockRead.mockResolvedValue(withArrival);
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    expect(view.root.findByProps({ testID: "saved-journey-arrival" }).props.children).toContain("약 19초");
    act(() => { jest.advanceTimersByTime(3000); });
    expect(view.root.findByProps({ testID: "saved-journey-arrival" }).props.children).toContain("약 16초");
    act(() => mockEvent({ ...withArrival, guidance: { ...withArrival.guidance, arrivalStatus: "IDENTITY_MISMATCH" } }));
    expect(view.root.findByProps({ testID: "saved-journey-arrival" }).props.children).toBe("도착정보 확인 중 · 탑승 미확정");
    act(() => view.unmount()); expect(mockDetach).toHaveBeenCalledTimes(1);
});

it('timeline current step follows GPS, not map selection, and disappears on stale/route mismatch', async () => {
    const route = { id: 'saved', steps: [{ id: 'origin', type: 'ORIGIN', title: '출발' },
        ...input.legs.map(leg => ({ id: `leg-${leg.index}`, type: leg.kind, title: leg.kind })),
        { id: 'destination', type: 'DESTINATION', title: '도착' }] } as RouteInfo;
    const onStepPress = jest.fn();
    mockRead.mockResolvedValue({ ...snapshot, guidance: { ...snapshot.guidance, phase: 'WALKING_TO_STOP', activeLegIndex: 0, walkProgress: 0.5 } });
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyRouteTimeline input={input} scheduleId="9001" routeInfo={route}
        selectedStepId="leg-2" onStepPress={onStepPress} compact />); });
    expect(view.root.findAllByProps({ testID: 'journey-current-step-leg-0' }).length).toBeGreaterThan(0);
    expect(view.root.findAllByProps({ testID: 'journey-current-step-leg-2' })).toHaveLength(0);
    act(() => view.root.findByProps({ testID: 'route-step-row-leg-2' }).props.onPress());
    expect(onStepPress).toHaveBeenCalledTimes(1);
    expect(view.root.findAllByProps({ testID: 'journey-current-step-leg-0' }).length).toBeGreaterThan(0);
    act(() => mockEvent(snapshot));
    expect(view.root.findAllByProps({ testID: 'journey-current-step-leg-0' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'journey-current-step-leg-1' }).length).toBeGreaterThan(0);
    act(() => jest.advanceTimersByTime(15000));
    expect(view.root.findAllByProps({ testID: 'journey-current-step-leg-1' })).toHaveLength(0);
    act(() => view.unmount()); expect(mockDetach).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
it('disabled timeline rows still expose full names and grow without fixed line heights', async () => {
    const name = '전체 긴 노선명을 축약하지 않는 접근성 시험 버스';
    const named = { ...input, legs: input.legs.map(leg => ({ ...leg, display: { lineName: leg.kind === 'BUS' ? name : null,
        lineColor: '#FFF5A0', durationMinutes: 5, distanceMeters: null } })) };
    const route = { id: 'saved', steps: named.legs.map(leg => ({ id: `leg-${leg.index}`, type: leg.kind, title: leg.kind, lineName: '축약' })) } as RouteInfo;
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyRouteTimeline input={named} scheduleId="9001" routeInfo={route} compact />); });
    const row = view.root.findByProps({ testID: 'route-step-row-leg-1' });
    expect(row.props.disabled).toBe(true); expect(row.props.accessible).toBe(true); expect(row.props.accessibilityLabel).toContain(name);
    const full = view.root.findByProps({ testID: 'route-step-full-name-leg-1' });
    expect(full.props.children).toBe(name); expect(full.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(full.props.style).lineHeight).toBeUndefined();
    act(() => view.unmount());
});

it('late initial reads cannot overwrite a newer event or revive guidance after stop', async () => {
    let finish!: (value: AutomaticJourneySnapshot) => void;
    mockRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={input} scheduleId="9001" />); });
    act(() => mockEvent({ ...snapshot, status: 'STOPPED' }));
    await act(async () => finish(snapshot));
    expect(view.toJSON()).toBeNull();
    act(() => view.unmount()); expect(mockDetach).toHaveBeenCalledTimes(1);
});
it('renders native-budgeted time proportions, provider color/name and matching GPS marker', async () => {
    const route = { ...input, legs: input.legs.map(leg => ({ ...leg, display: { durationMinutes: [2, 5, 2][leg.index], distanceMeters: null,
        lineName: leg.kind === 'BUS' ? '601' : null, lineColor: leg.kind === 'BUS' ? '#E8752B' : null } })) };
    mockRead.mockResolvedValue({ ...snapshot, guidanceRoute: { ...binding, legs: route.legs.map(leg => ({ index: leg.index, kind: leg.kind, ...leg.display })) },
        guidance: { ...snapshot.guidance, phase: 'WALKING_TO_STOP', activeLegIndex: 0, walkProgress: 0.6 } });
    let view!: ReactTestRenderer;
    await act(async () => { view = TestRenderer.create(<SavedJourneyGuidanceCard input={route} scheduleId="9001" />); });
    expect(view.root.findByProps({ testID: 'saved-journey-route-leg-1' }).props.style[1]).toMatchObject({ flex: 5 / 9, backgroundColor: '#E8752B' });
    expect(view.root.findByProps({ testID: 'saved-journey-route-marker' }).props.style[1].left).toBe(`${0.6 * (2 / 9) * 100}%`);
    const arrow = view.root.findByProps({ testID: 'saved-journey-route-marker' }).findByType(Text);
    expect(arrow.props.maxFontSizeMultiplier).toBe(1); expect(arrow.props.accessible).toBe(false);
    const track = view.root.findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('예정 시간 비례'))[0];
    expect(track.props.accessibilityLabel).toContain('601 예정 5분'); expect(track.props.accessibilityLabel).toContain('전체 여정 완료율이 아닙니다');
    act(() => view.unmount());
});
it('long routes retain every original segment and accessible ordinal without disabling font scaling', () => {
    const route = { ...input, legs: Array.from({ length: 32 }, (_, index) => ({ ...input.legs[index === 0 ? 0 : 1], index })) };
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<SavedJourneyRouteBar input={route} position={null} isDark />); });
    for (let index = 0; index < 32; index++) expect(view.root.findAllByProps({ testID: `saved-journey-route-leg-${index}` }).length).toBeGreaterThan(0);
    const track = view.root.findAll(node => typeof node.props.accessibilityLabel === 'string')[0];
    expect(track.props.accessibilityLabel).toContain('32. 버스'); expect(track.props.accessibilityLabel).toContain('구간 동일 폭');
    expect(view.root.findAllByProps({ allowFontScaling: false })).toHaveLength(0);
    act(() => view.unmount());
});

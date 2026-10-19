import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AppState, Platform, type AppStateStatus } from "react-native";

import JourneyAutomaticRoute from "../app/internal/journey-automatic";
import { JourneyAutomaticTrialPanel, JourneySelectedRouteTrial } from "../src/modules/journey/JourneySelectedRouteTrial";
import {
    canPrepareAutomaticJourneyAssessment, useAutomaticJourneyTrial, type AutomaticJourneyTrialScope,
} from "../src/modules/journey/useAutomaticJourneyTrial";
import type { AutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";
import type { JourneyRouteAssessmentResult } from "../src/modules/journey/journeyRouteAssessment";
import type { JourneyRouteInput } from "../src/modules/journey/journeyRouteInput";
import type { RouteAlternativeOption } from "../src/modules/map/routingService";

const mockGet = jest.fn();
const mockSubscribe = jest.fn();
const mockPrepare = jest.fn();
const mockRestore = jest.fn();
const mockStop = jest.fn();
const mockAssess = jest.fn();
const mockRetry = jest.fn();
const mockReconcile = jest.fn();
const mockPause = jest.fn();
const mockSyncSubscribe = jest.fn();
const mockAuthSubscribe = jest.fn();
const mockDetach = jest.fn();
const mockSyncDetach = jest.fn();
const mockAuthDetach = jest.fn();
const mockReplace = jest.fn();
let mockSyncState: { status: "IDLE" | "PENDING" | "SENDING" | "ACKNOWLEDGED" | "RETRY_WAIT" | "BLOCKED"; paused: boolean; errorCode: string | null };

jest.mock("../src/modules/journey/automaticJourney", () => ({
    getAutomaticJourneySnapshot: () => mockGet(),
    subscribeAutomaticJourney: (listener: (snapshot: AutomaticJourneySnapshot) => void) => mockSubscribe(listener),
}), { virtual: true });
jest.mock("../src/modules/journey/automaticJourneyTrial", () => ({
    prepareAutomaticJourneyTrial: (input: JourneyRouteInput, scope: AutomaticJourneyTrialScope) => mockPrepare(input, scope),
    restoreAutomaticJourneyTrial: (input: JourneyRouteInput) => mockRestore(input),
    stopAutomaticJourneyTrial: () => mockStop(),
    retryAutomaticJourneySync: () => mockRetry(),
    retryAutomaticJourneyStops: async () => undefined,
    reconcileAutomaticJourneyCheckpoint: () => mockReconcile(),
    setAutomaticJourneySyncPaused: (paused: boolean) => mockPause(paused),
    subscribeAutomaticJourneySync: (listener: (state: typeof mockSyncState) => void) => mockSyncSubscribe(listener),
    getAutomaticJourneySyncState: () => mockSyncState,
}), { virtual: true });
jest.mock("../src/modules/journey/journeyRouteAssessment", () => ({
    assessJourneyRouteInput: (input: JourneyRouteInput) => mockAssess(input),
}));
jest.mock("../src/modules/auth/authStorage", () => ({ subscribeAuthInvalidation: (listener: () => Promise<void>) => mockAuthSubscribe(listener) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({ Redirect: "Redirect", useRouter: () => ({ canGoBack: () => false, replace: mockReplace }) }));
jest.mock("../src/modules/journey/journeyRouteFixtures", () => ({
    journeyRouteFixtures: ["direct-provider-shape", "wrong-direction-shape", "invalid-middle-coordinate"].map((id, index) => ({
        id, title: id, description: `${id} 합성 설명`, input: mockInput("SYNTHETIC_FIXTURE", index > 0),
    })),
}));

function mockInput(context: JourneyRouteInput["context"] = "SYNTHETIC_FIXTURE", bad = false): JourneyRouteInput {
    return {
        schemaVersion: 1, routeRevision: 1, context, provider: "tmap", source: "api", reliability: "live_provider",
        plausibility: "normal", serviceState: "operating",
        origin: { latitude: 37.5665, longitude: 126.978 }, destination: { latitude: 37.5665, longitude: 126.98 },
        legs: [{
            index: 0, kind: "WALK", geometrySource: "WALK_STEPS_LINESTRING", geometryInputComplete: true, exact: true,
            coordinates: [{ latitude: 37.5665, longitude: 126.978 }, { latitude: bad ? 95 : 37.5665, longitude: 126.98 }],
            start: { latitude: 37.5665, longitude: 126.978 }, end: { latitude: 37.5665, longitude: 126.98 },
            providerRouteId: null, localRouteId: null, directionName: null, directionCode: null,
            serviceAvailable: true, declaredStationCount: null, stopEvidenceProvider: "tmap", stopEvidenceVersion: 1, stops: [],
        }],
    };
}
function assessmentFor(input: JourneyRouteInput): JourneyRouteAssessmentResult {
    const geometryUsable = input.legs[0].coordinates.every(point => point !== null && point.latitude < 90);
    return { available: true, summary: {
        schemaVersion: 1, routeRevision: input.routeRevision, context: input.context, provider: input.provider,
        evaluationMode: "READ_ONLY", fullAutomaticGuidance: false, fieldValidated: false,
        eligibleDepartureLegIndex: geometryUsable && input.context === "ROUTING_RESPONSE" ? 0 : null,
        reasonCodes: [
            ...(input.context === "SYNTHETIC_FIXTURE" ? ["SYNTHETIC_FIXTURE_ONLY"] : []),
            ...(geometryUsable ? [] : ["FIRST_WALK_GEOMETRY_UNUSABLE"]),
        ],
        legs: [{ index: 0, kind: "WALK", geometryUsable, geometryLengthMeters: geometryUsable ? 176 : null,
            stopSequenceUsable: false, directionExplicit: false, rideNavigationEligible: false,
            shapePointCount: input.legs[0].coordinates.length, stopCount: 0, reasonCodes: geometryUsable ? [] : ["GEOMETRY_COORDINATE_INVALID"] }],
    } };
}
const ready: AutomaticJourneySnapshot = {
    enabled: true, reason: null, status: "IDLE", sessionId: null, routeRevision: null,
    alongRouteMeters: null, crossTrackMeters: null, departureCount: 0, quality: "UNKNOWN", qualityReason: "NO_OBSERVATION",
    locationState: "STOPPED", authorization: "NOT_COLLECTING", pendingDeparture: false, departureAcknowledged: false,
    syncScope: "NONE", remainingSeconds: 0, lastErrorCode: null, checkpointAvailable: true,
};
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;
const originalOS = Platform.OS;

describe("P1-3 explicit automatic preparation UI", () => {
    let renderer: ReactTestRenderer | undefined;
    let current: ReturnType<typeof useAutomaticJourneyTrial>;
    let emit: (snapshot: AutomaticJourneySnapshot) => void;
    let emitSync: (state: typeof mockSyncState) => void;
    let invalidateAuth: () => Promise<void>;
    let appState: (state: AppStateStatus) => void;
    const removeAppState = jest.fn();
    function Probe({ input, scope = "SANDBOX", blocked = false }: { input: JourneyRouteInput; scope?: AutomaticJourneyTrialScope; blocked?: boolean }) {
        current = useAutomaticJourneyTrial(input, scope, blocked);
        return null;
    }
    beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        mockSyncState = { status: "IDLE", paused: false, errorCode: null };
        mockGet.mockResolvedValue(ready);
        mockSubscribe.mockImplementation(listener => { emit = listener; return mockDetach; });
        mockSyncSubscribe.mockImplementation(listener => { emitSync = listener; return mockSyncDetach; });
        mockAuthSubscribe.mockImplementation(listener => { invalidateAuth = listener; return mockAuthDetach; });
        mockAssess.mockImplementation(async (input: JourneyRouteInput) => assessmentFor(input));
        mockPrepare.mockImplementation(async (_input: JourneyRouteInput, scope: AutomaticJourneyTrialScope) => ({ ...ready, status: "ARMED", sessionId: "trial-one", routeRevision: 1, syncScope: scope, remainingSeconds: 600 }));
        mockRestore.mockResolvedValue({ ...ready, status: "ARMED", sessionId: "trial-restored", routeRevision: 1 });
        mockStop.mockResolvedValue({ ...ready, status: "STOPPED" });
        mockRetry.mockResolvedValue(undefined);
        mockReconcile.mockResolvedValue(undefined);
        mockPause.mockImplementation(paused => { mockSyncState = { ...mockSyncState, paused }; emitSync(mockSyncState); });
        jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => { appState = listener; return { remove: removeAppState }; });
    });
    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        runtime.__DEV__ = originalDev;
        Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
        jest.restoreAllMocks();
    });
    const render = async (element: React.ReactElement) => {
        await act(async () => { renderer = TestRenderer.create(element); });
        return renderer!;
    };
    const press = async (screen: ReactTestRenderer, id: string) => {
        await act(async () => screen.root.findByProps({ testID: id }).props.onPress());
    };
    const consentAndAssess = async () => {
        await act(async () => current.assess());
        await act(async () => current.setConsented(true));
    };

    it('authenticated cold mount reconciles automatically without consent prepare or restore', async () => {
        mockReconcile.mockImplementation(async () => { mockGet.mockResolvedValue({ ...ready, checkpointAvailable: false }); });
        await render(<Probe input={mockInput()} scope="AUTHENTICATED" />);
        expect(mockReconcile).toHaveBeenCalledTimes(1);
        expect(current.snapshot?.checkpointAvailable).toBe(false);
        expect(mockPrepare).not.toHaveBeenCalled(); expect(mockRestore).not.toHaveBeenCalled(); expect(mockStop).not.toHaveBeenCalled();
    });
    it('authenticated foreground rechecks checkpoint while a blocked source does no work', async () => {
        await render(<Probe input={mockInput()} scope="AUTHENTICATED" blocked />);
        expect(mockReconcile).not.toHaveBeenCalled();
        await act(async () => renderer!.update(<Probe input={mockInput()} scope="AUTHENTICATED" />));
        const before = mockReconcile.mock.calls.length;
        await act(async () => {
            for (const call of jest.mocked(AppState.addEventListener).mock.calls) call[1]('active');
        });
        expect(mockReconcile.mock.calls.length).toBeGreaterThan(before);
        expect(mockRestore).not.toHaveBeenCalled();
    });
    it('foreground fallback reads terminal state after a missed native event without changing navigation', async () => {
        const descriptor=Object.getOwnPropertyDescriptor(AppState,'currentState');
        Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});
        const intervals=jest.spyOn(globalThis,'setInterval');
        try {
            await render(<Probe input={mockInput()} />);
            const poll=intervals.mock.calls.find(call=>call[1]===2000)![0] as ()=>void;
            mockGet.mockResolvedValue({...ready,status:'EXPIRED',remainingSeconds:0,checkpointAvailable:false});
            await act(async()=>poll());
            expect(current.snapshot?.status).toBe('EXPIRED');
            expect(mockPrepare).not.toHaveBeenCalled();expect(mockRestore).not.toHaveBeenCalled();expect(mockStop).not.toHaveBeenCalled();
            Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'background'});
            const reads=mockGet.mock.calls.length;await act(async()=>poll());expect(mockGet).toHaveBeenCalledTimes(reads);
        } finally {if(descriptor)Object.defineProperty(AppState,'currentState',descriptor);}
    });
    it('does not overlap pending fallback reads or apply one after a newer native event',async()=>{
        const descriptor=Object.getOwnPropertyDescriptor(AppState,'currentState');
        Object.defineProperty(AppState,'currentState',{configurable:true,writable:true,value:'active'});
        const intervals=jest.spyOn(globalThis,'setInterval');
        try {
            await render(<Probe input={mockInput()} />);
            const poll=intervals.mock.calls.find(call=>call[1]===2000)![0] as ()=>void;
            let resolve!:(value:AutomaticJourneySnapshot)=>void;
            mockGet.mockReturnValue(new Promise(r=>{resolve=r;}));
            await act(async()=>{poll();poll();});const reads=mockGet.mock.calls.length;
            await act(async()=>emit({...ready,status:'STOPPED'}));
            await act(async()=>resolve({...ready,status:'ACTIVE'}));
            expect(mockGet).toHaveBeenCalledTimes(reads);expect(current.snapshot?.status).toBe('STOPPED');
        } finally {if(descriptor)Object.defineProperty(AppState,'currentState',descriptor);}
    });
    it("mounts with snapshot reads and subscriptions only, without assessing or preparing", async () => {
        await render(<Probe input={mockInput()} />);
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockSubscribe).toHaveBeenCalledTimes(1);
        expect(mockAssess).not.toHaveBeenCalled();
        expect(mockPrepare).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
        expect(current.canPrepare).toBe(false);
    });

    it("requires both explicit assessment and consent before preparing SANDBOX", async () => {
        const input = mockInput();
        await render(<Probe input={input} />);
        await act(async () => current.prepare());
        expect(mockPrepare).not.toHaveBeenCalled();
        await act(async () => current.assess());
        expect(current.canPrepare).toBe(false);
        await act(async () => current.setConsented(true));
        await act(async () => current.prepare());
        expect(mockPrepare).toHaveBeenCalledWith(input, "SANDBOX");
        expect(current.snapshot?.status).toBe("ARMED");
        expect(current.snapshot?.departureCount).toBe(0);
    });

    it("passes a selected routing response only to LOCAL_ONLY preparation", async () => {
        const input = mockInput("ROUTING_RESPONSE");
        await render(<Probe input={input} scope="LOCAL_ONLY" />);
        await consentAndAssess();
        await act(async () => current.prepare());
        expect(mockPrepare).toHaveBeenCalledWith(input, "LOCAL_ONLY");
        expect(current.snapshot?.syncScope).toBe("LOCAL_ONLY");
    });

    it("rejects bad first-walk geometry even after consent", async () => {
        await render(<Probe input={mockInput("SYNTHETIC_FIXTURE", true)} />);
        await consentAndAssess();
        await act(async () => current.prepare());
        expect(current.eligible).toBe(false);
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("resets assessment and consent on selection or scope change", async () => {
        const input = mockInput();
        const screen = await render(<Probe input={input} />);
        await consentAndAssess();
        expect(current.canPrepare).toBe(true);
        await act(async () => screen.update(<Probe input={{ ...input }} />));
        expect(current.assessment).toBeNull();
        expect(current.consented).toBe(false);
        await consentAndAssess();
        await act(async () => screen.update(<Probe input={input} scope="LOCAL_ONLY" />));
        expect(current.assessment).toBeNull();
        expect(current.consented).toBe(false);
    });

    it("discards an assessment that completes after selecting another route", async () => {
        const old = mockInput();
        let complete!: (result: JourneyRouteAssessmentResult) => void;
        mockAssess.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const screen = await render(<Probe input={old} />);
        await act(async () => { current.assess().catch(() => undefined); });
        await act(async () => screen.update(<Probe input={mockInput("SYNTHETIC_FIXTURE", true)} />));
        await act(async () => complete(assessmentFor(old)));
        expect(current.assessment).toBeNull();
        expect(current.pending).toBe(false);
        expect(current.canPrepare).toBe(false);
    });

    it("never replaces an existing ARMED or ACTIVE session with a new preparation", async () => {
        await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        for (const status of ["ARMED", "ACTIVE"] as const) {
            await act(async () => emit({ ...ready, status, sessionId: "existing", routeRevision: 1 }));
            await act(async () => current.prepare());
            expect(current.canPrepare).toBe(false);
        }
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("blocks a new preparation while an unacknowledged event remains, without blocking explicit recovery", async () => {
        await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        await act(async () => emit({ ...ready, pendingDeparture: true }));
        expect(current.canPrepare).toBe(false);
        expect(current.canRestore).toBe(true);
        await act(async () => current.prepare());
        expect(mockPrepare).not.toHaveBeenCalled();
        await act(async () => current.restore());
        expect(mockRestore).toHaveBeenCalledTimes(1);
    });

    it("deduplicates rapid preparation presses while the native request is pending", async () => {
        let complete!: (snapshot: AutomaticJourneySnapshot) => void;
        mockPrepare.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        await act(async () => {
            current.prepare().catch(() => undefined);
            current.prepare().catch(() => undefined);
        });
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        await act(async () => complete({ ...ready, status: "ARMED" }));
    });

    it("does not let a late snapshot read overwrite a newer location event", async () => {
        let complete!: (snapshot: AutomaticJourneySnapshot) => void;
        mockGet.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        await render(<Probe input={mockInput()} />);
        await act(async () => emit({ ...ready, status: "ACTIVE", departureCount: 1 }));
        await act(async () => complete(ready));
        expect(current.snapshot?.status).toBe("ACTIVE");
    });

    it("does not let a late preparation reply replace a newer ACTIVE event", async () => {
        let complete!: (snapshot: AutomaticJourneySnapshot) => void;
        mockPrepare.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        await act(async () => { current.prepare().catch(() => undefined); });
        await act(async () => emit({ ...ready, status: "ACTIVE", departureCount: 1 }));
        await act(async () => complete({ ...ready, status: "ARMED" }));
        expect(current.snapshot?.status).toBe("ACTIVE");
        expect(current.pending).toBe(false);
    });

    it("closing a view detaches listeners but never stops a consented native session", async () => {
        const screen = await render(<Probe input={mockInput()} />);
        await act(async () => emit({ ...ready, status: "ARMED" }));
        await act(async () => screen.unmount());
        renderer = undefined;
        expect(mockDetach).toHaveBeenCalledTimes(1);
        expect(mockSyncDetach).toHaveBeenCalledTimes(1);
        expect(mockAuthDetach).toHaveBeenCalledTimes(1);
        expect(removeAppState).toHaveBeenCalledTimes(2);
        expect(mockStop).not.toHaveBeenCalled();
    });

    it("does not stop an explicitly authorized preparation that completes after unmounting", async () => {
        let complete!: (snapshot: AutomaticJourneySnapshot) => void;
        mockPrepare.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const screen = await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        await act(async () => { current.prepare().catch(() => undefined); });
        await act(async () => screen.unmount());
        renderer = undefined;
        await act(async () => complete({ ...ready, status: "ARMED" }));
        expect(mockStop).not.toHaveBeenCalled();
    });

    it("stops on auth invalidation and clears the pending selection consent", async () => {
        await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        await act(async () => invalidateAuth());
        expect(mockStop).toHaveBeenCalledTimes(1);
        expect(current.snapshot?.status).toBe("STOPPED");
        expect(current.consented).toBe(false);
        expect(current.assessment).toBeNull();
    });

    it("ignores an assessment completing after authentication invalidation", async () => {
        const input = mockInput();
        let complete!: (result: JourneyRouteAssessmentResult) => void;
        mockAssess.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        await render(<Probe input={input} />);
        await act(async () => { current.assess().catch(() => undefined); });
        await act(async () => invalidateAuth());
        await act(async () => complete(assessmentFor(input)));
        expect(current.assessment).toBeNull();
        expect(current.canPrepare).toBe(false);
    });

    it("restores only after checking and consenting to the current selected input", async () => {
        const input = mockInput();
        await render(<Probe input={input} />);
        await act(async () => current.restore());
        expect(mockRestore).not.toHaveBeenCalled();
        await consentAndAssess();
        await act(async () => current.restore());
        expect(mockRestore).toHaveBeenCalledWith(input);
    });

    it("refreshes on foreground return without rearming or restoring", async () => {
        await render(<Probe input={mockInput()} />);
        await act(async () => appState("background"));
        expect(mockGet).toHaveBeenCalledTimes(1);
        await act(async () => appState("active"));
        expect(mockGet).toHaveBeenCalledTimes(2);
        expect(mockPrepare).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
    });

    it("requires native capability and a stable route selection", async () => {
        mockGet.mockResolvedValue({ ...ready, enabled: false, reason: "DEVELOPMENT_SIMULATOR_ONLY" });
        const input = mockInput();
        const screen = await render(<Probe input={input} />);
        await act(async () => current.assess());
        expect(mockAssess).not.toHaveBeenCalled();
        await act(async () => emit(ready));
        await consentAndAssess();
        await act(async () => screen.update(<Probe input={input} blocked />));
        await act(async () => current.prepare());
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("sanitizes raw preparation exceptions without exposing personal fields", async () => {
        mockPrepare.mockRejectedValue(new Error("token=private latitude=37.5"));
        await render(<Probe input={mockInput()} />);
        await consentAndAssess();
        await act(async () => current.prepare());
        expect(current.errorCode).toBe("AUTOMATIC_TRIAL_UNAVAILABLE");
        mockPrepare.mockRejectedValue(new Error("ROUTE_INPUT_REJECTED"));
        await act(async () => current.prepare());
        expect(current.errorCode).toBe("ROUTE_INPUT_REJECTED");
    });

    it("permits only sandbox sync controls, without creating departure events", async () => {
        const input = mockInput();
        const screen = await render(<Probe input={input} />);
        await act(async () => emit({ ...ready, status: "ACTIVE", syncScope: "SANDBOX", pendingDeparture: true }));
        await act(async () => current.setSyncPaused(true));
        await act(async () => current.retrySync());
        expect(mockPause).toHaveBeenCalledWith(true);
        expect(mockRetry).toHaveBeenCalledTimes(1);
        expect(mockPrepare).not.toHaveBeenCalled();
        await act(async () => screen.update(<Probe input={input} scope="LOCAL_ONLY" />));
        await act(async () => current.setSyncPaused(false));
        await act(async () => current.retrySync());
        expect(mockPause).toHaveBeenCalledTimes(1);
        expect(mockRetry).toHaveBeenCalledTimes(1);
    });

    it("renders native progress and durable pending/ack state without manual advance controls", async () => {
        const screen = await render(<JourneyAutomaticTrialPanel input={mockInput()} scope="SANDBOX" />);
        await act(async () => emit({ ...ready, status: "ACTIVE", departureCount: 1, alongRouteMeters: 88.5, crossTrackMeters: 2,
            pendingDeparture: true, syncScope: "SANDBOX", remainingSeconds: 570 }));
        await act(async () => emitSync({ status: "RETRY_WAIT", paused: true, errorCode: "NETWORK_UNAVAILABLE" }));
        expect(screen.root.findByProps({ testID: "automatic-journey-status" }).props.children).toBe("ACTIVE");
        expect(screen.root.findByProps({ testID: "automatic-journey-distance" }).props.children.join("")).toContain("88.5 m");
        expect(screen.root.findByProps({ testID: "automatic-journey-departure-count" }).props.children.join("")).toBe("자동 출발 감지 1회");
        expect(screen.root.findByProps({ testID: "automatic-journey-pending-departure" }).props.children.join("")).toContain("있음");
        expect(screen.root.findAllByProps({ testID: "journey-advance" })).toHaveLength(0);
        expect(screen.root.findAllByProps({ testID: "journey-start" })).toHaveLength(0);
        expect(JSON.stringify(screen.toJSON())).toContain("탑승/하차·음성 미지원");
        await act(async () => emit({ ...ready, status: "ACTIVE", departureAcknowledged: true, syncScope: "SANDBOX" }));
        expect(screen.root.findByProps({ testID: "automatic-journey-acknowledged" }).props.children.join("")).toContain("완료");
    });

    it("the internal screen keeps synthetic provenance and does not stop on close", async () => {
        const screen = await render(<JourneyAutomaticRoute />);
        await press(screen, "automatic-journey-assess");
        expect(mockAssess.mock.calls[0][0].context).toBe("SYNTHETIC_FIXTURE");
        await press(screen, "automatic-journey-consent");
        await press(screen, "automatic-journey-prepare");
        expect(mockPrepare.mock.calls[0][1]).toBe("SANDBOX");
        await press(screen, "automatic-journey-close");
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
        expect(mockStop).not.toHaveBeenCalled();
    });

    it("the internal fixture chooser clears prior consent and blocks invalid geometry", async () => {
        const screen = await render(<JourneyAutomaticRoute />);
        await press(screen, "automatic-journey-assess");
        await press(screen, "automatic-journey-consent");
        await press(screen, "automatic-journey-fixture-invalid-middle-coordinate");
        expect(screen.root.findByProps({ testID: "automatic-journey-consent" }).props.accessibilityState.checked).toBe(false);
        await press(screen, "automatic-journey-assess");
        await press(screen, "automatic-journey-consent");
        expect(screen.root.findByProps({ testID: "automatic-journey-prepare" }).props.disabled).toBe(true);
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("the actual selected-route entry builds a fresh-response input without mutating its route", async () => {
        const route = { id: "selected", mode: "TRANSIT", minutes: 10, source: "api", provider: "tmap", transitLegs: [{
            kind: "WALK", pathCoords: [{ lat: 37.5, lng: 127 }, { lat: 37.501, lng: 127 }],
            navigationEvidence: { version: 1, provider: "tmap", geometryInputComplete: true, stopOccurrences: [] },
        }] } as unknown as RouteAlternativeOption;
        const serialized = JSON.stringify(route);
        const screen = await render(<JourneySelectedRouteTrial route={route} origin={{ name: "출발", lat: 37.5, lng: 127 }} destination={{ name: "도착", lat: 37.501, lng: 127 }} />);
        await press(screen, "automatic-journey-assess");
        expect(mockAssess.mock.calls[0][0]).toMatchObject({ context: "ROUTING_RESPONSE", routeRevision: 1, origin: { latitude: 37.5, longitude: 127 } });
        expect(screen.root.findAllByProps({ testID: "automatic-journey-sync-pause" })).toHaveLength(0);
        expect(JSON.stringify(route)).toBe(serialized);
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it.each(["BUS", "SUBWAY"] as const)("the selected first %s route keeps local-only preparation and chooses its observation stage", async firstTransitKind => {
        const coordinate = (longitude: number) => ({ lat: 37.5665, lng: longitude });
        const leg = (kind: "WALK" | "BUS" | "SUBWAY", start: number, end: number) => ({
            kind, pathGeometrySource: kind === "WALK" ? "WALK_STEPS_LINESTRING" : "PROVIDER_SHAPE",
            pathCoordsIsExact: true, pathCoords: [coordinate(start), coordinate(end)],
            startCoord: coordinate(start), endCoord: coordinate(end), serviceAvailable: true,
            navigationEvidence: { version: 1, provider: "tmap", geometryInputComplete: true,
                directionName: kind === "WALK" ? undefined : "합성 종점 방면", declaredStationCount: kind === "WALK" ? undefined : 1,
                stopOccurrences: kind === "WALK" ? [] : [start, end].map((longitude, index) => ({
                    sourceIndex: index, providerSequence: index, name: `합성 정류장 ${index}`, coord: coordinate(longitude),
                })),
            },
        });
        const route = { id: "selected-fresh-transit", mode: "TRANSIT", minutes: 10, source: "api", provider: "tmap",
            routeReliability: "live_provider", routePlausibility: "normal", transitServiceState: "operating",
            transitLegs: [leg("WALK", 126.978, 126.9795), leg(firstTransitKind, 126.9795, 126.9895),
                ...(firstTransitKind === "SUBWAY" ? [leg("BUS", 126.9895, 126.995)] : [])],
        } as unknown as RouteAlternativeOption;
        const before = JSON.stringify(route);
        const screen = await render(<JourneySelectedRouteTrial route={route}
            origin={{ name: "출발", ...coordinate(126.978) }}
            destination={{ name: "도착", ...coordinate(firstTransitKind === "BUS" ? 126.9895 : 126.995) }} />);
        expect(screen.root.findByProps({ testID: "automatic-journey-stage" }).props.children.join("")).toContain(firstTransitKind === "BUS" ? "P2-2" : "P1-3");
        expect(screen.root.findAllByProps({ testID: "journey-bus-observation" }).length > 0).toBe(firstTransitKind === "BUS");
        expect(screen.root.findAllByProps({ testID: "automatic-journey-sync-pause" })).toHaveLength(0);
        expect(mockPrepare).not.toHaveBeenCalled();
        await press(screen, "automatic-journey-assess");
        await press(screen, "automatic-journey-consent");
        await press(screen, "automatic-journey-prepare");
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(mockPrepare.mock.calls[0][1]).toBe("LOCAL_ONLY");
        expect(mockPrepare.mock.calls[0][0]).toMatchObject({ context: "ROUTING_RESPONSE", routeRevision: 1 });
        expect(mockPrepare.mock.calls[0][0].legs.map((entry: { kind: string }) => entry.kind)).toEqual(firstTransitKind === "BUS" ? ["WALK", "BUS"] : ["WALK", "SUBWAY", "BUS"]);
        expect(JSON.stringify(route)).toBe(before);
    });

    it("release builds and Android never mount automatic development controls", async () => {
        runtime.__DEV__ = false;
        let screen = await render(<JourneyAutomaticRoute />);
        expect(screen.root.findAllByProps({ testID: "automatic-journey-panel" })).toHaveLength(0);
        expect(mockGet).not.toHaveBeenCalled();
        await act(async () => screen.unmount());
        renderer = undefined;
        runtime.__DEV__ = true;
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        screen = await render(<JourneySelectedRouteTrial route={{ id: "selected", mode: "TRANSIT", minutes: 10, source: "api", provider: "tmap" }} />);
        expect(screen.toJSON()).toBeNull();
        expect(mockGet).not.toHaveBeenCalled();
    });
});

describe("P1-3 preparation eligibility guard", () => {
    it("never upgrades saved or synthetic routes to LOCAL_ONLY live response readiness", () => {
        for (const context of ["SAVED_ROUTE", "SYNTHETIC_FIXTURE"] as const) {
            const input = mockInput(context);
            expect(canPrepareAutomaticJourneyAssessment(input, "LOCAL_ONLY", assessmentFor(input))).toBe(false);
        }
    });
    it("permits only the synthetic-context reason for sandbox preparation", () => {
        const input = mockInput();
        const result = assessmentFor(input);
        if (!result.available) throw new Error("Invalid test fixture");
        expect(canPrepareAutomaticJourneyAssessment(input, "SANDBOX", result)).toBe(true);
        expect(canPrepareAutomaticJourneyAssessment(input, "SANDBOX", { ...result, summary: { ...result.summary, reasonCodes: [] } })).toBe(false);
        expect(canPrepareAutomaticJourneyAssessment(input, "SANDBOX", { ...result, summary: { ...result.summary, reasonCodes: ["SYNTHETIC_FIXTURE_ONLY", "ORIGIN_MISMATCH"] } })).toBe(false);
        expect(canPrepareAutomaticJourneyAssessment(input, "SANDBOX", { ...result, summary: { ...result.summary, routeRevision: 2 } })).toBe(false);
    });
    it.each([null, 69.9, 100_000.1])("blocks an invalid sandbox first-walk length %s", geometryLengthMeters => {
        const input = mockInput();
        const result = assessmentFor(input);
        if (!result.available) throw new Error("Invalid test fixture");
        result.summary.legs[0].geometryLengthMeters = geometryLengthMeters;
        expect(canPrepareAutomaticJourneyAssessment(input, "SANDBOX", result)).toBe(false);
    });
});

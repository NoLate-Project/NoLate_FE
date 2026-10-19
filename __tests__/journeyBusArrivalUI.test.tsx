import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AppState } from "react-native";
import { JourneyBusArrivalTrial } from "../src/modules/journey/JourneyBusArrivalTrial";
import type { JourneyRouteInput } from "../src/modules/journey/journeyRouteInput";
import type { JourneyBusRouteMapping } from "../src/modules/journey/journeyBusRouteBinding";

const mockSnapshot = jest.fn();
const mockBinding = jest.fn();
let mockNativeListener: (v: unknown) => void;
jest.mock("../src/modules/journey/automaticJourney", () => ({ getAutomaticJourneySnapshot: () => mockSnapshot(),
    subscribeAutomaticJourney: (listener: typeof mockNativeListener) => { mockNativeListener = listener; return jest.fn(); } }), { virtual: true });
jest.mock("../src/modules/journey/automaticJourneyTrial", () => ({ getAutomaticJourneyTrialBinding: () => mockBinding() }), { virtual: true });
const input = { context: "SYNTHETIC_FIXTURE" } as JourneyRouteInput;
const mapping: JourneyBusRouteMapping = { status: "SUPPORTED", query: { namespace: "SEOUL_BUS", arsId: "99999", providerRouteId: "999999", directionLabel: "합성 동쪽 방면", legIndex: 1 },
    boarding: { sourceIndex: 0, providerSequence: 10, localStationId: "999996", latitude: 37.5665, longitude: 126.9795 } };
const now = Date.parse("2026-10-04T03:00:30Z");
const binding = { sessionId: "fixture", generation: 1, routeRevision: 1, routeInputDigest: "a".repeat(64), clientOwnerId: "owner", syncScope: "SANDBOX",
    preparedAtEpochSeconds: now / 1000 - 30, expiresAtEpochSeconds: now / 1000 + 570 };
const good = { enabled: true, status: "ACTIVE", sessionId: "fixture", routeRevision: 1, syncScope: "SANDBOX", busQuality: "GOOD", busPhase: "WAITING" };
let renderer: ReactTestRenderer;
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    jest.useFakeTimers(); jest.setSystemTime(now); jest.clearAllMocks();
    Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
    mockSnapshot.mockResolvedValue(good); mockBinding.mockReturnValue(binding); globalThis.fetch = mockFetch;
    mockFetch.mockImplementation(async (url: string) => url.endsWith("/binding") ? ({ ok: true, text: async () => JSON.stringify({ success: true, data: { schemaVersion: 1,
        sessionId: binding.sessionId, generation: 1, routeRevision: 1, routeInputDigest: binding.routeInputDigest, identityEvidence: "SAVED_ROUTE_METADATA", mapping } }) }) : ({ ok: true, text: async () => JSON.stringify({ success: true, data: { schemaVersion: 1, sessionId: "fixture", generation: 1, routeRevision: 1,
        routeInputDigest: binding.routeInputDigest, query: { namespace: "SEOUL_BUS", arsId: "99999", providerRouteId: "999999", directionLabel: "합성 동쪽 방면", legIndex: 1 },
        status: "WAITING_INFORMATION", evaluatedAt: new Date(now).toISOString(), confirmedBoarding: false, remainingStopsToAlight: null,
        identityEvidence: "SAVED_ROUTE_METADATA", incomingVehicleId: "999997", observation: {
            quality: "FRESH_WAITING_INFORMATION", provider: "SEOUL_BUS", kind: "BUS", arsId: "99999", directionLabel: "합성 동쪽 방면", confirmedBoarding: false,
            inputFreshnessEvidence: "PROVIDER_SOURCE_TIMESTAMP", sourceUpdatedAt: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(),
            expectedAt: new Date(now + 120000).toISOString(), validUntil: new Date(now + 120000).toISOString(),
        } } }) }));
});
afterEach(async () => { await act(async () => renderer?.unmount()); globalThis.fetch = originalFetch; jest.useRealTimers(); });
async function render(scope: "SANDBOX" | "LOCAL_ONLY" = "SANDBOX", route = input) {
    await act(async () => { renderer = TestRenderer.create(<JourneyBusArrivalTrial input={route} scope={scope} mapping={scope === "SANDBOX" ? mapping : null} />); });
    return renderer;
}
test("GPS waiting automatically fetches fixed loopback without credentials and renders countdown", async () => {
    const screen = await render();
    expect(mockFetch).toHaveBeenCalledWith("http://127.0.0.1:15543/api/schedules/9001/automatic-journey/fixture/bus-arrivals", expect.objectContaining({ credentials: "omit", redirect: "error" }));
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
    expect(mockFetch.mock.calls[0][0]).toMatch(/bus-arrivals\/binding$/);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).query).toBeUndefined();
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).query).toEqual(mapping.query);
    expect(screen.root.findByProps({ testID: "journey-bus-arrival-wait" }).props.children).toContain("120초");
    expect(JSON.stringify(screen.toJSON())).toContain("사용자 탑승 차량 아님");
});
test.each(["BOARDING_CANDIDATE", "WALKING_TO_STOP", "UNAVAILABLE"])("%s never starts arrival polling", async busPhase => {
    mockSnapshot.mockResolvedValue({ ...good, busPhase }); await render(); expect(mockFetch).not.toHaveBeenCalled();
});
test("real selected LOCAL_ONLY route has mapping blocker and never calls server", async () => {
    const screen = await render("LOCAL_ONLY", { context: "ROUTING_RESPONSE" } as JourneyRouteInput);
    expect(JSON.stringify(screen.toJSON())).toContain("PROVIDER_ID_MAPPING_REQUIRED"); expect(mockFetch).not.toHaveBeenCalled();
});
test("switching selected route to local scope hides previous incoming vehicle immediately", async () => {
    const screen = await render();
    expect(JSON.stringify(screen.toJSON())).toContain("999997");
    await act(async () => renderer.update(<JourneyBusArrivalTrial input={{ context: "ROUTING_RESPONSE" } as JourneyRouteInput} scope="LOCAL_ONLY" />));
    expect(JSON.stringify(screen.toJSON())).not.toContain("999997");
    expect(screen.root.findByProps({ testID: "journey-bus-arrival-wait" }).props.children).toBe("확인된 대기시간 없음");
});
test("stale native event immediately hides arrival and aborts pending request", async () => {
    let resolve!: (v: unknown) => void;
    mockFetch.mockImplementation(() => new Promise(r => { resolve = r; }));
    const screen = await render();
    await act(async () => { mockNativeListener({ ...good, busQuality: "UNCERTAIN" }); });
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { resolve({ ok: false }); });
    expect(screen.root.findByProps({ testID: "journey-bus-arrival-wait" }).props.children).toBe("확인된 대기시간 없음");
});
test("unmount aborts network and prevents cached arrival surviving another selection", async () => {
    mockFetch.mockImplementation(() => new Promise(() => undefined)); await render();
    const signal = mockFetch.mock.calls[0][1].signal;
    await act(async () => renderer.unmount()); expect(signal.aborted).toBe(true);
});
test.each(["unsupported", "different occurrence"])("%s saved binding stops arrival source access", async mode => {
    const saved = mode === "unsupported" ? { status: "LOCAL_ROUTE_ID_REQUIRED", query: null, boarding: null }
        : { ...mapping, boarding: { ...mapping.boarding!, providerSequence: 11 } };
    mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ success: true, data: { schemaVersion: 1,
        sessionId: binding.sessionId, generation: 1, routeRevision: 1, routeInputDigest: binding.routeInputDigest,
        identityEvidence: "SAVED_ROUTE_METADATA", mapping: saved } }) });
    const screen = await render(); expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.root.findByProps({ testID: "journey-bus-arrival-wait" }).props.children).toBe("확인된 대기시간 없음");
    expect(JSON.stringify(screen.toJSON())).toContain(mode === "unsupported" ? "SAVED_ROUTE_MAPPING_UNAVAILABLE" : "SELECTED_SAVED_ROUTE_MISMATCH");
});

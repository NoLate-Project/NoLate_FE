import { busArrivalEligible, JourneyBusArrivalPoller, projectJourneyBusArrival, type JourneyBusArrivalQuery } from "../src/modules/journey/journeyBusArrival";
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";

const now = Date.parse("2026-10-04T03:00:30Z");
const binding: AutomaticJourneyBinding = { sessionId: "fixture-session", scheduleId: "9001", clientOwnerId: "fixture-owner", generation: 1, routeRevision: 1,
    routeInputDigest: "a".repeat(64), preparedAtEpochSeconds: now / 1000 - 30, expiresAtEpochSeconds: now / 1000 + 570, execution: "SIMULATOR", syncScope: "SANDBOX" };
const query: JourneyBusArrivalQuery = { namespace: "SEOUL_BUS", arsId: "99999", providerRouteId: "999999", directionLabel: "합성 동쪽 방면", legIndex: 1 };
const snapshot = { enabled: true, status: "ACTIVE", sessionId: binding.sessionId, routeRevision: 1, syncScope: "SANDBOX", busQuality: "GOOD", busPhase: "WAITING" } as AutomaticJourneySnapshot;
function response() {
    const source = new Date(now - 30000).toISOString();
    const expected = new Date(now + 90000).toISOString();
    return { success: true, data: { schemaVersion: 1, sessionId: binding.sessionId, generation: 1, routeRevision: 1, routeInputDigest: binding.routeInputDigest,
        query: { ...query }, status: "WAITING_INFORMATION", evaluatedAt: new Date(now).toISOString(), identityEvidence: "SAVED_ROUTE_METADATA",
        confirmedBoarding: false, remainingStopsToAlight: null, incomingVehicleId: "999997", observation: {
            provider: "SEOUL_BUS", kind: "BUS", quality: "FRESH_WAITING_INFORMATION", inputFreshnessEvidence: "PROVIDER_SOURCE_TIMESTAMP", arsId: query.arsId,
            directionLabel: query.directionLabel, confirmedBoarding: false, sourceUpdatedAt: source, receivedAt: new Date(now).toISOString(),
            expectedAt: expected, validUntil: expected,
        } } };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
afterEach(() => jest.useRealTimers());

test("original source yields 90 seconds and no confirmed ride or alighting stops", () => {
    expect(projectJourneyBusArrival(response(), binding, query, now)).toEqual({ status: "WAITING_INFORMATION", remainingSeconds: 90, incomingVehicleId: "999997", confirmedBoarding: false });
    expect(projectJourneyBusArrival(response(), binding, query, now + 1000).remainingSeconds).toBe(89);
});
test.each(["sessionId", "generation", "routeRevision", "routeInputDigest", "confirmedBoarding", "identityEvidence", "remainingStopsToAlight"])("rejects changed %s", key => {
    const raw = response(); Object.assign(raw.data, { [key]: "wrong" });
    expect(projectJourneyBusArrival(raw, binding, query, now).status).toBe("RESPONSE_REJECTED");
});
test.each(["namespace", "arsId", "providerRouteId", "directionLabel", "legIndex"])("rejects changed query %s", key => {
    const raw = response(); Object.assign(raw.data.query, { [key]: "wrong" });
    expect(projectJourneyBusArrival(raw, binding, query, now).status).toBe("RESPONSE_REJECTED");
});
test.each(["sourceUpdatedAt", "expectedAt", "receivedAt", "validUntil"])("requires original valid %s", key => {
    const raw = response(); Object.assign(raw.data.observation, { [key]: "bad" });
    expect(projectJourneyBusArrival(raw, binding, query, now).status).toBe("RESPONSE_REJECTED");
});
test("expiry exclusive and future/extended expiry rejected", () => {
    expect(projectJourneyBusArrival(response(), binding, query, now + 90000).status).toBe("STALE");
    const raw = response(); raw.data.observation.validUntil = new Date(now + 100000).toISOString();
    expect(projectJourneyBusArrival(raw, binding, query, now).status).toBe("RESPONSE_REJECTED");
    raw.data.evaluatedAt = new Date(now + 6000).toISOString();
    expect(projectJourneyBusArrival(raw, binding, query, now).status).toBe("RESPONSE_REJECTED");
});
test.each(["STALE", "IDENTITY_MISMATCH", "NO_ARRIVAL", "UNVERIFIED", "INVALID"])("%s carries no actionable ETA or incoming vehicle", status => {
    const raw = response(); raw.data.status = status;
    expect(projectJourneyBusArrival(raw, binding, query, now)).toEqual({ status, remainingSeconds: null, incomingVehicleId: null, confirmedBoarding: false });
});
test("local_only wrong session candidate stale stopped expired never eligible", () => {
    expect(busArrivalEligible(snapshot, binding, now)).toBe(true);
    expect(busArrivalEligible({ ...snapshot, busPhase: "APPROACHING_STOP" }, binding, now)).toBe(true);
    for (const changed of [{ status: "STOPPED" }, { busQuality: "UNCERTAIN" }, { busPhase: "BOARDING_CANDIDATE" }, { sessionId: "other" }, { routeRevision: 2 }]) {
        expect(busArrivalEligible({ ...snapshot, ...changed } as AutomaticJourneySnapshot, binding, now)).toBe(false);
    }
    expect(busArrivalEligible(snapshot, { ...binding, syncScope: "LOCAL_ONLY" }, now)).toBe(false);
    expect(busArrivalEligible(snapshot, binding, binding.expiresAtEpochSeconds * 1000)).toBe(false);
});
test("single flight and bounded poll cadence with original countdown", async () => {
    const poller = new JourneyBusArrivalPoller(); const request = jest.fn(async () => response());
    expect((await poller.read(binding, query, now, request, () => true)).remainingSeconds).toBe(90);
    jest.setSystemTime(now + 1000);
    expect((await poller.read(binding, query, now + 1000, request, () => true)).remainingSeconds).toBe(89);
    expect(request).toHaveBeenCalledTimes(1);
    await poller.read(binding, query, now + 10000, request, () => true); expect(request).toHaveBeenCalledTimes(2);
});
test("stop or eligibility loss while request pending discards late success", async () => {
    const poller = new JourneyBusArrivalPoller(); let active = true; let resolve!: (v: unknown) => void;
    const result = poller.read(binding, query, now, () => new Promise(r => { resolve = r; }), () => active);
    active = false; poller.invalidate(); resolve(response());
    expect((await result).remainingSeconds).toBeNull();
    active = true;
    expect((await poller.read(binding, query, now, async () => { throw new Error("offline"); }, () => active)).remainingSeconds).toBeNull();
});
test("invalidate and reentry cannot let previous response become current", async () => {
    const poller = new JourneyBusArrivalPoller(); let resolve!: (v: unknown) => void;
    const result = poller.read(binding, query, now, () => new Promise(r => { resolve = r; }), () => true);
    poller.invalidate(); resolve(response()); expect((await result).status).toBe("ARRIVAL_UNAVAILABLE");
});
test("expired cache hidden even without a new response", async () => {
    const poller = new JourneyBusArrivalPoller(); await poller.read(binding, query, now, async () => response(), () => true);
    jest.setSystemTime(now + 90000);
    expect((await poller.read(binding, query, now + 90000, async () => response(), () => true)).status).toBe("STALE");
});

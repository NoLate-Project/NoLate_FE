import { presentSavedJourneyGuidance, buildSavedJourneyInput } from "../src/modules/journey/savedJourneyGuidance";
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";

const binding: AutomaticJourneyBinding = {
    sessionId: "11111111-1111-4111-8111-111111111111", scheduleId: "9001", generation: 1, routeRevision: 1,
    clientOwnerId: "22222222-2222-4222-8222-222222222222", routeInputDigest: "a".repeat(64),
    execution: "SIMULATOR", syncScope: "SANDBOX", savedRouteValidated: true, guidanceEnabled: true,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600,
};
const guidance = { ...binding, schemaVersion: 1, sequence: 10, status: "ACTIVE", phase: "WAITING", quality: "GOOD",
    instruction: "untrusted string", activeLegIndex: 1, walkProgress: 1, observedAt: 1020, validUntil: 1035, boardingConfirmed: false };
const snapshot = (patch = {}) => ({ enabled: true, status: "ACTIVE", sessionId: binding.sessionId, routeRevision: 1,
    guidance: { ...guidance, ...patch } }) as unknown as AutomaticJourneySnapshot;
it("displays native waiting but never confirmed boarding or invented ETA", () => {
    expect(presentSavedJourneyGuidance(snapshot(), binding, 1021)).toEqual({ phase: "WAITING", instruction: "정류장 대기 · 탑승 미확정", progress: 1, fresh: true });
});
it.each(["sessionId", "scheduleId", "generation", "routeRevision", "routeInputDigest", "status", "schemaVersion", "boardingConfirmed"])("rejects a different %s", key => {
    expect(presentSavedJourneyGuidance(snapshot({ [key]: "invalid" }), binding, 1021)).toBeNull();
});
it("rejects unvalidated or local-only bindings", () => {
    expect(presentSavedJourneyGuidance(snapshot(), { ...binding, savedRouteValidated: undefined }, 1021)).toBeNull();
    expect(presentSavedJourneyGuidance(snapshot(), { ...binding, syncScope: "LOCAL_ONLY" }, 1021)).toBeNull();
});
it.each([1035, 1040, 1500])("hides stale progress at %s without refreshing the source timestamp", now => {
    expect(presentSavedJourneyGuidance(snapshot(), binding, now)).toMatchObject({ phase: "UNAVAILABLE", progress: null, fresh: false });
});
it("refuses fabricated freshness and future observations", () => {
    expect(presentSavedJourneyGuidance(snapshot({ validUntil: 1040 }), binding, 1021)?.progress).toBeNull();
    expect(presentSavedJourneyGuidance(snapshot({ observedAt: 1030, validUntil: 1045 }), binding, 1021)?.progress).toBeNull();
});
it("candidate always hides progress even if native claims GOOD or 100 percent", () => {
    expect(presentSavedJourneyGuidance(snapshot({ phase: "BOARDING_CANDIDATE", quality: "UNCERTAIN" }), binding, 1021))
        .toMatchObject({ phase: "BOARDING_CANDIDATE", progress: null, fresh: false });
    expect(presentSavedJourneyGuidance(snapshot({ phase: "BOARDING_CANDIDATE", quality: "GOOD" }), binding, 1021)?.progress).toBeNull();
});
it("expiry and stopped sessions cannot display old state", () => {
    expect(presentSavedJourneyGuidance(snapshot(), binding, 1600)).toBeNull();
    expect(presentSavedJourneyGuidance({ ...snapshot(), status: "STOPPED" }, binding, 1021)).toBeNull();
});
it("saved input preserves raw coordinates and rejects competing containers", () => {
    const route = { provider: "tmap", source: "api", transitLegs: [{ kind: "WALK", pathCoords: [{ lat: 95, lng: 0 }] }] };
    const input = buildSavedJourneyInput(route, { lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(input?.context).toBe("SAVED_ROUTE"); expect(input?.legs[0].coordinates[0]?.latitude).toBe(95);
    expect(buildSavedJourneyInput({ ...route, routeInfo: route }, {}, {})).toBeNull();
});
const arrival = { providerRouteId: "999999", directionLabel: "합성 동쪽 방면", sourceUpdatedAt: 1020, expectedAt: 1140, validUntil: 1140 };
it("shows only native validated arrival on fresh approach or waiting, without rebasing source expiry", () => {
    expect(presentSavedJourneyGuidance(snapshot({ arrivalStatus: "WAITING_INFORMATION", arrival }), binding, 1021)?.arrival)
        .toEqual({ directionLabel: "합성 동쪽 방면", remainingSeconds: 119 });
    expect(presentSavedJourneyGuidance(snapshot({ arrivalStatus: "WAITING_INFORMATION", arrival }), binding, 1035)?.arrival).toBeUndefined();
    const freshGPS = snapshot({ observedAt: 1130, validUntil: 1145, arrivalStatus: "WAITING_INFORMATION", arrival });
    expect(presentSavedJourneyGuidance(freshGPS, binding, 1140)?.arrival).toBeUndefined();
});
it.each(["WALKING_TO_STOP", "BOARDING_CANDIDATE", "UNAVAILABLE", "READY"])("never exposes cached ETA during %s", phase => {
    expect(presentSavedJourneyGuidance(snapshot({ phase, arrivalStatus: "WAITING_INFORMATION", arrival }), binding, 1021)?.arrival).toBeUndefined();
});
it.each(["STALE", "IDENTITY_MISMATCH", "UNVERIFIED", "NO_ARRIVAL", "ARRIVAL_UNAVAILABLE", "RESPONSE_REJECTED"])("hides arrival for %s", arrivalStatus => {
    expect(presentSavedJourneyGuidance(snapshot({ arrivalStatus, arrival }), binding, 1021)?.arrival).toBeUndefined();
});
it.each([{ validUntil: 1150 }, { expectedAt: 1020 }, { expectedAt: 5000 }, { sourceUpdatedAt: 1030 },
    { directionLabel: "bad\nlabel" }, { providerRouteId: "not-id" }, { expectedAt: Number.NaN }])("rejects unsafe native arrival %j", patch => {
    expect(presentSavedJourneyGuidance(snapshot({ arrivalStatus: "WAITING_INFORMATION", arrival: { ...arrival, ...patch } }), binding, 1021)?.arrival).toBeUndefined();
});

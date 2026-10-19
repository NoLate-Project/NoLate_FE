import { normalizeAutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";

const candidate = {
    enabled: true, status: "ACTIVE", busPhase: "BOARDING_CANDIDATE", busQuality: "GOOD",
    busReason: "VEHICLE_MATCH_REQUIRED", distanceToBoardMeters: 170, busAlongRouteMeters: 170, busLastAccuracyMeters: 20,
    boardingEvidenceCount: 4, boardingConfirmed: false,
};

test("GPS candidate remains explicitly unconfirmed and exposes only bounded derived metrics", () => {
    const snapshot = normalizeAutomaticJourneySnapshot({ ...candidate, latitude: 37.5, vehicleId: "private", routeJSON: "secret" });
    expect(snapshot).toMatchObject({ busPhase: "BOARDING_CANDIDATE", busQuality: "GOOD", boardingConfirmed: false,
        busReason: "VEHICLE_MATCH_REQUIRED", distanceToBoardMeters: 170, busAlongRouteMeters: 170, busLastAccuracyMeters: 20, boardingEvidenceCount: 4 });
    expect(JSON.stringify(snapshot)).not.toMatch(/latitude|vehicleId|private|secret|routeJSON/);
});
test.each(["WALKING_TO_STOP", "APPROACHING_STOP", "WAITING", "BOARDING_CANDIDATE", "UNAVAILABLE"])("accepts known phase %s without inventing ride confirmation", busPhase => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, busPhase })).toMatchObject({ busPhase, boardingConfirmed: false });
});
test.each([
    { busPhase: "RIDING" }, { busPhase: "ARRIVED" }, { busPhase: null }, { busQuality: "CONFIRMED" },
    { boardingConfirmed: true }, { boardingConfirmed: undefined }, { enabled: false }, { status: "STOPPED" }, { status: "EXPIRED" },
])("unsupported/terminal input is unavailable, never a confirmed vehicle: %j", patch => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, ...patch })).toMatchObject({
        busPhase: "UNAVAILABLE", busQuality: "UNAVAILABLE", boardingConfirmed: false,
        distanceToBoardMeters: null, busAlongRouteMeters: null, busLastAccuracyMeters: null, boardingEvidenceCount: 0,
    });
});
test("older binaries remain supported but cannot report bus progress", () => {
    expect(normalizeAutomaticJourneySnapshot({ enabled: true, status: "ACTIVE" })).toMatchObject({
        enabled: true, busPhase: "UNAVAILABLE", busReason: "BUS_CAPABILITY_UNAVAILABLE", boardingConfirmed: false, busLastAccuracyMeters: null,
    });
});
test.each(["UNCERTAIN", "UNAVAILABLE"])("%s hides potentially stale current metrics and evidence", busQuality => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, busQuality, busReason: "STALE_OBSERVATION" })).toMatchObject({
        busQuality, busReason: "STALE_OBSERVATION", distanceToBoardMeters: null, busAlongRouteMeters: null, busLastAccuracyMeters: null, boardingEvidenceCount: 0,
    });
});
test.each([Infinity, NaN, -1, 100001, "123", null])("invalid metric %p is not displayed as a position", value => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, distanceToBoardMeters: value, busAlongRouteMeters: value, busLastAccuracyMeters: value }))
        .toMatchObject({ distanceToBoardMeters: null, busAlongRouteMeters: null, busLastAccuracyMeters: null });
});
test.each([0, 20, 100000])("preserves bounded current horizontal accuracy %p without interpreting it as boarding confirmation", busLastAccuracyMeters => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, busLastAccuracyMeters })).toMatchObject({ busLastAccuracyMeters, boardingConfirmed: false });
});
test("older bus-capable binaries may omit horizontal accuracy without manufacturing a value", () => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, busLastAccuracyMeters: undefined })).toMatchObject({
        busPhase: "BOARDING_CANDIDATE", busQuality: "GOOD", busLastAccuracyMeters: null,
    });
});
test("unavailable phase hides accuracy even when the quality enum is GOOD", () => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, busPhase: "UNAVAILABLE" }).busLastAccuracyMeters).toBeNull();
});
test.each([-1, 1.5, 1001, Infinity, "3"])("invalid evidence count %p is rejected", boardingEvidenceCount => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, boardingEvidenceCount }).boardingEvidenceCount).toBe(0);
});
test("private error text is not allowed across the bus bridge", () => {
    expect(normalizeAutomaticJourneySnapshot({ ...candidate, busReason: "latitude 37.5 token secret" }).busReason).toBe("BUS_OBSERVATION_UNAVAILABLE");
});

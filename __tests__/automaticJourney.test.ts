import { Platform } from "react-native";
import {
    acknowledgeAutomaticJourneyDeparture, armAutomaticJourney, getAutomaticJourneyDeparture, getAutomaticJourneySnapshot,
    configureAutomaticJourneyPushPilot, configureAutomaticJourneyNoticeMode, reconcileAutomaticJourneyTerminal,
    normalizeAutomaticJourneyBinding, normalizeAutomaticJourneyDeparture, normalizeAutomaticJourneySnapshot,
    refreshAutomaticJourneyCredentials, restoreAutomaticJourney, stopAutomaticJourney, subscribeAutomaticJourney, type AutomaticJourneyBinding,
} from "../src/modules/journey/automaticJourney";
import { createAutomaticJourneyTransport } from "../src/modules/journey/automaticJourneyTransport";

const mockNative = {
    getAutomaticJourneySnapshot: jest.fn(), armAutomaticJourney: jest.fn(), restoreAutomaticJourney: jest.fn(),
    stopAutomaticJourney: jest.fn(), getAutomaticJourneyDeparture: jest.fn(), acknowledgeAutomaticJourneyDeparture: jest.fn(),
    addListener: jest.fn(),
    refreshAutomaticJourneyCredentials: jest.fn(),
    configureAutomaticJourneyPushPilot: jest.fn(),
    configureAutomaticJourneyNoticeMode: jest.fn(),
    reconcileAutomaticJourneyTerminal: jest.fn(),
};
const mockRequire = jest.fn(() => mockNative);
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => mockRequire() }), { virtual: true });
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;
const originalOS = Platform.OS;
const binding: AutomaticJourneyBinding = {
    sessionId: "10000000-0000-4000-8000-000000000001", clientOwnerId: "20000000-0000-4000-8000-000000000002",
    scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: "a".repeat(64),
    preparedAtEpochSeconds: 1_800_000_000, expiresAtEpochSeconds: 1_800_000_600,
    execution: "SIMULATOR", syncScope: "SANDBOX",
};
const event = {
    schemaVersion: 1, sessionId: binding.sessionId, clientOwnerId: binding.clientOwnerId, scheduleId: "9001", generation: 1,
    routeRevision: 1, routeInputDigest: binding.routeInputDigest, execution: "SIMULATOR", type: "AUTO_DEPARTURE",
    eventKey: `${binding.sessionId}:1:1:AUTO_DEPARTURE`, sequence: 1, occurredAtEpochSeconds: binding.preparedAtEpochSeconds + 10,
};
const idle = { enabled: true, status: "IDLE" };
test('long binding requires authenticated saved guidance and still has a fixed two-hour ceiling',()=>{
    const long={...binding,syncScope:'AUTHENTICATED',apiOrigin:'http://127.0.0.1:15546',authMemberId:7,loginGeneration:0,
        savedRouteValidated:true,guidanceEnabled:true,expiresAtEpochSeconds:binding.preparedAtEpochSeconds+7200};
    expect(normalizeAutomaticJourneyBinding(long)).not.toBeNull();
    for(const patch of [{syncScope:'SANDBOX'},{syncScope:'LOCAL_ONLY'},{savedRouteValidated:false},
        {guidanceEnabled:false},{expiresAtEpochSeconds:long.expiresAtEpochSeconds+1}]) {
        expect(normalizeAutomaticJourneyBinding({...long,...patch})).toBeNull();
    }
    expect(normalizeAutomaticJourneySnapshot({...idle,syncScope:'AUTHENTICATED',remainingSeconds:7199}).remainingSeconds).toBe(7199);
});
test('device execution is accepted only for an owned authenticated route and retained in departures', () => {
    const device = { ...binding, execution: 'DEVICE', syncScope: 'AUTHENTICATED',
        apiOrigin: 'https://api.example.com', authMemberId: 7, loginGeneration: 2,
        savedRouteValidated: true, guidanceEnabled: true };
    const normalized = normalizeAutomaticJourneyBinding(device);
    expect(normalized?.execution).toBe('DEVICE');
    expect(normalizeAutomaticJourneyBinding({ ...device, syncScope: 'SANDBOX' })).toBeNull();
    expect(normalizeAutomaticJourneyBinding({ ...device, savedRouteValidated: false })).toBeNull();
    expect(normalizeAutomaticJourneyDeparture({ ...event, execution: 'DEVICE' }, normalized!))
        .toMatchObject({ execution: 'DEVICE' });
    expect(normalizeAutomaticJourneyDeparture(event, normalized!)).toBeNull();
});
test('notice mode requires explicit supported native acceptance and never requests OS permission', async () => {
    mockNative.configureAutomaticJourneyNoticeMode.mockResolvedValueOnce({ accepted: true });
    await expect(configureAutomaticJourneyNoticeMode('NOTIFICATIONS')).resolves.toBeUndefined();
    expect(mockNative.configureAutomaticJourneyNoticeMode).toHaveBeenCalledWith('NOTIFICATIONS');
    mockNative.configureAutomaticJourneyNoticeMode.mockResolvedValueOnce({ accepted: false });
    await expect(configureAutomaticJourneyNoticeMode('VOICE_AND_NOTIFICATIONS')).rejects.toThrow('GUIDANCE_NOTICE_MODE_UNAVAILABLE');
    const count = mockNative.configureAutomaticJourneyNoticeMode.mock.calls.length;
    await expect(configureAutomaticJourneyNoticeMode('unsafe' as never)).rejects.toThrow('GUIDANCE_NOTICE_MODE_REJECTED');
    expect(mockNative.configureAutomaticJourneyNoticeMode).toHaveBeenCalledTimes(count);
});
test('notice diagnostics contain bounded codes/counts, never instruction or event identifiers', () => {
    const v = normalizeAutomaticJourneySnapshot({ ...idle, guidanceNoticeMode: 'NOTIFICATIONS', guidanceNoticeState: 'NOTIFICATION_ACCEPTED',
        guidanceNoticeScheduledCount: 2, guidanceVoiceQueuedCount: 1, noticeText: 'private', noticeIdentifier: 'private' });
    expect(v).toMatchObject({ guidanceNoticeMode: 'NOTIFICATIONS', guidanceNoticeScheduledCount: 2, guidanceVoiceQueuedCount: 1 });
    expect(JSON.stringify(v)).not.toContain('private');
    for (const bad of [-1, .5, NaN, Infinity, '2', 100001]) expect(normalizeAutomaticJourneySnapshot({ ...idle,
        guidanceNoticeMode: 'NOTIFICATIONS', guidanceNoticeScheduledCount: bad }).guidanceNoticeScheduledCount).toBe(0);
    expect(normalizeAutomaticJourneySnapshot(idle).guidanceNoticeMode).toBeUndefined();
});
test("notice permission diagnostics distinguish authorization from lock presentation and redact invalid values", () => {
    expect(normalizeAutomaticJourneySnapshot({ ...idle, guidanceNoticeMode: 'NOTIFICATIONS',
        guidanceNoticePermission: 'AUTHORIZED_LOCK_ON_ALERT_ON' }).guidanceNoticePermission).toBe('AUTHORIZED_LOCK_ON_ALERT_ON');
    for (const value of ['private body', 'raw\ncredential', 'A'.repeat(97), 2, null]) {
        expect(normalizeAutomaticJourneySnapshot({ ...idle, guidanceNoticeMode: 'NOTIFICATIONS',
            guidanceNoticePermission: value }).guidanceNoticePermission).toBe('NOT_CHECKED');
    }
});
test("destination evidence is bounded, readonly and unavailable outside a final walk", () => {
    const native = { enabled: true, status: 'ACTIVE', finalWalkPhase: 'FINAL_WALK', destinationEvidenceCount: 6 };
    expect(normalizeAutomaticJourneySnapshot(native).destinationEvidenceCount).toBe(6);
    for (const value of [-1, 0.5, 1001, Infinity, '6']) {
        expect(normalizeAutomaticJourneySnapshot({ ...native, destinationEvidenceCount: value }).destinationEvidenceCount).toBe(0);
    }
    expect(normalizeAutomaticJourneySnapshot({ ...native, status: 'STOPPED', qualityReason: 'DESTINATION_ARRIVED' }))
        .toMatchObject({ destinationEvidenceCount: 0, qualityReason: 'DESTINATION_ARRIVED' });
    expect(normalizeAutomaticJourneySnapshot({ ...native, finalWalkPhase: 'COLLECTING' }).destinationEvidenceCount).toBe(0);
});
test("push probe opt-in never returns a raw token and disabled native cannot silently enable", async () => {
    mockNative.configureAutomaticJourneyPushPilot.mockResolvedValueOnce({ accepted: true });
    await expect(configureAutomaticJourneyPushPilot()).resolves.toBeUndefined();
    expect(mockNative.configureAutomaticJourneyPushPilot).toHaveBeenCalledWith("");
    mockNative.configureAutomaticJourneyPushPilot.mockResolvedValueOnce({ accepted: false });
    await expect(configureAutomaticJourneyPushPilot()).rejects.toThrow("AUTOMATIC_APNS_PILOT_UNAVAILABLE");
});
test("push snapshot contains only bounded status/count/token-presence, never provider routes", () => {
    const value = normalizeAutomaticJourneySnapshot({ ...idle, guidancePushState: "TOKEN_WAITING", guidancePushTokenAvailable: true,
        guidancePushProviderAcceptedCount: 2, fcmRegistrationToken: "private-fcm", liveActivityToken: "private-update" });
    expect(value).toMatchObject({ guidancePushState: "TOKEN_WAITING", guidancePushTokenAvailable: true, guidancePushProviderAcceptedCount: 2 });
    expect(JSON.stringify(value)).not.toContain("private");
});
test("refresh uses the enabled native client without storing or rendering credentials", async () => {
    mockNative.refreshAutomaticJourneyCredentials.mockResolvedValue({ available: true, accepted: true, responseJSON: '{"success":true,"data":{"accessToken":"fixture","refreshToken":"fixture"}}' });
    await expect(refreshAutomaticJourneyCredentials("http://127.0.0.1:15544", "fixture-refresh")).resolves.toMatchObject({ success: true });
    expect(mockNative.refreshAutomaticJourneyCredentials).toHaveBeenCalledWith("http://127.0.0.1:15544", "fixture-refresh");
});
test("absent native debug opt-in returns null; an enabled rejection never falls back", async () => {
    mockNative.refreshAutomaticJourneyCredentials.mockResolvedValueOnce({ available: false });
    await expect(refreshAutomaticJourneyCredentials("https://api.example.invalid", "fixture")).resolves.toBeNull();
    mockNative.refreshAutomaticJourneyCredentials.mockResolvedValueOnce({ available: true, accepted: false, errorCode: "AUTOMATIC_SERVER_REJECTED" });
    await expect(refreshAutomaticJourneyCredentials("https://api.example.invalid", "fixture")).rejects.toThrow("AUTOMATIC_SERVER_REJECTED");
});
test.each(["x".repeat(65537), "<private malformed body>", "null"])("native refresh bounds response parsing", async responseJSON => {
    mockNative.refreshAutomaticJourneyCredentials.mockResolvedValueOnce({ available: true, accepted: true, responseJSON });
    await expect(refreshAutomaticJourneyCredentials("https://api.example.invalid", "fixture")).rejects.toThrow();
});

beforeEach(() => {
    jest.clearAllMocks();
    runtime.__DEV__ = true;
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    mockRequire.mockReturnValue(mockNative);
    for (const method of ["getAutomaticJourneySnapshot", "armAutomaticJourney", "restoreAutomaticJourney", "stopAutomaticJourney", "acknowledgeAutomaticJourneyDeparture"] as const) {
        mockNative[method].mockResolvedValue(idle);
    }
    mockNative.getAutomaticJourneyDeparture.mockResolvedValue({ available: true, eventJSON: JSON.stringify(event) });
});
afterEach(() => {
    runtime.__DEV__ = originalDev;
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
});

test("normalizes only bounded snapshot fields without exposing coordinates or credentials", () => {
    const snapshot = normalizeAutomaticJourneySnapshot({ ...idle, token: "secret", latitude: 37, routeJSON: "private",
        departureCount: 10, remainingSeconds: 700, alongRouteMeters: Infinity, lastErrorCode: "private coordinates",
    });
    expect(snapshot).toMatchObject({ enabled: true, departureCount: 0, remainingSeconds: 600, alongRouteMeters: null, lastErrorCode: null });
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|latitude|private|routeJSON/);
    expect(normalizeAutomaticJourneySnapshot({ enabled: true, status: "RIDING" }).enabled).toBe(false);
});

test("binding validation strips extra fields and checks its lifetime/identity", () => {
    expect(normalizeAutomaticJourneyBinding({ ...binding, privateToken: "secret" })).toEqual(binding);
});
test("subway diagnostics preserve bounded native reasons without admitting a passenger position", () => {
    const value = normalizeAutomaticJourneySnapshot({ ...idle, subwayPhase: 'RIDING',
        subwayReason: 'STATION_SEQUENCE_AND_TRAIN_CORRELATED', subwayTransportState: 'SUBWAY_INPUT_WAITING_FOR_PASSENGER_EVIDENCE',
        subwayTrainId: 'private-train', subwayLatitude: 37 });
    expect(value).toMatchObject({ subwayPhase: 'RIDING', subwayReason: 'STATION_SEQUENCE_AND_TRAIN_CORRELATED', boardingConfirmed: false });
    expect(JSON.stringify(value)).not.toMatch(/private-train|subwayLatitude/);
    expect(normalizeAutomaticJourneySnapshot({ ...idle, subwayPhase: 'private text', subwayReason: 'A'.repeat(97) }))
        .toMatchObject({ subwayPhase: 'UNAVAILABLE', subwayReason: 'SUBWAY_INPUT_UNAVAILABLE' });
});
test("R2 diagnostics do not promote unadmitted native boarding into product guidance", () => {
    const snapshot = normalizeAutomaticJourneySnapshot({ enabled: true, status: 'ACTIVE',
        busPhase: 'RIDING', busQuality: 'GOOD', boardingConfirmed: true,
        ridePhase: 'RIDING', rideQuality: 'GOOD', rideReason: 'CO_MOVEMENT_OBSERVED', rideEvidenceCount: 4,
        vehicleId: 'private-vehicle', rideHistory: [{ latitude: 37 }] });
    expect(snapshot).toMatchObject({ boardingConfirmed: false, busPhase: 'UNAVAILABLE',
        ridePhase: 'RIDING', rideQuality: 'GOOD', rideReason: 'CO_MOVEMENT_OBSERVED', rideEvidenceCount: 4 });
    expect(JSON.stringify(snapshot)).not.toMatch(/private-vehicle|rideHistory|latitude/);
});
test.each([-1, 1.5, 1001, Infinity, 'private-count'])("invalid R2 evidence count stays zero: %s", rideEvidenceCount => {
    expect(normalizeAutomaticJourneySnapshot({ ...idle, rideEvidenceCount }).rideEvidenceCount).toBe(0);
});
test("R3 separation diagnostics stay bounded and cannot create a guidance phase or expose identity", () => {
    const value=normalizeAutomaticJourneySnapshot({...idle,separationStatus:"SEPARATION_OBSERVED",
        separationReason:"SAME_VEHICLE_DEPARTED_PASSENGER_AT_TARGET",separationEvidenceCount:3,
        trackedId:"private-vehicle",separationHistory:[{latitude:37}],boardingConfirmed:true});
    expect(value).toMatchObject({status:"IDLE",boardingConfirmed:false,separationStatus:"SEPARATION_OBSERVED",separationEvidenceCount:3});
    expect(value.guidance).toBeUndefined();expect(JSON.stringify(value)).not.toMatch(/private-vehicle|latitude|separationHistory/);
});
test.each([-1,1.5,1001,Infinity,"3"])("invalid separation count fails closed: %s",separationEvidenceCount=>{
    expect(normalizeAutomaticJourneySnapshot({...idle,separationEvidenceCount,separationStatus:"ALIGHTED"})).toMatchObject({
        separationEvidenceCount:0,separationStatus:"UNAVAILABLE"});
});
test('transfer diagnostics redact raw evidence and cannot authorize a phase',()=>{
    const value=normalizeAutomaticJourneySnapshot({...idle,transferWalkPhase:'TRANSFER_WALK',transferWalkReason:'NEXT_BOARDING_POINT_READY',
        transferWalkEvidenceCount:6,transferGPS:[{latitude:37}],nextBoardingPointReady:true});
    expect(value).toMatchObject({status:'IDLE',boardingConfirmed:false,transferWalkPhase:'TRANSFER_WALK',transferWalkEvidenceCount:6});
    expect(value.guidance).toBeUndefined();expect(JSON.stringify(value)).not.toMatch(/latitude|transferGPS|nextBoardingPointReady/);
    expect(normalizeAutomaticJourneySnapshot({...idle,transferWalkPhase:'raw private',transferWalkReason:'A'.repeat(97),transferWalkEvidenceCount:1001}))
        .toMatchObject({transferWalkPhase:'UNAVAILABLE',transferWalkReason:'TRANSFER_WALK_GEOMETRY_UNAVAILABLE',transferWalkEvidenceCount:0});
});
test.each([
    ["sessionId", "not-uuid"], ["clientOwnerId", "secret"], ["scheduleId", "../other"], ["generation", 0],
    ["routeRevision", 1.5], ["routeInputDigest", "A".repeat(64)], ["execution", "DEVICE"], ["syncScope", "PRODUCTION"],
    ["expiresAtEpochSeconds", binding.preparedAtEpochSeconds], ["expiresAtEpochSeconds", binding.preparedAtEpochSeconds + 601],
    ["preparedAtEpochSeconds", Infinity],
])("rejects invalid binding field %s", (key, value) => {
    expect(normalizeAutomaticJourneyBinding({ ...binding, [key as string]: value })).toBeNull();
});
test.each([
    ["sessionId", binding.clientOwnerId], ["scheduleId", "9002"], ["clientOwnerId", binding.sessionId],
    ["generation", 2], ["routeRevision", 2], ["routeInputDigest", "b".repeat(64)], ["sequence", 2],
    ["type", "MANUAL"], ["eventKey", "anything"], ["execution", "DEVICE"],
    ["occurredAtEpochSeconds", binding.preparedAtEpochSeconds - 1], ["occurredAtEpochSeconds", binding.expiresAtEpochSeconds],
])("rejects foreign or contradictory departure field %s", (key, value) => {
    expect(normalizeAutomaticJourneyDeparture({ ...event, [key as string]: value }, binding)).toBeNull();
});
test("departure normalization never forwards raw location samples", () => {
    expect(normalizeAutomaticJourneyDeparture({ ...event, latitude: 37, coordinates: [], token: "secret" }, binding)).toEqual(event);
});
test("release and Android guards never load native or read an outbox", async () => {
    runtime.__DEV__ = false;
    await getAutomaticJourneySnapshot(); await armAutomaticJourney("{}", binding); await restoreAutomaticJourney("{}", binding);
    await stopAutomaticJourney(); await acknowledgeAutomaticJourneyDeparture(event.eventKey, binding);
    subscribeAutomaticJourney(jest.fn())();
    await expect(getAutomaticJourneyDeparture(binding)).rejects.toThrow("DEPARTURE_OUTBOX_UNAVAILABLE");
    expect(mockRequire).not.toHaveBeenCalled();
    runtime.__DEV__ = true;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    expect((await getAutomaticJourneySnapshot()).reason).toBe("DEVELOPMENT_IOS_ONLY");
    expect(mockRequire).not.toHaveBeenCalled();
});
test("reading readiness does not arm or restore", async () => {
    await getAutomaticJourneySnapshot();
    expect(mockNative.armAutomaticJourney).not.toHaveBeenCalled();
    expect(mockNative.restoreAutomaticJourney).not.toHaveBeenCalled();
});
test("method arguments stay pinned to the original JSON/binding", async () => {
    await armAutomaticJourney("route", binding); await restoreAutomaticJourney("route", binding);
    await acknowledgeAutomaticJourneyDeparture(event.eventKey, binding);
    expect(mockNative.armAutomaticJourney).toHaveBeenCalledWith("route", JSON.stringify(binding));
    expect(mockNative.restoreAutomaticJourney).toHaveBeenCalledWith("route", JSON.stringify(binding));
    expect(mockNative.acknowledgeAutomaticJourneyDeparture).toHaveBeenCalledWith(event.eventKey, JSON.stringify(binding));
});
test('terminal cleanup passes only pinned binding and rejects unsupported or failed native revocation', async () => {
    mockNative.reconcileAutomaticJourneyTerminal.mockResolvedValueOnce({ accepted: true });
    await reconcileAutomaticJourneyTerminal(binding);
    expect(mockNative.reconcileAutomaticJourneyTerminal).toHaveBeenCalledWith(JSON.stringify(binding));
    mockNative.reconcileAutomaticJourneyTerminal.mockResolvedValueOnce({ accepted: false });
    await expect(reconcileAutomaticJourneyTerminal(binding)).rejects.toThrow('CHECKPOINT_TERMINAL_CLEANUP_REJECTED');
    mockRequire.mockReturnValueOnce(null as unknown as typeof mockNative);
    await expect(reconcileAutomaticJourneyTerminal(binding)).rejects.toThrow('CHECKPOINT_TERMINAL_CLEANUP_REJECTED');
});
test("native errors and unsupported binaries do not leak exception details", async () => {
    mockNative.getAutomaticJourneySnapshot.mockRejectedValueOnce(new Error("private-token latitude"));
    expect((await getAutomaticJourneySnapshot()).reason).toBe("AUTOMATIC_ENGINE_UNAVAILABLE");
    mockRequire.mockReturnValueOnce(null as unknown as typeof mockNative);
    expect((await getAutomaticJourneySnapshot()).reason).toBe("NATIVE_REBUILD_REQUIRED");
});
test("outbox null differs from malformed/unavailable output", async () => {
    expect(await getAutomaticJourneyDeparture(binding)).toEqual(event);
    mockNative.getAutomaticJourneyDeparture.mockResolvedValueOnce({ available: true, eventJSON: null });
    expect(await getAutomaticJourneyDeparture(binding)).toBeNull();
    for (const eventJSON of ["{", "null", "x".repeat(4097), JSON.stringify({ ...event, generation: 2 })]) {
        mockNative.getAutomaticJourneyDeparture.mockResolvedValueOnce({ available: true, eventJSON });
        await expect(getAutomaticJourneyDeparture(binding)).rejects.toThrow("INVALID_DEPARTURE_RECEIPT");
    }
});
test("view detachment cannot stop a native session", () => {
    const remove = jest.fn(); const listener = jest.fn();
    mockNative.addListener.mockReturnValue({ remove });
    const dispose = subscribeAutomaticJourney(listener);
    const receive = mockNative.addListener.mock.calls[0][1];
    receive(idle); dispose(); dispose(); receive(idle);
    expect(listener).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    expect(mockNative.stopAutomaticJourney).not.toHaveBeenCalled();
});

describe("automatic server transport", () => {
    const prepared = {
        ...binding, state: "ARMED", sequence: 0,
        preparedAt: new Date(binding.preparedAtEpochSeconds * 1000).toISOString(),
        expiresAt: new Date(binding.expiresAtEpochSeconds * 1000).toISOString(),
    };
    const request = { requestId: binding.sessionId, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest, execution: "SIMULATOR" as const };
    test("prepare is separate from departure and validates echoed ownership/digest", async () => {
        const post = jest.fn().mockResolvedValue({ success: true, data: prepared });
        expect(await createAutomaticJourneyTransport(post).prepare("9001", request)).toEqual(binding);
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toBe("/api/schedules/9001/automatic-journey/prepare");
        post.mockResolvedValue({ success: true, data: { ...prepared, clientOwnerId: binding.sessionId } });
        await expect(createAutomaticJourneyTransport(post).prepare("9001", request)).rejects.toThrow("INVALID_AUTOMATIC_SERVER_RESPONSE");
    });
    test("departure sends an allow-list and only accepts a matching durable receipt", async () => {
        const departure = normalizeAutomaticJourneyDeparture(event, binding)!;
        const ack = { sessionId: binding.sessionId, generation: 1, routeRevision: 1, eventKey: event.eventKey, sequence: 1,
            state: "ACTIVE", accepted: true, duplicate: false, departedAt: new Date(event.occurredAtEpochSeconds * 1000).toISOString() };
        const post = jest.fn().mockResolvedValue({ success: true, data: ack });
        await createAutomaticJourneyTransport(post).depart({ ...departure, privateCoordinate: 37 } as typeof departure);
        expect(post.mock.calls[0][1]).not.toHaveProperty("privateCoordinate");
        expect(post.mock.calls[0][1].occurredAt).toBe(ack.departedAt);
        post.mockResolvedValue({ success: true, data: { ...ack, duplicate: true } });
        await createAutomaticJourneyTransport(post).depart(departure);
        for (const patch of [{ accepted: false }, { eventKey: "foreign" }, { generation: 2 }, { state: "ARMED" }, { sequence: 0 }]) {
            post.mockResolvedValue({ success: true, data: { ...ack, ...patch } });
            await expect(createAutomaticJourneyTransport(post).depart(departure)).rejects.toThrow("INVALID_AUTOMATIC_SERVER_RESPONSE");
        }
    });
    test("stop uses a separate owner-fenced endpoint", async () => {
        const post = jest.fn().mockResolvedValue({ success: true, data: { sessionId: binding.sessionId, state: "STOPPED" } });
        await createAutomaticJourneyTransport(post).stop(binding);
        expect(post.mock.calls[0][1]).toEqual({ generation: 1, routeRevision: 1, clientOwnerId: binding.clientOwnerId, routeInputDigest: binding.routeInputDigest });
    });
});

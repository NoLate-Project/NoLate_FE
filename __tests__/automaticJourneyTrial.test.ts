import { Buffer } from "buffer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { journeyAuthentication } from "../src/modules/journey/automaticJourneyAuthentication";
import type { AutomaticJourneyBinding, AutomaticJourneyDeparture, AutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";
import type { JourneyRouteInput } from "../src/modules/journey/journeyRouteInput";
import { JOURNEY_STOP_OUTBOX_KEY } from '../src/modules/journey/journeyStopOutbox';
import {
    prepareAutomaticJourneyTrial, restoreAutomaticJourneyTrial, stopAutomaticJourneyTrial,
    retryAutomaticJourneySync, retryAutomaticJourneyStops, setAutomaticJourneySyncPaused, getAutomaticJourneySyncState,
    subscribeAutomaticJourneySync,
    revalidateAutomaticJourneySavedRoute, reconcileAutomaticJourneyCheckpoint,
    journeyTrialExecution,
} from "../src/modules/journey/automaticJourneyTrial";

const mockGet = jest.fn();
const mockArm = jest.fn();
const mockConfigureAuth = jest.fn();
const mockUpdateAuth = jest.fn();
const mockAuthenticatedPost = jest.fn();
const mockRestore = jest.fn();
const mockStop = jest.fn();
const mockTerminalCleanup = jest.fn();
const mockOutbox = jest.fn();
const mockAck = jest.fn();
const mockAssess = jest.fn();
let mockEnabled = true;
let mockAuth: () => Promise<void>;
let mockNativeEvent: (snapshot: AutomaticJourneySnapshot) => void;
const mockDetach = jest.fn();
jest.mock("../src/modules/journey/automaticJourney", () => ({
    ...jest.requireActual("../src/modules/journey/automaticJourney"),
    isAutomaticJourneyDevelopment: () => mockEnabled,
    getAutomaticJourneySnapshot: () => mockGet(),
    armAutomaticJourney: (route: string, binding: AutomaticJourneyBinding) => mockArm(route, binding),
    configureAutomaticJourneyAuthentication: (auth: unknown) => mockConfigureAuth(auth),
    updateAutomaticJourneyAuthentication: (...args: unknown[]) => mockUpdateAuth(...args),
    authenticatedAutomaticJourneyRequest: (...args: unknown[]) => mockAuthenticatedPost(...args),
    restoreAutomaticJourney: (route: string, binding: AutomaticJourneyBinding) => mockRestore(route, binding),
    stopAutomaticJourney: () => mockStop(),
    reconcileAutomaticJourneyTerminal: (b: AutomaticJourneyBinding) => mockTerminalCleanup(b),
    getAutomaticJourneyDeparture: (binding: AutomaticJourneyBinding) => mockOutbox(binding),
    acknowledgeAutomaticJourneyDeparture: (key: string, binding: AutomaticJourneyBinding) => mockAck(key, binding),
    subscribeAutomaticJourney: (listener: typeof mockNativeEvent) => { mockNativeEvent = listener; return mockDetach; },
}));
jest.mock("../src/modules/journey/journeyRouteAssessment", () => ({ assessJourneyRouteInput: (input: JourneyRouteInput) => mockAssess(input) }));
jest.mock("../src/modules/auth/authStorage", () => ({ subscribeAuthInvalidation: (listener: typeof mockAuth) => { mockAuth = listener; return jest.fn(); } }));
jest.mock("expo-crypto", () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    digestStringAsync: async () => "a".repeat(64),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
jest.mock("../src/api/env", () => ({ getEnv: (key: string) => process.env[key] }));
jest.mock("expo-device", () => ({ isDevice: false }));

const ready = {
    enabled: true, status: "IDLE", pendingDeparture: false, departureAcknowledged: false,
    sessionId: null, lastErrorCode: null, reason: null,
} as AutomaticJourneySnapshot;
const input = { schemaVersion: 1, routeRevision: 1, context: "SYNTHETIC_FIXTURE" } as JourneyRouteInput;
const routingInput = { ...input, context: "ROUTING_RESPONSE" } as JourneyRouteInput;
const response = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let binding: AutomaticJourneyBinding;
let pending: AutomaticJourneyDeparture | null;
let stored: string | null;
let stopStored: string | null;
let fetchMock: jest.Mock;
let calls: { path: string; body: Record<string, unknown> }[];
let serverDepartures: number;
let serverActive: boolean;

function queueDeparture() {
    pending = {
        schemaVersion: 1, sessionId: binding.sessionId, scheduleId: binding.scheduleId,
        clientOwnerId: binding.clientOwnerId, generation: binding.generation, routeRevision: binding.routeRevision,
        routeInputDigest: binding.routeInputDigest, execution: "SIMULATOR", type: "AUTO_DEPARTURE", sequence: 1,
        eventKey: `${binding.sessionId}:${binding.generation}:${binding.routeRevision}:AUTO_DEPARTURE`,
        occurredAtEpochSeconds: binding.preparedAtEpochSeconds + 20,
    };
}
async function server(url: string, init: RequestInit) {
    expect(url.startsWith("http://127.0.0.1:15543/")).toBe(true);
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(String(init.body));
    calls.push({ path: url, body });
    if (url.endsWith("/prepare") || url.endsWith("/prepare-saved")) return response({
        sessionId: body.requestId, scheduleId: "9001", generation: 1, routeRevision: 1, sequence: 0, state: "ARMED",
        clientOwnerId: body.clientOwnerId, routeInputDigest: body.routeInputDigest, execution: "SIMULATOR",
        preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
        ...(url.endsWith("/prepare-saved") ? { savedRouteValidated: true } : {}),
    });
    if (url.endsWith("/stop")) return response({ sessionId: "11111111-1111-4111-8111-111111111111", state: "STOPPED" });
    if (url.endsWith("/validate")) return response({
        ...body, schemaVersion: 1, sessionId: "11111111-1111-4111-8111-111111111111", scheduleId: "9001",
        execution: "SIMULATOR", state: "ARMED", validatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30000).toISOString(),
    });
    const duplicate = serverActive;
    if (!serverActive) serverDepartures++;
    serverActive = true;
    return response({ ...body, sessionId: binding.sessionId, state: "ACTIVE", accepted: true, duplicate, departedAt: body.occurredAt });
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-04T03:00:00Z"));
    jest.clearAllMocks();
    mockEnabled = true;
    stored = null; stopStored = null; pending = null; calls = []; serverDepartures = 0; serverActive = false;
    jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key === JOURNEY_STOP_OUTBOX_KEY ? stopStored : stored);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { if (key === JOURNEY_STOP_OUTBOX_KEY) stopStored = value; else stored = value; });
    jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { if (key === JOURNEY_STOP_OUTBOX_KEY) stopStored = null; else stored = null; });
    mockGet.mockResolvedValue(ready);
    mockStop.mockResolvedValue({ ...ready, status: "STOPPED" });
    mockTerminalCleanup.mockResolvedValue(undefined);
    mockArm.mockImplementation(async (_route, next: AutomaticJourneyBinding) => {
        binding = next;
        return { ...ready, status: "ARMED", sessionId: next.sessionId };
    });
    mockRestore.mockImplementation(async (_route, next: AutomaticJourneyBinding) => {
        binding = next;
        return { ...ready, status: "ACTIVE", sessionId: next.sessionId, pendingDeparture: true };
    });
    mockOutbox.mockImplementation(async () => pending);
    mockAck.mockImplementation(async () => {
        pending = null;
        return { ...ready, status: "ACTIVE", sessionId: binding.sessionId, departureAcknowledged: true };
    });
    mockAssess.mockImplementation(async (route: JourneyRouteInput) => ({ available: true, summary: {
        eligibleDepartureLegIndex: route.context === "ROUTING_RESPONSE" ? 0 : null,
        reasonCodes: route.context === "SYNTHETIC_FIXTURE" ? ["SYNTHETIC_FIXTURE_ONLY"] : [],
        legs: [{ kind: "WALK", geometryUsable: true, geometryLengthMeters: 132 }],
    } }));
    fetchMock = jest.fn(server);
    globalThis.fetch = fetchMock;
});
afterEach(async () => {
    mockEnabled = true;
    mockStop.mockResolvedValue({ ...ready, status: "STOPPED" });
    fetchMock.mockImplementation(server);
    await stopAutomaticJourneyTrial();
    jest.useRealTimers();
});

it('physical device trial requires an explicit field-test flag and authenticated scope', () => {
    const key = 'EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED';
    const previous = process.env[key];
    try {
        delete process.env[key];
        expect(journeyTrialExecution('AUTHENTICATED', false)).toBe('SIMULATOR');
        expect(() => journeyTrialExecution('AUTHENTICATED', true)).toThrow('DEVICE_FIELD_TEST_DISABLED');
        process.env[key] = 'true';
        expect(journeyTrialExecution('AUTHENTICATED', true)).toBe('DEVICE');
        expect(() => journeyTrialExecution('SANDBOX', true)).toThrow('DEVICE_FIELD_TEST_DISABLED');
    } finally {
        if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
});

it("preparation only arms; no departure HTTP or location data is persisted in JS", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    expect(calls.map(call => call.path.split("/").pop())).toEqual(["prepare"]);
    expect(serverDepartures).toBe(0);
    expect(JSON.parse(stored!)).toEqual(binding);
    expect(stored).not.toMatch(/latitude|longitude|token|coordinates/);
    expect(mockArm).toHaveBeenCalledWith(JSON.stringify(input), binding);
});
it("saved native route requires server attestation of the complete exact input before arm", async () => {
    const saved = { ...input, context: "SAVED_ROUTE" } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ["SAVED_ROUTE_REVALIDATION_REQUIRED"],
        legs: [{ kind: "WALK", geometryUsable: true }] } });
    await prepareAutomaticJourneyTrial(saved, "SANDBOX", "9001");
    expect(calls[0].path.endsWith("/prepare-saved")).toBe(true);
    expect(calls[0].body.routeInputJSON).toBe(JSON.stringify(saved));
    expect(binding).toMatchObject({ savedRouteValidated: true, guidanceEnabled: true });
    expect(mockArm).toHaveBeenCalledWith(JSON.stringify(saved), binding);
    expect(serverDepartures).toBe(0);
});
it("unattested saved route response never reaches native arm", async () => {
    const saved = { ...input, context: "SAVED_ROUTE" } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ["SAVED_ROUTE_REVALIDATION_REQUIRED"],
        legs: [{ kind: "WALK", geometryUsable: true }] } });
    fetchMock.mockImplementation(async (url, init) => {
        const result = await server(url, init); const body = JSON.parse(await result.text());
        delete body.data.savedRouteValidated;
        return { ...result, text: async () => JSON.stringify(body) };
    });
    await expect(prepareAutomaticJourneyTrial(saved, "SANDBOX", "9001")).rejects.toThrow("INVALID_AUTOMATIC_SERVER_RESPONSE");
    expect(mockArm).not.toHaveBeenCalled();
});
it('authoritative saved route replacement revokes native before HTTP and clears identity', async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    await prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001');
    expect(await revalidateAutomaticJourneySavedRoute('9002', null)).toBe(false);
    expect(await revalidateAutomaticJourneySavedRoute('9001', { ...saved })).toBe(false);
    expect(mockStop).not.toHaveBeenCalled();
    expect(await revalidateAutomaticJourneySavedRoute('9001', { ...saved, routeRevision: 2 })).toBe(true);
    expect(mockStop).toHaveBeenCalledTimes(1); expect(stored).toBeNull();
    expect(calls[calls.length - 1].path.endsWith('/stop')).toBe(true);
    expect(await revalidateAutomaticJourneySavedRoute('9001', null)).toBe(false);
});
it('saved preparation validates lifetime before native arm and rejects an invalid lease', async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    fetchMock.mockImplementation(async (url, init) => {
        const result = await server(url, init);
        if (!url.endsWith('/validate')) return result;
        const body = JSON.parse(await result.text()); body.data.generation = 2;
        return { ...result, text: async () => JSON.stringify(body) };
    });
    await expect(prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001')).rejects.toThrow('INVALID_AUTOMATIC_SERVER_RESPONSE');
    expect(mockArm).not.toHaveBeenCalled();
    expect(calls.map(call => call.path.split('/').pop())).toEqual(['prepare-saved', 'validate', 'stop']);
});
it('cold saved restoration checks server before restoring any native location or outbox', async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    await prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001');
    const retained = stored;
    await stopAutomaticJourneyTrial(); stored = retained;
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/validate')
        ? { ok: false, status: 401, text: async () => '' } : server(url, init));
    await expect(restoreAutomaticJourneyTrial(saved)).rejects.toThrow('AUTOMATIC_SERVER_REJECTED');
    expect(mockRestore).not.toHaveBeenCalled();
    expect(stored).toBeNull();
});
it('transient cold validation failure preserves quarantine but never resumes location', async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    await prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001');
    const retained = stored;
    await stopAutomaticJourneyTrial(); stored = retained; mockStop.mockClear();
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/validate')
        ? { ok: false, status: 503, text: async () => '' } : server(url, init));
    await expect(restoreAutomaticJourneyTrial(saved)).rejects.toThrow('AUTOMATIC_SERVER_UNAVAILABLE');
    expect(mockRestore).not.toHaveBeenCalled(); expect(mockStop).not.toHaveBeenCalled();
    expect(stored).toBe(retained);
});
it('native lifetime rejection clears JS binding and sends best effort stop without a screen', async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    await prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001');
    mockNativeEvent({ ...ready, status: 'STOPPED', sessionId: binding.sessionId, lastErrorCode: 'SAVED_SESSION_VALIDATION_REJECTED' });
    await flush();
    expect(mockStop).toHaveBeenCalledTimes(1); expect(stored).toBeNull();
    expect(calls[calls.length - 1].path.endsWith('/stop')).toBe(true);
});
it('deleting the authoritative saved route stops but switching a local-only selection does not', async () => {
    await prepareAutomaticJourneyTrial(routingInput, 'LOCAL_ONLY');
    expect(await revalidateAutomaticJourneySavedRoute('9001', null)).toBe(false);
    await stopAutomaticJourneyTrial(); mockStop.mockClear();
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    await prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001');
    expect(await revalidateAutomaticJourneySavedRoute('9001', null)).toBe(true);
    expect(mockStop).toHaveBeenCalledTimes(1);
});
it('route replacement during saved preparation fences a late successful server response', async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    const gate = deferred<Awaited<ReturnType<typeof server>>>();
    fetchMock.mockImplementation(async (url, init) => url.endsWith('/prepare-saved') ? gate.promise : server(url, init));
    const preparation = prepareAutomaticJourneyTrial(saved, 'SANDBOX', '9001');
    const rejected = preparation.then(() => { throw new Error('Expected preparation rejection'); }, error => {
        expect(error.message).toBe('AUTOMATIC_OPERATION_CANCELLED');
    });
    await flush();
    expect(await revalidateAutomaticJourneySavedRoute('9001', null)).toBe(true);
    gate.resolve(response({ sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001', generation: 1, routeRevision: 1,
        state: 'ARMED', sequence: 0,
        clientOwnerId: '11111111-1111-4111-8111-111111111111', routeInputDigest: 'a'.repeat(64), execution: 'SIMULATOR',
        preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), savedRouteValidated: true }));
    await rejected; expect(mockArm).not.toHaveBeenCalled(); expect(stored).toBeNull();
});
it("authenticated saved preparation validates before native and never persists credentials", async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    const now = Math.floor(Date.now() / 1000);
    const token = `e30.${Buffer.from(JSON.stringify({ type: 'ACCESS', sub: '7', sg: 2, iat: now, exp: now + 600 })).toString('base64url')}.c2ln`;
    const auth = journeyAuthentication(token, 'http://127.0.0.1:15544', 7);
    mockAuthenticatedPost.mockImplementation(async (credentials, path, body) => {
        expect(credentials).toEqual(auth);
        const nativeResponse = await server(`http://127.0.0.1:15543${path}`, { credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return JSON.parse(await nativeResponse.text());
    });
    await prepareAutomaticJourneyTrial(saved, 'AUTHENTICATED', '9001', async () => auth);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(binding).toMatchObject({ syncScope: 'AUTHENTICATED', apiOrigin: auth.apiOrigin, authMemberId: 7, loginGeneration: 2 });
    expect(mockConfigureAuth).toHaveBeenCalledWith(auth);
    expect(stored).not.toContain(token); expect(stored).not.toContain('accessToken');
    queueDeparture(); await retryAutomaticJourneySync(); expect(serverDepartures).toBe(1);
    await stopAutomaticJourneyTrial(); expect(stored).toBeNull();
    expect(calls.map(call => call.path.split('/').pop())).toEqual(['prepare-saved', 'validate', 'departure', 'stop']);
});
it.each([true, false])('extended preparation checks the credential horizon before native arm (covered=%s)', async covered => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    const now = Date.now() / 1000;
    const auth = (expiry: number) => journeyAuthentication(`e30.${Buffer.from(JSON.stringify({type:'ACCESS',sub:'7',sg:2,iat:now,exp:now+expiry})).toString('base64url')}.c2ln`, 'http://127.0.0.1:15544', 7);
    const short = auth(600), long = auth(9000);
    const source = jest.fn(async (until?: number) => until !== undefined && covered ? long : short);
    mockAuthenticatedPost.mockImplementation(async (_credentials, path, body) => {
        const wire = await server(`http://127.0.0.1:15543${path}`, { credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
        const value = JSON.parse(await wire.text());
        if (path.endsWith('/prepare-saved')) value.data.expiresAt = new Date((now + 7200)*1000).toISOString();
        return value;
    });
    if (covered) {
        await prepareAutomaticJourneyTrial(saved, 'AUTHENTICATED', '9001', source);
        expect(mockConfigureAuth).toHaveBeenCalledWith(long); expect(mockArm).toHaveBeenCalledTimes(1);
        expect(binding.expiresAtEpochSeconds).toBe(now+7200);
        expect(stored).not.toContain(long.accessToken);
    } else {
        await expect(prepareAutomaticJourneyTrial(saved, 'AUTHENTICATED', '9001', source)).rejects.toThrow('AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT');
        expect(mockConfigureAuth).not.toHaveBeenCalled(); expect(mockArm).not.toHaveBeenCalled();
        expect(calls.some(call=>call.path.endsWith('/stop'))).toBe(true);
        expect(stored).toBeNull(); expect(JSON.parse(stopStored!).bindings).toEqual([]);
    }
    expect(source).toHaveBeenCalledWith(now+7200);
});
it("account switch stops authenticated native inputs even after its departure outbox is empty", async () => {
    const saved = { ...input, context: 'SAVED_ROUTE' } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ['SAVED_ROUTE_REVALIDATION_REQUIRED'], legs: [{ kind: 'WALK', geometryUsable: true }] } });
    const now = Math.floor(Date.now() / 1000);
    const jwt = (id: number) => `e30.${Buffer.from(JSON.stringify({ type: 'ACCESS', sub: String(id), sg: 2, iat: now, exp: now + 600 })).toString('base64url')}.c2ln`;
    let auth = journeyAuthentication(jwt(7), 'http://127.0.0.1:15544', 7);
    mockAuthenticatedPost.mockImplementation(async (_auth, path, body) => {
        const wire = await server(`http://127.0.0.1:15543${path}`, { credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return JSON.parse(await wire.text());
    });
    await prepareAutomaticJourneyTrial(saved, 'AUTHENTICATED', '9001', async () => auth);
    queueDeparture(); await retryAutomaticJourneySync(); expect(pending).toBeNull();
    auth = journeyAuthentication(jwt(8), 'http://127.0.0.1:15544', 8);
    await retryAutomaticJourneySync();
    expect(mockStop).toHaveBeenCalledTimes(1); expect(stored).toBeNull();
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: 'BLOCKED', errorCode: 'AUTOMATIC_AUTH_CHANGED' });
});
it('long cold restore quarantines the checkpoint if fresh access cannot cover its fixed expiry', async () => {
    const now=Date.now()/1000,saved={...input,context:'SAVED_ROUTE'} as JourneyRouteInput;
    mockAssess.mockResolvedValue({available:true,summary:{reasonCodes:['SAVED_ROUTE_REVALIDATION_REQUIRED'],legs:[{kind:'WALK',geometryUsable:true}]}});
    const auth=journeyAuthentication(`e30.${Buffer.from(JSON.stringify({type:'ACCESS',sub:'7',sg:2,iat:now,exp:now+600})).toString('base64url')}.c2ln`,'http://127.0.0.1:15544',7);
    const source=jest.fn(async()=>auth);
    stored=JSON.stringify({sessionId:'11111111-1111-4111-8111-111111111111',scheduleId:'9001',generation:1,routeRevision:1,
        clientOwnerId:'11111111-1111-4111-8111-111111111111',routeInputDigest:'a'.repeat(64),execution:'SIMULATOR',
        syncScope:'AUTHENTICATED',savedRouteValidated:true,guidanceEnabled:true,preparedAtEpochSeconds:now-700,
        expiresAtEpochSeconds:now+6500,apiOrigin:auth.apiOrigin,authMemberId:7,loginGeneration:2});
    const original=stored;
    mockAuthenticatedPost.mockImplementation(async(_auth,path,body)=>JSON.parse(await(await server(`http://127.0.0.1:15543${path}`,
        {credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).text()));
    await expect(restoreAutomaticJourneyTrial(saved,source)).rejects.toThrow('AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT');
    expect(source).toHaveBeenCalledWith(now+6500);expect(mockRestore).not.toHaveBeenCalled();expect(mockConfigureAuth).not.toHaveBeenCalled();
    expect(stored).toBe(original);expect(calls.every(call=>!call.path.endsWith('/departure'))).toBe(true);
});
async function authenticatedRenewalSetup() {
    const saved = { ...input, context: "SAVED_ROUTE" } as JourneyRouteInput;
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ["SAVED_ROUTE_REVALIDATION_REQUIRED"], legs: [{ kind: "WALK", geometryUsable: true }] } });
    const now = Math.floor(Date.now() / 1000);
    const auth = (expiry: number) => journeyAuthentication(`e30.${Buffer.from(JSON.stringify({ type: "ACCESS", sub: "7", sg: 2, iat: now, exp: now + expiry })).toString("base64url")}.c2ln`, "http://127.0.0.1:15544", 7);
    const previous = auth(600); const next = auth(900);
    const source = jest.fn().mockResolvedValue(previous);
    mockAuthenticatedPost.mockImplementation(async (_auth, path, body) => {
        const wire = await server(`http://127.0.0.1:15543${path}`, { credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return JSON.parse(await wire.text());
    });
    await prepareAutomaticJourneyTrial(saved, "AUTHENTICATED", "9001", source);
    queueDeparture(); await retryAutomaticJourneySync();
    return { previous, next, source };
}
it.each(['SNAPSHOT_REPLACED','SNAPSHOT_NOT_FOUND','EXPIRED','REVISION_CHANGED'])('mixed snapshot denial %s stops native even with empty departure outbox',async denial=>{
    const now=Date.now(),snapshot={schemaVersion:1 as const,snapshotId:'12345678-1234-1234-1234-123456789abc',memberId:7,scheduleId:9001,
        loginGeneration:2,routeRevision:1,routeFingerprint:'a'.repeat(64),issuedAtMs:now,expiresAtMs:now+300000,
        transitProvider:'odsay' as const,walkProvider:'tmap' as const,navigationReady:false as const,reason:'TRANSIT_ADMISSION_PENDING' as const,
        walks:[0,2].map(legIndex=>({legIndex:legIndex as 0|2,provider:'tmap' as const,points:[{lat:37.5665,lng:126.978},{lat:37.5665,lng:126.9785}]}))};
    const saved={...input,context:'SAVED_ROUTE',walkingSnapshot:snapshot} as JourneyRouteInput;
    mockAssess.mockResolvedValue({available:true,summary:{reasonCodes:['SAVED_ROUTE_REVALIDATION_REQUIRED'],legs:[{kind:'WALK',geometryUsable:true}]}});
    const token=`e30.${Buffer.from(JSON.stringify({type:'ACCESS',sub:'7',sg:2,iat:now/1000,exp:now/1000+600})).toString('base64url')}.c2ln`;
    const auth=journeyAuthentication(token,'http://127.0.0.1:15544',7);
    mockAuthenticatedPost.mockImplementation(async (_auth,path,body)=>{
        const wire=await server(`http://127.0.0.1:15543${path}`,{credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        return JSON.parse(await wire.text());
    });
    fetchMock.mockResolvedValue(response(snapshot));
    await prepareAutomaticJourneyTrial(saved,'AUTHENTICATED','9001',async()=>auth);
    await flush();expect(pending).toBeNull();
    fetchMock.mockResolvedValue({ok:false,status:409,text:async()=>JSON.stringify({success:false,errorCode:denial})});
    await retryAutomaticJourneySync();
    expect(mockStop).toHaveBeenCalled();expect(stored).toBeNull();
    expect(getAutomaticJourneySyncState()).toMatchObject({status:'BLOCKED',errorCode:'AUTOMATIC_SERVER_REJECTED'});
    expect(serverDepartures).toBe(0);
});
it.each([false,true])('retained walking resume uses persisted preparation validation after admission expiry; revoked=%s',async revoked=>{
    const now=Date.now(),snapshot={schemaVersion:3 as const,snapshotId:'12345678-1234-1234-1234-123456789abc',memberId:7,scheduleId:9001,
        loginGeneration:2,routeRevision:1,routeFingerprint:'a'.repeat(64),issuedAtMs:now,expiresAtMs:now+300000,navigationExpiresAtMs:now+900000,
        transitProvider:'odsay' as const,walkProvider:'tmap' as const,navigationReady:false as const,reason:'TRANSIT_ADMISSION_PENDING' as const,
        walks:[0,2].map(legIndex=>({legIndex,provider:'tmap' as const,points:[{lat:37.5665,lng:126.978},{lat:37.5665,lng:126.9785}]}))};
    const saved={...input,context:'SAVED_ROUTE',walkingSnapshot:snapshot} as JourneyRouteInput;
    mockAssess.mockResolvedValue({available:true,summary:{reasonCodes:['SAVED_ROUTE_REVALIDATION_REQUIRED'],legs:[{kind:'WALK',geometryUsable:true}]}});
    const token=`e30.${Buffer.from(JSON.stringify({type:'ACCESS',sub:'7',sg:2,iat:now/1000,exp:now/1000+1200})).toString('base64url')}.c2ln`;
    const auth=journeyAuthentication(token,'http://127.0.0.1:15544',7);
    mockAuthenticatedPost.mockImplementation(async (_auth,path,body)=>{
        const wire=await server(`http://127.0.0.1:15543${path}`,{credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        return JSON.parse(await wire.text());
    });
    await prepareAutomaticJourneyTrial(saved,'AUTHENTICATED','9001',async()=>auth);
    await flush();const persisted=stored;fetchMock.mockClear();mockAuthenticatedPost.mockClear();mockStop.mockClear();
    jest.setSystemTime(now+301000);
    if(revoked)mockAuthenticatedPost.mockRejectedValue(new Error('AUTOMATIC_SERVER_REJECTED'));
    await retryAutomaticJourneySync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockAuthenticatedPost.mock.calls.some(call=>String(call[1]).endsWith('/validate'))).toBe(true);
    expect(mockArm).toHaveBeenCalledTimes(1);expect(serverDepartures).toBe(0);
    if(revoked){expect(mockStop).toHaveBeenCalled();expect(getAutomaticJourneySyncState().status).toBe('BLOCKED');}
    else {expect(mockStop).not.toHaveBeenCalled();expect(stored).toBe(persisted);}
});
it("same-account refresh adopts the token without rearming or extending persisted session", async () => {
    const { previous, next, source } = await authenticatedRenewalSetup();
    const persisted = stored; source.mockResolvedValue(next);
    await Promise.all([retryAutomaticJourneySync(), retryAutomaticJourneySync()]);
    expect(mockUpdateAuth).toHaveBeenCalledTimes(1);
    expect(mockUpdateAuth).toHaveBeenCalledWith(next, binding, previous.accessToken);
    expect(stored).toBe(persisted); expect(stored).not.toContain(next.accessToken);
    expect(mockArm).toHaveBeenCalledTimes(1); expect(mockStop).not.toHaveBeenCalled();
    expect(serverDepartures).toBe(1); expect(getAutomaticJourneySyncState().status).toBe("ACKNOWLEDGED");
});
it("logout while refresh source is pending cannot update native credentials or ACK", async () => {
    const { next, source } = await authenticatedRenewalSetup();
    const wait = deferred<typeof next>(); source.mockReturnValueOnce(wait.promise);
    const task = retryAutomaticJourneySync(); await flush();
    await mockAuth();
    wait.resolve(next); await task;
    expect(mockUpdateAuth).not.toHaveBeenCalled(); expect(mockStop).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull(); expect(getAutomaticJourneySyncState().status).toBe("IDLE");
});
it("native rejects a stopped or superseded live rotation and JS fails closed", async () => {
    const { next, source } = await authenticatedRenewalSetup(); source.mockResolvedValue(next);
    mockUpdateAuth.mockRejectedValueOnce(new Error("AUTOMATIC_NATIVE_AUTH_REJECTED"));
    await retryAutomaticJourneySync();
    expect(mockStop).toHaveBeenCalledTimes(1); expect(stored).toBeNull();
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: "BLOCKED", errorCode: "AUTOMATIC_NATIVE_AUTH_REJECTED" });
});
it("LOCAL_ONLY can detect but never sends server prepare, departure, or stop", async () => {
    await prepareAutomaticJourneyTrial(routingInput, "LOCAL_ONLY");
    queueDeparture();
    await retryAutomaticJourneySync();
    expect(getAutomaticJourneySyncState().status).toBe("PENDING");
    expect(mockAck).not.toHaveBeenCalled();
    await stopAutomaticJourneyTrial();
    expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects an ineligible route before server preparation or native arm", async () => {
    mockAssess.mockResolvedValue({ available: true, summary: { reasonCodes: ["SYNTHETIC_FIXTURE_ONLY", "FIRST_WALK_GEOMETRY_UNUSABLE"], legs: [] } });
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("ROUTE_NOT_ELIGIBLE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockArm).not.toHaveBeenCalled();
});
it("fail-closes if storing the binding fails, cancelling server preparation", async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("private file path"));
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("AUTOMATIC_SYNC_UNAVAILABLE");
    expect(mockArm).not.toHaveBeenCalled();
    expect(calls.map(call => call.path.split("/").pop())).toEqual(["prepare", "stop"]);
});
it("paused synchronization keeps the native event; unpause sends and acknowledges automatically", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    setAutomaticJourneySyncPaused(true);
    queueDeparture();
    await retryAutomaticJourneySync();
    expect(getAutomaticJourneySyncState().status).toBe("PENDING");
    expect(serverDepartures).toBe(0);
    setAutomaticJourneySyncPaused(false);
    await flush();
    expect(serverDepartures).toBe(1);
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(getAutomaticJourneySyncState().status).toBe("ACKNOWLEDGED");
});
it("network retry retains identical event and native ACK only follows a valid server receipt", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    fetchMock.mockRejectedValueOnce(new Error("offline sensitive details"));
    await retryAutomaticJourneySync();
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: "RETRY_WAIT", errorCode: "AUTOMATIC_SYNC_UNAVAILABLE" });
    expect(pending).not.toBeNull(); expect(mockAck).not.toHaveBeenCalled();
    const firstRequest = fetchMock.mock.calls[1][1].body;
    await retryAutomaticJourneySync();
    expect(fetchMock.mock.calls[2][1].body).toBe(firstRequest);
    expect(mockAck).toHaveBeenCalledTimes(1);
});
it("response loss after commit retries the same key without a second server departure", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    fetchMock.mockImplementationOnce(async (url, init) => { await server(url, init); throw new Error("connection lost"); });
    await retryAutomaticJourneySync();
    expect(serverDepartures).toBe(1); expect(mockAck).not.toHaveBeenCalled();
    await retryAutomaticJourneySync();
    expect(serverDepartures).toBe(1); expect(mockAck).toHaveBeenCalledTimes(1);
    expect(calls[1].body).toEqual(calls[2].body);
});
it("failed durable native ACK leaves the event retryable and server idempotence intact", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    mockAck.mockResolvedValueOnce({ ...ready, sessionId: binding.sessionId, pendingDeparture: true });
    await retryAutomaticJourneySync();
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: "RETRY_WAIT", errorCode: "NATIVE_ACK_NOT_PERSISTED" });
    expect(pending).not.toBeNull();
    await retryAutomaticJourneySync();
    expect(serverDepartures).toBe(1); expect(mockAck).toHaveBeenCalledTimes(2);
});
it("single-flights repeated native events and explicit sync requests", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    const wait = deferred<Awaited<ReturnType<typeof server>>>();
    fetchMock.mockReturnValueOnce(wait.promise);
    const first = retryAutomaticJourneySync(); const second = retryAutomaticJourneySync();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    wait.resolve(await server(fetchMock.mock.calls[1][0], fetchMock.mock.calls[1][1]));
    await Promise.all([first, second]); expect(mockAck).toHaveBeenCalledTimes(1);
});
it("frequent location events cannot bypass the automatic retry cooldown", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    fetchMock.mockRejectedValueOnce(new Error("offline")); await retryAutomaticJourneySync();
    for (let i = 0; i < 5; i++) mockNativeEvent({ ...ready, pendingDeparture: true });
    await flush(); expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(5001);
    mockNativeEvent({ ...ready, pendingDeparture: true }); await flush();
    expect(serverDepartures).toBe(1);
});
it("logout during a departure request fences a late ACK and stops native collection", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    const wait = deferred<Awaited<ReturnType<typeof server>>>(); fetchMock.mockReturnValueOnce(wait.promise);
    const task = retryAutomaticJourneySync(); await flush();
    const departureRequest = fetchMock.mock.calls[1];
    await mockAuth();
    wait.resolve(await server(departureRequest[0], departureRequest[1])); await task;
    expect(mockStop).toHaveBeenCalled(); expect(mockAck).not.toHaveBeenCalled();
    expect(getAutomaticJourneySyncState().status).toBe("IDLE");
});
it("logout while preparing cancels the late server binding without arming", async () => {
    const wait = deferred<Awaited<ReturnType<typeof server>>>(); fetchMock.mockReturnValueOnce(wait.promise);
    const task = prepareAutomaticJourneyTrial(input, "SANDBOX");
    const rejection = task.catch(error => error);
    await flush(); const request = fetchMock.mock.calls[0];
    await mockAuth(); wait.resolve(await server(request[0], request[1]));
    await expect(rejection).resolves.toMatchObject({ message: "AUTOMATIC_OPERATION_CANCELLED" });
    expect(mockArm).not.toHaveBeenCalled();
    expect(calls.map(call => call.path.split("/").pop())).toEqual(["prepare", "stop"]);
});
it("logout while native arm resolves late performs a second revocation", async () => {
    const wait = deferred<AutomaticJourneySnapshot>(); mockArm.mockReturnValueOnce(wait.promise);
    const task = prepareAutomaticJourneyTrial(input, "SANDBOX");
    const rejection = task.catch(error => error); await flush();
    const next = mockArm.mock.calls[0][1]; await mockAuth();
    wait.resolve({ ...ready, status: "ARMED", sessionId: next.sessionId });
    await expect(rejection).resolves.toMatchObject({ message: "AUTOMATIC_OPERATION_CANCELLED" });
    expect(mockStop).toHaveBeenCalledTimes(2);
});
it("detaching a view leaves the lifetime/auth fence active", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    const detach = subscribeAutomaticJourneySync(jest.fn()); detach();
    expect(mockStop).not.toHaveBeenCalled(); await mockAuth(); expect(mockStop).toHaveBeenCalledTimes(1);
});
it("definitive server rejection does not ACK or repeatedly resend", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 }); await retryAutomaticJourneySync();
    expect(getAutomaticJourneySyncState().status).toBe("BLOCKED");
    await retryAutomaticJourneySync(); expect(fetchMock).toHaveBeenCalledTimes(2); expect(mockAck).not.toHaveBeenCalled();
});
it("restores only an explicitly supplied matching route and resumes the durable event", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); queueDeparture();
    const saved = stored; const event = pending;
    await stopAutomaticJourneyTrial(); stored = saved; pending = event;
    await restoreAutomaticJourneyTrial(input); await flush();
    expect(mockRestore).toHaveBeenCalledWith(JSON.stringify(input), binding);
    expect(mockAck).toHaveBeenCalledTimes(1);
});
it("stopping after a JS restart also cancels the persisted server binding", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX"); const saved = stored;
    await stopAutomaticJourneyTrial(); calls = []; stored = saved;
    await stopAutomaticJourneyTrial();
    expect(calls.map(call => call.path.split("/").pop())).toEqual(["stop"]);
});
it('cold authenticated stop retains intent without a credential, then same-account retry clears it', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `e30.${Buffer.from(JSON.stringify({ type: 'ACCESS', sub: '7', sg: 2, iat: now, exp: now + 600 })).toString('base64url')}.c2ln`;
    const auth = journeyAuthentication(token, 'http://127.0.0.1:15544', 7);
    stored = JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001', generation: 1, routeRevision: 1,
        clientOwnerId: '22222222-2222-4222-8222-222222222222', routeInputDigest: 'a'.repeat(64), execution: 'SIMULATOR',
        syncScope: 'AUTHENTICATED', apiOrigin: auth.apiOrigin, authMemberId: 7, loginGeneration: 2,
        preparedAtEpochSeconds: now, expiresAtEpochSeconds: now + 600, savedRouteValidated: true, guidanceEnabled: true });
    await expect(stopAutomaticJourneyTrial()).resolves.toMatchObject({ status: 'STOPPED' });
    expect(mockStop).toHaveBeenCalled(); expect(stored).toBeNull();
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: 'RETRY_WAIT', pendingStopCount: 1 });
    expect(JSON.parse(stopStored!).bindings).toHaveLength(1); expect(stopStored).not.toContain(token);
    await expect(prepareAutomaticJourneyTrial(input, 'SANDBOX')).rejects.toThrow('PENDING_STOP_BLOCKS_PREPARE');
    await expect(restoreAutomaticJourneyTrial(input)).rejects.toThrow('PENDING_STOP_BLOCKS_RESTORE');
    mockAuthenticatedPost.mockResolvedValue({ success: true, data: { sessionId: '11111111-1111-4111-8111-111111111111', state: 'STOPPED' } });
    const changedToken = `e30.${Buffer.from(JSON.stringify({ type: 'ACCESS', sub: '7', sg: 3, iat: now, exp: now + 600 })).toString('base64url')}.c2ln`;
    await retryAutomaticJourneyStops(async () => journeyAuthentication(changedToken, auth.apiOrigin, 7));
    expect(mockAuthenticatedPost).not.toHaveBeenCalled();
    await retryAutomaticJourneyStops(async () => auth);
    expect(mockAuthenticatedPost).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stopStored!).bindings).toEqual([]);
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: 'IDLE', pendingStopCount: 0, errorCode: null });
});
it('an unreadable cold binding stops native but preserves evidence and reports remote cleanup blocked', async () => {
    stored = '{invalid';
    await expect(stopAutomaticJourneyTrial()).resolves.toMatchObject({ status: 'STOPPED' });
    expect(mockStop).toHaveBeenCalled(); expect(stored).toBe('{invalid');
    expect(getAutomaticJourneySyncState()).toMatchObject({ status: 'BLOCKED', errorCode: 'STOP_BINDING_STORAGE_UNAVAILABLE' });
    await expect(prepareAutomaticJourneyTrial(input, 'SANDBOX')).rejects.toThrow('CHECKPOINT_RESTORE_OR_STOP_REQUIRED');
    expect(stored).toBe('{invalid');
});
it.each(['EXPIRED', 'STOPPED'] as const)('native %s automatically persists and delivers remote cleanup once', async status => {
    await prepareAutomaticJourneyTrial(input, 'SANDBOX');
    mockNativeEvent({ ...ready, status, sessionId: binding.sessionId });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(calls.filter(call => call.path.endsWith('/stop'))).toHaveLength(1);
    expect(stored).toBeNull(); expect(JSON.parse(stopStored!).bindings).toEqual([]);
    expect(getAutomaticJourneySyncState()).toMatchObject({ pendingStopCount: 0, status: 'IDLE' });
});
it('destination arrival terminal event uses the same idempotent stop lane, not schedule completion', async () => {
    await prepareAutomaticJourneyTrial(input, 'SANDBOX');
    const arrived = { ...ready, status: 'STOPPED' as const, sessionId: binding.sessionId, qualityReason: 'DESTINATION_ARRIVED' };
    mockNativeEvent(arrived);mockNativeEvent(arrived);
    for (let i=0;i<30;i++) await Promise.resolve();
    expect(calls.filter(call => call.path.endsWith('/stop'))).toHaveLength(1);
    expect(calls.every(call => !call.path.includes('/complete'))).toBe(true);
    expect(stored).toBeNull();expect(getAutomaticJourneySyncState().pendingStopCount).toBe(0);
});
it("an attempted second preparation cannot disable the existing session pump", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    mockGet.mockResolvedValue({ ...ready, status: "ARMED" });
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("SESSION_ALREADY_RUNNING");
    queueDeparture(); await retryAutomaticJourneySync(); expect(mockAck).toHaveBeenCalledTimes(1);
});
it("blocks prepare and restore until an in-flight native stop has completed", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    const wait = deferred<AutomaticJourneySnapshot>();
    mockStop.mockReturnValueOnce(wait.promise);
    const stopping = stopAutomaticJourneyTrial();
    await flush();
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("AUTOMATIC_OPERATION_PENDING");
    await expect(restoreAutomaticJourneyTrial(input)).rejects.toThrow("AUTOMATIC_OPERATION_PENDING");
    expect(mockArm).toHaveBeenCalledTimes(1);
    expect(mockRestore).not.toHaveBeenCalled();
    wait.resolve({ ...ready, status: "STOPPED" });
    await stopping;
    expect(stored).toBeNull();
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    expect(mockArm).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stored!)).toEqual(binding);
});
it("keeps the stop barrier until delayed server cleanup finishes", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    const wait = deferred<Awaited<ReturnType<typeof server>>>();
    fetchMock.mockReturnValueOnce(wait.promise);
    const stopping = stopAutomaticJourneyTrial();
    await flush();
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull();
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("AUTOMATIC_OPERATION_PENDING");
    await expect(restoreAutomaticJourneyTrial(input)).rejects.toThrow("AUTOMATIC_OPERATION_PENDING");
    wait.resolve(response({ sessionId: binding.sessionId, state: "STOPPED" }));
    await stopping;
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    expect(getAutomaticJourneySyncState().status).toBe("IDLE");
    expect(JSON.parse(stored!)).toEqual(binding);
});
it("single-flights duplicate stops so old cleanup cannot race a second cleanup", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    const wait = deferred<AutomaticJourneySnapshot>();
    mockStop.mockReturnValueOnce(wait.promise);
    const first = stopAutomaticJourneyTrial();
    const second = stopAutomaticJourneyTrial();
    await flush();
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    const stopped = { ...ready, status: "STOPPED" as const };
    wait.resolve(stopped);
    expect(await Promise.all([first, second])).toEqual([stopped, stopped]);
    expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(calls.filter(call => call.path.endsWith("/stop"))).toHaveLength(1);
});
it.each([
    { ...ready, enabled: false, reason: "AUTOMATIC_ENGINE_UNAVAILABLE" },
    { ...ready, status: "IDLE" },
    { ...ready, status: "ARMED", sessionId: "22222222-2222-4222-8222-222222222222" },
])("revokes native collection after an incomplete arm acknowledgement %#", async snapshot => {
    mockArm.mockResolvedValueOnce(snapshot);
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow(
        snapshot.reason ?? "AUTOMATIC_PREPARATION_FAILED",
    );
    expect(mockArm).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull();
    expect(calls.map(call => call.path.split("/").pop())).toEqual(["prepare", "stop"]);
    expect(mockDetach).toHaveBeenCalledTimes(1);
});
it("revokes native collection when the arm promise rejects after it was requested", async () => {
    mockArm.mockRejectedValueOnce(new Error("private bridge failure after commit"));
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("AUTOMATIC_SYNC_UNAVAILABLE");
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull();
    expect(calls.map(call => call.path.split("/").pop())).toEqual(["prepare", "stop"]);
});
it.each([
    { ...ready, enabled: false },
    { ...ready, status: "STOPPED", sessionId: "11111111-1111-4111-8111-111111111111" },
    { ...ready, status: "ARMED", sessionId: "22222222-2222-4222-8222-222222222222" },
])("revokes native collection after an incomplete restore acknowledgement %#", async snapshot => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    const saved = stored;
    await stopAutomaticJourneyTrial();
    stored = saved;
    mockStop.mockClear();
    mockDetach.mockClear();
    mockRestore.mockResolvedValueOnce(snapshot);
    await expect(restoreAutomaticJourneyTrial(input)).rejects.toThrow("AUTOMATIC_RESTORE_FAILED");
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockDetach).toHaveBeenCalledTimes(1);
});
it("revokes native collection when a restore promise rejects after it was requested", async () => {
    await prepareAutomaticJourneyTrial(input, "SANDBOX");
    const saved = stored;
    await stopAutomaticJourneyTrial();
    stored = saved;
    mockStop.mockClear();
    mockRestore.mockRejectedValueOnce(new Error("private restored checkpoint detail"));
    await expect(restoreAutomaticJourneyTrial(input)).rejects.toThrow("AUTOMATIC_SYNC_UNAVAILABLE");
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockAck).not.toHaveBeenCalled();
});
it("disabled builds cannot prepare, restore, or perform network/storage work", async () => {
    mockEnabled = false;
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("DEVELOPMENT_IOS_ONLY");
    await expect(restoreAutomaticJourneyTrial(input)).rejects.toThrow("DEVELOPMENT_IOS_ONLY");
    await retryAutomaticJourneySync(); await stopAutomaticJourneyTrial();
    expect(fetchMock).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it("a restarted checkpoint must be explicitly restored or stopped, never replaced by prepare cleanup", async () => {
    mockGet.mockResolvedValue({ ...ready, checkpointAvailable: true });
    await expect(prepareAutomaticJourneyTrial(input, "SANDBOX")).rejects.toThrow("CHECKPOINT_RESTORE_OR_STOP_REQUIRED");
    expect(mockArm).not.toHaveBeenCalled(); expect(mockStop).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled(); expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});

function coldAuthenticatedCheckpoint() {
    const now = Math.floor(Date.now() / 1000);
    const token = `e30.${Buffer.from(JSON.stringify({ type: 'ACCESS', sub: '7', sg: 2, iat: now, exp: now + 600 })).toString('base64url')}.c2ln`;
    const auth = journeyAuthentication(token, 'http://127.0.0.1:15544', 7);
    const b: AutomaticJourneyBinding = { sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001', generation: 1, routeRevision: 1,
        clientOwnerId: '22222222-2222-4222-8222-222222222222', routeInputDigest: 'a'.repeat(64), execution: 'SIMULATOR',
        syncScope: 'AUTHENTICATED', apiOrigin: auth.apiOrigin, authMemberId: 7, loginGeneration: 2,
        preparedAtEpochSeconds: now, expiresAtEpochSeconds: now + 600, savedRouteValidated: true, guidanceEnabled: true };
    stored = JSON.stringify(b);
    mockGet.mockResolvedValue({ ...ready, checkpointAvailable: true });
    const data = { schemaVersion: 1, sessionId: b.sessionId, scheduleId: b.scheduleId, generation: b.generation,
        routeRevision: b.routeRevision, clientOwnerId: b.clientOwnerId, routeInputDigest: b.routeInputDigest, execution: b.execution,
        checkedAt: new Date().toISOString(), state: 'STOPPED', endedAt: new Date().toISOString() };
    mockAuthenticatedPost.mockResolvedValue({ success: true, data });
    return { auth, b, data, source: async () => auth };
}
it('automatically clears an exact server-terminal checkpoint without restore or stop HTTP', async () => {
    const { b, source } = coldAuthenticatedCheckpoint();
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(mockTerminalCleanup).toHaveBeenCalledWith(b); expect(stored).toBeNull();
    expect(mockAuthenticatedPost).toHaveBeenCalledTimes(1);
    expect(mockAuthenticatedPost.mock.calls[0][1]).toMatch(/\/reconcile$/);
    expect(mockStop).not.toHaveBeenCalled(); expect(mockArm).not.toHaveBeenCalled(); expect(mockRestore).not.toHaveBeenCalled();
    expect(getAutomaticJourneySyncState()).toMatchObject({ checkpointState: 'CLEARED', errorCode: null });
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(mockTerminalCleanup).toHaveBeenCalledTimes(1);
});
it('cold native tombstone plus retained owned binding recovers interrupted terminal cleanup once', async () => {
    const { b, source } = coldAuthenticatedCheckpoint();
    mockGet.mockResolvedValue({ ...ready, checkpointAvailable: false });
    mockAuthenticatedPost.mockResolvedValue({ success: true, data: { sessionId: b.sessionId, state: 'STOPPED' } });
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(mockAuthenticatedPost.mock.calls[0][1]).toMatch(/\/stop$/);
    expect(mockAuthenticatedPost).toHaveBeenCalledTimes(1);
    expect(stored).toBeNull();expect(getAutomaticJourneySyncState().pendingStopCount).toBe(0);
    expect(mockArm).not.toHaveBeenCalled();expect(mockRestore).not.toHaveBeenCalled();expect(mockStop).not.toHaveBeenCalled();
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(mockAuthenticatedPost).toHaveBeenCalledTimes(1);
});
it('cold interrupted cleanup queues offline without treating server silence as success', async () => {
    const { b, source } = coldAuthenticatedCheckpoint();
    mockGet.mockResolvedValue({ ...ready, checkpointAvailable: false });
    mockAuthenticatedPost.mockRejectedValueOnce(new Error('AUTOMATIC_SERVER_UNAVAILABLE'));
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(stored).toBeNull();expect(getAutomaticJourneySyncState()).toMatchObject({ pendingStopCount: 1, checkpointState: 'WAITING' });
    mockAuthenticatedPost.mockResolvedValue({ success: true, data: { sessionId: b.sessionId, state: 'STOPPED' } });
    await retryAutomaticJourneyStops(source);
    expect(getAutomaticJourneySyncState().pendingStopCount).toBe(0);
});
it('cold interrupted cleanup cannot deliver an old binding through a different login', async () => {
    const { auth } = coldAuthenticatedCheckpoint();const before=stored;
    mockGet.mockResolvedValue({ ...ready, checkpointAvailable: false });
    await reconcileAutomaticJourneyCheckpoint(async () => ({ ...auth, loginGeneration: 3 }));
    expect(stored).toBe(before);expect(mockAuthenticatedPost).not.toHaveBeenCalled();
});
it.each(['ARMED', 'ACTIVE'])('preserves authoritative %s checkpoint without granting restore permission', async state => {
    const { source, data } = coldAuthenticatedCheckpoint(); const before = stored;
    mockAuthenticatedPost.mockResolvedValue({ success: true, data: { ...data, state, endedAt: null } });
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(stored).toBe(before); expect(mockTerminalCleanup).not.toHaveBeenCalled(); expect(mockRestore).not.toHaveBeenCalled();
    expect(getAutomaticJourneySyncState().checkpointState).toBe('CURRENT');
});
it('transient outage preserves checkpoint, then automatic retry clears only on terminal receipt', async () => {
    const { source } = coldAuthenticatedCheckpoint(); const before = stored;
    mockAuthenticatedPost.mockRejectedValueOnce(new Error('AUTOMATIC_SERVER_UNAVAILABLE'));
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(stored).toBe(before); expect(mockTerminalCleanup).not.toHaveBeenCalled();
    expect(getAutomaticJourneySyncState().checkpointState).toBe('WAITING');
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(stored).toBeNull(); expect(mockTerminalCleanup).toHaveBeenCalledTimes(1);
});
it.each(['generation', 'routeRevision', 'clientOwnerId', 'routeInputDigest', 'sessionId', 'scheduleId', 'execution', 'checkedAt', 'endedAt'])
('rejects terminal receipt mismatch in %s and preserves all records', async field => {
    const { source, data } = coldAuthenticatedCheckpoint(); const before = stored;
    mockAuthenticatedPost.mockResolvedValue({ success: true, data: { ...data, [field]: 'invalid' } });
    await reconcileAutomaticJourneyCheckpoint(source);
    expect(stored).toBe(before); expect(mockTerminalCleanup).not.toHaveBeenCalled();
    expect(getAutomaticJourneySyncState().checkpointState).toBe('BLOCKED');
});
it.each(['AUTOMATIC_SERVER_REJECTED', 'AUTOMATIC_AUTH_CHANGED', 'INVALID_AUTOMATIC_SERVER_RESPONSE'])
('does not infer termination from %s', async code => {
    const { source } = coldAuthenticatedCheckpoint(); const before = stored;
    mockAuthenticatedPost.mockRejectedValueOnce(new Error(code)); await reconcileAutomaticJourneyCheckpoint(source);
    expect(stored).toBe(before); expect(mockTerminalCleanup).not.toHaveBeenCalled();
});
it('new login identity never receives the old reconciliation request', async () => {
    const { auth } = coldAuthenticatedCheckpoint(); const before = stored;
    await reconcileAutomaticJourneyCheckpoint(async () => ({ ...auth, loginGeneration: 3 }));
    expect(mockAuthenticatedPost).not.toHaveBeenCalled(); expect(stored).toBe(before); expect(mockTerminalCleanup).not.toHaveBeenCalled();
});
it('logout cancels a late terminal receipt before native cleanup', async () => {
    const { source, data } = coldAuthenticatedCheckpoint(); const wait = deferred<unknown>();
    mockAuthenticatedPost.mockReturnValueOnce(wait.promise);
    const check = reconcileAutomaticJourneyCheckpoint(source); await flush();
    await mockAuth(); wait.resolve({ success: true, data }); await check;
    expect(mockTerminalCleanup).not.toHaveBeenCalled();
});
it('concurrent reconciliation single-flights and prevents a new prepare while checking', async () => {
    const { source, data } = coldAuthenticatedCheckpoint(); const wait = deferred<unknown>();
    mockAuthenticatedPost.mockReturnValueOnce(wait.promise);
    const one = reconcileAutomaticJourneyCheckpoint(source); const two = reconcileAutomaticJourneyCheckpoint(source); await flush();
    await expect(prepareAutomaticJourneyTrial(input, 'SANDBOX')).rejects.toThrow('AUTOMATIC_OPERATION_PENDING');
    wait.resolve({ success: true, data }); await Promise.all([one, two]);
    expect(mockAuthenticatedPost).toHaveBeenCalledTimes(1); expect(mockTerminalCleanup).toHaveBeenCalledTimes(1);
});
it('changed JS binding or rejected native binding is never deleted by a late receipt', async () => {
    const { source } = coldAuthenticatedCheckpoint();
    mockTerminalCleanup.mockImplementationOnce(async () => { stored = 'new-binding'; });
    await reconcileAutomaticJourneyCheckpoint(source); expect(stored).toBe('new-binding');
    coldAuthenticatedCheckpoint(); const before = stored;
    mockTerminalCleanup.mockRejectedValueOnce(new Error('CHECKPOINT_TERMINAL_CLEANUP_REJECTED'));
    await reconcileAutomaticJourneyCheckpoint(source); expect(stored).toBe(before);
});
it('storage cleanup failure retains retryable JS evidence after native revocation', async () => {
    const { source } = coldAuthenticatedCheckpoint(); const before = stored;
    jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('disk unavailable'));
    await reconcileAutomaticJourneyCheckpoint(source); expect(stored).toBe(before);
    expect(getAutomaticJourneySyncState().checkpointState).toBe('WAITING');
    await reconcileAutomaticJourneyCheckpoint(source); expect(stored).toBeNull();
});

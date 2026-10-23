import { Buffer } from "buffer";
import { createAuthenticatedJourneyPost, createRenewingJourneyAuthenticationSource, journeyAuthentication, journeyRenewalCandidate, journeyAuthenticationOrigin, requireJourneyAuthenticationIdentity, requireJourneyAuthenticationLifetime } from "../src/modules/journey/automaticJourneyAuthentication";
jest.mock('expo-device', () => ({ isDevice: false }));
import { normalizeAutomaticJourneyBinding } from "../src/modules/journey/automaticJourney";
import { journeyJSONRequest } from "../src/modules/journey/journeyJSONRequest";

const now = 1_000;
const token = (patch: Record<string, unknown> = {}) => `e30.${Buffer.from(JSON.stringify({ type: "ACCESS", sub: "7", sg: 2, iat: 990, exp: 1600, name: "합성", ...patch })).toString("base64url")}.c2ln`;
const identity = { apiOrigin: "http://127.0.0.1:15544", authMemberId: 7, loginGeneration: 2 };
const path = "/api/schedules/9001/automatic-journey/prepare-saved";
it('long navigation renews a still-valid short token before arming, not in background', async () => {
    let auth = journeyAuthentication(token(), identity.apiOrigin, 7, now);
    const renew = jest.fn(async () => { auth = journeyAuthentication(token({ exp: 9000 }), identity.apiOrigin, 7, now); });
    const source = createRenewingJourneyAuthenticationSource(async () => auth, renew);
    await source(); expect(renew).not.toHaveBeenCalled();
    await expect(source(8200)).resolves.toMatchObject({ expiresAtEpochSeconds: 9000 });
    expect(renew).toHaveBeenCalledTimes(1);
    await source(8200); expect(renew).toHaveBeenCalledTimes(1);
});
it('a successful refresh with insufficient horizon cannot authorize long navigation', async () => {
    let auth = journeyAuthentication(token(), identity.apiOrigin, 7, now);
    const source = createRenewingJourneyAuthenticationSource(async () => auth, async () => {
        auth = journeyAuthentication(token({ exp: 2000 }), identity.apiOrigin, 7, now);
    });
    await expect(source(8200)).rejects.toThrow('AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT');
});
it('long callers joining an ordinary flight cannot inherit its short lifetime', async () => {
    const auth = journeyAuthentication(token(), identity.apiOrigin, 7, now);
    let release!: (value: typeof auth) => void;
    const read = new Promise<typeof auth>(resolve => { release = resolve; });
    const renew = jest.fn();
    const source = createRenewingJourneyAuthenticationSource(() => read, renew);
    const normal = source(); const long = source(8200);
    const rejected = expect(long).rejects.toThrow('AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT');
    release(auth); await normal; await rejected;
    expect(renew).not.toHaveBeenCalled();
});
it.each([Number.NaN, Number.POSITIVE_INFINITY, 999, 1000, 8206])('rejects invalid navigation horizon %s before reading credentials', async until => {
    const read = jest.fn(); const source = createRenewingJourneyAuthenticationSource(read, jest.fn());
    await expect(source(until)).rejects.toThrow('AUTOMATIC_AUTH_HORIZON_INVALID');
    expect(read).not.toHaveBeenCalled();
});
it('fixed horizon requires a 30-second margin and cannot accept forged metadata', () => {
    const auth = journeyAuthentication(token({ exp: 8230 }), identity.apiOrigin, 7, now);
    expect(() => requireJourneyAuthenticationLifetime(auth, 8200)).not.toThrow();
    expect(() => requireJourneyAuthenticationLifetime({ ...auth, expiresAtEpochSeconds: 9000 }, 8200)).toThrow('AUTOMATIC_AUTH_CHANGED');
    expect(() => requireJourneyAuthenticationLifetime(journeyAuthentication(token({ exp: 8229 }), identity.apiOrigin, 7, now), 8200)).toThrow('AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT');
});
it("expired recovery candidate is renewed once, and is never usable for authenticated requests", async () => {
    let auth = journeyRenewalCandidate(token({ exp: 999 }), identity.apiOrigin, 7, now);
    expect(() => requireJourneyAuthenticationIdentity(auth, identity)).toThrow("AUTOMATIC_AUTH_REQUIRED");
    const renew = jest.fn(async () => { auth = journeyAuthentication(token(), identity.apiOrigin, 7, now); });
    const source = createRenewingJourneyAuthenticationSource(async () => auth, renew);
    const results = await Promise.all([source(), source()]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(results.every(value => value.expiresAtEpochSeconds === 1600)).toBe(true);
});
it("expired recovery does not return old access if exchange fails", async () => {
    const auth = journeyRenewalCandidate(token({ exp: 999 }), identity.apiOrigin, 7, now);
    const source = createRenewingJourneyAuthenticationSource(async () => auth, async () => { throw new Error("AUTOMATIC_AUTH_REFRESH_UNAVAILABLE"); });
    await expect(source()).rejects.toThrow("AUTOMATIC_AUTH_REFRESH_UNAVAILABLE");
});
it.each([{ exp: -85400, iat: -86000 }, { type: "REFRESH", exp: 999 }, { sg: 3, exp: 989 }, { iat: Number.NaN }])("malformed or too-old renewal candidate is blocked %#", patch => {
    expect(() => journeyRenewalCandidate(token(patch), identity.apiOrigin, 7, now)).toThrow("AUTOMATIC_AUTH_REQUIRED");
});
it("concurrent expiring source reads perform one exchange and preserve identity", async () => {
    let auth = journeyAuthentication(token({ exp: 1020 }), identity.apiOrigin, 7, now);
    const renew = jest.fn(async () => { auth = journeyAuthentication(token({ exp: 1700 }), identity.apiOrigin, 7, now); });
    const source = createRenewingJourneyAuthenticationSource(async () => auth, renew);
    const replies = await Promise.all([source(), source(), source()]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(replies.every(reply => reply.expiresAtEpochSeconds === 1700)).toBe(true);
    await source(); expect(renew).toHaveBeenCalledTimes(1);
});
it("source exchange cannot cross account or login generation", async () => {
    let auth = journeyAuthentication(token({ exp: 1020 }), identity.apiOrigin, 7, now);
    const source = createRenewingJourneyAuthenticationSource(async () => auth, async () => {
        auth = journeyAuthentication(token({ sg: 3, exp: 1700 }), identity.apiOrigin, 7, now);
    });
    await expect(source()).rejects.toThrow("AUTOMATIC_AUTH_CHANGED");
});
it("offline renewal preserves original credential and does not fabricate extra lifetime", async () => {
    const auth = journeyAuthentication(token({ exp: 1020 }), identity.apiOrigin, 7, now);
    const source = createRenewingJourneyAuthenticationSource(async () => auth, async () => { throw new Error("AUTOMATIC_AUTH_REFRESH_UNAVAILABLE"); });
    await expect(source()).rejects.toThrow("AUTOMATIC_AUTH_REFRESH_UNAVAILABLE");
    expect(auth.expiresAtEpochSeconds).toBe(1020);
});
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now * 1000); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
it.each(["https://api.example.invalid", "http://127.0.0.1:15544", "http://localhost:15544"])("accepts canonical origin %s", origin => {
    expect(journeyAuthenticationOrigin(origin)).toBe(origin);
});
it("keeps physical-device authentication HTTPS-only even for loopback", () => {
    expect(journeyAuthenticationOrigin("http://127.0.0.1:5522", true)).toBeNull();
    expect(journeyAuthenticationOrigin("https://api.example.invalid", true)).toBe("https://api.example.invalid");
});
it.each(["http://127.0.0.1:15543", "http://example.invalid", "https://user:pass@example.invalid", "https://api.example.invalid/",
    "https://api.example.invalid/path", "https://api.example.invalid?q=x", "https://api.example.invalid#x", "https://api.example.invalid:443",
    "https://api.example.invalid:99999", "https://api.example.invalid\\@evil.invalid"])("rejects origin %s", origin => {
    expect(journeyAuthenticationOrigin(origin)).toBeNull();
});
it.each([{ type: "REFRESH" }, { sub: "8" }, { sg: -1 }, { sg: true }, { exp: 1000 }, { exp: 989 }, { iat: 1006 }])("rejects wrong or expired claim %#", patch => {
    expect(() => journeyAuthentication(token(patch), identity.apiOrigin, 7, now)).toThrow("AUTOMATIC_AUTH_REQUIRED");
});
it("decodes UTF-8 claims but uses only member, generation and original expiry", () => {
    expect(journeyAuthentication(token(), identity.apiOrigin, 7, now)).toEqual({ ...identity, accessToken: token(), expiresAtEpochSeconds: 1600 });
});
it("accepts generation zero used by a newly created account", () => {
    expect(journeyAuthentication(token({ sg: 0 }), identity.apiOrigin, 7, now).loginGeneration).toBe(0);
});
it("rejects account or generation switch even after a successful HTTP reply", async () => {
    const auth = journeyAuthentication(token(), identity.apiOrigin, 7, now);
    const source = jest.fn().mockResolvedValueOnce(auth).mockResolvedValueOnce({ ...auth, loginGeneration: 3 });
    const send = jest.fn().mockResolvedValue({ success: true });
    await expect(createAuthenticatedJourneyPost(source, identity, send)(path, {})).rejects.toThrow("AUTOMATIC_AUTH_CHANGED");
    expect(send).toHaveBeenCalledWith(auth, path, {});
});
it("rejects different account, invalid path and logout before a network request", async () => {
    const auth = journeyAuthentication(token(), identity.apiOrigin, 7, now);
    const fetch = jest.fn(); globalThis.fetch = fetch;
    expect(() => requireJourneyAuthenticationIdentity(auth, { ...identity, authMemberId: 8 })).toThrow("AUTOMATIC_AUTH_CHANGED");
    await expect(createAuthenticatedJourneyPost(async () => auth, identity)("https://evil.invalid", {})).rejects.toThrow("INVALID_AUTHENTICATED_JOURNEY_PATH");
    await expect(createAuthenticatedJourneyPost(async () => { throw new Error("AUTOMATIC_AUTH_REQUIRED"); }, identity)(path, {})).rejects.toThrow("AUTOMATIC_AUTH_REQUIRED");
    expect(fetch).not.toHaveBeenCalled();
});
it.each([{ ok: true, redirected: true, text: async () => '{}' }, { ok: true, url: "https://evil.invalid", text: async () => '{}' },
    { ok: true, text: async () => 'x'.repeat(65537) }, { ok: true, text: async () => '<private failure>' }])("bounds malformed and redirected JSON response %#", async response => {
    globalThis.fetch = jest.fn().mockResolvedValue(response);
    await expect(journeyJSONRequest(`${identity.apiOrigin}${path}`, {})).rejects.toThrow("INVALID_AUTOMATIC_SERVER_RESPONSE");
});
it("persists only authenticated metadata, never a supplied token", () => {
    const binding = { sessionId: "11111111-1111-4111-8111-111111111111", scheduleId: "9001", generation: 1, routeRevision: 1,
        clientOwnerId: "22222222-2222-4222-8222-222222222222", routeInputDigest: "a".repeat(64), preparedAtEpochSeconds: 1000,
        expiresAtEpochSeconds: 1600, execution: "SIMULATOR", syncScope: "AUTHENTICATED", savedRouteValidated: true, guidanceEnabled: true, ...identity };
    expect(normalizeAutomaticJourneyBinding({ ...binding, accessToken: token() })).toEqual(binding);
    expect(normalizeAutomaticJourneyBinding({ ...binding, loginGeneration: undefined })).toBeNull();
    expect(normalizeAutomaticJourneyBinding({ ...binding, apiOrigin: "http://127.0.0.1:15543" })).toBeNull();
});

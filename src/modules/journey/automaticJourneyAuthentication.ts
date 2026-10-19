import { authenticatedAutomaticJourneyRequest, automaticPositiveInteger, automaticRecord, type AutomaticJourneyBinding } from "./automaticJourney";
import { createSingleFlightRunner } from "../../api/singleFlight";

/** Ephemeral credentials. Only identity/origin metadata may enter a persisted binding. */
export type JourneyAuthentication = {
    accessToken: string; apiOrigin: string; authMemberId: number; loginGeneration: number; expiresAtEpochSeconds: number;
};
export type JourneyAuthenticationSource = (requiredUntilEpochSeconds?: number) => Promise<JourneyAuthentication>;
/** Preparation-only horizon. Never extends a JWT or authorizes background renewal. */
function navigationAuthenticationDeadline(requiredUntilEpochSeconds?: number): number | undefined {
    if (requiredUntilEpochSeconds === undefined) return undefined;
    const now = Date.now() / 1000;
    if (!Number.isFinite(requiredUntilEpochSeconds) || requiredUntilEpochSeconds <= now
        || requiredUntilEpochSeconds > now + 7205) throw new Error("AUTOMATIC_AUTH_HORIZON_INVALID");
    return requiredUntilEpochSeconds + 30;
}
export function requireJourneyAuthenticationLifetime(auth: JourneyAuthentication, requiredUntilEpochSeconds: number): void {
    const deadline = navigationAuthenticationDeadline(requiredUntilEpochSeconds)!;
    requireJourneyAuthenticationIdentity(auth, auth);
    if (auth.expiresAtEpochSeconds < deadline) throw new Error("AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT");
}
/** Isolated fixture and test adapter; production uses the shared API refresh flight below. */
export function createRenewingJourneyAuthenticationSource(read: JourneyAuthenticationSource,
    renew: (previous: JourneyAuthentication) => Promise<void>, marginSeconds = 30): JourneyAuthenticationSource {
    const flight = createSingleFlightRunner<JourneyAuthentication>();
    return async requiredUntilEpochSeconds => {
        const deadline = navigationAuthenticationDeadline(requiredUntilEpochSeconds);
        const result = await flight(async () => {
            const previous = await read();
            requireRenewalIdentity(previous, previous);
            if (previous.expiresAtEpochSeconds - Date.now() / 1000 > marginSeconds
                && (deadline === undefined || previous.expiresAtEpochSeconds >= deadline)) return previous;
            await renew(previous);
            const next = await read();
            requireJourneyAuthenticationIdentity(next, previous);
            if (next.expiresAtEpochSeconds < previous.expiresAtEpochSeconds) throw new Error("AUTOMATIC_AUTH_CHANGED");
            return next;
        });
        // A longer request may have joined an ordinary refresh flight. Never accept its
        // shorter credential merely because the exchange succeeded for another caller.
        if (requiredUntilEpochSeconds !== undefined) requireJourneyAuthenticationLifetime(result, requiredUntilEpochSeconds);
        return result;
    };
}
export const journeyLoginGeneration = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function journeyAuthenticationOrigin(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 256) return null;
    // Intentionally accept a canonical origin, not an arbitrary URL or RN's partial URL polyfill.
    const match = /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([1-9]\d{0,4}))?$/.exec(value);
    if (!match || match[3] === "15543" || match[3] && (Number(match[3]) > 65535
        || (match[1] === "https" && match[3] === "443") || (match[1] === "http" && match[3] === "80"))) return null;
    return match[1] === "https" || (__DEV__ && match[1] === "http" && ["127.0.0.1", "localhost"].includes(match[2])) ? value : null;
}
function decodeClaims(encoded: string): unknown {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bits = 0; let buffer = 0; let escaped = "";
    for (const char of encoded) {
        buffer = buffer * 64 + alphabet.indexOf(char); bits += 6;
        if (bits >= 8) {
            bits -= 8;
            const byte = Math.floor(buffer / 2 ** bits);
            escaped += `%${byte.toString(16).padStart(2, "0")}`;
            buffer %= 2 ** bits;
        }
    }
    return JSON.parse(decodeURIComponent(escaped)) as unknown;
}
/** Claim decoding is a local fence, NOT signature verification. The server authenticates every request. */
export function journeyAuthentication(token: unknown, origin: unknown, memberId: unknown, now = Date.now() / 1000): JourneyAuthentication {
    return decodeAuthentication(token, origin, memberId, now, false);
}
/** Expired ACCESS claims identify a renewal candidate only. Never pass this to native or HTTP. */
export function journeyRenewalCandidate(token: unknown, origin: unknown, memberId: unknown, now = Date.now() / 1000): JourneyAuthentication {
    return decodeAuthentication(token, origin, memberId, now, true);
}
function decodeAuthentication(token: unknown, origin: unknown, memberId: unknown, now: number, renewalOnly: boolean): JourneyAuthentication {
    const apiOrigin = journeyAuthenticationOrigin(origin);
    if (!apiOrigin || !automaticPositiveInteger(memberId) || typeof token !== "string" || token.length > 8192
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("AUTOMATIC_AUTH_REQUIRED");
    try {
        const claims = automaticRecord(decodeClaims(token.split(".")[1]));
        if (!claims || claims.type !== "ACCESS" || claims.sub !== String(memberId) || !journeyLoginGeneration(claims.sg)
            || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now - (renewalOnly ? 86400 : 0)
            || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + 5 || claims.exp <= claims.iat) throw new Error();
        return { accessToken: token, apiOrigin, authMemberId: memberId, loginGeneration: claims.sg, expiresAtEpochSeconds: claims.exp };
    } catch { throw new Error("AUTOMATIC_AUTH_REQUIRED"); }
}
function requireRenewalIdentity(auth: JourneyAuthentication, identity: Pick<JourneyAuthentication, "apiOrigin" | "authMemberId" | "loginGeneration">): void {
    const checked = journeyRenewalCandidate(auth.accessToken, auth.apiOrigin, auth.authMemberId);
    if (checked.loginGeneration !== auth.loginGeneration || checked.expiresAtEpochSeconds !== auth.expiresAtEpochSeconds
        || checked.apiOrigin !== identity.apiOrigin || checked.authMemberId !== identity.authMemberId
        || checked.loginGeneration !== identity.loginGeneration) throw new Error("AUTOMATIC_AUTH_CHANGED");
}
export function requireJourneyAuthenticationIdentity(auth: JourneyAuthentication, identity: Pick<JourneyAuthentication, "apiOrigin" | "authMemberId" | "loginGeneration">): void {
    const checked = journeyAuthentication(auth.accessToken, auth.apiOrigin, auth.authMemberId);
    if (checked.loginGeneration !== auth.loginGeneration || checked.expiresAtEpochSeconds !== auth.expiresAtEpochSeconds
        || checked.apiOrigin !== identity.apiOrigin || checked.authMemberId !== identity.authMemberId
        || checked.loginGeneration !== identity.loginGeneration) throw new Error("AUTOMATIC_AUTH_CHANGED");
}
export function createAuthenticatedJourneyPost(source: JourneyAuthenticationSource, identity: Pick<JourneyAuthentication, "apiOrigin" | "authMemberId" | "loginGeneration">,
    send: typeof authenticatedAutomaticJourneyRequest = authenticatedAutomaticJourneyRequest) {
    return async (path: string, body: Record<string, unknown>): Promise<unknown> => {
        if (!__DEV__ || !/^\/api\/schedules\/[1-9]\d{0,17}\/automatic-journey\/(?:prepare-saved|[a-f0-9-]{36}\/(?:departure|validate|stop|reconcile))$/.test(path)) {
            throw new Error("INVALID_AUTHENTICATED_JOURNEY_PATH");
        }
        const auth = await source(); requireJourneyAuthenticationIdentity(auth, identity);
        // React Native fetch does not guarantee redirect:error on every platform. Authenticated
        // requests use the same ephemeral, redirect-blocking native client as background polling.
        const result = await send(auth, path, body);
        // Account switches and logout fence even an otherwise successful late response.
        requireJourneyAuthenticationIdentity(await source(), identity);
        return result;
    };
}
export async function currentJourneyAuthentication(requiredUntilEpochSeconds?: number): Promise<JourneyAuthentication> {
    const deadline = navigationAuthenticationDeadline(requiredUntilEpochSeconds);
    const { getAccessToken, getAuthMember, getAuthCredentialRevision } = require("../auth/authStorage") as typeof import("../auth/authStorage");
    const { API_BASE_URL, refreshCurrentAuthTokens } = require("../../api/api") as typeof import("../../api/api");
    const revision = getAuthCredentialRevision();
    const [token, member] = await Promise.all([getAccessToken(), getAuthMember()]);
    if (revision !== getAuthCredentialRevision()) throw new Error("AUTOMATIC_AUTH_CHANGED");
    const initial = journeyRenewalCandidate(token, API_BASE_URL, member?.id);
    // Foreground/cold recovery only. An expired candidate cannot reach native or session validation.
    if (initial.expiresAtEpochSeconds - Date.now() / 1000 > 30
        && (deadline === undefined || initial.expiresAtEpochSeconds >= deadline)) return initial;
    const result = await refreshCurrentAuthTokens();
    if (revision !== getAuthCredentialRevision()) throw new Error("AUTOMATIC_AUTH_CHANGED");
    if (result.kind === "invalid") throw new Error("AUTOMATIC_AUTH_REQUIRED");
    if (result.kind === "superseded") throw new Error("AUTOMATIC_AUTH_CHANGED");
    if (result.kind === "unavailable") throw new Error("AUTOMATIC_AUTH_REFRESH_UNAVAILABLE");
    const [latest, latestMember] = await Promise.all([getAccessToken(), getAuthMember()]);
    if (revision !== getAuthCredentialRevision()) throw new Error("AUTOMATIC_AUTH_CHANGED");
    const renewed = journeyAuthentication(latest, API_BASE_URL, latestMember?.id);
    requireJourneyAuthenticationIdentity(renewed, initial);
    if (renewed.expiresAtEpochSeconds < initial.expiresAtEpochSeconds) throw new Error("AUTOMATIC_AUTH_CHANGED");
    if (requiredUntilEpochSeconds !== undefined) requireJourneyAuthenticationLifetime(renewed, requiredUntilEpochSeconds);
    return renewed;
}
export const authenticationMetadata = (auth: JourneyAuthentication): Required<Pick<AutomaticJourneyBinding, "apiOrigin" | "authMemberId" | "loginGeneration">> => ({
    apiOrigin: auth.apiOrigin, authMemberId: auth.authMemberId, loginGeneration: auth.loginGeneration,
});

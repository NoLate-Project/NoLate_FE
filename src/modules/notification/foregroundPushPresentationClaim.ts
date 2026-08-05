import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import { getAuthMember } from "../auth/authStorage";
import { isNotificationEtaEventFresh } from "./notificationEventExpiry";

const STORAGE_KEY_PREFIX = "nolate_foreground_push_presentation_claims_v1:";
const SCHEMA_VERSION = 1;
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const PENDING_LEASE_MS = 60 * 1_000;
const MAX_CLAIMS_PER_ACCOUNT = 256;
const LOGICAL_EVENT_KEY_PATTERN = /^(?:key:[0-9a-f]{64}|event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const PROVIDER_MESSAGE_ID_PATTERN = /^[\x21-\x7e]{1,256}$/;

type PresentationClaimState = "PENDING" | "COMMITTED";

type PresentationClaimEntry = {
    identityHash: string;
    notificationIdentifier: string;
    state: PresentationClaimState;
    updatedAt: number;
    expiresAt: number;
};

type PresentationClaimEnvelope = {
    version: typeof SCHEMA_VERSION;
    entries: PresentationClaimEntry[];
};

type ResolvedPresentationIdentity = {
    memberId: number;
    identityHash: string;
    notificationIdentifier: string;
    lifecycleGeneration: number;
};

type AcquiredPresentationClaim = ResolvedPresentationIdentity & {
    acquiredAt: number;
    durable: boolean;
};

export type ForegroundPushPresentationResult =
    | "presented"
    | "duplicate"
    | "rejected";

let storageTail: Promise<void> = Promise.resolve();
let accountLifecycleGeneration = 0;
const blockedAccountIds = new Set<number>();
const presentationFlights = new Map<string, Promise<ForegroundPushPresentationResult>>();

function storageKey(memberId: number): string {
    return `${STORAGE_KEY_PREFIX}${memberId}`;
}

function normalizeMemberId(value: unknown): number | undefined {
    const numberValue = typeof value === "number"
        ? value
        : typeof value === "string" && /^[1-9]\d*$/.test(value)
            ? Number(value)
            : undefined;
    return Number.isSafeInteger(numberValue) && (numberValue ?? 0) > 0
        ? numberValue
        : undefined;
}

function normalizeLogicalEventKey(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return LOGICAL_EVENT_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeProviderMessageId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return PROVIDER_MESSAGE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

async function sha256(value: string): Promise<string> {
    return Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        value,
        { encoding: Crypto.CryptoEncoding.HEX },
    );
}

async function resolveIdentity(
    data: Record<string, unknown> | undefined,
    providerMessageId: string | undefined,
    nowMilliseconds: number,
): Promise<ResolvedPresentationIdentity | undefined> {
    if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) return undefined;
    if (!isNotificationEtaEventFresh(data, nowMilliseconds)) return undefined;

    const lifecycleGeneration = accountLifecycleGeneration;
    const authenticatedMemberId = normalizeMemberId((await getAuthMember())?.id);
    if (!authenticatedMemberId || blockedAccountIds.has(authenticatedMemberId)) return undefined;

    const payloadRecipientPresent = data && "recipientMemberId" in data;
    const payloadRecipientId = normalizeMemberId(data?.recipientMemberId);
    if (payloadRecipientPresent && payloadRecipientId !== authenticatedMemberId) return undefined;

    const logicalEventKey = normalizeLogicalEventKey(data?.logicalEventKey);
    const canonicalIdentity = payloadRecipientId === authenticatedMemberId && logicalEventKey
        ? `logical\u0000${authenticatedMemberId}\u0000${logicalEventKey}`
        : undefined;
    const legacyProviderMessageId = normalizeProviderMessageId(providerMessageId);
    const identity = canonicalIdentity ?? (
        !payloadRecipientPresent && legacyProviderMessageId
            ? `legacy-provider\u0000${authenticatedMemberId}\u0000${legacyProviderMessageId}`
            : undefined
    );
    if (!identity) return undefined;

    const identityHash = await sha256(identity);
    if (
        lifecycleGeneration !== accountLifecycleGeneration ||
        blockedAccountIds.has(authenticatedMemberId) ||
        normalizeMemberId((await getAuthMember())?.id) !== authenticatedMemberId
    ) return undefined;

    return {
        memberId: authenticatedMemberId,
        identityHash,
        notificationIdentifier: `nolate-visible-${identityHash}`,
        lifecycleGeneration,
    };
}

function isClaimEntry(value: unknown): value is PresentationClaimEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Partial<PresentationClaimEntry>;
    return (
        typeof candidate.identityHash === "string" && /^[0-9a-f]{64}$/.test(candidate.identityHash) &&
        candidate.notificationIdentifier === `nolate-visible-${candidate.identityHash}` &&
        (candidate.state === "PENDING" || candidate.state === "COMMITTED") &&
        Number.isSafeInteger(candidate.updatedAt) && (candidate.updatedAt ?? -1) >= 0 &&
        Number.isSafeInteger(candidate.expiresAt) &&
        (candidate.expiresAt ?? 0) > (candidate.updatedAt ?? 0)
    );
}

function parseEnvelope(raw: string | null): PresentationClaimEnvelope {
    if (!raw) return { version: SCHEMA_VERSION, entries: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Foreground presentation claim envelope is invalid.");
    }
    const candidate = parsed as Partial<PresentationClaimEnvelope>;
    if (candidate.version !== SCHEMA_VERSION || !Array.isArray(candidate.entries)) {
        throw new Error("Foreground presentation claim envelope version is invalid.");
    }
    if (!candidate.entries.every(isClaimEntry)) {
        throw new Error("Foreground presentation claim entry is invalid.");
    }
    return { version: SCHEMA_VERSION, entries: candidate.entries };
}

function boundedEntries(
    entries: PresentationClaimEntry[],
    nowMilliseconds: number,
): PresentationClaimEntry[] {
    const latestByIdentity = new Map<string, PresentationClaimEntry>();
    for (const entry of entries) {
        if (entry.expiresAt <= nowMilliseconds) continue;
        const current = latestByIdentity.get(entry.identityHash);
        if (!current || current.updatedAt < entry.updatedAt) {
            latestByIdentity.set(entry.identityHash, entry);
        }
    }
    return [...latestByIdentity.values()]
        .sort((left, right) => left.updatedAt - right.updatedAt)
        .slice(-MAX_CLAIMS_PER_ACCOUNT);
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = storageTail.then(operation, operation);
    storageTail = result.then(() => undefined, () => undefined);
    return result;
}

async function acquireClaim(
    identity: ResolvedPresentationIdentity,
    nowMilliseconds: number,
): Promise<AcquiredPresentationClaim | "duplicate" | "rejected"> {
    if (
        identity.lifecycleGeneration !== accountLifecycleGeneration ||
        blockedAccountIds.has(identity.memberId)
    ) return "rejected";

    return serialize(async () => {
        if (
            identity.lifecycleGeneration !== accountLifecycleGeneration ||
            blockedAccountIds.has(identity.memberId)
        ) return "rejected";
        try {
            const key = storageKey(identity.memberId);
            const envelope = parseEnvelope(await AsyncStorage.getItem(key));
            const entries = boundedEntries(envelope.entries, nowMilliseconds);
            const existing = entries.find((entry) => entry.identityHash === identity.identityHash);
            if (
                existing?.state === "COMMITTED" ||
                (existing?.state === "PENDING" &&
                    nowMilliseconds - existing.updatedAt < PENDING_LEASE_MS)
            ) {
                return "duplicate";
            }

            const pending: PresentationClaimEntry = {
                identityHash: identity.identityHash,
                notificationIdentifier: identity.notificationIdentifier,
                state: "PENDING",
                updatedAt: nowMilliseconds,
                expiresAt: nowMilliseconds + CLAIM_TTL_MS,
            };
            const nextEntries = boundedEntries(
                entries.filter((entry) => entry.identityHash !== identity.identityHash).concat(pending),
                nowMilliseconds,
            );
            await AsyncStorage.setItem(key, JSON.stringify({
                version: SCHEMA_VERSION,
                entries: nextEntries,
            } satisfies PresentationClaimEnvelope));
            return {
                ...identity,
                acquiredAt: nowMilliseconds,
                durable: true,
            };
        } catch {
            // A verified, fresh safety notification fails open when local claim storage is
            // unavailable. The stable OS identifier and in-process flight still reduce repeats.
            return {
                ...identity,
                acquiredAt: nowMilliseconds,
                durable: false,
            };
        }
    });
}

async function mutateOwnedPendingClaim(
    claim: AcquiredPresentationClaim,
    mutation: "COMMIT" | "ROLLBACK",
): Promise<void> {
    if (!claim.durable) return;
    await serialize(async () => {
        const key = storageKey(claim.memberId);
        const envelope = parseEnvelope(await AsyncStorage.getItem(key));
        const current = envelope.entries.find((entry) =>
            entry.identityHash === claim.identityHash &&
            entry.state === "PENDING" &&
            entry.updatedAt === claim.acquiredAt
        );
        if (!current) return;
        const entries = mutation === "COMMIT"
            ? envelope.entries.map((entry) => entry === current
                ? { ...entry, state: "COMMITTED" as const }
                : entry)
            : envelope.entries.filter((entry) => entry !== current);
        await AsyncStorage.setItem(key, JSON.stringify({
            version: SCHEMA_VERSION,
            entries,
        } satisfies PresentationClaimEnvelope));
    });
}

async function accountStillOwnsClaim(claim: AcquiredPresentationClaim): Promise<boolean> {
    return (
        claim.lifecycleGeneration === accountLifecycleGeneration &&
        !blockedAccountIds.has(claim.memberId) &&
        normalizeMemberId((await getAuthMember())?.id) === claim.memberId
    );
}

async function executePresentation(
    identity: ResolvedPresentationIdentity,
    nowMilliseconds: number,
    present: (notificationIdentifier: string) => Promise<boolean>,
): Promise<ForegroundPushPresentationResult> {
    const claim = await acquireClaim(identity, nowMilliseconds);
    if (claim === "duplicate" || claim === "rejected") return claim;
    if (!(await accountStillOwnsClaim(claim))) {
        await mutateOwnedPendingClaim(claim, "ROLLBACK").catch(() => undefined);
        return "rejected";
    }

    try {
        const accepted = await present(claim.notificationIdentifier);
        if (!accepted) {
            await mutateOwnedPendingClaim(claim, "ROLLBACK").catch(() => undefined);
            return "rejected";
        }
    } catch (error) {
        await mutateOwnedPendingClaim(claim, "ROLLBACK").catch(() => undefined);
        throw error;
    }
    // The OS accepted the request, so report presentation evidence even if COMMITTED persistence
    // fails. A stale PENDING replay reuses the same opaque OS identifier.
    await mutateOwnedPendingClaim(claim, "COMMIT").catch(() => undefined);
    return "presented";
}

export async function presentForegroundPushOnce(
    data: Record<string, unknown> | undefined,
    providerMessageId: string | undefined,
    present: (notificationIdentifier: string) => Promise<boolean>,
    nowMilliseconds = Date.now(),
): Promise<ForegroundPushPresentationResult> {
    const identity = await resolveIdentity(data, providerMessageId, nowMilliseconds);
    if (!identity) return "rejected";
    const flightKey = `${identity.memberId}:${identity.identityHash}`;
    const existing = presentationFlights.get(flightKey);
    if (existing) {
        try {
            const result = await existing;
            return result === "presented" ? "duplicate" : result;
        } catch {
            // The winner rolled its claim back after an explicit OS scheduling failure. Let this
            // redelivery become the retry rather than dropping both concurrent callbacks.
        }
    }

    const request = executePresentation(identity, nowMilliseconds, present).finally(() => {
        if (presentationFlights.get(flightKey) === request) {
            presentationFlights.delete(flightKey);
        }
    });
    presentationFlights.set(flightKey, request);
    return request;
}

export async function activateForegroundPushPresentationClaimsForAuthenticatedMember(): Promise<boolean> {
    const activationGeneration = accountLifecycleGeneration;
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!memberId || activationGeneration !== accountLifecycleGeneration) return false;
    blockedAccountIds.delete(memberId);
    return true;
}

export async function clearForegroundPushPresentationClaimsForCurrentAccount(): Promise<void> {
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!memberId) return;
    accountLifecycleGeneration += 1;
    blockedAccountIds.add(memberId);
    const prefix = `${memberId}:`;
    await Promise.allSettled(
        [...presentationFlights.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([, flight]) => flight),
    );
    await serialize(() => AsyncStorage.removeItem(storageKey(memberId)));
}

export function resetForegroundPushPresentationClaimsForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    storageTail = Promise.resolve();
    accountLifecycleGeneration = 0;
    blockedAccountIds.clear();
    presentationFlights.clear();
}

export const FOREGROUND_PUSH_PRESENTATION_CLAIM_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        storageKeyForMember: storageKey,
        claimTtlMs: CLAIM_TTL_MS,
        pendingLeaseMs: PENDING_LEASE_MS,
        maximumSize: MAX_CLAIMS_PER_ACCOUNT,
    }
    : undefined;

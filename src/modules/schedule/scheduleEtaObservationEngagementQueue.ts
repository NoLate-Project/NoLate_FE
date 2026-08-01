import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    recordScheduleEtaObservationEngagement,
    type ScheduleEtaObservationEngagementCapture,
    type ScheduleEtaObservationEngagementEvent,
} from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import { isDepartureAlarmAccountCleanupPending } from "../notification/departureAlarmSync";

const STORAGE_KEY_PREFIX = "nolate_schedule_eta_engagement_queue_v1:";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES_PER_ACCOUNT = 200;
const ENTRY_TTL_MS = 24 * 60 * 60 * 1_000;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

type EngagementEntry = ScheduleEtaObservationEngagementCapture & {
    scheduleId: string;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

type EngagementEnvelope = {
    version: number;
    entries: EngagementEntry[];
};

export type DurableEngagementResult = "sent" | "queued" | "rejected";

let storageTail: Promise<void> = Promise.resolve();
let accountLifecycleGeneration = 0;
const blockedAccountIds = new Set<number>();
const inFlightAttempts = new Map<string, Promise<DurableEngagementResult>>();
const inFlightDrains = new Map<number, Promise<number>>();
let activeMemberId: number | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function cancelRetryTimer(): void {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
}

function normalizeMemberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

function normalizeScheduleId(value: unknown): string | undefined {
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return undefined;
    const normalized = value.trim().replace(/^0+(?=\d)/, "");
    return normalized !== "0" ? normalized : undefined;
}

function normalizeEvent(value: unknown): ScheduleEtaObservationEngagementEvent | undefined {
    return value === "EXPOSED" || value === "PROMPT_OPENED" ? value : undefined;
}

function normalizeOptionalCohortValue(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return /^[A-Za-z0-9._+-]{1,64}$/.test(normalized) ? normalized : undefined;
}

function storageKey(memberId: number): string {
    return `${STORAGE_KEY_PREFIX}${memberId}`;
}

function entryKey(scheduleId: string, event: ScheduleEtaObservationEngagementEvent): string {
    return `${scheduleId}\u0000${event}`;
}

function parseEntry(value: unknown, now: number): EngagementEntry | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<EngagementEntry>;
    const scheduleId = normalizeScheduleId(candidate.scheduleId);
    const event = normalizeEvent(candidate.event);
    if (
        !scheduleId ||
        !event ||
        !Number.isSafeInteger(candidate.attemptCount) ||
        (candidate.attemptCount ?? -1) < 0 ||
        typeof candidate.nextAttemptAt !== "number" ||
        !Number.isFinite(candidate.nextAttemptAt) ||
        typeof candidate.enqueuedAt !== "number" ||
        !Number.isFinite(candidate.enqueuedAt) ||
        candidate.enqueuedAt + ENTRY_TTL_MS <= now
    ) return undefined;

    const clientAppVersion = normalizeOptionalCohortValue(candidate.clientAppVersion);
    const clientBuildVersion = normalizeOptionalCohortValue(candidate.clientBuildVersion);
    const uxVariant = normalizeOptionalCohortValue(candidate.uxVariant);
    return {
        scheduleId,
        event,
        ...(clientAppVersion ? { clientAppVersion } : {}),
        ...(clientBuildVersion ? { clientBuildVersion } : {}),
        ...(uxVariant ? { uxVariant } : {}),
        attemptCount: candidate.attemptCount as number,
        nextAttemptAt: candidate.nextAttemptAt,
        enqueuedAt: candidate.enqueuedAt,
    };
}

function parseEnvelope(raw: string | null, now = Date.now()): EngagementEntry[] {
    if (!raw) return [];
    try {
        const envelope = JSON.parse(raw) as Partial<EngagementEnvelope>;
        if (envelope.version !== SCHEMA_VERSION || !Array.isArray(envelope.entries)) return [];
        const uniqueEntries = new Map<string, EngagementEntry>();
        envelope.entries.forEach((candidate) => {
            const entry = parseEntry(candidate, now);
            if (entry && !uniqueEntries.has(entryKey(entry.scheduleId, entry.event))) {
                uniqueEntries.set(entryKey(entry.scheduleId, entry.event), entry);
            }
        });
        return Array.from(uniqueEntries.values())
            .sort((left, right) => left.enqueuedAt - right.enqueuedAt)
            .slice(-MAX_ENTRIES_PER_ACCOUNT);
    } catch {
        return [];
    }
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = storageTail.then(operation, operation);
    storageTail = result.then(() => undefined, () => undefined);
    return result;
}

async function writeUnlocked(memberId: number, entries: EngagementEntry[]): Promise<void> {
    const now = Date.now();
    const retained = entries
        .filter((entry) => entry.enqueuedAt + ENTRY_TTL_MS > now)
        .slice(-MAX_ENTRIES_PER_ACCOUNT);
    if (retained.length === 0) {
        await AsyncStorage.removeItem(storageKey(memberId));
        return;
    }
    await AsyncStorage.setItem(
        storageKey(memberId),
        JSON.stringify({ version: SCHEMA_VERSION, entries: retained } satisfies EngagementEnvelope),
    );
}

async function readUnlocked(memberId: number): Promise<EngagementEntry[]> {
    const raw = await AsyncStorage.getItem(storageKey(memberId));
    const entries = parseEnvelope(raw).filter(
        (entry) => entry.enqueuedAt + ENTRY_TTL_MS > Date.now(),
    );
    // Rewrite every existing envelope to physically purge expired/corrupt entries and bound data.
    if (raw !== null) await writeUnlocked(memberId, entries);
    return entries;
}

function retryDelay(attemptCount: number): number {
    return RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

function isPermanentRejection(error: unknown): boolean {
    if (!(error instanceof ApiResponseError)) return false;
    return error.status === 400 ||
        error.status === 403 ||
        error.status === 404 ||
        error.status === 410 ||
        error.status === 422;
}

async function enqueue(
    memberId: number,
    scheduleId: string,
    capture: ScheduleEtaObservationEngagementCapture,
): Promise<EngagementEntry | undefined> {
    return serialize(async () => {
        if (blockedAccountIds.has(memberId)) return undefined;
        const entries = await readUnlocked(memberId);
        const key = entryKey(scheduleId, capture.event);
        const existing = entries.find((entry) => entryKey(entry.scheduleId, entry.event) === key);
        if (existing) return existing;
        const now = Date.now();
        const entry: EngagementEntry = {
            scheduleId,
            ...capture,
            attemptCount: 0,
            nextAttemptAt: now,
            enqueuedAt: now,
        };
        entries.push(entry);
        await writeUnlocked(memberId, entries);
        return entry;
    });
}

function attempt(
    memberId: number,
    scheduleId: string,
    event: ScheduleEtaObservationEngagementEvent,
): Promise<DurableEngagementResult> {
    const key = `${memberId}\u0000${entryKey(scheduleId, event)}`;
    const existingAttempt = inFlightAttempts.get(key);
    if (existingAttempt) return existingAttempt;

    const request = (async (): Promise<DurableEngagementResult> => {
        const entry = await serialize(async () => {
            if (blockedAccountIds.has(memberId)) return undefined;
            return (await readUnlocked(memberId)).find(
                (candidate) => candidate.scheduleId === scheduleId && candidate.event === event,
            );
        });
        if (!entry || blockedAccountIds.has(memberId)) return "rejected";
        if (entry.nextAttemptAt > Date.now()) return "queued";
        if (event === "PROMPT_OPENED") {
            const blockedByExposure = await serialize(async () => {
                const entries = await readUnlocked(memberId);
                const exposure = entries.find((candidate) =>
                    candidate.scheduleId === scheduleId && candidate.event === "EXPOSED"
                );
                if (!exposure) return false;
                const prompt = entries.find((candidate) =>
                    candidate.scheduleId === scheduleId && candidate.event === "PROMPT_OPENED"
                );
                if (prompt) {
                    prompt.nextAttemptAt = Math.max(prompt.nextAttemptAt, exposure.nextAttemptAt);
                    await writeUnlocked(memberId, entries);
                }
                return true;
            });
            if (blockedByExposure) return "queued";
        }

        try {
            await recordScheduleEtaObservationEngagement(entry.scheduleId, {
                event: entry.event,
                ...(entry.clientAppVersion ? { clientAppVersion: entry.clientAppVersion } : {}),
                ...(entry.clientBuildVersion ? { clientBuildVersion: entry.clientBuildVersion } : {}),
                ...(entry.uxVariant ? { uxVariant: entry.uxVariant } : {}),
            });
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                await writeUnlocked(
                    memberId,
                    entries.filter((candidate) =>
                        candidate.scheduleId !== scheduleId || candidate.event !== event
                    ),
                );
            });
            return "sent";
        } catch (error) {
            if (isPermanentRejection(error)) {
                await serialize(async () => {
                    const entries = await readUnlocked(memberId);
                    await writeUnlocked(
                        memberId,
                        entries.filter((candidate) =>
                            candidate.scheduleId !== scheduleId || candidate.event !== event
                        ),
                    );
                });
                return "rejected";
            }
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                if (blockedAccountIds.has(memberId)) {
                    await writeUnlocked(
                        memberId,
                        entries.filter((candidate) =>
                            candidate.scheduleId !== scheduleId || candidate.event !== event
                        ),
                    );
                    return;
                }
                const current = entries.find(
                    (candidate) => candidate.scheduleId === scheduleId && candidate.event === event,
                );
                if (!current) return;
                current.attemptCount += 1;
                current.nextAttemptAt = Date.now() + retryDelay(current.attemptCount);
                await writeUnlocked(memberId, entries);
            });
            return "queued";
        }
    })().finally(() => {
        if (inFlightAttempts.get(key) === request) inFlightAttempts.delete(key);
    });
    inFlightAttempts.set(key, request);
    return request;
}

async function drain(memberId: number): Promise<number> {
    if (blockedAccountIds.has(memberId)) return 0;
    const due = await serialize(async () => {
        const now = Date.now();
        return (await readUnlocked(memberId))
            .filter((entry) => entry.nextAttemptAt <= now)
            .map((entry) => ({ scheduleId: entry.scheduleId, event: entry.event }));
    });
    let sentCount = 0;
    // Preserve enqueue order so EXPOSED freezes its own cohort before PROMPT_OPENED can imply it.
    for (const entry of due) {
        if (await attempt(memberId, entry.scheduleId, entry.event) === "sent") sentCount += 1;
    }
    return sentCount;
}

async function scheduleEarliestRetry(memberId: number): Promise<void> {
    const generation = accountLifecycleGeneration;
    const nextAttemptAt = await serialize(async () => {
        const entries = await readUnlocked(memberId);
        return entries.length > 0 ? Math.min(...entries.map((entry) => entry.nextAttemptAt)) : undefined;
    });
    if (
        generation !== accountLifecycleGeneration ||
        memberId !== activeMemberId ||
        blockedAccountIds.has(memberId)
    ) return;
    cancelRetryTimer();
    if (nextAttemptAt === undefined) return;
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (memberId !== activeMemberId || blockedAccountIds.has(memberId)) return;
        activateScheduleEtaObservationEngagementQueueForAuthenticatedMember().catch(() => undefined);
    }, Math.max(0, nextAttemptAt - Date.now()));
}

/** Persists the first denominator event before attempting the idempotent API request. */
export async function recordScheduleEtaObservationEngagementDurably(
    scheduleIdInput: string,
    captureInput: ScheduleEtaObservationEngagementCapture,
): Promise<DurableEngagementResult> {
    if (await isDepartureAlarmAccountCleanupPending()) return "rejected";
    const scheduleId = normalizeScheduleId(scheduleIdInput);
    const event = normalizeEvent(captureInput?.event);
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!scheduleId || !event || !memberId || blockedAccountIds.has(memberId)) return "rejected";
    const clientAppVersion = normalizeOptionalCohortValue(captureInput.clientAppVersion);
    const clientBuildVersion = normalizeOptionalCohortValue(captureInput.clientBuildVersion);
    const uxVariant = normalizeOptionalCohortValue(captureInput.uxVariant);
    const capture: ScheduleEtaObservationEngagementCapture = {
        event,
        ...(clientAppVersion ? { clientAppVersion } : {}),
        ...(clientBuildVersion ? { clientBuildVersion } : {}),
        ...(uxVariant ? { uxVariant } : {}),
    };

    try {
        if (activeMemberId !== memberId) {
            cancelRetryTimer();
            activeMemberId = memberId;
        }
        // Opening the prompt proves exposure. Ensure an EXPOSED event exists first even if a
        // visibility callback was lost during a process transition.
        if (event === "PROMPT_OPENED") {
            const exposure = await enqueue(memberId, scheduleId, { ...capture, event: "EXPOSED" });
            if (!exposure) return "rejected";
            const exposureResult = await attempt(memberId, scheduleId, "EXPOSED");
            if (exposureResult === "queued") {
                await enqueue(memberId, scheduleId, capture);
                await scheduleEarliestRetry(memberId).catch(() => undefined);
                return "queued";
            }
            if (exposureResult === "rejected") return "rejected";
        }
        const entry = await enqueue(memberId, scheduleId, capture);
        if (!entry) return "rejected";
        const result = await attempt(memberId, scheduleId, event);
        await scheduleEarliestRetry(memberId).catch(() => undefined);
        return result;
    } catch {
        return "rejected";
    }
}

/** Cold-start, login and foreground replay hook. */
export async function activateScheduleEtaObservationEngagementQueueForAuthenticatedMember(): Promise<number> {
    const generation = accountLifecycleGeneration;
    if (await isDepartureAlarmAccountCleanupPending()) return 0;
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (
        !memberId ||
        generation !== accountLifecycleGeneration ||
        await isDepartureAlarmAccountCleanupPending()
    ) return 0;
    blockedAccountIds.delete(memberId);
    if (activeMemberId !== memberId) {
        cancelRetryTimer();
        activeMemberId = memberId;
    }
    const existing = inFlightDrains.get(memberId);
    if (existing) return existing;
    const request = (async () => {
        const sentCount = await drain(memberId);
        await scheduleEarliestRetry(memberId).catch(() => undefined);
        return sentCount;
    })().finally(() => {
        if (inFlightDrains.get(memberId) === request) inFlightDrains.delete(memberId);
    });
    inFlightDrains.set(memberId, request);
    return request;
}

/** Runs before authentication is cleared, preventing another account from replaying this cohort. */
export async function clearScheduleEtaObservationEngagementQueueForCurrentAccount(): Promise<void> {
    let persistedMemberId: number | undefined;
    try {
        persistedMemberId = normalizeMemberId((await getAuthMember())?.id);
    } catch {
        // Preserve logout cleanup even when the encrypted member cache fails after activation.
    }
    const memberId = persistedMemberId ?? activeMemberId;
    if (!memberId) return;
    accountLifecycleGeneration += 1;
    blockedAccountIds.add(memberId);
    if (activeMemberId === memberId) {
        cancelRetryTimer();
        activeMemberId = undefined;
    }
    await serialize(() => AsyncStorage.removeItem(storageKey(memberId)));
}

export function resetScheduleEtaObservationEngagementQueueForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    storageTail = Promise.resolve();
    accountLifecycleGeneration = 0;
    blockedAccountIds.clear();
    inFlightAttempts.clear();
    inFlightDrains.clear();
    cancelRetryTimer();
    activeMemberId = undefined;
}

export const SCHEDULE_ETA_ENGAGEMENT_QUEUE_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        storageKeyForMember: storageKey,
        maximumSize: MAX_ENTRIES_PER_ACCOUNT,
        entryTtlMs: ENTRY_TTL_MS,
        retryDelaysMs: RETRY_DELAYS_MS,
        schemaVersion: SCHEMA_VERSION,
    }
    : undefined;

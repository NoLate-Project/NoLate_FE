import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    recordScheduleArrivalObservation,
    type ScheduleArrivalObservationCapture,
    type ScheduleArrivalObservationSource,
} from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import { isDepartureAlarmAccountCleanupPending } from "../notification/departureAlarmSync";

const STORAGE_KEY_PREFIX = "nolate_schedule_arrival_observation_queue_v1:";
const SCHEMA_VERSION = 4;
const COHORT_SCHEMA_VERSION = 3;
const SOURCE_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const MAX_ENTRIES_PER_ACCOUNT = 100;
const ENTRY_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_PRECISION_SECONDS = 3_600;
const MIN_ADJUSTMENT_SECONDS = 60;
const MAX_ADJUSTMENT_SECONDS = 60 * 60;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const USER_NOW_PRECISION_SECONDS = 30;

type ArrivalEntry = {
    scheduleId: string;
    arrivedAt: ScheduleArrivalObservationCapture["arrivedAt"];
    observationSource: ScheduleArrivalObservationSource;
    precisionSeconds: number;
    adjustmentSeconds?: number;
    clientAppVersion?: string;
    clientBuildVersion?: string;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

type ArrivalEnvelope = {
    version: number;
    entries: ArrivalEntry[];
};

export type DurableArrivalResult = "sent" | "queued" | "rejected";

let storageTail: Promise<void> = Promise.resolve();
let accountLifecycleGeneration = 0;
const blockedAccountIds = new Set<number>();
const inFlightAttempts = new Map<string, Promise<DurableArrivalResult>>();
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

function normalizeIsoInstant(value: unknown): string | undefined {
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function normalizeObservationSource(value: unknown): ScheduleArrivalObservationSource | undefined {
    return value === "USER_NOW" || value === "USER_ADJUSTED" || value === "GEOFENCE"
        ? value
        : undefined;
}

function normalizePrecisionSeconds(value: unknown): number | undefined {
    return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 1 &&
        value <= MAX_PRECISION_SECONDS
        ? value
        : undefined;
}

function normalizeOptionalCohortValue(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return /^[A-Za-z0-9._+-]{1,64}$/.test(normalized) ? normalized : undefined;
}

function normalizeAdjustmentSeconds(
    value: unknown,
    source: ScheduleArrivalObservationSource,
    precisionSeconds: number,
): number | undefined | null {
    if (source !== "USER_ADJUSTED") return value === undefined ? undefined : null;
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < MIN_ADJUSTMENT_SECONDS ||
        value > MAX_ADJUSTMENT_SECONDS ||
        value % 60 !== 0 ||
        precisionSeconds < 60
    ) return null;
    return value;
}

function storageKey(memberId: number): string {
    return `${STORAGE_KEY_PREFIX}${memberId}`;
}

function parseEntry(value: unknown, legacy: boolean, now: number): ArrivalEntry | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<ArrivalEntry>;
    const scheduleId = normalizeScheduleId(candidate.scheduleId);
    const arrivedAt = normalizeIsoInstant(candidate.arrivedAt);
    // Version 1 was produced only by the explicit "record now" action. Preserve those offline
    // reports with the same conservative source/precision instead of silently dropping them.
    const observationSource = legacy
        ? "USER_NOW"
        : normalizeObservationSource(candidate.observationSource);
    const precisionSeconds = legacy
        ? USER_NOW_PRECISION_SECONDS
        : normalizePrecisionSeconds(candidate.precisionSeconds);
    const adjustmentSeconds = observationSource && precisionSeconds
        ? normalizeAdjustmentSeconds(
            candidate.adjustmentSeconds,
            observationSource,
            precisionSeconds,
        )
        : null;
    const clientAppVersion = normalizeOptionalCohortValue(candidate.clientAppVersion);
    const clientBuildVersion = normalizeOptionalCohortValue(candidate.clientBuildVersion);
    if (
        !scheduleId ||
        !arrivedAt ||
        !observationSource ||
        !precisionSeconds ||
        adjustmentSeconds === null ||
        !Number.isSafeInteger(candidate.attemptCount) ||
        (candidate.attemptCount ?? -1) < 0 ||
        typeof candidate.nextAttemptAt !== "number" ||
        !Number.isFinite(candidate.nextAttemptAt) ||
        typeof candidate.enqueuedAt !== "number" ||
        !Number.isFinite(candidate.enqueuedAt) ||
        candidate.enqueuedAt + ENTRY_TTL_MS <= now
    ) return undefined;

    return {
        scheduleId,
        arrivedAt,
        observationSource,
        precisionSeconds,
        ...(adjustmentSeconds === undefined ? {} : { adjustmentSeconds }),
        ...(clientAppVersion === undefined ? {} : { clientAppVersion }),
        ...(clientBuildVersion === undefined ? {} : { clientBuildVersion }),
        attemptCount: candidate.attemptCount as number,
        nextAttemptAt: candidate.nextAttemptAt,
        enqueuedAt: candidate.enqueuedAt,
    };
}

function parseEnvelope(raw: string | null, now = Date.now()): ArrivalEntry[] {
    if (!raw) return [];
    try {
        const envelope = JSON.parse(raw) as Partial<ArrivalEnvelope>;
        if (
            envelope.version !== SCHEMA_VERSION &&
            envelope.version !== COHORT_SCHEMA_VERSION &&
            envelope.version !== SOURCE_SCHEMA_VERSION &&
            envelope.version !== LEGACY_SCHEMA_VERSION
        ) return [];
        if (!Array.isArray(envelope.entries)) return [];
        const legacy = envelope.version === LEGACY_SCHEMA_VERSION;
        const uniqueBySchedule = new Map<string, ArrivalEntry>();
        envelope.entries.forEach((candidate) => {
            const entry = parseEntry(candidate, legacy, now);
            // The first callback time is immutable, including across process restarts.
            if (entry && !uniqueBySchedule.has(entry.scheduleId)) {
                uniqueBySchedule.set(entry.scheduleId, entry);
            }
        });
        return Array.from(uniqueBySchedule.values())
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

async function readUnlocked(memberId: number): Promise<ArrivalEntry[]> {
    const raw = await AsyncStorage.getItem(storageKey(memberId));
    const entries = parseEnvelope(raw).filter(
        (entry) => entry.enqueuedAt + ENTRY_TTL_MS > Date.now(),
    );
    // Exact arrival is the only sensitive event time required for offline replay. Rewrite every
    // existing envelope so expired/corrupt rows are physically purged, not merely ignored.
    if (raw !== null) await writeUnlocked(memberId, entries);
    return entries;
}

async function writeUnlocked(memberId: number, entries: ArrivalEntry[]): Promise<void> {
    const now = Date.now();
    const retained = entries
        .filter((entry) => entry.enqueuedAt + ENTRY_TTL_MS > now)
        .slice(-MAX_ENTRIES_PER_ACCOUNT);
    if (retained.length === 0) {
        await AsyncStorage.removeItem(storageKey(memberId));
        return;
    }
    const envelope: ArrivalEnvelope = {
        version: SCHEMA_VERSION,
        // Do not add schedule title, route, coordinates, member id, or duplicate capture time.
        entries: retained,
    };
    await AsyncStorage.setItem(storageKey(memberId), JSON.stringify(envelope));
}

function retryDelay(attemptCount: number): number {
    return RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

function isPermanentArrivalRejection(error: unknown): boolean {
    if (!(error instanceof ApiResponseError)) return false;
    // Authentication expiry, throttling, request timeout and server/network failures can recover.
    // Validation/access/not-found responses cannot become valid by replaying the same immutable
    // scheduleId + arrivedAt pair and must not occupy the bounded queue forever.
    return error.status === 400 ||
        error.status === 403 ||
        error.status === 404 ||
        error.status === 410 ||
        error.status === 422;
}

async function enqueue(
    memberId: number,
    scheduleId: string,
    capture: ScheduleArrivalObservationCapture,
): Promise<ArrivalEntry | undefined> {
    return serialize(async () => {
        if (blockedAccountIds.has(memberId)) return undefined;
        const entries = await readUnlocked(memberId);
        const existing = entries.find((entry) => entry.scheduleId === scheduleId);
        if (existing) return existing;

        const now = Date.now();
        const entry: ArrivalEntry = {
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

function flightKey(memberId: number, scheduleId: string): string {
    return `${memberId}\u0000${scheduleId}`;
}

function attempt(memberId: number, scheduleId: string): Promise<DurableArrivalResult> {
    const key = flightKey(memberId, scheduleId);
    const inFlight = inFlightAttempts.get(key);
    if (inFlight) return inFlight;

    const request = (async (): Promise<DurableArrivalResult> => {
        const entry = await serialize(async () => {
            if (blockedAccountIds.has(memberId)) return undefined;
            return (await readUnlocked(memberId)).find((item) => item.scheduleId === scheduleId);
        });
        if (!entry || blockedAccountIds.has(memberId)) return "rejected";
        if (entry.nextAttemptAt > Date.now()) return "queued";

        try {
            // The server's unique (schedule, member) contract makes retries idempotent.
            await recordScheduleArrivalObservation(entry.scheduleId, {
                arrivedAt: entry.arrivedAt,
                observationSource: entry.observationSource,
                precisionSeconds: entry.precisionSeconds,
                ...(entry.adjustmentSeconds === undefined
                    ? {}
                    : { adjustmentSeconds: entry.adjustmentSeconds }),
                ...(entry.clientAppVersion === undefined
                    ? {}
                    : { clientAppVersion: entry.clientAppVersion }),
                ...(entry.clientBuildVersion === undefined
                    ? {}
                    : { clientBuildVersion: entry.clientBuildVersion }),
            });
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                await writeUnlocked(
                    memberId,
                    entries.filter((item) => item.scheduleId !== scheduleId),
                );
            });
            return "sent";
        } catch (error) {
            if (isPermanentArrivalRejection(error)) {
                await serialize(async () => {
                    const entries = await readUnlocked(memberId);
                    await writeUnlocked(
                        memberId,
                        entries.filter((item) => item.scheduleId !== scheduleId),
                    );
                });
                return "rejected";
            }
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                if (blockedAccountIds.has(memberId)) {
                    await writeUnlocked(
                        memberId,
                        entries.filter((item) => item.scheduleId !== scheduleId),
                    );
                    return;
                }
                const current = entries.find((item) => item.scheduleId === scheduleId);
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
    const dueScheduleIds = await serialize(async () => {
        const now = Date.now();
        return (await readUnlocked(memberId))
            .filter((entry) => entry.nextAttemptAt <= now)
            .map((entry) => entry.scheduleId);
    });
    const results = await Promise.all(dueScheduleIds.map((scheduleId) => attempt(memberId, scheduleId)));
    return results.filter((result) => result === "sent").length;
}

async function scheduleEarliestRetry(memberId: number): Promise<void> {
    const generation = accountLifecycleGeneration;
    const nextAttemptAt = await serialize(async () => {
        const entries = await readUnlocked(memberId);
        return entries.length === 0
            ? undefined
            : Math.min(...entries.map((entry) => entry.nextAttemptAt));
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
        activateScheduleArrivalObservationQueueForAuthenticatedMember().catch(() => undefined);
    }, Math.max(0, nextAttemptAt - Date.now()));
}

/** Persists the complete arrival quality capture before the first network request. */
export async function recordScheduleArrivalDurably(
    scheduleIdInput: string,
    captureInput: ScheduleArrivalObservationCapture,
): Promise<DurableArrivalResult> {
    if (await isDepartureAlarmAccountCleanupPending()) return "rejected";
    const scheduleId = normalizeScheduleId(scheduleIdInput);
    const arrivedAt = normalizeIsoInstant(captureInput?.arrivedAt);
    const observationSource = normalizeObservationSource(captureInput?.observationSource);
    const precisionSeconds = normalizePrecisionSeconds(captureInput?.precisionSeconds);
    const adjustmentSeconds = observationSource && precisionSeconds
        ? normalizeAdjustmentSeconds(
            captureInput?.adjustmentSeconds,
            observationSource,
            precisionSeconds,
        )
        : null;
    const clientAppVersion = normalizeOptionalCohortValue(captureInput?.clientAppVersion);
    const clientBuildVersion = normalizeOptionalCohortValue(captureInput?.clientBuildVersion);
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (
        !scheduleId ||
        !arrivedAt ||
        !observationSource ||
        !precisionSeconds ||
        adjustmentSeconds === null ||
        !memberId ||
        blockedAccountIds.has(memberId)
    ) {
        return "rejected";
    }

    try {
        if (activeMemberId !== memberId) {
            cancelRetryTimer();
            activeMemberId = memberId;
        }
        const entry = await enqueue(memberId, scheduleId, {
            arrivedAt,
            observationSource,
            precisionSeconds,
            ...(adjustmentSeconds === undefined ? {} : { adjustmentSeconds }),
            ...(clientAppVersion === undefined ? {} : { clientAppVersion }),
            ...(clientBuildVersion === undefined ? {} : { clientBuildVersion }),
        });
        if (!entry) return "rejected";
        const result = await attempt(memberId, entry.scheduleId);
        await scheduleEarliestRetry(memberId).catch(() => undefined);
        return result;
    } catch {
        // If durable storage itself is unavailable, do not claim that an offline report is safe.
        return "rejected";
    }
}

/** Hook for cold start, fresh login and foreground activation. */
export async function activateScheduleArrivalObservationQueueForAuthenticatedMember(): Promise<number> {
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

/** Hook to run before clearing authentication during logout/account deletion. */
export async function clearScheduleArrivalObservationQueueForCurrentAccount(): Promise<void> {
    let persistedMemberId: number | undefined;
    try {
        persistedMemberId = normalizeMemberId((await getAuthMember())?.id);
    } catch {
        // The active in-memory binding still lets logout purge the exact timestamp when the
        // encrypted auth cache becomes temporarily unreadable.
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

export function resetScheduleArrivalObservationQueueForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    storageTail = Promise.resolve();
    accountLifecycleGeneration = 0;
    blockedAccountIds.clear();
    inFlightAttempts.clear();
    inFlightDrains.clear();
    cancelRetryTimer();
    activeMemberId = undefined;
}

export const SCHEDULE_ARRIVAL_QUEUE_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        storageKeyForMember: storageKey,
        maximumSize: MAX_ENTRIES_PER_ACCOUNT,
        entryTtlMs: ENTRY_TTL_MS,
        retryDelaysMs: RETRY_DELAYS_MS,
        schemaVersion: SCHEMA_VERSION,
        cohortSchemaVersion: COHORT_SCHEMA_VERSION,
        sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
        legacySchemaVersion: LEGACY_SCHEMA_VERSION,
    }
    : undefined;

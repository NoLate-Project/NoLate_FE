import AsyncStorage from "@react-native-async-storage/async-storage";

import { recordQuickScheduleReliabilityFeedback } from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import type {
    QuickScheduleReliabilityFeedback,
    QuickScheduleVerificationSignal,
} from "./types";

const STORAGE_KEY_PREFIX = "nolate_quick_schedule_feedback_queue_v1:";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES_PER_ACCOUNT = 100;
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const ANALYSIS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERIFICATION_SIGNALS: ReadonlySet<QuickScheduleVerificationSignal> = new Set([
    "UNTOUCHED",
    "USER_CONFIRMED",
    "USER_CORRECTED",
]);

type FeedbackEntry = QuickScheduleReliabilityFeedback & {
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

type FeedbackEnvelope = {
    version: typeof SCHEMA_VERSION;
    entries: FeedbackEntry[];
};

export type DurableQuickScheduleFeedbackResult = "sent" | "queued" | "rejected";

let storageTail: Promise<void> = Promise.resolve();
let lifecycleGeneration = 0;
let activeMemberId: number | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const blockedAccountIds = new Set<number>();
const inFlightAttempts = new Map<string, Promise<DurableQuickScheduleFeedbackResult>>();
const inFlightDrains = new Map<number, Promise<number>>();

function normalizeMemberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

function normalizeAnalysisId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return ANALYSIS_ID_PATTERN.test(normalized) ? normalized.toLowerCase() : undefined;
}

function normalizeVerification(value: unknown): QuickScheduleVerificationSignal | undefined {
    return VERIFICATION_SIGNALS.has(value as QuickScheduleVerificationSignal)
        ? value as QuickScheduleVerificationSignal
        : undefined;
}

function normalizeFeedback(value: unknown): QuickScheduleReliabilityFeedback | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<QuickScheduleReliabilityFeedback>;
    const analysisId = normalizeAnalysisId(candidate.analysisId);
    const date = normalizeVerification(candidate.date);
    const time = normalizeVerification(candidate.time);
    const destination = normalizeVerification(candidate.destination);
    if (
        !analysisId ||
        (candidate.outcome !== "SAVED" && candidate.outcome !== "CANCELLED") ||
        !date ||
        !time ||
        !destination ||
        typeof candidate.globalConfirmed !== "boolean"
    ) return undefined;
    return {
        analysisId,
        outcome: candidate.outcome,
        date,
        time,
        destination,
        globalConfirmed: candidate.globalConfirmed,
    };
}

function normalizeEntry(value: unknown, now: number): FeedbackEntry | undefined {
    const feedback = normalizeFeedback(value);
    if (!feedback || !value || typeof value !== "object") return undefined;
    const candidate = value as Partial<FeedbackEntry>;
    if (
        !Number.isSafeInteger(candidate.attemptCount) ||
        (candidate.attemptCount ?? -1) < 0 ||
        typeof candidate.nextAttemptAt !== "number" ||
        !Number.isFinite(candidate.nextAttemptAt) ||
        typeof candidate.enqueuedAt !== "number" ||
        !Number.isFinite(candidate.enqueuedAt) ||
        candidate.enqueuedAt > now + 60_000 ||
        now - candidate.enqueuedAt > MAX_ENTRY_AGE_MS
    ) return undefined;
    return {
        ...feedback,
        attemptCount: candidate.attemptCount as number,
        nextAttemptAt: candidate.nextAttemptAt,
        enqueuedAt: candidate.enqueuedAt,
    };
}

function storageKey(memberId: number): string {
    return `${STORAGE_KEY_PREFIX}${memberId}`;
}

function parseEnvelope(raw: string | null, now = Date.now()): FeedbackEntry[] {
    if (!raw) return [];
    try {
        const envelope = JSON.parse(raw) as Partial<FeedbackEnvelope>;
        if (envelope.version !== SCHEMA_VERSION || !Array.isArray(envelope.entries)) return [];
        const uniqueByAnalysis = new Map<string, FeedbackEntry>();
        envelope.entries.forEach((candidate) => {
            const entry = normalizeEntry(candidate, now);
            if (!entry) return;
            const existing = uniqueByAnalysis.get(entry.analysisId);
            // SAVED is terminal and stronger than a late CANCELLED callback.
            if (!existing || (existing.outcome === "CANCELLED" && entry.outcome === "SAVED")) {
                uniqueByAnalysis.set(entry.analysisId, entry);
            }
        });
        return [...uniqueByAnalysis.values()]
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

async function readUnlocked(memberId: number): Promise<FeedbackEntry[]> {
    return parseEnvelope(await AsyncStorage.getItem(storageKey(memberId)));
}

async function writeUnlocked(memberId: number, entries: FeedbackEntry[]): Promise<void> {
    if (entries.length === 0) {
        await AsyncStorage.removeItem(storageKey(memberId));
        return;
    }
    const envelope: FeedbackEnvelope = {
        version: SCHEMA_VERSION,
        entries: entries.slice(-MAX_ENTRIES_PER_ACCOUNT),
    };
    await AsyncStorage.setItem(storageKey(memberId), JSON.stringify(envelope));
}

function cancelRetryTimer(): void {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
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
    feedback: QuickScheduleReliabilityFeedback,
): Promise<FeedbackEntry | undefined> {
    return serialize(async () => {
        if (blockedAccountIds.has(memberId)) return undefined;
        const entries = await readUnlocked(memberId);
        const existingIndex = entries.findIndex((entry) => entry.analysisId === feedback.analysisId);
        if (existingIndex >= 0) {
            const existing = entries[existingIndex];
            if (existing.outcome === "SAVED" || feedback.outcome === "CANCELLED") return existing;
            const upgraded = { ...existing, ...feedback };
            entries[existingIndex] = upgraded;
            await writeUnlocked(memberId, entries);
            return upgraded;
        }
        const now = Date.now();
        const entry: FeedbackEntry = {
            ...feedback,
            attemptCount: 0,
            nextAttemptAt: now,
            enqueuedAt: now,
        };
        entries.push(entry);
        await writeUnlocked(memberId, entries);
        return entry;
    });
}

function attemptKey(memberId: number, analysisId: string): string {
    return `${memberId}\u0000${analysisId}`;
}

function sameFeedback(left: FeedbackEntry, right: FeedbackEntry): boolean {
    return left.analysisId === right.analysisId &&
        left.outcome === right.outcome &&
        left.date === right.date &&
        left.time === right.time &&
        left.destination === right.destination &&
        left.globalConfirmed === right.globalConfirmed;
}

function attempt(
    memberId: number,
    analysisId: string,
): Promise<DurableQuickScheduleFeedbackResult> {
    const key = attemptKey(memberId, analysisId);
    const existingRequest = inFlightAttempts.get(key);
    if (existingRequest) return existingRequest;

    const request = (async (): Promise<DurableQuickScheduleFeedbackResult> => {
        const entry = await serialize(async () => {
            if (blockedAccountIds.has(memberId)) return undefined;
            return (await readUnlocked(memberId)).find((item) => item.analysisId === analysisId);
        });
        if (!entry || blockedAccountIds.has(memberId)) return "rejected";
        if (entry.nextAttemptAt > Date.now()) return "queued";

        try {
            await recordQuickScheduleReliabilityFeedback({
                analysisId: entry.analysisId,
                outcome: entry.outcome,
                date: entry.date,
                time: entry.time,
                destination: entry.destination,
                globalConfirmed: entry.globalConfirmed,
            });
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                const current = entries.find((item) => item.analysisId === analysisId);
                if (!current || sameFeedback(current, entry)) {
                    await writeUnlocked(
                        memberId,
                        entries.filter((item) => item.analysisId !== analysisId),
                    );
                    return;
                }
                // A stronger SAVED signal replaced the payload while this request was in flight.
                // Keep it due immediately instead of deleting it with the completed older request.
                current.attemptCount = 0;
                current.nextAttemptAt = Date.now();
                await writeUnlocked(memberId, entries);
            });
            return "sent";
        } catch (error) {
            if (isPermanentRejection(error)) {
                await serialize(async () => {
                    const entries = await readUnlocked(memberId);
                    await writeUnlocked(
                        memberId,
                        entries.filter((item) => item.analysisId !== analysisId),
                    );
                });
                return "rejected";
            }
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                const current = entries.find((item) => item.analysisId === analysisId);
                if (!current) return;
                if (blockedAccountIds.has(memberId)) {
                    await writeUnlocked(
                        memberId,
                        entries.filter((item) => item.analysisId !== analysisId),
                    );
                    return;
                }
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
    const dueIds = await serialize(async () => {
        const now = Date.now();
        return (await readUnlocked(memberId))
            .filter((entry) => entry.nextAttemptAt <= now)
            .map((entry) => entry.analysisId);
    });
    const results = await Promise.all(dueIds.map((analysisId) => attempt(memberId, analysisId)));
    return results.filter((result) => result === "sent").length;
}

async function scheduleEarliestRetry(memberId: number): Promise<void> {
    const generation = lifecycleGeneration;
    const nextAttemptAt = await serialize(async () => {
        const entries = await readUnlocked(memberId);
        return entries.length === 0
            ? undefined
            : Math.min(...entries.map((entry) => entry.nextAttemptAt));
    });
    if (
        generation !== lifecycleGeneration ||
        memberId !== activeMemberId ||
        blockedAccountIds.has(memberId)
    ) return;
    cancelRetryTimer();
    if (nextAttemptAt === undefined) return;
    retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (memberId !== activeMemberId || blockedAccountIds.has(memberId)) return;
        activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember()
            .catch(() => undefined);
    }, Math.max(0, nextAttemptAt - Date.now()));
}

/** Stores content-free feedback before its first network attempt. */
export async function recordQuickScheduleReliabilityFeedbackDurably(
    feedbackInput: QuickScheduleReliabilityFeedback,
): Promise<DurableQuickScheduleFeedbackResult> {
    const feedback = normalizeFeedback(feedbackInput);
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!feedback || !memberId || blockedAccountIds.has(memberId)) return "rejected";
    try {
        if (activeMemberId !== memberId) {
            cancelRetryTimer();
            activeMemberId = memberId;
        }
        const entry = await enqueue(memberId, feedback);
        if (!entry) return "rejected";
        const result = await attempt(memberId, entry.analysisId);
        const stillQueued = await serialize(async () => (
            (await readUnlocked(memberId)).some((item) => item.analysisId === entry.analysisId)
        ));
        await scheduleEarliestRetry(memberId).catch(() => undefined);
        return result === "sent" && stillQueued ? "queued" : result;
    } catch {
        return "rejected";
    }
}

/** Recovery hook for login restore, cold start, and foreground activation. */
export async function activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember(): Promise<number> {
    const generation = lifecycleGeneration;
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!memberId || generation !== lifecycleGeneration) return 0;
    blockedAccountIds.delete(memberId);
    if (activeMemberId !== memberId) {
        cancelRetryTimer();
        activeMemberId = memberId;
    }
    const inFlight = inFlightDrains.get(memberId);
    if (inFlight) return inFlight;
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

/** Must run while the signing-out member binding is still available. */
export async function clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount(): Promise<void> {
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!memberId) return;
    lifecycleGeneration += 1;
    blockedAccountIds.add(memberId);
    if (activeMemberId === memberId) {
        cancelRetryTimer();
        activeMemberId = undefined;
    }
    await serialize(() => AsyncStorage.removeItem(storageKey(memberId)));
}

export function resetQuickScheduleReliabilityFeedbackQueueForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    storageTail = Promise.resolve();
    lifecycleGeneration = 0;
    activeMemberId = undefined;
    blockedAccountIds.clear();
    inFlightAttempts.clear();
    inFlightDrains.clear();
    cancelRetryTimer();
}

export const QUICK_SCHEDULE_FEEDBACK_QUEUE_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        storageKeyForMember: storageKey,
        retryDelaysMs: RETRY_DELAYS_MS,
        maximumSize: MAX_ENTRIES_PER_ACCOUNT,
        maximumAgeMs: MAX_ENTRY_AGE_MS,
    }
    : undefined;

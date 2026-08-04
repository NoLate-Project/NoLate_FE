import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    postNotificationDeliveryAck,
    type NotificationDeliveryAckPayload,
    type NotificationDeliveryAckStage,
} from "../../api/notification";
import { getAuthMember } from "../auth/authStorage";

const ACK_QUEUE_STORAGE_KEY_PREFIX = "nolate_push_delivery_ack_queue_v1:";
const ACK_QUEUE_SCHEMA_VERSION = 1;
const MAX_DURABLE_ACKS_PER_ACCOUNT = 100;
const DRAIN_CONCURRENCY = 4;
const RETRY_DELAYS_MS = [
    15_000,
    60_000,
    5 * 60_000,
    15 * 60_000,
    60 * 60_000,
] as const;

const ACK_STAGES: ReadonlySet<NotificationDeliveryAckStage> = new Set([
    "RECEIVED",
    "PRESENTED",
    "ALARM_SCHEDULED",
    "ALARM_FIRED",
    "ACTIONED",
]);

type DurableAckEntry = {
    key: string;
    payload: NotificationDeliveryAckPayload;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

type DurableAckEnvelope = {
    version: typeof ACK_QUEUE_SCHEMA_VERSION;
    entries: DurableAckEntry[];
};

type AckAttemptResult = "sent" | "failed" | "deferred" | "missing" | "blocked";

let storageOperationTail: Promise<void> = Promise.resolve();
let accountLifecycleGeneration = 0;
const inFlightAttempts = new Map<string, Promise<AckAttemptResult>>();
const inFlightDrains = new Map<number, Promise<number>>();
const blockedAccountIds = new Set<number>();
const retryTimers = new Map<number, ReturnType<typeof setTimeout>>();
const retryTimerRevisions = new Map<number, number>();

function normalizedMemberId(value: unknown): number | undefined {
    const parsed = typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : value;
    return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : undefined;
}

function queueStorageKey(memberId: number): string {
    return `${ACK_QUEUE_STORAGE_KEY_PREFIX}${memberId}`;
}

function ackEntryKey(payload: Pick<NotificationDeliveryAckPayload, "logicalEventKey" | "stage">): string {
    return `${payload.logicalEventKey}\u0000${payload.stage}`;
}

function retentionPriority(stage: NotificationDeliveryAckStage): number {
    if (stage === "ALARM_FIRED") return 3;
    if (stage === "ALARM_SCHEDULED") return 2;
    if (stage === "RECEIVED") return 1;
    return 0;
}

/** Preserve direct receipt and alarm lifecycle evidence before engagement-only ACKs. */
function retainHighestValueEntries(entries: DurableAckEntry[]): DurableAckEntry[] {
    return entries
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => {
            const priorityDifference = retentionPriority(right.entry.payload.stage) -
                retentionPriority(left.entry.payload.stage);
            if (priorityDifference !== 0) return priorityDifference;
            if (right.entry.enqueuedAt !== left.entry.enqueuedAt) {
                return right.entry.enqueuedAt - left.entry.enqueuedAt;
            }
            return right.index - left.index;
        })
        .slice(0, MAX_DURABLE_ACKS_PER_ACCOUNT)
        .map(({ entry }) => entry)
        .sort((left, right) => left.enqueuedAt - right.enqueuedAt || left.key.localeCompare(right.key));
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || isNonEmptyString(value);
}

function parsePayload(value: unknown): NotificationDeliveryAckPayload | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<NotificationDeliveryAckPayload>;
    if (
        !isNonEmptyString(candidate.logicalEventKey) ||
        !isNonEmptyString(candidate.deviceId) ||
        !isNonEmptyString(candidate.occurredAt) ||
        !ACK_STAGES.has(candidate.stage as NotificationDeliveryAckStage) ||
        !isOptionalString(candidate.providerMessageId) ||
        !isOptionalString(candidate.alarmId) ||
        !isOptionalString(candidate.actionIdentifier)
    ) {
        return undefined;
    }

    return {
        logicalEventKey: candidate.logicalEventKey,
        deviceId: candidate.deviceId,
        stage: candidate.stage as NotificationDeliveryAckStage,
        occurredAt: candidate.occurredAt,
        ...(candidate.providerMessageId
            ? { providerMessageId: candidate.providerMessageId }
            : {}),
        ...(candidate.alarmId ? { alarmId: candidate.alarmId } : {}),
        ...(candidate.actionIdentifier
            ? { actionIdentifier: candidate.actionIdentifier }
            : {}),
    };
}

function parseEntry(value: unknown): DurableAckEntry | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<DurableAckEntry>;
    const payload = parsePayload(candidate.payload);
    if (
        !payload ||
        !Number.isSafeInteger(candidate.attemptCount) ||
        (candidate.attemptCount ?? -1) < 0 ||
        typeof candidate.nextAttemptAt !== "number" ||
        !Number.isFinite(candidate.nextAttemptAt) ||
        typeof candidate.enqueuedAt !== "number" ||
        !Number.isFinite(candidate.enqueuedAt)
    ) {
        return undefined;
    }

    return {
        key: ackEntryKey(payload),
        payload,
        attemptCount: candidate.attemptCount as number,
        nextAttemptAt: candidate.nextAttemptAt,
        enqueuedAt: candidate.enqueuedAt,
    };
}

function parseQueue(raw: string | null): DurableAckEntry[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as Partial<DurableAckEnvelope>;
        if (parsed.version !== ACK_QUEUE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
            return [];
        }

        const uniqueEntries = new Map<string, DurableAckEntry>();
        parsed.entries.forEach((candidate) => {
            const entry = parseEntry(candidate);
            if (entry && !uniqueEntries.has(entry.key)) uniqueEntries.set(entry.key, entry);
        });
        return retainHighestValueEntries(Array.from(uniqueEntries.values()));
    } catch {
        return [];
    }
}

function runSerializedStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = storageOperationTail.then(operation, operation);
    storageOperationTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

async function readQueueUnlocked(memberId: number): Promise<DurableAckEntry[]> {
    return parseQueue(await AsyncStorage.getItem(queueStorageKey(memberId)));
}

async function writeQueueUnlocked(memberId: number, entries: DurableAckEntry[]): Promise<void> {
    const storageKey = queueStorageKey(memberId);
    if (entries.length === 0) {
        await AsyncStorage.removeItem(storageKey);
        return;
    }

    const envelope: DurableAckEnvelope = {
        version: ACK_QUEUE_SCHEMA_VERSION,
        entries: retainHighestValueEntries(entries),
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));
}

function retryDelayMs(attemptCount: number): number {
    const index = Math.min(
        Math.max(0, attemptCount - 1),
        RETRY_DELAYS_MS.length - 1,
    );
    return RETRY_DELAYS_MS[index];
}

async function enqueueAck(
    memberId: number,
    payload: NotificationDeliveryAckPayload,
    now: number,
): Promise<boolean> {
    return runSerializedStorageOperation(async () => {
        if (blockedAccountIds.has(memberId)) return false;

        const entries = await readQueueUnlocked(memberId);
        const key = ackEntryKey(payload);
        if (entries.some((entry) => entry.key === key)) return true;

        const incoming: DurableAckEntry = {
            key,
            payload,
            attemptCount: 0,
            nextAttemptAt: now,
            enqueuedAt: now,
        };
        const retained = retainHighestValueEntries([...entries, incoming]);
        await writeQueueUnlocked(memberId, retained);
        return retained.some((entry) => entry.key === key);
    });
}

function attemptFlightKey(memberId: number, entryKey: string): string {
    return `${memberId}\u0000${entryKey}`;
}

function cancelRetryTimer(memberId: number): void {
    const timer = retryTimers.get(memberId);
    if (timer) clearTimeout(timer);
    retryTimers.delete(memberId);
    retryTimerRevisions.set(memberId, (retryTimerRevisions.get(memberId) ?? 0) + 1);
}

async function scheduleNextRetry(memberId: number): Promise<void> {
    if (blockedAccountIds.has(memberId)) {
        cancelRetryTimer(memberId);
        return;
    }
    const revision = (retryTimerRevisions.get(memberId) ?? 0) + 1;
    retryTimerRevisions.set(memberId, revision);
    const lifecycleGeneration = accountLifecycleGeneration;
    const nextAttemptAt = await runSerializedStorageOperation(async () => {
        const pending = await readQueueUnlocked(memberId);
        return pending.reduce<number | undefined>((earliest, entry) => (
            earliest === undefined || entry.nextAttemptAt < earliest
                ? entry.nextAttemptAt
                : earliest
        ), undefined);
    });
    if (
        retryTimerRevisions.get(memberId) !== revision ||
        lifecycleGeneration !== accountLifecycleGeneration ||
        blockedAccountIds.has(memberId)
    ) return;

    const existing = retryTimers.get(memberId);
    if (existing) clearTimeout(existing);
    retryTimers.delete(memberId);
    if (nextAttemptAt === undefined) return;

    const timer = setTimeout(() => {
        if (
            retryTimers.get(memberId) !== timer ||
            retryTimerRevisions.get(memberId) !== revision ||
            lifecycleGeneration !== accountLifecycleGeneration ||
            blockedAccountIds.has(memberId)
        ) return;
        retryTimers.delete(memberId);
        drainPushDeliveryAckQueue(memberId).catch(() => {
            scheduleNextRetry(memberId).catch(() => undefined);
        });
    }, Math.max(0, nextAttemptAt - Date.now()));
    retryTimers.set(memberId, timer);
}

function attemptQueuedAck(memberId: number, entryKey: string): Promise<AckAttemptResult> {
    const flightKey = attemptFlightKey(memberId, entryKey);
    const existingAttempt = inFlightAttempts.get(flightKey);
    if (existingAttempt) return existingAttempt;

    const request = (async (): Promise<AckAttemptResult> => {
        const entry = await runSerializedStorageOperation(async () => {
            if (blockedAccountIds.has(memberId)) return undefined;
            const entries = await readQueueUnlocked(memberId);
            return entries.find((candidate) => candidate.key === entryKey);
        });
        if (blockedAccountIds.has(memberId)) return "blocked";
        if (!entry) return "missing";
        if (entry.nextAttemptAt > Date.now()) {
            await scheduleNextRetry(memberId).catch(() => undefined);
            return "deferred";
        }

        try {
            await postNotificationDeliveryAck(entry.payload);
            await runSerializedStorageOperation(async () => {
                const entries = await readQueueUnlocked(memberId);
                await writeQueueUnlocked(
                    memberId,
                    entries.filter((candidate) => candidate.key !== entryKey),
                );
            });
            await scheduleNextRetry(memberId).catch(() => undefined);
            return "sent";
        } catch {
            await runSerializedStorageOperation(async () => {
                const entries = await readQueueUnlocked(memberId);
                if (blockedAccountIds.has(memberId)) {
                    await writeQueueUnlocked(
                        memberId,
                        entries.filter((candidate) => candidate.key !== entryKey),
                    );
                    return;
                }

                const current = entries.find((candidate) => candidate.key === entryKey);
                if (!current) return;
                current.attemptCount += 1;
                current.nextAttemptAt = Date.now() + retryDelayMs(current.attemptCount);
                await writeQueueUnlocked(memberId, entries);
            });
            await scheduleNextRetry(memberId).catch(() => undefined);
            return "failed";
        }
    })().finally(() => {
        if (inFlightAttempts.get(flightKey) === request) inFlightAttempts.delete(flightKey);
    });

    inFlightAttempts.set(flightKey, request);
    return request;
}

async function runDrain(memberId: number): Promise<number> {
    if (blockedAccountIds.has(memberId)) return 0;
    const dueEntryKeys = await runSerializedStorageOperation(async () => {
        const entries = await readQueueUnlocked(memberId);
        const now = Date.now();
        return entries
            .filter((entry) => entry.nextAttemptAt <= now)
            .map((entry) => entry.key);
    });

    let sentCount = 0;
    for (let index = 0; index < dueEntryKeys.length; index += DRAIN_CONCURRENCY) {
        if (blockedAccountIds.has(memberId)) break;
        const results = await Promise.all(
            dueEntryKeys
                .slice(index, index + DRAIN_CONCURRENCY)
                .map((entryKey) => attemptQueuedAck(memberId, entryKey)),
        );
        sentCount += results.filter((result) => result === "sent").length;
    }
    await scheduleNextRetry(memberId).catch(() => undefined);
    return sentCount;
}

/**
 * Persists before sending so a process death cannot lose a callback that has
 * already reached JavaScript. A failed send remains queued with capped
 * exponential backoff; repeated callbacks keep the original occurredAt.
 */
export async function deliverPushDeliveryAckDurably(
    memberId: number,
    payload: NotificationDeliveryAckPayload,
): Promise<boolean> {
    if (!normalizedMemberId(memberId) || blockedAccountIds.has(memberId)) return false;
    const entryKey = ackEntryKey(payload);

    try {
        const accepted = await enqueueAck(memberId, payload, Date.now());
        if (!accepted) return false;

        const targetAttempt = attemptQueuedAck(memberId, entryKey);
        // Every new ACK is also a recovery point for older, due ACKs. Do not make
        // notification handling wait for unrelated telemetry requests.
        drainPushDeliveryAckQueue(memberId).catch(() => undefined);
        return await targetAttempt === "sent";
    } catch {
        // Storage unavailability must not prevent the original best-effort ACK.
        if (blockedAccountIds.has(memberId)) return false;
        try {
            await postNotificationDeliveryAck(payload);
            return true;
        } catch {
            return false;
        }
    }
}

export function drainPushDeliveryAckQueue(memberId: number): Promise<number> {
    if (!normalizedMemberId(memberId) || blockedAccountIds.has(memberId)) {
        return Promise.resolve(0);
    }
    const existingDrain = inFlightDrains.get(memberId);
    if (existingDrain) return existingDrain;

    const request = runDrain(memberId).finally(() => {
        if (inFlightDrains.get(memberId) === request) inFlightDrains.delete(memberId);
    });
    inFlightDrains.set(memberId, request);
    return request;
}

/** Called only on an authenticated app transition (cold start or fresh login). */
export async function activatePushDeliveryAckQueueForAuthenticatedMember(): Promise<number> {
    const activationGeneration = accountLifecycleGeneration;
    const memberId = normalizedMemberId((await getAuthMember())?.id);
    if (!memberId) return 0;
    // A logout that began while auth storage was being read wins over this
    // older activation attempt. A later fresh-login effect gets a new generation.
    if (activationGeneration !== accountLifecycleGeneration) return 0;
    blockedAccountIds.delete(memberId);
    return drainPushDeliveryAckQueue(memberId);
}

/**
 * Blocks new writes before deleting the current member's queue. Per-member keys
 * ensure even a failed deletion can never be drained with another account's JWT.
 */
export async function clearPushDeliveryAckQueueForCurrentAccount(): Promise<void> {
    const memberId = normalizedMemberId((await getAuthMember())?.id);
    if (!memberId) return;
    accountLifecycleGeneration += 1;
    blockedAccountIds.add(memberId);
    cancelRetryTimer(memberId);
    await runSerializedStorageOperation(() => AsyncStorage.removeItem(queueStorageKey(memberId)));
}

/** Test-only reset for process-memory coordination state. Durable storage is retained. */
export function resetPushDeliveryAckQueueForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    storageOperationTail = Promise.resolve();
    accountLifecycleGeneration = 0;
    inFlightAttempts.clear();
    inFlightDrains.clear();
    blockedAccountIds.clear();
    retryTimers.forEach((timer) => clearTimeout(timer));
    retryTimers.clear();
    retryTimerRevisions.clear();
}

export const PUSH_DELIVERY_ACK_QUEUE_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        storageKeyForMember: queueStorageKey,
        maximumSize: MAX_DURABLE_ACKS_PER_ACCOUNT,
        retryDelaysMs: RETRY_DELAYS_MS,
    }
    : undefined;

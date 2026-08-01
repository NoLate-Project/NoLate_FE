import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import {
    postDepartureAlarmScheduleReceipt,
    type DepartureAlarmScheduleReceiptPayload,
} from "../../api/notification";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import {
    getDepartureAlarmCapabilities,
    type DepartureAlarmCapabilities,
    type DepartureAlarmMutationResult,
} from "./departureAlarm";
import type { DepartureAlarmSyncCommand } from "./departureAlarmContract";
import { getOrCreatePushDeviceId } from "./pushDeviceIdentity";

const STORAGE_KEY_PREFIX = "nolate_departure_alarm_schedule_receipts_v1:";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES_PER_ACCOUNT = 200;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

type ReceiptEntry = {
    payload: DepartureAlarmScheduleReceiptPayload;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

type ReceiptEnvelope = {
    version: typeof SCHEMA_VERSION;
    entries: ReceiptEntry[];
};

export type DepartureAlarmReceiptSource = "PUSH" | "SNAPSHOT";
export type DurableScheduleReceiptResult = "sent" | "queued" | "rejected";

let storageTail: Promise<void> = Promise.resolve();
let accountLifecycleGeneration = 0;
const blockedAccountIds = new Set<number>();
const inFlightAttempts = new Map<string, Promise<DurableScheduleReceiptResult>>();
const inFlightDrains = new Map<number, Promise<number>>();
const drainRerunRequested = new Set<number>();
const retryTimers = new Map<number, ReturnType<typeof setTimeout>>();
const retryTimerRevisions = new Map<number, number>();
let deliveryModeInFlight: Promise<DepartureAlarmScheduleReceiptPayload["deliveryMode"]> | undefined;

function normalizeMemberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

function isIsoInstant(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isPayload(value: unknown): value is DepartureAlarmScheduleReceiptPayload {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<DepartureAlarmScheduleReceiptPayload>;
    return typeof candidate.receiptId === "string" && candidate.receiptId.length > 0 &&
        typeof candidate.alarmId === "string" && candidate.alarmId.length > 0 &&
        Number.isSafeInteger(candidate.scheduleId) && (candidate.scheduleId ?? 0) > 0 &&
        Number.isSafeInteger(candidate.generation) && (candidate.generation ?? -1) >= 0 &&
        Number.isSafeInteger(candidate.recipientMemberId) && (candidate.recipientMemberId ?? 0) > 0 &&
        (candidate.operation === "UPSERT" || candidate.operation === "CANCEL") &&
        (candidate.triggerAt === undefined || isIsoInstant(candidate.triggerAt)) &&
        (candidate.outcome === "SCHEDULED" || candidate.outcome === "CANCELED" || candidate.outcome === "FAILED") &&
        typeof candidate.applied === "boolean" &&
        typeof candidate.scheduled === "boolean" &&
        (candidate.reason === undefined || typeof candidate.reason === "string") &&
        (candidate.platform === "IOS" || candidate.platform === "ANDROID") &&
        (
            candidate.deliveryMode === "ANDROID_EXACT" ||
            candidate.deliveryMode === "ANDROID_INEXACT" ||
            candidate.deliveryMode === "IOS_ALARM_KIT" ||
            candidate.deliveryMode === "IOS_TIME_SENSITIVE" ||
            candidate.deliveryMode === "UNKNOWN"
        ) &&
        (candidate.source === "PUSH" || candidate.source === "SNAPSHOT") &&
        isIsoInstant(candidate.occurredAt) &&
        typeof candidate.deviceId === "string" && candidate.deviceId.length > 0;
}

function parseEntry(value: unknown): ReceiptEntry | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<ReceiptEntry>;
    if (
        !isPayload(candidate.payload) ||
        !Number.isSafeInteger(candidate.attemptCount) ||
        (candidate.attemptCount ?? -1) < 0 ||
        typeof candidate.nextAttemptAt !== "number" || !Number.isFinite(candidate.nextAttemptAt) ||
        typeof candidate.enqueuedAt !== "number" || !Number.isFinite(candidate.enqueuedAt)
    ) return undefined;
    return candidate as ReceiptEntry;
}

function storageKey(memberId: number): string {
    return `${STORAGE_KEY_PREFIX}${memberId}`;
}

function parseEnvelope(raw: string | null): ReceiptEntry[] {
    if (!raw) return [];
    try {
        const envelope = JSON.parse(raw) as Partial<ReceiptEnvelope>;
        if (envelope.version !== SCHEMA_VERSION || !Array.isArray(envelope.entries)) return [];
        const unique = new Map<string, ReceiptEntry>();
        envelope.entries.forEach((candidate) => {
            const entry = parseEntry(candidate);
            if (entry && !unique.has(entry.payload.receiptId)) {
                unique.set(entry.payload.receiptId, entry);
            }
        });
        return Array.from(unique.values())
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

async function readUnlocked(memberId: number): Promise<ReceiptEntry[]> {
    return parseEnvelope(await AsyncStorage.getItem(storageKey(memberId)));
}

async function writeUnlocked(memberId: number, entries: ReceiptEntry[]): Promise<void> {
    if (entries.length === 0) {
        await AsyncStorage.removeItem(storageKey(memberId));
        return;
    }
    const envelope: ReceiptEnvelope = {
        version: SCHEMA_VERSION,
        entries: entries.slice(-MAX_ENTRIES_PER_ACCOUNT),
    };
    await AsyncStorage.setItem(storageKey(memberId), JSON.stringify(envelope));
}

function retryDelay(attemptCount: number): number {
    return RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
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
    const nextAttemptAt = await serialize(async () => {
        const pending = await readUnlocked(memberId);
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
        drainSingleFlight(memberId).catch(() => undefined);
    }, Math.max(0, nextAttemptAt - Date.now()));
    retryTimers.set(memberId, timer);
}

function isPermanentRejection(error: unknown): boolean {
    if (!(error instanceof ApiResponseError)) return false;
    // 404 is intentionally retryable: on a fresh login the authenticated snapshot can be
    // applied before this installation's push-token ownership registration commits.
    return error.status === 400 ||
        error.status === 403 ||
        error.status === 409 ||
        error.status === 410 ||
        error.status === 422;
}

async function enqueue(
    memberId: number,
    payload: DepartureAlarmScheduleReceiptPayload,
): Promise<boolean> {
    return serialize(async () => {
        if (blockedAccountIds.has(memberId)) return false;
        const entries = await readUnlocked(memberId);
        if (entries.some((entry) => entry.payload.receiptId === payload.receiptId)) return true;
        const now = Date.now();
        entries.push({ payload, attemptCount: 0, nextAttemptAt: now, enqueuedAt: now });
        await writeUnlocked(memberId, entries);
        return true;
    });
}

function flightKey(memberId: number, receiptId: string): string {
    return `${memberId}\u0000${receiptId}`;
}

function attempt(memberId: number, receiptId: string): Promise<DurableScheduleReceiptResult> {
    const key = flightKey(memberId, receiptId);
    const existing = inFlightAttempts.get(key);
    if (existing) return existing;

    const request = (async (): Promise<DurableScheduleReceiptResult> => {
        const entry = await serialize(async () => {
            if (blockedAccountIds.has(memberId)) return undefined;
            return (await readUnlocked(memberId)).find(
                (candidate) => candidate.payload.receiptId === receiptId,
            );
        });
        if (!entry || blockedAccountIds.has(memberId)) return "rejected";
        if (entry.nextAttemptAt > Date.now()) {
            await scheduleNextRetry(memberId).catch(() => undefined);
            return "queued";
        }

        try {
            await postDepartureAlarmScheduleReceipt(entry.payload);
            await serialize(async () => {
                await writeUnlocked(
                    memberId,
                    (await readUnlocked(memberId)).filter(
                        (candidate) => candidate.payload.receiptId !== receiptId,
                    ),
                );
            });
            await scheduleNextRetry(memberId).catch(() => undefined);
            return "sent";
        } catch (error) {
            if (isPermanentRejection(error)) {
                await serialize(async () => {
                    await writeUnlocked(
                        memberId,
                        (await readUnlocked(memberId)).filter(
                            (candidate) => candidate.payload.receiptId !== receiptId,
                        ),
                    );
                });
                await scheduleNextRetry(memberId).catch(() => undefined);
                return "rejected";
            }
            await serialize(async () => {
                const entries = await readUnlocked(memberId);
                if (blockedAccountIds.has(memberId)) {
                    await writeUnlocked(
                        memberId,
                        entries.filter((candidate) => candidate.payload.receiptId !== receiptId),
                    );
                    return;
                }
                const current = entries.find(
                    (candidate) => candidate.payload.receiptId === receiptId,
                );
                if (!current) return;
                current.attemptCount += 1;
                current.nextAttemptAt = Date.now() + retryDelay(current.attemptCount);
                await writeUnlocked(memberId, entries);
            });
            await scheduleNextRetry(memberId).catch(() => undefined);
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
            .map((entry) => entry.payload.receiptId);
    });
    const results = await Promise.all(due.map((receiptId) => attempt(memberId, receiptId)));
    await scheduleNextRetry(memberId).catch(() => undefined);
    return results.filter((result) => result === "sent").length;
}

function drainSingleFlight(memberId: number): Promise<number> {
    const existing = inFlightDrains.get(memberId);
    if (existing) {
        drainRerunRequested.add(memberId);
        return existing;
    }
    const request = (async () => {
        let sentCount = 0;
        do {
            drainRerunRequested.delete(memberId);
            sentCount += await drain(memberId);
        } while (drainRerunRequested.has(memberId) && !blockedAccountIds.has(memberId));
        return sentCount;
    })().finally(() => {
        if (inFlightDrains.get(memberId) === request) inFlightDrains.delete(memberId);
    });
    inFlightDrains.set(memberId, request);
    return request;
}

export function classifyDepartureAlarmReceiptOutcome(
    command: DepartureAlarmSyncCommand,
    result: DepartureAlarmMutationResult,
): DepartureAlarmScheduleReceiptPayload["outcome"] {
    if (command.operation === "UPSERT" && result.scheduled === true) return "SCHEDULED";
    if (command.operation === "CANCEL" && result.applied === true) return "CANCELED";
    return "FAILED";
}

function mapDeliveryMode(
    capabilities: DepartureAlarmCapabilities,
): DepartureAlarmScheduleReceiptPayload["deliveryMode"] {
    if (!capabilities.supported) return "UNKNOWN";
    if (capabilities.platform === "android") {
        return capabilities.exactAlarmAuthorized ? "ANDROID_EXACT" : "ANDROID_INEXACT";
    }
    if (capabilities.platform === "ios") {
        if (capabilities.deliveryMode === "alarmKit") return "IOS_ALARM_KIT";
        if (capabilities.deliveryMode === "timeSensitive") return "IOS_TIME_SENSITIVE";
    }
    return "UNKNOWN";
}

async function resolveDeliveryMode(): Promise<
    DepartureAlarmScheduleReceiptPayload["deliveryMode"]
> {
    if (deliveryModeInFlight) return deliveryModeInFlight;
    const request = getDepartureAlarmCapabilities()
        .then(mapDeliveryMode, () => "UNKNOWN" as const)
        .finally(() => {
            if (deliveryModeInFlight === request) deliveryModeInFlight = undefined;
        });
    deliveryModeInFlight = request;
    return request;
}

function actualDeliveryMode(
    result: DepartureAlarmMutationResult,
): DepartureAlarmScheduleReceiptPayload["deliveryMode"] | undefined {
    if (result.deliveryMode === "androidExact") return "ANDROID_EXACT";
    if (result.deliveryMode === "androidInexact") return "ANDROID_INEXACT";
    if (result.deliveryMode === "alarmKit") return "IOS_ALARM_KIT";
    if (result.deliveryMode === "timeSensitive") return "IOS_TIME_SENSITIVE";
    return undefined;
}

export async function recordDepartureAlarmScheduleReceiptDurably(
    command: DepartureAlarmSyncCommand,
    result: DepartureAlarmMutationResult,
    source: DepartureAlarmReceiptSource,
    occurredAt = new Date().toISOString(),
): Promise<DurableScheduleReceiptResult> {
    const memberId = normalizeMemberId(command.recipientMemberId);
    const scheduleId = Number(command.scheduleId);
    const platform = Platform.OS === "ios"
        ? "IOS"
        : Platform.OS === "android"
            ? "ANDROID"
            : undefined;
    if (
        !memberId ||
        !Number.isSafeInteger(scheduleId) || scheduleId <= 0 ||
        !platform ||
        !isIsoInstant(occurredAt) ||
        blockedAccountIds.has(memberId) ||
        normalizeMemberId((await getAuthMember())?.id) !== memberId
    ) return "rejected";

    try {
        const reason = result.reason?.trim().slice(0, 200) || undefined;
        const nativeDeliveryMode = actualDeliveryMode(result);
        const [deviceId, deliveryMode] = await Promise.all([
            getOrCreatePushDeviceId(),
            nativeDeliveryMode ? Promise.resolve(nativeDeliveryMode) : resolveDeliveryMode(),
        ]);
        const payload: DepartureAlarmScheduleReceiptPayload = {
            receiptId: Crypto.randomUUID(),
            alarmId: command.alarmId,
            scheduleId,
            generation: command.generation,
            recipientMemberId: memberId,
            operation: command.operation,
            ...(command.operation === "UPSERT" && command.triggerAt
                ? { triggerAt: command.triggerAt }
                : {}),
            outcome: classifyDepartureAlarmReceiptOutcome(command, result),
            applied: result.applied === true,
            scheduled: result.scheduled === true,
            ...(reason ? { reason } : {}),
            platform,
            deliveryMode,
            source,
            occurredAt,
            deviceId,
        };
        if (!(await enqueue(memberId, payload))) return "rejected";
        const targetAttempt = attempt(memberId, payload.receiptId);
        // A new receipt is also a recovery point for every older due receipt.
        drainSingleFlight(memberId).catch(() => undefined);
        return targetAttempt;
    } catch {
        return "rejected";
    }
}

export async function activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember(): Promise<number> {
    const generation = accountLifecycleGeneration;
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!memberId || generation !== accountLifecycleGeneration) return 0;
    blockedAccountIds.delete(memberId);
    return drainSingleFlight(memberId);
}

export async function clearDepartureAlarmScheduleReceiptQueueForCurrentAccount(): Promise<void> {
    const memberId = normalizeMemberId((await getAuthMember())?.id);
    if (!memberId) return;
    accountLifecycleGeneration += 1;
    blockedAccountIds.add(memberId);
    cancelRetryTimer(memberId);
    await serialize(() => AsyncStorage.removeItem(storageKey(memberId)));
}

export function resetDepartureAlarmScheduleReceiptQueueForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    storageTail = Promise.resolve();
    accountLifecycleGeneration = 0;
    blockedAccountIds.clear();
    inFlightAttempts.clear();
    inFlightDrains.clear();
    drainRerunRequested.clear();
    retryTimers.forEach((timer) => clearTimeout(timer));
    retryTimers.clear();
    retryTimerRevisions.clear();
    deliveryModeInFlight = undefined;
}

export const DEPARTURE_ALARM_RECEIPT_QUEUE_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        storageKeyForMember: storageKey,
        maximumSize: MAX_ENTRIES_PER_ACCOUNT,
        retryDelaysMs: RETRY_DELAYS_MS,
    }
    : undefined;

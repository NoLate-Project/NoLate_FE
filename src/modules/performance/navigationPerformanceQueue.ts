import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import {
    postNavigationPerformanceEvents,
    type NavigationPerformanceCompletionKind,
    type NavigationPerformanceEventPayload,
    type NavigationPerformancePlatform,
} from "../../api/performance";
import { getAuthMember } from "../auth/authStorage";
import type { NavigationPerformanceEntry } from "./navigationPerformance";

const QUEUE_STORAGE_KEY_PREFIX = "nolate_navigation_performance_queue_v1:";
const QUEUE_SCHEMA_VERSION = 1;
const MAX_QUEUE_SIZE = 200;
const BATCH_SIZE = 50;
const IMMEDIATE_DRAIN_SIZE = 8;
const BATCH_DELAY_MS = 5_000;
const RETRY_DELAY_MS = 30_000;

type QueueEnvelope = {
    version: typeof QUEUE_SCHEMA_VERSION;
    events: NavigationPerformanceEventPayload[];
};

let storageOperationTail: Promise<void> = Promise.resolve();
let activeMemberId: number | undefined;
let lifecycleGeneration = 0;
let drainInFlight: Promise<number> | undefined;
let drainTimer: ReturnType<typeof setTimeout> | undefined;

const STATIC_ROUTES = new Set([
    "/",
    "/auth/login",
    "/auth/signup",
    "/onboarding/calendar-import",
    "/schedule",
    "/schedule/calendars",
    "/schedule/categories",
    "/schedule/route-select",
    "/schedule/route-planner",
    "/profile",
    "/settings/places",
    "/notifications",
    "/share/inbox",
    "/share/blocked",
    "/share/reports",
    "/legal/terms-of-service",
    "/legal/privacy-policy",
    "/legal/privacy-collection-consent",
    "/internal/quick-schedule-benchmark",
]);

function normalizedMemberId(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

function queueStorageKey(memberId: number) {
    return `${QUEUE_STORAGE_KEY_PREFIX}${memberId}`;
}

/** Never persist schedule ids, invitation tokens, query parameters, or fragments. */
export function canonicalizeNavigationRoute(route: string): string {
    const pathname = route.trim().split(/[?#]/, 1)[0] || "/";
    if (STATIC_ROUTES.has(pathname)) return pathname;
    if (/^\/schedule\/[^/]+$/.test(pathname)) return "/schedule/[id]";
    if (/^\/share\/[^/]+$/.test(pathname)) return "/share/[token]";

    const safeSegments = pathname
        .split("/")
        .filter(Boolean)
        .map((segment) => {
            if (/^\d+$/.test(segment)) return "[id]";
            if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return "[id]";
            if (/^[a-z0-9_-]{1,30}$/i.test(segment)) return segment;
            return "[dynamic]";
        });
    const safePath = `/${safeSegments.join("/")}`;
    return safePath.length <= 80 ? safePath : "/[dynamic]";
}

function currentPlatform(): NavigationPerformancePlatform {
    if (Platform.OS === "ios") return "IOS";
    if (Platform.OS === "android") return "ANDROID";
    return "WEB";
}

function completionKind(
    value: NavigationPerformanceEntry["completedBy"],
): NavigationPerformanceCompletionKind {
    if (value === "transition") return "TRANSITION";
    if (value === "next-navigation") return "NEXT_NAVIGATION";
    return "FRAME";
}

function toPayload(entry: NavigationPerformanceEntry): NavigationPerformanceEventPayload {
    const appVersion = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version;
    const buildVersion = Constants.nativeBuildVersion ??
        Constants.expoConfig?.ios?.buildNumber ??
        Constants.expoConfig?.android?.versionCode;
    return {
        eventId: Crypto.randomUUID(),
        fromRoute: canonicalizeNavigationRoute(entry.fromRoute),
        toRoute: canonicalizeNavigationRoute(entry.toRoute),
        action: entry.action.trim().toUpperCase().slice(0, 30) || "UNKNOWN",
        routeReadyMs: Math.min(120_000, Math.max(0, Math.round(entry.routeReadyMs))),
        totalMs: Math.min(120_000, Math.max(0, Math.round(entry.totalMs))),
        completionKind: completionKind(entry.completedBy),
        platform: currentPlatform(),
        ...(appVersion ? { appVersion: String(appVersion).slice(0, 32) } : {}),
        ...(buildVersion !== undefined && buildVersion !== null
            ? { buildVersion: String(buildVersion).slice(0, 32) }
            : {}),
        occurredAt: new Date(entry.startedAtEpochMs).toISOString(),
    };
}

function isStoredEvent(value: unknown): value is NavigationPerformanceEventPayload {
    if (!value || typeof value !== "object") return false;
    const event = value as Partial<NavigationPerformanceEventPayload>;
    return (
        typeof event.eventId === "string" &&
        typeof event.fromRoute === "string" &&
        typeof event.toRoute === "string" &&
        typeof event.action === "string" &&
        typeof event.routeReadyMs === "number" &&
        typeof event.totalMs === "number" &&
        typeof event.occurredAt === "string" &&
        ["TRANSITION", "FRAME", "NEXT_NAVIGATION"].includes(event.completionKind ?? "") &&
        ["IOS", "ANDROID", "WEB"].includes(event.platform ?? "")
    );
}

function parseQueue(raw: string | null): NavigationPerformanceEventPayload[] {
    if (!raw) return [];
    try {
        const envelope = JSON.parse(raw) as Partial<QueueEnvelope>;
        if (envelope.version !== QUEUE_SCHEMA_VERSION || !Array.isArray(envelope.events)) {
            return [];
        }
        const unique = new Map<string, NavigationPerformanceEventPayload>();
        envelope.events.forEach((event) => {
            if (isStoredEvent(event) && !unique.has(event.eventId)) {
                unique.set(event.eventId, event);
            }
        });
        return Array.from(unique.values()).slice(-MAX_QUEUE_SIZE);
    } catch {
        return [];
    }
}

function runSerializedStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = storageOperationTail.then(operation, operation);
    storageOperationTail = result.then(() => undefined, () => undefined);
    return result;
}

async function readQueue(memberId: number) {
    return parseQueue(await AsyncStorage.getItem(queueStorageKey(memberId)));
}

async function writeQueue(memberId: number, events: NavigationPerformanceEventPayload[]) {
    const key = queueStorageKey(memberId);
    if (!events.length) {
        await AsyncStorage.removeItem(key);
        return;
    }
    const envelope: QueueEnvelope = {
        version: QUEUE_SCHEMA_VERSION,
        events: events.slice(-MAX_QUEUE_SIZE),
    };
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
}

function cancelDrainTimer() {
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = undefined;
}

function scheduleDrain(memberId: number, delayMs: number) {
    if (activeMemberId !== memberId || drainTimer) return;
    drainTimer = setTimeout(() => {
        drainTimer = undefined;
        drainNavigationPerformanceQueue().catch(() => undefined);
    }, delayMs);
}

async function runDrain(memberId: number): Promise<number> {
    const batch = await runSerializedStorageOperation(async () =>
        (await readQueue(memberId)).slice(0, BATCH_SIZE)
    );
    if (!batch.length || activeMemberId !== memberId) return 0;

    try {
        await postNavigationPerformanceEvents(batch);
        const sentIds = new Set(batch.map((event) => event.eventId));
        await runSerializedStorageOperation(async () => {
            const current = await readQueue(memberId);
            await writeQueue(memberId, current.filter((event) => !sentIds.has(event.eventId)));
        });
        const remaining = await runSerializedStorageOperation(() => readQueue(memberId));
        if (remaining.length) scheduleDrain(memberId, BATCH_DELAY_MS);
        return batch.length;
    } catch {
        scheduleDrain(memberId, RETRY_DELAY_MS);
        return 0;
    }
}

export function drainNavigationPerformanceQueue(): Promise<number> {
    const memberId = activeMemberId;
    if (!memberId) return Promise.resolve(0);
    if (drainInFlight) return drainInFlight;
    cancelDrainTimer();
    const request = runDrain(memberId).finally(() => {
        if (drainInFlight === request) drainInFlight = undefined;
    });
    drainInFlight = request;
    return request;
}

export async function recordNavigationPerformance(
    entry: NavigationPerformanceEntry,
): Promise<boolean> {
    const generation = lifecycleGeneration;
    const memberId = activeMemberId ?? normalizedMemberId((await getAuthMember())?.id);
    if (!memberId || generation !== lifecycleGeneration) return false;
    activeMemberId = memberId;
    const payload = toPayload(entry);
    const queueSize = await runSerializedStorageOperation(async () => {
        if (generation !== lifecycleGeneration || activeMemberId !== memberId) return 0;
        const current = await readQueue(memberId);
        await writeQueue(memberId, [...current, payload]);
        return Math.min(MAX_QUEUE_SIZE, current.length + 1);
    });
    if (!queueSize) return false;
    scheduleDrain(memberId, queueSize >= IMMEDIATE_DRAIN_SIZE ? 0 : BATCH_DELAY_MS);
    return true;
}

export async function activateNavigationPerformanceQueue(): Promise<number> {
    const generation = lifecycleGeneration;
    const memberId = normalizedMemberId((await getAuthMember())?.id);
    if (!memberId || generation !== lifecycleGeneration) return 0;
    activeMemberId = memberId;
    return drainNavigationPerformanceQueue();
}

export function deactivateNavigationPerformanceQueue() {
    activeMemberId = undefined;
    cancelDrainTimer();
}

export async function clearNavigationPerformanceQueueForCurrentAccount(): Promise<void> {
    const memberId = activeMemberId ?? normalizedMemberId((await getAuthMember())?.id);
    lifecycleGeneration += 1;
    activeMemberId = undefined;
    cancelDrainTimer();
    if (memberId) {
        await runSerializedStorageOperation(() =>
            AsyncStorage.removeItem(queueStorageKey(memberId))
        );
    }
}

export function resetNavigationPerformanceQueueForTests() {
    if (process.env.NODE_ENV !== "test") return;
    storageOperationTail = Promise.resolve();
    activeMemberId = undefined;
    lifecycleGeneration = 0;
    drainInFlight = undefined;
    cancelDrainTimer();
}

export const NAVIGATION_PERFORMANCE_QUEUE_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? {
        batchSize: BATCH_SIZE,
        maximumSize: MAX_QUEUE_SIZE,
        storageKeyForMember: queueStorageKey,
    }
    : undefined;

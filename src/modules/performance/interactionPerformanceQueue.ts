import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import {
  postInteractionPerformanceEvents,
  INTERACTION_PERFORMANCE_OPERATIONS,
  type InteractionPerformanceEventPayload,
  type InteractionPerformanceOperation,
  type NavigationPerformancePlatform,
} from '../../api/performance';
import { getAuthMember } from '../auth/authStorage';
import type { InteractionPerformanceMeasurement } from './interactionPerformance';
import { canonicalizeNavigationRoute } from './navigationPerformanceQueue';

const QUEUE_STORAGE_KEY_PREFIX = 'nolate_interaction_performance_queue_v1:';
const QUEUE_SCHEMA_VERSION = 1;
const MAX_QUEUE_SIZE = 200;
const BATCH_SIZE = 50;
const IMMEDIATE_DRAIN_SIZE = 8;
const BATCH_DELAY_MS = 5_000;
const RETRY_DELAY_MS = 30_000;

type QueueEnvelope = {
  version: typeof QUEUE_SCHEMA_VERSION;
  events: InteractionPerformanceEventPayload[];
};

let storageOperationTail: Promise<void> = Promise.resolve();
let activeMemberId: number | undefined;
let lifecycleGeneration = 0;
let drainInFlight: Promise<number> | undefined;
let drainTimer: ReturnType<typeof setTimeout> | undefined;

function normalizedMemberId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function queueStorageKey(memberId: number) {
  return `${QUEUE_STORAGE_KEY_PREFIX}${memberId}`;
}

function currentPlatform(): NavigationPerformancePlatform {
  if (Platform.OS === 'ios') return 'IOS';
  if (Platform.OS === 'android') return 'ANDROID';
  return 'WEB';
}

const allowedOperations = new Set<string>(INTERACTION_PERFORMANCE_OPERATIONS);

function normalizeOperation(
  value: string,
): InteractionPerformanceOperation | undefined {
  const normalized = value.trim().toLowerCase();
  return allowedOperations.has(normalized)
    ? (normalized as InteractionPerformanceOperation)
    : undefined;
}

function toPayload(
  measurement: InteractionPerformanceMeasurement,
): InteractionPerformanceEventPayload | undefined {
  const operation = normalizeOperation(measurement.operation);
  if (!operation) return undefined;
  const appVersion =
    Constants.nativeApplicationVersion ?? Constants.expoConfig?.version;
  const buildVersion =
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode;
  return {
    eventId: Crypto.randomUUID(),
    route: canonicalizeNavigationRoute(measurement.route),
    operation,
    kind: measurement.kind,
    outcome: measurement.outcome,
    durationMs: Math.min(
      120_000,
      Math.max(0, Math.round(measurement.durationMs)),
    ),
    platform: currentPlatform(),
    ...(appVersion ? { appVersion: String(appVersion).slice(0, 32) } : {}),
    ...(buildVersion !== undefined && buildVersion !== null
      ? { buildVersion: String(buildVersion).slice(0, 32) }
      : {}),
    occurredAt: new Date(measurement.startedAtEpochMs).toISOString(),
  };
}

function isStoredEvent(
  value: unknown,
): value is InteractionPerformanceEventPayload {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<InteractionPerformanceEventPayload>;
  return (
    typeof event.eventId === 'string' &&
    typeof event.route === 'string' &&
    typeof event.operation === 'string' &&
    allowedOperations.has(event.operation) &&
    typeof event.durationMs === 'number' &&
    Number.isInteger(event.durationMs) &&
    event.durationMs >= 0 &&
    event.durationMs <= 120_000 &&
    typeof event.occurredAt === 'string' &&
    ['CONTENT_READY', 'INTERACTION', 'NETWORK'].includes(event.kind ?? '') &&
    ['SUCCESS', 'ERROR', 'CANCELLED'].includes(event.outcome ?? '') &&
    ['IOS', 'ANDROID', 'WEB'].includes(event.platform ?? '')
  );
}

function parseQueue(raw: string | null): InteractionPerformanceEventPayload[] {
  if (!raw) return [];
  try {
    const envelope = JSON.parse(raw) as Partial<QueueEnvelope>;
    if (
      envelope.version !== QUEUE_SCHEMA_VERSION ||
      !Array.isArray(envelope.events)
    ) {
      return [];
    }
    const unique = new Map<string, InteractionPerformanceEventPayload>();
    envelope.events.forEach(event => {
      if (isStoredEvent(event) && !unique.has(event.eventId)) {
        unique.set(event.eventId, event);
      }
    });
    return Array.from(unique.values()).slice(-MAX_QUEUE_SIZE);
  } catch {
    return [];
  }
}

function runSerializedStorageOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = storageOperationTail.then(operation, operation);
  storageOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readQueue(memberId: number) {
  return parseQueue(await AsyncStorage.getItem(queueStorageKey(memberId)));
}

async function writeQueue(
  memberId: number,
  events: InteractionPerformanceEventPayload[],
) {
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
    drainInteractionPerformanceQueue().catch(() => undefined);
  }, delayMs);
}

async function runDrain(memberId: number): Promise<number> {
  const batch = await runSerializedStorageOperation(async () =>
    (await readQueue(memberId)).slice(0, BATCH_SIZE),
  );
  if (!batch.length || activeMemberId !== memberId) return 0;

  try {
    await postInteractionPerformanceEvents(batch);
    const sentIds = new Set(batch.map(event => event.eventId));
    await runSerializedStorageOperation(async () => {
      const current = await readQueue(memberId);
      await writeQueue(
        memberId,
        current.filter(event => !sentIds.has(event.eventId)),
      );
    });
    const remaining = await runSerializedStorageOperation(() =>
      readQueue(memberId),
    );
    if (remaining.length) scheduleDrain(memberId, BATCH_DELAY_MS);
    return batch.length;
  } catch {
    scheduleDrain(memberId, RETRY_DELAY_MS);
    return 0;
  }
}

export function drainInteractionPerformanceQueue(): Promise<number> {
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

export async function recordInteractionPerformance(
  measurement: InteractionPerformanceMeasurement,
): Promise<boolean> {
  const generation = lifecycleGeneration;
  const memberId =
    activeMemberId ?? normalizedMemberId((await getAuthMember())?.id);
  if (!memberId || generation !== lifecycleGeneration) return false;
  activeMemberId = memberId;
  const payload = toPayload(measurement);
  if (!payload) return false;
  const queueSize = await runSerializedStorageOperation(async () => {
    if (generation !== lifecycleGeneration || activeMemberId !== memberId)
      return 0;
    const current = await readQueue(memberId);
    await writeQueue(memberId, [...current, payload]);
    return Math.min(MAX_QUEUE_SIZE, current.length + 1);
  });
  if (!queueSize) return false;
  scheduleDrain(
    memberId,
    queueSize >= IMMEDIATE_DRAIN_SIZE ? 0 : BATCH_DELAY_MS,
  );
  return true;
}

export async function activateInteractionPerformanceQueue(): Promise<number> {
  const generation = lifecycleGeneration;
  const memberId = normalizedMemberId((await getAuthMember())?.id);
  if (!memberId || generation !== lifecycleGeneration) return 0;
  activeMemberId = memberId;
  return drainInteractionPerformanceQueue();
}

export function deactivateInteractionPerformanceQueue() {
  activeMemberId = undefined;
  cancelDrainTimer();
}

export async function clearInteractionPerformanceQueueForCurrentAccount(): Promise<void> {
  const memberId =
    activeMemberId ?? normalizedMemberId((await getAuthMember())?.id);
  lifecycleGeneration += 1;
  activeMemberId = undefined;
  cancelDrainTimer();
  if (memberId) {
    await runSerializedStorageOperation(() =>
      AsyncStorage.removeItem(queueStorageKey(memberId)),
    );
  }
}

export function resetInteractionPerformanceQueueForTests() {
  if (process.env.NODE_ENV !== 'test') return;
  storageOperationTail = Promise.resolve();
  activeMemberId = undefined;
  lifecycleGeneration = 0;
  drainInFlight = undefined;
  cancelDrainTimer();
}

export const INTERACTION_PERFORMANCE_QUEUE_TEST_CONSTANTS =
  process.env.NODE_ENV === 'test'
    ? {
        storageKeyForMember: queueStorageKey,
      }
    : undefined;

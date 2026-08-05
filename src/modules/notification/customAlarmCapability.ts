import * as Crypto from "expo-crypto";

import type { NoLateCustomAlarmNavigationTarget } from "./customAlarmNavigation";

export type NoLateCustomAlarmCapabilityIdentity = Pick<
    NoLateCustomAlarmNavigationTarget,
    | "alarmId"
    | "isPreview"
    | "requestedAction"
    | "previewId"
    | "scheduleId"
    | "notificationIdentifier"
    | "nativeAlarmId"
    | "recipientMemberId"
    | "alarmGeneration"
    | "actionEventKey"
    | "occurrenceId"
> & {
    capabilityId?: string;
};

type StoredCapability = {
    target: NoLateCustomAlarmNavigationTarget & { capabilityId: string };
    fingerprint: string;
    expiresAt: number;
    claimed: boolean;
};

const CAPABILITY_TTL_MS = 30 * 60 * 1_000;
const MAX_CAPABILITIES = 24;
const capabilities = new Map<string, StoredCapability>();

/**
 * Issues an in-process, unguessable capability only after native notification metadata was parsed.
 * Route query parameters alone can therefore display only the inert fallback screen.
 */
export function issueNoLateCustomAlarmCapability(
    target: NoLateCustomAlarmNavigationTarget,
): NoLateCustomAlarmNavigationTarget & { capabilityId: string } {
    cleanupExpiredCapabilities();
    const capabilityId = Crypto.randomUUID();
    const authorizedTarget = { ...target, capabilityId };
    capabilities.set(capabilityId, {
        target: authorizedTarget,
        fingerprint: capabilityFingerprint(authorizedTarget),
        expiresAt: Date.now() + CAPABILITY_TTL_MS,
        claimed: false,
    });
    trimOldestCapabilities();
    return authorizedTarget;
}

export function hasNoLateCustomAlarmCapability(
    identity: NoLateCustomAlarmCapabilityIdentity,
): boolean {
    const capability = getMatchingCapability(identity);
    return capability !== undefined;
}

/** Atomically prevents two mounted alarm routes from performing the same mutation. */
export function claimNoLateCustomAlarmCapability(
    identity: NoLateCustomAlarmCapabilityIdentity,
): (NoLateCustomAlarmNavigationTarget & { capabilityId: string }) | undefined {
    const capability = getMatchingCapability(identity);
    if (!capability || capability.claimed) return undefined;
    capability.claimed = true;
    return capability.target;
}

export function releaseNoLateCustomAlarmCapability(capabilityId: string): void {
    const capability = capabilities.get(capabilityId);
    if (capability) capability.claimed = false;
}

export function consumeNoLateCustomAlarmCapability(capabilityId: string): void {
    capabilities.delete(capabilityId);
}

/** Test-only reset prevents one route test from authorizing another. */
export function resetNoLateCustomAlarmCapabilitiesForTests(): void {
    if (process.env.NODE_ENV === "test") capabilities.clear();
}

function getMatchingCapability(
    identity: NoLateCustomAlarmCapabilityIdentity,
): StoredCapability | undefined {
    cleanupExpiredCapabilities();
    if (!identity.capabilityId) return undefined;
    const capability = capabilities.get(identity.capabilityId);
    if (!capability) return undefined;
    return capability.fingerprint === capabilityFingerprint(identity)
        ? capability
        : undefined;
}

function capabilityFingerprint(identity: NoLateCustomAlarmCapabilityIdentity): string {
    return JSON.stringify([
        identity.alarmId,
        identity.isPreview,
        identity.requestedAction,
        identity.previewId ?? null,
        identity.scheduleId ?? null,
        identity.notificationIdentifier ?? null,
        identity.nativeAlarmId ?? null,
        identity.recipientMemberId ?? null,
        identity.alarmGeneration ?? null,
        identity.actionEventKey ?? null,
        identity.occurrenceId ?? null,
    ]);
}

function cleanupExpiredCapabilities(now = Date.now()): void {
    for (const [capabilityId, capability] of capabilities) {
        if (capability.expiresAt <= now) capabilities.delete(capabilityId);
    }
}

function trimOldestCapabilities(): void {
    while (capabilities.size > MAX_CAPABILITIES) {
        const oldest = capabilities.keys().next().value as string | undefined;
        if (!oldest) return;
        capabilities.delete(oldest);
    }
}

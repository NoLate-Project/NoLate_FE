import * as SecureStore from "../storage/secureStorage";

import type {
    ShareInbox,
    ShareInboxItem,
    SharePendingInvitation,
    ShareResourceType,
} from "../../api/scheduleSharing";
import { isScheduleSharingEnabled } from "./scheduleSharingPolicy";

const SHARE_ATTENTION_SEEN_KEY = "nolate.shareAttention.seenKeys.v1";
const MAX_SEEN_SHARE_KEYS = 240;

export type ShareAttentionKind = "INVITATION" | "SHARE";

export type ShareAttentionEntry = {
    key: string;
    kind: ShareAttentionKind;
    resourceType: ShareResourceType;
    title: string;
    ownerEmail?: string | null;
    timestamp: number;
};

export type ShareAttentionSummary = {
    pendingInvitationCount: number;
    receivedShareCount: number;
    totalCount: number;
    unseenCount: number;
    latest?: ShareAttentionEntry;
    latestUnseen?: ShareAttentionEntry;
};

type ShareAttentionPollingOptions = {
    enabled?: boolean;
    intervalMs: number;
    load: () => Promise<ShareAttentionSummary>;
    onSummary: (summary: ShareAttentionSummary) => void;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
};

export function startScheduleShareAttentionPolling({
    enabled = isScheduleSharingEnabled(),
    intervalMs,
    load,
    onSummary,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
}: ShareAttentionPollingOptions): () => void {
    // Do not even schedule a dormant poll: old builds may still have cached
    // attention, and a hidden network loop would undermine the global gate.
    if (!enabled) return () => undefined;

    let cancelled = false;
    const refresh = () => {
        load()
            .then((summary) => {
                if (!cancelled) onSummary(summary);
            })
            .catch(() => {
                // Attention is only a hint; an enabled rollout keeps calendar
                // use available when this optional request temporarily fails.
            });
    };

    refresh();
    const timer = setIntervalFn(refresh, intervalMs);

    return () => {
        cancelled = true;
        clearIntervalFn(timer);
    };
}

function parseTimestamp(value?: string | null) {
    if (!value) return 0;

    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function invitationToEntry(invitation: SharePendingInvitation): ShareAttentionEntry {
    return {
        key: `invitation:${invitation.id}`,
        kind: "INVITATION",
        resourceType: invitation.resourceType,
        title: invitation.title,
        ownerEmail: invitation.ownerEmail,
        timestamp: 0,
    };
}

function shareToEntry(share: ShareInboxItem): ShareAttentionEntry {
    return {
        key: `share:${share.shareId}`,
        kind: "SHARE",
        resourceType: share.resourceType,
        title: share.title,
        ownerEmail: share.ownerEmail,
        timestamp: parseTimestamp(share.sharedAt),
    };
}

function sortAttentionEntries(a: ShareAttentionEntry, b: ShareAttentionEntry) {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return a.key.localeCompare(b.key);
}

function uniqueKeys(keys: readonly string[]) {
    const seen = new Set<string>();
    const normalized: string[] = [];

    keys.forEach((key) => {
        if (typeof key !== "string") return;
        const trimmed = key.trim();
        if (!trimmed || seen.has(trimmed)) return;

        seen.add(trimmed);
        normalized.push(trimmed);
    });

    return normalized;
}

export function getShareAttentionEntries(inbox: ShareInbox): ShareAttentionEntry[] {
    if (!isScheduleSharingEnabled()) return [];
    return [
        ...inbox.pendingInvitations.map(invitationToEntry),
        ...inbox.receivedShares.map(shareToEntry),
    ].sort(sortAttentionEntries);
}

export function getShareAttentionKeys(inbox: ShareInbox): string[] {
    return getShareAttentionEntries(inbox).map((entry) => entry.key);
}

export function buildShareAttentionSummary(
    inbox: ShareInbox,
    seenKeys: readonly string[] = []
): ShareAttentionSummary {
    if (!isScheduleSharingEnabled()) {
        return {
            pendingInvitationCount: 0,
            receivedShareCount: 0,
            totalCount: 0,
            unseenCount: 0,
        };
    }
    const entries = getShareAttentionEntries(inbox);
    const seenKeySet = new Set(uniqueKeys(seenKeys));
    const unseenEntries = entries.filter((entry) => !seenKeySet.has(entry.key));

    return {
        pendingInvitationCount: inbox.pendingInvitations.length,
        receivedShareCount: inbox.receivedShares.length,
        totalCount: entries.length,
        unseenCount: unseenEntries.length,
        latest: entries[0],
        latestUnseen: unseenEntries[0],
    };
}

export async function readSeenShareAttentionKeys(): Promise<string[]> {
    if (!isScheduleSharingEnabled()) {
        // Seen keys are account-owned durable data. Clear them on an off-build
        // bootstrap so an upgrade or later account switch cannot revive a badge.
        await clearSeenShareAttention().catch(() => undefined);
        return [];
    }
    try {
        const raw = await SecureStore.getItemAsync(SHARE_ATTENTION_SEEN_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? uniqueKeys(parsed) : [];
    } catch {
        return [];
    }
}

export async function markShareInboxSeen(inbox: ShareInbox): Promise<void> {
    if (!isScheduleSharingEnabled()) {
        await clearSeenShareAttention().catch(() => undefined);
        return;
    }
    const currentKeys = await readSeenShareAttentionKeys();
    const nextKeys = uniqueKeys([...currentKeys, ...getShareAttentionKeys(inbox)])
        .slice(-MAX_SEEN_SHARE_KEYS);

    if (nextKeys.length === 0) return;

    await SecureStore.setItemAsync(SHARE_ATTENTION_SEEN_KEY, JSON.stringify(nextKeys));
}

export async function clearSeenShareAttention(): Promise<void> {
    await SecureStore.deleteItemAsync(SHARE_ATTENTION_SEEN_KEY);
}

export async function clearDormantScheduleSharingAttention(): Promise<void> {
    if (isScheduleSharingEnabled()) return;
    await clearSeenShareAttention();
}

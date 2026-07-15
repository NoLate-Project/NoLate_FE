import * as SecureStore from "../storage/secureStorage";

import type {
    ShareInbox,
    ShareInboxItem,
    SharePendingInvitation,
    ShareResourceType,
} from "../../api/scheduleSharing";

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
    const currentKeys = await readSeenShareAttentionKeys();
    const nextKeys = uniqueKeys([...currentKeys, ...getShareAttentionKeys(inbox)])
        .slice(-MAX_SEEN_SHARE_KEYS);

    if (nextKeys.length === 0) return;

    await SecureStore.setItemAsync(SHARE_ATTENTION_SEEN_KEY, JSON.stringify(nextKeys));
}

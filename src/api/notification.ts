import type { AxiosRequestConfig } from "axios";
import { apiGet, apiPatch, apiPost } from "./api";
import { assertApiSuccess, unwrapApiResponse, type ApiEnvelope } from "./response";
import {
    filterStoredNotificationsForSharingPolicy,
    isScheduleSharingEnabled,
} from "../modules/share/scheduleSharingPolicy";

export type PushPlatform = "IOS" | "ANDROID" | "WEB";

type RegisterPushTokenPayload = {
    memberId?: number;
    deviceId?: string;
    platform: PushPlatform;
    token: string;
};

export type AppNotification = {
    id: number;
    type: string;
    scheduleId: number | null;
    categoryId: number | null;
    title: string;
    body: string;
    data: Record<string, string>;
    read: boolean;
    readAt: string | null;
    createdAt: string;
};

export type AppNotificationInbox = {
    items: AppNotification[];
    nextCursor: number | null;
    unreadCount: number;
};

export type AppNotificationInboxQuery = {
    cursorId?: number;
    limit?: number;
    unreadOnly?: boolean;
};

type AppNotificationUnreadCountResponse = {
    unreadCount: number;
};

type AppNotificationMarkAllReadResponse = {
    updatedCount: number;
};

const OFF_POLICY_NOTIFICATION_PAGE_SIZE = 100;
const MAX_OFF_POLICY_NOTIFICATION_PAGES = 100;

export function filterAppNotificationInboxForSharingPolicy(
    inbox: AppNotificationInbox,
): AppNotificationInbox {
    if (isScheduleSharingEnabled()) return inbox;
    const items = filterStoredNotificationsForSharingPolicy(inbox.items);
    return {
        ...inbox,
        items,
        // The aggregate count cannot prove which rows are owner-only. Recompute
        // from policy-visible rows so stale servers and cached pages stay safe.
        unreadCount: items.filter((item) => !item.read).length,
    };
}

export async function registerPushToken(
    payload: RegisterPushTokenPayload,
    options: Pick<AxiosRequestConfig, "signal"> = {},
): Promise<void> {
    const response = options.signal
        ? await apiPost<ApiEnvelope<null>, RegisterPushTokenPayload>(
            "/api/notifications/token",
            payload,
            { signal: options.signal },
        )
        : await apiPost<ApiEnvelope<null>, RegisterPushTokenPayload>(
            "/api/notifications/token",
            payload,
        );
    assertApiSuccess(response);
}

export async function getAppNotificationInbox(
    query: AppNotificationInboxQuery = {},
): Promise<AppNotificationInbox> {
    const params: Record<string, number | boolean> = {
        limit: query.limit ?? 30,
        unreadOnly: query.unreadOnly ?? false,
    };
    if (query.cursorId !== undefined) params.cursorId = query.cursorId;

    const response = await apiGet<ApiEnvelope<AppNotificationInbox>>(
        "/api/notifications/inbox",
        { params },
    );
    return filterAppNotificationInboxForSharingPolicy(
        unwrapApiResponse(response),
    );
}

export async function getAppNotificationUnreadCount(): Promise<number> {
    if (!isScheduleSharingEnabled()) {
        let cursorId: number | undefined;
        let unreadCount = 0;
        const seenCursors = new Set<number>();

        // The aggregate endpoint mixes dormant sharing rows with owner rows.
        // Walk unread pages so hidden rows cannot mask a later owner alert.
        for (
            let pageIndex = 0;
            pageIndex < MAX_OFF_POLICY_NOTIFICATION_PAGES;
            pageIndex += 1
        ) {
            const params: Record<string, number | boolean> = {
                limit: OFF_POLICY_NOTIFICATION_PAGE_SIZE,
                unreadOnly: true,
            };
            if (cursorId !== undefined) params.cursorId = cursorId;
            const response = await apiGet<ApiEnvelope<AppNotificationInbox>>(
                "/api/notifications/inbox",
                { params },
            );
            const page = filterAppNotificationInboxForSharingPolicy(
                unwrapApiResponse(response),
            );
            unreadCount += page.items.filter((item) => !item.read).length;

            const nextCursor = page.nextCursor;
            if (nextCursor === null) return unreadCount;
            if (
                !Number.isSafeInteger(nextCursor)
                || nextCursor <= 0
                || seenCursors.has(nextCursor)
            ) return unreadCount;
            seenCursors.add(nextCursor);
            cursorId = nextCursor;
        }
        return unreadCount;
    }
    const response = await apiGet<ApiEnvelope<AppNotificationUnreadCountResponse>>(
        "/api/notifications/unread-count",
    );
    return unwrapApiResponse(response).unreadCount;
}

export async function markAppNotificationRead(id: number): Promise<AppNotification> {
    const response = await apiPatch<ApiEnvelope<AppNotification>>(
        `/api/notifications/${id}/read`,
    );
    return unwrapApiResponse(response);
}

export async function markAllAppNotificationsRead(): Promise<number> {
    const response = await apiPatch<ApiEnvelope<AppNotificationMarkAllReadResponse>>(
        "/api/notifications/read-all",
    );
    return unwrapApiResponse(response).updatedCount;
}

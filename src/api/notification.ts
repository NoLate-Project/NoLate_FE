import { apiGet, apiPatch, apiPost } from "./api";
import { assertApiSuccess, unwrapApiResponse, type ApiEnvelope } from "./response";

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

export async function registerPushToken(payload: RegisterPushTokenPayload): Promise<void> {
    const response = await apiPost<ApiEnvelope<null>, RegisterPushTokenPayload>("/api/notifications/token", payload);
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
    return unwrapApiResponse(response);
}

export async function getAppNotificationUnreadCount(): Promise<number> {
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

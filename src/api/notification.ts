import { apiGet, apiPatch, apiPost } from "./api";
import { assertApiSuccess, unwrapApiResponse, type ApiEnvelope } from "./response";

export type PushPlatform = "IOS" | "ANDROID" | "WEB";

export type NotificationDeliveryAckStage =
    | "RECEIVED"
    | "PRESENTED"
    | "ALARM_SCHEDULED"
    | "ALARM_FIRED"
    | "ACTIONED";

export type NotificationDeliveryAckPayload = {
    logicalEventKey: string;
    deviceId: string;
    stage: NotificationDeliveryAckStage;
    occurredAt: string;
    providerMessageId?: string;
    alarmId?: string;
    actionIdentifier?: string;
};

export type DepartureAlarmFiredEventPayload = {
    eventId: string;
    alarmId: string;
    scheduleId: number;
    generation: number;
    recipientMemberId: number;
    scheduledFor: string;
    sourceTriggerAt?: string;
    occurredAt: string;
    timingBasis: "EXACT_CALLBACK" | "OBSERVED_ALERTING" | "INFERRED_OS_DELIVERY";
    deviceId: string;
};

export type DepartureAlarmScheduleReceiptPayload = {
    receiptId: string;
    alarmId: string;
    scheduleId: number;
    generation: number;
    recipientMemberId: number;
    operation: "UPSERT" | "CANCEL";
    triggerAt?: string;
    outcome: "SCHEDULED" | "CANCELED" | "FAILED";
    applied: boolean;
    scheduled: boolean;
    reason?: string;
    platform: "IOS" | "ANDROID";
    deliveryMode:
        | "ANDROID_EXACT"
        | "ANDROID_INEXACT"
        | "IOS_ALARM_KIT"
        | "IOS_TIME_SENSITIVE"
        | "UNKNOWN";
    source: "PUSH" | "SNAPSHOT";
    occurredAt: string;
    deviceId: string;
};

export type RegisterPushTokenPayload = {
    memberId?: number;
    deviceId?: string;
    platform: PushPlatform;
    token: string;
    deliveryAckCapabilityVersion: 1;
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

type DepartureAlarmSnapshotResponse = {
    commands: unknown;
};

export async function registerPushToken(payload: RegisterPushTokenPayload): Promise<void> {
    const response = await apiPost<ApiEnvelope<null>, RegisterPushTokenPayload>("/api/notifications/token", payload);
    assertApiSuccess(response);
}

export async function postNotificationDeliveryAck(
    payload: NotificationDeliveryAckPayload,
): Promise<void> {
    const response = await apiPost<ApiEnvelope<null>, NotificationDeliveryAckPayload>(
        "/api/notifications/delivery-acks",
        payload,
    );
    assertApiSuccess(response);
}

export async function postDepartureAlarmFiredEvent(
    payload: DepartureAlarmFiredEventPayload,
): Promise<void> {
    const response = await apiPost<ApiEnvelope<null>, DepartureAlarmFiredEventPayload>(
        "/api/notifications/departure-alarm-fired-events",
        payload,
    );
    assertApiSuccess(response);
}

export async function postDepartureAlarmScheduleReceipt(
    payload: DepartureAlarmScheduleReceiptPayload,
): Promise<void> {
    const response = await apiPost<ApiEnvelope<null>, DepartureAlarmScheduleReceiptPayload>(
        "/api/notifications/departure-alarm-schedule-receipts",
        payload,
    );
    assertApiSuccess(response);
}

export async function getDepartureAlarmSnapshotCommands(): Promise<unknown[]> {
    const response = await apiGet<ApiEnvelope<DepartureAlarmSnapshotResponse>>(
        "/api/notifications/departure-alarms/snapshot",
    );
    const snapshot = unwrapApiResponse(response);
    if (!Array.isArray(snapshot.commands)) {
        throw new Error("Departure alarm snapshot commands must be an array.");
    }
    return snapshot.commands;
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

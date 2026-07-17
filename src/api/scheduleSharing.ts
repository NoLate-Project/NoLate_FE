import { apiDelete, apiGet, apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type { ScheduleSharePermission } from "../modules/schedule/types";

export type ShareResourceType = "SCHEDULE" | "CATEGORY";
export type ShareInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type ShareStatus = "ACTIVE" | "REVOKED";

export type ScheduleShareInvitation = {
    id: string;
    resourceType: ShareResourceType;
    resourceId: string;
    ownerMemberId: number;
    permission: ScheduleSharePermission;
    status: ShareInvitationStatus;
    expiresAt: string;
    maxAcceptCount: number;
    acceptedCount: number;
    token?: string;
    acceptPath?: string;
    acceptedMemberId?: number;
    acceptedAt?: string;
};

export type ScheduleShare = {
    id: string;
    resourceId: string;
    ownerMemberId: number;
    targetMemberId: number;
    targetEmail?: string | null;
    permission: ScheduleSharePermission;
    status: ShareStatus;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type CreateShareInvitationPayload = {
    permission?: Exclude<ScheduleSharePermission, "OWNER">;
    ttlHours?: number;
    maxAcceptCount?: number;
};

export type CreateDirectSharePayload = {
    targetEmail?: string;
    targetAppId?: number;
    permission?: Exclude<ScheduleSharePermission, "OWNER">;
};

export type ScheduleShareInvitationAcceptResult = {
    invitation: ScheduleShareInvitation;
    share: ScheduleShare;
};

export type ShareInboxItem = {
    shareId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    title: string;
    color?: string | null;
    ownerMemberId: number;
    ownerEmail?: string | null;
    permission: ScheduleSharePermission;
    sharedAt?: string | null;
};

export type SharePendingInvitation = {
    id: string;
    resourceType: ShareResourceType;
    resourceId: string;
    title: string;
    color?: string | null;
    ownerMemberId: number;
    ownerEmail?: string | null;
    permission: ScheduleSharePermission;
    expiresAt: string;
};

export type ShareInbox = {
    pendingInvitations: SharePendingInvitation[];
    receivedShares: ShareInboxItem[];
};

export type ShareOutboxResource = {
    resourceType: ShareResourceType;
    resourceId: string;
    title: string;
    color?: string | null;
    shareCount: number;
    shares: ScheduleShare[];
};

export type ShareInvitationSummary = {
    id: string;
    resourceType: ShareResourceType;
    resourceId: string;
    title: string;
    color?: string | null;
    permission: ScheduleSharePermission;
    status: ShareInvitationStatus;
    expiresAt: string;
    maxAcceptCount: number;
    acceptedCount: number;
};

export type ShareOutbox = {
    sharedResources: ShareOutboxResource[];
    activeInvitations: ShareInvitationSummary[];
};

export async function getShareInbox(): Promise<ShareInbox> {
    const response = await apiGet<ApiEnvelope<ShareInbox>>("/api/shares/inbox");
    return unwrapApiResponse(response);
}

export async function getShareOutbox(): Promise<ShareOutbox> {
    const response = await apiGet<ApiEnvelope<ShareOutbox>>("/api/shares/outbox");
    return unwrapApiResponse(response);
}

export async function createScheduleShare(
    scheduleId: string,
    payload: CreateDirectSharePayload,
): Promise<ScheduleShare> {
    const response = await apiPost<ApiEnvelope<ScheduleShare>, CreateDirectSharePayload>(
        `/api/schedules/${scheduleId}/shares`,
        payload,
    );
    return unwrapApiResponse(response);
}

export async function createCategoryShare(
    categoryId: string,
    payload: CreateDirectSharePayload,
): Promise<ScheduleShare> {
    const response = await apiPost<ApiEnvelope<ScheduleShare>, CreateDirectSharePayload>(
        `/api/schedule-categories/${categoryId}/shares`,
        payload,
    );
    return unwrapApiResponse(response);
}

export async function revokeScheduleShare(scheduleId: string, shareId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedules/${scheduleId}/shares/${shareId}`
    );
    assertApiSuccess(response);
}

export async function revokeCategoryShare(categoryId: string, shareId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedule-categories/${categoryId}/shares/${shareId}`
    );
    assertApiSuccess(response);
}

export async function getScheduleShareInvitations(scheduleId: string): Promise<ScheduleShareInvitation[]> {
    const response = await apiGet<ApiEnvelope<ScheduleShareInvitation[]>>(
        `/api/schedules/${scheduleId}/shares/invitations`
    );
    return unwrapApiResponse(response);
}

export async function createScheduleShareInvitation(
    scheduleId: string,
    payload: CreateShareInvitationPayload
): Promise<ScheduleShareInvitation> {
    const response = await apiPost<ApiEnvelope<ScheduleShareInvitation>, CreateShareInvitationPayload>(
        `/api/schedules/${scheduleId}/shares/invitations`,
        payload
    );
    return unwrapApiResponse(response);
}

export async function getCategoryShareInvitations(categoryId: string): Promise<ScheduleShareInvitation[]> {
    const response = await apiGet<ApiEnvelope<ScheduleShareInvitation[]>>(
        `/api/schedule-categories/${categoryId}/shares/invitations`
    );
    return unwrapApiResponse(response);
}

export async function createCategoryShareInvitation(
    categoryId: string,
    payload: CreateShareInvitationPayload
): Promise<ScheduleShareInvitation> {
    const response = await apiPost<ApiEnvelope<ScheduleShareInvitation>, CreateShareInvitationPayload>(
        `/api/schedule-categories/${categoryId}/shares/invitations`,
        payload
    );
    return unwrapApiResponse(response);
}

export async function revokeScheduleShareInvitation(scheduleId: string, invitationId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedules/${scheduleId}/shares/invitations/${invitationId}`
    );
    assertApiSuccess(response);
}

export async function revokeCategoryShareInvitation(categoryId: string, invitationId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedule-categories/${categoryId}/shares/invitations/${invitationId}`
    );
    assertApiSuccess(response);
}

export async function acceptShareInvitation(token: string): Promise<ScheduleShareInvitationAcceptResult> {
    const response = await apiPost<ApiEnvelope<ScheduleShareInvitationAcceptResult>>(
        `/api/share-invitations/${encodeURIComponent(token)}/accept`
    );
    return unwrapApiResponse(response);
}

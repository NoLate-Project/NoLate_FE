import { apiDelete, apiGet, apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type { ScheduleSharePermission } from "../modules/schedule/types";
import {
    addScheduleCalendarMember,
    type ScheduleCalendarMember,
    type ScheduleShareContentMode,
} from "./scheduleCalendars";
import {
    captureCalendarScheduleCacheAuthEpoch,
    clearCalendarScheduleCache,
    mutateCalendarScheduleCacheIfAuthSessionCurrent,
} from "../modules/schedule/calendarScheduleCache";
import {
    assertScheduleSharingEnabled,
} from "../modules/share/scheduleSharingPolicy";

export type ShareResourceType = "SCHEDULE" | "CATEGORY" | "CALENDAR";
export type ShareInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type ShareStatus = "ACTIVE" | "REVOKED";

export type ScheduleShareInvitation = {
    id: string;
    resourceType: ShareResourceType;
    resourceId: string;
    ownerMemberId: number;
    permission: ScheduleSharePermission;
    contentMode?: ScheduleShareContentMode;
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
    contentMode?: ScheduleShareContentMode;
    status: ShareStatus;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type CreateShareInvitationPayload = {
    permission?: Exclude<ScheduleSharePermission, "OWNER">;
    contentMode?: ScheduleShareContentMode;
    ttlHours?: number;
    maxAcceptCount?: number;
};

export type CreateDirectSharePayload = {
    targetEmail?: string;
    targetAppId?: number;
    permission?: Exclude<ScheduleSharePermission, "OWNER">;
    contentMode?: ScheduleShareContentMode;
};

export type ScheduleShareInvitationAcceptResult = {
    invitation: ScheduleShareInvitation;
    share: ScheduleShare;
    calendarMembership?: ScheduleCalendarMember | null;
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
    contentMode?: ScheduleShareContentMode;
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
    contentMode?: ScheduleShareContentMode;
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
    contentMode?: ScheduleShareContentMode;
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
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ShareInbox>>("/api/shares/inbox");
    return unwrapApiResponse(response);
}

export async function getShareOutbox(): Promise<ShareOutbox> {
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ShareOutbox>>("/api/shares/outbox");
    return unwrapApiResponse(response);
}

export async function createScheduleShare(
    scheduleId: string,
    payload: CreateDirectSharePayload,
): Promise<ScheduleShare> {
    assertScheduleSharingEnabled();
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
    assertScheduleSharingEnabled();
    const response = await apiPost<ApiEnvelope<ScheduleShare>, CreateDirectSharePayload>(
        `/api/schedule-categories/${categoryId}/shares`,
        payload,
    );
    return unwrapApiResponse(response);
}

export async function createCalendarShare(
    calendarId: string,
    payload: CreateDirectSharePayload,
): Promise<ScheduleCalendarMember> {
    assertScheduleSharingEnabled();
    return addScheduleCalendarMember(calendarId, {
        targetEmail: payload.targetEmail,
        targetAppId: payload.targetAppId,
        role: payload.permission === "EDITOR" ? "EDITOR" : "VIEWER",
    });
}

export async function revokeScheduleShare(scheduleId: string, shareId: string): Promise<void> {
    assertScheduleSharingEnabled();
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedules/${scheduleId}/shares/${shareId}`
    );
    assertApiSuccess(response);
}

export async function revokeCategoryShare(categoryId: string, shareId: string): Promise<void> {
    assertScheduleSharingEnabled();
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedule-categories/${categoryId}/shares/${shareId}`
    );
    assertApiSuccess(response);
}

export async function getScheduleShareInvitations(scheduleId: string): Promise<ScheduleShareInvitation[]> {
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ScheduleShareInvitation[]>>(
        `/api/schedules/${scheduleId}/shares/invitations`
    );
    return unwrapApiResponse(response);
}

export async function createScheduleShareInvitation(
    scheduleId: string,
    payload: CreateShareInvitationPayload
): Promise<ScheduleShareInvitation> {
    assertScheduleSharingEnabled();
    const response = await apiPost<ApiEnvelope<ScheduleShareInvitation>, CreateShareInvitationPayload>(
        `/api/schedules/${scheduleId}/shares/invitations`,
        payload
    );
    return unwrapApiResponse(response);
}

export async function getCategoryShareInvitations(categoryId: string): Promise<ScheduleShareInvitation[]> {
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ScheduleShareInvitation[]>>(
        `/api/schedule-categories/${categoryId}/shares/invitations`
    );
    return unwrapApiResponse(response);
}

export async function createCategoryShareInvitation(
    categoryId: string,
    payload: CreateShareInvitationPayload
): Promise<ScheduleShareInvitation> {
    assertScheduleSharingEnabled();
    const response = await apiPost<ApiEnvelope<ScheduleShareInvitation>, CreateShareInvitationPayload>(
        `/api/schedule-categories/${categoryId}/shares/invitations`,
        payload
    );
    return unwrapApiResponse(response);
}

export async function getCalendarShareInvitations(calendarId: string): Promise<ScheduleShareInvitation[]> {
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ScheduleShareInvitation[]>>(
        `/api/schedule-calendars/${calendarId}/invitations`,
    );
    return unwrapApiResponse(response);
}

export async function createCalendarShareInvitation(
    calendarId: string,
    payload: CreateShareInvitationPayload,
): Promise<ScheduleShareInvitation> {
    assertScheduleSharingEnabled();
    // 캘린더의 공유 범위는 초대마다 저장하지 않고 캘린더 기본 정책으로 관리한다.
    // 공유 시트가 공통 payload를 넘겨도 서버 DTO에 없는 contentMode는 전송하지 않는다.
    const calendarInvitationPayload: Omit<CreateShareInvitationPayload, "contentMode"> = {
        permission: payload.permission,
        ttlHours: payload.ttlHours,
        maxAcceptCount: payload.maxAcceptCount,
    };
    const response = await apiPost<
        ApiEnvelope<ScheduleShareInvitation>,
        Omit<CreateShareInvitationPayload, "contentMode">
    >(
        `/api/schedule-calendars/${calendarId}/invitations`,
        calendarInvitationPayload,
    );
    return unwrapApiResponse(response);
}

export async function revokeScheduleShareInvitation(scheduleId: string, invitationId: string): Promise<void> {
    assertScheduleSharingEnabled();
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedules/${scheduleId}/shares/invitations/${invitationId}`
    );
    assertApiSuccess(response);
}

export async function revokeCategoryShareInvitation(categoryId: string, invitationId: string): Promise<void> {
    assertScheduleSharingEnabled();
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedule-categories/${categoryId}/shares/invitations/${invitationId}`
    );
    assertApiSuccess(response);
}

export async function revokeCalendarShareInvitation(calendarId: string, invitationId: string): Promise<void> {
    assertScheduleSharingEnabled();
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedule-calendars/${calendarId}/invitations/${invitationId}`,
    );
    assertApiSuccess(response);
}

export async function acceptShareInvitation(token: string): Promise<ScheduleShareInvitationAcceptResult> {
    assertScheduleSharingEnabled();
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const response = await apiPost<ApiEnvelope<ScheduleShareInvitationAcceptResult>>(
        `/api/share-invitations/${encodeURIComponent(token)}/accept`
    );
    const result = unwrapApiResponse(response);
    // 초대로 새롭게 보이게 된 일정은 기존 월 캐시에 없으므로 다음 캘린더 진입에서 다시 조회한다.
    mutateCalendarScheduleCacheIfAuthSessionCurrent(
        authEpoch,
        clearCalendarScheduleCache,
    );
    return result;
}

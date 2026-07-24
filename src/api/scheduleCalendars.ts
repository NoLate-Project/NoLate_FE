import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import { clearCalendarScheduleCache } from "../modules/schedule/calendarScheduleCache";

export type ScheduleShareContentMode = "SCHEDULE_ONLY" | "SCHEDULE_AND_TRAVEL";
export type ScheduleCalendarRole = "VIEWER" | "EDITOR" | "OWNER";
export type ScheduleCalendarStatus = "ACTIVE" | "ARCHIVED";
export type ScheduleCalendarMemberStatus = "ACTIVE" | "LEFT" | "REMOVED";

export type ScheduleCalendar = {
    id: number;
    title: string;
    color: string;
    defaultContentMode: ScheduleShareContentMode;
    status: ScheduleCalendarStatus;
    ownerMemberId: number;
    myRole: ScheduleCalendarRole;
    memberCount: number;
    routeReminderEnabled: boolean;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type ScheduleCalendarMember = {
    id: number;
    calendarId: number;
    memberId: number;
    name?: string | null;
    email?: string | null;
    role: ScheduleCalendarRole;
    status: ScheduleCalendarMemberStatus;
    routeReminderEnabled: boolean;
    joinedAt?: string | null;
    updatedAt?: string | null;
};

export type CreateScheduleCalendarPayload = {
    title: string;
    color: string;
    defaultContentMode: ScheduleShareContentMode;
};

export type UpdateScheduleCalendarPayload = Partial<CreateScheduleCalendarPayload>;

export async function getScheduleCalendars(): Promise<ScheduleCalendar[]> {
    const response = await apiGet<ApiEnvelope<ScheduleCalendar[]>>("/api/schedule-calendars");
    return unwrapApiResponse(response);
}

export async function createScheduleCalendar(
    payload: CreateScheduleCalendarPayload,
): Promise<ScheduleCalendar> {
    const response = await apiPost<ApiEnvelope<ScheduleCalendar>, CreateScheduleCalendarPayload>(
        "/api/schedule-calendars",
        payload,
    );
    return unwrapApiResponse(response);
}

export async function updateScheduleCalendar(
    calendarId: number | string,
    payload: UpdateScheduleCalendarPayload,
): Promise<ScheduleCalendar> {
    const response = await apiPatch<ApiEnvelope<ScheduleCalendar>, UpdateScheduleCalendarPayload>(
        `/api/schedule-calendars/${calendarId}`,
        payload,
    );
    const calendar = unwrapApiResponse(response);
    clearCalendarScheduleCache();
    return calendar;
}

export async function archiveScheduleCalendar(calendarId: number | string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/schedule-calendars/${calendarId}`);
    assertApiSuccess(response);
    clearCalendarScheduleCache();
}

export async function getScheduleCalendarMembers(
    calendarId: number | string,
): Promise<ScheduleCalendarMember[]> {
    const response = await apiGet<ApiEnvelope<ScheduleCalendarMember[]>>(
        `/api/schedule-calendars/${calendarId}/members`,
    );
    return unwrapApiResponse(response);
}

export async function addScheduleCalendarMember(
    calendarId: number | string,
    payload: {
        targetEmail?: string;
        targetAppId?: number;
        role: Exclude<ScheduleCalendarRole, "OWNER">;
    },
): Promise<ScheduleCalendarMember> {
    const response = await apiPost<ApiEnvelope<ScheduleCalendarMember>, typeof payload>(
        `/api/schedule-calendars/${calendarId}/members`,
        payload,
    );
    return unwrapApiResponse(response);
}

export async function updateScheduleCalendarMember(
    calendarId: number | string,
    memberId: number,
    payload: {
        role?: Exclude<ScheduleCalendarRole, "OWNER">;
    },
): Promise<ScheduleCalendarMember> {
    const response = await apiPatch<ApiEnvelope<ScheduleCalendarMember>, typeof payload>(
        `/api/schedule-calendars/${calendarId}/members/${memberId}`,
        payload,
    );
    return unwrapApiResponse(response);
}

export async function updateMyScheduleCalendarPreferences(
    calendarId: number | string,
    routeReminderEnabled: boolean,
): Promise<ScheduleCalendarMember> {
    const response = await apiPatch<
        ApiEnvelope<ScheduleCalendarMember>,
        { routeReminderEnabled: boolean }
    >(
        `/api/schedule-calendars/${calendarId}/preferences`,
        { routeReminderEnabled },
    );
    return unwrapApiResponse(response);
}

export async function removeScheduleCalendarMember(
    calendarId: number | string,
    memberId: number,
): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(
        `/api/schedule-calendars/${calendarId}/members/${memberId}`,
    );
    assertApiSuccess(response);
}

export async function leaveScheduleCalendar(calendarId: number | string): Promise<void> {
    const response = await apiPost<ApiEnvelope<unknown>>(`/api/schedule-calendars/${calendarId}/leave`);
    assertApiSuccess(response);
    clearCalendarScheduleCache();
}

export async function transferScheduleCalendarOwnership(
    calendarId: number | string,
    targetMemberId: number,
): Promise<ScheduleCalendar> {
    const response = await apiPost<ApiEnvelope<ScheduleCalendar>, { targetMemberId: number }>(
        `/api/schedule-calendars/${calendarId}/ownership`,
        { targetMemberId },
    );
    return unwrapApiResponse(response);
}

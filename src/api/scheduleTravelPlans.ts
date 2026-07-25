import { apiGet, apiPut } from "./api";
import { unwrapApiResponse, type ApiEnvelope } from "./response";
import type {
    Place,
    ScheduleTravelPlan,
    ScheduleTravelPlanParticipant,
    TravelMode,
} from "../modules/schedule/types";
import {
    assertScheduleSharingEnabled,
} from "../modules/share/scheduleSharingPolicy";

export type ScheduleTravelPlanPayload = {
    travelMinutes?: number;
    departAt?: string;
    travelMode?: TravelMode;
    origin?: Place;
    route?: unknown;
    notificationEnabled?: boolean;
    notificationLeadMinutes?: number;
    notificationIntervalMinutes?: number;
};

export type ScheduleTravelPlanOverview = {
    canViewAllTravelPlans: boolean;
    myTravelPlan?: ScheduleTravelPlan | null;
    participants: ScheduleTravelPlanParticipant[];
};

export async function getScheduleTravelPlanOverview(
    scheduleId: string
): Promise<ScheduleTravelPlanOverview> {
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ScheduleTravelPlanOverview>>(
        `/api/schedules/${scheduleId}/travel-plans`
    );
    return unwrapApiResponse(response);
}

export async function getScheduleTravelPlan(
    scheduleId: string,
    memberId: number
): Promise<ScheduleTravelPlan> {
    assertScheduleSharingEnabled();
    const response = await apiGet<ApiEnvelope<ScheduleTravelPlan>>(
        `/api/schedules/${scheduleId}/travel-plans/${memberId}`
    );
    return unwrapApiResponse(response);
}

export async function upsertMyScheduleTravelPlan(
    scheduleId: string,
    payload: ScheduleTravelPlanPayload
): Promise<ScheduleTravelPlan> {
    const response = await apiPut<ApiEnvelope<ScheduleTravelPlan>, ScheduleTravelPlanPayload>(
        `/api/schedules/${scheduleId}/travel-plans/my`,
        payload
    );
    return unwrapApiResponse(response);
}

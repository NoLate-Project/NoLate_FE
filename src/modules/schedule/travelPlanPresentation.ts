import type {
    ScheduleItem,
    ScheduleTravelPlan,
    ScheduleTravelPlanParticipant,
    ScheduleTravelPlanStatus,
} from "./types";
import type { ScheduleRouteUpdatePayload } from "./routePlannerSession";
import type { ScheduleTravelPlanPayload } from "../../api/scheduleTravelPlans";

export function travelPlanStatusLabel(status: ScheduleTravelPlanStatus): string {
    switch (status) {
        case "READY": return "경로 준비됨";
        case "STALE": return "경로 재설정 필요";
        default: return "경로 미설정";
    }
}

export function canOpenParticipantTravelPlan(
    participant: ScheduleTravelPlanParticipant,
    currentMemberId: number | null
): boolean {
    return participant.status !== "NOT_CONFIGURED" &&
        (participant.canViewDetails || participant.memberId === currentMemberId);
}

export function buildTravelPlanPayload(
    payload: ScheduleRouteUpdatePayload
): ScheduleTravelPlanPayload {
    return {
        travelMinutes: payload.travelMinutes,
        departAt: payload.departAt,
        travelMode: payload.travelMode,
        origin: payload.origin,
        route: payload.route,
        notificationEnabled: payload.notificationEnabled,
        notificationLeadMinutes: payload.notificationLeadMinutes,
        notificationIntervalMinutes: payload.notificationIntervalMinutes,
    };
}

/** 개인 계획 응답을 기존 평탄형 일정 화면 모델에 투영한다. */
export function applyTravelPlanToScheduleItem(
    item: ScheduleItem,
    plan: ScheduleTravelPlan
): ScheduleItem {
    return {
        ...item,
        travelMinutes: plan.travelMinutes ?? undefined,
        departAt: plan.departAt ?? undefined,
        travelMode: plan.travelMode ?? undefined,
        origin: plan.origin ?? undefined,
        destination: plan.destination ?? item.destination,
        route: plan.route,
        routeSetupRequired: plan.status !== "READY",
        notificationEnabled: plan.notificationEnabled,
        notificationLeadMinutes: plan.notificationLeadMinutes ?? undefined,
        notificationIntervalMinutes: plan.notificationIntervalMinutes ?? undefined,
        myTravelPlan: plan,
        travelPlanStatus: plan.status,
    };
}

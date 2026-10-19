import type { ScheduleTravelPlanPayload } from "../../api/scheduleTravelPlans";
import { recoverDepartureAlarmsAfterMutation } from "../notification/departureAlarmMutationRecovery";
import type { ScheduleRouteUpdatePayload } from "./routePlannerSession";
import {
    applyTravelPlanToScheduleItem,
    buildTravelPlanPayload,
} from "./travelPlanPresentation";
import type { ScheduleItem, ScheduleTravelPlan } from "./types";

type ScheduleTravelPlanSaveDependencies = {
    upsertMyTravelPlan: (
        scheduleId: string,
        payload: ScheduleTravelPlanPayload
    ) => Promise<ScheduleTravelPlan>;
    reloadSchedule: (scheduleId: string) => Promise<ScheduleItem>;
    canResolveCommonDestination?: boolean;
};

/**
 * 일정 상세의 경로 편집은 기본적으로 현재 사용자의 이동 계획만 저장한다.
 * 일정 제목과 시간은 일정 편집 흐름에서만 변경한다. 다만 빠른 일정처럼
 * 첫 경로를 선택할 때는 경로 목록에서 선택한 도착지를 일정 도착지에도 반영한다.
 * 저장 전 도착지 스냅샷을 함께 보내 오래된 화면이 새 도착지를 덮어쓰지 않도록 한다.
 */
export async function saveScheduleRouteAsMyTravelPlan(
    item: ScheduleItem,
    routeUpdate: ScheduleRouteUpdatePayload,
    dependencies: ScheduleTravelPlanSaveDependencies
): Promise<ScheduleItem> {
    const payload = buildTravelPlanPayload(routeUpdate);
    const needsLocationResolution = dependencies.canResolveCommonDestination === true
        && !!item.destination && item.route == null
        && routeUpdate.route != null && !!routeUpdate.destination;
    const plan = await dependencies.upsertMyTravelPlan(
        item.id,
        needsLocationResolution ? {
            ...payload,
            resolveUnlocatedCommonDestination: true,
            expectedCommonDestination: {
                name: item.destination?.name,
                address: item.destination?.address,
                lat: item.destination?.lat,
                lng: item.destination?.lng,
            },
        } : payload,
    );
    await recoverDepartureAlarmsAfterMutation();

    try {
        return await dependencies.reloadSchedule(item.id);
    } catch {
        // 재조회만 실패한 경우에도 방금 저장된 개인 계획을 즉시 화면에 반영한다.
        return applyTravelPlanToScheduleItem(item, plan);
    }
}

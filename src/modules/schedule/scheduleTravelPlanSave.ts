import type { ScheduleTravelPlanPayload } from "../../api/scheduleTravelPlans";
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
};

/**
 * 일정 상세의 경로 편집은 오너 여부와 무관하게 현재 사용자의 이동 계획만 저장한다.
 * 일정 제목, 시간, 공통 목적지처럼 모든 참가자에게 적용되는 값은 일정 편집 흐름에서만
 * 변경해야 하며, 여기서 공용 일정 수정 API를 호출하면 오너 경로가 공유 데이터에 섞인다.
 */
export async function saveScheduleRouteAsMyTravelPlan(
    item: ScheduleItem,
    routeUpdate: ScheduleRouteUpdatePayload,
    dependencies: ScheduleTravelPlanSaveDependencies
): Promise<ScheduleItem> {
    const plan = await dependencies.upsertMyTravelPlan(
        item.id,
        buildTravelPlanPayload(routeUpdate)
    );

    try {
        return await dependencies.reloadSchedule(item.id);
    } catch {
        // 재조회만 실패한 경우에도 방금 저장된 개인 계획을 즉시 화면에 반영한다.
        return applyTravelPlanToScheduleItem(item, plan);
    }
}

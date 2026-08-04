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
};

/**
 * 일정 상세의 경로 편집은 오너 여부와 무관하게 현재 사용자의 이동 계획만 저장한다.
 * 일정 제목, 시간, 공통 목적지의 의미는 일정 편집 흐름에서만 변경한다. 다만 빠른 일정처럼
 * 공통 목적지 이름만 저장된 경우를 위해 사용자가 선택한 destination을 개인 계획 요청에도
 * 전달한다. 서버는 오너/EDITOR 요청에서 같은 목적지의 비어 있는 좌표만 보강하고 이름이나
 * 기존 좌표는 바꾸지 않는다. 여기서 공용 일정 수정 API를 호출하면 오너 경로가 공유 데이터에
 * 섞일 수 있으므로 사용하지 않는다.
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
    await recoverDepartureAlarmsAfterMutation();

    try {
        return await dependencies.reloadSchedule(item.id);
    } catch {
        // 재조회만 실패한 경우에도 방금 저장된 개인 계획을 즉시 화면에 반영한다.
        return applyTravelPlanToScheduleItem(item, plan);
    }
}

export type RoutePlannerBackAction = "close" | "return-to-selection";

type RoutePlannerBackContext = {
    isRouteSelectionStage: boolean;
    shouldReturnToScheduleDetail: boolean;
};

/**
 * 경로 목록에서 들어온 상세 화면은 뒤로갈 때 편집 중인 초안을 목록에 넘겨야 한다.
 * 일정 상세에서 바로 들어온 화면과 경로 목록 자체만 실제 이전 화면을 닫는다.
 */
export function resolveRoutePlannerBackAction({
    isRouteSelectionStage,
    shouldReturnToScheduleDetail,
}: RoutePlannerBackContext): RoutePlannerBackAction {
    return shouldReturnToScheduleDetail || isRouteSelectionStage
        ? "close"
        : "return-to-selection";
}

/**
 * 경로 목록이 replace된 상세 화면에서 iOS 스와이프 pop을 허용하면 목록을 건너뛰고
 * 일정 폼으로 돌아가 초안이 사라진다. 이 경우에는 화면의 명시적 뒤로가기를 사용한다.
 */
export function shouldEnableRoutePlannerGesture({
    isRouteSelectionStage,
    shouldReturnToScheduleDetail,
}: RoutePlannerBackContext): boolean {
    return resolveRoutePlannerBackAction({
        isRouteSelectionStage,
        shouldReturnToScheduleDetail,
    }) === "close";
}

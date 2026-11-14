export type RoutePlannerBackAction = "close" | "return-to-selection";

type RoutePlannerBackContext = {
    shouldReturnToScheduleDetail: boolean;
};

/**
 * 경로 목록에서 들어온 상세 화면은 뒤로갈 때 편집 중인 초안을 목록에 넘겨야 한다.
 * 일정 상세에서 바로 들어온 경우에는 플래너를 닫는다.
 */
export function resolveRoutePlannerBackAction({
    shouldReturnToScheduleDetail,
}: RoutePlannerBackContext): RoutePlannerBackAction {
    return shouldReturnToScheduleDetail
        ? "close"
        : "return-to-selection";
}

/**
 * 경로 목록이 replace된 상세 화면에서 iOS 스와이프 pop을 허용하면 목록을 건너뛰고
 * 일정 폼으로 돌아가 초안이 사라진다. 이 경우에는 화면의 명시적 뒤로가기를 사용한다.
 */
export function shouldEnableRoutePlannerGesture({
    shouldReturnToScheduleDetail,
}: RoutePlannerBackContext): boolean {
    return resolveRoutePlannerBackAction({
        shouldReturnToScheduleDetail,
    }) === "close";
}

import {
    resolveRoutePlannerBackAction,
    shouldEnableRoutePlannerGesture,
} from "../src/modules/schedule/routePlannerNavigation";

describe("route planner navigation", () => {
    test("일정 수정의 경로 목록에서 연 상세는 뒤로갈 때 목록 초안으로 복귀한다", () => {
        const context = {
            shouldReturnToScheduleDetail: false,
        };

        expect(resolveRoutePlannerBackAction(context)).toBe("return-to-selection");
        expect(shouldEnableRoutePlannerGesture(context)).toBe(false);
    });

    test("일정 상세에서 직접 연 경로는 실제 이전 화면을 닫는다", () => {
        expect(resolveRoutePlannerBackAction({
            shouldReturnToScheduleDetail: true,
        })).toBe("close");
        expect(shouldEnableRoutePlannerGesture({
            shouldReturnToScheduleDetail: true,
        })).toBe(true);
    });
});

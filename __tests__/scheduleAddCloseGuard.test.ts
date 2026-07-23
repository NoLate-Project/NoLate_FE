import { getScheduleAddCloseAction } from "../src/modules/schedule/scheduleAddCloseGuard";

describe("schedule add close guard", () => {
    test("깨끗한 폼은 확인 없이 닫는다", () => {
        expect(getScheduleAddCloseAction({ dirty: false, submitting: false })).toBe("close");
    });

    test("작성 중인 초안은 버리기 확인을 거친다", () => {
        expect(getScheduleAddCloseAction({ dirty: true, submitting: false })).toBe("confirm");
    });

    test("저장 중에는 중복 닫기 요청을 무시한다", () => {
        expect(getScheduleAddCloseAction({ dirty: true, submitting: true })).toBe("ignore");
        expect(getScheduleAddCloseAction({ dirty: false, submitting: true })).toBe("ignore");
    });
});

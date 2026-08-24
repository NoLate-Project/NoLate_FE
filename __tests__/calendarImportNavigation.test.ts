import {
    getCalendarImportCompletionRoute,
    isCalendarImportManagementEntry,
    shouldConsumeCalendarImportHardwareBack,
} from "../src/modules/onboarding/calendarImportNavigation";

describe("calendar import navigation", () => {
    test("완료 사용자가 프로필에서 들어온 경우에만 관리 흐름으로 판별한다", () => {
        expect(isCalendarImportManagementEntry({
            source: "profile",
            isCurationCompleted: true,
        })).toBe(true);
        expect(isCalendarImportManagementEntry({
            source: ["profile"],
            isCurationCompleted: true,
        })).toBe(true);
        expect(isCalendarImportManagementEntry({
            source: "profile",
            isCurationCompleted: false,
        })).toBe(false);
        expect(isCalendarImportManagementEntry({
            source: undefined,
            isCurationCompleted: true,
        })).toBe(false);
    });

    test("저장 중에는 내부 이전 단계가 없어도 Android 뒤로가기를 소비한다", () => {
        expect(shouldConsumeCalendarImportHardwareBack({ busy: true, canGoBack: false })).toBe(true);
        expect(shouldConsumeCalendarImportHardwareBack({ busy: false, canGoBack: true })).toBe(true);
        expect(shouldConsumeCalendarImportHardwareBack({ busy: false, canGoBack: false })).toBe(false);
    });

    test("첫 큐레이션 완료 뒤에는 제품 온보딩으로, 프로필 재설정 뒤에는 일정으로 이동한다", () => {
        expect(getCalendarImportCompletionRoute(false)).toBe("/onboarding/product-tour");
        expect(getCalendarImportCompletionRoute(true)).toBe("/schedule");
    });
});

import { getScheduleAccessibilityVisibility } from "../src/modules/schedule/accessibilityVisibility";

describe("schedule animated layer accessibility", () => {
    test("사용 가능한 레이어만 접근성 트리에 노출한다", () => {
        expect(getScheduleAccessibilityVisibility(true)).toEqual({
            accessibilityElementsHidden: false,
            importantForAccessibility: "auto",
        });
    });

    test("투명하거나 전환 중인 레이어의 하위 요소를 숨긴다", () => {
        expect(getScheduleAccessibilityVisibility(false)).toEqual({
            accessibilityElementsHidden: true,
            importantForAccessibility: "no-hide-descendants",
        });
    });
});

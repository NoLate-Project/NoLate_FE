import {
    getRouteSelectionAccessibilityProps,
    getRouteSelectionConfirmAccessibilityProps,
} from "../src/modules/schedule/routeSelectionAccessibility";

describe("route selection accessibility", () => {
    test("announces travel modes and route cards as selected radio controls", () => {
        expect(getRouteSelectionAccessibilityProps("radio", "대중교통 이동수단", true))
            .toEqual({
                accessibilityRole: "radio",
                accessibilityLabel: "대중교통 이동수단",
                accessibilityState: { selected: true },
            });
        expect(getRouteSelectionAccessibilityProps("radio", "자동차 이동수단", false)
            .accessibilityState.selected).toBe(false);
    });

    test("announces filters as tabs and exposes the confirm disabled state", () => {
        expect(getRouteSelectionAccessibilityProps("tab", "전체 경로 필터", true)
            .accessibilityRole).toBe("tab");
        expect(getRouteSelectionConfirmAccessibilityProps(false)).toEqual({
            accessibilityRole: "button",
            accessibilityLabel: "지도에서 상세 경로 보기",
            accessibilityState: { disabled: true },
        });
        expect(getRouteSelectionConfirmAccessibilityProps(true).accessibilityState.disabled)
            .toBe(false);
    });
});

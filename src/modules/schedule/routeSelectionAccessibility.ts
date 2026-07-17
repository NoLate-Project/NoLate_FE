export type RouteSelectionAccessibilityRole = "radio" | "tab";

export function getRouteSelectionAccessibilityProps(
    role: RouteSelectionAccessibilityRole,
    label: string,
    selected: boolean,
) {
    return {
        accessibilityRole: role,
        accessibilityLabel: label,
        accessibilityState: { selected },
    } as const;
}

export function getRouteSelectionConfirmAccessibilityProps(enabled: boolean) {
    return {
        accessibilityRole: "button",
        accessibilityLabel: "지도에서 상세 경로 보기",
        accessibilityState: { disabled: !enabled },
    } as const;
}

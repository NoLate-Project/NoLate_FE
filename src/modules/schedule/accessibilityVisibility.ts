export type ScheduleAccessibilityVisibility = {
    accessibilityElementsHidden: boolean;
    importantForAccessibility: "auto" | "no-hide-descendants";
};

/**
 * Animated schedule layers stay mounted so transitions remain smooth. Keep
 * their accessibility tree in lockstep with the layer that is actually usable;
 * opacity and pointerEvents alone do not hide descendants from VoiceOver.
 */
export function getScheduleAccessibilityVisibility(
    visible: boolean,
): ScheduleAccessibilityVisibility {
    return {
        accessibilityElementsHidden: !visible,
        importantForAccessibility: visible ? "auto" : "no-hide-descendants",
    };
}

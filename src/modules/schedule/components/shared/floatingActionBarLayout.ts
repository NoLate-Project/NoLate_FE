export const FLOATING_ACTION_BAR_HEIGHT = 44;

const FLOATING_ACTION_BAR_MIN_BOTTOM_INSET = 10;
const FLOATING_ACTION_BAR_BOTTOM_GAP = 8;
const FLOATING_ACTION_BAR_CONTENT_GAP = 8;

export function getFloatingActionBarBottomOffset(bottomInset = 0) {
    return Math.max(bottomInset, FLOATING_ACTION_BAR_MIN_BOTTOM_INSET)
        + FLOATING_ACTION_BAR_BOTTOM_GAP;
}

/**
 * Returns the viewport space that scrolling content should leave above the
 * persistent floating controls. The extra content gap keeps the final row
 * visually separate from the existing button treatment.
 */
export function getFloatingActionBarClearance(bottomInset = 0) {
    return getFloatingActionBarBottomOffset(bottomInset)
        + FLOATING_ACTION_BAR_HEIGHT
        + FLOATING_ACTION_BAR_CONTENT_GAP;
}

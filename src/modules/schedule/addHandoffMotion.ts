/** Shared geometry and timing for the native add menu -> React Native card handoff. */
export const ADD_MENU_SOURCE = {
    nativeWidth: 238,
    nativeHeight: 164,
    nativeRightInset: 8,
    nativeRadius: 26,
    fallbackWidth: 196,
    fallbackRightInset: 16,
} as const;

export const ADD_HANDOFF_MOTION = {
    // Crossfade the native menu and pre-composed RN card while geometry starts
    // moving. A separate stationary handoff left a visible blank white card
    // between the selected menu row and the destination form.
    ownershipCrossfadeMs: 72,
    // The hidden SwiftUI host is reset only after the RN geometry animation
    // has settled. Resetting it on the exact completion frame used to stack a
    // SwiftUI teardown, a Fabric commit, and a raster-cache change together.
    nativeResetSettleMs: 96,
    // Pre-compose the native toolbar behind the still-opaque RN shell. It is
    // fully resident before the RN shell begins revealing it near the end.
    toolbarReturnDelayMs: 16,
    toolbarReturnDurationMs: 96,
    // Values close to zero still let iOS evict the glass render pass. Four
    // percent remains fully covered by the opaque RN shell, but is high enough
    // to keep the native pill material and glyph layers compositor-resident.
    toolbarParkedOpacity: 0.04,
    quickOpenMs: 200,
    manualOpenMs: 200,
    closeMs: 190,
    // A non-zero initial tangent makes the first compositor frames move at a
    // visible rate instead of looking like a short pause after selection.
    openBezier: [0.28, 0.28, 0.22, 1] as const,
    // Match the opening motion's non-zero initial velocity. A zero tangent
    // visibly held the first close frames before the card began shrinking.
    closeBezier: [0.32, 0.32, 0.66, 1] as const,
    // The native menu remains the only menu renderer. As soon as its surface
    // hands off, reveal the destination content during the first half of the
    // geometry motion; no approximate RN menu clone is sampled in between.
    contentRevealStartProgress: 0.04,
    contentRevealEndProgress: 0.34,
    // Fade the complete RN card while it is still compact enough to read as
    // one surface. Keeping a second blank shell alive below this range made a
    // tall white tail overlap the returning three-button native pill.
    closeContentFadeStartProgress: 0.42,
    closeContentFadeEndProgress: 0.70,
    // Preserve the raster cache of the dense form until the close completes.
    // Exact zero can tear down the large manual-form layer mid-animation; this
    // value is visually absent after the native pill has taken ownership.
    closeContentParkedOpacity: 0.001,
    backdropInputRange: [0, 0.33, 0.67, 1] as const,
    backdropOutputRange: [0, 0.33, 0.67, 1] as const,
} as const;

export function lerpAddHandoffValue(
    source: number,
    target: number,
    progress: number
): number {
    "worklet";
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return source + (target - source) * clampedProgress;
}

export function resolveAddHandoffCloseDuration(progress: number): number {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    return Math.round(ADD_HANDOFF_MOTION.closeMs * clampedProgress);
}

export type AddHandoffVisibilityState = {
    isFocused: boolean;
    modalVisible: boolean;
    quickModalVisible: boolean;
    handoffPending: boolean;
    handoffClosing: boolean;
    liquidMenuOpen: boolean;
};

export function shouldRestoreAddHandoffToolbar({
    isFocused,
    modalVisible,
    quickModalVisible,
    handoffPending,
    handoffClosing,
    liquidMenuOpen,
}: AddHandoffVisibilityState): boolean {
    return isFocused
        && !modalVisible
        && !quickModalVisible
        && !handoffPending
        && !handoffClosing
        && !liquidMenuOpen;
}

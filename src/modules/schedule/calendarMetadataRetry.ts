export const CALENDAR_METADATA_RETRY_DELAYS_MS = Object.freeze([
    5_000,
    30_000,
] as const);

export type CalendarMetadataRetryState = Readonly<{
    targetKey: string | null;
    scheduledRetryCount: number;
}>;

export type CalendarMetadataRetryDecision = Readonly<{
    delayMs: number | null;
    state: CalendarMetadataRetryState;
}>;

/**
 * A target changes when either the prefetched month window or first-day
 * setting changes. Sorting and de-duplicating keeps equivalent windows stable.
 */
export function getCalendarMetadataRetryTargetKey(
    monthKeys: readonly string[],
    firstDay: 0 | 1,
): string {
    const normalizedMonthKeys = [...new Set(monthKeys)].sort();
    return `${firstDay}:${normalizedMonthKeys.join(",")}`;
}

/**
 * Starts a fresh retry budget. Call this for a target change or an explicit
 * foreground refresh so a previous exhausted budget cannot suppress it.
 */
export function resetCalendarMetadataRetryState(
    targetKey: string | null = null,
): CalendarMetadataRetryState {
    return {
        targetKey,
        scheduledRetryCount: 0,
    };
}

/**
 * Consumes the next retry delay without mutating the previous state.
 * A new target gets a fresh budget automatically. Once both delays have been
 * consumed, delayMs stays null until the state is reset or the target changes.
 */
export function getNextCalendarMetadataRetry(
    state: CalendarMetadataRetryState,
    targetKey: string,
): CalendarMetadataRetryDecision {
    const activeState = state.targetKey === targetKey
        ? state
        : resetCalendarMetadataRetryState(targetKey);
    const delayMs = CALENDAR_METADATA_RETRY_DELAYS_MS[
        activeState.scheduledRetryCount
    ];

    if (delayMs === undefined) {
        return { delayMs: null, state: activeState };
    }

    return {
        delayMs,
        state: {
            targetKey,
            scheduledRetryCount: activeState.scheduledRetryCount + 1,
        },
    };
}

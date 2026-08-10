export const DEPARTURE_STATUS_REFRESH_GRACE_MS = 2_000;
export const DEPARTURE_STATUS_MIN_REFRESH_DELAY_MS = 15_000;
export const DEPARTURE_STATUS_MAX_REFRESH_DELAY_MS = 5 * 60_000;
export const DEPARTURE_STATUS_FALLBACK_REFRESH_DELAY_MS = 2 * 60_000;

/**
 * Waits just beyond the worker boundary, while bounding invalid, overdue, or
 * unusually distant server hints so a long-open detail screen stays current
 * without becoming a tight polling loop.
 */
export function getDepartureStatusRefreshDelay({
    nextCheckAt,
    nowMs,
}: {
    nextCheckAt: string | null | undefined;
    nowMs: number;
}): number {
    const parsedNextCheckAt = nextCheckAt ? Date.parse(nextCheckAt) : Number.NaN;
    if (!Number.isFinite(parsedNextCheckAt) || !Number.isFinite(nowMs)) {
        return DEPARTURE_STATUS_FALLBACK_REFRESH_DELAY_MS;
    }

    const requestedDelay = parsedNextCheckAt + DEPARTURE_STATUS_REFRESH_GRACE_MS - nowMs;
    return Math.min(
        DEPARTURE_STATUS_MAX_REFRESH_DELAY_MS,
        Math.max(DEPARTURE_STATUS_MIN_REFRESH_DELAY_MS, requestedDelay),
    );
}

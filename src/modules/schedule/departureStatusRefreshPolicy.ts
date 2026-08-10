export const DEPARTURE_STATUS_REFRESH_GRACE_MS = 2_000;
export const DEPARTURE_STATUS_MIN_REFRESH_DELAY_MS = 15_000;
export const DEPARTURE_STATUS_MAX_REFRESH_DELAY_MS = 5 * 60_000;
export const DEPARTURE_STATUS_FALLBACK_REFRESH_DELAY_MS = 2 * 60_000;
export const DEPARTURE_STATUS_LOCAL_EXPIRY_GRACE_MS = 5 * 60_000;

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

/** Fails closed when the server cannot be reached beyond the normal worker grace window. */
export function isDepartureStatusLocallyExpired({
    etaRefreshDueAt,
    evaluatedAt,
    nowMs,
}: {
    etaRefreshDueAt: string | null | undefined;
    evaluatedAt?: string | null;
    nowMs: number;
}): boolean {
    const parsedEtaRefreshDueAt = etaRefreshDueAt
        ? Date.parse(etaRefreshDueAt)
        : Number.NaN;
    const parsedEvaluatedAt = evaluatedAt ? Date.parse(evaluatedAt) : Number.NaN;
    const freshnessBaseline = Number.isFinite(parsedEtaRefreshDueAt)
        ? parsedEtaRefreshDueAt
        : parsedEvaluatedAt;
    if (!Number.isFinite(freshnessBaseline) || !Number.isFinite(nowMs)) return true;
    return nowMs > freshnessBaseline + DEPARTURE_STATUS_LOCAL_EXPIRY_GRACE_MS;
}

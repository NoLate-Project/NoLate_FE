export const CALENDAR_CACHE_REVISION_POLL_INTERVAL_MS = 45_000;

export function startCalendarCacheRevisionPolling(
    poll: () => void,
    intervalMs = CALENDAR_CACHE_REVISION_POLL_INTERVAL_MS,
): () => void {
    const timer = setInterval(poll, intervalMs);
    return () => clearInterval(timer);
}

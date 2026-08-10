export const ROUTE_DETAIL_AD_ENTRY_INTERVAL = 3;
export const ROUTE_DETAIL_AD_DAILY_LIMIT = 2;
export const ROUTE_DETAIL_AD_COOLDOWN_MS = 30 * 60 * 1000;

export type RouteDetailAdFrequencyState = {
    dayKey: string;
    entriesSinceLastAd: number;
    shownToday: number;
    lastShownAtMs?: number;
};

export type RouteDetailAdEntryDecision = {
    eligible: boolean;
    state: RouteDetailAdFrequencyState;
};

function localDayKey(nowMs: number): string {
    const now = new Date(nowMs);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function nonNegativeInteger(value: unknown): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : 0;
}

export function createRouteDetailAdFrequencyState(nowMs: number): RouteDetailAdFrequencyState {
    return {
        dayKey: localDayKey(nowMs),
        entriesSinceLastAd: 0,
        shownToday: 0,
    };
}

export function parseRouteDetailAdFrequencyState(
    raw: string | null,
    nowMs: number,
): RouteDetailAdFrequencyState {
    if (!raw) return createRouteDetailAdFrequencyState(nowMs);

    try {
        const parsed = JSON.parse(raw) as Partial<RouteDetailAdFrequencyState>;
        const today = localDayKey(nowMs);
        const lastShownAtMs = typeof parsed.lastShownAtMs === "number" &&
            Number.isFinite(parsed.lastShownAtMs) &&
            parsed.lastShownAtMs > 0 &&
            parsed.lastShownAtMs <= nowMs
            ? parsed.lastShownAtMs
            : undefined;

        return {
            dayKey: today,
            entriesSinceLastAd: nonNegativeInteger(parsed.entriesSinceLastAd),
            shownToday: parsed.dayKey === today ? nonNegativeInteger(parsed.shownToday) : 0,
            lastShownAtMs,
        };
    } catch {
        return createRouteDetailAdFrequencyState(nowMs);
    }
}

export function registerRouteDetailEntry(
    current: RouteDetailAdFrequencyState,
    nowMs: number,
): RouteDetailAdEntryDecision {
    const normalized = parseRouteDetailAdFrequencyState(JSON.stringify(current), nowMs);
    const state = {
        ...normalized,
        entriesSinceLastAd: Math.min(normalized.entriesSinceLastAd + 1, 10_000),
    };
    const cooldownComplete = state.lastShownAtMs === undefined ||
        nowMs - state.lastShownAtMs >= ROUTE_DETAIL_AD_COOLDOWN_MS;

    return {
        state,
        eligible: state.entriesSinceLastAd >= ROUTE_DETAIL_AD_ENTRY_INTERVAL &&
            state.shownToday < ROUTE_DETAIL_AD_DAILY_LIMIT &&
            cooldownComplete,
    };
}

export function recordRouteDetailAdShown(
    current: RouteDetailAdFrequencyState,
    nowMs: number,
): RouteDetailAdFrequencyState {
    const normalized = parseRouteDetailAdFrequencyState(JSON.stringify(current), nowMs);
    return {
        ...normalized,
        entriesSinceLastAd: 0,
        shownToday: Math.min(normalized.shownToday + 1, ROUTE_DETAIL_AD_DAILY_LIMIT),
        lastShownAtMs: nowMs,
    };
}

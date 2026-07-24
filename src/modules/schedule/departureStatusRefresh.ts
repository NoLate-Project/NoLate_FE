import type { ScheduleDepartureStatus } from "../../api/schedule";

const MIN_REFRESH_DELAY_MS = 60_000;
const MAX_REFRESH_DELAY_MS = 15 * 60_000;
const BACKOFF_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, MAX_REFRESH_DELAY_MS] as const;

export function shouldRefreshDepartureStatusOnAppStateChange(
    previousState: string,
    nextState: string,
): boolean {
    return previousState !== "active" && nextState === "active";
}

export function handleDepartureStatusAppStateChange<TState extends string>(
    previousState: TState,
    nextState: TState,
    refresh: () => void,
): TState {
    if (shouldRefreshDepartureStatusOnAppStateChange(previousState, nextState)) refresh();
    return nextState;
}

export function shouldFetchDepartureStatus(options: {
    scheduleLoaded: boolean;
    authResolved: boolean;
    travelCollaborationEnabled?: boolean | null;
}): boolean {
    return options.scheduleLoaded &&
        options.authResolved &&
        options.travelCollaborationEnabled !== false;
}

export function getDepartureStatusFingerprint(status: ScheduleDepartureStatus): string {
    return JSON.stringify([
        status.travelMinutes,
        status.recommendedDepartureAt,
        status.source,
        status.stale,
        status.confidence,
        status.failureReason,
        status.lastTrafficChangeMinutes,
        status.lastChangedAt,
        status.preparationStartAt,
        status.nextCheckAt,
    ]);
}

export function createDepartureStatusRefreshController() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let generation = 0;
    let lastFingerprint: string | undefined;
    let unchangedCount = 0;
    let failureCount = 0;

    const cancel = () => {
        generation += 1;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    const backoffDelay = () => {
        const index = Math.min(
            BACKOFF_DELAYS_MS.length - 1,
            Math.max(0, unchangedCount + failureCount - 1),
        );
        return BACKOFF_DELAYS_MS[index];
    };

    return {
        seed(status: ScheduleDepartureStatus): void {
            if (lastFingerprint !== undefined) return;
            lastFingerprint = getDepartureStatusFingerprint(status);
        },
        reset(status?: ScheduleDepartureStatus): void {
            lastFingerprint = status
                ? getDepartureStatusFingerprint(status)
                : undefined;
            unchangedCount = 0;
            failureCount = 0;
        },
        recordSuccess(status: ScheduleDepartureStatus): void {
            const fingerprint = getDepartureStatusFingerprint(status);
            if (lastFingerprint !== fingerprint) {
                unchangedCount = 0;
                failureCount = 0;
            } else {
                unchangedCount += 1;
                failureCount = 0;
            }
            lastFingerprint = fingerprint;
        },
        recordFailure(): void {
            failureCount += 1;
        },
        schedule(options: {
            nextCheckAt?: string | null;
            active: boolean;
            refresh: () => void;
            nowMs?: number;
        }): void {
            cancel();
            if (disposed || !options.active) return;
            const nowMs = options.nowMs ?? Date.now();
            const nextCheckMs = options.nextCheckAt
                ? Date.parse(options.nextCheckAt)
                : Number.NaN;
            const scheduledDelay = Number.isFinite(nextCheckMs) && nextCheckMs > nowMs
                ? Math.min(MAX_REFRESH_DELAY_MS, Math.max(MIN_REFRESH_DELAY_MS, nextCheckMs - nowMs))
                : backoffDelay();
            const scheduledGeneration = generation;
            timer = setTimeout(() => {
                timer = undefined;
                if (!disposed && scheduledGeneration === generation) options.refresh();
            }, scheduledDelay);
        },
        cancel,
        dispose(): void {
            disposed = true;
            cancel();
        },
    };
}

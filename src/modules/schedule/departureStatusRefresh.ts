const MIN_REFRESH_DELAY_MS = 15_000;
const MAX_REFRESH_DELAY_MS = 15 * 60_000;

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
    if (shouldRefreshDepartureStatusOnAppStateChange(previousState, nextState)) {
        refresh();
    }
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

export function getDepartureStatusRefreshDelay(
    nextCheckAt?: string | null,
    nowMs = Date.now(),
): number | undefined {
    if (!nextCheckAt) return undefined;
    const nextCheckMs = Date.parse(nextCheckAt);
    if (!Number.isFinite(nextCheckMs)) return undefined;

    return Math.min(
        MAX_REFRESH_DELAY_MS,
        Math.max(MIN_REFRESH_DELAY_MS, nextCheckMs - nowMs),
    );
}

export function createDepartureStatusRefreshController() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let generation = 0;

    const cancel = () => {
        generation += 1;
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    return {
        schedule(
            nextCheckAt: string | null | undefined,
            refresh: () => void,
            nowMs = Date.now(),
        ): void {
            cancel();
            if (disposed) return;
            const delay = getDepartureStatusRefreshDelay(nextCheckAt, nowMs);
            if (delay === undefined) return;
            const scheduledGeneration = generation;
            timer = setTimeout(() => {
                timer = undefined;
                if (disposed || scheduledGeneration !== generation) return;
                refresh();
            }, delay);
        },
        cancel,
        dispose(): void {
            disposed = true;
            cancel();
        },
    };
}

export type PushActionFailure = {
    action: "departNow" | "snooze";
    scheduleId?: string;
    message: string;
};

const MAX_PENDING_FAILURES = 3;

/**
 * Native alerts are not reliable while the app is inactive. Keep action failures
 * briefly and deliver them once the app reaches the foreground.
 */
export function createPushActionFailureGate(
    deliver: ((failure: PushActionFailure) => void) | undefined,
    initiallyActive: boolean,
) {
    let active = initiallyActive;
    let disposed = false;
    let pending: PushActionFailure[] = [];

    const flush = () => {
        if (!active || disposed || !deliver) return;

        const failures = pending;
        pending = [];
        failures.forEach(deliver);
    };

    return {
        report(failure: PushActionFailure): void {
            if (disposed || !deliver) return;
            if (active) {
                deliver(failure);
                return;
            }

            pending = [...pending.slice(-(MAX_PENDING_FAILURES - 1)), failure];
        },
        onAppStateChange(state: string): void {
            active = state === "active";
            flush();
        },
        clearPending(): void {
            pending = [];
        },
        dispose(): void {
            disposed = true;
            pending = [];
        },
    };
}

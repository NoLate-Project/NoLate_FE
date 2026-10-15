/** Foreground recovery for ETA updates when no push token/delivery is available.
 * Never relies on JavaScript timers in the background. Account fencing and
 * idempotent native generation application remain in departureAlarmSync.
 */
export function createForegroundAlarmSnapshotPoller(
    synchronize: (memberId: number) => Promise<unknown>,
    // A newly observed train can move departure to less than a minute away.
    // A 60-second foreground poll left the old native generation pending past
    // that deadline in real E2E. This reads our DB snapshot, not transit APIs.
    intervalMs = 15_000,
) {
    let memberId: number | undefined;
    let active = false;
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const schedule = () => {
        clear();
        if (disposed || !active || !memberId || running) return;
        timer = setTimeout(async () => {
            timer = undefined;
            const candidate = memberId;
            if (disposed || !active || !candidate) return;
            running = true;
            try { await synchronize(candidate); }
            catch { /* The next foreground tick recovers; never log credentials/raw HTTP errors. */ }
            finally { running = false; schedule(); }
        }, intervalMs);
    };
    return {
        setMember(value: number | undefined) { memberId = value; schedule(); },
        setActive(value: boolean) { active = value; schedule(); },
        dispose() { disposed = true; memberId = undefined; clear(); },
    };
}

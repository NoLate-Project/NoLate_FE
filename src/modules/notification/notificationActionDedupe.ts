export type NotificationActionLease = {
    commit: (nowMs?: number) => void;
    rollback: () => void;
};

export function createNotificationActionDedupe(options: {
    ttlMs?: number;
    maxSize?: number;
} = {}) {
    const ttlMs = options.ttlMs ?? 5 * 60_000;
    const maxSize = options.maxSize ?? 100;
    const committedAt = new Map<string, number>();
    const inFlight = new Set<string>();
    let generation = 0;

    const prune = (nowMs: number) => {
        committedAt.forEach((timestamp, key) => {
            if (nowMs - timestamp >= ttlMs) committedAt.delete(key);
        });
        while (committedAt.size > maxSize) {
            const firstKey = committedAt.keys().next().value as string | undefined;
            if (!firstKey) break;
            committedAt.delete(firstKey);
        }
    };

    return {
        begin(key: string, nowMs = Date.now()): NotificationActionLease | undefined {
            prune(nowMs);
            if (inFlight.has(key) || committedAt.has(key)) return undefined;
            inFlight.add(key);
            const leaseGeneration = generation;
            let settled = false;

            return {
                commit(committedNowMs = Date.now()): void {
                    if (settled) return;
                    settled = true;
                    if (leaseGeneration !== generation) return;
                    inFlight.delete(key);
                    committedAt.set(key, committedNowMs);
                    prune(committedNowMs);
                },
                rollback(): void {
                    if (settled) return;
                    settled = true;
                    if (leaseGeneration !== generation) return;
                    inFlight.delete(key);
                },
            };
        },
        clear(): void {
            generation += 1;
            committedAt.clear();
            inFlight.clear();
        },
    };
}

export async function executeNotificationActionOnce<TResult>(
    dedupe: ReturnType<typeof createNotificationActionDedupe>,
    key: string,
    action: () => Promise<TResult>,
    onSuccess: (result: TResult) => void | Promise<void>,
): Promise<boolean> {
    const lease = dedupe.begin(key);
    if (!lease) return false;

    try {
        const result = await action();
        await onSuccess(result);
        lease.commit();
        return true;
    } catch (error) {
        lease.rollback();
        throw error;
    }
}

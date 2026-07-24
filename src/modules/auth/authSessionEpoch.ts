const listeners = new Set<(epoch: number) => void>();
let currentEpoch = 0;

export function getAuthSessionEpoch(): number {
    return currentEpoch;
}

export function isAuthSessionEpochCurrent(epoch: number): boolean {
    return currentEpoch === epoch;
}

export function subscribeAuthSessionEpoch(
    listener: (epoch: number) => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * This is the single generation source for storage, requests, caches, stores,
 * push actions, and navigation. Only explicit auth intents advance it.
 */
export function advanceAuthSessionEpoch(): number {
    currentEpoch += 1;
    listeners.forEach((listener) => listener(currentEpoch));
    return currentEpoch;
}

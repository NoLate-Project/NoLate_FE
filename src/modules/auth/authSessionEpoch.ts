const listeners = new Set<(epoch: number) => void>();
let currentEpoch = 0;
let sessionPhase:
    | "BOOTSTRAPPING"
    | "AUTHENTICATING"
    | "ACTIVE"
    | "LOGGING_OUT"
    | "SIGNED_OUT" = "BOOTSTRAPPING";
let authSessionTransitionBarrier: Promise<void> = Promise.resolve();

export function getAuthSessionEpoch(): number {
    return currentEpoch;
}

export function isAuthSessionEpochCurrent(epoch: number): boolean {
    return currentEpoch === epoch;
}

export function isAuthSessionActive(epoch = currentEpoch): boolean {
    return currentEpoch === epoch && sessionPhase === "ACTIVE";
}

export function isAuthSessionRestorable(epoch: number): boolean {
    return currentEpoch === epoch && (
        sessionPhase === "BOOTSTRAPPING" ||
        sessionPhase === "ACTIVE"
    );
}

export function isAuthSessionWritable(epoch: number): boolean {
    return currentEpoch === epoch && (
        sessionPhase === "AUTHENTICATING" ||
        sessionPhase === "ACTIVE"
    );
}

export function registerAuthSessionTransitionBarrier(
    transition: Promise<unknown>,
): void {
    const previousBarrier = authSessionTransitionBarrier;
    const barrier = Promise.all([previousBarrier, transition]).then(
        () => undefined,
        () => undefined,
    );
    authSessionTransitionBarrier = barrier;
    barrier.finally(() => {
        if (authSessionTransitionBarrier === barrier) {
            authSessionTransitionBarrier = Promise.resolve();
        }
    }).catch(() => undefined);
}

export async function waitForAuthSessionTransition(): Promise<void> {
    await authSessionTransitionBarrier;
}

export function beginAuthLoginSession(): number {
    sessionPhase = "AUTHENTICATING";
    return advanceAuthSessionEpoch();
}

export function activateAuthSessionIfCurrent(epoch: number): boolean {
    if (
        currentEpoch !== epoch ||
        (
            sessionPhase !== "BOOTSTRAPPING" &&
            sessionPhase !== "AUTHENTICATING" &&
            sessionPhase !== "ACTIVE"
        )
    ) return false;
    sessionPhase = "ACTIVE";
    return true;
}

export function beginAuthLogoutSession(): number {
    // This assignment is synchronous and precedes every storage/network await.
    // New account-owned work is therefore rejected at the instant logout starts.
    sessionPhase = "LOGGING_OUT";
    return advanceAuthSessionEpoch();
}

export function completeAuthLogoutSession(epoch: number): boolean {
    if (currentEpoch !== epoch || sessionPhase !== "LOGGING_OUT") return false;
    sessionPhase = "SIGNED_OUT";
    return true;
}

export function invalidateAuthSession(): number {
    sessionPhase = "SIGNED_OUT";
    return advanceAuthSessionEpoch();
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

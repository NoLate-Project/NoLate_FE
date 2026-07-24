const listeners = new Set<(epoch: number) => void>();
let currentEpoch = 0;
let sessionPhase:
    | "BOOTSTRAPPING"
    | "AUTHENTICATING"
    | "ACTIVE"
    | "LOGGING_OUT"
    | "SIGNED_OUT" = "BOOTSTRAPPING";
let authSessionTransitionBarrier: Promise<void> = Promise.resolve();
let authSessionTransitionHoldSequence = 0;
const failedAuthSessionTransitionHoldIds = new Set<number>();
export type SocialAuthProvider = "naver" | "kakao" | "apple";
const socialAuthTransitionBarriers = new Map<
    SocialAuthProvider,
    Promise<void>
>();
export const AUTH_SESSION_TRANSITION_WAIT_MS = 8_000;

export function __resetAuthSessionTransitionsForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    authSessionTransitionBarrier = Promise.resolve();
    failedAuthSessionTransitionHoldIds.clear();
    socialAuthTransitionBarriers.clear();
}

export class AuthSessionTransitionPendingError extends Error {
    readonly code = "AUTH_SESSION_TRANSITION_PENDING";

    constructor() {
        super(
            "이전 계정의 보안 정리가 끝나지 않았어요. 잠시 후 다시 시도하고, 계속되면 앱을 완전히 종료한 뒤 다시 열어 주세요.",
        );
        this.name = "AuthSessionTransitionPendingError";
    }
}

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
    const barrier = Promise.allSettled([
        previousBarrier,
        transition,
    ]).then(() => undefined);
    authSessionTransitionBarrier = barrier;
    barrier.finally(() => {
        if (authSessionTransitionBarrier === barrier) {
            authSessionTransitionBarrier = Promise.resolve();
        }
    }).catch(() => undefined);
}

export type AuthSessionTransitionHold = {
    readonly id: number;
    readonly failed: boolean;
    release: () => void;
    fail: () => void;
};

function createAuthSessionTransitionHold(): AuthSessionTransitionHold {
    const id = ++authSessionTransitionHoldSequence;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
    });
    registerAuthSessionTransitionBarrier(barrier);
    let terminalState: "ACTIVE" | "RELEASED" | "FAILED" = "ACTIVE";
    const settle = (failed: boolean) => {
        if (terminalState !== "ACTIVE") return;
        terminalState = failed ? "FAILED" : "RELEASED";
        if (failed) failedAuthSessionTransitionHoldIds.add(id);
        else failedAuthSessionTransitionHoldIds.delete(id);
        releaseBarrier();
    };
    return {
        id,
        get failed() {
            return terminalState === "FAILED";
        },
        release: () => settle(false),
        fail: () => settle(true),
    };
}

export function holdAuthSessionTransition(): AuthSessionTransitionHold {
    return createAuthSessionTransitionHold();
}

export function replaceFailedAuthSessionTransition(
    failedHold: AuthSessionTransitionHold,
): AuthSessionTransitionHold {
    if (
        !failedHold.failed ||
        !failedAuthSessionTransitionHoldIds.has(failedHold.id)
    ) {
        return failedHold;
    }
    failedAuthSessionTransitionHoldIds.delete(failedHold.id);
    return createAuthSessionTransitionHold();
}

export function registerSocialAuthTransitionBarrier(
    provider: SocialAuthProvider,
    transition: Promise<unknown>,
): void {
    const previousBarrier =
        socialAuthTransitionBarriers.get(provider) ?? Promise.resolve();
    const barrier = Promise.allSettled([
        previousBarrier,
        transition,
    ]).then(() => undefined);
    socialAuthTransitionBarriers.set(provider, barrier);
    barrier.finally(() => {
        if (socialAuthTransitionBarriers.get(provider) === barrier) {
            socialAuthTransitionBarriers.delete(provider);
        }
    }).catch(() => undefined);
}

export async function waitForAuthSessionTransition(options: {
    timeoutMs?: number;
} = {}): Promise<void> {
    if (failedAuthSessionTransitionHoldIds.size > 0) {
        throw new AuthSessionTransitionPendingError();
    }
    const timeoutMs =
        options.timeoutMs ?? AUTH_SESSION_TRANSITION_WAIT_MS;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    await waitForStableTransitionBarrier(
        () => authSessionTransitionBarrier,
        deadline,
    );
    if (failedAuthSessionTransitionHoldIds.size > 0) {
        throw new AuthSessionTransitionPendingError();
    }
}

export async function waitForSocialAuthTransition(
    provider: SocialAuthProvider,
    options: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs =
        options.timeoutMs ?? AUTH_SESSION_TRANSITION_WAIT_MS;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
        await waitForStableTransitionBarrier(
            () => authSessionTransitionBarrier,
            deadline,
        );
        const observedProviderBarrier =
            socialAuthTransitionBarriers.get(provider) ?? Promise.resolve();
        await waitForTransitionBarrier(
            observedProviderBarrier,
            remainingTransitionMs(deadline),
        );
        await waitForStableTransitionBarrier(
            () => authSessionTransitionBarrier,
            deadline,
        );
        if (
            (socialAuthTransitionBarriers.get(provider) ??
                observedProviderBarrier) === observedProviderBarrier
        ) return;
    }
}

async function waitForStableTransitionBarrier(
    getBarrier: () => Promise<void>,
    deadline: number,
): Promise<void> {
    while (true) {
        const observedBarrier = getBarrier();
        await waitForTransitionBarrier(
            observedBarrier,
            remainingTransitionMs(deadline),
        );
        // A remote cleanup can be registered while a waiter is already blocked
        // on the local cleanup. Do not let that waiter slip past the newer tail.
        if (getBarrier() === observedBarrier) return;
    }
}

function remainingTransitionMs(deadline: number): number {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new AuthSessionTransitionPendingError();
    return remainingMs;
}

function waitForTransitionBarrier(
    barrier: Promise<void>,
    timeoutMs: number,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new AuthSessionTransitionPendingError());
        }, timeoutMs);
        barrier.then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            () => {
                clearTimeout(timer);
                resolve();
            },
        );
    });
}

export function isAuthSessionTransitionPendingError(
    error: unknown,
): error is AuthSessionTransitionPendingError {
    return error instanceof AuthSessionTransitionPendingError ||
        (
            typeof error === "object" &&
            error !== null &&
            (error as { code?: unknown }).code ===
                "AUTH_SESSION_TRANSITION_PENDING"
        );
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
    listeners.forEach((listener) => {
        try {
            listener(currentEpoch);
        } catch {
            // One UI subscriber must not prevent the synchronous security fence
            // or the remaining session owners from observing the transition.
        }
    });
    return currentEpoch;
}

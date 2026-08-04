import { retryPushRegistration } from "./pushRegistrationRetry";

const TOKEN_REFRESH_RETRY_DELAYS_MS = [0, 1_500, 4_000, 15_000] as const;

type LatestPushTokenRetryOptions = {
    register: (token: string) => Promise<void>;
    onError?: (error: unknown) => void;
    delaysMs?: readonly number[];
    sleep?: (delayMs: number) => Promise<void>;
};

export type LatestPushTokenRetryCoordinator = {
    enqueue: (token: string) => Promise<void>;
    stop: () => void;
};

/**
 * Serializes native token rotations so an older request can never become the
 * final server value after a newer token arrives. Each current token gets a
 * bounded retry budget; a newer token or account cleanup invalidates the rest.
 */
export function createLatestPushTokenRetryCoordinator({
    register,
    onError = () => undefined,
    delaysMs = TOKEN_REFRESH_RETRY_DELAYS_MS,
    sleep,
}: LatestPushTokenRetryOptions): LatestPushTokenRetryCoordinator {
    let active = true;
    let revision = 0;
    let pending: { token: string; revision: number } | undefined;
    let worker: Promise<void> | undefined;

    const startWorker = (): Promise<void> => {
        if (worker) return worker;

        const request = (async () => {
            while (active && pending) {
                const candidate = pending;
                pending = undefined;
                try {
                    await retryPushRegistration(
                        () => register(candidate.token),
                        {
                            delaysMs,
                            isCurrent: () => active && candidate.revision === revision,
                            ...(sleep ? { sleep } : {}),
                        },
                    );
                } catch (error) {
                    if (active && candidate.revision === revision) onError(error);
                }
            }
        })().finally(() => {
            if (worker === request) worker = undefined;
            if (active && pending) startWorker();
        });
        worker = request;
        return request;
    };

    return {
        enqueue(token: string): Promise<void> {
            const normalized = token.trim();
            if (!active || !normalized) return Promise.resolve();
            revision += 1;
            pending = { token: normalized, revision };
            return startWorker();
        },
        stop(): void {
            active = false;
            revision += 1;
            pending = undefined;
        },
    };
}

export const PUSH_TOKEN_REFRESH_RETRY_TEST_CONSTANTS = process.env.NODE_ENV === "test"
    ? { delaysMs: TOKEN_REFRESH_RETRY_DELAYS_MS }
    : undefined;

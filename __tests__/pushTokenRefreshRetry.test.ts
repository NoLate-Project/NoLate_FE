import {
    createLatestPushTokenRetryCoordinator,
    PUSH_TOKEN_REFRESH_RETRY_TEST_CONSTANTS,
} from "../src/modules/notification/pushTokenRefreshRetry";

function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe("latest push-token refresh retry coordinator", () => {
    test("retries a transient server failure with a bounded delay budget", async () => {
        const register = jest.fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockRejectedValueOnce(new Error("timeout"))
            .mockResolvedValue(undefined);
        const sleep = jest.fn().mockResolvedValue(undefined);
        const onError = jest.fn();
        const coordinator = createLatestPushTokenRetryCoordinator({
            register,
            sleep,
            onError,
        });

        await coordinator.enqueue(" refreshed-token ");

        expect(register).toHaveBeenCalledTimes(3);
        expect(register).toHaveBeenNthCalledWith(1, "refreshed-token");
        expect(sleep).toHaveBeenNthCalledWith(
            1,
            PUSH_TOKEN_REFRESH_RETRY_TEST_CONSTANTS!.delaysMs[1],
        );
        expect(sleep).toHaveBeenNthCalledWith(
            2,
            PUSH_TOKEN_REFRESH_RETRY_TEST_CONSTANTS!.delaysMs[2],
        );
        expect(onError).not.toHaveBeenCalled();
    });

    test("serializes a newer token behind an in-flight request and skips stale retries", async () => {
        const oldAttempt = deferred();
        const register = jest.fn((token: string) => (
            token === "old-token" ? oldAttempt.promise : Promise.resolve()
        ));
        const sleep = jest.fn().mockResolvedValue(undefined);
        const coordinator = createLatestPushTokenRetryCoordinator({ register, sleep });

        const oldWorker = coordinator.enqueue("old-token");
        const latestWorker = coordinator.enqueue("new-token");
        oldAttempt.reject(new Error("old token failed"));
        await Promise.all([oldWorker, latestWorker]);

        expect(register.mock.calls.map(([token]) => token)).toEqual([
            "old-token",
            "new-token",
        ]);
        expect(sleep).not.toHaveBeenCalled();
    });

    test("stops delayed retries at the account lifecycle boundary", async () => {
        const delayedRetry = deferred();
        const register = jest.fn().mockRejectedValue(new Error("offline"));
        const coordinator = createLatestPushTokenRetryCoordinator({
            register,
            sleep: () => delayedRetry.promise,
        });

        const worker = coordinator.enqueue("old-account-token");
        await Promise.resolve();
        coordinator.stop();
        delayedRetry.resolve(undefined);
        await worker;

        expect(register).toHaveBeenCalledTimes(1);
    });
});

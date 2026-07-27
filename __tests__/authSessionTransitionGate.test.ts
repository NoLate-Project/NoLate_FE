import {
    __resetAuthSessionTransitionsForTests,
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    beginAuthLogoutSession,
    holdAuthSessionTransition,
    isAuthSessionActive,
    registerAuthSessionTransitionBarrier,
    registerSocialAuthTransitionBarrier,
    replaceFailedAuthSessionTransition,
    waitForAuthSessionTransition,
    waitForSocialAuthTransition,
} from "../src/modules/auth/authSessionEpoch";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe("account-exit authentication start gate", () => {
    beforeEach(() => {
        jest.useRealTimers();
        __resetAuthSessionTransitionsForTests();
        const epoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(epoch);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test.each([
        "email loginMember",
        "common signup",
        "SNS signup network",
    ])("%s은 동적으로 등록된 local/withdraw cleanup 완료 전 시작하지 않는다", async () => {
        const localCleanup = deferred<void>();
        const remoteCleanup = deferred<void>();
        const authenticationNetwork = jest.fn(async () => "B-session");
        registerAuthSessionTransitionBarrier(localCleanup.promise);

        const bAuthentication = waitForAuthSessionTransition({
            timeoutMs: 10_000,
        }).then(authenticationNetwork);
        await Promise.resolve();
        // Profile/AuthProvider registers withdrawal cleanup while the
        // waiter can already be observing the local cleanup tail.
        registerAuthSessionTransitionBarrier(remoteCleanup.promise);
        localCleanup.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(authenticationNetwork).not.toHaveBeenCalled();

        remoteCleanup.resolve();
        await expect(bAuthentication).resolves.toBe("B-session");
        expect(authenticationNetwork).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["naver", "Naver SDK login"],
        ["kakao", "Kakao SDK login"],
    ] as const)(
        "%s destructive cleanup은 같은 provider %s 시작만 직렬화한다",
        async (provider, _label) => {
            const sdkCleanup = deferred<void>();
            const sameProviderLogin = jest.fn(async () => "same-provider");
            const emailLogin = jest.fn(async () => "email");
            const otherProviderLogin = jest.fn(async () => "other-provider");
            registerSocialAuthTransitionBarrier(provider, sdkCleanup.promise);

            const same = waitForSocialAuthTransition(provider, {
                timeoutMs: 10_000,
            }).then(sameProviderLogin);
            const email = waitForAuthSessionTransition({
                timeoutMs: 10_000,
            }).then(emailLogin);
            const otherProvider = provider === "naver" ? "kakao" : "naver";
            const other = waitForSocialAuthTransition(otherProvider, {
                timeoutMs: 10_000,
            }).then(otherProviderLogin);

            await expect(email).resolves.toBe("email");
            await expect(other).resolves.toBe("other-provider");
            expect(sameProviderLogin).not.toHaveBeenCalled();

            sdkCleanup.resolve();
            await expect(same).resolves.toBe("same-provider");
            expect(sameProviderLogin).toHaveBeenCalledTimes(1);
        },
    );

    test("cleanup 실패가 terminal rejection으로 끝나면 gate가 정리되고 B가 정상 시작한다", async () => {
        const remoteCleanup = deferred<void>();
        const authenticationNetwork = jest.fn(async () => "B-session");
        registerAuthSessionTransitionBarrier(remoteCleanup.promise);
        const bAuthentication = waitForAuthSessionTransition({
            timeoutMs: 10_000,
        }).then(authenticationNetwork);

        remoteCleanup.reject(new Error("SDK logout failed"));

        await expect(bAuthentication).resolves.toBe("B-session");
        expect(authenticationNetwork).toHaveBeenCalledTimes(1);
    });

    test("cleanup이 멈추면 로그인 시도는 bounded error로 끝나고 인증 네트워크는 0회다", async () => {
        jest.useFakeTimers();
        const remoteCleanup = deferred<void>();
        const authenticationNetwork = jest.fn(async () => "unsafe-B-session");
        registerAuthSessionTransitionBarrier(remoteCleanup.promise);
        const bAuthentication = waitForAuthSessionTransition({
            timeoutMs: 1_000,
        }).then(authenticationNetwork);
        let rejection: unknown;
        const observed = bAuthentication.catch((error) => {
            rejection = error;
        });

        await jest.advanceTimersByTimeAsync(1_000);
        await observed;
        expect(rejection).toMatchObject({
            code: "AUTH_SESSION_TRANSITION_PENDING",
            message: expect.stringContaining("앱을 완전히 종료"),
        });
        expect(authenticationNetwork).not.toHaveBeenCalled();

        // A timed-out waiter never unlocks the security barrier. A retry while
        // the owner is still hung is also bounded and explains recovery, rather
        // than spinning forever or starting an unsafe authentication request.
        const retryNetwork = jest.fn(async () => "unsafe-retry");
        const retry = waitForAuthSessionTransition({
            timeoutMs: 1_000,
        }).then(retryNetwork);
        let retryRejection: unknown;
        const observedRetry = retry.catch((error) => {
            retryRejection = error;
        });
        await jest.advanceTimersByTimeAsync(1_000);
        await observedRetry;
        expect(retryRejection).toMatchObject({
            code: "AUTH_SESSION_TRANSITION_PENDING",
            message: expect.stringContaining("다시 열어"),
        });
        expect(retryNetwork).not.toHaveBeenCalled();

        remoteCleanup.resolve();
        await Promise.resolve();
        await expect(waitForAuthSessionTransition({
            timeoutMs: 1_000,
        })).resolves.toBeUndefined();
    });

    test("timeout 뒤 terminal failure hold를 새 세대 retry로 교체해 재시작 없이 복구한다", async () => {
        jest.useFakeTimers();
        const failedHold = holdAuthSessionTransition();
        const firstNetwork = jest.fn(async () => "unsafe-A");
        const firstAttempt = waitForAuthSessionTransition({
            timeoutMs: 1_000,
        }).then(firstNetwork);
        let firstFailure: unknown;
        const observedFirst = firstAttempt.catch((error) => {
            firstFailure = error;
        });

        await jest.advanceTimersByTimeAsync(1_000);
        await observedFirst;
        expect(firstFailure).toMatchObject({
            code: "AUTH_SESSION_TRANSITION_PENDING",
        });
        expect(firstNetwork).not.toHaveBeenCalled();

        const logoutEpoch = beginAuthLogoutSession();
        expect(isAuthSessionActive(logoutEpoch)).toBe(false);
        failedHold.fail();
        await expect(waitForAuthSessionTransition({
            timeoutMs: 1_000,
        })).rejects.toMatchObject({
            code: "AUTH_SESSION_TRANSITION_PENDING",
        });

        const retryHold = replaceFailedAuthSessionTransition(failedHold);
        expect(retryHold.id).not.toBe(failedHold.id);
        const bNetwork = jest.fn(async () => "B-session");
        const retry = waitForAuthSessionTransition({
            timeoutMs: 1_000,
        }).then(async () => {
            const bEpoch = beginAuthLoginSession();
            expect(activateAuthSessionIfCurrent(bEpoch)).toBe(true);
            return bNetwork();
        });
        await Promise.resolve();
        expect(bNetwork).not.toHaveBeenCalled();

        retryHold.release();
        // A stale owner cannot fail or release the replacement hold.
        failedHold.fail();
        failedHold.release();
        await expect(retry).resolves.toBe("B-session");
        expect(bNetwork).toHaveBeenCalledTimes(1);
        expect(isAuthSessionActive()).toBe(true);
    });

    test("same-provider SDK cleanup timeout은 SDK login을 시작하지 않고 이후 재시도할 수 있다", async () => {
        jest.useFakeTimers();
        const sdkCleanup = deferred<void>();
        const sdkLogin = jest.fn(async () => "unsafe");
        registerSocialAuthTransitionBarrier("naver", sdkCleanup.promise);
        const attempt = waitForSocialAuthTransition("naver", {
            timeoutMs: 1_000,
        }).then(sdkLogin);
        let rejection: unknown;
        const observed = attempt.catch((error) => {
            rejection = error;
        });

        await jest.advanceTimersByTimeAsync(1_000);
        await observed;
        expect(rejection).toMatchObject({
            code: "AUTH_SESSION_TRANSITION_PENDING",
        });
        expect(sdkLogin).not.toHaveBeenCalled();

        sdkCleanup.resolve();
        await Promise.resolve();
        await expect(waitForSocialAuthTransition("naver", {
            timeoutMs: 1_000,
        })).resolves.toBeUndefined();
    });
});

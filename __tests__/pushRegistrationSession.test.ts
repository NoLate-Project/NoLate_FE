import { registerPushToken } from "../src/api/notification";
import {
    activateAuthSessionIfCurrent,
    advanceAuthSessionEpoch,
    beginAuthLoginSession,
    beginAuthLogoutSession,
    getAuthSessionEpoch,
} from "../src/modules/auth/authSessionEpoch";
import { registerPushTokenForSession } from "../src/modules/notification/pushRegistrationSession";

jest.mock("../src/api/notification", () => ({
    registerPushToken: jest.fn(),
}));

const mockedRegisterPushToken = jest.mocked(registerPushToken);

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

beforeEach(() => {
    const epoch = beginAuthLoginSession();
    activateAuthSessionIfCurrent(epoch);
});

afterEach(() => jest.clearAllMocks());

test("logout epoch aborts an in-flight A registration and rejects its late response", async () => {
    const response = deferred<void>();
    mockedRegisterPushToken.mockReturnValueOnce(response.promise);
    const authEpoch = getAuthSessionEpoch();
    const request = registerPushTokenForSession({
        memberId: 1,
        deviceId: "ios-device",
        platform: "IOS",
        token: "A-token",
        authEpoch,
        isRegistrationGenerationCurrent: () => true,
    });
    await Promise.resolve();

    const signal = mockedRegisterPushToken.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    advanceAuthSessionEpoch();
    expect(signal?.aborted).toBe(true);

    response.resolve();
    await expect(request).rejects.toThrow("AUTH_SESSION_CHANGED");
    expect(mockedRegisterPushToken).toHaveBeenCalledTimes(1);
});

test("old onTokenRefresh subscription epoch cannot register A for the new B session", async () => {
    const oldSubscriptionEpoch = getAuthSessionEpoch();
    advanceAuthSessionEpoch();

    await registerPushTokenForSession({
        memberId: 1,
        deviceId: "android-device",
        platform: "ANDROID",
        token: "late-A-token",
        authEpoch: oldSubscriptionEpoch,
        isRegistrationGenerationCurrent: () => true,
    });

    expect(mockedRegisterPushToken).not.toHaveBeenCalled();
});

test("same-session registration sends the auth-owned request with an AbortSignal", async () => {
    mockedRegisterPushToken.mockResolvedValueOnce();
    const authEpoch = getAuthSessionEpoch();

    await registerPushTokenForSession({
        memberId: 2,
        deviceId: "android-device",
        platform: "ANDROID",
        token: "B-token",
        authEpoch,
        isRegistrationGenerationCurrent: () => true,
    });

    expect(mockedRegisterPushToken).toHaveBeenCalledWith({
        memberId: 2,
        deviceId: "android-device",
        platform: "ANDROID",
        token: "B-token",
    }, {
        signal: expect.any(AbortSignal),
    });
});

test("logout-pending에서는 새 push 등록 요청을 시작하지 않는다", async () => {
    const logoutEpoch = beginAuthLogoutSession();

    await registerPushTokenForSession({
        memberId: 1,
        deviceId: "android-device",
        platform: "ANDROID",
        token: "late-A-token",
        authEpoch: logoutEpoch,
        isRegistrationGenerationCurrent: () => true,
    });

    expect(mockedRegisterPushToken).not.toHaveBeenCalled();
});

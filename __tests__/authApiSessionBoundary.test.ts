const mockSecureValues = new Map<string, string>();
const mockRequestUse = jest.fn();
const mockResponseUse = jest.fn();
const mockRawPost = jest.fn();
const mockApiClient = Object.assign(
    jest.fn(async (config) => ({ config, data: { success: true } })),
    {
        interceptors: {
            request: { use: mockRequestUse },
            response: { use: mockResponseUse },
        },
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
);

jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(async (key: string) => mockSecureValues.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
        mockSecureValues.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
        mockSecureValues.delete(key);
    }),
}));

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

jest.mock("axios", () => {
    const axiosMock = {
        create: jest.fn(() => mockApiClient),
        post: mockRawPost,
        isAxiosError: (error: unknown) => Boolean(
            error && typeof error === "object" && (error as { isAxiosError?: boolean }).isAxiosError,
        ),
    };
    return { __esModule: true, default: axiosMock };
});

type RequestHandler = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
type SuccessHandler = (response: {
    config: Record<string, unknown>;
    data?: unknown;
}) => unknown;
type ErrorHandler = (error: Record<string, unknown>) => Promise<unknown>;

const {
    beginAuthLogoutIntent,
    saveAuthTokens,
    saveAuthMember,
    getAccessToken,
    getRefreshToken,
} = require("../src/modules/auth/authStorage") as typeof import("../src/modules/auth/authStorage");
require("../src/api/api");

const requestHandler = mockRequestUse.mock.calls[0][0] as RequestHandler;
const successHandler = mockResponseUse.mock.calls[0][0] as SuccessHandler;
const errorHandler = mockResponseUse.mock.calls[0][1] as ErrorHandler;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function unauthorized(config: Record<string, unknown>) {
    return {
        isAxiosError: true,
        message: "unauthorized",
        config,
        response: { status: 401, data: {} },
    };
}

async function authenticatedConfig(method: string) {
    return requestHandler({
        method,
        url: "/api/schedules/42",
        headers: {},
    });
}

beforeEach(async () => {
    mockApiClient.mockClear();
    mockRawPost.mockReset();
    mockSecureValues.clear();
    await saveAuthTokens("A-access", "A-refresh");
    await saveAuthMember({ id: 1, name: "A" });
});

test.each(["get", "post", "delete"])(
    "late A %s 401 is rejected after B login and never retried with B token",
    async (method) => {
        const config = await authenticatedConfig(method);
        await saveAuthTokens("B-access", "B-refresh");

        await expect(errorHandler(unauthorized(config))).rejects.toMatchObject({
            errorCode: "AUTH_SESSION_CHANGED",
        });
        expect(mockApiClient).not.toHaveBeenCalled();
        expect(mockRawPost).not.toHaveBeenCalled();
    },
);

test("late A 200 is fenced before a B caller can observe its payload", async () => {
    const config = await authenticatedConfig("get");
    await saveAuthTokens("B-access", "B-refresh");

    await expect(successHandler({
        config,
        data: { title: "A private schedule" },
    })).rejects.toMatchObject({ errorCode: "AUTH_SESSION_CHANGED" });
});

test("same epoch concurrent 401s share one rotating refresh and retry once each", async () => {
    const firstConfig = await authenticatedConfig("get");
    const secondConfig = await authenticatedConfig("post");
    const refresh = deferred<{
        data: {
            success: boolean;
            data: { accessToken: string; refreshToken: string };
        };
    }>();
    mockRawPost.mockReturnValueOnce(refresh.promise);

    const first = errorHandler(unauthorized(firstConfig));
    const second = errorHandler(unauthorized(secondConfig));
    await Promise.resolve();
    await Promise.resolve();

    refresh.resolve({
        data: {
            success: true,
            data: {
                accessToken: "A-access-v2",
                refreshToken: "A-refresh-v2",
            },
        },
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    expect(mockRawPost).toHaveBeenCalledTimes(1);
    expect(mockApiClient).toHaveBeenCalledTimes(2);
    for (const [retriedConfig] of mockApiClient.mock.calls) {
        expect(retriedConfig.headers.Authorization).toBe("Bearer A-access-v2");
    }
    await expect(getAccessToken()).resolves.toBe("A-access-v2");
    await expect(getRefreshToken()).resolves.toBe("A-refresh-v2");
});

test("B refresh detaches from aborted A flight and late A failure cannot clear B", async () => {
    const aConfig = await authenticatedConfig("get");
    const aRefresh = deferred<never>();
    const bRefresh = deferred<{
        data: {
            success: boolean;
            data: { accessToken: string; refreshToken: string };
        };
    }>();
    mockRawPost
        .mockReturnValueOnce(aRefresh.promise)
        .mockReturnValueOnce(bRefresh.promise);

    const lateA = errorHandler(unauthorized(aConfig));
    while (mockRawPost.mock.calls.length < 1) await Promise.resolve();

    await saveAuthTokens("B-access", "B-refresh");
    await saveAuthMember({ id: 2, name: "B" });
    const bConfig = await authenticatedConfig("get");
    const bRetry = errorHandler(unauthorized(bConfig));
    while (mockRawPost.mock.calls.length < 2) await Promise.resolve();

    aRefresh.reject({
        isAxiosError: true,
        response: { status: 401 },
    });
    bRefresh.resolve({
        data: {
            success: true,
            data: {
                accessToken: "B-access-v2",
                refreshToken: "B-refresh-v2",
            },
        },
    });

    await expect(lateA).rejects.toMatchObject({ errorCode: "AUTH_SESSION_CHANGED" });
    await expect(bRetry).resolves.toBeDefined();
    expect(mockRawPost).toHaveBeenCalledTimes(2);
    await expect(getAccessToken()).resolves.toBe("B-access-v2");
    await expect(getRefreshToken()).resolves.toBe("B-refresh-v2");
});

test.each(["get", "post", "delete"])(
    "logout-pending에서 새 일반 %s 요청은 adapter 전에 거부된다",
    async (method) => {
        await beginAuthLogoutIntent();

        await expect(authenticatedConfig(method)).rejects.toMatchObject({
            errorCode: "AUTH_SESSION_CHANGED",
        });
        expect(mockApiClient).not.toHaveBeenCalled();
        expect(mockRawPost).not.toHaveBeenCalled();
    },
);

test("withdrawal만 logout-pending epoch에 명시적으로 허용하고 계정 전환 시에는 폐기한다", async () => {
    const intent = await beginAuthLogoutIntent();
    const withdrawalConfig = await requestHandler({
        method: "delete",
        url: "/api/member/withdraw",
        headers: {},
        _allowDuringAccountExit: true,
    });
    expect(withdrawalConfig.headers).toMatchObject({
        Authorization: "Bearer A-access",
    });

    await saveAuthTokens("B-access", "B-refresh");
    await saveAuthMember({ id: 2, name: "B" });
    await expect(successHandler({
        config: withdrawalConfig,
        data: { success: true },
    })).rejects.toMatchObject({ errorCode: "AUTH_SESSION_CHANGED" });
    expect(intent.refreshToken).toBe("A-refresh");
});

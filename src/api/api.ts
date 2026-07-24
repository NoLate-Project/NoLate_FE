import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { Platform } from "react-native";
import { resolveApiBaseUrl } from "./apiBaseUrl";
import { getEnv } from "./env";
import {
    clearAuthTokens,
    captureAuthRestoreContextForEpoch,
    configureSharedAuthApiBaseUrl,
    getAccessToken,
    getAuthSessionEpoch,
    isAuthRefreshContextCurrent,
    isAuthSessionEpochCurrent,
    isAuthSessionRestorable,
    prepareAuthRestoreRequest,
    saveRefreshedAuthTokensIfCurrent,
    subscribeAuthSessionEpoch,
} from "../modules/auth/authStorage";
import { isDefinitiveRefreshStatus } from "../modules/auth/refreshPolicy";
import { ApiResponseError } from "./response";

// 운영 URL이 .env에 들어 있어도 개발 빌드는 로컬 BE를 기본 사용한다. 이전 구현은
// EXPO_PUBLIC_LOCAL_API_BASE_URL이 없으면 개발용 시뮬레이터까지 운영 서버를 호출해,
// 로컬에 반영된 VOICE_TRANSCRIPT 계약을 테스트할 수 없는 문제가 있었다.
export const API_BASE_URL = resolveApiBaseUrl({
    explicitLocalUrl: getEnv("EXPO_PUBLIC_LOCAL_API_BASE_URL"),
    configuredUrl: getEnv("EXPO_PUBLIC_API_BASE_URL"),
    isDevelopment: __DEV__,
    platform: Platform.OS,
});

// 공유 확장이 토큰을 발급한 서버와 정확히 같은 환경을 사용하도록 함께 보관한다.
configureSharedAuthApiBaseUrl(API_BASE_URL);

export const apiClient: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json",
    },
});

type RetryableRequestConfig = AxiosRequestConfig & {
    _retryAuth?: boolean;
    _authSessionEpoch?: number;
    _allowDuringAccountExit?: boolean;
};

type RefreshedAuthTokens = {
    accessToken: string;
    refreshToken: string;
};

let authRefreshGeneration = 0;
let activeAuthRefreshControllers = new Set<AbortController>();
let authRefreshFlight: {
    key: string;
    promise: Promise<RefreshedAuthTokens | null>;
} | null = null;

subscribeAuthSessionEpoch(() => {
    authRefreshGeneration += 1;
    authRefreshFlight = null;
    activeAuthRefreshControllers.forEach((controller) => controller.abort());
    activeAuthRefreshControllers = new Set();
});

async function requestRefreshedAuthTokens(
    startedEpoch: number,
    refreshToken: string,
    generation: number,
): Promise<RefreshedAuthTokens | null> {
    const controller = new AbortController();
    activeAuthRefreshControllers.add(controller);
    const contextIsCurrent = async () => (
        !controller.signal.aborted &&
        generation === authRefreshGeneration &&
        await isAuthRefreshContextCurrent({
            expectedEpoch: startedEpoch,
            expectedRefreshToken: refreshToken,
        }) &&
        generation === authRefreshGeneration &&
        isAuthSessionEpochCurrent(startedEpoch)
    );

    try {
        const refreshResponse = await axios.post<{
            success: boolean;
            data?: { accessToken?: string; refreshToken?: string };
            errorMessage?: string | null;
        }>(
            `${API_BASE_URL}/api/member/auth/refresh`,
            { refreshToken },
            {
                headers: { "Content-Type": "application/json" },
                timeout: 10000,
                signal: controller.signal,
            }
        );
        const tokens = refreshResponse.data.data;

        if (!refreshResponse.data.success || !tokens?.accessToken || !tokens.refreshToken) {
            if (await contextIsCurrent()) await clearAuthTokens();
            return null;
        }

        const refreshedTokens = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        };
        if (!await contextIsCurrent()) return null;
        const saved = await saveRefreshedAuthTokensIfCurrent({
            accessToken: refreshedTokens.accessToken,
            refreshToken: refreshedTokens.refreshToken,
            expectedEpoch: startedEpoch,
            expectedRefreshToken: refreshToken,
        });
        return saved ? refreshedTokens : null;
    } catch (error) {
        // A connection loss, timeout, rate limit, or server outage does not mean the
        // refresh token is invalid. Keep the bounded same-epoch prepared context so
        // connectivity recovery can retry exactly that credential; clear it only
        // when the auth server definitively rejects it. A response-loss after server
        // rotation therefore fails closed on a later rejection instead of mixing
        // unknown rotated credentials into local storage.
        if (isDefinitiveRefreshRejection(error) && await contextIsCurrent()) {
            await clearAuthTokens();
        }
        return null;
    } finally {
        activeAuthRefreshControllers.delete(controller);
    }
}

async function runAuthRefreshForSession(
    expectedEpoch: number,
): Promise<RefreshedAuthTokens | null> {
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
    const restoreContext = await captureAuthRestoreContextForEpoch(
        expectedEpoch,
    );
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
    if (!restoreContext) {
        await clearAuthTokens();
        return null;
    }
    const refreshToken = restoreContext.expectedRefreshToken;

    const key = `${expectedEpoch}:${refreshToken}`;
    if (authRefreshFlight?.key === key) return authRefreshFlight.promise;

    const generation = authRefreshGeneration;
    const promise = (async () => {
        const prepared = await prepareAuthRestoreRequest(restoreContext);
        if (!prepared) return null;
        return requestRefreshedAuthTokens(
            expectedEpoch,
            refreshToken,
            generation,
        );
    })().finally(() => {
        if (authRefreshFlight?.promise === promise) authRefreshFlight = null;
    });
    authRefreshFlight = { key, promise };
    return promise;
}

function isDefinitiveRefreshRejection(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    return isDefinitiveRefreshStatus(error.response?.status);
}

function getRequestAuthorization(config: RetryableRequestConfig): string | null {
    const headers = config.headers;
    if (!headers) return null;

    const headerAccessor = headers as unknown as {
        get?: (name: string) => unknown;
        Authorization?: unknown;
        authorization?: unknown;
    };
    const value =
        typeof headerAccessor.get === "function"
            ? headerAccessor.get("Authorization")
            : headerAccessor.Authorization ?? headerAccessor.authorization;

    return typeof value === "string" ? value : null;
}

function applyAccessToken(config: RetryableRequestConfig, accessToken: string): void {
    config.headers = {
        ...config.headers,
        Authorization: `Bearer ${accessToken}`,
    };
}

function createAuthSessionChangedError(cause?: unknown): ApiResponseError {
    return new ApiResponseError(
        "로그인 계정이 변경되어 이전 요청 결과를 사용하지 않습니다.",
        {
            errorCode: "AUTH_SESSION_CHANGED",
            cause,
        },
    );
}

function isRequestAuthSessionCurrent(config?: RetryableRequestConfig): boolean {
    if (
        typeof config?._authSessionEpoch !== "number" ||
        !isAuthSessionEpochCurrent(config._authSessionEpoch)
    ) return false;
    return config._allowDuringAccountExit === true ||
        isAuthSessionRestorable(config._authSessionEpoch);
}

apiClient.interceptors.request.use(
    async (config) => {
        const requestConfig = config as RetryableRequestConfig;
        if (isAuthEndpoint(config.url)) return config;
        if (requestConfig._authSessionEpoch === undefined) {
            requestConfig._authSessionEpoch = getAuthSessionEpoch();
        }
        if (!isRequestAuthSessionCurrent(requestConfig)) {
            throw createAuthSessionChangedError();
        }
        if (requestConfig._allowDuringAccountExit === true) {
            // Logout has already made normal token reads fail closed. The sole
            // account-exit request must carry the operation-owned access-token
            // snapshot explicitly; never fall back to ambient storage.
            if (!/^Bearer\s+\S+$/.test(
                getRequestAuthorization(requestConfig) ?? "",
            )) {
                throw createAuthSessionChangedError();
            }
            return config;
        }
        const accessToken = await getAccessToken();
        if (!isRequestAuthSessionCurrent(requestConfig)) {
            throw createAuthSessionChangedError();
        }
        if (accessToken && !isAuthEndpoint(config.url)) {
            config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
    },
    (error: AxiosError) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
        const responseConfig = response.config as RetryableRequestConfig;
        if (
            !isAuthEndpoint(responseConfig.url) &&
            !isRequestAuthSessionCurrent(responseConfig)
        ) {
            return Promise.reject(createAuthSessionChangedError());
        }
        return response;
    },
    async (error: AxiosError<{
        errorMessage?: string | null;
        errorCode?: string | null;
        message?: string | null;
    }>) => {
        if (error instanceof ApiResponseError) return Promise.reject(error);
        const originalRequest = error.config as RetryableRequestConfig | undefined;
        const requestUrl = originalRequest?.url ?? "";

        if (
            originalRequest &&
            !isAuthEndpoint(requestUrl) &&
            !isRequestAuthSessionCurrent(originalRequest)
        ) {
            return Promise.reject(createAuthSessionChangedError(error));
        }

        if (
            error.response?.status === 401 &&
            originalRequest &&
            !originalRequest._retryAuth &&
            !isAuthEndpoint(requestUrl) &&
            isAuthSessionRestorable(originalRequest._authSessionEpoch!)
        ) {
            originalRequest._retryAuth = true;
            const currentAccessToken = await getAccessToken();
            if (!isRequestAuthSessionCurrent(originalRequest)) {
                return Promise.reject(createAuthSessionChangedError(error));
            }

            // 다른 동시 요청이 이미 토큰을 갱신했다면 회전된 refresh token을 다시 쓰지 않고
            // 최신 access token으로 바로 재시도한다.
            if (
                currentAccessToken &&
                getRequestAuthorization(originalRequest) !== `Bearer ${currentAccessToken}`
            ) {
                applyAccessToken(originalRequest, currentAccessToken);
                return apiClient(originalRequest);
            }

            const tokens = await runAuthRefreshForSession(
                originalRequest._authSessionEpoch!,
            );
            if (tokens && isRequestAuthSessionCurrent(originalRequest)) {
                applyAccessToken(originalRequest, tokens.accessToken);
                return apiClient(originalRequest);
            }
            if (!isRequestAuthSessionCurrent(originalRequest)) {
                return Promise.reject(createAuthSessionChangedError(error));
            }
        }

        const message =
            error.response?.data?.errorMessage ??
            error.response?.data?.message ??
            error.message;

        return Promise.reject(new ApiResponseError(message, {
            errorCode: error.response?.data?.errorCode ?? error.code,
            status: error.response?.status,
            cause: error,
        }));
    }
);

function isAuthEndpoint(url?: string): boolean {
    return Boolean(url?.includes("/api/member/auth/"));
}

export type AuthBoundRequestConfig<D = unknown> = AxiosRequestConfig<D> & {
    /** Only account withdrawal may finish after the synchronous logout fence closes. */
    _allowDuringAccountExit?: boolean;
};

export async function apiGet<T = unknown>(url: string, config?: AuthBoundRequestConfig) {
    const response = await apiClient.get<T>(url, config);
    return response.data;
}

export async function apiPost<T = unknown, B = unknown>(url: string, body?: B, config?: AuthBoundRequestConfig<B>) {
    const response = await apiClient.post<T>(url, body, config);
    return response.data;
}

export async function apiPut<T = unknown, B = unknown>(url: string, body?: B, config?: AuthBoundRequestConfig<B>) {
    const response = await apiClient.put<T>(url, body, config);
    return response.data;
}

export async function apiPatch<T = unknown, B = unknown>(url: string, body?: B, config?: AuthBoundRequestConfig<B>) {
    const response = await apiClient.patch<T>(url, body, config);
    return response.data;
}

export async function apiDelete<T = unknown>(url: string, config?: AuthBoundRequestConfig) {
    const response = await apiClient.delete<T>(url, config);
    return response.data;
}

export default apiClient;

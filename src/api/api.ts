import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { Platform } from "react-native";
import { resolveApiBaseUrl } from "./apiBaseUrl";
import { getEnv } from "./env";
import { createSingleFlightRunner } from "./singleFlight";
import {
    clearAuthTokens,
    configureSharedAuthApiBaseUrl,
    getAccessToken,
    getRefreshToken,
    saveAuthTokens,
} from "../modules/auth/authStorage";
import { isDefinitiveRefreshStatus } from "../modules/auth/refreshPolicy";
import { ApiResponseError, AuthSessionInvalidatedError } from "./response";

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

export type AuthRecoveryRequestConfig<D = unknown> = AxiosRequestConfig<D> & {
    // Lifecycle work may be awaited by auth invalidation itself. Refresh is
    // allowed, but these requests must report rejection without re-entering it.
    authFailureMode?: "report-only";
};

type RetryableRequestConfig = AuthRecoveryRequestConfig & {
    _retryAuth?: boolean;
};

type RefreshedAuthTokens = {
    accessToken: string;
    refreshToken: string;
};

type AuthRefreshResult =
    | { kind: "refreshed"; tokens: RefreshedAuthTokens }
    | { kind: "invalid"; cause?: unknown }
    | { kind: "unavailable"; cause: unknown };

const runAuthRefresh = createSingleFlightRunner<AuthRefreshResult>();

async function requestRefreshedAuthTokens(): Promise<AuthRefreshResult> {
    const refreshToken = await getRefreshToken();

    if (!refreshToken) {
        return { kind: "invalid" };
    }

    try {
        const refreshResponse = await axios.post<{
            success: boolean;
            data?: { accessToken?: string; refreshToken?: string };
            errorMessage?: string | null;
        }>(
            `${API_BASE_URL}/api/member/auth/refresh`,
            { refreshToken },
            { headers: { "Content-Type": "application/json" }, timeout: 10000 }
        );
        const tokens = refreshResponse.data.data;

        if (!refreshResponse.data.success || !tokens?.accessToken || !tokens.refreshToken) {
            return { kind: "invalid" };
        }

        const refreshedTokens = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        };
        await saveAuthTokens(refreshedTokens.accessToken, refreshedTokens.refreshToken);
        return { kind: "refreshed", tokens: refreshedTokens };
    } catch (error) {
        // A connection loss, timeout, rate limit, or server outage does not mean the
        // refresh token is invalid. Keep the local session so the user can retry when
        // connectivity recovers; clear it only when the auth server definitively rejects it.
        if (isDefinitiveRefreshRejection(error)) {
            return { kind: "invalid", cause: error };
        }
        return { kind: "unavailable", cause: error };
    }
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

apiClient.interceptors.request.use(
    async (config) => {
        const accessToken = await getAccessToken();
        if (accessToken && !isAuthEndpoint(config.url)) {
            config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
    },
    (error: AxiosError) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError<{
        errorMessage?: string | null;
        errorCode?: string | null;
        message?: string | null;
    }>) => {
        const originalRequest = error.config as RetryableRequestConfig | undefined;
        const requestUrl = originalRequest?.url ?? "";

        if (
            error.response?.status === 401 &&
            originalRequest &&
            !originalRequest._retryAuth &&
            !isAuthEndpoint(requestUrl)
        ) {
            originalRequest._retryAuth = true;
            const currentAccessToken = await getAccessToken();

            // 다른 동시 요청이 이미 토큰을 갱신했다면 회전된 refresh token을 다시 쓰지 않고
            // 최신 access token으로 바로 재시도한다.
            if (
                currentAccessToken &&
                getRequestAuthorization(originalRequest) !== `Bearer ${currentAccessToken}`
            ) {
                applyAccessToken(originalRequest, currentAccessToken);
                return apiClient(originalRequest);
            }

            // Never await account cleanup inside the shared refresh flight:
            // cleanup's own HTTP requests may need to join that same flight.
            const result = await runAuthRefresh(requestRefreshedAuthTokens);
            if (result.kind === "refreshed") {
                applyAccessToken(originalRequest, result.tokens.accessToken);
                return apiClient(originalRequest);
            }
            if (result.kind === "invalid") {
                if (originalRequest.authFailureMode === "report-only") {
                    throw new AuthSessionInvalidatedError(result.cause);
                }
                await clearAuthTokens();
            } else if (originalRequest.authFailureMode === "report-only") {
                // Do not disguise an offline/5xx refresh as a revoked session.
                // Lifecycle cleanup must retain its retry/failure boundary.
                throw result.cause;
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

export async function apiGet<T = unknown>(url: string, config?: AxiosRequestConfig) {
    const response = await apiClient.get<T>(url, config);
    return response.data;
}

export async function apiPost<T = unknown, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig<B>) {
    const response = await apiClient.post<T>(url, body, config);
    return response.data;
}

export async function apiPut<T = unknown, B = unknown>(url: string, body?: B, config?: AuthRecoveryRequestConfig<B>) {
    const response = await apiClient.put<T>(url, body, config);
    return response.data;
}

export async function apiPatch<T = unknown, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig<B>) {
    const response = await apiClient.patch<T>(url, body, config);
    return response.data;
}

export async function apiDelete<T = unknown>(url: string, config?: AuthRecoveryRequestConfig) {
    const response = await apiClient.delete<T>(url, config);
    return response.data;
}

export default apiClient;

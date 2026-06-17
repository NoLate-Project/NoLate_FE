import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { Platform } from "react-native";

import { getEnv } from "./env";
import { clearAuthTokens, getAccessToken, getRefreshToken, saveAuthTokens } from "../modules/auth/authStorage";

const defaultBaseUrl = Platform.OS === "android" ? "http://10.0.2.2:5522" : "http://localhost:5522";
export const API_BASE_URL = getEnv("EXPO_PUBLIC_API_BASE_URL") ?? defaultBaseUrl;

export const apiClient: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json",
    },
});

type RetryableRequestConfig = AxiosRequestConfig & {
    _retryAuth?: boolean;
};

apiClient.interceptors.request.use(
    async (config) => {
        const accessToken = await getAccessToken();
        if (accessToken) {
            config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
    },
    (error: AxiosError) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError<{ errorMessage?: string | null; message?: string | null }>) => {
        const originalRequest = error.config as RetryableRequestConfig | undefined;
        const requestUrl = originalRequest?.url ?? "";

        if (
            error.response?.status === 401 &&
            originalRequest &&
            !originalRequest._retryAuth &&
            !requestUrl.includes("/api/member/auth/refresh") &&
            !requestUrl.includes("/api/member/auth/login") &&
            !requestUrl.includes("/api/member/auth/token-login")
        ) {
            originalRequest._retryAuth = true;
            const refreshToken = await getRefreshToken();

            if (refreshToken) {
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

                    if (refreshResponse.data.success && tokens?.accessToken && tokens.refreshToken) {
                        await saveAuthTokens(tokens.accessToken, tokens.refreshToken);
                        originalRequest.headers = {
                            ...originalRequest.headers,
                            Authorization: `Bearer ${tokens.accessToken}`,
                        };
                        return apiClient(originalRequest);
                    }
                } catch {
                    await clearAuthTokens();
                }
            } else {
                await clearAuthTokens();
            }
        }

        const message =
            error.response?.data?.errorMessage ??
            error.response?.data?.message ??
            error.message;

        return Promise.reject(new Error(message));
    }
);

export async function apiGet<T = unknown>(url: string, config?: AxiosRequestConfig) {
    const response = await apiClient.get<T>(url, config);
    return response.data;
}

export async function apiPost<T = unknown, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig<B>) {
    const response = await apiClient.post<T>(url, body, config);
    return response.data;
}

export async function apiPut<T = unknown, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig<B>) {
    const response = await apiClient.put<T>(url, body, config);
    return response.data;
}

export async function apiPatch<T = unknown, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig<B>) {
    const response = await apiClient.patch<T>(url, body, config);
    return response.data;
}

export async function apiDelete<T = unknown>(url: string, config?: AxiosRequestConfig) {
    const response = await apiClient.delete<T>(url, config);
    return response.data;
}

export default apiClient;

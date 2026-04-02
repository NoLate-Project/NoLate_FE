import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { Platform } from "react-native";

import { getEnv } from "./env";
import { getAccessToken } from "../modules/auth/authStorage";

const defaultBaseUrl = Platform.OS === "android" ? "http://10.0.2.2:5522" : "http://localhost:5522";
export const API_BASE_URL = getEnv("EXPO_PUBLIC_API_BASE_URL") ?? defaultBaseUrl;

export const apiClient: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json",
    },
});

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
    (error: AxiosError) => Promise.reject(error)
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

export async function apiDelete<T = unknown>(url: string, config?: AxiosRequestConfig) {
    const response = await apiClient.delete<T>(url, config);
    return response.data;
}

export default apiClient;

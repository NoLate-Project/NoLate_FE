import { apiPost } from "./api";
import { getEnv } from "./env";

type ApiEnvelope<T> = {
    success: boolean;
    data?: T;
    errorMessage?: string | null;
};

export type TransitRouteProxyRequest = {
    startX: string;
    startY: string;
    endX: string;
    endY: string;
    count: number;
    lang: number;
    format: "json";
    searchDttm: string;
};

export function isTransitRouteProxyEnabled(): boolean {
    return getEnv("EXPO_PUBLIC_ROUTE_API_PROXY_ENABLED") === "true";
}

/** 서버 프록시를 통해 앱 번들 밖에서 TMAP 키를 사용한다. */
export async function getTransitRouteViaProxy<T>(request: TransitRouteProxyRequest): Promise<T> {
    const response = await apiPost<ApiEnvelope<T>, TransitRouteProxyRequest>(
        "/api/routes/transit",
        request
    );
    if (!response.success || !response.data) {
        throw new Error(response.errorMessage || "대중교통 경로 프록시 응답이 비어 있습니다.");
    }
    return response.data;
}

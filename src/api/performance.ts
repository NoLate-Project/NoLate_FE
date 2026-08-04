import { apiPost } from "./api";
import { unwrapApiResponse, type ApiEnvelope } from "./response";

export type NavigationPerformanceCompletionKind =
    | "TRANSITION"
    | "FRAME"
    | "NEXT_NAVIGATION";

export type NavigationPerformancePlatform = "IOS" | "ANDROID" | "WEB";

export type NavigationPerformanceEventPayload = {
    eventId: string;
    fromRoute: string;
    toRoute: string;
    action: string;
    routeReadyMs: number;
    totalMs: number;
    completionKind: NavigationPerformanceCompletionKind;
    platform: NavigationPerformancePlatform;
    appVersion?: string;
    buildVersion?: string;
    occurredAt: string;
};

type NavigationPerformanceBatchResponse = {
    acceptedCount: number;
    storedCount: number;
};

export async function postNavigationPerformanceEvents(
    events: NavigationPerformanceEventPayload[],
): Promise<NavigationPerformanceBatchResponse> {
    const response = await apiPost<
        ApiEnvelope<NavigationPerformanceBatchResponse>,
        { events: NavigationPerformanceEventPayload[] }
    >("/api/performance/navigation-events", { events });
    return unwrapApiResponse(response);
}

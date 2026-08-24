import { apiPost } from "./api";
import { unwrapApiResponse, type ApiEnvelope } from "./response";

export type NavigationPerformanceCompletionKind =
    | "TRANSITION"
    | "FRAME"
    | "NEXT_NAVIGATION";

export type NavigationPerformancePlatform = "IOS" | "ANDROID" | "WEB";

export type InteractionPerformanceKind = "CONTENT_READY" | "INTERACTION" | "NETWORK";
export type InteractionPerformanceOutcome = "SUCCESS" | "ERROR" | "CANCELLED";
export const INTERACTION_PERFORMANCE_OPERATIONS = [
    "schedule.content_ready",
    "schedule.range_load",
    "schedule.range_refresh",
    "schedule.revision_sync",
    "schedule.calendar_metadata_load",
    "schedule.detail_load",
    "schedule.detail_content_ready",
    "calendar.settings_content_ready",
    "calendar.list_load",
    "calendar.members_load",
    "category.settings_content_ready",
    "category.list_load",
    "quick_schedule.analyze",
    "route.search",
    "alarm.content_ready",
    "alarm.preview_schedule_load",
    "alarm.complete_departure",
] as const;
export type InteractionPerformanceOperation =
    typeof INTERACTION_PERFORMANCE_OPERATIONS[number];

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

export type InteractionPerformanceEventPayload = {
    eventId: string;
    route: string;
    operation: InteractionPerformanceOperation;
    kind: InteractionPerformanceKind;
    outcome: InteractionPerformanceOutcome;
    durationMs: number;
    platform: NavigationPerformancePlatform;
    appVersion?: string;
    buildVersion?: string;
    occurredAt: string;
};

type InteractionPerformanceBatchResponse = {
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

export async function postInteractionPerformanceEvents(
    events: InteractionPerformanceEventPayload[],
): Promise<InteractionPerformanceBatchResponse> {
    const response = await apiPost<
        ApiEnvelope<InteractionPerformanceBatchResponse>,
        { events: InteractionPerformanceEventPayload[] }
    >("/api/performance/interaction-events", { events });
    return unwrapApiResponse(response);
}

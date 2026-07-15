import type { RouteAlternativeOption } from "../map/routingService";
import type { TravelMode } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * 목록에서 선택한 경로를 상세 화면의 최초 단일 진실 공급원으로 복구한다.
 * URL의 routeId와 이동수단이 함께 맞아야 하므로 오래된 세션 경로가 섞이지 않는다.
 */
export function resolveRouteSelectionHandoff(
    value: unknown,
    expectedMode: TravelMode,
    expectedRouteId?: string
): RouteAlternativeOption | undefined {
    if (!isRecord(value)) return undefined;

    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id || value.mode !== expectedMode) return undefined;
    if (expectedRouteId && id !== expectedRouteId) return undefined;
    if (value.source !== "api" && value.source !== "fallback") return undefined;

    return value as RouteAlternativeOption;
}

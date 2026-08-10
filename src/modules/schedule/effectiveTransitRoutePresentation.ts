import type {
    EffectiveTransitRoute,
    EffectiveTransitRouteSegment,
    ScheduleDepartureStatus,
} from "../../api/schedule";

export type FreshDepartureTiming = {
    recommendedDepartureAt: Date;
    travelMinutes: number;
};

export type ScheduleDetailDepartureTiming = {
    recommendedDepartureAt?: Date;
    travelMinutes?: number;
};

export type EffectiveTransitRoutePresentation = {
    summary: string;
    itinerary: string;
    waitMeta?: string;
    mapNote: string;
};

const MAP_SAVED_ROUTE_NOTE = "지도에는 저장한 경로가 표시돼요";

function isPositiveMinute(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function formatLocalClock(parsed: Date): string {
    const hours = String(parsed.getHours()).padStart(2, "0");
    const minutes = String(parsed.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function formatClock(
    value: string | null | undefined,
    timeZone: string | null | undefined,
): string | undefined {
    const parsed = parseDate(value);
    if (!parsed) return undefined;

    if (timeZone) {
        try {
            return new Intl.DateTimeFormat("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone,
            }).format(parsed);
        } catch {
            // Older Hermes runtimes and invalid IANA zones fall back to device-local display.
        }
    }

    return formatLocalClock(parsed);
}

/**
 * Only accepted provider snapshots may replace the schedule's saved ETA.
 * Stale/failure snapshots remain useful diagnostics on the server, but must
 * not move the departure countdown in the client.
 */
export function getFreshDepartureTiming(
    status: ScheduleDepartureStatus | null | undefined,
): FreshDepartureTiming | undefined {
    if (!status || status.stale || status.failureReason) return undefined;
    if (!isPositiveMinute(status.travelMinutes)) return undefined;

    const recommendedDepartureAt = parseDate(status.recommendedDepartureAt);
    if (!recommendedDepartureAt) return undefined;

    return {
        recommendedDepartureAt,
        travelMinutes: status.travelMinutes,
    };
}

/** An explicit stale/failure response expires the previously accepted live timing. */
export function resolveAcceptedDepartureStatus(
    candidate: ScheduleDepartureStatus,
): ScheduleDepartureStatus | undefined {
    return getFreshDepartureTiming(candidate) ? candidate : undefined;
}

/**
 * A participant's inspected plan is a hard presentation boundary. Current-member
 * live status must never fill missing timing in another participant's plan.
 */
export function resolveScheduleDetailDepartureTiming({
    status,
    savedRecommendedDepartureAt,
    savedTravelMinutes,
    isInspectingTravelPlan,
    inspectedRecommendedDepartureAt,
    inspectedTravelMinutes,
}: {
    status: ScheduleDepartureStatus | null | undefined;
    savedRecommendedDepartureAt?: Date;
    savedTravelMinutes?: number | null;
    isInspectingTravelPlan: boolean;
    inspectedRecommendedDepartureAt?: Date;
    inspectedTravelMinutes?: number | null;
}): ScheduleDetailDepartureTiming {
    if (isInspectingTravelPlan) {
        return {
            recommendedDepartureAt: inspectedRecommendedDepartureAt,
            travelMinutes: isPositiveMinute(inspectedTravelMinutes)
                ? inspectedTravelMinutes
                : undefined,
        };
    }

    const fresh = getFreshDepartureTiming(status);
    return {
        recommendedDepartureAt: fresh?.recommendedDepartureAt ?? savedRecommendedDepartureAt,
        travelMinutes: fresh?.travelMinutes ?? (
            isPositiveMinute(savedTravelMinutes) ? savedTravelMinutes : undefined
        ),
    };
}

function compactPlaceRange(segment: EffectiveTransitRouteSegment): string | undefined {
    const fromName = segment.fromName?.trim();
    const toName = segment.toName?.trim();
    if (fromName && toName && fromName !== toName) return `${fromName}→${toName}`;
    return fromName || toName || undefined;
}

function segmentLabel(segment: EffectiveTransitRouteSegment): string {
    const places = compactPlaceRange(segment);
    const direction = segment.directionName?.trim();

    if (segment.kind === "WALK") {
        return ["도보", places].filter(Boolean).join(" · ");
    }

    const mode = segment.kind === "BUS"
        ? "버스"
        : segment.kind === "SUBWAY"
            ? "지하철"
            : "이동";
    const line = segment.lineName?.trim() || mode;
    return [line, places, direction].filter(Boolean).join(" · ");
}

function itineraryLabel(route: EffectiveTransitRoute): string {
    const labels = (Array.isArray(route.segments) ? [...route.segments] : [])
        .sort((left, right) => left.sequence - right.sequence)
        .map(segmentLabel)
        .filter(Boolean);

    return labels.length > 0
        ? labels.join("  →  ")
        : "현재 확인된 대체 대중교통 경로로 안내해요.";
}

/** Builds text-only guidance so an alternative itinerary never impersonates saved map geometry. */
export function buildEffectiveTransitRoutePresentation(
    status: ScheduleDepartureStatus | null | undefined,
): EffectiveTransitRoutePresentation | undefined {
    if (!getFreshDepartureTiming(status) || status?.routeChanged !== true) return undefined;
    const route = status.effectiveTransitRoute;
    if (!route) return undefined;

    const departureAt = formatClock(route.departureAt, status.timeZone);
    const arrivalAt = formatClock(route.arrivalAt, status.timeZone);
    const totalMinutes = isPositiveMinute(route.totalMinutes)
        ? `${Math.ceil(route.totalMinutes)}분`
        : undefined;
    const clockRange = departureAt && arrivalAt
        ? `${departureAt} 출발 · ${arrivalAt} 도착`
        : departureAt
            ? `${departureAt} 출발`
            : arrivalAt
                ? `${arrivalAt} 도착`
                : undefined;

    return {
        summary: [clockRange, totalMinutes ? `총 ${totalMinutes}` : undefined]
            .filter(Boolean)
            .join(" · "),
        itinerary: itineraryLabel(route),
        waitMeta: isPositiveMinute(status.firstBoardingWaitMinutes)
            ? `첫 승차 대기 ${Math.ceil(status.firstBoardingWaitMinutes)}분 · 총시간에 포함`
            : undefined,
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

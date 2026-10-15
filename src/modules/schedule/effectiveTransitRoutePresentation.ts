import { transitModeLabel } from "../map/transitModes";
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
    preservingEarlierDeparture?: true;
};

export type EffectiveTransitRoutePresentation = {
    guidanceTitle: string;
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

function formatLocalClock(parsed: Date, includeSeconds: boolean): string {
    const hours = String(parsed.getHours()).padStart(2, "0");
    const minutes = String(parsed.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}${includeSeconds ? `:${String(parsed.getSeconds()).padStart(2, "0")}` : ""}`;
}

function formatClock(
    value: string | null | undefined,
    timeZone: string | null | undefined,
    includeSeconds = false,
): string | undefined {
    const parsed = parseDate(value);
    if (!parsed) return undefined;

    if (timeZone) {
        try {
            return new Intl.DateTimeFormat("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                ...(includeSeconds ? { second: "2-digit" as const } : {}),
                hour12: false,
                timeZone,
            }).format(parsed);
        } catch {
            // Older Hermes runtimes and invalid IANA zones fall back to device-local display.
        }
    }

    return formatLocalClock(parsed, includeSeconds);
}

/**
 * Only accepted provider snapshots may replace the schedule's saved ETA.
 * Stale/failure snapshots never become a fresh ETA. A separately marked,
 * earlier protected departure may still prevent falling back to a later saved plan.
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
    const protectedDeparture = !fresh && status?.stale && status.failureReason
        ? parseDate(status.recommendedDepartureAt) : undefined;
    // The backend validates schedule/route ownership and returns the protected job time.
    // A failure may keep an earlier departure, but can never delay the saved departure
    // or supply a new duration/arrival pair. Another participant's plan is handled above.
    const preserveEarlier = protectedDeparture && savedRecommendedDepartureAt &&
        Number.isFinite(savedRecommendedDepartureAt.getTime()) &&
        protectedDeparture < savedRecommendedDepartureAt;
    return {
        recommendedDepartureAt: fresh?.recommendedDepartureAt ??
            (preserveEarlier ? protectedDeparture : savedRecommendedDepartureAt),
        travelMinutes: fresh?.travelMinutes ?? (
            isPositiveMinute(savedTravelMinutes) ? savedTravelMinutes : undefined
        ),
        ...(preserveEarlier ? { preservingEarlierDeparture: true as const } : {}),
    };
}

function compactPlaceRange(segment: EffectiveTransitRouteSegment): string | undefined {
    const fromName = segment.fromName?.trim();
    const toName = segment.toName?.trim();
    if (fromName && toName && fromName !== toName) return `${fromName}→${toName}`;
    return fromName || toName || undefined;
}

/** Optional evidence is additive. Invalid/legacy metadata must not invent a precise clock. */
function rideTimingLabel(segment: EffectiveTransitRouteSegment, timeZone?: string | null): string | undefined {
    const timing = segment.rideTiming;
    const table = timing?.timetable;
    if (segment.kind !== "SUBWAY" || !timing || !table ||
        typeof table.provider !== "string" || !table.provider.trim() ||
        typeof table.trainNumber !== "string" || !table.trainNumber.trim() ||
        !["LOCAL", "EXPRESS"].includes(table.serviceClass) ||
        !["UP", "DOWN"].includes(table.directionCode) ||
        !table.fromStationCode || !table.toStationCode || table.fromStationCode === table.toStationCode ||
        !parseDate(table.fetchedAt)) return undefined;
    const boarding = parseDate(timing.predictedBoardingAt);
    const arrival = parseDate(timing.predictedArrivalAt);
    const scheduledBoarding = parseDate(table.boardingAt);
    const scheduledArrival = parseDate(table.arrivalAt);
    if (!boarding || !arrival || !scheduledBoarding || !scheduledArrival ||
        arrival <= boarding || scheduledArrival <= scheduledBoarding) return undefined;
    const shift = boarding.getTime() - scheduledBoarding.getTime();
    if (arrival.getTime() !== scheduledArrival.getTime() + shift ||
        (timing.basis === "TIMETABLE" ? shift !== 0
            : timing.basis !== "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE")) return undefined;
    const basis = timing.basis === "TIMETABLE" ? "시간표" : "첫 승차 실시간 반영";
    // This is a prediction based on a train timetable, not measured actual arrival.
    return `${table.trainNumber}열차 · ${basis} · ${formatClock(timing.predictedBoardingAt, timeZone, true)} 승차 → ${formatClock(timing.predictedArrivalAt, timeZone, true)} 하차 예측`;
}

function segmentLabel(segment: EffectiveTransitRouteSegment, showMinutes: boolean, timeZone?: string | null): string {
    const places = compactPlaceRange(segment);
    const direction = segment.directionName?.trim();

    const mode = transitModeLabel(segment.kind);
    const walkingLabel = segment.walkingScope === "ACCESS" ? "접근 도보"
        : segment.walkingScope === "TRANSFER" ? "환승 도보"
            : segment.walkingScope === "EGRESS" ? "도착 도보" : "도보";
    const line = segment.kind === "WALK" ? walkingLabel : segment.lineName?.trim() || mode;
    // These are provider-evaluated segments, not scaled portions of the saved plan.
    // Segment minutes are rounded up and already include their waiting time.
    const seconds = segment.durationSeconds;
    // Only trustworthy original WALK seconds override rounded display. They are already in total ETA.
    const hasWalkingSeconds = segment.kind === "WALK" && typeof seconds === "number" &&
        Number.isSafeInteger(seconds) && seconds >= 0 && Math.ceil(seconds / 60) === segment.durationMinutes;
    const walkingDuration = hasWalkingSeconds
        ? [seconds >= 60 ? `${Math.floor(seconds / 60)}분` : undefined,
            seconds % 60 !== 0 || seconds === 0 ? `${seconds % 60}초` : undefined].filter(Boolean).join(" ")
        : undefined;
    const duration = showMinutes && walkingDuration ? `약 ${walkingDuration}`
        : showMinutes && isPositiveMinute(segment.durationMinutes)
        ? `약 ${Math.ceil(segment.durationMinutes)}분` : undefined;
    const meters = segment.walkingGeometry?.distanceMeters;
    // Provider's leg distance is explanatory only; never derive travel seconds/platform coverage from it.
    const walkingDistance = segment.kind === "WALK" && typeof meters === "number" &&
        Number.isSafeInteger(meters) && meters >= 0 ? `${meters}m` : undefined;
    return [line, places, direction, duration, walkingDistance, rideTimingLabel(segment, timeZone)].filter(Boolean).join(" · ");
}

function itineraryLabel(route: EffectiveTransitRoute, showMinutes: boolean, timeZone?: string | null): string {
    const labels = (Array.isArray(route.segments) ? [...route.segments] : [])
        .sort((left, right) => left.sequence - right.sequence)
        .map(segment => segmentLabel(segment, showMinutes, timeZone))
        .filter(Boolean);

    return labels.length > 0
        ? labels.join("  →  ")
        : "현재 확인된 대체 대중교통 경로로 안내해요.";
}

/** 완전한 미래 시간표만 별도 안내한다. 정상 ETA/알람 시각 계산에는 사용하지 않는다. */
export function buildFutureTimetablePredictionPresentation(
    status: ScheduleDepartureStatus | null | undefined,
): EffectiveTransitRoutePresentation | undefined {
    const route = status?.futureTimetablePrediction;
    if (!status || !route || status.stale !== true || status.source !== "TIMETABLE_PROVIDER" ||
        !status.failureReason?.startsWith("TRANSIT_TRAIN_NOT_YET_OBSERVED:") ||
        !parseDate(route.departureAt) || !parseDate(route.arrivalAt) ||
        parseDate(route.arrivalAt)! <= parseDate(route.departureAt)! ||
        !isPositiveMinute(route.totalMinutes) || !Array.isArray(route.segments) || !route.segments.length) return undefined;
    const rides = route.segments.filter(segment => segment.kind !== "WALK");
    if (!rides.length || !rides.every(segment => segment.rideTiming?.basis === "TIMETABLE" &&
        rideTimingLabel(segment, status.timeZone))) return undefined;
    return {
        guidanceTitle: "미래 시간표 예측 · 실시간 미확인",
        summary: `${formatClock(route.departureAt, status.timeZone)} 출발 예측 · ${formatClock(route.arrivalAt, status.timeZone)} 도착 예측 · 총 ${Math.ceil(route.totalMinutes)}분`,
        itinerary: itineraryLabel(route, true, status.timeZone),
        waitMeta: "선택 열차는 아직 실시간 목록에서 확인되지 않았어요. 출발 알람은 기존 안전 시각을 유지해요",
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

/** Fresh timing applies to unchanged routes too; neither timing case replaces saved geometry. */
export function buildEffectiveTransitRoutePresentation(
    status: ScheduleDepartureStatus | null | undefined,
): EffectiveTransitRoutePresentation | undefined {
    if (!getFreshDepartureTiming(status) || !status ||
        (status.routeChanged !== true && status.routeChanged !== false)) return undefined;
    const route = status.effectiveTransitRoute;
    if (!route) return undefined;
    const routeDeparture = parseDate(route.departureAt);
    const routeArrival = parseDate(route.arrivalAt);
    // An inconsistent/incomplete journey must not be blended with fresh headline timing.
    if (!routeDeparture || !routeArrival || routeArrival <= routeDeparture ||
        !isPositiveMinute(route.totalMinutes) || Math.ceil(route.totalMinutes) !== Math.ceil(status.travelMinutes!) ||
        !Array.isArray(route.segments) || route.segments.length === 0) return undefined;
    const sameRoute = status.routeChanged === false;

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
        guidanceTitle: sameRoute ? "현재 보정 여정" : "실시간 추천 경로",
        summary: [clockRange, totalMinutes ? `총 ${totalMinutes}` : undefined]
            .filter(Boolean)
            .join(" · "),
        itinerary: itineraryLabel(route, sameRoute, status.timeZone),
        waitMeta: [
            isPositiveMinute(status.firstBoardingWaitMinutes)
                ? `첫 승차 대기 ${Math.ceil(status.firstBoardingWaitMinutes)}분 · 총시간에 포함` : undefined,
            sameRoute ? "구간은 대기 포함·분 단위 올림값이에요. 도보는 원본 초가 있으면 초 단위로 표시해요" : undefined,
            // EGRESS is a journey position, not proof of an exit/platform boundary.
            // Explain the existing total; never add walking again or infer coverage from coordinates.
            route.segments.some(segment => segment.kind === "WALK" &&
                segment.walkingScope === "EGRESS" && isPositiveMinute(segment.durationMinutes))
                ? "도착 도보는 총시간에 포함돼요. 역 내부 이동 포함 범위는 확인되지 않았어요" : undefined,
        ].filter(Boolean).join(" · ") || undefined,
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

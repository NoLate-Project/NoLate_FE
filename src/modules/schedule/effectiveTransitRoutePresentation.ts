import { transitModeLabel } from "../map/transitModes";
import { formatRouteDurationSeconds } from "./routeInfo";
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
    compactSummary?: string;
    waitMeta?: string;
    mapNote: string;
};

const MAP_SAVED_ROUTE_NOTE = "지도에는 저장한 경로가 표시돼요";

/** 출발 뒤의 계획 여정은 실제 탑승 확인이 아니며 출발 알람의 정상 ETA와 섞지 않는다. */
export function buildPlannedJourneyArrivalPresentation(
    status: ScheduleDepartureStatus | null | undefined,
    nowMs: number,
): EffectiveTransitRoutePresentation | undefined {
    const prediction = status?.plannedJourneyArrivalPrediction;
    if (!status || !prediction || !Number.isFinite(nowMs) ||
        !/^[0-9a-f]{64}$/.test(prediction.routeIdentity)) return undefined;
    const arrival = parseDate(prediction.predictedArrivalAt);
    const presented = parseDate(prediction.presentedAt);
    const maxDisplayAgeMs = prediction.basis === "MATCHED_TRAIN_REALTIME" ? 120_000 : 300_000;
    if (!arrival || !presented || arrival.getTime() <= nowMs ||
        presented.getTime() > nowMs + 5_000 || nowMs - presented.getTime() > maxDisplayAgeMs) return undefined;
    const arrivalClock = formatClock(prediction.predictedArrivalAt, status.timeZone);
    if (!arrivalClock) return undefined;
    const observed = prediction.basis === "MATCHED_TRAIN_REALTIME";
    return {
        guidanceTitle: "계획 경로 기준 · 잠정 도착",
        summary: `${arrivalClock} 도착 예상`,
        compactSummary: `${arrivalClock} 도착 예상 · 탑승 미확인`,
        itinerary: observed
            ? "같은 환승 열차의 신선한 관측을 반영했어요. 다른 구간은 계획 시각이에요"
            : "마지막으로 확인된 경로의 계획 도착시각이에요. 새 차량 관측은 없어요",
        waitMeta: "실제 탑승·환승 여부는 확인하지 못했어요. 출발 알림 시각은 바뀌지 않아요",
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

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
    const protectedDeparture = !fresh && status?.stale &&
        (status.failureReason || status.originReplanDiagnostic)
        ? parseDate(status.recommendedDepartureAt) : undefined;
    // The provisional arrival refers to the already accepted plan and its original departure.
    const inProgressDeparture = status?.originReplanDiagnostic && status.plannedJourneyArrivalPrediction
        ? protectedDeparture : undefined;
    const savedDeparture = (status?.stale ? parseDate(status.savedRouteEstimatedDepartureAt) : undefined)
        ?? savedRecommendedDepartureAt;
    // The backend validates schedule/route ownership and returns the protected job time.
    // A failure may keep an earlier departure, but can never delay the saved departure
    // or supply a new duration/arrival pair. Another participant's plan is handled above.
    const preserveEarlier = protectedDeparture && savedDeparture &&
        Number.isFinite(savedDeparture.getTime()) && protectedDeparture < savedDeparture;
    return {
        recommendedDepartureAt: fresh?.recommendedDepartureAt ?? inProgressDeparture ??
            (preserveEarlier ? protectedDeparture : savedDeparture),
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

export function isBoardingStationArrivalPrediction(timing: NonNullable<EffectiveTransitRouteSegment["rideTiming"]>): boolean {
    return timing.basis === "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE" ||
        timing.basis === "FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING" ||
        timing.basis === "FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME" ||
        timing.basis === "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE";
}

/** Optional evidence is additive. Invalid/legacy metadata must not invent a precise clock. */
function rideTimingLabel(segment: EffectiveTransitRouteSegment, timeZone?: string | null): string | undefined {
    const bus = segment.busRidePrediction;
    if (segment.kind === "BUS" && bus) {
        const boarding = parseDate(bus.boardingAt);
        const alighting = parseDate(bus.alightingAt);
        const updated = parseDate(bus.sourceUpdatedAt);
        if (boarding && alighting && updated && updated <= boarding && boarding < alighting) {
            return `${formatClock(bus.boardingAt, timeZone, true)} 승차 → ${formatClock(bus.alightingAt, timeZone, true)} 하차 예측`;
        }
    }
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
    const adjustedAtBoarding = isBoardingStationArrivalPrediction(timing);
    const scheduledOriginArrival = adjustedAtBoarding && table.boardingStationArrivalAt != null
        ? parseDate(table.boardingStationArrivalAt)
        : scheduledBoarding;
    if (!scheduledOriginArrival || scheduledOriginArrival > scheduledBoarding) return undefined;
    const shift = boarding.getTime() - scheduledOriginArrival.getTime();
    const firstRideBothObserved = timing.basis === "FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME";
    const firstAlightingFromTimetable = timing.basis === "FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING";
    const alightingObserved = timing.basis === "TRANSFER_ALIGHTING_REALTIME" || firstRideBothObserved;
    const transferObserved = alightingObserved ||
        timing.basis === "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE";
    if (transferObserved && !parseDate(timing.observationSourceUpdatedAt)) return undefined;
    if (firstAlightingFromTimetable
        ? shift >= 0 || arrival.getTime() !== scheduledArrival.getTime()
        : alightingObserved
        ? !firstRideBothObserved && shift !== 0
        : arrival.getTime() !== scheduledArrival.getTime() + shift ||
            (timing.basis === "TIMETABLE" ? shift !== 0
                : timing.basis !== "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE" &&
                    timing.basis !== "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE")) return undefined;
    const basis = timing.basis === "TIMETABLE" ? "시간표"
        : timing.basis === "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE" ? "첫 승차 실시간 반영"
            : firstAlightingFromTimetable ? "승차역 실시간 · 하차역 시간표"
            : firstRideBothObserved ? "승하차역 실시간 예측"
            : alightingObserved ? "하차역 실시간 예측" : "환승역 실시간 반영";
    // The timetable fallback used to compute the shift does not change what the live feed observed.
    const boardingLabel = adjustedAtBoarding ? "승차역 열차 도착 예측" : "승차";
    return `${table.trainNumber}열차 · ${basis} · ${formatClock(timing.predictedBoardingAt, timeZone, true)} ${boardingLabel} → ${formatClock(timing.predictedArrivalAt, timeZone, true)} 하차 예측`;
}

function verifiedTransferWaitSeconds(segment: EffectiveTransitRouteSegment, previousRideArrivalAt?: string): number | undefined {
    const transfer = segment.transferTiming;
    if (!transfer || segment.kind !== "SUBWAY" || !segment.rideTiming ||
        !Number.isSafeInteger(transfer.walkingSeconds) || transfer.walkingSeconds < 0 ||
        !Number.isSafeInteger(transfer.requiredMarginSeconds) || transfer.requiredMarginSeconds < 0) return undefined;
    const previous = parseDate(transfer.previousArrivalAt)?.getTime();
    const ready = parseDate(transfer.physicalReadyAt)?.getTime();
    const boarding = parseDate(transfer.boardingAt)?.getTime();
    if (previous === undefined || previous !== parseDate(previousRideArrivalAt)?.getTime() ||
        ready === undefined || boarding === undefined ||
        ready !== previous + transfer.walkingSeconds * 1000 ||
        boarding !== parseDate(segment.rideTiming.predictedBoardingAt)?.getTime()) return undefined;
    const seconds = (boarding - ready) / 1000;
    if (!Number.isSafeInteger(seconds) || seconds < transfer.requiredMarginSeconds ||
        seconds - transfer.requiredMarginSeconds !== transfer.remainingSlackSeconds) return undefined;
    return seconds;
}

function segmentLabel(segment: EffectiveTransitRouteSegment, showMinutes: boolean,
                      timeZone?: string | null, previousRideArrivalAt?: string): string {
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
    const walkingDuration = hasWalkingSeconds ? formatRouteDurationSeconds(seconds) : undefined;
    const ride = rideTimingLabel(segment, timeZone);
    const transferWait = ride ? verifiedTransferWaitSeconds(segment, previousRideArrivalAt) : undefined;
    const duration = showMinutes && walkingDuration ? `약 ${walkingDuration}`
        : showMinutes && transferWait === undefined && isPositiveMinute(segment.durationMinutes)
        ? `약 ${Math.ceil(segment.durationMinutes)}분` : undefined;
    const transferWaitLabel = transferWait !== undefined && transferWait > 0
        ? `환승 대기 약 ${formatRouteDurationSeconds(transferWait)}` : undefined;
    const meters = segment.walkingGeometry?.distanceMeters;
    // Provider's leg distance is explanatory only; never derive travel seconds/platform coverage from it.
    const walkingDistance = segment.kind === "WALK" && typeof meters === "number" &&
        Number.isSafeInteger(meters) && meters >= 0 ? `${meters}m` : undefined;
    return [line, places, direction, duration, walkingDistance, transferWaitLabel, ride].filter(Boolean).join(" · ");
}

function itineraryLabel(route: EffectiveTransitRoute, showMinutes: boolean, timeZone?: string | null): string {
    let previousRideArrivalAt: string | undefined;
    const labels = (Array.isArray(route.segments) ? [...route.segments] : [])
        .sort((left, right) => left.sequence - right.sequence)
        .map(segment => {
            const label = segmentLabel(segment, showMinutes, timeZone, previousRideArrivalAt);
            if (segment.kind !== "WALK") previousRideArrivalAt = segment.rideTiming?.predictedArrivalAt;
            return label;
        })
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
    const staleObservation = status?.failureReason?.startsWith("TRANSIT_ARRIVAL_SOURCE_STALE:") === true;
    const unobservedTrain = status?.failureReason?.startsWith("TRANSIT_TRAIN_NOT_YET_OBSERVED:") === true;
    if (!status || !route || status.stale !== true || status.source !== "TIMETABLE_PROVIDER" ||
        (!staleObservation && !unobservedTrain) ||
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
        waitMeta: (staleObservation ? "실시간 도착정보가 오래되어 시간표를 보여드려요." :
            "선택 열차는 아직 실시간 목록에서 확인되지 않았어요.") + " 출발 알람은 기존 안전 시각을 유지해요",
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

/** Fresh timing applies to unchanged routes too; neither timing case replaces saved geometry. */
export function buildEffectiveTransitRoutePresentation(
    status: ScheduleDepartureStatus | null | undefined,
): EffectiveTransitRoutePresentation | undefined {
    const freshTiming = getFreshDepartureTiming(status);
    if (!freshTiming || !status ||
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
    // The Worker can preserve an earlier alert while the ETA uses a later route start.
    const hasEarlierAlarm = freshTiming.recommendedDepartureAt < routeDeparture;
    const departureLabel = hasEarlierAlarm ? "경로 출발" : "출발";
    const clockRange = departureAt && arrivalAt
        ? `${departureAt} ${departureLabel} · ${arrivalAt} 도착`
        : departureAt
            ? `${departureAt} ${departureLabel}`
            : arrivalAt
                ? `${arrivalAt} 도착`
                : undefined;

    return {
        guidanceTitle: sameRoute ? "현재 보정 여정" : "실시간 추천 경로",
        summary: [clockRange, totalMinutes ? `총 ${totalMinutes}` : undefined]
            .filter(Boolean)
            .join(" · "),
        ...(hasEarlierAlarm && arrivalAt ? { compactSummary: `${arrivalAt} 도착 예상` } : {}),
        itinerary: itineraryLabel(route, sameRoute, status.timeZone),
        waitMeta: [
            isPositiveMinute(status.firstBoardingWaitMinutes)
                ? `첫 승차 대기 ${Math.ceil(status.firstBoardingWaitMinutes)}분 · 총시간에 포함` : undefined,
            sameRoute ? "분으로 표시한 열차 구간 소요는 대기 포함·분 단위 올림값이에요. 도보는 원본 초가 있으면 초 단위로 표시해요" : undefined,
            // EGRESS is a journey position, not proof of an exit/platform boundary.
            // Explain the existing total; never add walking again or infer coverage from coordinates.
            route.segments.some(segment => segment.kind === "WALK" &&
                segment.walkingScope === "EGRESS" && isPositiveMinute(segment.durationMinutes))
                ? "도착 도보는 총시간에 포함돼요. 역 내부 이동 포함 범위는 확인되지 않았어요" : undefined,
        ].filter(Boolean).join(" · ") || undefined,
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

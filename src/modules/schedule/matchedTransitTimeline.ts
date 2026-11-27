import type { ScheduleDepartureStatus } from "../../api/schedule";
import { firstTransitBoardingInterval, getDisplayedFutureTimetableRoute, getFreshDepartureTiming, getDisplayedPlannedTransitRoute, isBoardingStationArrivalPrediction, hasReportedBoardingEvidence, isPendingTransitTransfer, selectedSubwayTrainNumber, transitTransferWaitSeconds } from "./effectiveTransitRoutePresentation";
import { normalizeStopName, rideMovementDurationLabel, type RouteInfo, type RouteStep } from "./routeInfo";

function sameStop(a?: string | null, b?: string | null) {
    const key = (name?: string | null) => normalizeStopName(name ?? undefined)?.replace(/역$/u, "").trim();
    return Boolean(key(a) && key(a) === key(b));
}

function sameLine(a?: string | null, b?: string | null) {
    const key = (name?: string | null) => name?.trim().replace(/^수도권\s*/u, "").replace(/\s+/gu, "");
    return Boolean(key(a) && key(a) === key(b));
}

function savedAlightingName(step: RouteStep, provider?: RouteInfo["provider"]): string | undefined {
    // Older ODsay payloads persisted the ride endpoint as endName.
    const legacyEndName = provider === "odsay" && "endName" in step && typeof step.endName === "string"
        ? step.endName.trim() || undefined
        : undefined;
    return step.alightingName ?? legacyEndName ?? step.passStops?.at(-1)?.name;
}

/** Align the saved map's clock rail only when the API supplies a complete, ordered match.
 * An alternative route, incomplete clocks or an expired observation must never borrow saved geometry.
 */
export function applyMatchedTransitTimeline(info: RouteInfo | undefined, status?: ScheduleDepartureStatus | null,
                                            nowMs = Date.now()): RouteInfo | undefined {
    if (!info || info.intercityJourney || !status) return info;
    const pendingTransfer = isPendingTransitTransfer(status);
    // Keep the route geometry and stops visible, without inferring bus/destination clocks from saved minutes.
    const fallback = pendingTransfer ? {
        ...info, matchedTimeline: true as const, matchedTimelineBasis: "PENDING_TRANSFER" as const,
        departureTime: status.recommendedDepartureAt ?? "", arrivalTime: "", totalDurationSeconds: undefined,
        steps: info.steps.map(step => ({ ...step, matchedTimeline: undefined, scheduledRide: undefined,
            durationMinutes: undefined, durationSeconds: undefined, waitingMinutes: undefined, description: undefined })),
    } : info;
    const planned = getDisplayedPlannedTransitRoute(status, nowMs);
    const fresh = status.routeChanged === false && getFreshDepartureTiming(status)
        ? status.effectiveTransitRoute : undefined;
    const future = status.futureTimetableRouteProvenance === "SELECTED_ROUTE_PRESERVED"
        ? getDisplayedFutureTimetableRoute(status, nowMs) : undefined;
    const route = pendingTransfer ? status.pendingTransferRailPlan : planned ?? fresh ?? future;
    const basis = pendingTransfer ? "PENDING_TRANSFER" : planned ? "PLANNED" : !fresh && future ? "TIMETABLE" : undefined;
    if (!route || !Array.isArray(route.segments) || (basis && info.provider !== route.provider)) return fallback;
    const movements = info.steps.filter(step => step.type !== "ORIGIN" && step.type !== "DESTINATION");
    const segments = [...route.segments].sort((a, b) => a.sequence - b.sequence);
    const start = Date.parse(route.departureAt);
    const end = Date.parse(route.arrivalAt);
    if (pendingTransfer && (route.provider !== "odsay" || !/^[0-9a-f]{64}$/.test(route.identity) || start > nowMs + 5_000 ||
        status.predictedArrivalAt != null || status.plannedJourneyArrivalPrediction != null || movements[segments.length]?.type !== "BUS" ||
        movements.slice(segments.length + 1).some(step => step.type !== "WALK") || segments.at(-1)?.walkingScope !== "TRANSFER" ||
        segments.some(segment => segment.kind !== "WALK" && (segment.kind !== "SUBWAY" ||
            !["TIMETABLE", "PLANNED_RIDE_BASELINE"].includes(segment.rideTiming?.basis ?? "") ||
            segment.rideTiming?.observationSourceUpdatedAt != null || segment.rideTiming?.boardingObservationSourceUpdatedAt != null)))) return fallback;
    const timedMovements = pendingTransfer ? movements.slice(0, segments.length) : movements;
    if (!timedMovements.length || segments.length !== timedMovements.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
        (basis === "TIMETABLE" && Math.ceil((end - start) / 60_000) !== route.totalMinutes) ||
        (!basis && (end !== Date.parse(status.predictedArrivalAt ?? "") || route.totalMinutes !== status.travelMinutes)) ||
        !segments.some(segment => segment.kind === "SUBWAY" || segment.kind === "BUS" && segment.busRidePrediction)) return fallback;

    const times = new Map<string, NonNullable<RouteStep["matchedTimeline"]>>();
    const firstInterval = firstTransitBoardingInterval(route);
    let cursor = start;
    for (const [index, step] of timedMovements.entries()) {
        const segment = segments[index];
        if (segment.sequence !== index || times.has(step.id) || segment.kind !== step.type) return fallback;
        let from = cursor;
        const transferWaitSeconds = transitTransferWaitSeconds(segments, index);
        let startsWithStationArrivalPrediction = false;
        let startsWithReportedStationArrival = false;
        let endsWithReportedStationArrival = false;
        if (segment.kind === "WALK") {
            const seconds = segment.walkingTiming?.movementSeconds ?? segment.durationSeconds ?? segment.durationMinutes * 60;
            if (!Number.isSafeInteger(seconds) || seconds < 0) return fallback;
            cursor += seconds * 1000;
        } else if (segment.kind === "BUS") {
            const bus = segment.busRidePrediction;
            if (!bus || !sameLine(segment.lineName, step.lineName) || !sameStop(step.title, segment.fromName) ||
                !sameStop(savedAlightingName(step, info.provider), segment.toName)) return fallback;
            from = Date.parse(bus.boardingAt);
            const alight = Date.parse(bus.alightingAt);
            if (!Number.isFinite(from) || !Number.isFinite(alight) || from < cursor || alight <= from) return fallback;
            if (bus.reportedAlightingAt != null) {
                if (bus.alightingObservationSourceUpdatedAt != null ||
                    Date.parse(bus.reportedAlightingAt) !== alight || alight > nowMs) return fallback;
                endsWithReportedStationArrival = true;
            }
            startsWithStationArrivalPrediction = !endsWithReportedStationArrival && bus.alightingObservationSourceUpdatedAt == null;
            cursor = alight;
        } else {
            const timing = segment.rideTiming;
            const lastStop = savedAlightingName(step, info.provider);
            if (!timing || segment.kind !== "SUBWAY" || !sameLine(segment.lineName, step.lineName) ||
                !sameStop(step.title, segment.fromName) || !sameStop(lastStop, segment.toName) ||
                (step.directionCode && step.directionCode !== timing.timetable.directionCode) ||
                !selectedSubwayTrainNumber(segment)) return fallback;
            from = Date.parse(timing.predictedBoardingAt);
            startsWithReportedStationArrival = hasReportedBoardingEvidence(segment);
            startsWithStationArrivalPrediction = !startsWithReportedStationArrival && isBoardingStationArrivalPrediction(timing);
            const alight = Date.parse(timing.predictedArrivalAt);
            if (!Number.isFinite(from) || !Number.isFinite(alight) || from < cursor || alight <= from) return fallback;
            if (timing.reportedAlightingAt != null) {
                if (timing.basis !== "PLANNED_RIDE_BASELINE" || timing.observationSourceUpdatedAt != null ||
                    Date.parse(timing.reportedAlightingAt) !== alight || alight > nowMs) return fallback;
                endsWithReportedStationArrival = true;
            }
            cursor = alight;
        }
        if (cursor > end) return fallback;
        times.set(step.id, {
            startAt: new Date(from).toISOString(), endAt: new Date(cursor).toISOString(),
            movementSeconds: (cursor - from) / 1000,
            ...(firstInterval?.sequence === index && firstInterval.seconds > 0
                ? { firstBoardingIntervalSeconds: firstInterval.seconds } : {}),
            ...(transferWaitSeconds !== undefined && transferWaitSeconds > 0 ? { transferWaitSeconds } : {}),
            ...(startsWithStationArrivalPrediction ? { startsWithStationArrivalPrediction: true } : {}),
            ...(startsWithReportedStationArrival ? { startsWithReportedStationArrival: true } : {}),
            ...(endsWithReportedStationArrival ? { endsWithReportedStationArrival: true } : {}),
            ...(basis ? { provisionalPlan: true } : {}),
        });
    }
    if (cursor !== end) return fallback;

    return {
        ...fallback, departureTime: route.departureAt,
        ...(!pendingTransfer ? { arrivalTime: route.arrivalAt, totalDurationMinutes: route.totalMinutes,
            totalDurationSeconds: (end - start) / 1000 } : {}),
        steps: fallback.steps.map(step => {
            const matchedTimeline = times.get(step.id);
            if (!matchedTimeline) return step;
            const durationMinutes = Math.ceil(matchedTimeline.movementSeconds / 60);
            const alightingName = step.type === "SUBWAY" ? savedAlightingName(step, info.provider) : step.alightingName;
            // Old leg descriptions can contain the saved duration (e.g. 48분).
            // The corrected rail must not carry that number beside its new clocks.
            const description = step.type === "WALK" ? undefined
                : [alightingName && `${alightingName}까지`,
                    step.stationCount && `${step.stationCount}정거장`, rideMovementDurationLabel(durationMinutes, matchedTimeline.movementSeconds)].filter(Boolean).join(" · ");
            return { ...step, alightingName, matchedTimeline, durationMinutes, durationSeconds: matchedTimeline.movementSeconds, description };
        }),
        matchedTimeline: true,
        ...(basis ? { matchedTimelineBasis: basis } : {}),
    };
}

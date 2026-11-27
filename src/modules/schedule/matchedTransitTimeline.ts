import type { ScheduleDepartureStatus } from "../../api/schedule";
import { firstTransitBoardingInterval, getDisplayedFutureTimetableRoute, getFreshDepartureTiming, getDisplayedPlannedTransitRoute, isBoardingStationArrivalPrediction, hasReportedBoardingEvidence, selectedSubwayTrainNumber, transitTransferWaitSeconds } from "./effectiveTransitRoutePresentation";
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
    const planned = getDisplayedPlannedTransitRoute(status, nowMs);
    if (!info || info.intercityJourney || !status) return info;
    const fresh = status.routeChanged === false && getFreshDepartureTiming(status)
        ? status.effectiveTransitRoute : undefined;
    const future = status.futureTimetableRouteProvenance === "SELECTED_ROUTE_PRESERVED"
        ? getDisplayedFutureTimetableRoute(status, nowMs) : undefined;
    const route = planned ?? fresh ?? future;
    const basis = planned ? "PLANNED" : !fresh && future ? "TIMETABLE" : undefined;
    if (!route || !Array.isArray(route.segments) || (basis && info.provider !== route.provider)) return info;
    const movements = info.steps.filter(step => step.type !== "ORIGIN" && step.type !== "DESTINATION");
    const segments = [...route.segments].sort((a, b) => a.sequence - b.sequence);
    const start = Date.parse(route.departureAt);
    const end = Date.parse(route.arrivalAt);
    if (!movements.length || segments.length !== movements.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
        (basis === "TIMETABLE" && Math.ceil((end - start) / 60_000) !== route.totalMinutes) ||
        (!basis && (end !== Date.parse(status.predictedArrivalAt ?? "") || route.totalMinutes !== status.travelMinutes)) ||
        !segments.some(segment => segment.kind === "SUBWAY" || segment.kind === "BUS" && segment.busRidePrediction)) return info;

    const times = new Map<string, NonNullable<RouteStep["matchedTimeline"]>>();
    const firstInterval = firstTransitBoardingInterval(route);
    let cursor = start;
    for (const [index, step] of movements.entries()) {
        const segment = segments[index];
        if (segment.sequence !== index || times.has(step.id) || segment.kind !== step.type) return info;
        let from = cursor;
        const transferWaitSeconds = transitTransferWaitSeconds(segments, index);
        let startsWithStationArrivalPrediction = false;
        let startsWithReportedStationArrival = false;
        if (segment.kind === "WALK") {
            const seconds = segment.walkingTiming?.movementSeconds ?? segment.durationSeconds ?? segment.durationMinutes * 60;
            if (!Number.isSafeInteger(seconds) || seconds < 0) return info;
            cursor += seconds * 1000;
        } else if (segment.kind === "BUS") {
            const bus = segment.busRidePrediction;
            if (!bus || !sameLine(segment.lineName, step.lineName) || !sameStop(step.title, segment.fromName) ||
                !sameStop(savedAlightingName(step, info.provider), segment.toName)) return info;
            from = Date.parse(bus.boardingAt);
            const alight = Date.parse(bus.alightingAt);
            if (!Number.isFinite(from) || !Number.isFinite(alight) || from < cursor || alight <= from) return info;
            cursor = alight;
        } else {
            const timing = segment.rideTiming;
            const lastStop = savedAlightingName(step, info.provider);
            if (!timing || segment.kind !== "SUBWAY" || !sameLine(segment.lineName, step.lineName) ||
                !sameStop(step.title, segment.fromName) || !sameStop(lastStop, segment.toName) ||
                (step.directionCode && step.directionCode !== timing.timetable.directionCode) ||
                !selectedSubwayTrainNumber(segment)) return info;
            from = Date.parse(timing.predictedBoardingAt);
            startsWithReportedStationArrival = hasReportedBoardingEvidence(segment);
            startsWithStationArrivalPrediction = !startsWithReportedStationArrival && isBoardingStationArrivalPrediction(timing);
            const alight = Date.parse(timing.predictedArrivalAt);
            if (!Number.isFinite(from) || !Number.isFinite(alight) || from < cursor || alight <= from) return info;
            cursor = alight;
        }
        if (cursor > end) return info;
        times.set(step.id, {
            startAt: new Date(from).toISOString(), endAt: new Date(cursor).toISOString(),
            movementSeconds: (cursor - from) / 1000,
            ...(firstInterval?.sequence === index && firstInterval.seconds > 0
                ? { firstBoardingIntervalSeconds: firstInterval.seconds } : {}),
            ...(transferWaitSeconds !== undefined && transferWaitSeconds > 0 ? { transferWaitSeconds } : {}),
            ...(startsWithStationArrivalPrediction ? { startsWithStationArrivalPrediction: true } : {}),
            ...(startsWithReportedStationArrival ? { startsWithReportedStationArrival: true } : {}),
            ...(basis ? { provisionalPlan: true } : {}),
        });
    }
    if (cursor !== end) return info;

    return {
        ...info, departureTime: route.departureAt, arrivalTime: route.arrivalAt,
        totalDurationMinutes: route.totalMinutes, totalDurationSeconds: (end - start) / 1000,
        steps: info.steps.map(step => {
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

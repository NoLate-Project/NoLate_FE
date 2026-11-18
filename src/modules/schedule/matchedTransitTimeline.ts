import type { ScheduleDepartureStatus } from "../../api/schedule";
import { getFreshDepartureTiming, isBoardingStationArrivalPrediction } from "./effectiveTransitRoutePresentation";
import { normalizeStopName, type RouteInfo, type RouteStep } from "./routeInfo";

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
export function applyMatchedTransitTimeline(info: RouteInfo | undefined, status?: ScheduleDepartureStatus | null): RouteInfo | undefined {
    const route = status?.effectiveTransitRoute;
    if (!info || info.intercityJourney || !status || !route || status.routeChanged !== false ||
        !Array.isArray(route.segments) || !getFreshDepartureTiming(status)) return info;
    const movements = info.steps.filter(step => step.type !== "ORIGIN" && step.type !== "DESTINATION");
    const segments = [...route.segments].sort((a, b) => a.sequence - b.sequence);
    const start = Date.parse(route.departureAt);
    const end = Date.parse(route.arrivalAt);
    if (!movements.length || segments.length !== movements.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
        end !== Date.parse(status.predictedArrivalAt ?? "") || route.totalMinutes !== status.travelMinutes ||
        !segments.some(segment => segment.kind === "SUBWAY")) return info;

    const times = new Map<string, NonNullable<RouteStep["matchedTimeline"]>>();
    let cursor = start;
    let previousRideSeen = false;
    for (const [index, step] of movements.entries()) {
        const segment = segments[index];
        if (segment.sequence !== index || times.has(step.id) || segment.kind !== step.type) return info;
        let from = cursor;
        let transferWaitSeconds: number | undefined;
        let startsWithStationArrivalPrediction = false;
        if (segment.kind === "WALK") {
            const seconds = segment.walkingTiming?.movementSeconds ?? segment.durationSeconds ?? segment.durationMinutes * 60;
            if (!Number.isSafeInteger(seconds) || seconds < 0) return info;
            cursor += seconds * 1000;
        } else {
            const timing = segment.rideTiming;
            const lastStop = savedAlightingName(step, info.provider);
            if (!timing || segment.kind !== "SUBWAY" || !sameLine(segment.lineName, step.lineName) ||
                !sameStop(step.title, segment.fromName) || !sameStop(lastStop, segment.toName) ||
                (step.directionCode && step.directionCode !== timing.timetable.directionCode) ||
                !timing.timetable.trainNumber?.trim()) return info;
            from = Date.parse(timing.predictedBoardingAt);
            startsWithStationArrivalPrediction = isBoardingStationArrivalPrediction(timing);
            const alight = Date.parse(timing.predictedArrivalAt);
            if (!Number.isFinite(from) || !Number.isFinite(alight) || from < cursor || alight <= from) return info;
            // The cursor has already advanced through every transfer walk.
            if (previousRideSeen && from > cursor) transferWaitSeconds = (from - cursor) / 1000;
            previousRideSeen = true;
            cursor = alight;
        }
        if (cursor > end) return info;
        times.set(step.id, {
            startAt: new Date(from).toISOString(), endAt: new Date(cursor).toISOString(),
            movementSeconds: (cursor - from) / 1000,
            ...(transferWaitSeconds === undefined ? {} : { transferWaitSeconds }),
            ...(startsWithStationArrivalPrediction ? { startsWithStationArrivalPrediction: true } : {}),
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
                    step.stationCount && `${step.stationCount}정거장`, `${durationMinutes}분`].filter(Boolean).join(" · ");
            return { ...step, alightingName, matchedTimeline, durationMinutes, durationSeconds: matchedTimeline.movementSeconds, description };
        }),
        matchedTimeline: true,
    };
}

import { applyOdsayBusPreview, applyOdsayEntranceEstimate, buildOdsayBusPreviewInput, buildOdsayTimetablePreviewInput,
    getOdsayBusPreview, getOdsayTimetablePreview } from "../../api/transitTimetablePreview";
import type { RouteAlternativeOption } from "../map/tmapApiCore";
import { buildRouteInfoFromAlternative } from "./routeInfo";
import { reconcileScheduleRouteTiming, resolveSelectedRouteTiming } from "./scheduleRouteTiming";
import type { Place } from "./types";

type TimingInput = Parameters<typeof reconcileScheduleRouteTiming>[0] & {
    origin?: Place;
    destination?: Place;
};

/** Recheck the chosen topology for a changed appointment before saving its departure alarm. */
export async function refreshOdsayScheduleTiming(input: TimingInput) {
    const estimate = reconcileScheduleRouteTiming(input);
    const fallback = { ...estimate, travelMinutes: estimate.route ? estimate.travelMinutes ?? input.travelMinutes : input.route ? undefined : input.travelMinutes };
    if (estimate.route === input.route || !estimate.route || typeof estimate.route !== "object") return fallback;

    const candidate = estimate.route as RouteAlternativeOption;
    if (candidate.provider !== "odsay" || candidate.mode !== "TRANSIT" || !Array.isArray(candidate.transitLegs)) return fallback;

    try {
        const targetArrivalAt = new Date(input.nextArrivalAt).toISOString();
        const busRequest = buildOdsayBusPreviewInput(candidate, { targetArrivalAt }, input.origin, input.destination);
        if (busRequest) {
            const preview = await getOdsayBusPreview(busRequest);
            if (!preview) return fallback;
            const selected = applyOdsayBusPreview(candidate, preview);
            const routeInfo = buildRouteInfoFromAlternative(selected, input.origin, input.destination);
            return { route: { ...selected, odsayBusPreview: undefined, routeInfo }, departAt: routeInfo.departureTime,
                travelMinutes: routeInfo.totalDurationMinutes };
        }
        const request = buildOdsayTimetablePreviewInput(input.route as RouteAlternativeOption,
            { targetArrivalAt }, input.origin, input.destination);
        if (!request) return fallback;
        const { preview, missingEntranceWalk } = await getOdsayTimetablePreview(request);
        if (!preview && !missingEntranceWalk) return fallback;
        const selected = missingEntranceWalk ? applyOdsayEntranceEstimate(candidate, missingEntranceWalk) : candidate;
        if (!preview && selected === candidate) return fallback;
        const estimated = buildRouteInfoFromAlternative({ ...selected, odsayTimetablePreview: preview }, input.origin, input.destination);
        const timing = resolveSelectedRouteTiming({ routeInfo: estimated, targetArrivalAt });
        const routeInfo = { ...estimated, departureTime: timing.departureAt.toISOString(), arrivalTime: timing.arrivalAt.toISOString() };
        return { route: { ...selected, routeInfo }, departAt: routeInfo.departureTime,
            travelMinutes: routeInfo.totalDurationMinutes };
    } catch {
        // The appointment can still be saved with the estimate if the matching timetable is unavailable.
        return fallback;
    }
}

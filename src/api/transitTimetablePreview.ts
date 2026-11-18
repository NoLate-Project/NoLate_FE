import apiClient from "./api";
import { unwrapApiResponse, type ApiEnvelope } from "./response";
import type { RouteAlternativeOption, TransitBusPreview, TransitTimetablePreview } from "../modules/map/tmapApiCore";
import type { Place } from "../modules/schedule/types";

const seoulDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});

type TimetableRequestTime =
    | { targetArrivalAt: string; requestedDepartureAt?: never }
    | { requestedDepartureAt: string; targetArrivalAt?: never };

export function buildOdsayBusPreviewInput(
    option: RouteAlternativeOption, timing: TimetableRequestTime, origin?: Place, destination?: Place,
) {
    const now = Date.now();
    const anchor = Date.parse(timing.targetArrivalAt ?? timing.requestedDepartureAt);
    if (option.mode !== "TRANSIT" || option.provider !== "odsay" || option.intercityJourney ||
        option.transitDepartureTimeSource === "next_service_search" || option.transitServiceState === "not_operating" ||
        !Number.isFinite(anchor) || anchor <= now ||
        typeof origin?.lat !== "number" || typeof origin.lng !== "number" ||
        typeof destination?.lat !== "number" || typeof destination.lng !== "number") return undefined;
    const rides = (option.transitLegs ?? []).filter(leg => leg.kind !== "WALK");
    if (rides.length < 1 || rides.length > 2 || rides.some(leg =>
        leg.kind !== "BUS" || !leg.providerRouteId || !leg.startID || !leg.endID)) return undefined;
    const estimate = Number.isFinite(option.minutes) ? option.minutes! : 10;
    const horizonMinutes = timing.requestedDepartureAt ? 20 : rides.length === 2 ? Math.min(90, estimate + 20) : 30;
    if (anchor > now + horizonMinutes * 60_000) return undefined;
    const ride = rides[0];
    return {
        startX: origin.lng, startY: origin.lat, endX: destination.lng, endY: destination.lat, ...timing,
        alternateProviderRouteId: ride.alternateBusLines?.find(line =>
            line.providerRouteId !== ride.providerRouteId && /^[1-9][0-9]{8}$/.test(line.localRouteId),
        )?.providerRouteId,
        route: { provider: "odsay", transitLegs: rides.map(leg => ({
            kind: "BUS", providerRouteId: leg.providerRouteId, lineName: leg.lineName,
            startID: leg.startID, endID: leg.endID, startName: leg.startName, endName: leg.endName,
            directionCode: leg.directionCode, directionName: leg.directionName,
        })) },
    };
}

export function isFreshOdsayBusPreview(preview?: TransitBusPreview, now = Date.now()): preview is TransitBusPreview {
    if (!preview) return false;
    const source = Date.parse(preview.sourceUpdatedAt);
    return Date.parse(preview.departureAt) > now && source <= now && now - source < 120_000;
}

export async function getOdsayBusPreview(
    input: NonNullable<ReturnType<typeof buildOdsayBusPreviewInput>>, signal?: AbortSignal,
): Promise<TransitBusPreview | undefined> {
    const { data } = await apiClient.post<ApiEnvelope<{ preview?: TransitBusPreview | null }>>(
        "/api/routes/transit/bus-preview", input, { signal, timeout: 10_000 },
    );
    const result = unwrapApiResponse(data).preview;
    if (!result || !isFreshOdsayBusPreview(result)) return undefined;
    if (result.providerRouteId !== input.route.transitLegs[0].providerRouteId &&
        result.providerRouteId !== input.alternateProviderRouteId) return undefined;
    const depart = Date.parse(result.departureAt), board = Date.parse(result.boardingAt);
    const alight = Date.parse(result.alightingAt), arrival = Date.parse(result.arrivalAt);
    if (!(board >= depart && alight > board && arrival >= alight) ||
        ![result.accessSeconds, result.egressSeconds].every(seconds => Number.isSafeInteger(seconds) && seconds >= 0) ||
        depart + result.accessSeconds * 1000 > board || alight + result.egressSeconds * 1000 !== arrival) return undefined;
    const transfer = result.transfer;
    if (Boolean(transfer) !== (input.route.transitLegs.length === 2)) return undefined;
    if (transfer) {
        const firstAlight = Date.parse(transfer.firstAlightingAt), secondBoard = Date.parse(transfer.secondBoardingAt);
        if (transfer.secondProviderRouteId !== input.route.transitLegs[1].providerRouteId ||
            ![transfer.walkingSeconds, transfer.requiredMarginSeconds].every(n => Number.isSafeInteger(n) && n >= 0) ||
            !(firstAlight > board && firstAlight + (transfer.walkingSeconds + transfer.requiredMarginSeconds) * 1000 <= secondBoard &&
                secondBoard < alight)) return undefined;
    }
    if (input.requestedDepartureAt !== undefined ? depart !== Date.parse(input.requestedDepartureAt)
        : arrival > Date.parse(input.targetArrivalAt)) return undefined;
    return { ...result, targetArrivalAt: input.targetArrivalAt };
}

export function applyOdsayBusPreview(option: RouteAlternativeOption, preview: TransitBusPreview): RouteAlternativeOption {
    const legs = option.transitLegs ?? [];
    const bus = legs.find(leg => leg.kind === "BUS");
    if (!bus) return option;
    if (bus.providerRouteId === preview.providerRouteId) return { ...option, odsayBusPreview: preview };
    const line = bus.alternateBusLines?.find(alternate => alternate.providerRouteId === preview.providerRouteId);
    if (!line) return option;
    const evidence = bus.navigationEvidence;
    const selected = {
        ...bus, ...line, alternateBusLines: undefined,
        label: ["버스", line.lineName, bus.durationMinutes ? `${bus.durationMinutes}분` : undefined].filter(Boolean).join(" · "),
        navigationEvidence: evidence && { ...evidence, busIdentifiers: {
            ...evidence.busIdentifiers, localRouteId: line.localRouteId,
            routeCityCode: line.routeCityCode, routeProviderCode: line.routeProviderCode,
        } },
    };
    const transitLegs = legs.map(leg => leg === bus ? selected : leg);
    return { ...option, odsayBusPreview: preview, transitLegs,
        transitModeSummary: transitLegs.filter(leg => leg.kind === "BUS").map(leg => leg.lineName).filter(Boolean).join(" → "),
        stepSummary: transitLegs.map(leg => leg.label).join(" → ") };
}

export function buildOdsayTimetablePreviewInput(
    option: RouteAlternativeOption,
    timing: TimetableRequestTime,
    origin?: Place,
    destination?: Place,
) {
    const target = new Date(timing.targetArrivalAt ?? timing.requestedDepartureAt);
    const now = new Date();
    if (option.mode !== "TRANSIT" || option.provider !== "odsay" || option.intercityJourney ||
        option.transitDepartureTimeSource === "next_service_search" ||
        !Number.isFinite(target.getTime()) || target <= now ||
        !origin || !destination || typeof origin.lat !== "number" || typeof origin.lng !== "number" ||
        typeof destination.lat !== "number" || typeof destination.lng !== "number") return undefined;

    const laterDate = seoulDate.format(target) !== seoulDate.format(now);
    const rides = (option.transitLegs ?? []).filter(leg => leg.kind !== "WALK");
    if (rides.length < 1 || rides.length > 3) return undefined;
    const nextStops: string[] = [];
    const orderedStops: string[][] = [];
    for (const leg of rides) {
        const evidence = leg.navigationEvidence;
        const ids = evidence?.subwayIdentifiers;
        const ordered = [...(evidence?.stopOccurrences ?? [])].sort((a, b) =>
            (a.providerSequence ?? -1) - (b.providerSequence ?? -1));
        const first = ordered[0], last = ordered[ordered.length - 1];
        const next = ordered[1]?.name;
        const firstSequence = first?.providerSequence;
        if (leg.kind !== "SUBWAY" || evidence?.provider !== "odsay" || !ids?.startID || !ids.endID ||
            ids.lanes.length !== 1 || ids.lanes[0].subwayCityCode !== "1000" ||
            !/^[1-9]$/.test(ids.lanes[0].subwayCode ?? "") ||
            ordered.length < 2 || !next || first.routingStationID !== ids.startID || last.routingStationID !== ids.endID ||
            first.name !== leg.startName || last.name !== leg.endName || firstSequence === undefined ||
            ordered.some((stop, index) => !stop.name || !stop.routingStationID ||
                stop.providerSequence !== firstSequence + index)) return undefined;
        nextStops.push(next);
        if (laterDate) orderedStops.push(ordered.map(stop => stop.name!));
    }
    return {
        startX: origin.lng, startY: origin.lat, endX: destination.lng, endY: destination.lat, ...timing, nextStops,
        ...(laterDate && { orderedStops }),
        route: {
            provider: "odsay",
            transitLegs: rides.map(leg => ({
                kind: leg.kind, lineName: leg.lineName, providerRouteId: leg.providerRouteId,
                serviceClass: leg.serviceClass, startName: leg.startName, endName: leg.endName,
                startID: leg.navigationEvidence?.subwayIdentifiers?.startID,
                endID: leg.navigationEvidence?.subwayIdentifiers?.endID,
                directionCode: leg.directionCode, directionName: leg.directionName,
            })),
        },
    };
}

export async function getOdsayTimetablePreview(
    input: NonNullable<ReturnType<typeof buildOdsayTimetablePreviewInput>>,
    signal?: AbortSignal,
): Promise<{ preview?: TransitTimetablePreview; missingEntranceWalk?: VerifiedEntranceWalk }> {
    const { data } = await apiClient.post<ApiEnvelope<{
        preview?: TransitTimetablePreview | null; missingEntranceWalk?: VerifiedEntranceWalk | null;
    }>>(
        "/api/routes/transit/timetable-preview", input, { signal, timeout: 10_000 },
    );
    const { preview, missingEntranceWalk } = unwrapApiResponse(data);
    if (preview) return { preview: validateTimetablePreview(input, preview) };
    const anchor = input.targetArrivalAt ?? input.requestedDepartureAt;
    if (anchor && Date.parse(anchor) > Date.now() &&
        isVerifiedEntranceWalk(missingEntranceWalk)) return { missingEntranceWalk };
    return {};
}

type VerifiedEntranceWalk = NonNullable<TransitTimetablePreview["entranceWalk"]>;

function isVerifiedEntranceWalk(value: VerifiedEntranceWalk | null | undefined): value is VerifiedEntranceWalk {
    return !!value && Number.isSafeInteger(value.seconds) && value.seconds > 0 &&
        Number.isSafeInteger(value.distanceMeters) && value.distanceMeters > 0;
}

export function applyOdsayEntranceEstimate(option: RouteAlternativeOption, walk: VerifiedEntranceWalk): RouteAlternativeOption {
    const legs = option.transitLegs;
    if (option.provider !== "odsay" || legs?.[0]?.kind !== "SUBWAY" ||
        !option.minutes || !Number.isFinite(option.minutes)) return option;
    const totalDurationSeconds = (option.totalDurationSeconds ?? option.minutes * 60) + walk.seconds;
    const durationMinutes = Math.ceil(walk.seconds / 60);
    const walkingLeg = { kind: "WALK" as const, label: `도보 · ${durationMinutes}분`,
        durationMinutes, durationSeconds: walk.seconds, distanceMeters: walk.distanceMeters };
    return { ...option, totalDurationSeconds, minutes: Math.ceil(totalDurationSeconds / 60),
        walkMeters: (option.walkMeters ?? 0) + walk.distanceMeters,
        distanceMeters: option.distanceMeters === undefined ? undefined : option.distanceMeters + walk.distanceMeters,
        transitLegs: [walkingLeg, ...legs], stepSummary: [walkingLeg.label, option.stepSummary].filter(Boolean).join(" → ") };
}

function validateTimetablePreview(
    input: NonNullable<ReturnType<typeof buildOdsayTimetablePreviewInput>>,
    result: TransitTimetablePreview,
): TransitTimetablePreview | undefined {
    const departure = Date.parse(result.departureAt), arrival = Date.parse(result.arrivalAt);
    if (!Number.isFinite(departure) || !Number.isFinite(arrival) || departure <= Date.now() ||
        arrival <= departure) return undefined;
    if (input.requestedDepartureAt !== undefined ? departure !== Date.parse(input.requestedDepartureAt)
        : arrival > Date.parse(input.targetArrivalAt)) return undefined;
    const { rides, transferTimings, entranceWalk, exitWalk } = result;
    if (!Array.isArray(rides) || rides.length !== input.nextStops.length || !rides.every((ride, index) => {
        const board = Date.parse(ride?.boardingAt), alight = Date.parse(ride?.arrivalAt);
        const previous = index ? Date.parse(rides[index - 1]?.arrivalAt) : departure;
        return board >= previous && alight > board && alight <= arrival;
    })) return undefined;
    if (!Array.isArray(transferTimings) || transferTimings.length !== rides.length - 1 ||
        !transferTimings.every((transfer, index) => {
            const previous = Date.parse(transfer?.previousArrivalAt), board = Date.parse(transfer?.boardingAt);
            const margin = transfer?.requiredMarginSeconds;
            return previous === Date.parse(rides[index].arrivalAt) && board === Date.parse(rides[index + 1].boardingAt) &&
                Number.isSafeInteger(transfer.walkingSeconds) && transfer.walkingSeconds >= 0 &&
                typeof margin === "number" && Number.isSafeInteger(margin) && margin >= 0 &&
                (transfer.walkingSeconds + margin) * 1000 <= board - previous;
        })) return undefined;
    if (entranceWalk != null && (!Number.isSafeInteger(entranceWalk.seconds) || entranceWalk.seconds <= 0 ||
        !Number.isSafeInteger(entranceWalk.distanceMeters) || entranceWalk.distanceMeters <= 0 ||
        departure + entranceWalk.seconds * 1000 > Date.parse(rides[0].boardingAt))) return undefined;
    if (exitWalk != null && (!Number.isSafeInteger(exitWalk.seconds) || exitWalk.seconds <= 0 ||
        !Number.isSafeInteger(exitWalk.distanceMeters) || exitWalk.distanceMeters <= 0 ||
        arrival - exitWalk.seconds * 1000 !== Date.parse(rides[rides.length - 1].arrivalAt))) return undefined;
    return { departureAt: result.departureAt, arrivalAt: result.arrivalAt, rides, transferTimings,
        ...(entranceWalk != null && { entranceWalk }), ...(exitWalk != null && { exitWalk }) };
}

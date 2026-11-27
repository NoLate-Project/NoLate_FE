import { transitModeLabel } from "../map/transitModes";
import { firstBoardingIntervalLabel, formatRouteDurationSeconds, rideMovementDurationLabel } from "./routeInfo";
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
const MAX_REPORTED_ARRIVAL_AGE_MS = 20 * 60_000;
const MAX_SEOUL_BUS_FORECAST_AGE_MS = 45_000;

/** The existing detail clock expires a cached live ETA even while the next server read is pending. */
export function expireSeoulBusDepartureStatus(
    status: ScheduleDepartureStatus | undefined,
    nowMs: number,
): ScheduleDepartureStatus | undefined {
    if (status?.source !== "LIVE_PROVIDER" || status.stale || status.failureReason) return status;
    const expired = status.effectiveTransitRoute?.segments.some(({ busRidePrediction }) => {
        if (!busRidePrediction) return false;
        const sourceAt = parseDate(busRidePrediction.sourceUpdatedAt)?.getTime();
        return sourceAt == null || sourceAt > nowMs + 5000 || nowMs - sourceAt > MAX_SEOUL_BUS_FORECAST_AGE_MS;
    });
    if (!expired) return status;
    return {
        ...status,
        stale: true,
        confidence: "LOW",
        failureReason: "TRANSIT_ARRIVAL_SOURCE_STALE: 차량 관측정보가 오래됐어요",
        predictedArrivalAt: null,
        onTimeArrivalPossible: null,
        transitRouteProvenance: null,
        transitTimingBasis: null,
        firstBoardingWaitMinutes: null,
        routeChanged: false,
        effectiveTransitRoute: null,
    };
}

export function isPendingTransitTransfer(status: ScheduleDepartureStatus | null | undefined): boolean {
    return status?.plannedJourneyTimingFailureReason === "TRANSFER_FORECAST_PENDING";
}

/** 출발 뒤의 계획 여정은 실제 탑승 확인이 아니며 출발 알람의 정상 ETA와 섞지 않는다. */
export function buildPlannedJourneyArrivalPresentation(
    status: ScheduleDepartureStatus | null | undefined,
    nowMs: number,
): EffectiveTransitRoutePresentation | undefined {
    if (isPendingTransitTransfer(status)) {
        return {
            guidanceTitle: "계획 경로 기준",
            summary: "환승 버스 도착정보 확인 중",
            compactSummary: "환승 버스 확인 중",
            itinerary: "버스 도착정보가 확인되면 예상 도착시각을 갱신해요",
            mapNote: MAP_SAVED_ROUTE_NOTE,
        };
    }
    if (status && ["TRANSFER_RECONNECTION_UNAVAILABLE", "EARLY_BOARDING_UNCONFIRMED", "TIMELINE_INCONSISTENT"]
        .includes(status.plannedJourneyTimingFailureReason ?? "")) {
        const earlyBoarding = status.plannedJourneyTimingFailureReason === "EARLY_BOARDING_UNCONFIRMED";
        return {
            guidanceTitle: "계획 경로 재확인 필요",
            summary: earlyBoarding ? "승차 시각을 확인하고 있어요" : "환승 시각을 확인하고 있어요",
            compactSummary: earlyBoarding ? "승차 재확인 필요" : "환승 재확인 필요",
            itinerary: earlyBoarding ? "열차가 예상보다 일찍 도착해 계획대로 탈 수 있을지 확인하고 있어요"
                : "관측된 하차 시각으로 다음 편을 연결하지 못했어요",
            waitMeta: "실제 탑승·환승 여부는 확인하지 못했어요. 출발 알림 시각은 바뀌지 않아요",
            mapNote: MAP_SAVED_ROUTE_NOTE,
        };
    }
    const prediction = status?.plannedJourneyArrivalPrediction;
    if (!status || !prediction || !Number.isFinite(nowMs) ||
        !/^[0-9a-f]{64}$/.test(prediction.routeIdentity)) return undefined;
    const arrival = parseDate(prediction.predictedArrivalAt);
    const presented = parseDate(prediction.presentedAt);
    const busObserved = prediction.basis === "MATCHED_BUS_REALTIME" || prediction.basis === "MATCHED_TRAIN_AND_BUS_REALTIME";
    const finalBusReported = prediction.basis === "FINAL_BUS_ALIGHTING_REPORTED";
    const finalTrainReported = prediction.basis === "FINAL_TRAIN_ALIGHTING_REPORTED";
    const finalRideReported = finalBusReported || finalTrainReported;
    const freshnessMs = busObserved ? MAX_SEOUL_BUS_FORECAST_AGE_MS : 120_000;
    const maxDisplayAgeMs = prediction.basis === "LAST_ACCEPTED_PLAN" ? 300_000 : freshnessMs;
    if (!arrival || !presented || arrival.getTime() <= nowMs ||
        presented.getTime() > nowMs + 5_000 || nowMs - presented.getTime() > maxDisplayAgeMs) return undefined;
    if (prediction.basis !== "LAST_ACCEPTED_PLAN") {
        const source = parseDate(prediction.sourceUpdatedAt);
        const sourceMaxAgeMs = finalRideReported ? MAX_REPORTED_ARRIVAL_AGE_MS : freshnessMs;
        if (!source || source.getTime() > nowMs + 5_000 || nowMs - source.getTime() > sourceMaxAgeMs) return undefined;
    }
    const arrivalClock = formatClock(prediction.predictedArrivalAt, status.timeZone);
    if (!arrivalClock) return undefined;
    const observed = prediction.basis === "MATCHED_TRAIN_REALTIME";
    const selectedService = prediction.basis === "OBSERVED_SERVICE_CONNECTION";
    const updated = prediction.basis === "MATCHED_RIDE_AND_ONWARD_TIMETABLE" || selectedService || busObserved || finalRideReported;
    const route = prediction.effectiveTransitRoute;
    const hasRoute = Boolean(getDisplayedPlannedTransitRoute(status, nowMs));
    if (route && !hasRoute) return undefined;
    if (updated && !hasRoute) return undefined;
    if (selectedService && !route?.segments.some(segment => segment.rideTiming?.observedService)) return undefined;
    return {
        guidanceTitle: "계획 경로 기준 · 잠정 도착",
        summary: `${arrivalClock} 도착 예상${hasRoute && route ? ` · 총 ${Math.ceil(route.totalMinutes)}분` : ""}`,
        compactSummary: `${arrivalClock} 도착 예상 · 탑승 미확인`,
        itinerary: hasRoute && route ? itineraryLabel(route, true, status.timeZone) : observed
            ? "같은 환승 열차의 신선한 관측을 반영했어요. 다른 구간은 계획 시각이에요"
            : "마지막으로 확인한 경로의 계획 도착시각이에요",
        waitMeta: (finalRideReported ? `${finalBusReported ? "하차 정류장" : "하차역"} 도착 보고와 남은 도보를 반영했어요. ` :
            updated && route?.segments.some(segment => segment.transferTiming) ? "환승 도보와 승차 여유를 반영했어요. " :
            prediction.basis === "LAST_ACCEPTED_PLAN" && hasRoute ? "도착시각은 이전 계획을 기준으로 해요. " : "") +
            "실제 탑승·환승 여부는 확인하지 못했어요. 출발 알림 시각은 바뀌지 않아요",
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

/** 카드와 시간 레일은 같은 여정을 사용한다. 이전 계획에는 실시간 근거를 붙이지 않는다. */
export function getDisplayedPlannedTransitRoute(
    status: ScheduleDepartureStatus | null | undefined,
    nowMs: number,
): EffectiveTransitRoute | undefined {
    const prediction = status?.plannedJourneyArrivalPrediction;
    const route = prediction?.effectiveTransitRoute;
    if (!status || status.plannedJourneyTimingFailureReason || !prediction || !route ||
        !Number.isFinite(nowMs) ||
        !/^[0-9a-f]{64}$/.test(prediction.routeIdentity) || route.identity !== prediction.routeIdentity) return undefined;
    const source = parseDate(prediction.sourceUpdatedAt);
    const presented = parseDate(prediction.presentedAt);
    const departure = parseDate(route.departureAt);
    const arrival = parseDate(route.arrivalAt);
    const baseline = prediction.basis === "LAST_ACCEPTED_PLAN";
    const busObserved = prediction.basis === "MATCHED_BUS_REALTIME";
    const finalBusReported = prediction.basis === "FINAL_BUS_ALIGHTING_REPORTED";
    const finalTrainReported = prediction.basis === "FINAL_TRAIN_ALIGHTING_REPORTED";
    const finalRideReported = finalBusReported || finalTrainReported;
    const railBusConnection = prediction.basis === "MATCHED_TRAIN_AND_BUS_REALTIME";
    const freshnessMs = busObserved || railBusConnection ? MAX_SEOUL_BUS_FORECAST_AGE_MS : 120_000;
    if (!presented || !departure || !arrival || (!baseline && (!source || source.getTime() > nowMs + 5_000 ||
        nowMs - source.getTime() > (finalRideReported ? MAX_REPORTED_ARRIVAL_AGE_MS : freshnessMs))) || presented.getTime() > nowMs + 5_000 ||
        nowMs - presented.getTime() > (baseline ? 300_000 : freshnessMs) || departure.getTime() > nowMs + 5_000 ||
        arrival.getTime() <= nowMs || arrival.getTime() !== parseDate(prediction.predictedArrivalAt)?.getTime() ||
        !isPositiveMinute(route.totalMinutes) || !Array.isArray(route.segments) || !route.segments.length) return undefined;
    const rides = route.segments.filter(segment => segment.kind !== "WALK").sort((a, b) => a.sequence - b.sequence);
    if (rides.some(({ rideTiming }, index) => rideTiming?.reportedAlightingAt != null &&
        ((index === rides.length - 1 && !finalTrainReported) || (parseDate(rideTiming.reportedAlightingAt)?.getTime() ?? Infinity) > nowMs))) {
        return undefined;
    }
    if (finalRideReported) {
        const final = rides.at(-1);
        if (!final || final.kind !== (finalBusReported ? "BUS" : "SUBWAY")) return undefined;
        const reported = parseDate(finalBusReported ? final.busRidePrediction?.reportedAlightingAt : final.rideTiming?.reportedAlightingAt);
        if (!reported || reported.getTime() !== source?.getTime() || reported.getTime() > nowMs) return undefined;
        const remaining = route.segments.filter(segment => segment.sequence > final.sequence);
        const walking = remaining.map(leg => leg.durationSeconds ?? leg.durationMinutes * 60);
        if (!remaining.every(leg => leg.kind === "WALK") || walking.some(seconds => !Number.isSafeInteger(seconds) || seconds < 0) ||
            reported.getTime() + walking.reduce((sum, seconds) => sum + seconds, 0) * 1000 !== arrival.getTime()) return undefined;
    }
    const buses = rides.filter(segment => segment.kind === "BUS");
    if (buses.length) {
        const trains = rides.filter(segment => segment.kind !== "BUS");
        const mixed = trains.length > 0;
        const busFirst = rides[0]?.kind === "BUS";
        const busLast = rides.at(-1)?.kind === "BUS";
        const lastTrainObserved = mixed && busFirst && prediction.basis === "MATCHED_TRAIN_REALTIME";
        if (route.provider !== "odsay" || (!baseline && !busObserved && !lastTrainObserved && !railBusConnection && !finalRideReported) ||
            (baseline && prediction.sourceUpdatedAt != null) || (railBusConnection && (!mixed || !busLast)) ||
            (mixed && (buses.length !== 1 || trains.length > 2 || (!busFirst && !busLast) ||
                trains.some(segment => segment.kind !== "SUBWAY")))) {
            return undefined;
        }
        let directForecast = false;
        for (const segment of buses) {
            if (!rideTimingLabel(segment, status.timeZone)) return undefined;
            const bus = segment.busRidePrediction!;
            if (bus.reportedAlightingAt != null) {
                const terminalReport = finalBusReported && segment === rides.at(-1);
                if ((!terminalReport && (!mixed || !busFirst)) ||
                    (parseDate(bus.reportedAlightingAt)?.getTime() ?? Infinity) > nowMs) return undefined;
            }
            if (bus.alightingObservationSourceUpdatedAt == null) continue;
            const observed = parseDate(bus.alightingObservationSourceUpdatedAt);
            if (!busObserved || !source || !observed || observed < source || observed.getTime() > nowMs + 5_000) return undefined;
            directForecast = true;
        }
        for (const [index, segment] of trains.entries()) {
            if (!rideTimingLabel(segment, status.timeZone)) return undefined;
            const timing = segment.rideTiming!;
            if (lastTrainObserved && index === trains.length - 1) {
                const observed = parseDate(timing.observationSourceUpdatedAt);
                if (timing.basis !== "PLANNED_RIDE_ALIGHTING_REALTIME" || !source || !observed ||
                    observed.getTime() !== source.getTime()) return undefined;
            } else if (!railBusConnection && timing.basis !== "TIMETABLE" &&
                !((baseline || finalTrainReported || (busLast && (busObserved || finalBusReported))) && timing.basis === "PLANNED_RIDE_BASELINE" &&
                    timing.observationSourceUpdatedAt == null)) return undefined;
        }
        if (finalRideReported) return route;
        if (railBusConnection) {
            const bus = buses[0];
            const transfer = bus.transferTiming;
            const finalTrain = trains.at(-1)?.rideTiming;
            const railArrival = finalTrain?.predictedArrivalAt;
            const railAlreadyReported = finalTrain?.reportedAlightingAt != null;
            const busSource = parseDate(bus.busRidePrediction?.sourceUpdatedAt);
            const busBoarding = parseDate(bus.busRidePrediction?.boardingAt);
            const ready = parseDate(transfer?.confidenceReadyAt);
            const railSources = trains.flatMap(({ rideTiming }) => [rideTiming?.observationSourceUpdatedAt,
                rideTiming?.reportedBoarding ? null : rideTiming?.boardingObservationSourceUpdatedAt]).filter(value => value != null);
            if (!source || !busSource || busSource < source || busSource.getTime() > nowMs + 5_000 ||
                (railAlreadyReported ? railSources.length !== 0 || busSource.getTime() !== source.getTime() : !railSources.length) ||
                railSources.some(value => {
                    const stamp = parseDate(value);
                    return !stamp || stamp < source || stamp.getTime() > nowMs + 5_000;
                }) || !transfer || !railArrival || !busBoarding || !ready || ready > busBoarding ||
                parseDate(transfer.previousArrivalAt)?.getTime() !== parseDate(railArrival)?.getTime() ||
                parseDate(transfer.boardingAt)?.getTime() !== busBoarding.getTime() ||
                transfer.walkingSeconds <= 0 || transfer.remainingSlackSeconds < 0) return undefined;
            return route;
        }
        return baseline || directForecast || lastTrainObserved ? route : undefined;
    }
    if (busObserved || finalBusReported) return undefined;
    for (const segment of rides) {
        const timing = segment.rideTiming;
        const reported = timing?.reportedBoarding;
        if (reported && (!hasReportedBoardingEvidence(segment) || reported.routeIdentity !== route.identity ||
            parseDate(reported.routeDepartureAt)?.getTime() !== departure.getTime() ||
            (parseDate(reported.checkedAt)?.getTime() ?? Infinity) > nowMs ||
            (parseDate(reported.recordedAt)?.getTime() ?? Infinity) > nowMs)) return undefined;
        if (timing?.boardingObservationSourceUpdatedAt != null && timing.observationSourceUpdatedAt == null) return undefined;
        // ARRIVED 게시시각은 당시 확인한 과거 상태다. 현재 하차 예보의 신선도와 분리한다.
        // 이 예외는 같은 경로·구간·차량·기록 시점까지 검증한 명시적 기록에만 적용한다.
        for (const stamp of [timing?.observationSourceUpdatedAt, reported ? null : timing?.boardingObservationSourceUpdatedAt]) {
            if (stamp == null) continue;
            const stationSource = parseDate(stamp);
            if (!source || !stationSource || stationSource < source || stationSource.getTime() > nowMs + 5_000) return undefined;
        }
    }
    if (finalTrainReported && rides.some(({ rideTiming }) => rideTiming?.observationSourceUpdatedAt != null ||
        rideTiming?.boardingObservationSourceUpdatedAt != null)) return undefined;
    if (baseline && (prediction.sourceUpdatedAt != null || rides.some(segment =>
        !["TIMETABLE", "PLANNED_RIDE_BASELINE"].includes(segment.rideTiming?.basis ?? "") ||
        segment.rideTiming?.observationSourceUpdatedAt != null))) return undefined;
    return rides.length && rides.every(segment => segment.kind === "SUBWAY" && rideTimingLabel(segment, status.timeZone))
        ? route : undefined;
}

/** 호환 호출도 관측 기반 경로에만 fresh 의미를 유지한다. */
export function getFreshPlannedTransitRoute(status: ScheduleDepartureStatus | null | undefined, nowMs: number) {
    return status?.plannedJourneyArrivalPrediction?.basis === "LAST_ACCEPTED_PLAN"
        ? undefined : getDisplayedPlannedTransitRoute(status, nowMs);
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

    if (isPendingTransitTransfer(status)) {
        return { recommendedDepartureAt: parseDate(status?.recommendedDepartureAt) ?? savedRecommendedDepartureAt };
    }

    const fresh = getFreshDepartureTiming(status);
    const trackingPlan = status?.plannedJourneyArrivalPrediction || status?.plannedJourneyTimingFailureReason;
    const protectedDeparture = !fresh && status?.stale &&
        (status.failureReason || status.originReplanDiagnostic || trackingPlan)
        ? parseDate(status.recommendedDepartureAt) : undefined;
    // The provisional arrival refers to the already accepted plan and its original departure.
    const inProgressDeparture = trackingPlan ? protectedDeparture : undefined;
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
    if (timing.basis === "PLANNED_RIDE_BASELINE" || timing.basis === "PLANNED_RIDE_ALIGHTING_REALTIME") {
        return timing.plannedBoardingIsStationArrival === true;
    }
    return timing.basis === "OBSERVED_SUBWAY_SERVICE_REALTIME" ||
        timing.basis === "REPORTED_BOARDING_AND_ALIGHTING_REALTIME" ||
        timing.basis === "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE" ||
        timing.basis === "FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING" ||
        timing.basis === "TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING" ||
        timing.basis === "FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME" ||
        timing.basis === "PLANNED_RIDE_BOARDING_REALTIME" ||
        timing.basis === "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE";
}

/** Historical provider state, not an expired forecast or confirmation that the user boarded. */
export function hasReportedBoardingEvidence(segment: EffectiveTransitRouteSegment): boolean {
    const timing = segment.rideTiming;
    const record = timing?.reportedBoarding;
    const service = timing?.observedService;
    if (!timing || !record || !service || segment.kind !== "SUBWAY" ||
        !["REPORTED_BOARDING_AND_ALIGHTING_REALTIME", "PLANNED_RIDE_BASELINE", "PLANNED_RIDE_ALIGHTING_REALTIME"].includes(timing.basis) ||
        !/^[0-9a-f]{64}$/u.test(record.routeIdentity) || record.segmentSequence !== segment.sequence) return false;
    const posted = parseDate(record.sourceUpdatedAt);
    const recorded = parseDate(record.recordedAt);
    const checked = parseDate(record.checkedAt);
    const departed = parseDate(record.routeDepartureAt);
    const boarding = parseDate(timing.predictedBoardingAt);
    if (!posted || !recorded || !checked || !departed || !boarding || boarding.getTime() !== posted.getTime() ||
        posted < departed || recorded < posted || checked < posted ||
        checked.getTime() - posted.getTime() > 120_000 || recorded.getTime() - posted.getTime() > 120_000 ||
        recorded.getTime() > checked.getTime() + 5_000) return false;
    return (["provider", "line", "serviceDate", "trainNumber", "directionCode", "serviceClass", "terminalName",
        "boardingStationName", "alightingStationName"] as const).every(key => record.service?.[key] === service[key]);
}

/** Never label a newly selected vehicle with the comparison timetable's train number. */
export function selectedSubwayTrainNumber(segment: EffectiveTransitRouteSegment): string | undefined {
    const timing = segment.rideTiming;
    if (!timing) return undefined;
    const service = timing.observedService;
    if (service == null) return timing.basis === "OBSERVED_SUBWAY_SERVICE_REALTIME" ||
        timing.basis === "REPORTED_BOARDING_AND_ALIGHTING_REALTIME" || timing.reportedBoarding != null
        ? undefined : timing.timetable.trainNumber?.trim() || undefined;
    const table = timing.timetable;
    const stationKey = (name: string | null | undefined) => typeof name === "string"
        ? name.replace(/\([^)]*\)/gu, "").replace(/\s+/gu, "").replace(/종착$/u, "")
            .replace(/방면$/u, "").replace(/행$/u, "").replace(/역$/u, "") : "";
    const stops = segment.orderedStopNames?.map(stationKey) ?? [];
    if (service.provider !== "seoul-openapi" || service.line !== table.line ||
        service.serviceDate !== table.serviceDate || service.directionCode !== table.directionCode ||
        service.serviceClass !== table.serviceClass || !stationKey(service.terminalName) ||
        stationKey(service.terminalName) !== stationKey(table.terminalName) ||
        !/^[A-Z]?[0-9]{1,12}$/u.test(service.trainNumber) || !/[1-9]/u.test(service.trainNumber) ||
        ![service.terminalName, service.boardingStationName, service.alightingStationName].every(name =>
            typeof name === "string" && name === name.trim() && name.length > 0 && name.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(name)) ||
        service.boardingStationName !== segment.fromName?.trim() || service.alightingStationName !== segment.toName?.trim() ||
        stops.length < 2 || stops.length > 512 || stops.some(name => !name) || new Set(stops).size !== stops.length ||
        stops[0] !== stationKey(service.boardingStationName) || stops.at(-1) !== stationKey(service.alightingStationName) ||
        !["OBSERVED_SUBWAY_SERVICE_REALTIME", "REPORTED_BOARDING_AND_ALIGHTING_REALTIME", "PLANNED_RIDE_BASELINE", "PLANNED_RIDE_ALIGHTING_REALTIME"].includes(timing.basis) ||
        timing.reportedBoarding != null && !hasReportedBoardingEvidence(segment) ||
        timing.basis === "REPORTED_BOARDING_AND_ALIGHTING_REALTIME" && !hasReportedBoardingEvidence(segment)) return undefined;
    return service.trainNumber;
}

/** Optional evidence is additive. Invalid/legacy metadata must not invent a precise clock. */
function rideTimingLabel(segment: EffectiveTransitRouteSegment, timeZone?: string | null): string | undefined {
    const bus = segment.busRidePrediction;
    if (segment.kind === "BUS" && bus) {
        const boarding = parseDate(bus.boardingAt);
        const alighting = parseDate(bus.alightingAt);
        const updated = parseDate(bus.sourceUpdatedAt);
        const direct = parseDate(bus.alightingObservationSourceUpdatedAt);
        if (boarding && alighting && updated && updated <= boarding && boarding < alighting) {
            if (bus.reportedAlightingAt != null) {
                if (bus.alightingObservationSourceUpdatedAt != null ||
                    parseDate(bus.reportedAlightingAt)?.getTime() !== alighting.getTime()) return undefined;
                return `${formatClock(bus.boardingAt, timeZone, true)} 승차 계획 → ${formatClock(bus.alightingAt, timeZone, true)} 하차 정류장 도착 보고`;
            }
            if (bus.alightingObservationSourceUpdatedAt != null && (!direct || direct < boarding || direct > alighting)) {
                return undefined;
            }
            const boardingLabel = direct ? "승차 계획" : "승차 정류장 도착 예측";
            const alightingLabel = direct ? "같은 버스 하차 예보" : "하차 정류장 도착 예측";
            return `${formatClock(bus.boardingAt, timeZone, true)} ${boardingLabel} → ${formatClock(bus.alightingAt, timeZone, true)} ${alightingLabel}`;
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
    const trainNumber = selectedSubwayTrainNumber(segment);
    if (!boarding || !arrival || !scheduledBoarding || !scheduledArrival ||
        !trainNumber || arrival <= boarding || scheduledArrival <= scheduledBoarding) return undefined;
    if (timing.reportedAlightingAt != null) {
        if (timing.basis !== "PLANNED_RIDE_BASELINE" || timing.observationSourceUpdatedAt != null ||
            parseDate(timing.reportedAlightingAt)?.getTime() !== arrival.getTime()) return undefined;
        const boardingLabel = timing.plannedBoardingIsStationArrival ? "승차역 열차 도착 계획" : "승차 계획";
        return `${trainNumber}열차 · ${formatClock(timing.predictedBoardingAt, timeZone, true)} ${boardingLabel} → ${formatClock(timing.reportedAlightingAt, timeZone, true)} 하차역 도착 보고`;
    }
    if (timing.basis === "REPORTED_BOARDING_AND_ALIGHTING_REALTIME") {
        const boardSource = parseDate(timing.boardingObservationSourceUpdatedAt);
        const alightSource = parseDate(timing.observationSourceUpdatedAt);
        if (!hasReportedBoardingEvidence(segment) || !boardSource || boardSource.getTime() !== boarding.getTime() ||
            !alightSource || alightSource > arrival) return undefined;
        return `${trainNumber}열차 · ${formatClock(timing.predictedBoardingAt, timeZone, true)} 승차역 도착 관측 → ${formatClock(timing.predictedArrivalAt, timeZone, true)} 하차 예측`;
    }
    if (timing.basis === "OBSERVED_SUBWAY_SERVICE_REALTIME") {
        const boardSource = parseDate(timing.boardingObservationSourceUpdatedAt);
        const alightSource = parseDate(timing.observationSourceUpdatedAt);
        if (!boardSource || !alightSource || Math.abs(boardSource.getTime() - alightSource.getTime()) > 125_000) return undefined;
        return `${trainNumber}열차 · 양 끝 역 실시간 예측 · ${formatClock(timing.predictedBoardingAt, timeZone, true)} 승차역 열차 도착 예측 → ${formatClock(timing.predictedArrivalAt, timeZone, true)} 하차 예측`;
    }
    if (timing.basis === "PLANNED_RIDE_BASELINE" || timing.basis === "PLANNED_RIDE_ALIGHTING_REALTIME") {
        const observed = timing.basis === "PLANNED_RIDE_ALIGHTING_REALTIME";
        if (observed ? !parseDate(timing.observationSourceUpdatedAt) : timing.observationSourceUpdatedAt != null) return undefined;
        const reported = hasReportedBoardingEvidence(segment);
        const bothObserved = !reported && observed && timing.plannedBoardingIsStationArrival === true &&
            Boolean(parseDate(timing.boardingObservationSourceUpdatedAt));
        const basis = bothObserved ? "승하차역 실시간 예측" : reported && observed
            ? "승차역 도착 관측 · 하차역 실시간" : observed ? "하차역 실시간 · 승차 계획 유지" : "이전 계획";
        const boardingLabel = reported ? "열차 도착 관측" : bothObserved ? "승차역 열차 도착 예측"
            : timing.plannedBoardingIsStationArrival === true ? "승차역 열차 도착 계획" : "승차 계획";
        return `${trainNumber}열차 · ${basis} · ${formatClock(timing.predictedBoardingAt, timeZone, true)} ${boardingLabel} → ${formatClock(timing.predictedArrivalAt, timeZone, true)} 하차 ${observed ? "예측" : "계획"}`;
    }
    const adjustedAtBoarding = isBoardingStationArrivalPrediction(timing);
    const scheduledOriginArrival = adjustedAtBoarding && table.boardingStationArrivalAt != null
        ? parseDate(table.boardingStationArrivalAt)
        : scheduledBoarding;
    if (!scheduledOriginArrival || scheduledOriginArrival > scheduledBoarding) return undefined;
    const shift = boarding.getTime() - scheduledOriginArrival.getTime();
    const firstRideBothObserved = timing.basis === "FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME";
    const transferWithTimetableAlighting = timing.basis === "TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING";
    const alightingFromTimetable = timing.basis === "FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING" || transferWithTimetableAlighting;
    const alightingObserved = timing.basis === "TRANSFER_ALIGHTING_REALTIME" || firstRideBothObserved;
    const transferObserved = alightingObserved || transferWithTimetableAlighting ||
        timing.basis === "PLANNED_RIDE_BOARDING_REALTIME" ||
        timing.basis === "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE";
    if (transferObserved && !parseDate(timing.observationSourceUpdatedAt)) return undefined;
    if (alightingFromTimetable
        ? shift >= 0 || arrival.getTime() !== scheduledArrival.getTime()
        : alightingObserved
        ? !firstRideBothObserved && shift !== 0
        : arrival.getTime() !== scheduledArrival.getTime() + shift ||
            (timing.basis === "TIMETABLE" ? shift !== 0
                : timing.basis !== "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE" &&
                    timing.basis !== "PLANNED_RIDE_BOARDING_REALTIME" &&
                    timing.basis !== "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE")) return undefined;
    const basis = timing.basis === "TIMETABLE" ? "시간표"
        : timing.basis === "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE" ? "첫 승차 실시간 반영"
            : alightingFromTimetable ? "승차역 실시간 · 하차역 시간표"
            : firstRideBothObserved ? "승하차역 실시간 예측"
            : timing.basis === "PLANNED_RIDE_BOARDING_REALTIME" ? "승차역 실시간 · 하차역 시간표 보정"
            : alightingObserved ? "하차역 실시간 예측" : "환승역 실시간 반영";
    // The timetable fallback used to compute the shift does not change what the live feed observed.
    const boardingLabel = adjustedAtBoarding ? "승차역 열차 도착 예측" : "승차";
    return `${trainNumber}열차 · ${basis} · ${formatClock(timing.predictedBoardingAt, timeZone, true)} ${boardingLabel} → ${formatClock(timing.predictedArrivalAt, timeZone, true)} 하차 예측`;
}

function exactWalkingSeconds(segment: EffectiveTransitRouteSegment): number | undefined {
    const detail = segment.walkingTiming;
    const seconds = segment.durationSeconds ?? detail?.movementSeconds;
    if (segment.kind !== "WALK" || detail?.source === "ROUTE_MINUTES" ||
        typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0 ||
        Math.ceil(seconds / 60) !== segment.durationMinutes || (detail && detail.movementSeconds !== seconds)) return undefined;
    return seconds;
}

function rideClocks(segment: EffectiveTransitRouteSegment): { boardingAt: string; alightingAt: string } | undefined {
    if (segment.kind === "BUS") return segment.busRidePrediction ?? undefined;
    if (segment.kind === "SUBWAY" && segment.rideTiming) {
        return { boardingAt: segment.rideTiming.predictedBoardingAt, alightingAt: segment.rideTiming.predictedArrivalAt };
    }
    return undefined;
}

/** The previous alighting, transfer walks and next boarding all belong to this ordered itinerary. */
export function transitTransferWaitSeconds(segments: EffectiveTransitRouteSegment[], index: number): number | undefined {
    const segment = segments[index];
    if (index < 1 || segment.sequence !== index) return undefined;
    const nextClocks = rideClocks(segment);
    if (!nextClocks || !rideTimingLabel(segment)) return undefined;
    let previousIndex = index - 1;
    let walkingSeconds: number | undefined = 0;
    while (previousIndex >= 0 && segments[previousIndex].kind === "WALK") {
        const walk = segments[previousIndex];
        if (walk.sequence !== previousIndex || (walk.walkingScope != null && walk.walkingScope !== "TRANSFER")) return undefined;
        const seconds = exactWalkingSeconds(walk);
        if (seconds === undefined && (walk.durationSeconds != null || (walk.walkingTiming && walk.walkingTiming.source !== "ROUTE_MINUTES"))) return undefined;
        walkingSeconds = walkingSeconds !== undefined && seconds !== undefined ? walkingSeconds + seconds : undefined;
        previousIndex--;
    }
    const previousRide = segments[previousIndex];
    if (!previousRide || previousRide.sequence !== previousIndex || !rideTimingLabel(previousRide)) return undefined;
    const previousClocks = rideClocks(previousRide);
    if (!previousClocks) return undefined;
    const previousRideArrivalAt = previousClocks.alightingAt;
    const boardingAt = nextClocks.boardingAt;
    if (!segment.transferTiming) {
        // Older accepted plans have clocks and recorded walks but no separate transfer object.
        // Without a walk leg we do not know whether this transfer took zero walking time.
        if (previousIndex + 1 === index || walkingSeconds === undefined) return undefined;
        const waitMs = Date.parse(boardingAt) - Date.parse(previousRideArrivalAt) - walkingSeconds * 1000;
        return Number.isSafeInteger(waitMs) && waitMs >= 0 ? waitMs / 1000 : undefined;
    }
    const transfer = segment.transferTiming;
    if ((walkingSeconds !== undefined && walkingSeconds !== transfer.walkingSeconds) ||
        !Number.isSafeInteger(transfer.walkingSeconds) || transfer.walkingSeconds < 0 ||
        !Number.isSafeInteger(transfer.requiredMarginSeconds) || transfer.requiredMarginSeconds < 0) return undefined;
    const previous = parseDate(transfer.previousArrivalAt)?.getTime();
    const ready = parseDate(transfer.physicalReadyAt)?.getTime();
    const boarding = parseDate(transfer.boardingAt)?.getTime();
    if (previous === undefined || previous !== parseDate(previousRideArrivalAt)?.getTime() ||
        ready === undefined || boarding === undefined ||
        ready !== previous + transfer.walkingSeconds * 1000 ||
        boarding !== Date.parse(boardingAt)) return undefined;
    const waitMs = boarding - ready;
    const slackMs = waitMs - transfer.requiredMarginSeconds * 1000;
    if (!Number.isSafeInteger(waitMs) || slackMs < 0 ||
        Math.floor(slackMs / 1000) !== transfer.remainingSlackSeconds) return undefined;
    return waitMs / 1000;
}

/** Use the route departure and exact access legs. The notification can have an earlier, protected time. */
export function firstTransitBoardingInterval(route: EffectiveTransitRoute): { sequence: number; seconds: number } | undefined {
    let readyAt = Date.parse(route.departureAt);
    const segments = [...route.segments].sort((a, b) => a.sequence - b.sequence);
    for (const [index, segment] of segments.entries()) {
        if (segment.sequence !== index) return undefined;
        if (segment.kind === "WALK") {
            const seconds = exactWalkingSeconds(segment);
            if (seconds === undefined) return undefined;
            readyAt += seconds * 1000;
            continue;
        }
        const clocks = rideClocks(segment);
        if (!clocks || (segment.kind === "BUS" && !rideTimingLabel(segment))) return undefined;
        const intervalMs = Date.parse(clocks.boardingAt) - readyAt;
        return Number.isSafeInteger(intervalMs) && intervalMs >= 0 ? { sequence: index, seconds: intervalMs / 1000 } : undefined;
    }
    return undefined;
}

function segmentLabel(segment: EffectiveTransitRouteSegment, showMinutes: boolean,
                      timeZone?: string | null, transferWait?: number, firstIntervalSeconds?: number): string {
    const places = compactPlaceRange(segment);
    const direction = segment.directionName?.trim();

    const mode = transitModeLabel(segment.kind);
    const walkingLabel = segment.walkingScope === "ACCESS" ? "접근 도보"
        : segment.walkingScope === "TRANSFER" ? "환승 도보"
            : segment.walkingScope === "EGRESS" ? "도착 도보" : "도보";
    const line = segment.kind === "WALK" ? walkingLabel : segment.lineName?.trim() || mode;
    // These are provider-evaluated segments, not scaled portions of the saved plan.
    // Segment minutes are rounded up and already include their waiting time.
    const seconds = exactWalkingSeconds(segment);
    const walkingDuration = seconds === undefined ? undefined : formatRouteDurationSeconds(seconds);
    const ride = rideTimingLabel(segment, timeZone);
    const clocks = ride ? rideClocks(segment) : undefined;
    const firstInterval = clocks && showMinutes
        ? firstBoardingIntervalLabel(firstIntervalSeconds,
            Boolean(segment.rideTiming && isBoardingStationArrivalPrediction(segment.rideTiming)),
            segment.kind === "BUS" ? "BUS" : "SUBWAY") : undefined;
    const rideSeconds = clocks ? (Date.parse(clocks.alightingAt) - Date.parse(clocks.boardingAt)) / 1000 : 0;
    const movementDuration = clocks && (firstIntervalSeconds !== undefined || transferWait !== undefined)
        ? rideMovementDurationLabel(undefined, rideSeconds) : undefined;
    let duration: string | undefined;
    if (showMinutes) {
        if (walkingDuration) duration = `약 ${walkingDuration}`;
        else if (movementDuration) {
            const travelScope = segment.kind === "BUS" ? "승차 정류장부터 하차 정류장까지" : "승차역부터 하차역까지";
            duration = `${travelScope} 약 ${movementDuration}`;
        }
        else if (isPositiveMinute(segment.durationMinutes)) duration = `약 ${Math.ceil(segment.durationMinutes)}분`;
    }
    const transferWaitLabel = transferWait !== undefined && transferWait > 0
        ? `환승 대기 약 ${formatRouteDurationSeconds(transferWait)}` : undefined;
    const meters = segment.walkingGeometry?.distanceMeters;
    // Provider's leg distance is explanatory only; never derive travel seconds/platform coverage from it.
    const walkingDistance = segment.kind === "WALK" && typeof meters === "number" &&
        Number.isSafeInteger(meters) && meters >= 0 ? `${meters}m` : undefined;
    return [line, places, direction, firstInterval, transferWaitLabel, duration, walkingDistance, ride].filter(Boolean).join(" · ");
}

function itineraryLabel(route: EffectiveTransitRoute, showMinutes: boolean, timeZone?: string | null,
                        firstInterval = showMinutes && Array.isArray(route.segments) ? firstTransitBoardingInterval(route) : undefined): string {
    const segments = Array.isArray(route.segments) ? [...route.segments].sort((a, b) => a.sequence - b.sequence) : [];
    const labels = segments.map((segment, index) => segmentLabel(segment, showMinutes, timeZone,
        showMinutes || segment.transferTiming ? transitTransferWaitSeconds(segments, index) : undefined,
        segment.sequence === firstInterval?.sequence ? firstInterval.seconds : undefined))
        .filter(Boolean);

    return labels.length > 0
        ? labels.join("  →  ")
        : "현재 확인된 대체 대중교통 경로로 안내해요.";
}

export function getDisplayedFutureTimetableRoute(
    status: ScheduleDepartureStatus | null | undefined,
    nowMs: number,
): EffectiveTransitRoute | undefined {
    const route = status?.futureTimetablePrediction;
    const staleObservation = status?.failureReason?.startsWith("TRANSIT_ARRIVAL_SOURCE_STALE:") === true;
    const unobservedTrain = status?.failureReason?.startsWith("TRANSIT_TRAIN_NOT_YET_OBSERVED:") === true;
    const departure = parseDate(route?.departureAt);
    const arrival = parseDate(route?.arrivalAt);
    if (!status || !route || status.stale !== true || status.source !== "TIMETABLE_PROVIDER" ||
        (!staleObservation && !unobservedTrain) ||
        !Number.isFinite(nowMs) || !departure || !arrival || departure.getTime() < nowMs || arrival <= departure ||
        !isPositiveMinute(route.totalMinutes) || !Array.isArray(route.segments) || !route.segments.length) return undefined;
    const rides = route.segments.filter(segment => segment.kind !== "WALK");
    if (!rides.length || !rides.every(segment => segment.rideTiming?.basis === "TIMETABLE" &&
        rideTimingLabel(segment, status.timeZone))) return undefined;
    return route;
}

export function getFutureTimetableArrivalSummary(
    status: ScheduleDepartureStatus | null | undefined,
    nowMs = Date.now(),
): string | undefined {
    const route = getDisplayedFutureTimetableRoute(status, nowMs);
    const arrival = route && formatClock(route.arrivalAt, status?.timeZone);
    if (!arrival) return undefined;
    const routeLabel = status?.futureTimetableRouteProvenance === "SELECTED_ROUTE_PRESERVED" ? ""
        : status?.futureTimetableRouteProvenance === "ODSAY_ALTERNATIVE_ROUTE" ? "대안 경로 " : "조회 경로 ";
    return `${routeLabel}${arrival} 도착 예상 · 시간표 기준`;
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
    const firstInterval = sameRoute && Array.isArray(route.segments) ? firstTransitBoardingInterval(route) : undefined;
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
        itinerary: itineraryLabel(route, sameRoute, status.timeZone, firstInterval),
        waitMeta: [
            !firstInterval && isPositiveMinute(status.firstBoardingWaitMinutes)
                ? `첫 승차 대기 ${Math.ceil(status.firstBoardingWaitMinutes)}분 · 총시간에 포함` : undefined,
            sameRoute ? "승하차 시각을 분리할 수 없는 열차 구간은 대기 포함·분 단위 올림값이에요. 도보는 원본 초가 있으면 초 단위로 표시해요" : undefined,
            // EGRESS is a journey position, not proof of an exit/platform boundary.
            // Explain the existing total; never add walking again or infer coverage from coordinates.
            route.segments.some(segment => segment.kind === "WALK" &&
                segment.walkingScope === "EGRESS" && isPositiveMinute(segment.durationMinutes))
                ? "도착 도보는 총시간에 포함돼요. 역 내부 이동 포함 범위는 확인되지 않았어요" : undefined,
        ].filter(Boolean).join(" · ") || undefined,
        mapNote: MAP_SAVED_ROUTE_NOTE,
    };
}

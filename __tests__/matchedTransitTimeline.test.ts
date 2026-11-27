import type { EffectiveTransitRouteSegment, ScheduleDepartureStatus } from "../src/api/schedule";
import { applyMatchedTransitTimeline } from "../src/modules/schedule/matchedTransitTimeline";
import { buildEffectiveTransitRoutePresentation, buildPlannedJourneyArrivalPresentation } from "../src/modules/schedule/effectiveTransitRoutePresentation";
import type { RouteInfo } from "../src/modules/schedule/routeInfo";
import { buildSavedTransitProgressFromSteps, getTransitRouteSummaryAccessibilityLabel } from "../src/modules/schedule/transitRouteProgress";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 15, 0, minute)).toISOString();
const info: RouteInfo = {
    id: "saved", originName: "출발", destinationName: "도착", timeBasis: "estimated",
    departureTime: at(0), arrivalTime: at(25), totalDurationMinutes: 25,
    steps: [
        { id: "origin", type: "ORIGIN", title: "출발" },
        { id: "first", type: "SUBWAY", title: "노원역", lineName: "4호선", durationMinutes: 8, passStops: [{ name: "사당역" }] },
        { id: "walk", type: "WALK", title: "도보", durationMinutes: 3 },
        { id: "second", type: "SUBWAY", title: "사당역", lineName: "2호선", durationMinutes: 14, passStops: [{ name: "신림역" }] },
        { id: "destination", type: "DESTINATION", title: "도착" },
    ],
};

function ride(sequence: number, lineName: string, fromName: string, toName: string, board: number, alight: number): EffectiveTransitRouteSegment {
    return {
        sequence, kind: "SUBWAY", lineName, fromName, toName, durationMinutes: alight - board,
        rideTiming: {
            basis: "TIMETABLE", predictedBoardingAt: at(board), predictedArrivalAt: at(alight),
            timetable: { provider: "seoul", line: lineName, serviceDate: "2026-11-15", trainNumber: `200${sequence}`,
                directionCode: "UP", serviceClass: "LOCAL", fromStationCode: fromName, toStationCode: toName,
                terminalName: toName, boardingAt: at(board), arrivalAt: at(alight), fetchedAt: at(0) },
        },
    };
}

function status(): ScheduleDepartureStatus {
    return {
        scheduleId: 363, travelMinutes: 31, recommendedDepartureAt: at(0), evaluatedAt: at(0),
        predictedArrivalAt: at(32), liveFetchedAt: at(0), source: "LIVE_PROVIDER", stale: false, confidence: "MEDIUM",
        failureReason: null, lastChangedAt: null, lastTrafficChangeMinutes: null, nextCheckAt: null,
        preparationMinutes: null, preparationStartAt: null, safetyBufferMinutes: null, timeZone: "Asia/Seoul",
        routeChanged: false, effectiveTransitRoute: {
            provider: "odsay", identity: "matched", departureAt: at(1), arrivalAt: at(32), totalMinutes: 31,
            segments: [ride(0, "수도권 4호선", "노원", "사당", 3, 10),
                { sequence: 1, kind: "WALK", durationMinutes: 3, durationSeconds: 152 },
                ride(2, "2호선", "사당", "신림", 19, 32)],
        },
    };
}

test("matches both vehicle clocks without adding transfer wait twice or changing saved geometry", () => {
    const result = applyMatchedTransitTimeline(info, status());
    expect(result).toMatchObject({ matchedTimeline: true, departureTime: at(1), arrivalTime: at(32) });
    expect(result?.steps[1]).toMatchObject({ durationMinutes: 7, matchedTimeline: { startAt: at(3), endAt: at(10) } });
    expect(result?.steps[1].matchedTimeline?.transferWaitSeconds).toBeUndefined();
    expect(result?.steps[1].matchedTimeline?.firstBoardingIntervalSeconds).toBe(120);
    expect(result?.steps[2].matchedTimeline).toMatchObject({ startAt: at(10), endAt: new Date(Date.parse(at(10)) + 152_000).toISOString() });
    expect(result?.steps[3]).toMatchObject({
        durationMinutes: 13,
        matchedTimeline: { startAt: at(19), endAt: at(32), transferWaitSeconds: 388 },
    });
    expect(info.steps[3].matchedTimeline).toBeUndefined();
});

test("shows only verified rail and walking clocks while the onward bus is pending", () => {
    const seconds = (value: number) => new Date(Date.parse(at(0)) + value * 1000).toISOString();
    const saved: RouteInfo = { ...info, provider: "odsay", steps: [info.steps[0],
        { id: "access", type: "WALK", title: "도보", durationMinutes: 1 }, info.steps[1], info.steps[2],
        { id: "bus", type: "BUS", lineName: "402", title: "승차 정류장", alightingName: "하차 정류장",
            durationMinutes: 4, description: "4분", scheduledRide: { boardingAt: at(9), arrivalAt: at(13) } },
        { id: "egress", type: "WALK", title: "도보", durationMinutes: 1 }, info.steps.at(-1)!,
    ] };
    const route = { provider: "odsay", identity: "b".repeat(64), departureAt: at(0), arrivalAt: seconds(1830), totalMinutes: 31,
        segments: [{ sequence: 0, kind: "WALK", walkingScope: "ACCESS", durationMinutes: 1, durationSeconds: 30 },
            ride(1, "4호선", "노원", "사당", 2, 30),
            { sequence: 2, kind: "WALK", walkingScope: "TRANSFER", durationMinutes: 1, durationSeconds: 30 },
        ] satisfies EffectiveTransitRouteSegment[] };
    const pending: ScheduleDepartureStatus = { ...status(), predictedArrivalAt: null,
        plannedJourneyTimingFailureReason: "TRANSFER_FORECAST_PENDING", pendingTransferRailPlan: route };
    const now = Date.parse(at(10));
    const result = applyMatchedTransitTimeline(saved, pending, now);
    expect(result).toMatchObject({ matchedTimelineBasis: "PENDING_TRANSFER", departureTime: at(0), arrivalTime: "" });
    expect(result?.steps.find(step => step.id === "first")?.matchedTimeline).toMatchObject({ startAt: at(2), endAt: at(30) });
    expect(result?.steps.find(step => step.id === "walk")?.matchedTimeline).toMatchObject({
        startAt: at(30), endAt: seconds(1830), movementSeconds: 30,
    });
    const bus = result?.steps.find(step => step.id === "bus");
    expect(bus?.matchedTimeline ?? bus?.scheduledRide ?? bus?.durationMinutes ?? bus?.description).toBeUndefined();
    expect(saved.steps.find(step => step.id === "bus")?.durationMinutes).toBe(4);

    Object.assign(route.segments[1].rideTiming!, { basis: "PLANNED_RIDE_BASELINE", reportedAlightingAt: at(30) });
    const reported = applyMatchedTransitTimeline(saved, pending, Date.parse(at(32)));
    expect(reported?.steps.find(step => step.id === "first")?.matchedTimeline)
        .toMatchObject({ endAt: at(30), endsWithReportedStationArrival: true });
    expect(reported?.steps.find(step => step.id === "bus")?.matchedTimeline).toBeUndefined();
    expect(applyMatchedTransitTimeline(saved, pending, now)?.steps.every(step => !step.matchedTimeline)).toBe(true);

    route.segments[1].fromName = "다른 역";
    const mismatched = applyMatchedTransitTimeline(saved, pending, now);
    expect(mismatched?.steps.some(step => step.matchedTimeline || step.scheduledRide)).toBe(false);
    expect(mismatched?.arrivalTime).toBe("");
});

test("uses the same Seoul bus clocks for the summary and the saved map after a transfer reconnects", () => {
    const seconds = (value: number) => new Date(Date.parse(at(0)) + value * 1000).toISOString();
    const walk = (sequence: number, durationSeconds: number, walkingScope: "ACCESS" | "TRANSFER" | "EGRESS"): EffectiveTransitRouteSegment => ({
        sequence, kind: "WALK", durationMinutes: 1, durationSeconds, walkingScope,
    });
    const route = {
        provider: "odsay", identity: "b".repeat(64), departureAt: at(0), arrivalAt: seconds(820), totalMinutes: 14,
        segments: [walk(0, 30, "ACCESS"), {
            sequence: 1, kind: "BUS", lineName: "101", fromName: "첫 정류장", toName: "환승 정류장", durationMinutes: 6,
            busRidePrediction: { boardingAt: seconds(90), alightingAt: seconds(390), sourceUpdatedAt: seconds(-5),
                alightingObservationSourceUpdatedAt: seconds(148) },
        }, walk(2, 30, "TRANSFER"), {
            sequence: 3, kind: "BUS", lineName: "202", fromName: "다음 정류장", toName: "마지막 정류장", durationMinutes: 6,
            busRidePrediction: { boardingAt: seconds(480), alightingAt: seconds(760), sourceUpdatedAt: seconds(151) },
            transferTiming: { previousArrivalAt: seconds(390), walkingSeconds: 30, physicalReadyAt: seconds(420),
                boardingAt: seconds(480), bufferSeconds: 0, confidenceMarginSeconds: 60,
                requiredMarginSeconds: 60, confidenceReadyAt: seconds(480), remainingSlackSeconds: 0 },
        }, walk(4, 60, "EGRESS")] satisfies EffectiveTransitRouteSegment[],
    };
    const saved: RouteInfo = { ...info, provider: "odsay", steps: [info.steps[0],
        { id: "access", type: "WALK", title: "접근" },
        { id: "first-bus", type: "BUS", lineName: "101", title: "첫 정류장", alightingName: "환승 정류장" },
        { id: "transfer", type: "WALK", title: "환승" },
        { id: "next-bus", type: "BUS", lineName: "202", title: "다음 정류장", alightingName: "마지막 정류장" },
        { id: "egress", type: "WALK", title: "도착 도보" }, info.steps.at(-1)!,
    ] };
    const updated: ScheduleDepartureStatus = { ...status(), stale: true, source: null, effectiveTransitRoute: null,
        plannedJourneyArrivalPrediction: { routeIdentity: route.identity, basis: "MATCHED_BUS_REALTIME",
            presentedAt: seconds(153), sourceUpdatedAt: seconds(145), predictedArrivalAt: route.arrivalAt,
            effectiveTransitRoute: route } };
    const now = Date.parse(seconds(170));
    const presentation = buildPlannedJourneyArrivalPresentation(updated, now)!;
    expect(presentation.itinerary).toContain("첫 승차 대기 약 1분 (버스 도착 기준) · 승차 정류장부터 하차 정류장까지 약 5분");
    expect(presentation.itinerary).toContain("환승 도보 · 약 30초");
    expect(presentation.itinerary).toContain("환승 대기 약 1분 · 승차 정류장부터 하차 정류장까지 약 4분 40초");
    expect(presentation.itinerary).toContain("같은 버스 하차 예보");
    expect(presentation.compactSummary).toContain("탑승 미확인");
    const result = applyMatchedTransitTimeline(saved, updated, now)!;
    expect(result).toMatchObject({ departureTime: at(0), arrivalTime: seconds(820), totalDurationSeconds: 820 });
    expect(result.steps[2].matchedTimeline).toMatchObject({ firstBoardingIntervalSeconds: 60, movementSeconds: 300 });
    expect(result.steps[4].matchedTimeline).toMatchObject({ startAt: seconds(480), transferWaitSeconds: 60, movementSeconds: 280 });
    expect(applyMatchedTransitTimeline(saved, updated, Date.parse(seconds(191)))).toBe(saved);
    expect(updated.recommendedDepartureAt).toBe(at(0));

    route.segments[3].transferTiming!.physicalReadyAt = seconds(430);
    expect(buildPlannedJourneyArrivalPresentation(updated, now)?.itinerary).not.toContain("환승 대기 약");
    expect(applyMatchedTransitTimeline(saved, updated, now)?.steps[4].matchedTimeline?.transferWaitSeconds).toBeUndefined();
});

test("shows the updated bus-to-train times and keeps the current evidence on the correct ride", () => {
    const seconds = (value: number) => new Date(Date.parse(at(0)) + value * 1000).toISOString();
    const bus: EffectiveTransitRouteSegment = {
        sequence: 1, kind: "BUS", lineName: "402", fromName: "승차 정류장", toName: "하차 정류장", durationMinutes: 6,
        busRidePrediction: { boardingAt: seconds(90), alightingAt: seconds(390), sourceUpdatedAt: seconds(-5),
            alightingObservationSourceUpdatedAt: seconds(148) },
    };
    const train = ride(3, "2호선", "사당", "신림", 8, 12);
    train.rideTiming!.timetable.trainNumber = "2014";
    train.rideTiming!.timetable.boardingAt = train.rideTiming!.predictedBoardingAt = seconds(500);
    train.rideTiming!.timetable.arrivalAt = train.rideTiming!.predictedArrivalAt = seconds(760);
    const route = { provider: "odsay", identity: "b".repeat(64), departureAt: at(0), arrivalAt: seconds(820), totalMinutes: 14,
        segments: [{ sequence: 0, kind: "WALK", durationMinutes: 1, durationSeconds: 30 }, bus,
            { sequence: 2, kind: "WALK", durationMinutes: 1, durationSeconds: 30, walkingScope: "TRANSFER" }, train,
            { sequence: 4, kind: "WALK", durationMinutes: 1, durationSeconds: 60 }] satisfies EffectiveTransitRouteSegment[],
    };
    const saved: RouteInfo = { ...info, provider: "odsay", steps: [info.steps[0],
        { id: "access", type: "WALK", title: "접근" },
        { id: "bus", type: "BUS", lineName: "402", title: "승차 정류장", alightingName: "하차 정류장" },
        info.steps[2], info.steps[3], { id: "egress", type: "WALK", title: "도착 도보" }, info.steps.at(-1)!,
    ] };
    const updated: ScheduleDepartureStatus = { ...status(), stale: true, source: null, effectiveTransitRoute: null,
        plannedJourneyArrivalPrediction: { routeIdentity: route.identity, basis: "MATCHED_BUS_REALTIME",
            presentedAt: seconds(153), sourceUpdatedAt: seconds(145), predictedArrivalAt: route.arrivalAt,
            effectiveTransitRoute: route } };
    const afterBus = Date.parse(seconds(170));
    const firstItinerary = buildPlannedJourneyArrivalPresentation(updated, afterBus)?.itinerary;
    expect(firstItinerary).toContain("같은 버스 하차 예보");
    expect(firstItinerary).toContain("환승 대기 약 1분 20초");
    expect(firstItinerary).toContain("2014열차 · 시간표");
    expect(applyMatchedTransitTimeline(saved, updated, afterBus)?.steps[4].matchedTimeline)
        .toMatchObject({ startAt: seconds(500), endAt: seconds(760), transferWaitSeconds: 80 });

    delete bus.busRidePrediction!.alightingObservationSourceUpdatedAt;
    bus.busRidePrediction!.reportedAlightingAt = seconds(390);
    Object.assign(updated.plannedJourneyArrivalPrediction!, { basis: "LAST_ACCEPTED_PLAN", presentedAt: seconds(480),
        sourceUpdatedAt: null });
    const afterBusReport = Date.parse(seconds(480));
    const reportedItinerary = buildPlannedJourneyArrivalPresentation(updated, afterBusReport)?.itinerary;
    expect(reportedItinerary).toContain("하차 정류장 도착 보고");
    expect(reportedItinerary).toContain("2014열차 · 시간표");
    expect(applyMatchedTransitTimeline(saved, updated, afterBusReport)?.steps[2].matchedTimeline)
        .toMatchObject({ endAt: seconds(390), endsWithReportedStationArrival: true });
    bus.busRidePrediction!.reportedAlightingAt = seconds(391);
    expect(buildPlannedJourneyArrivalPresentation(updated, afterBusReport)).toBeUndefined();
    bus.busRidePrediction!.reportedAlightingAt = seconds(390);
    train.rideTiming!.predictedArrivalAt = seconds(790);
    train.rideTiming!.basis = "PLANNED_RIDE_ALIGHTING_REALTIME";
    train.rideTiming!.observationSourceUpdatedAt = seconds(598);
    route.arrivalAt = seconds(850);
    route.totalMinutes = 15;
    Object.assign(updated.plannedJourneyArrivalPrediction!, { basis: "MATCHED_TRAIN_REALTIME", presentedAt: seconds(600),
        sourceUpdatedAt: seconds(598), predictedArrivalAt: route.arrivalAt });
    const afterTrain = Date.parse(seconds(650));
    const delayedPresentation = buildPlannedJourneyArrivalPresentation(updated, afterTrain);
    expect(delayedPresentation?.itinerary).toContain("2014열차 · 하차역 실시간");
    expect(delayedPresentation?.itinerary).toContain("하차 정류장 도착 보고");
    expect(delayedPresentation?.itinerary).not.toContain("같은 버스 하차 예보");
    expect(applyMatchedTransitTimeline(saved, updated, afterTrain)?.arrivalTime).toBe(seconds(850));
    expect(updated.recommendedDepartureAt).toBe(at(0));
    expect(applyMatchedTransitTimeline(saved, updated, Date.parse(seconds(719)))).toBe(saved);

    train.rideTiming!.predictedArrivalAt = new Date(Date.parse(seconds(767)) + 250).toISOString();
    train.rideTiming!.observationSourceUpdatedAt = seconds(659);
    route.arrivalAt = new Date(Date.parse(seconds(827)) + 250).toISOString();
    route.totalMinutes = 14;
    Object.assign(updated.plannedJourneyArrivalPrediction!, { presentedAt: seconds(660), sourceUpdatedAt: seconds(659),
        predictedArrivalAt: route.arrivalAt });
    const recoveryAt = Date.parse(seconds(665));
    const recoveredPresentation = buildPlannedJourneyArrivalPresentation(updated, recoveryAt);
    expect(recoveredPresentation?.itinerary).toContain("2014열차 · 하차역 실시간");
    expect(recoveredPresentation?.itinerary).toContain("환승 대기 약 1분 20초");
    expect(recoveredPresentation?.itinerary).toContain("승차역부터 하차역까지 약 4분 27초");
    expect(recoveredPresentation?.compactSummary).not.toBe(delayedPresentation?.compactSummary);
    expect(applyMatchedTransitTimeline(saved, updated, recoveryAt)).toMatchObject({ departureTime: at(0), arrivalTime: route.arrivalAt });
});

test("shows a train-to-bus connection with actionable transfer slack and expires both live sources together", () => {
    const seconds = (value: number) => new Date(Date.parse(at(0)) + value * 1000).toISOString();
    const train = ride(1, "4호선", "동작", "사당", 2, 4);
    Object.assign(train.rideTiming!, { predictedArrivalAt: seconds(390), basis: "PLANNED_RIDE_ALIGHTING_REALTIME",
        observationSourceUpdatedAt: seconds(145) });
    const bus: EffectiveTransitRouteSegment = { sequence: 3, kind: "BUS", lineName: "402", fromName: "사당 버스 정류장",
        toName: "하차 정류장", durationMinutes: 7, busRidePrediction: { boardingAt: seconds(480), alightingAt: seconds(760),
            sourceUpdatedAt: seconds(151) }, transferTiming: { previousArrivalAt: seconds(390), walkingSeconds: 30,
            physicalReadyAt: seconds(420), boardingAt: seconds(480), bufferSeconds: 0, confidenceMarginSeconds: 60,
            requiredMarginSeconds: 60, confidenceReadyAt: seconds(480), remainingSlackSeconds: 0 } };
    const route = { provider: "odsay", identity: "c".repeat(64), departureAt: at(0), arrivalAt: seconds(820), totalMinutes: 14,
        segments: [{ sequence: 0, kind: "WALK", durationMinutes: 1, durationSeconds: 30 }, train,
            { sequence: 2, kind: "WALK", durationMinutes: 1, durationSeconds: 30, walkingScope: "TRANSFER" }, bus,
            { sequence: 4, kind: "WALK", durationMinutes: 1, durationSeconds: 60 }] satisfies EffectiveTransitRouteSegment[] };
    const saved: RouteInfo = { ...info, provider: "odsay", steps: [info.steps[0],
        { id: "access", type: "WALK", title: "접근" },
        { id: "train", type: "SUBWAY", lineName: "4호선", title: "동작", alightingName: "사당" },
        { id: "transfer", type: "WALK", title: "환승" },
        { id: "bus", type: "BUS", lineName: "402", title: bus.fromName!, alightingName: bus.toName! },
        { id: "egress", type: "WALK", title: "도착 도보" }, info.steps.at(-1)!] };
    const updated: ScheduleDepartureStatus = { ...status(), stale: true, source: null, effectiveTransitRoute: null,
        plannedJourneyArrivalPrediction: { routeIdentity: route.identity, basis: "MATCHED_TRAIN_AND_BUS_REALTIME",
            presentedAt: seconds(153), sourceUpdatedAt: seconds(145), predictedArrivalAt: route.arrivalAt,
            effectiveTransitRoute: route } };
    const now = Date.parse(seconds(170));
    const presentation = buildPlannedJourneyArrivalPresentation(updated, now);
    expect(presentation?.itinerary).toContain("하차역 실시간");
    expect(presentation?.itinerary).toContain("환승 도보 · 약 30초");
    expect(presentation?.itinerary).toContain("환승 대기 약 1분");
    expect(applyMatchedTransitTimeline(saved, updated, now)?.steps[4].matchedTimeline)
        .toMatchObject({ startAt: seconds(480), endAt: seconds(760), transferWaitSeconds: 60, startsWithStationArrivalPrediction: true });
    expect(applyMatchedTransitTimeline(saved, updated, Date.parse(seconds(191)))).toBe(saved);
    bus.transferTiming!.confidenceReadyAt = seconds(481);
    expect(buildPlannedJourneyArrivalPresentation(updated, now)).toBeUndefined();

    Object.assign(train.rideTiming!, { basis: "PLANNED_RIDE_BASELINE", observationSourceUpdatedAt: null,
        reportedAlightingAt: seconds(390) });
    Object.assign(bus.busRidePrediction!, { boardingAt: seconds(490), sourceUpdatedAt: seconds(477) });
    Object.assign(bus.transferTiming!, { boardingAt: seconds(490), confidenceReadyAt: seconds(480), remainingSlackSeconds: 10 });
    const prediction = updated.plannedJourneyArrivalPrediction!;
    prediction.presentedAt = seconds(480);
    prediction.sourceUpdatedAt = seconds(477);
    const later = Date.parse(seconds(480));
    const afterReport = buildPlannedJourneyArrivalPresentation(updated, later);
    expect(afterReport?.itinerary).toContain("하차역 도착 보고");
    expect(afterReport?.itinerary).toContain("환승 대기 약 1분 10초");
    expect(applyMatchedTransitTimeline(saved, updated, later)?.steps[4].matchedTimeline)
        .toMatchObject({ startAt: seconds(490), endAt: seconds(760), transferWaitSeconds: 70 });
    prediction.sourceUpdatedAt = seconds(476);
    expect(buildPlannedJourneyArrivalPresentation(updated, later)).toBeUndefined();
});

test("separates the Sadang transfer walk, wait and ride in both views from the same station clocks", () => {
    const data = status();
    const route = data.effectiveTransitRoute!;
    const [first, walk, second] = route.segments;
    // Previous train arrives at :06. The next departs at :10:30 and arrives at :18.
    first.rideTiming!.timetable.arrivalAt = first.rideTiming!.predictedArrivalAt = at(6);
    const boarding = new Date(Date.parse(at(10)) + 30_000).toISOString();
    second.rideTiming!.timetable.boardingAt = second.rideTiming!.predictedBoardingAt = boarding;
    second.rideTiming!.timetable.arrivalAt = second.rideTiming!.predictedArrivalAt = at(18);
    second.durationMinutes = 10;
    walk.durationSeconds = 157;
    walk.walkingScope = "TRANSFER";
    data.predictedArrivalAt = route.arrivalAt = at(18);
    data.travelMinutes = route.totalMinutes = 17;
    const presentation = buildEffectiveTransitRoutePresentation(data)!;
    expect(presentation.itinerary).toContain("환승 도보 · 약 2분 37초");
    expect(presentation.itinerary).toContain("환승 대기 약 1분 53초 · 승차역부터 하차역까지 약 7분 30초");
    expect(presentation.itinerary).not.toContain("약 10분");
    expect(applyMatchedTransitTimeline(info, data)?.steps[3]).toMatchObject({
        description: "신림역까지 · 7분 30초",
        matchedTimeline: { transferWaitSeconds: 113, movementSeconds: 450 },
    });

    const reportedEnd = new Date(Date.parse(at(6)) + 250).toISOString();
    first.rideTiming!.timetable.arrivalAt = first.rideTiming!.predictedArrivalAt = reportedEnd;
    const readyMs = Date.parse(reportedEnd) + 157_000;
    second.transferTiming = { previousArrivalAt: reportedEnd, walkingSeconds: 157,
        physicalReadyAt: new Date(readyMs).toISOString(), boardingAt: boarding, bufferSeconds: 60,
        confidenceMarginSeconds: 60, requiredMarginSeconds: 60,
        confidenceReadyAt: new Date(readyMs + 60_000).toISOString(), remainingSlackSeconds: 52 };
    expect(buildEffectiveTransitRoutePresentation(data)?.itinerary).toContain("환승 대기 약 1분 53초 · 승차역부터 하차역까지 약 7분 30초");
    expect(applyMatchedTransitTimeline(info, data)?.steps[3].matchedTimeline?.transferWaitSeconds).toBe(112.75);
});

test.each(["rounded walk", "wrong walk scope", "inconsistent transfer", "sequence gap", "invalid previous clock"])(
    "keeps unsupported precise transfer waits out of both views for %s", problem => {
        const data = status();
        const [first, walk, second] = data.effectiveTransitRoute!.segments;
        if (problem === "rounded walk") delete walk.durationSeconds;
        if (problem === "wrong walk scope") walk.walkingScope = "EGRESS";
        if (problem === "sequence gap") second.sequence++;
        if (problem === "invalid previous clock") first.rideTiming!.timetable.arrivalAt = at(9);
        if (problem === "inconsistent transfer") {
            // Internally consistent metadata, but it contradicts the actual 152-second walk.
            second.transferTiming = { previousArrivalAt: at(10), walkingSeconds: 120,
                physicalReadyAt: at(12), boardingAt: at(19), bufferSeconds: 60,
                confidenceMarginSeconds: 0, requiredMarginSeconds: 60, confidenceReadyAt: at(13), remainingSlackSeconds: 360 };
        }
        expect(buildEffectiveTransitRoutePresentation(data)?.itinerary).not.toContain("환승 대기 약");
        expect(applyMatchedTransitTimeline(info, data)?.steps[3].matchedTimeline?.transferWaitSeconds).toBeUndefined();
    });

test("counts access, first boarding, transfers and rides once, with no exact first wait from rounded access", () => {
    const current = status();
    const route = current.effectiveTransitRoute!;
    const access: EffectiveTransitRouteSegment = { sequence: 0, kind: "WALK", durationMinutes: 1, durationSeconds: 37 };
    route.segments = [access, ...route.segments.map(s => ({ ...s, sequence: s.sequence + 1 }))];
    const saved: RouteInfo = { ...info, steps: [info.steps[0], { id: "access", type: "WALK", title: "접근 도보" }, ...info.steps.slice(1)] };
    const result = applyMatchedTransitTimeline(saved, current)!;
    const times = result.steps.flatMap(s => s.matchedTimeline ? [s.matchedTimeline] : []);
    expect(times[1].firstBoardingIntervalSeconds).toBe(83);
    expect(times.reduce((total, t) => total + t.movementSeconds + (t.firstBoardingIntervalSeconds ?? 0) +
        (t.transferWaitSeconds ?? 0), 0)).toBe(result.totalDurationSeconds);
    expect(buildEffectiveTransitRoutePresentation(current)?.itinerary)
        .toContain("첫 승차 대기 약 1분 23초 (열차 출발 기준) · 승차역부터 하차역까지 약 7분");
    access.durationSeconds = null;
    expect(applyMatchedTransitTimeline(saved, current)?.steps[2].matchedTimeline?.firstBoardingIntervalSeconds).toBeUndefined();
    expect(buildEffectiveTransitRoutePresentation(current)?.itinerary).not.toContain("첫 승차 대기 약");
});

test("uses the stored ODsay end station when the old itinerary has no alightingName or stop list", () => {
    const legacy: RouteInfo = {
        ...info, provider: "odsay",
        steps: info.steps.map((step, index) => step.type === "SUBWAY"
            ? { ...step, passStops: undefined, endName: index === 1 ? "사당" : "신림" }
            : step),
    };
    const current = status();
    const result = applyMatchedTransitTimeline(legacy, current);
    expect(result?.steps[1]).toMatchObject({ alightingName: "사당", matchedTimeline: { startAt: at(3), endAt: at(10) } });
    expect(result?.steps[3]).toMatchObject({ alightingName: "신림", matchedTimeline: { startAt: at(19), endAt: at(32) } });

    current.effectiveTransitRoute!.segments[2].toName = "봉천";
    expect(applyMatchedTransitTimeline(legacy, current)).toBe(legacy);
});

test("updates the same saved rail from fresh provisional ride clocks without promoting a departure ETA", () => {
    const normal = status();
    const route = { ...normal.effectiveTransitRoute!, identity: "a".repeat(64) };
    const nowMs = Date.parse(at(9));
    const planned: ScheduleDepartureStatus = { ...normal, source: null, stale: true, predictedArrivalAt: null,
        travelMinutes: null, effectiveTransitRoute: null, plannedJourneyArrivalPrediction: {
            routeIdentity: route.identity, basis: "MATCHED_RIDE_AND_ONWARD_TIMETABLE", presentedAt: at(9),
            sourceUpdatedAt: at(8), predictedArrivalAt: at(32), effectiveTransitRoute: route } };
    const saved: RouteInfo = { ...info, provider: "odsay" };
    const result = applyMatchedTransitTimeline(saved, planned, nowMs)!;
    expect(result.matchedTimeline).toBe(true);
    expect(result.steps[1].matchedTimeline).toMatchObject({ startAt: at(3), endAt: at(10), provisionalPlan: true });
    expect(result.steps[3].matchedTimeline).toMatchObject({ startAt: at(19), endAt: at(32), provisionalPlan: true });
    expect(planned.recommendedDepartureAt).toBe(at(0));
    expect(applyMatchedTransitTimeline(saved, planned, nowMs + 121_000)).toBe(saved);
    expect(applyMatchedTransitTimeline(saved, { ...planned, plannedJourneyTimingFailureReason: "TIMELINE_INCONSISTENT" }, nowMs)).toBe(saved);
});

test("aligns a verified future timetable on the saved route and leaves its alarm alone", () => {
    const normal = status();
    const saved: RouteInfo = { ...info, provider: "odsay" };
    const route = normal.effectiveTransitRoute!;
    const future: ScheduleDepartureStatus = { ...normal, source: "TIMETABLE_PROVIDER", stale: true,
        effectiveTransitRoute: null, predictedArrivalAt: null, travelMinutes: null,
        failureReason: "TRANSIT_TRAIN_NOT_YET_OBSERVED: safe", futureTimetablePrediction: route,
        futureTimetableRouteProvenance: "SELECTED_ROUTE_PRESERVED" };
    const now = Date.parse(at(0));
    const aligned = applyMatchedTransitTimeline(saved, future, now);
    expect(aligned).toMatchObject({ matchedTimelineBasis: "TIMETABLE", departureTime: at(1), arrivalTime: at(32) });
    expect(aligned?.steps[3].matchedTimeline).toMatchObject({ transferWaitSeconds: 388, provisionalPlan: true });
    expect(future.recommendedDepartureAt).toBe(at(0));
    for (const provenance of ["ODSAY_ALTERNATIVE_ROUTE", null, undefined] as const) {
        expect(applyMatchedTransitTimeline(saved, { ...future, futureTimetableRouteProvenance: provenance }, now)).toBe(saved);
    }
    expect(applyMatchedTransitTimeline(saved, future, Date.parse(at(1)) + 1)).toBe(saved);
    const differentProvider: RouteInfo = { ...saved, provider: "tmap" };
    expect(applyMatchedTransitTimeline(differentProvider, future, now)).toBe(differentProvider);
    route.segments[2].fromName = "교대";
    expect(applyMatchedTransitTimeline(saved, future, now)).toBe(saved);
});

test("replays the refreshed Nowon–Sadang clocks in the compact progress bar", () => {
    const seconds = (value: number) => new Date(Date.parse(at(0)) + value * 1000).toISOString();
    const first = ride(1, "수도권 4호선", "노원", "사당", 5, 53);
    first.rideTiming!.timetable.boardingAt = first.rideTiming!.predictedBoardingAt = seconds(330);
    first.rideTiming!.timetable.arrivalAt = first.rideTiming!.predictedArrivalAt = seconds(3210);
    const second = ride(3, "수도권 2호선", "사당", "신림", 58, 65);
    second.rideTiming!.timetable.arrivalAt = second.rideTiming!.predictedArrivalAt = seconds(3930);
    const saved: RouteInfo = { ...info, provider: "odsay", steps: [info.steps[0],
        { id: "access", type: "WALK", title: "접근", durationMinutes: 1 },
        { ...info.steps[1], durationMinutes: 47 }, info.steps[2], { ...info.steps[3], durationMinutes: 8 },
        { id: "egress", type: "WALK", title: "도착 도보", durationMinutes: 1 }, info.steps.at(-1)!,
    ] };
    const route = { ...status().effectiveTransitRoute!, departureAt: at(0), arrivalAt: seconds(4003), totalMinutes: 67,
        segments: [{ sequence: 0, kind: "WALK", durationMinutes: 3, durationSeconds: 137 }, first,
            { sequence: 2, kind: "WALK", durationMinutes: 3, durationSeconds: 157 }, second,
            { sequence: 4, kind: "WALK", durationMinutes: 2, durationSeconds: 73 }] satisfies EffectiveTransitRouteSegment[],
    };
    const updated = { ...status(), source: "TIMETABLE_PROVIDER" as const, stale: true, effectiveTransitRoute: null,
        failureReason: "TRANSIT_TRAIN_NOT_YET_OBSERVED: safe", futureTimetablePrediction: route,
        futureTimetableRouteProvenance: "SELECTED_ROUTE_PRESERVED" as const };
    const matched = applyMatchedTransitTimeline(saved, updated, Date.parse(seconds(-60)))!;
    expect(getTransitRouteSummaryAccessibilityLabel(buildSavedTransitProgressFromSteps(saved.steps)))
        .toContain("도보 1분, 4호선 47분");
    const summary = buildSavedTransitProgressFromSteps(matched.steps);
    expect(getTransitRouteSummaryAccessibilityLabel(summary)).toContain("도보 3분, 4호선 48분");
    expect(summary.map(segment => segment.durationSeconds)).toEqual([137, 2880, 157, 450, 73]);
    expect(matched.arrivalTime).toBe(seconds(4003));
});

test("keeps the predicted station arrival distinct from the timetable boarding clock", () => {
    const current = status();
    const [first, , transfer] = current.effectiveTransitRoute!.segments;
    first.rideTiming!.basis = "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE";
    first.rideTiming!.timetable.boardingStationArrivalAt = at(3);
    first.rideTiming!.timetable.boardingAt = new Date(Date.parse(at(3)) + 30_000).toISOString();
    transfer.rideTiming!.timetable.boardingStationArrivalAt = at(18);

    const result = applyMatchedTransitTimeline(info, current);
    expect(result?.steps[1].matchedTimeline).toMatchObject({ startAt: at(3), startsWithStationArrivalPrediction: true });
    expect(result?.steps[3].matchedTimeline?.startsWithStationArrivalPrediction).toBeUndefined();
    expect(result?.steps[3].matchedTimeline?.transferWaitSeconds).toBe(388);
});

test.each(["alternative", "stale", "incomplete", "wrong-station", "infeasible", "wrong-arrival"])("does not blend a %s evaluation with the saved map", (condition) => {
    const candidate = status();
    const segments = candidate.effectiveTransitRoute!.segments;
    if (condition === "alternative") candidate.routeChanged = true;
    if (condition === "stale") candidate.stale = true;
    if (condition === "incomplete") delete segments[2].rideTiming;
    if (condition === "wrong-station") segments[2].fromName = "교대";
    if (condition === "infeasible") segments[2].rideTiming!.predictedBoardingAt = at(11);
    if (condition === "wrong-arrival") candidate.predictedArrivalAt = at(40);
    expect(applyMatchedTransitTimeline(info, candidate)).toBe(info);
});

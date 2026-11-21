import type { EffectiveTransitRouteSegment, ScheduleDepartureStatus } from "../src/api/schedule";
import { applyMatchedTransitTimeline } from "../src/modules/schedule/matchedTransitTimeline";
import { buildEffectiveTransitRoutePresentation } from "../src/modules/schedule/effectiveTransitRoutePresentation";
import type { RouteInfo } from "../src/modules/schedule/routeInfo";

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

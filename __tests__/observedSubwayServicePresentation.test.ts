import type { EffectiveTransitRoute, EffectiveTransitRouteSegment, ScheduleDepartureStatus } from "../src/api/schedule";
import { buildPlannedJourneyArrivalPresentation, getDisplayedPlannedTransitRoute, selectedSubwayTrainNumber } from "../src/modules/schedule/effectiveTransitRoutePresentation";
import { applyMatchedTransitTimeline } from "../src/modules/schedule/matchedTransitTimeline";
import type { RouteInfo } from "../src/modules/schedule/routeInfo";

const at = (minute: number) => new Date(Date.parse("2026-11-20T03:00:00Z") + minute * 60_000).toISOString();
function reportedFixture() {
    const value = fixture();
    const timing = value.segment.rideTiming!;
    timing.basis = "REPORTED_BOARDING_AND_ALIGHTING_REALTIME";
    timing.boardingObservationSourceUpdatedAt = at(3);
    timing.observationSourceUpdatedAt = at(8);
    timing.reportedBoarding = { routeIdentity: value.route.identity, routeDepartureAt: value.route.departureAt,
        segmentSequence: value.segment.sequence, service: { ...timing.observedService! },
        sourceUpdatedAt: at(3), checkedAt: at(3.5), recordedAt: at(3.5) };
    value.status.plannedJourneyArrivalPrediction!.sourceUpdatedAt = at(8);
    value.status.plannedJourneyArrivalPrediction!.presentedAt = at(8);
    return value;
}
function fixture(): { segment: EffectiveTransitRouteSegment; route: EffectiveTransitRoute; status: ScheduleDepartureStatus } {
    const segment: EffectiveTransitRouteSegment = { sequence: 0, kind: "SUBWAY", durationMinutes: 10,
        fromName: "사당", toName: "신림", lineName: "2호선", orderedStopNames: ["사당", "낙성대", "서울대입구", "봉천", "신림"],
        rideTiming: { basis: "OBSERVED_SUBWAY_SERVICE_REALTIME", predictedBoardingAt: at(3), predictedArrivalAt: at(10),
            observationSourceUpdatedAt: at(1), boardingObservationSourceUpdatedAt: at(1),
            timetable: { provider: "seoul-timetable", line: "LINE_2", serviceDate: "2026-11-20", trainNumber: "2202",
                directionCode: "UP", serviceClass: "LOCAL", terminalName: "성수", fromStationCode: "0226", toStationCode: "0230",
                boardingAt: at(2), arrivalAt: at(9), fetchedAt: at(0) },
            observedService: { provider: "seoul-openapi", line: "LINE_2", serviceDate: "2026-11-20", trainNumber: "3202",
                directionCode: "UP", serviceClass: "LOCAL", terminalName: "성수", boardingStationName: "사당", alightingStationName: "신림" } } };
    const route: EffectiveTransitRoute = { provider: "odsay", identity: "a".repeat(64), departureAt: at(0), arrivalAt: at(10), totalMinutes: 10, segments: [segment] };
    const status = { scheduleId: 363, timeZone: "Asia/Seoul", stale: true, recommendedDepartureAt: at(0),
        effectiveTransitRoute: null, plannedJourneyArrivalPrediction: { predictedArrivalAt: at(10), routeIdentity: route.identity,
            basis: "OBSERVED_SERVICE_CONNECTION", presentedAt: at(1), sourceUpdatedAt: at(1), effectiveTransitRoute: route } } as ScheduleDepartureStatus;
    return { segment, route, status };
}

test("uses the actual selected vehicle in the summary while keeping the old timetable as comparison data", () => {
    const { segment, status } = fixture();
    expect(selectedSubwayTrainNumber(segment)).toBe("3202");
    const view = buildPlannedJourneyArrivalPresentation(status, Date.parse(at(1)))!;
    expect(view.itinerary).toContain("3202열차 · 양 끝 역 실시간 예측");
    expect(view.itinerary).not.toContain("2202열차");
    expect(view.itinerary).toContain("12:03:00 승차역 열차 도착 예측 → 12:10:00 하차 예측");
    expect(view.waitMeta).toContain("실제 탑승·환승 여부는 확인하지 못했어요");
    expect(segment.rideTiming!.timetable.trainNumber).toBe("2202");
});

test("an expired observation preserves the selected actual vehicle as an explicit old plan", () => {
    const { segment, status } = fixture();
    const timing = segment.rideTiming!;
    timing.basis = "PLANNED_RIDE_BASELINE";
    timing.plannedBoardingIsStationArrival = true;
    timing.observationSourceUpdatedAt = timing.boardingObservationSourceUpdatedAt = null;
    const prediction = status.plannedJourneyArrivalPrediction!;
    prediction.basis = "LAST_ACCEPTED_PLAN";
    prediction.sourceUpdatedAt = null;
    prediction.presentedAt = at(4);
    const view = buildPlannedJourneyArrivalPresentation(status, Date.parse(at(4)))!;
    expect(view.itinerary).toContain("3202열차 · 이전 계획");
    expect(view.itinerary).not.toContain("실시간");
    expect(view.itinerary).not.toContain("2202열차");
});

test("rejects incomplete, conflicting, or detached actual service metadata without falling back to the old train", () => {
    for (const change of ["number", "line", "day", "direction", "terminal", "order", "station", "sources", "missing"] as const) {
        const { segment, status } = fixture();
        const timing = segment.rideTiming!;
        const service = timing.observedService!;
        if (change === "number") service.trainNumber = "0000";
        if (change === "line") service.line = "LINE_4";
        if (change === "day") service.serviceDate = "2026-11-19";
        if (change === "direction") service.directionCode = "DOWN";
        if (change === "terminal") service.terminalName = "신도림";
        if (change === "order") segment.orderedStopNames = ["신림", "사당"];
        if (change === "station") service.boardingStationName = "강남";
        if (change === "sources") timing.boardingObservationSourceUpdatedAt = null;
        if (change === "missing") timing.observedService = null;
        expect(getDisplayedPlannedTransitRoute(status, Date.parse(at(1)))).toBeUndefined();
        expect(buildPlannedJourneyArrivalPresentation(status, Date.parse(at(1)))).toBeUndefined();
    }
});

test("updates the existing rail with the same clocks and station-arrival meaning", () => {
    const { status } = fixture();
    const info = { provider: "odsay", steps: [{ id: "ride", type: "SUBWAY", title: "사당", lineName: "2호선",
        directionCode: "UP", alightingName: "신림" }] } as RouteInfo;
    const result = applyMatchedTransitTimeline(info, status, Date.parse(at(1)));
    expect(result?.matchedTimeline).toBe(true);
    expect(result?.steps[0].matchedTimeline).toMatchObject({ startAt: at(3), endAt: at(10),
        startsWithStationArrivalPrediction: true, provisionalPlan: true });
    expect(result?.arrivalTime).toBe(status.plannedJourneyArrivalPrediction!.predictedArrivalAt);
    expect(info.steps[0].matchedTimeline).toBeUndefined();
});

test("labels a historical station-arrival state separately from the later fresh alighting forecast", () => {
    const { segment, status } = reportedFixture();
    expect(selectedSubwayTrainNumber(segment)).toBe("3202");
    const view = buildPlannedJourneyArrivalPresentation(status, Date.parse(at(8)))!;
    expect(view.itinerary).toContain("3202열차 · 12:03:00 승차역 도착 관측 → 12:10:00 하차 예측");
    expect(view.itinerary).not.toContain("양 끝 역 실시간");
    expect(view.waitMeta).toContain("실제 탑승·환승 여부는 확인하지 못했어요");
});

test("does not use a historical-state exception for a detached, stale-at-capture or forged record", () => {
    for (const change of ["missing", "route", "departure", "sequence", "vehicle", "clock", "stale", "future"] as const) {
        const { segment, status } = reportedFixture();
        const timing = segment.rideTiming!;
        const record = timing.reportedBoarding!;
        if (change === "missing") timing.reportedBoarding = null;
        if (change === "route") record.routeIdentity = "b".repeat(64);
        if (change === "departure") record.routeDepartureAt = at(1);
        if (change === "sequence") record.segmentSequence = 1;
        if (change === "vehicle") record.service.trainNumber = "3204";
        if (change === "clock") record.sourceUpdatedAt = at(2);
        if (change === "stale") record.recordedAt = at(5.1);
        if (change === "future") {
            record.checkedAt = at(7.99);
            record.recordedAt = at(8.01);
            record.sourceUpdatedAt = timing.predictedBoardingAt = timing.boardingObservationSourceUpdatedAt = at(7.98);
        }
        expect(getDisplayedPlannedTransitRoute(status, Date.parse(at(8)))).toBeUndefined();
    }
});

test("keeps the recorded-arrival meaning on the existing clock rail", () => {
    const { status } = reportedFixture();
    const info = { provider: "odsay", steps: [{ id: "ride", type: "SUBWAY", title: "사당", lineName: "2호선",
        directionCode: "UP", alightingName: "신림" }] } as RouteInfo;
    const result = applyMatchedTransitTimeline(info, status, Date.parse(at(8)));
    expect(result?.matchedTimeline).toBe(true);
    expect(result?.steps[0].matchedTimeline).toMatchObject({ startAt: at(3), endAt: at(10),
        startsWithReportedStationArrival: true, provisionalPlan: true });
    expect(result?.steps[0].matchedTimeline?.startsWithStationArrivalPrediction).toBeUndefined();
});

test("accepts independently published fresh alighting data already available with the boarding state", () => {
    const { segment, status } = reportedFixture();
    segment.rideTiming!.observationSourceUpdatedAt = at(2.9);
    status.plannedJourneyArrivalPrediction!.sourceUpdatedAt = at(2.9);
    status.plannedJourneyArrivalPrediction!.presentedAt = at(3.6);
    expect(buildPlannedJourneyArrivalPresentation(status, Date.parse(at(3.6)))?.itinerary)
        .toContain("12:03:00 승차역 도착 관측 → 12:10:00 하차 예측");
});

test("keeps the observed vehicle in an expired plan without claiming a fresh boarding forecast", () => {
    const { segment, route, status } = reportedFixture();
    const timing = segment.rideTiming!;
    timing.basis = "PLANNED_RIDE_BASELINE";
    timing.plannedBoardingIsStationArrival = true;
    timing.predictedArrivalAt = route.arrivalAt = at(30);
    route.totalMinutes = segment.durationMinutes = 30;
    timing.observationSourceUpdatedAt = timing.boardingObservationSourceUpdatedAt = null;
    const prediction = status.plannedJourneyArrivalPrediction!;
    prediction.predictedArrivalAt = at(30);
    prediction.basis = "LAST_ACCEPTED_PLAN";
    prediction.sourceUpdatedAt = null;
    prediction.presentedAt = at(11);
    const view = buildPlannedJourneyArrivalPresentation(status, Date.parse(at(11)))!;
    expect(view.itinerary).toContain("3202열차 · 이전 계획");
    expect(view.itinerary).toContain("열차 도착 관측");
    expect(view.itinerary).not.toContain("실시간");
});

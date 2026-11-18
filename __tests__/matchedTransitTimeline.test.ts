import type { EffectiveTransitRouteSegment, ScheduleDepartureStatus } from "../src/api/schedule";
import { applyMatchedTransitTimeline } from "../src/modules/schedule/matchedTransitTimeline";
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
    expect(result?.steps[2].matchedTimeline).toMatchObject({ startAt: at(10), endAt: new Date(Date.parse(at(10)) + 152_000).toISOString() });
    expect(result?.steps[3]).toMatchObject({
        durationMinutes: 13,
        matchedTimeline: { startAt: at(19), endAt: at(32), transferWaitSeconds: 388 },
    });
    expect(info.steps[3].matchedTimeline).toBeUndefined();
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

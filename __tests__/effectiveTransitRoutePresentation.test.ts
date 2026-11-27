import type { EffectiveTransitRideTiming, ScheduleDepartureStatus } from "../src/api/schedule";
import {
    buildEffectiveTransitRoutePresentation,
    getFutureTimetableArrivalSummary,
    buildPlannedJourneyArrivalPresentation,
    getFreshDepartureTiming,
    resolveAcceptedDepartureStatus,
    resolveScheduleDetailDepartureTiming,
} from "../src/modules/schedule/effectiveTransitRoutePresentation";

function departureStatus(
    overrides: Partial<ScheduleDepartureStatus> = {},
): ScheduleDepartureStatus {
    return {
        scheduleId: 41,
        travelMinutes: 58,
        recommendedDepartureAt: "2026-08-10T09:10:00+09:00",
        evaluatedAt: "2026-08-10T09:00:00+09:00",
        liveFetchedAt: "2026-08-10T09:00:00+09:00",
        source: "LIVE_PROVIDER",
        stale: false,
        confidence: "HIGH",
        failureReason: null,
        lastTrafficChangeMinutes: null,
        lastChangedAt: null,
        nextCheckAt: "2026-08-10T09:05:00+09:00",
        preparationMinutes: null,
        preparationStartAt: null,
        safetyBufferMinutes: null,
        timeZone: "Asia/Seoul",
        firstBoardingWaitMinutes: 6,
        routeChanged: true,
        effectiveTransitRoute: {
            provider: "odsay",
            identity: "alternative-2",
            departureAt: "2026-08-10T09:10:00+09:00",
            arrivalAt: "2026-08-10T10:08:00+09:00",
            totalMinutes: 58,
            segments: [
                {
                    sequence: 2,
                    kind: "SUBWAY",
                    durationMinutes: 22,
                    lineName: "2호선",
                    fromName: "교대역",
                    toName: "시청역",
                    directionName: "외선순환",
                },
                {
                    sequence: 0,
                    kind: "WALK",
                    durationMinutes: 4,
                    fromName: "현재 위치",
                    toName: "강남역",
                },
                {
                    sequence: 1,
                    kind: "BUS",
                    durationMinutes: 26,
                    waitingMinutes: 6,
                    lineName: "간선 740",
                    fromName: "강남역",
                    toName: "교대역",
                },
            ],
        },
        ...overrides,
    };
}

test("shows that a deferred bus transfer is pending without showing the original departure replan as an arrival", () => {
    const status = departureStatus({ plannedJourneyTimingFailureReason: "TRANSFER_FORECAST_PENDING",
        predictedArrivalAt: "2026-08-10T10:30:00+09:00", plannedJourneyArrivalPrediction: null });
    const presentation = buildPlannedJourneyArrivalPresentation(status, Date.parse("2026-08-10T09:25:00+09:00"));
    expect(presentation?.summary).toBe("환승 버스 도착정보 확인 중");
    expect(presentation?.itinerary).not.toContain("10:30");
    expect(resolveScheduleDetailDepartureTiming({ status, savedTravelMinutes: 10, isInspectingTravelPlan: false,
        savedRecommendedDepartureAt: new Date("2026-08-10T09:00:00+09:00") })).toEqual({
        recommendedDepartureAt: new Date("2026-08-10T09:10:00+09:00"),
    });
});

describe("effective transit route presentation", () => {
    it("keeps the last bus's confirmed stop report and the remaining walk separate from a live forecast", () => {
        const reportedAt = "2026-08-10T09:43:30+09:00";
        const arrivalAt = "2026-08-10T09:46:30+09:00";
        const nowMs = Date.parse("2026-08-10T09:45:00+09:00");
        const route = { provider: "odsay", identity: "a".repeat(64), departureAt: "2026-08-10T09:10:00+09:00",
            arrivalAt, totalMinutes: 37, segments: [
                { sequence: 0, kind: "WALK" as const, durationMinutes: 4, durationSeconds: 240 },
                { sequence: 1, kind: "BUS" as const, lineName: "461", fromName: "승차 정류장", toName: "하차 정류장",
                    durationMinutes: 30, busRidePrediction: { boardingAt: "2026-08-10T09:16:00+09:00",
                        alightingAt: reportedAt, reportedAlightingAt: reportedAt, sourceUpdatedAt: "2026-08-10T09:10:00+09:00" } },
                { sequence: 2, kind: "WALK" as const, durationMinutes: 3, durationSeconds: 180, walkingScope: "EGRESS" as const },
            ] };
        const prediction = { predictedArrivalAt: arrivalAt, routeIdentity: route.identity,
            presentedAt: "2026-08-10T09:44:55+09:00", sourceUpdatedAt: reportedAt,
            basis: "FINAL_BUS_ALIGHTING_REPORTED" as const, effectiveTransitRoute: route };
        const status = departureStatus({ stale: true, source: null, travelMinutes: null, predictedArrivalAt: null,
            effectiveTransitRoute: null, plannedJourneyArrivalPrediction: prediction });
        const shown = buildPlannedJourneyArrivalPresentation(status, nowMs);
        expect(shown?.summary).toBe("09:46 도착 예상 · 총 37분");
        expect(shown?.itinerary).toContain("09:43:30 하차 정류장 도착 보고");
        expect(shown?.itinerary).toContain("도착 도보 · 약 3분");
        expect(shown?.waitMeta).toContain("실제 탑승·환승 여부는 확인하지 못했어요");
        expect(resolveScheduleDetailDepartureTiming({ status, isInspectingTravelPlan: false }).recommendedDepartureAt)
            .toEqual(new Date(status.recommendedDepartureAt!));
        expect(buildPlannedJourneyArrivalPresentation(status, Date.parse(arrivalAt))).toBeUndefined();
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...prediction, sourceUpdatedAt: "2026-08-10T09:43:29+09:00",
        } }, nowMs)).toBeUndefined();
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...prediction, effectiveTransitRoute: { ...route, segments: [...route.segments.slice(0, 2),
                { ...route.segments[2], durationSeconds: 120, durationMinutes: 2 }] },
        } }, nowMs)).toBeUndefined();
    });

    it("shows paired bus times only on accepted timing and preserves exact seconds", () => {
        const status = departureStatus();
        const ride = status.effectiveTransitRoute!.segments.find(segment => segment.kind === "BUS")!;
        const paired = {
            boardingAt: "2026-08-10T09:24:02+09:00",
            alightingAt: "2026-08-10T09:26:18+09:00",
            sourceUpdatedAt: "2026-08-10T09:00:00+09:00",
        };
        ride.busRidePrediction = paired;
        expect(buildEffectiveTransitRoutePresentation(status)?.itinerary)
            .toContain("09:24:02 승차 정류장 도착 예측 → 09:26:18 하차 정류장 도착 예측");
        expect(buildEffectiveTransitRoutePresentation({ ...status, stale: true })).toBeUndefined();
        ride.busRidePrediction = { ...paired, boardingAt: paired.alightingAt };
        expect(buildEffectiveTransitRoutePresentation(status)?.itinerary).not.toContain("하차 정류장 도착 예측");
    });

    it.each([true, false])("keeps an in-progress arrival provisional with an origin search of %s", (originSearchPerformed) => {
        const nowMs = Date.parse("2026-08-10T09:45:00+09:00");
        const status = departureStatus({ stale: true, travelMinutes: null, source: null, failureReason: null,
            predictedArrivalAt: null, effectiveTransitRoute: null,
            originReplanDiagnostic: originSearchPerformed ? { travelMinutes: 63, source: "TIMETABLE_PROVIDER", stale: true,
                failureReason: "TRANSIT_TRAIN_NOT_YET_OBSERVED: safe", providerFetchedAt: null } : null,
            plannedJourneyArrivalPrediction: {
                predictedArrivalAt: "2026-08-10T10:08:00+09:00",
                presentedAt: "2026-08-10T09:44:30+09:00",
                routeIdentity: "a".repeat(64), basis: "MATCHED_TRAIN_REALTIME",
                sourceUpdatedAt: "2026-08-10T09:44:30+09:00",
            } });
        const presentation = buildPlannedJourneyArrivalPresentation(status, nowMs)!;
        expect(presentation.guidanceTitle).toBe("계획 경로 기준 · 잠정 도착");
        expect(presentation.compactSummary).toBe("10:08 도착 예상 · 탑승 미확인");
        expect(presentation.waitMeta).toContain("출발 알림 시각은 바뀌지 않아요");
        expect(getFreshDepartureTiming(status)).toBeUndefined();
        expect(resolveScheduleDetailDepartureTiming({ status,
            savedRecommendedDepartureAt: new Date("2026-08-10T09:20:00+09:00"),
            savedTravelMinutes: 48, isInspectingTravelPlan: false,
        }).preservingEarlierDeparture).toBe(true);
        const earlierSavedEstimate = resolveScheduleDetailDepartureTiming({ status,
            savedRecommendedDepartureAt: new Date("2026-08-10T09:00:00+09:00"),
            savedTravelMinutes: 48, isInspectingTravelPlan: false,
        });
        expect(earlierSavedEstimate.recommendedDepartureAt?.toISOString())
            .toBe(new Date(status.recommendedDepartureAt!).toISOString());
        expect(earlierSavedEstimate.travelMinutes).toBe(48);
        expect(buildPlannedJourneyArrivalPresentation(status, nowMs + 121_000)).toBeUndefined();
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...status.plannedJourneyArrivalPrediction!, basis: "LAST_ACCEPTED_PLAN",
        } }, nowMs + 121_000)?.itinerary).toContain("계획 도착시각");
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...status.plannedJourneyArrivalPrediction!, predictedArrivalAt: "2026-08-10T09:40:00+09:00",
        } }, nowMs)).toBeUndefined();
    });
    it("keeps future timetable preview separate from accepted timing and rejects incomplete evidence", () => {
        const timing = rideTiming();
        timing.predictedBoardingAt = timing.timetable.boardingAt;
        timing.predictedArrivalAt = timing.timetable.arrivalAt;
        timing.basis = "TIMETABLE";
        const base = departureStatus();
        const route = { ...base.effectiveTransitRoute!, segments: [
            { sequence: 0, kind: "SUBWAY" as const, durationMinutes: 21, rideTiming: timing },
        ] };
        const status = departureStatus({ source: "TIMETABLE_PROVIDER", stale: true,
            failureReason: "TRANSIT_TRAIN_NOT_YET_OBSERVED: safe", effectiveTransitRoute: null,
            futureTimetablePrediction: route, futureTimetableRouteProvenance: "SELECTED_ROUTE_PRESERVED" });
        const departureMs = Date.parse(route.departureAt);
        expect(getFutureTimetableArrivalSummary(status, departureMs)).toBe("10:08 도착 예상 · 시간표 기준");
        expect(getFutureTimetableArrivalSummary({ ...status, futureTimetableRouteProvenance: "ODSAY_ALTERNATIVE_ROUTE" }, departureMs))
            .toBe("대안 경로 10:08 도착 예상 · 시간표 기준");
        const staleStatus = { ...status, failureReason: "TRANSIT_ARRIVAL_SOURCE_STALE: safe" };
        expect(getFutureTimetableArrivalSummary(staleStatus, departureMs - 1)).toBe("10:08 도착 예상 · 시간표 기준");
        expect(getFreshDepartureTiming(staleStatus)).toBeUndefined();
        expect(getFreshDepartureTiming(status)).toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(status)).toBeUndefined();
        expect(getFutureTimetableArrivalSummary({ ...status, failureReason: "TRANSIT_ARRIVAL_API_ERROR: safe" }, departureMs)).toBeUndefined();
        expect(getFutureTimetableArrivalSummary({ ...status, futureTimetablePrediction: {
            ...route, segments: [{ ...route.segments[0], rideTiming: null }],
        } }, departureMs)).toBeUndefined();
        expect(getFutureTimetableArrivalSummary(status, departureMs + 1)).toBeUndefined();
    });
    const rideTiming = (): EffectiveTransitRideTiming => ({
        timetable: {
            provider: "seoul-timetable", line: "LINE_2", serviceDate: "2026-08-10",
            trainNumber: "2012", directionCode: "DOWN", serviceClass: "LOCAL",
            fromStationCode: "0223", toStationCode: "0230", terminalName: "외선순환",
            boardingAt: "2026-08-10T09:30:00+09:00", arrivalAt: "2026-08-10T09:50:31+09:00",
            fetchedAt: "2026-08-10T09:00:00+09:00",
        },
        predictedBoardingAt: "2026-08-10T09:30:13+09:00", predictedArrivalAt: "2026-08-10T09:50:44+09:00",
        basis: "FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE",
    });

    it.each([false, true])("keeps the terminal train report during the last walk (bus first %s)", busFirst => {
        const reportedAt = "2026-08-10T09:51:04+09:00";
        const arrivalAt = "2026-08-10T09:54:04+09:00";
        const now = Date.parse("2026-08-10T09:53:30+09:00");
        const timing: EffectiveTransitRideTiming = { ...rideTiming(), basis: "PLANNED_RIDE_BASELINE",
            predictedArrivalAt: reportedAt, reportedAlightingAt: reportedAt };
        const bus = { sequence: 1, kind: "BUS" as const, lineName: "461", durationMinutes: 10,
            busRidePrediction: { boardingAt: "2026-08-10T09:14:00+09:00", alightingAt: "2026-08-10T09:24:00+09:00",
                sourceUpdatedAt: "2026-08-10T09:09:00+09:00" } };
        const route = { provider: "odsay", identity: "a".repeat(64), departureAt: "2026-08-10T09:10:00+09:00",
            arrivalAt, totalMinutes: 45, segments: [...(busFirst ? [bus] : []),
                { sequence: 3, kind: "SUBWAY" as const, durationMinutes: 22, rideTiming: timing },
                { sequence: 4, kind: "WALK" as const, durationMinutes: 3, durationSeconds: 180, walkingScope: "EGRESS" as const },
            ] };
        const prediction = { routeIdentity: route.identity, predictedArrivalAt: arrivalAt, sourceUpdatedAt: reportedAt,
            presentedAt: "2026-08-10T09:53:20+09:00", basis: "FINAL_TRAIN_ALIGHTING_REPORTED" as const,
            effectiveTransitRoute: route };
        const status = departureStatus({ effectiveTransitRoute: null, plannedJourneyArrivalPrediction: prediction });
        const presentation = buildPlannedJourneyArrivalPresentation(status, now);
        expect(presentation?.summary).toBe("09:54 도착 예상 · 총 45분");
        expect(presentation?.itinerary).toContain("09:51:04 하차역 도착 보고");
        expect(presentation?.itinerary).toContain("도착 도보 · 약 3분");
        expect(presentation?.waitMeta).toContain("실제 탑승·환승 여부는 확인하지 못했어요");
        expect(buildPlannedJourneyArrivalPresentation(status, Date.parse(arrivalAt))).toBeUndefined();
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...prediction, sourceUpdatedAt: "2026-08-10T09:51:05+09:00",
        } }, now)).toBeUndefined();
    });

    function statusWithTiming(timing: EffectiveTransitRideTiming | null = rideTiming()) {
        const status = departureStatus({ routeChanged: false });
        status.effectiveTransitRoute!.segments[0].rideTiming = timing;
        return status;
    }

    it("shows every refreshed planned ride while keeping departure timing and stale source evidence separate", () => {
        const nowMs = Date.parse("2026-08-10T09:45:00+09:00");
        const timing: EffectiveTransitRideTiming = { ...rideTiming(), basis: "PLANNED_RIDE_ALIGHTING_REALTIME",
            predictedArrivalAt: "2026-08-10T09:56:00+09:00", observationSourceUpdatedAt: "2026-08-10T09:44:50+09:00",
            plannedBoardingIsStationArrival: true };
        const route = { provider: "odsay", identity: "a".repeat(64), departureAt: "2026-08-10T09:20:00+09:00",
            arrivalAt: timing.predictedArrivalAt, totalMinutes: 36,
            segments: [{ sequence: 0, kind: "SUBWAY" as const, durationMinutes: 36, rideTiming: timing }] };
        const status = departureStatus({ stale: true, source: null, travelMinutes: null, predictedArrivalAt: null,
            effectiveTransitRoute: null, plannedJourneyArrivalPrediction: { predictedArrivalAt: route.arrivalAt,
                routeIdentity: route.identity, presentedAt: "2026-08-10T09:44:55+09:00",
                sourceUpdatedAt: "2026-08-10T09:44:50+09:00", basis: "MATCHED_RIDE_AND_ONWARD_TIMETABLE",
                effectiveTransitRoute: route } });
        const result = buildPlannedJourneyArrivalPresentation(status, nowMs)!;
        expect(result.summary).toBe("09:56 도착 예상 · 총 36분");
        expect(result.itinerary).toContain("2012열차 · 하차역 실시간 · 승차 계획 유지 · 09:30:13 승차역 열차 도착 계획 → 09:56:00 하차 예측");
        const bothStations = { ...route, segments: route.segments.map(s => ({ ...s, rideTiming: { ...timing,
            boardingObservationSourceUpdatedAt: "2026-08-10T09:44:49+09:00" } })) };
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...status.plannedJourneyArrivalPrediction!, effectiveTransitRoute: bothStations,
            sourceUpdatedAt: "2026-08-10T09:44:49+09:00",
        } }, nowMs)?.itinerary).toContain("승하차역 실시간 예측 · 09:30:13 승차역 열차 도착 예측 → 09:56:00 하차 예측");
        const expiredBoarding = { ...route, segments: route.segments.map(s => ({ ...s, rideTiming: { ...timing,
            boardingObservationSourceUpdatedAt: "2026-08-10T09:42:59+09:00" } })) };
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...status.plannedJourneyArrivalPrediction!, effectiveTransitRoute: expiredBoarding,
        } }, nowMs)).toBeUndefined();
        expect(result.waitMeta).not.toContain("환승은 시간표 기준");
        const olderFirstStation = { ...timing, observationSourceUpdatedAt: "2026-08-10T09:44:20+09:00" };
        const nextRide = { ...rideTiming(), basis: "PLANNED_RIDE_BOARDING_REALTIME" as const,
            timetable: { ...rideTiming().timetable, trainNumber: "2014", boardingAt: "2026-08-10T09:59:00+09:00",
                arrivalAt: "2026-08-10T10:06:00+09:00" },
            predictedBoardingAt: "2026-08-10T09:59:10+09:00", predictedArrivalAt: "2026-08-10T10:06:10+09:00",
            observationSourceUpdatedAt: "2026-08-10T09:44:50+09:00" };
        const twoRides = { ...route, arrivalAt: nextRide.predictedArrivalAt, totalMinutes: 47, segments: [
            { ...route.segments[0], rideTiming: olderFirstStation },
            { sequence: 1, kind: "SUBWAY" as const, durationMinutes: 10, rideTiming: nextRide },
        ] };
        const mixedSources = { ...status.plannedJourneyArrivalPrediction!, effectiveTransitRoute: twoRides,
            predictedArrivalAt: twoRides.arrivalAt, sourceUpdatedAt: olderFirstStation.observationSourceUpdatedAt };
        const transferResult = buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: mixedSources }, nowMs);
        expect(transferResult?.itinerary).toContain("2012열차 · 하차역 실시간");
        expect(transferResult?.itinerary).toContain("2014열차 · 승차역 실시간");
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...mixedSources, sourceUpdatedAt: nextRide.observationSourceUpdatedAt,
        } }, nowMs)).toBeUndefined();

        const reportedAt = "2026-08-10T09:40:00+09:00";
        const historicalAlighting: EffectiveTransitRideTiming = { ...olderFirstStation, basis: "PLANNED_RIDE_BASELINE",
            predictedArrivalAt: reportedAt, reportedAlightingAt: reportedAt, observationSourceUpdatedAt: null };
        const afterAlighting = { ...twoRides, segments: [
            { ...twoRides.segments[0], rideTiming: historicalAlighting }, twoRides.segments[1],
        ] };
        const afterAlightingStatus = { ...status, plannedJourneyArrivalPrediction: { ...mixedSources,
            sourceUpdatedAt: nextRide.observationSourceUpdatedAt, effectiveTransitRoute: afterAlighting } };
        const historicalResult = buildPlannedJourneyArrivalPresentation(afterAlightingStatus, nowMs);
        expect(historicalResult?.itinerary).toContain("09:40:00 하차역 도착 보고");
        expect(historicalResult?.itinerary).toContain("2014열차 · 승차역 실시간");
        expect(historicalResult?.itinerary).not.toContain("09:40:00 하차 예측");
        historicalAlighting.predictedArrivalAt = "2026-08-10T09:46:00+09:00";
        expect(buildPlannedJourneyArrivalPresentation(afterAlightingStatus, nowMs)).toBeUndefined();
        historicalAlighting.reportedAlightingAt = historicalAlighting.predictedArrivalAt;
        expect(buildPlannedJourneyArrivalPresentation(afterAlightingStatus, nowMs)).toBeUndefined();

        expect(getFreshDepartureTiming(status)).toBeUndefined();
        expect(buildPlannedJourneyArrivalPresentation({ ...status, plannedJourneyArrivalPrediction: {
            ...status.plannedJourneyArrivalPrediction!, sourceUpdatedAt: "2026-08-10T09:42:59+09:00",
        } }, nowMs)).toBeUndefined();
        const failed = buildPlannedJourneyArrivalPresentation({ ...status,
            plannedJourneyTimingFailureReason: "TRANSFER_RECONNECTION_UNAVAILABLE" }, nowMs)!;
        const early = buildPlannedJourneyArrivalPresentation(departureStatus({
            plannedJourneyTimingFailureReason: "EARLY_BOARDING_UNCONFIRMED",
        }), Date.now())!;
        expect(early.compactSummary).toBe("승차 재확인 필요");
        expect(early.itinerary).toContain("계획대로 탈 수 있을지");
        expect(failed.guidanceTitle).toBe("계획 경로 재확인 필요");
        expect(failed.summary).not.toContain("09:56");
    });

    it("shows exact predicted ride clocks and distinguishes first boarding realtime from a future timetable", () => {
        const status = statusWithTiming();
        const result = buildEffectiveTransitRoutePresentation(status)!;
        expect(result.itinerary).toContain("2012열차 · 첫 승차 실시간 반영 · 09:30:13 승차역 열차 도착 예측 → 09:50:44 하차 예측");
        expect(result.itinerary).toContain("약 22분");
        expect(result.summary).toBe("09:10 출발 · 10:08 도착 · 총 58분");
        expect(buildEffectiveTransitRoutePresentation({ ...status, timeZone: "UTC" })!.itinerary)
            .toContain("00:30:13 승차역 열차 도착 예측 → 00:50:44 하차 예측");
        const table = rideTiming().timetable;
        const timetableResult = buildEffectiveTransitRoutePresentation(statusWithTiming({ timetable: table,
            predictedBoardingAt: table.boardingAt, predictedArrivalAt: table.arrivalAt, basis: "TIMETABLE" }))!;
        expect(timetableResult.itinerary).toContain("2012열차 · 시간표 · 09:30:00 승차 → 09:50:31 하차 예측");
        expect(timetableResult.itinerary).not.toContain("실시간 반영");
    });

    it("labels post-departure boarding observation separately from direct alighting evidence", () => {
        const timing: EffectiveTransitRideTiming = { ...rideTiming(), basis: "PLANNED_RIDE_BOARDING_REALTIME",
            observationSourceUpdatedAt: "2026-08-10T09:29:00+09:00" };
        const result = buildEffectiveTransitRoutePresentation(statusWithTiming(timing))!;
        expect(result.itinerary).toContain("승차역 실시간 · 하차역 시간표 보정");
        expect(result.itinerary).toContain("09:30:13 승차역 열차 도착 예측 → 09:50:44 하차 예측");
    });

    it("keeps cached train clocks as an explicit plan and rejects cached realtime labels", () => {
        const now = Date.parse("2026-08-10T09:45:00+09:00");
        const timing: EffectiveTransitRideTiming = { ...rideTiming(), basis: "PLANNED_RIDE_BASELINE",
            observationSourceUpdatedAt: null, plannedBoardingIsStationArrival: true };
        const status = departureStatus({ stale: true, plannedJourneyArrivalPrediction: {
            predictedArrivalAt: timing.predictedArrivalAt, routeIdentity: "a".repeat(64),
            basis: "LAST_ACCEPTED_PLAN", presentedAt: "2026-08-10T09:45:00+09:00",
            effectiveTransitRoute: { provider: "odsay", identity: "a".repeat(64), totalMinutes: 31,
                departureAt: "2026-08-10T09:20:00+09:00", arrivalAt: timing.predictedArrivalAt,
                segments: [{ sequence: 0, kind: "SUBWAY", durationMinutes: 31, rideTiming: timing }] } } });
        const result = buildPlannedJourneyArrivalPresentation(status, now)!;
        expect(result.itinerary).toContain("이전 계획");
        expect(result.itinerary).not.toContain("실시간");
        expect(result.waitMeta).toContain("도착시각은 이전 계획을 기준으로");
        timing.basis = "PLANNED_RIDE_ALIGHTING_REALTIME";
        timing.observationSourceUpdatedAt = "2026-08-10T09:44:59+09:00";
        expect(buildPlannedJourneyArrivalPresentation(status, now)).toBeUndefined();
    });

    it("distinguishes a live transfer boarding prediction from a direct alighting prediction", () => {
        const table = rideTiming().timetable;
        const sourceUpdatedAt = "2026-08-10T09:25:00+09:00";
        const boarding = statusWithTiming({ timetable: table,
            predictedBoardingAt: "2026-08-10T09:32:00+09:00",
            predictedArrivalAt: "2026-08-10T09:52:31+09:00",
            basis: "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE",
            observationSourceUpdatedAt: sourceUpdatedAt });
        expect(buildEffectiveTransitRoutePresentation(boarding)!.itinerary)
            .toContain("환승역 실시간 반영 · 09:32:00 승차역 열차 도착 예측 → 09:52:31 하차 예측");
        const alighting = statusWithTiming({ timetable: table,
            predictedBoardingAt: table.boardingAt,
            predictedArrivalAt: "2026-08-10T09:56:00+09:00",
            basis: "TRANSFER_ALIGHTING_REALTIME", observationSourceUpdatedAt: sourceUpdatedAt });
        expect(buildEffectiveTransitRoutePresentation(alighting)!.itinerary)
            .toContain("하차역 실시간 예측 · 09:30:00 승차 → 09:56:00 하차 예측");
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming({
            ...alighting.effectiveTransitRoute!.segments[0].rideTiming!, observationSourceUpdatedAt: null,
        }))!.itinerary).not.toContain("하차역 실시간 예측");
        const firstRide = statusWithTiming({ timetable: table,
            predictedBoardingAt: "2026-08-10T09:29:35+09:00",
            predictedArrivalAt: "2026-08-10T09:51:05+09:00",
            basis: "FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME", observationSourceUpdatedAt: sourceUpdatedAt });
        expect(buildEffectiveTransitRoutePresentation(firstRide)!.itinerary)
            .toContain("승하차역 실시간 예측 · 09:29:35 승차역 열차 도착 예측 → 09:51:05 하차 예측");
        const timetableAlighting = statusWithTiming({ timetable: table,
            predictedBoardingAt: "2026-08-10T09:29:35+09:00", predictedArrivalAt: table.arrivalAt,
            basis: "FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING" });
        expect(buildEffectiveTransitRoutePresentation(timetableAlighting)!.itinerary)
            .toContain("승차역 실시간 · 하차역 시간표 · 09:29:35 승차역 열차 도착 예측 → 09:50:31 하차 예측");
        const transferEarly = { ...timetableAlighting.effectiveTransitRoute!.segments[0].rideTiming!,
            basis: "TRANSFER_BOARDING_REALTIME_TIMETABLE_ALIGHTING" as const, observationSourceUpdatedAt: sourceUpdatedAt };
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming(transferEarly))!.itinerary)
            .toContain("승차역 실시간 · 하차역 시간표 · 09:29:35 승차역 열차 도착 예측 → 09:50:31 하차 예측");
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming({
            ...transferEarly, observationSourceUpdatedAt: null,
        }))!.itinerary).not.toContain("승차역 실시간");
    });

    it("shows verified transfer waiting instead of an ambiguous train segment total", () => {
        const status = departureStatus({ routeChanged: false });
        const firstAlight = "2026-08-10T09:26:13+09:00";
        const firstBoard = "2026-08-10T09:15:00+09:00";
        const onward = rideTiming();
        const transferTiming = { previousArrivalAt: firstAlight, walkingSeconds: 180,
            bufferSeconds: 0, confidenceMarginSeconds: 60, requiredMarginSeconds: 60,
            physicalReadyAt: "2026-08-10T09:29:13+09:00", confidenceReadyAt: onward.predictedBoardingAt,
            boardingAt: onward.predictedBoardingAt, remainingSlackSeconds: 0 };
        status.effectiveTransitRoute!.segments = [
            { sequence: 0, kind: "SUBWAY", durationMinutes: 16, rideTiming: { basis: "TIMETABLE",
                timetable: { ...onward.timetable, boardingAt: firstBoard, arrivalAt: firstAlight },
                predictedBoardingAt: firstBoard, predictedArrivalAt: firstAlight } },
            { sequence: 1, kind: "WALK", walkingScope: "TRANSFER", durationMinutes: 3, durationSeconds: 180 },
            { sequence: 2, kind: "SUBWAY", lineName: "2호선", durationMinutes: 22, transferTiming,
                rideTiming: { ...onward, basis: "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE",
                    observationSourceUpdatedAt: "2026-08-10T09:25:00+09:00" } },
        ];
        const itinerary = buildEffectiveTransitRoutePresentation(status)!.itinerary;
        expect(itinerary).toContain("환승 도보 · 약 3분");
        expect(itinerary).toContain("2호선 · 환승 대기 약 1분");
        expect(itinerary).not.toContain("약 22분");
        transferTiming.previousArrivalAt = "2026-08-10T09:26:12+09:00";
        expect(buildEffectiveTransitRoutePresentation(status)!.itinerary).not.toContain("환승 대기 약");
    });

    it("uses the scheduled station arrival for a train with separate arrival and departure clocks", () => {
        const timing = rideTiming();
        const timetable = { ...timing.timetable, boardingStationArrivalAt: "2026-08-10T09:29:30+09:00" };
        const corrected = { ...timing, timetable, predictedArrivalAt: "2026-08-10T09:51:14+09:00" };
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming(corrected))!.itinerary)
            .toContain("09:30:13 승차역 열차 도착 예측 → 09:51:14 하차 예측");
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming({
            ...corrected,
            basis: "TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE",
            observationSourceUpdatedAt: "2026-08-10T09:25:00+09:00",
        }))!.itinerary).toContain("환승역 실시간 반영 · 09:30:13 승차역 열차 도착 예측");
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming({
            timetable,
            predictedBoardingAt: timetable.boardingAt,
            predictedArrivalAt: timetable.arrivalAt,
            basis: "TIMETABLE",
        }))!.itinerary).toContain("09:30:00 승차 → 09:50:31 하차 예측");
        expect(buildEffectiveTransitRoutePresentation(statusWithTiming({ ...timing, timetable }))!.itinerary)
            .not.toContain("2012열차");
    });

    it("does not fabricate precision for old, malformed, walking or stale timing metadata", () => {
        const baseline = buildEffectiveTransitRoutePresentation(statusWithTiming(null));
        const bad = [ { ...rideTiming(), predictedArrivalAt: "invalid" },
            { ...rideTiming(), predictedArrivalAt: "2026-08-10T09:50:45+09:00" },
            { ...rideTiming(), basis: "TIMETABLE" as const },
            { ...rideTiming(), timetable: { ...rideTiming().timetable, serviceClass: "UNKNOWN" } } ];
        for (const timing of bad) {
            expect(buildEffectiveTransitRoutePresentation(statusWithTiming(timing as EffectiveTransitRideTiming))).toEqual(baseline);
        }
        const walk = departureStatus();
        walk.effectiveTransitRoute!.segments[1].rideTiming = rideTiming();
        expect(buildEffectiveTransitRoutePresentation(walk)!.itinerary).not.toContain("열차");
        expect(buildEffectiveTransitRoutePresentation({ ...statusWithTiming(), stale: true })).toBeUndefined();
    });

    it("keeps seconds when falling back to the device timezone", () => {
        const status = statusWithTiming();
        const clock = (value: string) => {
            const date = new Date(value);
            return [date.getHours(), date.getMinutes(), date.getSeconds()].map(v => String(v).padStart(2, "0")).join(":");
        };
        expect(buildEffectiveTransitRoutePresentation({ ...status, timeZone: "invalid-zone" })!.itinerary)
            .toContain(`${clock(rideTiming().predictedBoardingAt)} 승차역 열차 도착 예측 → ${clock(rideTiming().predictedArrivalAt)} 하차 예측`);
    });

    it("keeps an earlier protected departure after failure without adopting stale duration or a live label", () => {
        const failed = departureStatus({ stale: true, failureReason: "TRANSIT_ARRIVAL_UNAVAILABLE: unavailable" });
        const result = resolveScheduleDetailDepartureTiming({ status: failed,
            savedRecommendedDepartureAt: new Date("2026-08-10T09:20:00+09:00"),
            savedTravelMinutes: 48, isInspectingTravelPlan: false });
        expect(result.recommendedDepartureAt?.toISOString()).toBe("2026-08-10T00:10:00.000Z");
        expect(result.travelMinutes).toBe(48);
        expect(result.preservingEarlierDeparture).toBe(true);
        expect(getFreshDepartureTiming(failed)).toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(failed)).toBeUndefined();
    });

    it("uses the server's exact saved-route fallback while retaining an earlier protected departure", () => {
        const estimatedAt = "2026-08-10T09:20:17+09:00";
        const status = departureStatus({ stale: true, failureReason: "TRANSIT_TRANSFER_TIMING_UNKNOWN: uncertain",
            savedRouteEstimatedDepartureAt: estimatedAt, recommendedDepartureAt: "2026-08-10T09:35:00+09:00" });
        const timing = { status, savedRecommendedDepartureAt: new Date("2026-08-10T09:20:00+09:00"),
            savedTravelMinutes: 48, isInspectingTravelPlan: false };
        expect(resolveScheduleDetailDepartureTiming(timing).recommendedDepartureAt).toEqual(new Date(estimatedAt));
        expect(resolveScheduleDetailDepartureTiming({ ...timing,
            status: { ...status, recommendedDepartureAt: "2026-08-10T09:19:41+09:00" },
        })).toEqual({ recommendedDepartureAt: new Date("2026-08-10T09:19:41+09:00"),
            travelMinutes: 48, preservingEarlierDeparture: true });
    });

    it.each(["2026-08-10T09:20:00+09:00", "2026-08-10T09:30:00+09:00", "invalid", null])(
        "never delays the saved departure using degraded timing %s", (recommendedDepartureAt) => {
            const saved = new Date("2026-08-10T09:20:00+09:00");
            expect(resolveScheduleDetailDepartureTiming({
                status: departureStatus({ stale: true, failureReason: "PROVIDER_TIMEOUT", recommendedDepartureAt }),
                savedRecommendedDepartureAt: saved, savedTravelMinutes: 48, isInspectingTravelPlan: false,
            })).toEqual({ recommendedDepartureAt: saved, travelMinutes: 48 });
        });
    it("uses only non-stale, successful status timing", () => {
        const timing = getFreshDepartureTiming(departureStatus());

        expect(timing?.recommendedDepartureAt.toISOString()).toBe("2026-08-10T00:10:00.000Z");
        expect(timing?.travelMinutes).toBe(58);
        expect(getFreshDepartureTiming(departureStatus({ stale: true }))).toBeUndefined();
        expect(getFreshDepartureTiming(departureStatus({ failureReason: "PROVIDER_TIMEOUT" }))).toBeUndefined();
        expect(getFreshDepartureTiming(departureStatus({ travelMinutes: null }))).toBeUndefined();
        expect(getFreshDepartureTiming(departureStatus({ recommendedDepartureAt: "invalid" }))).toBeUndefined();
    });

    it("builds a sequence-ordered text itinerary and explicitly preserves the saved map", () => {
        const presentation = buildEffectiveTransitRoutePresentation(departureStatus());

        expect(presentation).toEqual({
            guidanceTitle: "실시간 추천 경로",
            summary: "09:10 출발 · 10:08 도착 · 총 58분",
            itinerary: "도보 · 현재 위치→강남역  →  간선 740 · 강남역→교대역  →  2호선 · 교대역→시청역 · 외선순환",
            waitMeta: "첫 승차 대기 6분 · 총시간에 포함",
            mapNote: "지도에는 저장한 경로가 표시돼요",
        });
        expect(presentation?.itinerary).not.toContain("26분");
        expect(presentation?.itinerary).not.toContain("대기 6분");
    });

    it("formats effective route clocks in the server schedule timezone", () => {
        const seoul = buildEffectiveTransitRoutePresentation(departureStatus({
            timeZone: "Asia/Seoul",
        }));
        const utc = buildEffectiveTransitRoutePresentation(departureStatus({
            timeZone: "UTC",
        }));

        expect(seoul?.summary).toBe("09:10 출발 · 10:08 도착 · 총 58분");
        expect(utc?.summary).toBe("00:10 출발 · 01:08 도착 · 총 58분");
    });

    it("falls back to the device timezone when the server timezone is unsupported", () => {
        const departureAt = new Date("2026-08-10T09:10:00+09:00");
        const arrivalAt = new Date("2026-08-10T10:08:00+09:00");
        const localClock = (date: Date) => [date.getHours(), date.getMinutes()]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");

        const presentation = buildEffectiveTransitRoutePresentation(departureStatus({
            timeZone: "Unsupported/Timezone",
        }));

        expect(presentation?.summary).toBe(
            `${localClock(departureAt)} 출발 · ${localClock(arrivalAt)} 도착 · 총 58분`,
        );
    });

    it("expires accepted timing when the server explicitly returns stale or failed", () => {
        const replacement = departureStatus({ travelMinutes: 62 });

        expect(resolveAcceptedDepartureStatus(departureStatus({ stale: true })))
            .toBeUndefined();
        expect(resolveAcceptedDepartureStatus(
            departureStatus({ failureReason: "PROVIDER_TIMEOUT" }),
        )).toBeUndefined();
        expect(resolveAcceptedDepartureStatus(replacement)).toBe(replacement);
    });

    it("never mixes the current member status into an inspected participant plan", () => {
        const inspectedDepartureAt = new Date("2026-08-10T09:30:00+09:00");

        expect(resolveScheduleDetailDepartureTiming({
            status: departureStatus(),
            savedRecommendedDepartureAt: new Date("2026-08-10T09:20:00+09:00"),
            savedTravelMinutes: 48,
            isInspectingTravelPlan: false,
        })).toMatchObject({
            travelMinutes: 58,
        });

        expect(resolveScheduleDetailDepartureTiming({
            status: departureStatus(),
            savedRecommendedDepartureAt: new Date("2026-08-10T09:20:00+09:00"),
            savedTravelMinutes: 48,
            isInspectingTravelPlan: true,
            inspectedRecommendedDepartureAt: inspectedDepartureAt,
            inspectedTravelMinutes: 38,
        })).toEqual({
            recommendedDepartureAt: inspectedDepartureAt,
            travelMinutes: 38,
        });

        expect(resolveScheduleDetailDepartureTiming({
            status: departureStatus(),
            savedRecommendedDepartureAt: new Date("2026-08-10T09:20:00+09:00"),
            savedTravelMinutes: 48,
            isInspectingTravelPlan: true,
        })).toEqual({
            recommendedDepartureAt: undefined,
            travelMinutes: undefined,
        });
    });

    it("shows unchanged-route corrected segments instead of the saved segment estimates", () => {
        const presentation = buildEffectiveTransitRoutePresentation(departureStatus({ routeChanged: false }));
        expect(presentation?.guidanceTitle).toBe("현재 보정 여정");
        expect(presentation?.itinerary).toContain("간선 740 · 강남역→교대역 · 약 26분");
        expect(presentation?.itinerary).toContain("2호선 · 교대역→시청역 · 외선순환 · 약 22분");
        expect(presentation?.summary).toContain("총 58분");
        expect(presentation?.waitMeta).toContain("대기 포함·분 단위 올림값");
        expect(presentation?.mapNote).toBe("지도에는 저장한 경로가 표시돼요");
    });

    it("separates walking scopes and original seconds without changing the total ETA", () => {
        const status = departureStatus({ routeChanged: false });
        status.effectiveTransitRoute!.segments = [
            { sequence: 0, kind: "WALK", walkingScope: "ACCESS", durationMinutes: 2, durationSeconds: 111 },
            { sequence: 1, kind: "SUBWAY", durationMinutes: 22, lineName: "4호선" },
            { sequence: 2, kind: "WALK", walkingScope: "TRANSFER", durationMinutes: 5, durationSeconds: 243 },
            { sequence: 3, kind: "SUBWAY", durationMinutes: 11, lineName: "2호선" },
            { sequence: 4, kind: "WALK", walkingScope: "EGRESS", durationMinutes: 3, durationSeconds: 171 },
        ];
        const presentation = buildEffectiveTransitRoutePresentation(status);
        expect(presentation?.itinerary).toContain("접근 도보 · 약 1분 51초");
        expect(presentation?.itinerary).toContain("환승 도보 · 약 4분 3초");
        expect(presentation?.itinerary).toContain("도착 도보 · 약 2분 51초");
        expect(presentation?.summary).toContain("총 58분");
    });

    it("explains egress inclusion without treating coordinates as confirmed station coverage", () => {
        for (const routeChanged of [false, true]) {
            const status = departureStatus({ routeChanged });
            status.effectiveTransitRoute!.segments.push({
                sequence: 3, kind: "WALK", walkingScope: "EGRESS",
                durationMinutes: 3, durationSeconds: 171,
                walkingGeometry: {
                    from: { lat: 37.484, lng: 126.9295 },
                    to: { lat: 37.4842, lng: 126.9297 },
                    distanceMeters: 121,
                },
            });
            const original = JSON.stringify(status);
            const presentation = buildEffectiveTransitRoutePresentation(status);
            expect(presentation?.waitMeta).toContain("도착 도보는 총시간에 포함돼요");
            expect(presentation?.waitMeta).toContain("역 내부 이동 포함 범위는 확인되지 않았어요");
            expect(presentation?.summary).toBe("09:10 출발 · 10:08 도착 · 총 58분");
            expect(JSON.stringify(status)).toBe(original);
        }
    });

    it("shows original walking distance but does not recalculate ETA or infer platform coverage", () => {
        const status = departureStatus({ routeChanged: false });
        status.effectiveTransitRoute!.segments.push({
            sequence: 10, kind: "WALK", walkingScope: "EGRESS", durationMinutes: 3, durationSeconds: 171,
            walkingGeometry: { distanceMeters: 126, endpointBasis: "PROVIDER_LEG_ENDPOINTS",
                pathEvidence: { provider: "tmap", status: "PROVIDED", stationInteriorCoverage: "UNKNOWN", steps: [
                    { coordinates: [{ lat: 37.484, lng: 126.9295 }, { lat: 37.4842, lng: 126.9297 }],
                        distanceMeters: 126, description: "신림역 2번출구 경유" },
                ] } },
        });
        const input = JSON.stringify(status);
        const presentation = buildEffectiveTransitRoutePresentation(status);
        expect(presentation?.itinerary).toContain("도착 도보 · 약 2분 51초 · 126m");
        expect(presentation?.waitMeta).toContain("역 내부 이동 포함 범위는 확인되지 않았어요");
        expect(presentation?.summary).toContain("총 58분");
        expect(JSON.stringify(status)).toBe(input);
        for (const distance of [-1, NaN, 1.5, Infinity]) {
            status.effectiveTransitRoute!.segments.at(-1)!.walkingGeometry!.distanceMeters = distance;
            expect(buildEffectiveTransitRoutePresentation(status)?.itinerary).not.toContain(`${distance}m`);
        }
    });

    it("does not invent egress inclusion for legacy or absent walking scopes", () => {
        const status = departureStatus({ routeChanged: false });
        const walk = status.effectiveTransitRoute!.segments.find(segment => segment.kind === "WALK")!;
        for (const scope of [undefined, "UNKNOWN", "ACCESS", "TRANSFER"] as const) {
            walk.walkingScope = scope;
            expect(buildEffectiveTransitRoutePresentation(status)?.waitMeta).not.toContain("도착 도보는");
        }
        walk.walkingScope = "EGRESS";
        walk.durationMinutes = 0;
        expect(buildEffectiveTransitRoutePresentation(status)?.waitMeta).not.toContain("도착 도보는");
    });

    it("keeps unknown legacy walking generic and rejects contradictory or malformed seconds", () => {
        const status = departureStatus({ routeChanged: false });
        const walk = status.effectiveTransitRoute!.segments.find(segment => segment.kind === "WALK")!;
        for (const seconds of [null, undefined, -1, 31, 241, NaN, 200.5]) {
            walk.durationSeconds = seconds;
            walk.walkingScope = "UNKNOWN";
            expect(buildEffectiveTransitRoutePresentation(status)?.itinerary).toContain("도보 · 현재 위치→강남역 · 약 4분");
        }
        walk.durationMinutes = 0;
        walk.durationSeconds = 0;
        expect(buildEffectiveTransitRoutePresentation(status)?.itinerary).toContain("도보 · 현재 위치→강남역 · 약 0초");
    });

    it("keeps a conservative notification departure separate from the evaluated route departure", () => {
        const status = departureStatus({
            recommendedDepartureAt: "2026-11-15T10:30:00+09:00",
            predictedArrivalAt: "2026-11-15T11:34:30+09:00",
            travelMinutes: 64,
            routeChanged: false,
            effectiveTransitRoute: {
                ...departureStatus().effectiveTransitRoute!,
                departureAt: "2026-11-15T10:31:00+09:00",
                arrivalAt: "2026-11-15T11:34:30+09:00",
                totalMinutes: 64,
            },
        });

        expect(getFreshDepartureTiming(status)?.recommendedDepartureAt.toISOString()).toBe("2026-11-15T01:30:00.000Z");
        expect(buildEffectiveTransitRoutePresentation(status)).toMatchObject({
            summary: "10:31 경로 출발 · 11:34 도착 · 총 64분",
            compactSummary: "11:34 도착 예상",
        });
    });

    it("does not fabricate a corrected itinerary from an incomplete or inconsistent snapshot", () => {
        const status = departureStatus({ routeChanged: false });
        for (const route of [
            { ...status.effectiveTransitRoute!, totalMinutes: 65 },
            { ...status.effectiveTransitRoute!, segments: [] },
            { ...status.effectiveTransitRoute!, arrivalAt: "invalid" },
            { ...status.effectiveTransitRoute!, arrivalAt: status.effectiveTransitRoute!.departureAt },
        ]) {
            expect(buildEffectiveTransitRoutePresentation({ ...status, effectiveTransitRoute: route })).toBeUndefined();
        }
    });

    it("does not present corrected segments for stale or failed snapshots", () => {
        expect(buildEffectiveTransitRoutePresentation(departureStatus({ stale: true })))
            .toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(departureStatus({ routeChanged: false, failureReason: "PROVIDER_TIMEOUT" })))
            .toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(departureStatus({ effectiveTransitRoute: null })))
            .toBeUndefined();
    });
});

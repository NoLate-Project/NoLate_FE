import type { EffectiveTransitRideTiming, ScheduleDepartureStatus } from "../src/api/schedule";
import {
    buildEffectiveTransitRoutePresentation,
    buildFutureTimetablePredictionPresentation,
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

describe("effective transit route presentation", () => {
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
            futureTimetablePrediction: route });
        const preview = buildFutureTimetablePredictionPresentation(status)!;
        expect(preview.guidanceTitle).toBe("미래 시간표 예측 · 실시간 미확인");
        expect(preview.itinerary).toContain("2012열차 · 시간표");
        expect(preview.waitMeta).toContain("출발 알람은 기존 안전 시각을 유지");
        expect(getFreshDepartureTiming(status)).toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(status)).toBeUndefined();
        expect(buildFutureTimetablePredictionPresentation({ ...status, failureReason: "TRANSIT_ARRIVAL_API_ERROR: safe" })).toBeUndefined();
        expect(buildFutureTimetablePredictionPresentation({ ...status, futureTimetablePrediction: {
            ...route, segments: [{ ...route.segments[0], rideTiming: null }],
        } })).toBeUndefined();
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
    function statusWithTiming(timing: EffectiveTransitRideTiming | null = rideTiming()) {
        const status = departureStatus({ routeChanged: false });
        status.effectiveTransitRoute!.segments[0].rideTiming = timing;
        return status;
    }

    it("shows exact predicted ride clocks and distinguishes first boarding realtime from a future timetable", () => {
        const status = statusWithTiming();
        const result = buildEffectiveTransitRoutePresentation(status)!;
        expect(result.itinerary).toContain("2012열차 · 첫 승차 실시간 반영 · 09:30:13 승차 → 09:50:44 하차 예측");
        expect(result.itinerary).toContain("약 22분");
        expect(result.summary).toBe("09:10 출발 · 10:08 도착 · 총 58분");
        expect(buildEffectiveTransitRoutePresentation({ ...status, timeZone: "UTC" })!.itinerary)
            .toContain("00:30:13 승차 → 00:50:44 하차 예측");
        const table = rideTiming().timetable;
        const timetableResult = buildEffectiveTransitRoutePresentation(statusWithTiming({ timetable: table,
            predictedBoardingAt: table.boardingAt, predictedArrivalAt: table.arrivalAt, basis: "TIMETABLE" }))!;
        expect(timetableResult.itinerary).toContain("2012열차 · 시간표 · 09:30:00 승차 → 09:50:31 하차 예측");
        expect(timetableResult.itinerary).not.toContain("실시간 반영");
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
            .toContain(`${clock(rideTiming().predictedBoardingAt)} 승차 → ${clock(rideTiming().predictedArrivalAt)} 하차 예측`);
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
        const status = departureStatus({ routeChanged: false, recommendedDepartureAt: "2026-08-10T09:05:00+09:00" });
        expect(getFreshDepartureTiming(status)?.recommendedDepartureAt.toISOString()).toBe("2026-08-10T00:05:00.000Z");
        expect(buildEffectiveTransitRoutePresentation(status)?.summary).toContain("09:10 출발");
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

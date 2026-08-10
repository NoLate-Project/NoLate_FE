import type { ScheduleDepartureStatus } from "../src/api/schedule";
import {
    buildEffectiveTransitRoutePresentation,
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

    it("does not present a replacement route for unchanged or stale snapshots", () => {
        expect(buildEffectiveTransitRoutePresentation(departureStatus({ routeChanged: false })))
            .toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(departureStatus({ stale: true })))
            .toBeUndefined();
        expect(buildEffectiveTransitRoutePresentation(departureStatus({ effectiveTransitRoute: null })))
            .toBeUndefined();
    });
});

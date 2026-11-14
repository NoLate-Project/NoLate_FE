import {
    buildSavedRouteDetailInfo,
    getScheduleDetailLayout,
    getSavedRouteEntryPath,
    getSavedRouteSummaryKind,
    shouldRenderScheduleDetailMap,
} from "../src/modules/schedule/savedRouteDetailPresentation";
import type { RouteAlternativeOption } from "../src/modules/map/routingService";
import { buildRouteInfoFromAlternative } from "../src/modules/schedule/routeInfo";

const origin = { name: "서울시청", lat: 37.5666, lng: 126.9784 };
const destination = { name: "강남역", lat: 37.4979, lng: 127.0276 };

describe("saved route detail presentation", () => {
    test("uses source seconds when rebasing a saved display and no longer labels shifted clocks as timetable", () => {
        const option: RouteAlternativeOption = {
            id: "seconds", mode: "TRANSIT", source: "api", minutes: 3, totalDurationSeconds: 141,
            providerTimeBasis: "timetable", providerDepartureAt: "2026-11-15T00:00:00Z",
            providerArrivalAt: "2026-11-15T00:02:21Z",
        };
        const routeInfo = buildRouteInfoFromAlternative(option, origin, destination);
        const departureAt = new Date("2026-11-15T01:00:00Z");
        for (const routeAlternative of [undefined, option]) {
            const result = buildSavedRouteDetailInfo({ route: routeInfo, routeAlternative, departureAt });
            expect(result?.arrivalTime).toBe("2026-11-15T01:02:21.000Z");
            expect(result?.timeBasis).toBe("estimated");
        }
    });
    test("restores physical transfer walks without relabelling a waiting buffer", () => {
        const routeAlternative: RouteAlternativeOption = {
            id: "legacy-transfer", mode: "TRANSIT", source: "api", minutes: 17,
            transitLegs: [
                { kind: "SUBWAY", label: "4호선", durationMinutes: 7 },
                { kind: "WALK", label: "환승", durationSeconds: 180, distanceMeters: 120 },
                { kind: "ETC", label: "환승 대기", journeyPhase: "BUFFER", durationMinutes: 2 },
                { kind: "BUS", label: "361", durationMinutes: 5 },
            ],
        };
        const routeInfo = buildRouteInfoFromAlternative(routeAlternative, origin, destination);
        routeInfo.steps[2] = { ...routeInfo.steps[2], type: "TRANSFER", title: "환승", durationMinutes: undefined };
        const restored = buildSavedRouteDetailInfo({ route: { routeInfo }, routeAlternative, origin, destination });
        expect(restored?.steps[2]).toMatchObject({ type: "WALK", title: "도보", durationMinutes: 3, distanceMeters: 120 });
        expect(restored?.steps[3]).toMatchObject({ type: "TRANSFER", title: "환승 대기", durationMinutes: 2 });
    });
    test("불완전 경로를 병합하거나 출발 시각을 적용해도 누락된 시간 정보를 생성하지 않는다", () => {
        const route = { id: 'public-preview', mode: 'TRANSIT', transitLegs: [
            { kind: 'BUS', lineName: '7016', startName: '서울역', endName: '경복궁역' },
        ] };
        for (const routeAlternative of [undefined, route]) {
            const info = buildSavedRouteDetailInfo({ route,
                routeAlternative: routeAlternative as unknown as Parameters<typeof buildSavedRouteDetailInfo>[0]['routeAlternative'],
                departureAt: new Date('2026-10-07T04:00:00Z') });
            expect(info?.departureTime).toBe(''); expect(info?.arrivalTime).toBe('');
        }
    });
    test("distinguishes a detailed route from a duration-only estimate and an empty route", () => {
        expect(getSavedRouteSummaryKind(true, 32)).toBe("detailed");
        expect(getSavedRouteSummaryKind(false, 32)).toBe("duration_only");
        expect(getSavedRouteSummaryKind(false, 0)).toBe("none");
        expect(getSavedRouteSummaryKind(false, Number.NaN)).toBe("none");
    });

    test("경로 설정 화면을 닫은 뒤 저장된 경로가 없으면 일반 일정 상세를 표시한다", () => {
        expect(getScheduleDetailLayout({
            routeSummaryKind: "none",
            routeSetupRequired: true,
        })).toBe("plain");
        expect(getScheduleDetailLayout({
            routeSummaryKind: "none",
            routeSetupRequired: false,
        })).toBe("plain");
        expect(getScheduleDetailLayout({
            routeSummaryKind: "duration_only",
            routeSetupRequired: true,
        })).toBe("route");
        expect(getScheduleDetailLayout({
            routeSummaryKind: "detailed",
            routeSetupRequired: true,
        })).toBe("route");
    });

    test("opens the saved map only when detailed route endpoints are valid", () => {
        expect(getSavedRouteEntryPath(true, origin, destination)).toBe("/schedule/route-planner");
        expect(getSavedRouteEntryPath(false, origin, destination)).toBe("/schedule/route-select");
        expect(getSavedRouteEntryPath(true, origin, undefined)).toBe("/schedule/route-select");
        expect(getSavedRouteEntryPath(true, origin, { name: "잘못된 위치", lat: 120, lng: 127 }))
            .toBe("/schedule/route-select");
    });

    test("상세 경로와 실제 좌표가 모두 있을 때만 일정 상세 지도를 표시한다", () => {
        expect(shouldRenderScheduleDetailMap(true, 2)).toBe(true);
        expect(shouldRenderScheduleDetailMap(true, 1)).toBe(false);
        expect(shouldRenderScheduleDetailMap(true, 0)).toBe(false);
        expect(shouldRenderScheduleDetailMap(false, 2)).toBe(false);
        expect(shouldRenderScheduleDetailMap(false, 0)).toBe(false);
        expect(shouldRenderScheduleDetailMap(true, Number.NaN)).toBe(false);
        expect(shouldRenderScheduleDetailMap(true, -1)).toBe(false);
    });
});

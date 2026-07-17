import {
    getScheduleDetailLayout,
    getSavedRouteEntryPath,
    getSavedRouteSummaryKind,
    shouldRenderScheduleDetailMap,
} from "../src/modules/schedule/savedRouteDetailPresentation";

const origin = { name: "서울시청", lat: 37.5666, lng: 126.9784 };
const destination = { name: "강남역", lat: 37.4979, lng: 127.0276 };

describe("saved route detail presentation", () => {
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

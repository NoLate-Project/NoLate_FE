import {
    buildRouteSetupEntryRoute,
    isRouteSetupEntryRequested,
} from "../src/modules/schedule/routeSetupNavigation";

describe("route setup navigation", () => {
    test("미설정 안내는 상세 표시 요청이 아니라 경로 설정 자동 진입 요청을 전달한다", () => {
        expect(buildRouteSetupEntryRoute("schedule-42")).toEqual({
            pathname: "/schedule/[id]",
            params: {
                id: "schedule-42",
                openRouteSetup: "1",
            },
        });
    });

    test("명시적인 자동 진입 값만 경로 설정 요청으로 인정한다", () => {
        expect(isRouteSetupEntryRequested("1")).toBe(true);
        expect(isRouteSetupEntryRequested(["1"])).toBe(true);
        expect(isRouteSetupEntryRequested("0")).toBe(false);
        expect(isRouteSetupEntryRequested(undefined)).toBe(false);
    });
});

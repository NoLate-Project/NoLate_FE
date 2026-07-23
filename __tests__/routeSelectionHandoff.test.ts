import type { RouteAlternativeOption } from "../src/modules/map/routingService";
import { resolveRouteSelectionHandoff } from "../src/modules/schedule/routeSelectionHandoff";

function route(id: string, mode: RouteAlternativeOption["mode"]): RouteAlternativeOption {
    return {
        id,
        mode,
        minutes: 48,
        source: "api",
        provider: "tmap",
    };
}

describe("routeSelectionHandoff", () => {
    it("목록에서 선택한 경로를 상세 화면 정렬 순서와 무관하게 유지한다", () => {
        const selectedSubwayRoute = route("transit-4-subway", "TRANSIT");

        expect(resolveRouteSelectionHandoff(
            selectedSubwayRoute,
            "TRANSIT",
            "transit-4-subway"
        )).toBe(selectedSubwayRoute);
    });

    it("URL routeId 또는 이동수단이 다른 오래된 세션 경로는 거부한다", () => {
        const selectedSubwayRoute = route("transit-4-subway", "TRANSIT");

        expect(resolveRouteSelectionHandoff(selectedSubwayRoute, "TRANSIT", "transit-0-bus")).toBeUndefined();
        expect(resolveRouteSelectionHandoff(selectedSubwayRoute, "CAR", "transit-4-subway")).toBeUndefined();
    });

    it("불완전한 세션 값은 경로 객체로 취급하지 않는다", () => {
        expect(resolveRouteSelectionHandoff({ id: "route", mode: "TRANSIT" }, "TRANSIT")).toBeUndefined();
        expect(resolveRouteSelectionHandoff(undefined, "TRANSIT")).toBeUndefined();
    });
});

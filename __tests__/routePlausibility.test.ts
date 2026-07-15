import { assessRoutePlausibility } from "../src/modules/map/routePlausibility";
import type { RouteAlternativeOption } from "../src/modules/map/tmapApi";

const origin = { name: "잠실역", lat: 37.5133, lng: 127.1001 };
const destination = { name: "홍대입구역", lat: 37.5572, lng: 126.9254 };

function transit(distanceMeters: number): RouteAlternativeOption {
    return {
        id: `transit-${distanceMeters}`,
        mode: "TRANSIT",
        minutes: 45,
        distanceMeters,
        source: "api",
        provider: "tmap",
        pathCoords: [
            { lat: origin.lat, lng: origin.lng },
            { lat: destination.lat, lng: destination.lng },
        ],
    };
}

describe("route plausibility", () => {
    it("좌표계 오류에 가까운 극단적인 장거리 결과만 표시한다", () => {
        expect(assessRoutePlausibility(transit(58_000), origin, destination)).toMatchObject({
            status: "geometry_suspected",
            reason: "extreme_detour",
            routeDistanceMeters: 58_000,
        });
    });

    it("도시 철도망에서 발생하는 큰 우회도 공급자 정상 경로로 유지한다", () => {
        expect(assessRoutePlausibility(transit(28_700), origin, destination)?.status).toBe("normal");
    });

    it("경로 중간에 화면 bounds를 망가뜨릴 좌표 단절이 있으면 표시한다", () => {
        const option = transit(20_000);
        option.pathCoords = [
            { lat: origin.lat, lng: origin.lng },
            { lat: 38.1, lng: 127.7 },
            { lat: destination.lat, lng: destination.lng },
        ];
        expect(assessRoutePlausibility(option, origin, destination)).toMatchObject({
            status: "geometry_suspected",
            reason: "path_discontinuity",
        });
    });

    it("대중교통 외 모드에는 우회 판정을 적용하지 않는다", () => {
        expect(assessRoutePlausibility({ ...transit(58_000), mode: "CAR" }, origin, destination)).toBeUndefined();
    });
});

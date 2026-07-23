import { getStationTransferDisplayPath } from "../src/modules/map/stationTransferGeometry";

describe("stationTransferGeometry", () => {
    const sadangProviderPath = [
        { lat: 37.476808, lng: 126.981667 },
        { lat: 37.476728, lng: 126.981681 },
        { lat: 37.476564, lng: 126.981669 },
        { lat: 37.476603, lng: 126.981281 },
        { lat: 37.476783, lng: 126.981306 },
        { lat: 37.476975, lng: 126.981094 },
        { lat: 37.477097, lng: 126.981278 },
        { lat: 37.477119, lng: 126.981278 },
        { lat: 37.477031, lng: 126.981153 },
        { lat: 37.476956, lng: 126.981228 },
        { lat: 37.476822, lng: 126.981356 },
        { lat: 37.476747, lng: 126.981375 },
        { lat: 37.476567, lng: 126.981625 },
    ];

    it("동일 역사 내부의 왕복 환승 선형을 승하차 anchor 연결로 줄인다", () => {
        const result = getStationTransferDisplayPath({
            pathCoords: sadangProviderPath,
            startName: "사당",
            endName: "사당역",
            distanceMeters: 205,
            previousRideCoord: { lat: 37.476653, lng: 126.981658 },
            nextRideCoord: { lat: 37.476567, lng: 126.981625 },
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ lat: 37.476653, lng: 126.981658 });
        expect(result[result.length - 1]).toEqual({ lat: 37.476567, lng: 126.981625 });
    });

    it("서로 다른 정류장 사이의 실제 보행 선형은 유지한다", () => {
        const result = getStationTransferDisplayPath({
            pathCoords: sadangProviderPath,
            startName: "교대",
            endName: "교대역13번출구",
            distanceMeters: 205,
        });

        expect(result).toBe(sadangProviderPath);
    });

    it("동일 역이어도 우회가 없는 선형은 원본을 유지한다", () => {
        const directPath = [
            { lat: 37.5, lng: 127.0 },
            { lat: 37.5004, lng: 127.0 },
            { lat: 37.5008, lng: 127.0 },
        ];
        const result = getStationTransferDisplayPath({
            pathCoords: directPath,
            startName: "강남",
            endName: "강남",
            distanceMeters: 90,
        });

        expect(result).toBe(directPath);
    });
});

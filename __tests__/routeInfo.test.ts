import type { RouteAlternativeOption } from "../src/modules/map/tmapApi";
import {
    buildRouteInfoFromAlternative,
    buildRouteSummaryMetrics,
    compactTransitLineLabel,
    getRouteStepDirectionHint,
    isRouteInfo,
} from "../src/modules/schedule/routeInfo";

const origin = { name: "서울역", address: "서울 중구", lat: 37.5547, lng: 126.9706 };
const destination = { name: "홍대입구역", address: "서울 마포구", lat: 37.5572, lng: 126.9254 };

describe("routeInfo", () => {
    it("지도 배지에서 TMAP 버스 분류 접두사를 제거한다", () => {
        expect(compactTransitLineLabel("직행좌석:9007")).toBe("9007");
        expect(compactTransitLineLabel("간선:402")).toBe("402");
        expect(compactTransitLineLabel("수도권4호선")).toBe("4호선");
    });

    it("자동차 공급자 안내를 공통 상세 단계와 비용 정보로 보존한다", () => {
        const option: RouteAlternativeOption = {
            id: "car-0",
            mode: "CAR",
            minutes: 19,
            distanceMeters: 6126,
            tollFareWon: 1200,
            taxiFareWon: 11200,
            source: "api",
            provider: "tmap",
            guideSteps: [
                {
                    instruction: "교차로에서 우회전",
                    roadName: "한강대로",
                    durationMinutes: 2.5,
                    distanceMeters: 420,
                    coordinate: { lat: 37.555, lng: 126.97 },
                    pathCoords: [
                        { lat: 37.555, lng: 126.97 },
                        { lat: 37.556, lng: 126.965 },
                    ],
                },
                {
                    instruction: "양화로 방면으로 직진",
                    durationMinutes: 8,
                    distanceMeters: 2400,
                    pathCoords: [
                        { lat: 37.556, lng: 126.965 },
                        { lat: 37.557, lng: 126.94 },
                    ],
                },
            ],
        };

        const result = buildRouteInfoFromAlternative(
            option,
            origin,
            destination,
            new Date("2026-07-11T01:00:00.000Z")
        );

        expect(result.provider).toBe("tmap");
        expect(result.timeBasis).toBe("estimated");
        expect(result.steps.map((step) => step.type)).toEqual([
            "ORIGIN",
            "DRIVE",
            "DRIVE",
            "DESTINATION",
        ]);
        expect(result.steps[1]).toMatchObject({
            title: "교차로에서 우회전",
            distanceMeters: 420,
        });
        expect(buildRouteSummaryMetrics(result).map((item) => item.label)).toEqual(expect.arrayContaining([
            "통행료 1,200원",
            "택시 예상 11,200원",
            "총 6.1km",
        ]));
    });

    it("자전거 경로는 자전거 단계 타입을 사용한다", () => {
        const option: RouteAlternativeOption = {
            id: "bike-0",
            mode: "BIKE",
            minutes: 24,
            distanceMeters: 7100,
            source: "api",
            provider: "openstreetmap",
            guideSteps: [{
                instruction: "자전거도로 따라 계속 이동",
                distanceMeters: 1800,
            }],
        };

        const result = buildRouteInfoFromAlternative(option, origin, destination);
        expect(result.steps[1]).toMatchObject({
            type: "BIKE",
            title: "자전거도로 따라 계속 이동",
        });
    });

    it("timeBasis가 없는 기존 저장 경로도 읽을 수 있다", () => {
        expect(isRouteInfo({
            id: "legacy",
            originName: "출발",
            destinationName: "도착",
            totalDurationMinutes: 10,
            departureTime: "2026-07-11T01:00:00.000Z",
            arrivalTime: "2026-07-11T01:10:00.000Z",
            steps: [],
        })).toBe(true);
    });

    it("ODsay가 제공한 운행 시각과 공급자 정보를 상세 경로에 보존한다", () => {
        const option: RouteAlternativeOption = {
            id: "odsay-transit",
            mode: "TRANSIT",
            minutes: 31,
            source: "api",
            provider: "odsay",
            providerDepartureAt: "2026-07-15T13:06:00.000Z",
            providerArrivalAt: "2026-07-15T13:37:00.000Z",
            transitLegs: [],
        };

        const result = buildRouteInfoFromAlternative(option, origin, destination);

        expect(result).toMatchObject({
            provider: "odsay",
            departureTime: "2026-07-15T13:06:00.000Z",
            arrivalTime: "2026-07-15T13:37:00.000Z",
            timeBasis: "provider_schedule",
        });
    });

    it("구간 도착역을 행선지로 오인하지 않고 다음 통과역을 방향으로 표시한다", () => {
        expect(getRouteStepDirectionHint({
            id: "subway-4",
            type: "SUBWAY",
            title: "서울역",
            description: "사당까지 · 8정거장 · 16분",
            passStops: [
                { name: "서울역" },
                { name: "숙대입구역" },
                { name: "삼각지역" },
            ],
        }, "사당까지 · 8정거장 · 16분")).toBe("숙대입구역 방향");

        expect(getRouteStepDirectionHint({
            id: "subway-2",
            type: "SUBWAY",
            title: "사당역",
            description: "강남역까지 · 5정거장",
        }, "강남역까지 · 5정거장")).toBe("강남역까지");
    });

    it("공급자가 제공한 승차 안내를 상세 단계까지 보존한다", () => {
        const option: RouteAlternativeOption = {
            id: "bus-platform",
            mode: "TRANSIT",
            minutes: 18,
            source: "api",
            provider: "tmap",
            transitLegs: [{
                kind: "BUS",
                label: "402",
                lineName: "402",
                startName: "서울역버스환승센터(6번승강장)(중)",
                endName: "남산도서관",
                boardingPlatform: "6번 승강장",
                boardingExit: "4번 출구",
                recommendedBoardingPosition: "앞문 가까이",
            }],
        };

        const result = buildRouteInfoFromAlternative(option, origin, destination);
        expect(result.steps[1]).toMatchObject({
            type: "BUS",
            boardingPlatform: "6번 승강장",
            boardingExit: "4번 출구",
            recommendedBoardingPosition: "앞문 가까이",
        });
    });
});

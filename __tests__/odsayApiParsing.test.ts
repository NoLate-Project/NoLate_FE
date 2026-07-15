jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import { parseTransitOptionsFromOdsay } from "../src/modules/map/odsayApi";

describe("ODsay multimodal transit parser", () => {
    test("keeps provider schedule, exact geometry, stop IDs, and fast-transfer position", () => {
        const result = parseTransitOptionsFromOdsay({
            result: {
                paths: [{
                    pathType: 2,
                    totalTime: 35,
                    totalDistance: 12_300,
                    totalPayment: 1_550,
                    startDateTime: "202607141200",
                    endDateTime: "202607141235",
                    rps: [
                        {
                            trafficType: 3,
                            duration: 6,
                            distance: 310,
                            routes: [{
                                rseq: 1,
                                crossXYInfos: [
                                    { x: 126.9723, y: 37.5559 },
                                    { x: 126.97231, y: 37.55589 },
                                ],
                                xyInfos: [
                                    { x: 126.97231, y: 37.55589 },
                                    { x: 126.9725, y: 37.5557 },
                                ],
                            }],
                        },
                        {
                            trafficType: 1,
                            duration: 16,
                            distance: 7_800,
                            startID: 426,
                            startName: "서울역",
                            startX: 126.9726,
                            startY: 37.5547,
                            endID: 433,
                            endName: "사당",
                            endX: 126.9816,
                            endY: 37.4768,
                            way: "사당",
                            wayCode: 2,
                            door: "1-1",
                            startExitNo: "4",
                            graph: "126.9726 37.5547|126.9816 37.4768",
                            lane: [{ name: "수도권 4호선", subwayCode: 4 }],
                            passStopList: {
                                stations: [
                                    { index: 0, stationID: 426, stationName: "서울역", x: 126.9726, y: 37.5547 },
                                    { index: 1, stationID: 433, stationName: "사당", x: 126.9816, y: 37.4768 },
                                ],
                            },
                        },
                        { trafficType: 3, duration: 3, distance: 120, routes: [] },
                        {
                            trafficType: 1,
                            duration: 9,
                            distance: 4_000,
                            startID: 226,
                            startName: "사당",
                            startX: 126.9816,
                            startY: 37.4768,
                            endID: 222,
                            endName: "강남",
                            endX: 127.0276,
                            endY: 37.4979,
                            way: "강남",
                            wayCode: 1,
                            door: "",
                            graph: "126.9816 37.4768|127.0276 37.4979",
                            lane: [{ name: "수도권 2호선", subwayCode: 2 }],
                        },
                        { trafficType: 3, duration: 1, distance: 40, routes: [] },
                    ],
                }],
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            minutes: 35,
            fareWon: 1_550,
            transferCount: 1,
            walkMeters: 470,
            provider: "odsay",
            providerDepartureAt: "2026-07-14T03:00:00.000Z",
            providerArrivalAt: "2026-07-14T03:35:00.000Z",
        });
        expect(result[0].transitLegs?.[0]).toMatchObject({
            kind: "WALK",
            pathCoordsIsExact: true,
            pathGeometrySource: "WALK_STEPS_LINESTRING",
        });
        expect(result[0].transitLegs?.[1]).toMatchObject({
            kind: "SUBWAY",
            lineName: "수도권 4호선",
            directionName: "사당",
            directionCode: "DOWN",
            boardingExit: "4번 출구",
            recommendedBoardingPosition: "1-1",
            recommendedTransferPosition: "1-1",
            pathCoordsIsExact: true,
        });
        expect(result[0].transitLegs?.[3]).toMatchObject({
            directionCode: "UP",
            recommendedBoardingPosition: undefined,
            recommendedTransferPosition: undefined,
        });
    });

    test("preserves ODsay bus ARS and provider line color for realtime arrival lookup", () => {
        const [option] = parseTransitOptionsFromOdsay({
            result: {
                paths: [{
                    pathType: 2,
                    totalTime: 20,
                    totalDistance: 5_000,
                    totalPayment: 1_500,
                    rps: [{
                        trafficType: 2,
                        duration: 18,
                        distance: 4_800,
                        startName: "서울역버스환승센터(5번승강장)",
                        startX: 126.9726,
                        startY: 37.5552,
                        endName: "강남역",
                        endX: 127.0276,
                        endY: 37.4979,
                        graph: "126.9726 37.5552|127.0276 37.4979",
                        lane: [{ busNo: "402", busLaneColor: "#3952fb" }],
                        passStopList: {
                            stations: [
                                {
                                    index: 0,
                                    stationName: "서울역버스환승센터(5번승강장)",
                                    arsID: "02005",
                                    x: 126.9726,
                                    y: 37.5552,
                                },
                                { index: 1, stationName: "강남역", arsID: "22009", x: 127.0276, y: 37.4979 },
                            ],
                        },
                    }],
                }],
            },
        });

        expect(option.transitLegs?.[0]).toMatchObject({
            kind: "BUS",
            lineName: "402",
            lineColor: "#3952FB",
            boardingPlatform: "5번 승강장",
        });
        expect(option.transitLegs?.[0].passStops?.[0].code).toBe("ARS:02005");
    });
});

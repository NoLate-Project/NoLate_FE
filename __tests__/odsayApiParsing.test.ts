jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import { parseTransitOptionsFromOdsay } from "../src/modules/map/odsayApi";

type ParsedCoord = { lat: number; lng: number };

function pathLengthMeters(coords: ParsedCoord[] | undefined): number {
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    const earthRadiusMeters = 6_371_000;
    const toRadians = Math.PI / 180;
    return coords.slice(1).reduce((total, coord, index) => {
        const previous = coords[index];
        const startLat = previous.lat * toRadians;
        const endLat = coord.lat * toRadians;
        const deltaLat = (coord.lat - previous.lat) * toRadians;
        const deltaLng = (coord.lng - previous.lng) * toRadians;
        const haversine = (
            Math.sin(deltaLat / 2) ** 2 +
            Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2
        );
        return total + (2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine))));
    }, 0);
}

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

    test("assembles first and last WALK terminal connectors without tail loops", () => {
        const origin = { x: 126.9, y: 37.5 };
        const firstLinkStart = { x: 126.9001, y: 37.5 };
        const firstLinkMiddle = { x: 126.9002, y: 37.5 };
        const firstLinkEnd = { x: 126.9003, y: 37.5 };
        const firstStation = { x: 126.9004, y: 37.5 };
        const lastStation = { x: 126.91, y: 37.5 };
        const lastLinkStart = { x: 126.9101, y: 37.5 };
        const lastLinkMiddle = { x: 126.9102, y: 37.5 };
        const lastLinkEnd = { x: 126.9103, y: 37.5 };
        const destination = { x: 126.9104, y: 37.5 };

        const [option] = parseTransitOptionsFromOdsay({
            result: {
                paths: [{
                    pathType: 2,
                    totalTime: 20,
                    totalDistance: 1_200,
                    totalPayment: 1_500,
                    rps: [
                        {
                            trafficType: 3,
                            duration: 4,
                            distance: 38,
                            // Recording-shaped fixture: terminal cross exists only on the
                            // first and last route, while an intermediate link is reversed.
                            routes: [
                                {
                                    rseq: 3,
                                    crossXYInfos: [firstLinkEnd, firstStation],
                                    xyInfos: [firstLinkMiddle, firstLinkEnd],
                                },
                                {
                                    rseq: 1,
                                    crossXYInfos: [origin, firstLinkStart],
                                    xyInfos: [firstLinkStart, firstLinkMiddle],
                                },
                                {
                                    rseq: 2,
                                    xyInfos: [firstLinkEnd, firstLinkMiddle],
                                },
                            ],
                        },
                        {
                            trafficType: 1,
                            duration: 12,
                            distance: 1_100,
                            startName: "첫역",
                            startX: firstStation.x,
                            startY: firstStation.y,
                            endName: "마지막역",
                            endX: lastStation.x,
                            endY: lastStation.y,
                            graph: `${firstStation.x} ${firstStation.y}|${lastStation.x} ${lastStation.y}`,
                            lane: [{ name: "테스트선" }],
                        },
                        {
                            trafficType: 3,
                            duration: 4,
                            distance: 38,
                            routes: [
                                {
                                    rseq: 1,
                                    crossXYInfos: [lastStation, lastLinkStart],
                                    xyInfos: [lastLinkStart, lastLinkMiddle],
                                },
                                {
                                    rseq: 2,
                                    xyInfos: [lastLinkEnd, lastLinkMiddle],
                                },
                                {
                                    rseq: 3,
                                    crossXYInfos: [lastLinkEnd, destination],
                                    xyInfos: [lastLinkMiddle, lastLinkEnd],
                                },
                            ],
                        },
                    ],
                }],
            },
        });

        const firstWalkPath = option.transitLegs?.[0].pathCoords;
        const lastWalkPath = option.transitLegs?.[2].pathCoords;
        expect(firstWalkPath).toEqual([
            { lat: origin.y, lng: origin.x },
            { lat: firstLinkStart.y, lng: firstLinkStart.x },
            { lat: firstLinkMiddle.y, lng: firstLinkMiddle.x },
            { lat: firstLinkEnd.y, lng: firstLinkEnd.x },
            { lat: firstStation.y, lng: firstStation.x },
        ]);
        expect(lastWalkPath).toEqual([
            { lat: lastStation.y, lng: lastStation.x },
            { lat: lastLinkStart.y, lng: lastLinkStart.x },
            { lat: lastLinkMiddle.y, lng: lastLinkMiddle.x },
            { lat: lastLinkEnd.y, lng: lastLinkEnd.x },
            { lat: destination.y, lng: destination.x },
        ]);
        expect(firstWalkPath?.filter((coord) => coord.lng === firstStation.x)).toHaveLength(1);
        expect(lastWalkPath?.filter((coord) => coord.lng === destination.x)).toHaveLength(1);
        expect(pathLengthMeters(firstWalkPath)).toBeLessThan(38 * 1.2);
        expect(pathLengthMeters(lastWalkPath)).toBeLessThan(38 * 1.2);
    });

    test("orients a single route from start to end and tolerates missing cross or link coordinates", () => {
        const [option] = parseTransitOptionsFromOdsay({
            result: {
                paths: [{
                    pathType: 2,
                    totalTime: 3,
                    totalDistance: 60,
                    rps: [
                        {
                            trafficType: 3,
                            duration: 1,
                            distance: 20,
                            startX: 126.92,
                            startY: 37.5,
                            endX: 126.9202,
                            endY: 37.5,
                            routes: [{
                                rseq: 1,
                                crossXYInfos: [
                                    { x: 126.9201, y: 37.5 },
                                    { x: 126.92, y: 37.5 },
                                ],
                                xyInfos: [
                                    { x: 126.9202, y: 37.5 },
                                    { x: 126.9201, y: 37.5 },
                                ],
                            }],
                        },
                        {
                            trafficType: 3,
                            duration: 1,
                            distance: 20,
                            startX: 126.93,
                            startY: 37.5,
                            endX: 126.9302,
                            endY: 37.5,
                            routes: [{
                                rseq: 1,
                                xyInfos: [
                                    { x: 126.9302, y: 37.5 },
                                    { x: 126.93, y: 37.5 },
                                ],
                            }],
                        },
                        {
                            trafficType: 3,
                            duration: 1,
                            distance: 20,
                            startX: 126.94,
                            startY: 37.5,
                            endX: 126.9402,
                            endY: 37.5,
                            routes: [{
                                rseq: 1,
                                crossXYInfos: [
                                    { x: 126.9402, y: 37.5 },
                                    { x: 126.94, y: 37.5 },
                                ],
                            }],
                        },
                    ],
                }],
            },
        });

        expect(option.transitLegs?.map((leg) => leg.pathCoords)).toEqual([
            [
                { lat: 37.5, lng: 126.92 },
                { lat: 37.5, lng: 126.9201 },
                { lat: 37.5, lng: 126.9202 },
            ],
            [
                { lat: 37.5, lng: 126.93 },
                { lat: 37.5, lng: 126.9302 },
            ],
            [
                { lat: 37.5, lng: 126.94 },
                { lat: 37.5, lng: 126.9402 },
            ],
        ]);
    });
});

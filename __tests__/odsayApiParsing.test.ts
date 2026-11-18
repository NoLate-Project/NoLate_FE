jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import { parseTransitOptionsFromOdsay } from "../src/modules/map/odsayApi";
import { buildRouteInfoFromAlternative } from "../src/modules/schedule/routeInfo";

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
    test("keeps verified walking seconds through the bus route's stored estimate", () => {
        const link = {
            rseq: 1, LENGTH: 173, DURATION: 157,
            xyInfos: [{ x: 127.027619, y: 37.497952 }, { x: 127.029322, y: 37.498243 }],
        };
        const parse = (walkLink: Record<string, unknown>, endDateTime = "202611152235") =>
            parseTransitOptionsFromOdsay({ result: { paths: [{
                pathType: 2, totalTime: 15, startDateTime: "202611152220", endDateTime,
                rps: [
                    { trafficType: 3, duration: 3, distance: 173, routes: [walkLink] },
                    { trafficType: 2, duration: 6, lane: [{ busNo: "360", busID: 1440 }] },
                    { trafficType: 3, duration: 6 },
                ],
            }] } })[0];
        const option = parse(link);
        expect(option).toMatchObject({ minutes: 15, totalDurationSeconds: 877, providerTimeBasis: "route_estimate" });
        expect(option.transitLegs?.[0]?.durationSeconds).toBe(157);
        const info = buildRouteInfoFromAlternative({ ...option, mode: "TRANSIT" }, undefined, undefined);
        expect(info).toMatchObject({ totalDurationSeconds: 877, timeBasis: "estimated",
            departureTime: "2026-11-15T13:20:00.000Z", arrivalTime: "2026-11-15T13:34:37.000Z" });
        expect(info.steps.find(step => step.type === "WALK")?.durationSeconds).toBe(157);

        for (const invalid of [
            { ...link, crossXYInfos: link.xyInfos },
            { ...link, DURATION: null },
            { ...link, xyInfos: [{ x: null, y: 37.497952 }, link.xyInfos[1]] },
            { ...link, LENGTH: 172 },
        ]) {
            const unverified = parse(invalid);
            expect(unverified.transitLegs?.[0]?.durationSeconds).toBeUndefined();
            expect(unverified.totalDurationSeconds).toBeUndefined();
        }
        expect(parse(link, "202611152234").totalDurationSeconds).toBeUndefined();
    });

    test("uses the next bus lane when ODsay labels the first as weekday only on Sunday", () => {
        const restricted = { busNo: "8146(새벽맞춤버스.평일운행)", busID: 2822539 };
        const normal = { busNo: "360", busID: 1440 };
        const parse = (start: string, end: string, lane: Array<typeof restricted>) =>
            parseTransitOptionsFromOdsay({ result: { paths: [{ pathType: 2, totalTime: 6,
                startDateTime: start, endDateTime: end,
                rps: [{ trafficType: 2, duration: 6, startDateTime: start, endDateTime: end, lane }],
            }] } });
        expect(parse("202611152223", "202611152229", [restricted, normal])[0]?.transitLegs?.[0])
            .toMatchObject({ lineName: "360", providerRouteId: "1440" });
        expect(parse("202611152223", "202611152229", [restricted, normal])[0]?.transitLegs?.[0]?.serviceAvailable)
            .toBeUndefined();
        expect(parse("202611152223", "202611152229", [restricted])).toEqual([]);
        for (const [start, end] of [
            ["202611150130", "202611150136"],
            ["202611152357", "202611160003"],
            ["202611160450", "202611160456"],
        ]) {
            expect(parse(start, end, [restricted, normal])[0]?.transitLegs?.[0]?.providerRouteId).toBe("2822539");
        }
    });

    test("keeps provider estimated times, exact geometry, stop IDs, and fast-transfer position", () => {
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
                            waitingTime: 4,
                            distance: 7_800,
                            startDateTime: "202607141206",
                            endDateTime: "202607141222",
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
                            lane: [{ name: "수도권 4호선", subwayCode: 4, subwayCityCode: 1000 }],
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
            providerTimeBasis: "route_estimate",
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
            serviceClass: "LOCAL",
            directionName: "사당",
            directionCode: "DOWN",
            waitingMinutes: 4,
            providerRouteId: "1000:4",
            routeCityCode: "1000",
            startDateTime: "2026-07-14T03:06:00.000Z",
            endDateTime: "2026-07-14T03:22:00.000Z",
            startID: "426",
            endID: "433",
            boardingExit: "4번 출구",
            recommendedBoardingPosition: "1-1",
            recommendedTransferPosition: "1-1",
            pathCoordsIsExact: true,
        });
        expect(result[0].transitLegs?.[3]).toMatchObject({
            directionCode: "UP",
            serviceClass: "LOCAL",
            recommendedBoardingPosition: undefined,
            recommendedTransferPosition: undefined,
        });
        // maasRP 시각/경로가 존재해도 차량 운행 여부나 확정 시간표로 승격하지 않는다.
        expect(result[0].transitLegs?.[1].serviceAvailable).toBeUndefined();
        expect(result[0].transitLegs?.[3].serviceAvailable).toBeUndefined();
    });

    test("preserves stations without certifying a subway graph with a missing point", () => {
        const [option] = parseTransitOptionsFromOdsay({
            result: { paths: [{ pathType: 2, totalTime: 16, rps: [{
                trafficType: 1,
                duration: 16,
                graph: "126.972713 37.553514|missing-point|126.974396 37.522427|126.981668 37.476798",
                passStopList: { stations: [
                    { index: 0, stationName: "서울역", x: 126.972713, y: 37.553514 },
                    { index: 1, stationName: "이촌역", x: 126.974396, y: 37.522427 },
                    { index: 2, stationName: "사당역", x: 126.981668, y: 37.476798 },
                ] },
            }] }] },
        });
        const leg = option.transitLegs?.[0];
        expect(leg).toMatchObject({
            pathGeometrySource: "PASS_STOP_LIST",
            pathCoordsIsExact: false,
            navigationEvidence: { geometryInputComplete: false },
        });
        expect(leg?.passStops?.map(stop => stop.name)).toEqual(["서울역", "이촌역", "사당역"]);
    });

    test("persists ODsay express markers and classifies non-express named subway legs as local", () => {
        const [option] = parseTransitOptionsFromOdsay({
            result: {
                paths: [{
                    pathType: 2,
                    totalTime: 20,
                    rps: [
                        {
                            trafficType: 1,
                            duration: 10,
                            startName: "여의도",
                            endName: "김포공항",
                            lane: [{ name: "수도권 9호선(급행)", subwayCode: 9, subwayCityCode: 1000 }],
                        },
                        {
                            trafficType: 1,
                            duration: 10,
                            startName: "김포공항",
                            endName: "개화",
                            lane: [{ name: "수도권 9호선(일반)", subwayCode: 9, subwayCityCode: 1000 }],
                        },
                        {
                            trafficType: 1,
                            duration: 10,
                            startName: "시청",
                            endName: "을지로입구",
                            lane: [{ name: "수도권 2호선", subwayCode: 2, subwayCityCode: 1000 }],
                        },
                        {
                            trafficType: 1,
                            duration: 10,
                            startName: "A",
                            endName: "B",
                            lane: [{ name: "9호선(급행)(일반)", subwayCode: 9, subwayCityCode: 1000 }],
                        },
                        {
                            trafficType: 1,
                            duration: 10,
                            startName: "B",
                            endName: "C",
                            lane: [{ subwayCode: 2, subwayCityCode: 1000 }],
                        },
                    ],
                }],
            },
        });

        expect(option.transitLegs?.map((leg) => leg.serviceClass)).toEqual([
            "EXPRESS",
            "LOCAL",
            "LOCAL",
            "UNKNOWN",
            "UNKNOWN",
        ]);
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
                        startDateTime: "202607141210",
                        endDateTime: "202607141228",
                        startID: 10001,
                        startLocalStationID: "SEOUL_NODE_02005",
                        startStationCityCode: 11,
                        startStationProviderCode: 100,
                        startArsID: "02005",
                        startName: "서울역버스환승센터(5번승강장)",
                        startX: 126.9726,
                        startY: 37.5552,
                        endID: 10002,
                        endLocalStationID: "SEOUL_NODE_22009",
                        endStationCityCode: 11,
                        endStationProviderCode: 100,
                        endArsID: "22009",
                        endName: "강남역",
                        endX: 127.0276,
                        endY: 37.4979,
                        graph: "126.9726 37.5552|127.0276 37.4979",
                        lane: [{
                            busNo: "402",
                            busID: 12345,
                            busLocalBlID: "SEOUL_ROUTE_402",
                            busCityCode: 11,
                            busProviderCode: 100,
                            busLaneColor: "#3952fb",
                        }],
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
            providerRouteId: "12345",
            localRouteId: "SEOUL_ROUTE_402",
            routeCityCode: "11",
            routeProviderCode: "100",
            startDateTime: "2026-07-14T03:10:00.000Z",
            endDateTime: "2026-07-14T03:28:00.000Z",
            startID: "10001",
            startLocalStationID: "SEOUL_NODE_02005",
            startStationCityCode: "11",
            startStationProviderCode: "100",
            startArsID: "02005",
            endID: "10002",
            endLocalStationID: "SEOUL_NODE_22009",
            endStationCityCode: "11",
            endStationProviderCode: "100",
            endArsID: "22009",
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

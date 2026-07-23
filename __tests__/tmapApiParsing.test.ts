jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import { parseTmapRoadRouteResponse, parseTransitOptionsFromTmap } from "../src/modules/map/tmapApi";

describe("TMAP road response parser", () => {
    test("keeps provider guidance, traffic, and fare fields", () => {
        const result = parseTmapRoadRouteResponse({
            type: "FeatureCollection",
            features: [
                {
                    geometry: { type: "Point", coordinates: [126.9706, 37.5547] },
                    properties: {
                        totalDistance: 6126,
                        totalTime: 1140,
                        totalFare: 1200,
                        taxiFare: 11200,
                        description: "출발지",
                    },
                },
                {
                    geometry: {
                        type: "LineString",
                        coordinates: [[126.9706, 37.5547], [126.965, 37.555]],
                        traffic: [[0, 1, 1, 31]],
                    },
                    properties: {
                        name: "한강대로",
                        description: "한강대로를 따라 이동",
                        distance: 420,
                        time: 150,
                    },
                },
                {
                    geometry: { type: "Point", coordinates: [126.965, 37.555] },
                    properties: {
                        description: "교차로에서 우회전",
                        nextRoadName: "양화로",
                        turnType: 13,
                    },
                },
                {
                    geometry: {
                        type: "LineString",
                        coordinates: [[126.965, 37.555], [126.94, 37.557]],
                        traffic: [[0, 1, 3, 9]],
                    },
                    properties: {
                        name: "양화로",
                        distance: 2400,
                        time: 480,
                    },
                },
                {
                    geometry: { type: "Point", coordinates: [126.9254, 37.5572] },
                    properties: { description: "도착지" },
                },
            ],
        });

        expect(result).toMatchObject({
            minutes: 19,
            distanceMeters: 6126,
            tollFareWon: 1200,
            taxiFareWon: 11200,
        });
        expect(result.guideSteps).toHaveLength(2);
        expect(result.guideSteps?.[0]).toMatchObject({
            instruction: "한강대로를 따라 이동",
            roadName: "한강대로",
            distanceMeters: 420,
        });
        expect(result.guideSteps?.[1]).toMatchObject({
            instruction: "교차로에서 우회전",
            roadName: "양화로",
            turnType: "13",
        });
        expect(result.trafficSections?.map((section) => section.level)).toEqual([
            "smooth",
            "congested",
        ]);
    });
});

describe("TMAP transit response parser", () => {
    test("keeps Lane route metadata and service availability", () => {
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 900,
                        totalDistance: 3_100,
                        transferCount: 0,
                        totalWalkDistance: 200,
                        legs: [{
                            mode: "BUS",
                            service: 0,
                            distance: 2_900,
                            sectionTime: 700,
                            direction: "양재역 방면",
                            Lane: [{ route: "간선:542", routeColor: "0068B7", service: 0 }],
                            passStopList: {
                                stationList: [
                                    { stationName: "강남역", lon: "127.02569", lat: "37.50172" },
                                    { stationName: "양재역", lon: "127.03462", lat: "37.48365" },
                                ],
                            },
                            passShape: {
                                linestring: "127.02569,37.50172 127.03462,37.48365",
                            },
                        }],
                    }],
                },
            },
        });

        expect(result[0].transitLegs?.[0]).toMatchObject({
            lineName: "간선:542",
            lineColor: "#0068B7",
            directionName: "양재역 방면",
            serviceAvailable: false,
            durationMinutes: 12,
        });
        expect(result[0].minutes).toBe(15);
    });

    test("preserves provider boarding guidance without inventing missing fields", () => {
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 900,
                        legs: [{
                            mode: "BUS",
                            sectionTime: 700,
                            start: { entranceName: "4번 출구" },
                            recommendedBoardingPosition: "앞문 가까이",
                            Lane: [{ route: "402" }],
                            passStopList: {
                                stationList: [
                                    { index: 0, stationName: "서울역버스환승센터(6번승강장)(중)" },
                                    { index: 1, stationName: "후암약수터" },
                                ],
                            },
                        }],
                    }],
                },
            },
        });

        expect(result[0].transitLegs?.[0]).toMatchObject({
            boardingPlatform: "6번 승강장",
            boardingExit: "4번 출구",
            recommendedBoardingPosition: "앞문 가까이",
        });
    });

    test("sorts shuffled pass stops by the provider sequence before deriving endpoints", () => {
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 1_200,
                        legs: [{
                            mode: "BUS",
                            sectionTime: 900,
                            Lane: [{ route: "N64" }],
                            passStopList: {
                                stationList: [
                                    { index: 2, stationName: "도착 정류장", lon: "126.9900", lat: "37.4900" },
                                    { index: 0, stationName: "승차 정류장", lon: "126.9700", lat: "37.4700" },
                                    { index: 1, stationName: "중간 정류장", lon: "126.9800", lat: "37.4800" },
                                ],
                            },
                        }],
                    }],
                },
            },
        });

        const leg = result[0].transitLegs?.[0];
        expect(leg?.startName).toBe("승차 정류장");
        expect(leg?.endName).toBe("도착 정류장");
        expect(leg?.passStops?.map((stop) => stop.name)).toEqual([
            "승차 정류장",
            "중간 정류장",
            "도착 정류장",
        ]);
        expect(leg?.startCoord).toEqual({ lat: 37.47, lng: 126.97 });
        expect(leg?.endCoord).toEqual({ lat: 37.49, lng: 126.99 });
    });

    test("does not promote a pass-stop-only line to itinerary geometry", () => {
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 1_200,
                        legs: [{
                            mode: "BUS",
                            sectionTime: 900,
                            Lane: [{ route: "402" }],
                            passStopList: {
                                stationList: [
                                    { index: 0, stationName: "서울역", lon: "126.9700", lat: "37.5540" },
                                    { index: 1, stationName: "후암동", lon: "126.9800", lat: "37.5500" },
                                    { index: 2, stationName: "남산도서관", lon: "126.9900", lat: "37.5460" },
                                ],
                            },
                        }],
                    }],
                },
            },
        });

        expect(result[0].pathCoords).toHaveLength(3);
        expect(result[0].transitLegs?.[0]).toMatchObject({
            pathCoordsIsExact: false,
            pathGeometrySource: "PASS_STOP_LIST",
            rawPathPointCount: 3,
        });
    });

    test("uses an explicit itinerary path as coarse provider geometry when a leg shape is absent", () => {
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 1_200,
                        path: "126.9700,37.5540 126.9750,37.5520 126.9800,37.5500 126.9900,37.5460",
                        legs: [{
                            mode: "BUS",
                            sectionTime: 900,
                            start: { name: "서울역", lon: "126.9700", lat: "37.5540" },
                            end: { name: "남산도서관", lon: "126.9900", lat: "37.5460" },
                            Lane: [{ route: "402" }],
                        }],
                    }],
                },
            },
        });

        expect(result[0].transitLegs?.[0]).toMatchObject({
            pathCoordsIsExact: false,
            pathGeometrySource: "ITINERARY_PATH_SNAP",
            rawPathPointCount: 4,
        });
    });

    test("treats sub-1000 totalTime values as seconds", () => {
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 873,
                        legs: [{
                            mode: "SUBWAY",
                            sectionTime: 473,
                            distance: 2_000,
                            start: { name: "강남역", lon: 127.0276, lat: 37.4979 },
                            end: { name: "역삼역", lon: 127.0365, lat: 37.5006 },
                            passShape: {
                                linestring: "127.0276,37.4979 127.0365,37.5006",
                            },
                        }],
                    }],
                },
            },
        });

        expect(result[0].minutes).toBe(15);
        expect(result[0].transitLegs?.[0].durationMinutes).toBe(8);
    });

    test("preserves a WALK passShape when TMAP omits transfer steps", () => {
        const transferShape = [
            "126.981667,37.476808",
            "126.981281,37.476603",
            "126.981094,37.476975",
            "126.981625,37.476567",
        ].join(" ");
        const result = parseTransitOptionsFromTmap({
            metaData: {
                plan: {
                    itineraries: [{
                        totalTime: 1_200,
                        legs: [{
                            mode: "WALK",
                            sectionTime: 243,
                            distance: 205,
                            start: { name: "사당", lon: 126.981667, lat: 37.476808 },
                            end: { name: "사당", lon: 126.981625, lat: 37.476567 },
                            passShape: { linestring: transferShape },
                        }],
                    }],
                },
            },
        });

        expect(result[0].transitLegs?.[0]).toMatchObject({
            kind: "WALK",
            pathCoordsIsExact: true,
            pathGeometrySource: "WALK_PASS_SHAPE_LINESTRING",
            rawPathPointCount: 4,
        });
        expect(result[0].transitLegs?.[0].pathCoords).toHaveLength(4);
    });
});

jest.mock("../src/api/env", () => ({ getEnv: jest.fn(() => undefined) }));

import { parseTransitOptionsFromTmap } from "../src/modules/map/tmapRouteProviders";
import { buildScheduleRouteUpdatePayload } from "../src/modules/schedule/routePlannerSession";
import { buildTravelPlanPayload } from "../src/modules/schedule/travelPlanPresentation";
import type { ScheduleItem } from "../src/modules/schedule/types";

function parseRoute(overrides: Record<string, unknown> = {}) {
    return parseTransitOptionsFromTmap({ metaData: { plan: { itineraries: [{
        totalTime: 600,
        legs: [{
            mode: "SUBWAY",
            route: "수도권4호선",
            routeId: "10004000",
            type: 4,
            service: 1,
            sectionTime: 600,
            start: { name: "노원", lat: 37.656, lon: 127.063 },
            end: { name: "창동", lat: 37.653, lon: 127.048 },
            passStopList: { stationList: [
                { index: 0, stationID: "401", stationName: "노원" },
                { index: 1, stationID: "402", stationName: "창동" },
            ] },
            ...overrides,
        }],
    }] } } })[0];
}

function parseLeg(overrides: Record<string, unknown> = {}) {
    return parseRoute(overrides).transitLegs![0];
}

describe("TMAP selected-route identity for ETA requery", () => {
    test("preserves the primary route rather than the first alternative Lane", () => {
        const leg = parseLeg({
            directionName: "오이도 방면",
            directionCode: " down ",
            Lane: [{ route: "수도권4호선급행", routeId: "alternative", type: 120, directionName: "진접 방면" }],
        });
        expect(leg).toMatchObject({
            kind: "SUBWAY", lineName: "수도권4호선", providerRouteId: "10004000",
            serviceClass: "LOCAL", startID: "401", endID: "402",
            directionName: "오이도 방면", directionCode: "DOWN",
        });
    });

    test("keeps Lane-only display compatibility without borrowing identity or direction", () => {
        const leg = parseLeg({
            route: undefined, routeId: undefined, type: undefined,
            Lane: [{ route: "대체 노선", routeId: "alternative", type: 117, direction: "대체 방향", directionCode: "UP" }],
        });
        expect(leg.lineName).toBe("대체 노선");
        expect(leg.providerRouteId).toBeUndefined();
        expect(leg.serviceClass).toBe("UNKNOWN");
        expect(leg.directionName).toBeUndefined();
        expect(leg.directionCode).toBeUndefined();
    });

    test.each([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
        21, 22, 31, 41, 42, 43, 44, 51, 71, 72, 73, 74, 78, 79,
        100, 101, 104, 107, 108, 109, 110, 112, 113, 114, 115, 116, 125,
    ])("preserves documented local subway type %s", (type) => {
        expect(parseLeg({ type }).serviceClass).toBe("LOCAL");
    });

    test.each([117, 118, 119, 120, 121, 122, 123, 124, "117"])("preserves documented express subway type %s", (type) => {
        expect(parseLeg({ type }).serviceClass).toBe("EXPRESS");
    });

    test.each([undefined, null, 0, 12, 102, 103, 105, 106, 111, 126, -1, 4.5, "4.0", "4e0", "", true])(
        "does not infer LOCAL for unknown or malformed type %s", (type) => {
            expect(parseLeg({ type, route: "수도권4호선" }).serviceClass).toBe("UNKNOWN");
        },
    );

    test("does not apply subway service codes to a bus", () => {
        expect(parseLeg({ mode: "BUS", type: 4 }).serviceClass).toBe("UNKNOWN");
    });

    test("uses the same explicit station index ordering as the BE mapper", () => {
        const leg = parseLeg({ passStopList: { stations: [
            { index: "2", stationID: "303", stationName: "하차" },
            { index: "0", stationID: 101, stationName: "승차" },
            { index: "1", stationID: "202", stationName: "경유" },
        ] } });
        expect(leg).toMatchObject({ startID: "101", endID: "303", startName: "승차", endName: "하차" });
        expect(leg.passStops?.map((stop) => stop.code)).toEqual(["101", "202", "303"]);
    });

    test("preserves original station order when the documented index is absent", () => {
        const leg = parseLeg({ passStopList: { stationList: [
            { sequence: 2, stationID: "101", stationName: "승차" },
            { sequence: 1, stationID: "303", stationName: "하차" },
        ] } });
        expect(leg).toMatchObject({ startID: "101", endID: "303" });
    });

    test.each([
        [0, undefined], [0, 0], [0, -1], [0, 1.5], [0, null], [0, "1e0"], [0, true],
    ])("does not derive endpoint identities from malformed indices %s / %s", (firstIndex, lastIndex) => {
        const leg = parseLeg({ passStopList: { stationList: [
            { index: firstIndex, stationID: "101", stationName: "승차" },
            { index: lastIndex, stationID: "303", stationName: "하차" },
        ] } });
        expect(leg.startID).toBeUndefined();
        expect(leg.endID).toBeUndefined();
        expect(leg.passStops).toEqual([]);
    });

    test("keeps raw provider IDs separate from legacy city codes and explicit ARS", () => {
        const leg = parseLeg({ mode: "BUS", passStopList: { stationList: [
            { index: 0, stationID: 12345, cityCode: 1000, stationName: "승차" },
            { index: 1, stationID: "197386", cityCode: 1000, arsId: 2005, stationName: "하차" },
        ] } });
        expect(leg).toMatchObject({ startID: "12345", endID: "197386", endArsID: "02005" });
        expect(leg.startArsID).toBeUndefined();
        expect(leg.passStops?.map((stop) => stop.code)).toEqual(["1000:12345", "ARS:02005"]);
    });

    test.each(["UP", "down", " UP "])("preserves explicit direction code %s", (directionCode) => {
        expect(parseLeg({ directionCode }).directionCode).toBe(directionCode.trim().toUpperCase());
    });

    test.each([1, "1", "inbound", undefined])("does not guess direction from code %s", (directionCode) => {
        expect(parseLeg({ directionCode, Lane: [{ directionCode: "UP" }] }).directionCode).toBeUndefined();
    });

    test("passes normalized identities through the actual personal travel-plan payload builder", () => {
        const route = parseRoute({ directionCode: "DOWN" });
        const item: ScheduleItem = {
            id: "363", title: "ETA identity test", startAt: "2026-10-04T05:50:00Z", endAt: "2026-10-04T06:50:00Z",
            category: { id: "5", title: "업무", color: "#f44336" },
        };
        const update = buildScheduleRouteUpdatePayload(item, {
            travelMode: "TRANSIT", travelMinutes: 10, route,
            departureAt: "2026-10-04T05:40:00Z",
        });
        const persisted = JSON.parse(JSON.stringify(buildTravelPlanPayload(update)));
        expect(persisted.route).toMatchObject({
            provider: "tmap", providerTimeBasis: "route_estimate",
            transitLegs: [{
                providerRouteId: "10004000", serviceClass: "LOCAL", startID: "401", endID: "402",
                directionCode: "DOWN", durationSeconds: 600,
            }],
        });
    });
});

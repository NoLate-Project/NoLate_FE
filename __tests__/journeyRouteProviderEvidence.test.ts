jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => { throw new Error("Provider evidence parsing must not read credentials"); }),
}));

import { getEnv } from "../src/api/env";
import { parseTransitOptionsFromOdsay } from "../src/modules/map/odsayApi";
import { parseTransitOptionsFromTmap } from "../src/modules/map/tmapApi";
import type { TransitLegDetail } from "../src/modules/map/tmapApiCore";
import { parseTransitLegNavigationEvidence } from "../src/modules/map/tmapTransitFields";
import { parseTransitLegDetails } from "../src/modules/map/tmapTransitGeometry";

function parseTmapLeg(stations: unknown[], fields: Record<string, unknown> = {}): TransitLegDetail {
    const options = parseTransitOptionsFromTmap({
        metaData: { plan: { itineraries: [{
            totalTime: 600,
            legs: [{
                mode: "BUS",
                sectionTime: 600,
                Lane: [{ route: "402" }],
                passStopList: { stationList: stations },
                ...fields,
            }],
        }] } },
    });
    return options[0].transitLegs![0];
}

function parseOdsayLeg(stations: unknown[], fields: Record<string, unknown> = {}): TransitLegDetail {
    const options = parseTransitOptionsFromOdsay({
        result: { paths: [{
            pathType: 2,
            totalTime: 10,
            rps: [{
                trafficType: 2,
                duration: 10,
                lane: [{ busNo: "402", busID: 12345 }],
                passStopList: { stations },
                ...fields,
            }],
        }] },
    });
    return options[0].transitLegs![0];
}

function stop(name: string, index?: unknown) {
    return {
        index,
        stationName: name,
        stationID: name,
        cityCode: 1000,
        lat: "37.5665",
        lon: "126.9780",
        y: "37.5665",
        x: "126.9780",
    };
}

afterEach(() => {
    expect(getEnv).not.toHaveBeenCalled();
});

describe.each([
    { provider: "tmap", parse: parseTmapLeg },
    { provider: "odsay", parse: parseOdsayLeg },
])("$provider navigation evidence", ({ provider, parse }) => {
    test("keeps raw order and repeated loop occurrences while the legacy UI stays sorted and deduplicated", () => {
        const stations = [stop("C", 2), stop("A", 0), stop("B", 1), stop("A", 3)];
        const before = JSON.stringify(stations);
        const leg = parse(stations, { stationCount: "3" });

        expect(leg.navigationEvidence).toMatchObject({
            version: 1,
            provider,
            declaredStationCount: 3,
            stopOccurrences: [
                { sourceIndex: 0, providerSequence: 2, name: "C", code: "1000:C" },
                { sourceIndex: 1, providerSequence: 0, name: "A", code: "1000:A" },
                { sourceIndex: 2, providerSequence: 1, name: "B", code: "1000:B" },
                { sourceIndex: 3, providerSequence: 3, name: "A", code: "1000:A" },
            ],
        });
        expect(leg.navigationEvidence?.stopOccurrences.map((row) => row.coord)).toEqual(
            Array.from({ length: 4 }, () => ({ lat: 37.5665, lng: 126.9780 }))
        );
        expect(leg.passStops?.map((row) => row.name)).toEqual(["A", "B", "C"]);
        expect(leg.passStops?.map((row) => row.sequence)).toEqual([1, 2, 3]);
        expect(JSON.stringify(stations)).toBe(before);
    });

    test("never promotes a generated UI index or count to provider evidence", () => {
        const leg = parse([stop("A"), stop("B"), stop("C")], { endName: "도착지" });
        expect(leg.stationCount).toBe(2);
        expect(leg.passStops?.map((row) => row.sequence)).toEqual([1, 2, 3]);
        expect(leg.navigationEvidence?.declaredStationCount).toBeUndefined();
        expect(leg.navigationEvidence?.directionName).toBeUndefined();
        expect(leg.navigationEvidence?.directionCode).toBeUndefined();
        expect(leg.navigationEvidence?.stopOccurrences.map((row) => row.providerSequence)).toEqual([
            undefined, undefined, undefined,
        ]);
    });

    test("keeps invalid and nameless rows as occurrences without inventing coordinates or names", () => {
        const leg = parse([
            null, 17, "invalid", [], {},
            { index: 5, x: null, y: null, lat: null, lon: null },
            { index: 6, stationName: "", x: " ", y: " ", lat: " ", lon: " " },
            { index: 7, arsId: "02005", x: false, y: true, lat: true, lon: false },
            { index: 8, stationName: 123, x: 200, y: 100, lat: 100, lon: 200 },
        ]);
        const rows = leg.navigationEvidence!.stopOccurrences;
        expect(rows).toHaveLength(9);
        expect(rows.map((row) => row.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(rows.map((row) => row.name)).toEqual(Array(9).fill(undefined));
        expect(rows.map((row) => row.coord)).toEqual(Array(9).fill(undefined));
        expect(rows[7].code).toBe("ARS:02005");
        expect(rows[5].providerSequence).toBe(5);
    });

    test("keeps holes in a sparse provider array as explicit empty occurrences", () => {
        const stations = new Array(3);
        stations[2] = stop("C", 2);
        expect(parse(stations).navigationEvidence?.stopOccurrences).toEqual([
            { sourceIndex: 0 },
            { sourceIndex: 1 },
            expect.objectContaining({ sourceIndex: 2, name: "C", providerSequence: 2 }),
        ]);
    });

    test("only accepts explicitly supplied non-negative safe integer sequences", () => {
        const values = [0, 1, "2", undefined, null, "", " ", true, false, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0x10"];
        const rows = parse(values.map((value, index) => stop(`S${index}`, value))).navigationEvidence!.stopOccurrences;
        expect(rows.map((row) => row.providerSequence)).toEqual([
            0, 1, 2, ...Array(values.length - 3).fill(undefined),
        ]);
    });

    test.each([null, "", " ", true, false, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        "does not replace an invalid declared station count (%p) with a derived count",
        (stationCount) => {
            expect(parse([stop("A", 0), stop("B", 1)], { stationCount })
                .navigationEvidence?.declaredStationCount).toBeUndefined();
        }
    );

    test("retains an explicit zero station count so the normalizer can reject conflicts", () => {
        expect(parse([stop("A", 0), stop("B", 1)], { stationCount: 0 })
            .navigationEvidence?.declaredStationCount).toBe(0);
    });

    test("bounds evidence at 500 occurrences and omits rather than truncates oversized arrays", () => {
        const stations = Array.from({ length: 501 }, (_, index) => stop(`S${index}`, index));
        expect(parse(stations.slice(0, 500)).navigationEvidence?.stopOccurrences).toHaveLength(500);
        expect(parse(stations).navigationEvidence).toBeUndefined();
    });

    test("does not infer direction from names, geometry, or UI metadata", () => {
        const leg = parse([stop("A", 0), stop("B", 1)], {
            startName: "A", endName: "B", wayCode: true,
        });
        expect(leg.navigationEvidence?.directionName).toBeUndefined();
        expect(leg.navigationEvidence?.directionCode).toBeUndefined();
    });

    test("retains duplicate provider sequences for downstream conflict detection", () => {
        expect(parse([stop("A", 4), stop("B", 4)]).navigationEvidence?.stopOccurrences
            .map((row) => row.providerSequence)).toEqual([4, 4]);
    });

    test("creates evidence from raw provider fields without trusting pre-existing UI evidence", () => {
        const evidence = parse([stop("A")], {
            navigationEvidence: {
                version: 99, provider: "legacy", geometryInputComplete: true,
                declaredStationCount: 99, stopOccurrences: [{ sourceIndex: 0, providerSequence: 100 }],
            },
        }).navigationEvidence;
        expect(evidence).toMatchObject({ version: 1, provider, geometryInputComplete: false });
        expect(evidence?.declaredStationCount).toBeUndefined();
        expect(evidence?.stopOccurrences[0].providerSequence).toBeUndefined();
    });
});

describe("provider-specific evidence fields", () => {
    test("TMAP keeps explicit sequence aliases, direction text/code, and passStopCount", () => {
        const leg = parseTmapLeg([
            { ...stop("A"), sequence: "10" },
            { ...stop("B"), seq: 11 },
            { ...stop("C"), stationSeq: 12 },
            { ...stop("D"), stopSequence: 13 },
        ], { direction: "양재역 방면", directionCode: "DOWN", passStopCount: "3" });
        expect(leg.navigationEvidence?.stopOccurrences.map((row) => row.providerSequence)).toEqual([10, 11, 12, 13]);
        expect(leg.navigationEvidence).toMatchObject({
            directionName: "양재역 방면", directionCode: "DOWN", declaredStationCount: 3,
        });
    });

    test("TMAP does not map undocumented direction codes or station endpoints to evidence", () => {
        const leg = parseTmapLeg([], { directionCode: 1, end: { name: "남산도서관" } });
        expect(leg.navigationEvidence).toMatchObject({ stopOccurrences: [] });
        expect(leg.navigationEvidence?.directionName).toBeUndefined();
        expect(leg.navigationEvidence?.directionCode).toBeUndefined();
    });

    test("TMAP rejects oversized evidence before reading or copying any station rows", () => {
        const stations = new Proxy(new Array(501), {
            get(target, key, receiver) {
                if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("must not copy oversized evidence");
                return Reflect.get(target, key, receiver);
            },
        });
        expect(parseTransitLegNavigationEvidence({ passStopList: { stationList: stations } })).toBeUndefined();
    });

    test.each([[1, "UP"], ["2", "DOWN"]])("ODsay preserves explicit way/wayCode %p", (wayCode, directionCode) => {
        expect(parseOdsayLeg([stop("A", 0), stop("B", 1)], {
            stationCount: "1", way: "사당", wayCode,
        }).navigationEvidence).toMatchObject({
            provider: "odsay", declaredStationCount: 1, directionName: "사당", directionCode,
        });
    });

    test("ODsay does not borrow uncontracted aliases as sequence or count evidence", () => {
        const leg = parseOdsayLeg([{ ...stop("A"), sequence: 0 }, { ...stop("B"), sequence: 1 }], {
            passStopCount: 1, direction: "사당",
        });
        expect(leg.navigationEvidence?.declaredStationCount).toBeUndefined();
        expect(leg.navigationEvidence?.directionName).toBeUndefined();
        expect(leg.navigationEvidence?.stopOccurrences.map((row) => row.providerSequence)).toEqual([undefined, undefined]);
    });

    test("provider geometry sources and exact claims remain unchanged", () => {
        expect(parseTmapLeg([stop("A", 0), stop("B", 1)], {
            passShape: { linestring: "126.9780,37.5665 126.9790,37.5665" },
        })).toMatchObject({
            pathCoordsIsExact: true, pathGeometrySource: "TRANSIT_PASS_SHAPE_LINESTRING",
            navigationEvidence: { geometryInputComplete: true },
        });
        expect(parseOdsayLeg([stop("A", 0), stop("B", 1)], {
            graph: "126.9780 37.5665|126.9790 37.5665",
        })).toMatchObject({
            pathCoordsIsExact: true, pathGeometrySource: "TRANSIT_PASS_SHAPE_LINESTRING",
            navigationEvidence: { geometryInputComplete: true },
        });
    });
});

describe("raw geometry completeness evidence", () => {
    const start = stop("A", 0);
    const end = { ...stop("B", 1), x: "126.9790", lon: "126.9790" };

    beforeEach(() => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        "126.9780,37.5665 malformed 126.9790,37.5665",
        "126.9780,37.5665 181,37.5665 126.9790,37.5665",
        "126.9780,37.5665 ,37.5665 126.9790,37.5665",
        "126.9780,37.5665 126.9785,NaN 126.9790,37.5665",
        "126.9780,37.5665 126.9785,37.5665,extra 126.9790,37.5665",
    ])("TMAP keeps the display shape but rejects filtered malformed source: %s", (linestring) => {
        const leg = parseTmapLeg([start, end], { passShape: { linestring } });
        expect(leg.pathCoordsIsExact).toBe(true);
        expect(leg.pathGeometrySource).toBe("TRANSIT_PASS_SHAPE_LINESTRING");
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test.each([
        "126.9780 37.5665|malformed|126.9790 37.5665",
        "126.9780 37.5665|181 37.5665|126.9790 37.5665",
        "126.9780 37.5665||126.9790 37.5665",
        "126.9780 37.5665|126.9785 NaN|126.9790 37.5665",
        "126.9780 37.5665|126.9785 37.5665 extra|126.9790 37.5665",
    ])("ODsay keeps the display shape but rejects filtered malformed source: %s", (graph) => {
        const leg = parseOdsayLeg([start, end], { graph });
        expect(leg.pathCoordsIsExact).toBe(true);
        expect(leg.pathGeometrySource).toBe("TRANSIT_PASS_SHAPE_LINESTRING");
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test("stop chords, missing shapes, and itinerary snapshots never become complete provider geometry", () => {
        for (const parse of [parseTmapLeg, parseOdsayLeg]) {
            const leg = parse([start, end]);
            expect(leg.pathGeometrySource).toBe("PASS_STOP_LIST");
            expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
        }
        expect(parseTmapLeg([]).navigationEvidence?.geometryInputComplete).toBe(false);
        expect(parseOdsayLeg([]).navigationEvidence?.geometryInputComplete).toBe(false);
        const [snapped] = parseTransitLegDetails([{
            mode: "BUS", start: { name: "A", lat: 37.5665, lon: 126.978 },
            end: { name: "B", lat: 37.5665, lon: 126.979 },
        }], [{ lat: 37.5665, lng: 126.978 }, { lat: 37.5665, lng: 126.979 }]);
        expect(snapped.pathGeometrySource).toBe("ITINERARY_PATH_SNAP");
        expect(snapped.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test("TMAP validates all selected WALK steps and WALK passShape input", () => {
        const walkFields = {
            mode: "WALK", steps: [{ linestring: "126.9780,37.5665 126.9790,37.5665" }],
        };
        expect(parseTmapLeg([], walkFields)).toMatchObject({
            pathGeometrySource: "WALK_STEPS_LINESTRING", navigationEvidence: { geometryInputComplete: true },
        });
        expect(parseTmapLeg([], {
            mode: "WALK", passShape: { linestring: "126.9780,37.5665 126.9790,37.5665" },
        })).toMatchObject({
            pathGeometrySource: "WALK_PASS_SHAPE_LINESTRING", navigationEvidence: { geometryInputComplete: true },
        });
        expect(parseTmapLeg([], {
            ...walkFields, steps: [...walkFields.steps, { linestring: "malformed" }],
        })).toMatchObject({
            pathGeometrySource: "WALK_STEPS_LINESTRING", navigationEvidence: { geometryInputComplete: false },
        });
    });

    test("TMAP validates the selected source instead of a valid but unselected alternate", () => {
        const leg = parseTmapLeg([], {
            mode: "WALK",
            steps: [{ linestring: "126.9780,37.5665 invalid 126.9790,37.5665" }],
            passShape: { linestring: "126.9780,37.5665 126.9790,37.5665" },
        });
        expect(leg.pathGeometrySource).toBe("WALK_STEPS_LINESTRING");
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test("TMAP does not silently skip sparse steps when proving completeness", () => {
        const steps = new Array(2);
        steps[1] = { linestring: "126.9780,37.5665 126.9790,37.5665" };
        const leg = parseTmapLeg([], { mode: "WALK", steps });
        expect(leg.pathGeometrySource).toBe("WALK_STEPS_LINESTRING");
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test.each(["WALK", "BUS"])("TMAP %s does not certify a 1201-point shape whose backtrack was sampled away", (mode) => {
        const coordinates = Array.from({ length: 1201 }, (_, index) => ({
            lat: 37.5665, lng: 126.978 + index * 0.000002,
        }));
        // Display sampling keeps even indices. The backwards odd point must not disappear from
        // the evidence contract just because the delivered 601-point polyline looks straight.
        coordinates[501] = { lat: 37.5665, lng: 126.978 + 498.5 * 0.000002 };
        const linestring = coordinates.map(({ lat, lng }) => `${lng},${lat}`).join(" ");
        const leg = parseTmapLeg([], mode === "WALK"
            ? { mode, steps: [{ linestring }] }
            : { mode, passShape: { linestring } });
        expect(leg.pathCoordsIsExact).toBe(true); // Legacy display contract remains unchanged.
        expect(leg.pathCoords).toHaveLength(601);
        expect(leg.pathCoords).not.toContainEqual(coordinates[501]);
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test("TMAP permits only adjacent duplicate removal, including duplicated step seams", () => {
        const leg = parseTmapLeg([], {
            mode: "WALK", steps: [
                { linestring: "126.9780,37.5665 126.9780,37.5665 126.9785,37.5665" },
                { linestring: "126.9785,37.5665 126.9790,37.5665 126.9790,37.5665" },
            ],
        });
        expect(leg.pathCoords).toEqual([
            { lat: 37.5665, lng: 126.978 },
            { lat: 37.5665, lng: 126.9785 },
            { lat: 37.5665, lng: 126.979 },
        ]);
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(true);
    });

    test("TMAP retains completeness exactly at the unsampled 1200-point limit", () => {
        const linestring = Array.from({ length: 1200 }, (_, index) => `${126.978 + index * 0.000002},37.5665`).join(" ");
        const leg = parseTmapLeg([], { mode: "WALK", steps: [{ linestring }] });
        expect(leg.pathCoords).toHaveLength(1200);
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(true);
    });

    test("ODsay keeps all 1201 direct graph points, including a backtrack for native rejection", () => {
        const coordinates = Array.from({ length: 1201 }, (_, index) => ({
            lat: 37.5665, lng: 126.978 + index * 0.000002,
        }));
        coordinates[501] = { lat: 37.5665, lng: 126.978 + 498.5 * 0.000002 };
        const graph = coordinates.map(({ lat, lng }) => `${lng} ${lat}`).join("|");
        const leg = parseOdsayLeg([], { graph });
        expect(leg.pathCoords).toEqual(coordinates);
        // Complete means lossless input, not a geometrically safe or navigable route.
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(true);
    });

    test("unsupported TMAP aliases remain displayable but have unknown completeness", () => {
        const leg = parseTmapLeg([], { shape: [[126.9780, 37.5665], [126.9790, 37.5665]] });
        expect(leg.pathCoordsIsExact).toBe(true);
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });

    test("ODsay WALK route assembly is explicitly unverified in this slice", () => {
        const leg = parseOdsayLeg([], {
            trafficType: 3,
            routes: [{ rseq: 1, xyInfos: [{ x: 126.9780, y: 37.5665 }, { x: 126.9790, y: 37.5665 }] }],
        });
        expect(leg.pathCoordsIsExact).toBe(true);
        expect(leg.navigationEvidence?.geometryInputComplete).toBe(false);
    });
});

import {
    buildJourneyRouteInput, JOURNEY_ROUTE_INPUT_LIMITS, journeyRouteUTF8Bytes,
    type JourneyRouteInputContext,
} from "../src/modules/journey/journeyRouteInput";

const coordinate = (offset = 0) => ({ lat: 37.5665, lng: 126.978 + offset });
const rawStop = (index: number) => ({ sourceIndex: index, providerSequence: index + 1, name: ` 정류장 ${index} `, code: `S${index}`, coord: coordinate(index * 0.001) });
const rawLeg = (overrides: Record<string, unknown> = {}) => ({
    kind: "BUS", pathGeometrySource: "provider_shape", pathCoordsIsExact: true,
    pathCoords: [coordinate(), coordinate(0.001), coordinate(0.002)],
    startCoord: coordinate(), endCoord: coordinate(0.002), providerRouteId: " provider-route ", localRouteId: "local-route",
    serviceAvailable: true, navigationEvidence: {
        version: 1, provider: "tmap", geometryInputComplete: true, directionName: " 종점 방면 ", directionCode: "OUTBOUND", declaredStationCount: 2,
        stopOccurrences: [rawStop(0), rawStop(1)],
    },
    ...overrides,
});
const rawRoute = (overrides: Record<string, unknown> = {}) => ({
    mode: "TRANSIT", provider: "tmap", source: "api", routeReliability: "live_provider",
    routePlausibility: "normal", transitServiceState: "operating", transitLegs: [rawLeg()], ...overrides,
});
const context = (overrides: Partial<JourneyRouteInputContext> = {}): JourneyRouteInputContext => ({
    routeRevision: 3, context: "ROUTING_RESPONSE", origin: coordinate(-0.0001), destination: coordinate(0.0021), ...overrides,
});
const unwrap = (route: unknown, requestContext = context()) => {
    const result = buildJourneyRouteInput(route, requestContext);
    if (!result.ok) throw new Error(`Unexpected fixture rejection: ${result.reason}`);
    return result.input;
};

describe("P1-2 route input allow-list", () => {
    it('retains the routing namespace only for explicit subway stop evidence, without inventing Seoul station IDs', () => {
        const evidence = { ...rawLeg().navigationEvidence,
            stopOccurrences: [{ ...rawStop(0), routingStationID: ' 222 ', stationID: 'untrusted-seoul-id' }, rawStop(1)] };
        const subway = unwrap(rawRoute({ transitLegs: [rawLeg({ kind: 'SUBWAY', navigationEvidence: evidence })] })).legs[0];
        expect(subway.stops[0].routingStationId).toBe('222');
        expect(subway.stops[1].routingStationId).toBeUndefined();
        expect(JSON.stringify(subway)).not.toContain('untrusted-seoul-id');
        const bus = unwrap(rawRoute({ transitLegs: [rawLeg({ navigationEvidence: evidence })] })).legs[0];
        expect(bus.stops[0].routingStationId).toBeUndefined();
    });
    it('binds bounded provider display claims but never promotes them to stop/direction evidence', () => {
        const leg = unwrap(rawRoute({ transitLegs: [rawLeg({ lineName: ' 601 ', lineColor: 'e8752b', durationMinutes: 5, distanceMeters: 800 })] })).legs[0];
        expect(leg.display).toEqual({ lineName: '601', lineColor: '#E8752B', durationMinutes: 5, distanceMeters: 800 });
        const invalid = unwrap(rawRoute({ transitLegs: [rawLeg({ lineName: 'bad\nname', lineColor: 'red', durationMinutes: '5', distanceMeters: -1 })] })).legs[0];
        expect(invalid.display).toEqual({ lineName: null, lineColor: null, durationMinutes: null, distanceMeters: null });
        expect(invalid.directionName).toBe('종점 방면');
        expect(unwrap(rawRoute({ transitLegs: [rawLeg({ lineColor: 'ABCDEF\n' })] })).legs[0].display?.lineColor).toBeNull();
    });
    it("copies only the wire allow-list with independent selected endpoints and trimmed strings", () => {
        const input = unwrap(rawRoute({
            token: "private-token", savedUser: { email: "private@example.com" }, displayPolyline: [coordinate(9)],
            transitLegs: [rawLeg({ estimatedArrival: "private-time", label: "private-label", pathOverlay: [coordinate(8)] })],
        }));
        expect(input).toMatchObject({
            schemaVersion: 1, routeRevision: 3, context: "ROUTING_RESPONSE", provider: "tmap", source: "api",
            reliability: "live_provider", plausibility: "normal", serviceState: "operating",
            origin: { latitude: 37.5665, longitude: coordinate(-0.0001).lng },
            legs: [{ index: 0, providerRouteId: "provider-route", directionName: "종점 방면", stopEvidenceVersion: 1 }],
        });
        expect(input.legs[0].stops[0].name).toBe("정류장 0");
        expect(JSON.stringify(input)).not.toMatch(/private-|savedUser|displayPolyline|pathOverlay|estimatedArrival/);
        expect(input.origin).not.toEqual(input.legs[0].start);
    });

    it("deep-copies route points, stops and context instead of retaining mutable provider objects", () => {
        const source = rawRoute();
        const selected = context();
        const input = unwrap(source, selected);
        const serialized = JSON.stringify(input);
        source.transitLegs[0].pathCoords[0].lat = 0;
        source.transitLegs[0].navigationEvidence.stopOccurrences[0].coord.lng = 0;
        source.transitLegs[0].navigationEvidence.stopOccurrences[0].name = "changed";
        (selected.origin as { lat: number }).lat = 0;
        expect(JSON.stringify(input)).toBe(serialized);
    });

    it("preserves invalid middle coordinates as null without joining the surviving endpoints", () => {
        const input = unwrap(rawRoute({ transitLegs: [rawLeg({
            pathCoords: [coordinate(), { lat: "37.5", lng: 127 }, { lat: NaN, lng: 127 }, null, coordinate(0.002)],
        })] }));
        expect(input.legs[0].coordinates).toEqual([
            { latitude: 37.5665, longitude: 126.978 }, null, null, null,
            { latitude: 37.5665, longitude: coordinate(0.002).lng },
        ]);
    });

    it("preserves sparse point and stop array positions for native rejection", () => {
        const points = new Array<ReturnType<typeof coordinate>>(3);
        points[0] = coordinate();
        points[2] = coordinate(0.002);
        const stops = new Array<ReturnType<typeof rawStop>>(3);
        stops[0] = rawStop(0);
        stops[2] = rawStop(2);
        const input = unwrap(rawRoute({ transitLegs: [rawLeg({ pathCoords: points, navigationEvidence: { stopOccurrences: stops } })] }));
        expect(input.legs[0].coordinates).toHaveLength(3);
        expect(input.legs[0].coordinates[1]).toBeNull();
        expect(input.legs[0].stops).toHaveLength(3);
        expect(input.legs[0].stops[1]).toEqual({ sourceIndex: -1, providerSequence: null, name: null, code: null, coordinate: null });
    });

    it("does not silently repair swapped or out-of-range finite coordinates", () => {
        const input = unwrap(rawRoute({ transitLegs: [rawLeg({ pathCoords: [{ lat: 127, lng: 37 }, { lat: -999, lng: 999 }] })] }));
        expect(input.legs[0].coordinates).toEqual([{ latitude: 127, longitude: 37 }, { latitude: -999, longitude: 999 }]);
    });

    it("uses UNKNOWN/null rather than optimistic defaults for absent provider indicators", () => {
        const input = unwrap({ transitLegs: [{ kind: "FERRY", pathCoordsIsExact: "true", serviceAvailable: 1 }] });
        expect(input).toMatchObject({ provider: "UNKNOWN", source: "UNKNOWN", reliability: "UNKNOWN", plausibility: "UNKNOWN", serviceState: "UNKNOWN" });
        expect(input.legs[0]).toMatchObject({ kind: "UNKNOWN", geometrySource: "UNKNOWN", exact: false, serviceAvailable: null, coordinates: [], stops: [] });
    });

    it("does not infer missing endpoints from shape points or a provider leg", () => {
        const input = unwrap(rawRoute(), context({ origin: undefined, destination: { latitude: 37, longitude: 127 } }));
        expect(input.origin).toBeNull();
        expect(input.destination).toBeNull();
        expect(input.legs[0].start).not.toBeNull();
    });

    it("never promotes legacy display stops, direction or count into raw navigation evidence", () => {
        const input = unwrap(rawRoute({ transitLegs: [rawLeg({
            navigationEvidence: undefined,
            passStops: [rawStop(0), rawStop(1)], passStopList: [rawStop(0)],
            directionName: "display-inferred", directionCode: "DISPLAY", stationCount: 9,
        })] }));
        expect(input.legs[0]).toMatchObject({ stops: [], directionName: null, directionCode: null, declaredStationCount: null, stopEvidenceProvider: null, stopEvidenceVersion: null });
    });

    it("accepts the raw geometry-completeness claim only when explicitly true", () => {
        expect(unwrap(rawRoute()).legs[0].geometryInputComplete).toBe(true);
        for (const value of [undefined, false, "true", 1]) {
            const input = unwrap(rawRoute({ transitLegs: [rawLeg({ geometryInputComplete: true, navigationEvidence: { geometryInputComplete: value } })] }));
            expect(input.legs[0].geometryInputComplete).toBe(false);
        }
    });

    it("preserves raw occurrence order, repeated stop identity and missing provider sequence", () => {
        const repeated = { ...rawStop(0), providerSequence: undefined };
        const input = unwrap(rawRoute({ transitLegs: [rawLeg({ navigationEvidence: { stopOccurrences: [rawStop(2), repeated, repeated] } })] }));
        expect(input.legs[0].stops.map(stop => stop.sourceIndex)).toEqual([2, 0, 0]);
        expect(input.legs[0].stops.map(stop => stop.providerSequence)).toEqual([3, null, null]);
        expect(input.legs[0].stops.map(stop => stop.code)).toEqual(["S2", "S0", "S0"]);
    });

    it("turns unsafe numeric stop evidence and control-character labels into explicit unknown values", () => {
        const input = unwrap(rawRoute({ transitLegs: [rawLeg({ navigationEvidence: {
            version: 1.5, declaredStationCount: -1, directionName: "bad\nlabel", directionCode: " ",
            stopOccurrences: [{ sourceIndex: -3, providerSequence: Number.MAX_SAFE_INTEGER + 1, name: "bad\u007Flabel", code: 12, coord: { lat: Infinity, lng: 127 } }],
        } })] }));
        expect(input.legs[0]).toMatchObject({ stopEvidenceVersion: null, declaredStationCount: null, directionName: null, directionCode: null });
        expect(input.legs[0].stops[0]).toEqual({ sourceIndex: -1, providerSequence: null, name: null, code: null, coordinate: null });
    });

    it.each(["ROUTING_RESPONSE", "SAVED_ROUTE", "SYNTHETIC_FIXTURE"] as const)("retains explicit %s context without changing its trust level", routeContext => {
        expect(unwrap(rawRoute(), context({ context: routeContext })).context).toBe(routeContext);
    });

    it.each([null, undefined, [], "raw", {}, { transitLegs: [] }, { transitLegs: {} }, { transitLegs: [null] }])("rejects malformed root or legs %#", route => {
        expect(buildJourneyRouteInput(route, context())).toEqual({ ok: false, reason: "INVALID_ROUTE_INPUT" });
    });

    it.each([0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe revision %s", routeRevision => {
        expect(buildJourneyRouteInput(rawRoute(), context({ routeRevision }))).toEqual({ ok: false, reason: "INVALID_ROUTE_INPUT" });
    });

    it("rejects unsupported context and non-transit modes", () => {
        expect(buildJourneyRouteInput(rawRoute(), context({ context: "LIVE" as JourneyRouteInputContext["context"] }))).toEqual({ ok: false, reason: "INVALID_ROUTE_INPUT" });
        expect(buildJourneyRouteInput(rawRoute({ mode: "CAR" }), context())).toEqual({ ok: false, reason: "TRANSIT_ROUTE_REQUIRED" });
    });

    it.each([
        ["leg count", () => Array.from({ length: JOURNEY_ROUTE_INPUT_LIMITS.legs + 1 }, () => rawLeg())],
        ["per-leg points", () => [rawLeg({ pathCoords: Array.from({ length: JOURNEY_ROUTE_INPUT_LIMITS.pointsPerLeg + 1 }, () => coordinate()) })]],
        ["total points", () => Array.from({ length: 7 }, () => rawLeg({ pathCoords: Array.from({ length: 2000 }, () => coordinate()) }))],
        ["per-leg stops", () => [rawLeg({ navigationEvidence: { stopOccurrences: Array.from({ length: 501 }, (_, index) => rawStop(index)) } })]],
        ["total stops", () => Array.from({ length: 5 }, () => rawLeg({ navigationEvidence: { stopOccurrences: Array.from({ length: 500 }, (_, index) => rawStop(index)) } }))],
    ] as const)("enforces %s bounds before native hand-off", (_label, makeLegs) => {
        expect(buildJourneyRouteInput(rawRoute({ transitLegs: makeLegs() }), context())).toEqual({ ok: false, reason: "INPUT_LIMIT_EXCEEDED" });
    });

    it.each(["a".repeat(257), "가".repeat(86), "🚌".repeat(65)])("enforces string UTF-8 limits %#", providerRouteId => {
        expect(buildJourneyRouteInput(rawRoute({ transitLegs: [rawLeg({ providerRouteId })] }), context())).toEqual({ ok: false, reason: "INPUT_LIMIT_EXCEEDED" });
    });

    it("enforces the total JSON byte limit even when each array and string is individually bounded", () => {
        const stops = Array.from({ length: 500 }, (_, index) => ({ ...rawStop(index), name: "가".repeat(85), code: "나".repeat(85) }));
        const transitLegs = Array.from({ length: 4 }, () => rawLeg({ navigationEvidence: { stopOccurrences: stops } }));
        expect(buildJourneyRouteInput(rawRoute({ transitLegs }), context())).toEqual({ ok: false, reason: "INPUT_LIMIT_EXCEEDED" });
    });

    it.each([["", 0], ["ASCII", 5], ["é", 2], ["가", 3], ["🚌", 4], ["a가🚌", 8]] as const)("counts UTF-8 bytes for %s", (value, bytes) => {
        expect(journeyRouteUTF8Bytes(value)).toBe(bytes);
    });
});

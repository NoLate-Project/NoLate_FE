jest.mock("../src/api/env", () => ({ getEnv: jest.fn(() => { throw new Error("NO_CREDENTIAL_ACCESS"); }) }));

import { getEnv } from "../src/api/env";
import { journeyRouteFixtures } from "../src/modules/journey/journeyRouteFixtures";

describe("P1-2 parser-to-adapter synthetic fixtures", () => {
    afterEach(() => expect(getEnv).not.toHaveBeenCalled());

    test("uses real TMAP parsing without claiming an actual provider response or inventing a route ID", () => {
        const input = journeyRouteFixtures[0].input;
        expect(input.context).toBe("SYNTHETIC_FIXTURE");
        expect(input.legs.map(leg => leg.kind)).toEqual(["WALK", "BUS", "WALK"]);
        expect(input.legs.every(leg => leg.geometryInputComplete)).toBe(true);
        expect(input.legs.map(leg => leg.coordinates.length)).toEqual([3, 3, 3]);
        expect(input.legs[1]).toMatchObject({
            exact: true, providerRouteId: null, declaredStationCount: 2,
            stopEvidenceProvider: "tmap", stopEvidenceVersion: 1,
            directionName: "합성 동쪽 방면", directionCode: "DOWN",
        });
        expect(input.legs[1].stops.map(stop => stop.providerSequence)).toEqual([0, 1, 2]);
    });

    test("stop-only geometry retains fallback provenance and cannot manufacture direct geometry", () => {
        expect(journeyRouteFixtures[1].input.legs[1]).toMatchObject({
            geometrySource: "PASS_STOP_LIST", exact: false, geometryInputComplete: false,
        });
    });

    test("the display parser cannot manufacture a missing provider stop sequence", () => {
        expect(journeyRouteFixtures[2].input.legs[1].stops.map(stop => stop.providerSequence)).toEqual([0, null, 2]);
    });

    test("wrong-direction geometry is not silently reoriented to the requested origin", () => {
        const leg = journeyRouteFixtures[3].input.legs[0];
        expect(leg.start?.longitude).toBe(126.978);
        expect(leg.coordinates[0]?.longitude).toBe(126.9795);
    });

    test("legacy saved data cannot reconstruct evidence from display fields", () => {
        const input = journeyRouteFixtures[4].input;
        expect(input.context).toBe("SAVED_ROUTE");
        expect(input.legs[1]).toMatchObject({
            geometryInputComplete: false, stopEvidenceVersion: null, stopEvidenceProvider: null,
            stops: [], declaredStationCount: null, directionName: null,
        });
    });

    test("invalid middle point survives for native rejection, and fixtures do not share mutable paths", () => {
        expect(journeyRouteFixtures[5].input.legs[0].coordinates).toHaveLength(3);
        expect(journeyRouteFixtures[5].input.legs[0].coordinates[1]?.latitude).toBe(95);
        expect(journeyRouteFixtures[0].input.legs[0].coordinates[1]?.latitude).toBe(37.5665);
    });
});

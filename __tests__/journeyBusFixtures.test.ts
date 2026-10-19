jest.mock("../src/api/env", () => ({ getEnv: jest.fn(() => { throw new Error("NO_CREDENTIAL_ACCESS"); }) }));

import { getEnv } from "../src/api/env";
import { journeyBusFixtures } from "../src/modules/journey/journeyBusFixtures";
import { journeyRouteFixtures } from "../src/modules/journey/journeyRouteFixtures";
import type { JourneyRouteCoordinate } from "../src/modules/journey/journeyRouteInput";

const base = journeyRouteFixtures.find(fixture => fixture.id === "direct-provider-shape")!;
const fixture = (id: string) => journeyBusFixtures.find(item => item.id === id)!;
function length(points: (JourneyRouteCoordinate | null)[]) {
    return points.slice(1).reduce((sum, point, index) => {
        const previous = points[index];
        if (!previous || !point) throw new Error("INVALID_TEST_COORDINATE");
        const radians = Math.PI / 180;
        return sum + 6_371_000 * Math.hypot(
            (point.longitude - previous.longitude) * radians * Math.cos(point.latitude * radians),
            (point.latitude - previous.latitude) * radians,
        );
    }, 0);
}

describe("P2-1 first-bus synthetic fixtures", () => {
    afterEach(() => expect(getEnv).not.toHaveBeenCalled());

    it("keeps the existing direct-provider fixture contract exactly unchanged", () => {
        expect(journeyBusFixtures).toHaveLength(3);
        expect(fixture("first-bus-valid").input).toEqual(base.input);
        expect(fixture("first-bus-valid").input).not.toBe(base.input);
        expect(base.input.legs[1].coordinates).toHaveLength(3);
        expect(base.input.legs[1].coordinates[1]?.latitude).toBe(37.5665);
    });

    it("uses about 132m initial walking and 881m bus geometry with ordered provider occurrences", () => {
        const input = fixture("first-bus-valid").input;
        expect(input.legs.map(leg => leg.kind)).toEqual(["WALK", "BUS", "WALK"]);
        expect(length(input.legs[0].coordinates)).toBeGreaterThan(130);
        expect(length(input.legs[0].coordinates)).toBeLessThan(135);
        expect(length(input.legs[1].coordinates)).toBeGreaterThan(870);
        expect(length(input.legs[1].coordinates)).toBeLessThan(890);
        expect(input.legs[1].stops.map(stop => stop.providerSequence)).toEqual([0, 1, 2]);
        expect(input.legs[1].directionName).toBe("합성 동쪽 방면");
    });

    it("never promotes synthetic data to live routing or invents a route/vehicle identifier", () => {
        for (const item of journeyBusFixtures) {
            expect(item.input.context).toBe("SYNTHETIC_FIXTURE");
            expect(item.input.legs[1].providerRouteId).toBeNull();
            expect(item.input.legs[1].localRouteId).toBeNull();
            expect(JSON.stringify(item.input)).not.toMatch(/vehicleId|boardingConfirmed/);
        }
    });

    it("retains a bad middle bus point instead of filtering or reconnecting it", () => {
        const input = fixture("invalid-bus-middle-coordinate").input;
        expect(input.legs[1].coordinates).toHaveLength(3);
        expect(input.legs[1].coordinates[1]).toEqual({ latitude: 95, longitude: 126.9845 });
        expect(input.legs[1].coordinates[0]).toEqual(base.input.legs[1].coordinates[0]);
        expect(input.legs[1].coordinates[2]).toEqual(base.input.legs[1].coordinates[2]);
    });

    it("introduces an interior backwards segment without reversing endpoints or stop order", () => {
        const input = fixture("bus-backtracking-shape").input;
        const shape = input.legs[1].coordinates;
        expect(shape).toHaveLength(4);
        expect(shape[2]!.longitude).toBeLessThan(shape[1]!.longitude);
        expect(shape[0]).toEqual(base.input.legs[1].coordinates[0]);
        expect(shape.at(-1)).toEqual(base.input.legs[1].coordinates.at(-1));
        expect(input.legs[1].stops).toEqual(base.input.legs[1].stops);
    });

    it("preserves first-walk eligibility inputs and leg continuity in each bus-only negative", () => {
        for (const item of journeyBusFixtures.slice(1)) {
            expect(item.input.origin).toEqual(base.input.origin);
            expect(item.input.destination).toEqual(base.input.destination);
            expect(item.input.legs[0]).toEqual(base.input.legs[0]);
            expect(item.input.legs[2]).toEqual(base.input.legs[2]);
            expect(item.input.legs[1].start).toEqual(base.input.legs[1].start);
            expect(item.input.legs[1].end).toEqual(base.input.legs[1].end);
            expect(item.input.legs[1].stops).toEqual(base.input.legs[1].stops);
        }
    });

    it("does not share mutable nested geometry or stop data with other fixtures", () => {
        const first = journeyBusFixtures[0].input;
        for (const item of journeyBusFixtures.slice(1)) {
            expect(item.input.legs[0]).not.toBe(first.legs[0]);
            expect(item.input.legs[1].coordinates).not.toBe(first.legs[1].coordinates);
            expect(item.input.legs[1].stops[0]).not.toBe(first.legs[1].stops[0]);
        }
        expect(first.legs[1].stops).not.toBe(base.input.legs[1].stops);
    });

    it("exports no development fixtures in release", () => {
        const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
        const original = runtime.__DEV__;
        try {
            runtime.__DEV__ = false;
            jest.isolateModules(() => {
                const release = require("../src/modules/journey/journeyBusFixtures") as typeof import("../src/modules/journey/journeyBusFixtures");
                expect(release.journeyBusFixtures).toEqual([]);
            });
        } finally { runtime.__DEV__ = original; }
    });
});

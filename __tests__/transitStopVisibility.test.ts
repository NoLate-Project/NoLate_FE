import {
    allocateTransitStopMarkerCounts,
    getTransitStopMarkerPolicy,
    sampleTransitStopIndices,
} from "../src/modules/map/transitStopVisibility";

describe("transitStopVisibility", () => {
    it("reveals more bus stops and scales their rings with zoom", () => {
        expect(getTransitStopMarkerPolicy("BUS", 14.39).visible).toBe(false);
        expect(getTransitStopMarkerPolicy("BUS", 14.4)).toMatchObject({
            visible: true,
            maxPerLeg: 3,
            maxTotal: 6,
            markerSize: 13,
        });
        expect(getTransitStopMarkerPolicy("BUS", 15.5)).toMatchObject({
            maxPerLeg: 6,
            maxTotal: 12,
            markerSize: 14,
        });
        expect(getTransitStopMarkerPolicy("BUS", 17)).toMatchObject({
            maxPerLeg: 14,
            maxTotal: 24,
            markerSize: 15,
            showLabels: true,
            maxLabelsPerLeg: 4,
            maxLabelsTotal: 8,
        });
        expect(getTransitStopMarkerPolicy("BUS", 18)).toMatchObject({
            maxPerLeg: 20,
            maxTotal: 32,
            markerSize: 16,
            maxLabelsPerLeg: 7,
            maxLabelsTotal: 14,
        });

        expect(getTransitStopMarkerPolicy("SUBWAY", 15.1).visible).toBe(false);
        expect(getTransitStopMarkerPolicy("SUBWAY", 15.6)).toMatchObject({
            visible: true,
            maxPerLeg: 4,
            showLabels: false,
        });
        expect(getTransitStopMarkerPolicy("SUBWAY", 18)).toMatchObject({
            visible: true,
            markerSize: 15,
            showLabels: true,
            maxLabelsPerLeg: 6,
            maxLabelsTotal: 12,
        });
    });

    it("samples the whole route and always keeps the selected stop", () => {
        expect(sampleTransitStopIndices(20, 5)).toEqual([0, 5, 10, 14, 19]);
        expect(sampleTransitStopIndices(20, 5, 7)).toEqual([0, 7, 10, 14, 19]);
        expect(sampleTransitStopIndices(20, 1, 7)).toEqual([7]);
    });

    it("shares the global budget across every transit leg", () => {
        const allocations = allocateTransitStopMarkerCounts([30, 4, 12], 10);

        expect(allocations.reduce((sum, count) => sum + count, 0)).toBe(10);
        expect(allocations.every((count) => count >= 1)).toBe(true);
        expect(allocations[0]).toBeGreaterThan(allocations[1]);
    });

    it("spreads a very small budget across the route instead of taking only early legs", () => {
        expect(allocateTransitStopMarkerCounts([1, 1, 1, 1, 1], 3)).toEqual([1, 0, 1, 0, 1]);
    });
});

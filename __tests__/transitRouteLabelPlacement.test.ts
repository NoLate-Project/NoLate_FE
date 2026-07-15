import { selectTransitRouteLabelCoordinate } from "../src/modules/map/transitRouteLabelPlacement";

describe("selectTransitRouteLabelCoordinate", () => {
    it("places a straight route label near the route midpoint", () => {
        const coord = selectTransitRouteLabelCoordinate([
            { lat: 37.5, lng: 126.9 },
            { lat: 37.5, lng: 127.0 },
        ]);

        expect(coord?.lat).toBeCloseTo(37.5, 5);
        expect(coord?.lng).toBeCloseTo(126.95, 3);
    });

    it("keeps a loop route label away from clustered boarding and alighting markers", () => {
        const coord = selectTransitRouteLabelCoordinate([
            { lat: 37.5, lng: 126.9 },
            { lat: 37.53, lng: 126.91 },
            { lat: 37.5, lng: 126.905 },
            { lat: 37.49, lng: 126.94 },
        ]);

        expect(coord).toBeDefined();
        expect(coord!.lat).toBeGreaterThan(37.515);
        expect(coord!.lng).toBeGreaterThan(126.9);
    });
});

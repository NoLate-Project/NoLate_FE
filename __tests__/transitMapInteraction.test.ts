import {
    buildTransitLegInteractionId,
    buildTransitStopInteractionId,
    parseTransitMapInteractionId,
} from "../src/modules/map/transitMapInteraction";

describe("transitMapInteraction", () => {
    it("builds and parses a transit leg interaction", () => {
        const id = buildTransitLegInteractionId(3);
        expect(id).toBe("transit-leg:3");
        expect(parseTransitMapInteractionId(id)).toEqual({ kind: "leg", legIndex: 3 });
    });

    it("builds and parses an intermediate stop interaction", () => {
        const id = buildTransitStopInteractionId(2, 7);
        expect(id).toBe("transit-stop:2:7");
        expect(parseTransitMapInteractionId(id)).toEqual({ kind: "stop", legIndex: 2, stopIndex: 7 });
    });

    it("rejects unrelated or malformed marker ids", () => {
        expect(parseTransitMapInteractionId("route-origin")).toBeUndefined();
        expect(parseTransitMapInteractionId("transit-stop:1:-2")).toBeUndefined();
        expect(parseTransitMapInteractionId(undefined)).toBeUndefined();
    });
});

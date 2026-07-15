import {
    getTransitStopAccessLink,
    getTransitWalkAccessLink,
    joinTerminalWalkPathEndpoint,
    joinWalkPathEndpoint,
    resolveTransitRouteNodeCoordinate,
    resolveTransitStopAccessCoordinate,
    splitWalkPathAtDiscontinuities,
    TRANSIT_CONNECTOR_POLICY,
} from "../src/modules/map/transitRouteGeometry";

describe("transit route geometry", () => {
    const stop = { latitude: 37.555956, longitude: 126.972275 };

    it("uses the route anchor only when it is close to the physical stop", () => {
        const routeAnchor = { latitude: 37.55597, longitude: 126.97229 };
        expect(resolveTransitStopAccessCoordinate({
            stopCoordinate: stop,
            routeAnchorCoordinate: routeAnchor,
            snapDistanceMeters: 2,
        })).toEqual(routeAnchor);
    });

    it("keeps the physical stop when rail geometry is too far away", () => {
        const railAnchor = { latitude: 37.556442, longitude: 126.972333 };
        const anchor = {
            stopCoordinate: stop,
            routeAnchorCoordinate: railAnchor,
            snapDistanceMeters: 54,
        };
        expect(resolveTransitStopAccessCoordinate(anchor)).toEqual(stop);
        expect(resolveTransitRouteNodeCoordinate(anchor)).toEqual(railAnchor);
        expect(getTransitStopAccessLink(anchor)).toEqual([stop, railAnchor]);
    });

    it("keeps a route stop node at the physical POI when the provider mismatch is implausible", () => {
        const distantRouteAnchor = { latitude: 37.5571, longitude: 126.9728 };
        expect(resolveTransitRouteNodeCoordinate({
            stopCoordinate: stop,
            routeAnchorCoordinate: distantRouteAnchor,
            snapDistanceMeters: 135,
        })).toEqual(stop);
    });

    it("snaps a pedestrian endpoint within normal API coordinate error", () => {
        const path = [
            { lat: 37.5547, lng: 126.9706 },
            { lat: 37.5558, lng: 126.96879 },
        ];
        const endpoint = { lat: 37.5558, lng: 126.9689 };
        const result = joinWalkPathEndpoint(path, endpoint, "end");

        expect(result.action).toBe("snapped");
        expect(result.pathCoords[result.pathCoords.length - 1]).toEqual(endpoint);
    });

    it("rejects a long straight connector instead of inventing a walking path", () => {
        const path = [
            { lat: 37.5547, lng: 126.9706 },
            { lat: 37.555984, lng: 126.972145 },
        ];
        const railAnchor = { lat: 37.556442, lng: 126.972333 };
        const result = joinWalkPathEndpoint(path, railAnchor, "end");

        expect(result.action).toBe("rejected");
        expect(result.gapMeters).toBeGreaterThan(TRANSIT_CONNECTOR_POLICY.maxDirectConnectorMeters);
        expect(result.pathCoords).toEqual(path);
    });

    it("connects a short provider gap only at the final destination boundary", () => {
        const path = [
            { lat: 37.49842, lng: 127.02786 },
            { lat: 37.49805, lng: 127.02723 },
        ];
        const destination = { lat: 37.4979, lng: 127.0276 };

        expect(joinWalkPathEndpoint(path, destination, "end").action).toBe("rejected");

        const terminalResult = joinTerminalWalkPathEndpoint(path, destination, "end");
        expect(terminalResult.action).toBe("connected");
        expect(terminalResult.pathCoords.at(-1)).toEqual(destination);
        expect(terminalResult.gapMeters).toBeLessThanOrEqual(
            TRANSIT_CONNECTOR_POLICY.maxTerminalConnectorMeters
        );
    });

    it("still rejects a long direct connector at a terminal boundary", () => {
        const path = [
            { lat: 37.49842, lng: 127.02786 },
            { lat: 37.49805, lng: 127.02723 },
        ];
        const farDestination = { lat: 37.4974, lng: 127.0276 };

        expect(joinTerminalWalkPathEndpoint(path, farDestination, "end").action).toBe("rejected");
    });

    it("trims a provider tail that passes the destination and loops back", () => {
        const destination = { lat: 37.4979, lng: 127.0276 };
        const path = [
            { lat: 37.4985, lng: 127.0269 },
            { lat: 37.49791, lng: 127.02759 },
            { lat: 37.49818, lng: 127.02792 },
            { lat: 37.49805, lng: 127.02723 },
        ];

        const result = joinTerminalWalkPathEndpoint(path, destination, "end");

        expect(result.action).toBe("trimmed");
        expect(result.pathCoords.at(-1)).toEqual(destination);
        expect(result.pathCoords).not.toContainEqual(path[2]);
        expect(result.pathCoords).not.toContainEqual(path[3]);
    });

    it("separates a subway entrance gap from the actual walking geometry", () => {
        const walkPath = [
            { lat: 37.49794, lng: 127.02761 },
            { lat: 37.49842, lng: 127.02786 },
        ];
        const station = { lat: 37.49883, lng: 127.02786 };

        expect(getTransitWalkAccessLink(walkPath, station, "board")).toEqual([
            { latitude: walkPath[1].lat, longitude: walkPath[1].lng },
            { latitude: station.lat, longitude: station.lng },
        ]);
    });

    it("does not create an indoor access link outside the 24m to 80m policy", () => {
        const walkPath = [
            { lat: 37.49794, lng: 127.02761 },
            { lat: 37.49842, lng: 127.02786 },
        ];
        expect(getTransitWalkAccessLink(
            walkPath,
            { lat: 37.49855, lng: 127.02786 },
            "board"
        )).toBeUndefined();
        expect(getTransitWalkAccessLink(
            walkPath,
            { lat: 37.49925, lng: 127.02786 },
            "board"
        )).toBeUndefined();
    });

    it("splits a WALK path instead of drawing across a missing indoor section", () => {
        const path = [
            { lat: 37.555935, lng: 126.97213 },
            { lat: 37.55545, lng: 126.97197 },
            { lat: 37.55478, lng: 126.97198 },
            { lat: 37.55332, lng: 126.97244 },
            { lat: 37.553177, lng: 126.97266 },
            { lat: 37.55347, lng: 126.97297 },
        ];

        const parts = splitWalkPathAtDiscontinuities(path);

        expect(parts).toHaveLength(2);
        expect(parts[0].at(-1)).toEqual(path[2]);
        expect(parts[1][0]).toEqual(path[3]);
    });
});

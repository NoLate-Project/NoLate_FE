import {
    filterTransitConnectorRequestsForSuccessfulWalks,
    getTransitStopAccessLink,
    getTransitWalkAccessLink,
    joinTerminalWalkPathEndpoint,
    joinWalkPathEndpoint,
    repairLegacyOdsayWalkPath,
    resolveTransitWalkRequestEndpoints,
    resolveTransitRouteNodeCoordinate,
    resolveTransitStopAccessCoordinate,
    splitWalkPathAtDiscontinuities,
    stitchTransitWalkPathToAnchors,
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

    it("repairs the legacy ODsay E-F-T-E-tail-F ordering without guessing a new path", () => {
        const start = { lat: 37.5, lng: 127.0 };
        const repeatedStart = { lat: 37.5, lng: 127.0001 };
        const repeatedEnd = { lat: 37.5, lng: 127.0002 };
        const target = { lat: 37.5, lng: 127.0005 };
        const innerCorner = { lat: 37.5001, lng: 127.0003 };
        const legacy = [
            start,
            repeatedStart,
            repeatedEnd,
            target,
            repeatedStart,
            innerCorner,
            repeatedEnd,
        ];

        expect(repairLegacyOdsayWalkPath({
            pathCoords: legacy,
            expectedFrom: start,
            expectedTo: target,
            reportedDistanceMeters: 58,
        })).toEqual([
            start,
            repeatedStart,
            innerCorner,
            repeatedEnd,
            target,
        ]);
    });

    it("repairs the same legacy signature when ODsay reported the first WALK as zero metres", () => {
        const start = { lat: 37.5, lng: 127.0 };
        const repeatedStart = { lat: 37.5, lng: 127.0001 };
        const repeatedEnd = { lat: 37.5, lng: 127.0002 };
        const target = { lat: 37.5, lng: 127.0005 };
        const legacy = [
            start,
            repeatedStart,
            repeatedEnd,
            target,
            repeatedStart,
            repeatedEnd,
        ];

        expect(repairLegacyOdsayWalkPath({
            pathCoords: legacy,
            expectedFrom: start,
            expectedTo: target,
            reportedDistanceMeters: 0,
        })).toEqual([
            start,
            repeatedStart,
            repeatedEnd,
            target,
        ]);
    });

    it("leaves current and structurally-unmatched WALK geometry untouched", () => {
        const start = { lat: 37.5, lng: 127.0 };
        const middle = { lat: 37.5, lng: 127.0002 };
        const target = { lat: 37.5, lng: 127.0005 };
        const current = [start, middle, target];
        const unmatched = [
            start,
            { lat: 37.5001, lng: 127.0001 },
            { lat: 37.5002, lng: 127.0002 },
            target,
            { lat: 37.5003, lng: 127.0003 },
            { lat: 37.5004, lng: 127.0004 },
        ];

        expect(repairLegacyOdsayWalkPath({
            pathCoords: current,
            expectedFrom: start,
            expectedTo: target,
            reportedDistanceMeters: 45,
        })).toBe(current);
        expect(repairLegacyOdsayWalkPath({
            pathCoords: unmatched,
            expectedFrom: start,
            expectedTo: target,
            reportedDistanceMeters: 45,
        })).toBe(unmatched);
    });

    it("trims a long provider tail before an origin inside the terminal WALK path", () => {
        const origin = { lat: 37.5, lng: 127.0 };
        const destination = { lat: 37.5, lng: 127.0009 };
        const path = [
            { lat: 37.5, lng: 126.99945 },
            { lat: 37.5, lng: 126.9997 },
            origin,
            { lat: 37.5, lng: 127.00045 },
            destination,
        ];

        const stitched = stitchTransitWalkPathToAnchors(path, origin, destination, {
            terminalStart: true,
            terminalEnd: true,
        });

        expect(stitched[0]).toEqual(origin);
        expect(stitched).not.toContainEqual(path[0]);
        expect(stitched).not.toContainEqual(path[1]);
    });

    it("orients a reversed provider WALK path from its from anchor to its to anchor", () => {
        const from = { lat: 37.5, lng: 127.0 };
        const middle = { lat: 37.5002, lng: 127.0003 };
        const to = { lat: 37.5004, lng: 127.0006 };

        expect(stitchTransitWalkPathToAnchors([to, middle, from], from, to)).toEqual([
            from,
            middle,
            to,
        ]);
    });

    it("preserves a non-terminal WALK path when its nearest anchor gap is too long", () => {
        const path = [
            { lat: 37.5, lng: 127.0 },
            { lat: 37.5, lng: 127.0002 },
        ];
        const distantFrom = { lat: 37.5, lng: 126.9995 };

        expect(stitchTransitWalkPathToAnchors(path, distantFrom, undefined)).toBe(path);
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

    it("keeps consecutive WALK requests inside each leg instead of duplicating the whole ride gap", () => {
        const origin = { lat: 37.56, lng: 126.97 };
        const destination = { lat: 37.5, lng: 127.03 };
        const firstWalkEnd = { lat: 37.558, lng: 126.973 };
        const secondWalkStart = { lat: 37.5579, lng: 126.9731 };
        const rideBoard = { lat: 37.555, lng: 126.975 };

        expect(resolveTransitWalkRequestEndpoints({
            legIndex: 0,
            legCount: 3,
            origin,
            destination,
            legStart: origin,
            legEnd: firstWalkEnd,
            previousIsRide: false,
            nextIsRide: false,
        })).toEqual({
            from: origin,
            to: firstWalkEnd,
            snapFrom: true,
            snapTo: false,
        });

        expect(resolveTransitWalkRequestEndpoints({
            legIndex: 1,
            legCount: 3,
            origin,
            destination,
            legStart: secondWalkStart,
            legEnd: rideBoard,
            previousIsRide: false,
            nextIsRide: true,
            nextRideBoard: rideBoard,
        })).toEqual({
            from: secondWalkStart,
            to: rideBoard,
            snapFrom: false,
            snapTo: false,
        });
    });

    it("uses adjacent ride anchors for an isolated middle WALK request", () => {
        const origin = { lat: 37.56, lng: 126.97 };
        const destination = { lat: 37.5, lng: 127.03 };
        const alight = { lat: 37.54, lng: 126.99 };
        const board = { lat: 37.535, lng: 127.0 };

        expect(resolveTransitWalkRequestEndpoints({
            legIndex: 1,
            legCount: 3,
            origin,
            destination,
            legStart: { lat: 0, lng: 0 },
            legEnd: { lat: 1, lng: 1 },
            previousIsRide: true,
            previousRideAlight: alight,
            nextIsRide: true,
            nextRideBoard: board,
        })).toEqual({
            from: alight,
            to: board,
            snapFrom: false,
            snapTo: false,
        });
    });

    it("removes connector overlap only after its WALK request succeeds", () => {
        const requests = [
            { id: "route-walk-boundary-start" },
            { id: "route-walk-gap-0" },
            { id: "route-unrelated" },
        ];
        const failed = filterTransitConnectorRequestsForSuccessfulWalks(requests, {
            firstWalkRequestId: "route-walk-leg-0",
            successfulWalkRequestIds: new Set(),
            successfulWalkLegIndexes: new Set(),
            legKinds: ["WALK", "SUBWAY"],
        });
        const succeeded = filterTransitConnectorRequestsForSuccessfulWalks(requests, {
            firstWalkRequestId: "route-walk-leg-0",
            successfulWalkRequestIds: new Set(["route-walk-leg-0"]),
            successfulWalkLegIndexes: new Set([0]),
            legKinds: ["WALK", "SUBWAY"],
        });

        expect(failed).toEqual(requests);
        expect(succeeded).toEqual([{ id: "route-unrelated" }]);
    });

    it("preserves a real connector gap between consecutive WALK legs", () => {
        const requests = [{ id: "route-walk-gap-0" }];

        expect(filterTransitConnectorRequestsForSuccessfulWalks(requests, {
            successfulWalkRequestIds: new Set(["route-walk-leg-0", "route-walk-leg-1"]),
            successfulWalkLegIndexes: new Set([0, 1]),
            legKinds: ["WALK", "WALK", "SUBWAY"],
        })).toEqual(requests);
    });
});

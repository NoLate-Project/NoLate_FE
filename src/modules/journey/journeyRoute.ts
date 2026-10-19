import type { RoutePathCoord, TransitLegDetail, TransitPassStop } from "../map/routingService";

import type { NormalizedJourneyLeg, NormalizedJourneyRoute } from "./types";

const SUPPORTED_JOURNEY_LEG_KINDS = new Set<string>(["WALK", "BUS", "SUBWAY"]);

function cloneCoord(coord: RoutePathCoord | undefined): RoutePathCoord | undefined {
    return coord ? { ...coord } : undefined;
}

function clonePassStop(stop: TransitPassStop): TransitPassStop {
    return {
        ...stop,
        coord: cloneCoord(stop.coord),
    };
}

function cloneTransitLeg(leg: TransitLegDetail): TransitLegDetail {
    return {
        ...leg,
        startCoord: cloneCoord(leg.startCoord),
        endCoord: cloneCoord(leg.endCoord),
        passStops: leg.passStops?.map(clonePassStop),
        pathCoords: leg.pathCoords?.map((coord) => ({ ...coord })),
    };
}

export function isJourneyRideLeg(leg: Pick<TransitLegDetail, "kind">): boolean {
    return leg.kind === "BUS" || leg.kind === "SUBWAY";
}

/**
 * Copies and indexes the original transit route without merging or dropping real provider legs.
 * An empty route cannot drive a journey and is rejected at the boundary.
 */
export function normalizeJourneyRoute(legs: TransitLegDetail[]): NormalizedJourneyRoute {
    if (!Array.isArray(legs) || legs.length === 0) {
        throw new RangeError("Journey route must contain at least one transit leg.");
    }

    const normalizedLegs: NormalizedJourneyLeg[] = legs.map((leg, index) => {
        if (!leg || typeof leg !== "object") {
            throw new TypeError(`Journey route leg ${index} is invalid.`);
        }
        if (!SUPPORTED_JOURNEY_LEG_KINDS.has(leg.kind)) {
            throw new RangeError(
                `${String(leg.kind)} journey legs are not supported by the manual transit MVP.`,
            );
        }
        return {
            index,
            isRide: isJourneyRideLeg(leg),
            detail: cloneTransitLeg(leg),
        };
    });
    const rideLegIndexes = normalizedLegs
        .filter((leg) => leg.isRide)
        .map((leg) => leg.index);
    if (rideLegIndexes.length === 0) {
        throw new RangeError("Journey route must contain at least one bus or subway leg.");
    }

    return {
        legs: normalizedLegs,
        firstRideLegIndex: rideLegIndexes[0] ?? null,
        lastRideLegIndex: rideLegIndexes.at(-1) ?? null,
    };
}

export function getJourneyLeg(
    route: NormalizedJourneyRoute,
    legIndex: number,
): NormalizedJourneyLeg | undefined {
    return route.legs[legIndex];
}

export function findNextRideLegIndex(
    route: NormalizedJourneyRoute,
    afterLegIndex: number,
): number | null {
    return route.legs.find((leg) => leg.index > afterLegIndex && leg.isRide)?.index ?? null;
}

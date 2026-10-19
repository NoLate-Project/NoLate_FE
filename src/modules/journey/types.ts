import type { TransitLegDetail } from "../map/routingService";

export const JOURNEY_PHASES = [
    "READY",
    "WALKING_TO_STOP",
    "WAITING",
    "RIDING",
    "ALIGHTING",
    "TRANSFERRING",
    "FINAL_WALK",
    "ARRIVED",
    "STOPPED",
] as const;

export type JourneyPhase = (typeof JOURNEY_PHASES)[number];

export type JourneyIdentity = {
    sessionId: string;
    generation: number;
    routeRevision: number;
};

/**
 * A normalized leg keeps the complete provider-backed detail. The journey engine only adds
 * deterministic indexing/classification and never replaces it with the reduced RouteInfo model.
 */
export type NormalizedJourneyLeg = {
    index: number;
    isRide: boolean;
    detail: TransitLegDetail;
};

export type NormalizedJourneyRoute = {
    legs: readonly NormalizedJourneyLeg[];
    firstRideLegIndex: number | null;
    lastRideLegIndex: number | null;
};

export type JourneyProgress = JourneyIdentity & {
    sequence: number;
    phase: JourneyPhase;
    activeLegIndex: number;
    currentStopIndex: number | null;
    remainingStops: number | null;
    /**
     * Progress within the active leg. Manual mode does not invent a GPS-derived fraction, so this
     * remains 0 until the whole journey reaches ARRIVED.
     */
    legProgress: number;
    /** Completed-leg ratio derived locally from activeLegIndex; never presented as measured GPS. */
    overallProgress?: number;
    nextInstruction: string;
    observedAt: string;
    source: "MANUAL";
};

export type JourneyManualAction = JourneyIdentity & {
    type: "ADVANCE" | "STOP";
    /** The exact next sequence. Gaps, duplicates, and older values are ignored. */
    sequence: number;
    observedAt: string;
    source?: "MANUAL";
};

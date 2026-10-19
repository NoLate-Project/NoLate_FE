import {
    findNextRideLegIndex,
    getJourneyLeg,
} from "./journeyRoute";
import {
    buildJourneyNextInstruction,
    calculateJourneyOverallProgress,
} from "./journeyPresentation";
import type {
    JourneyIdentity,
    JourneyManualAction,
    JourneyPhase,
    JourneyProgress,
    NormalizedJourneyRoute,
} from "./types";

type JourneyStateTarget = {
    phase: JourneyPhase;
    activeLegIndex: number;
};

function normalizeIsoTimestamp(value: string): string | null {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function requireIdentity(identity: JourneyIdentity): void {
    if (!identity.sessionId.trim()) {
        throw new TypeError("Journey sessionId must not be blank.");
    }
    if (!Number.isSafeInteger(identity.generation) || identity.generation < 0) {
        throw new RangeError("Journey generation must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(identity.routeRevision) || identity.routeRevision < 0) {
        throw new RangeError("Journey routeRevision must be a non-negative safe integer.");
    }
}

function buildProgress(
    identity: JourneyIdentity,
    route: NormalizedJourneyRoute,
    sequence: number,
    phase: JourneyPhase,
    activeLegIndex: number,
    observedAt: string,
): JourneyProgress {
    return {
        ...identity,
        sequence,
        phase,
        activeLegIndex,
        currentStopIndex: null,
        remainingStops: null,
        legProgress: phase === "ARRIVED" ? 1 : 0,
        overallProgress: calculateJourneyOverallProgress(
            phase,
            activeLegIndex,
            route.legs.length,
        ),
        nextInstruction: buildJourneyNextInstruction(phase, route, activeLegIndex),
        observedAt,
        source: "MANUAL",
    };
}

export function createInitialJourneyProgress(
    identity: JourneyIdentity,
    route: NormalizedJourneyRoute,
    observedAt: string,
): JourneyProgress {
    requireIdentity(identity);
    if (route.legs.length === 0) {
        throw new RangeError("Journey route must contain at least one normalized leg.");
    }
    const normalizedObservedAt = normalizeIsoTimestamp(observedAt);
    if (!normalizedObservedAt) {
        throw new TypeError("Journey observedAt must be an ISO-8601 timestamp.");
    }
    return buildProgress(identity, route, 0, "READY", 0, normalizedObservedAt);
}

function isTerminal(phase: JourneyPhase): boolean {
    return phase === "ARRIVED" || phase === "STOPPED";
}

function actionMatchesProgress(
    progress: JourneyProgress,
    route: NormalizedJourneyRoute,
    action: JourneyManualAction,
): boolean {
    if (action.source !== undefined && action.source !== "MANUAL") return false;
    if (
        action.sessionId !== progress.sessionId
        || action.generation !== progress.generation
        || action.routeRevision !== progress.routeRevision
    ) return false;
    if (!Number.isSafeInteger(action.sequence) || action.sequence !== progress.sequence + 1) {
        return false;
    }
    if (!getJourneyLeg(route, progress.activeLegIndex)) return false;

    const actionTime = Date.parse(action.observedAt);
    const progressTime = Date.parse(progress.observedAt);
    return Number.isFinite(actionTime)
        && Number.isFinite(progressTime)
        && actionTime >= progressTime;
}

function nextJourneyState(
    progress: JourneyProgress,
    route: NormalizedJourneyRoute,
): JourneyStateTarget | null {
    const activeLeg = getJourneyLeg(route, progress.activeLegIndex);
    if (!activeLeg) return null;

    switch (progress.phase) {
        case "READY":
            if (route.firstRideLegIndex === null) return null;
            return route.firstRideLegIndex === 0
                ? { phase: "WAITING", activeLegIndex: 0 }
                : { phase: "WALKING_TO_STOP", activeLegIndex: 0 };

        case "WALKING_TO_STOP": {
            if (activeLeg.isRide) return null;
            const firstRideIndex = route.firstRideLegIndex;
            if (firstRideIndex === null) {
                return { phase: "FINAL_WALK", activeLegIndex: progress.activeLegIndex };
            }
            const nextLegIndex = progress.activeLegIndex + 1;
            return nextLegIndex < firstRideIndex
                ? { phase: "WALKING_TO_STOP", activeLegIndex: nextLegIndex }
                : { phase: "WAITING", activeLegIndex: firstRideIndex };
        }

        case "WAITING":
            return activeLeg.isRide
                ? { phase: "RIDING", activeLegIndex: progress.activeLegIndex }
                : null;

        case "RIDING":
            return activeLeg.isRide
                ? { phase: "ALIGHTING", activeLegIndex: progress.activeLegIndex }
                : null;

        case "ALIGHTING": {
            if (!activeLeg.isRide) return null;
            const nextLegIndex = progress.activeLegIndex + 1;
            if (nextLegIndex >= route.legs.length) {
                return { phase: "ARRIVED", activeLegIndex: progress.activeLegIndex };
            }
            const nextLeg = getJourneyLeg(route, nextLegIndex);
            if (nextLeg?.isRide) {
                return { phase: "WAITING", activeLegIndex: nextLegIndex };
            }
            const nextRideIndex = findNextRideLegIndex(route, progress.activeLegIndex);
            if (nextRideIndex === null) {
                return { phase: "FINAL_WALK", activeLegIndex: nextLegIndex };
            }
            return { phase: "TRANSFERRING", activeLegIndex: nextLegIndex };
        }

        case "TRANSFERRING": {
            if (activeLeg.isRide) {
                return { phase: "WAITING", activeLegIndex: progress.activeLegIndex };
            }
            const nextLegIndex = progress.activeLegIndex + 1;
            const nextLeg = getJourneyLeg(route, nextLegIndex);
            if (!nextLeg) {
                return { phase: "ARRIVED", activeLegIndex: progress.activeLegIndex };
            }
            return nextLeg.isRide
                ? { phase: "WAITING", activeLegIndex: nextLegIndex }
                : { phase: "TRANSFERRING", activeLegIndex: nextLegIndex };
        }

        case "FINAL_WALK": {
            if (activeLeg.isRide) return null;
            const nextLegIndex = progress.activeLegIndex + 1;
            const nextLeg = getJourneyLeg(route, nextLegIndex);
            if (!nextLeg) {
                return { phase: "ARRIVED", activeLegIndex: progress.activeLegIndex };
            }
            return nextLeg.isRide
                ? { phase: "WAITING", activeLegIndex: nextLegIndex }
                : { phase: "FINAL_WALK", activeLegIndex: nextLegIndex };
        }

        case "ARRIVED":
        case "STOPPED":
            return null;
    }
}

/**
 * Applies one fenced manual observation. Rejected, duplicate, stale, and terminal updates return
 * the exact existing object, which makes controller-side persistence and rendering dedupe cheap.
 */
export function transitionJourney(
    progress: JourneyProgress,
    route: NormalizedJourneyRoute,
    action: JourneyManualAction,
): JourneyProgress {
    if (isTerminal(progress.phase)) return progress;
    if (!actionMatchesProgress(progress, route, action)) return progress;

    const observedAt = normalizeIsoTimestamp(action.observedAt);
    if (!observedAt) return progress;
    const target = action.type === "STOP"
        ? { phase: "STOPPED" as const, activeLegIndex: progress.activeLegIndex }
        : nextJourneyState(progress, route);
    if (!target) return progress;

    return buildProgress(
        {
            sessionId: progress.sessionId,
            generation: progress.generation,
            routeRevision: progress.routeRevision,
        },
        route,
        action.sequence,
        target.phase,
        target.activeLegIndex,
        observedAt,
    );
}

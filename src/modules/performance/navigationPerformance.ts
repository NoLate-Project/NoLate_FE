export type NavigationCompletionKind = "frame" | "transition" | "next-navigation";

export type NavigationPerformanceEntry = {
    id: number;
    action: string;
    fromRoute: string;
    toRoute: string;
    requestedRoute?: string;
    routeReadyMs: number;
    totalMs: number;
    completedBy: NavigationCompletionKind;
    startedAtEpochMs: number;
};

type PendingNavigation = {
    id: number;
    action: string;
    fromRoute: string;
    requestedRoute?: string;
    startedAt: number;
    startedAtEpochMs: number;
    routeReadyAt?: number;
    toRoute?: string;
    transitionStarted: boolean;
    transitionEndedAt?: number;
};

type NavigationPerformanceSink = (entry: NavigationPerformanceEntry) => void;

const DUPLICATE_ACTION_WINDOW_MS = 50;
export const NAVIGATION_MEASUREMENT_TIMEOUT_MS = 10_000;

let nextId = 1;
let pendingNavigation: PendingNavigation | undefined;
let observedRoute = "/";
let performanceSink: NavigationPerformanceSink | undefined;

function monotonicNow() {
    const runtimePerformance = (
        globalThis as typeof globalThis & { performance?: { now?: () => number } }
    ).performance;
    if (typeof runtimePerformance?.now === "function") {
        return runtimePerformance.now();
    }
    return Date.now();
}

function normalizeRoute(route: string | undefined, fallback: string) {
    const trimmed = route?.trim();
    return trimmed || fallback;
}

function completePendingNavigation(
    completedBy: NavigationCompletionKind,
    completedAt: number,
) {
    const pending = pendingNavigation;
    if (!pending || pending.routeReadyAt === undefined || !pending.toRoute) return false;

    const safeCompletedAt = Math.max(completedAt, pending.routeReadyAt);
    const routeReadyMs = Math.max(0, Math.round(pending.routeReadyAt - pending.startedAt));
    const totalMs = Math.max(0, Math.round(safeCompletedAt - pending.startedAt));
    const isNoopGesture = pending.action === "GESTURE"
        && pending.fromRoute === pending.toRoute;

    if (
        isNoopGesture
        || routeReadyMs > NAVIGATION_MEASUREMENT_TIMEOUT_MS
        || totalMs > NAVIGATION_MEASUREMENT_TIMEOUT_MS
    ) {
        pendingNavigation = undefined;
        return false;
    }

    const entry: NavigationPerformanceEntry = {
        id: pending.id,
        action: pending.action,
        fromRoute: pending.fromRoute,
        toRoute: pending.toRoute,
        requestedRoute: pending.requestedRoute,
        routeReadyMs,
        totalMs,
        completedBy,
        startedAtEpochMs: pending.startedAtEpochMs,
    };

    pendingNavigation = undefined;
    try {
        performanceSink?.(entry);
    } catch {
        // 성능 수집 실패가 실제 화면 전환을 방해해서는 안 된다.
    }
    return true;
}

export function shouldMeasureNavigationAction(action: string) {
    return action !== "SET_PARAMS" && action !== "PRELOAD";
}

export function beginNavigationMeasurement(
    action: string,
    fromRoute = observedRoute,
    requestedRoute?: string,
    at = monotonicNow(),
    startedAtEpochMs = Date.now(),
) {
    if (pendingNavigation) {
        if (pendingNavigation.routeReadyAt !== undefined) {
            if (pendingNavigation.transitionStarted) {
                pendingNavigation = undefined;
            } else {
                completePendingNavigation("next-navigation", at);
            }
        } else if (at - pendingNavigation.startedAt <= DUPLICATE_ACTION_WINDOW_MS) {
            return pendingNavigation.id;
        } else {
            pendingNavigation = undefined;
        }
    }

    const id = nextId++;
    pendingNavigation = {
        id,
        action,
        fromRoute: normalizeRoute(fromRoute, observedRoute),
        requestedRoute: requestedRoute?.trim() || undefined,
        startedAt: at,
        startedAtEpochMs,
        transitionStarted: false,
    };
    return id;
}

export function markNavigationRouteReady(
    toRoute: string,
    at = monotonicNow(),
) {
    observedRoute = normalizeRoute(toRoute, observedRoute);
    const pending = pendingNavigation;
    if (!pending) return undefined;

    if (pending.routeReadyAt === undefined) {
        pending.routeReadyAt = at;
        pending.toRoute = observedRoute;
    }

    if (pending.transitionEndedAt !== undefined) {
        completePendingNavigation("transition", pending.transitionEndedAt);
    }
    return pending.id;
}

export function markNavigationTransitionStarted(
    fromRoute = observedRoute,
    at = monotonicNow(),
    startedAtEpochMs = Date.now(),
) {
    if (!pendingNavigation) {
        beginNavigationMeasurement(
            "GESTURE",
            fromRoute,
            undefined,
            at,
            startedAtEpochMs,
        );
    }
    if (pendingNavigation) pendingNavigation.transitionStarted = true;
    return pendingNavigation?.id;
}

export function markNavigationTransitionEnded(at = monotonicNow()) {
    if (!pendingNavigation) return false;
    pendingNavigation.transitionEndedAt = at;
    return completePendingNavigation("transition", at);
}

export function finishNavigationAfterFrames(
    pendingId: number,
    at = monotonicNow(),
) {
    if (
        !pendingNavigation ||
        pendingNavigation.id !== pendingId
    ) {
        return false;
    }
    return completePendingNavigation("frame", at);
}

export function discardNavigationMeasurement(pendingId: number) {
    if (!pendingNavigation || pendingNavigation.id !== pendingId) return false;
    pendingNavigation = undefined;
    return true;
}

export function setNavigationPerformanceSink(sink: NavigationPerformanceSink) {
    performanceSink = sink;
    return () => {
        if (performanceSink === sink) performanceSink = undefined;
    };
}

export function resetNavigationPerformanceForTests() {
    nextId = 1;
    pendingNavigation = undefined;
    observedRoute = "/";
    performanceSink = undefined;
}

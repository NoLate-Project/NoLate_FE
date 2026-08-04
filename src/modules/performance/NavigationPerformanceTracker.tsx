import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useNavigationContainerRef, usePathname } from "expo-router";

import {
    beginNavigationMeasurement,
    finishNavigationAfterFrames,
    markNavigationRouteReady,
    setNavigationPerformanceSink,
    shouldMeasureNavigationAction,
} from "./navigationPerformance";
import {
    activateNavigationPerformanceQueue,
    deactivateNavigationPerformanceQueue,
    drainNavigationPerformanceQueue,
    recordNavigationPerformance,
} from "./navigationPerformanceQueue";

function actionTarget(action: { payload?: unknown }) {
    if (!action.payload || typeof action.payload !== "object") return undefined;
    const payload = action.payload as { name?: unknown; path?: unknown };
    if (typeof payload.path === "string") return payload.path;
    if (typeof payload.name === "string" && payload.name !== "__root") return payload.name;
    return undefined;
}

function scheduleFrameCompletion(pendingId: number) {
    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
            finishNavigationAfterFrames(pendingId);
        });
    });
    return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
}

export default function NavigationPerformanceTracker() {
    const pathname = usePathname();
    const navigationRef = useNavigationContainerRef();
    const pathnameRef = useRef(pathname);

    useEffect(() => {
        const clearSink = setNavigationPerformanceSink((entry) => {
            recordNavigationPerformance(entry).catch(() => undefined);
        });
        activateNavigationPerformanceQueue().catch(() => undefined);
        const appStateSubscription = AppState.addEventListener("change", (state) => {
            if (state === "active") {
                activateNavigationPerformanceQueue().catch(() => undefined);
            } else {
                drainNavigationPerformanceQueue().catch(() => undefined);
            }
        });
        return () => {
            clearSink();
            appStateSubscription.remove();
            deactivateNavigationPerformanceQueue();
        };
    }, []);

    useEffect(() => {
        pathnameRef.current = pathname;
        const pendingId = markNavigationRouteReady(pathname);
        if (pendingId === undefined) return;
        return scheduleFrameCompletion(pendingId);
    }, [pathname]);

    useEffect(() => {
        const navigation = navigationRef.current;
        if (!navigation) return;

        return navigation.addListener("__unsafe_action__", ({ data }) => {
            const action = data.action;
            if (data.noop || !shouldMeasureNavigationAction(action.type)) return;
            beginNavigationMeasurement(
                action.type,
                pathnameRef.current,
                actionTarget(action),
            );
        });
    }, [navigationRef]);

    return null;
}

import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getCalendarSchedules } from "../../api/schedule";
import { useAuth } from "../auth/AuthContext";
import { subscribeScheduleMutation } from "../schedule/scheduleMutationEvents";
import type { ScheduleItem } from "../schedule/types";
import {
    activateNoLateWidgetSnapshotPublishing,
    clearNoLateWidgetSnapshot,
    getNoLateWidgetSnapshotGeneration,
    isNoLateWidgetSyncAvailable,
    isNoLateWidgetSnapshotPublishingEnabled,
    writeNoLateWidgetSnapshot,
} from "./nativeWidgetBridge";
import {
    buildNoLateWidgetSnapshot,
    getNoLateWidgetScheduleRange,
} from "./widgetSnapshot";

export function NoLateWidgetSync() {
    const { isAuthenticated, isLoading } = useAuth();
    const authenticatedRef = useRef(false);
    const refreshInFlightRef = useRef<Promise<void> | null>(null);
    const refreshQueuedRef = useRef(false);
    const refreshRequestRef = useRef<() => void>(() => undefined);
    const lastPayloadRef = useRef<string | null>(null);
    const lastPayloadGenerationRef = useRef<number | null>(null);
    authenticatedRef.current = !isLoading && isAuthenticated;

    const publish = useCallback(async (
        items: readonly ScheduleItem[],
        expectedGeneration: number,
    ) => {
        const snapshot = buildNoLateWidgetSnapshot(items);
        const payload = JSON.stringify(snapshot.schedules);
        if (
            lastPayloadGenerationRef.current === expectedGeneration &&
            lastPayloadRef.current === payload
        ) return;

        const written = await writeNoLateWidgetSnapshot(snapshot, expectedGeneration);
        if (written) {
            lastPayloadRef.current = payload;
            lastPayloadGenerationRef.current = expectedGeneration;
        }
    }, []);

    const refreshFromServer = useCallback(() => {
        if (
            !authenticatedRef.current ||
            !isNoLateWidgetSyncAvailable() ||
            !isNoLateWidgetSnapshotPublishingEnabled()
        ) return;

        if (refreshInFlightRef.current) {
            refreshQueuedRef.current = true;
            return;
        }

        const run = async () => {
            do {
                refreshQueuedRef.current = false;
                if (
                    !authenticatedRef.current ||
                    !isNoLateWidgetSnapshotPublishingEnabled()
                ) break;

                const generation = getNoLateWidgetSnapshotGeneration();
                try {
                    const { startAt, endAt } = getNoLateWidgetScheduleRange();
                    const refreshed = await getCalendarSchedules(startAt, endAt);
                    if (
                        !authenticatedRef.current ||
                        !isNoLateWidgetSnapshotPublishingEnabled() ||
                        generation !== getNoLateWidgetSnapshotGeneration()
                    ) continue;
                    await publish(refreshed, generation);
                } catch (error) {
                    // Keep the last good widget snapshot through transient network failures.
                    if (__DEV__ && process.env.NODE_ENV !== "test") {
                        console.warn("[widget] schedule refresh failed", error);
                    }
                }
            } while (
                refreshQueuedRef.current &&
                authenticatedRef.current &&
                isNoLateWidgetSnapshotPublishingEnabled()
            );
        };

        const request = run().finally(() => {
            if (refreshInFlightRef.current === request) {
                refreshInFlightRef.current = null;
            }
            if (
                refreshQueuedRef.current &&
                authenticatedRef.current &&
                isNoLateWidgetSnapshotPublishingEnabled()
            ) {
                refreshRequestRef.current();
            }
        });
        refreshInFlightRef.current = request;
    }, [publish]);
    refreshRequestRef.current = refreshFromServer;

    useEffect(() => {
        if (isLoading || !isNoLateWidgetSyncAvailable()) return undefined;
        if (isAuthenticated) {
            activateNoLateWidgetSnapshotPublishing();
            refreshFromServer();
            return undefined;
        }

        refreshQueuedRef.current = false;
        lastPayloadRef.current = null;
        lastPayloadGenerationRef.current = null;
        clearNoLateWidgetSnapshot().catch(() => undefined);
        return undefined;
    }, [isAuthenticated, isLoading, refreshFromServer]);

    useEffect(() => {
        if (!isAuthenticated || !isNoLateWidgetSyncAvailable()) return undefined;
        const appStateSubscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") refreshFromServer();
        });
        const unsubscribeMutation = subscribeScheduleMutation(() => {
            refreshFromServer();
        });

        return () => {
            appStateSubscription.remove();
            unsubscribeMutation();
        };
    }, [isAuthenticated, refreshFromServer]);

    return null;
}

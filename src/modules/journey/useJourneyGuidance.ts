import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";

import { finishJourneySession, getJourneySession, startJourneySession, updateJourneyProgress } from "../../api/journey";
import { useAuth } from "../auth/AuthContext";
import { subscribeAuthInvalidation } from "../auth/authStorage";
import { recoverDepartureAlarmsAfterMutation } from "../notification/departureAlarmMutationRecovery";
import { getOrCreatePushDeviceId } from "../notification/pushDeviceIdentity";
import { emitScheduleMutation } from "../schedule/scheduleMutationEvents";
import { isJourneyGuidanceEnabled } from "./journeyFeature";
import { createJourneySessionController, type JourneySessionViewState } from "./journeySessionController";

const EMPTY: JourneySessionViewState = { session: null, ready: false, pending: false, error: null };

export function useJourneyGuidance(scheduleId: string) {
    const { isAuthenticated, isLoading } = useAuth();
    const enabled = isJourneyGuidanceEnabled();
    const [state, setState] = useState(EMPTY);
    const controller = useRef<ReturnType<typeof createJourneySessionController> | null>(null);

    useEffect(() => {
        setState(EMPTY);
        if (!enabled || !isAuthenticated || isLoading) return;
        if (!/^[1-9]\d*$/.test(scheduleId)) {
            setState({ ...EMPTY, error: "올바른 일정에서 길안내를 열어 주세요." });
            return;
        }
        const current = createJourneySessionController({
            load: () => getJourneySession(scheduleId),
            start: (requestId, deviceId) => startJourneySession(scheduleId, requestId, deviceId),
            update: (id, request) => updateJourneyProgress(scheduleId, id, request),
            finish: (id, operation, request) => finishJourneySession(scheduleId, id, operation, request),
            // Token-storage failure only disables the optional Lock Screen projection.
            deviceId: () => Platform.OS === "ios" ? getOrCreatePushDeviceId().catch(() => undefined) : Promise.resolve(undefined),
            makeRequestId: () => Crypto.randomUUID(),
            now: () => Date.now(),
            onStarted: (session) => {
                emitScheduleMutation({ scheduleId, departure: { myDepartedAt: session.startedAt } });
                recoverDepartureAlarmsAfterMutation();
            },
            onFinished: () => { recoverDepartureAlarmsAfterMutation(); },
        }, setState);
        controller.current = current;
        const unsubscribeAuth = subscribeAuthInvalidation(() => {
            current.dispose();
            if (controller.current === current) controller.current = null;
            setState(EMPTY);
        });
        current.refresh();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") current.refresh();
        });
        // Only a visible foreground app polls; background location is deliberately not enabled.
        const timer = setInterval(() => {
            if (AppState.currentState === "active") current.refresh();
        }, 30_000);
        return () => {
            current.dispose();
            if (controller.current === current) controller.current = null;
            unsubscribeAuth();
            subscription.remove();
            clearInterval(timer);
        };
    }, [enabled, isAuthenticated, isLoading, scheduleId]);

    const start = useCallback(async () => { await controller.current?.start(); }, []);
    const advance = useCallback(async () => { await controller.current?.advance(); }, []);
    const stop = useCallback(async () => { await controller.current?.stop(); }, []);
    const refresh = useCallback(async () => { await controller.current?.refresh(); }, []);
    return { ...state, enabled, start, advance, stop, refresh };
}

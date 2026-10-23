import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { subscribeAuthInvalidation } from "../auth/authStorage";
import {
    getAutomaticJourneySnapshot, subscribeAutomaticJourney, type AutomaticJourneySnapshot,
} from "./automaticJourney";
import {
    getAutomaticJourneySyncState, prepareAutomaticJourneyTrial, restoreAutomaticJourneyTrial,
    retryAutomaticJourneySync, setAutomaticJourneySyncPaused, stopAutomaticJourneyTrial,
    subscribeAutomaticJourneySync, retryAutomaticJourneyStops, reconcileAutomaticJourneyCheckpoint,
} from "./automaticJourneyTrial";
import { assessJourneyRouteInput, type JourneyRouteAssessmentResult } from "./journeyRouteAssessment";
import type { JourneyRouteInput } from "./journeyRouteInput";
import type { JourneyAuthenticationSource } from "./automaticJourneyAuthentication";

export type AutomaticJourneyTrialScope = "LOCAL_ONLY" | "SANDBOX" | "AUTHENTICATED";

/** This is a UI guard, not authority: the coordinator and native bridge revalidate the same input. */
export function canPrepareAutomaticJourneyAssessment(
    input: JourneyRouteInput | null, scope: AutomaticJourneyTrialScope, result: JourneyRouteAssessmentResult | null, saved = false,
): boolean {
    if (!input || !result?.available || result.summary.routeRevision !== input.routeRevision
        || result.summary.context !== input.context || result.summary.provider !== input.provider) return false;
    if (scope === "LOCAL_ONLY") return input.context === "ROUTING_RESPONSE" && result.summary.eligibleDepartureLegIndex === 0;
    const summary = result.summary;
    const first = summary.legs[0];
    const savedReasons = summary.reasonCodes.length === 1 && summary.reasonCodes[0] === 'SAVED_ROUTE_REVALIDATION_REQUIRED'
        || input.provider === 'odsay' && input.serviceState === 'UNKNOWN' && summary.reasonCodes.length === 2
            && summary.reasonCodes.includes('SAVED_ROUTE_REVALIDATION_REQUIRED') && summary.reasonCodes.includes('ROUTE_SERVICE_UNVERIFIED');
    return ((scope === "SANDBOX" && input.context === "SYNTHETIC_FIXTURE" && summary.reasonCodes.length === 1
        && summary.reasonCodes[0] === 'SYNTHETIC_FIXTURE_ONLY') || (saved && input.context === "SAVED_ROUTE" && savedReasons)) && first?.index === 0 && first.kind === "WALK"
        && first.geometryUsable && typeof first.geometryLengthMeters === "number"
        && first.geometryLengthMeters >= 70 && first.geometryLengthMeters <= 100_000;
}

const safeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : null;
    return typeof message === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(message) ? message : "AUTOMATIC_TRIAL_UNAVAILABLE";
};

/** View lifetime owns reads/subscriptions only. Native owns every explicitly consented session. */
export function useAutomaticJourneyTrial(input: JourneyRouteInput | null, scope: AutomaticJourneyTrialScope, blocked = false, savedScheduleId?: string, authSource?: JourneyAuthenticationSource) {
    const [snapshot, setSnapshot] = useState<AutomaticJourneySnapshot | null>(null);
    const [sync, setSync] = useState(getAutomaticJourneySyncState);
    const [assessment, setAssessment] = useState<JourneyRouteAssessmentResult | null>(null);
    const [consented, setConsented] = useState(false);
    const [pending, setPending] = useState(false);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const mounted = useRef(false);
    const nativeRevision = useRef(0);
    const assessmentRevision = useRef(0);
    const assessedInput = useRef<JourneyRouteInput | null>(null);
    const busy = useRef(false);
    const refreshing = useRef(false);
    // A bounded input snapshot prevents a mutable selection from changing an in-flight request.
    const selectedInput = useMemo(() => input ? JSON.parse(JSON.stringify(input)) as JourneyRouteInput : null, [input]);
    const selectedRef = useRef(selectedInput);
    selectedRef.current = selectedInput;
    const scopeRef = useRef(scope);
    scopeRef.current = scope;

    useEffect(() => {
        ++assessmentRevision.current;
        assessedInput.current = null;
        setAssessment(null);
        setConsented(false);
        setErrorCode(null);
    }, [selectedInput, scope, savedScheduleId]);

    const refresh = useCallback(async () => {
        if (busy.current || refreshing.current) return;
        refreshing.current = true;
        const request = ++nativeRevision.current;
        try {
            const next = await getAutomaticJourneySnapshot();
            if (mounted.current && request === nativeRevision.current) setSnapshot(next);
        } catch (error) {
            if (mounted.current && request === nativeRevision.current) setErrorCode(safeError(error));
        } finally { refreshing.current = false; }
    }, []);

    useEffect(() => {
        if (blocked) return;
        let active = true;
        const check = async () => {
            try {
                await retryAutomaticJourneyStops(authSource);
                if (active && scope === 'AUTHENTICATED') {
                    await reconcileAutomaticJourneyCheckpoint(authSource);
                    if (active) await refresh();
                }
            } catch { /* Coordinator exposes bounded diagnostic codes, never raw failures. */ }
        };
        check();
        const foreground = AppState.addEventListener('change', state => { if (state === 'active') check(); });
        const retry = setInterval(() => {
            if (AppState.currentState === 'active' && getAutomaticJourneySyncState().checkpointState === 'WAITING') check();
        }, 5000);
        return () => { active = false; foreground.remove(); clearInterval(retry); };
    }, [authSource, blocked, scope, refresh]);

    useEffect(() => {
        mounted.current = true;
        const detachNative = subscribeAutomaticJourney(next => {
            ++nativeRevision.current;
            if (mounted.current) setSnapshot(next);
        });
        const detachSync = subscribeAutomaticJourneySync(next => {
            if (mounted.current) setSync(next);
        });
        const detachAuth = subscribeAuthInvalidation(() => {
            ++assessmentRevision.current;
            assessedInput.current = null;
            const request = ++nativeRevision.current;
            setConsented(false);
            setAssessment(null);
            // This is account invalidation, not screen cleanup. The coordinator also fences
            // invalidation while no screen is mounted and while a preparation is in flight.
            return stopAutomaticJourneyTrial().then(next => {
                if (mounted.current && request === nativeRevision.current) setSnapshot(next);
            }).catch(() => undefined);
        });
        const appState = AppState.addEventListener("change", next => {
            if (next === "active") refresh().catch(() => undefined);
        });
        refresh().catch(() => undefined);
        // Event delivery can be missed while JS is suspended or its module is reloaded.
        // A foreground read reconciles the view; it never arms, restores or changes a phase.
        const snapshotTimer = setInterval(() => {
            if (AppState.currentState === 'active') refresh().catch(() => undefined);
        }, 2000);
        return () => {
            mounted.current = false;
            detachNative();
            detachSync();
            detachAuth();
            appState.remove();
            clearInterval(snapshotTimer);
            // Closing or selecting another route must not stop an already consented session.
        };
    }, [refresh]);

    const running = snapshot?.status === "ARMED" || snapshot?.status === "ACTIVE";
    const eligible = assessedInput.current === selectedInput && canPrepareAutomaticJourneyAssessment(selectedInput, scope, assessment, !!savedScheduleId);
    const available = snapshot?.enabled === true && !blocked;
    const canAssess = available && !!selectedInput && !pending;
    const canOptIn = available && eligible && consented && !running && !pending;
    const canPrepare = canOptIn && snapshot?.pendingDeparture !== true && (scope !== 'AUTHENTICATED' || snapshot?.checkpointAvailable !== true)
        && !['CHECKING', 'WAITING', 'BLOCKED'].includes(sync.checkpointState ?? 'NONE');

    const assess = async () => {
        if (!canAssess || busy.current || !selectedInput) return;
        busy.current = true;
        const request = ++assessmentRevision.current;
        assessedInput.current = null;
        const requestedInput = selectedInput;
        const requestedScope = scope;
        setPending(true);
        setAssessment(null);
        setErrorCode(null);
        try {
            const next = await assessJourneyRouteInput(requestedInput);
            if (mounted.current && request === assessmentRevision.current
                && selectedRef.current === requestedInput && scopeRef.current === requestedScope) {
                assessedInput.current = requestedInput;
                setAssessment(next);
            }
        } catch (error) {
            if (mounted.current && request === assessmentRevision.current) setErrorCode(safeError(error));
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };

    const runNative = async (operation: () => Promise<AutomaticJourneySnapshot>) => {
        if (busy.current) return;
        busy.current = true;
        const request = ++nativeRevision.current;
        setPending(true);
        setErrorCode(null);
        try {
            const next = await operation();
            if (mounted.current && request === nativeRevision.current) setSnapshot(next);
        } catch (error) {
            if (mounted.current) setErrorCode(safeError(error));
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };

    return {
        snapshot, sync, assessment, consented, pending, errorCode, running, eligible, canAssess, canPrepare,
        canRestore: canOptIn && snapshot?.checkpointAvailable === true,
        setConsented: (value: boolean) => { if (!pending && !running && available) setConsented(value); },
        assess,
        prepare: async () => {
            if (canPrepare && selectedInput) await runNative(() => prepareAutomaticJourneyTrial(selectedInput, scope, savedScheduleId, authSource));
        },
        restore: async () => {
            if (canOptIn && selectedInput && snapshot?.checkpointAvailable) await runNative(() => restoreAutomaticJourneyTrial(selectedInput, authSource));
        },
        stop: async () => {
            if (snapshot?.enabled && !pending) await runNative(stopAutomaticJourneyTrial);
        },
        retrySync: async () => {
            if (scope !== "SANDBOX" || snapshot?.enabled !== true || snapshot.syncScope !== "SANDBOX" || pending) return;
            try { await retryAutomaticJourneySync(); }
            catch (error) { if (mounted.current) setErrorCode(safeError(error)); }
        },
        setSyncPaused: (value: boolean) => { if (scope === "SANDBOX" && snapshot?.enabled) setAutomaticJourneySyncPaused(value); },
        refresh,
    };
}

import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { automaticRecord, getAutomaticJourneySnapshot, subscribeAutomaticJourney, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from "./automaticJourney";
import { getAutomaticJourneyTrialBinding, getAutomaticJourneyTrialInput, subscribeAutomaticJourneySync } from "./automaticJourneyTrial";
import type { JourneyRouteInput } from "./journeyRouteInput";
import { presentSavedJourneyGuidance } from "./savedJourneyGuidance";
import { presentSavedJourneyWalkingMap } from './savedJourneyWalkingMap';

export function presentSavedJourneyPosition(snapshot: AutomaticJourneySnapshot | null, binding: AutomaticJourneyBinding | null, now: number) {
    const guidance = presentSavedJourneyGuidance(snapshot, binding, now);
    const position = automaticRecord(snapshot?.guidancePosition);
    const raw = snapshot?.guidance;
    if (!guidance?.fresh || !position || position.observedAt !== raw?.observedAt || position.validUntil !== raw?.validUntil
        || typeof position.latitude !== "number" || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > 90
        || typeof position.longitude !== "number" || !Number.isFinite(position.longitude) || Math.abs(position.longitude) > 180
        || typeof position.accuracyMeters !== "number" || !Number.isFinite(position.accuracyMeters)
        || position.accuracyMeters < 0 || position.accuracyMeters > 35) return null;
    return { latitude: position.latitude, longitude: position.longitude };
}

/** Reads the engine only; mounting/unmounting never requests location or starts/stops a session. */
export function useSavedJourneyPosition(input: JourneyRouteInput | null, scheduleId: string) {
    return useSavedJourneyMapView(input, scheduleId).position;
}

/** One read-only subscription for current position and separately owned walking geometry. */
export function useSavedJourneyMapView(input: JourneyRouteInput | null, scheduleId: string) {
    const [snapshot, setSnapshot] = useState<AutomaticJourneySnapshot | null>(null);
    const [now, setNow] = useState(Date.now() / 1000);
    const [, redraw] = useState(0);
    const enabled = __DEV__ && Platform.OS === "ios" && !!input;
    useEffect(() => {
        setSnapshot(null);
        if (!enabled) return;
        let active = true, revision = 0;
        const unsubscribe = subscribeAutomaticJourney(value => { ++revision; if (active) setSnapshot(value); });
        const sync = subscribeAutomaticJourneySync(() => { if (active) redraw(value => value + 1); });
        getAutomaticJourneySnapshot().then(value => { if (active && revision === 0) setSnapshot(value); }).catch(() => undefined);
        const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
        return () => { active = false; unsubscribe(); sync(); clearInterval(timer); };
    }, [enabled, input, scheduleId]);
    const binding = enabled && input ? getAutomaticJourneyTrialBinding(input) : null;
    const matched = binding?.scheduleId === scheduleId ? binding : null;
    const admitted = enabled && input ? getAutomaticJourneyTrialInput(input) : null;
    return {
        position: matched ? presentSavedJourneyPosition(snapshot, matched, now) : null,
        walkingPaths: matched ? presentSavedJourneyWalkingMap(snapshot, matched, admitted, now) : [],
    };
}

import { freshLocationCourse, updateLocationCourse, type LocationCourse } from '../map/locationCourse';
import { useEffect, useState } from "react";
import { automaticRecord, getAutomaticJourneySnapshot, isAutomaticJourneyDevelopment, subscribeAutomaticJourney, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from "./automaticJourney";
import { getAutomaticJourneyTrialBinding, getAutomaticJourneyTrialInput, getAutomaticJourneyTrialDisplayRoute, subscribeAutomaticJourneySync } from "./automaticJourneyTrial";
import type { JourneyRouteInput } from "./journeyRouteInput";
import { presentSavedJourneyRoutePosition } from './savedJourneyRoutePosition';
import { presentSavedJourneyGuidance } from "./savedJourneyGuidance";
import { presentSavedJourneyWalkingMap } from './savedJourneyWalkingMap';
import { trustedOffRouteFix } from './journeyRerouteEligibility';

export function presentSavedJourneyPosition(snapshot: AutomaticJourneySnapshot | null, binding: AutomaticJourneyBinding | null, now: number, input?: JourneyRouteInput | null) {
    const guidance = presentSavedJourneyGuidance(snapshot, binding, now);
    if (guidance?.subwaySegment && (!input || !presentSavedJourneyRoutePosition(snapshot, binding, input, now))) return null;
    const position = automaticRecord(snapshot?.guidancePosition);
    const raw = snapshot?.guidance;
    if (!guidance || !position || !binding) return null;
    if (guidance.phase === 'READY') {
        const {observedAt, validUntil} = position;
        if (!Number.isFinite(now) || typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt < binding.preparedAtEpochSeconds
            || observedAt > now || validUntil !== Math.min(binding.expiresAtEpochSeconds, observedAt + 15) || now >= validUntil) return null;
    } else if (!guidance.fresh || position.observedAt !== raw?.observedAt || position.validUntil !== raw?.validUntil) return null;
    if (typeof position.latitude !== "number" || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > 90
        || typeof position.longitude !== "number" || !Number.isFinite(position.longitude) || Math.abs(position.longitude) > 180
        || typeof position.accuracyMeters !== "number" || !Number.isFinite(position.accuracyMeters)
        || position.accuracyMeters < 0 || position.accuracyMeters > 35) return null;
    return { latitude: position.latitude, longitude: position.longitude };
}

/** A separate, short-lived GPS dot on the map while the route projection is rejected. */
export function presentSavedJourneyOffRouteLocation(snapshot: AutomaticJourneySnapshot | null,
    binding: AutomaticJourneyBinding | null, now: number) {
    const fix = trustedOffRouteFix(snapshot, binding, now);
    if (!fix) return null;
    return { latitude: fix.latitude, longitude: fix.longitude };
}

/** Reads the engine only; mounting/unmounting never requests location or starts/stops a session. */
export function useSavedJourneyPosition(input: JourneyRouteInput | null, scheduleId: string) {
    return useSavedJourneyMapView(input, scheduleId).position;
}

/** One read-only subscription for current position and separately owned walking geometry. */
export function useSavedJourneyMapView(input: JourneyRouteInput | null, scheduleId: string) {
    const [snapshot, setSnapshot] = useState<AutomaticJourneySnapshot | null>(null);
    const [, redraw] = useState(0);
    const enabled = !!input && isAutomaticJourneyDevelopment();
    useEffect(() => {
        setSnapshot(null);
        if (!enabled) return;
        let active = true, revision = 0;
        const unsubscribe = subscribeAutomaticJourney(value => { ++revision; if (active) setSnapshot(value); });
        const sync = subscribeAutomaticJourneySync(() => { if (active) redraw(value => value + 1); });
        getAutomaticJourneySnapshot().then(value => { if (active && revision === 0) setSnapshot(value); }).catch(() => undefined);
        const timer = setInterval(() => redraw(value => value + 1), 1000);
        return () => { active = false; unsubscribe(); sync(); clearInterval(timer); };
    }, [enabled, input, scheduleId]);
    const binding = enabled && input ? getAutomaticJourneyTrialBinding(input) : null;
    const matched = binding?.scheduleId === scheduleId ? binding : null;
    const admitted = enabled && input ? getAutomaticJourneyTrialInput(input) : null;
    const display = enabled && input && matched ? getAutomaticJourneyTrialDisplayRoute(input, scheduleId) : null;
    const now = Date.now() / 1000;
    const position = matched ? presentSavedJourneyPosition(snapshot, matched, now, admitted ?? input) : null;
    // Station/segment positions can come from the train observation. Only use
    // accepted passenger fixes on map-followed legs to orient the person's marker.
    const phase = snapshot?.guidance?.phase;
    const followsPassenger = ['READY', 'WALKING_TO_STOP', 'APPROACHING_STOP', 'TRANSFER_WALK', 'FINAL_WALK', 'RIDING'].includes(String(phase));
    const fix = followsPassenger && !snapshot?.guidance?.subwaySegment && position ? snapshot?.guidancePosition : null;
    const latitude = position?.latitude, longitude = position?.longitude;
    const observedAt = fix?.observedAt, accuracy = fix?.accuracyMeters;
    const scope = matched && fix ? JSON.stringify([matched.sessionId, matched.generation, matched.routeRevision,
        matched.routeInputDigest, snapshot?.guidance?.activeLegIndex, phase === 'RIDING']) : null;
    const [motion, setMotion] = useState<{scope: string; course: LocationCourse} | null>(null);
    useEffect(() => {
        if (!scope || latitude == null || longitude == null || typeof observedAt !== 'number' || typeof accuracy !== 'number') {
            setMotion(null);
            return;
        }
        setMotion(previous => {
            const course = updateLocationCourse(previous?.scope === scope ? previous.course : null,
                { latitude, longitude, accuracyMeters: accuracy, observedAtMs: observedAt * 1000 });
            return previous?.scope === scope && previous.course === course ? previous : {scope, course};
        });
    }, [scope, latitude, longitude, observedAt, accuracy]);
    const courseDegrees = scope && motion?.scope === scope ? freshLocationCourse(motion.course, now * 1000) : null;
    return {
        guidanceActive: !!matched && (!snapshot || (snapshot.sessionId === matched.sessionId &&
            (snapshot.status === 'ARMED' || snapshot.status === 'ACTIVE'))),
        position,
        courseDegrees,
        walkingScope: phase === 'RIDING' ? null : scope,
        offRouteLocation: matched ? presentSavedJourneyOffRouteLocation(snapshot, matched, now) : null,
        walkingPaths: matched ? presentSavedJourneyWalkingMap(snapshot, matched, admitted, now) : [],
        rerouteDisplay: display,
    };
}

import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from './automaticJourney';
import type { JourneyRouteInput } from './journeyRouteInput';
import { presentSavedJourneyGuidance } from './savedJourneyGuidance';
import { presentSavedJourneyRouteLayout } from './savedJourneyRouteLayout';

export type SavedJourneyRoutePosition = { legIndex: number; legProgress: number; barFraction: number; waiting: boolean };
/** Same first-walk/boundary/v2 confirmed-ride policy as native. No clock-driven movement. */
export function presentSavedJourneyRoutePosition(snapshot: AutomaticJourneySnapshot | null,
    binding: AutomaticJourneyBinding | null, input: JourneyRouteInput, now: number): SavedJourneyRoutePosition | null {
    const view = presentSavedJourneyGuidance(snapshot, binding, now);
    const legs = input.legs;
    if (!Number.isFinite(now) || !view?.fresh || view.progress == null || !Array.isArray(legs) || !legs.length || legs.length > 32
        || input.routeRevision !== binding?.routeRevision || legs[0].kind !== 'WALK'
        || legs.some((leg, index) => leg.index !== index || !['WALK', 'BUS', 'SUBWAY', 'ETC', 'UNKNOWN'].includes(leg.kind))) return null;
    const layout = presentSavedJourneyRouteLayout(snapshot, binding, input);
    if (view.subway) {
        const i = snapshot?.guidance?.activeLegIndex, current = view.subway;
        if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 1 || i >= legs.length || legs[i].kind !== 'SUBWAY'
            || legs[i].stops.length !== current.totalStops || legs[i].stops[current.currentStopIndex]?.name !== current.currentStopName
            || (current.remainingStops > 0 && legs[i].stops[current.currentStopIndex+1]?.name !== current.nextStopName)) return null;
        return {legIndex:i,legProgress:view.progress,waiting:false,
            barFraction:layout.legs.slice(0,i).reduce((sum,leg)=>sum+leg.fraction,0)+view.progress*layout.legs[i].fraction};
    }
    if (snapshot?.guidance?.schemaVersion === 6 || snapshot?.guidance?.schemaVersion === 7) {
        const i = snapshot.guidance.activeLegIndex;
        if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 2 || i >= legs.length
            || legs.length < 5 || legs.length > 31 || legs.length % 2 !== 1
            || legs.some((leg,index) => index % 2 === 0 ? leg.kind !== 'WALK' : !['BUS','SUBWAY'].includes(leg.kind))) return null;
        const metadata = automaticRecord(snapshot.guidanceRoute), routeLegs = metadata?.legs;
        if (!metadata || !binding || ['sessionId','scheduleId','generation','routeRevision','routeInputDigest']
            .some(key => metadata[key] !== binding[key as keyof AutomaticJourneyBinding]) || !Array.isArray(routeLegs) || routeLegs.length !== legs.length
            || routeLegs.some((raw,index) => { const leg=automaticRecord(raw);return leg?.index !== index || leg.kind !== legs[index].kind; })) return null;
        let positionIndex = i;
        const waiting = view.phase === 'WAITING';
        if (view.phase === 'RIDING') { if (i % 2 !== 1 || legs[i].kind !== 'BUS') return null; }
        else {
            if (waiting) { if (i % 2 !== 1 || legs[i].kind !== 'BUS' || view.progress !== 1) return null; positionIndex = i - 1; }
            else if (view.phase === 'FINAL_WALK') { if (i !== legs.length - 1 || legs[i - 1].kind !== 'BUS') return null; }
            else if (['WALKING_TO_STOP','APPROACHING_STOP'].includes(view.phase)) { if (i % 2 !== 0 || i >= legs.length - 1 || legs[i + 1].kind !== 'BUS') return null; }
            else return null;
            const length = automaticRecord(routeLegs[positionIndex])?.walkingLengthMeters;
            if (typeof length !== 'number' || !Number.isFinite(length) || length < (view.phase === 'FINAL_WALK' ? 70 : 1) || length > 10_000) return null;
        }
        return { legIndex:positionIndex,legProgress:view.progress,waiting,
            barFraction:layout.legs.slice(0,positionIndex).reduce((sum,leg)=>sum+leg.fraction,0) + view.progress * layout.legs[positionIndex].fraction };
    }
    if (view.phase === 'TRANSFER_WALK') {
        const i = snapshot?.guidance?.activeLegIndex;
        if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 2 || i % 2 !== 0 || i + 1 >= legs.length - 1
            || legs.length < 5 || legs.length % 2 !== 1 || legs[i - 1]?.kind !== 'BUS'
            || legs.some((leg,index) => index % 2 === 0 ? leg.kind !== 'WALK' : !['BUS','SUBWAY'].includes(leg.kind))) return null;
        const metadata = automaticRecord(snapshot?.guidanceRoute), routeLegs = metadata?.legs;
        if (!metadata || !binding || ['sessionId','scheduleId','generation','routeRevision','routeInputDigest']
            .some(key => metadata[key] !== binding[key as keyof AutomaticJourneyBinding]) || !Array.isArray(routeLegs) || routeLegs.length !== legs.length
            || routeLegs.some((raw,index) => { const leg=automaticRecord(raw);return leg?.index !== index || leg.kind !== legs[index].kind; })) return null;
        const length = automaticRecord(routeLegs[i])?.walkingLengthMeters;
        if (typeof length !== 'number' || !Number.isFinite(length) || length < 1 || length > 10_000) return null;
        return {legIndex:i,legProgress:view.progress,barFraction:layout.legs.slice(0,i).reduce((sum,leg)=>sum+leg.fraction,0)
            + view.progress * layout.legs[i].fraction,waiting:false};
    }
    if (view.phase === 'FINAL_WALK') {
        if (legs.length !== 3 || legs[1]?.kind !== 'BUS' || legs[2]?.kind !== 'WALK' || snapshot?.guidance?.activeLegIndex !== 2) return null;
        const metadata = automaticRecord(snapshot?.guidanceRoute);
        const routeLegs = metadata?.legs;
        if (!metadata || !binding || ['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest']
            .some(key => metadata[key] !== binding[key as keyof AutomaticJourneyBinding]) || !Array.isArray(routeLegs) || routeLegs.length !== 3
            || routeLegs.some((raw, index) => { const leg = automaticRecord(raw); return leg?.index !== index || leg.kind !== legs[index].kind; })) return null;
        const length = automaticRecord(routeLegs[2])?.walkingLengthMeters;
        if (typeof length !== 'number' || !Number.isFinite(length) || length < 70 || length > 10_000) return null;
        return { legIndex: 2, legProgress: view.progress,
            barFraction: layout.legs[0].fraction + layout.legs[1].fraction + view.progress * layout.legs[2].fraction, waiting: false };
    }
    if (view.phase === 'RIDING') {
        if (legs[1]?.kind !== 'BUS' || snapshot?.guidance?.activeLegIndex !== 1) return null;
        return { legIndex: 1, legProgress: view.progress, barFraction: layout.legs[0].fraction + view.progress * layout.legs[1].fraction, waiting: false };
    }
    const waiting = view.phase === 'WAITING';
    if (waiting) {
        if (!['BUS','SUBWAY'].includes(legs[1]?.kind) || snapshot?.guidance?.activeLegIndex !== 1 || view.progress !== 1) return null;
    } else if (!['WALKING_TO_STOP', 'APPROACHING_STOP'].includes(view.phase) || snapshot?.guidance?.activeLegIndex !== 0) return null;
    return { legIndex: 0, legProgress: view.progress,
        barFraction: view.progress * layout.legs[0].fraction, waiting };
}

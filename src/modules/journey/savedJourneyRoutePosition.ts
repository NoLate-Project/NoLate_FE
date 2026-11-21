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
    if (view.subway || view.subwaySegment) {
        const i = snapshot?.guidance?.activeLegIndex;
        if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 1 || i >= legs.length || legs[i].kind !== 'SUBWAY') return null;
        const stops = legs[i].stops;
        const station = view.subway, segment = view.subwaySegment;
        if (station && (stops.length !== station.totalStops || stops[station.currentStopIndex]?.name !== station.currentStopName
            || (station.remainingStops > 0 && stops[station.currentStopIndex + 1]?.name !== station.nextStopName))) return null;
        if (segment && (stops.length !== segment.totalStops || stops[segment.fromStopIndex]?.name !== segment.fromStopName
            || stops[segment.fromStopIndex + 1]?.name !== segment.toStopName)) return null;
        return {legIndex:i,legProgress:view.progress,waiting:false,
            barFraction:layout.legs.slice(0,i).reduce((sum,leg)=>sum+leg.fraction,0)+view.progress*layout.legs[i].fraction};
    }
    const indexed = snapshot?.guidance?.schemaVersion === 6 || snapshot?.guidance?.schemaVersion === 7;
    if (indexed || view.phase === 'TRANSFER_WALK' || view.phase === 'FINAL_WALK') {
        const index = snapshot?.guidance?.activeLegIndex;
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 2 || index >= legs.length
            || legs.length > 31 || legs.length % 2 === 0 || (indexed && legs.length < 5)
            || legs.some((leg, i) => i % 2 === 0 ? leg.kind !== 'WALK' : !['BUS', 'SUBWAY'].includes(leg.kind))) return null;
        const metadata = automaticRecord(snapshot?.guidanceRoute), routeLegs = metadata?.legs;
        if (!metadata || !binding || ['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest']
            .some(key => metadata[key] !== binding[key as keyof AutomaticJourneyBinding]) || !Array.isArray(routeLegs)
            || routeLegs.length !== legs.length || routeLegs.some((raw, i) => {
                const leg = automaticRecord(raw);
                return leg?.index !== i || leg.kind !== legs[i].kind;
            })) return null;

        const waiting = view.phase === 'WAITING';
        const positionIndex = waiting ? index - 1 : index;
        if (view.phase === 'RIDING') {
            // A train ride always carries the station observation checked above (v8).
            if (legs[index].kind !== 'BUS') return null;
        } else {
            if (waiting && (index % 2 === 0 || view.progress !== 1)) return null;
            if (legs[positionIndex].kind !== 'WALK') return null;
            if (view.phase === 'FINAL_WALK' ? index !== legs.length - 1
                : !waiting && (!['WALKING_TO_STOP', 'APPROACHING_STOP', 'TRANSFER_WALK'].includes(view.phase)
                    || index >= legs.length - 1)) return null;
            const length = automaticRecord(routeLegs[positionIndex])?.walkingLengthMeters;
            if (typeof length !== 'number' || !Number.isFinite(length)
                || length < (view.phase === 'FINAL_WALK' ? 70 : 1) || length > 10_000) return null;
            if (snapshot?.guidance?.schemaVersion === 7) {
                const arrival = automaticRecord(snapshot.guidance.arrival);
                const kind = arrival?.kind ?? 'BUS';
                if (kind !== legs[positionIndex + 1].kind) return null;
            }
        }
        return { legIndex: positionIndex, legProgress: view.progress, waiting,
            barFraction: layout.legs.slice(0, positionIndex).reduce((sum, leg) => sum + leg.fraction, 0)
                + view.progress * layout.legs[positionIndex].fraction };
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

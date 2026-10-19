import { useEffect, useState } from 'react';
import { getAutomaticJourneySnapshot, subscribeAutomaticJourney, type AutomaticJourneySnapshot } from './automaticJourney';
import { useSavedJourneyBinding } from './useSavedJourneyBinding';
import type { JourneyRouteInput } from './journeyRouteInput';
import { presentSavedJourneyGuidance } from './savedJourneyGuidance';
import { presentSavedJourneyRoutePosition } from './savedJourneyRoutePosition';
import { presentSavedJourneyStage } from './savedJourneyStage';
import { presentSavedJourneyRouteLayout } from './savedJourneyRouteLayout';
import {getAutomaticJourneyTrialInput} from './automaticJourneyTrial';

/** Read-only. No location/HTTP/phase changes, including on mounting and unmounting. */
export function useSavedJourneyGuidanceView(input: JourneyRouteInput | null, scheduleId: string) {
    const binding = useSavedJourneyBinding(input, scheduleId);
    const eligible = binding?.savedRouteValidated === true && binding.guidanceEnabled === true && binding.scheduleId === scheduleId;
    const [snapshot, setSnapshot] = useState<AutomaticJourneySnapshot | null>(null);
    const [now, setNow] = useState(Date.now() / 1000);
    const sessionId = binding?.sessionId;
    useEffect(() => {
        setSnapshot(null);
        if (!eligible) return;
        let active = true, revision = 0;
        const remove = subscribeAutomaticJourney(value => { ++revision; if (active) setSnapshot(value); });
        getAutomaticJourneySnapshot().then(value => { if (active && revision === 0) setSnapshot(value); }).catch(() => undefined);
        const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
        return () => { active = false; remove(); clearInterval(timer); };
    }, [input, eligible, sessionId]);
    const value = eligible ? presentSavedJourneyGuidance(snapshot, binding, now) : null;
    const resolved=input ? getAutomaticJourneyTrialInput(input) ?? input : null;
    const position = eligible && resolved ? presentSavedJourneyRoutePosition(snapshot, binding, resolved, now) : null;
    const stage = eligible && resolved ? presentSavedJourneyStage(snapshot, binding, resolved, now) : null;
    const layout = eligible && resolved ? presentSavedJourneyRouteLayout(snapshot, binding, resolved) : null;
    return { snapshot, value, position, stage, layout, eligible };
}

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getAutomaticJourneyTrialBinding, subscribeAutomaticJourneySync } from './automaticJourneyTrial';
import type { JourneyRouteInput } from './journeyRouteInput';

/** Update an already mounted detail before its first GPS event. No session mutation. */
export function useSavedJourneyBinding(input: JourneyRouteInput | null, scheduleId: string) {
    const [, redraw] = useState(0);
    const enabled = __DEV__ && Platform.OS === 'ios' && !!input;
    useEffect(() => {
        if (!enabled) return;
        return subscribeAutomaticJourneySync(() => redraw(value => value + 1));
    }, [enabled, input, scheduleId]);
    const binding = enabled && input ? getAutomaticJourneyTrialBinding(input) : null;
    return binding?.scheduleId === scheduleId && binding.savedRouteValidated === true && binding.guidanceEnabled === true ? binding : null;
}

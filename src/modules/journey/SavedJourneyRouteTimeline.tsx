import React from 'react';
import RouteStepTimeline from '../schedule/components/route/RouteStepTimeline';
import type { RouteStepTimelineProps } from '../schedule/components/route/RouteStepTimeline.helpers';
import type { JourneyRouteInput } from './journeyRouteInput';
import { savedJourneyTimelineHighlight, savedJourneyTimelineNames } from './savedJourneyStage';
import { useSavedJourneyGuidanceView } from './useSavedJourneyGuidanceView';

/** A map-selection highlight is not journey progress. Only engine evidence sets this marker. */
export function SavedJourneyRouteTimeline({ input, scheduleId, ...props }: RouteStepTimelineProps & {
    input: JourneyRouteInput | null; scheduleId: string;
}) {
    const { eligible, stage } = useSavedJourneyGuidanceView(input, scheduleId);
    return <RouteStepTimeline {...props} currentGuidance={savedJourneyTimelineHighlight(stage, input, props.routeInfo)}
        stepDisplayNames={eligible ? savedJourneyTimelineNames(input, props.routeInfo) : undefined}
        realtimeArrivalsEnabled={eligible ? false : props.realtimeArrivalsEnabled} />;
}

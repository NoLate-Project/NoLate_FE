import React from 'react';
import RouteStepTimeline from '../schedule/components/route/RouteStepTimeline';
import type { RouteStepTimelineProps } from '../schedule/components/route/RouteStepTimeline.helpers';
import type { JourneyRouteInput } from './journeyRouteInput';
import { savedJourneyTimelineHighlight, savedJourneyTimelineNames } from './savedJourneyStage';
import { useSavedJourneyGuidanceView } from './useSavedJourneyGuidanceView';

type GuidanceTimelineProps = RouteStepTimelineProps & {
    input: JourneyRouteInput | null; scheduleId: string;
    guidance?: Pick<ReturnType<typeof useSavedJourneyGuidanceView>, 'eligible' | 'stage'>;
};

/** A map-selection highlight is not journey progress. Only engine evidence sets this marker. */
export function SavedJourneyRouteTimeline({ input, scheduleId, guidance, ...props }: GuidanceTimelineProps) {
    const observed = useSavedJourneyGuidanceView(guidance ? null : input, scheduleId);
    const { eligible, stage } = guidance ?? observed;
    return <RouteStepTimeline {...props} currentGuidance={savedJourneyTimelineHighlight(stage, input, props.routeInfo)}
        stepDisplayNames={eligible ? savedJourneyTimelineNames(input, props.routeInfo) : undefined}
        realtimeArrivalsEnabled={eligible ? false : props.realtimeArrivalsEnabled} />;
}

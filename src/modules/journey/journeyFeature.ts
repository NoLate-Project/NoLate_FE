import { getEnv } from "../../api/env";
import { Platform } from 'react-native';
import type { ScheduleItem } from "../schedule/types";

export function isJourneyGuidanceEnabled(): boolean {
    return getEnv("EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED") === "true";
}

/** UI entry only. Native capability and the authenticated server still gate preparation. */
export function isAutomaticJourneyEntryEnabled(): boolean {
    const product = getEnv('EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED') === 'true';
    return isJourneyGuidanceEnabled() && (__DEV__ || product) && Platform.OS === 'ios'
        && getEnv('EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED') === 'true'
        && (!(require('expo-device') as typeof import('expo-device')).isDevice
            || product || getEnv('EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED') === 'true');
}

export function canOpenJourneyGuidance(item?: ScheduleItem): boolean {
    // Never replace the existing departure action with an unavailable entry screen.
    // In particular, the guidance flag alone does not make the Release engine usable.
    if (!item || !isJourneyGuidanceEnabled() || !isAutomaticJourneyEntryEnabled()) return false;
    if (item.travelCollaborationEnabled === false || item.routeSetupRequired) return false;
    return (item.myTravelPlan?.travelMode ?? item.travelMode) === "TRANSIT";
}

export function journeyGuidanceRoute(scheduleId: string) {
    return { pathname: "/schedule/journey" as const, params: { scheduleId } };
}

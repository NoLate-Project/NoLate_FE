import { clearPushRegistrationAfterLogout } from "../notification/pushRegistration";
import { clearCalendarConnectionSnapshot } from "../onboarding/calendarConnectionStorage";
import { clearStoredGoogleCalendarAccessToken } from "../onboarding/googleCalendarImport";
import { clearLocalRoutePlaceCaches } from "../schedule/favoriteDeparture";
import { clearSeenShareAttention } from "../share/shareAttention";
import { clearDepartureAlarmsForAccountCleanup } from "../notification/departureAlarmSync";
import { clearPushDeliveryAckQueueForCurrentAccount } from "../notification/pushDeliveryAckQueue";
import {
    clearScheduleArrivalObservationQueueForCurrentAccount,
} from "../schedule/scheduleArrivalObservationQueue";
import {
    clearScheduleEtaObservationEngagementQueueForCurrentAccount,
} from "../schedule/scheduleEtaObservationEngagementQueue";
import {
    clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount,
} from "../schedule/quickScheduleReliabilityFeedbackQueue";
import {
    clearDepartureAlarmScheduleReceiptQueueForCurrentAccount,
} from "../notification/departureAlarmScheduleReceiptQueue";
import {
    clearStandardDepartureActionFallbackForCurrentAccount,
} from "../notification/nativeDepartureActionJournal";
import {
    clearForegroundPushPresentationClaimsForCurrentAccount,
} from "../notification/foregroundPushPresentationClaim";
import {
    clearNavigationPerformanceQueueForCurrentAccount,
} from "../performance/navigationPerformanceQueue";
import {
    clearInteractionPerformanceQueueForCurrentAccount,
} from "../performance/interactionPerformanceQueue";
import { clearScheduleCalendarMemoryCache } from "../schedule/scheduleCalendarMemoryCache";
import { clearPersistedCalendarScheduleCacheForAccount } from "../schedule/calendarScheduleCache";
import { disableRouteDetailAdvertising } from "../advertising/routeDetailInterstitial";
import { clearNoLateWidgetSnapshot } from "../widget/nativeWidgetBridge";
import { getAuthMember } from "./authStorage";

/** Clears data that belongs to the signed-in member before another account can load. */
export async function clearAccountScopedLocalData(): Promise<void> {
    // The backend decision is account-specific. Never let a fresh account inherit the previous
    // member's cached FREE/PREMIUM advertising state.
    disableRouteDetailAdvertising();
    clearScheduleCalendarMemoryCache();
    // Invalidate widget writes before the first await so an older account fetch cannot
    // republish private schedule data after cleanup has started. Native mutations are
    // serialized, making this clear run after any write that already crossed the bridge.
    const widgetCleanup = clearNoLateWidgetSnapshot();
    // Native alarms can keep acting after the process exits. Start cleanup immediately
    // and propagate failure so auth credentials are not deleted while an old resource survives.
    const alarmCleanup = clearDepartureAlarmsForAccountCleanup();
    const memberId = await getAuthMember()
        .then(member => member?.id)
        .catch(() => undefined);
    const cleanupResults = await Promise.allSettled([
        alarmCleanup,
        widgetCleanup,
        clearStoredGoogleCalendarAccessToken(),
        clearCalendarConnectionSnapshot(),
        clearLocalRoutePlaceCaches(),
        clearSeenShareAttention(),
        clearPushRegistrationAfterLogout(),
        clearPushDeliveryAckQueueForCurrentAccount(),
        clearScheduleArrivalObservationQueueForCurrentAccount(),
        clearScheduleEtaObservationEngagementQueueForCurrentAccount(),
        clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount(),
        clearDepartureAlarmScheduleReceiptQueueForCurrentAccount(),
        clearStandardDepartureActionFallbackForCurrentAccount(),
        clearForegroundPushPresentationClaimsForCurrentAccount(),
        clearNavigationPerformanceQueueForCurrentAccount(),
        clearInteractionPerformanceQueueForCurrentAccount(),
        clearPersistedCalendarScheduleCacheForAccount(memberId),
    ]);

    const alarmResult = cleanupResults[0];
    if (alarmResult.status === "rejected") {
        throw alarmResult.reason;
    }
    const widgetResult = cleanupResults[1];
    if (widgetResult.status === "rejected") {
        throw widgetResult.reason;
    }
}

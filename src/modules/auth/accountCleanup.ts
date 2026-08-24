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
import { clearLiveActivitiesForAccountCleanup } from "../notification/liveActivitySync";
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
    const memberId = await getAuthMember()
        .then(member => member?.id)
        .catch(() => undefined);

    // The widget is also a lock-screen privacy surface. Do not remove credentials or
    // journals until its account-owned snapshot has been removed successfully.
    await widgetCleanup;

    // Commit the lock-screen privacy boundary before the alarm coordinator clears
    // its durable departure-action journal. If Live Activity end or remote token
    // retirement fails, preserving that journal keeps the completed action
    // recoverable and prevents a new account from inheriting an actionable surface.
    await clearLiveActivitiesForAccountCleanup();
    await clearDepartureAlarmsForAccountCleanup();
    await clearStandardDepartureActionFallbackForCurrentAccount();

    await Promise.allSettled([
        clearStoredGoogleCalendarAccessToken(),
        clearCalendarConnectionSnapshot(),
        clearLocalRoutePlaceCaches(),
        clearSeenShareAttention(),
        clearPushDeliveryAckQueueForCurrentAccount(),
        clearScheduleArrivalObservationQueueForCurrentAccount(),
        clearScheduleEtaObservationEngagementQueueForCurrentAccount(),
        clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount(),
        clearDepartureAlarmScheduleReceiptQueueForCurrentAccount(),
        clearForegroundPushPresentationClaimsForCurrentAccount(),
        clearNavigationPerformanceQueueForCurrentAccount(),
        clearInteractionPerformanceQueueForCurrentAccount(),
        clearPersistedCalendarScheduleCacheForAccount(memberId),
    ]);

    // Device-token retirement is the final account-owned mutation. At this
    // point no journal or native surface can enqueue new old-member work.
    await clearPushRegistrationAfterLogout();
}

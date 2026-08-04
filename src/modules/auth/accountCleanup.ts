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

/** Clears data that belongs to the signed-in member before another account can load. */
export async function clearAccountScopedLocalData(): Promise<void> {
    // Native alarms are the only account-scoped resource that can keep acting
    // after the process exits. Start it first and propagate its failure so auth
    // credentials are not deleted while a previous account alarm may survive.
    const alarmCleanup = clearDepartureAlarmsForAccountCleanup();
    const cleanupResults = await Promise.allSettled([
        alarmCleanup,
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
    ]);

    const alarmResult = cleanupResults[0];
    if (alarmResult.status === "rejected") {
        throw alarmResult.reason;
    }
}

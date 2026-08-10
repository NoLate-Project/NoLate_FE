import React, { type PropsWithChildren, useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { AuthProvider } from "./modules/auth/AuthContext";
import { useAuth } from "./modules/auth/AuthContext";
import { getAuthMember } from "./modules/auth/authStorage";
import {
    registerPushAfterLogin,
    subscribePushRegistrationSuccess,
    subscribePushTokenRefresh,
} from "./modules/notification/pushRegistration";
import {
    activatePushDeliveryAckQueueForAuthenticatedMember,
    drainPushDeliveryAckQueue,
} from "./modules/notification/pushDeliveryAckQueue";
import { reconcileDepartureAlarmSnapshot } from "./modules/notification/departureAlarmSync";
import {
    activateNativeAlarmFireJournalForAuthenticatedMember,
    deactivateNativeAlarmFireJournalRetry,
} from "./modules/notification/nativeAlarmFireJournal";
import {
    activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember,
} from "./modules/notification/departureAlarmScheduleReceiptQueue";
import {
    activateForegroundPushPresentationClaimsForAuthenticatedMember,
} from "./modules/notification/foregroundPushPresentationClaim";
import {
    activateNativeDepartureReminderPresentationJournal,
    deactivateNativeDepartureReminderPresentationJournal,
} from "./modules/notification/nativeDepartureReminderPresentationJournal";
import {
    activateLiveActivitySyncForAuthenticatedMember,
    pauseLiveActivitySync,
    resumeLiveActivitySyncForAuthenticatedMember,
    setLiveActivityAppearance,
} from "./modules/notification/liveActivitySync";
import { createScheduleInitialState } from "./modules/schedule/initialState";
import {
    activateScheduleArrivalObservationQueueForAuthenticatedMember,
} from "./modules/schedule/scheduleArrivalObservationQueue";
import {
    activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember,
} from "./modules/schedule/quickScheduleReliabilityFeedbackQueue";
import {
    activateScheduleEtaObservationEngagementQueueForAuthenticatedMember,
} from "./modules/schedule/scheduleEtaObservationEngagementQueue";
import { ScheduleProvider } from "./modules/schedule/store";
import { ThemeProvider, useTheme } from "./modules/theme/ThemeContext";

const PUSH_BOOTSTRAP_RETRY_DELAYS_MS = [
    1_500,
    4_000,
    15_000,
    60_000,
] as const;
const PUSH_REGISTRATION_RECOVERY_DELAYS_MS = [
    15_000,
    60_000,
    5 * 60_000,
] as const;

export function AppProviders({ children }: PropsWithChildren) {
    const initialState = useMemo(() => createScheduleInitialState(), []);

    return (
        <ThemeProvider>
            <LiveActivityAppearanceBridge />
            <AuthProvider>
                <PushRegistrationBootstrap />
                <ScheduleProvider initialState={initialState}>
                    {children}
                </ScheduleProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}

function LiveActivityAppearanceBridge() {
    const { mode } = useTheme();

    useEffect(() => {
        setLiveActivityAppearance(mode).catch((error) => {
            console.warn("[live-activity] appearance sync failed", error);
        });
    }, [mode]);

    return null;
}

function PushRegistrationBootstrap() {
    const { isAuthenticated, isLoading } = useAuth();

    useEffect(() => {
        if (isLoading || !isAuthenticated) {
            return undefined;
        }

        let cancelled = false;
        let unsubscribe: () => void = () => undefined;
        let unsubscribePushRegistrationSuccess: () => void = () => undefined;
        let removeAppStateListener: () => void = () => undefined;
        let memberBoundMemberId: number | undefined;
        let memberBootstrapInFlight: Promise<void> | undefined;
        let memberBootstrapRetryTimer: ReturnType<typeof setTimeout> | undefined;
        let memberBootstrapRetryAttempt = 0;
        let tokenRegistrationInFlight: Promise<void> | undefined;
        let tokenRegistrationRetryTimer: ReturnType<typeof setTimeout> | undefined;
        let tokenRegistrationRetryAttempt = 0;
        let liveActivityAccountReady = false;
        let appIsActive = AppState.currentState === "active";

        unsubscribePushRegistrationSuccess = subscribePushRegistrationSuccess((memberId) => {
            if (cancelled || memberBoundMemberId !== memberId) return;
            liveActivityAccountReady = true;
            if (!appIsActive) return;
            activateLiveActivitySyncForAuthenticatedMember(memberId).catch((error) => {
                console.warn("[live-activity] account bootstrap failed", error);
            });
        });

        const clearMemberBootstrapRetry = () => {
            if (memberBootstrapRetryTimer) clearTimeout(memberBootstrapRetryTimer);
            memberBootstrapRetryTimer = undefined;
        };
        const clearTokenRegistrationRetry = () => {
            if (tokenRegistrationRetryTimer) clearTimeout(tokenRegistrationRetryTimer);
            tokenRegistrationRetryTimer = undefined;
        };

        // This effect runs for both restored sessions and fresh logins. ACK
        // recovery is account-bound and does not depend on push permission or a
        // successful member/token bootstrap.
        activatePushDeliveryAckQueueForAuthenticatedMember().catch((error) => {
            console.warn("[push-ack] durable queue bootstrap failed", error);
        });
        activateForegroundPushPresentationClaimsForAuthenticatedMember().catch((error) => {
            console.warn("[push] presentation claim activation failed", error);
        });
        const drainAlarmFireEvents = () => {
            activateNativeAlarmFireJournalForAuthenticatedMember().catch((error) => {
                console.warn("[alarm-fired] native journal drain failed", error);
            });
        };
        drainAlarmFireEvents();
        /*
         * Native fire evidence is account-bound but independent of member/token bootstrap.
         * Foreground recovery must survive an account-cache read failing transiently.
         */
        const fireJournalAppStateSubscription = AppState.addEventListener("change", (state) => {
            if (state === "active") drainAlarmFireEvents();
        });
        activateScheduleArrivalObservationQueueForAuthenticatedMember().catch((error) => {
            console.warn("[eta-observation] durable arrival queue bootstrap failed", error);
        });
        const drainQuickScheduleFeedback = () => {
            activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember().catch((error) => {
                console.warn("[quick-schedule] durable feedback queue drain failed", error);
            });
        };
        drainQuickScheduleFeedback();
        const quickScheduleFeedbackAppStateSubscription = AppState.addEventListener(
            "change",
            (state) => {
                if (state === "active") drainQuickScheduleFeedback();
            },
        );
        activateScheduleEtaObservationEngagementQueueForAuthenticatedMember().catch((error) => {
            console.warn("[eta-observation] durable engagement queue bootstrap failed", error);
        });
        const drainAlarmScheduleReceipts = () => {
            activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember().catch((error) => {
                console.warn("[alarm-receipt] durable queue drain failed", error);
            });
        };
        drainAlarmScheduleReceipts();
        // Receipt recovery must not depend on the member bootstrap succeeding:
        // that request can fail for the same transient outage that queued the receipt.
        const receiptAppStateSubscription = AppState.addEventListener("change", (state) => {
            if (state === "active") drainAlarmScheduleReceipts();
        });

        const scheduleTokenRegistrationRetry = (
            memberId: number,
            register: (candidateMemberId: number) => void,
        ) => {
            if (
                cancelled ||
                memberBoundMemberId !== memberId ||
                tokenRegistrationRetryTimer
            ) return;
            const delay = PUSH_REGISTRATION_RECOVERY_DELAYS_MS[Math.min(
                tokenRegistrationRetryAttempt,
                PUSH_REGISTRATION_RECOVERY_DELAYS_MS.length - 1,
            )];
            tokenRegistrationRetryAttempt += 1;
            tokenRegistrationRetryTimer = setTimeout(() => {
                tokenRegistrationRetryTimer = undefined;
                if (
                    !cancelled &&
                    appIsActive &&
                    memberBoundMemberId === memberId
                ) register(memberId);
            }, delay);
        };

        const registerMemberPush = (memberId: number) => {
            if (
                cancelled ||
                memberBoundMemberId !== memberId ||
                tokenRegistrationInFlight
            ) return;

            const request = registerPushAfterLogin(memberId)
                .then(() => {
                    if (cancelled || memberBoundMemberId !== memberId) return;
                    tokenRegistrationRetryAttempt = 0;
                    clearTokenRegistrationRetry();
                })
                .catch((error) => {
                    if (cancelled || memberBoundMemberId !== memberId) return;
                    console.warn("[push] token registration bootstrap failed", error);
                    scheduleTokenRegistrationRetry(memberId, registerMemberPush);
                })
                .finally(() => {
                    if (tokenRegistrationInFlight === request) {
                        tokenRegistrationInFlight = undefined;
                    }
                });
            tokenRegistrationInFlight = request;
        };

        const runMemberBoundRecovery = (memberId: number) => {
            activateNativeDepartureReminderPresentationJournal().catch((error) => {
                console.warn("[push] native presentation evidence drain failed", error);
            });
            reconcileDepartureAlarmSnapshot(memberId).catch((error) => {
                console.warn("[alarm-sync] snapshot bootstrap failed", error);
            });
            registerMemberPush(memberId);
            drainPushDeliveryAckQueue(memberId).catch((error) => {
                console.warn("[push-ack] durable queue drain failed", error);
            });
            activateScheduleArrivalObservationQueueForAuthenticatedMember().catch((error) => {
                console.warn("[eta-observation] durable arrival queue drain failed", error);
            });
            activateScheduleEtaObservationEngagementQueueForAuthenticatedMember().catch((error) => {
                console.warn("[eta-observation] durable engagement queue drain failed", error);
            });
        };

        const scheduleMemberBootstrapRetry = (bootstrap: () => void) => {
            if (cancelled || memberBoundMemberId || memberBootstrapRetryTimer) return;
            const delay = PUSH_BOOTSTRAP_RETRY_DELAYS_MS[Math.min(
                memberBootstrapRetryAttempt,
                PUSH_BOOTSTRAP_RETRY_DELAYS_MS.length - 1,
            )];
            memberBootstrapRetryAttempt += 1;
            memberBootstrapRetryTimer = setTimeout(() => {
                memberBootstrapRetryTimer = undefined;
                if (!cancelled && appIsActive) bootstrap();
            }, delay);
        };

        const bootstrapMemberBoundPush = () => {
            if (cancelled) return;
            if (memberBoundMemberId) {
                runMemberBoundRecovery(memberBoundMemberId);
                return;
            }
            if (memberBootstrapInFlight) return;

            const request = getAuthMember()
                .then((member) => {
                    if (cancelled) return;
                    const memberId = member?.id;
                    if (
                        typeof memberId !== "number" ||
                        !Number.isSafeInteger(memberId) ||
                        memberId <= 0
                    ) {
                        throw new Error("Authenticated member cache is unavailable.");
                    }

                    // The auth provider already verified this persisted identity.
                    // Subscribe before registration so a native token rotation in
                    // the registration window is queued rather than lost.
                    unsubscribe = subscribePushTokenRefresh(memberId);
                    memberBoundMemberId = memberId;
                    memberBootstrapRetryAttempt = 0;
                    clearMemberBootstrapRetry();
                    runMemberBoundRecovery(memberId);
                })
                .catch((error) => {
                    if (cancelled) return;
                    console.warn("[push] member bootstrap for token registration failed", error);
                    scheduleMemberBootstrapRetry(bootstrapMemberBoundPush);
                })
                .finally(() => {
                    if (memberBootstrapInFlight === request) memberBootstrapInFlight = undefined;
                });
            memberBootstrapInFlight = request;
        };

        bootstrapMemberBoundPush();
        const appStateSubscription = AppState.addEventListener("change", (state) => {
            appIsActive = state === "active";
            if (state !== "active") {
                clearMemberBootstrapRetry();
                clearTokenRegistrationRetry();
                pauseLiveActivitySync();
                return;
            }
            // Recover both a transient SecureStore read failure and a token or
            // snapshot request that failed before the app returned to foreground.
            bootstrapMemberBoundPush();
            if (memberBoundMemberId && liveActivityAccountReady) {
                resumeLiveActivitySyncForAuthenticatedMember(memberBoundMemberId).catch((error) => {
                    console.warn("[live-activity] foreground snapshot failed", error);
                });
            }
        });
        removeAppStateListener = () => appStateSubscription.remove();

        return () => {
            cancelled = true;
            liveActivityAccountReady = false;
            clearMemberBootstrapRetry();
            clearTokenRegistrationRetry();
            removeAppStateListener();
            unsubscribe();
            unsubscribePushRegistrationSuccess();
            receiptAppStateSubscription.remove();
            quickScheduleFeedbackAppStateSubscription.remove();
            fireJournalAppStateSubscription.remove();
            deactivateNativeAlarmFireJournalRetry();
            deactivateNativeDepartureReminderPresentationJournal();
            pauseLiveActivitySync();
        };
    }, [isAuthenticated, isLoading]);

    return null;
}

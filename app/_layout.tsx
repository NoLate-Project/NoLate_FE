import { AuthFormDraftsProvider } from "../src/modules/auth/AuthFormDrafts";
import { useSystemReduceMotion } from "../src/modules/performance/useSystemReduceMotion";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Redirect, Stack, useRouter, useSegments } from "expo-router";
import { Alert, AppState, InteractionManager, StatusBar, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { BrandedLoadingState } from "../src/ui/BrandedLoader";
import {
    configureForegroundPush,
    configurePushNavigation,
    type NoLateCustomAlarmOpenOutcome,
} from "../src/modules/notification/foregroundPush";
import { useAuth } from "../src/modules/auth/AuthContext";
import {
    createPendingPushNavigationQueue,
    createScheduleDetailRoute,
    isPushNavigationReady,
    type PushNavigationTarget,
} from "../src/modules/notification/pushNavigation";
import { useTheme } from "../src/modules/theme/ThemeContext";
import NavigationPerformanceTracker from "../src/modules/performance/NavigationPerformanceTracker";
import { ImmediateNavigationTransitionProvider } from "../src/modules/performance/ImmediateNavigationTransition";
import { ProfileScreen } from "./profile";
import { ScheduleDetail } from "./schedule/[id]";
import { useScheduleStore } from "../src/modules/schedule/store";
import { getSelectedDayAgendaItems } from "../src/modules/schedule/agendaLayout";
import {
    getCachedCalendarViewModePreference,
    loadCalendarViewModePreference,
} from "../src/modules/schedule/components/calendar/calendarViewModePreference";
import PlacesSettingsScreen from "./settings/places";
import ScheduleCategoriesScreen from "./schedule/categories";
import RouteSelectScreen from "./schedule/route-select";
import {
    getLatestRoutePlannerSessionId,
    subscribeLatestRoutePlannerSession,
} from "../src/modules/schedule/routePlannerSession";
import BlockedSharingMembersScreen from "./share/blocked";
import SharingReportHistoryScreen from "./share/reports";
import PrivacyPolicyScreen from "./legal/privacy-policy";
import TermsOfServiceScreen from "./legal/terms-of-service";
import {
    markNavigationTransitionEnded,
    markNavigationTransitionStarted,
} from "../src/modules/performance/navigationPerformance";
import {
    activateNativeDepartureActionJournalForAuthenticatedMember,
    configureNativeDepartureActionNavigation,
    deactivateNativeDepartureActionJournalRetry,
} from "../src/modules/notification/nativeDepartureActionJournal";
import {
    activateNativeAlarmNavigationJournal,
    configureNativeAlarmNavigation,
    deactivateNativeAlarmNavigationJournal,
} from "../src/modules/notification/nativeAlarmNavigationJournal";
import {
    createNoLateCustomAlarmRoute,
    type NoLateCustomAlarmNavigationTarget,
} from "../src/modules/notification/customAlarmNavigation";
import { getAutomaticJourneySyncState, reconcileAutomaticJourneyCheckpoint, retryAutomaticJourneyStops } from '../src/modules/journey/automaticJourneyTrial';
import { clearAutomaticJourneyArrivalHandoff, isAutomaticJourneyDevelopment } from '../src/modules/journey/automaticJourney';
import { subscribeAuthInvalidation } from '../src/modules/auth/authStorage';
import {internalPreviewRoutes, isPublicInternalPreviewRoute} from '../src/modules/navigation/internalPreviewRoutes';

export default function RootLayout() {
    const router = useRouter();
    const { isAuthenticated, isCurationCompleted, isLoading: authLoading } = useAuth();
    const [calendarViewPreferenceReady, setCalendarViewPreferenceReady] = useState(
        () => getCachedCalendarViewModePreference() !== null,
    );
    useEffect(() => {
        if (calendarViewPreferenceReady) return;
        let active = true;
        void loadCalendarViewModePreference().finally(() => {
            if (active) setCalendarViewPreferenceReady(true);
        });
        return () => { active = false; };
    }, [calendarViewPreferenceReady]);
    const isLoading = authLoading ||
        (isAuthenticated && isCurationCompleted && !calendarViewPreferenceReady);
    const { state: scheduleState } = useScheduleStore();
    const preMountedDetailItem = useMemo(() => {
        const items = Object.values(scheduleState.itemsById);
        const item = getSelectedDayAgendaItems(items, scheduleState.selectedDay)[0]
            ?? items.sort((left, right) => left.startAt.localeCompare(right.startAt))[0];
        // A saved route has a stateful sheet. Use the detail route's transition
        // shell so the editor opens over that same detail instance.
        return item?.route != null || item?.myTravelPlan?.route != null ? undefined : item;
    }, [scheduleState.itemsById, scheduleState.selectedDay]);
    const routePlannerSceneSessionId = useSyncExternalStore(
        subscribeLatestRoutePlannerSession,
        getLatestRoutePlannerSessionId,
        getLatestRoutePlannerSessionId,
    );
    useEffect(() => subscribeAuthInvalidation(async () => {
        await clearAutomaticJourneyArrivalHandoff();
    }), []);
    useEffect(() => {
        if (!isAutomaticJourneyDevelopment() || isLoading || !isAuthenticated) return;
        let active = true;
        let checking = false;
        let pendingRetryTicks = 0;
        const check = async () => {
            if (checking) return;
            checking = true;
            try {
                await retryAutomaticJourneyStops();
                if (active) await reconcileAutomaticJourneyCheckpoint();
            } catch { /* Preserve pending records; never assume a failed server read means ended. */ }
            finally { checking = false; }
        };
        check();
        const foreground = AppState.addEventListener('change', state => { if (state === 'active') check(); });
        const retry = setInterval(() => {
            if (AppState.currentState !== 'active') return;
            const sync = getAutomaticJourneySyncState();
            if (sync.checkpointState === 'WAITING' ||
                ((sync.pendingStopCount ?? 0) > 0 && ++pendingRetryTicks % 3 === 0)) check();
        }, 5000);
        return () => { active = false; foreground.remove(); clearInterval(retry); };
    }, [isAuthenticated, isLoading]);
    const pendingPushNavigation = useRef(createPendingPushNavigationQueue()).current;
    const pushNavigationReadyRef = useRef(isPushNavigationReady({
        isAuthenticated,
        isCurationCompleted,
        isLoading,
    }));

    const navigateToPushTarget = useCallback((target: PushNavigationTarget) => {
        InteractionManager.runAfterInteractions(() => {
            if (target.kind === "scheduleDetail") {
                if (target.guidanceSession) {
                    router.navigate({ pathname: "/schedule/[id]", params: { id: target.scheduleId,
                        entrySource: "guidance-activity", guidanceSession: target.guidanceSession } });
                    return;
                }
                router.push(createScheduleDetailRoute(target.scheduleId));
                return;
            }
            router.push("/share/inbox");
        });
    }, [router]);

    const openOrDeferPushTarget = useCallback((target: PushNavigationTarget) => {
        if (!pushNavigationReadyRef.current) {
            pendingPushNavigation.defer(target);
            return;
        }
        navigateToPushTarget(target);
    }, [navigateToPushTarget, pendingPushNavigation]);

    const navigateToCustomAlarmTarget = useCallback((target: NoLateCustomAlarmNavigationTarget) => {
        // A single reusable route owns alarm audio. `navigate` focuses/reuses it instead of
        // stacking multiple mounted alarm screens whose audio loops could overlap.
        router.navigate(createNoLateCustomAlarmRoute(target));
    }, [router]);

    const openOrDeferCustomAlarmTarget = useCallback((
        target: NoLateCustomAlarmNavigationTarget,
    ): NoLateCustomAlarmOpenOutcome => {
        if (!pushNavigationReadyRef.current) {
            // Keep the OS-owned last notification response until auth/navigation is ready. The
            // listener is configured again when readiness changes, so no account-agnostic JS
            // queue survives logout, reload, or a process crash.
            return "deferred";
        }
        navigateToCustomAlarmTarget(target);
        return "opened";
    }, [navigateToCustomAlarmTarget]);

    useEffect(() => {
        const readiness = { isAuthenticated, isCurationCompleted, isLoading };
        const ready = isPushNavigationReady(readiness);
        pushNavigationReadyRef.current = ready;
        if (!ready) return;

        const pendingTarget = pendingPushNavigation.consumeIfReady(readiness);
        if (pendingTarget) navigateToPushTarget(pendingTarget);
    }, [
        isAuthenticated,
        isCurationCompleted,
        isLoading,
        navigateToPushTarget,
        pendingPushNavigation,
    ]);

    useEffect(() => {
        if (!isPushNavigationReady({ isAuthenticated, isCurationCompleted, isLoading })) {
            return undefined;
        }
        const removeActionJournal = configureNativeDepartureActionNavigation(() => undefined, (event) => {
            InteractionManager.runAfterInteractions(() => {
                Alert.alert(
                    "출발 완료를 처리하지 못했어요",
                    "일정 권한이나 알림 상태가 변경되었을 수 있어요. 일정 화면에서 상태를 확인해 주세요.",
                    [
                        { text: "닫기", style: "cancel" },
                        {
                            text: "일정 열기",
                            onPress: () => openOrDeferPushTarget({
                                kind: "scheduleDetail",
                                scheduleId: event.scheduleId,
                            }),
                        },
                    ],
                );
            });
        });
        const removeAlarmNavigation = configureNativeAlarmNavigation((scheduleId) => {
            openOrDeferPushTarget({ kind: "scheduleDetail", scheduleId });
        });
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") {
                activateNativeDepartureActionJournalForAuthenticatedMember().catch(() => undefined);
                activateNativeAlarmNavigationJournal().catch(() => undefined);
            }
        });
        return () => {
            subscription.remove();
            removeActionJournal();
            removeAlarmNavigation();
            deactivateNativeDepartureActionJournalRetry();
            deactivateNativeAlarmNavigationJournal();
        };
    }, [isAuthenticated, isCurationCompleted, isLoading, openOrDeferPushTarget]);

    useEffect(() => {
        let unsubscribeForeground: (() => void) | undefined;
        let unsubscribeNavigation: (() => void) | undefined;
        let disposed = false;

        const configureNotifications = async () => {
            try {
                const listener = await configureForegroundPush();
                if (disposed) {
                    listener();
                    return;
                }
                unsubscribeForeground = listener;
            } catch (error) {
                console.warn("[push] foreground notification setup failed", error);
            }

            try {
                const listener = await configurePushNavigation(
                    (scheduleId, guidanceSession) => {
                        openOrDeferPushTarget({ kind: "scheduleDetail", scheduleId, guidanceSession });
                    },
                    () => {
                        openOrDeferPushTarget({ kind: "shareInbox" });
                    },
                    ({ scheduleId, message }) => {
                        InteractionManager.runAfterInteractions(() => {
                            Alert.alert(
                                "알림 요청을 처리하지 못했어요",
                                message,
                                scheduleId
                                    ? [
                                        { text: "닫기", style: "cancel" },
                                        {
                                            text: "일정 열기",
                                            onPress: () => openOrDeferPushTarget({
                                                kind: "scheduleDetail",
                                                scheduleId,
                                            }),
                                        },
                                    ]
                                    : [{ text: "확인" }],
                            );
                        });
                    },
                    openOrDeferCustomAlarmTarget,
                );
                if (disposed) listener();
                else unsubscribeNavigation = listener;
            } catch (error) {
                console.warn("[push] notification navigation setup failed", error);
            }
        };
        configureNotifications().catch(() => undefined);

        return () => {
            disposed = true;
            unsubscribeForeground?.();
            unsubscribeNavigation?.();
        };
    }, [
        isAuthenticated,
        isCurationCompleted,
        isLoading,
        openOrDeferCustomAlarmTarget,
        openOrDeferPushTarget,
    ]);

    return (
        <GestureHandlerRootView style={styles.gestureRoot}>
            <ImmediateNavigationTransitionProvider
                preMountedScenes={!isLoading && isAuthenticated ? [
                    { route: "/profile", content: <ProfileScreen /> },
                    { route: "/settings/places", content: <PlacesSettingsScreen /> },
                    { route: "/schedule/categories", content: <ScheduleCategoriesScreen /> },
                    { route: "/share/blocked", content: <BlockedSharingMembersScreen /> },
                    { route: "/share/reports", content: <SharingReportHistoryScreen /> },
                    { route: "/legal/privacy-policy", content: <PrivacyPolicyScreen /> },
                    { route: "/legal/terms-of-service", content: <TermsOfServiceScreen /> },
                    ...(preMountedDetailItem ? [{
                        route: "/schedule/[id]",
                        sceneKey: preMountedDetailItem.id,
                        content: <ScheduleDetail initialItem={preMountedDetailItem} />,
                    }] : []),
                    ...(routePlannerSceneSessionId ? [{
                        route: "/schedule/route-select",
                        sceneKey: routePlannerSceneSessionId,
                        content: <RouteSelectScreen sessionIdOverride={routePlannerSceneSessionId} />,
                    }] : []),
                ] : []}
            >
                {!isLoading && isAuthenticated ? <NavigationPerformanceTracker /> : null}
                <AuthFormDraftsProvider>
                    <RootNavigator isLoading={isLoading} />
                </AuthFormDraftsProvider>
            </ImmediateNavigationTransitionProvider>
        </GestureHandlerRootView>
    );
}

function RootNavigator({ isLoading }: { isLoading: boolean }) {
    const { isAuthenticated, isCurationCompleted } = useAuth();
    const { colors, mode } = useTheme();
    const reduceMotion = useSystemReduceMotion();
    const { fontScale } = useWindowDimensions();
    const segments = useSegments();
    const routeSegments = segments as string[];
    const quickScheduleBenchmarkEnabled =
        __DEV__ || process.env.EXPO_PUBLIC_ENABLE_QUICK_SCHEDULE_BENCHMARK === "true";

    if (isLoading) {
        return (
            <View style={[styles.bootstrap, { backgroundColor: colors.background }]}>
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
                <BrandedLoadingState
                    fill
                    size="full"
                    startup
                    accessibilityLabel="NoLate를 준비하고 있어요"
                    title="NoLate를 준비하고 있어요"
                />
            </View>
        );
    }

    const isPublicRoute =
        routeSegments[0] === "auth" ||
        routeSegments[0] === "legal" ||
        isPublicInternalPreviewRoute(routeSegments, __DEV__) ||
        (routeSegments[0] === "share" &&
            routeSegments[1] !== "inbox" &&
            routeSegments[1] !== "blocked" &&
            routeSegments[1] !== "safety" &&
            routeSegments[1] !== "reports");

    if (!isAuthenticated && !isPublicRoute) {
        return <Redirect href="/auth/login" />;
    }

    return (
        <Stack
            screenListeners={isAuthenticated
                ? {
                    transitionStart: () => markNavigationTransitionStarted(),
                    transitionEnd: () => markNavigationTransitionEnded(),
                }
                : undefined}
            screenOptions={{ headerShown: false, animation: "none" }}
        >
            <Stack.Screen name="index" />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/signup" />
            <Stack.Screen name="legal/terms-of-service" />
            <Stack.Screen name="legal/privacy-collection-consent" />
            <Stack.Screen name="legal/privacy-policy" />
            <Stack.Screen
                name="share/[token]"
            />
            <Stack.Protected guard={__DEV__}>
                {internalPreviewRoutes.map(name => <Stack.Screen key={name} name={`internal/${name}`}/>)}
            </Stack.Protected>
            <Stack.Protected guard={isAuthenticated}>
                <Stack.Screen
                    name="onboarding/calendar-import"
                />
                <Stack.Screen
                    name="onboarding/product-tour"
                    options={{
                        gestureEnabled: false,
                    }}
                />
            </Stack.Protected>
            <Stack.Protected guard={isAuthenticated && isCurationCompleted}>
                <Stack.Screen
                    name="profile"
                    options={{
                        animation: "none",
                    }}
                />
                <Stack.Screen
                    name="settings/places"
                    options={{
                        animation: "none",
                    }}
                />
                <Stack.Screen
                    name="schedule/index"
                />
                <Stack.Screen name="schedule/journey" />
                <Stack.Protected guard={quickScheduleBenchmarkEnabled}>
                    <Stack.Screen name="internal/quick-schedule-benchmark" />
                </Stack.Protected>
                <Stack.Screen
                    name="notifications"
                    options={{
                        animation: "none",
                    }}
                />
                <Stack.Screen
                    name="alarm"
                    options={{
                        gestureEnabled: false,
                    }}
                />
                <Stack.Screen
                    name="schedule/categories"
                    options={{ animation: "none" }}
                />
                <Stack.Screen
                    name="schedule/calendars"
                    options={{ animation: "none" }}
                />
                <Stack.Screen
                    name="share/inbox"
                    options={({ route }) => (
                        (route.params as { from?: string } | undefined)?.from === "notifications" && fontScale <= 1.35
                            ? { presentation: "transparentModal", animation: "none" }
                            : { animation: "none" }
                    )}
                />
                <Stack.Screen
                    name="share/safety"
                />
                <Stack.Screen
                    name="share/blocked"
                    options={{ animation: "none" }}
                />
                <Stack.Screen
                    name="share/reports"
                    options={{ animation: "none" }}
                />
                <Stack.Screen
                    name="schedule/route-select"
                />
                <Stack.Screen
                    name="schedule/route-planner"
                />
                <Stack.Screen
                    name="schedule/[id]"
                    options={({ route }) => {
                        const params = route.params as { entrySource?: string } | undefined;
                        if (
                            fontScale <= 1.35 &&
                            (params?.entrySource === "share-inbox" || params?.entrySource === "notification-inbox")
                        ) {
                            return { presentation: "transparentModal", animation: "none" };
                        }
                        return params?.entrySource === "share-inbox" && !reduceMotion
                            ? { animation: "fade", animationDuration: 180 }
                            : { animation: "none" };
                    }}
                />
            </Stack.Protected>
        </Stack>
    );
}

const styles = StyleSheet.create({
    gestureRoot: {
        flex: 1,
    },
    bootstrap: {
        flex: 1,
    },
});

import React, { useCallback, useEffect, useRef } from "react";
import { Redirect, Stack, useRouter, useSegments } from "expo-router";
import { Alert, AppState, InteractionManager, StatusBar, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { BrandedLoadingState } from "../src/ui/BrandedLoader";
import {
    configureForegroundPush,
    configurePushNavigation,
} from "../src/modules/notification/foregroundPush";
import { useAuth } from "../src/modules/auth/AuthContext";
import {
    createPendingPushNavigationQueue,
    createScheduleDetailRoute,
    isPushNavigationReady,
    type PushNavigationTarget,
} from "../src/modules/notification/pushNavigation";
import { useTheme } from "../src/modules/theme/ThemeContext";
import {
    NAVIGATION_PERFORMANCE_ENABLED,
    NavigationPerformanceOverlay,
    NavigationPerformanceTracker,
} from "../src/modules/performance/NavigationPerformanceMonitor";
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

export default function RootLayout() {
    const router = useRouter();
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();
    const pendingPushNavigation = useRef(createPendingPushNavigationQueue()).current;
    const pushNavigationReadyRef = useRef(isPushNavigationReady({
        isAuthenticated,
        isCurationCompleted,
        isLoading,
    }));

    const navigateToPushTarget = useCallback((target: PushNavigationTarget) => {
        InteractionManager.runAfterInteractions(() => {
            if (target.kind === "scheduleDetail") {
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

        configureForegroundPush()
            .then((listener) => {
                unsubscribeForeground = listener;
            })
            .catch((error) => {
                console.warn("[push] foreground notification setup failed", error);
            });
        configurePushNavigation(
            (scheduleId) => {
                openOrDeferPushTarget({ kind: "scheduleDetail", scheduleId });
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
        )
            .then((listener) => {
                unsubscribeNavigation = listener;
            })
            .catch((error) => {
                console.warn("[push] notification navigation setup failed", error);
            });

        return () => {
            unsubscribeForeground?.();
            unsubscribeNavigation?.();
        };
    }, [openOrDeferPushTarget]);

    return (
        <GestureHandlerRootView style={styles.gestureRoot}>
            <RootNavigator />
            {NAVIGATION_PERFORMANCE_ENABLED ? (
                <>
                    <NavigationPerformanceTracker />
                    <NavigationPerformanceOverlay />
                </>
            ) : null}
        </GestureHandlerRootView>
    );
}

function RootNavigator() {
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();
    const { colors, mode } = useTheme();
    const segments = useSegments();
    const routeSegments = segments as string[];

    if (isLoading) {
        return (
            <View style={[styles.bootstrap, { backgroundColor: colors.background }]}>
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
                <BrandedLoadingState
                    fill
                    size="full"
                    variant="auth"
                    accessibilityLabel="NoLate를 준비하고 있어요. 로그인 상태를 확인하고 있어요"
                    title="NoLate를 준비하고 있어요"
                    caption="로그인 상태를 확인하고 있어요"
                />
            </View>
        );
    }

    const isPublicRoute =
        routeSegments[0] === "auth" ||
        routeSegments[0] === "legal" ||
        (routeSegments[0] === "share" &&
            routeSegments[1] !== "inbox" &&
            routeSegments[1] !== "blocked" &&
            routeSegments[1] !== "reports");

    if (!isAuthenticated && !isPublicRoute) {
        return <Redirect href="/auth/login" />;
    }

    return (
        <Stack
            screenListeners={NAVIGATION_PERFORMANCE_ENABLED
                ? {
                    transitionStart: () => markNavigationTransitionStarted(),
                    transitionEnd: () => markNavigationTransitionEnded(),
                }
                : undefined}
            screenOptions={{ headerShown: false }}
        >
            <Stack.Screen name="index" />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/signup" />
            <Stack.Screen name="legal/terms-of-service" />
            <Stack.Screen name="legal/privacy-collection-consent" />
            <Stack.Screen name="legal/privacy-policy" />
            <Stack.Screen name="share/[token]" />
            <Stack.Protected guard={isAuthenticated}>
                <Stack.Screen
                    name="onboarding/calendar-import"
                    options={{
                        animation: "fade",
                        animationDuration: 180,
                    }}
                />
            </Stack.Protected>
            <Stack.Protected guard={isAuthenticated && isCurationCompleted}>
                <Stack.Screen
                    name="profile"
                    options={{
                        animation: "fade",
                        animationDuration: 180,
                    }}
                />
                <Stack.Screen
                    name="settings/places"
                    options={{
                        animation: "slide_from_right",
                        animationDuration: 200,
                    }}
                />
                <Stack.Screen name="schedule/index" />
                <Stack.Screen name="internal/quick-schedule-benchmark" />
                <Stack.Screen
                    name="notifications"
                    options={{
                        animation: "slide_from_right",
                        animationDuration: 200,
                    }}
                />
                <Stack.Screen name="schedule/categories" />
                <Stack.Screen name="share/inbox" />
                <Stack.Screen name="share/blocked" />
                <Stack.Screen name="share/reports" />
                <Stack.Screen name="schedule/route-select" />
                <Stack.Screen name="schedule/route-planner" />
                <Stack.Screen name="schedule/[id]" />
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

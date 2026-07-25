import React, { useCallback, useEffect, useRef } from "react";
import { Redirect, Stack, useRouter, useSegments } from "expo-router";
import {
    Alert,
    InteractionManager,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { BrandedLoadingState } from "../src/ui/BrandedLoader";
import {
    configureForegroundPush,
    configurePushNavigation,
    type PushNavigationBinding,
} from "../src/modules/notification/foregroundPush";
import { useAuth } from "../src/modules/auth/AuthContext";
import {
    getAuthMember,
    getAuthSessionEpoch,
    isAuthSessionActive,
    isAuthSessionEpochCurrent,
    subscribeAuthSessionEpoch,
} from "../src/modules/auth/authStorage";
import {
    type AccountBoundPushNavigationIntent,
    createPendingPushNavigationQueue,
    createScheduleDetailRoute,
    isAccountBoundPushNavigationIntentCurrent,
    isPushNavigationReady,
} from "../src/modules/notification/pushNavigation";
import { useTheme } from "../src/modules/theme/ThemeContext";
import {
    scheduleNotificationInteractionForAuthSession,
} from "../src/modules/notification/notificationInteractionFence";
import {
    getScheduleSharingRouteRedirect,
    isScheduleSharingEnabled,
} from "../src/modules/share/scheduleSharingPolicy";

export default function RootLayout() {
    const router = useRouter();
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();
    const pendingPushNavigation = useRef(createPendingPushNavigationQueue()).current;
    const pushNavigationReadyRef = useRef(isPushNavigationReady({
        isAuthenticated,
        isCurationCompleted,
        isLoading,
    }));

    const navigateToPushIntent = useCallback((intent: AccountBoundPushNavigationIntent) => {
        if (
            !isScheduleSharingEnabled()
            && intent.target.kind === "shareInbox"
        ) return;
        scheduleNotificationInteractionForAuthSession({
            authEpoch: intent.validationEpoch,
            isAuthSessionActive,
            schedule: (callback) =>
                InteractionManager.runAfterInteractions(callback),
            action: () => {
                (async () => {
                    if (!isAuthSessionEpochCurrent(intent.validationEpoch)) return;
                    const member = await getAuthMember();
                    if (
                        !isAuthSessionActive(intent.validationEpoch) ||
                        !isAccountBoundPushNavigationIntentCurrent(intent, {
                            authEpoch: getAuthSessionEpoch(),
                            memberId: member?.id,
                        })
                    ) return;
                    if (
                        !isScheduleSharingEnabled()
                        && intent.target.kind === "shareInbox"
                    ) return;
                    if (intent.target.kind === "scheduleDetail") {
                        router.push(createScheduleDetailRoute(intent.target.scheduleId));
                        return;
                    }
                    router.push("/share/inbox");
                })().catch((error) => {
                    console.warn("[push] queued navigation validation failed", error);
                });
            },
        });
    }, [router]);

    const openOrDeferPushIntent = useCallback((intent: AccountBoundPushNavigationIntent) => {
        if (!isAuthSessionActive(intent.validationEpoch)) return;
        if (
            !isScheduleSharingEnabled()
            && intent.target.kind === "shareInbox"
        ) return;
        if (!pushNavigationReadyRef.current) {
            pendingPushNavigation.defer(intent);
            return;
        }
        navigateToPushIntent(intent);
    }, [navigateToPushIntent, pendingPushNavigation]);

    useEffect(
        () => subscribeAuthSessionEpoch(() => {
            pendingPushNavigation.clear();
        }),
        [pendingPushNavigation],
    );

    useEffect(() => {
        const readiness = { isAuthenticated, isCurationCompleted, isLoading };
        const ready = isPushNavigationReady(readiness);
        pushNavigationReadyRef.current = ready;
        if (!ready) return;

        const pendingIntent = pendingPushNavigation.consumeIfReady(readiness);
        if (pendingIntent) navigateToPushIntent(pendingIntent);
    }, [
        isAuthenticated,
        isCurationCompleted,
        isLoading,
        navigateToPushIntent,
        pendingPushNavigation,
    ]);

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
            (scheduleId, binding) => {
                openOrDeferPushIntent(createPushNavigationIntent(
                    { kind: "scheduleDetail", scheduleId },
                    binding,
                ));
            },
            (binding) => {
                openOrDeferPushIntent(createPushNavigationIntent(
                    { kind: "shareInbox" },
                    binding,
                ));
            },
            ({ message }) => {
                const authEpoch = getAuthSessionEpoch();
                scheduleNotificationInteractionForAuthSession({
                    authEpoch,
                    isAuthSessionActive,
                    schedule: (callback) =>
                        InteractionManager.runAfterInteractions(callback),
                    action: () => {
                        Alert.alert(
                            "알림 요청을 처리하지 못했어요",
                            message,
                            [{ text: "확인" }],
                        );
                    },
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
    }, [openOrDeferPushIntent]);

    return <RootNavigator />;
}

function createPushNavigationIntent(
    target: AccountBoundPushNavigationIntent["target"],
    binding: PushNavigationBinding,
): AccountBoundPushNavigationIntent {
    return {
        target,
        logicalEventKey: binding.logicalEventKey,
        recipientMemberId: binding.recipientMemberId,
        validationEpoch: binding.authEpoch,
    };
}

function RootNavigator() {
    const {
        isAuthenticated,
        isCurationCompleted,
        isLoading,
        accountExitError,
        retryAccountExit,
    } = useAuth();
    const { colors, mode } = useTheme();
    const segments = useSegments();
    const routeSegments = segments as string[];
    const sharingRouteRedirect = getScheduleSharingRouteRedirect({
        segments: routeSegments,
        isAuthenticated,
        isCurationCompleted,
    });

    if (accountExitError) {
        return (
            <View
                style={[
                    styles.accountExitRecovery,
                    { backgroundColor: colors.background },
                ]}
            >
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
                <View
                    style={[
                        styles.accountExitRecoveryCard,
                        {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                        },
                    ]}
                >
                    <Text
                        accessibilityRole="header"
                        style={[
                            styles.accountExitRecoveryTitle,
                            { color: colors.textPrimary },
                        ]}
                    >
                        로그아웃을 안전하게 완료하지 못했어요
                    </Text>
                    <Text
                        style={[
                            styles.accountExitRecoveryMessage,
                            { color: colors.textSecondary },
                        ]}
                    >
                        {accountExitError}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="로그아웃 보안 정리 다시 시도"
                        onPress={retryAccountExit}
                        style={styles.accountExitRecoveryButton}
                    >
                        <Text style={styles.accountExitRecoveryButtonText}>
                            다시 시도
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

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

    if (sharingRouteRedirect) {
        // Redirect before a page effect mounts: old links and restored routes
        // must not get a chance to poll or accept dormant sharing resources.
        return <Redirect href={sharingRouteRedirect} />;
    }

    const isPublicRoute =
        routeSegments[0] === "auth" ||
        routeSegments[0] === "legal" ||
        (routeSegments[0] === "share" && routeSegments[1] !== "inbox");

    if (!isAuthenticated && !isPublicRoute) {
        return <Redirect href="/auth/login" />;
    }

    return (
        <Stack screenOptions={{ headerShown: false }}>
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
                <Stack.Screen
                    name="notifications"
                    options={{
                        animation: "slide_from_right",
                        animationDuration: 200,
                    }}
                />
                <Stack.Screen name="schedule/categories" />
                <Stack.Screen name="share/inbox" />
                <Stack.Screen name="schedule/route-select" />
                <Stack.Screen name="schedule/route-planner" />
                <Stack.Screen name="schedule/[id]" />
            </Stack.Protected>
        </Stack>
    );
}

const styles = StyleSheet.create({
    bootstrap: {
        flex: 1,
    },
    accountExitRecovery: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
    accountExitRecoveryCard: {
        width: "100%",
        maxWidth: 420,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 20,
        padding: 24,
    },
    accountExitRecoveryTitle: {
        fontSize: 20,
        fontWeight: "800",
        lineHeight: 28,
    },
    accountExitRecoveryMessage: {
        marginTop: 12,
        fontSize: 15,
        lineHeight: 22,
    },
    accountExitRecoveryButton: {
        minHeight: 48,
        marginTop: 24,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2563EB",
        paddingHorizontal: 20,
    },
    accountExitRecoveryButtonText: {
        color: "#FFFFFF",
        fontSize: 16,
        fontWeight: "800",
    },
});

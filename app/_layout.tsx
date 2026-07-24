import React, { useCallback, useEffect, useRef } from "react";
import { Redirect, Stack, useRouter, useSegments } from "expo-router";
import { Alert, InteractionManager, StatusBar, StyleSheet, View } from "react-native";

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
    isAuthSessionEpochCurrent,
} from "../src/modules/auth/authStorage";
import {
    type AccountBoundPushNavigationIntent,
    createPendingPushNavigationQueue,
    createScheduleDetailRoute,
    isAccountBoundPushNavigationIntentCurrent,
    isPushNavigationReady,
} from "../src/modules/notification/pushNavigation";
import { useTheme } from "../src/modules/theme/ThemeContext";

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
        InteractionManager.runAfterInteractions(() => {
            (async () => {
                if (!isAuthSessionEpochCurrent(intent.validationEpoch)) return;
                const member = await getAuthMember();
                if (!isAccountBoundPushNavigationIntentCurrent(intent, {
                    authEpoch: getAuthSessionEpoch(),
                    memberId: member?.id,
                })) return;
                if (intent.target.kind === "scheduleDetail") {
                    router.push(createScheduleDetailRoute(intent.target.scheduleId));
                    return;
                }
                router.push("/share/inbox");
            })().catch((error) => {
                console.warn("[push] queued navigation validation failed", error);
            });
        });
    }, [router]);

    const openOrDeferPushIntent = useCallback((intent: AccountBoundPushNavigationIntent) => {
        if (!pushNavigationReadyRef.current) {
            pendingPushNavigation.defer(intent);
            return;
        }
        navigateToPushIntent(intent);
    }, [navigateToPushIntent, pendingPushNavigation]);

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
                InteractionManager.runAfterInteractions(() => {
                    Alert.alert(
                        "알림 요청을 처리하지 못했어요",
                        message,
                        [{ text: "확인" }],
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
});

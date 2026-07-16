import React, { useEffect } from "react";
import { Redirect, Stack, useRouter, useSegments } from "expo-router";
import { InteractionManager, StyleSheet, View } from "react-native";

import { BrandedLoadingState } from "../src/ui/BrandedLoader";
import {
    configureForegroundPush,
    configurePushNavigation,
} from "../src/modules/notification/foregroundPush";
import { useAuth } from "../src/modules/auth/AuthContext";
import { createScheduleDetailRoute } from "../src/modules/notification/pushNavigation";
import { useTheme } from "../src/modules/theme/ThemeContext";

export default function RootLayout() {
    const router = useRouter();

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
                InteractionManager.runAfterInteractions(() => {
                    router.push(createScheduleDetailRoute(scheduleId));
                });
            },
            () => {
                InteractionManager.runAfterInteractions(() => {
                    router.push("/share/inbox");
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
    }, [router]);

    return <RootNavigator />;
}

function RootNavigator() {
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();
    const { colors } = useTheme();
    const segments = useSegments();
    const routeSegments = segments as string[];

    if (isLoading) {
        return (
            <View style={[styles.bootstrap, { backgroundColor: colors.background }]}>
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
        routeSegments[0] === "legal";

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
                <Stack.Screen name="schedule/index" />
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

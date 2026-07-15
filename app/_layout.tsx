import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { InteractionManager, LogBox } from "react-native";

import {
    configureForegroundPush,
    configurePushNavigation,
} from "../src/modules/notification/foregroundPush";
import { useAuth } from "../src/modules/auth/AuthContext";
import { createScheduleDetailRoute } from "../src/modules/notification/pushNavigation";

if (__DEV__) {
    // 지도 UI를 시뮬레이터에서 반복 점검할 때 Expo Go warning banner가 화면을 가려서
    // 개발 중 시각 확인에 집중할 수 있도록 경고 오버레이만 숨긴다.
    LogBox.ignoreAllLogs();
}

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
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return null;
    }

    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/signup" />
            <Stack.Screen name="share/[token]" />
            {__DEV__ && <Stack.Screen name="dev/calendar-import-preview" />}
            {__DEV__ && <Stack.Screen name="dev/calendar-import-scan" />}
            {__DEV__ && <Stack.Screen name="dev/auth-session" />}
            {__DEV__ && <Stack.Screen name="dev/share-preview" />}
            <Stack.Protected guard={isAuthenticated}>
                <Stack.Screen
                    name="profile"
                    options={{
                        animation: "fade",
                        animationDuration: 180,
                    }}
                />
                <Stack.Screen
                    name="onboarding/calendar-import"
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

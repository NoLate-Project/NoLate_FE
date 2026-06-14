import React, { useEffect, useMemo } from "react";
import { Stack, useRouter } from "expo-router";
import { InteractionManager, LogBox } from "react-native";

import { ScheduleProvider } from "../src/modules/schedule/store";
import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import {
    configureForegroundPush,
    configurePushNavigation,
} from "../src/modules/notification/foregroundPush";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

if (__DEV__) {
    // 지도 UI를 시뮬레이터에서 반복 점검할 때 Expo Go warning banner가 화면을 가려서
    // 개발 중 시각 확인에 집중할 수 있도록 경고 오버레이만 숨긴다.
    LogBox.ignoreAllLogs();
}

export default function RootLayout() {
    const router = useRouter();
    const initialState = useMemo(() => createScheduleInitialState(), []);

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
        configurePushNavigation((scheduleId) => {
            InteractionManager.runAfterInteractions(() => {
                router.push({
                    pathname: "/schedule/[id]",
                    params: { id: scheduleId },
                });
            });
        })
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

    return (
        <ThemeProvider>
            <ScheduleProvider initialState={initialState}>
                <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="auth/login" />
                    <Stack.Screen name="auth/signup" />
                    <Stack.Screen name="schedule/index" />
                    <Stack.Screen name="schedule/timetable" />
                    <Stack.Screen name="schedule/[id]" />
                    <Stack.Screen name="schedule/route-select" />
                    <Stack.Screen name="schedule/route-planner" />
                </Stack>
            </ScheduleProvider>
        </ThemeProvider>
    );
}

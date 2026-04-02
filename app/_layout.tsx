import React, { useMemo } from "react";
import { Stack } from "expo-router";

import { ScheduleProvider } from "../src/modules/schedule/store";
import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

export default function RootLayout() {
    const initialState = useMemo(() => createScheduleInitialState(), []);

    return (
        <ThemeProvider>
            <ScheduleProvider initialState={initialState}>
                <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="auth/login" />
                    <Stack.Screen name="auth/signup" />
                    <Stack.Screen name="schedule/index" />
                    <Stack.Screen name="schedule/[id]" />
                    <Stack.Screen name="schedule/route-planner" />
                </Stack>
            </ScheduleProvider>
        </ThemeProvider>
    );
}

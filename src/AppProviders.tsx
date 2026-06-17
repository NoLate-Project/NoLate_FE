import React, { type PropsWithChildren, useMemo } from "react";

import { AuthProvider } from "./modules/auth/AuthContext";
import { createScheduleInitialState } from "./modules/schedule/initialState";
import { ScheduleProvider } from "./modules/schedule/store";
import { ThemeProvider } from "./modules/theme/ThemeContext";

export function AppProviders({ children }: PropsWithChildren) {
    const initialState = useMemo(() => createScheduleInitialState(), []);

    return (
        <ThemeProvider>
            <AuthProvider>
                <ScheduleProvider initialState={initialState}>
                    {children}
                </ScheduleProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}

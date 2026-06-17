import React, { type PropsWithChildren, useEffect, useMemo } from "react";

import { getMyProfile } from "./api/member";
import { AuthProvider } from "./modules/auth/AuthContext";
import { useAuth } from "./modules/auth/AuthContext";
import {
    registerPushAfterLogin,
    subscribePushTokenRefresh,
} from "./modules/notification/pushRegistration";
import { createScheduleInitialState } from "./modules/schedule/initialState";
import { ScheduleProvider } from "./modules/schedule/store";
import { ThemeProvider } from "./modules/theme/ThemeContext";

export function AppProviders({ children }: PropsWithChildren) {
    const initialState = useMemo(() => createScheduleInitialState(), []);

    return (
        <ThemeProvider>
            <AuthProvider>
                <PushRegistrationBootstrap />
                <ScheduleProvider initialState={initialState}>
                    {children}
                </ScheduleProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}

function PushRegistrationBootstrap() {
    const { isAuthenticated, isLoading } = useAuth();

    useEffect(() => {
        if (isLoading || !isAuthenticated) {
            return undefined;
        }

        let cancelled = false;
        let unsubscribe: () => void = () => undefined;

        getMyProfile()
            .then(async (profile) => {
                if (cancelled) return;

                await registerPushAfterLogin(profile.memberId);
                if (!cancelled) {
                    unsubscribe = subscribePushTokenRefresh(profile.memberId);
                }
            })
            .catch((error) => {
                console.warn("[push] token registration bootstrap failed", error);
            });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [isAuthenticated, isLoading]);

    return null;
}

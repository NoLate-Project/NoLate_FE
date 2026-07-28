import React, { type PropsWithChildren, useEffect, useMemo } from "react";
import { AppState } from "react-native";

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
        let removeAppStateListener: () => void = () => undefined;

        getMyProfile()
            .then((profile) => {
                if (cancelled) return;

                // 토큰 갱신 구독을 먼저 연결해 초기 등록 도중 FCM이 토큰을 회전해도 놓치지 않는다.
                unsubscribe = subscribePushTokenRefresh(profile.memberId);
                const register = () => {
                    registerPushAfterLogin(profile.memberId).catch((error) => {
                        console.warn("[push] token registration bootstrap failed", error);
                    });
                };

                register();
                const appStateSubscription = AppState.addEventListener("change", (state) => {
                    // 권한 설정을 바꾸고 돌아오거나 시작 시 네트워크가 불안정했던 경우를 복구한다.
                    if (state === "active") register();
                });
                removeAppStateListener = () => appStateSubscription.remove();
            })
            .catch((error) => {
                console.warn("[push] profile bootstrap for token registration failed", error);
            });

        return () => {
            cancelled = true;
            removeAppStateListener();
            unsubscribe();
        };
    }, [isAuthenticated, isLoading]);

    return null;
}

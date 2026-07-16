import React, {
    createContext,
    type PropsWithChildren,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

import { getMemberCurationStatus, logoutMember } from "../../api/member";
import {
    clearAuthTokens,
    getAccessToken,
    getAuthMember,
    getRefreshToken,
    saveAuthCurationCompleted,
    subscribeAuthInvalidation,
} from "./authStorage";

type AuthContextValue = {
    isAuthenticated: boolean;
    isCurationCompleted: boolean;
    isLoading: boolean;
    syncAuthentication: () => Promise<boolean>;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const fallbackAuthContext: AuthContextValue = {
    isAuthenticated: false,
    isCurationCompleted: false,
    isLoading: false,
    syncAuthentication: async () => {
        try {
            const [accessToken, refreshToken, member] = await Promise.all([
                getAccessToken(),
                getRefreshToken(),
                getAuthMember(),
            ]);
            return Boolean(accessToken && refreshToken && member?.id);
        } catch {
            return false;
        }
    },
    signOut: async () => {
        await clearAuthTokens();
    },
};

export function AuthProvider({ children }: PropsWithChildren) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isCurationCompleted, setIsCurationCompleted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const syncAuthentication = useCallback(async () => {
        try {
            let [accessToken, refreshToken, storedMember] = await Promise.all([
                getAccessToken(),
                getRefreshToken(),
                getAuthMember(),
            ]);
            let authenticated = Boolean(accessToken && refreshToken && storedMember?.id);
            let curationCompleted = storedMember?.curationCompleted === true;

            if (!authenticated) {
                await clearAuthTokens();
                accessToken = null;
                refreshToken = null;
                storedMember = null;
            }

            if (authenticated) {
                try {
                    // DB 상태를 기준으로 동기화해 재설치·기기 변경 후에도 큐레이션 여부가 유지된다.
                    const remoteStatus = await getMemberCurationStatus();
                    curationCompleted = remoteStatus.curationCompleted === true;
                    await saveAuthCurationCompleted(curationCompleted);
                } catch {
                    // 오프라인에서는 마지막으로 확인한 로컬 값을 사용한다. 인증 갱신 실패로 토큰이
                    // 제거된 경우에는 아래 재확인에서 비로그인 상태로 바로 전환한다.
                    [accessToken, refreshToken, storedMember] = await Promise.all([
                        getAccessToken(),
                        getRefreshToken(),
                        getAuthMember(),
                    ]);
                    authenticated = Boolean(accessToken && refreshToken && storedMember?.id);
                    if (!authenticated) curationCompleted = false;
                }
            }

            setIsAuthenticated(authenticated);
            setIsCurationCompleted(authenticated && curationCompleted);

            return authenticated;
        } catch {
            setIsAuthenticated(false);
            setIsCurationCompleted(false);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        const refreshToken = await getRefreshToken();

        if (refreshToken) {
            await logoutMember({ refreshToken }).catch(() => undefined);
        }

        await clearAuthTokens();
        setIsAuthenticated(false);
        setIsCurationCompleted(false);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        syncAuthentication();
    }, [syncAuthentication]);

    useEffect(() => subscribeAuthInvalidation(() => {
        setIsAuthenticated(false);
        setIsCurationCompleted(false);
        setIsLoading(false);
    }), []);

    const value = useMemo(
        () => ({
            isAuthenticated,
            isCurationCompleted,
            isLoading,
            syncAuthentication,
            signOut,
        }),
        [isAuthenticated, isCurationCompleted, isLoading, syncAuthentication, signOut]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);

    return context ?? fallbackAuthContext;
}

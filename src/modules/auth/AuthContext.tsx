import React, {
    createContext,
    type PropsWithChildren,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import {
    getMemberCurationStatus,
    logoutMember,
    tokenLoginMember,
} from "../../api/member";
import {
    clearAuthTokens,
    getAccessToken,
    getAuthMember,
    getRefreshToken,
    saveAuthMember,
    saveAuthTokens,
    saveAuthCurationCompleted,
    subscribeAuthInvalidation,
} from "./authStorage";
import { clearAccountScopedLocalData } from "./accountCleanup";
import { cancelPendingPushRegistration } from "../notification/pushRegistrationCoordinator";
import { isDefinitiveAuthRejection } from "./refreshPolicy";

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
        cancelPendingPushRegistration();
        try {
            await clearAccountScopedLocalData();
        } finally {
            await clearAuthTokens({ notifyListeners: false });
        }
    },
};

export function AuthProvider({ children }: PropsWithChildren) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isCurationCompleted, setIsCurationCompleted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const authenticationSequenceRef = useRef(0);

    const syncAuthentication = useCallback(async () => {
        const sequence = authenticationSequenceRef.current + 1;
        authenticationSequenceRef.current = sequence;
        const isCurrent = () => authenticationSequenceRef.current === sequence;

        try {
            let [accessToken, refreshToken, storedMember] = await Promise.all([
                getAccessToken(),
                getRefreshToken(),
                getAuthMember(),
            ]);
            let authenticated = Boolean(accessToken && refreshToken && storedMember?.id);
            let curationCompleted = storedMember?.curationCompleted === true;

            // Member metadata is a cache, not an authentication credential. A
            // Keychain migration or interrupted write can leave a valid refresh
            // token without that cache; rebuild it from the server before deciding
            // to discard the session.
            if (!authenticated && refreshToken) {
                try {
                    const restoredMember = await tokenLoginMember({ refreshToken });
                    if (!isCurrent()) return false;
                    if (
                        restoredMember.id &&
                        restoredMember.accessToken &&
                        restoredMember.refreshToken
                    ) {
                        await saveAuthTokens(restoredMember.accessToken, restoredMember.refreshToken);
                        await saveAuthMember(restoredMember);
                        accessToken = restoredMember.accessToken;
                        refreshToken = restoredMember.refreshToken;
                        storedMember = restoredMember;
                        authenticated = true;
                        curationCompleted = restoredMember.curationCompleted === true;
                    }
                } catch (error) {
                    // Do not turn a temporary network outage into a logout. The
                    // login screen can retry this token when connectivity returns.
                    if (isDefinitiveAuthRejection(error)) {
                        await clearAuthTokens();
                        accessToken = null;
                        refreshToken = null;
                        storedMember = null;
                    }
                }
            }

            if (!authenticated) {
                // With no refresh credential there is nothing recoverable to keep.
                if (!refreshToken) {
                    await clearAuthTokens();
                    accessToken = null;
                    storedMember = null;
                }
            }

            if (authenticated) {
                try {
                    // DB 상태를 기준으로 동기화해 재설치·기기 변경 후에도 큐레이션 여부가 유지된다.
                    const remoteStatus = await getMemberCurationStatus();
                    if (!isCurrent()) return false;
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
                    if (!isCurrent()) return false;
                    authenticated = Boolean(accessToken && refreshToken && storedMember?.id);
                    if (!authenticated) curationCompleted = false;
                }
            }

            if (!isCurrent()) return false;

            setIsAuthenticated(authenticated);
            setIsCurationCompleted(authenticated && curationCompleted);

            return authenticated;
        } catch {
            if (isCurrent()) {
                setIsAuthenticated(false);
                setIsCurationCompleted(false);
            }
            return false;
        } finally {
            if (isCurrent()) setIsLoading(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        // Any slower authentication/status request that started before logout
        // must not restore the just-removed session when it eventually finishes.
        authenticationSequenceRef.current += 1;
        // Stop an in-flight permission/token bootstrap before the server revokes
        // this account's devices, otherwise a late registration could add the
        // just-signed-out device again after logout.
        cancelPendingPushRegistration();
        const refreshToken = await getRefreshToken().catch(() => null);

        if (refreshToken) {
            await logoutMember({ refreshToken }).catch(() => undefined);
        }

        // clearAuthTokens awaits the async invalidation listener below, so cache
        // cleanup is complete before another account can enter the app.
        await clearAuthTokens();
        setIsAuthenticated(false);
        setIsCurationCompleted(false);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        syncAuthentication();
    }, [syncAuthentication]);

    useEffect(() => subscribeAuthInvalidation(async () => {
        authenticationSequenceRef.current += 1;
        // Interceptor-driven invalidation bypasses signOut, so clear member-owned
        // caches here as well before another account can authenticate.
        await clearAccountScopedLocalData();
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

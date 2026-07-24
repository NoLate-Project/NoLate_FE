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
    activateAuthSessionIfCurrent,
    beginAuthLogoutIntent,
    clearAuthTokens,
    clearAuthTokensIfCurrent,
    clearRestorableAuthSessionIfCurrent,
    getAccessToken,
    getAuthMember,
    getAuthSessionEpoch,
    getRefreshToken,
    isAuthSessionActive,
    saveAuthCurationCompleted,
    subscribeAuthInvalidation,
    type AuthLogoutIntent,
    type AuthRestoreContext,
} from "./authStorage";
import { clearAccountScopedLocalData } from "./accountCleanup";
import { cancelPendingPushRegistration } from "../notification/pushRegistrationCoordinator";
import { isDefinitiveAuthRejection } from "./refreshPolicy";
import { restoreAuthSessionIfCurrent } from "./conditionalAuthRestore";
import {
    registerAuthSessionTransitionBarrier,
} from "./authSessionEpoch";

type AuthContextValue = {
    isAuthenticated: boolean;
    isCurationCompleted: boolean;
    isLoading: boolean;
    syncAuthentication: () => Promise<boolean>;
    beginAccountExit: () => Promise<AuthLogoutIntent>;
    signOut: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function beginStandaloneAccountExit(): {
    intentPromise: Promise<AuthLogoutIntent>;
    credentialClearPromise: Promise<boolean>;
    cleanupPromise: Promise<void>;
} {
    cancelPendingPushRegistration();
    const intentPromise = beginAuthLogoutIntent();
    const credentialClearPromise = intentPromise.then((intent) =>
        clearAuthTokensIfCurrent(intent.epoch, { notifyListeners: false })
    );
    const cleanupPromise = clearAccountScopedLocalData();
    registerAuthSessionTransitionBarrier(Promise.all([
        credentialClearPromise,
        cleanupPromise,
    ]));
    return { intentPromise, credentialClearPromise, cleanupPromise };
}

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
    beginAccountExit: () => beginStandaloneAccountExit().intentPromise,
    signOut: async () => {
        const operation = beginStandaloneAccountExit();
        const logoutIntent = await operation.intentPromise;
        const cleared = await operation.credentialClearPromise;
        await operation.cleanupPromise;
        if (logoutIntent.refreshToken) {
            await logoutMember({ refreshToken: logoutIntent.refreshToken })
                .catch(() => undefined);
        }
        return cleared;
    },
};

export function AuthProvider({ children }: PropsWithChildren) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isCurationCompleted, setIsCurationCompleted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const authenticationSequenceRef = useRef(0);
    const accountExitRef = useRef<{
        intentPromise: Promise<AuthLogoutIntent>;
        localCredentialClearPromise: Promise<boolean>;
        localCleanupPromise: Promise<void>;
        completionPromise?: Promise<boolean>;
    } | undefined>(undefined);

    const syncAuthentication = useCallback(async () => {
        const sequence = authenticationSequenceRef.current + 1;
        authenticationSequenceRef.current = sequence;
        const isCurrent = () => authenticationSequenceRef.current === sequence;

        try {
            const restoreEpoch = getAuthSessionEpoch();
            let [accessToken, refreshToken, storedMember] = await Promise.all([
                getAccessToken(),
                getRefreshToken(),
                getAuthMember(),
            ]);
            let authenticated = Boolean(accessToken && refreshToken && storedMember?.id);
            let curationCompleted = storedMember?.curationCompleted === true;
            let restoreContext: AuthRestoreContext | undefined;

            // Member metadata is a cache, not an authentication credential. A
            // Keychain migration or interrupted write can leave a valid refresh
            // token without that cache; rebuild it from the server before deciding
            // to discard the session.
            if (!authenticated && refreshToken) {
                restoreContext = {
                    expectedEpoch: restoreEpoch,
                    expectedRefreshToken: refreshToken,
                };
                try {
                    const restoredMember = await restoreAuthSessionIfCurrent({
                        context: restoreContext,
                        tokenLogin: (token) =>
                            tokenLoginMember({ refreshToken: token }),
                    });
                    if (!isCurrent()) return false;
                    if (
                        restoredMember?.id &&
                        restoredMember.accessToken &&
                        restoredMember.refreshToken
                    ) {
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
                        await clearRestorableAuthSessionIfCurrent(restoreContext);
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
            if (
                authenticated &&
                !activateAuthSessionIfCurrent(getAuthSessionEpoch())
            ) {
                authenticated = false;
                curationCompleted = false;
            }

            setIsAuthenticated(authenticated);
            setIsCurationCompleted(authenticated && curationCompleted);
            if (authenticated) accountExitRef.current = undefined;

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

    const beginAccountExit = useCallback(() => {
        const existing = accountExitRef.current;
        if (existing) return existing.intentPromise;

        // Any slower authentication/status request that started before logout
        // must not restore the just-removed session when it eventually finishes.
        authenticationSequenceRef.current += 1;
        cancelPendingPushRegistration();
        setIsAuthenticated(false);
        setIsCurationCompleted(false);
        setIsLoading(false);

        // beginAuthLogoutIntent closes the central fence synchronously before
        // its refresh-token snapshot awaits storage.
        const intentPromise = beginAuthLogoutIntent();
        const operation = {
            intentPromise,
            localCredentialClearPromise: intentPromise.then((intent) =>
                clearAuthTokensIfCurrent(intent.epoch, {
                    notifyListeners: false,
                })
            ),
            localCleanupPromise: clearAccountScopedLocalData(),
        };
        registerAuthSessionTransitionBarrier(Promise.all([
            operation.localCredentialClearPromise,
            operation.localCleanupPromise,
        ]));
        accountExitRef.current = operation;
        return operation.intentPromise;
    }, []);

    const signOut = useCallback(async (): Promise<boolean> => {
        const intentPromise = beginAccountExit();
        const operation = accountExitRef.current;
        if (!operation) return false;
        if (!operation.completionPromise) {
            operation.completionPromise = (async () => {
                const logoutIntent = await intentPromise;
                // beginAccountExit already started local credential removal, so
                // an external SDK/withdrawal wait cannot leave a restorable A session.
                const cleared = await operation.localCredentialClearPromise;
                await operation.localCleanupPromise;
                if (logoutIntent.refreshToken) {
                    await logoutMember({ refreshToken: logoutIntent.refreshToken })
                        .catch(() => undefined);
                }
                return cleared && !isAuthSessionActive();
            })();
        }
        return operation.completionPromise;
    }, [beginAccountExit]);

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
            beginAccountExit,
            signOut,
        }),
        [
            beginAccountExit,
            isAuthenticated,
            isCurationCompleted,
            isLoading,
            signOut,
            syncAuthentication,
        ]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);

    return context ?? fallbackAuthContext;
}

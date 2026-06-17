import React, {
    createContext,
    type PropsWithChildren,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

import { logoutMember } from "../../api/member";
import { clearAuthTokens, getAccessToken, getRefreshToken } from "./authStorage";

type AuthContextValue = {
    isAuthenticated: boolean;
    isLoading: boolean;
    syncAuthentication: () => Promise<boolean>;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const fallbackAuthContext: AuthContextValue = {
    isAuthenticated: false,
    isLoading: false,
    syncAuthentication: async () => {
        try {
            return Boolean(await getAccessToken());
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
    const [isLoading, setIsLoading] = useState(true);

    const syncAuthentication = useCallback(async () => {
        try {
            const accessToken = await getAccessToken();
            const authenticated = Boolean(accessToken);

            setIsAuthenticated(authenticated);

            return authenticated;
        } catch {
            setIsAuthenticated(false);
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
        setIsLoading(false);
    }, []);

    useEffect(() => {
        syncAuthentication();
    }, [syncAuthentication]);

    const value = useMemo(
        () => ({
            isAuthenticated,
            isLoading,
            syncAuthentication,
            signOut,
        }),
        [isAuthenticated, isLoading, syncAuthentication, signOut]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);

    return context ?? fallbackAuthContext;
}

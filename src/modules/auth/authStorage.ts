import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "nolte_access_token";
const REFRESH_TOKEN_KEY = "nolte_refresh_token";

export async function saveAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    if (accessToken) {
        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    }

    if (refreshToken) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    }
}

export async function getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearAuthTokens() {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

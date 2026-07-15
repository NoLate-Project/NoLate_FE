import * as SecureStore from "../storage/secureStorage";

const ACCESS_TOKEN_KEY = "nolte_access_token";
const REFRESH_TOKEN_KEY = "nolte_refresh_token";
const AUTH_MEMBER_KEY = "nolate_auth_member";

export type StoredAuthMember = {
    id?: number;
    name?: string;
    email?: string;
    loginType?: string;
    snsId?: string;
};

function normalizeAuthMember(member: StoredAuthMember | null | undefined): StoredAuthMember | null {
    if (!member) return null;

    const normalized: StoredAuthMember = {};

    if (typeof member.id === "number" && Number.isFinite(member.id)) {
        normalized.id = member.id;
    }

    const name = member.name?.trim();
    const email = member.email?.trim();
    const loginType = member.loginType?.trim();
    const snsId = member.snsId?.trim();

    if (name) normalized.name = name;
    if (email) normalized.email = email;
    if (loginType) normalized.loginType = loginType;
    if (snsId) normalized.snsId = snsId;

    return Object.keys(normalized).length > 0 ? normalized : null;
}

export async function saveAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    if (accessToken) {
        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    }

    if (refreshToken) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    }
}

export async function saveAuthMember(member?: StoredAuthMember | null) {
    const normalized = normalizeAuthMember(member);

    if (!normalized) {
        await SecureStore.deleteItemAsync(AUTH_MEMBER_KEY);
        return;
    }

    await SecureStore.setItemAsync(AUTH_MEMBER_KEY, JSON.stringify(normalized));
}

export async function getAuthMember(): Promise<StoredAuthMember | null> {
    const raw = await SecureStore.getItemAsync(AUTH_MEMBER_KEY);
    if (!raw) return null;

    try {
        return normalizeAuthMember(JSON.parse(raw) as StoredAuthMember);
    } catch {
        await SecureStore.deleteItemAsync(AUTH_MEMBER_KEY);
        return null;
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
    await SecureStore.deleteItemAsync(AUTH_MEMBER_KEY);
}

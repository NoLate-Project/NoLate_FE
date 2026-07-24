import * as SecureStore from "../storage/secureStorage";
import { NativeModules, Platform } from "react-native";

const ACCESS_TOKEN_KEY = "nolte_access_token";
const REFRESH_TOKEN_KEY = "nolte_refresh_token";
const AUTH_MEMBER_KEY = "nolate_auth_member";
const AUTH_API_BASE_URL_KEY = "nolate_auth_api_base_url";
let currentAuthApiBaseUrl: string | null = null;
type AuthInvalidationListener = () => void | Promise<void>;

const authInvalidationListeners = new Set<AuthInvalidationListener>();
const authSessionEpochListeners = new Set<(epoch: number) => void>();
let authSessionEpoch = 0;
let authTokenMutationTail: Promise<void> = Promise.resolve();

function bumpAuthSessionEpoch(): number {
    authSessionEpoch += 1;
    authSessionEpochListeners.forEach((listener) => listener(authSessionEpoch));
    return authSessionEpoch;
}

function runAuthTokenMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = authTokenMutationTail.then(operation, operation);
    authTokenMutationTail = result.then(() => undefined, () => undefined);
    return result;
}

export function getAuthSessionEpoch(): number {
    return authSessionEpoch;
}

export function isAuthSessionEpochCurrent(epoch: number): boolean {
    return authSessionEpoch === epoch;
}

export function subscribeAuthSessionEpoch(listener: (epoch: number) => void): () => void {
    authSessionEpochListeners.add(listener);
    return () => authSessionEpochListeners.delete(listener);
}

export type AuthLogoutIntent = {
    epoch: number;
    refreshToken: string | null;
};

export function configureSharedAuthApiBaseUrl(apiBaseUrl: string) {
    const normalized = apiBaseUrl.trim().replace(/\/$/, "");
    currentAuthApiBaseUrl = /^https?:\/\//i.test(normalized) ? normalized : null;
}

export function subscribeAuthInvalidation(listener: AuthInvalidationListener) {
    authInvalidationListeners.add(listener);
    return () => {
        authInvalidationListeners.delete(listener);
    };
}

type SharedAuthModule = {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<boolean>;
    deleteItem(key: string): Promise<boolean>;
};

const sharedAuth = Platform.OS === "ios"
    ? NativeModules.NoLateShareAuth as SharedAuthModule | undefined
    : undefined;

function reportSharedAuthError(operation: string, key: string, error: unknown) {
    if (!__DEV__ || process.env.NODE_ENV === "test") return;
    console.warn(`[auth] 공유 Keychain ${operation} 실패 (${key})`, error);
}

async function saveSharedItem(key: string, value: string) {
    await sharedAuth?.setItem(key, value).catch((error) => {
        reportSharedAuthError("저장", key, error);
        return undefined;
    });
}

async function deleteSharedItem(key: string) {
    await sharedAuth?.deleteItem(key).catch((error) => {
        reportSharedAuthError("삭제", key, error);
        return undefined;
    });
}

async function readSharedItem(key: string): Promise<string | null> {
    return sharedAuth?.getItem(key).catch((error) => {
        reportSharedAuthError("조회", key, error);
        return null;
    }) ?? null;
}

async function syncSharedApiBaseUrl() {
    if (currentAuthApiBaseUrl) {
        await saveSharedItem(AUTH_API_BASE_URL_KEY, currentAuthApiBaseUrl);
    }
}

async function getAuthToken(key: string): Promise<string | null> {
    const sharedValue = await readSharedItem(key);
    if (sharedValue) {
        await syncSharedApiBaseUrl();
        return sharedValue;
    }

    const storedValue = await SecureStore.getItemAsync(key);
    if (storedValue) {
        await Promise.all([
            saveSharedItem(key, storedValue),
            syncSharedApiBaseUrl(),
        ]);
    }
    return storedValue;
}

export type StoredAuthMember = {
    id?: number;
    name?: string;
    email?: string;
    loginType?: string;
    snsId?: string;
    curationCompleted?: boolean;
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
    if (typeof member.curationCompleted === "boolean") {
        normalized.curationCompleted = member.curationCompleted;
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
}

async function writeAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    const writes: Promise<unknown>[] = [syncSharedApiBaseUrl()];

    if (accessToken) {
        writes.push(
            SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
            saveSharedItem(ACCESS_TOKEN_KEY, accessToken)
        );
    }

    if (refreshToken) {
        writes.push(
            SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
            saveSharedItem(REFRESH_TOKEN_KEY, refreshToken)
        );
    }

    await Promise.all(writes);
}

export async function saveAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    // Explicit login/account restoration is a new intent and invalidates any
    // refresh response captured for the previous session.
    bumpAuthSessionEpoch();
    await runAuthTokenMutation(() => writeAuthTokens(accessToken, refreshToken));
}

export async function isAuthRefreshContextCurrent(options: {
    expectedEpoch: number;
    expectedRefreshToken: string;
}): Promise<boolean> {
    if (!isAuthSessionEpochCurrent(options.expectedEpoch)) return false;
    const currentRefreshToken = await getRefreshToken();
    return isAuthSessionEpochCurrent(options.expectedEpoch) &&
        currentRefreshToken === options.expectedRefreshToken;
}

export async function saveRefreshedAuthTokensIfCurrent(options: {
    accessToken: string;
    refreshToken: string;
    expectedEpoch: number;
    expectedRefreshToken: string;
}): Promise<boolean> {
    return runAuthTokenMutation(async () => {
        if (!await isAuthRefreshContextCurrent(options)) return false;
        await writeAuthTokens(options.accessToken, options.refreshToken);
        return isAuthSessionEpochCurrent(options.expectedEpoch);
    });
}

export async function saveAuthMember(member?: StoredAuthMember | null) {
    const expectedEpoch = getAuthSessionEpoch();
    const normalized = normalizeAuthMember(member);
    await runAuthTokenMutation(async () => {
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return;
        if (!normalized) {
            await SecureStore.deleteItemAsync(AUTH_MEMBER_KEY);
            await deleteSharedItem(AUTH_MEMBER_KEY);
            return;
        }

        const serialized = JSON.stringify(normalized);
        await Promise.all([
            SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized),
            saveSharedItem(AUTH_MEMBER_KEY, serialized),
        ]);
    });
}

export async function getAuthMember(): Promise<StoredAuthMember | null> {
    const expectedEpoch = getAuthSessionEpoch();
    const [sharedRaw, storedRaw] = await Promise.all([
        readSharedItem(AUTH_MEMBER_KEY),
        SecureStore.getItemAsync(AUTH_MEMBER_KEY),
    ]);
    const raw = sharedRaw ?? storedRaw;
    if (!raw) return null;

    try {
        const normalized = normalizeAuthMember(JSON.parse(raw) as StoredAuthMember);
        if (!normalized) {
            if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
            await Promise.all([
                SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
                deleteSharedItem(AUTH_MEMBER_KEY),
            ]);
            return null;
        }

        const serialized = JSON.stringify(normalized);
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        if (sharedRaw) {
            if (storedRaw !== serialized) await SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized);
        } else {
            await saveSharedItem(AUTH_MEMBER_KEY, serialized);
        }
        return normalized;
    } catch {
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        await Promise.all([
            SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
            deleteSharedItem(AUTH_MEMBER_KEY),
        ]);
        return null;
    }
}

export async function saveAuthCurationCompleted(curationCompleted: boolean): Promise<void> {
    const expectedEpoch = getAuthSessionEpoch();
    const current = await getAuthMember();
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return;
    await saveAuthMember({
        ...(current ?? {}),
        curationCompleted,
    });
}

export async function getAccessToken(): Promise<string | null> {
    return getAuthToken(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
    return getAuthToken(REFRESH_TOKEN_KEY);
}

export async function beginAuthLogoutIntent(): Promise<AuthLogoutIntent> {
    // Abort refresh and other account-owned work at the moment the user chooses
    // logout, before the best-effort server logout request can block.
    const epoch = bumpAuthSessionEpoch();
    const refreshToken = await runAuthTokenMutation(() => getRefreshToken());
    return { epoch, refreshToken };
}

export async function clearAuthTokensIfCurrent(
    expectedEpoch: number,
    options: { notifyListeners?: boolean } = {},
): Promise<boolean> {
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return false;
    await clearAuthTokens(options);
    return true;
}

export async function clearAuthTokens({ notifyListeners = true } = {}) {
    // Invalidate pending account-owned async work before any storage deletion awaits.
    bumpAuthSessionEpoch();
    const deletionResults = await runAuthTokenMutation(() => Promise.allSettled([
            SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
            SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
            SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
            deleteSharedItem(ACCESS_TOKEN_KEY),
            deleteSharedItem(REFRESH_TOKEN_KEY),
            deleteSharedItem(AUTH_MEMBER_KEY),
            deleteSharedItem(AUTH_API_BASE_URL_KEY),
        ]));
    if (__DEV__ && process.env.NODE_ENV !== "test") {
        deletionResults.forEach((result) => {
            if (result.status === "rejected") {
                console.warn("[auth] 로컬 인증 정보 삭제 실패", result.reason);
            }
        });
    }
    if (notifyListeners) {
        // Callers must not return to a login surface while member-owned caches are
        // still being deleted, otherwise a fast account switch can race cleanup.
        await Promise.allSettled(
            Array.from(authInvalidationListeners, (listener) => listener()),
        );
    }
}

import * as SecureStore from "../storage/secureStorage";
import { NativeModules, Platform } from "react-native";

const ACCESS_TOKEN_KEY = "nolte_access_token";
const REFRESH_TOKEN_KEY = "nolte_refresh_token";
const AUTH_MEMBER_KEY = "nolate_auth_member";
const AUTH_API_BASE_URL_KEY = "nolate_auth_api_base_url";
let currentAuthApiBaseUrl: string | null = null;
const authTokenMemoryCache = new Map<string, string | null>();
const authTokenReadInFlight = new Map<string, Promise<string | null>>();
let authTokenCacheGeneration = 0;
type AuthInvalidationListener = () => void | Promise<void>;

const authInvalidationListeners = new Set<AuthInvalidationListener>();

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

async function readAuthTokenFromStorage(key: string): Promise<string | null> {
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

/** 인증 부트스트랩 이후 API 요청이 매번 Keychain IPC를 다시 기다리지 않게 한다. */
async function getAuthToken(key: string): Promise<string | null> {
    if (authTokenMemoryCache.has(key)) {
        return authTokenMemoryCache.get(key) ?? null;
    }

    const existing = authTokenReadInFlight.get(key);
    if (existing) return existing;

    const generation = authTokenCacheGeneration;
    const request = readAuthTokenFromStorage(key)
        .then(value => {
            if (generation === authTokenCacheGeneration) {
                authTokenMemoryCache.set(key, value);
            }
            return value;
        })
        .finally(() => {
            if (authTokenReadInFlight.get(key) === request) {
                authTokenReadInFlight.delete(key);
            }
        });
    authTokenReadInFlight.set(key, request);
    return request;
}

export type StoredAuthMember = {
    id?: number;
    name?: string;
    email?: string;
    loginType?: string;
    snsId?: string;
    curationCompleted?: boolean;
};

let authMemberMemoryCache: StoredAuthMember | null = null;
let authMemberMemoryCacheInitialized = false;
let authMemberReadInFlight: Promise<StoredAuthMember | null> | null = null;
let authMemberCacheGeneration = 0;

function cloneAuthMember(member: StoredAuthMember | null): StoredAuthMember | null {
    return member ? { ...member } : null;
}

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

export async function saveAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
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
    authTokenCacheGeneration += 1;
    authTokenReadInFlight.clear();
    if (accessToken) authTokenMemoryCache.set(ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken) authTokenMemoryCache.set(REFRESH_TOKEN_KEY, refreshToken);
}

export async function saveAuthMember(member?: StoredAuthMember | null) {
    const normalized = normalizeAuthMember(member);

    if (!normalized) {
        authMemberCacheGeneration += 1;
        authMemberMemoryCacheInitialized = true;
        authMemberMemoryCache = null;
        authMemberReadInFlight = null;
        await SecureStore.deleteItemAsync(AUTH_MEMBER_KEY);
        await deleteSharedItem(AUTH_MEMBER_KEY);
        return;
    }

    const serialized = JSON.stringify(normalized);
    await Promise.all([
        SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized),
        saveSharedItem(AUTH_MEMBER_KEY, serialized),
    ]);
    authMemberCacheGeneration += 1;
    authMemberMemoryCacheInitialized = true;
    authMemberMemoryCache = cloneAuthMember(normalized);
    authMemberReadInFlight = null;
}

async function readAuthMemberFromStorage(): Promise<StoredAuthMember | null> {
    const [sharedRaw, storedRaw] = await Promise.all([
        readSharedItem(AUTH_MEMBER_KEY),
        SecureStore.getItemAsync(AUTH_MEMBER_KEY),
    ]);
    const raw = sharedRaw ?? storedRaw;
    if (!raw) return null;

    try {
        const normalized = normalizeAuthMember(JSON.parse(raw) as StoredAuthMember);
        if (!normalized) {
            await Promise.all([
                SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
                deleteSharedItem(AUTH_MEMBER_KEY),
            ]);
            return null;
        }

        const serialized = JSON.stringify(normalized);
        if (sharedRaw) {
            if (storedRaw !== serialized) await SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized);
        } else {
            await saveSharedItem(AUTH_MEMBER_KEY, serialized);
        }
        return normalized;
    } catch {
        await Promise.all([
            SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
            deleteSharedItem(AUTH_MEMBER_KEY),
        ]);
        return null;
    }
}

/** 회원 메타데이터도 토큰과 같은 프로세스 수명 캐시를 사용해 화면 진입을 막지 않는다. */
export async function getAuthMember(): Promise<StoredAuthMember | null> {
    if (authMemberMemoryCacheInitialized) {
        return cloneAuthMember(authMemberMemoryCache);
    }
    if (authMemberReadInFlight) {
        return authMemberReadInFlight.then(cloneAuthMember);
    }

    const generation = authMemberCacheGeneration;
    const request = readAuthMemberFromStorage()
        .then(member => {
            if (generation === authMemberCacheGeneration) {
                authMemberMemoryCacheInitialized = true;
                authMemberMemoryCache = cloneAuthMember(member);
            }
            return member;
        })
        .finally(() => {
            if (authMemberReadInFlight === request) {
                authMemberReadInFlight = null;
            }
        });
    authMemberReadInFlight = request;
    return request.then(cloneAuthMember);
}

export async function saveAuthCurationCompleted(curationCompleted: boolean): Promise<void> {
    const current = await getAuthMember();
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

export async function clearAuthTokens({ notifyListeners = true } = {}) {
    if (notifyListeners) {
        // Account-scoped native state (including system alarms) must be purged
        // while the current member binding is still readable. Each listener is
        // failure-isolated so credential deletion cannot be skipped.
        const cleanupResults = await Promise.allSettled(
            Array.from(authInvalidationListeners, (listener) => listener()),
        );
        const cleanupFailure = cleanupResults.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (cleanupFailure) {
            throw cleanupFailure.reason;
        }
    }

    // Once account cleanup succeeds, new requests must not observe an old
    // in-memory credential while durable Keychain deletion is still running.
    authTokenCacheGeneration += 1;
    authTokenReadInFlight.clear();
    authTokenMemoryCache.set(ACCESS_TOKEN_KEY, null);
    authTokenMemoryCache.set(REFRESH_TOKEN_KEY, null);
    authMemberCacheGeneration += 1;
    authMemberMemoryCacheInitialized = true;
    authMemberMemoryCache = null;
    authMemberReadInFlight = null;

    const deletionResults = await Promise.allSettled([
        SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
        deleteSharedItem(ACCESS_TOKEN_KEY),
        deleteSharedItem(REFRESH_TOKEN_KEY),
        deleteSharedItem(AUTH_MEMBER_KEY),
        deleteSharedItem(AUTH_API_BASE_URL_KEY),
    ]);
    if (__DEV__ && process.env.NODE_ENV !== "test") {
        deletionResults.forEach((result) => {
            if (result.status === "rejected") {
                console.warn("[auth] 로컬 인증 정보 삭제 실패", result.reason);
            }
        });
    }
}

export function resetAuthStorageMemoryCacheForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    authTokenCacheGeneration += 1;
    authTokenMemoryCache.clear();
    authTokenReadInFlight.clear();
    authMemberCacheGeneration += 1;
    authMemberMemoryCacheInitialized = false;
    authMemberMemoryCache = null;
    authMemberReadInFlight = null;
}

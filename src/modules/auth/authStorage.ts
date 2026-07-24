import * as SecureStore from "../storage/secureStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import {
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    beginAuthLogoutSession,
    completeAuthLogoutSession,
    getAuthSessionEpoch,
    invalidateAuthSession,
    isAuthSessionEpochCurrent,
    isAuthSessionRestorable,
    isAuthSessionWritable,
    registerAuthSessionTransitionBarrier,
    waitForAuthSessionTransition,
} from "./authSessionEpoch";

export {
    activateAuthSessionIfCurrent,
    getAuthSessionEpoch,
    isAuthSessionActive,
    isAuthSessionEpochCurrent,
    isAuthSessionRestorable,
    subscribeAuthSessionEpoch,
} from "./authSessionEpoch";

const ACCESS_TOKEN_KEY = "nolte_access_token";
const REFRESH_TOKEN_KEY = "nolte_refresh_token";
const AUTH_MEMBER_KEY = "nolate_auth_member";
const AUTH_API_BASE_URL_KEY = "nolate_auth_api_base_url";
const AUTH_INVALID_SESSION_KEY = "nolate_auth_invalid_session";
const AUTH_INVALID_SESSION_VALUE = "invalidated";
let currentAuthApiBaseUrl: string | null = null;
let hasInMemoryInvalidSessionMarker = false;
type AuthInvalidationListener = () => void | Promise<void>;

const authInvalidationListeners = new Set<AuthInvalidationListener>();
let authTokenMutationTail: Promise<void> = Promise.resolve();

function runAuthTokenMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = authTokenMutationTail.then(operation, operation);
    authTokenMutationTail = result.then(() => undefined, () => undefined);
    return result;
}

export type AuthLogoutIntent = {
    epoch: number;
    accessToken: string | null;
    refreshToken: string | null;
};

export function configureSharedAuthApiBaseUrl(apiBaseUrl: string) {
    const normalized = apiBaseUrl.trim().replace(/\/$/, "");
    currentAuthApiBaseUrl = /^https?:\/\//i.test(normalized) ? normalized : null;
}

export function __resetAuthStorageInvalidSessionForTests(): void {
    if (process.env.NODE_ENV === "test") {
        hasInMemoryInvalidSessionMarker = false;
    }
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

async function setSharedItemStrict(
    key: string,
    value: string,
): Promise<void> {
    if (!sharedAuth) return;
    const saved = await sharedAuth.setItem(key, value);
    if (!saved) throw new Error(`공유 Keychain 저장 실패 (${key})`);
}

async function deleteSharedItemStrict(key: string): Promise<void> {
    if (!sharedAuth) return;
    const deleted = await sharedAuth.deleteItem(key);
    if (!deleted) throw new Error(`공유 Keychain 삭제 실패 (${key})`);
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

async function getAuthTokenWithinMutation(
    key: string,
    expectedEpoch: number,
    repair: boolean,
): Promise<string | null> {
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
    const sharedValue = await readSharedItem(key);
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
    if (sharedValue) {
        if (repair) await syncSharedApiBaseUrl();
        return isAuthSessionEpochCurrent(expectedEpoch) ? sharedValue : null;
    }

    const storedValue = await SecureStore.getItemAsync(key);
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
    if (storedValue && repair) {
        await Promise.all([
            saveSharedItem(key, storedValue),
            syncSharedApiBaseUrl(),
        ]);
    }
    return isAuthSessionEpochCurrent(expectedEpoch) ? storedValue : null;
}

async function getAuthToken(key: string): Promise<string | null> {
    const expectedEpoch = getAuthSessionEpoch();
    // Reads join the same queue as login/refresh/clear. This prevents a stale
    // SecureStore snapshot from being repaired into shared Keychain after a newer
    // write, while the epoch checks let logout invalidate an already-running read.
    return runAuthTokenMutation(async () => {
        if (await hasInvalidSessionMarkerWithinMutation()) return null;
        return getAuthTokenWithinMutation(key, expectedEpoch, true);
    });
}

export type StoredAuthMember = {
    id?: number;
    name?: string;
    email?: string;
    loginType?: string;
    snsId?: string;
    curationCompleted?: boolean;
};

export type AuthRestoreContext = {
    expectedEpoch: number;
    expectedRefreshToken: string;
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

function parseNormalizedAuthMember(raw: string | null): StoredAuthMember | null {
    if (!raw) return null;
    try {
        return normalizeAuthMember(JSON.parse(raw) as StoredAuthMember);
    } catch {
        return null;
    }
}

async function writeAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    const writes: Promise<unknown>[] = [syncSharedApiBaseUrl()];

    if (accessToken) {
        writes.push(
            SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
            setSharedItemStrict(ACCESS_TOKEN_KEY, accessToken),
        );
    }

    if (refreshToken) {
        writes.push(
            SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
            setSharedItemStrict(REFRESH_TOKEN_KEY, refreshToken),
        );
    }

    await Promise.all(writes);
}

async function writeNormalizedAuthMember(member: StoredAuthMember): Promise<void> {
    const serialized = JSON.stringify(member);
    await Promise.all([
        SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized),
        saveSharedItem(AUTH_MEMBER_KEY, serialized),
    ]);
}

async function deleteAuthStorageWithinMutation(): Promise<
    PromiseSettledResult<unknown>[]
> {
    return Promise.allSettled([
        SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
        deleteSharedItemStrict(ACCESS_TOKEN_KEY),
        deleteSharedItemStrict(REFRESH_TOKEN_KEY),
        deleteSharedItemStrict(AUTH_MEMBER_KEY),
        deleteSharedItemStrict(AUTH_API_BASE_URL_KEY),
    ]);
}

type InvalidSessionMarkerWriteResult = {
    anySucceeded: boolean;
    allSucceeded: boolean;
    results: PromiseSettledResult<unknown>[];
};

async function persistInvalidSessionMarkerWithinMutation(): Promise<
    InvalidSessionMarkerWriteResult
> {
    const writes: Promise<unknown>[] = [
        SecureStore.setItemAsync(
            AUTH_INVALID_SESSION_KEY,
            AUTH_INVALID_SESSION_VALUE,
        ),
        AsyncStorage.setItem(
            AUTH_INVALID_SESSION_KEY,
            AUTH_INVALID_SESSION_VALUE,
        ),
    ];
    if (sharedAuth) {
        writes.push(setSharedItemStrict(
            AUTH_INVALID_SESSION_KEY,
            AUTH_INVALID_SESSION_VALUE,
        ));
    }
    const results = await Promise.allSettled(writes);
    return {
        anySucceeded: results.some((result) => result.status === "fulfilled"),
        allSucceeded: results.every((result) => result.status === "fulfilled"),
        results,
    };
}

async function clearInvalidSessionMarkerWithinMutation(): Promise<void> {
    const removals: Promise<unknown>[] = [
        SecureStore.deleteItemAsync(AUTH_INVALID_SESSION_KEY),
        AsyncStorage.removeItem(AUTH_INVALID_SESSION_KEY),
    ];
    if (sharedAuth) {
        removals.push(deleteSharedItemStrict(AUTH_INVALID_SESSION_KEY));
    }
    const results = await Promise.allSettled(removals);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
}

async function hasInvalidSessionMarkerWithinMutation(): Promise<boolean> {
    if (hasInMemoryInvalidSessionMarker) return true;
    const reads: Promise<string | null>[] = [
        SecureStore.getItemAsync(AUTH_INVALID_SESSION_KEY),
        AsyncStorage.getItem(AUTH_INVALID_SESSION_KEY),
    ];
    if (sharedAuth) reads.push(sharedAuth.getItem(AUTH_INVALID_SESSION_KEY));
    const results = await Promise.allSettled(reads);
    // A marker store that cannot be checked is not evidence that stale
    // credentials are safe. Cold bootstrap therefore fails closed.
    if (results.some((result) => result.status === "rejected")) return true;
    return results.some((result) =>
        result.status === "fulfilled" &&
        result.value === AUTH_INVALID_SESSION_VALUE
    );
}

type AuthStorageInvalidationResult = {
    succeeded: boolean;
    deletionResults: PromiseSettledResult<unknown>[];
    markerResults: PromiseSettledResult<unknown>[];
};

async function invalidateAuthStorageWithinMutation(): Promise<
    AuthStorageInvalidationResult
> {
    const marker = await persistInvalidSessionMarkerWithinMutation();
    const deletionResults = await deleteAuthStorageWithinMutation();
    const deletionSucceeded = deletionResults.every(
        (result) => result.status === "fulfilled",
    );
    return {
        // At least one durable marker still makes a partial delete safe across
        // restart, but partial storage failure must not be reported as success.
        succeeded:
            marker.anySucceeded &&
            marker.allSucceeded &&
            deletionSucceeded,
        deletionResults,
        markerResults: marker.results,
    };
}

async function notifyAuthInvalidationListeners(): Promise<void> {
    // Callers must not return to a login surface while member-owned caches are
    // still being deleted, otherwise a fast account switch can race cleanup.
    await Promise.allSettled(
        Array.from(authInvalidationListeners, (listener) => listener()),
    );
}

function reportAuthDeletionFailures(
    deletionResults: PromiseSettledResult<unknown>[],
): void {
    if (!__DEV__ || process.env.NODE_ENV === "test") return;
    deletionResults.forEach((result) => {
        if (result.status === "rejected") {
            console.warn("[auth] 로컬 인증 정보 삭제 실패", result.reason);
        }
    });
}

function reportAuthInvalidationFailures(
    result: AuthStorageInvalidationResult,
): void {
    reportAuthDeletionFailures(result.deletionResults);
    if (!__DEV__ || process.env.NODE_ENV === "test") return;
    result.markerResults.forEach((markerResult) => {
        if (markerResult.status === "rejected") {
            console.warn(
                "[auth] 로그아웃 차단 marker 저장 실패",
                markerResult.reason,
            );
        }
    });
}

export async function saveAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    const normalizedAccessToken = accessToken?.trim();
    const normalizedRefreshToken = refreshToken?.trim();
    if (!normalizedAccessToken || !normalizedRefreshToken) {
        throw new Error("새 로그인 자격 증명이 완전하지 않습니다.");
    }
    // Explicit login/account restoration is a new intent and invalidates any
    // refresh response captured for the previous session.
    await waitForAuthSessionTransition();
    beginAuthLoginSession();
    await runAuthTokenMutation(async () => {
        await writeAuthTokens(normalizedAccessToken, normalizedRefreshToken);
        // Only an explicit new authentication intent may clear the durable
        // invalid-session marker, and only after both new credentials are stored.
        await clearInvalidSessionMarkerWithinMutation();
        hasInMemoryInvalidSessionMarker = false;
    });
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
        if (!isAuthSessionEpochCurrent(options.expectedEpoch)) return false;
        if (await hasInvalidSessionMarkerWithinMutation()) return false;
        const currentRefreshToken = await getAuthTokenWithinMutation(
            REFRESH_TOKEN_KEY,
            options.expectedEpoch,
            true,
        );
        if (
            !isAuthSessionEpochCurrent(options.expectedEpoch) ||
            currentRefreshToken !== options.expectedRefreshToken
        ) return false;
        await writeAuthTokens(options.accessToken, options.refreshToken);
        return isAuthSessionEpochCurrent(options.expectedEpoch);
    });
}

export async function saveAuthMember(member?: StoredAuthMember | null) {
    const expectedEpoch = getAuthSessionEpoch();
    if (!isAuthSessionWritable(expectedEpoch)) return;
    const normalized = normalizeAuthMember(member);
    await runAuthTokenMutation(async () => {
        if (!isAuthSessionWritable(expectedEpoch)) return;
        if (await hasInvalidSessionMarkerWithinMutation()) return;
        if (!normalized) {
            await SecureStore.deleteItemAsync(AUTH_MEMBER_KEY);
            await deleteSharedItem(AUTH_MEMBER_KEY);
            return;
        }

        await writeNormalizedAuthMember(normalized);
        if (normalized.id) activateAuthSessionIfCurrent(expectedEpoch);
    });
}

export async function captureAuthRestoreContext(): Promise<
    AuthRestoreContext | undefined
> {
    const expectedEpoch = getAuthSessionEpoch();
    if (!isAuthSessionRestorable(expectedEpoch)) return undefined;
    const expectedRefreshToken = await getRefreshToken();
    if (
        !expectedRefreshToken ||
        !isAuthSessionRestorable(expectedEpoch)
    ) return undefined;
    return { expectedEpoch, expectedRefreshToken };
}

export async function saveRestoredAuthSessionIfCurrent(options: {
    context: AuthRestoreContext;
    member: StoredAuthMember & {
        accessToken?: string | null;
        refreshToken?: string | null;
    };
}): Promise<boolean> {
    const normalized = normalizeAuthMember(options.member);
    const accessToken = options.member.accessToken?.trim();
    const refreshToken = options.member.refreshToken?.trim();
    if (!normalized?.id || !accessToken || !refreshToken) return false;

    return runAuthTokenMutation(async () => {
        if (!isAuthSessionRestorable(options.context.expectedEpoch)) return false;
        if (await hasInvalidSessionMarkerWithinMutation()) return false;
        const currentRefreshToken = await getAuthTokenWithinMutation(
            REFRESH_TOKEN_KEY,
            options.context.expectedEpoch,
            false,
        );
        if (
            !isAuthSessionRestorable(options.context.expectedEpoch) ||
            currentRefreshToken !== options.context.expectedRefreshToken
        ) return false;

        await writeAuthTokens(accessToken, refreshToken);
        if (!isAuthSessionRestorable(options.context.expectedEpoch)) return false;
        await writeNormalizedAuthMember(normalized);
        if (!isAuthSessionRestorable(options.context.expectedEpoch)) return false;
        return activateAuthSessionIfCurrent(options.context.expectedEpoch);
    });
}

export async function getAuthMember(): Promise<StoredAuthMember | null> {
    const expectedEpoch = getAuthSessionEpoch();
    return runAuthTokenMutation(async () => {
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        if (await hasInvalidSessionMarkerWithinMutation()) return null;
        const [sharedRaw, storedRaw] = await Promise.all([
            readSharedItem(AUTH_MEMBER_KEY),
            SecureStore.getItemAsync(AUTH_MEMBER_KEY),
        ]);
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        const sharedMember = parseNormalizedAuthMember(sharedRaw);
        const storedMember = parseNormalizedAuthMember(storedRaw);
        const normalized = sharedMember ?? storedMember;
        if (!normalized) {
            if (!sharedRaw && !storedRaw) return null;
            await Promise.all([
                SecureStore.deleteItemAsync(AUTH_MEMBER_KEY),
                deleteSharedItem(AUTH_MEMBER_KEY),
            ]);
            return null;
        }

        const serialized = JSON.stringify(normalized);
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        const repairs: Promise<unknown>[] = [];
        if (storedRaw !== serialized) {
            repairs.push(SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized));
        }
        if (sharedRaw !== serialized) {
            repairs.push(saveSharedItem(AUTH_MEMBER_KEY, serialized));
        }
        await Promise.all(repairs);
        return isAuthSessionEpochCurrent(expectedEpoch) ? normalized : null;
    });
}

export async function saveAuthCurationCompleted(curationCompleted: boolean): Promise<void> {
    const expectedEpoch = getAuthSessionEpoch();
    const [current, expectedRefreshToken] = await Promise.all([
        getAuthMember(),
        getRefreshToken(),
    ]);
    if (
        !isAuthSessionEpochCurrent(expectedEpoch) ||
        !current?.id ||
        !expectedRefreshToken
    ) return;
    await saveAuthCurationCompletedForSession({
        curationCompleted,
        expectedEpoch,
        expectedRefreshToken,
        expectedMemberId: current.id,
    });
}

export async function saveAuthCurationCompletedForSession(options: {
    curationCompleted: boolean;
    expectedEpoch: number;
    expectedRefreshToken: string;
    expectedMemberId: number;
}): Promise<boolean> {
    return runAuthTokenMutation(async () => {
        if (!isAuthSessionRestorable(options.expectedEpoch)) return false;
        if (await hasInvalidSessionMarkerWithinMutation()) return false;
        const currentRefreshToken = await getAuthTokenWithinMutation(
            REFRESH_TOKEN_KEY,
            options.expectedEpoch,
            false,
        );
        if (
            !isAuthSessionRestorable(options.expectedEpoch) ||
            currentRefreshToken !== options.expectedRefreshToken
        ) return false;

        const [sharedRaw, storedRaw] = await Promise.all([
            readSharedItem(AUTH_MEMBER_KEY),
            SecureStore.getItemAsync(AUTH_MEMBER_KEY),
        ]);
        if (!isAuthSessionRestorable(options.expectedEpoch)) return false;
        const currentMember =
            parseNormalizedAuthMember(sharedRaw) ??
            parseNormalizedAuthMember(storedRaw);
        if (currentMember?.id !== options.expectedMemberId) return false;

        await writeNormalizedAuthMember({
            ...currentMember,
            curationCompleted: options.curationCompleted,
        });
        return isAuthSessionRestorable(options.expectedEpoch);
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
    const epoch = beginAuthLogoutSession();
    hasInMemoryInvalidSessionMarker = true;
    const [accessTokenResult, refreshTokenResult] =
        await runAuthTokenMutation(async () => {
            const marker = await persistInvalidSessionMarkerWithinMutation();
            if (!marker.allSucceeded && __DEV__ && process.env.NODE_ENV !== "test") {
                console.warn(
                    "[auth] 로그아웃 marker를 일부 저장소에 기록하지 못했습니다.",
                );
            }
            return Promise.allSettled([
                getAuthTokenWithinMutation(ACCESS_TOKEN_KEY, epoch, false),
                getAuthTokenWithinMutation(REFRESH_TOKEN_KEY, epoch, false),
            ]);
        }).catch(() => [
            { status: "rejected" as const, reason: undefined },
            { status: "rejected" as const, reason: undefined },
        ]);
    const accessToken = accessTokenResult.status === "fulfilled"
        ? accessTokenResult.value
        : null;
    const refreshToken = refreshTokenResult.status === "fulfilled"
        ? refreshTokenResult.value
        : null;
    return { epoch, accessToken, refreshToken };
}

export function clearAuthTokensIfCurrent(
    expectedEpoch: number,
    options: { notifyListeners?: boolean } = {},
): Promise<boolean> {
    if (!isAuthSessionEpochCurrent(expectedEpoch)) {
        return Promise.resolve(false);
    }
    hasInMemoryInvalidSessionMarker = true;
    // Keep the logout intent's epoch stable so explicitly account-exit-bound
    // requests can finish with snapshotted credentials. All normal work remains
    // blocked because this session is no longer ACTIVE.
    completeAuthLogoutSession(expectedEpoch);
    const completion = (async () => {
        const result = await runAuthTokenMutation(
            invalidateAuthStorageWithinMutation,
        );
        reportAuthInvalidationFailures(result);
        if (options.notifyListeners !== false) {
            await notifyAuthInvalidationListeners();
        }
        return result.succeeded;
    })();
    registerAuthSessionTransitionBarrier(completion);
    return completion;
}

export function clearRestorableAuthSessionIfCurrent(
    context: AuthRestoreContext,
    options: { notifyListeners?: boolean } = {},
): Promise<boolean> {
    const completion = (async () => {
        const result = await runAuthTokenMutation(async () => {
            if (!isAuthSessionRestorable(context.expectedEpoch)) return null;
            if (await hasInvalidSessionMarkerWithinMutation()) return null;
            const currentRefreshToken = await getAuthTokenWithinMutation(
                REFRESH_TOKEN_KEY,
                context.expectedEpoch,
                false,
            );
            if (
                !isAuthSessionRestorable(context.expectedEpoch) ||
                currentRefreshToken !== context.expectedRefreshToken
            ) return null;

            // The final identity check and invalidation are synchronous within the
            // shared mutation queue. A newer login cannot slip between them.
            invalidateAuthSession();
            hasInMemoryInvalidSessionMarker = true;
            return invalidateAuthStorageWithinMutation();
        });
        if (!result) return false;
        reportAuthInvalidationFailures(result);
        if (options.notifyListeners !== false) {
            await notifyAuthInvalidationListeners();
        }
        return result.succeeded;
    })();
    registerAuthSessionTransitionBarrier(completion);
    return completion;
}

export function clearAuthTokens(
    { notifyListeners = true } = {},
): Promise<boolean> {
    // Invalidate pending account-owned async work before any storage deletion awaits.
    invalidateAuthSession();
    hasInMemoryInvalidSessionMarker = true;
    const completion = (async () => {
        const result = await runAuthTokenMutation(
            invalidateAuthStorageWithinMutation,
        );
        reportAuthInvalidationFailures(result);
        if (notifyListeners) {
            await notifyAuthInvalidationListeners();
        }
        return result.succeeded;
    })();
    registerAuthSessionTransitionBarrier(completion);
    return completion;
}

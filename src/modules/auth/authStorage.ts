import * as SecureStore from "../storage/secureStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
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
const AUTH_APP_GROUP_SESSION_INVALIDATED = "invalidated";
const AUTH_APP_GROUP_SESSION_ACTIVE_PREFIX = "active:";
const AUTH_MEMBER_SESSION_IDENTITY_KEY = "authSessionIdentity";
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
    getAppGroupSessionState?(): Promise<string | null>;
    setAppGroupSessionState?(value: string): Promise<boolean>;
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

async function setAppGroupSessionStateStrict(value: string): Promise<void> {
    if (!sharedAuth) return;
    if (!sharedAuth.setAppGroupSessionState) {
        throw new Error("App Group 인증 상태 bridge를 사용할 수 없습니다.");
    }
    const saved = await sharedAuth.setAppGroupSessionState(value);
    if (!saved) throw new Error("App Group 인증 상태 저장 실패");
}

async function readAppGroupSessionStateStrict(): Promise<string | null> {
    if (!sharedAuth) return null;
    if (!sharedAuth.getAppGroupSessionState) {
        throw new Error("App Group 인증 상태 bridge를 사용할 수 없습니다.");
    }
    return sharedAuth.getAppGroupSessionState();
}

async function syncSharedApiBaseUrl() {
    if (currentAuthApiBaseUrl) {
        await saveSharedItem(AUTH_API_BASE_URL_KEY, currentAuthApiBaseUrl);
    }
}

async function syncSharedApiBaseUrlStrict() {
    if (currentAuthApiBaseUrl) {
        await setSharedItemStrict(
            AUTH_API_BASE_URL_KEY,
            currentAuthApiBaseUrl,
        );
    }
}

async function getConsistentStoredValueWithinMutation(
    key: string,
    expectedEpoch: number,
    repair: boolean,
): Promise<string | null> {
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
    const [secureResult, sharedResult] = await Promise.allSettled([
        SecureStore.getItemAsync(key),
        sharedAuth ? sharedAuth.getItem(key) : Promise.resolve(null),
    ]);
    if (
        secureResult.status === "rejected" ||
        sharedResult.status === "rejected" ||
        !isAuthSessionEpochCurrent(expectedEpoch)
    ) return null;

    const secureValue = secureResult.value;
    const sharedValue = sharedResult.value;
    if (secureValue && sharedValue && secureValue !== sharedValue) {
        // Never pick one account's value and repair it over the other. A
        // conditional server restore can rebuild a coherent session instead.
        return null;
    }
    const value = secureValue ?? sharedValue;
    if (!value || !repair) return value;

    const repairs: Promise<unknown>[] = [];
    if (!secureValue) {
        repairs.push(SecureStore.setItemAsync(key, value));
    }
    if (sharedAuth && !sharedValue) {
        repairs.push(setSharedItemStrict(key, value));
    }
    if (repairs.length > 0) {
        try {
            await Promise.all(repairs);
        } catch {
            return null;
        }
    }
    return isAuthSessionEpochCurrent(expectedEpoch) ? value : null;
}

async function getAuthTokenWithinMutation(
    key: string,
    expectedEpoch: number,
    repair: boolean,
): Promise<string | null> {
    const value = await getConsistentStoredValueWithinMutation(
        key,
        expectedEpoch,
        repair,
    );
    if (value && repair) await syncSharedApiBaseUrl();
    return isAuthSessionEpochCurrent(expectedEpoch) ? value : null;
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

type StoredAuthMemberRecord = StoredAuthMember & {
    [AUTH_MEMBER_SESSION_IDENTITY_KEY]: string;
};

export type AuthenticatedSession = StoredAuthMember & {
    accessToken?: string | null;
    refreshToken?: string | null;
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

function parseAuthMemberRecord(raw: string | null): StoredAuthMemberRecord | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as StoredAuthMember & {
            authSessionIdentity?: unknown;
        };
        const normalized = normalizeAuthMember(parsed);
        const authSessionIdentity =
            typeof parsed.authSessionIdentity === "string"
                ? parsed.authSessionIdentity.trim()
                : "";
        if (!normalized?.id || !authSessionIdentity) return null;
        return {
            ...normalized,
            authSessionIdentity,
        };
    } catch {
        return null;
    }
}

async function getAuthSessionIdentity(refreshToken: string): Promise<string> {
    return Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        refreshToken,
    );
}

async function createAuthMemberRecord(
    member: StoredAuthMember,
    refreshToken: string,
): Promise<StoredAuthMemberRecord> {
    return {
        ...member,
        authSessionIdentity: await getAuthSessionIdentity(refreshToken),
    };
}

async function writeAuthTokensStrict(
    accessToken: string,
    refreshToken: string,
): Promise<void> {
    await Promise.all([
        syncSharedApiBaseUrlStrict(),
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
        setSharedItemStrict(ACCESS_TOKEN_KEY, accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
        setSharedItemStrict(REFRESH_TOKEN_KEY, refreshToken),
    ]);
}

async function writeAuthMemberRecordStrict(
    record: StoredAuthMemberRecord,
): Promise<void> {
    const serialized = JSON.stringify(record);
    await Promise.all([
        SecureStore.setItemAsync(AUTH_MEMBER_KEY, serialized),
        setSharedItemStrict(AUTH_MEMBER_KEY, serialized),
    ]);
}

async function readCurrentAuthMemberRecordWithinMutation(
    expectedEpoch: number,
    refreshToken: string,
    repair: boolean,
): Promise<StoredAuthMemberRecord | null> {
    const raw = await getConsistentStoredValueWithinMutation(
        AUTH_MEMBER_KEY,
        expectedEpoch,
        repair,
    );
    if (!raw || !isAuthSessionEpochCurrent(expectedEpoch)) return null;
    const record = parseAuthMemberRecord(raw);
    if (!record) return null;
    const expectedIdentity = await getAuthSessionIdentity(refreshToken);
    if (
        !isAuthSessionEpochCurrent(expectedEpoch) ||
        record.authSessionIdentity !== expectedIdentity
    ) return null;
    return record;
}

async function verifyAuthenticatedSessionWithinMutation(options: {
    accessToken: string;
    refreshToken: string;
    record: StoredAuthMemberRecord;
}): Promise<void> {
    const serializedMember = JSON.stringify(options.record);
    const results = await Promise.allSettled([
        SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.getItemAsync(AUTH_MEMBER_KEY),
        sharedAuth
            ? sharedAuth.getItem(ACCESS_TOKEN_KEY)
            : Promise.resolve(options.accessToken),
        sharedAuth
            ? sharedAuth.getItem(REFRESH_TOKEN_KEY)
            : Promise.resolve(options.refreshToken),
        sharedAuth
            ? sharedAuth.getItem(AUTH_MEMBER_KEY)
            : Promise.resolve(serializedMember),
    ]);
    const expected = [
        options.accessToken,
        options.refreshToken,
        serializedMember,
        options.accessToken,
        options.refreshToken,
        serializedMember,
    ];
    if (results.some((result, index) =>
        result.status === "rejected" || result.value !== expected[index]
    )) {
        throw new Error("인증 세션 저장 검증에 실패했습니다.");
    }
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
    if (sharedAuth) {
        // This channel is deliberately outside Keychain. The share extension
        // can still observe logout/commit staging when the shared Keychain
        // subsystem is locked or temporarily unavailable.
        writes.push(setAppGroupSessionStateStrict(
            AUTH_APP_GROUP_SESSION_INVALIDATED,
        ));
    }
    const results = await Promise.allSettled(writes);
    return {
        anySucceeded: results.some((result) => result.status === "fulfilled"),
        allSucceeded: results.every((result) => result.status === "fulfilled"),
        results,
    };
}

async function publishCommittedSessionWithinMutation(
    authSessionIdentity: string,
): Promise<void> {
    // Keep the independent App Group state invalidated until every marker that
    // can block the main app has been removed. If any deletion fails, the
    // extension remains fail-closed as well.
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
    await setAppGroupSessionStateStrict(
        `${AUTH_APP_GROUP_SESSION_ACTIVE_PREFIX}${authSessionIdentity}`,
    );
}

async function hasInvalidSessionMarkerWithinMutation(): Promise<boolean> {
    if (hasInMemoryInvalidSessionMarker) return true;
    const reads: Promise<string | null>[] = [
        SecureStore.getItemAsync(AUTH_INVALID_SESSION_KEY),
        AsyncStorage.getItem(AUTH_INVALID_SESSION_KEY),
    ];
    if (sharedAuth) reads.push(sharedAuth.getItem(AUTH_INVALID_SESSION_KEY));
    if (sharedAuth) {
        reads.push(readAppGroupSessionStateStrict());
    }
    const results = await Promise.allSettled(reads);
    // A marker store that cannot be checked is not evidence that stale
    // credentials are safe. Cold bootstrap therefore fails closed.
    if (results.some((result) => result.status === "rejected")) return true;
    return results.some((result) =>
        result.status === "fulfilled" &&
        (
            result.value === AUTH_INVALID_SESSION_VALUE ||
            result.value === AUTH_APP_GROUP_SESSION_INVALIDATED
        )
    );
}

async function commitAuthenticatedSessionWithinMutation(options: {
    accessToken: string;
    refreshToken: string;
    normalizedMember: StoredAuthMember;
    isCurrent: () => boolean;
}): Promise<boolean> {
    if (!options.isCurrent()) return false;
    hasInMemoryInvalidSessionMarker = true;
    const marker = await persistInvalidSessionMarkerWithinMutation();
    if (!marker.allSucceeded) {
        await deleteAuthStorageWithinMutation();
        throw new Error("인증 세션 차단 상태를 모든 저장소에 기록하지 못했습니다.");
    }
    if (!options.isCurrent()) return false;

    const record = await createAuthMemberRecord(
        options.normalizedMember,
        options.refreshToken,
    );
    try {
        await writeAuthTokensStrict(
            options.accessToken,
            options.refreshToken,
        );
        await writeAuthMemberRecordStrict(record);
        if (!options.isCurrent()) return false;
        await verifyAuthenticatedSessionWithinMutation({
            accessToken: options.accessToken,
            refreshToken: options.refreshToken,
            record,
        });
        if (!options.isCurrent()) return false;
        await publishCommittedSessionWithinMutation(
            record.authSessionIdentity,
        );
        if (!options.isCurrent()) return false;
        hasInMemoryInvalidSessionMarker = false;
        return true;
    } catch (error) {
        // The durable staging marker is intentionally retained. Cleanup is
        // best-effort because marker visibility, not partial deletion, is the
        // security boundary after a process kill.
        await deleteAuthStorageWithinMutation();
        throw error;
    }
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

export async function saveAuthenticatedSession(
    member: AuthenticatedSession,
): Promise<void> {
    const normalized = normalizeAuthMember(member);
    const accessToken = member.accessToken?.trim();
    const refreshToken = member.refreshToken?.trim();
    if (!normalized?.id || !accessToken || !refreshToken) {
        throw new Error("새 로그인 세션 정보가 완전하지 않습니다.");
    }
    await waitForAuthSessionTransition();
    const expectedEpoch = beginAuthLoginSession();
    try {
        const committed = await runAuthTokenMutation(() =>
            commitAuthenticatedSessionWithinMutation({
                accessToken,
                refreshToken,
                normalizedMember: normalized,
                isCurrent: () =>
                    isAuthSessionEpochCurrent(expectedEpoch),
            })
        );
        if (
            !committed ||
            !activateAuthSessionIfCurrent(expectedEpoch)
        ) {
            throw new Error("인증 세션 소유권이 변경되었습니다.");
        }
    } catch (error) {
        if (isAuthSessionEpochCurrent(expectedEpoch)) {
            invalidateAuthSession();
        }
        throw error;
    }
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
    try {
        return await runAuthTokenMutation(async () => {
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
            const currentRecord =
                await readCurrentAuthMemberRecordWithinMutation(
                    options.expectedEpoch,
                    options.expectedRefreshToken,
                    true,
                );
            if (!currentRecord) return false;
            const normalizedMember = normalizeAuthMember(currentRecord);
            if (!normalizedMember?.id) return false;
            return commitAuthenticatedSessionWithinMutation({
                accessToken: options.accessToken.trim(),
                refreshToken: options.refreshToken.trim(),
                normalizedMember,
                isCurrent: () =>
                    isAuthSessionEpochCurrent(options.expectedEpoch),
            });
        });
    } catch {
        if (isAuthSessionEpochCurrent(options.expectedEpoch)) {
            invalidateAuthSession();
        }
        return false;
    }
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
    member: AuthenticatedSession;
}): Promise<boolean> {
    const normalized = normalizeAuthMember(options.member);
    const accessToken = options.member.accessToken?.trim();
    const refreshToken = options.member.refreshToken?.trim();
    if (!normalized?.id || !accessToken || !refreshToken) return false;

    try {
        return await runAuthTokenMutation(async () => {
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

            const committed =
                await commitAuthenticatedSessionWithinMutation({
                    accessToken,
                    refreshToken,
                    normalizedMember: normalized,
                    isCurrent: () =>
                        isAuthSessionRestorable(
                            options.context.expectedEpoch,
                        ),
                });
            return committed &&
                activateAuthSessionIfCurrent(
                    options.context.expectedEpoch,
                );
        });
    } catch {
        if (isAuthSessionEpochCurrent(options.context.expectedEpoch)) {
            invalidateAuthSession();
        }
        return false;
    }
}

export async function getAuthMember(): Promise<StoredAuthMember | null> {
    const expectedEpoch = getAuthSessionEpoch();
    return runAuthTokenMutation(async () => {
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        if (await hasInvalidSessionMarkerWithinMutation()) return null;
        const refreshToken = await getAuthTokenWithinMutation(
            REFRESH_TOKEN_KEY,
            expectedEpoch,
            true,
        );
        if (!refreshToken) return null;
        const record = await readCurrentAuthMemberRecordWithinMutation(
            expectedEpoch,
            refreshToken,
            true,
        );
        if (!record || !isAuthSessionEpochCurrent(expectedEpoch)) return null;
        return normalizeAuthMember(record);
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

        const currentRecord =
            await readCurrentAuthMemberRecordWithinMutation(
                options.expectedEpoch,
                currentRefreshToken,
                true,
            );
        if (!isAuthSessionRestorable(options.expectedEpoch)) return false;
        const currentMember = normalizeAuthMember(currentRecord);
        if (currentMember?.id !== options.expectedMemberId) return false;

        await writeAuthMemberRecordStrict(await createAuthMemberRecord(
            {
                ...currentMember,
                curationCompleted: options.curationCompleted,
            },
            currentRefreshToken,
        ));
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

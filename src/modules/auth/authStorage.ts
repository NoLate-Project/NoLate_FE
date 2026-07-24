import * as SecureStore from "../storage/secureStorage";
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
let currentAuthApiBaseUrl: string | null = null;
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
    return runAuthTokenMutation(
        () => getAuthTokenWithinMutation(key, expectedEpoch, true),
    );
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
        deleteSharedItem(ACCESS_TOKEN_KEY),
        deleteSharedItem(REFRESH_TOKEN_KEY),
        deleteSharedItem(AUTH_MEMBER_KEY),
        deleteSharedItem(AUTH_API_BASE_URL_KEY),
    ]);
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

export async function saveAuthTokens(accessToken?: string | null, refreshToken?: string | null) {
    // Explicit login/account restoration is a new intent and invalidates any
    // refresh response captured for the previous session.
    await waitForAuthSessionTransition();
    beginAuthLoginSession();
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
        if (!isAuthSessionEpochCurrent(options.expectedEpoch)) return false;
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
        const [sharedRaw, storedRaw] = await Promise.all([
            readSharedItem(AUTH_MEMBER_KEY),
            SecureStore.getItemAsync(AUTH_MEMBER_KEY),
        ]);
        if (!isAuthSessionEpochCurrent(expectedEpoch)) return null;
        const parse = (raw: string | null): StoredAuthMember | null => {
            if (!raw) return null;
            try {
                return normalizeAuthMember(JSON.parse(raw) as StoredAuthMember);
            } catch {
                return null;
            }
        };
        const sharedMember = parse(sharedRaw);
        const storedMember = parse(storedRaw);
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
    const epoch = beginAuthLogoutSession();
    const [accessToken, refreshToken] = await runAuthTokenMutation(
        () => Promise.all([
            getAuthTokenWithinMutation(ACCESS_TOKEN_KEY, epoch, false),
            getAuthTokenWithinMutation(REFRESH_TOKEN_KEY, epoch, false),
        ]),
    );
    return { epoch, accessToken, refreshToken };
}

export async function clearAuthTokensIfCurrent(
    expectedEpoch: number,
    options: { notifyListeners?: boolean } = {},
): Promise<boolean> {
    if (!isAuthSessionEpochCurrent(expectedEpoch)) return false;
    // Keep the logout intent's epoch stable so explicitly account-exit-bound
    // requests can finish with snapshotted credentials. All normal work remains
    // blocked because this session is no longer ACTIVE.
    completeAuthLogoutSession(expectedEpoch);
    const deletionResults = await runAuthTokenMutation(
        deleteAuthStorageWithinMutation,
    );
    reportAuthDeletionFailures(deletionResults);
    if (options.notifyListeners !== false) {
        await notifyAuthInvalidationListeners();
    }
    return true;
}

export async function clearRestorableAuthSessionIfCurrent(
    context: AuthRestoreContext,
    options: { notifyListeners?: boolean } = {},
): Promise<boolean> {
    const deletionResults = await runAuthTokenMutation(async () => {
        if (!isAuthSessionRestorable(context.expectedEpoch)) return null;
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
        return deleteAuthStorageWithinMutation();
    });
    if (!deletionResults) return false;
    reportAuthDeletionFailures(deletionResults);
    if (options.notifyListeners !== false) {
        await notifyAuthInvalidationListeners();
    }
    return true;
}

export async function clearAuthTokens({ notifyListeners = true } = {}) {
    // Invalidate pending account-owned async work before any storage deletion awaits.
    invalidateAuthSession();
    const deletionResults = await runAuthTokenMutation(
        deleteAuthStorageWithinMutation,
    );
    reportAuthDeletionFailures(deletionResults);
    if (notifyListeners) {
        await notifyAuthInvalidationListeners();
    }
}

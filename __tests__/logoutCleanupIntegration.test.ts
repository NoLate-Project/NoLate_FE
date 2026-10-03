/** Real auth storage, HTTP interceptors and coordinator; no network/native I/O. */
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, NativeModules: {} }));
jest.mock('../src/api/env', () => ({ getEnv: () => undefined }));
jest.mock('../src/modules/storage/secureStorage', () => {
    const values = new Map<string, string>();
    return {
        getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
        setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
        deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }),
    };
});

import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { apiClient, apiGet } from '../src/api/api';
import { logoutMember } from '../src/api/member';
import { retireLiveActivityStartToken, registerLiveActivityStartToken } from '../src/api/notification';
import {
    clearAuthTokens, getAccessToken, getRefreshToken, resetAuthStorageMemoryCacheForTests,
    saveAuthTokens, subscribeAuthInvalidation,
} from '../src/modules/auth/authStorage';
import { createLiveActivitySyncCoordinator } from '../src/modules/notification/liveActivitySyncCoordinator';

async function settles<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup deadlock')), 1000); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

describe('account cleanup with real auth recovery', () => {
    const originalAxiosAdapter = axios.defaults.adapter;
    const originalApiAdapter = apiClient.defaults.adapter;
    let unsubscribe: (() => void) | undefined;
    let expired: boolean;
    let refreshStatus: number;
    let events: string[];

    function coordinator() {
        return createLiveActivitySyncCoordinator({
            getDeviceId: async () => 'regression-device',
            getCapabilities: async () => ({
                supported: false, enabled: false, canDisplay: false, canUpdate: false,
                canStartLocally: false, canStartRemotely: false, pushToStartSupported: false,
            }),
            getActiveActivities: async () => [],
            subscribeEvents: () => () => undefined,
            registerStartToken: registerLiveActivityStartToken,
            registerUpdateToken: async () => undefined,
            retireStartToken: retireLiveActivityStartToken,
            retireActivity: async () => undefined,
            end: async () => ({ supported: false, applied: false, operation: 'ignored' }),
            endAll: async () => {
                events.push('native:endAll');
                return { supported: false, applied: false, operation: 'ignored' };
            },
            retirementRetryDelaysMs: [],
        });
    }

    beforeEach(async () => {
        resetAuthStorageMemoryCacheForTests();
        await saveAuthTokens('regression-access', 'regression-refresh');
        expired = false;
        refreshStatus = 401;
        events = [];
        const adapter: AxiosAdapter = async config => {
            const url = config.url ?? '';
            let status = 200;
            let data: unknown = { success: true, data: null };
            if (url.endsWith('/auth/logout')) {
                expired = true;
                events.push('logout:200');
            } else if (url.endsWith('/auth/refresh')) {
                status = refreshStatus;
                events.push(`refresh:${status}`);
                if (status === 200) {
                    expired = false;
                    data = { success: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh' } };
                }
            } else if (url.includes('/live-activities/start-token') || url.endsWith('/profile')) {
                status = expired ? 401 : 200;
                events.push(`${config.method}:${url.endsWith('/profile') ? 'profile' : 'token'}:${status}`);
            } else {
                throw new Error(`Unexpected request ${url}`);
            }
            const response = { config, status, statusText: String(status), headers: {}, data };
            if (status !== 200) throw new AxiosError('HTTP failure', 'ERR_BAD_RESPONSE', config, undefined, response);
            return response;
        };
        axios.defaults.adapter = adapter;
        apiClient.defaults.adapter = adapter;
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = undefined;
        axios.defaults.adapter = originalAxiosAdapter;
        apiClient.defaults.adapter = originalApiAdapter;
    });

    function subscribeCleanup(sync: ReturnType<typeof coordinator>) {
        unsubscribe = subscribeAuthInvalidation(async () => {
            events.push('auth:listener');
            await sync.clearForAccount(292);
        });
    }

    test('logout cleans native state before revocation and skips a second listener', async () => {
        const sync = coordinator();
        subscribeCleanup(sync);
        await settles(sync.clearForAccount(292));
        await logoutMember({ refreshToken: (await getRefreshToken())! });
        await settles(clearAuthTokens({ notifyListeners: false }));
        expect(events).toEqual(['delete:token:200', 'native:endAll', 'logout:200']);
        expect(await getAccessToken()).toBeNull();
    });

    test('even post-revocation invalidation completes without recursive cleanup', async () => {
        const sync = coordinator();
        subscribeCleanup(sync);
        await sync.clearForAccount(292);
        await logoutMember({ refreshToken: (await getRefreshToken())! });
        await settles(clearAuthTokens());
        expect(events).toEqual([
            'delete:token:200', 'native:endAll', 'logout:200', 'auth:listener',
            'delete:token:401', 'refresh:401', 'native:endAll',
        ]);
        expect(await getAccessToken()).toBeNull();
    });

    test('a normal 401 can invalidate auth while cleanup performs its own HTTP recovery', async () => {
        expired = true;
        subscribeCleanup(coordinator());
        await expect(settles(apiGet('/api/member/profile'))).rejects.toMatchObject({ status: 401 });
        expect(events.filter(event => event === 'auth:listener')).toHaveLength(1);
        expect(events).toContain('native:endAll');
        expect(await getRefreshToken()).toBeNull();
    });

    test('interrupted logout or withdrawal can clear an already-revoked session on startup', async () => {
        expired = true;
        const sync = coordinator();
        subscribeCleanup(sync);
        await settles(sync.clearForAccount(292));
        await settles(clearAuthTokens({ notifyListeners: false }));
        expect(events).toEqual(['delete:token:401', 'refresh:401', 'native:endAll']);
        expect(await getAccessToken()).toBeNull();
    });

    test('a refresh outage still ends local activities but does not silently delete credentials', async () => {
        expired = true;
        refreshStatus = 503;
        subscribeCleanup(coordinator());
        await expect(settles(clearAuthTokens())).rejects.toMatchObject({ response: { status: 503 } });
        expect(events).toContain('native:endAll');
        expect(await getAccessToken()).toBe('regression-access');
    });

    test('expired access with valid refresh can still retire the remote token', async () => {
        expired = true;
        refreshStatus = 200;
        subscribeCleanup(coordinator());
        await settles(clearAuthTokens());
        expect(events).toEqual([
            'auth:listener', 'delete:token:401', 'refresh:200', 'delete:token:200', 'native:endAll',
        ]);
        expect(await getAccessToken()).toBeNull();
    });

    test('registration reports revoked auth instead of re-entering an invalidation listener', async () => {
        expired = true;
        subscribeCleanup(coordinator());
        await expect(settles(registerLiveActivityStartToken({
            deviceId: 'device', activityType: 'NoLateDepartureAttributes',
            pushToStartToken: 'aa'.repeat(32), appearance: 'light', schemaVersion: 1,
        }))).rejects.toMatchObject({ errorCode: 'AUTH_SESSION_INVALIDATED' });
        expect(events).not.toContain('auth:listener');
    });
});

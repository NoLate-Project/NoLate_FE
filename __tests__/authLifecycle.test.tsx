import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AuthProvider, useAuth } from '../src/modules/auth/AuthContext';
import * as storage from '../src/modules/auth/authStorage';
import { clearAccountScopedLocalData } from '../src/modules/auth/accountCleanup';
import { logoutMember } from '../src/api/member';
import { isDepartureAlarmAccountCleanupPending } from '../src/modules/notification/departureAlarmSync';

jest.mock('../src/api/member', () => ({
    getMemberCurationStatus: jest.fn().mockResolvedValue({ curationCompleted: true }),
    logoutMember: jest.fn().mockResolvedValue(undefined),
    tokenLoginMember: jest.fn(),
}));
jest.mock('../src/modules/auth/authStorage', () => ({
    clearAuthTokens: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue('access'),
    getRefreshToken: jest.fn().mockResolvedValue('refresh'),
    getAuthMember: jest.fn().mockResolvedValue({ id: 292, curationCompleted: true }),
    saveAuthTokens: jest.fn(), saveAuthMember: jest.fn(),
    saveAuthCurationCompleted: jest.fn().mockResolvedValue(undefined),
    subscribeAuthInvalidation: jest.fn(() => jest.fn()),
}));
jest.mock('../src/modules/auth/accountCleanup', () => ({
    clearAccountScopedLocalData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/modules/notification/pushRegistrationCoordinator', () => ({
    cancelPendingPushRegistration: jest.fn(),
}));
jest.mock('../src/modules/notification/departureAlarmSync', () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn().mockResolvedValue(false),
    activateDepartureAlarmSyncForAuthenticatedAccount: jest.fn().mockResolvedValue(true),
}));

describe('AuthProvider lifecycle boundaries', () => {
    let value: ReturnType<typeof useAuth>;
    let renderer: TestRenderer.ReactTestRenderer;
    function Probe() { value = useAuth(); return null; }
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(false);
        jest.mocked(clearAccountScopedLocalData).mockResolvedValue(undefined);
    });
    afterEach(async () => { await act(async () => renderer?.unmount()); });
    async function mount() {
        await act(async () => { renderer = TestRenderer.create(<AuthProvider><Probe /></AuthProvider>); });
    }

    test('signOut cleans exactly once before logout, then clears credentials without listeners', async () => {
        await mount();
        expect(value!.isAuthenticated).toBe(true);
        await act(async () => { await value!.signOut(); });
        expect(clearAccountScopedLocalData).toHaveBeenCalledTimes(1);
        expect(logoutMember).toHaveBeenCalledWith({ refreshToken: 'refresh' });
        expect(storage.clearAuthTokens).toHaveBeenCalledWith({ notifyListeners: false });
        const cleanOrder = jest.mocked(clearAccountScopedLocalData).mock.invocationCallOrder[0];
        const revokeOrder = jest.mocked(logoutMember).mock.invocationCallOrder[0];
        const deleteOrder = jest.mocked(storage.clearAuthTokens).mock.invocationCallOrder[0];
        expect(cleanOrder).toBeLessThan(revokeOrder);
        expect(revokeOrder).toBeLessThan(deleteOrder);
        expect(value!.isAuthenticated).toBe(false);
        expect(value!.isLoading).toBe(false);
    });

    test('interrupted logout finishes cleanup before showing a signed-out state', async () => {
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(true);
        await mount();
        expect(clearAccountScopedLocalData).toHaveBeenCalledTimes(1);
        expect(storage.clearAuthTokens).toHaveBeenCalledWith({ notifyListeners: false });
        expect(value!.isAuthenticated).toBe(false);
        expect(value!.isLoading).toBe(false);
    });

    test('invalidation owns the loading flag when it supersedes an unfinished bootstrap', async () => {
        let finishCheck: ((pending: boolean) => void) | undefined;
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockReturnValueOnce(
            new Promise(resolve => { finishCheck = resolve; }),
        );
        await mount();
        expect(value!.isLoading).toBe(true);
        const listener = jest.mocked(storage.subscribeAuthInvalidation).mock.calls[0][0];
        await act(async () => { await listener(); });
        expect(value!.isAuthenticated).toBe(false);
        expect(value!.isLoading).toBe(false);
        await act(async () => { finishCheck?.(false); });
        expect(value!.isAuthenticated).toBe(false);
    });

    test('failed native cleanup cannot revoke the session or clear credentials', async () => {
        await mount();
        jest.mocked(clearAccountScopedLocalData).mockRejectedValueOnce(new Error('native cleanup failed'));
        await expect(value!.signOut()).rejects.toThrow('native cleanup failed');
        expect(logoutMember).not.toHaveBeenCalled();
        expect(storage.clearAuthTokens).not.toHaveBeenCalled();
        expect(value!.isAuthenticated).toBe(true);
    });
});

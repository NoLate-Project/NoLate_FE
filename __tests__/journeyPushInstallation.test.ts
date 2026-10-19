import { Platform } from 'react-native';
import { inspectJourneyPushInstallation, journeyPushInstallationError, type JourneyPushInstallationPort } from '../src/modules/journey/journeyPushInstallation';
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const oldDev = runtime.__DEV__; const oldOS = Platform.OS;
let port: JourneyPushInstallationPort;
beforeEach(() => {
    runtime.__DEV__ = true; Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    port = { isSimulator: true, projectId: 'nolate-cbdf2', isRegistered: jest.fn(() => false),
        register: jest.fn(async () => undefined), apnsToken: jest.fn(async () => 'private-apns'),
        sandboxAPNS: jest.fn(async () => undefined),
        fcmToken: jest.fn(async () => 'private-fcm'), sha256: jest.fn(async () => 'a'.repeat(64)) };
});
afterEach(() => { runtime.__DEV__ = oldDev; Object.defineProperty(Platform, 'OS', { configurable: true, value: oldOS }); });
it('registers explicitly and returns only a validated digest for UI; raw token remains private transport input', async () => {
    expect(await inspectJourneyPushInstallation(port)).toEqual({ token: 'private-fcm', digest: 'a'.repeat(64) });
    expect(port.register).toHaveBeenCalledTimes(1); expect(port.sha256).toHaveBeenCalledWith('private-fcm');
    expect(port.sandboxAPNS).toHaveBeenCalledWith('private-apns');
    expect((port.sandboxAPNS as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((port.fcmToken as jest.Mock).mock.invocationCallOrder[0]);
});
it('does not register an already registered installation', async () => {
    port.isRegistered = () => true; await inspectJourneyPushInstallation(port); expect(port.register).not.toHaveBeenCalled();
});
it.each(['release', 'android', 'physical', 'project'])('blocks %s before registration/token access', async mode => {
    if (mode === 'release') runtime.__DEV__ = false;
    if (mode === 'android') Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    if (mode === 'physical') port.isSimulator = false;
    if (mode === 'project') port.projectId = 'other-project';
    await expect(inspectJourneyPushInstallation(port)).rejects.toThrow();
    expect(port.register).not.toHaveBeenCalled(); expect(port.apnsToken).not.toHaveBeenCalled(); expect(port.fcmToken).not.toHaveBeenCalled();
});
it('APNs not ready does not ask FCM for a token', async () => {
    port.apnsToken = async () => null;
    await expect(inspectJourneyPushInstallation(port)).rejects.toThrow('APNS_TEST_TOKEN_NOT_READY');
    expect(port.fcmToken).not.toHaveBeenCalled();
    expect(port.sandboxAPNS).not.toHaveBeenCalled();
});
it.each(['', 'bad token', 'a'.repeat(4097), 'bad\u0000token'])('rejects invalid registration without hashing', async token => {
    port.fcmToken = async () => token;
    await expect(inspectJourneyPushInstallation(port)).rejects.toThrow('APNS_TEST_FCM_INVALID'); expect(port.sha256).not.toHaveBeenCalled();
});
it('rejects an invalid digest and redacts arbitrary provider exception text', async () => {
    port.sha256 = async () => 'private-fcm';
    await expect(inspectJourneyPushInstallation(port)).rejects.toThrow('APNS_TEST_DIGEST_INVALID');
    expect(journeyPushInstallationError(new Error('private-key provider details'))).toBe('APNS_TEST_REGISTRATION_UNAVAILABLE');
    expect(journeyPushInstallationError(new Error('APNS_TEST_TOKEN_NOT_READY'))).toBe('APNS_TEST_TOKEN_NOT_READY');
});
it.each([
    ['register', 'APNS_TEST_REGISTER_FAILED'], ['apnsToken', 'APNS_TEST_APNS_READ_FAILED'],
    ['fcmToken', 'APNS_TEST_FCM_FETCH_FAILED'], ['sha256', 'APNS_TEST_HASH_FAILED'],
    ['sandboxAPNS', 'APNS_TEST_SANDBOX_MAPPING_FAILED'],
] as const)('classifies %s failures without exposing provider details', async (method, code) => {
    port[method] = jest.fn(async () => { throw new Error('private-token provider details'); });
    await expect(inspectJourneyPushInstallation(port)).rejects.toThrow(code);
    if (method === 'sandboxAPNS') expect(port.fcmToken).not.toHaveBeenCalled();
});
it('bounds a hanging registration and never proceeds to FCM after timeout', async () => {
    jest.useFakeTimers();
    try {
        port.register = () => new Promise<void>(() => undefined);
        const check = (async () => {
            await expect(inspectJourneyPushInstallation(port)).rejects.toThrow('APNS_TEST_STAGE_TIMEOUT');
        })();
        await jest.advanceTimersByTimeAsync(12_001); await check;
        expect(port.fcmToken).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});

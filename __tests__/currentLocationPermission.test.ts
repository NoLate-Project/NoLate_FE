import * as Location from 'expo-location';
import { ensureForegroundPermission } from '../src/modules/map/currentLocation';

jest.mock('expo-location', () => ({
    hasServicesEnabledAsync: jest.fn(),
    getForegroundPermissionsAsync: jest.fn(),
    requestForegroundPermissionsAsync: jest.fn(),
}));

beforeEach(() => { jest.resetAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it.each(['services', 'status'])('ends a stalled %s read without opening the permission prompt', async stage => {
    let finishRead!: () => void;
    const stalled = new Promise<void>(resolve => { finishRead = resolve; });
    const denied = { granted: false } as Location.LocationPermissionResponse;
    jest.mocked(Location.hasServicesEnabledAsync).mockImplementation(async () => {
        if (stage === 'services') await stalled;
        return true;
    });
    jest.mocked(Location.getForegroundPermissionsAsync).mockImplementation(async () => {
        if (stage === 'status') await stalled;
        return denied;
    });
    const result = ensureForegroundPermission().then(() => 'allowed', (error: Error) => error.name);
    await jest.advanceTimersByTimeAsync(12000);
    finishRead();
    expect(await result).toBe('LocationStatusTimeoutError');
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

it('leaves the decision time to the user once the permission prompt opens', async () => {
    const response = (granted: boolean) => ({ granted }) as Location.LocationPermissionResponse;
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response(false));
    let allow!: () => void;
    jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(() =>
        new Promise(resolve => { allow = () => resolve(response(true)); }));
    const request = ensureForegroundPermission();
    await jest.advanceTimersByTimeAsync(30000);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    allow();
    await expect(request).resolves.toBeUndefined();
});

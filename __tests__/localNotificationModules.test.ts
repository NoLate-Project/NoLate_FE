const mockReceived = jest.fn();
const mockResponse = jest.fn();
const mockLast = jest.fn();
const mockClear = jest.fn();
const mockHandler = jest.fn();
const mockEmitterLoaded = jest.fn();
const mockHandlerLoaded = jest.fn();
let mockInvalid = false;
jest.mock('expo-notifications', () => { throw new Error('Root notification package must not load'); });
jest.mock('expo-notifications/build/NotificationsEmitter', () => {
    mockEmitterLoaded();
    return { addNotificationReceivedListener: mockReceived, addNotificationResponseReceivedListener: mockResponse,
        getLastNotificationResponse: mockLast, clearLastNotificationResponse: mockClear };
});
jest.mock('expo-notifications/build/NotificationsHandler', () => {
    mockHandlerLoaded(); return { setNotificationHandler: mockInvalid ? null : mockHandler };
});

beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); mockInvalid = false; });
it('does not load native notification modules when the helper is imported', () => {
    require('../src/modules/notification/localNotificationModules');
    expect(mockEmitterLoaded).not.toHaveBeenCalled(); expect(mockHandlerLoaded).not.toHaveBeenCalled();
});
it('loads only local modules synchronously without requesting permission or registering tokens', () => {
    const { loadLocalNotificationModules } = require('../src/modules/notification/localNotificationModules');
    const result = loadLocalNotificationModules();
    expect(result).toEqual({ addNotificationReceivedListener: mockReceived,
        addNotificationResponseReceivedListener: mockResponse, getLastNotificationResponse: mockLast,
        clearLastNotificationResponse: mockClear, setNotificationHandler: mockHandler });
    expect(mockEmitterLoaded).toHaveBeenCalledTimes(1); expect(mockHandlerLoaded).toHaveBeenCalledTimes(1);
    for (const action of [mockReceived,mockResponse,mockLast,mockClear,mockHandler]) expect(action).not.toHaveBeenCalled();
    expect(result.requestPermissionsAsync).toBeUndefined(); expect(result.getDevicePushTokenAsync).toBeUndefined();
});
it('preserves module caching without registering duplicate listeners', () => {
    const { loadLocalNotificationModules } = require('../src/modules/notification/localNotificationModules');
    loadLocalNotificationModules(); loadLocalNotificationModules();
    expect(mockEmitterLoaded).toHaveBeenCalledTimes(1); expect(mockHandlerLoaded).toHaveBeenCalledTimes(1);
    expect(mockHandler).not.toHaveBeenCalled();
});
it('rejects an unavailable local native handler instead of falling back to the root package', () => {
    mockInvalid = true;
    const { loadLocalNotificationModules } = require('../src/modules/notification/localNotificationModules');
    expect(() => loadLocalNotificationModules()).toThrow('LOCAL_NOTIFICATION_MODULE_UNAVAILABLE');
});

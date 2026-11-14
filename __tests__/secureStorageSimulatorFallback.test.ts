jest.mock("expo/virtual/env", () => ({ env: process.env }));

const originalNodeEnv = process.env.NODE_ENV;
const originalLocalApi = process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL;
const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

function loadStorage(isDevice: boolean, localApi: string | undefined) {
    jest.resetModules();
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    process.env.NODE_ENV = "production";
    if (localApi) process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL = localApi;
    else delete process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL;

    const keychainError = new Error("ERR_KEY_CHAIN");
    const keychain = {
        getItemAsync: jest.fn().mockRejectedValue(keychainError),
        setItemAsync: jest.fn().mockRejectedValue(keychainError),
        deleteItemAsync: jest.fn().mockRejectedValue(keychainError),
    };
    const simulatorStorage = {
        getItem: jest.fn().mockResolvedValue("isolated-token"),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    };
    jest.doMock("expo-secure-store", () => keychain);
    jest.doMock("expo-device", () => ({ isDevice }));
    jest.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    jest.doMock("@react-native-async-storage/async-storage", () => ({
        __esModule: true,
        default: simulatorStorage,
    }));
    // Each case reads the build-time environment and device type afresh.
    const storage = require("../src/modules/storage/secureStorage") as
        typeof import("../src/modules/storage/secureStorage");
    return { storage, keychain, simulatorStorage, keychainError };
}

afterEach(() => {
    jest.resetModules();
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalLocalApi === undefined) delete process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL;
    else process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL = originalLocalApi;
    jest.restoreAllMocks();
});

test("isolated loopback Release simulator can continue without Keychain entitlement", async () => {
    const { storage, simulatorStorage } = loadStorage(false, "http://127.0.0.1:5522");
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(storage.getItemAsync("token")).resolves.toBe("isolated-token");
    await expect(storage.setItemAsync("token", "new-token")).resolves.toBeUndefined();
    await expect(storage.deleteItemAsync("token")).resolves.toBeUndefined();
    expect(simulatorStorage.getItem).toHaveBeenCalledWith("token");
    expect(simulatorStorage.setItem).toHaveBeenCalledWith("token", "new-token");
    expect(simulatorStorage.removeItem).toHaveBeenCalledWith("token");
});

test("physical device never falls back, even when the build targets loopback", async () => {
    const { storage, simulatorStorage, keychainError } =
        loadStorage(true, "http://127.0.0.1:5522");

    await expect(storage.getItemAsync("token")).rejects.toBe(keychainError);
    await expect(storage.setItemAsync("token", "new-token")).rejects.toBe(keychainError);
    expect(simulatorStorage.getItem).not.toHaveBeenCalled();
    expect(simulatorStorage.setItem).not.toHaveBeenCalled();
});

test("Release simulator against the production API never falls back", async () => {
    const { storage, simulatorStorage, keychainError } =
        loadStorage(false, "https://nolate.jinuk.dev");

    await expect(storage.getItemAsync("token")).rejects.toBe(keychainError);
    expect(simulatorStorage.getItem).not.toHaveBeenCalled();
});

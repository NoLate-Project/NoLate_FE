import * as SecureStore from "../src/modules/storage/secureStorage";
import {
    getOrCreatePushDeviceId,
    resetPushDeviceIdentityForTests,
} from "../src/modules/notification/pushDeviceIdentity";

jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

const mockedGetItem = jest.mocked(SecureStore.getItemAsync);
const mockedSetItem = jest.mocked(SecureStore.setItemAsync);

describe("push installation device identity", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetPushDeviceIdentityForTests();
        mockedSetItem.mockResolvedValue(undefined);
    });

    it("reuses the exact id registered with the push token", async () => {
        mockedGetItem.mockResolvedValue("ios-installation-existing");

        await expect(getOrCreatePushDeviceId()).resolves.toBe(
            "ios-installation-existing",
        );
        await expect(getOrCreatePushDeviceId()).resolves.toBe(
            "ios-installation-existing",
        );

        expect(mockedGetItem).toHaveBeenCalledTimes(1);
        expect(mockedSetItem).not.toHaveBeenCalled();
    });

    it("single-flights first creation so registration and ACK share one id", async () => {
        mockedGetItem.mockResolvedValue(null);

        const registrationId = getOrCreatePushDeviceId();
        const ackId = getOrCreatePushDeviceId();

        expect(ackId).toBe(registrationId);
        await expect(Promise.all([registrationId, ackId])).resolves.toEqual([
            expect.any(String),
            expect.any(String),
        ]);
        expect(await registrationId).toBe(await ackId);
        expect(mockedGetItem).toHaveBeenCalledTimes(1);
        expect(mockedSetItem).toHaveBeenCalledTimes(1);
    });
});

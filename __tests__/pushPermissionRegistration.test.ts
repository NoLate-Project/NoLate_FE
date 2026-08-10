import { Platform } from "react-native";
import {
    AuthorizationStatus,
    requestPermission,
} from "@react-native-firebase/messaging";

import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    requestPushPermissionAndRegisterCurrentDevice,
} from "../src/modules/notification/pushPermission";
import { registerPushAfterLogin } from "../src/modules/notification/pushRegistration";

jest.mock("@react-native-firebase/messaging", () => ({
    AuthorizationStatus: {
        NOT_DETERMINED: -1,
        DENIED: 0,
        AUTHORIZED: 1,
        PROVISIONAL: 2,
        EPHEMERAL: 3,
    },
    getMessaging: jest.fn(() => ({})),
    requestPermission: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

jest.mock("../src/modules/notification/pushRegistration", () => ({
    registerPushAfterLogin: jest.fn(),
}));

describe("explicit push permission registration", () => {
    const originalPlatform = Platform.OS;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        jest.mocked(getAuthMember).mockResolvedValue({ id: 9448 });
        jest.mocked(registerPushAfterLogin).mockResolvedValue(undefined);
    });

    afterAll(() => {
        Object.defineProperty(Platform, "OS", {
            configurable: true,
            value: originalPlatform,
        });
    });

    it("registers the current device immediately after permission is granted", async () => {
        jest.mocked(requestPermission).mockResolvedValue(AuthorizationStatus.AUTHORIZED);

        await expect(requestPushPermissionAndRegisterCurrentDevice()).resolves.toBe(true);

        expect(getAuthMember).toHaveBeenCalledTimes(1);
        expect(registerPushAfterLogin).toHaveBeenCalledWith(9448);
    });

    it("does not attempt token registration when permission is denied", async () => {
        jest.mocked(requestPermission).mockResolvedValue(AuthorizationStatus.DENIED);

        await expect(requestPushPermissionAndRegisterCurrentDevice()).resolves.toBe(false);

        expect(getAuthMember).not.toHaveBeenCalled();
        expect(registerPushAfterLogin).not.toHaveBeenCalled();
    });
});

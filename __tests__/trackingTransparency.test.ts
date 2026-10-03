import {
    getTrackingPermissionsAsync,
    PermissionStatus,
    requestTrackingPermissionsAsync,
} from "expo-tracking-transparency";
import { AppState } from "react-native";

import {
    ensureAppTrackingTransparencyResolved,
    resetAppTrackingTransparencyForTests,
} from "../src/modules/privacy/trackingTransparency";

jest.mock("expo-tracking-transparency", () => ({
    getTrackingPermissionsAsync: jest.fn(),
    PermissionStatus: {
        DENIED: "denied",
        GRANTED: "granted",
        UNDETERMINED: "undetermined",
    },
    requestTrackingPermissionsAsync: jest.fn(),
}));

const mockGetTrackingPermissions = jest.mocked(getTrackingPermissionsAsync);
const mockRequestTrackingPermissions = jest.mocked(requestTrackingPermissionsAsync);
const originalAppState = AppState.currentState;

function setCurrentAppState(state: typeof AppState.currentState): void {
    Object.defineProperty(AppState, "currentState", {
        configurable: true,
        value: state,
        writable: true,
    });
}

describe("App Tracking Transparency coordination", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetAppTrackingTransparencyForTests();
        setCurrentAppState("active");
    });

    afterEach(() => {
        jest.restoreAllMocks();
        setCurrentAppState(originalAppState);
    });

    it("requests ATT exactly once while the status is undetermined", async () => {
        mockGetTrackingPermissions.mockResolvedValue({
            canAskAgain: true,
            expires: "never",
            granted: false,
            status: PermissionStatus.UNDETERMINED,
        });
        mockRequestTrackingPermissions.mockResolvedValue({
            canAskAgain: false,
            expires: "never",
            granted: false,
            status: PermissionStatus.DENIED,
        });

        await ensureAppTrackingTransparencyResolved();

        expect(mockGetTrackingPermissions).toHaveBeenCalledTimes(1);
        expect(mockRequestTrackingPermissions).toHaveBeenCalledTimes(1);
    });

    it("does not ask again after iOS has a stored decision", async () => {
        mockGetTrackingPermissions.mockResolvedValue({
            canAskAgain: false,
            expires: "never",
            granted: true,
            status: PermissionStatus.GRANTED,
        });

        await ensureAppTrackingTransparencyResolved();

        expect(mockRequestTrackingPermissions).not.toHaveBeenCalled();
    });

    it("shares one in-flight request across startup consumers", async () => {
        let resolveStatus: ((value: Awaited<ReturnType<typeof getTrackingPermissionsAsync>>) => void) | undefined;
        mockGetTrackingPermissions.mockImplementation(() => new Promise((resolve) => {
            resolveStatus = resolve;
        }));
        mockRequestTrackingPermissions.mockResolvedValue({
            canAskAgain: false,
            expires: "never",
            granted: true,
            status: PermissionStatus.GRANTED,
        });

        const first = ensureAppTrackingTransparencyResolved();
        const second = ensureAppTrackingTransparencyResolved();
        await Promise.resolve();
        resolveStatus?.({
            canAskAgain: true,
            expires: "never",
            granted: false,
            status: PermissionStatus.UNDETERMINED,
        });
        await Promise.all([first, second]);

        expect(first).toBe(second);
        expect(mockGetTrackingPermissions).toHaveBeenCalledTimes(1);
        expect(mockRequestTrackingPermissions).toHaveBeenCalledTimes(1);
    });

    it("waits for the main app to become active before checking or requesting", async () => {
        let appStateListener: ((state: "active") => void) | undefined;
        const remove = jest.fn();
        setCurrentAppState("background");
        jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
            appStateListener = listener as (state: "active") => void;
            return { remove } as ReturnType<typeof AppState.addEventListener>;
        });
        mockGetTrackingPermissions.mockResolvedValue({
            canAskAgain: false,
            expires: "never",
            granted: false,
            status: PermissionStatus.DENIED,
        });

        const result = ensureAppTrackingTransparencyResolved();
        await Promise.resolve();
        expect(mockGetTrackingPermissions).not.toHaveBeenCalled();

        appStateListener?.("active");
        await result;

        expect(remove).toHaveBeenCalledTimes(1);
        expect(mockGetTrackingPermissions).toHaveBeenCalledTimes(1);
    });

    it("fails closed and allows a later retry when iOS does not present the sheet", async () => {
        mockGetTrackingPermissions.mockResolvedValue({
            canAskAgain: true,
            expires: "never",
            granted: false,
            status: PermissionStatus.UNDETERMINED,
        });
        mockRequestTrackingPermissions
            .mockResolvedValueOnce({
                canAskAgain: true,
                expires: "never",
                granted: false,
                status: PermissionStatus.UNDETERMINED,
            })
            .mockResolvedValueOnce({
                canAskAgain: false,
                expires: "never",
                granted: false,
                status: PermissionStatus.DENIED,
            });

        await expect(ensureAppTrackingTransparencyResolved()).rejects.toThrow(
            "without a user decision",
        );
        await ensureAppTrackingTransparencyResolved();

        expect(mockGetTrackingPermissions).toHaveBeenCalledTimes(2);
        expect(mockRequestTrackingPermissions).toHaveBeenCalledTimes(2);
    });
});

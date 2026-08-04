import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

const mockAcceptShareInvitation = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();
const mockRouterReplace = jest.fn();
const mockSearchParams: {
    token: string;
    autoAccept?: string;
} = {
    token: "abcdefghijklmnop",
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockSearchParams,
    useRouter: () => ({
        replace: mockRouterReplace,
    }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/api/scheduleSharing", () => ({
    acceptShareInvitation: (...args: unknown[]) =>
        mockAcceptShareInvitation(...args),
}));
jest.mock("../src/modules/auth/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: true,
        isCurationCompleted: true,
        isLoading: false,
    }),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        colors: {
            background: "#fff",
            border: "#ddd",
            surface: "#fff",
            textPrimary: "#111",
            textSecondary: "#555",
        },
        mode: "light",
    }),
}));
jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");

import ShareInvitationAcceptScreen from "../app/share/[token]";

describe("share invitation departure-alarm recovery", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchParams.token = "abcdefghijklmnop";
        delete mockSearchParams.autoAccept;
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("awaits one recovery after invitation acceptance succeeds", async () => {
        mockAcceptShareInvitation.mockResolvedValue({
            invitation: {
                id: "1",
                resourceType: "SCHEDULE",
                resourceId: "41",
                ownerMemberId: 7,
                permission: "VIEWER",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "41",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "VIEWER",
                status: "ACTIVE",
            },
        });

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledWith("abcdefghijklmnop");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockAcceptShareInvitation.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "공유 초대 수락",
        })).toHaveLength(0);
    });

    it("does not duplicate recovery while auto-accepting the same invitation", async () => {
        const pendingRecovery = deferred<void>();
        mockSearchParams.autoAccept = "1";
        mockAcceptShareInvitation.mockResolvedValue({
            invitation: {
                id: "1",
                resourceType: "SCHEDULE",
                resourceId: "41",
                ownerMemberId: 7,
                permission: "VIEWER",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "41",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "VIEWER",
                status: "ACTIVE",
            },
        });
        mockRecoverDepartureAlarmsAfterMutation.mockReturnValueOnce(
            pendingRecovery.promise,
        );

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);

        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락 중" })
                .props.onPress();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);

        await act(async () => {
            pendingRecovery.resolve();
            await pendingRecovery.promise;
            await Promise.resolve();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledWith("abcdefghijklmnop");
        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    it("does not recover when invitation acceptance fails", async () => {
        mockAcceptShareInvitation.mockRejectedValue(new Error("accept failed"));

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({
            accessibilityRole: "alert",
        })).toBeTruthy();
    });
});

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

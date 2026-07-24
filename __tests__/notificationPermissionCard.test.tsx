import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import NotificationPermissionCard from "../src/modules/notification/components/NotificationPermissionCard";
import {
    normalizeNotificationPermissionState,
    shouldAutomaticallyRequestNotificationPermission,
} from "../src/modules/notification/notificationPermission";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));
jest.mock("expo-device", () => ({
    isDevice: true,
}));
jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: jest.fn(() => ({})),
}));
jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

describe("notification permission state", () => {
    test("granted, denied, blocked 상태를 시스템 응답에서 구분한다", () => {
        expect(normalizeNotificationPermissionState({
            status: "granted",
            granted: true,
            canAskAgain: false,
        })).toBe("granted");
        expect(normalizeNotificationPermissionState({
            status: "denied",
            granted: false,
            canAskAgain: true,
        })).toBe("denied");
        expect(normalizeNotificationPermissionState({
            status: "denied",
            granted: false,
            canAskAgain: false,
        })).toBe("blocked");
    });

    test("자동 권한 요청은 미결정 상태의 최초 한 번만 허용한다", () => {
        expect(shouldAutomaticallyRequestNotificationPermission("undetermined", false)).toBe(true);
        expect(shouldAutomaticallyRequestNotificationPermission("undetermined", true)).toBe(false);
        expect(shouldAutomaticallyRequestNotificationPermission("denied", false)).toBe(false);
        expect(shouldAutomaticallyRequestNotificationPermission("blocked", false)).toBe(false);
        expect(shouldAutomaticallyRequestNotificationPermission("granted", false)).toBe(false);
    });
});

describe("NotificationPermissionCard", () => {
    let renderer: ReactTestRenderer | undefined;
    const onRequest = jest.fn();
    const onOpenSettings = jest.fn();

    async function render(state: "granted" | "denied" | "blocked") {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <NotificationPermissionCard
                        state={state}
                        onRequest={onRequest}
                        onOpenSettings={onOpenSettings}
                    />
                </ThemeProvider>,
            );
        });
    }

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllMocks();
    });

    test("허용 상태는 반복 요청 버튼 없이 현재 상태를 설명한다", async () => {
        await render("granted");
        const text = renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .join(" ");

        expect(text).toContain("출발 알림을 받을 수 있어요");
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "알림 허용" })).toHaveLength(0);
    });

    test("거절 상태는 강요 문구 없이 사용자가 선택할 때만 다시 요청한다", async () => {
        await render("denied");
        const retry = renderer!.root.findByProps({ accessibilityLabel: "다시 허용" });

        await act(async () => retry.props.onPress());

        expect(onRequest).toHaveBeenCalledTimes(1);
        expect(onOpenSettings).not.toHaveBeenCalled();
    });

    test("차단 상태는 재요청하지 않고 시스템 설정으로 이동한다", async () => {
        await render("blocked");
        const settings = renderer!.root.findByProps({ accessibilityLabel: "시스템 설정 열기" });

        await act(async () => settings.props.onPress());

        expect(onOpenSettings).toHaveBeenCalledTimes(1);
        expect(onRequest).not.toHaveBeenCalled();
    });
});

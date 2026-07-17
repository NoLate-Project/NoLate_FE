import React from "react";
import { Text, View } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ProfileRouteAccessibilityRoot from "../src/modules/profile/ProfileRouteAccessibilityRoot";

const mockUseIsFocused = jest.fn(() => true);

jest.mock("@react-navigation/native", () => ({
    useIsFocused: () => mockUseIsFocused(),
}));

describe("ProfileRouteAccessibilityRoot", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        mockUseIsFocused.mockReset();
        mockUseIsFocused.mockReturnValue(true);
    });

    const createProfile = () => (
        <ProfileRouteAccessibilityRoot testID="profile-route-root">
            <Text>프로필 정보</Text>
        </ProfileRouteAccessibilityRoot>
    );

    const renderProfile = async () => {
        await act(async () => {
            renderer = TestRenderer.create(createProfile());
            await Promise.resolve();
        });

        return renderer!.root.findByType(View);
    };

    test("프로필 route가 활성화된 동안 하위 요소를 접근성 탐색에 노출한다", async () => {
        mockUseIsFocused.mockReturnValue(true);

        const root = await renderProfile();

        expect(root.props.accessibilityElementsHidden).toBe(false);
        expect(root.props.importantForAccessibility).toBe("auto");
    });

    test("법적 문서 진입 시 프로필을 숨기고 뒤로 복귀하면 다시 노출한다", async () => {
        mockUseIsFocused.mockReturnValue(false);
        let root = await renderProfile();

        expect(root.props.accessibilityElementsHidden).toBe(true);
        expect(root.props.importantForAccessibility).toBe("no-hide-descendants");

        mockUseIsFocused.mockReturnValue(true);
        await act(async () => {
            renderer!.update(createProfile());
            await Promise.resolve();
        });
        root = renderer!.root.findByType(View);

        expect(root.props.accessibilityElementsHidden).toBe(false);
        expect(root.props.importantForAccessibility).toBe("auto");
    });
});

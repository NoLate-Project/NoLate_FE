import React from "react";
import { KeyboardAvoidingView, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { AuthInput, AuthScreen } from "../src/modules/auth/components/AuthScreen";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

const mockUseIsFocused = jest.fn(() => true);

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("@react-navigation/native", () => ({
    useIsFocused: () => mockUseIsFocused(),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe("AuthScreen accessibility focus", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        mockUseIsFocused.mockReset();
        mockUseIsFocused.mockReturnValue(true);
    });

    const renderScreen = async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <AuthScreen subtitle="인증 화면">
                        <Text>입력 폼</Text>
                    </AuthScreen>
                </ThemeProvider>
            );
            await Promise.resolve();
        });
        return renderer!.root.findByType(KeyboardAvoidingView);
    };

    test("현재 인증 화면은 접근성 탐색에 노출한다", async () => {
        mockUseIsFocused.mockReturnValue(true);

        const root = await renderScreen();

        expect(root.props.accessibilityElementsHidden).toBe(false);
        expect(root.props.importantForAccessibility).toBe("auto");
    });

    test("다른 화면이 위에 쌓이면 이전 인증 화면의 하위 요소를 숨긴다", async () => {
        mockUseIsFocused.mockReturnValue(false);

        const root = await renderScreen();

        expect(root.props.accessibilityElementsHidden).toBe(true);
        expect(root.props.importantForAccessibility).toBe("no-hide-descendants");
    });

    test("입력 의미와 무관한 아이콘 문자는 접근성 탐색에서 숨긴다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <AuthInput
                        label="이메일"
                        icon="mail-outline"
                        value=""
                        onChangeText={() => undefined}
                    />
                </ThemeProvider>
            );
            await Promise.resolve();
        });

        const hiddenDecorations = renderer!.root.findAll((node) => (
            node.props.accessibilityElementsHidden === true &&
            node.props.importantForAccessibility === "no-hide-descendants"
        ));

        // react-native의 View mock과 host View가 모두 같은 접근성 속성을 전달한다.
        expect(hiddenDecorations.length).toBeGreaterThanOrEqual(1);
    });

    test("가입 요청 중에는 상단 뒤로가기를 비활성화해 진행 중인 화면을 이탈하지 않는다", async () => {
        const onBack = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <AuthScreen
                        subtitle="가입 처리 중"
                        onBack={onBack}
                        backDisabled
                    >
                        <Text>약관</Text>
                    </AuthScreen>
                </ThemeProvider>
            );
            await Promise.resolve();
        });

        const backButtons = renderer!.root.findAll(
            (node) => node.props.accessibilityLabel === "이전 화면으로 돌아가기",
        );
        expect(backButtons.some(
            (node) => node.props.accessibilityState?.disabled === true,
        )).toBe(true);
        expect(onBack).not.toHaveBeenCalled();
    });
});

import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CalendarSettingsModal from "../src/modules/schedule/components/calendar/CalendarSettingsModal";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        colors: {
            border: "#dddddd",
            surface: "#ffffff",
            surface2: "#f3f4f6",
            textPrimary: "#111111",
            textSecondary: "#666666",
        },
    }),
}));
jest.mock("../src/modules/theme/ThemeModeSwitch", () => () => null);
jest.mock(
    "../src/modules/schedule/components/calendar/CalendarGlassSurface",
    () => {
        const { View } = jest.requireActual("react-native");
        return ({ children, ...props }: React.ComponentProps<typeof View>) => (
            <View {...props}>{children}</View>
        );
    }
);

describe("CalendarSettingsModal", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllMocks();
    });

    test("주 시작일 선택은 설정을 변경하되 모달을 닫지 않는다", async () => {
        const onChangeFirstDay = jest.fn();
        const onClose = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <CalendarSettingsModal
                    visible
                    firstDay={0}
                    onChangeFirstDay={onChangeFirstDay}
                    onClose={onClose}
                />
            );
        });

        const monday = renderer!.root.findByProps({
            accessibilityLabel: "한 주의 시작 월요일",
        });
        await act(async () => monday.props.onPress());

        expect(onChangeFirstDay).toHaveBeenCalledWith(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    test("닫기 버튼은 모달을 닫는다", async () => {
        const onClose = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <CalendarSettingsModal
                    visible
                    firstDay={0}
                    onChangeFirstDay={jest.fn()}
                    onClose={onClose}
                />
            );
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "캘린더 설정 닫기" }).props.onPress();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

import React from "react";
import { Modal } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CalendarScopeSheet from "../src/modules/schedule/components/calendar/CalendarScopeSheet";

jest.mock("../src/modules/theme/ThemeModeSwitch", () => () => null);
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        colors: {
            background: "#ffffff",
            border: "#dddddd",
            surface2: "#f3f4f6",
            textPrimary: "#111111",
            textSecondary: "#666666",
        },
    }),
}));
jest.mock(
    "../src/modules/schedule/components/calendar/CalendarGlassSurface",
    () => {
        const { View } = jest.requireActual("react-native");
        return ({ children, ...props }: React.ComponentProps<typeof View>) => (
            <View {...props}>{children}</View>
        );
    },
);

const calendars = [{
    id: 21,
    title: "가족 캘린더",
    color: "#2F80FF",
    defaultContentMode: "SCHEDULE_ONLY",
    status: "ACTIVE",
    ownerMemberId: 7,
    myRole: "OWNER",
    memberCount: 4,
    routeReminderEnabled: true,
}] as const;

describe("CalendarScopeSheet", () => {
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

    const renderSheet = async (overrides: Partial<React.ComponentProps<typeof CalendarScopeSheet>> = {}) => {
        const props: React.ComponentProps<typeof CalendarScopeSheet> = {
            visible: true,
            calendars: calendars as never,
            value: 21,
            onChange: jest.fn(),
            onShareCalendar: jest.fn(),
            firstDay: 0,
            onChangeFirstDay: jest.fn(),
            onClose: jest.fn(),
            ...overrides,
        };
        await act(async () => {
            renderer = TestRenderer.create(<CalendarScopeSheet {...props} />);
        });
        return props;
    };

    test("현재 캘린더를 선택 상태로 표시한다", async () => {
        await renderSheet();

        expect(renderer!.root.findByProps({ accessibilityLabel: "가족 캘린더 보기" }).props.accessibilityState)
            .toEqual({ selected: true });
        expect(renderer!.root.findByProps({ accessibilityLabel: "전체 일정 보기" }).props.accessibilityState)
            .toEqual({ selected: false });
    });

    test("캘린더를 선택하면 범위를 변경하고 시트를 닫는다", async () => {
        const props = await renderSheet();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "개인 일정 보기" }).props.onPress();
        });

        expect(props.onChange).toHaveBeenCalledWith("personal");
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    test("보기 설정에서 주 시작일을 바꾸고 같은 범위로 돌아간다", async () => {
        const props = await renderSheet({ reduceMotionEnabled: true });

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "캘린더 관리" })).toHaveLength(0);
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "캘린더 보기 설정" }).props.onPress();
        });
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "가족 캘린더 보기" })).toHaveLength(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "한 주의 시작 월요일" }).props.onPress();
        });
        expect(props.onChangeFirstDay).toHaveBeenCalledWith(1);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "캘린더 선택으로 돌아가기" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "가족 캘린더 보기" }).props.accessibilityState)
            .toEqual({ selected: true });
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onChange).not.toHaveBeenCalled();
    });

    test("보기 설정에서 닫으면 시트를 닫고 다음 진입은 선택 화면이다", async () => {
        const props = await renderSheet({ reduceMotionEnabled: true });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "캘린더 보기 설정" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "보기 설정과 캘린더 선택 닫기" }).props.onPress();
            renderer!.update(<CalendarScopeSheet {...props} visible={false} />);
        });
        expect(props.onClose).toHaveBeenCalledTimes(1);

        await act(async () => renderer!.update(<CalendarScopeSheet {...props} />));
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "캘린더 선택 닫기" }).length).toBeGreaterThan(0);
    });

    test("소유한 캘린더에는 바로 공유하기 버튼을 표시한다", async () => {
        const props = await renderSheet();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "가족 캘린더 공유하기" }).props.onPress();
        });

        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(props.onShareCalendar).toHaveBeenCalledWith(expect.objectContaining({ id: 21 }));
        expect(props.onChange).not.toHaveBeenCalled();
    });

    test("선택 시트가 완전히 닫힌 뒤 후속 화면을 열 수 있도록 dismiss를 전달한다", async () => {
        const onDismiss = jest.fn();
        await renderSheet({ onDismiss });

        await act(async () => {
            renderer!.root.findByType(Modal).props.onDismiss();
        });

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});

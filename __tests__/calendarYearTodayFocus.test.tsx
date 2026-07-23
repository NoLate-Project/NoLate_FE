import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CalendarYearOverviewModal from "../src/modules/schedule/components/calendar/CalendarYearOverviewModal";

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            border: "#dddddd",
            calendarBackground: "#ffffff",
            selectedDayBg: "#111111",
            selectedDayText: "#ffffff",
            textPrimary: "#111111",
        },
    }),
}));

let mockSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => mockSafeAreaInsets,
}));

describe("CalendarYearOverviewModal Today focus", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 6, 15, 12, 0, 0));
        mockSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function calendar(
        todayRequest: number,
        reduceMotionEnabled = false,
        presentationRequest = 0
    ) {
        return (
            <CalendarYearOverviewModal
                year={2026}
                selectedDay="2025-12-31"
                firstDay={0}
                topInset={20}
                presentationRequest={presentationRequest}
                todayRequest={todayRequest}
                reduceMotionEnabled={reduceMotionEnabled}
                onSelectMonth={jest.fn()}
            />
        );
    }

    test("레이아웃보다 먼저 Today 요청이 와도 현재 월 위치가 준비되면 이동한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(calendar(0));
        });

        const scrollInstance = renderer!.root.findByType(ScrollView).instance as {
            scrollTo: (options: { y: number; animated: boolean }) => void;
        };
        const scrollTo = jest.spyOn(scrollInstance, "scrollTo");

        await act(async () => {
            renderer!.update(calendar(1));
            jest.runOnlyPendingTimers();
        });
        expect(scrollTo).not.toHaveBeenCalled();

        await act(async () => {
            renderer!.root.findByProps({ testID: "calendar-year-today-section" }).props.onLayout({
                nativeEvent: { layout: { y: 103 } },
            });
            renderer!.root.findByProps({ testID: "calendar-year-today-month-grid" }).props.onLayout({
                nativeEvent: { layout: { y: 56 } },
            });
            renderer!.root.findByProps({ testID: "calendar-year-today-month" }).props.onLayout({
                nativeEvent: { layout: { y: 300 } },
            });
            jest.runOnlyPendingTimers();
        });

        expect(scrollTo).toHaveBeenLastCalledWith({ y: 459, animated: true });
    });

    test("동작 줄이기에서는 Today 이동을 즉시 포커싱한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(calendar(0, true));
        });

        const scrollInstance = renderer!.root.findByType(ScrollView).instance as {
            scrollTo: (options: { y: number; animated: boolean }) => void;
        };
        const scrollTo = jest.spyOn(scrollInstance, "scrollTo");

        await act(async () => {
            renderer!.update(calendar(1, true));
            jest.runOnlyPendingTimers();
        });

        await act(async () => {
            renderer!.root.findByProps({ testID: "calendar-year-today-section" }).props.onLayout({
                nativeEvent: { layout: { y: 103 } },
            });
            renderer!.root.findByProps({ testID: "calendar-year-today-month-grid" }).props.onLayout({
                nativeEvent: { layout: { y: 56 } },
            });
            renderer!.root.findByProps({ testID: "calendar-year-today-month" }).props.onLayout({
                nativeEvent: { layout: { y: 300 } },
            });
            jest.runOnlyPendingTimers();
        });

        expect(scrollTo).toHaveBeenLastCalledWith({ y: 459, animated: false });
    });

    test("상단 Safe Area와 캘린더 툴바 아래부터 스크롤 영역을 시작한다", async () => {
        mockSafeAreaInsets = { top: 59, right: 0, bottom: 34, left: 0 };

        await act(async () => {
            renderer = TestRenderer.create(calendar(0));
        });

        const safeArea = renderer!.root.findByProps({
            testID: "calendar-year-overview-safe-area",
        });
        const safeAreaStyle = StyleSheet.flatten(safeArea.props.style);
        expect(safeAreaStyle.paddingTop).toBe(122);

        const scrollView = renderer!.root.findByProps({
            testID: "calendar-year-overview-scroll",
        });
        expect(scrollView.props.contentInsetAdjustmentBehavior).toBe("never");
    });

    test("같은 연도를 다시 열어도 해당 연도 상단으로 스크롤 위치를 복원한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(calendar(0, false, 0));
        });

        const scrollInstance = renderer!.root.findByType(ScrollView).instance as {
            scrollTo: (options: { y: number; animated: boolean }) => void;
        };
        const scrollTo = jest.spyOn(scrollInstance, "scrollTo");

        await act(async () => {
            renderer!.root.findByProps({ testID: "calendar-year-today-section" }).props.onLayout({
                nativeEvent: { layout: { y: 640 } },
            });
            jest.runOnlyPendingTimers();
        });
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 640, animated: false });

        scrollTo.mockClear();
        await act(async () => {
            renderer!.update(calendar(0, false, 1));
        });
        await act(async () => {
            jest.runOnlyPendingTimers();
        });

        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(scrollTo).toHaveBeenLastCalledWith({ y: 640, animated: false });
    });
});

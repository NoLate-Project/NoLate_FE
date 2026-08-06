import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CalendarYearOverviewModal from "../src/modules/schedule/components/calendar/CalendarYearOverviewModal";
import type { ScheduleItem } from "../src/modules/schedule/types";

let mockThemeMode: "light" | "dark" = "light";

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: mockThemeMode,
        colors: {
            border: "#dddddd",
            calendarBackground: mockThemeMode === "dark" ? "#000000" : "#ffffff",
            selectedDayBg: "#111111",
            selectedDayText: "#ffffff",
            textPrimary: mockThemeMode === "dark" ? "#ffffff" : "#111111",
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
        mockThemeMode = "light";
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
        presentationRequest = 0,
        items: ScheduleItem[] = []
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
                items={items}
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
        expect(StyleSheet.flatten(scrollView.props.style).marginBottom).toBe(94);
        expect(StyleSheet.flatten(scrollView.props.contentContainerStyle).paddingBottom).toBe(24);
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

    test("일정 개수에 따라 빨간색 밀도를 높이고 파란 오늘 표시를 우선한다", async () => {
        const item = (id: string, day: number, hour: number): ScheduleItem => ({
            id,
            title: id,
            startAt: `2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+09:00`,
            endAt: `2026-07-${String(day).padStart(2, "0")}T${String(hour + 1).padStart(2, "0")}:00:00+09:00`,
            category: { id: "category", title: "일정", color: "#0A84FF" },
        });
        const items: ScheduleItem[] = [
            item("today-1", 15, 9),
            item("today-2", 15, 12),
            item("light-1", 16, 9),
            item("medium-1", 17, 9),
            item("medium-2", 17, 12),
            item("strong-1", 18, 9),
            item("strong-2", 18, 12),
            item("strong-3", 18, 15),
        ];

        await act(async () => {
            renderer = TestRenderer.create(calendar(0, false, 0, items));
        });

        const densityBadge = (dateKey: string) => renderer!.root.findAllByProps({
            testID: `calendar-year-schedule-density-${dateKey}`,
        })[0];
        const lightBadge = densityBadge("2026-07-16");
        const mediumBadge = densityBadge("2026-07-17");
        const strongBadge = densityBadge("2026-07-18");
        const todayBadge = densityBadge("2026-07-15");

        expect(StyleSheet.flatten(lightBadge.props.style)).toMatchObject({
            backgroundColor: "#FFE6E3",
            borderRadius: 2,
        });
        expect(StyleSheet.flatten(mediumBadge.props.style)).toMatchObject({
            backgroundColor: "#FFB5AE",
            borderRadius: 2,
        });
        expect(StyleSheet.flatten(strongBadge.props.style)).toMatchObject({
            backgroundColor: "#F24A3F",
            borderRadius: 2,
        });
        expect(StyleSheet.flatten(
            strongBadge.findAllByType(Text)[0].props.style
        ).color).toBe("#FFFFFF");
        expect(StyleSheet.flatten(todayBadge.props.style)).toMatchObject({
            backgroundColor: "#2979FF",
            borderRadius: 7.5,
        });
        expect(renderer!.root.findAllByProps({
            testID: "calendar-year-schedule-marker-dot",
        })).toHaveLength(0);

        const julyButton = renderer!.root.findAll((node) => (
            node.props.accessibilityRole === "button"
            && String(node.props.accessibilityLabel).startsWith("2026년 7월 보기")
        ))[0];
        expect(julyButton.props.accessibilityLabel)
            .toBe(
                "2026년 7월 보기, 일정 있는 날 4일, "
                + "하루 최대 3개, 오늘 15일 일정 2개"
            );
    });

    test("다크 모드에서는 오늘 원형에 밝은 NoLate 파랑을 사용한다", async () => {
        mockThemeMode = "dark";
        const items: ScheduleItem[] = [{
            id: "dark-today",
            title: "오늘 일정",
            startAt: "2026-07-15T09:00:00+09:00",
            endAt: "2026-07-15T10:00:00+09:00",
            category: {
                id: "personal",
                title: "개인",
                color: "#2979FF",
            },
        }];

        await act(async () => {
            renderer = TestRenderer.create(calendar(0, false, 0, items));
        });

        const todayBadge = renderer!.root.findAllByProps({
            testID: "calendar-year-schedule-density-2026-07-15",
        })[0];
        expect(StyleSheet.flatten(todayBadge.props.style).backgroundColor)
            .toBe("#4B9DFF");
    });
});

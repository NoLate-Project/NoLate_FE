import React from "react";
import { FlatList } from "react-native";
import TestRenderer, {
    act,
    type ReactTestRenderer,
} from "react-test-renderer";

import ScheduleCalendar from "../src/modules/schedule/components/calendar/ScheduleCalendar";
import type { TodayFocusTarget } from "../src/modules/schedule/components/calendar/ScheduleCalendar";
import type { CalendarViewMode } from "../src/modules/schedule/components/calendar/viewMode";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("react-native-calendars", () => ({
    Calendar: () => null,
}));

jest.mock("../src/modules/schedule/components/calendar/CustomDay", () => () => null);

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            arrowColor: "#111111",
            border: "#dddddd",
            calendarBackground: "#ffffff",
            dayHeaderColor: "#555555",
            monthTextColor: "#111111",
        },
    }),
}));

type StackMonthTestItem = {
    key: string;
    dateString: string;
    dayHeight: number;
    headerHeight: number;
    height: number;
};

type StackMonthLayout = {
    length: number;
    offset: number;
    index: number;
};

describe("ScheduleCalendar stack month navigation", () => {
    let renderer: ReactTestRenderer | undefined;
    let onVisibleMonthChange: jest.Mock;
    let scrollToOffsetSpy: jest.SpyInstance;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        onVisibleMonthChange = jest.fn();
        scrollToOffsetSpy = jest.spyOn(FlatList.prototype, "scrollToOffset");
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    function calendarElement(
        viewMode: CalendarViewMode,
        focusedMonth: string,
        scrollRequest: number,
        items: ScheduleItem[] = []
    ) {
        return (
            <ScheduleCalendar
                selectedDay="2026-07-14"
                focusedMonth={focusedMonth}
                items={items}
                onSelectDay={jest.fn()}
                onOpenDay={jest.fn()}
                viewMode={viewMode}
                firstDay={0}
                scrollRequest={scrollRequest}
                onVisibleMonthChange={onVisibleMonthChange}
            />
        );
    }

    async function renderCalendar(
        viewMode: CalendarViewMode,
        focusedMonth = "2026-07",
        scrollRequest = 0,
        items: ScheduleItem[] = []
    ) {
        await act(async () => {
            renderer = TestRenderer.create(
                calendarElement(viewMode, focusedMonth, scrollRequest, items)
            );
        });

        return renderer!.root;
    }

    async function updateCalendar(
        viewMode: CalendarViewMode,
        focusedMonth: string,
        scrollRequest: number,
        items: ScheduleItem[] = []
    ) {
        await act(async () => {
            renderer?.update(calendarElement(viewMode, focusedMonth, scrollRequest, items));
        });

        return renderer!.root;
    }

    function flushAnimationFrame() {
        act(() => jest.runOnlyPendingTimers());
    }

    function getStackList() {
        const list = renderer?.root.findByType(FlatList);
        if (!list) throw new Error("stack month FlatList was not rendered");
        return list;
    }

    function scrollSwitchLineToMonth(monthKey: string) {
        const list = getStackList();
        const data = list.props.data as StackMonthTestItem[];
        const targetIndex = data.findIndex((month) => month.key === monthKey);
        expect(targetIndex).toBeGreaterThanOrEqual(0);

        const getItemLayout = list.props.getItemLayout as (
            data: StackMonthTestItem[] | null,
            index: number
        ) => StackMonthLayout;
        const targetLayout = getItemLayout(data, targetIndex);
        const viewportHeight = 700;

        act(() => {
            list.props.onScroll({
                nativeEvent: {
                    contentOffset: {
                        x: 0,
                        // The production switch line is y + viewportHeight * 0.32.
                        // Placing it just inside the target month makes the direction
                        // deterministic without depending on momentum physics.
                        y: targetLayout.offset - viewportHeight * 0.32 + 1,
                    },
                    layoutMeasurement: { width: 393, height: viewportHeight },
                },
            });
        });
    }

    test("스택형에서 과거부터 미래까지 이어지는 간결한 고정 월 목록을 사용한다", async () => {
        const root = await renderCalendar("stack");
        const list = root.findByType(FlatList);
        const data = list.props.data as StackMonthTestItem[];
        const julyIndex = data.findIndex((month) => month.key === "2026-07");

        expect(list.props.horizontal).not.toBe(true);
        expect(julyIndex).toBeGreaterThan(0);
        expect(data[julyIndex - 1].key).toBe("2026-06");
        expect(data[julyIndex + 1].key).toBe("2026-08");
        expect(data[julyIndex].dayHeight).toBe(116);
        expect(data[julyIndex].height).toBeGreaterThan(580);
        expect(data[julyIndex].height).toBeLessThan(600);
    });

    test("상세형과 목록형은 연속 월 목록을 사용하지 않는다", async () => {
        let root = await renderCalendar("detail");

        for (const viewMode of ["detail", "list"] as const) {
            await act(async () => {
                renderer?.update(
                    <ScheduleCalendar
                        selectedDay="2026-07-14"
                        focusedMonth="2026-07"
                        items={[]}
                        onSelectDay={jest.fn()}
                        onOpenDay={jest.fn()}
                        viewMode={viewMode}
                        firstDay={0}
                        scrollRequest={0}
                        onVisibleMonthChange={onVisibleMonthChange}
                    />
                );
            });
            root = renderer!.root;
            expect(root.findAllByType(FlatList)).toHaveLength(0);
        }
    });

    test("스택형에서 콘텐츠를 위로 올려 아래쪽을 보면 다음 달로 이동한다", async () => {
            await renderCalendar("stack");

            scrollSwitchLineToMonth("2026-08");

            expect(onVisibleMonthChange).toHaveBeenLastCalledWith("2026-08-01");
    });

    test("스택형에서 콘텐츠를 아래로 당겨 위쪽을 보면 이전 달로 이동한다", async () => {
            await renderCalendar("stack");

            scrollSwitchLineToMonth("2026-06");

            expect(onVisibleMonthChange).toHaveBeenLastCalledWith("2026-06-01");
    });

    test("스택형 진입 시 선택일보다 현재 보고 있는 달을 우선한다", async () => {
            await renderCalendar("stack", "2026-08");
            const list = getStackList();
            const data = list.props.data as StackMonthTestItem[];

            expect(data[list.props.initialScrollIndex].key).toBe("2026-08");
    });

    test("스택형 초기 뷰포트가 측정되기 전 scroll event로 직전 달을 보고하지 않는다", async () => {
        await renderCalendar("stack", "2026-07");
        const list = getStackList();
        const data = list.props.data as StackMonthTestItem[];
        const julyIndex = data.findIndex((month) => month.key === "2026-07");
        const getItemLayout = list.props.getItemLayout as (
            data: StackMonthTestItem[] | null,
            index: number
        ) => StackMonthLayout;
        const julyLayout = getItemLayout(data, julyIndex);

        act(() => {
            list.props.onScroll({
                nativeEvent: {
                    contentOffset: {
                        x: 0,
                        // Native layout rounding can put the first event a
                        // fraction before the requested July item offset.
                        y: julyLayout.offset - 0.25,
                    },
                    layoutMeasurement: { width: 393, height: 0 },
                },
            });
        });

        expect(onVisibleMonthChange).not.toHaveBeenCalledWith("2026-06-01");
    });

    test("같은 달의 일정 데이터가 갱신돼도 월 시작으로 다시 스크롤하지 않는다", async () => {
        await renderCalendar("stack", "2026-07");
        flushAnimationFrame();
        scrollToOffsetSpy.mockClear();

        const item: ScheduleItem = {
            id: "refresh-item",
            title: "갱신된 일정",
            startAt: new Date(2026, 6, 23, 9).toISOString(),
            endAt: new Date(2026, 6, 23, 10).toISOString(),
            category: { id: "work", title: "업무", color: "#ff3b30" },
        };
        await updateCalendar("stack", "2026-07", 0, [item]);
        flushAnimationFrame();

        expect(scrollToOffsetSpy).not.toHaveBeenCalled();
    });

    test("스택형 Today target은 스크롤 RAF 직후 ACK한다", async () => {
            const target: TodayFocusTarget = {
                day: "2026-08-16",
                requiresMonthChange: true,
            };
            const onTodayFocusReady = jest.fn();

            await act(async () => {
                renderer = TestRenderer.create(
                    <ScheduleCalendar
                        selectedDay={target.day}
                        focusedMonth={target.day}
                        items={[]}
                        onSelectDay={jest.fn()}
                        onOpenDay={jest.fn()}
                        viewMode="stack"
                        firstDay={0}
                        scrollRequest={1}
                        onVisibleMonthChange={onVisibleMonthChange}
                        todayFocusTarget={target}
                        onTodayFocusReady={onTodayFocusReady}
                    />
                );
            });

            expect(onTodayFocusReady).not.toHaveBeenCalled();
            act(() => jest.runOnlyPendingTimers());
            expect(onTodayFocusReady).toHaveBeenCalledTimes(1);
            expect(onTodayFocusReady).toHaveBeenCalledWith(target.day);
    });

    test("스택형 자연 스크롤 focusedMonth 응답은 월 시작으로 되감지 않는다", async () => {
            await renderCalendar("stack");
            flushAnimationFrame();
            scrollToOffsetSpy.mockClear();

            scrollSwitchLineToMonth("2026-08");
            expect(onVisibleMonthChange).toHaveBeenLastCalledWith("2026-08-01");

            await updateCalendar("stack", "2026-08", 0);
            flushAnimationFrame();

            expect(scrollToOffsetSpy).not.toHaveBeenCalled();
    });

    test("스택형 명시적 scrollRequest는 대상 월 제목을 지나 날짜 그리드로 이동한다", async () => {
            await renderCalendar("stack");
            flushAnimationFrame();
            scrollToOffsetSpy.mockClear();

            await updateCalendar("stack", "2026-08", 1);
            const list = getStackList();
            const data = list.props.data as StackMonthTestItem[];
            const targetIndex = data.findIndex((month) => month.key === "2026-08");
            const getItemLayout = list.props.getItemLayout as (
                data: StackMonthTestItem[] | null,
                index: number
            ) => StackMonthLayout;
            const targetLayout = getItemLayout(data, targetIndex);

            flushAnimationFrame();

            expect(scrollToOffsetSpy).toHaveBeenCalledTimes(1);
            expect(scrollToOffsetSpy).toHaveBeenCalledWith({
                offset: targetLayout.offset + data[targetIndex].headerHeight,
                animated: false,
            });
    });

    test("스택형 범위 밖 명시적 월 이동은 대상 월을 중심으로 목록을 다시 만든다", async () => {
            await renderCalendar("stack");
            flushAnimationFrame();
            scrollToOffsetSpy.mockClear();

            await updateCalendar("stack", "2032-01", 1);
            const list = getStackList();
            const data = list.props.data as StackMonthTestItem[];
            const targetIndex = data.findIndex((month) => month.key === "2032-01");

            expect(targetIndex).toBeGreaterThanOrEqual(0);
            expect(data[list.props.initialScrollIndex].key).toBe("2032-01");
            expect(data[targetIndex].headerHeight).toBe(0);

            flushAnimationFrame();
            expect(scrollToOffsetSpy).toHaveBeenCalledTimes(1);
    });

});

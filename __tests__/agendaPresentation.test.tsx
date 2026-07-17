import React from "react";
import {
    PanResponder,
    ScrollView,
    Text,
    type GestureResponderEvent,
    type PanResponderGestureState,
} from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    MonthAgendaList,
    SelectedDayAgendaPanel,
} from "../src/modules/schedule/components/list/ScheduleAgendaViews";
import ScheduleAgendaCard from "../src/modules/schedule/components/list/ScheduleAgendaCard";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: "Ionicons",
}));

const category = { id: "work", title: "업무", color: "#2563EB" };

function schedule(
    id: string,
    day: number,
    hour: number,
    title = id,
    scheduleCategory = category
): ScheduleItem {
    const start = new Date(2026, 6, day, hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    return {
        id,
        title,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        category: scheduleCategory,
    };
}

function renderedText(renderer: ReactTestRenderer) {
    return renderer.root
        .findAllByType(Text)
        .map((node) => node.props.children)
        .flat(Infinity)
        .filter((value): value is string | number => (
            typeof value === "string" || typeof value === "number"
        ))
        .join(" ");
}

function gesture(dy: number, vy: number): PanResponderGestureState {
    return {
        stateID: 1,
        moveX: 0,
        moveY: dy,
        x0: 0,
        y0: 0,
        dx: 0,
        dy,
        vx: 0,
        vy,
        numberActiveTouches: 0,
        _accountsForMovesUpTo: 0,
    };
}

describe("schedule agenda presentation", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.restoreAllMocks();
    });

    test("공유로 빠르게 저장한 일정은 경로 미설정 상태를 표시한다", async () => {
        const item = {
            ...schedule("shared-quick", 14, 19, "저녁 약속"),
            routeSetupRequired: true,
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleAgendaCard item={item} onPress={jest.fn()} />
                </ThemeProvider>
            );
        });

        expect(renderedText(renderer!)).toContain("경로 미설정");
        const card = renderer!.root.find((node) => (
            typeof node.props.accessibilityLabel === "string" &&
            node.props.accessibilityLabel.includes("저녁 약속")
        ));
        expect(card.props.accessibilityLabel).toContain("경로 미설정");
    });

    test("경로 미설정 안내는 캘린더를 덮지 않고 일정 목록 안에서 열린다", async () => {
        const onOpenRouteSetup = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-14"
                        items={[schedule("meeting", 14, 10, "회의")]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        routeSetupRequiredCount={2}
                        onOpenRouteSetup={onOpenRouteSetup}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        expect(renderedText(renderer!)).toContain("경로 미설정 2개");
        const scroll = renderer!.root.findByType(ScrollView);
        const notice = scroll.find((node) => (
            node.props.accessibilityLabel ===
            "경로 설정이 필요한 일정 2개. 가장 가까운 일정의 경로 설정 열기"
        ));

        await act(async () => notice.props.onPress());
        expect(onOpenRouteSetup).toHaveBeenCalledTimes(1);
    });

    test("상세형 핸들을 위·아래로 놓으면 목록형·스택형을 요청한다", async () => {
        let panResponderConfig: Parameters<typeof PanResponder.create>[0] | undefined;
        jest.spyOn(PanResponder, "create").mockImplementation((config) => {
            panResponderConfig = config;
            return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
        });
        const onRequestViewMode = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-14"
                        items={[]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={onRequestViewMode}
                    />
                </ThemeProvider>
            );
        });

        const event = {} as GestureResponderEvent;
        expect(panResponderConfig).toBeDefined();
        expect(panResponderConfig!.onMoveShouldSetPanResponder?.(
            event,
            gesture(-12, -0.1)
        )).toBe(true);
        expect(panResponderConfig!.onPanResponderTerminationRequest?.(
            event,
            gesture(-12, -0.1)
        )).toBe(false);

        await act(async () => {
            panResponderConfig!.onPanResponderRelease?.(
                event,
                gesture(-52, -0.1)
            );
        });
        await act(async () => {
            panResponderConfig!.onPanResponderRelease?.(
                event,
                gesture(52, 0.1)
            );
        });

        expect(onRequestViewMode).toHaveBeenNthCalledWith(1, "list");
        expect(onRequestViewMode).toHaveBeenNthCalledWith(2, "stack");
    });

    test("목록형 핸들은 아래 드래그만 상세형 전환을 요청한다", async () => {
        let panResponderConfig: Parameters<typeof PanResponder.create>[0] | undefined;
        jest.spyOn(PanResponder, "create").mockImplementation((config) => {
            panResponderConfig = config;
            return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
        });
        const onRequestViewMode = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <MonthAgendaList
                        visibleMonth="2026-07-14"
                        items={[]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={onRequestViewMode}
                    />
                </ThemeProvider>
            );
        });

        const event = {} as GestureResponderEvent;
        expect(panResponderConfig).toBeDefined();
        expect(panResponderConfig!.onMoveShouldSetPanResponder?.(
            event,
            gesture(12, 0.1)
        )).toBe(true);

        await act(async () => {
            panResponderConfig!.onPanResponderRelease?.(
                event,
                gesture(52, 0.1)
            );
            panResponderConfig!.onPanResponderRelease?.(
                event,
                gesture(-52, -0.1)
            );
            panResponderConfig!.onPanResponderRelease?.(
                event,
                gesture(20, 0.1)
            );
        });

        expect(onRequestViewMode).toHaveBeenCalledTimes(1);
        expect(onRequestViewMode).toHaveBeenCalledWith("detail");

        const handle = renderer!.root.find((node) => (
            node.props.accessibilityLabel === "일정 보기 방식"
        ));
        const scroll = renderer!.root.findByType(ScrollView);
        expect(scroll.findAll((node) => (
            node.props.accessibilityLabel === "일정 보기 방식"
        ))).toHaveLength(0);
        expect(handle.props.accessibilityValue).toEqual({ text: "목록형" });
        expect(handle.props.accessibilityActions).toEqual([
            { name: "decrement", label: "상세형으로 변경" },
        ]);

        await act(async () => handle.props.onAccessibilityAction({
            nativeEvent: { actionName: "decrement" },
        }));
        await act(async () => handle.props.onAccessibilityAction({
            nativeEvent: { actionName: "increment" },
        }));
        expect(onRequestViewMode).toHaveBeenCalledTimes(2);
        expect(onRequestViewMode).toHaveBeenLastCalledWith("detail");
    });

    test("상세형은 선택한 날짜의 일정만 시간순으로 표시한다", async () => {
        const onOpenSchedule = jest.fn();
        const onRequestViewMode = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-14"
                        items={[
                            schedule("later", 14, 15, "오후 일정"),
                            schedule("outside", 15, 9, "다른 날 일정"),
                            schedule("earlier", 14, 8, "오전 일정"),
                        ]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={onOpenSchedule}
                        onRequestViewMode={onRequestViewMode}
                    />
                </ThemeProvider>
            );
        });

        const text = renderedText(renderer!);
        expect(text).toContain("7월 14일 화요일");
        expect(text).toMatch(/2\s*개의 일정/);
        expect(text.indexOf("오전 일정")).toBeLessThan(text.indexOf("오후 일정"));
        expect(text).not.toContain("다른 날 일정");
        expect(renderer!.root.findAllByType(ScheduleAgendaCard)).toHaveLength(2);

        const targetCard = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && String(node.props.accessibilityLabel).startsWith("오전 일정")
        ))[0];
        await act(async () => targetCard?.props.onPress());
        expect(onOpenSchedule).toHaveBeenCalledWith("earlier");

        const handle = renderer!.root.find((node) => (
            node.props.accessibilityLabel === "일정 보기 방식"
        ));
        expect(handle.props.accessibilityValue).toEqual({ text: "상세형" });
        expect(handle.props.accessibilityActions).toEqual([
            { name: "increment", label: "목록형으로 변경" },
            { name: "decrement", label: "스택형으로 변경" },
        ]);
        await act(async () => handle.props.onAccessibilityAction({
            nativeEvent: { actionName: "increment" },
        }));
        await act(async () => handle.props.onAccessibilityAction({
            nativeEvent: { actionName: "decrement" },
        }));
        expect(onRequestViewMode).toHaveBeenNthCalledWith(1, "list");
        expect(onRequestViewMode).toHaveBeenNthCalledWith(2, "stack");
    });

    test("목록형은 필터와 날짜별 섹션 안에 시안형 compact 카드를 표시한다", async () => {
        const onOpenSchedule = jest.fn();
        const onRequestViewMode = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <MonthAgendaList
                        visibleMonth="2026-07-14"
                        items={[
                            schedule("same-day-later", 14, 15, "14일 오후"),
                            {
                                ...schedule("outside", 14, 9, "8월 일정"),
                                startAt: new Date(2026, 7, 1, 9).toISOString(),
                                endAt: new Date(2026, 7, 1, 10).toISOString(),
                            },
                            schedule("first", 10, 8, "10일 일정"),
                            schedule("same-day", 14, 10, "14일 오전"),
                        ]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={onOpenSchedule}
                        onRequestViewMode={onRequestViewMode}
                    />
                </ThemeProvider>
            );
        });

        const text = renderedText(renderer!);
        expect(text).toContain("전체 일정");
        expect(text).toMatch(/7월 10일[^\d]*금요일/);
        expect(text).toMatch(/7월 14일[^\d]*화요일/);
        expect(text).toMatch(/1\s*개의 일정/);
        expect(text).toMatch(/2\s*개의 일정/);
        expect(text.indexOf("10일 일정")).toBeLessThan(text.indexOf("14일 오전"));
        expect(text.indexOf("14일 오전")).toBeLessThan(text.indexOf("14일 오후"));
        expect(text).not.toContain("8월 일정");
        const cards = renderer!.root.findAllByType(ScheduleAgendaCard);
        expect(cards).toHaveLength(3);
        expect(cards.every((card) => card.props.compact === true)).toBe(true);

        const targetCard = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && String(node.props.accessibilityLabel).startsWith("14일 오전")
        ))[0];
        await act(async () => targetCard?.props.onPress());
        expect(onOpenSchedule).toHaveBeenCalledWith("same-day");
    });

    test("목록형은 월이 바뀌면 스크롤을 맨 위로 되돌린다", async () => {
        const augustItem = {
            ...schedule("august", 14, 9, "8월 일정"),
            startAt: new Date(2026, 7, 1, 9).toISOString(),
            endAt: new Date(2026, 7, 1, 10).toISOString(),
        };
        const renderList = (visibleMonth: string, items: ScheduleItem[]) => (
            <ThemeProvider>
                <MonthAgendaList
                    visibleMonth={visibleMonth}
                    items={items}
                    loading={false}
                    error={null}
                    bottomInset={0}
                    onPressRetry={jest.fn()}
                    onOpenSchedule={jest.fn()}
                    onRequestViewMode={jest.fn()}
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(
                renderList("2026-07-14", [schedule("july", 14, 9, "7월 일정")])
            );
        });
        const julyScroll = renderer!.root.findByType(ScrollView);

        await act(async () => {
            renderer!.update(renderList("2026-08-01", [augustItem]));
        });
        const augustScroll = renderer!.root.findByType(ScrollView);
        expect(augustScroll).not.toBe(julyScroll);
        expect(renderedText(renderer!)).toContain("8월 일정");
        expect(renderedText(renderer!)).not.toContain("7월 일정");
    });
});

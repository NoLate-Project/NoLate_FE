import React from "react";
import {
    ActionSheetIOS,
    PanResponder,
    ScrollView,
    StyleSheet,
    Text,
    View,
    type GestureResponderEvent,
    type PanResponderGestureState,
} from "react-native";
import TestRenderer, {
    act,
    type ReactTestInstance,
    type ReactTestRenderer,
} from "react-test-renderer";

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

const category: ScheduleItem["category"] = {
    id: "work",
    title: "업무",
    color: "#2563EB",
};

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

function renderedNodeText(node: ReactTestInstance) {
    return node
        .findAllByType(Text)
        .map((textNode) => textNode.props.children)
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

function gestureEvent(touchCount = 1): GestureResponderEvent {
    return {
        nativeEvent: {
            touches: Array.from({ length: touchCount }, () => ({})),
        },
    } as GestureResponderEvent;
}

function panResponderFromConfig(
    config: Parameters<typeof PanResponder.create>[0]
): ReturnType<typeof PanResponder.create> {
    return {
        panHandlers: {
            onStartShouldSetResponder: config.onStartShouldSetPanResponder,
            onStartShouldSetResponderCapture:
                config.onStartShouldSetPanResponderCapture,
            onMoveShouldSetResponder: config.onMoveShouldSetPanResponder,
            onMoveShouldSetResponderCapture:
                config.onMoveShouldSetPanResponderCapture,
            onResponderGrant: config.onPanResponderGrant,
            onResponderMove: config.onPanResponderMove,
            onResponderRelease: config.onPanResponderRelease,
            onResponderTerminate: config.onPanResponderTerminate,
            onResponderTerminationRequest:
                config.onPanResponderTerminationRequest,
        },
        getInteractionHandle: () => null,
    } as ReturnType<typeof PanResponder.create>;
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

    test("상세형 하단 손잡이의 위·아래 스와이프는 목록형·스택형을 요청한다", async () => {
        let panResponderConfig: Parameters<typeof PanResponder.create>[0] | undefined;
        jest.spyOn(PanResponder, "create").mockImplementation((config) => {
            panResponderConfig = config;
            return panResponderFromConfig(config);
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
        const gestureHeader = renderer!.root.findByProps({
            testID: "month-agenda-detail-gesture-handle",
        });
        expect(gestureHeader.props.onMoveShouldSetResponderCapture(
            event,
            gesture(-12, -0.1)
        )).toBe(true);
        expect(gestureHeader.props.onResponderTerminationRequest(
            event,
            gesture(-12, -0.1)
        )).toBe(false);

        await act(async () => {
            gestureHeader.props.onResponderGrant(event, gesture(-52, -0.1));
            gestureHeader.props.onResponderMove(event, gesture(-52, -0.1));
            gestureHeader.props.onResponderRelease(
                event,
                gesture(-52, -0.1)
            );
        });
        await act(async () => {
            gestureHeader.props.onResponderGrant(event, gesture(52, 0.1));
            gestureHeader.props.onResponderMove(event, gesture(52, 0.1));
            gestureHeader.props.onResponderRelease(
                event,
                gesture(52, 0.1)
            );
        });

        expect(onRequestViewMode).toHaveBeenNthCalledWith(1, "list");
        expect(onRequestViewMode).toHaveBeenNthCalledWith(2, "stack");
        expect(renderer!.root.findByType(ScrollView).props
            .onMoveShouldSetResponderCapture).toBeUndefined();
        expect(renderer!.root.findAllByProps({
            children: "7월 14일 화요일",
        })).toHaveLength(0);
    });

    test("목록형 핸들은 아래 드래그만 상세형 전환을 요청한다", async () => {
        let panResponderConfig: Parameters<typeof PanResponder.create>[0] | undefined;
        jest.spyOn(PanResponder, "create").mockImplementation((config) => {
            panResponderConfig = config;
            return panResponderFromConfig(config);
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
        const gestureHeader = renderer!.root.findByProps({
            testID: "month-agenda-list-gesture-handle",
        });
        expect(gestureHeader.props.onMoveShouldSetResponderCapture(
            event,
            gesture(12, 0.1)
        )).toBe(true);

        await act(async () => {
            gestureHeader.props.onResponderRelease(
                event,
                gesture(52, 0.1)
            );
            gestureHeader.props.onResponderRelease(
                event,
                gesture(-52, -0.1)
            );
            gestureHeader.props.onResponderRelease(
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

    test("패널 손잡이 드래그 도중 두 번째 손가락이 추가되면 전환을 취소한다", async () => {
        jest.spyOn(PanResponder, "create").mockImplementation((config) => (
            panResponderFromConfig(config)
        ));
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

        const gestureHeader = renderer!.root.findByProps({
            testID: "month-agenda-detail-gesture-handle",
        });
        const verticalGesture = gesture(-52, -0.1);

        expect(gestureHeader.props.onMoveShouldSetResponderCapture(
            gestureEvent(),
            verticalGesture
        )).toBe(true);

        await act(async () => {
            gestureHeader.props.onResponderGrant(
                gestureEvent(),
                verticalGesture
            );
            gestureHeader.props.onResponderMove(
                gestureEvent(2),
                verticalGesture
            );
            gestureHeader.props.onResponderRelease(
                gestureEvent(0),
                verticalGesture
            );
        });

        expect(onRequestViewMode).not.toHaveBeenCalled();
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
        expect(text).not.toContain("7월 14일 화요일");
        expect(text).not.toMatch(/2\s*개의 일정/);
        expect(text.indexOf("오전 일정")).toBeLessThan(text.indexOf("오후 일정"));
        expect(text).not.toContain("다른 날 일정");
        const detailCards = renderer!.root.findAllByType(ScheduleAgendaCard);
        expect(detailCards).toHaveLength(2);
        expect(detailCards.every((card) => card.props.groupRow === true)).toBe(true);
        expect(renderer!.root.findByProps({
            testID: "selected-day-agenda-group",
        })).toBeDefined();
        expect(StyleSheet.flatten(renderer!.root.findByProps({
            testID: "selected-day-agenda-group",
        }).props.style).borderRadius).toBe(9);
        const detailScroll = renderer!.root.findByType(ScrollView);
        expect(StyleSheet.flatten(detailScroll.props.style).marginBottom).toBe(70);
        expect(StyleSheet.flatten(detailScroll.props.contentContainerStyle).paddingBottom)
            .toBe(24);
        expect(renderer!.root.findAllByProps({
            testID: "selected-day-agenda-divider",
        }).length).toBeGreaterThan(0);
        const detailCard = renderer!.root.findAllByProps({
            testID: "selected-day-agenda-card",
        })[0];
        expect(StyleSheet.flatten(detailCard.props.style({
            pressed: false,
        })).minHeight).toBe(52);
        expect(StyleSheet.flatten(renderer!.root.findAllByProps({
            testID: "selected-day-agenda-card-rail",
        })[0].props.style).marginVertical).toBe(4);
        expect(StyleSheet.flatten(renderer!.root.findAllByProps({
            testID: "selected-day-agenda-card-content",
        })[0].props.style)).toMatchObject({
            paddingVertical: 5,
            gap: 1,
        });
        expect(renderer!.root.findAllByType(View).filter((node) => (
            node.props.testID === "agenda-card-time-column"
        ))).toHaveLength(2);
        expect(renderer!.root.findAllByProps({
            name: "chevron-forward",
        })).toHaveLength(0);

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

    test("상세형 연속 일정 카드는 전체 날짜 범위와 N박 N일을 표시한다", async () => {
        const multiDay = {
            ...schedule("multi-day", 14, 9, "인천여행"),
            startAt: new Date(2026, 6, 14, 9).toISOString(),
            endAt: new Date(2026, 6, 16, 11).toISOString(),
            travelMode: "TRANSIT" as const,
            travelMinutes: 43,
            departAt: new Date(2026, 6, 14, 8, 17).toISOString(),
            locationName: "인천역",
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-15"
                        items={[multiDay]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        const text = renderedText(renderer!);
        expect(text).toContain("2박 3일");
        expect(text).toContain("7/14 오전 9:00");
        expect(text).toContain("7/16 오전 11:00");
        expect(text).not.toContain("9:00 - 11:00");
        expect(text).not.toContain("→");
        expect(text).toContain("오전 8:17 출발 · 43분");
        expect(text).not.toContain("대중교통");
        expect(text).not.toContain("경로 준비됨");
        expect(renderer!.root.findByProps({
            testID: "agenda-multi-day-summary",
        })).toBeDefined();
        const titleRow = renderer!.root.findByProps({
            testID: "agenda-card-title-row",
        });
        const timeColumn = renderer!.root.findByProps({
            testID: "agenda-card-time-column",
        });
        const contextRow = renderer!.root.findByProps({
            testID: "agenda-card-context-row",
        });
        expect(renderedNodeText(titleRow)).toContain("2박 3일");
        expect(renderedNodeText(timeColumn)).toContain("7/14 오전 9:00");
        expect(renderedNodeText(timeColumn)).toContain("7/16 오전 11:00");
        expect(renderedNodeText(timeColumn)).not.toContain("2박 3일");
        expect(timeColumn.findAllByType(Text).every((node) => (
            node.props.adjustsFontSizeToFit === undefined
            && node.props.minimumFontScale === undefined
        ))).toBe(true);
        expect(renderedNodeText(contextRow)).toContain("인천역");
        expect(renderedNodeText(contextRow)).toContain("오전 8:17 출발 · 43분");
        expect([titleRow, timeColumn, contextRow].every((row) => (
            row.findAllByType(Text).every((node) => node.props.numberOfLines === 1)
        ))).toBe(true);
        const card = renderer!.root.findByType(ScheduleAgendaCard);
        expect(card.props.showMultiDaySummary).toBe(true);
        const pressable = renderer!.root.find((node) => (
            typeof node.props.accessibilityLabel === "string"
            && node.props.accessibilityLabel.startsWith("인천여행")
        ));
        expect(pressable.props.accessibilityLabel).toContain("2박 3일");
        expect(pressable.props.accessibilityLabel)
            .toContain("7월 14일 오전 9:00 → 7월 16일 오전 11:00");
        expect(pressable.props.accessibilityLabel).toContain("대중교통 이동");
        expect(pressable.props.accessibilityLabel).toContain("오전 8:17 출발 · 43분");
        expect(renderer!.root.findAllByProps({ name: "bus-outline" })).toHaveLength(1);
        expect(renderer!.root.findAllByProps({ name: "chevron-forward" })).toHaveLength(0);
    });

    test("공유와 경로 미설정 상태는 상세형의 제목·맥락 행에 나눠 표시한다", async () => {
        const sharedRouteRequired = {
            ...schedule(
                "shared-route-required",
                14,
                15,
                "병원 예약",
                {
                    ...category,
                    shared: true,
                    sharePermission: "EDITOR" as const,
                }
            ),
            startAt: new Date(2026, 6, 14, 15, 40).toISOString(),
            endAt: new Date(2026, 6, 14, 16, 10).toISOString(),
            locationName: "서울메디컬센터",
            routeSetupRequired: true,
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-14"
                        items={[sharedRouteRequired]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        const titleRow = renderer!.root.findByProps({
            testID: "agenda-card-title-row",
        });
        const timeColumn = renderer!.root.findByProps({
            testID: "agenda-card-time-column",
        });
        const contextRow = renderer!.root.findByProps({
            testID: "agenda-card-context-row",
        });
        expect(renderedNodeText(titleRow)).toContain("공유");
        expect(renderedNodeText(titleRow)).not.toContain("경로 미설정");
        expect(renderedNodeText(timeColumn)).toContain("오후 3:40");
        expect(renderedNodeText(timeColumn)).toContain("오후 4:10");
        const [startTime, endTime] = timeColumn.findAllByType(Text);
        expect(StyleSheet.flatten(startTime.props.style)).toMatchObject({
            color: "#000",
            fontWeight: "700",
        });
        expect(StyleSheet.flatten(endTime.props.style)).toMatchObject({
            color: "#6e6e73",
            fontWeight: "500",
        });
        expect(renderedNodeText(contextRow)).toContain("서울메디컬센터");
        expect(renderedNodeText(contextRow)).toContain("경로 미설정");
        expect(renderer!.root.findByProps({
            testID: "agenda-shared-badge",
        })).toBeDefined();
        expect(renderer!.root.findByProps({
            testID: "agenda-route-required-badge",
        })).toBeDefined();
        expect(renderer!.root.findAllByProps({ name: "people-outline" })).toHaveLength(1);
        expect(renderer!.root.findAllByProps({ name: "navigate-outline" })).toHaveLength(1);

        const pressable = renderer!.root.find((node) => (
            typeof node.props.accessibilityLabel === "string"
            && node.props.accessibilityLabel.startsWith("병원 예약")
        ));
        expect(pressable.props.accessibilityLabel).toContain("편집 공유");
        expect(pressable.props.accessibilityLabel).toContain("경로 미설정");
    });

    test("장소 없는 경로 미설정 상세 카드에는 경로 아이콘을 한 번만 표시한다", async () => {
        const routeRequired = {
            ...schedule("route-required", 14, 18, "저녁 약속"),
            routeSetupRequired: true,
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-14"
                        items={[routeRequired]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        expect(renderer!.root.findAllByProps({ name: "navigate-outline" })).toHaveLength(1);
        expect(renderer!.root.findByProps({
            testID: "agenda-route-required-badge",
        })).toBeDefined();
    });

    test("연속 종일 일정은 숙박 수와 시작·종료 날짜를 나눠 표시한다", async () => {
        const multiDayAllDay = {
            ...schedule("multi-all-day", 18, 0, "가족 여행"),
            startAt: new Date(2026, 6, 18).toISOString(),
            endAt: new Date(2026, 6, 21).toISOString(),
            allDay: true,
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-19"
                        items={[multiDayAllDay]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        const titleRow = renderer!.root.findByProps({
            testID: "agenda-card-title-row",
        });
        const timeColumn = renderer!.root.findByProps({
            testID: "agenda-card-time-column",
        });
        expect(renderedNodeText(titleRow)).toContain("2박 3일");
        expect(renderedNodeText(timeColumn)).toContain("7/18 시작");
        expect(renderedNodeText(timeColumn)).toContain("7/20 종료");
        expect(renderer!.root.findAllByProps({
            testID: "agenda-card-context-row",
        })).toHaveLength(0);
    });

    test("당일 일정과 목록형 compact 카드에는 숙박 정보를 표시하지 않는다", async () => {
        const sameDay = schedule("same-day", 14, 9, "당일 일정");
        const multiDay = {
            ...schedule("multi-day-list", 14, 9, "목록 연속 일정"),
            endAt: new Date(2026, 6, 16, 11).toISOString(),
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SelectedDayAgendaPanel
                        selectedDay="2026-07-14"
                        items={[sameDay]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });
        expect(renderedText(renderer!)).not.toContain("0박 1일");
        expect(renderer!.root.findAllByProps({
            testID: "agenda-multi-day-summary",
        })).toHaveLength(0);

        await act(async () => {
            renderer!.update(
                <ThemeProvider>
                    <MonthAgendaList
                        visibleMonth="2026-07-14"
                        items={[multiDay]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });
        expect(renderedText(renderer!)).not.toContain("2박 3일");
        expect(renderedText(renderer!)).toContain("9:00 - 11:00");
        expect(renderer!.root.findByType(ScheduleAgendaCard).props.compact).toBe(true);
        expect(renderer!.root.findByType(ScheduleAgendaCard).props.showMultiDaySummary)
            .not.toBe(true);
        expect(renderer!.root.findAll((node) => (
            typeof node.props.testID === "string"
            && node.props.testID.startsWith("agenda-card-")
        ))).toHaveLength(0);
    });

    test("목록형은 필터와 날짜별 섹션 안에 시안형 compact 카드를 표시한다", async () => {
        const onOpenSchedule = jest.fn();
        const onRequestScheduleActions = jest.fn();
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
                        onRequestScheduleActions={onRequestScheduleActions}
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
        expect(cards.every((card) => card.props.groupRow !== true)).toBe(true);

        const targetCard = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && String(node.props.accessibilityLabel).startsWith("14일 오전")
        ))[0];
        await act(async () => targetCard?.props.onPress());
        expect(onOpenSchedule).toHaveBeenCalledWith("same-day");

        await act(async () => targetCard?.props.onLongPress());
        expect(onRequestScheduleActions).toHaveBeenCalledWith(
            expect.objectContaining({ id: "same-day", title: "14일 오전" })
        );
        expect(targetCard?.props.delayLongPress).toBe(420);
        expect(targetCard?.props.accessibilityHint).toContain("길게 누르면");
    });

    test("빈 달에서도 전체 일정 필터 pill을 열 수 있다", async () => {
        const showActionSheet = jest
            .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
            .mockImplementation(() => undefined);

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
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });

        const filterPill = renderer!.root.findByProps({
            accessibilityLabel: "일정 필터, 전체 일정",
        });
        expect(filterPill.props.accessibilityState).toEqual({ disabled: false });

        act(() => filterPill.props.onPress());

        expect(showActionSheet).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "표시할 일정",
                options: ["전체 일정", "취소"],
                cancelButtonIndex: 1,
            }),
            expect.any(Function)
        );
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

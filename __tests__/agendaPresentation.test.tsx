import React from "react";
import {
    ActionSheetIOS,
    Animated,
    Dimensions,
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

    test("목록형에서도 공유 권한을 읽고 경로 미설정 일정의 이전 출발시각은 숨긴다", async () => {
        const onEdit = jest.fn();
        const onDelete = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <MonthAgendaList
                        visibleMonth="2026-07-14"
                        items={[{
                            ...schedule("shared-list", 14, 9, "긴 제목도 원문을 유지하는 공동 일정"),
                            category: { ...category, shared: true, sharePermission: "EDITOR" },
                            locationName: "회의실 A",
                            departAt: new Date(2026, 6, 14, 8, 17).toISOString(),
                            travelMinutes: 43,
                            routeSetupRequired: true,
                        }]}
                        loading={false}
                        error={null}
                        bottomInset={0}
                        onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()}
                        getScheduleSwipeActions={() => ({ onEdit, onDelete })}
                        onRequestViewMode={jest.fn()}
                    />
                </ThemeProvider>
            );
        });
        expect(renderedText(renderer!)).toContain("공유");
        expect(renderedText(renderer!)).toContain("경로 미설정");
        expect(renderedText(renderer!)).not.toContain("8:17");
        const card = renderer!.root.findByProps({ testID: "month-agenda-card" });
        expect(card.props.accessibilityLabel).toContain("편집 공유");
        expect(card.props.accessibilityLabel).not.toContain("출발");
        act(() => card.props.onAccessibilityAction({ nativeEvent: { actionName: "edit" } }));
        act(() => card.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } }));
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
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
        expect(text).toContain("7월 14일 화요일");
        expect(text).toMatch(/2\s*개의 일정/);
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
        }).props.style).backgroundColor).toBeUndefined();
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
        })).minHeight).toBe(64);
        expect(StyleSheet.flatten(renderer!.root.findAllByProps({
            testID: "selected-day-agenda-card-rail",
        })[0].props.style).marginVertical).toBe(14);
        expect(StyleSheet.flatten(renderer!.root.findAllByProps({
            testID: "selected-day-agenda-card-content",
        })[0].props.style)).toMatchObject({
            paddingVertical: 12,
            gap: 4,
        });
        expect(renderer!.root.findAllByType(View).filter((node) => (
            node.props.testID === "agenda-card-time-column"
        ))).toHaveLength(2);
        expect(renderer!.root.findAllByProps({
            name: "chevron-forward-outline",
        })).toHaveLength(0);

        const targetCard = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && String(node.props.accessibilityLabel).startsWith("오전 일정")
        ))[0];
        await act(async () => targetCard?.props.onPress());
        expect(onOpenSchedule).toHaveBeenCalledWith("earlier", expect.any(Function));

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
        expect(renderedNodeText(renderer!.root.findByProps({ testID: "agenda-multi-day-summary" }))).toContain("2박 3일");
        expect(renderedNodeText(timeColumn)).toContain("7/14 오전 9:00");
        expect(renderedNodeText(timeColumn)).toContain("7/16 오전 11:00");
        expect(renderedNodeText(timeColumn)).not.toContain("2박 3일");
        expect(timeColumn.findAllByType(Text).every((node) => (
            node.props.adjustsFontSizeToFit === undefined
            && node.props.minimumFontScale === undefined
        ))).toBe(true);
        expect(renderedNodeText(contextRow)).toContain("인천역");
        expect(renderedNodeText(contextRow)).toContain("오전 8:17 출발 · 43분");
        expect(titleRow.findByType(Text).props.numberOfLines).toBe(2);
        const locationRow = renderer!.root.findByProps({ testID: "agenda-card-location-row" });
        const departureRow = renderer!.root.findByProps({ testID: "agenda-card-departure-row" });
        expect(locationRow).not.toBe(departureRow);
        expect(renderedNodeText(locationRow)).toBe("인천역");
        expect(renderedNodeText(departureRow)).toBe("오전 8:17 출발 · 43분");
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
        expect(renderer!.root.findAllByProps({ name: "chevron-forward-outline" })).toHaveLength(0);
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
        expect(renderedNodeText(renderer!.root.findByProps({ testID: "agenda-shared-badge" }))).toContain("공유");
        expect(renderedNodeText(titleRow)).toBe("병원 예약");
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

        const timeColumn = renderer!.root.findByProps({
            testID: "agenda-card-time-column",
        });
        expect(renderedNodeText(renderer!.root.findByProps({ testID: "agenda-multi-day-summary" }))).toContain("2박 3일");
        expect(renderedNodeText(timeColumn)).toContain("7/18 시작");
        expect(renderedNodeText(timeColumn)).toContain("7/20 종료");
        expect(renderer!.root.findAllByProps({
            testID: "agenda-card-context-row",
        })).toHaveLength(0);
    });

    test("당일 일정에는 숙박 정보를 생략하고 목록형 연속 일정에는 실제 날짜를 표시한다", async () => {
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
        expect(renderedText(renderer!)).toContain("2박 3일");
        expect(renderedText(renderer!)).toContain("7/14 오전 9:00");
        expect(renderedText(renderer!)).toContain("7/16 오전 11:00");
        expect(renderer!.root.findByType(ScheduleAgendaCard).props.compact).toBe(true);
        expect(renderer!.root.findByType(ScheduleAgendaCard).props.showMultiDaySummary).toBe(true);
        expect(renderer!.root.findByProps({ testID: "agenda-card-time-column" })).toBeDefined();
    });

    test("목록형은 필터와 날짜별 중립색 묶음에서 일정과 시간을 표시한다", async () => {
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
        expect(text).toContain("모든 카테고리");
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
        expect(cards.every((card) => card.props.groupRow === true)).toBe(true);
        expect(renderer!.root.findAllByType(View).filter((node) => node.props.testID === "month-agenda-group")).toHaveLength(2);
        expect(renderer!.root.findAllByType(View).filter((node) => node.props.testID === "month-agenda-divider")).toHaveLength(1);

        const targetCard = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && String(node.props.accessibilityLabel).startsWith("14일 오전")
        ))[0];
        await act(async () => targetCard?.props.onPress());
        expect(onOpenSchedule).toHaveBeenCalledWith("same-day", expect.any(Function));

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
            accessibilityLabel: "일정 필터, 모든 카테고리",
        });
        expect(filterPill.props.accessibilityState).toEqual({ disabled: false });

        act(() => filterPill.props.onPress());

        expect(showActionSheet).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "카테고리 선택",
                options: ["모든 카테고리", "취소"],
                cancelButtonIndex: 1,
            }),
            expect.any(Function)
        );
    });

    test("일정이 없는 선택 날짜를 표시하고 이후 일정을 날짜순으로 이어서 보여 준다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <MonthAgendaList visibleMonth="2026-07-01" entryDate="2026-07-16"
                        items={[schedule("before", 14, 9, "이전 일정"), schedule("after", 17, 12, "다음 일정")]}
                        loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
                </ThemeProvider>,
            );
        });
        const selected = renderer!.root.findByProps({ testID: "month-agenda-entry-date" });
        expect(selected.findByProps({ children: "7월 16일" })).toBeDefined();
        const text = renderedText(renderer!);
        expect(text.indexOf("이전 일정")).toBeLessThan(text.indexOf("등록된 일정이 없어요"));
        expect(text.indexOf("등록된 일정이 없어요")).toBeLessThan(text.indexOf("다음 일정"));
    });

    test("기본 글씨의 목록은 선택 날짜 앞에 이전 날짜 제목의 일부를 남기지 않는다", async () => {
        jest.useFakeTimers();
        const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
        const getDimensions = Dimensions.get.bind(Dimensions);
        const dimensions = jest.spyOn(Dimensions, "get").mockImplementation(name => ({ ...getDimensions(name), fontScale: 1 }));
        try {
            const view = (transitionActive: boolean) => (
                <ThemeProvider>
                    <MonthAgendaList visibleMonth="2026-07-01" entryDate="2026-07-16"
                        entryLayoutTransitionActive={transitionActive}
                        items={[schedule("before", 14, 9), schedule("after", 17, 12)]}
                        loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
                </ThemeProvider>
            );
            await act(async () => {
                renderer = TestRenderer.create(view(true));
            });
            const heading = renderer!.root.findByProps({ testID: "month-agenda-entry-date" }).parent!;
            const body = renderer!.root.findByProps({ testID: "month-agenda-body-2026-07-16" });
            const list = renderer!.root.findByType(ScrollView);
            const layout = (y: number, height: number) => ({ nativeEvent: { layout: { y, height } } });
            await act(async () => {
                list.props.onLayout(layout(0, 212));
                list.props.onContentSizeChange(320, 412);
                heading.props.onLayout(layout(120, 28));
                body.props.onLayout(layout(148, 45));
                jest.advanceTimersByTime(50);
            });
            expect(scrollTo).not.toHaveBeenCalled();
            await act(async () => { renderer!.update(view(false)); });
            await act(async () => {
                list.props.onLayout(layout(0, 300));
                jest.advanceTimersByTime(50);
            });
            expect(renderer!.root.findAllByType(View).some(view =>
                view.props.pointerEvents === "none" && view.props.style?.height === 8)).toBe(true);
            await act(async () => {
                list.props.onContentSizeChange(320, 420);
                jest.advanceTimersByTime(50);
            });
            expect(scrollTo).toHaveBeenLastCalledWith({ y: 120, animated: false });
            await act(async () => {
                list.props.onScroll({ nativeEvent: {
                    contentOffset: { y: 103 }, layoutMeasurement: { height: 317 }, contentSize: { height: 420 },
                } });
                list.props.onContentSizeChange(320, 437);
                jest.advanceTimersByTime(50);
            });
            expect(scrollTo).toHaveBeenCalledTimes(2);
            expect(scrollTo).toHaveBeenLastCalledWith({ y: 120, animated: false });
        } finally {
            scrollTo.mockRestore();
            dimensions.mockRestore();
            jest.useRealTimers();
        }
    });

    test("여러 날 일정은 시작일에 한 번만 표시하고 선택한 이후 날짜를 함께 표시한다", async () => {
        const trip = { ...schedule("trip", 14, 9, "가족 여행"), endAt: new Date(2026, 6, 15, 18).toISOString() };
        const tree = (entryDate: string) => (
            <ThemeProvider>
                <MonthAgendaList visibleMonth="2026-07-01" entryDate={entryDate} items={[trip]}
                    loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                    onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
            </ThemeProvider>
        );
        await act(async () => { renderer = TestRenderer.create(tree("2026-07-15")); });
        const heading = renderer!.root.findByProps({ testID: "month-agenda-entry-date" });
        expect(heading.findByProps({ children: "7월 14일" })).toBeDefined();
        expect(heading.findByProps({ children: "선택한 날 7월 15일" })).toBeDefined();
        expect(renderer!.root.findAllByType(ScheduleAgendaCard)).toHaveLength(1);

        await act(async () => { renderer!.update(tree("2026-07-14")); });
        expect(renderer!.root.findAllByProps({ children: "선택한 날 7월 15일" })).toHaveLength(0);
    });

    test.each([[true, 1], [false, 1], [true, 2], [false, 2]])("범위를 바꾸면 보던 날짜가 있는 경우에만 목록 위치를 유지한다 (%s, %s)", async (keepsDate, fontScale) => {
        jest.useFakeTimers();
        const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
        const getDimensions = Dimensions.get.bind(Dimensions);
        const dimensions = jest.spyOn(Dimensions, 'get').mockImplementation(name => ({ ...getDimensions(name), fontScale }));
        try {
            const view = (scope: 'all' | 'personal', days: number[]) => (
                <ThemeProvider>
                    <MonthAgendaList visibleMonth="2026-07-01" entryDate="2026-07-14" calendarScope={scope}
                        items={days.map(day => schedule(String(day), day, 9))} loading={false} error={null}
                        bottomInset={0} onPressRetry={jest.fn()} onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
                </ThemeProvider>
            );
            const section = (day: number) => {
                let node = renderer!.root.findByProps({ children: `7월 ${day}일` });
                while (node.parent && !node.props.onLayout) node = node.parent;
                return node;
            };
            const layout = (y: number, height: number) => ({ nativeEvent: { layout: { y, height } } });
            const placeSection = (day: number, y: number) => {
                const body = renderer!.root.findAllByType(View).find(view => view.props.testID === `month-agenda-body-2026-07-${day}`);
                section(day).props.onLayout(layout(y, body ? 29 : 70));
                body?.props.onLayout(layout(y + 37, 33));
            };
            await act(async () => { renderer = TestRenderer.create(view('all', [14, 18, 21])); });
            const list = () => renderer!.root.findByType(ScrollView);
            expect(list().props.stickyHeaderIndices).toEqual(fontScale === 1 ? [0, 2, 4] : undefined);
            await act(async () => {
                placeSection(14, 8);
                placeSection(18, 150);
                jest.advanceTimersByTime(50);
            });
            act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 175 } } }));
            scrollTo.mockClear();
            await act(async () => { renderer!.update(view('personal', keepsDate ? [14, 18, 21] : [14, 21])); });
            await act(async () => {
                list().props.onLayout({ nativeEvent: { layout: { height: 300 } } });
                list().props.onContentSizeChange(320, 700);
                placeSection(14, 8);
                if (keepsDate) placeSection(18, 100);
                jest.advanceTimersByTime(50);
            });
            const expectedOffset = keepsDate ? 125 : fontScale === 1 ? 8 : 0;
            expect(scrollTo).toHaveBeenLastCalledWith({ y: expectedOffset, animated: false });
        } finally {
            scrollTo.mockRestore();
            dimensions.mockRestore();
            jest.useRealTimers();
        }
    });

    test("목록을 다시 열면 상위 캘린더가 보관한 카테고리로 표시한다", async () => {
        const personal = { ...category, id: "personal", title: "개인" };
        const items = [schedule("work", 14, 9, "업무 일정"), schedule("personal", 14, 12, "개인 일정", personal)];
        const categoryFilter = { id: personal.id, onChange: jest.fn(), onHandleSavedItem: jest.fn() };
        const tree = (showList: boolean) => (
            <ThemeProvider>
                {showList && <MonthAgendaList visibleMonth="2026-07-14" items={items} categoryFilter={categoryFilter}
                    loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                    onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />}
            </ThemeProvider>
        );
        await act(async () => { renderer = TestRenderer.create(tree(true)); });
        await act(async () => { renderer!.update(tree(false)); });
        await act(async () => { renderer!.update(tree(true)); });
        expect(renderedText(renderer!)).toContain("개인 일정");
        expect(renderedText(renderer!)).not.toContain("업무 일정");
        expect(categoryFilter.onChange).not.toHaveBeenCalled();
    });

    test("안내에서 복귀한 일정이 다른 카테고리면 목록에서 해당 일정을 표시한다", async () => {
        const personal = { ...category, id: "personal", title: "개인" };
        const items = [schedule("other", 19, 9, "다른 일정"), schedule("returned", 19, 14, "안내를 종료한 일정", personal)];
        const onChange = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <MonthAgendaList visibleMonth="2026-07-19" items={items} entryDate="2026-07-19"
                        focusTarget={{ id: "returned", run: "1" }}
                        categoryFilter={{ id: category.id, onChange, onHandleSavedItem: jest.fn() }}
                        loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
                </ThemeProvider>,
            );
        });
        expect(onChange).toHaveBeenCalledWith(null);
        expect(renderedText(renderer!)).toContain("안내를 종료한 일정");
    });

    test.each([true, false])("빠른 저장 뒤 일정이 필터에 포함되는지 확인한다 (%s)", async (matchesFilter) => {
        const personal = { ...category, id: "personal", title: "개인" };
        const items = [schedule("old", 14, 9, "기존 일정"), schedule("personal", 14, 12, "개인 일정", personal)];
        const saved = schedule("saved", 19, 14, "저장한 일정", matchesFilter ? category : personal);
        const showOptions = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => undefined);
        const renderList = (afterSave: boolean) => (
            <ThemeProvider>
                <MonthAgendaList visibleMonth="2026-07-14" items={afterSave ? [...items, saved] : items}
                    entryDate={afterSave ? "2026-07-19" : undefined}
                    savedEntry={afterSave ? { itemId: saved.id, categoryId: saved.category.id } : undefined}
                    loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                    onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
            </ThemeProvider>
        );
        await act(async () => { renderer = TestRenderer.create(renderList(false)); });
        act(() => renderer!.root.findByProps({ accessibilityLabel: "일정 필터, 모든 카테고리" }).props.onPress());
        const [options, select] = showOptions.mock.calls.at(-1)!;
        act(() => select(options.options.indexOf("업무")));
        await act(async () => { renderer!.update(renderList(true)); });
        expect(renderedText(renderer!)).toContain("저장한 일정");
        expect(renderer!.root.findByProps({ accessibilityLabel: `일정 필터, ${matchesFilter ? "업무" : "모든 카테고리"}` })).toBeDefined();
        expect(renderedText(renderer!).includes("필터를 해제했어요")).toBe(!matchesFilter);
    });

    test("저장한 일정만 작성 창이 닫힌 뒤 한 번 강조한다", async () => {
        jest.useFakeTimers();
        const timing = jest.spyOn(Animated, "timing");
        const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
        try {
            const saved = schedule("saved", 19, 14);
            const other = schedule("other", 19, 10);
            const renderList = (saveReturnVisible: boolean, reduceEntryMotion = false) => (
                <ThemeProvider>
                    <MonthAgendaList visibleMonth="2026-07-19" items={[other, saved]}
                        entryDate="2026-07-19" savedEntry={{ itemId: saved.id }}
                        saveReturnVisible={saveReturnVisible} reduceEntryMotion={reduceEntryMotion}
                        loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
                </ThemeProvider>
            );
            await act(async () => { renderer = TestRenderer.create(renderList(false)); });
            const scroll = renderer!.root.findByType(ScrollView);
            const section = renderer!.root.findByProps({ testID: "month-agenda-entry-date" }).parent!;
            await act(async () => {
                scroll.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
                scroll.props.onContentSizeChange(350, 700);
                section.props.onLayout({ nativeEvent: { layout: { y: 80 } } });
                jest.advanceTimersByTime(80);
            });
            const cards = renderer!.root.findAllByType(ScheduleAgendaCard);
            expect(cards.find(card => card.props.item.id === "other")?.props.returnHighlightOpacity).toBeUndefined();
            const savedCard = cards.find(card => card.props.item.id === "saved")!;
            expect(savedCard.props.returnHighlightOpacity).toBeDefined();
            const measureLayout = jest.fn((_content, onLayout) => onLayout(0, 510));
            savedCard.props.cardRef.current = { measureLayout };
            scroll.props.innerViewRef.current = {};
            const fades = () => timing.mock.calls.filter(([, config]) => config.duration === 240);
            expect(fades()).toHaveLength(0);
            expect(measureLayout).not.toHaveBeenCalled();
            await act(async () => { renderer!.update(renderList(true)); });
            await act(async () => { jest.advanceTimersByTime(80); });
            expect(measureLayout).toHaveBeenCalledTimes(1);
            const position = scrollTo.mock.lastCall?.[0];
            expect(position).toEqual({ y: expect.any(Number), animated: false });
            expect(typeof position === "object" ? position.y : undefined).toBeGreaterThan(400);
            expect(fades()).toHaveLength(1);
            await act(async () => { renderer!.update(renderList(false)); });
            await act(async () => { renderer!.update(renderList(true)); });
            expect(fades()).toHaveLength(1);
            await act(async () => { renderer!.update(renderList(true, true)); });
            expect(renderer!.root.findAllByType(ScheduleAgendaCard).every(card => !card.props.returnHighlightOpacity)).toBe(true);
        } finally {
            scrollTo.mockRestore();
            timing.mockRestore();
            jest.useRealTimers();
        }
    });

    test("상세형은 작성 창이 닫히고 저장한 일정이 표시되면 해당 행만 강조한다", async () => {
        jest.useFakeTimers();
        const timing = jest.spyOn(Animated, "timing");
        const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
        try {
            const saved = schedule("saved", 19, 14);
            const other = schedule("other", 19, 10);
            const renderPanel = (saveReturnVisible: boolean, items: ScheduleItem[], reduceEntryMotion = false) => (
                <ThemeProvider>
                    <SelectedDayAgendaPanel selectedDay="2026-07-19" items={items}
                        savedItemId={saved.id} saveReturnVisible={saveReturnVisible} reduceEntryMotion={reduceEntryMotion}
                        loading={false} error={null} bottomInset={0} onPressRetry={jest.fn()}
                        onOpenSchedule={jest.fn()} onRequestViewMode={jest.fn()} />
                </ThemeProvider>
            );
            const fades = () => timing.mock.calls.filter(([, config]) => config.duration === 240);
            await act(async () => { renderer = TestRenderer.create(renderPanel(false, [other])); });
            await act(async () => { renderer!.update(renderPanel(true, [other])); });
            expect(fades()).toHaveLength(0);
            await act(async () => { renderer!.update(renderPanel(true, [other, saved])); });
            const cards = renderer!.root.findAllByType(ScheduleAgendaCard);
            const savedCard = cards.find(card => card.props.item.id === saved.id)!;
            savedCard.props.cardRef.current = {
                measureLayout: (_content: View, onLayout: (x: number, y: number) => void) => onLayout(0, 420),
            };
            renderer!.root.findByType(ScrollView).props.innerViewRef.current = {};
            await act(async () => { jest.advanceTimersByTime(80); });
            expect(scrollTo).toHaveBeenLastCalledWith({ y: 412, animated: false });
            expect(fades()).toHaveLength(1);
            expect(cards.find(card => card.props.item.id === other.id)?.props.returnHighlightOpacity).toBeUndefined();
            expect(savedCard.props.returnHighlightOpacity).toBeDefined();
            await act(async () => { renderer!.update(renderPanel(true, [other, saved], true)); });
            expect(renderer!.root.findAllByType(ScheduleAgendaCard).every(card => !card.props.returnHighlightOpacity)).toBe(true);
        } finally {
            scrollTo.mockRestore();
            timing.mockRestore();
            jest.useRealTimers();
        }
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

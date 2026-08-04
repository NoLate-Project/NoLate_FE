import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, {
    act,
    type ReactTestRenderer,
} from "react-test-renderer";

import CustomDay from "../src/modules/schedule/components/calendar/CustomDay";
import type {
    StackDayPresentation,
    StackEventPresentation,
} from "../src/modules/schedule/components/calendar/stackCalendarLayout";

jest.mock("@expo/vector-icons", () => {
    const ReactActual = jest.requireActual("react");
    const ReactNative = jest.requireActual("react-native");
    return {
        Ionicons: (props: Record<string, unknown>) => ReactActual.createElement(
            ReactNative.View,
            { testID: "mock-ionicon", ...props }
        ),
    };
});

jest.mock("react-native-reanimated", () => {
    const ReactNative = jest.requireActual("react-native");
    return {
        __esModule: true,
        default: {
            View: ReactNative.View,
            Text: ReactNative.Text,
        },
        useAnimatedStyle: (factory: () => Record<string, unknown>) => {
            const style = factory();
            Object.defineProperty(style, "__mockFactory", {
                configurable: true,
                enumerable: false,
                value: factory,
            });
            return style;
        },
    };
});

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            selectedDayBg: "#111111",
            selectedDayText: "#ffffff",
            textPrimary: "#111111",
            textSecondary: "#777777",
        },
    }),
}));

const DATE = {
    day: 14,
    month: 7,
    year: 2026,
    dateString: "2026-07-14",
    timestamp: new Date("2026-07-14T00:00:00").getTime(),
};

function makeEvents(count: number) {
    return Array.from({ length: count }, (_, index) => ({
        id: `event-${index}`,
        title: index === 0 ? "아주 긴 한글 일정 제목 테스트" : `일정 ${index + 1}`,
        color: index % 2 === 0 ? "#ff3b30" : "#0a84ff",
        startAt: `2026-07-14T${String(9 + index).padStart(2, "0")}:00:00+09:00`,
        travelMode: index === 0 ? "TRANSIT" as const : undefined,
    }));
}

describe("CustomDay stack indicators", () => {
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
    });

    async function renderDay({
        viewMode = "stack",
        eventCount = 0,
        animatedHeight,
        holiday = false,
        stackPresentation,
        stackEventTop,
        state,
        allowDisabledPress = false,
        onPress,
    }: {
        viewMode?: "stack" | "detail";
        eventCount?: number;
        animatedHeight?: number;
        holiday?: boolean;
        stackPresentation?: StackDayPresentation;
        stackEventTop?: number;
        state?: string;
        allowDisabledPress?: boolean;
        onPress?: jest.Mock;
    } = {}) {
        await act(async () => {
            renderer = TestRenderer.create(
                <CustomDay
                    date={DATE}
                    state={state}
                    marking={{ events: makeEvents(eventCount) }}
                    dayMetadata={holiday ? {
                        date: DATE.dateString,
                        lunarYear: 2026,
                        lunarMonth: 6,
                        lunarDay: 1,
                        leapMonth: false,
                        holidays: [{ name: "제헌절", type: "NATIONAL_DAY" }],
                    } : undefined}
                    viewMode={viewMode}
                    stackPresentation={stackPresentation}
                    stackEventTop={stackEventTop}
                    allowDisabledPress={allowDisabledPress}
                    onPress={onPress}
                    animatedCellHeight={animatedHeight === undefined
                        ? undefined
                        : { value: animatedHeight } as never}
                />
            );
        });

        return renderer!.root;
    }

    function findViewsByTestId(root: ReactTestRenderer["root"], testID: string) {
        return root.findAllByType(View).filter((node) => node.props.testID === testID);
    }

    function findTextsByTestId(root: ReactTestRenderer["root"], testID: string) {
        return root.findAllByType(Text).filter((node) => node.props.testID === testID);
    }

    function findStackChips(root: ReactTestRenderer["root"]) {
        return root.findAllByType(View).filter((node) => (
            typeof node.props.testID === "string"
            && node.props.testID.startsWith("stack-event-chip-")
        ));
    }

    function stackEvent(
        id: string,
        lane: number,
        connectsBefore: boolean,
        connectsAfter: boolean,
        showsLabel = !connectsBefore
    ): StackEventPresentation {
        return {
            id,
            title: id,
            color: "#ff3b30",
            startAt: "2026-07-14T00:00:00+09:00",
            allDay: true,
            travelMode: "TRANSIT",
            lane,
            position: connectsBefore
                ? connectsAfter ? "middle" : "end"
                : connectsAfter ? "start" : "single",
            connectsBefore,
            connectsAfter,
            showsLabel,
        };
    }

    test("스택형은 이동수단 아이콘이 포함된 날짜별 pill 두 줄을 표시한다", async () => {
        const root = await renderDay({ eventCount: 2 });
        const chips = findStackChips(root);
        const titles = findTextsByTestId(root, "stack-event-title");
        const icons = findViewsByTestId(root, "mock-ionicon");

        expect(chips).toHaveLength(2);
        expect(titles).toHaveLength(2);
        expect(titles[0].props.children).toBe("아주 긴 한글 일정 제목 테스트");
        expect(titles[0].props.numberOfLines).toBe(1);
        expect(titles[0].props.ellipsizeMode).toBe("tail");
        expect(StyleSheet.flatten(chips[0].props.style).backgroundColor)
            .toBe("rgba(255, 59, 48, 0.14)");
        expect(icons[0].props.name).toBe("bus-outline");
    });

    test("스택형은 기존 130pt 행과 pill 기준선을 사용한다", async () => {
        const root = await renderDay({ eventCount: 1, holiday: true });
        const [chips] = findViewsByTestId(root, "stack-event-chips");
        const pressable = root.findByProps({ accessibilityRole: "button" });

        const chipsStyle = StyleSheet.flatten(chips.props.style);
        const pressableStyle = StyleSheet.flatten(pressable.props.style({ pressed: false }));

        expect(pressableStyle.height).toBe(130);
        expect(pressableStyle.paddingTop).toBe(8);
        expect(chipsStyle.top).toBe(62);
    });

    test("세 번째 일정부터 남은 개수를 +N개로 합친다", async () => {
        const root = await renderDay({ eventCount: 5 });
        const [overflow] = findTextsByTestId(root, "stack-event-overflow");

        expect(findStackChips(root)).toHaveLength(2);
        expect(overflow.props.children).toEqual(["+", 3, "개"]);
    });

    test.each([
        ["start", false, true, { left: 2, right: 0, borderTopLeftRadius: 5, borderTopRightRadius: 0 }],
        ["middle", true, true, { left: 0, right: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }],
        ["end", true, false, { left: 0, right: 2, borderTopLeftRadius: 0, borderTopRightRadius: 5 }],
        ["single", false, false, { left: 2, right: 2, borderTopLeftRadius: 5, borderTopRightRadius: 5 }],
    ] as const)("연속 일정 %s 조각의 연결 면과 둥근 cap을 구분한다", async (
        _position,
        connectsBefore,
        connectsAfter,
        expectedStyle
    ) => {
        const event = stackEvent("range", 0, connectsBefore, connectsAfter);
        const root = await renderDay({
            eventCount: 1,
            stackPresentation: { lanes: [event, null], overflowCount: 0 },
        });
        const [chip] = findStackChips(root);

        expect(StyleSheet.flatten(chip.props.style)).toMatchObject(expectedStyle);
    });

    test("두 번째 lane만 남아도 위로 당기지 않고 +N은 두 lane 아래에 둔다", async () => {
        const event = stackEvent("lane-1", 1, true, true);
        const root = await renderDay({
            eventCount: 2,
            stackPresentation: { lanes: [null, event], overflowCount: 3 },
            stackEventTop: 62,
        });
        const [chip] = findStackChips(root);
        const [container] = findViewsByTestId(root, "stack-event-chips");
        const [overflow] = findTextsByTestId(root, "stack-event-overflow");

        expect(StyleSheet.flatten(chip.props.style).top).toBe(18);
        expect(StyleSheet.flatten(container.props.style).top).toBe(62);
        expect(StyleSheet.flatten(overflow.props.style).top).toBe(36);
        expect(overflow.props.children).toEqual(["+", 3, "개"]);
    });

    test("연속 stick은 시작 칸에만 제목과 아이콘을 표시한다", async () => {
        const start = stackEvent("range-start", 0, false, true, true);
        let root = await renderDay({
            stackPresentation: { lanes: [start, null], overflowCount: 0 },
        });

        expect(findTextsByTestId(root, "stack-event-title")).toHaveLength(1);
        expect(findViewsByTestId(root, "mock-ionicon")).toHaveLength(1);

        const middle = stackEvent("range-middle", 0, true, true, false);
        root = await renderDay({
            stackPresentation: { lanes: [middle, null], overflowCount: 0 },
        });

        expect(findTextsByTestId(root, "stack-event-title")).toHaveLength(0);
        expect(findViewsByTestId(root, "mock-ionicon")).toHaveLength(0);
        expect(findStackChips(root)).toHaveLength(1);
    });

    test("다음 주 첫 칸에서는 이어지는 stick의 제목을 다시 표시한다", async () => {
        const continued = stackEvent("range-next-week", 0, true, true, true);
        const root = await renderDay({
            stackPresentation: { lanes: [continued, null], overflowCount: 0 },
        });

        expect(findTextsByTestId(root, "stack-event-title")).toHaveLength(1);
        expect(findViewsByTestId(root, "mock-ionicon")).toHaveLength(1);
    });

    test("상세형에는 스택형 pill을 표시하지 않는다", async () => {
        const root = await renderDay({
            viewMode: "detail",
            eventCount: 3,
        });

        expect(findViewsByTestId(root, "stack-event-chips")).toHaveLength(0);
        expect(findStackChips(root)).toHaveLength(0);
        expect(findTextsByTestId(root, "stack-event-overflow")).toHaveLength(0);
        expect(findViewsByTestId(root, "detail-event-markers")).toHaveLength(1);
    });

    test("상세형은 세 개 마커 뒤에 남은 일정 수를 표시한다", async () => {
        const root = await renderDay({
            viewMode: "detail",
            eventCount: 7,
        });
        const [overflow] = findTextsByTestId(root, "detail-event-overflow");

        expect(findViewsByTestId(root, "mock-ionicon")).toHaveLength(1);
        expect(overflow.props.children).toEqual(["+", 4, "개"]);
    });

    test("상세형은 일정이 세 개면 초과 개수를 표시하지 않는다", async () => {
        const root = await renderDay({
            viewMode: "detail",
            eventCount: 3,
        });

        expect(findTextsByTestId(root, "detail-event-overflow")).toHaveLength(0);
    });

    test("상세형 셀이 40pt로 줄어도 날짜·공휴일·마커를 셀 안에서 함께 재배치한다", async () => {
        const root = await renderDay({
            viewMode: "detail",
            eventCount: 1,
            animatedHeight: 40,
            holiday: true,
        });
        const [circle] = findViewsByTestId(root, "calendar-day-circle");
        const [holiday] = findTextsByTestId(root, "calendar-holiday-name");
        const [markers] = findViewsByTestId(root, "detail-event-markers");
        const pressable = root.findByProps({ accessibilityRole: "button" });

        const circleStyle = StyleSheet.flatten(circle.props.style);
        const holidayStyle = StyleSheet.flatten(holiday.props.style);
        const markerStyle = StyleSheet.flatten(markers.props.style);
        const pressableStyle = StyleSheet.flatten(pressable.props.style({ pressed: false }));

        expect(circleStyle.height).toBeLessThan(40);
        expect(holidayStyle.top).toBeLessThan(40);
        expect(markerStyle.top).toBeLessThanOrEqual(32);
        expect(pressableStyle.paddingTop).toBe(0);
    });

    test("음력과 공휴일 및 접근성 일정 개수를 유지한다", async () => {
        const root = await renderDay({
            viewMode: "detail",
            eventCount: 1,
            holiday: true,
        });
        const [lunarText] = findTextsByTestId(root, "calendar-lunar-date");
        const [holidayText] = findTextsByTestId(root, "calendar-holiday-name");

        expect(lunarText.props.children).toBe("음 6.1");
        expect(holidayText.props.children).toBe("제헌절");
        expect(root.findByProps({ accessibilityRole: "button" }).props.accessibilityLabel)
            .toContain("음 6.1, 공휴일 제헌절, 1개의 일정");
    });

    test("전달·다음달 날짜는 흐린 표현을 유지하면서 클릭할 수 있다", async () => {
        const onPress = jest.fn();
        const root = await renderDay({
            viewMode: "detail",
            state: "disabled",
            allowDisabledPress: true,
            onPress,
        });
        const pressable = root.findByProps({ accessibilityRole: "button" });
        const [circle] = findViewsByTestId(root, "calendar-day-circle");
        const dayText = circle.findByType(Text);

        expect(pressable.props.disabled).toBe(false);
        expect(pressable.props.accessibilityState.disabled).toBe(false);
        expect(StyleSheet.flatten(dayText.props.style).opacity).toBe(0.28);

        act(() => pressable.props.onPress());
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onPress).toHaveBeenCalledWith(DATE);
    });

    test("일반 disabled 날짜는 명시적으로 허용하지 않으면 클릭되지 않는다", async () => {
        const onPress = jest.fn();
        const root = await renderDay({
            viewMode: "detail",
            state: "disabled",
            onPress,
        });
        const pressable = root.findByProps({ accessibilityRole: "button" });

        expect(pressable.props.disabled).toBe(true);
        expect(pressable.props.accessibilityState.disabled).toBe(true);
        act(() => pressable.props.onPress());
        expect(onPress).not.toHaveBeenCalled();
    });

    test("상세형 선택 원은 controlled render를 기다리지 않고 shared key를 따른다", async () => {
        const selectedDayKey = { value: 20260715 };
        const nextDate = {
            ...DATE,
            day: 15,
            dateString: "2026-07-15",
            timestamp: new Date("2026-07-15T00:00:00").getTime(),
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <View>
                    <CustomDay
                        date={DATE}
                        marking={{ selected: true }}
                        isSelectedDay
                        viewMode="detail"
                        animatedSelectedDayKey={selectedDayKey as never}
                    />
                    <CustomDay
                        date={nextDate}
                        marking={{}}
                        isSelectedDay={false}
                        viewMode="detail"
                        animatedSelectedDayKey={selectedDayKey as never}
                    />
                </View>
            );
        });

        const circles = findViewsByTestId(
            renderer!.root,
            "calendar-day-circle"
        );
        expect(circles).toHaveLength(2);
        expect(StyleSheet.flatten(circles[0].props.style).backgroundColor)
            .toBe("transparent");
        expect(StyleSheet.flatten(circles[1].props.style).backgroundColor)
            .toBe("#111111");

        selectedDayKey.value = 20260714;
        const resolveAnimatedStyle = (circle: typeof circles[number]) => {
            const animatedStyle = circle.props.style.at(-1) as {
                __mockFactory?: () => Record<string, unknown>;
            };
            return animatedStyle.__mockFactory?.();
        };
        expect(resolveAnimatedStyle(circles[0])?.backgroundColor)
            .toBe("#111111");
        expect(resolveAnimatedStyle(circles[1])?.backgroundColor)
            .toBe("transparent");
    });

    test("인접 pager는 release 전에도 같은 일자의 선택 원을 준비한다", async () => {
        const selectedDayKey = { value: 20260715 };
        const august15 = {
            ...DATE,
            day: 15,
            month: 8,
            dateString: "2026-08-15",
            timestamp: new Date("2026-08-15T00:00:00").getTime(),
        };

        await act(async () => {
            renderer = TestRenderer.create(
                <CustomDay
                    date={august15}
                    marking={{}}
                    viewMode="detail"
                    animatedSelectedDayKey={selectedDayKey as never}
                    detailPagerMonthOrdinal={2026 * 12 + 8 - 1}
                />
            );
        });

        const [circle] = findViewsByTestId(
            renderer!.root,
            "calendar-day-circle"
        );
        const animatedStyle = circle.props.style.at(-1) as {
            __mockFactory?: () => Record<string, unknown>;
        };
        expect(animatedStyle.__mockFactory?.().backgroundColor)
            .toBe("#111111");
    });
});

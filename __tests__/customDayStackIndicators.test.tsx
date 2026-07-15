import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, {
    act,
    type ReactTestRenderer,
} from "react-test-renderer";

import CustomDay from "../src/modules/schedule/components/calendar/CustomDay";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    default: { View: "ReanimatedView" },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
}));

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
    }));
}

describe("CustomDay compact and stack indicators", () => {
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

    async function renderDay(
        eventCount: number,
        viewMode: "compact" | "stack" | "detail" = "compact"
    ) {
        await act(async () => {
            renderer = TestRenderer.create(
                <CustomDay
                    date={DATE}
                    marking={{ events: makeEvents(eventCount) }}
                    viewMode={viewMode}
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

    test("일정 3개까지는 동일한 폭의 막대를 날짜 중앙에 맞춘다", async () => {
        const root = await renderDay(3);
        const [markerLayer] = findViewsByTestId(root, "compact-event-markers");
        const markerStyle = StyleSheet.flatten(markerLayer.props.style);
        const bars = findViewsByTestId(root, "compact-event-bar");

        expect(bars).toHaveLength(3);
        expect(findTextsByTestId(root, "compact-event-overflow")).toHaveLength(0);
        expect(markerStyle).toMatchObject({
            left: 0,
            right: 0,
            alignItems: "center",
        });
        bars.forEach((bar) => {
            expect(StyleSheet.flatten(bar.props.style).width).toBe(40);
        });
    });

    test("3개를 넘는 일정은 남은 개수를 +N개로 표시한다", async () => {
        const root = await renderDay(7);
        const [overflow] = findTextsByTestId(root, "compact-event-overflow");

        expect(findViewsByTestId(root, "compact-event-bar")).toHaveLength(3);
        expect(overflow.props.children).toEqual(["+", 4, "개"]);
    });

    test("새 스택형은 일정 제목 칩을 한 줄로 표시한다", async () => {
        const root = await renderDay(3, "stack");
        const chips = findViewsByTestId(root, "stack-event-chip");
        const titles = findTextsByTestId(root, "stack-event-title");

        expect(chips).toHaveLength(3);
        expect(titles).toHaveLength(3);
        expect(titles[0].props.children).toBe("아주 긴 한글 일정 제목 테스트");
        expect(titles[0].props.numberOfLines).toBe(1);
        expect(titles[0].props.ellipsizeMode).toBe("tail");
        expect(StyleSheet.flatten(chips[0].props.style).backgroundColor)
            .toBe("rgba(255, 59, 48, 0.14)");
        expect(findViewsByTestId(root, "compact-event-bar")).toHaveLength(0);
    });

    test("새 스택형도 세 개를 넘는 일정의 남은 개수를 표시한다", async () => {
        const root = await renderDay(7, "stack");
        const [overflow] = findTextsByTestId(root, "stack-event-overflow");

        expect(findViewsByTestId(root, "stack-event-chip")).toHaveLength(3);
        expect(overflow.props.children).toEqual(["+", 4, "개"]);
        expect(findViewsByTestId(root, "compact-event-markers")).toHaveLength(0);
    });

    test("다른 보기 방식에는 축소형 막대와 스택형 칩을 표시하지 않는다", async () => {
        const root = await renderDay(7, "detail");

        expect(findViewsByTestId(root, "compact-event-markers")).toHaveLength(0);
        expect(findViewsByTestId(root, "compact-event-bar")).toHaveLength(0);
        expect(findViewsByTestId(root, "stack-event-chips")).toHaveLength(0);
        expect(findViewsByTestId(root, "stack-event-chip")).toHaveLength(0);
        expect(findTextsByTestId(root, "stack-event-overflow")).toHaveLength(0);
        expect(root.findAllByType(View).length).toBeGreaterThan(0);
    });
});

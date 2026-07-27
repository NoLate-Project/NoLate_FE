import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import StackWeekEventLabels, {
    createStackWeekLabelSegments,
} from "../src/modules/schedule/components/calendar/StackWeekEventLabels";
import { createStackCalendarLayout } from "../src/modules/schedule/components/calendar/stackCalendarLayout";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("@expo/vector-icons", () => {
    const ReactActual = jest.requireActual("react");
    const ReactNative = jest.requireActual("react-native");
    return {
        Ionicons: (props: Record<string, unknown>) => ReactActual.createElement(
            ReactNative.View,
            { testID: "mock-stack-week-icon", ...props }
        ),
    };
});

const WEEK = [
    "2026-07-12",
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-18",
];

function allDayItem(
    id: string,
    startDay: string,
    endExclusiveDay: string,
    color = "#ff3b30"
): ScheduleItem {
    return {
        id,
        title: `${id} 아주 긴 연속 일정 제목`,
        startAt: `${startDay}T00:00:00+09:00`,
        endAt: `${endExclusiveDay}T00:00:00+09:00`,
        allDay: true,
        travelMode: "TRANSIT",
        category: { id, title: id, color },
    };
}

describe("StackWeekEventLabels", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
    });

    async function renderLabels(items: ScheduleItem[], eventTop = 52) {
        const layout = createStackCalendarLayout(items, 0);
        await act(async () => {
            renderer = TestRenderer.create(
                <StackWeekEventLabels
                    days={WEEK}
                    layout={layout}
                    eventTop={eventTop}
                />
            );
        });
        return { root: renderer!.root, layout };
    }

    test("연속 일정 제목 영역을 이어진 날짜 전체 폭으로 확장한다", async () => {
        const { root, layout } = await renderLabels([
            allDayItem("range", "2026-07-14", "2026-07-16"),
        ], 62);
        const segments = createStackWeekLabelSegments(WEEK, layout);
        const label = root.findByProps({ testID: "stack-week-event-label-range" });
        const style = StyleSheet.flatten(label.props.style);

        expect(segments).toHaveLength(1);
        expect(segments[0]).toMatchObject({
            startIndex: 2,
            endIndex: 3,
            lane: 0,
        });
        expect(style.left).toBe(`${2 * 100 / 7}%`);
        expect(style.right).toBe(`${3 * 100 / 7}%`);
        expect(style.top).toBe(62);
        expect(root.findAllByType(Text).filter((node) => (
            node.props.testID === "stack-week-event-title"
        ))).toHaveLength(1);
        expect(root.findAllByType(View).filter((node) => (
            node.props.testID === "mock-stack-week-icon"
        ))).toHaveLength(1);
        const layer = root.findByProps({
            importantForAccessibility: "no-hide-descendants",
        });
        expect(layer.props.pointerEvents).toBe("none");
        expect(layer.props.accessibilityElementsHidden).toBe(true);
    });

    test("단일 일정은 한 날짜 폭과 양쪽 inset만 사용한다", async () => {
        const { root } = await renderLabels([
            allDayItem("single", "2026-07-14", "2026-07-15"),
        ]);
        const label = root.findByProps({ testID: "stack-week-event-label-single" });
        const style = StyleSheet.flatten(label.props.style);

        expect(style.left).toBe(`${2 * 100 / 7}%`);
        expect(style.right).toBe(`${4 * 100 / 7}%`);
        expect(style.marginLeft).toBe(2);
        expect(style.marginRight).toBe(2);
    });

    test("겹친 연속 일정은 각 lane에서 한 번씩만 제목을 표시한다", async () => {
        const { root } = await renderLabels([
            allDayItem("lane-a", "2026-07-14", "2026-07-19"),
            allDayItem("lane-b", "2026-07-15", "2026-07-18", "#0a84ff"),
            allDayItem("hidden", "2026-07-16", "2026-07-18", "#30d158"),
        ]);
        const titles = root.findAllByType(Text).filter((node) => (
            node.props.testID === "stack-week-event-title"
        ));
        const labels = root.findAllByType(View).filter((node) => (
            typeof node.props.testID === "string"
            && node.props.testID.startsWith("stack-week-event-label-")
        ));

        expect(labels).toHaveLength(2);
        expect(titles).toHaveLength(2);
        expect(StyleSheet.flatten(labels[0].props.style).top).toBe(52);
        expect(StyleSheet.flatten(labels[1].props.style).top).toBe(70);
    });

    test("주 경계에서 이어지는 일정도 새 주 전체 segment에 제목을 한 번 표시한다", async () => {
        const { root } = await renderLabels([
            allDayItem("continued", "2026-07-10", "2026-07-20"),
        ]);
        const [label] = root.findAllByProps({
            testID: "stack-week-event-label-continued",
        });
        const style = StyleSheet.flatten(label.props.style);

        expect(style.left).toBe("0%");
        expect(style.right).toBe("0%");
        expect(style.marginLeft).toBe(0);
        expect(style.marginRight).toBe(0);
        expect(root.findAllByType(Text).filter((node) => (
            node.props.testID === "stack-week-event-title"
        ))).toHaveLength(1);
    });

    test("빈 월 경계 셀을 가로질러 제목 영역을 합치지 않는다", () => {
        const layout = createStackCalendarLayout([
            allDayItem("month-boundary", "2026-07-30", "2026-08-03"),
        ], 0);
        const segments = createStackWeekLabelSegments([
            "2026-07-30",
            "2026-07-31",
            null,
            "2026-08-01",
            "2026-08-02",
            null,
            null,
        ], layout);

        expect(segments.map(({ startIndex, endIndex }) => ({ startIndex, endIndex })))
            .toEqual([
                { startIndex: 0, endIndex: 1 },
                { startIndex: 3, endIndex: 4 },
            ]);
    });
});

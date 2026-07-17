import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ScheduleRouteFocusBoundary from "../src/modules/schedule/components/ScheduleRouteFocusBoundary";

describe("ScheduleRouteFocusBoundary", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    async function renderBoundary(focused: boolean) {
        await act(async () => {
            renderer = TestRenderer.create(
                <ScheduleRouteFocusBoundary
                    focused={focused}
                    testID="schedule-index-route-root"
                >
                    <Text accessibilityRole="button">뒤쪽 캘린더 일정</Text>
                </ScheduleRouteFocusBoundary>
            );
        });

        return renderer!.root.findAll(
            (node) => (
                node.props.testID === "schedule-index-route-root" &&
                node.props.accessibilityElementsHidden !== undefined
            )
        )[0];
    }

    test("일정 route가 현재 화면이면 캘린더 하위 요소를 탐색할 수 있다", async () => {
        const root = await renderBoundary(true);

        expect(root.props.accessibilityElementsHidden).toBe(false);
        expect(root.props.importantForAccessibility).toBe("auto");
    });

    test("공유함·프로필·상세 route가 위에 쌓이면 뒤쪽 캘린더 전체를 숨긴다", async () => {
        const root = await renderBoundary(false);

        expect(root.props.accessibilityElementsHidden).toBe(true);
        expect(root.props.importantForAccessibility).toBe("no-hide-descendants");
    });
});

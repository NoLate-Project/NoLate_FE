import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import CalendarScopeContextLabel from "../src/modules/schedule/components/calendar/CalendarScopeContextLabel";

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        colors: {
            textPrimary: "#FFFFFF",
            textSecondary: "#9A9AA0",
        },
    }),
}));

describe("CalendarScopeContextLabel", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    it("shows the full calendar name outside the icon-only bottom action", async () => {
        const title = "여름 부산 여행을 함께 준비하는 공유 캘린더";

        await act(async () => {
            renderer = TestRenderer.create(
                <CalendarScopeContextLabel title={title} color="#AF52DE" />
            );
        });

        const root = renderer!.root.findByProps({ testID: "calendar-scope-context" });
        const accessibleHeader = renderer!.root.findByProps({
            accessibilityLabel: `현재 캘린더, ${title}`,
        });
        const label = renderer!.root.findByProps({
            testID: "calendar-scope-context-label",
        });
        const marker = renderer!.root.findByProps({
            testID: "calendar-scope-context-color",
        });

        expect(root.props.pointerEvents).toBe("none");
        expect(accessibleHeader.props.accessibilityRole).toBe("header");
        expect(label.props.children).toBe(title);
        expect(label.props.numberOfLines).toBe(1);
        expect(label.props.ellipsizeMode).toBe("tail");
        expect(StyleSheet.flatten(marker.props.style).backgroundColor).toBe("#AF52DE");
    });
});

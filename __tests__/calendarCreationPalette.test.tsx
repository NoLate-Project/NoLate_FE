import React from "react";
import { Dimensions } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { ColorPicker } from "../src/routeSupport/schedule/CalendarsSettingsComponents";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("react-native/Libraries/Components/Pressable/Pressable", () => ({ default: "Pressable" }));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({ mode: "light", colors: { textSecondary: "#526582" } }),
}));

describe("calendar creation color picker", () => {
    let renderer: ReactTestRenderer;
    const realDimensions = Dimensions.get.bind(Dimensions);

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        jest.restoreAllMocks();
    });

    it("uses one row when it fits and two complete rows in a narrow content area", async () => {
        jest.spyOn(Dimensions, "get").mockImplementation(name => ({
            ...realDimensions(name), width: 390, fontScale: 1,
        }));
        const onChange = jest.fn();
        await act(async () => {
            renderer = TestRenderer.create(<ColorPicker value="#AF52DE" onChange={onChange} />);
        });
        const options = () => renderer.root.findAllByType("Pressable" as unknown as React.ElementType);
        expect(new Set(options().map(option => option.parent)).size).toBe(1);

        const panel = renderer.root.findAll(node => typeof node.props.onLayout === "function")[0];
        await act(async () => panel.props.onLayout({ nativeEvent: { layout: { width: 284 } } }));
        const [first, second, third, fourth, fifth, sixth] = options();
        expect(first.parent).toBe(second.parent);
        expect(first.parent).toBe(third.parent);
        expect(fourth.parent).not.toBe(first.parent);
        expect(fourth.parent).toBe(fifth.parent);
        expect(fourth.parent).toBe(sixth.parent);
        expect(fifth.props.accessibilityLabel).toBe("보라 색상");
        expect(fifth.props.accessibilityState.selected).toBe(true);
        expect(renderer.root.findAllByProps({ children: "색상 · 보라" }).length).toBeGreaterThan(0);
        expect(fifth.findAllByProps({ name: "checkmark-outline" }).length).toBeGreaterThan(0);
        await act(async () => sixth.props.onPress());
        expect(onChange).toHaveBeenCalledWith("#FF9500");
    });
});

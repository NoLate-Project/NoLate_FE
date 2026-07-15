import React from "react";
import { Pressable, Switch, Text, useColorScheme } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    SYSTEM_SWITCH_ACTIVE_COLOR,
    ThemeProvider,
    resolveSystemColorMode,
    useTheme,
} from "../src/modules/theme/ThemeContext";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";

function ThemeProbe() {
    const { mode, colors, toggleMode } = useTheme();

    return (
        <Pressable testID="theme-toggle" onPress={toggleMode}>
            <Text testID="theme-mode">{mode}</Text>
            <Text testID="theme-switch-color">{colors.switchActive}</Text>
        </Pressable>
    );
}

function renderTheme(): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = TestRenderer.create(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );
    });
    return renderer;
}

function updateTheme(renderer: ReactTestRenderer) {
    act(() => {
        renderer.update(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );
    });
}

function readMode(renderer: ReactTestRenderer) {
    return renderer.root.findByProps({ testID: "theme-mode" }).props.children;
}

describe("ThemeProvider", () => {
    beforeEach(() => {
        jest.mocked(useColorScheme).mockReturnValue("light");
    });

    it("uses the current phone theme as the default", () => {
        jest.mocked(useColorScheme).mockReturnValue("dark");
        const renderer = renderTheme();

        expect(readMode(renderer)).toBe("dark");
        expect(
            renderer.root.findByProps({ testID: "theme-switch-color" }).props.children
        ).toBe(SYSTEM_SWITCH_ACTIVE_COLOR);
    });

    it("falls back to light while the system theme is unavailable", () => {
        jest.mocked(useColorScheme).mockReturnValue(null);

        expect(readMode(renderTheme())).toBe("light");
        expect(resolveSystemColorMode(null)).toBe("light");
    });

    it("follows phone theme changes until the user overrides it", () => {
        const renderer = renderTheme();
        expect(readMode(renderer)).toBe("light");

        jest.mocked(useColorScheme).mockReturnValue("dark");
        updateTheme(renderer);

        expect(readMode(renderer)).toBe("dark");
    });

    it("keeps a manual choice when the phone theme changes", () => {
        jest.mocked(useColorScheme).mockReturnValue("dark");
        const renderer = renderTheme();

        act(() => {
            renderer.root.findByProps({ testID: "theme-toggle" }).props.onPress();
        });
        expect(readMode(renderer)).toBe("light");

        updateTheme(renderer);
        expect(readMode(renderer)).toBe("light");

        jest.mocked(useColorScheme).mockReturnValue("light");
        updateTheme(renderer);
        jest.mocked(useColorScheme).mockReturnValue("dark");
        updateTheme(renderer);

        expect(readMode(renderer)).toBe("light");
    });

    it("uses the system green track while dark mode is active", () => {
        jest.mocked(useColorScheme).mockReturnValue("dark");
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ThemeModeSwitch />
                </ThemeProvider>
            );
        });

        const themeSwitch = renderer.root.findByType(Switch);
        expect(themeSwitch.props.value).toBe(true);
        expect(themeSwitch.props.trackColor.true).toBe(SYSTEM_SWITCH_ACTIVE_COLOR);
        expect(themeSwitch.props.accessibilityLabel).toBe("다크 모드");
    });
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { Pressable, Text, useColorScheme } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    SYSTEM_SWITCH_ACTIVE_COLOR,
    THEME_PREFERENCE_STORAGE_KEY,
    ThemeProvider,
    resolveSystemColorMode,
    useTheme,
} from "../src/modules/theme/ThemeContext";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";

jest.mock("@react-native-async-storage/async-storage", () =>
    require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

const mockedGetItem = jest.mocked(AsyncStorage.getItem);
const mockedSetItem = jest.mocked(AsyncStorage.setItem);

function ThemeProbe() {
    const { mode, colors, preference, setPreference, toggleMode } = useTheme();

    return (
        <>
            <Pressable testID="theme-toggle" onPress={toggleMode} />
            <Pressable testID="theme-system" onPress={() => setPreference("system")} />
            <Pressable testID="theme-light" onPress={() => setPreference("light")} />
            <Pressable testID="theme-dark" onPress={() => setPreference("dark")} />
            <Text testID="theme-mode">{mode}</Text>
            <Text testID="theme-preference">{preference}</Text>
            <Text testID="theme-switch-color">{colors.switchActive}</Text>
        </>
    );
}

function renderTheme(children: React.ReactNode = <ThemeProbe />): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = TestRenderer.create(
            <ThemeProvider>
                {children}
            </ThemeProvider>
        );
    });
    return renderer;
}

async function flushThemeHydration() {
    await act(async () => {
        await Promise.resolve();
    });
}

function updateTheme(renderer: ReactTestRenderer, children: React.ReactNode = <ThemeProbe />) {
    act(() => {
        renderer.update(
            <ThemeProvider>
                {children}
            </ThemeProvider>
        );
    });
}

function read(renderer: ReactTestRenderer, testID: string) {
    return renderer.root.findByProps({ testID }).props.children;
}

describe("ThemeProvider", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useColorScheme).mockReturnValue("light");
        mockedGetItem.mockResolvedValue(null);
        mockedSetItem.mockResolvedValue(undefined);
    });

    it("uses the current phone theme with the system preference by default", async () => {
        jest.mocked(useColorScheme).mockReturnValue("dark");
        const renderer = renderTheme();
        await flushThemeHydration();

        expect(read(renderer, "theme-mode")).toBe("dark");
        expect(read(renderer, "theme-preference")).toBe("system");
        expect(read(renderer, "theme-switch-color")).toBe(SYSTEM_SWITCH_ACTIVE_COLOR);
    });

    it("falls back to light while the system theme is unavailable", () => {
        expect(resolveSystemColorMode(null)).toBe("light");
    });

    it("restores a stored manual preference", async () => {
        mockedGetItem.mockResolvedValue("dark");
        const renderer = renderTheme();
        await flushThemeHydration();

        expect(mockedGetItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY);
        expect(read(renderer, "theme-preference")).toBe("dark");
        expect(read(renderer, "theme-mode")).toBe("dark");
    });

    it("follows phone theme changes only while system is selected", async () => {
        const renderer = renderTheme();
        await flushThemeHydration();
        expect(read(renderer, "theme-mode")).toBe("light");

        jest.mocked(useColorScheme).mockReturnValue("dark");
        updateTheme(renderer);
        expect(read(renderer, "theme-mode")).toBe("dark");

        act(() => {
            renderer.root.findByProps({ testID: "theme-light" }).props.onPress();
        });
        jest.mocked(useColorScheme).mockReturnValue("light");
        updateTheme(renderer);
        jest.mocked(useColorScheme).mockReturnValue("dark");
        updateTheme(renderer);

        expect(read(renderer, "theme-preference")).toBe("light");
        expect(read(renderer, "theme-mode")).toBe("light");
        expect(mockedSetItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY, "light");
    });

    it("exposes system, light, and dark as accessible radio choices", async () => {
        const renderer = renderTheme(<ThemeModeSwitch />);
        await flushThemeHydration();

        const system = renderer.root.findByProps({ testID: "theme-preference-system" });
        const light = renderer.root.findByProps({ testID: "theme-preference-light" });
        const dark = renderer.root.findByProps({ testID: "theme-preference-dark" });
        expect(system.props.accessibilityRole).toBe("radio");
        expect(system.props.accessibilityState.selected).toBe(true);
        expect(light.props.accessibilityState.selected).toBe(false);

        act(() => dark.props.onPress());

        expect(renderer.root.findByProps({ testID: "theme-preference-dark" }).props.accessibilityState.selected).toBe(true);
        expect(mockedSetItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY, "dark");
    });

    it("keeps the selected theme usable when persistence fails", async () => {
        const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        mockedSetItem.mockRejectedValue(new Error("storage unavailable"));
        const renderer = renderTheme();
        await flushThemeHydration();

        await act(async () => {
            renderer.root.findByProps({ testID: "theme-dark" }).props.onPress();
            await Promise.resolve();
        });

        expect(read(renderer, "theme-mode")).toBe("dark");
        expect(warning).toHaveBeenCalledWith(
            "[theme] preference save failed",
            expect.any(Error),
        );
        warning.mockRestore();
    });

    it("keeps following the system when preference loading fails", async () => {
        const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        jest.mocked(useColorScheme).mockReturnValue("dark");
        mockedGetItem.mockRejectedValue(new Error("storage unavailable"));
        const renderer = renderTheme();
        await flushThemeHydration();

        expect(read(renderer, "theme-preference")).toBe("system");
        expect(read(renderer, "theme-mode")).toBe("dark");
        expect(warning).toHaveBeenCalledWith(
            "[theme] preference load failed",
            expect.any(Error),
        );
        warning.mockRestore();
    });
});

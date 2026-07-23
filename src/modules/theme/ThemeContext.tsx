import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useColorScheme, type ColorSchemeName } from "react-native";

export type ColorMode = "dark" | "light";
export type ThemePreference = "system" | ColorMode;

export type AppColors = {
    background: string;
    surface: string;
    surface2: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textDisabled: string;
    // 캘린더 선택일
    selectedDayBg: string;
    selectedDayText: string;
    // 오늘 테두리
    todayBorderColor: string;
    // 캘린더 헤더
    calendarBackground: string;
    dayHeaderColor: string;
    arrowColor: string;
    monthTextColor: string;
    inputBackground: string;
    inputBorder: string;
    inputBorderFocused: string;
    inputPlaceholder: string;
    switchActive: string;
};

export const SYSTEM_SWITCH_ACTIVE_COLOR = "#34C759";
export const THEME_PREFERENCE_STORAGE_KEY = "nolate_theme_preference";

const dark: AppColors = {
    background: "#000",
    surface: "#1c1c1e",
    surface2: "#2c2c2e",
    border: "#2c2c2e",
    textPrimary: "#fff",
    textSecondary: "#8e8e93",
    textDisabled: "#3a3a3c",
    selectedDayBg: "#fff",
    selectedDayText: "#000",
    todayBorderColor: "#fff",
    calendarBackground: "#000",
    dayHeaderColor: "#555",
    arrowColor: "#fff",
    monthTextColor: "#fff",
    inputBackground: "rgba(10,11,14,0.72)",
    inputBorder: "rgba(255,255,255,0.11)",
    inputBorderFocused: "rgba(255,255,255,0.32)",
    inputPlaceholder: "rgba(235,235,245,0.34)",
    switchActive: SYSTEM_SWITCH_ACTIVE_COLOR,
};

const light: AppColors = {
    background: "#fff",
    surface: "#fff",
    surface2: "#f7f7f8",
    border: "#e6e6ea",
    textPrimary: "#000",
    textSecondary: "#6e6e73",
    textDisabled: "#c7c7cc",
    selectedDayBg: "#000",
    selectedDayText: "#fff",
    todayBorderColor: "#000",
    calendarBackground: "#fff",
    dayHeaderColor: "#8e8e93",
    arrowColor: "#000",
    monthTextColor: "#000",
    inputBackground: "rgba(118,118,128,0.10)",
    inputBorder: "rgba(60,60,67,0.14)",
    inputBorderFocused: "rgba(0,0,0,0.36)",
    inputPlaceholder: "rgba(60,60,67,0.34)",
    switchActive: SYSTEM_SWITCH_ACTIVE_COLOR,
};

export function resolveSystemColorMode(systemScheme: ColorSchemeName): ColorMode {
    return systemScheme === "dark" ? "dark" : "light";
}

type ThemeContextValue = {
    mode: ColorMode;
    colors: AppColors;
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => void;
    toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemScheme = useColorScheme();
    const systemMode = resolveSystemColorMode(systemScheme);
    const [preference, setPreferenceState] = useState<ThemePreference>("system");
    const userChangedPreferenceRef = useRef(false);
    const mode = preference === "system" ? systemMode : preference;

    useEffect(() => {
        let active = true;

        AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
            .then((storedPreference) => {
                if (!active || userChangedPreferenceRef.current) return;
                if (isThemePreference(storedPreference)) {
                    setPreferenceState(storedPreference);
                }
            })
            .catch((error) => {
                console.warn("[theme] preference load failed", error);
            });

        return () => {
            active = false;
        };
    }, []);

    const setPreference = useCallback((nextPreference: ThemePreference) => {
        userChangedPreferenceRef.current = true;
        setPreferenceState(nextPreference);
        AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, nextPreference).catch((error) => {
            // 테마 저장 실패는 현재 앱의 선택을 되돌리거나 사용을 막지 않는다.
            console.warn("[theme] preference save failed", error);
        });
    }, []);

    const toggleMode = useCallback(() => {
        setPreference(mode === "dark" ? "light" : "dark");
    }, [mode, setPreference]);
    const colors = mode === "dark" ? dark : light;

    return (
        <ThemeContext.Provider value={{ mode, colors, preference, setPreference, toggleMode }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === "system" || value === "light" || value === "dark";
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
    return ctx;
}

import React, { createContext, useContext, useState } from "react";
import { useColorScheme } from "react-native";

export type ColorMode = "dark" | "light";

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
};

const dark: AppColors = {
    background: "#000",
    surface: "#1c1c1e",
    surface2: "#2c2c2e",
    border: "#3a3a3c",
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
};

const light: AppColors = {
    background: "#f2f2f7",
    surface: "#fff",
    surface2: "#f2f2f7",
    border: "#e5e5ea",
    textPrimary: "#000",
    textSecondary: "#6e6e73",
    textDisabled: "#c7c7cc",
    selectedDayBg: "#000",
    selectedDayText: "#fff",
    todayBorderColor: "#000",
    calendarBackground: "#f2f2f7",
    dayHeaderColor: "#8e8e93",
    arrowColor: "#000",
    monthTextColor: "#000",
};

type ThemeContextValue = {
    mode: ColorMode;
    colors: AppColors;
    toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemScheme = useColorScheme();
    const [mode, setMode] = useState<ColorMode>(
        systemScheme === "light" ? "light" : "dark"
    );

    const toggleMode = () => setMode((m) => (m === "dark" ? "light" : "dark"));
    const colors = mode === "dark" ? dark : light;

    return (
        <ThemeContext.Provider value={{ mode, colors, toggleMode }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
    return ctx;
}

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
    inputBackground: string;
    inputBorder: string;
    inputBorderFocused: string;
    inputPlaceholder: string;
};

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

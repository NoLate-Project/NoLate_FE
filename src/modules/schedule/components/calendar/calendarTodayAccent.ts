export const CALENDAR_TODAY_ACCENT = {
    light: "#2979FF",
    dark: "#4B9DFF",
} as const;

export function getCalendarTodayAccent(mode: "light" | "dark"): string {
    return CALENDAR_TODAY_ACCENT[mode];
}

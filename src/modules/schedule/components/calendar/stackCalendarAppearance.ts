/** Cell backgrounds and week-wide labels must share the same vertical geometry. */
export const STACK_CALENDAR_GEOMETRY = {
    rowHeight: 104,
    eventTop: 44,
    holidayEventTop: 54,
    holidayTop: 42,
    eventHeight: 16,
    laneStride: 18,
} as const;

export function getStackEventBackground(
    color: string,
    isRange: boolean,
    mode: "light" | "dark"
): string {
    if (!isRange) return mode === "dark" ? "#202126" : "#F4F5F7";

    let hex = color.replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        hex = hex.split("").map((value) => value + value).join("");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return color;

    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${mode === "dark" ? 0.18 : 0.09})`;
}

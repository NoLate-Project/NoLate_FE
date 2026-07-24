function channel(value: number): number {
    const normalized = value / 255;
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
    const value = hex.replace("#", "");
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

export function getColorContrastRatio(foreground: string, background: string): number {
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
}

export const LIGHT_DEPARTURE_BADGE_COLORS = {
    attentionText: "#9A3412",
    attentionBackground: "#FFF1E8",
    freshText: "#166534",
    freshBackground: "#E8F8ED",
    infoText: "#1D4ED8",
    infoBackground: "#EAF2FF",
} as const;

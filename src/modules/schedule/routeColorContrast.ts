/** Retain the provider's route color; choose readable monochrome ink on it. */
export function routeColorInk(color: string): '#000000' | '#FFFFFF' {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return '#FFFFFF';
    const channel = (start: number) => {
        const value = parseInt(color.slice(start, start + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}

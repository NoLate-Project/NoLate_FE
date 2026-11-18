const RGB_HEX = /^#[0-9a-f]{6}$/i;

function routeColorLuminance(color: string): number {
    const channel = (start: number) => {
        const value = parseInt(color.slice(start, start + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Retain the provider's route color; choose readable monochrome ink on it. */
export function routeColorInk(color: string): '#000000' | '#FFFFFF' {
    if (!RGB_HEX.test(color)) return '#FFFFFF';
    const luminance = routeColorLuminance(color);
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}

/** Darken bright route colors just enough to keep white transit symbols readable. */
export function routeColorForWhiteIcon(color: string): string {
    if (!RGB_HEX.test(color)) return '#44556A';
    if (routeColorInk(color) === '#FFFFFF') return color;
    const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
    for (const factor of [0.82, 0.72, 0.62, 0.46]) {
        const shade = '#' + rgb.map(value => Math.floor(value * factor).toString(16).padStart(2, '0')).join('');
        if (routeColorInk(shade) === '#FFFFFF') return shade;
    }
    return '#44556A';
}

/** Keep the route hue for small captions across the opaque route surfaces. */
export function routeColorForCaption(color: string, isDark: boolean): string {
    const neutral = isDark ? '#B3BECC' : '#53647A';
    if (!RGB_HEX.test(color)) return neutral;

    // Use the lighter dark surface and the darker light surface for the contrast check.
    const surface = routeColorLuminance(isDark ? '#20242B' : '#F4F6FA');
    const luminance = routeColorLuminance(color);
    const meetsContrast = (value: number) => isDark
        ? (value + 0.05) / (surface + 0.05) >= 4.5
        : (surface + 0.05) / (value + 0.05) >= 4.5;
    if (meetsContrast(luminance)) return color;

    const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
    const target = isDark ? 255 : 0;
    for (const amount of [0.12, 0.24, 0.36, 0.48, 0.60, 0.72]) {
        const shade = '#' + rgb.map(value =>
            Math.round(value + (target - value) * amount).toString(16).padStart(2, '0')
        ).join('');
        if (meetsContrast(routeColorLuminance(shade))) return shade;
    }
    return neutral;
}

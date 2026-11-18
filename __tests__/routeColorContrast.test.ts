import { routeColorForCaption, routeColorForWhiteIcon, routeColorInk } from '../src/modules/schedule/routeColorContrast';

function luminance(color: string) {
    const linear = (value: number) => value / 255 <= 0.04045
        ? value / 255 / 12.92
        : ((value / 255 + 0.055) / 1.055) ** 2.4;
    const [red, green, blue] = [1, 3, 5].map(index => linear(parseInt(color.slice(index, index + 2), 16)));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

it('keeps readable text on both pale and dark route colors', () => {
    expect(routeColorInk('#FFF5A0')).toBe('#000000'); expect(routeColorInk('#001122')).toBe('#FFFFFF');
    expect(routeColorInk('invalid')).toBe('#FFFFFF');
});
it('keeps all route labels and symbols at 4.5:1 contrast across a representative RGB grid', () => {
    for (const r of [0, 51, 102, 153, 204, 255]) for (const g of [0, 51, 102, 153, 204, 255]) for (const b of [0, 51, 102, 153, 204, 255]) {
        const hex = '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('');
        expect(contrast(routeColorInk(hex), hex)).toBeGreaterThanOrEqual(4.5);
        expect(contrast('#FFFFFF', routeColorForWhiteIcon(hex))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(routeColorForCaption(hex, false), '#F4F6FA')).toBeGreaterThanOrEqual(4.5);
        expect(contrast(routeColorForCaption(hex, true), '#20242B')).toBeGreaterThanOrEqual(4.5);
    }
});

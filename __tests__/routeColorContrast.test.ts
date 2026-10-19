import { routeColorInk } from '../src/modules/schedule/routeColorContrast';
it('keeps readable text on both pale and dark route colors', () => {
    expect(routeColorInk('#FFF5A0')).toBe('#000000'); expect(routeColorInk('#001122')).toBe('#FFFFFF');
    expect(routeColorInk('invalid')).toBe('#FFFFFF');
});
it('selected ink exceeds 4.5:1 contrast across a representative RGB grid', () => {
    const linear = (value: number) => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
    for (const r of [0, 51, 102, 153, 204, 255]) for (const g of [0, 51, 102, 153, 204, 255]) for (const b of [0, 51, 102, 153, 204, 255]) {
        const hex = '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('');
        const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        const contrast = routeColorInk(hex) === '#000000' ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
});

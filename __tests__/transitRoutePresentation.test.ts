import {
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    shouldRenderTransitNativeDirection,
} from "../src/modules/map/transitRoutePresentation";

describe("transit route zoom presentation", () => {
    it("줌 단계 사이에서도 본선과 casing의 화면상 폭을 고정한다", () => {
        const zooms = [12, 13.5, 15, 16, 17, 17.5, 18];
        const values = zooms.map(getTransitRouteLinePresentation);

        values.forEach((value) => {
            expect(value.rideCasingWidth / value.rideWidth).toBeCloseTo(1.22);
            expect(value.walkCasingWidth / value.walkWidth).toBeCloseTo(1.3);
            expect((value.rideCasingWidth - value.rideWidth) / 2).toBeLessThan(1);
            expect((value.walkCasingWidth - value.walkWidth) / 2).toBeLessThan(0.8);
        });
        values.forEach((value) => {
            expect(value.rideWidth).toBeCloseTo(8.4);
            expect(value.walkWidth).toBeCloseTo(5.2);
        });
    });

    it("fallback 선도 줌 경계에서 두께가 튀지 않는다", () => {
        expect(getFallbackRouteStrokePresentation(14).mainWidth).toBeCloseTo(6.8667, 3);
        expect(getFallbackRouteStrokePresentation(16).mainWidth).toBeCloseTo(7.8);
        expect(getFallbackRouteStrokePresentation(17.5).mainWidth).toBeCloseTo(8.6);
    });

    it("native direction은 BUS/SUBWAY에만 적용하고 투명도를 연속 보간한다", () => {
        expect(shouldRenderTransitNativeDirection("BUS", 5.9)).toBe(false);
        expect(shouldRenderTransitNativeDirection("SUBWAY", 6)).toBe(true);
        expect(shouldRenderTransitNativeDirection("BUS", 10)).toBe(true);
        expect(shouldRenderTransitNativeDirection("BUS", 15)).toBe(true);
        expect(shouldRenderTransitNativeDirection("WALK", 18)).toBe(false);
        expect(shouldRenderTransitNativeDirection("TRANSFER", 18)).toBe(false);
        expect(getTransitNativeDirectionOpacity(12)).toBeCloseTo(0.52);
        expect(getTransitNativeDirectionOpacity(15)).toBeCloseTo(0.62);
        expect(getTransitNativeDirectionOpacity(16)).toBeCloseTo(0.66);
        expect(getTransitNativeDirectionOpacity(17)).toBeCloseTo(0.7);
        expect(getTransitNativeDirectionOpacity(18)).toBeCloseTo(0.72);
    });
});

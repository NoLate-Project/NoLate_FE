import {
    applyTransitRouteThemeToOverlay,
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    getTransitRouteThemePresentation,
    shouldRenderTransitNativeDirection,
    TRANSIT_WALK_DASH_PATTERN,
} from "../src/modules/map/transitRoutePresentation";

describe("transit route zoom presentation", () => {
    it("도보선은 모든 줌에서 분리된 둥근 점 리듬을 유지한다", () => {
        Array.from({ length: 13 }, (_, index) => index + 6).forEach(() => {
            expect(TRANSIT_WALK_DASH_PATTERN).toEqual([1, 13]);
        });
    });

    it("줌 단계 사이에서도 본선과 casing의 화면상 폭을 고정한다", () => {
        const zooms = [6, 8, 10, 12, 13.5, 15, 16, 17, 17.5, 18];
        const values = zooms.map(getTransitRouteLinePresentation);

        values.forEach((value) => {
            expect(value.rideCasingWidth / value.rideWidth).toBeCloseTo(1.22);
            expect(value.walkCasingWidth / value.walkWidth).toBeCloseTo(1.3);
            expect((value.rideCasingWidth - value.rideWidth) / 2).toBeCloseTo(0.792);
            expect((value.walkCasingWidth - value.walkWidth) / 2).toBeLessThan(0.8);
        });
        values.forEach((value) => {
            expect(value.rideWidth).toBeCloseTo(7.2);
            expect(value.walkWidth).toBeCloseTo(4.4);
        });
    });

    it("fallback 선도 줌 경계에서 두께가 튀지 않는다", () => {
        expect(getFallbackRouteStrokePresentation(14).mainWidth).toBeCloseTo(6.9333, 3);
        expect(getFallbackRouteStrokePresentation(16).mainWidth).toBeCloseTo(7.4);
        expect(getFallbackRouteStrokePresentation(17.5).mainWidth).toBeCloseTo(7.7);
        expect(getFallbackRouteStrokePresentation(18)).toMatchObject({
            mainWidth: 7.8,
            casingWidth: 11,
            outlineWidth: 1.6,
        });
    });

    it("native direction은 BUS/SUBWAY에만 적용하고 z11부터 확대할수록 선명하게 유지한다", () => {
        expect(shouldRenderTransitNativeDirection("BUS", 5.9)).toBe(false);
        expect(shouldRenderTransitNativeDirection("SUBWAY", 6)).toBe(false);
        expect(shouldRenderTransitNativeDirection("BUS", 10)).toBe(false);
        expect(shouldRenderTransitNativeDirection("BUS", 10.9)).toBe(false);
        expect(shouldRenderTransitNativeDirection("BUS", 11)).toBe(true);
        expect(shouldRenderTransitNativeDirection("BUS", 11.9)).toBe(true);
        expect(shouldRenderTransitNativeDirection("SUBWAY", 12)).toBe(true);
        expect(shouldRenderTransitNativeDirection("BUS", 15)).toBe(true);
        expect(shouldRenderTransitNativeDirection("WALK", 18)).toBe(false);
        expect(shouldRenderTransitNativeDirection("TRANSFER", 18)).toBe(false);
        expect(getTransitNativeDirectionOpacity(11)).toBeCloseTo(0.9);
        expect(getTransitNativeDirectionOpacity(12)).toBeCloseTo(0.9);
        expect(getTransitNativeDirectionOpacity(13.5)).toBeCloseTo(0.92);
        expect(getTransitNativeDirectionOpacity(15)).toBeCloseTo(0.94);
        expect(getTransitNativeDirectionOpacity(16)).toBeCloseTo(0.95);
        expect(getTransitNativeDirectionOpacity(17)).toBeCloseTo(0.96);
        expect(getTransitNativeDirectionOpacity(18)).toBeCloseTo(0.96);
    });

    it("라이트와 다크 안내선의 casing과 방향 대비를 분리한다", () => {
        expect(getTransitRouteThemePresentation(12, "light")).toMatchObject({
            rideCasingColor: "#FFFFFF",
            rideCasingOpacity: 0.92,
            walkCasingColor: "#FFFFFF",
            walkCasingOpacity: 0.9,
            directionColor: "#FFFFFF",
            directionOpacity: 0.9,
        });
        expect(getTransitRouteThemePresentation(12, "dark")).toMatchObject({
            rideCasingColor: "#0F172A",
            rideCasingOpacity: 0.76,
            walkCasingColor: "#0F172A",
            walkCasingOpacity: 0.72,
            directionColor: "#FFFFFF",
            directionOpacity: 0.9,
        });
        const darkDirectionStops = [0.9, 0.92, 0.94, 0.95, 0.96, 0.96];
        [12, 13.5, 15, 16, 17, 18].forEach((zoom, index) => {
            const lightTheme = getTransitRouteThemePresentation(zoom, "light");
            const darkTheme = getTransitRouteThemePresentation(zoom, "dark");
            expect(darkTheme.directionOpacity)
                .toBeCloseTo(darkDirectionStops[index]);
            expect(lightTheme.directionColor).toBe(darkTheme.directionColor);
            expect(lightTheme.directionOpacity).toBeCloseTo(darkTheme.directionOpacity);
        });

        const ride = {
            id: "route-subway-1",
            renderMode: "native" as const,
            strokeStyle: "solid",
            outlineColor: "#FFFFFF",
            outlineOpacity: 0.92,
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
            nativeDirectionOpacity: 0.9,
        };
        expect(applyTransitRouteThemeToOverlay(ride, 17, "light")).toBe(ride);
        expect(applyTransitRouteThemeToOverlay(ride, 17, "dark")).toMatchObject({
            outlineColor: "#0F172A",
            outlineOpacity: 0.76,
            nativeDirectionColor: "#FFFFFF",
            nativeDirectionOpacity: 0.96,
        });
        expect(applyTransitRouteThemeToOverlay({
            id: "route-walk-1",
            renderMode: "native" as const,
            strokeStyle: "dash",
            outlineColor: "#FFFFFF",
            outlineOpacity: 0.9,
        }, 17, "dark")).toMatchObject({
            outlineColor: "#0F172A",
            outlineOpacity: 0.72,
        });
    });
});

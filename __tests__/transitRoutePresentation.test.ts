import {
    applyTransitRouteThemeToOverlay,
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    getTransitRouteThemePresentation,
    getTransitWalkGuidePresentation,
    shouldRenderTransitNativeDirection,
    shouldRenderTransitStopAccessLinks,
    TRANSIT_WALK_DASH_PATTERN,
} from "../src/modules/map/transitRoutePresentation";

describe("transit route zoom presentation", () => {
    it("z6~18 전 레벨에서 같은 native dot 리듬을 유지하고 상세 줌에서만 access-link를 보인다", () => {
        expect(TRANSIT_WALK_DASH_PATTERN).toEqual([1, 13]);

        const matrix = Array.from({ length: 13 }, (_, index) => {
            const zoom = index + 6;
            return { zoom, accessLinks: zoom >= 14 };
        });

        matrix.forEach(({ zoom, accessLinks }) => {
            expect(getTransitWalkGuidePresentation(zoom)).toEqual({
                dashPattern: [1, 13],
                strokeStyle: "dot",
                outlineStrokeStyle: "dot",
            });
            expect(shouldRenderTransitStopAccessLinks(zoom)).toBe(accessLinks);
        });
        expect(shouldRenderTransitStopAccessLinks(13.999)).toBe(false);
        expect(shouldRenderTransitStopAccessLinks(14)).toBe(true);
    });

    it("z6~18에서 도보 폭을 약 20%만 키우고 별도 dot casing은 만들지 않는다", () => {
        const matrix = [
            ...[6, 7, 8, 9, 10].map((zoom) => ({ zoom, rideWidth: 6.4, walkWidth: 3.8 })),
            ...[11, 12, 13, 14, 15].map((zoom) => ({ zoom, rideWidth: 7.2, walkWidth: 4.2 })),
            ...[16, 17, 18].map((zoom) => ({ zoom, rideWidth: 8, walkWidth: 4.6 })),
        ];

        matrix.forEach(({ zoom, rideWidth, walkWidth }) => {
            expect(getTransitRouteLinePresentation(zoom)).toEqual({
                rideWidth,
                rideCasingWidth: Number((rideWidth + 1.6).toFixed(1)),
                walkWidth,
                walkCasingWidth: walkWidth,
            });
        });
    });

    it("LOD 경계 안에서는 소수 줌에도 선 폭을 보간하지 않는다", () => {
        expect(getTransitRouteLinePresentation(10.999)).toEqual({
            rideWidth: 6.4,
            rideCasingWidth: 8,
            walkWidth: 3.8,
            walkCasingWidth: 3.8,
        });
        expect(getTransitRouteLinePresentation(11)).toEqual({
            rideWidth: 7.2,
            rideCasingWidth: 8.8,
            walkWidth: 4.2,
            walkCasingWidth: 4.2,
        });
        expect(getTransitRouteLinePresentation(15.999)).toEqual(
            getTransitRouteLinePresentation(11)
        );
        expect(getTransitRouteLinePresentation(16)).toEqual({
            rideWidth: 8,
            rideCasingWidth: 9.6,
            walkWidth: 4.6,
            walkCasingWidth: 4.6,
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

    it("native direction은 BUS/SUBWAY에만 적용하고 z11부터 고정 대비를 유지한다", () => {
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
        [6, 10, 11, 12, 13.5, 15, 16, 17, 18].forEach((zoom) => {
            expect(getTransitNativeDirectionOpacity(zoom)).toBe(0.96);
        });
    });

    it("라이트와 다크 안내선의 casing과 방향 대비를 분리한다", () => {
        expect(getTransitRouteThemePresentation(12, "light")).toMatchObject({
            rideCasingColor: "#FFFFFF",
            rideCasingOpacity: 0.92,
            walkCasingColor: "#FFFFFF",
            walkCasingOpacity: 0.9,
            directionColor: "#FFFFFF",
            directionOpacity: 0.96,
        });
        expect(getTransitRouteThemePresentation(12, "dark")).toMatchObject({
            rideCasingColor: "#0F172A",
            rideCasingOpacity: 0.76,
            walkCasingColor: "#0F172A",
            walkCasingOpacity: 0.72,
            directionColor: "#FFFFFF",
            directionOpacity: 0.96,
        });
        [12, 13.5, 15, 16, 17, 18].forEach((zoom) => {
            const lightTheme = getTransitRouteThemePresentation(zoom, "light");
            const darkTheme = getTransitRouteThemePresentation(zoom, "dark");
            expect(darkTheme.directionOpacity).toBe(0.96);
            expect(lightTheme.directionColor).toBe(darkTheme.directionColor);
            expect(lightTheme.directionOpacity).toBe(darkTheme.directionOpacity);
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

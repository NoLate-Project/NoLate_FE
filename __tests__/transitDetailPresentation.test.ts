import {
    getRouteDetailSummarySurface,
    getTransitDetailScrollViewportHeight,
    getTransitDetailSummaryPalette,
} from "../src/modules/schedule/transitDetailPresentation";

describe("transit detail presentation", () => {
    it("uses readable theme colors", () => {
        const light = getTransitDetailSummaryPalette(false, {
            textSecondary: "#6E6E73",
            border: "#E6E6EA",
        });
        const dark = getTransitDetailSummaryPalette(true, {
            textSecondary: "#8E8E93",
            border: "#2C2C2E",
        });

        expect(light).toEqual({
            metaTextColor: "#6E6E73",
            borderColor: "#E6E6EA",
        });
        expect(dark).toEqual({
            metaTextColor: "#B8B8B8",
            borderColor: "#343434",
        });
    });

    it("keeps non-transit detail cards on their existing surface", () => {
        expect(getRouteDetailSummarySurface(true, "#FFFFFF", "#E6E6EA")).toEqual({
            backgroundColor: "transparent",
            borderBottomColor: "#E6E6EA",
        });
        expect(getRouteDetailSummarySurface(false, "#FFFFFF", "#E6E6EA")).toEqual({
            backgroundColor: "#FFFFFF",
            borderBottomColor: undefined,
        });
    });

    it("reserves only the actual handle and fixed action bar heights", () => {
        expect(getTransitDetailScrollViewportHeight(500, 84, 26)).toBe(390);
        expect(getTransitDetailScrollViewportHeight(500, 84, 30)).toBe(386);
        expect(getTransitDetailScrollViewportHeight(90, 84, 26)).toBe(0);
        expect(getTransitDetailScrollViewportHeight(Number.NaN, 84, 26)).toBe(0);
    });
});

import { getScheduleDetailSheetHeights } from "../src/modules/schedule/detailPresentation";

describe("schedule detail compact sheet height", () => {
    test.each([
        [852, 166, 613],
        [874, 169, 629],
        [932, 178, 671],
    ])("raises only the compact sheet by 15%% at %ipt", (
        windowHeight,
        expectedHeight,
        expectedMaxHeight
    ) => {
        const heights = getScheduleDetailSheetHeights(windowHeight);

        expect(heights.minHeight).toBe(expectedHeight);
        expect(heights.maxHeight).toBe(expectedMaxHeight);
    });

    test.each([568, 667, 1024, 1366])(
        "keeps the compact sheet below the expanded height at %ipt",
        (windowHeight) => {
            const heights = getScheduleDetailSheetHeights(windowHeight);

            expect(heights.minHeight).toBeLessThan(heights.maxHeight);
        }
    );
});

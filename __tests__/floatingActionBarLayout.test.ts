import {
    FLOATING_ACTION_BAR_HEIGHT,
    getFloatingActionBarBottomOffset,
    getFloatingActionBarClearance,
} from "../src/modules/schedule/components/shared/floatingActionBarLayout";

describe("floating action bar layout", () => {
    test("keeps the existing button geometry", () => {
        expect(FLOATING_ACTION_BAR_HEIGHT).toBe(44);
        expect(getFloatingActionBarBottomOffset(34)).toBe(42);
    });

    test("reserves the full button area and a small content gap", () => {
        expect(getFloatingActionBarClearance(34)).toBe(94);
        expect(getFloatingActionBarClearance(0)).toBe(70);
    });
});

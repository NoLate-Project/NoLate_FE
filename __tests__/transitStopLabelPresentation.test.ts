import {
    getTransitBoardingDirectionHint,
    getTransitBoardingLabelPresentation,
} from "../src/modules/map/transitStopLabelPresentation";

describe("transitStopLabelPresentation", () => {
    it("uses a provider direction before deriving one from stop order", () => {
        expect(getTransitBoardingDirectionHint({
            directionName: "외선순환",
            startName: "사당역",
            passStops: [{ name: "사당역" }, { name: "방배역" }],
        })).toBe("외선순환");
    });

    it.each([
        ["남성시장", "남성시장 방향"],
        ["숭례문남산방향", "숭례문남산방향"],
        ["남산 방면", "남산 방면"],
        ["한국은행", "한국은행 방향"],
    ])("derives the boarding direction from the next stop %s", (name, expected) => {
        expect(getTransitBoardingDirectionHint({
            startName: "남성역",
            endName: "사당역",
            passStops: [
                { name: "남성역" },
                { name },
                { name: "사당역" },
            ],
        })).toBe(expected);
    });

    it("does not present the alighting stop as a vehicle headsign", () => {
        expect(getTransitBoardingDirectionHint({
            startName: "서울역",
            endName: "강남역",
        })).toBe("강남역까지");
    });

    it("builds the two-line boarding context used by the map label", () => {
        expect(getTransitBoardingLabelPresentation({
            startName: "서울역",
            endName: "사당역",
            passStops: [{ name: "서울역" }, { name: "숙대입구역" }],
        }, "4호선")).toEqual({
            primary: "4호선 · 서울역",
            secondary: "숙대입구역 방향",
        });
    });
});

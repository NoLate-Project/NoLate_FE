import {
    IOS_ROUTE_DETAIL_INTERSTITIAL_AD_UNIT_ID,
    resolveProductionRouteDetailAdUnitId,
} from "../src/modules/advertising/adMobAdUnits";

describe("production AdMob ad units", () => {
    it("uses the published NoLate iOS interstitial without external env injection", () => {
        expect(resolveProductionRouteDetailAdUnitId("ios")).toBe(
            "ca-app-pub-6334753209593250/7417557605",
        );
        expect(IOS_ROUTE_DETAIL_INTERSTITIAL_AD_UNIT_ID).toMatch(
            /^ca-app-pub-\d{16}\/\d{10}$/,
        );
    });

    it("accepts only slash-formatted Android ad unit IDs", () => {
        expect(
            resolveProductionRouteDetailAdUnitId(
                "android",
                "  ca-app-pub-1234567890123456/1234567890  ",
            ),
        ).toBe("ca-app-pub-1234567890123456/1234567890");
        expect(
            resolveProductionRouteDetailAdUnitId(
                "android",
                "ca-app-pub-1234567890123456~1234567890",
            ),
        ).toBeUndefined();
    });

    it("does not resolve an ad unit on unsupported platforms", () => {
        expect(resolveProductionRouteDetailAdUnitId("web")).toBeUndefined();
    });
});

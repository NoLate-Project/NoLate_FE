import {
    isRouteDetailEntryRequested,
    ROUTE_DETAIL_ENTRY_VALUE,
} from "../src/modules/schedule/routeDetailNavigation";

describe("schedule route-detail notification entry", () => {
    it("accepts only the explicit one-shot route-detail value", () => {
        expect(isRouteDetailEntryRequested(ROUTE_DETAIL_ENTRY_VALUE)).toBe(true);
        expect(isRouteDetailEntryRequested(["0", ROUTE_DETAIL_ENTRY_VALUE])).toBe(true);
        expect(isRouteDetailEntryRequested("true")).toBe(false);
        expect(isRouteDetailEntryRequested(undefined)).toBe(false);
    });
});

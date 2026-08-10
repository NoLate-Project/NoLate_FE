import {
    ROUTE_DETAIL_AD_COOLDOWN_MS,
    createRouteDetailAdFrequencyState,
    parseRouteDetailAdFrequencyState,
    recordRouteDetailAdShown,
    registerRouteDetailEntry,
} from "../src/modules/advertising/routeDetailAdFrequency";

describe("route detail ad frequency", () => {
    const now = new Date(2026, 7, 10, 12, 0, 0).getTime();

    test("the third route detail entry becomes eligible", () => {
        let state = createRouteDetailAdFrequencyState(now);

        const first = registerRouteDetailEntry(state, now);
        state = first.state;
        const second = registerRouteDetailEntry(state, now + 1);
        state = second.state;
        const third = registerRouteDetailEntry(state, now + 2);

        expect(first.eligible).toBe(false);
        expect(second.eligible).toBe(false);
        expect(third.eligible).toBe(true);
    });

    test("a shown ad resets entries and enforces the cooldown", () => {
        let state = createRouteDetailAdFrequencyState(now);
        state = registerRouteDetailEntry(state, now).state;
        state = registerRouteDetailEntry(state, now + 1).state;
        state = registerRouteDetailEntry(state, now + 2).state;
        state = recordRouteDetailAdShown(state, now + 3);

        state = registerRouteDetailEntry(state, now + 4).state;
        state = registerRouteDetailEntry(state, now + 5).state;
        const duringCooldown = registerRouteDetailEntry(state, now + 6);
        const afterCooldown = registerRouteDetailEntry(
            duringCooldown.state,
            now + 3 + ROUTE_DETAIL_AD_COOLDOWN_MS,
        );

        expect(duringCooldown.eligible).toBe(false);
        expect(afterCooldown.eligible).toBe(true);
    });

    test("no more than two ads are eligible per local day", () => {
        let state = createRouteDetailAdFrequencyState(now);
        state = { ...state, entriesSinceLastAd: 2 };
        state = registerRouteDetailEntry(state, now).state;
        state = recordRouteDetailAdShown(state, now);
        state = { ...state, entriesSinceLastAd: 2 };
        state = recordRouteDetailAdShown(state, now + ROUTE_DETAIL_AD_COOLDOWN_MS);

        const capped = registerRouteDetailEntry(
            { ...state, entriesSinceLastAd: 2 },
            now + (ROUTE_DETAIL_AD_COOLDOWN_MS * 2),
        );

        expect(capped.eligible).toBe(false);
        expect(capped.state.shownToday).toBe(2);
    });

    test("a new local day resets only the daily count", () => {
        const previous = JSON.stringify({
            dayKey: "2026-08-09",
            entriesSinceLastAd: 2,
            shownToday: 2,
            lastShownAtMs: now - ROUTE_DETAIL_AD_COOLDOWN_MS,
        });

        const state = parseRouteDetailAdFrequencyState(previous, now);
        const decision = registerRouteDetailEntry(state, now);

        expect(state.shownToday).toBe(0);
        expect(decision.eligible).toBe(true);
    });
});

jest.mock("../src/api/env", () => ({ getEnv: jest.fn() }));

import { parseTransitOptionsFromTmap } from "../src/modules/map/tmapRouteProviders";
import type { RouteAlternativeOption } from "../src/modules/map/tmapApi";
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute } from "../src/modules/schedule/routeInfo";
import { normalizeRouteAlternativeToSegments } from "../src/modules/schedule/routePlanner/routeTransitGeometryBuilder";
import { buildRouteInfoFromNormalizedRoute } from "../src/modules/schedule/routePlanner/routePlannerRouteInfo";

// Synthetic seconds reproduce the observed 2+49+5+9+3 minute labels without
// claiming these are the real provider's unrecorded sectionTime values.
const sectionSeconds = [75, 2890, 250, 515, 170];
const origin = { name: "출발", lat: 37.65, lng: 127.06 };
const destination = { name: "도착", lat: 37.48, lng: 126.93 };
const departureAt = new Date("2026-10-04T13:00:00+09:00");

function parsedRoute(totalTime: unknown = 3900, sections: unknown[] = sectionSeconds): RouteAlternativeOption {
    const [option] = parseTransitOptionsFromTmap({ metaData: { plan: { itineraries: [{
        totalTime,
        legs: sections.map((sectionTime, index) => ({
            mode: index % 2 ? "SUBWAY" : "WALK",
            sectionTime,
            route: index === 1 ? "수도권4호선" : "수도권2호선",
            passShape: {
                linestring: `${127.06 - index * 0.026},${37.65 - index * 0.034} ${127.06 - (index + 1) * 0.026},${37.65 - (index + 1) * 0.034}`,
            },
        })),
    }] } } });
    return { ...option, mode: "TRANSIT" };
}

describe("transit duration precision", () => {
    test("preserves seconds through parsing, normalization and stored route info without changing the 65 minute total", () => {
        const option = parsedRoute();
        expect(option.minutes).toBe(65);
        expect(option.totalDurationSeconds).toBe(3900);
        expect(option.transitLegs?.map(leg => leg.durationMinutes)).toEqual([2, 49, 5, 9, 3]);
        expect(option.transitLegs?.map(leg => leg.durationSeconds)).toEqual(sectionSeconds);

        const base = buildRouteInfoFromAlternative(option, origin, destination, departureAt);
        const normalized = normalizeRouteAlternativeToSegments(option)!;
        expect(normalized.totalDurationSeconds).toBe(3900);
        expect(normalized.segments.map(segment => segment.durationSeconds)).toEqual(sectionSeconds);
        const routeInfo = buildRouteInfoFromNormalizedRoute(base, normalized);
        expect(routeInfo.totalDurationMinutes).toBe(65);
        expect(routeInfo.totalDurationSeconds).toBe(3900);
        expect(routeInfo.steps.filter(step => step.id.startsWith("leg-")).map(step => step.durationSeconds))
            .toEqual(sectionSeconds);
        expect(routeInfo.arrivalTime).toBe(new Date("2026-10-04T14:05:00+09:00").toISOString());
        const stored = getRouteInfoFromRoute(JSON.parse(JSON.stringify({ routeInfo })))!;
        expect(stored.totalDurationSeconds).toBe(3900);
        expect(stored.steps.slice(1, -1).map(step => step.durationSeconds)).toEqual(sectionSeconds);
    });

    test("preserves provider total and segment seconds independently when their raw values differ", () => {
        const option = parsedRoute(3850);
        const base = buildRouteInfoFromAlternative(option, origin, destination, departureAt);
        const routeInfo = buildRouteInfoFromNormalizedRoute(base, normalizeRouteAlternativeToSegments(option));

        expect(routeInfo.totalDurationMinutes).toBe(65);
        expect(routeInfo.totalDurationSeconds).toBe(3850);
        expect(routeInfo.steps.reduce((sum, step) => sum + (step.durationSeconds ?? 0), 0)).toBe(3900);
        expect(routeInfo.arrivalTime).toBe(new Date("2026-10-04T14:04:10+09:00").toISOString());
    });

    test("keeps zero-second walks and sub-minute sections exact instead of creating a minute for arithmetic", () => {
        const option = parsedRoute(61, [0, 60.5, 0.5, 0]);
        const routeInfo = buildRouteInfoFromAlternative(option, origin, destination, departureAt);
        expect(routeInfo.totalDurationMinutes).toBe(2);
        expect(routeInfo.totalDurationSeconds).toBe(61);
        expect(routeInfo.steps.slice(1, -1).map(step => step.durationSeconds)).toEqual([0, 60.5, 0.5, 0]);
        expect(routeInfo.arrivalTime).toBe(new Date("2026-10-04T13:01:01+09:00").toISOString());
    });

    test.each([undefined, null, "", " ", -1, Infinity, "invalid"])(
        "does not preserve invalid section seconds %p as exact evidence", (value) => {
            expect(parsedRoute(60, [value]).transitLegs?.[0].durationSeconds).toBeUndefined();
        }
    );

    test.each([0, -1, Infinity, Number.MAX_VALUE, 8_640_000_000_000])(
        "rejects nonpositive or overflowing provider totalTime %p", totalTime => {
            expect(parseTransitOptionsFromTmap({ metaData: { plan: { itineraries: [{ totalTime }] } } }))
                .toEqual([]);
        }
    );

    test.each([0, -1, Infinity, Number.MAX_VALUE, 8_640_000_000_000])(
        "uses legacy minutes without reintroducing invalid raw total %p into fallback steps", totalDurationSeconds => {
            const option = { ...parsedRoute(), minutes: 5, totalDurationSeconds, transitLegs: undefined };
            const base = buildRouteInfoFromAlternative(option, origin, destination, departureAt);
            const normalized = normalizeRouteAlternativeToSegments(option)!;
            const info = buildRouteInfoFromNormalizedRoute(base, normalized);
            expect(normalized.totalDurationSeconds).toBeUndefined();
            expect(normalized.segments[0].durationSeconds).toBeUndefined();
            expect(info.totalDurationSeconds).toBeUndefined();
            expect(info.steps.slice(1, -1).map(step => step.durationSeconds)).toEqual([undefined]);
            expect(info.arrivalTime).toBe(new Date("2026-10-04T13:05:00+09:00").toISOString());
        }
    );

    test("rejects raw seconds that overflow the actual departure date even if valid near today's date", () => {
        const option = { ...parsedRoute(), minutes: 1, totalDurationSeconds: 3600 };
        const departureNearLimit = new Date(8_640_000_000_000_000 - 120_000);
        const base = buildRouteInfoFromAlternative(option, origin, destination, departureNearLimit);
        const info = buildRouteInfoFromNormalizedRoute(base, normalizeRouteAlternativeToSegments(option));
        expect(info.totalDurationSeconds).toBeUndefined();
        expect(info.arrivalTime).toBe(new Date(departureNearLimit.getTime() + 60_000).toISOString());
    });

    test("preserves legacy minute-only options through the same route paths", () => {
        const option = parsedRoute();
        delete option.totalDurationSeconds;
        option.transitLegs?.forEach(leg => { delete leg.durationSeconds; });
        const base = buildRouteInfoFromAlternative(option, origin, destination, departureAt);
        const routeInfo = buildRouteInfoFromNormalizedRoute(base, normalizeRouteAlternativeToSegments(option));

        expect(routeInfo.totalDurationSeconds).toBeUndefined();
        expect(routeInfo.totalDurationMinutes).toBe(65);
        expect(routeInfo.steps.every(step => step.durationSeconds === undefined)).toBe(true);
        expect(routeInfo.arrivalTime).toBe(new Date("2026-10-04T14:05:00+09:00").toISOString());
    });
});

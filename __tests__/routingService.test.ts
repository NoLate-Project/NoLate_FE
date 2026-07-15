import { getRouteAlternativeOptions as getLegacyRouteAlternativeOptions } from "../src/modules/map/tmapApi";
import {
    getRouteAlternativeOptions,
    invalidateRouteSearch,
} from "../src/modules/map/routingService";
import type { Place } from "../src/modules/schedule/types";

jest.mock("../src/modules/map/tmapApi", () => ({
    getRouteAlternativeOptions: jest.fn(),
    reverseGeocodeToAddress: jest.fn(),
    searchAddressByKeyword: jest.fn(),
}));

const mockedLegacyRouteSearch = jest.mocked(getLegacyRouteAlternativeOptions);

const origin: Place = { name: "서울시청", lat: 37.56661, lng: 126.978388 };
const destination: Place = { name: "강남역", lat: 37.497942, lng: 127.027621 };

describe("routingService", () => {
    beforeEach(() => {
        mockedLegacyRouteSearch.mockReset();
        invalidateRouteSearch(origin, destination, "CAR");
        invalidateRouteSearch(origin, destination, "TRANSIT");
        invalidateRouteSearch(origin, destination, "WALK");
        invalidateRouteSearch(origin, destination, "BIKE");
    });

    test("returns only a renderable provider route with quality metadata", async () => {
        mockedLegacyRouteSearch.mockResolvedValue([
            {
                id: "car-api-0",
                mode: "CAR",
                minutes: 21,
                distanceMeters: 10_000,
                source: "api",
                pathCoords: [
                    { lat: 37.56661, lng: 126.978388 },
                    { lat: 37.497942, lng: 127.027621 },
                ],
            },
        ]);

        const result = await getRouteAlternativeOptions(origin, destination, "CAR");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            provider: "tmap",
            routeReliability: "live_provider",
            routeQualityLabel: "TMAP 실경로",
        });
    });

    test("reuses the same route search briefly and supports explicit refresh", async () => {
        mockedLegacyRouteSearch.mockResolvedValue([
            {
                id: "walk-api-0",
                mode: "WALK",
                minutes: 12,
                distanceMeters: 830,
                source: "api",
                provider: "tmap",
                pathCoords: [
                    { lat: 37.56661, lng: 126.978388 },
                    { lat: 37.497942, lng: 127.027621 },
                ],
            },
        ]);

        await getRouteAlternativeOptions(origin, destination, "WALK");
        await getRouteAlternativeOptions(origin, destination, "WALK");
        expect(mockedLegacyRouteSearch).toHaveBeenCalledTimes(1);

        await getRouteAlternativeOptions(origin, destination, "WALK", { forceRefresh: true });
        expect(mockedLegacyRouteSearch).toHaveBeenCalledTimes(2);
    });

    test("does not expose estimated road or straight-line data as a route", async () => {
        mockedLegacyRouteSearch.mockResolvedValue([
            {
                id: "transit-road-fallback",
                mode: "TRANSIT",
                minutes: 30,
                source: "fallback",
                fallbackKind: "road",
                pathCoords: [
                    { lat: 37.56661, lng: 126.978388 },
                    { lat: 37.497942, lng: 127.027621 },
                ],
            },
        ]);

        await expect(getRouteAlternativeOptions(origin, destination, "TRANSIT")).rejects.toMatchObject({
            code: "NO_PROVIDER_ROUTE",
        });
    });

    test("accepts a dedicated OpenStreetMap bicycle route", async () => {
        mockedLegacyRouteSearch.mockResolvedValue([
            {
                id: "openstreetmap-bike-0",
                mode: "BIKE",
                minutes: 46,
                distanceMeters: 11_114,
                source: "api",
                provider: "openstreetmap",
                pathCoords: [
                    { lat: 37.56661, lng: 126.978388 },
                    { lat: 37.497942, lng: 127.027621 },
                ],
            },
        ]);

        const result = await getRouteAlternativeOptions(origin, destination, "BIKE");

        expect(result[0]).toMatchObject({
            provider: "openstreetmap",
            routeReliability: "provider_estimate",
            routeQualityLabel: "OpenStreetMap 자전거 경로",
        });
    });

    test("marks an extreme transit geometry result instead of presenting it as verified", async () => {
        mockedLegacyRouteSearch.mockResolvedValue([{
            id: "transit-long-loop",
            mode: "TRANSIT",
            minutes: 58,
            distanceMeters: 50_000,
            source: "api",
            provider: "tmap",
            pathCoords: [
                { lat: origin.lat!, lng: origin.lng! },
                { lat: destination.lat!, lng: destination.lng! },
            ],
        }]);

        const result = await getRouteAlternativeOptions(origin, destination, "TRANSIT", {
            searchFutureService: false,
        });

        expect(result[0]).toMatchObject({
            routeReliability: "provider_estimate",
            routePlausibility: "geometry_suspected",
            routeQualityLabel: expect.stringContaining("좌표 검증 필요"),
        });
    });

    test("keeps an ended route with a clear warning when every transit option has service=0", async () => {
        mockedLegacyRouteSearch.mockResolvedValue([{
            id: "transit-not-operating",
            mode: "TRANSIT",
            minutes: 40,
            distanceMeters: 9_000,
            source: "api",
            provider: "tmap",
            pathCoords: [
                { lat: origin.lat!, lng: origin.lng! },
                { lat: destination.lat!, lng: destination.lng! },
            ],
            transitLegs: [{
                kind: "SUBWAY",
                label: "2호선",
                serviceAvailable: false,
            }],
        }]);

        const result = await getRouteAlternativeOptions(origin, destination, "TRANSIT", {
            searchFutureService: false,
        });

        expect(result[0]).toMatchObject({
            id: "transit-not-operating",
            routeReliability: "provider_estimate",
            routeQualityLabel: "TMAP 경로 · 현재 운행 종료",
            routeQualityNotice: expect.stringContaining("현재 운행하지"),
            transitServiceState: "not_operating",
        });
    });

    test("replaces ended routes with the nearest future operating service", async () => {
        const route = (id: string, serviceAvailable: boolean) => ({
            id,
            mode: "TRANSIT" as const,
            minutes: 34,
            distanceMeters: 9_000,
            source: "api" as const,
            provider: "tmap" as const,
            pathCoords: [
                { lat: origin.lat!, lng: origin.lng! },
                { lat: destination.lat!, lng: destination.lng! },
            ],
            transitLegs: [{
                kind: "BUS" as const,
                label: "401",
                serviceAvailable,
            }],
        });
        mockedLegacyRouteSearch
            .mockResolvedValueOnce([route("ended-now", false)])
            .mockResolvedValueOnce([route("operating-later", true)]);

        const result = await getRouteAlternativeOptions(origin, destination, "TRANSIT", {
            departureAt: new Date("2026-07-13T18:04:00.000Z"),
            forceRefresh: true,
        });

        expect(mockedLegacyRouteSearch).toHaveBeenCalledTimes(2);
        expect(mockedLegacyRouteSearch.mock.calls[1]?.[3]?.departureAt?.toISOString())
            .toBe("2026-07-13T18:30:00.000Z");
        expect(result[0]).toMatchObject({
            id: "operating-later",
            transitServiceState: "operating",
            transitDepartureAt: "2026-07-13T18:30:00.000Z",
            transitDepartureTimeSource: "next_service_search",
        });
    });

    test("prefers an operating route and hides service=0 alternatives", async () => {
        const route = (id: string, serviceAvailable: boolean) => ({
            id,
            mode: "TRANSIT" as const,
            minutes: 40,
            distanceMeters: 9_000,
            source: "api" as const,
            provider: "tmap" as const,
            pathCoords: [
                { lat: origin.lat!, lng: origin.lng! },
                { lat: destination.lat!, lng: destination.lng! },
            ],
            transitLegs: [{
                kind: "SUBWAY" as const,
                label: "2호선",
                serviceAvailable,
            }],
        });
        mockedLegacyRouteSearch.mockResolvedValue([
            route("ended", false),
            route("operating", true),
        ]);

        const result = await getRouteAlternativeOptions(origin, destination, "TRANSIT");

        expect(result.map((option) => option.id)).toEqual(["operating"]);
    });

    test("rejects effectively identical endpoints", async () => {
        await expect(getRouteAlternativeOptions(origin, { ...origin }, "CAR")).rejects.toMatchObject({
            code: "SAME_ENDPOINT",
        });
        expect(mockedLegacyRouteSearch).not.toHaveBeenCalled();
    });

    test("provider connection failures are distinct from an empty route result", async () => {
        mockedLegacyRouteSearch.mockRejectedValue(new Error("timeout"));

        await expect(getRouteAlternativeOptions(origin, destination, "CAR")).rejects.toMatchObject({
            code: "PROVIDER_UNAVAILABLE",
            message: expect.stringContaining("경로 서버에 연결하지 못했습니다"),
        });
    });
});

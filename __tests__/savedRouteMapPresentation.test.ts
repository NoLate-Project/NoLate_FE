import {
    buildSavedRouteMapPresentation,
    getSavedRouteFitCoords,
} from "../src/modules/map/savedRouteMapPresentation";
import type { RouteAlternativeOption } from "../src/modules/map/routingService";

const origin = { name: "출발지", lat: 37.56, lng: 126.97 };
const destination = { name: "도착지", lat: 37.5, lng: 127.03 };

const transitRoute: RouteAlternativeOption = {
    id: "saved-transit-route",
    mode: "TRANSIT",
    minutes: 31,
    source: "api",
    pathCoords: [
        { lat: 37.56, lng: 126.97 },
        { lat: 37.555, lng: 126.975 },
        { lat: 37.53, lng: 127.0 },
        { lat: 37.5, lng: 127.03 },
    ],
    transitLegs: [
        {
            kind: "WALK",
            label: "승차 지점까지 도보",
            startName: "출발지",
            endName: "시청역",
            startCoord: { lat: 37.56, lng: 126.97 },
            endCoord: { lat: 37.555, lng: 126.975 },
            pathCoords: [
                { lat: 37.56, lng: 126.97 },
                { lat: 37.557, lng: 126.973 },
                { lat: 37.555, lng: 126.975 },
            ],
        },
        {
            kind: "SUBWAY",
            label: "2호선",
            lineName: "2호선",
            lineColor: "00B140",
            startName: "시청역",
            endName: "강남역",
            startCoord: { lat: 37.555, lng: 126.975 },
            endCoord: { lat: 37.5, lng: 127.03 },
            pathCoords: [
                { lat: 37.555, lng: 126.975 },
                { lat: 37.54, lng: 126.99 },
                { lat: 37.52, lng: 127.01 },
                { lat: 37.5, lng: 127.03 },
            ],
            passStops: [
                { name: "시청역", coord: { lat: 37.555, lng: 126.975 } },
                { name: "을지로입구역", coord: { lat: 37.545, lng: 126.985 } },
                { name: "을지로3가역", coord: { lat: 37.535, lng: 126.995 } },
                { name: "교대역", coord: { lat: 37.51, lng: 127.02 } },
                { name: "강남역", coord: { lat: 37.5, lng: 127.03 } },
            ],
        },
    ],
};

describe("saved route map presentation", () => {
    it("uses the current native line policy for saved transit routes", () => {
        const presentation = buildSavedRouteMapPresentation({
            route: transitRoute,
            origin,
            destination,
            mapZoom: 12,
            isDark: false,
        });
        const walk = presentation.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-0");
        const subway = presentation.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-1");

        expect(walk).toMatchObject({
            color: "#1A73E8",
            width: 5.2,
            strokeStyle: "dash",
            renderMode: "native",
            nativeDirection: false,
            showDirection: false,
        });
        expect(walk?.dashPattern).toEqual([8, 7.2]);
        expect(subway).toMatchObject({
            color: "#00B140",
            width: 8.4,
            strokeStyle: "solid",
            renderMode: "native",
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
        });
    });

    it("changes marker density by zoom without changing route stroke proportions", () => {
        const overview = buildSavedRouteMapPresentation({
            route: transitRoute,
            origin,
            destination,
            mapZoom: 12,
            isDark: false,
        });
        const detail = buildSavedRouteMapPresentation({
            route: transitRoute,
            origin,
            destination,
            mapZoom: 17,
            isDark: false,
        });

        expect(overview.markers.some((marker) => marker.id.startsWith("saved-transit-route-label-"))).toBe(true);
        expect(overview.markers.some((marker) => marker.id.startsWith("saved-transit-stop-"))).toBe(false);
        expect(detail.markers.some((marker) => marker.id.startsWith("saved-transit-route-label-"))).toBe(false);
        expect(detail.markers.some((marker) => marker.id.startsWith("saved-transit-stop-"))).toBe(true);
        expect(detail.markers.some((marker) => marker.badgeVariant === "context")).toBe(true);
        expect(overview.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-1")?.width).toBe(8.4);
        expect(detail.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-1")?.width).toBe(8.4);
        expect(overview.markers.find((marker) => marker.id === "origin")?.markerScale).toBe(0.84);
        expect(detail.markers.find((marker) => marker.id === "origin")?.markerScale).toBe(1);
    });

    it("drops legacy screen-space layers and rebuilds the native route", () => {
        const route = {
            ...transitRoute,
            storedPathOverlays: [{
                id: "legacy-screen-arrows",
                renderMode: "screen",
                coords: transitRoute.pathCoords,
            }],
        };
        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: true,
        });

        expect(presentation.pathOverlays.some((overlay) => overlay.id === "legacy-screen-arrows")).toBe(false);
        expect(presentation.pathOverlays.some((overlay) => overlay.id === "saved-route-leg-1")).toBe(true);
    });

    it("keeps camera bounds independent from zoom-dependent marker layers", () => {
        const first = getSavedRouteFitCoords(transitRoute, origin, destination);
        const second = getSavedRouteFitCoords(transitRoute, origin, destination);

        expect(first).toEqual(second);
        expect(first).toContainEqual({ latitude: origin.lat, longitude: origin.lng });
        expect(first).toContainEqual({ latitude: destination.lat, longitude: destination.lng });
    });

    it("shares the stop-label budget across multiple ride legs", () => {
        const transitLegs = Array.from({ length: 3 }, (_, legIndex) => {
            const pathCoords = Array.from({ length: 8 }, (_, stopIndex) => ({
                lat: 37.48 + (legIndex * 0.03),
                lng: 126.9 + (stopIndex * 0.004),
            }));
            return {
                kind: "BUS" as const,
                label: `${legIndex + 1}00번`,
                lineName: `${legIndex + 1}00번`,
                startName: `승차 ${legIndex + 1}`,
                endName: `하차 ${legIndex + 1}`,
                startCoord: pathCoords[0],
                endCoord: pathCoords[pathCoords.length - 1],
                pathCoords,
                passStops: pathCoords.map((coord, stopIndex) => ({
                    name: `정류장 ${legIndex + 1}-${stopIndex + 1}`,
                    coord,
                })),
            };
        });
        const route: RouteAlternativeOption = {
            id: "multi-bus-route",
            mode: "TRANSIT",
            minutes: 48,
            source: "api",
            pathCoords: transitLegs.flatMap((leg) => leg.pathCoords),
            transitLegs,
        };
        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 17,
            isDark: false,
        });
        const stopLabels = presentation.markers.filter((marker) => (
            marker.id.startsWith("saved-transit-stop-") && marker.badgeVariant === "stop"
        ));

        expect(stopLabels).toHaveLength(8);
    });
});

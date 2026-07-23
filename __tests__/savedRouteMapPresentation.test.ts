import {
    buildSavedRouteMapPresentation,
    getSavedRouteFitCoords,
    getSavedRouteOverviewFitKey,
    getSavedTransitLegBoardCoord,
    getStoredRouteOverlayGeometryProvenance,
    hasRenderableSavedRouteGeometry,
    resolveDetailedWalkGeometrySource,
} from "../src/modules/map/savedRouteMapPresentation";
import type { RouteAlternativeOption, TransitLegDetail } from "../src/modules/map/routingService";

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
    it("repairs legacy saved ODsay WALK tails and keeps every marker on the adopted path", () => {
        const legacyOrigin = { name: "출발", lat: 37.5, lng: 127.0 };
        const firstRepeatStart = { lat: 37.5, lng: 127.0001 };
        const firstRepeatEnd = { lat: 37.5, lng: 127.0002 };
        const firstRideStart = { lat: 37.5, lng: 127.0005 };
        const firstInner = { lat: 37.5001, lng: 127.0003 };
        const firstRideEnd = { lat: 37.51, lng: 127.01 };
        const transferRepeatStart = { lat: 37.5101, lng: 127.0101 };
        const transferRepeatEnd = { lat: 37.5102, lng: 127.0102 };
        const secondRideStart = { lat: 37.5105, lng: 127.0105 };
        const transferInner = { lat: 37.5103, lng: 127.0104 };
        const secondRideEnd = { lat: 37.52, lng: 127.02 };
        const finalRepeatStart = { lat: 37.5201, lng: 127.0201 };
        const finalRepeatEnd = { lat: 37.5202, lng: 127.0202 };
        const legacyDestination = { name: "도착", lat: 37.5205, lng: 127.0205 };
        const finalInner = { lat: 37.5203, lng: 127.0204 };
        const legacyRoute: RouteAlternativeOption = {
            id: "legacy-odsay-saved",
            mode: "TRANSIT",
            minutes: 29,
            source: "api",
            provider: "odsay",
            pathCoords: [legacyOrigin, legacyDestination],
            transitLegs: [
                {
                    kind: "WALK",
                    label: "첫 도보",
                    distanceMeters: 0,
                    pathGeometrySource: "WALK_STEPS_LINESTRING",
                    startCoord: legacyOrigin,
                    endCoord: firstRepeatEnd,
                    pathCoords: [
                        legacyOrigin,
                        firstRepeatStart,
                        firstRepeatEnd,
                        firstRideStart,
                        firstRepeatStart,
                        firstInner,
                        firstRepeatEnd,
                    ],
                },
                {
                    kind: "SUBWAY",
                    label: "5호선",
                    lineName: "5호선",
                    startCoord: firstRideStart,
                    endCoord: firstRideEnd,
                    pathCoords: [firstRideStart, firstRideEnd],
                },
                {
                    kind: "WALK",
                    label: "환승 도보",
                    distanceMeters: 90,
                    pathGeometrySource: "WALK_STEPS_LINESTRING",
                    startCoord: firstRideEnd,
                    endCoord: transferRepeatEnd,
                    pathCoords: [
                        firstRideEnd,
                        transferRepeatStart,
                        transferRepeatEnd,
                        secondRideStart,
                        transferRepeatStart,
                        transferInner,
                        transferRepeatEnd,
                    ],
                },
                {
                    kind: "SUBWAY",
                    label: "8호선",
                    lineName: "8호선",
                    startCoord: secondRideStart,
                    endCoord: secondRideEnd,
                    pathCoords: [secondRideStart, secondRideEnd],
                },
                {
                    kind: "WALK",
                    label: "마지막 도보",
                    distanceMeters: 90,
                    pathGeometrySource: "WALK_STEPS_LINESTRING",
                    startCoord: secondRideEnd,
                    endCoord: finalRepeatEnd,
                    pathCoords: [
                        secondRideEnd,
                        finalRepeatStart,
                        finalRepeatEnd,
                        legacyDestination,
                        finalRepeatStart,
                        finalInner,
                        finalRepeatEnd,
                    ],
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route: legacyRoute,
            origin: legacyOrigin,
            destination: legacyDestination,
            mapZoom: 17,
            isDark: false,
        });

        expect(presentation.routeLegs[0].pathCoords).toEqual([
            { lat: legacyOrigin.lat, lng: legacyOrigin.lng },
            firstRepeatStart,
            firstInner,
            firstRepeatEnd,
            firstRideStart,
        ]);
        expect(presentation.routeLegs[0].startCoord).toEqual({
            lat: legacyOrigin.lat,
            lng: legacyOrigin.lng,
        });
        expect(presentation.routeLegs[0].endCoord).toEqual(firstRideStart);
        expect(presentation.routeLegs[2].pathCoords?.at(-1)).toEqual(secondRideStart);
        expect(presentation.routeLegs[4].pathCoords?.at(-1)).toEqual({
            lat: legacyDestination.lat,
            lng: legacyDestination.lng,
        });
        expect(presentation.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-0")?.coords.at(-1))
            .toEqual({ latitude: firstRideStart.lat, longitude: firstRideStart.lng });
        expect(presentation.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-4")?.coords.at(-1))
            .toEqual({ latitude: legacyDestination.lat, longitude: legacyDestination.lng });
        expect(presentation.markers.find((marker) => (
            marker.id === "saved-transit-event-legacy-odsay-saved-1-board-node"
        ))).toMatchObject({
            latitude: firstRideStart.lat,
            longitude: firstRideStart.lng,
        });
        expect(presentation.markers.find((marker) => (
            marker.id === "saved-transit-event-legacy-odsay-saved-3-transfer-node"
        ))).toMatchObject({
            latitude: secondRideStart.lat,
            longitude: secondRideStart.lng,
        });
        expect(presentation.routeOption?.pathCoords?.at(-1)).toEqual({
            lat: legacyDestination.lat,
            lng: legacyDestination.lng,
        });
    });

    it("leaves a healthy current ODsay WALK untouched when geometryRevision is absent", () => {
        const start = { name: "출발", lat: 37.5, lng: 127.0 };
        const walkEnd = { lat: 37.5, lng: 127.0002 };
        const rideStart = { lat: 37.5, lng: 127.0003 };
        const healthyPath = [start, walkEnd];
        const route: RouteAlternativeOption = {
            id: "current-odsay-without-revision",
            mode: "TRANSIT",
            minutes: 10,
            source: "api",
            provider: "odsay",
            transitLegs: [{
                kind: "WALK",
                label: "도보",
                distanceMeters: 18,
                pathGeometrySource: "WALK_STEPS_LINESTRING",
                pathCoords: healthyPath,
            }, {
                kind: "SUBWAY",
                label: "5호선",
                startCoord: rideStart,
                endCoord: { lat: 37.51, lng: 127.01 },
                pathCoords: [rideStart, { lat: 37.51, lng: 127.01 }],
            }],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin: start,
            mapZoom: 17,
            isDark: false,
        });

        expect(presentation.routeLegs).toBe(route.transitLegs);
        expect(presentation.routeLegs[0].pathCoords).toBe(healthyPath);
        expect(presentation.routeLegs[0].pathCoords?.at(-1)).toBe(walkEnd);
    });

    it("ignores a malformed stored WALK overlay after repairing the legacy leg", () => {
        const start = { name: "출발", lat: 37.5, lng: 127.0 };
        const repeatedStart = { lat: 37.5, lng: 127.0001 };
        const repeatedEnd = { lat: 37.5, lng: 127.0002 };
        const rideStart = { lat: 37.5, lng: 127.0005 };
        const inner = { lat: 37.5001, lng: 127.0003 };
        const legacyPath = [
            start,
            repeatedStart,
            repeatedEnd,
            rideStart,
            repeatedStart,
            inner,
            repeatedEnd,
        ];
        const route: RouteAlternativeOption = {
            id: "legacy-odsay-with-overlay",
            mode: "TRANSIT",
            minutes: 10,
            source: "api",
            provider: "odsay",
            storedPathOverlays: [{
                id: "persisted-legacy-walk",
                coords: legacyPath.map((coord) => ({
                    latitude: coord.lat,
                    longitude: coord.lng,
                })),
                geometrySource: "WALK_STEPS_LINESTRING",
                transitLegIndex: 0,
            }],
            transitLegs: [{
                kind: "WALK",
                label: "도보",
                distanceMeters: 0,
                pathGeometrySource: "WALK_STEPS_LINESTRING",
                pathCoords: legacyPath,
            }, {
                kind: "SUBWAY",
                label: "5호선",
                startCoord: rideStart,
                endCoord: { lat: 37.51, lng: 127.01 },
                pathCoords: [rideStart, { lat: 37.51, lng: 127.01 }],
            }],
        } as RouteAlternativeOption;

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin: start,
            mapZoom: 17,
            isDark: false,
        });
        const walkOverlay = presentation.pathOverlays.find((overlay) => (
            overlay.id === "saved-route-leg-0"
        ));

        expect(walkOverlay?.coords).toEqual(presentation.routeLegs[0].pathCoords?.map((coord) => ({
            latitude: coord.lat,
            longitude: coord.lng,
        })));
        expect(presentation.pathOverlays.some((overlay) => (
            overlay.id === "persisted-legacy-walk"
        ))).toBe(false);
    });

    it("does not migrate non-ODsay or revision-2 saved WALK geometry", () => {
        const start = { name: "출발", lat: 37.5, lng: 127.0 };
        const repeatStart = { lat: 37.5, lng: 127.0001 };
        const repeatEnd = { lat: 37.5, lng: 127.0002 };
        const rideStart = { lat: 37.5, lng: 127.0005 };
        const legacyPath = [start, repeatStart, repeatEnd, rideStart, repeatStart, repeatEnd];
        const baseRoute = {
            id: "migration-gate",
            mode: "TRANSIT" as const,
            minutes: 10,
            source: "api" as const,
            provider: "odsay" as const,
            transitLegs: [{
                kind: "WALK" as const,
                label: "도보",
                distanceMeters: 50,
                pathGeometrySource: "WALK_STEPS_LINESTRING" as const,
                pathCoords: legacyPath,
            }, {
                kind: "SUBWAY" as const,
                label: "5호선",
                startCoord: rideStart,
                endCoord: { lat: 37.51, lng: 127.01 },
                pathCoords: [rideStart, { lat: 37.51, lng: 127.01 }],
            }],
        };

        const nonOdsay = buildSavedRouteMapPresentation({
            route: { ...baseRoute, provider: "tmap" },
            origin: start,
            mapZoom: 17,
            isDark: false,
        });
        const currentRevision = buildSavedRouteMapPresentation({
            route: { ...baseRoute, geometryRevision: 2 },
            origin: start,
            mapZoom: 17,
            isDark: false,
        });

        expect(nonOdsay.routeLegs[0].pathCoords).toBe(legacyPath);
        expect(currentRevision.routeLegs[0].pathCoords).toBe(legacyPath);
    });

    it("restores legacy RouteInfo-only geometry instead of showing endpoint markers alone", () => {
        const legacyRouteInfo = {
            id: "legacy-calendar-route",
            originName: "출발지",
            destinationName: "도착지",
            totalDurationMinutes: 24,
            departureTime: "2026-07-20T01:00:00.000Z",
            arrivalTime: "2026-07-20T01:24:00.000Z",
            timeBasis: "estimated" as const,
            steps: [
                {
                    id: "origin",
                    type: "ORIGIN" as const,
                    title: "출발지",
                    coordinates: [{ latitude: 37.56, longitude: 126.97 }],
                },
                {
                    id: "leg-0",
                    type: "DRIVE" as const,
                    title: "차량 이동",
                    coordinates: [
                        { latitude: 37.56, longitude: 126.97 },
                        { latitude: 37.53, longitude: 127.0 },
                        { latitude: 37.5, longitude: 127.03 },
                    ],
                },
                {
                    id: "destination",
                    type: "DESTINATION" as const,
                    title: "도착지",
                    coordinates: [{ latitude: 37.5, longitude: 127.03 }],
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route: legacyRouteInfo,
            origin,
            destination,
            mapZoom: 13,
            isDark: false,
        });

        expect(presentation.routeOption).toBeUndefined();
        expect(presentation.pathOverlays).toHaveLength(1);
        expect(presentation.pathOverlays[0]).toMatchObject({
            id: "saved-route-info-leg-0-0",
            coords: [
                { latitude: 37.56, longitude: 126.97 },
                { latitude: 37.53, longitude: 127.0 },
                { latitude: 37.5, longitude: 127.03 },
            ],
        });
        expect(getSavedRouteFitCoords(legacyRouteInfo, origin, destination)).toContainEqual({
            latitude: 37.53,
            longitude: 127.0,
        });
        expect(hasRenderableSavedRouteGeometry(legacyRouteInfo, origin, destination)).toBe(true);
    });

    it("does not invent a straight transit line from endpoint markers when movement geometry is missing", () => {
        const routeInfoWithoutGeometry = {
            id: "legacy-transit-without-geometry",
            originName: "출발지",
            destinationName: "도착지",
            totalDurationMinutes: 25,
            departureTime: "2026-07-20T01:00:00.000Z",
            arrivalTime: "2026-07-20T01:25:00.000Z",
            timeBasis: "provider_schedule" as const,
            steps: [
                {
                    id: "origin",
                    type: "ORIGIN" as const,
                    title: "출발지",
                    coordinates: [{ latitude: 37.56, longitude: 126.97 }],
                },
                {
                    id: "bus",
                    type: "BUS" as const,
                    title: "버스 이동",
                    coordinates: [{ latitude: 37.54, longitude: 127.0 }],
                },
                {
                    id: "destination",
                    type: "DESTINATION" as const,
                    title: "도착지",
                    coordinates: [{ latitude: 37.5, longitude: 127.03 }],
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route: routeInfoWithoutGeometry,
            origin,
            destination,
            mapZoom: 13,
            isDark: false,
        });

        expect(presentation.pathOverlays).toHaveLength(0);
        expect(hasRenderableSavedRouteGeometry(
            routeInfoWithoutGeometry,
            origin,
            destination
        )).toBe(false);
    });

    it("uses the normal map walking style when restoring RouteInfo geometry", () => {
        const walkingRouteInfo = {
            id: "legacy-walk",
            originName: "출발지",
            destinationName: "도착지",
            totalDurationMinutes: 12,
            departureTime: "2026-07-20T01:00:00.000Z",
            arrivalTime: "2026-07-20T01:12:00.000Z",
            timeBasis: "estimated" as const,
            steps: [{
                id: "walk",
                type: "WALK" as const,
                title: "도보 이동",
                coordinates: [
                    { latitude: 37.56, longitude: 126.97 },
                    { latitude: 37.5, longitude: 127.03 },
                ],
            }],
        };

        const presentation = buildSavedRouteMapPresentation({
            route: walkingRouteInfo,
            origin,
            destination,
            mapZoom: 13,
            isDark: false,
        });

        expect(presentation.pathOverlays[0]).toMatchObject({
            color: "#1A73E8",
            strokeStyle: "dot",
        });
    });

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
            width: 4.2,
            outlineWidth: 0,
            strokeStyle: "dot",
            outlineStrokeStyle: "dot",
            renderMode: "native",
            nativeDirection: false,
            showDirection: false,
        });
        expect(walk?.dashPattern).toEqual([1, 13]);
        expect(subway).toMatchObject({
            color: "#00B140",
            width: 7.2,
            strokeStyle: "solid",
            renderMode: "native",
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
        });
        expect(Number(subway?.zIndex)).toBeGreaterThan(Number(walk?.zIndex));
    });

    it("keeps saved transit WALK styling identical across every supported zoom", () => {
        for (let zoom = 6; zoom <= 18; zoom += 1) {
            const presentation = buildSavedRouteMapPresentation({
                route: transitRoute,
                origin,
                destination,
                mapZoom: zoom,
                isDark: false,
            });
            const walk = presentation.pathOverlays.find(
                (overlay) => overlay.id === "saved-route-leg-0"
            );
            const expectedWidth = zoom < 11 ? 3.8 : zoom < 16 ? 4.2 : 4.6;

            expect(walk).toMatchObject({
                width: expectedWidth,
                outlineWidth: 0,
                dashPattern: [1, 13],
                strokeStyle: "dot",
                outlineStrokeStyle: "dot",
                nativeDirection: false,
            });
        }
    });

    it("changes marker density and thickens route strokes at detail zoom", () => {
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
        expect(overview.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-0")?.width).toBe(4.2);
        expect(detail.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-0")?.width).toBe(4.6);
        expect(overview.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-1")?.width).toBe(7.2);
        expect(detail.pathOverlays.find((overlay) => overlay.id === "saved-route-leg-1")?.width).toBe(8);
        expect(overview.markers.find((marker) => marker.id === "origin")?.markerScale).toBe(0.84);
        expect(detail.markers.find((marker) => marker.id === "origin")?.markerScale).toBe(1);
    });

    it("keeps direction arrows on a focused transit leg", () => {
        const presentation = buildSavedRouteMapPresentation({
            route: transitRoute,
            origin,
            destination,
            mapZoom: 17,
            isDark: true,
            focusedLegIndex: 1,
        });
        const focused = presentation.pathOverlays.find(
            (overlay) => overlay.id === "saved-route-focused-leg-1"
        );
        const walk = presentation.pathOverlays.find(
            (overlay) => overlay.id === "saved-route-leg-0"
        );
        const subway = presentation.pathOverlays.find(
            (overlay) => overlay.id === "saved-route-leg-1"
        );

        expect(walk).toMatchObject({
            outlineColor: "#0F172A",
            outlineOpacity: 0.72,
            nativeDirection: false,
        });
        expect(subway).toMatchObject({
            outlineColor: "#0F172A",
            outlineOpacity: 0.76,
            nativeDirection: false,
        });
        expect(focused).toMatchObject({
            nativeDirection: true,
            outlineColor: "#0F172A",
            outlineOpacity: 0.76,
            nativeDirectionColor: "#FFFFFF",
            nativeDirectionOpacity: 0.96,
        });
        expect(presentation.pathOverlays.filter((overlay) => overlay.nativeDirection)).toHaveLength(1);
    });

    it("does not stack a second dotted line over a focused walking leg", () => {
        const presentation = buildSavedRouteMapPresentation({
            route: transitRoute,
            origin,
            destination,
            mapZoom: 17,
            isDark: false,
            focusedLegIndex: 0,
        });
        const walkingOverlays = presentation.pathOverlays.filter(
            (overlay) => overlay.strokeStyle === "dot"
        );

        expect(walkingOverlays).toHaveLength(1);
        expect(walkingOverlays[0]?.id).toBe("saved-route-leg-0");
        expect(presentation.pathOverlays.some(
            (overlay) => overlay.id === "saved-route-focused-leg-0"
        )).toBe(false);
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

    it("preserves a matching stored leg and rebuilds only the missing transit leg", () => {
        const route = {
            ...transitRoute,
            storedPathOverlays: [{
                id: "legacy-walk-only",
                coords: transitRoute.transitLegs?.[0]?.pathCoords,
                dashPattern: [8, 7.2],
                strokeStyle: "dash",
                renderMode: "native",
            }],
        };
        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays.map((overlay) => overlay.id)).toEqual([
            "legacy-walk-only",
            "saved-route-leg-1",
        ]);
    });

    it("rejects stored transit geometry whose endpoints match but interior shape does not", () => {
        const leg: TransitLegDetail = {
            kind: "SUBWAY",
            label: "2호선",
            lineName: "2호선",
            lineColor: "00B140",
            pathCoords: [
                { lat: 37.56, lng: 126.97 },
                { lat: 37.57, lng: 127.0 },
                { lat: 37.54, lng: 127.03 },
            ],
        };
        const legacyOutlier = { lat: 38.2, lng: 128.2 };
        const route = {
            id: "stored-shape-mismatch",
            mode: "TRANSIT",
            minutes: 25,
            source: "api",
            transitLegs: [leg],
            storedPathOverlays: [{
                id: "legacy-same-endpoints-wrong-shape",
                coords: [leg.pathCoords?.[0], legacyOutlier, leg.pathCoords?.[2]],
                color: "#FF00FF",
                zIndex: 999,
                strokeStyle: "solid",
            }],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });
        const publicFitCoords = getSavedRouteFitCoords(route, origin, destination);

        expect(presentation.pathOverlays.map((overlay) => overlay.id)).toEqual(["saved-route-leg-0"]);
        expect(presentation.fitCoords).not.toContainEqual({
            latitude: legacyOutlier.lat,
            longitude: legacyOutlier.lng,
        });
        expect(publicFitCoords).not.toContainEqual({
            latitude: legacyOutlier.lat,
            longitude: legacyOutlier.lng,
        });
    });

    it("keeps accepted stored geometry but recalculates its color, z-index and direction style", () => {
        const leg: TransitLegDetail = {
            kind: "SUBWAY",
            label: "2호선",
            lineName: "2호선",
            lineColor: "00B140",
            pathCoords: [
                { lat: 37.56, lng: 126.97 },
                { lat: 37.55, lng: 127.0 },
                { lat: 37.54, lng: 127.03 },
            ],
        };
        const route = {
            id: "stored-current-style",
            mode: "TRANSIT",
            minutes: 22,
            source: "api",
            transitLegs: [leg],
            storedPathOverlays: [{
                id: "legacy-subway-style",
                coords: leg.pathCoords,
                color: "#FF00FF",
                width: 99,
                zIndex: 999,
                nativeDirection: false,
                strokeStyle: "solid",
            }],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });
        const overlay = presentation.pathOverlays[0];

        expect(overlay).toMatchObject({
            id: "legacy-subway-style",
            color: "#00B140",
            width: 7.2,
            zIndex: 40,
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
        });

        const focusedPresentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
            focusedLegIndex: 0,
        });
        expect(focusedPresentation.pathOverlays.find(
            (item) => item.id === "legacy-subway-style"
        )?.nativeDirection).toBe(false);
        expect(focusedPresentation.pathOverlays.filter((item) => item.nativeDirection)).toHaveLength(1);
    });

    it("preserves normalized detailed WALK geometry across the actual save and restore provenance flow", () => {
        const detailedWalk = [
            { lat: 37.56, lng: 126.97 },
            { lat: 37.5605, lng: 126.972 },
            { lat: 37.558, lng: 126.974 },
        ];
        const wrongRideOutlier = { lat: 38.1, lng: 128.1 };
        const legs: TransitLegDetail[] = [
            {
                kind: "WALK",
                label: "상세 보행",
                distanceMeters: 500,
                pathCoords: [
                    { lat: 37.56, lng: 126.97 },
                    { lat: 37.559, lng: 126.972 },
                    { lat: 37.558, lng: 126.974 },
                ],
            },
            {
                kind: "SUBWAY",
                label: "2호선",
                lineColor: "00B140",
                pathCoords: [
                    { lat: 37.558, lng: 126.974 },
                    { lat: 37.54, lng: 127.0 },
                    { lat: 37.52, lng: 127.02 },
                ],
            },
        ];
        const normalizedWalkOverlayId = "saved-detailed-walk-segment-0";
        const detailedGeometrySource = resolveDetailedWalkGeometrySource(undefined);
        const normalizedWalkSegments = [{
            id: normalizedWalkOverlayId,
            sequence: 0,
            mode: "WALK",
            geometrySource: detailedGeometrySource,
        }] as const;
        const savedProvenance = getStoredRouteOverlayGeometryProvenance(
            normalizedWalkOverlayId,
            normalizedWalkSegments
        );
        const route = {
            id: "saved-detailed-walk",
            mode: "TRANSIT",
            minutes: 28,
            source: "api",
            transitLegs: legs,
            storedPathOverlays: [
                {
                    id: normalizedWalkOverlayId,
                    coords: detailedWalk,
                    dashPattern: [1, 13],
                    strokeStyle: "dash",
                    renderMode: "native",
                    ...(savedProvenance ?? {}),
                },
                {
                    id: "legacy-wrong-ride-1",
                    coords: [legs[1].pathCoords?.[0], wrongRideOutlier, legs[1].pathCoords?.[2]],
                    strokeStyle: "solid",
                    renderMode: "native",
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });
        const publicFitCoords = getSavedRouteFitCoords(route, origin, destination);

        expect(savedProvenance).toEqual({
            geometrySource: "WALK_API_DETAIL",
            transitLegIndex: 0,
        });
        expect(resolveDetailedWalkGeometrySource("WALK_PASS_SHAPE_LINESTRING"))
            .toBe("WALK_PASS_SHAPE_LINESTRING");
        expect(getStoredRouteOverlayGeometryProvenance(
            `${normalizedWalkOverlayId}-part-2`,
            normalizedWalkSegments
        )).toEqual(savedProvenance);
        expect(getStoredRouteOverlayGeometryProvenance(
            `${normalizedWalkOverlayId}-access-link-0`,
            normalizedWalkSegments
        )).toBeUndefined();
        expect(getStoredRouteOverlayGeometryProvenance(
            `${normalizedWalkOverlayId}-focused`,
            normalizedWalkSegments
        )).toBeUndefined();
        expect(getStoredRouteOverlayGeometryProvenance("ride-segment-0", [{
            id: "ride-segment-0",
            sequence: 0,
            mode: "SUBWAY",
            geometrySource: "WALK_API_DETAIL",
        }])).toBeUndefined();
        expect(getStoredRouteOverlayGeometryProvenance(normalizedWalkOverlayId, [{
            ...normalizedWalkSegments[0],
            geometrySource: "UNKNOWN",
        }])).toBeUndefined();
        expect(presentation.pathOverlays.map((overlay) => overlay.id)).toEqual([
            normalizedWalkOverlayId,
            "saved-route-leg-1",
        ]);
        expect(presentation.pathOverlays[0]?.coords).toEqual(detailedWalk.map((coord) => ({
            latitude: coord.lat,
            longitude: coord.lng,
        })));
        expect(presentation.fitCoords).not.toContainEqual({
            latitude: wrongRideOutlier.lat,
            longitude: wrongRideOutlier.lng,
        });
        expect(publicFitCoords).not.toContainEqual({
            latitude: wrongRideOutlier.lat,
            longitude: wrongRideOutlier.lng,
        });
    });

    it("safely restores a legacy normalized WALK segment id saved before provenance fields existed", () => {
        const leg: TransitLegDetail = {
            kind: "WALK",
            label: "상세 보행",
            distanceMeters: 500,
            pathCoords: [
                { lat: 37.56, lng: 126.97 },
                { lat: 37.559, lng: 126.972 },
                { lat: 37.558, lng: 126.974 },
            ],
        };
        const legacyDetailedWalk = [
            { lat: 37.56, lng: 126.97 },
            { lat: 37.5605, lng: 126.972 },
            { lat: 37.558, lng: 126.974 },
        ];
        const route = {
            id: "legacy-normalized-walk",
            mode: "TRANSIT",
            minutes: 8,
            source: "api",
            transitLegs: [leg],
            storedPathOverlays: [{
                id: "legacy-normalized-walk-segment-0",
                coords: legacyDetailedWalk,
                dashPattern: [1, 13],
                strokeStyle: "dash",
                renderMode: "native",
            }],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays[0]?.id).toBe("legacy-normalized-walk-segment-0");
        expect(presentation.pathOverlays[0]?.coords).toEqual(legacyDetailedWalk.map((coord) => ({
            latitude: coord.lat,
            longitude: coord.lng,
        })));
    });

    it("fails closed when explicit stored WALK provenance points at a different leg", () => {
        const walkPath = [
            { lat: 37.56, lng: 126.97 },
            { lat: 37.559, lng: 126.972 },
            { lat: 37.558, lng: 126.974 },
        ];
        const presentation = buildSavedRouteMapPresentation({
            route: {
                id: "mismatched-walk-provenance",
                mode: "TRANSIT",
                minutes: 8,
                source: "api",
                transitLegs: [{
                    kind: "WALK",
                    label: "도보",
                    pathCoords: walkPath,
                }],
                storedPathOverlays: [{
                    id: "mismatched-walk-provenance-segment-0",
                    coords: walkPath,
                    dashPattern: [1, 13],
                    strokeStyle: "dash",
                    geometrySource: "WALK_API_DETAIL",
                    transitLegIndex: 1,
                }],
            },
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays[0]?.id).toBe("saved-route-leg-0");
    });

    it("uses the adopted stored ride geometry for the focused direction overlay", () => {
        const rawRide = [
            { lat: 37.56, lng: 126.97 },
            { lat: 37.55, lng: 127.0 },
            { lat: 37.54, lng: 127.03 },
        ];
        const storedRide = [
            rawRide[0],
            { lat: 37.55006, lng: 127.00004 },
            rawRide[2],
        ];
        const route = {
            id: "saved-focused-stored-ride",
            mode: "TRANSIT",
            minutes: 20,
            source: "api",
            transitLegs: [{
                kind: "SUBWAY",
                label: "2호선",
                lineColor: "00B140",
                pathCoords: rawRide,
            }],
            storedPathOverlays: [{
                id: "stored-subway-detail",
                coords: storedRide,
                strokeStyle: "solid",
                renderMode: "native",
            }],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
            focusedLegIndex: 0,
        });
        const expectedStoredCoords = storedRide.map((coord) => ({
            latitude: coord.lat,
            longitude: coord.lng,
        }));
        const rawCoords = rawRide.map((coord) => ({
            latitude: coord.lat,
            longitude: coord.lng,
        }));
        const base = presentation.pathOverlays.find((overlay) => overlay.id === "stored-subway-detail");
        const focused = presentation.pathOverlays.find(
            (overlay) => overlay.id === "saved-route-focused-leg-0"
        );

        expect(base?.coords).toEqual(expectedStoredCoords);
        expect(focused?.coords).toEqual(expectedStoredCoords);
        expect(focused?.coords).not.toEqual(rawCoords);
        expect(base?.nativeDirection).toBe(false);
        expect(focused?.nativeDirection).toBe(true);
        expect(presentation.pathOverlays.filter((overlay) => overlay.nativeDirection)).toHaveLength(1);
    });

    it("does not let a reversed duplicate WALK hide a different missing leg", () => {
        const legs: TransitLegDetail[] = [
            {
                kind: "WALK",
                label: "첫 도보",
                pathCoords: [
                    { lat: 37.56, lng: 126.97 },
                    { lat: 37.558, lng: 126.973 },
                ],
            },
            {
                kind: "SUBWAY",
                label: "2호선",
                lineColor: "00B140",
                pathCoords: [
                    { lat: 37.558, lng: 126.973 },
                    { lat: 37.52, lng: 127.01 },
                ],
            },
            {
                kind: "WALK",
                label: "마지막 도보",
                pathCoords: [
                    { lat: 37.52, lng: 127.01 },
                    { lat: 37.5, lng: 127.03 },
                ],
            },
        ];
        const firstWalk = legs[0].pathCoords ?? [];
        const route = {
            id: "saved-transit-missing-final-walk",
            mode: "TRANSIT",
            minutes: 31,
            source: "api",
            transitLegs: legs,
            storedPathOverlays: [
                {
                    id: "legacy-walk-0",
                    coords: firstWalk,
                    dashPattern: [1, 12],
                    strokeStyle: "dash",
                    renderMode: "native",
                },
                {
                    id: "legacy-walk-0-reversed-duplicate",
                    coords: [
                        firstWalk[1],
                        { lat: 37.559, lng: 126.9715 },
                        firstWalk[0],
                    ],
                    dashPattern: [1, 12],
                    strokeStyle: "dash",
                    renderMode: "native",
                },
                {
                    id: "legacy-ride-1",
                    coords: legs[1].pathCoords,
                    strokeStyle: "solid",
                    renderMode: "native",
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays.map((overlay) => overlay.id)).toEqual([
            "legacy-walk-0",
            "legacy-ride-1",
            "saved-route-leg-2",
        ]);
        expect(presentation.pathOverlays.some(
            (overlay) => overlay.id === "legacy-walk-0-reversed-duplicate"
        )).toBe(false);
    });

    it("does not apply the wider terminal tolerance to an internal transfer WALK", () => {
        const legs: TransitLegDetail[] = [
            {
                kind: "SUBWAY",
                label: "1호선",
                pathCoords: [
                    { lat: 37.56, lng: 126.97 },
                    { lat: 37.55, lng: 126.98 },
                ],
            },
            {
                kind: "WALK",
                label: "환승 도보",
                pathCoords: [
                    { lat: 37.55, lng: 126.98 },
                    { lat: 37.549, lng: 126.982 },
                ],
            },
            {
                kind: "SUBWAY",
                label: "2호선",
                pathCoords: [
                    { lat: 37.549, lng: 126.982 },
                    { lat: 37.54, lng: 126.99 },
                ],
            },
        ];
        const route = {
            id: "saved-transit-shifted-transfer",
            mode: "TRANSIT",
            minutes: 22,
            source: "api",
            transitLegs: legs,
            storedPathOverlays: [
                { id: "legacy-ride-0", coords: legs[0].pathCoords, strokeStyle: "solid" },
                {
                    id: "legacy-walk-1-shifted-33m",
                    coords: [
                        { lat: 37.5503, lng: 126.98 },
                        { lat: 37.5493, lng: 126.982 },
                    ],
                    dashPattern: [1, 12],
                    strokeStyle: "dash",
                },
                { id: "legacy-ride-2", coords: legs[2].pathCoords, strokeStyle: "solid" },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays.map((overlay) => overlay.id)).toEqual([
            "legacy-ride-0",
            "saved-route-leg-1",
            "legacy-ride-2",
        ]);
    });

    it("uses the dedicated dark casing for standalone walking routes", () => {
        const presentation = buildSavedRouteMapPresentation({
            route: {
                id: "saved-dark-walk",
                mode: "WALK",
                minutes: 18,
                source: "api",
                pathCoords: transitRoute.pathCoords,
            },
            origin,
            destination,
            mapZoom: 17,
            isDark: true,
        });

        expect(presentation.pathOverlays[0]).toMatchObject({
            outlineColor: "#0F172A",
            outlineOpacity: 0.72,
            dashPattern: [1, 13],
        });
    });

    it("renders an ETC transit leg as a neutral solid line without arrows", () => {
        const presentation = buildSavedRouteMapPresentation({
            route: {
                id: "saved-neutral-etc-leg",
                mode: "TRANSIT",
                minutes: 12,
                source: "api",
                transitLegs: [{
                    kind: "ETC",
                    label: "기타 이동",
                    pathCoords: [
                        { lat: 37.56, lng: 126.97 },
                        { lat: 37.55, lng: 126.99 },
                        { lat: 37.54, lng: 127.01 },
                    ],
                }],
            },
            origin,
            destination,
            mapZoom: 17,
            isDark: true,
        });

        expect(presentation.pathOverlays[0]).toMatchObject({
            color: "#64748B",
            width: 8,
            strokeStyle: "solid",
            outlineColor: "#0F172A",
            nativeDirection: false,
            zIndex: 35,
        });
        expect(presentation.pathOverlays[0].dashPattern).toBeUndefined();
    });

    it("restyles stored overlays with the current mode and theme while preserving id and geometry", () => {
        const modes = ["WALK", "CAR", "BIKE", "ETC", "TRANSIT"] as const;
        const storedGeometry = [
            { lat: 37.541, lng: 126.981 },
            { lat: 37.532, lng: 126.994 },
        ];

        modes.forEach((mode) => {
            [false, true].forEach((isDark) => {
                const route = {
                    id: `saved-${mode.toLowerCase()}`,
                    mode,
                    minutes: 18,
                    source: "api" as const,
                    pathCoords: transitRoute.pathCoords,
                    transitLegs: mode === "TRANSIT" ? [] : undefined,
                    storedPathOverlays: [{
                        id: `legacy-${mode.toLowerCase()}-piece`,
                        coords: storedGeometry,
                        color: "#FF00FF",
                        width: 99,
                        opacity: 0.2,
                        outlineColor: "#0F172A",
                        outlineWidth: 20,
                        outlineOpacity: 0.1,
                        dashPattern: [8, 7.2],
                        strokeStyle: "dash",
                        outlineStrokeStyle: "dash",
                        renderMode: "native",
                        shape: "dot",
                        nativeDirection: false,
                        nativeDirectionColor: "#FF00FF",
                        nativeDirectionOpacity: 0.1,
                        zIndex: 999,
                    }],
                };
                const freshRoute = { ...route, storedPathOverlays: undefined };
                const restored = buildSavedRouteMapPresentation({
                    route,
                    origin,
                    destination,
                    mapZoom: 15,
                    isDark,
                }).pathOverlays[0];
                const fresh = buildSavedRouteMapPresentation({
                    route: freshRoute,
                    origin,
                    destination,
                    mapZoom: 15,
                    isDark,
                }).pathOverlays[0];

                expect(restored.id).toBe(`legacy-${mode.toLowerCase()}-piece`);
                expect(restored.coords).toEqual([
                    { latitude: 37.541, longitude: 126.981 },
                    { latitude: 37.532, longitude: 126.994 },
                ]);
                const styleKeys = [
                    "color",
                    "width",
                    "opacity",
                    "outlineColor",
                    "outlineWidth",
                    "outlineOpacity",
                    "dashPattern",
                    "strokeStyle",
                    "outlineStrokeStyle",
                    "renderMode",
                    "shape",
                    "showDirection",
                    "nativeDirection",
                    "nativeDirectionColor",
                    "nativeDirectionOpacity",
                    "zIndex",
                ] as const;
                styleKeys.forEach((key) => {
                    expect(restored[key]).toEqual(fresh[key]);
                });
            });
        });
    });

    it("removes legacy dots from WALK and no-leg TRANSIT stored overlays", () => {
        const legacyOverlay = {
            id: "legacy-route-piece",
            coords: transitRoute.pathCoords,
            color: "#FF00FF",
            width: 12,
            outlineColor: "#0F172A",
            outlineWidth: 8,
            dashPattern: [8, 7.2],
            strokeStyle: "dash",
            renderMode: "native",
            shape: "dot",
            zIndex: 999,
        };
        const walk = buildSavedRouteMapPresentation({
            route: {
                id: "legacy-walk",
                mode: "WALK",
                minutes: 18,
                source: "api",
                pathCoords: transitRoute.pathCoords,
                storedPathOverlays: [legacyOverlay],
            },
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        }).pathOverlays[0];
        const noLegTransitRoute = {
            id: "legacy-transit-without-legs",
            mode: "TRANSIT",
            minutes: 18,
            source: "api",
            pathCoords: transitRoute.pathCoords,
            transitLegs: [],
        };
        const transitWithoutLegs = buildSavedRouteMapPresentation({
            route: { ...noLegTransitRoute, storedPathOverlays: [legacyOverlay] },
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        }).pathOverlays[0];
        const freshTransitWithoutLegs = buildSavedRouteMapPresentation({
            route: noLegTransitRoute,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        }).pathOverlays[0];

        expect(walk).toMatchObject({
            id: "legacy-route-piece",
            color: "#1A73E8",
            width: 4.2,
            outlineColor: "#FFFFFF",
            outlineOpacity: 0.9,
            dashPattern: [1, 13],
            strokeStyle: "dot",
            nativeDirection: false,
            zIndex: 40,
        });
        expect(walk.shape).toBeUndefined();
        expect(transitWithoutLegs).toMatchObject({
            id: "legacy-route-piece",
            color: "#2979FF",
            width: 7.2,
            outlineColor: "#FFFFFF",
            outlineOpacity: 0.92,
            strokeStyle: "solid",
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
            nativeDirectionOpacity: 0.96,
            zIndex: 40,
        });
        expect(transitWithoutLegs.outlineWidth).toBeCloseTo(freshTransitWithoutLegs.outlineWidth ?? 0);
        expect(transitWithoutLegs.dashPattern).toBeUndefined();
        expect(transitWithoutLegs.shape).toBeUndefined();
    });

    it("gates no-leg TRANSIT direction arrows at z11 for fresh and stored geometry", () => {
        const baseRoute = {
            id: "transit-without-legs-zoom-gate",
            mode: "TRANSIT" as const,
            minutes: 18,
            source: "api" as const,
            pathCoords: transitRoute.pathCoords,
            transitLegs: [],
        };
        const freshZ10 = buildSavedRouteMapPresentation({
            route: baseRoute,
            origin,
            destination,
            mapZoom: 10,
            isDark: false,
        }).pathOverlays[0];
        const freshZ11 = buildSavedRouteMapPresentation({
            route: baseRoute,
            origin,
            destination,
            mapZoom: 11,
            isDark: false,
        }).pathOverlays[0];
        const storedZ10 = buildSavedRouteMapPresentation({
            route: {
                ...baseRoute,
                storedPathOverlays: [{
                    id: "legacy-no-leg-transit",
                    coords: transitRoute.pathCoords,
                    nativeDirection: true,
                    zIndex: 999,
                }],
            },
            origin,
            destination,
            mapZoom: 10,
            isDark: false,
        }).pathOverlays[0];
        const darkZ11 = buildSavedRouteMapPresentation({
            route: baseRoute,
            origin,
            destination,
            mapZoom: 11,
            isDark: true,
        }).pathOverlays[0];

        expect(freshZ10).toMatchObject({
            strokeStyle: "solid",
            dashPattern: undefined,
            nativeDirection: false,
        });
        expect(storedZ10.nativeDirection).toBe(false);
        expect(freshZ11).toMatchObject({
            width: 6.4,
            outlineColor: "#FFFFFF",
            outlineOpacity: 0.92,
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
        });
        expect(freshZ11.outlineWidth).toBeCloseTo(1.6);
        expect(darkZ11).toMatchObject({
            width: 6.4,
            outlineColor: "#0F172A",
            outlineOpacity: 0.76,
            nativeDirection: true,
            nativeDirectionColor: "#FFFFFF",
        });
        expect(darkZ11.outlineWidth).toBeCloseTo(1.6);
    });

    it("keeps camera bounds independent from zoom-dependent marker layers", () => {
        const first = getSavedRouteFitCoords(transitRoute, origin, destination);
        const second = getSavedRouteFitCoords(transitRoute, origin, destination);

        expect(first).toEqual(second);
        expect(first).toContainEqual({ latitude: origin.lat, longitude: origin.lng });
        expect(first).toContainEqual({ latitude: destination.lat, longitude: destination.lng });
    });

    it("keeps the saved-route overview fit stable across equivalent API refreshes", () => {
        const coords = getSavedRouteFitCoords(transitRoute, origin, destination);
        const padding = { top: 180, right: 44, bottom: 260, left: 44 };
        const first = getSavedRouteOverviewFitKey(coords, padding);
        const refreshed = getSavedRouteOverviewFitKey(
            coords.map((coord) => ({ ...coord })),
            { ...padding }
        );
        const interiorGeometryUpdate = getSavedRouteOverviewFitKey([
            coords[0],
            { latitude: 37.53, longitude: 127.0 },
            coords[coords.length - 1],
        ], padding);

        expect(refreshed).toBe(first);
        expect(interiorGeometryUpdate).toBe(first);
        expect(getSavedRouteOverviewFitKey(coords, {
            ...padding,
            bottom: padding.bottom + 12,
        })).not.toBe(first);
        expect(getSavedRouteOverviewFitKey([
            ...coords,
            { latitude: 37.49, longitude: 127.04 },
        ], padding)).not.toBe(first);
    });

    it("draws the saved root path underneath transit legs when one leg has no usable geometry", () => {
        const rootPath = [
            { lat: 37.56, lng: 126.97 },
            { lat: 37.54, lng: 126.99 },
            { lat: 37.52, lng: 127.01 },
        ];
        const route = {
            id: "partial-transit-geometry",
            mode: "TRANSIT" as const,
            minutes: 28,
            source: "api" as const,
            pathCoords: rootPath,
            transitLegs: [
                {
                    kind: "WALK" as const,
                    label: "출발지에서 도보",
                    pathCoords: rootPath.slice(0, 2),
                },
                {
                    kind: "SUBWAY" as const,
                    label: "좌표가 유실된 지하철",
                    startName: "승차역",
                    endName: "하차역",
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });
        const fallback = presentation.pathOverlays.find(
            (overlay) => overlay.id === "saved-route-transit-fallback"
        );

        expect(fallback).toMatchObject({
            opacity: 0.7,
            nativeDirection: false,
            zIndex: 20,
        });
        expect(fallback?.coords).toEqual(rootPath.map((coord) => ({
            latitude: coord.lat,
            longitude: coord.lng,
        })));
        expect(getSavedRouteFitCoords(route, origin, destination)).toEqual(expect.arrayContaining(
            rootPath.map((coord) => ({ latitude: coord.lat, longitude: coord.lng }))
        ));

        const darkPresentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: true,
        });
        expect(darkPresentation.pathOverlays.find(
            (overlay) => overlay.id === "saved-route-transit-fallback"
        )).toMatchObject({
            opacity: 0.7,
            nativeDirection: false,
            outlineColor: "#0F172A",
            outlineOpacity: 0.76,
            zIndex: 20,
        });
    });

    it("does not fabricate a root fallback by joining remaining legs when no root path was saved", () => {
        const route = {
            id: "partial-transit-without-root",
            mode: "TRANSIT" as const,
            minutes: 31,
            source: "api" as const,
            transitLegs: [
                {
                    kind: "WALK" as const,
                    label: "첫 도보",
                    pathCoords: [
                        { lat: 37.56, lng: 126.97 },
                        { lat: 37.558, lng: 126.973 },
                    ],
                },
                {
                    kind: "SUBWAY" as const,
                    label: "좌표가 유실된 지하철",
                },
                {
                    kind: "WALK" as const,
                    label: "마지막 도보",
                    pathCoords: [
                        { lat: 37.52, lng: 127.01 },
                        { lat: 37.5, lng: 127.03 },
                    ],
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays.some(
            (overlay) => overlay.id === "saved-route-transit-fallback"
        )).toBe(false);
        expect(presentation.pathOverlays.map((overlay) => overlay.id)).toEqual([
            "saved-route-leg-0",
            "saved-route-leg-2",
        ]);
    });

    it("themes mode-less legacy stored overlays without changing their geometry", () => {
        const legacyRoute = {
            storedPathOverlays: [{
                id: "legacy-walk-overlay",
                coords: [
                    { lat: 37.56, lng: 126.97 },
                    { lat: 37.55, lng: 126.98 },
                ],
                color: "#1A73E8",
                width: 4,
                outlineColor: "#FFFFFF",
                outlineWidth: 2,
                outlineOpacity: 0.9,
                dashPattern: [1, 13],
                strokeStyle: "dot",
                outlineStrokeStyle: "dot",
            }],
        };

        const light = buildSavedRouteMapPresentation({
            route: legacyRoute,
            origin,
            destination,
            mapZoom: 17,
            isDark: false,
        });
        const dark = buildSavedRouteMapPresentation({
            route: legacyRoute,
            origin,
            destination,
            mapZoom: 17,
            isDark: true,
        });

        expect(light.pathOverlays[0]).toMatchObject({
            id: "legacy-walk-overlay",
            outlineColor: "#FFFFFF",
            outlineOpacity: 0.9,
        });
        expect(dark.pathOverlays[0]).toMatchObject({
            id: "legacy-walk-overlay",
            outlineColor: "#0F172A",
            outlineOpacity: 0.72,
        });
        expect(dark.pathOverlays[0]?.coords).toEqual(light.pathOverlays[0]?.coords);
    });

    it("does not add the root fallback or duplicate base lines when every leg has geometry", () => {
        const presentation = buildSavedRouteMapPresentation({
            route: transitRoute,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });
        const overlayIds = presentation.pathOverlays.map((overlay) => overlay.id);

        expect(overlayIds).not.toContain("saved-route-transit-fallback");
        expect(new Set(overlayIds).size).toBe(overlayIds.length);
    });

    it("restores only access links anchored to the saved transit geometry", () => {
        const ridePath = [
            { lat: 37.5553, lng: 126.975 },
            { lat: 37.54, lng: 126.99 },
            { lat: 37.52, lng: 127.01 },
        ];
        const stationAnchor = { lat: 37.555, lng: 126.975 };
        const route = {
            id: "validated-access-links",
            mode: "TRANSIT" as const,
            minutes: 25,
            source: "api" as const,
            pathCoords: ridePath,
            transitLegs: [{
                kind: "SUBWAY" as const,
                label: "2호선",
                startCoord: stationAnchor,
                endCoord: ridePath[ridePath.length - 1],
                pathCoords: ridePath,
            }],
            storedPathOverlays: [
                {
                    id: "stored-subway-line",
                    coords: ridePath,
                    strokeStyle: "solid" as const,
                },
                {
                    id: "stored-subway-access-link-0",
                    coords: [stationAnchor, ridePath[0]],
                    strokeStyle: "dash" as const,
                },
                {
                    id: "stale-access-link",
                    coords: [ridePath[0], { lat: 38.1, lng: 128.1 }],
                    strokeStyle: "dash" as const,
                },
            ],
        };

        const presentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: false,
        });

        expect(presentation.pathOverlays.some(
            (overlay) => overlay.id === "stored-subway-access-link-0"
        )).toBe(true);
        expect(presentation.pathOverlays.some(
            (overlay) => overlay.id === "stale-access-link"
        )).toBe(false);
        expect(presentation.fitCoords).toEqual(getSavedRouteFitCoords(route, origin, destination));
        expect(presentation.fitCoords).not.toContainEqual({
            latitude: stationAnchor.lat,
            longitude: stationAnchor.lng,
        });

        const darkPresentation = buildSavedRouteMapPresentation({
            route,
            origin,
            destination,
            mapZoom: 15,
            isDark: true,
        });
        expect(darkPresentation.pathOverlays.find(
            (overlay) => overlay.id === "stored-subway-access-link-0"
        )).toMatchObject({
            strokeStyle: "dot",
            nativeDirection: false,
            outlineColor: "#0F172A",
            outlineOpacity: 0.72,
        });
    });

    it("resolves the movement start and the actual boarding point for detail taps", () => {
        const legs: TransitLegDetail[] = [
            {
                kind: "WALK",
                label: "승차 지점까지 도보",
                startCoord: { lat: 37.56, lng: 126.97 },
                endCoord: { lat: 37.555, lng: 126.975 },
            },
            {
                kind: "SUBWAY",
                label: "2호선",
                startCoord: { lat: 37.556, lng: 126.976 },
            },
            {
                kind: "BUS",
                label: "100번",
                passStops: [
                    { name: "버스 승차 정류장", coord: { lat: 37.54, lng: 126.99 } },
                ],
            },
        ];

        expect(getSavedTransitLegBoardCoord(legs, 0)).toEqual({
            latitude: 37.56,
            longitude: 126.97,
        });
        expect(getSavedTransitLegBoardCoord(legs, 1)).toEqual({
            latitude: 37.555,
            longitude: 126.975,
        });
        expect(getSavedTransitLegBoardCoord(legs, 2)).toEqual({
            latitude: 37.54,
            longitude: 126.99,
        });
        expect(getSavedTransitLegBoardCoord([legs[1]], 0)).toEqual({
            latitude: 37.556,
            longitude: 126.976,
        });
        expect(getSavedTransitLegBoardCoord([{
            kind: "WALK",
            label: "좌표 경로 도보",
            pathCoords: [
                { lat: 37.52, lng: 126.96 },
                { lat: 37.51, lng: 126.97 },
            ],
        }], 0)).toEqual({
            latitude: 37.52,
            longitude: 126.96,
        });
        expect(getSavedTransitLegBoardCoord([
            legs[0],
            {
                kind: "WALK",
                label: "환승 통로",
                startCoord: { lat: 37.53, lng: 126.98 },
            },
        ], 1)).toEqual({
            latitude: 37.53,
            longitude: 126.98,
        });
        expect(getSavedTransitLegBoardCoord(legs, 99)).toBeUndefined();
    });

    it("shares the stop-label budget across multiple ride legs", () => {
        const transitLegs = Array.from({ length: 3 }, (_unusedLeg, legIndex) => {
            const pathCoords = Array.from({ length: 8 }, (_unusedStop, stopIndex) => ({
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

import {
    getPaddedBoundsCamera,
    getRouteOverviewFitKey,
    getZoomStyleValue,
    shouldDeferInitialRouteCamera,
} from "../src/modules/map/routeZoomStyle";

const stops = {
    zoom12: 4,
    zoom15: 7,
    zoom17: 9,
    zoom18: 10,
} as const;

function projectToViewport(
    coordinate: { latitude: number; longitude: number },
    camera: { latitude: number; longitude: number; zoom: number },
    viewport: { width: number; height: number }
): { x: number; y: number } {
    const toWorldX = (longitude: number) => (longitude + 180) / 360;
    const toWorldY = (latitude: number) => {
        const radians = (latitude * Math.PI) / 180;
        return (1 - (Math.log(Math.tan(radians) + (1 / Math.cos(radians))) / Math.PI)) / 2;
    };
    const worldSize = 256 * (2 ** camera.zoom);
    return {
        x: (viewport.width / 2) + ((toWorldX(coordinate.longitude) - toWorldX(camera.longitude)) * worldSize),
        y: (viewport.height / 2) + ((toWorldY(coordinate.latitude) - toWorldY(camera.latitude)) * worldSize),
    };
}

describe("getZoomStyleValue", () => {
    it("keeps the named QA zoom values exact", () => {
        expect(getZoomStyleValue(stops, 12)).toBe(4);
        expect(getZoomStyleValue(stops, 15)).toBe(7);
        expect(getZoomStyleValue(stops, 17)).toBe(9);
        expect(getZoomStyleValue(stops, 18)).toBe(10);
    });

    it("interpolates continuously between zoom stops", () => {
        expect(getZoomStyleValue(stops, 13.5)).toBeCloseTo(5.5);
        expect(getZoomStyleValue(stops, 16)).toBeCloseTo(8);
        expect(getZoomStyleValue(stops, 17.5)).toBeCloseTo(9.5);
    });

    it("clamps outside the supported visual range", () => {
        expect(getZoomStyleValue(stops, 8)).toBe(4);
        expect(getZoomStyleValue(stops, 20)).toBe(10);
        expect(getZoomStyleValue(stops, Number.NaN)).toBe(7);
    });
});

describe("getPaddedBoundsCamera", () => {
    const viewport = {
        width: 402,
        height: 874,
        padding: { top: 190, right: 64, bottom: 473, left: 64 },
    };

    it("세로형 단거리 경로를 헤더와 바텀시트 사이에 맞춘다", () => {
        const camera = getPaddedBoundsCamera(
            { minLat: 37.55465, maxLat: 37.57225, minLng: 126.97061, maxLng: 126.97736 },
            viewport,
            { minZoom: 6, maxZoom: 16, minimumSpanMeters: 520, boundsPaddingFactor: 1.12 }
        );

        expect(camera).toBeDefined();
        expect(camera?.zoom).toBeGreaterThan(13);
        expect(camera?.zoom).toBeLessThan(14);
        expect(camera?.latitude).toBeLessThan((37.55465 + 37.57225) / 2);
        if (!camera) throw new Error("camera is required");

        const northWest = projectToViewport(
            { latitude: 37.57225, longitude: 126.97061 },
            camera,
            viewport
        );
        const southEast = projectToViewport(
            { latitude: 37.55465, longitude: 126.97736 },
            camera,
            viewport
        );
        expect(northWest.x).toBeGreaterThanOrEqual(viewport.padding.left);
        expect(northWest.y).toBeGreaterThanOrEqual(viewport.padding.top);
        expect(southEast.x).toBeLessThanOrEqual(viewport.width - viewport.padding.right);
        expect(southEast.y).toBeLessThanOrEqual(viewport.height - viewport.padding.bottom);
        const routeHeight = southEast.y - northWest.y;
        const usableHeight = viewport.height - viewport.padding.top - viewport.padding.bottom;
        expect(routeHeight / usableHeight).toBeGreaterThan(0.72);
    });

    it("충분히 짧은 경로도 전체 경로 화면의 최대 배율을 넘지 않는다", () => {
        const camera = getPaddedBoundsCamera(
            { minLat: 37.5546, maxLat: 37.5550, minLng: 126.9706, maxLng: 126.9710 },
            { width: 402, height: 874, padding: { top: 120, right: 48, bottom: 240, left: 48 } },
            { maxZoom: 16, minimumSpanMeters: 420 }
        );

        expect(camera?.zoom).toBeLessThanOrEqual(16);
    });

    it("잘못된 화면 크기는 카메라를 만들지 않는다", () => {
        expect(getPaddedBoundsCamera(
            { minLat: 37.5, maxLat: 37.6, minLng: 126.9, maxLng: 127 },
            { width: 0, height: 874, padding: { top: 0, right: 0, bottom: 0, left: 0 } }
        )).toBeUndefined();
    });
});

describe("shouldDeferInitialRouteCamera", () => {
    const ready = {
        isRouteDetailMode: true,
        mapInitialized: true,
        hasOrigin: true,
        hasDestination: true,
        routeLoading: false,
        bottomSheetVisible: true,
        bottomSheetMeasured: true,
    };

    it("경로 또는 시트 안전영역이 준비되기 전에는 첫 카메라 이동을 보류한다", () => {
        expect(shouldDeferInitialRouteCamera({ ...ready, mapInitialized: false })).toBe(true);
        expect(shouldDeferInitialRouteCamera({ ...ready, routeLoading: true })).toBe(true);
        expect(shouldDeferInitialRouteCamera({ ...ready, bottomSheetMeasured: false })).toBe(true);
        expect(shouldDeferInitialRouteCamera({
            ...ready,
            bottomSheetVisible: false,
            bottomSheetMeasured: false,
        })).toBe(true);
    });

    it("경로와 시트가 준비되면 한 번의 전체 경로 fit을 허용한다", () => {
        expect(shouldDeferInitialRouteCamera(ready)).toBe(false);
        expect(shouldDeferInitialRouteCamera({ ...ready, bottomSheetVisible: false })).toBe(false);
    });
});

describe("getRouteOverviewFitKey", () => {
    const identity = {
        routeId: "route-a",
        routeRevision: "0:2026-07-18T13:00:00.000Z:68:18500",
        routeMode: "detail" as const,
        travelMode: "TRANSIT",
        origin: { latitude: 37.485, longitude: 126.895 },
        destination: { latitude: 37.515, longitude: 127.105 },
        sheetSnap: "middle",
        sheetHidden: false,
        bottomPanelHeight: 420,
        animatedSheetOffset: 180,
        visibleSheetTopY: 520,
        padding: { top: 160, right: 64, bottom: 390, left: 64 },
    };

    it("동일 경로의 비동기 지도 형상 보강과 무관한 의미 기반 키를 만든다", () => {
        expect(getRouteOverviewFitKey(identity)).toBe(getRouteOverviewFitKey({ ...identity }));
    });

    it("선택 경로나 시트 안전영역이 바뀌면 새 fit을 허용한다", () => {
        const current = getRouteOverviewFitKey(identity);
        expect(getRouteOverviewFitKey({ ...identity, routeId: "route-b" })).not.toBe(current);
        expect(getRouteOverviewFitKey({
            ...identity,
            padding: { ...identity.padding, bottom: 460 },
        })).not.toBe(current);
    });
});

import {
    dedupeCoveredNativeDashPathOverlays,
    expandNativeDashPathOverlay,
    expandNativeDashPathOverlays,
} from "../src/modules/map/nativeDashPathPresentation";

const worldPixelLongitude = (pixels: number, zoom: number) => (
    (pixels / (256 * (2 ** zoom))) * 360
);

const longitudeWorldPixel = (longitude: number, zoom: number) => (
    (longitude / 360) * (256 * (2 ** zoom))
);

describe("native dash path presentation", () => {
    it("화면 픽셀 dash/gap을 실제 native polyline 조각으로 만든다", () => {
        const zoom = 18;
        const overlay = {
            id: "route-walk-1",
            coords: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
            ],
            width: 4.4,
            outlineWidth: 0.66,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [12, 13],
        };

        const expanded = expandNativeDashPathOverlay(overlay, zoom);

        expect(expanded).toHaveLength(4);
        expect(expanded.every((item) => item.strokeStyle === "solid")).toBe(true);
        expect(expanded.every((item) => item.dashPattern?.join(",") === "12,13")).toBe(true);
        expect(expanded.map((item) => item.id)).toEqual([
            "route-walk-1--native-dash-0",
            "route-walk-1--native-dash-1",
            "route-walk-1--native-dash-2",
            "route-walk-1--native-dash-3",
        ]);
    });

    it("줌이 바뀌어도 화면상 dash 개수를 일정하게 유지한다", () => {
        const build = (zoom: number) => expandNativeDashPathOverlay({
            id: `walk-z${zoom}`,
            coords: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
            ],
            strokeStyle: "dash" as const,
            dashPattern: [12, 13],
        }, zoom);

        Array.from({ length: 13 }, (_, index) => index + 6).forEach((zoom) => {
            expect(build(zoom)).toHaveLength(4);
        });
    });

    it("소수 줌 경계에서도 dash 밀도가 튀지 않는다", () => {
        const build = (zoom: number) => expandNativeDashPathOverlay({
            id: `walk-z${zoom}`,
            coords: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
            ],
            strokeStyle: "dash" as const,
            dashPattern: [1, 13],
        }, zoom);

        expect(build(17.49)).toHaveLength(8);
        expect(build(17.51)).toHaveLength(8);
    });

    it("도보용 1/13 패턴은 100px마다 분리된 둥근 점 8개를 만든다", () => {
        const expanded = expandNativeDashPathOverlay({
            id: "transit-walk",
            coords: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: worldPixelLongitude(100, 17) },
            ],
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 13],
        }, 17);

        expect(expanded).toHaveLength(8);
        expect(expanded.every((overlay) => overlay.strokeStyle === "solid")).toBe(true);
    });

    it("같은 도보 경로가 역방향으로 겹쳐도 한 레이어만 유지한다", () => {
        const zoom = 18;
        const coords = [
            { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
            { latitude: 0, longitude: worldPixelLongitude(50, zoom) },
            { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
        ];
        const style = {
            color: "#1D72FF",
            width: 4.4,
            outlineColor: "#FFFFFF",
            outlineWidth: 0.66,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 12],
        };

        const deduped = dedupeCoveredNativeDashPathOverlays([
            { ...style, id: "walk-main", coords },
            { ...style, id: "walk-reverse", coords: coords.slice().reverse() },
        ], zoom);

        expect(deduped).toHaveLength(1);
        expect(deduped[0].id).toBe("walk-main");
    });

    it("좌표 샘플 수가 달라도 같은 도보 경로는 중복 제거한다", () => {
        const zoom = 18;
        const style = {
            color: "#1D72FF",
            width: 4.4,
            outlineColor: "#FFFFFF",
            outlineWidth: 0.66,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 12],
        };
        const deduped = dedupeCoveredNativeDashPathOverlays([
            {
                ...style,
                id: "walk-detailed",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    { latitude: 0, longitude: worldPixelLongitude(50, zoom) },
                    { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
                ],
            },
            {
                ...style,
                id: "walk-simple",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
                ],
            },
        ], zoom);

        expect(deduped.map((overlay) => overlay.id)).toEqual(["walk-detailed"]);
    });

    it("같은 geometry라도 강조도나 casing이 다른 도보선은 보존한다", () => {
        const zoom = 18;
        const coords = [
            { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
            { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
        ];
        const deduped = dedupeCoveredNativeDashPathOverlays([
            {
                id: "walk-base",
                coords,
                color: "#1D72FF",
                width: 4.4,
                opacity: 0.72,
                outlineColor: "#FFFFFF",
                outlineWidth: 0.66,
                outlineOpacity: 0.65,
                strokeStyle: "dash",
                renderMode: "native",
                dashPattern: [1, 12],
            },
            {
                id: "walk-highlight",
                coords,
                color: "#1D72FF",
                width: 4.4,
                opacity: 0.96,
                outlineColor: "#0F172A",
                outlineWidth: 0.66,
                outlineOpacity: 0.9,
                strokeStyle: "dash",
                renderMode: "native",
                dashPattern: [1, 12],
            },
        ], zoom);

        expect(deduped.map((overlay) => overlay.id)).toEqual([
            "walk-base",
            "walk-highlight",
        ]);
    });

    it("굵기가 다른 포커스 도보선을 긴 기본선으로 오인해 제거하지 않는다", () => {
        const zoom = 18;
        const coords = [
            { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
            { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
        ];
        const style = {
            color: "#1D72FF",
            opacity: 0.96,
            outlineColor: "#FFFFFF",
            outlineWidth: 0.66,
            outlineOpacity: 0.9,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 12],
        };
        const deduped = dedupeCoveredNativeDashPathOverlays([
            { ...style, id: "walk-base", coords, width: 4 },
            { ...style, id: "walk-focus", coords, width: 5, zIndex: 200 },
        ], zoom);

        expect(deduped.map((overlay) => overlay.id)).toEqual(["walk-base", "walk-focus"]);
    });

    it("끝점이 다른 실제 도보 분기와 solid 본선은 보존한다", () => {
        const zoom = 18;
        const walkStyle = {
            color: "#1D72FF",
            width: 4.4,
            outlineColor: "#FFFFFF",
            outlineWidth: 0.66,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 12],
        };
        const deduped = dedupeCoveredNativeDashPathOverlays([
            {
                ...walkStyle,
                id: "walk-main",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
                ],
            },
            {
                ...walkStyle,
                id: "walk-branch",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    {
                        latitude: worldPixelLongitude(24, zoom),
                        longitude: worldPixelLongitude(100, zoom),
                    },
                ],
            },
            {
                id: "ride-main",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
                ],
                color: "#1D72FF",
                strokeStyle: "solid" as const,
            },
        ], zoom);

        expect(deduped.map((overlay) => overlay.id)).toEqual([
            "walk-main",
            "walk-branch",
            "ride-main",
        ]);
    });

    it("시작과 끝이 같아도 중간 우회가 있는 도보 경로는 보존한다", () => {
        const zoom = 18;
        const style = {
            color: "#1D72FF",
            width: 4.4,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 12],
        };
        const deduped = dedupeCoveredNativeDashPathOverlays([
            {
                ...style,
                id: "walk-straight",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
                ],
            },
            {
                ...style,
                id: "walk-detour",
                coords: [
                    { latitude: 0, longitude: worldPixelLongitude(0, zoom) },
                    {
                        latitude: worldPixelLongitude(16, zoom),
                        longitude: worldPixelLongitude(48, zoom),
                    },
                    { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
                ],
            },
        ], zoom);

        expect(deduped.map((overlay) => overlay.id)).toEqual([
            "walk-straight",
            "walk-detour",
        ]);
    });

    it("긴 경로도 화면 안에서는 1/13 간격을 확대하지 않는다", () => {
        const counts = Array.from({ length: 13 }, (_, index) => index + 6).map((zoom) => {
            const expanded = expandNativeDashPathOverlay({
                id: `long-walk-z${zoom}`,
                coords: [
                    { latitude: 0, longitude: 0 },
                    { latitude: 0, longitude: worldPixelLongitude(10_000, zoom) },
                ],
                strokeStyle: "dash" as const,
                renderMode: "native" as const,
                dashPattern: [1, 13],
            }, zoom, {
                viewport: {
                    center: { latitude: 0, longitude: worldPixelLongitude(5_000, zoom) },
                    widthPx: 400,
                    heightPx: 200,
                    paddingPx: 0,
                },
            });

            expanded.flatMap((overlay) => overlay.coords).forEach((coord) => {
                expect(longitudeWorldPixel(coord.longitude, zoom)).toBeGreaterThanOrEqual(4_799.99);
                expect(longitudeWorldPixel(coord.longitude, zoom)).toBeLessThanOrEqual(5_200.01);
            });
            return expanded.length;
        });

        expect(new Set(counts)).toEqual(new Set([29]));
    });

    it("여러 긴 도보선은 전역 native 예산을 넘기지 않고 canvas 점으로 폴백한다", () => {
        const zoom = 17;
        const overlays = Array.from({ length: 3 }, (_, index) => ({
            id: `long-walk-${index}`,
            coords: [
                { latitude: index * 0.0001, longitude: 0 },
                { latitude: index * 0.0001, longitude: worldPixelLongitude(2_000, zoom) },
            ],
            color: "#1A73E8",
            width: 4.4,
            outlineColor: "#FFFFFF",
            outlineWidth: 0.66,
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 13],
        }));

        const expanded = expandNativeDashPathOverlays(overlays, zoom, {
            center: { latitude: 0, longitude: worldPixelLongitude(1_000, zoom) },
            widthPx: 2_100,
            heightPx: 300,
            paddingPx: 0,
        });
        const screenFallbacks = expanded.filter((overlay) => overlay.renderMode === "screen");
        const nativeFragments = expanded.filter((overlay) => (
            overlay.id.includes("--native-dash-") && overlay.renderMode !== "screen"
        ));

        expect(screenFallbacks).toHaveLength(2);
        expect(screenFallbacks.every((overlay) => overlay.shape === "dot")).toBe(true);
        expect(screenFallbacks.every((overlay) => overlay.dotSpacingPx === 14)).toBe(true);
        expect(nativeFragments.length).toBeLessThanOrEqual(240);
    });

    it("화면 밖의 native 도보 조각은 생성하지 않는다", () => {
        const zoom = 17;
        const expanded = expandNativeDashPathOverlay({
            id: "offscreen-walk",
            coords: [
                { latitude: 0, longitude: 0 },
                { latitude: 0, longitude: worldPixelLongitude(100, zoom) },
            ],
            strokeStyle: "dash" as const,
            renderMode: "native" as const,
            dashPattern: [1, 12],
        }, zoom, {
            viewport: {
                center: { latitude: 0, longitude: worldPixelLongitude(1_000, zoom) },
                widthPx: 100,
                heightPx: 100,
                paddingPx: 0,
            },
        });

        expect(expanded).toEqual([]);
    });

    it("solid와 screen overlay는 원본 참조를 유지한다", () => {
        const solid = {
            id: "route-subway-1",
            coords: [
                { latitude: 37.5, longitude: 127 },
                { latitude: 37.51, longitude: 127.01 },
            ],
            strokeStyle: "solid" as const,
        };
        const screen = {
            ...solid,
            id: "screen-walk",
            strokeStyle: "dash" as const,
            renderMode: "screen" as const,
            dashPattern: [12, 13],
        };

        expect(expandNativeDashPathOverlay(solid, 17)[0]).toBe(solid);
        expect(expandNativeDashPathOverlay(screen, 17)[0]).toBe(screen);
        expect(expandNativeDashPathOverlays([solid], 17)).toEqual([solid]);
    });
});

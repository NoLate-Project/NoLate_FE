jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import {
    addNativeDirectionScreenFallbacks,
    enqueueTmapCommand,
    readTmapNativeDirectionCapability,
    TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT,
    TMAP_NATIVE_DIRECTION_REPORT_SCRIPT,
    TMAP_NATIVE_STROKE_COLOR_SCRIPT,
} from "../src/modules/map/TmapMapView";

describe("Tmap initialization command queue", () => {
    it("초기화 전 지도 데이터는 가장 최신 명령만 남긴다", () => {
        let queue: string[] = [];
        queue = enqueueTmapCommand(queue, { type: "setData", payload: { route: "old" } });
        queue = enqueueTmapCommand(queue, { type: "resizeMap", payload: { reason: "layout" } });
        queue = enqueueTmapCommand(queue, { type: "setData", payload: { route: "latest" } });

        expect(queue).toHaveLength(2);
        expect(queue.map((item) => JSON.parse(item))).toEqual([
            { type: "resizeMap", payload: { reason: "layout" } },
            { type: "setData", payload: { route: "latest" } },
        ]);
    });

    it("사용자 카메라 명령의 순서는 보존한다", () => {
        let queue: string[] = [];
        queue = enqueueTmapCommand(queue, { type: "animateCamera", payload: { zoom: 15 } });
        queue = enqueueTmapCommand(queue, { type: "fitBounds", payload: { padding: 40 } });

        expect(queue.map((item) => JSON.parse(item).type)).toEqual([
            "animateCamera",
            "fitBounds",
        ]);
    });
});

type NativeStrokeColor = {
    color: string;
    alpha: number;
};

type NativeStrokePaint = NativeStrokeColor & {
    requestedOpacity: number;
    opacity: number;
};

type NormalizeNativeStrokeColor = (value: unknown, fallback: unknown) => NativeStrokeColor;
type ResolveNativeStrokePaint = (
    value: unknown,
    fallback: unknown,
    opacity: unknown,
    fallbackOpacity: unknown
) => NativeStrokePaint;

// WebView에 들어가는 스크립트와 같은 전역 함수 선언을 실제로 평가한다.
// eslint-disable-next-line no-new-func
const injectedHelpers = Function(
    TMAP_NATIVE_STROKE_COLOR_SCRIPT +
    "; return { normalizeNativeStrokeColor, resolveNativeStrokePaint };"
)() as {
    normalizeNativeStrokeColor: NormalizeNativeStrokeColor;
    resolveNativeStrokePaint: ResolveNativeStrokePaint;
};

const { normalizeNativeStrokeColor, resolveNativeStrokePaint } = injectedHelpers;

describe("Tmap native stroke color", () => {
    it("기존 hex와 rgb 색상은 불투명 RGB hex로 유지한다", () => {
        expect(normalizeNativeStrokeColor("#1D72FF", "#000000")).toEqual({
            color: "#1D72FF",
            alpha: 1,
        });
        expect(normalizeNativeStrokeColor("#abc", "#000000")).toEqual({
            color: "#aabbcc",
            alpha: 1,
        });
        expect(normalizeNativeStrokeColor("rgb(29, 114, 255)", "#000000")).toEqual({
            color: "#1d72ff",
            alpha: 1,
        });
    });

    it("rgba alpha와 명시적 opacity를 곱한다", () => {
        expect(resolveNativeStrokePaint("rgba(47, 123, 255, 0.18)", "#000000", 0.5, 1)).toEqual({
            color: "#2f7bff",
            alpha: 0.18,
            requestedOpacity: 0.5,
            opacity: 0.09,
        });
        const percentAlphaPaint = resolveNativeStrokePaint(
            "rgba(255, 255, 255, 70%)",
            "#000000",
            undefined,
            0.8
        );
        expect(percentAlphaPaint).toMatchObject({
            color: "#ffffff",
            alpha: 0.7,
            requestedOpacity: 0.8,
        });
        expect(percentAlphaPaint.opacity).toBeCloseTo(0.56);
    });

    it("#RGBA, #RRGGBBAA, transparent를 TMAP 색상과 alpha로 분리한다", () => {
        expect(normalizeNativeStrokeColor("#0f08", "#000000")).toEqual({
            color: "#00ff00",
            alpha: 136 / 255,
        });
        expect(normalizeNativeStrokeColor("#11223380", "#000000")).toEqual({
            color: "#112233",
            alpha: 128 / 255,
        });
        expect(resolveNativeStrokePaint("transparent", "#FFFFFF", 0.94, 1)).toEqual({
            color: "#000000",
            alpha: 0,
            requestedOpacity: 0.94,
            opacity: 0,
        });
    });

    it("유효하지 않은 값은 fallback을 사용하고 opacity 범위를 제한한다", () => {
        expect(resolveNativeStrokePaint("not-a-color", "#abc", 2, 1)).toEqual({
            color: "#aabbcc",
            alpha: 1,
            requestedOpacity: 1,
            opacity: 1,
        });
        expect(resolveNativeStrokePaint("rgba(1, 2, 3, 0.4)", "#000000", -1, 1).opacity).toBe(0);
    });

    it("WebView에 삽입되는 함수 문자열도 외부 의존성 없이 실행된다", () => {
        expect(resolveNativeStrokePaint("rgba(10,20,30,0.25)", "#000000", 0.8, 1)).toEqual({
            color: "#0a141e",
            alpha: 0.25,
            requestedOpacity: 0.8,
            opacity: 0.2,
        });
    });
});

describe("Tmap native direction fallback", () => {
    const ride = {
        id: "ride",
        coords: [
            { latitude: 37.56, longitude: 126.97 },
            { latitude: 37.5, longitude: 127.03 },
        ],
        strokeStyle: "solid" as const,
        renderMode: "native" as const,
        nativeDirection: true,
        nativeDirectionColor: "#FFFFFF",
        nativeDirectionOpacity: 0.96,
        zIndex: 40,
    };

    it("SDK drawInfo를 확인할 수 없으면 native 지원으로 추측하지 않는다", () => {
        expect(readTmapNativeDirectionCapability({})).toEqual({
            confirmed: false,
            supportsDirection: false,
            supportsDirectionColor: false,
            supportsDirectionOpacity: false,
        });
    });

    it("Vector JS의 고정 arrow pattern은 요청 색상을 저장해도 color 지원으로 보지 않는다", () => {
        expect(readTmapNativeDirectionCapability({
            _shape_data: {
                drawInfo: {
                    direction: true,
                    directionColor: "#ffffff",
                    directionOpacity: 0.001,
                },
                vsmStyle: {
                    "stroke-pattern": "PATTERN:arrow",
                },
            },
        })).toEqual({
            confirmed: true,
            supportsDirection: true,
            supportsDirectionColor: false,
            supportsDirectionOpacity: false,
        });

        expect(readTmapNativeDirectionCapability({
            _shape_data: { drawInfo: { direction: true } },
        })).toMatchObject({
            confirmed: false,
            supportsDirection: false,
            supportsDirectionColor: false,
            supportsDirectionOpacity: false,
        });
        expect(TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT).toContain("if (!drawInfo || !usesFixedArrowPattern)");
        expect(TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT).toContain("confirmed: false");
        expect(TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT).toContain("PATTERN:ARROW");
        expect(TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT).toContain("supportsDirectionColor: false");
    });

    it("Release HTML에서도 SDK 방향표시 판정 결과를 RN에 항상 전달한다", () => {
        const post = jest.fn();
        const nativeDirectionReport = {
            rows: [{ usableForRouteLine: false }],
        };
        // WebView에 삽입되는 실제 fragment를 Release 조건으로 실행한다.
        // eslint-disable-next-line no-new-func
        const runReportScript = Function(
            "post",
            "nativeDirectionReport",
            "isDevelopment",
            TMAP_NATIVE_DIRECTION_REPORT_SCRIPT
        );

        runReportScript(post, nativeDirectionReport, false);

        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith("tmapNativeDirectionReport", nativeDirectionReport);
        expect(TMAP_NATIVE_DIRECTION_REPORT_SCRIPT).not.toContain("isDevelopment");
    });

    it("SDK 판정과 관계없이 TMAP native direction overlay를 그대로 유지한다", () => {
        const overlays = [ride];

        expect(addNativeDirectionScreenFallbacks(overlays, undefined)).toBe(overlays);
        expect(addNativeDirectionScreenFallbacks(overlays, false)).toBe(overlays);
        expect(addNativeDirectionScreenFallbacks(overlays, true)).toBe(overlays);
        expect(ride.nativeDirection).toBe(true);
    });

    it("앱이 screen 화살표 overlay를 추가하지 않는다", () => {
        const overlays = [
            { ...ride, id: "walk", strokeStyle: "dash" as const },
            { ...ride, id: "screen", renderMode: "screen" as const },
            { ...ride, id: "disabled", nativeDirection: false },
        ];
        const result = addNativeDirectionScreenFallbacks(overlays, false);

        expect(result).toBe(overlays);
        expect(result.some((overlay) => overlay.id.includes("screen-direction-fallback"))).toBe(false);
    });
});

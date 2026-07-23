jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import {
    getTmapVectorMapType,
    getTmapVectorScriptUrl,
    isDuplicateTmapMapSelection,
    isValidWgs84Coordinate,
    TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS,
    TMAP_MAP_SELECTION_EVENTS,
    TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX,
    TMAP_VECTOR_JS_NAMESPACE,
    TMAP_VECTOR_JS_SCRIPT_VERSION,
} from "../src/modules/map/TmapMapView";

describe("Tmap map selection event", () => {
    it("Vector JS의 대소문자 구분 이벤트와 이동량을 검사하는 touch lifecycle을 사용한다", () => {
        expect(TMAP_MAP_SELECTION_EVENTS).toEqual({
            click: "Click",
            touchStart: "TouchStart",
            touchMove: ["TouchMove", "DragStart", "Drag", "DragEnd"],
            touchCancel: ["TouchCancel", "ZoomStart", "Zoom"],
            touchEnd: "TouchEnd",
        });
        expect(TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX).toBeGreaterThan(0);
    });

    it("Raster v2 대신 Vector JS v3 로더와 공식 map type을 사용한다", () => {
        expect(TMAP_VECTOR_JS_SCRIPT_VERSION).toBe("vectorjs?version=1");
        expect(TMAP_VECTOR_JS_NAMESPACE).toBe("Tmapv3");
        expect(getTmapVectorScriptUrl("key with space")).toBe(
            "https://apis.openapi.sk.com/tmap/vectorjs?version=1&appKey=key%20with%20space"
        );
        expect(getTmapVectorMapType(false)).toBe("ROAD");
        expect(getTmapVectorMapType(true)).toBe("NIGHT");
    });

    it("같은 물리 탭에서 연이어 온 touch/click 선택은 한 번으로 합친다", () => {
        const previous = { latitude: 37.4933, longitude: 126.9299, timestampMs: 1_000 };

        expect(isDuplicateTmapMapSelection(previous, {
            latitude: 37.49331,
            longitude: 126.92991,
            timestampMs: 1_000 + TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS,
        })).toBe(true);
        expect(isDuplicateTmapMapSelection(previous, {
            latitude: 37.4933,
            longitude: 126.9299,
            timestampMs: 1_001 + TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS,
        })).toBe(false);
        expect(isDuplicateTmapMapSelection(previous, {
            latitude: 37.494,
            longitude: 126.931,
            timestampMs: 1_100,
        })).toBe(false);
    });

    it("선택 콜백으로 전달할 WGS84 좌표 범위를 검증한다", () => {
        expect(isValidWgs84Coordinate(37.4933, 126.9299)).toBe(true);
        expect(isValidWgs84Coordinate(91, 126.9299)).toBe(false);
        expect(isValidWgs84Coordinate(37.4933, 181)).toBe(false);
        expect(isValidWgs84Coordinate(Number.NaN, 126.9299)).toBe(false);
    });
});

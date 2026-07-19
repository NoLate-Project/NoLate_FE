jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(() => undefined),
}));

import {
    isDuplicateTmapMapSelection,
    isValidWgs84Coordinate,
    TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS,
    TMAP_MAP_SELECTION_EVENTS,
    TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX,
} from "../src/modules/map/TmapMapView";

describe("Tmap map selection event", () => {
    it("데스크톱 click과 이동량을 검사하는 모바일 touch lifecycle을 사용한다", () => {
        expect(TMAP_MAP_SELECTION_EVENTS).toEqual({
            click: "click",
            touchStart: "touchstart",
            touchMove: ["touchmove", "dragstart", "drag", "dragend"],
            touchCancel: ["zoomstart", "zoom_changed", "gesturestart"],
            touchEnd: "touchend",
        });
        expect(TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX).toBeGreaterThan(0);
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

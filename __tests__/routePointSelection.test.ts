import {
    getMapPickedPlaceFallbackName,
    resolveDefaultOriginUiUpdate,
    resolveInitialRoutePointTarget,
    resolveNextMissingRoutePointTarget,
    shouldShowExistingMapPickerMarker,
    shouldShowRoutePointSearchResults,
} from "../src/modules/schedule/routePointSelection";

describe("route point selection priority", () => {
    test("지도에서 새 좌표를 고르면 이전 장소명 대신 대상별 임시 이름을 쓴다", () => {
        expect(getMapPickedPlaceFallbackName("origin")).toBe("지도에서 선택한 출발지");
        expect(getMapPickedPlaceFallbackName("destination")).toBe("지도에서 선택한 도착지");
    });

    test("지도에서 새 위치를 탭하면 같은 대상의 이전 핀만 새 선택 핀으로 교체한다", () => {
        expect(shouldShowExistingMapPickerMarker("destination", "destination", false)).toBe(true);
        expect(shouldShowExistingMapPickerMarker("destination", "destination", true)).toBe(false);
        expect(shouldShowExistingMapPickerMarker("origin", "destination", true)).toBe(true);
        expect(shouldShowExistingMapPickerMarker("origin", "origin", true)).toBe(false);
        expect(shouldShowExistingMapPickerMarker("destination", "origin", true)).toBe(true);
    });

    test("빠른 일정이 목적지 이름을 넘기면 목적지를 먼저 확정한다", () => {
        expect(resolveInitialRoutePointTarget(
            { name: "서울역" },
            { name: "금천구청역" }
        )).toBe("destination");
    });

    test("목적지 정보가 없을 때만 출발지부터 시작한다", () => {
        expect(resolveInitialRoutePointTarget(undefined, undefined)).toBe("origin");
    });

    test("사용자가 명시적으로 고른 편집 지점은 우선한다", () => {
        expect(resolveInitialRoutePointTarget(
            undefined,
            { name: "금천구청역" },
            "origin"
        )).toBe("origin");
    });

    test("목적지를 선택한 뒤 출발지가 없을 때만 출발지로 이어간다", () => {
        expect(resolveNextMissingRoutePointTarget("destination", false, true)).toBe("origin");
        expect(resolveNextMissingRoutePointTarget("destination", true, true)).toBeNull();
    });

    test.each([
        { searching: true, hasSearchAttempt: true, resultCount: 0 },
        { searching: false, hasSearchAttempt: true, resultCount: 0 },
        { searching: false, hasSearchAttempt: true, resultCount: 3 },
    ])("자동 목적지 검색을 시작한 뒤에는 0건과 오류 상태도 검색 결과 영역에 유지한다", (state) => {
        expect(shouldShowRoutePointSearchResults({
            isEditingRoutePoint: true,
            hasTypedSearchQuery: false,
            ...state,
        })).toBe(true);
    });

    test("검색 전 빈 입력일 때만 최근 검색을 보여준다", () => {
        expect(shouldShowRoutePointSearchResults({
            isEditingRoutePoint: true,
            searching: false,
            hasTypedSearchQuery: false,
            hasSearchAttempt: false,
            resultCount: 0,
        })).toBe(false);
    });

    test("기본 출발지 응답 전에 사용자가 목적지를 확정하면 현재 편집 상태를 건드리지 않는다", () => {
        expect(resolveDefaultOriginUiUpdate({
            requestUiRevision: 3,
            currentUiRevision: 4,
            destinationHasCoordinates: true,
        })).toBeNull();
    });

    test("사용자 상호작용이 없으면 현재 목적지 좌표를 기준으로 검색을 마친다", () => {
        expect(resolveDefaultOriginUiUpdate({
            requestUiRevision: 3,
            currentUiRevision: 3,
            destinationHasCoordinates: true,
        })).toEqual({
            activeTarget: "destination",
            isEditingRoutePoint: false,
        });
    });

    test("목적지가 아직 미확정이면 기본 출발지를 적용한 뒤 목적지 편집을 유지한다", () => {
        expect(resolveDefaultOriginUiUpdate({
            requestUiRevision: 3,
            currentUiRevision: 3,
            destinationHasCoordinates: false,
        })).toEqual({
            activeTarget: "destination",
            isEditingRoutePoint: true,
        });
    });
});

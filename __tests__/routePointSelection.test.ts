import {
    createMapPickerSessionState,
    getMapPickedPlaceFallbackName,
    resolveMapPickerCommit,
    resolveMapPickerPostCommitTransition,
    resolveDefaultOriginUiUpdate,
    resolveInitialRoutePointTarget,
    resolveNextMissingRoutePointTarget,
    selectMapPickerSessionCoordinate,
    shouldShowRoutePointSearchResults,
} from "../src/modules/schedule/routePointSelection";

describe("route point selection priority", () => {
    test("지도에서 새 좌표를 고르면 이전 장소명 대신 대상별 임시 이름을 쓴다", () => {
        expect(getMapPickedPlaceFallbackName("origin")).toBe("지도에서 선택한 출발지");
        expect(getMapPickedPlaceFallbackName("destination")).toBe("지도에서 선택한 도착지");
    });

    test("지도 선택 핀을 옮겨도 탐색 중인 카메라를 강제로 재중앙화하지 않는다", () => {
        const initial = { latitude: 37.5547, longitude: 126.9707 };
        const picked = { latitude: 37.4933, longitude: 126.9299 };
        const opened = createMapPickerSessionState(initial);
        const selected = selectMapPickerSessionCoordinate(opened, picked);

        expect(selected.cameraCoordinate).toEqual(initial);
        expect(selected.pickedCoordinate).toEqual(picked);
        expect(selected.hasSelection).toBe(true);
        expect(opened.hasSelection).toBe(false);
    });

    test("현재 대상에 기존 좌표가 있으면 지도 재선택 즉시 그 위치를 사용할 수 있다", () => {
        const existing = { latitude: 37.5547, longitude: 126.9707 };

        expect(createMapPickerSessionState(existing, true)).toEqual({
            cameraCoordinate: existing,
            pickedCoordinate: existing,
            hasSelection: true,
        });
        expect(createMapPickerSessionState(existing)).toEqual({
            cameraCoordinate: existing,
            pickedCoordinate: undefined,
            hasSelection: false,
        });
    });

    test("지도에서 고른 같은 좌표를 출발지 또는 도착지로 확정할 수 있다", () => {
        const picked = { latitude: 37.5663, longitude: 126.9779 };
        const session = selectMapPickerSessionCoordinate(
            createMapPickerSessionState(picked),
            picked
        );

        expect(resolveMapPickerCommit(session, "origin", false)).toEqual({
            coordinate: picked,
            target: "origin",
        });
        expect(resolveMapPickerCommit(session, "destination", false)).toEqual({
            coordinate: picked,
            target: "destination",
        });
    });

    test("좌표가 없거나 주소를 확인 중이면 출발지와 도착지 모두 확정하지 않는다", () => {
        const emptySession = createMapPickerSessionState({
            latitude: 37.5663,
            longitude: 126.9779,
        });
        const selectedSession = selectMapPickerSessionCoordinate(emptySession, {
            latitude: 37.5658,
            longitude: 126.9768,
        });

        expect(resolveMapPickerCommit(emptySession, "origin", false)).toBeNull();
        expect(resolveMapPickerCommit(emptySession, "destination", false)).toBeNull();
        expect(resolveMapPickerCommit(selectedSession, "origin", true)).toBeNull();
        expect(resolveMapPickerCommit(selectedSession, "destination", true)).toBeNull();
    });

    test.each([
        { selectedTarget: "origin" as const, nextTarget: "destination" as const },
        { selectedTarget: "destination" as const, nextTarget: "origin" as const },
    ])("첫 $selectedTarget 확정 뒤에는 지도에 남아 반대 지점을 새로 고른다", ({
        selectedTarget,
        nextTarget,
    }) => {
        const camera = { latitude: 37.5663, longitude: 126.9779 };
        const picked = { latitude: 37.5658, longitude: 126.9768 };
        const session = selectMapPickerSessionCoordinate(
            createMapPickerSessionState(camera),
            picked
        );

        const transition = resolveMapPickerPostCommitTransition(
            session,
            selectedTarget,
            false,
            false
        );

        expect(transition.nextTarget).toBe(nextTarget);
        expect(transition.keepPickerOpen).toBe(true);
        expect(transition.nextSession).toEqual({
            cameraCoordinate: camera,
            pickedCoordinate: undefined,
            hasSelection: false,
        });
    });

    test.each([
        { selectedTarget: "destination" as const, originHadCoordinates: true, destinationHadCoordinates: false },
        { selectedTarget: "origin" as const, originHadCoordinates: false, destinationHadCoordinates: true },
        { selectedTarget: "origin" as const, originHadCoordinates: true, destinationHadCoordinates: true },
        { selectedTarget: "destination" as const, originHadCoordinates: true, destinationHadCoordinates: true },
    ])("두 지점이 완성되는 $selectedTarget 확정 뒤에는 지도를 닫는다", ({
        selectedTarget,
        originHadCoordinates,
        destinationHadCoordinates,
    }) => {
        const existing = { latitude: 37.5663, longitude: 126.9779 };
        const session = createMapPickerSessionState(existing, true);

        const transition = resolveMapPickerPostCommitTransition(
            session,
            selectedTarget,
            originHadCoordinates,
            destinationHadCoordinates
        );

        expect(transition.nextTarget).toBeNull();
        expect(transition.keepPickerOpen).toBe(false);
        expect(transition.nextSession).toBe(session);
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

    test("출발지를 재선택해도 기존 도착지가 있으면 결과 화면으로 돌아간다", () => {
        expect(resolveNextMissingRoutePointTarget("origin", true, false)).toBe("destination");
        expect(resolveNextMissingRoutePointTarget("origin", true, true)).toBeNull();
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

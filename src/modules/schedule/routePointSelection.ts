import type { Place } from "./types";

export type RoutePointTarget = "origin" | "destination";

export type MapPickerCoordinate = {
    latitude: number;
    longitude: number;
};

export type MapPickerSessionState = {
    cameraCoordinate?: MapPickerCoordinate;
    pickedCoordinate?: MapPickerCoordinate;
    hasSelection: boolean;
};

export type MapPickerCommit = {
    coordinate: MapPickerCoordinate;
    target: RoutePointTarget;
};

export type MapPickerPostCommitTransition = {
    nextTarget: RoutePointTarget | null;
    keepPickerOpen: boolean;
    nextSession: MapPickerSessionState;
};

export type RoutePointSearchVisibilityInput = {
    isEditingRoutePoint: boolean;
    searching: boolean;
    hasTypedSearchQuery: boolean;
    hasSearchAttempt: boolean;
    resultCount: number;
};

export type DefaultOriginUiUpdateInput = {
    requestUiRevision: number;
    currentUiRevision: number;
    destinationHasCoordinates: boolean;
    forcedTarget?: RoutePointTarget;
};

export type DefaultOriginUiUpdate = {
    activeTarget: "destination";
    isEditingRoutePoint: boolean;
};

/** 역지오코딩이 끝나기 전이나 실패했을 때 예전 장소명이 새 좌표에 남지 않게 한다. */
export function getMapPickedPlaceFallbackName(target: RoutePointTarget): string {
    return target === "origin" ? "지도에서 선택한 출발지" : "지도에서 선택한 도착지";
}

/** 지도 탐색 카메라와 사용자가 탭한 선택 좌표를 서로 독립적으로 유지한다. */
export function createMapPickerSessionState(
    initialCoordinate?: MapPickerCoordinate,
    useInitialCoordinate = false
): MapPickerSessionState {
    const hasInitialSelection = Boolean(initialCoordinate && useInitialCoordinate);
    return {
        cameraCoordinate: initialCoordinate,
        pickedCoordinate: hasInitialSelection ? initialCoordinate : undefined,
        hasSelection: hasInitialSelection,
    };
}

/** 새 핀만 옮기고 현재 카메라 중심/줌은 건드리지 않는다. */
export function selectMapPickerSessionCoordinate(
    session: MapPickerSessionState,
    coordinate: MapPickerCoordinate
): MapPickerSessionState {
    return {
        ...session,
        pickedCoordinate: coordinate,
        hasSelection: true,
    };
}

/** 좌표가 확정되고 주소 확인도 끝난 경우에만 선택한 출발/도착 지점으로 적용한다. */
export function resolveMapPickerCommit(
    session: MapPickerSessionState,
    target: RoutePointTarget,
    resolving: boolean
): MapPickerCommit | null {
    if (
        resolving ||
        !session.hasSelection ||
        !session.pickedCoordinate
    ) {
        return null;
    }
    return {
        coordinate: session.pickedCoordinate,
        target,
    };
}

function hasCoordinates(place?: Place): boolean {
    return typeof place?.lat === "number" && typeof place?.lng === "number";
}

function hasPlaceText(place?: Place): boolean {
    return Boolean(place?.name?.trim() || place?.address?.trim());
}

/** 빠른 일정에서는 사용자가 입력한 목적지를 먼저 확정한다. */
export function resolveInitialRoutePointTarget(
    origin?: Place,
    destination?: Place,
    forcedTarget?: RoutePointTarget
): RoutePointTarget {
    if (forcedTarget) return forcedTarget;
    if (!hasCoordinates(destination) && hasPlaceText(destination)) return "destination";
    if (!hasCoordinates(origin)) return "origin";
    return "destination";
}

/** 한 지점을 선택한 뒤 아직 좌표가 없는 반대 지점으로만 이어간다. */
export function resolveNextMissingRoutePointTarget(
    selectedTarget: RoutePointTarget,
    originHasCoordinates: boolean,
    destinationHasCoordinates: boolean
): RoutePointTarget | null {
    if (selectedTarget === "destination" && !originHasCoordinates) return "origin";
    if (selectedTarget === "origin" && !destinationHasCoordinates) return "destination";
    return null;
}

/** 첫 지점만 정해졌다면 지도에 남아 반대 지점을 고르도록 후보 좌표를 초기화한다. */
export function resolveMapPickerPostCommitTransition(
    session: MapPickerSessionState,
    selectedTarget: RoutePointTarget,
    originHadCoordinates: boolean,
    destinationHadCoordinates: boolean
): MapPickerPostCommitTransition {
    const nextTarget = resolveNextMissingRoutePointTarget(
        selectedTarget,
        originHadCoordinates || selectedTarget === "origin",
        destinationHadCoordinates || selectedTarget === "destination"
    );
    const keepPickerOpen = nextTarget !== null;
    return {
        nextTarget,
        keepPickerOpen,
        nextSession: keepPickerOpen
            ? createMapPickerSessionState(session.cameraCoordinate)
            : session,
    };
}

/** 자동 검색도 한 번 시작했다면 0건/오류 결과를 최근 검색으로 덮지 않는다. */
export function shouldShowRoutePointSearchResults({
    isEditingRoutePoint,
    searching,
    hasTypedSearchQuery,
    hasSearchAttempt,
    resultCount,
}: RoutePointSearchVisibilityInput): boolean {
    if (!isEditingRoutePoint) return false;
    return searching || hasTypedSearchQuery || hasSearchAttempt || resultCount > 0;
}

/**
 * 기본 출발지 조회를 시작한 뒤 사용자가 장소 선택 UI를 움직였다면 그 최신 의도를 보존한다.
 * 사용자 상호작용이 없었던 경우에만 기본 출발지를 반영한 다음 목적지 상태로 이어간다.
 */
export function resolveDefaultOriginUiUpdate({
    requestUiRevision,
    currentUiRevision,
    destinationHasCoordinates,
    forcedTarget,
}: DefaultOriginUiUpdateInput): DefaultOriginUiUpdate | null {
    if (forcedTarget === "origin" || currentUiRevision !== requestUiRevision) return null;

    return {
        activeTarget: "destination",
        isEditingRoutePoint: forcedTarget === "destination" || !destinationHasCoordinates,
    };
}

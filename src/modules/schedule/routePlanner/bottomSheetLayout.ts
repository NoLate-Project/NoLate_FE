import { getTransitDetailScrollViewportHeight } from "../transitDetailPresentation";

/** 바텀시트가 멈출 수 있는 화면 상태입니다. */
export type BottomSheetSnap = "expanded" | "middle" | "collapsed" | "hidden";

export const BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT = 30;
export const TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT = 26;
export const TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT = 72;
export const TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING = 8;
export const TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT = 46;
export const TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT = 40;

const BOTTOM_SHEET_HANDLE_PEEK_HEIGHT = BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT;
const BOTTOM_SHEET_COLLAPSED_VISIBLE_RATIO = 0.2;
const TRANSIT_DETAIL_MIDDLE_VISIBLE_RATIO = 0.5;
const TRANSIT_DETAIL_COLLAPSED_VISIBLE_BASE_HEIGHT = 76;
const BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION = 180;
const BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD = 0.45;

export type RoutePlannerBottomSheetLayoutInput = {
    bottomPanelHeight: number;
    transitActionBarHeight: number;
    hasBottomSheetMeasured: boolean;
    bottomSheetAnimatedOffset: number;
    bottomSheetSnap: BottomSheetSnap;
    isBottomSheetHidden: boolean;
    isRouteDetailMode: boolean;
    windowHeight: number;
    safeAreaTop: number;
    safeAreaBottom: number;
};

export type RoutePlannerBottomSheetLayout = {
    transitDetailActionBarPaddingBottom: number;
    transitDetailActionBarEstimatedHeight: number;
    bottomPanelMaxHeight: number;
    bottomSheetPeekHeight: number;
    bottomSheetCollapsedOffset: number;
    bottomSheetMiddleOffset: number;
    bottomSheetExpandedOffset: number;
    bottomSheetHiddenOffset: number;
    bottomSheetDragMinOffset: number;
    bottomSheetDragMaxOffset: number;
    canScrollBottomSheetContent: boolean;
    transitDetailActionBarReserveHeight: number;
    visibleBottomSheetHeight: number;
    bottomPanelScrollViewportHeight?: number;
    bottomPanelScrollBottomPadding: number;
    transitMapBottomOcclusionHeight: number;
};

/**
 * 화면 크기와 현재 시트 상태를 바탕으로 바텀시트의 모든 파생 치수를 계산합니다.
 *
 * 화면 컴포넌트에서 서로 의존하는 높이 계산을 분리해, 카메라 여백·스크롤 viewport·드래그
 * 범위가 항상 같은 기준을 사용하게 합니다. 반환값은 픽셀 단위이며 React 상태를 변경하지 않는
 * 순수 계산 결과이므로 화면 회전이나 safe-area 변경 때 다시 호출해도 부작용이 없습니다.
 */
export function getRoutePlannerBottomSheetLayout({
    bottomPanelHeight,
    transitActionBarHeight,
    hasBottomSheetMeasured,
    bottomSheetAnimatedOffset,
    bottomSheetSnap,
    isBottomSheetHidden,
    isRouteDetailMode,
    windowHeight,
    safeAreaTop,
    safeAreaBottom,
}: RoutePlannerBottomSheetLayoutInput): RoutePlannerBottomSheetLayout {
    const transitDetailActionBarPaddingBottom = Math.max(safeAreaBottom - 4, 8);
    const transitDetailActionBarEstimatedHeight = Math.max(
        TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
        TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING +
        TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT +
        transitDetailActionBarPaddingBottom +
        (bottomSheetSnap === "collapsed" ? TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT : 0)
    );

    const bottomPanelMaxHeight = isRouteDetailMode
        ? Math.min(
            520,
            Math.max(300, windowHeight - Math.max(safeAreaTop + 104, 132)),
            Math.max(340, Math.round(windowHeight * 0.56))
        )
        : Math.min(560, Math.max(300, windowHeight - Math.max(safeAreaTop + 104, 140)));

    const bottomSheetPeekHeight = BOTTOM_SHEET_HANDLE_PEEK_HEIGHT;
    const bottomSheetCollapsedVisibleHeight = getCollapsedVisibleHeight({
        bottomPanelHeight,
        bottomSheetPeekHeight,
        isRouteDetailMode,
        safeAreaBottom,
    });
    const bottomSheetCollapsedOffset = Math.max(0, bottomPanelHeight - bottomSheetCollapsedVisibleHeight);
    const bottomSheetMiddleOffset = getMiddleOffset({
        bottomPanelHeight,
        bottomSheetCollapsedOffset,
        isRouteDetailMode,
    });
    const bottomSheetExpandedOffset = getExpandedOffset({
        bottomPanelHeight,
        bottomSheetCollapsedOffset,
        isRouteDetailMode,
        safeAreaTop,
        windowHeight,
    });
    const bottomSheetHiddenOffset = hasBottomSheetMeasured
        ? Math.max(320, bottomPanelHeight + safeAreaBottom + 32)
        : 420;
    const bottomSheetDragMinOffset = bottomSheetExpandedOffset;
    const bottomSheetDragMaxOffset = bottomSheetCollapsedOffset;
    const canScrollBottomSheetContent =
        bottomSheetSnap === "expanded" ||
        (isRouteDetailMode && bottomSheetSnap === "middle");
    const transitDetailActionBarReserveHeight = isRouteDetailMode
        ? Math.max(transitActionBarHeight, transitDetailActionBarEstimatedHeight)
        : 0;

    const visibleBottomSheetHeight = bottomPanelHeight > 0
        ? Math.max(
            0,
            bottomPanelHeight - (
                isBottomSheetHidden
                    ? bottomSheetHiddenOffset
                    : Math.min(
                        bottomSheetHiddenOffset,
                        Math.max(bottomSheetDragMinOffset, bottomSheetAnimatedOffset)
                    )
            )
        )
        : bottomPanelMaxHeight;
    const bottomPanelScrollViewportHeight = isRouteDetailMode
        ? getTransitDetailScrollViewportHeight(
            visibleBottomSheetHeight,
            transitDetailActionBarReserveHeight,
            TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT
        )
        : undefined;
    const bottomPanelScrollBottomPadding = isRouteDetailMode ? 34 : Math.max(safeAreaBottom + 8, 12);

    // 접힌 상세 화면에서는 시트보다 하단 요약·버튼 바가 더 높을 수 있으므로 카메라를
    // 실제로 더 많이 가리는 쪽을 기준으로 지도 하단 여백을 계산한다.
    const transitMapBottomOcclusionHeight = isRouteDetailMode && !isBottomSheetHidden
        ? Math.max(visibleBottomSheetHeight, transitDetailActionBarReserveHeight)
        : visibleBottomSheetHeight;

    return {
        transitDetailActionBarPaddingBottom,
        transitDetailActionBarEstimatedHeight,
        bottomPanelMaxHeight,
        bottomSheetPeekHeight,
        bottomSheetCollapsedOffset,
        bottomSheetMiddleOffset,
        bottomSheetExpandedOffset,
        bottomSheetHiddenOffset,
        bottomSheetDragMinOffset,
        bottomSheetDragMaxOffset,
        canScrollBottomSheetContent,
        transitDetailActionBarReserveHeight,
        visibleBottomSheetHeight,
        bottomPanelScrollViewportHeight,
        bottomPanelScrollBottomPadding,
        transitMapBottomOcclusionHeight,
    };
}

/** 상세/편집 화면별로 접힌 상태에서 남겨 둘 시트 높이를 결정합니다. */
function getCollapsedVisibleHeight({
    bottomPanelHeight,
    bottomSheetPeekHeight,
    isRouteDetailMode,
    safeAreaBottom,
}: {
    bottomPanelHeight: number;
    bottomSheetPeekHeight: number;
    isRouteDetailMode: boolean;
    safeAreaBottom: number;
}): number {
    if (bottomPanelHeight <= 0) return bottomSheetPeekHeight;
    if (isRouteDetailMode) {
        return Math.min(
            bottomPanelHeight,
            Math.max(bottomSheetPeekHeight, TRANSIT_DETAIL_COLLAPSED_VISIBLE_BASE_HEIGHT + safeAreaBottom)
        );
    }
    return Math.max(bottomSheetPeekHeight, Math.round(bottomPanelHeight * BOTTOM_SHEET_COLLAPSED_VISIBLE_RATIO));
}

/** 상세 시트와 편집 시트의 서로 다른 중간 snap 비율을 offset으로 변환합니다. */
function getMiddleOffset({
    bottomPanelHeight,
    bottomSheetCollapsedOffset,
    isRouteDetailMode,
}: {
    bottomPanelHeight: number;
    bottomSheetCollapsedOffset: number;
    isRouteDetailMode: boolean;
}): number {
    if (!isRouteDetailMode) return Math.round(bottomSheetCollapsedOffset * 0.52);
    if (bottomPanelHeight <= 0) return Math.round(bottomSheetCollapsedOffset * 0.45);
    const targetOffset = Math.max(0, Math.round(bottomPanelHeight * (1 - TRANSIT_DETAIL_MIDDLE_VISIBLE_RATIO)));
    return Math.min(bottomSheetCollapsedOffset, targetOffset);
}

/** 확장된 시트가 상단 경로 헤더를 침범하지 않는 최소 translate offset을 계산합니다. */
function getExpandedOffset({
    bottomPanelHeight,
    bottomSheetCollapsedOffset,
    isRouteDetailMode,
    safeAreaTop,
    windowHeight,
}: {
    bottomPanelHeight: number;
    bottomSheetCollapsedOffset: number;
    isRouteDetailMode: boolean;
    safeAreaTop: number;
    windowHeight: number;
}): number {
    if (!isRouteDetailMode) return 0;
    const routeHeaderBottom = Math.max(safeAreaTop + 84, 110);
    const naturalPanelTop = windowHeight - bottomPanelHeight;
    const safeExpandedOffset = Math.max(0, Math.ceil(routeHeaderBottom - naturalPanelTop));
    return Math.min(bottomSheetCollapsedOffset, safeExpandedOffset);
}

/**
 * 현재 snap 상태에 대응하는 `translateY` 목표값을 반환합니다.
 *
 * 편집 화면에는 실제 중간 상태가 없으므로 `middle` 요청을 접힌 위치로 안전하게 매핑합니다.
 */
export function getBottomSheetSnapTarget(
    snap: BottomSheetSnap,
    layout: Pick<
        RoutePlannerBottomSheetLayout,
        | "bottomSheetHiddenOffset"
        | "bottomSheetExpandedOffset"
        | "bottomSheetMiddleOffset"
        | "bottomSheetCollapsedOffset"
    >,
    isRouteDetailMode: boolean
): number {
    if (snap === "hidden") return layout.bottomSheetHiddenOffset;
    if (snap === "expanded") return layout.bottomSheetExpandedOffset;
    if (snap === "middle") {
        return isRouteDetailMode ? layout.bottomSheetMiddleOffset : layout.bottomSheetCollapsedOffset;
    }
    return layout.bottomSheetCollapsedOffset;
}

/**
 * 드래그가 끝난 위치와 속도를 가장 자연스러운 snap 상태로 변환합니다.
 *
 * 빠른 제스처는 방향을 우선하고 느린 제스처는 예상 이동 지점과 가장 가까운 snap을 고릅니다.
 * 편집 화면은 확장/접힘 두 단계, 상세 화면은 확장/중간/접힘 세 단계를 사용합니다.
 */
export function getBottomSheetSnapFromGesture({
    current,
    velocityY,
    isRouteDetailMode,
    bottomSheetCollapsedOffset,
    bottomSheetExpandedOffset,
    bottomSheetMiddleOffset,
    bottomSheetDragMaxOffset,
}: {
    current: number;
    velocityY: number;
    isRouteDetailMode: boolean;
    bottomSheetCollapsedOffset: number;
    bottomSheetExpandedOffset: number;
    bottomSheetMiddleOffset: number;
    bottomSheetDragMaxOffset: number;
}): BottomSheetSnap {
    if (bottomSheetCollapsedOffset <= 0) return "collapsed";
    if (!isRouteDetailMode) {
        const midpoint = bottomSheetExpandedOffset +
            ((bottomSheetCollapsedOffset - bottomSheetExpandedOffset) * 0.52);
        const projected = current + (velocityY * BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION);

        if (velocityY <= -BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) return "expanded";
        if (velocityY >= BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) return "collapsed";
        return projected >= midpoint ? "collapsed" : "expanded";
    }

    if (velocityY <= -BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) {
        return current > bottomSheetMiddleOffset ? "middle" : "expanded";
    }
    if (velocityY >= BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) {
        return current < bottomSheetMiddleOffset ? "middle" : "collapsed";
    }

    const projected = Math.min(
        Math.max(bottomSheetExpandedOffset, current + (velocityY * BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION)),
        bottomSheetDragMaxOffset
    );
    const snapPoints: Array<{ snap: BottomSheetSnap; value: number }> = [
        { snap: "expanded", value: bottomSheetExpandedOffset },
        { snap: "middle", value: bottomSheetMiddleOffset },
        { snap: "collapsed", value: bottomSheetCollapsedOffset },
    ];
    return snapPoints.reduce((nearest, candidate) => (
        Math.abs(candidate.value - projected) < Math.abs(nearest.value - projected)
            ? candidate
            : nearest
    )).snap;
}

import {
    useCallback,
    useLayoutEffect,
} from "react";
import type { LayoutChangeEvent } from "react-native";
import type { DetailMonthSwipeDirection } from "../../calendarMotion";
import { shiftCalendarMonth } from "../../calendarNavigation";
import {
    DETAIL_MONTH_PAGER_POSITIONS,
    getCalendarDayFromSelectionKey,
} from "./scheduleCalendarModel";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";

type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;

type UseDetailMonthGestureSettlingParams = {
    calendarState: ScheduleCalendarState;
    commitController: DetailMonthCommitController;
    headerOffset: number;
    onRegisterDetailMonthMotionShift?: (
        shift: ((direction: DetailMonthSwipeDirection) => void) | null
    ) => void;
};

/**
 * 상세 월 제스처의 뷰포트 측정과 연속 스와이프 정착 세대를 관리한다.
 * UI 스레드가 확정한 선택 일자를 다음 월 이동 기준으로 보존하고, 마지막 제스처가
 * 끝났을 때만 유휴 커밋을 예약한다.
 */
export function useDetailMonthGestureSettling({
    calendarState,
    commitController,
    headerOffset,
    onRegisterDetailMonthMotionShift,
}: UseDetailMonthGestureSettlingParams) {
    const {
        detailMonthVisualAnchorDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        setDetailMonthViewportWidth,
        setDetailMonthViewportLayoutHeight,
        detailMonthViewportHeight,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureSettleGeneration,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthVisualMonthOrdinal,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthContinuousCommitPending,
        detailMonthPreviewedDayRef,
        detailMonthSuppressedCommitRef,
        onCommitDetailMonthRef,
        detailMonthPageLayoutsRef,
    } = calendarState;
    const {
        setDetailMonthMotionOwnershipActive,
        emitDetailMonthPreview,
        commitDetailMonthControlledState,
        holdDetailMonthContinuousCommit,
        scheduleDetailMonthContinuousCommit,
    } = commitController;
    /** 실제 뷰포트 크기를 공유값과 React 상태에 반영하고 레이아웃 정보가 없으면 슬롯 높이를 보정한다. */
    const handleDetailMonthViewportLayout = useCallback((
        event: LayoutChangeEvent
    ) => {
        const { width, height } = event.nativeEvent.layout;
        if (Number.isFinite(height) && height > 0) {
            detailMonthViewportHeight.value = height;
            setDetailMonthViewportLayoutHeight((current) => (
                Math.abs(current - height) < 0.5 ? current : height
            ));
            if (!detailMonthPageLayoutsRef.current) {
                detailMonthPagerSlotPageHeights.value =
                    detailMonthPagerSlotPageHeights.value.map(
                        () => height
                    );
                detailMonthPagerSlotCalendarHeights.value =
                    detailMonthPagerSlotCalendarHeights.value.map(
                        () => height + Math.max(0, headerOffset)
                    );
            }
        }
        if (
            !Number.isFinite(width)
            || width <= 0
        ) return;

        setDetailMonthViewportWidth((current) => (
            Math.abs(current - width) < 0.5
                ? current
                : width
        ));
    }, [
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPageLayoutsRef,
        detailMonthViewportHeight,
        headerOffset,
        setDetailMonthViewportLayoutHeight,
        setDetailMonthViewportWidth,
    ]);

    /** UI 스레드가 정한 목표 일자를 시각 앵커로 승격하고 연속 커밋 묶음을 시작한다. */
    const beginDetailMonthGestureSettle = useCallback((
        direction: number,
        _gestureOffset: number,
        _gestureVelocity: number,
        _axis: 1 | 2,
        uiTargetDayKey?: number
    ) => {
        const normalizedDirection: DetailMonthSwipeDirection =
            direction < 0 ? -1 : 1;
        const uiTargetDay = uiTargetDayKey === undefined
            ? null
            : getCalendarDayFromSelectionKey(uiTargetDayKey);
        const targetDay = uiTargetDay ?? shiftCalendarMonth(
            detailMonthVisualAnchorDayRef.current,
            normalizedDirection
        );
        detailMonthVisualAnchorDayRef.current = targetDay;
        detailMonthContinuousSettleCountRef.current += 1;
        detailMonthPreviewedDayRef.current = targetDay;
        detailMonthSuppressedCommitRef.current = targetDay.slice(0, 7);
        // A physical pan has already advanced the selection on the UI thread.
        // Its exact shifted key is authoritative; writing the older JS anchor
        // back here can turn Jul 31 into Aug 1 while React is one frame behind.
        emitDetailMonthPreview(targetDay, uiTargetDay === null);
        setDetailMonthMotionOwnershipActive(true);
        if (onCommitDetailMonthRef.current) {
            detailMonthPendingControlledDayRef.current = targetDay;
            detailMonthContinuousCommitPending.value = true;
            holdDetailMonthContinuousCommit();
        } else {
            // Preserve the standalone component's synchronous fallback. The
            // schedule screen supplies onCommitDetailMonth and therefore uses
            // the burst-coalesced path above.
            detailMonthContinuousCommitPending.value = false;
            commitDetailMonthControlledState(targetDay);
        }
    }, [
        commitDetailMonthControlledState,
        detailMonthContinuousSettleCountRef,
        detailMonthContinuousCommitPending,
        detailMonthPendingControlledDayRef,
        detailMonthPreviewedDayRef,
        detailMonthSuppressedCommitRef,
        detailMonthVisualAnchorDayRef,
        emitDetailMonthPreview,
        holdDetailMonthContinuousCommit,
        onCommitDetailMonthRef,
        setDetailMonthMotionOwnershipActive,
    ]);

    /** 한 페이지 정착을 완료하고 진행 중인 정착이 모두 끝났을 때만 유휴 커밋을 예약한다. */
    const completeDetailMonthGestureSettle = useCallback((
        direction: number,
        _axis: 1 | 2,
        heldGesture = false
    ) => {
        const normalizedDirection: DetailMonthSwipeDirection =
            direction < 0 ? -1 : 1;
        const settledAnchorDay = shiftCalendarMonth(
            detailMonthSettledAnchorDayRef.current,
            normalizedDirection
        );
        detailMonthSettledAnchorDayRef.current = settledAnchorDay;
        detailMonthContinuousSettleCountRef.current = Math.max(
            0,
            detailMonthContinuousSettleCountRef.current - 1
        );
        if (
            detailMonthContinuousSettleCountRef.current === 0
            && !heldGesture
        ) {
            scheduleDetailMonthContinuousCommit();
        }
    }, [
        detailMonthContinuousSettleCountRef,
        detailMonthSettledAnchorDayRef,
        scheduleDetailMonthContinuousCommit,
    ]);

    /** 버튼·접근성 입력을 물리 제스처와 같은 연속 페이저 정착 경로로 변환한다. */
    const shiftContinuousDetailMonthPager = useCallback((
        direction: DetailMonthSwipeDirection
    ) => {
        const normalizedDirection: DetailMonthSwipeDirection =
            direction < 0 ? -1 : 1;
        const targetOrdinal = detailMonthVisualMonthOrdinal.value
            + normalizedDirection;
        const windowStartOrdinal =
            detailMonthPagerWindowStartOrdinal.value;
        const windowEndOrdinal = windowStartOrdinal
            + DETAIL_MONTH_PAGER_POSITIONS.length - 1;
        if (
            targetOrdinal < windowStartOrdinal
            || targetOrdinal > windowEndOrdinal
        ) return;
        beginDetailMonthGestureSettle(normalizedDirection, 0, 0, 1);
        detailMonthVisualMonthOrdinal.value = targetOrdinal;
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        completeDetailMonthGestureSettle(
            normalizedDirection,
            1,
            false
        );
    }, [
        beginDetailMonthGestureSettle,
        completeDetailMonthGestureSettle,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureSettleGeneration,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthPagerWindowStartOrdinal,
        detailMonthVisualMonthOrdinal,
    ]);

    useLayoutEffect(() => {
        if (!onRegisterDetailMonthMotionShift) return undefined;

        onRegisterDetailMonthMotionShift(shiftContinuousDetailMonthPager);
        return () => onRegisterDetailMonthMotionShift(null);
    }, [
        onRegisterDetailMonthMotionShift,
        shiftContinuousDetailMonthPager,
    ]);

    return {
        handleDetailMonthViewportLayout,
        beginDetailMonthGestureSettle,
        completeDetailMonthGestureSettle,
        shiftContinuousDetailMonthPager,
    };
}

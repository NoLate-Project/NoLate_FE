import {
    useCallback,
    useEffect,
    useLayoutEffect,
} from "react";
import {
    cancelAnimation as cancelReanimatedAnimation,
    runOnJS,
    runOnUI,
    withTiming,
} from "react-native-reanimated";
import type { CalendarViewMode } from "./viewMode";
import {
    DETAIL_MONTH_PAGER_RADIUS,
    createDetailMonthPagerSlots,
    getCalendarMonthOrdinal,
    normalizeMonthCandidate,
    resolveDetailMonthAnchor,
    type TodayFocusTarget,
} from "./scheduleCalendarModel";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";
import type { useDetailMonthAnimationController } from "./useDetailMonthAnimationController";

type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;
type DetailMonthAnimationController = ReturnType<
    typeof useDetailMonthAnimationController
>;

type UseDetailMonthPagerSynchronizationParams = {
    calendarState: ScheduleCalendarState;
    commitController: DetailMonthCommitController;
    animationController: DetailMonthAnimationController;
    selectedDay: string;
    visibleMonth: string;
    viewMode: CalendarViewMode;
    transitionActive: boolean;
    transitionMonthKey?: string;
    reduceMotionEnabled: boolean;
    todayFocusTarget?: TodayFocusTarget | null;
};

/**
 * React가 승인한 월과 UI 스레드 페이저 창을 다시 맞추고 오늘 포커스 준비를 알린다.
 * 진행 중인 전환의 예상 날짜와 세대가 일치할 때만 슬롯을 재배치해 이전 ACK가
 * 최신 페이저 위치를 되돌리지 않도록 한다.
 */
export function useDetailMonthPagerSynchronization({
    calendarState,
    commitController,
    animationController,
    selectedDay,
    visibleMonth,
    viewMode,
    transitionActive,
    transitionMonthKey,
    reduceMotionEnabled,
    todayFocusTarget,
}: UseDetailMonthPagerSynchronizationParams) {
    const {
        initialDate,
        initialMonthKey,
        detailMonthPagerAnchorDay,
        setDetailMonthPagerAnchorDay,
        detailMonthPagerHandoffDay,
        setDetailMonthPagerHandoffDay,
        setDetailMonthPagerSlots,
        detailMonthPagerSlotsRef,
        detailMonthVisualAnchorDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthGestureOpacity,
        detailMonthVisualMonthOrdinal,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPagerRebaseFrameRef,
        detailMonthPagerRebasePendingRef,
        detailMonthAnimationActiveRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationSourceDayRef,
        detailMonthAnimationExpectedDayRef,
        detailMonthAnimationReduceMotionRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthAnimationAxisRef,
    } = calendarState;
    const {
        acknowledgeTodayFocusTarget,
    } = commitController;
    const {
        invalidateDetailMonthAnimation,
        completeDetailMonthAnimation,
        startDetailMonthEnterAnimation,
        scheduleDetailMonthPagerHandoff,
    } = animationController;
    /** UI 스레드의 이동값 초기화가 끝나면 시각 앵커를 확정하고 임시 핸드오프를 제거한다. */
    const finishDetailMonthPagerTranslationReset = useCallback((
        generation: number,
        expectedDay: string
    ) => {
        const rebaseKey = `${generation}:${expectedDay}`;
        if (detailMonthPagerRebasePendingRef.current === rebaseKey) {
            detailMonthPagerRebasePendingRef.current = null;
        }
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
            || detailMonthAnimationExpectedDayRef.current !== expectedDay
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        // The UI thread has already reset the target-only canvas to its
        // origin. Removing the duplicate handoff now exposes the canonical
        // previous/current/next pages without an intermediate source frame.
        detailMonthVisualAnchorDayRef.current = expectedDay;
        detailMonthSettledAnchorDayRef.current = expectedDay;
        detailMonthAnimationPhaseRef.current = "finalizing";
        setDetailMonthPagerHandoffDay(null);
    }, [
        detailMonthAnimationExpectedDayRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthPagerRebasePendingRef,
        detailMonthSettledAnchorDayRef,
        detailMonthVisualAnchorDayRef,
        setDetailMonthPagerHandoffDay,
    ]);

    /** 제어 상태 ACK 뒤 실제 페이지를 중앙으로 승격하고 이동값을 한 프레임에서 재설정한다. */
    const scheduleDetailMonthPagerRebaseCompletion = useCallback((
        generation: number,
        expectedDay: string
    ) => {
        const rebaseKey = `${generation}:${expectedDay}`;
        if (detailMonthPagerRebasePendingRef.current === rebaseKey) return;
        const isCurrentRebase = (
            generation === detailMonthAnimationGenerationRef.current
            && detailMonthAnimationPhaseRef.current === "awaitingCommit"
            && detailMonthAnimationExpectedDayRef.current === expectedDay
            && detailMonthAnimationUsesPagerRef.current
        );
        if (!isCurrentRebase) return;

        detailMonthPagerRebasePendingRef.current = rebaseKey;
        const frame = requestAnimationFrame(() => {
            if (detailMonthPagerRebaseFrameRef.current === frame) {
                detailMonthPagerRebaseFrameRef.current = null;
            }
            if (
                generation !== detailMonthAnimationGenerationRef.current
                || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                || detailMonthAnimationExpectedDayRef.current !== expectedDay
                || !detailMonthAnimationUsesPagerRef.current
            ) return;

            const targetOrdinal = getCalendarMonthOrdinal(expectedDay);
            const vertical =
                detailMonthAnimationAxisRef.current === "vertical";
            // The wide pager no longer renders the old target-only handoff.
            // Promote the actual page ordinal and reset its translation in a
            // single UI worklet so the source page can never reappear between
            // those two writes.
            runOnUI(() => {
                "worklet";

                cancelReanimatedAnimation(detailMonthGestureTranslateX);
                cancelReanimatedAnimation(detailMonthGestureTranslateY);
                cancelReanimatedAnimation(detailMonthGestureOpacity);
                const activeTranslation = vertical
                    ? detailMonthGestureTranslateY
                    : detailMonthGestureTranslateX;
                const inactiveTranslation = vertical
                    ? detailMonthGestureTranslateX
                    : detailMonthGestureTranslateY;
                detailMonthVisualMonthOrdinal.value = targetOrdinal;
                inactiveTranslation.value = 0;
                detailMonthGestureOpacity.value = 1;
                activeTranslation.value = withTiming(
                    0,
                    { duration: 0 },
                    () => {
                        runOnJS(finishDetailMonthPagerTranslationReset)(
                            generation,
                            expectedDay
                        );
                    }
                );
            })();
        });
        detailMonthPagerRebaseFrameRef.current = frame;
    }, [
        detailMonthAnimationAxisRef,
        detailMonthAnimationExpectedDayRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthPagerRebaseFrameRef,
        detailMonthPagerRebasePendingRef,
        finishDetailMonthPagerTranslationReset,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthVisualMonthOrdinal,
    ]);

    /** 부모의 선택/표시 월 변화를 전환 단계의 ACK로 해석해 다음 애니메이션 단계를 진행한다. */
    useLayoutEffect(() => {
        if (!detailMonthAnimationActiveRef.current) return;

        const phase = detailMonthAnimationPhaseRef.current;
        const sourceDay = detailMonthAnimationSourceDayRef.current;
        const expectedDay = detailMonthAnimationExpectedDayRef.current;
        const currentAnchor = resolveDetailMonthAnchor(selectedDay, visibleMonth);
        const matchesControlledTransition = phase === "exit"
            ? currentAnchor === sourceDay
            : phase === "settling" || phase === "awaitingCommit"
                ? currentAnchor === sourceDay || currentAnchor === expectedDay
                : phase === "finalizing"
                    ? currentAnchor === expectedDay
                : phase === "enter"
                    ? currentAnchor === expectedDay
                    : false;

        if (
            transitionActive ||
            viewMode !== "detail" ||
            detailMonthAnimationReduceMotionRef.current !== reduceMotionEnabled ||
            !matchesControlledTransition
        ) {
            invalidateDetailMonthAnimation(true);
            return;
        }

        if (phase === "finalizing" && currentAnchor === expectedDay) {
            if (
                detailMonthPagerAnchorDay === expectedDay
                && detailMonthPagerHandoffDay === null
            ) {
                // The canonical previous/current/next topology is now in the
                // committed native tree. Unlock immediately so a touch held
                // during the handoff is adopted on its next update.
                completeDetailMonthAnimation(
                    detailMonthAnimationGenerationRef.current,
                    true
                );
            }
            return;
        }

        // The controlled props are the authoritative commit ACK. Starting the
        // enter phase here avoids waiting on react-native-calendars' later
        // onMonthChange effect and keeps the release-to-settle path under 200ms.
        if (phase === "awaitingCommit" && currentAnchor === expectedDay) {
            if (detailMonthAnimationUsesPagerRef.current) {
                // Keep the target month rendered at both the incoming page and
                // the centre page until the structural anchor is also target.
                if (detailMonthPagerHandoffDay !== expectedDay) {
                    // Let the controlled ACK (including the month pill and
                    // agenda title) paint before mounting the duplicate centre
                    // calendar used for the pager rebase. Doing both Fabric
                    // commits in one layout phase delayed visible chrome by
                    // roughly 300 ms on the simulator.
                    scheduleDetailMonthPagerHandoff(
                        detailMonthAnimationGenerationRef.current,
                        expectedDay
                    );
                    return;
                }

                if (detailMonthPagerAnchorDay !== expectedDay) {
                    // Keep the duplicate handoff mounted while promoting the
                    // structural pager anchor. This render makes the current,
                    // previous and next slots all resolve to the target month;
                    // only then is it safe to reset the UI-thread translation.
                    setDetailMonthPagerAnchorDay(expectedDay);
                    return;
                }

                scheduleDetailMonthPagerRebaseCompletion(
                    detailMonthAnimationGenerationRef.current,
                    expectedDay
                );
                return;
            }
            startDetailMonthEnterAnimation(
                detailMonthAnimationGenerationRef.current
            );
        }
    }, [
        detailMonthAnimationActiveRef,
        detailMonthAnimationExpectedDayRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationReduceMotionRef,
        detailMonthAnimationSourceDayRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthPagerAnchorDay,
        detailMonthPagerHandoffDay,
        completeDetailMonthAnimation,
        invalidateDetailMonthAnimation,
        reduceMotionEnabled,
        scheduleDetailMonthPagerRebaseCompletion,
        selectedDay,
        scheduleDetailMonthPagerHandoff,
        setDetailMonthPagerAnchorDay,
        startDetailMonthEnterAnimation,
        transitionActive,
        viewMode,
        visibleMonth,
    ]);

    /** 페이저 전환이 없을 때 외부 제어값을 기준으로 슬롯과 시각 앵커를 안전하게 되맞춘다. */
    useLayoutEffect(() => {
        if (detailMonthAnimationUsesPagerRef.current) return;
        if (detailMonthPendingControlledDayRef.current !== null) return;
        if (
            transitionActive
            && normalizeMonthCandidate(transitionMonthKey)
        ) return;
        setDetailMonthPagerHandoffDay((current) => (
            current === null ? current : null
        ));
        setDetailMonthPagerAnchorDay((current) => (
            current.slice(0, 7) === initialMonthKey
                ? current
                : initialDate
        ));
        const initialOrdinal = getCalendarMonthOrdinal(initialDate);
        if (
            detailMonthContinuousSettleCountRef.current > 0
            || (
                detailMonthVisualAnchorDayRef.current.slice(0, 7)
                    === initialMonthKey
                && detailMonthVisualMonthOrdinal.value === initialOrdinal
            )
        ) return;

        const resetSlots = createDetailMonthPagerSlots(initialDate);
        detailMonthVisualAnchorDayRef.current = initialDate;
        detailMonthSettledAnchorDayRef.current = initialDate;
        detailMonthPagerSlotsRef.current = resetSlots;
        detailMonthVisualMonthOrdinal.value =
            initialOrdinal;
        detailMonthPagerWindowStartOrdinal.value =
            resetSlots[0]?.monthOrdinal
            ?? getCalendarMonthOrdinal(initialDate)
                - DETAIL_MONTH_PAGER_RADIUS;
        setDetailMonthPagerSlots(resetSlots);
    }, [
        detailMonthAnimationUsesPagerRef,
        detailMonthContinuousSettleCountRef,
        detailMonthPagerHandoffDay,
        detailMonthPagerSlotsRef,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPendingControlledDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthVisualAnchorDayRef,
        detailMonthVisualMonthOrdinal,
        initialDate,
        initialMonthKey,
        transitionActive,
        transitionMonthKey,
        setDetailMonthPagerAnchorDay,
        setDetailMonthPagerHandoffDay,
        setDetailMonthPagerSlots,
    ]);

    useEffect(() => {
        const target = todayFocusTarget;
        if (!target || selectedDay !== target.day) return undefined;

        const targetMonth = target.day.slice(0, 7);
        const isCommittedWeek = viewMode === "week";
        const isCommittedCalendar = (
            viewMode === "detail"
                ? visibleMonth === targetMonth
                : viewMode === "list"
                    && !target.requiresMonthChange
                    && visibleMonth === targetMonth
        );
        if (!isCommittedWeek && !isCommittedCalendar) return undefined;

        const readyFrame = requestAnimationFrame(() => {
            acknowledgeTodayFocusTarget(target.day);
        });
        return () => cancelAnimationFrame(readyFrame);
    }, [
        acknowledgeTodayFocusTarget,
        selectedDay,
        todayFocusTarget,
        viewMode,
        visibleMonth,
    ]);

}

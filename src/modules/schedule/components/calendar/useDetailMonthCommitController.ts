import {
    startTransition,
    useCallback,
    useEffect,
    useLayoutEffect,
} from "react";
import { CALENDAR_DAY_HEIGHTS } from "./viewMode";
import {
    DETAIL_MONTH_PAGER_GUARD,
    DETAIL_MONTH_PAGER_RADIUS,
    createDetailMonthPagerSlots,
    getCalendarDaySelectionKey,
    getCalendarMonthOrdinal,
    resolveDetailMonthAnchor,
    resolveDetailMonthPagerLayout,
    type DetailMonthPageLayouts,
} from "./scheduleCalendarModel";
import { DETAIL_MONTH_SWIPE_MOTION } from "../../calendarMotion";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";

type UseDetailMonthCommitControllerParams = {
    calendarState: ScheduleCalendarState;
    selectedDay: string;
    firstDay: 0 | 1;
    headerOffset: number;
    detailMonthPageLayouts?: DetailMonthPageLayouts;
};

/**
 * 상세 월 페이저의 제어형 날짜 커밋, 미리보기, 유휴 커밋 예약을 관리한다.
 * UI 스레드가 한 달 앞서 이동한 동안 이전 React props가 최신 시각 상태를
 * 덮어쓰지 않도록 승인 날짜와 커밋 세대를 검증한다.
 */
export function useDetailMonthCommitController({
    calendarState,
    selectedDay,
    firstDay,
    headerOffset,
    detailMonthPageLayouts,
}: UseDetailMonthCommitControllerParams) {
    const {
        visibleMonth,
        initialMonthKey,
        setDetailMonthPagerAnchorDay,
        detailMonthPagerSlots,
        setDetailMonthPagerSlots,
        detailMonthPagerSlotsRef,
        detailMonthVisualAnchorDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        detailMonthContinuousCommitTimerRef,
        detailMonthContinuousCommitTimerTokenRef,
        detailMonthViewportHeight,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPagerSlotDayHeights,
        detailMonthVisualSelectedDayKey,
        detailMonthContinuousCommitPending,
        detailMonthContinuousCommitGeneration,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestVisibleMonthRef,
        todayFocusTargetRef,
        acknowledgedTodayFocusTargetRef,
        onTodayFocusReadyRef,
        onSelectDayRef,
        onVisibleMonthChangeRef,
        onDetailMonthPreviewRef,
        onCommitDetailMonthRef,
        onDetailMonthMotionActiveChangeRef,
        detailMonthMotionOwnershipActiveRef,
    } = calendarState;
    /** 부모가 확정한 선택 일자를 시각 앵커와 동기화하되 진행 중인 제스처는 보존한다. */
    useLayoutEffect(() => {
        const pendingDay = detailMonthPendingControlledDayRef.current;
        if (pendingDay !== null) {
            const pendingMonth = pendingDay.slice(0, 7);
            const acknowledged =
                selectedDay === pendingDay
                && visibleMonth === pendingMonth;
            if (!acknowledged) return;

            // The visual pager can be one gesture ahead of React while a
            // controlled transition is pending. Keep that protection until
            // both controlled props acknowledge this exact target; an older
            // month ACK must never reset a newer UI-thread pager position.
            detailMonthPendingControlledDayRef.current = null;
        }
        if (detailMonthContinuousSettleCountRef.current > 0) return;

        const controlledAnchor = resolveDetailMonthAnchor(
            selectedDay,
            visibleMonth
        );
        if (
            detailMonthVisualAnchorDayRef.current.slice(0, 7)
            === controlledAnchor.slice(0, 7)
        ) {
            // A same-month controlled selection can come from Today, quick
            // schedule creation or another parent action rather than this
            // calendar's own day press. Keep the next month shift anchored to
            // that newly selected day instead of the older pager day.
            detailMonthVisualAnchorDayRef.current = controlledAnchor;
            detailMonthSettledAnchorDayRef.current = controlledAnchor;
        }
        detailMonthVisualSelectedDayKey.value =
            getCalendarDaySelectionKey(controlledAnchor);
    }, [
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthVisualAnchorDayRef,
        detailMonthVisualSelectedDayKey,
        selectedDay,
        visibleMonth,
    ]);

    useLayoutEffect(() => {
        const currentCalendarHeight =
            detailMonthPageLayouts?.current.calendarHeight;
        if (
            currentCalendarHeight !== undefined
            && Number.isFinite(currentCalendarHeight)
            && currentCalendarHeight > 0
        ) {
            // The parent height includes the sticky toolbar/weekday inset,
            // while these pager pages begin below that inset. Using the full
            // panel height here leaves a blank header-sized gap between
            // vertically adjacent months.
            detailMonthViewportHeight.value = Math.max(
                1,
                currentCalendarHeight - Math.max(0, headerOffset)
            );
        }
        const slotLayouts = detailMonthPagerSlots.map((slot) => (
            resolveDetailMonthPagerLayout(
                slot.day,
                detailMonthPageLayouts,
                initialMonthKey,
                firstDay
            )
        ));
        detailMonthPagerSlotPageHeights.value = slotLayouts.map(
            (layout) => Math.max(
                1,
                layout
                    ? layout.calendarHeight - Math.max(0, headerOffset)
                    : detailMonthViewportHeight.value
            )
        );
        detailMonthPagerSlotCalendarHeights.value = slotLayouts.map(
            (layout) => Math.max(
                1,
                layout?.calendarHeight
                    ?? (
                        detailMonthViewportHeight.value
                        + Math.max(0, headerOffset)
                    )
            )
        );
        detailMonthPagerSlotDayHeights.value = slotLayouts.map(
            (layout) => Math.max(
                1,
                layout?.dayHeight ?? CALENDAR_DAY_HEIGHTS.detail
            )
        );
    }, [
        detailMonthPageLayouts,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotDayHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPagerSlots,
        detailMonthViewportHeight,
        firstDay,
        headerOffset,
        initialMonthKey,
    ]);

    /** 상세 월 전환의 소유권 상태를 중복 알림 없이 상위 화면에 전달한다. */
    const setDetailMonthMotionOwnershipActive = useCallback((
        active: boolean
    ) => {
        if (detailMonthMotionOwnershipActiveRef.current === active) return;

        detailMonthMotionOwnershipActiveRef.current = active;
        onDetailMonthMotionActiveChangeRef.current?.(active);
    }, [
        detailMonthMotionOwnershipActiveRef,
        onDetailMonthMotionActiveChangeRef,
    ]);

    /** 빠른 미리보기 선택값을 반영하고 보조 콜백 오류가 커밋을 막지 않게 격리한다. */
    const emitDetailMonthPreview = useCallback((
        day: string,
        updateSelection = true
    ) => {
        if (updateSelection) {
            detailMonthVisualSelectedDayKey.value =
                getCalendarDaySelectionKey(day);
        }
        try {
            onDetailMonthPreviewRef.current?.(day);
        } catch {
            // Preview is a visual fast path. Native chrome must never be able
            // to interrupt the authoritative calendar/store commit.
        }
    }, [detailMonthVisualSelectedDayKey, onDetailMonthPreviewRef]);

    /** 상세 월의 최종 선택을 전용 커밋 콜백 또는 기본 제어 콜백으로 확정한다. */
    const commitDetailMonthControlledState = useCallback((day: string) => {
        const commit = onCommitDetailMonthRef.current;
        if (commit) {
            commit(day);
            return;
        }

        onVisibleMonthChangeRef.current(day);
        onSelectDayRef.current(day);
    }, [onCommitDetailMonthRef, onSelectDayRef, onVisibleMonthChangeRef]);

    /** 시각 월이 슬롯 가장자리에 가까워지면 동일한 일자를 중심으로 페이저 창을 재구성한다. */
    const rebaseDetailMonthPagerWindowIfNeeded = useCallback((day: string) => {
        const slots = detailMonthPagerSlotsRef.current;
        const firstOrdinal = slots[0]?.monthOrdinal;
        const lastOrdinal = slots.at(-1)?.monthOrdinal;
        const visualOrdinal = getCalendarMonthOrdinal(day);
        if (
            firstOrdinal !== undefined
            && lastOrdinal !== undefined
            && visualOrdinal - firstOrdinal > DETAIL_MONTH_PAGER_GUARD
            && lastOrdinal - visualOrdinal > DETAIL_MONTH_PAGER_GUARD
        ) return;

        const rebasedSlots = createDetailMonthPagerSlots(day);
        detailMonthPagerSlotsRef.current = rebasedSlots;
        detailMonthPagerWindowStartOrdinal.value =
            rebasedSlots[0]?.monthOrdinal
            ?? visualOrdinal - DETAIL_MONTH_PAGER_RADIUS;
        setDetailMonthPagerSlots(rebasedSlots);
    }, [
        detailMonthPagerSlotsRef,
        detailMonthPagerWindowStartOrdinal,
        setDetailMonthPagerSlots,
    ]);

    /** 연속 스와이프가 이어질 때 예약된 유휴 커밋 타이머의 소유권을 취소한다. */
    const holdDetailMonthContinuousCommit = useCallback(() => {
        // The UI worklets advance the shared generation before crossing to
        // JS. Keep JS cancellation on the timer token: SharedValue writes
        // made from JS are asynchronous on-device, so using them as a JS
        // counter can make a valid idle callback compare against a newer UI
        // value and discard its own commit.
        const pendingTimer = detailMonthContinuousCommitTimerRef.current;
        detailMonthContinuousCommitTimerTokenRef.current = null;
        if (pendingTimer === null) return;

        clearTimeout(pendingTimer);
        detailMonthContinuousCommitTimerRef.current = null;
    }, [
        detailMonthContinuousCommitTimerRef,
        detailMonthContinuousCommitTimerTokenRef,
    ]);

    /** 세대와 토큰이 일치하는 마지막 스와이프만 부모 상태에 원자적으로 커밋한다. */
    const flushDetailMonthContinuousCommit = useCallback((
        expectedGeneration: number,
        expectedTimerToken: object
    ) => {
        if (
            expectedGeneration
            !== detailMonthContinuousCommitGeneration.value
            || detailMonthContinuousCommitTimerTokenRef.current
                !== expectedTimerToken
        ) return;
        // A cancelled timer can already be queued on the JS event loop. Only
        // the callback that still owns the current reservation may consume
        // it; an older callback must never clear a newer idle commit.
        detailMonthContinuousCommitTimerRef.current = null;
        detailMonthContinuousCommitTimerTokenRef.current = null;
        if (detailMonthContinuousSettleCountRef.current > 0) return;

        const pendingDay = detailMonthPendingControlledDayRef.current;
        detailMonthContinuousCommitPending.value = false;
        if (pendingDay) {
            startTransition(() => {
                setDetailMonthPagerAnchorDay(pendingDay);
                rebaseDetailMonthPagerWindowIfNeeded(pendingDay);
                commitDetailMonthControlledState(pendingDay);
            });
        }
        setDetailMonthMotionOwnershipActive(false);
    }, [
        commitDetailMonthControlledState,
        detailMonthContinuousCommitTimerRef,
        detailMonthContinuousCommitTimerTokenRef,
        detailMonthContinuousCommitGeneration,
        detailMonthContinuousCommitPending,
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        rebaseDetailMonthPagerWindowIfNeeded,
        setDetailMonthPagerAnchorDay,
        setDetailMonthMotionOwnershipActive,
    ]);

    /** 제스처 묶음이 끝난 뒤 짧은 유휴 시간을 두고 마지막 선택만 커밋하도록 예약한다. */
    const scheduleDetailMonthContinuousCommit = useCallback(() => {
        holdDetailMonthContinuousCommit();
        if (detailMonthContinuousSettleCountRef.current > 0) return;

        if (!detailMonthPendingControlledDayRef.current) {
            detailMonthContinuousCommitPending.value = false;
            setDetailMonthMotionOwnershipActive(false);
            return;
        }
        // Snapshot the UI touch epoch; do not mutate it from JS. The token
        // provides JS timer identity while this shared value only detects a
        // touch that landed before runOnJS cancellation reached this thread.
        const scheduledGeneration =
            detailMonthContinuousCommitGeneration.value;
        const scheduledTimerToken = {};
        detailMonthContinuousCommitTimerTokenRef.current =
            scheduledTimerToken;
        detailMonthContinuousCommitTimerRef.current = setTimeout(
            () => flushDetailMonthContinuousCommit(
                scheduledGeneration,
                scheduledTimerToken
            ),
            DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
        );
    }, [
        detailMonthContinuousCommitGeneration,
        detailMonthContinuousCommitPending,
        detailMonthContinuousCommitTimerRef,
        detailMonthContinuousCommitTimerTokenRef,
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        flushDetailMonthContinuousCommit,
        holdDetailMonthContinuousCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    /** 새 입력이 이전 예약을 대체하면 대기 상태를 폐기하고 제어값 기준으로 선택 표시를 복원한다. */
    const discardDetailMonthContinuousCommit = useCallback(() => {
        holdDetailMonthContinuousCommit();
        detailMonthPendingControlledDayRef.current = null;
        detailMonthContinuousSettleCountRef.current = 0;
        detailMonthContinuousCommitPending.value = false;
        detailMonthVisualSelectedDayKey.value = getCalendarDaySelectionKey(
            resolveDetailMonthAnchor(
                detailMonthLatestSelectedDayRef.current,
                detailMonthLatestVisibleMonthRef.current
            )
        );
        setDetailMonthMotionOwnershipActive(false);
    }, [
        detailMonthContinuousCommitPending,
        detailMonthContinuousSettleCountRef,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestVisibleMonthRef,
        detailMonthPendingControlledDayRef,
        detailMonthVisualSelectedDayKey,
        holdDetailMonthContinuousCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    useEffect(() => () => {
        const pendingTimer = detailMonthContinuousCommitTimerRef.current;
        if (pendingTimer !== null) clearTimeout(pendingTimer);
        detailMonthContinuousCommitTimerRef.current = null;
        detailMonthContinuousCommitTimerTokenRef.current = null;
    }, [
        detailMonthContinuousCommitTimerRef,
        detailMonthContinuousCommitTimerTokenRef,
    ]);

    /** 오늘 이동 대상의 실제 표시가 준비되었을 때 완료 콜백을 정확히 한 번 호출한다. */
    const acknowledgeTodayFocusTarget = useCallback((day: string) => {
        const target = todayFocusTargetRef.current;
        if (
            !target ||
            target.day !== day ||
            acknowledgedTodayFocusTargetRef.current === target
        ) return;

        acknowledgedTodayFocusTargetRef.current = target;
        onTodayFocusReadyRef.current?.(target.day);
    }, [
        acknowledgedTodayFocusTargetRef,
        onTodayFocusReadyRef,
        todayFocusTargetRef,
    ]);

    return {
        setDetailMonthMotionOwnershipActive,
        emitDetailMonthPreview,
        commitDetailMonthControlledState,
        rebaseDetailMonthPagerWindowIfNeeded,
        holdDetailMonthContinuousCommit,
        flushDetailMonthContinuousCommit,
        scheduleDetailMonthContinuousCommit,
        discardDetailMonthContinuousCommit,
        acknowledgeTodayFocusTarget,
    };
}

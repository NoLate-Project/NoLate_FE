import { useCallback, useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { isContinuousMonthViewMode } from '../components/calendar/viewMode';
import { STACK_MONTH_FETCH_COALESCE_MS } from './scheduleIndexControllerModel';
import type { ScheduleIndexState } from './useScheduleIndexState';

type UseScheduleIndexLifecycleParams = {
  isFocused: boolean;
  stateModel: ScheduleIndexState;
};

/**
 * 일정 화면이 활성화된 동안 수행할 사전 마운트, 조회 월 동기화, ref 정리를 관리한다.
 * 달력 전환이 진행 중인 프레임에는 무거운 마운트나 조회 범위 변경을 미뤄 사용자
 * 제스처와 데이터 갱신이 경쟁하지 않도록 한다.
 */
export function useScheduleIndexLifecycle({
  isFocused,
  stateModel,
}: UseScheduleIndexLifecycleParams) {
  const {
    addFormsPrewarmed,
    calendarDepth,
    calendarMetadataMountedRef,
    calendarMetadataRetryTimerRef,
    calendarViewMode,
    dayDisplayPrepareRef,
    dayLayerMounted,
    dayPageNavigationActiveRef,
    detailMonthMotionActiveRef,
    isDayTransitionActive,
    isMonthViewTransitionActive,
    isYearDepthTransitionActive,
    pendingSelectedDay,
    selectedDay,
    setAddFormsPrewarmed,
    setDayLayerMounted,
    setPendingSelectedDay,
    state,
    updateFetchVisibleMonth,
    visibleMonth,
    visibleMonthAnchor,
  } = stateModel;

  useEffect(() => {
    calendarMetadataMountedRef.current = true;
    return () => {
      calendarMetadataMountedRef.current = false;
      const retryTimer = calendarMetadataRetryTimerRef.current;
      if (retryTimer !== null) clearTimeout(retryTimer);
      calendarMetadataRetryTimerRef.current = null;
    };
  }, [calendarMetadataMountedRef, calendarMetadataRetryTimerRef]);

  useEffect(() => {
    if (
      !isFocused ||
      addFormsPrewarmed ||
      !dayLayerMounted ||
      isDayTransitionActive ||
      isYearDepthTransitionActive ||
      isMonthViewTransitionActive
    )
      return;

    // 달력의 초기 상호작용이 끝난 뒤 입력 폼 레이아웃 비용을 미리 지불한다.
    const task = InteractionManager.runAfterInteractions(() => {
      setAddFormsPrewarmed(true);
    });
    return () => task.cancel();
  }, [
    addFormsPrewarmed,
    dayLayerMounted,
    isDayTransitionActive,
    isFocused,
    isMonthViewTransitionActive,
    isYearDepthTransitionActive,
    setAddFormsPrewarmed,
  ]);

  useEffect(() => {
    if (
      !isFocused ||
      dayLayerMounted ||
      calendarDepth !== 'month' ||
      isDayTransitionActive ||
      isYearDepthTransitionActive
    )
      return;

    // 월 화면이 유휴 상태일 때 시간표 레이어를 구성해 첫 탭의 전환을 즉시 시작한다.
    const task = InteractionManager.runAfterInteractions(() => {
      setDayLayerMounted(true);
    });
    return () => task.cancel();
  }, [
    calendarDepth,
    dayLayerMounted,
    isDayTransitionActive,
    isFocused,
    isYearDepthTransitionActive,
    setDayLayerMounted,
  ]);

  useEffect(() => {
    if (isYearDepthTransitionActive) return;

    if (calendarDepth === 'day') {
      updateFetchVisibleMonth(visibleMonthAnchor);
      return;
    }

    // 상세 월 링은 양쪽 페이지를 메모리에 보관하므로 연속 제스처가 끝날 때까지
    // 일정·공휴일 조회 범위 갱신을 미룬다.
    if (
      calendarDepth === 'month' &&
      calendarViewMode === 'detail' &&
      detailMonthMotionActiveRef.current
    )
      return;

    if (
      calendarDepth === 'month' &&
      isContinuousMonthViewMode(calendarViewMode)
    ) {
      const timer = setTimeout(() => {
        updateFetchVisibleMonth(visibleMonthAnchor);
      }, STACK_MONTH_FETCH_COALESCE_MS);
      return () => clearTimeout(timer);
    }

    updateFetchVisibleMonth(visibleMonthAnchor);
  }, [
    calendarDepth,
    calendarViewMode,
    detailMonthMotionActiveRef,
    isYearDepthTransitionActive,
    updateFetchVisibleMonth,
    visibleMonthAnchor,
  ]);

  useEffect(() => {
    if (pendingSelectedDay && state.selectedDay === pendingSelectedDay) {
      setPendingSelectedDay(null);
    }
  }, [pendingSelectedDay, setPendingSelectedDay, state.selectedDay]);

  /** 일간 화면이 전환 전에 호출할 준비 함수를 등록하거나 해제한다. */
  const registerDayDisplayPrepare = useCallback(
    (prepare: ((day: string) => void) | null) => {
      dayDisplayPrepareRef.current = prepare;
    },
    [dayDisplayPrepareRef],
  );

  /** 일간 페이지 스와이프 활성 상태를 ref에 기록해 다른 깊이 전환을 차단한다. */
  const handleDayPageNavigationActiveChange = useCallback(
    (active: boolean) => {
      dayPageNavigationActiveRef.current = active;
    },
    [dayPageNavigationActiveRef],
  );

  const [overviewYear, setOverviewYear] = useState(
    new Date(`${selectedDay}T00:00:00`).getFullYear(),
  );
  const visibleYear = new Date(`${visibleMonth}T00:00:00`).getFullYear();

  return {
    handleDayPageNavigationActiveChange,
    overviewYear,
    registerDayDisplayPrepare,
    setOverviewYear,
    visibleYear,
  };
}

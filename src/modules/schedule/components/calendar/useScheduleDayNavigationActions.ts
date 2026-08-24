import {
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  unstable_batchedUpdates,
} from 'react-native';

import {
  DAY_NAVIGATION_MOTION,
  DAY_NAVIGATION_RETARGET_MOTION,
  getDayNavigationRemainingDuration,
  getDayNavigationResetDuration,
  getDayNavigationRetargetSettleDuration,
} from '../../dayNavigationMotion';
import { CALENDAR_INTERACTION_BUDGET_MS } from '../../calendarMotion';
import type { ScheduleDayDisplayProps } from './useScheduleDayDisplayController';

const DAY_NAVIGATION_EASING = Easing.bezier(...DAY_NAVIGATION_MOTION.bezier);

/** YYYY-MM-DD 날짜에 일수를 더해 같은 형식으로 반환합니다. */
function addDaysToYmd(ymd: string, offset: number) {
  const date = new Date(`${ymd}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

export type DayPanelNavigation = {
  fromDay: string;
  targetDay: string;
  direction: 1 | -1;
  outgoingPanel: ReactNode;
};

export type DayNavigationOptions = {
  commitDay?: (day: string) => void;
  prepareIncoming?: () => void;
};

export type QueuedDayNavigation = {
  day: string;
  options: DayNavigationOptions;
};

type Params = Pick<
  ScheduleDayDisplayProps,
  | 'dayViewMode'
  | 'onNavigateToday'
  | 'onPageNavigationActiveChange'
  | 'onSelectDay'
  | 'onShiftDay'
  | 'reduceMotionEnabled'
  | 'todayKey'
  | 'todayRequest'
> & {
  dayNavigation: DayPanelNavigation | null;
  dayNavigationActiveRef: MutableRefObject<boolean>;
  dayNavigationCleanupTimerRef: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  dayNavigationInterruptRef: MutableRefObject<(() => void) | null>;
  dayNavigationRetargetRef: MutableRefObject<(() => void) | null>;
  dayNavigationSourceRef: MutableRefObject<string | null>;
  dayNavigationTargetRef: MutableRefObject<string | null>;
  dayNavigationUnmountingRef: MutableRefObject<boolean>;
  dayPagerProgress: Animated.Value;
  dayPanelSnapshotRef: MutableRefObject<ReactNode>;
  daySwipeSettlingRef: MutableRefObject<boolean>;
  daySwipeVisualXRef: MutableRefObject<number>;
  daySwipeX: Animated.Value;
  deferredDayNavigationRef: MutableRefObject<QueuedDayNavigation | null>;
  handledTodayRequestRef: MutableRefObject<number>;
  isModeTransitionActive: boolean;
  queuedDayNavigationRef: MutableRefObject<QueuedDayNavigation | null>;
  scrollTimelineToNow: (animated?: boolean) => void;
  selectedDay: string;
  setDayNavigation: Dispatch<SetStateAction<DayPanelNavigation | null>>;
  viewportWidth: number;
};

/**
 * 날짜 타임라인의 좌우 스와이프, 연속 이동 재지정과 오늘 이동 요청을 관리합니다.
 * 전환 중 새 요청은 큐에 보관하고 현재 애니메이션이 정리된 뒤 순서대로 반영합니다.
 */
export function useScheduleDayNavigationActions({
  dayNavigation,
  dayNavigationActiveRef,
  dayNavigationCleanupTimerRef,
  dayNavigationInterruptRef,
  dayNavigationRetargetRef,
  dayNavigationSourceRef,
  dayNavigationTargetRef,
  dayNavigationUnmountingRef,
  dayPagerProgress,
  dayPanelSnapshotRef,
  daySwipeSettlingRef,
  daySwipeVisualXRef,
  daySwipeX,
  dayViewMode,
  deferredDayNavigationRef,
  handledTodayRequestRef,
  isModeTransitionActive,
  onNavigateToday,
  onPageNavigationActiveChange,
  onSelectDay,
  onShiftDay,
  queuedDayNavigationRef,
  reduceMotionEnabled,
  scrollTimelineToNow,
  selectedDay,
  setDayNavigation,
  todayKey,
  todayRequest,
  viewportWidth,
}: Params) {
  /** 완료되지 않은 좌우 스와이프를 현재 위치에서 중앙으로 복원합니다. */
  const resetDaySwipe = useCallback(
    (currentDx: number) => {
      const width = Math.max(320, viewportWidth);
      const duration = getDayNavigationResetDuration(currentDx, width);

      if (duration === 0) {
        daySwipeX.setValue(0);
        daySwipeVisualXRef.current = 0;
        daySwipeSettlingRef.current = false;
        return;
      }

      daySwipeSettlingRef.current = true;
      daySwipeVisualXRef.current = currentDx;
      daySwipeX.stopAnimation();
      daySwipeX.setValue(currentDx);
      Animated.timing(daySwipeX, {
        toValue: 0,
        duration,
        easing: DAY_NAVIGATION_EASING,
        useNativeDriver: true,
        isInteraction: false,
      }).start(({ finished }) => {
        if (!finished) {
          daySwipeVisualXRef.current = 0;
          daySwipeSettlingRef.current = dayNavigationActiveRef.current;
          return;
        }
        daySwipeVisualXRef.current = 0;
        daySwipeSettlingRef.current = false;
      });
    },
    [
      dayNavigationActiveRef,
      daySwipeSettlingRef,
      daySwipeVisualXRef,
      daySwipeX,
      viewportWidth,
    ],
  );

  /** 대상 날짜와 방향을 고정하고 기존 패널 스냅샷을 사용해 날짜 전환 애니메이션을 시작합니다. */
  const startDayNavigation = useCallback(
    (
      day: string,
      fromDay = selectedDay,
      initialProgress = 0,
      options: DayNavigationOptions = {},
    ) => {
      if (day === fromDay) return;

      const commitDay = options.commitDay ?? onSelectDay;
      const outgoingPanel = dayPanelSnapshotRef.current;
      if (reduceMotionEnabled || !outgoingPanel) {
        if (dayNavigationCleanupTimerRef.current) {
          clearTimeout(dayNavigationCleanupTimerRef.current);
          dayNavigationCleanupTimerRef.current = null;
        }
        dayNavigationInterruptRef.current = null;
        dayNavigationRetargetRef.current = null;
        queuedDayNavigationRef.current = null;
        dayNavigationActiveRef.current = false;
        dayNavigationSourceRef.current = null;
        dayNavigationTargetRef.current = null;
        daySwipeSettlingRef.current = false;
        daySwipeVisualXRef.current = 0;
        daySwipeX.setValue(0);
        onPageNavigationActiveChange(false);
        commitDay(day);
        requestAnimationFrame(() => options.prepareIncoming?.());
        return;
      }

      const direction: 1 | -1 =
        new Date(`${day}T00:00:00`).getTime() >
        new Date(`${fromDay}T00:00:00`).getTime()
          ? 1
          : -1;

      const clampedInitialProgress = Math.max(0, Math.min(1, initialProgress));
      let didComplete = false;
      let cancelRequested = false;
      let animationGeneration = 0;
      let currentLegTarget = day;
      let currentLegOptions = options;
      let preparedOptions: DayNavigationOptions | null = null;

      function prepareIncoming(requestOptions: DayNavigationOptions) {
        if (
          !requestOptions.prepareIncoming ||
          preparedOptions === requestOptions
        )
          return;
        preparedOptions = requestOptions;
        requestOptions.prepareIncoming();
      }

      function scheduleInteractionDeadline() {
        if (dayNavigationCleanupTimerRef.current) {
          clearTimeout(dayNavigationCleanupTimerRef.current);
        }
        dayNavigationCleanupTimerRef.current = setTimeout(() => {
          finishNavigation(true, true);
        }, CALENDAR_INTERACTION_BUDGET_MS);
      }

      function finishNavigation(finished: boolean, forceValue = false) {
        if (didComplete) return;
        didComplete = true;
        animationGeneration += 1;
        dayNavigationInterruptRef.current = null;
        dayNavigationRetargetRef.current = null;
        if (dayNavigationCleanupTimerRef.current) {
          clearTimeout(dayNavigationCleanupTimerRef.current);
          dayNavigationCleanupTimerRef.current = null;
        }
        if (forceValue) {
          dayPagerProgress.stopAnimation();
          dayPagerProgress.setValue(1);
        } else {
          dayPagerProgress.setValue(cancelRequested ? 0 : finished ? 1 : 0);
        }
        const latestRequest = queuedDayNavigationRef.current;
        queuedDayNavigationRef.current = null;
        const finalDay = latestRequest?.day ?? currentLegTarget;
        const finalOptions = latestRequest?.options ?? currentLegOptions;
        const finalCommitDay = finalOptions.commitDay ?? onSelectDay;
        dayNavigationActiveRef.current = false;
        dayNavigationSourceRef.current = null;
        dayNavigationTargetRef.current = null;
        daySwipeSettlingRef.current = false;
        daySwipeX.setValue(0);
        daySwipeVisualXRef.current = 0;
        onPageNavigationActiveChange(false);

        if (cancelRequested) {
          if (!dayNavigationUnmountingRef.current) {
            setDayNavigation(null);
          }
          return;
        }

        // Keep the expensive parent calendar and month-range fetch out of
        // the animation frame. The DayDisplay renders its local target
        // immediately and publishes the selection only when motion settles.
        unstable_batchedUpdates(() => {
          finalCommitDay(finalDay);
          setDayNavigation(null);
        });

        if (finalOptions.prepareIncoming && preparedOptions !== finalOptions) {
          requestAnimationFrame(() => finalOptions.prepareIncoming?.());
        }
      }

      function runCurrentLegToEnd(durationMs: number) {
        if (didComplete) return;
        const generation = ++animationGeneration;
        if (durationMs <= 0) {
          dayPagerProgress.setValue(1);
          completeCurrentLeg();
          return;
        }

        Animated.timing(dayPagerProgress, {
          toValue: 1,
          duration: durationMs,
          easing: DAY_NAVIGATION_EASING,
          useNativeDriver: true,
          isInteraction: false,
        }).start(({ finished }) => {
          if (didComplete || generation !== animationGeneration || !finished)
            return;
          completeCurrentLeg();
        });
      }

      function beginFollowUpLeg(request: QueuedDayNavigation) {
        const sourceDay = currentLegTarget;
        const nextOutgoingPanel = dayPanelSnapshotRef.current ?? outgoingPanel;
        currentLegTarget = request.day;
        currentLegOptions = request.options;
        preparedOptions = null;
        const nextDirection: 1 | -1 =
          new Date(`${request.day}T00:00:00`).getTime() >
          new Date(`${sourceDay}T00:00:00`).getTime()
            ? 1
            : -1;

        dayNavigationSourceRef.current = sourceDay;
        dayNavigationTargetRef.current = request.day;
        unstable_batchedUpdates(() => {
          dayPagerProgress.setValue(0);
          setDayNavigation({
            fromDay: sourceDay,
            targetDay: request.day,
            direction: nextDirection,
            outgoingPanel: nextOutgoingPanel,
          });
        });

        const scheduledGeneration = ++animationGeneration;
        requestAnimationFrame(() => {
          if (didComplete || scheduledGeneration !== animationGeneration)
            return;
          prepareIncoming(currentLegOptions);
          runCurrentLegToEnd(DAY_NAVIGATION_RETARGET_MOTION.followDurationMs);
        });
      }

      function completeCurrentLeg() {
        if (didComplete) return;
        dayPagerProgress.setValue(1);
        const latestRequest = queuedDayNavigationRef.current;

        if (latestRequest && latestRequest.day !== currentLegTarget) {
          queuedDayNavigationRef.current = null;
          beginFollowUpLeg(latestRequest);
          return;
        }

        if (latestRequest) {
          queuedDayNavigationRef.current = null;
          currentLegOptions = latestRequest.options;
        }
        finishNavigation(true);
      }

      dayNavigationActiveRef.current = true;
      dayNavigationSourceRef.current = fromDay;
      dayNavigationTargetRef.current = day;
      daySwipeSettlingRef.current = true;
      onPageNavigationActiveChange(true);
      dayPagerProgress.stopAnimation();
      dayPagerProgress.setValue(clampedInitialProgress);

      scheduleInteractionDeadline();
      dayNavigationInterruptRef.current = () => {
        cancelRequested = true;
        animationGeneration += 1;
        dayPagerProgress.stopAnimation();
        finishNavigation(false);
      };
      dayNavigationRetargetRef.current = () => {
        if (didComplete) return;
        scheduleInteractionDeadline();
        const generation = ++animationGeneration;
        dayPagerProgress.stopAnimation(value => {
          if (didComplete || generation !== animationGeneration) return;
          const progress = Math.max(0, Math.min(1, value));
          const settleDuration =
            getDayNavigationRetargetSettleDuration(progress);
          runCurrentLegToEnd(settleDuration);
        });
      };

      setDayNavigation({
        fromDay,
        targetDay: day,
        direction,
        outgoingPanel,
      });

      const scheduledGeneration = ++animationGeneration;
      requestAnimationFrame(() => {
        if (didComplete || scheduledGeneration !== animationGeneration) return;
        prepareIncoming(currentLegOptions);
        // When a drag hands off to the pager, the outgoing panel already has
        // the same offset through dayPagerProgress. Clearing the gesture value
        // here therefore does not introduce a one-frame jump.
        daySwipeX.setValue(0);
        daySwipeVisualXRef.current = 0;
        runCurrentLegToEnd(
          getDayNavigationRemainingDuration(clampedInitialProgress),
        );
      });
    },
    [
      dayPagerProgress,
      dayNavigationActiveRef,
      dayNavigationCleanupTimerRef,
      dayNavigationInterruptRef,
      dayNavigationRetargetRef,
      dayNavigationSourceRef,
      dayNavigationTargetRef,
      dayNavigationUnmountingRef,
      dayPanelSnapshotRef,
      daySwipeSettlingRef,
      daySwipeVisualXRef,
      daySwipeX,
      onPageNavigationActiveChange,
      onSelectDay,
      reduceMotionEnabled,
      queuedDayNavigationRef,
      selectedDay,
      setDayNavigation,
    ],
  );

  /** 진행 중인 날짜 전환을 새 대상 날짜로 재지정하고 남은 거리 기준으로 시간을 다시 계산합니다. */
  const retargetActiveDayNavigation = useCallback(
    (day: string, options: DayNavigationOptions = {}) => {
      const retarget = dayNavigationRetargetRef.current;
      if (!dayNavigationActiveRef.current || !retarget) return false;

      const activeTargetDay = dayNavigationTargetRef.current;
      if (!activeTargetDay) return false;
      const requestedTargetDay =
        queuedDayNavigationRef.current?.day ?? activeTargetDay;

      deferredDayNavigationRef.current = null;
      if (
        day === requestedTargetDay &&
        !options.commitDay &&
        !options.prepareIncoming
      ) {
        return true;
      }

      queuedDayNavigationRef.current = { day, options };
      retarget();
      return true;
    },
    [
      dayNavigationActiveRef,
      dayNavigationRetargetRef,
      dayNavigationTargetRef,
      deferredDayNavigationRef,
      queuedDayNavigationRef,
    ],
  );

  /** 주간 스트립에서 선택한 날짜로 이동하며 현재 전환 상태에 따라 시작 또는 재지정을 선택합니다. */
  const navigateToDayFromWeekStrip = useCallback(
    (day: string) => {
      if (retargetActiveDayNavigation(day)) return;

      if (day === selectedDay) {
        queuedDayNavigationRef.current = null;
        deferredDayNavigationRef.current = null;
        return;
      }

      if (isModeTransitionActive) {
        queuedDayNavigationRef.current = null;
        deferredDayNavigationRef.current = { day, options: {} };
        return;
      }

      startDayNavigation(day, selectedDay);
    },
    [
      isModeTransitionActive,
      deferredDayNavigationRef,
      queuedDayNavigationRef,
      retargetActiveDayNavigation,
      selectedDay,
      startDayNavigation,
    ],
  );

  useEffect(() => {
    if (isModeTransitionActive || dayNavigationActiveRef.current) return;

    const deferredRequest = deferredDayNavigationRef.current;
    if (!deferredRequest) return;
    deferredDayNavigationRef.current = null;

    if (deferredRequest.day === selectedDay) {
      requestAnimationFrame(() => deferredRequest.options.prepareIncoming?.());
      return;
    }

    startDayNavigation(
      deferredRequest.day,
      selectedDay,
      0,
      deferredRequest.options,
    );
  }, [
    dayNavigation,
    dayNavigationActiveRef,
    deferredDayNavigationRef,
    isModeTransitionActive,
    selectedDay,
    startDayNavigation,
  ]);

  /** 스와이프 거리와 속도를 평가해 이전·다음 날짜 이동 또는 원위치 복원을 실행합니다. */
  const finishDaySwipe = useCallback(
    (direction: 1 | -1, currentDx: number) => {
      const width = Math.max(320, viewportWidth);

      const targetDay = addDaysToYmd(selectedDay, direction);
      startDayNavigation(
        targetDay,
        selectedDay,
        Math.min(1, Math.abs(currentDx) / width),
        dayViewMode === 'singleDay'
          ? undefined
          : { commitDay: () => onShiftDay(direction) },
      );
    },
    [dayViewMode, onShiftDay, selectedDay, startDayNavigation, viewportWidth],
  );

  useEffect(() => {
    if (handledTodayRequestRef.current === todayRequest) return;
    handledTodayRequestRef.current = todayRequest;

    const options: DayNavigationOptions = {
      commitDay: onNavigateToday,
      prepareIncoming: () => scrollTimelineToNow(false),
    };

    // Handle the active target before the committed selection so a final
    // Today press can replace the in-flight destination without waiting.
    if (retargetActiveDayNavigation(todayKey, options)) return;

    if (selectedDay === todayKey) {
      requestAnimationFrame(() => scrollTimelineToNow(true));
      return;
    }

    if (isModeTransitionActive) {
      queuedDayNavigationRef.current = null;
      deferredDayNavigationRef.current = { day: todayKey, options };
      return;
    }

    if (reduceMotionEnabled) {
      onNavigateToday(todayKey);
      requestAnimationFrame(() => scrollTimelineToNow(false));
      return;
    }

    startDayNavigation(todayKey, selectedDay, 0, options);
  }, [
    isModeTransitionActive,
    deferredDayNavigationRef,
    handledTodayRequestRef,
    onNavigateToday,
    reduceMotionEnabled,
    retargetActiveDayNavigation,
    scrollTimelineToNow,
    selectedDay,
    startDayNavigation,
    queuedDayNavigationRef,
    todayKey,
    todayRequest,
  ]);

  /** 타임라인의 수평 제스처만 날짜 이동으로 인식하는 PanResponder를 생성합니다. */
  const timelineSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !daySwipeSettlingRef.current &&
          Math.abs(gestureState.dx) > 16 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.15,
        // 카드에서 시작한 수평 제스처는 자식 Swipeable이 먼저 처리한다.
        // 빈 타임라인 영역은 위의 bubbling 판정으로 기존 날짜 이동을 유지한다.
        onPanResponderMove: (_, gestureState) => {
          const dx = gestureState.dx;
          const dy = gestureState.dy;

          if (Math.abs(dx) <= Math.abs(dy) * 1.15) return;
          daySwipeVisualXRef.current = dx;
          daySwipeX.setValue(dx);
        },
        onPanResponderRelease: (_, gestureState) => {
          const dx = gestureState.dx;
          const dy = gestureState.dy;
          const projectedX = dx + gestureState.vx * 80;
          const reversesDirection =
            dx !== 0 && Math.sign(projectedX) !== Math.sign(dx);

          if (
            Math.abs(projectedX) <= 54 ||
            Math.abs(dx) <= Math.abs(dy) * 1.15 ||
            reversesDirection
          ) {
            resetDaySwipe(daySwipeVisualXRef.current);
            return;
          }

          finishDaySwipe(projectedX < 0 ? 1 : -1, dx);
        },
        onPanResponderTerminate: () =>
          resetDaySwipe(daySwipeVisualXRef.current),
      }),
    [
      daySwipeSettlingRef,
      daySwipeVisualXRef,
      daySwipeX,
      finishDaySwipe,
      resetDaySwipe,
    ],
  );
  return { navigateToDayFromWeekStrip, timelineSwipeResponder };
}

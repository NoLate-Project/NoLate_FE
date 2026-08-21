import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { AppState, InteractionManager } from 'react-native';

import { getCalendarDays } from '../../../api/calendar';
import { getCalendarSchedules } from '../../../api/schedule';
import {
  activateCalendarScheduleCacheForAuthenticatedAccount,
  hasCalendarScheduleMonthCache,
  readCalendarScheduleCache,
  refreshCalendarScheduleCache,
  subscribeCalendarScheduleCacheInvalidated,
} from '../calendarScheduleCache';
import { getMonthRange } from '../calendarRange';
import {
  getCalendarMetadataRange,
  indexCalendarDays,
  isCalendarMetadataMonthComplete,
  mergeCalendarMetadataDays,
  type CalendarDayMetadata,
} from '../calendarMetadata';
import {
  getNextCalendarMetadataRetry,
  resetCalendarMetadataRetryState,
  type CalendarMetadataRetryState,
} from '../calendarMetadataRetry';
import { synchronizeCalendarScheduleCacheRevision } from '../../../api/schedule';
import {
  beginPerformanceInteraction,
  measurePerformanceInteraction,
  type PerformanceInteractionTimer,
} from '../../performance/interactionPerformance';
import { useScheduleStore } from '../store';
import type { ScheduleItem } from '../types';
import { getAuthMember } from '../../auth/authStorage';

type Options = {
  calendarMetadataInFlightMonthKeysRef: MutableRefObject<Set<string>>;
  calendarMetadataLoadPendingRef: MutableRefObject<boolean>;
  calendarMetadataLoadedMonthKeysRef: MutableRefObject<Set<string>>;
  calendarMetadataMountedRef: MutableRefObject<boolean>;
  calendarMetadataPrefetchMonthKeys: string[];
  calendarMetadataRetrySequence: number;
  calendarMetadataRetryStateRef: MutableRefObject<CalendarMetadataRetryState>;
  calendarMetadataRetryTargetKey: string;
  calendarMetadataRetryTargetKeyRef: MutableRefObject<string>;
  calendarMetadataRetryTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  calendarRevisionSyncPromiseRef: MutableRefObject<Promise<boolean> | null>;
  detailMonthMotionActiveRef: MutableRefObject<boolean>;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  fetchVisibleMonth: string;
  firstDay: 0 | 1;
  getErrorMessage: (error: unknown) => string;
  isFocused: boolean;
  pendingCalendarMetadataByDateRef: MutableRefObject<Record<string, CalendarDayMetadata>>;
  pendingScheduleSnapshotRef: MutableRefObject<{
    requestSequence: number;
    items: ScheduleItem[];
  } | null>;
  scheduleFetchEndAt: string;
  scheduleFetchStartAt: string;
  scheduleItemsByIdRef: MutableRefObject<Record<string, ScheduleItem>>;
  scheduleLoadSequenceRef: MutableRefObject<number>;
  setCalendarDaysByDate: Dispatch<SetStateAction<Record<string, CalendarDayMetadata>>>;
  setCalendarMetadataRetrySequence: Dispatch<SetStateAction<number>>;
};

/**
 * 월별 일정 캐시와 음력·공휴일 메타데이터를 현재 화면 범위에 맞춰 불러온다.
 * 캐시 revision, 요청 순서, 월 이동 제스처를 함께 확인해 오래된 응답이 최신 달력을 덮지 않게 한다.
 */
export function useScheduleIndexCalendarData({
  calendarMetadataInFlightMonthKeysRef,
  calendarMetadataLoadPendingRef,
  calendarMetadataLoadedMonthKeysRef,
  calendarMetadataMountedRef,
  calendarMetadataPrefetchMonthKeys,
  calendarMetadataRetrySequence,
  calendarMetadataRetryStateRef,
  calendarMetadataRetryTargetKey,
  calendarMetadataRetryTargetKeyRef,
  calendarMetadataRetryTimerRef,
  calendarRevisionSyncPromiseRef,
  detailMonthMotionActiveRef,
  dispatch,
  fetchVisibleMonth,
  firstDay,
  getErrorMessage,
  isFocused,
  pendingCalendarMetadataByDateRef,
  pendingScheduleSnapshotRef,
  scheduleFetchEndAt,
  scheduleFetchStartAt,
  scheduleItemsByIdRef,
  scheduleLoadSequenceRef,
  setCalendarDaysByDate,
  setCalendarMetadataRetrySequence,
}: Options) {
  const contentReadyTimerRef = useRef<PerformanceInteractionTimer | null>(null);
  const adjacentRangePrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScheduleLoadStartedRef = useRef(false);
  if (contentReadyTimerRef.current === null) {
    contentReadyTimerRef.current = beginPerformanceInteraction(
      'schedule.content_ready',
      '/schedule',
      'CONTENT_READY',
    );
  }

  useEffect(
    () => () => {
      contentReadyTimerRef.current?.finish('CANCELLED');
      if (adjacentRangePrefetchTimerRef.current !== null) {
        clearTimeout(adjacentRangePrefetchTimerRef.current);
      }
    },
    [],
  );

  /** 일정 배열의 항목 identity가 실제로 달라졌을 때만 전역 일정 저장소를 갱신한다. */
  const applyScheduleItemsToStore = useCallback(
    (items: ScheduleItem[]) => {
      const currentScheduleItemsById = scheduleItemsByIdRef.current;
      const hasItemSetChanged =
        items.length !== Object.keys(currentScheduleItemsById).length ||
        items.some(item => currentScheduleItemsById[item.id] !== item);
      if (!hasItemSetChanged) return;

      dispatch({ type: 'SET_ITEMS', items });
    },
    [dispatch, scheduleItemsByIdRef],
  );

  /** 최신 요청의 일정 스냅샷만 게시하고 월 제스처 중이면 종료 시점까지 보류한다. */
  const publishScheduleSnapshot = useCallback(
    (requestSequence: number, items: ScheduleItem[]) => {
      if (requestSequence !== scheduleLoadSequenceRef.current) return;
      if (detailMonthMotionActiveRef.current) {
        pendingScheduleSnapshotRef.current = {
          requestSequence,
          items,
        };
        return;
      }

      applyScheduleItemsToStore(items);
    },
    [
      applyScheduleItemsToStore,
      detailMonthMotionActiveRef,
      pendingScheduleSnapshotRef,
      scheduleLoadSequenceRef,
    ],
  );

  /** 현재 월 창의 캐시를 즉시 표시한 뒤 stale 범위를 재검증하며 오래된 요청 결과를 폐기한다. */
  const loadSchedules = useCallback(async () => {
    const requestSequence = scheduleLoadSequenceRef.current + 1;
    scheduleLoadSequenceRef.current = requestSequence;
    const cached = readCalendarScheduleCache(
      scheduleFetchStartAt,
      scheduleFetchEndAt,
    );
    const hasVisibleMonthCache =
      hasCalendarScheduleMonthCache(fetchVisibleMonth);

    if (cached.cachedMonthKeys.length > 0) {
      // 월 이동 대상은 초기 5개월 묶음에 포함되어 있으므로 즉시 표시한다.
      // 길이도 비교해 서버에서 삭제된 일정만 있는 경우까지 반영한다.
      publishScheduleSnapshot(requestSequence, cached.items);
    }
    dispatch({ type: 'SET_LOADING', loading: !hasVisibleMonthCache });
    dispatch({ type: 'SET_ERROR', error: null });

    const publishLatestRangeSnapshot = () => {
      const latest = readCalendarScheduleCache(
        scheduleFetchStartAt,
        scheduleFetchEndAt,
      );
      publishScheduleSnapshot(requestSequence, latest.items);
    };
    const prefetchAdjacentRange = () => {
      if (adjacentRangePrefetchTimerRef.current !== null) {
        clearTimeout(adjacentRangePrefetchTimerRef.current);
      }
      adjacentRangePrefetchTimerRef.current = setTimeout(() => {
        adjacentRangePrefetchTimerRef.current = null;
        if (requestSequence !== scheduleLoadSequenceRef.current) return;
        measurePerformanceInteraction(
          'schedule.range_refresh',
          '/schedule',
          () =>
            refreshCalendarScheduleCache(
              scheduleFetchStartAt,
              scheduleFetchEndAt,
              getCalendarSchedules,
            ),
          'NETWORK',
        )
          .then(() => publishLatestRangeSnapshot())
          .catch(() => undefined);
      }, 350);
    };

    // 현재 월 cache hit는 즉시 표시한다. 다만 이동 방향 앞쪽 월까지 계속
    // 준비되도록 현재 ±2개월 창의 missing/stale edge는 백그라운드 SWR로
    // 채운다. 결과를 여기서 dispatch하지 않아 다음 touch와 Calendar
    // remount가 네트워크 완료 시점에 겹치지 않게 하고, 다음 idle load가
    // 월별 L1 cache에서 합쳐서 표시한다.
    if (hasVisibleMonthCache) {
      contentReadyTimerRef.current?.finish('SUCCESS');
      dispatch({ type: 'SET_LOADING', loading: false });
      measurePerformanceInteraction(
        'schedule.range_refresh',
        '/schedule',
        () =>
          refreshCalendarScheduleCache(
            scheduleFetchStartAt,
            scheduleFetchEndAt,
            getCalendarSchedules,
          ),
        'NETWORK',
      )
        .then(() => {
          // This is the result of the request already made for SWR. Apply
          // it only if this range still owns the screen, and defer the
          // React update while a continuous gesture owns the calendar.
          publishLatestRangeSnapshot();
        })
        .catch(() => undefined);
      return;
    }

    try {
      // Cold cache: fetch only the visible month first. Revision validation
      // runs in parallel and the wider sliding window is filled after the
      // first usable agenda is on screen.
      const visibleMonthRange = getMonthRange(fetchVisibleMonth);
      await measurePerformanceInteraction(
        'schedule.range_load',
        '/schedule',
        () =>
          refreshCalendarScheduleCache(
            visibleMonthRange.startAt,
            visibleMonthRange.endAt,
            getCalendarSchedules,
          ),
        'NETWORK',
      );
      if (requestSequence !== scheduleLoadSequenceRef.current) return;
      publishLatestRangeSnapshot();
      contentReadyTimerRef.current?.finish('SUCCESS');
      prefetchAdjacentRange();
    } catch (error) {
      if (requestSequence !== scheduleLoadSequenceRef.current) return;
      contentReadyTimerRef.current?.finish('ERROR');
      // 화면에 표시할 월이 캐시에 있으면 프리패치 실패가 기존 일정을 가리지 않게 한다.
      if (!hasVisibleMonthCache) {
        const message = getErrorMessage(error);
        dispatch({ type: 'SET_ERROR', error: message });
      }
    } finally {
      if (requestSequence === scheduleLoadSequenceRef.current) {
        dispatch({ type: 'SET_LOADING', loading: false });
      }
    }
  }, [
    dispatch,
    adjacentRangePrefetchTimerRef,
    fetchVisibleMonth,
    getErrorMessage,
    publishScheduleSnapshot,
    scheduleFetchEndAt,
    scheduleFetchStartAt,
    scheduleLoadSequenceRef,
  ]);

  useEffect(() => {
    if (!isFocused) {
      // The destination route can mount before native-stack reports it focused.
      // Preload its account cache and visible month once so the initial
      // transition does not leave the calendar blank for several seconds.
      if (initialScheduleLoadStartedRef.current) {
        calendarRevisionSyncPromiseRef.current = null;
        dispatch({ type: 'SET_LOADING', loading: false });
        return undefined;
      }
    }
    initialScheduleLoadStartedRef.current = true;

    let cancelled = false;
    let cacheActivation: Promise<void> | null = null;
    /** 현재 효과가 유효할 때만 계산된 월 범위의 일정 로딩을 시작한다. */
    const loadCurrentRange = () => {
      if (!cancelled) loadSchedules();
    };
    /** 화면 데이터와 서버 revision을 병렬로 확인해 느린 revision이 첫 표시를 막지 않게 한다. */
    const synchronizeAndLoad = (forceRevisionCheck = false) => {
      loadCurrentRange();
      let revisionSync = calendarRevisionSyncPromiseRef.current;
      if (forceRevisionCheck || revisionSync === null) {
        revisionSync = measurePerformanceInteraction(
          'schedule.revision_sync',
          '/schedule',
          synchronizeCalendarScheduleCacheRevision,
          'NETWORK',
        );
        calendarRevisionSyncPromiseRef.current = revisionSync;
      }

      // Revision validation is an app-session/foreground concern, not a
      // month-navigation concern. A Redis-backed server cache can answer
      // this quickly. Range changes join the same promise, while the API
      // layer single-flights and cools down foreground checks.
      revisionSync
        .then(() => {
          if (calendarRevisionSyncPromiseRef.current === revisionSync) {
            // Keep only readiness after settlement. Retaining a
            // resolved `true` would make later month effects skip
            // their range load until the next foreground event.
            calendarRevisionSyncPromiseRef.current = Promise.resolve(false);
          }
          // revision 변경 시 clear가 아래 구독자를 통해 한 번만 다시 조회한다.
        })
        .catch(() => {
          if (calendarRevisionSyncPromiseRef.current === revisionSync) {
            calendarRevisionSyncPromiseRef.current = Promise.resolve(false);
          }
        });
    };
    /** 인증 계정의 디스크 캐시를 한 번 복원한 뒤 화면/네트워크 작업을 시작한다. */
    const activateCacheAndLoad = (forceRevisionCheck = false) => {
      if (cacheActivation === null) {
        cacheActivation = getAuthMember()
          .then(member => {
            const memberId = member?.id;
            if (!Number.isSafeInteger(memberId) || (memberId ?? 0) <= 0) return;
            return activateCalendarScheduleCacheForAuthenticatedAccount(
              memberId as number,
            ).then(() => undefined);
          })
          .catch(() => undefined);
      }
      cacheActivation.then(() => {
        if (!cancelled) synchronizeAndLoad(forceRevisionCheck);
      });
    };
    activateCacheAndLoad();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return;
      activateCacheAndLoad(true);
    });
    const unsubscribeInvalidated =
      subscribeCalendarScheduleCacheInvalidated(loadCurrentRange);
    return () => {
      cancelled = true;
      subscription.remove();
      unsubscribeInvalidated();
      // 화면을 벗어나거나 조회 범위가 바뀐 뒤 도착한 응답이
      // 상세 화면의 최신 수정값을 덮지 못하도록 무효화한다.
      scheduleLoadSequenceRef.current += 1;
    };
  }, [
    calendarRevisionSyncPromiseRef,
    dispatch,
    isFocused,
    loadSchedules,
    scheduleLoadSequenceRef,
  ]);

  /** 컴포넌트가 마운트된 동안에만 공휴일·음력 메타데이터를 날짜별 상태에 병합한다. */
  const mergeCalendarMetadataIntoState = useCallback(
    (nextDaysByDate: Record<string, CalendarDayMetadata>) => {
      if (!calendarMetadataMountedRef.current) return;

      setCalendarDaysByDate(currentDaysByDate =>
        mergeCalendarMetadataDays(currentDaysByDate, nextDaysByDate),
      );
    },
    [calendarMetadataMountedRef, setCalendarDaysByDate],
  );

  /** 이전 메타데이터 재시도 타이머를 취소하고 새 월 창의 재시도 예산을 초기화한다. */
  const resetCalendarMetadataRetry = useCallback((targetKey: string) => {
    const retryTimer = calendarMetadataRetryTimerRef.current;
    if (retryTimer !== null) clearTimeout(retryTimer);
    calendarMetadataRetryTimerRef.current = null;
    calendarMetadataRetryStateRef.current =
      resetCalendarMetadataRetryState(targetKey);
  }, [calendarMetadataRetryStateRef, calendarMetadataRetryTimerRef]);

  useEffect(() => {
    // Moving to a different month window invalidates a timer for the old
    // window and grants the new target its own bounded retry budget.
    resetCalendarMetadataRetry(calendarMetadataRetryTargetKey);
  }, [calendarMetadataRetryTargetKey, resetCalendarMetadataRetry]);

  /** 불완전한 월 메타데이터에 대해 현재 대상이 유지될 때만 제한된 지연 재시도를 예약한다. */
  const scheduleCalendarMetadataRetry = useCallback(
    (targetKey: string) => {
      if (calendarMetadataRetryTargetKeyRef.current !== targetKey) return;
      if (calendarMetadataRetryStateRef.current.targetKey !== targetKey) {
        resetCalendarMetadataRetry(targetKey);
      }
      if (calendarMetadataRetryTimerRef.current !== null) return;

      const retryDecision = getNextCalendarMetadataRetry(
        calendarMetadataRetryStateRef.current,
        targetKey,
      );
      calendarMetadataRetryStateRef.current = retryDecision.state;
      if (retryDecision.delayMs === null) return;

      const retryTimer = setTimeout(() => {
        if (calendarMetadataRetryTimerRef.current !== retryTimer) return;
        calendarMetadataRetryTimerRef.current = null;
        if (
          !calendarMetadataMountedRef.current ||
          calendarMetadataRetryTargetKeyRef.current !== targetKey ||
          calendarMetadataRetryStateRef.current.targetKey !== targetKey
        )
          return;
        setCalendarMetadataRetrySequence(current => current + 1);
      }, retryDecision.delayMs);
      calendarMetadataRetryTimerRef.current = retryTimer;
    },
    [
      calendarMetadataMountedRef,
      calendarMetadataRetryStateRef,
      calendarMetadataRetryTargetKeyRef,
      calendarMetadataRetryTimerRef,
      resetCalendarMetadataRetry,
      setCalendarMetadataRetrySequence,
    ],
  );

  /** 누락된 월만 묶어 메타데이터를 조회하고 제스처 중 결과는 안전한 시점까지 보류한다. */
  const loadCalendarMetadata = useCallback(async (
    monthKeys = calendarMetadataPrefetchMonthKeys,
  ) => {
    if (detailMonthMotionActiveRef.current) {
      // This is gesture deferral, not a server failure. Retry as soon as
      // the gesture ends without consuming either network retry slot.
      calendarMetadataLoadPendingRef.current = true;
      return;
    }
    const requestedMonths = monthKeys.map(monthKey => ({
      monthKey,
      cacheKey: `${firstDay}:${monthKey}`,
    }));
    const missingMonths = requestedMonths.filter(
      ({ cacheKey }) =>
        !calendarMetadataLoadedMonthKeysRef.current.has(cacheKey) &&
        !calendarMetadataInFlightMonthKeysRef.current.has(cacheKey),
    );
    if (missingMonths.length === 0) return;

    const firstMissingMonth = missingMonths[0]?.monthKey ?? fetchVisibleMonth;
    const lastMissingMonth =
      missingMonths[missingMonths.length - 1]?.monthKey ?? fetchVisibleMonth;
    const requestStartDate = getCalendarMetadataRange(
      firstMissingMonth,
      firstDay,
    ).startDate;
    const requestEndDate = getCalendarMetadataRange(
      lastMissingMonth,
      firstDay,
    ).endDate;
    missingMonths.forEach(({ cacheKey }) => {
      calendarMetadataInFlightMonthKeysRef.current.add(cacheKey);
    });
    try {
      const days = await measurePerformanceInteraction(
        'schedule.calendar_metadata_load',
        '/schedule',
        () => getCalendarDays(requestStartDate, requestEndDate),
        'NETWORK',
      );

      if (
        typeof __DEV__ === 'boolean' &&
        __DEV__ &&
        days.length > 0 &&
        !days.some(
          day => day.lunarMonth !== undefined && day.lunarDay !== undefined,
        )
      ) {
        console.warn(
          '[calendar-metadata] lunar data missing from successful response',
          {
            startDate: requestStartDate,
            endDate: requestEndDate,
            receivedDays: days.length,
          },
        );
      }

      const nextDaysByDate = indexCalendarDays(days);
      const incompleteMonths = missingMonths.filter(
        ({ monthKey }) =>
          !isCalendarMetadataMonthComplete(nextDaysByDate, monthKey),
      );
      const incompleteCacheKeys = new Set(
        incompleteMonths.map(({ cacheKey }) => cacheKey),
      );
      missingMonths.forEach(({ cacheKey }) => {
        if (!incompleteCacheKeys.has(cacheKey)) {
          calendarMetadataLoadedMonthKeysRef.current.add(cacheKey);
        }
      });
      const retryTargetIsCurrent =
        calendarMetadataRetryTargetKeyRef.current ===
        calendarMetadataRetryTargetKey;
      if (incompleteMonths.length > 0 && retryTargetIsCurrent) {
        scheduleCalendarMetadataRetry(calendarMetadataRetryTargetKey);
      } else if (retryTargetIsCurrent) {
        resetCalendarMetadataRetry(calendarMetadataRetryTargetKey);
      }
      if (detailMonthMotionActiveRef.current) {
        pendingCalendarMetadataByDateRef.current = mergeCalendarMetadataDays(
          pendingCalendarMetadataByDateRef.current,
          nextDaysByDate,
        );
      } else {
        mergeCalendarMetadataIntoState(nextDaysByDate);
      }
    } catch (error) {
      // 음력/공휴일은 보조 정보다. 조회 실패가 일정 화면을 막거나 오류 배너를
      // 띄우지 않도록, 마지막으로 성공한 메타데이터를 그대로 유지한다.
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.warn('[calendar-metadata] load failed', {
          startDate: requestStartDate,
          endDate: requestEndDate,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
      if (
        calendarMetadataRetryTargetKeyRef.current ===
        calendarMetadataRetryTargetKey
      ) {
        scheduleCalendarMetadataRetry(calendarMetadataRetryTargetKey);
      }
    } finally {
      missingMonths.forEach(({ cacheKey }) => {
        calendarMetadataInFlightMonthKeysRef.current.delete(cacheKey);
      });
    }
  }, [
    calendarMetadataInFlightMonthKeysRef,
    calendarMetadataLoadPendingRef,
    calendarMetadataLoadedMonthKeysRef,
    calendarMetadataPrefetchMonthKeys,
    calendarMetadataRetryTargetKey,
    calendarMetadataRetryTargetKeyRef,
    detailMonthMotionActiveRef,
    fetchVisibleMonth,
    firstDay,
    mergeCalendarMetadataIntoState,
    pendingCalendarMetadataByDateRef,
    resetCalendarMetadataRetry,
    scheduleCalendarMetadataRetry,
  ]);

  useEffect(() => {
    if (!isFocused) return undefined;

    let cancelled = false;
    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
    let interactionTask: ReturnType<
      typeof InteractionManager.runAfterInteractions
    > | null = null;
    const scheduleMetadataLoads = () => {
      interactionTask?.cancel();
      if (backgroundTimer !== null) clearTimeout(backgroundTimer);
      interactionTask = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        // 일정 조회에 먼저 네트워크 우선권을 주고, 현재 월의 공휴일·음력을
        // 짧게 지연한 뒤 인접 월은 한 번 더 뒤로 미룬다.
        backgroundTimer = setTimeout(() => {
          if (cancelled) return;
          loadCalendarMetadata([fetchVisibleMonth.slice(0, 7)]);
          backgroundTimer = setTimeout(() => {
            backgroundTimer = null;
            if (!cancelled) loadCalendarMetadata();
          }, 900);
        }, 450);
      });
    };
    scheduleMetadataLoads();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return;
      resetCalendarMetadataRetry(calendarMetadataRetryTargetKey);
      scheduleMetadataLoads();
    });
    return () => {
      cancelled = true;
      interactionTask?.cancel();
      if (backgroundTimer !== null) clearTimeout(backgroundTimer);
      subscription.remove();
    };
  }, [
    calendarMetadataRetrySequence,
    calendarMetadataRetryTargetKey,
    fetchVisibleMonth,
    isFocused,
    loadCalendarMetadata,
    resetCalendarMetadataRetry,
  ]);


  return {
    applyScheduleItemsToStore,
    loadCalendarMetadata,
    loadSchedules,
    mergeCalendarMetadataIntoState,
  };
}

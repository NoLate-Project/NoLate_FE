import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Alert, AppState } from 'react-native';

import { getCalendarSchedules, searchSchedules } from '../../../api/schedule';
import { getScheduleCategoriesFromApi } from '../../../api/scheduleCategories';
import {
  getScheduleCalendars,
  type ScheduleCalendar,
} from '../../../api/scheduleCalendars';
import { getShareInbox } from '../../../api/scheduleSharing';
import { getAppNotificationUnreadCount } from '../../../api/notification';
import { refreshCalendarScheduleCache } from '../calendarScheduleCache';
import {
  getCalendarYearScheduleFetchRanges,
  mergeCalendarYearScheduleItems,
} from '../components/calendar/calendarYearScheduleDensity';
import { getWritableScheduleCategories } from '../categoryPermissions';
import {
  isCategoryInCalendarScope,
  isScheduleInCalendarScope,
  normalizeCalendarScope,
  type CalendarScope,
} from '../calendarScope';
import { subscribeAppNotificationReceived } from '../../notification/appNotificationEvents';
import {
  buildShareAttentionSummary,
  readSeenShareAttentionKeys,
  type ShareAttentionSummary,
} from '../../share/shareAttention';
import type { ScheduleCategory, ScheduleItem } from '../types';
import { useScheduleStore } from '../store';

const AUXILIARY_SAFETY_REFRESH_MS = 10 * 60 * 1000;
const SEARCH_MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 450;
const SEARCH_RESULT_LIMIT = 20;
const SEARCH_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_RESULT_CACHE_MAX_ENTRIES = 12;

type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  activeCalendarScope: CalendarScope;
  categoryRetryKey: number;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  getErrorMessage: (error: unknown) => string;
  handledSearchRetryKeyRef: MutableRefObject<number>;
  isFocused: boolean;
  itemsById: Record<string, ScheduleItem>;
  overviewYear: number;
  scheduleCalendars: ScheduleCalendar[];
  scheduleCategories: ScheduleCategory[];
  searchAbortControllerRef: MutableRefObject<AbortController | null>;
  searchInvalidationKey: number;
  searchQuery: string;
  searchResultCacheRef: MutableRefObject<Map<string, {
    items: ScheduleItem[];
    fetchedAt: number;
  }>>;
  searchRetryKey: number;
  searchSequenceRef: MutableRefObject<number>;
  setActiveCalendarScope: SetValue<CalendarScope>;
  setCategoryError: SetValue<string | null>;
  setCategoryLoading: SetValue<boolean>;
  setCategoryRetryKey: SetValue<number>;
  setNotificationUnreadCount: SetValue<number>;
  setScheduleCalendars: SetValue<ScheduleCalendar[]>;
  setSearchError: SetValue<string | null>;
  setSearchLoading: SetValue<boolean>;
  setSearchResults: SetValue<ScheduleItem[]>;
  setShareAttention: SetValue<ShareAttentionSummary>;
  setYearOverviewItemsByYear: SetValue<Record<number, ScheduleItem[]>>;
  yearOverviewItemsByYear: Record<number, ScheduleItem[]>;
  yearOverviewLoadedYearsRef: MutableRefObject<Set<number>>;
  yearOverviewLoadInFlightRef: MutableRefObject<Map<number, Promise<void>>>;
  yearOverviewLoadSessionRef: MutableRefObject<number>;
  yearOverviewPresentationRequest: number;
  yearOverviewVisible: boolean;
};

/**
 * 공유·알림 배지와 카테고리·캘린더·연간 일정·검색 결과 같은 보조 데이터를 관리한다.
 * 포커스·푸시·재시도·검색 캐시를 결합하되 실패가 기본 일정 화면을 막지 않도록 독립적으로 갱신한다.
 */
export function useScheduleIndexAuxiliaryData({
  activeCalendarScope,
  categoryRetryKey,
  dispatch,
  getErrorMessage,
  handledSearchRetryKeyRef,
  isFocused,
  itemsById,
  overviewYear,
  scheduleCalendars,
  scheduleCategories,
  searchAbortControllerRef,
  searchInvalidationKey,
  searchQuery,
  searchResultCacheRef,
  searchRetryKey,
  searchSequenceRef,
  setActiveCalendarScope,
  setCategoryError,
  setCategoryLoading,
  setCategoryRetryKey,
  setNotificationUnreadCount,
  setScheduleCalendars,
  setSearchError,
  setSearchLoading,
  setSearchResults,
  setShareAttention,
  setYearOverviewItemsByYear,
  yearOverviewItemsByYear,
  yearOverviewLoadedYearsRef,
  yearOverviewLoadInFlightRef,
  yearOverviewLoadSessionRef,
  yearOverviewPresentationRequest,
  yearOverviewVisible,
}: Options) {
  const state = {
    categories: scheduleCategories,
    itemsById,
  };
  /** 공유함의 미확인 항목 수를 조회하고 화면 이탈 뒤 도착한 응답은 반영하지 않는다. */
  const loadShareAttention = useCallback(async () => {
    const [inbox, seenKeys] = await Promise.all([
      getShareInbox(),
      readSeenShareAttentionKeys(),
    ]);

    return buildShareAttentionSummary(inbox, seenKeys);
  }, []);

  useEffect(() => {
    if (!isFocused) return undefined;

    let cancelled = false;
    let auxiliaryRefreshInFlight: Promise<void> | null = null;
    let auxiliaryRefreshPending = false;
    let auxiliarySafetyTimer: ReturnType<typeof setInterval> | null = null;
    let observedAppState = AppState.currentState;
    let lastAuxiliaryRefreshAt: number | null = null;

    /** 알림·공유 배지를 한 번에 갱신하되 짧은 간격의 중복 신호는 단일 요청으로 합친다. */
    const refreshAuxiliaryData = (minimumIntervalMs = 0) => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        auxiliaryRefreshPending = true;
        return;
      }
      // A push or genuine foreground transition can arrive while the
      // current GET pair still represents the older snapshot. Collapse
      // any such burst into exactly one trailing pair instead of losing it.
      if (auxiliaryRefreshInFlight) {
        auxiliaryRefreshPending = true;
        return;
      }

      const now = Date.now();
      if (
        lastAuxiliaryRefreshAt !== null &&
        now - lastAuxiliaryRefreshAt < minimumIntervalMs
      )
        return;
      auxiliaryRefreshPending = false;
      lastAuxiliaryRefreshAt = now;

      let request: Promise<void>;
      request = Promise.all([
        loadShareAttention()
          .then(summary => {
            if (!cancelled) setShareAttention(summary);
          })
          .catch(() => {
            // 공유함 알림 표시는 보조 신호라 실패해도 일정 화면 사용 흐름은 유지한다.
          }),
        getAppNotificationUnreadCount()
          .then(count => {
            if (!cancelled) setNotificationUnreadCount(count);
          })
          .catch(() => {
            // 알림 배지는 보조 정보다. 일시적인 조회 실패가 캘린더 사용을 막지 않는다.
          }),
      ])
        .then(() => undefined)
        .finally(() => {
          if (auxiliaryRefreshInFlight === request) {
            auxiliaryRefreshInFlight = null;
          }
          if (
            cancelled ||
            !auxiliaryRefreshPending ||
            AppState.currentState !== 'active'
          )
            return;
          refreshAuxiliaryData();
        });
      auxiliaryRefreshInFlight = request;
    };

    /** 포그라운드 보조 갱신 타이머를 해제해 화면 이탈 뒤 요청이 이어지지 않게 한다. */
    const stopAuxiliarySafetyTimer = () => {
      if (auxiliarySafetyTimer === null) return;
      clearInterval(auxiliarySafetyTimer);
      auxiliarySafetyTimer = null;
    };
    /** 푸시 누락에 대비한 저빈도 안전 갱신 타이머를 새로 시작한다. */
    const startAuxiliarySafetyTimer = () => {
      if (
        cancelled ||
        AppState.currentState !== 'active' ||
        auxiliarySafetyTimer !== null
      )
        return;
      auxiliarySafetyTimer = setInterval(
        () => refreshAuxiliaryData(AUXILIARY_SAFETY_REFRESH_MS),
        AUXILIARY_SAFETY_REFRESH_MS,
      );
    };

    if (AppState.currentState === 'active') {
      refreshAuxiliaryData();
      startAuxiliarySafetyTimer();
    }
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        // React Navigation focus and AppState can report the same
        // foreground boundary. Only a real state edge starts work.
        if (nextState === observedAppState) return;
        observedAppState = nextState;
        if (nextState === 'active') {
          startAuxiliarySafetyTimer();
          refreshAuxiliaryData();
        } else {
          stopAuxiliarySafetyTimer();
        }
      },
    );
    const unsubscribeReceived = subscribeAppNotificationReceived(() => {
      // Push is the primary invalidation signal for both badges. Requests
      // still single-flight when several notifications arrive together.
      refreshAuxiliaryData();
    });

    return () => {
      cancelled = true;
      stopAuxiliarySafetyTimer();
      appStateSubscription.remove();
      unsubscribeReceived();
    };
  }, [
    isFocused,
    loadShareAttention,
    setNotificationUnreadCount,
    setShareAttention,
  ]);

  useEffect(() => {
    let cancelled = false;
    setCategoryLoading(true);

    getScheduleCategoriesFromApi()
      .then(categories => {
        if (cancelled) return;
        dispatch({ type: 'SET_CATEGORIES', categories });
        setCategoryError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setCategoryError('카테고리를 불러오지 못했어요.');
        }
      })
      .finally(() => {
        if (!cancelled) setCategoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    categoryRetryKey,
    dispatch,
    isFocused,
    setCategoryError,
    setCategoryLoading,
  ]);

  useEffect(() => {
    if (!isFocused) return undefined;
    let cancelled = false;
    getScheduleCalendars()
      .then(calendars => {
        if (cancelled) return;
        setScheduleCalendars(calendars);
        setActiveCalendarScope(current =>
          normalizeCalendarScope(current, calendars),
        );
      })
      .catch(() => {
        // 개인/전체 캘린더는 네트워크 오류에도 계속 사용할 수 있다.
      });
    return () => {
      cancelled = true;
    };
  }, [isFocused, setActiveCalendarScope, setScheduleCalendars]);

  /** 카테고리 조회 재시도 키를 증가시켜 로딩 효과를 다시 실행한다. */
  const retryCategoryLoad = useCallback(() => {
    setCategoryRetryKey(value => value + 1);
  }, [setCategoryRetryKey]);

  const allItemsArray = useMemo(
    () => Object.values(state.itemsById),
    [state.itemsById],
  );
  const itemsArray = useMemo(
    () =>
      allItemsArray.filter(item =>
        isScheduleInCalendarScope(item, activeCalendarScope),
      ),
    [activeCalendarScope, allItemsArray],
  );
  /** 지정 연도의 월별 일정 범위를 병렬 조회하고 성공한 스냅샷만 연간 보기 캐시에 병합한다. */
  const loadYearOverviewSchedules = useCallback((targetYear: number) => {
    if (!Number.isInteger(targetYear)) return;
    if (
      yearOverviewLoadedYearsRef.current.has(targetYear) ||
      yearOverviewLoadInFlightRef.current.has(targetYear)
    )
      return;

    const loadSession = yearOverviewLoadSessionRef.current;
    let request: Promise<void>;
    request = Promise.allSettled(
      getCalendarYearScheduleFetchRanges(targetYear).map(range =>
        refreshCalendarScheduleCache(
          range.startAt,
          range.endAt,
          getCalendarSchedules,
        ),
      ),
    )
      .then(results => {
        if (loadSession !== yearOverviewLoadSessionRef.current) return;

        const snapshots = results.flatMap(result =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        if (snapshots.length === 0) return;

        yearOverviewLoadedYearsRef.current.add(targetYear);
        setYearOverviewItemsByYear(current => ({
          ...current,
          [targetYear]: mergeCalendarYearScheduleItems(
            snapshots.flatMap(snapshot => snapshot.items),
          ),
        }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (yearOverviewLoadInFlightRef.current.get(targetYear) === request) {
          yearOverviewLoadInFlightRef.current.delete(targetYear);
        }
      });
    yearOverviewLoadInFlightRef.current.set(targetYear, request);
  }, [
    setYearOverviewItemsByYear,
    yearOverviewLoadInFlightRef,
    yearOverviewLoadSessionRef,
    yearOverviewLoadedYearsRef,
  ]);
  const yearOverviewItems = useMemo(
    () =>
      mergeCalendarYearScheduleItems([
        ...Object.values(yearOverviewItemsByYear).flat(),
        ...itemsArray,
      ]).filter(item => isScheduleInCalendarScope(item, activeCalendarScope)),
    [activeCalendarScope, itemsArray, yearOverviewItemsByYear],
  );

  useEffect(() => {
    yearOverviewLoadSessionRef.current += 1;
    yearOverviewLoadedYearsRef.current.clear();
    yearOverviewLoadInFlightRef.current.clear();
    setYearOverviewItemsByYear({});
    if (!yearOverviewVisible) return;

    loadYearOverviewSchedules(overviewYear);
  }, [
    loadYearOverviewSchedules,
    overviewYear,
    setYearOverviewItemsByYear,
    yearOverviewPresentationRequest,
    yearOverviewVisible,
    yearOverviewLoadInFlightRef,
    yearOverviewLoadSessionRef,
    yearOverviewLoadedYearsRef,
  ]);
  // The calendar range already contains the nearby schedules needed by the
  // agenda notice. Reuse it instead of issuing an unbounded /api/schedules
  // request on every focus/foreground transition.
  const routeSetupItems = useMemo(
    () => itemsArray.filter(item => item.routeSetupRequired === true),
    [itemsArray],
  );
  const writableCategories = useMemo(
    () =>
      getWritableScheduleCategories(state.categories).filter(category =>
        isCategoryInCalendarScope(category, activeCalendarScope),
      ),
    [activeCalendarScope, state.categories],
  );
  const activeScopeCalendar = useMemo(
    () =>
      typeof activeCalendarScope === 'number'
        ? scheduleCalendars.find(
            calendar => calendar.id === activeCalendarScope,
          ) ?? null
        : null,
    [activeCalendarScope, scheduleCalendars],
  );
  /** 현재 캘린더의 쓰기 권한을 확인하고 보기 전용이면 사용자 안내 후 작업을 중단한다. */
  const requireActiveCalendarWriteAccess = useCallback(() => {
    if (activeScopeCalendar?.myRole !== 'VIEWER') return true;
    Alert.alert('보기 전용 캘린더', '이 캘린더에는 일정을 추가할 수 없어요.');
    return false;
  }, [activeScopeCalendar]);
  const normalizedSearchKeyword = searchQuery.trim().replace(/\s+/g, ' ');
  const normalizedSearchCacheKey = `${String(
    activeCalendarScope,
  )}:${normalizedSearchKeyword.toLowerCase()}`;
  const searchKeywordLength = Array.from(normalizedSearchKeyword).length;
  useEffect(() => {
    const sequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequence;
    const forceRefresh = handledSearchRetryKeyRef.current !== searchRetryKey;
    handledSearchRetryKeyRef.current = searchRetryKey;
    if (!isFocused || searchKeywordLength < SEARCH_MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return undefined;
    }

    const cache = searchResultCacheRef.current;
    const cached = cache.get(normalizedSearchCacheKey);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.fetchedAt < SEARCH_RESULT_CACHE_TTL_MS
    ) {
      // Refresh insertion order so the small cache behaves as LRU while
      // repeated equivalent queries stay entirely local.
      cache.delete(normalizedSearchCacheKey);
      cache.set(normalizedSearchCacheKey, cached);
      setSearchResults(cached.items);
      setSearchLoading(false);
      setSearchError(null);
      return undefined;
    }

    setSearchLoading(true);
    setSearchError(null);
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;
    const timer = setTimeout(() => {
      searchSchedules(
        {
          keyword: normalizedSearchKeyword,
          limit: SEARCH_RESULT_LIMIT,
        },
        abortController.signal,
      )
        .then(items => {
          if (
            abortController.signal.aborted ||
            searchSequenceRef.current !== sequence
          )
            return;
          const visibleItems = [...items]
            .filter(item =>
              isScheduleInCalendarScope(item, activeCalendarScope),
            )
            .sort(
              (a, b) =>
                new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
            )
            .slice(0, SEARCH_RESULT_LIMIT);
          cache.delete(normalizedSearchCacheKey);
          cache.set(normalizedSearchCacheKey, {
            items: visibleItems,
            fetchedAt: Date.now(),
          });
          while (cache.size > SEARCH_RESULT_CACHE_MAX_ENTRIES) {
            const oldestKey = cache.keys().next().value;
            if (typeof oldestKey !== 'string') break;
            cache.delete(oldestKey);
          }
          setSearchResults(visibleItems);
        })
        .catch(error => {
          if (
            abortController.signal.aborted ||
            searchSequenceRef.current !== sequence
          )
            return;
          setSearchResults([]);
          setSearchError(getErrorMessage(error));
        })
        .finally(() => {
          if (searchAbortControllerRef.current === abortController) {
            searchAbortControllerRef.current = null;
          }
          if (
            !abortController.signal.aborted &&
            searchSequenceRef.current === sequence
          )
            setSearchLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abortController.abort();
      if (searchAbortControllerRef.current === abortController) {
        searchAbortControllerRef.current = null;
      }
    };
  }, [
    isFocused,
    normalizedSearchCacheKey,
    normalizedSearchKeyword,
    activeCalendarScope,
    getErrorMessage,
    handledSearchRetryKeyRef,
    searchAbortControllerRef,
    searchInvalidationKey,
    searchKeywordLength,
    searchResultCacheRef,
    searchRetryKey,
    searchSequenceRef,
    setSearchError,
    setSearchLoading,
    setSearchResults,
  ]);


  return {
    activeScopeCalendar,
    allItemsArray,
    itemsArray,
    loadYearOverviewSchedules,
    requireActiveCalendarWriteAccess,
    retryCategoryLoad,
    routeSetupItems,
    searchKeywordLength,
    writableCategories,
    yearOverviewItems,
  };
}

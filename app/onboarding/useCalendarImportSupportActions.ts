import { useRouter } from 'expo-router';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback } from 'react';
import { Alert, Keyboard } from 'react-native';

import { completeMemberCuration } from '../../src/api/member';
import { getScheduleCategoriesFromApi } from '../../src/api/scheduleCategories';
import { saveAuthCurationCompleted } from '../../src/modules/auth/authStorage';
import {
  searchAddressByKeyword,
  type PlaceSearchItem,
} from '../../src/modules/map/routingService';
import { getWritableCalendarImportCategories } from '../../src/modules/onboarding/calendarImportCategory';
import { withCalendarImportTimeout } from '../../src/modules/onboarding/calendarImportReliability';
import {
  hasFavoriteDepartureCoords,
  saveFavoriteDeparturePlace,
} from '../../src/modules/schedule/favoriteDeparture';
import { useScheduleStore } from '../../src/modules/schedule/store';
import type { Place, ScheduleCategory } from '../../src/modules/schedule/types';
import {
  getErrorMessage,
  isSamePlace,
  PLACE_SEARCH_TIMEOUT_MS,
  type CalendarConsentId,
  type CalendarConsentItem,
  type CalendarProviderId,
  type OnboardingStep,
} from './calendarImportModel';

type CalendarImportSupportActionParams = {
  categoryLoadSequenceRef: MutableRefObject<number>;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  setCategoryLoading: Dispatch<SetStateAction<boolean>>;
  setCategoryError: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setCategoryId: Dispatch<SetStateAction<string>>;
  expandedCategorySourceKey: string | null;
  setCategoryIdBySource: Dispatch<SetStateAction<Record<string, string>>>;
  setExpandedCategorySourceKey: Dispatch<SetStateAction<string | null>>;
  isCurationCompleted: boolean;
  syncAuthentication: () => Promise<boolean>;
  completingCuration: boolean;
  importing: boolean;
  categoryCreating: boolean;
  isManagementEntry: boolean;
  step: OnboardingStep;
  scanAttemptRef: MutableRefObject<number>;
  router: ReturnType<typeof useRouter>;
  setCompletingCuration: Dispatch<SetStateAction<boolean>>;
  originSearchQuery: string;
  originSearching: boolean;
  originSearchSequenceRef: MutableRefObject<number>;
  setOriginSearching: Dispatch<SetStateAction<boolean>>;
  setOriginSearchError: Dispatch<SetStateAction<string | null>>;
  setOriginSearchResults: Dispatch<SetStateAction<PlaceSearchItem[]>>;
  setOriginSearchQuery: Dispatch<SetStateAction<string>>;
  defaultOriginSaveRequestIdRef: MutableRefObject<number>;
  setDefaultOrigin: Dispatch<SetStateAction<Place | undefined>>;
  setFavoriteDeparturePlaces: Dispatch<SetStateAction<Place[]>>;
  setSelectedProviderIds: Dispatch<SetStateAction<Set<CalendarProviderId>>>;
  setAcceptedCalendarConsentIds: Dispatch<
    SetStateAction<Set<CalendarConsentId>>
  >;
  allCalendarConsentsAccepted: boolean;
  calendarConsentItemIds: CalendarConsentId[];
  calendarConsentItems: CalendarConsentItem[];
  setExpandedCalendarConsentIds: Dispatch<
    SetStateAction<Set<CalendarConsentId>>
  >;
};

/** 카테고리 로딩, 큐레이션 완료, 기본 출발지 검색 동작을 안정적인 콜백으로 묶습니다. */
export function useCalendarImportSupportActions(
  params: CalendarImportSupportActionParams,
) {
  const {
    categoryLoadSequenceRef,
    dispatch,
    setCategoryLoading,
    setCategoryError,
    setErrorMessage,
    setCategoryId,
    expandedCategorySourceKey,
    setCategoryIdBySource,
    setExpandedCategorySourceKey,
    isCurationCompleted,
    syncAuthentication,
    completingCuration,
    importing,
    categoryCreating,
    isManagementEntry,
    step,
    scanAttemptRef,
    router,
    setCompletingCuration,
    originSearchQuery,
    originSearching,
    originSearchSequenceRef,
    setOriginSearching,
    setOriginSearchError,
    setOriginSearchResults,
    setOriginSearchQuery,
    defaultOriginSaveRequestIdRef,
    setDefaultOrigin,
    setFavoriteDeparturePlaces,
    setSelectedProviderIds,
    setAcceptedCalendarConsentIds,
    allCalendarConsentsAccepted,
    calendarConsentItemIds,
    calendarConsentItems,
    setExpandedCalendarConsentIds,
  } = params;

  const loadCategories = useCallback(async () => {
    const sequence = categoryLoadSequenceRef.current + 1;
    categoryLoadSequenceRef.current = sequence;
    setCategoryLoading(true);
    setCategoryError(null);

    try {
      const nextCategories = await getScheduleCategoriesFromApi();
      if (sequence !== categoryLoadSequenceRef.current) return;

      const writableCategories =
        getWritableCalendarImportCategories(nextCategories);
      if (writableCategories.length === 0) {
        throw new Error('일정을 저장할 카테고리가 없어요.');
      }

      dispatch({ type: 'SET_CATEGORIES', categories: nextCategories });
      setCategoryId(current =>
        writableCategories.some(category => category.id === current)
          ? current
          : writableCategories[0].id,
      );
    } catch {
      if (sequence !== categoryLoadSequenceRef.current) return;
      setCategoryError('카테고리를 불러오지 못했어요. 다시 확인해 주세요.');
    } finally {
      if (sequence === categoryLoadSequenceRef.current)
        setCategoryLoading(false);
    }
  }, [
    categoryLoadSequenceRef,
    dispatch,
    setCategoryError,
    setCategoryId,
    setCategoryLoading,
  ]);

  const handleCategoryCreated = useCallback(
    (category: ScheduleCategory) => {
      dispatch({ type: 'UPSERT_CATEGORY', category });
      if (expandedCategorySourceKey) {
        setCategoryIdBySource(current => ({
          ...current,
          [expandedCategorySourceKey]: category.id,
        }));
        setExpandedCategorySourceKey(null);
      } else {
        setCategoryId(category.id);
      }
      setCategoryError(null);
    },
    [
      dispatch,
      expandedCategorySourceKey,
      setCategoryError,
      setCategoryId,
      setCategoryIdBySource,
      setExpandedCategorySourceKey,
    ],
  );

  const persistCurationCompletion = async () => {
    if (isCurationCompleted) return;

    const status = await completeMemberCuration();
    if (!status.curationCompleted) {
      throw new Error('캘린더 설정을 저장하지 못했어요.');
    }

    // 서버 저장이 끝난 뒤 로컬 인증 상태를 갱신해야 보호된 일정 화면이 열린다.
    await saveAuthCurationCompleted(true);
    const authenticated = await syncAuthentication();
    if (!authenticated) {
      throw new Error('로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.');
    }
  };

  const finishCuration = async () => {
    if (completingCuration || importing || categoryCreating) return;

    if (isManagementEntry && step !== 'complete') {
      scanAttemptRef.current += 1;
      if (router.canGoBack()) router.back();
      else router.replace('/profile');
      return;
    }

    try {
      setCompletingCuration(true);
      await persistCurationCompletion();
      scanAttemptRef.current += 1;
      router.replace('/schedule');
    } catch (error) {
      Alert.alert(
        '완료 상태 저장 실패',
        getErrorMessage(error, '네트워크를 확인하고 다시 시도해 주세요.'),
      );
    } finally {
      setCompletingCuration(false);
    }
  };

  const searchDefaultOrigin = async () => {
    const query = originSearchQuery.trim();
    if (!query || originSearching) return;
    const sequence = originSearchSequenceRef.current + 1;
    originSearchSequenceRef.current = sequence;

    try {
      setOriginSearching(true);
      setOriginSearchError(null);
      const results = await withCalendarImportTimeout(
        searchAddressByKeyword(query),
        {
          timeoutMs: PLACE_SEARCH_TIMEOUT_MS,
          operationName: '주 출발지 검색',
        },
      );
      if (sequence !== originSearchSequenceRef.current) return;
      setOriginSearchResults(results.slice(0, 5));
      if (results.length === 0) {
        setOriginSearchError(
          '검색 결과가 없어요. 건물명이나 도로명 주소로 다시 검색해 주세요.',
        );
      }
    } catch (error) {
      if (sequence !== originSearchSequenceRef.current) return;
      setOriginSearchResults([]);
      setOriginSearchError(
        getErrorMessage(error, '출발지를 검색하지 못했습니다.'),
      );
    } finally {
      if (sequence === originSearchSequenceRef.current)
        setOriginSearching(false);
    }
  };

  const changeOriginSearchQuery = (value: string) => {
    originSearchSequenceRef.current += 1;
    setOriginSearchQuery(value);
    setOriginSearching(false);
    setOriginSearchResults([]);
    setOriginSearchError(null);
  };

  const selectDefaultOrigin = (place: Place) => {
    if (!hasFavoriteDepartureCoords(place)) return;

    Keyboard.dismiss();
    const requestId = defaultOriginSaveRequestIdRef.current + 1;
    defaultOriginSaveRequestIdRef.current = requestId;
    setDefaultOrigin(place);
    setOriginSearchQuery(place.name?.trim() || place.address?.trim() || '');
    setOriginSearchResults([]);
    setOriginSearchError(null);
    setFavoriteDeparturePlaces(current =>
      [place, ...current.filter(item => !isSamePlace(item, place))].slice(0, 5),
    );

    saveFavoriteDeparturePlace(place)
      .then(saved => {
        if (requestId !== defaultOriginSaveRequestIdRef.current || !saved)
          return;
        setDefaultOrigin(saved);
        setFavoriteDeparturePlaces(current =>
          [saved, ...current.filter(item => !isSamePlace(item, saved))].slice(
            0,
            5,
          ),
        );
        setOriginSearchError(null);
      })
      .catch(error => {
        if (requestId !== defaultOriginSaveRequestIdRef.current) return;
        // 현재 가져오기는 메모리의 선택값으로 진행할 수 있지만 계정 동기화 실패는 숨기지 않는다.
        setOriginSearchError(
          '기본 출발지를 계정에 저장하지 못했어요. 네트워크를 확인해 주세요.',
        );
        console.warn('[calendar-import] default origin save failed', error);
      });
  };

  const toggleProvider = (providerId: CalendarProviderId) => {
    setErrorMessage(null);
    setSelectedProviderIds(current => {
      const next = new Set(current);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const toggleCalendarConsent = (consentId: CalendarConsentId) => {
    setAcceptedCalendarConsentIds(current => {
      const next = new Set(current);
      if (next.has(consentId)) {
        next.delete(consentId);
      } else {
        next.add(consentId);
      }
      return next;
    });
  };

  const toggleAllCalendarConsents = () => {
    setAcceptedCalendarConsentIds(current => {
      if (allCalendarConsentsAccepted) {
        return new Set(
          Array.from(current).filter(
            id => !calendarConsentItemIds.includes(id),
          ),
        );
      }

      return new Set([
        ...Array.from(current),
        ...calendarConsentItems
          .filter(item => item.required)
          .map(item => item.id),
      ]);
    });
  };

  const toggleCalendarConsentDetail = (consentId: CalendarConsentId) => {
    setExpandedCalendarConsentIds(current => {
      const next = new Set(current);
      if (next.has(consentId)) {
        next.delete(consentId);
      } else {
        next.add(consentId);
      }
      return next;
    });
  };

  return {
    loadCategories,
    handleCategoryCreated,
    persistCurationCompletion,
    finishCuration,
    searchDefaultOrigin,
    changeOriginSearchQuery,
    selectDefaultOrigin,
    toggleProvider,
    toggleCalendarConsent,
    toggleAllCalendarConsents,
    toggleCalendarConsentDetail,
  };
}

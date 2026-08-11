import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import type { SubscriptionPolicy } from '../../src/api/subscription';
import {
  getRouteAlternativeOptions,
  searchAddressByKeyword,
  type RoutePathCoord,
} from '../../src/modules/map/routingService';
import { recordCalendarImportCompleted } from '../../src/modules/onboarding/calendarConnectionStorage';
import { createCalendarImportAlarmRecoveryBatch } from '../../src/modules/onboarding/calendarImportAlarmRecoveryBatch';
import {
  getCalendarImportSourceKey,
  resolveCalendarImportCategoryAssignment,
} from '../../src/modules/onboarding/calendarImportCategory';
import { withCalendarImportTimeout } from '../../src/modules/onboarding/calendarImportReliability';
import {
  enableCalendarImportNotification,
  enrichCalendarCandidateWithRoute,
  extractCalendarRouteHints,
} from '../../src/modules/onboarding/calendarImportRouteEnrichment';
import {
  buildSchedulePayloadFromCandidate,
  type DeviceCalendarCandidate,
} from '../../src/modules/onboarding/deviceCalendarImport';
import { useScheduleStore } from '../../src/modules/schedule/store';
import type {
  Place,
  ScheduleCategory,
  TravelMode,
} from '../../src/modules/schedule/types';
import {
  buildPlaceSearchCacheKey,
  createImportedSchedule,
  getErrorMessage,
  IMPORT_BATCH_SIZE,
  PLACE_SEARCH_TIMEOUT_MS,
  ROUTE_SEARCH_TIMEOUT_MS,
  type OnboardingStep,
} from './calendarImportModel';

type CalendarImportActionParams = {
  selectedCategory?: ScheduleCategory;
  routesReadyForImport: boolean;
  selectedCandidates: DeviceCalendarCandidate[];
  importing: boolean;
  categoryCreating: boolean;
  setImporting: Dispatch<SetStateAction<boolean>>;
  setImportProgress: Dispatch<SetStateAction<number>>;
  setAlreadyImportedCount: Dispatch<SetStateAction<number>>;
  setPreparedRouteCount: Dispatch<SetStateAction<number>>;
  setNotificationReadyCount: Dispatch<SetStateAction<number>>;
  setFailedImportCount: Dispatch<SetStateAction<number>>;
  setLastImportPreparedRoutes: Dispatch<SetStateAction<boolean>>;
  travelMode: TravelMode;
  travelMinutes: number;
  categories: ScheduleCategory[];
  categoryId: string;
  categoryIdBySource: Record<string, string>;
  defaultOrigin?: Place;
  remainingNotificationQuota: number;
  subscriptionPolicy: SubscriptionPolicy;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  persistCurationCompletion: () => Promise<void>;
  goToStep: (step: OnboardingStep) => void;
  setImportedCount: Dispatch<SetStateAction<number>>;
};

/** 선택 일정의 장소·경로 보강, 저장, 알림 복구를 순서대로 실행하는 동작을 구성합니다. */
export function createCalendarImportActions({
  selectedCategory,
  routesReadyForImport,
  selectedCandidates,
  importing,
  categoryCreating,
  setImporting,
  setImportProgress,
  setAlreadyImportedCount,
  setPreparedRouteCount,
  setNotificationReadyCount,
  setFailedImportCount,
  setLastImportPreparedRoutes,
  travelMode,
  travelMinutes,
  categories,
  categoryId,
  categoryIdBySource,
  defaultOrigin,
  remainingNotificationQuota,
  subscriptionPolicy,
  dispatch,
  persistCurationCompletion,
  goToStep,
  setImportedCount,
}: CalendarImportActionParams) {
  const importSelectedSchedules = async () => {
    const importCategory = selectedCategory;
    // A missing default origin should only skip optional route enrichment. The selected
    // schedules can still be saved, so the final action never becomes a dead end.
    const shouldPrepareRoutes = routesReadyForImport;
    if (
      selectedCandidates.length === 0 ||
      importing ||
      categoryCreating ||
      !importCategory
    )
      return;

    const alarmRecoveryBatch = createCalendarImportAlarmRecoveryBatch();
    try {
      setImporting(true);
      setImportProgress(0);
      setAlreadyImportedCount(0);
      setPreparedRouteCount(0);
      setNotificationReadyCount(0);
      setFailedImportCount(0);
      setLastImportPreparedRoutes(shouldPrepareRoutes);

      let successCount = 0;
      let skippedCount = 0;
      let routeCount = 0;
      let enabledNotificationCount = 0;
      let failureCount = 0;
      let processedCount = 0;
      let lastError: unknown;
      const settings = {
        category: importCategory,
        travelMode,
        travelMinutes,
        prepareDepartureAlert: shouldPrepareRoutes,
      };
      const placeCache = new Map<string, Promise<Place | undefined>>();
      const resolvePlace = (
        query: string,
        center?: RoutePathCoord,
      ): Promise<Place | undefined> => {
        const key = buildPlaceSearchCacheKey(query, center);
        const cached = placeCache.get(key);
        if (cached) return cached;

        const request = withCalendarImportTimeout(
          searchAddressByKeyword(
            query,
            center ? { center, radiusKm: 100 } : undefined,
          ),
          {
            timeoutMs: PLACE_SEARCH_TIMEOUT_MS,
            operationName: `장소 검색 (${query})`,
          },
        ).then(results => results[0]);
        placeCache.set(key, request);
        return request;
      };
      const findRoutes = (
        origin: Place,
        destination: Place,
        routeSettings: typeof settings,
        departureAt: Date,
      ) =>
        withCalendarImportTimeout(
          getRouteAlternativeOptions(
            origin,
            destination,
            routeSettings.travelMode,
            { departureAt, searchFutureService: true },
          ),
          {
            timeoutMs: ROUTE_SEARCH_TIMEOUT_MS,
            operationName: '캘린더 일정 경로 생성',
          },
        );

      // 장소·경로 공급자 요청은 세 개씩만 병렬 처리한다. 20개 일정을 한꺼번에 조회해
      // rate limit에 걸리는 것을 막으면서도 일정 하나씩 기다리는 지연은 줄인다.
      for (
        let offset = 0;
        offset < selectedCandidates.length;
        offset += IMPORT_BATCH_SIZE
      ) {
        const batch = selectedCandidates.slice(
          offset,
          offset + IMPORT_BATCH_SIZE,
        );
        const canAttemptMoreNotifications =
          shouldPrepareRoutes &&
          enabledNotificationCount < remainingNotificationQuota;
        const enrichedBatch = await Promise.all(
          batch.map(async candidate => {
            const candidateCategory = resolveCalendarImportCategoryAssignment(
              categories,
              categoryId,
              categoryIdBySource,
              getCalendarImportSourceKey(candidate),
            );
            if (!candidateCategory) {
              throw new Error('일정을 저장할 카테고리를 확인하지 못했어요.');
            }
            const candidateSettings = {
              ...settings,
              category: candidateCategory,
            };
            const enrichment = canAttemptMoreNotifications
              ? await enrichCalendarCandidateWithRoute(
                  candidate,
                  candidateSettings,
                  defaultOrigin,
                  { resolvePlace, findRoutes },
                )
              : {
                  payload: buildSchedulePayloadFromCandidate(
                    candidate,
                    candidateSettings,
                  ),
                  routePrepared: false,
                  hints: extractCalendarRouteHints(candidate),
                };

            return { candidate, ...enrichment };
          }),
        );

        // 일정 생성은 순차 처리해 구독 quota가 동시에 중복 소비되지 않게 한다.
        for (const enriched of enrichedBatch) {
          const shouldEnableNotification =
            enriched.routePrepared &&
            enabledNotificationCount < remainingNotificationQuota;
          const payload = shouldEnableNotification
            ? enableCalendarImportNotification(
                enriched.payload,
                subscriptionPolicy.minEtaRefreshIntervalMinutes,
              )
            : enriched.payload;

          try {
            const result = await alarmRecoveryBatch.run(() =>
              createImportedSchedule(enriched.candidate, payload),
            );
            dispatch({ type: 'ADD_ITEM', item: result.item });
            if (result.created) {
              successCount += 1;
              if (enriched.routePrepared) routeCount += 1;
              if (result.notificationEnabled) enabledNotificationCount += 1;
            } else {
              skippedCount += 1;
            }
          } catch (error) {
            lastError = error;
            failureCount += 1;
          } finally {
            processedCount += 1;
            setImportProgress(processedCount);
          }
        }
      }

      if (successCount === 0 && skippedCount === 0) {
        throw lastError ?? new Error('선택한 일정을 가져오지 못했어요.');
      }

      setImportedCount(successCount);
      setAlreadyImportedCount(skippedCount);
      setPreparedRouteCount(routeCount);
      setNotificationReadyCount(enabledNotificationCount);
      setFailedImportCount(failureCount);
      try {
        await recordCalendarImportCompleted(successCount);
      } catch (error) {
        // 연결 이력 저장이 실패해도 이미 생성된 일정을 다시 보내 중복시키지 않는다.
        console.warn(
          '[calendar-import] completion snapshot save failed',
          error,
        );
      }
      try {
        await persistCurationCompletion();
      } catch (error) {
        // 일정 생성은 이미 끝났으므로 중복 가져오기를 유도하지 않는다. 완료 화면의
        // "내 일정 보기" 버튼이 멱등 완료 API를 다시 호출해 안전하게 복구한다.
        console.warn('[calendar-import] account completion save failed', error);
      }
      goToStep('complete');
    } catch (error) {
      Alert.alert(
        '가져오기 실패',
        getErrorMessage(error, '선택한 일정을 가져오지 못했어요.'),
      );
    } finally {
      await alarmRecoveryBatch.finish();
      setImporting(false);
    }
  };

  return { importSelectedSchedules };
}

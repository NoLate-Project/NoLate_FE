import { hasPersistableScheduleRoute } from "../../modules/schedule/scheduleRouteTiming";
import { getImportedTicket } from "../../modules/schedule/importedTicket";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, useWindowDimensions } from 'react-native';
import { createLatestRequestGuard } from '../../modules/map/routeAsyncGuard';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getSchedule,
  sendScheduleDepartureNudge,
} from '../../api/schedule';
import { fromISO } from '../../../lib/util/data';
import {
  getScheduleTravelPlan,
  upsertMyScheduleTravelPlan,
} from '../../api/scheduleTravelPlans';
import {
  canEditPresentedSchedule,
  canManagePresentedSchedule,
} from '../../modules/schedule/schedulePermissions';
import { getSavedRouteEntryPath } from '../../modules/schedule/savedRouteDetailPresentation';
import { getScheduleFocusDay } from '../../modules/schedule/calendarNavigation';
import { useScheduleStore } from '../../modules/schedule/store';
import type {
  ScheduleTravelPlan,
  ScheduleTravelPlanParticipant,
} from '../../modules/schedule/types';
import {
  buildScheduleRoutePlannerInitial,
  consumeScheduleRouteUpdatePayload,
  isRoutePlannerFlowPath,
  observeRoutePlannerReturn,
  setRoutePlannerInitial,
  type ScheduleRouteUpdatePayload,
} from '../../modules/schedule/routePlannerSession';
import { isRouteSetupEntryRequested } from '../../modules/schedule/routeSetupNavigation';
import { isRouteDetailEntryRequested } from '../../modules/schedule/routeDetailNavigation';
import { goBackFromScheduleDetail } from '../../modules/schedule/scheduleDetailNavigation';
import { useTheme } from '../../modules/theme/ThemeContext';
import { getAuthMember } from '../../modules/auth/authStorage';
import { canOpenParticipantTravelPlan } from '../../modules/schedule/travelPlanPresentation';
import { completeScheduleDeparture } from '../../modules/schedule/scheduleDepartureCompletion';
import { canOpenJourneyGuidance } from '../../modules/journey/journeyFeature';
import { buildSavedJourneyInput } from '../../modules/journey/savedJourneyGuidance';
import { useGuidanceActivityHandoff, useGuidanceActivityRepeatTap } from '../../modules/journey/useGuidanceActivityHandoff';
import { automaticUUID } from '../../modules/journey/automaticJourney';
import { revalidateAutomaticJourneySavedRoute } from '../../modules/journey/automaticJourneyTrial';
import { saveScheduleRouteAsMyTravelPlan } from '../../modules/schedule/scheduleTravelPlanSave';
import { classifyDepartureNudgeResult } from '../../modules/schedule/departureNudgeResult';
import { measurePerformanceInteraction } from '../../modules/performance/interactionPerformance';
import { runAfterScreenTransition } from '../../modules/performance/runAfterScreenTransition';
import { useImmediateNavigationTransition } from '../../modules/performance/ImmediateNavigationTransition';
import {
  buildEffectiveTransitRoutePresentation,
  buildFutureTimetablePredictionPresentation,
  buildPlannedJourneyArrivalPresentation,
  resolveScheduleDetailDepartureTiming,
} from '../../modules/schedule/effectiveTransitRoutePresentation';
import {
  primeRouteDetailAdvertising,
  showRouteDetailInterstitialIfEligible,
} from '../../modules/advertising/routeDetailInterstitial';
import {
  DEPARTURE_COUNTDOWN_REFRESH_MS,
  MINUTE_MS,
} from './ScheduleDetailChrome';
import {
  getDepartureDisplayState,
  getErrorMessage,
  getRecommendedDepartureAt,
  type DepartureDisplayState,
  type ScheduleDetailPreviewProps,
} from './scheduleDetailModel';
import { useScheduleDetailSheetController } from './useScheduleDetailSheetController';
import { useScheduleDetailMapController } from './useScheduleDetailMapController';
import { applyMatchedTransitTimeline } from '../../modules/schedule/matchedTransitTimeline';
import { useScheduleDepartureStatusController } from './useScheduleDepartureStatusController';

/**
 * 일정 상세 화면의 데이터 로딩, 지도 초점, 출발 상태, 하단 시트와 경로 편집 동작을 관리한다.
 * 렌더러는 이 훅이 반환한 안정된 화면 모델과 명령만 사용해 표시 책임에 집중한다.
 */
export function useScheduleDetailController({
  previewItem,
  initialItem,
  previewOfflineGuidanceMap = false,
  previewGuidanceAuthenticationSource,
  initialSheetMode = 'compact',
  initialParticipantsExpanded = false,
  previewNowMs,
  previewCurrentMemberId,
  onPreviewOpenEditor,
}: ScheduleDetailPreviewProps = {}) {
  const { id: routeId, openRouteSetup, openRouteDetail, entrySource, guidanceSession, navigationMode: navigationModeParam } = useLocalSearchParams<{
    id: string;
    entrySource?: string;
    openRouteSetup?: string | string[];
    openRouteDetail?: string | string[];
    guidanceSession?: string;
    navigationMode?: string;
  }>();
  const pathname = usePathname();
  const router = useRouter();
  const internalPreviewItem =
    typeof __DEV__ === 'boolean' && __DEV__ ? previewItem : undefined;
  const id = internalPreviewItem?.id ?? routeId ?? initialItem?.id;
  const [navigationScheduleId, setNavigationScheduleId] = useState<string | null>(
    () => !internalPreviewItem && navigationModeParam === '1' && id ? id : null,
  );
  const [navigationEnd, setNavigationEnd] = useState<{ scheduleId: string; reason: string }>();
  useEffect(() => {
    if (!internalPreviewItem && navigationModeParam === '1' && id) setNavigationScheduleId(id);
  }, [id, internalPreviewItem, navigationModeParam]);
  const { runWithTransitionShell } = useImmediateNavigationTransition();
  const goBackNormally = useCallback(() => {
    if ((entrySource === 'calendar-search' || entrySource === 'notification-inbox' || entrySource === 'share-inbox') && router.canGoBack()) {
      // Preserve the visible list during the native back transition.
      router.back();
      return;
    }
    runWithTransitionShell(
      { route: '/schedule', title: '일정', showBack: false },
      () => goBackFromScheduleDetail(router),
    );
  }, [entrySource, router, runWithTransitionShell]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, mode } = useTheme();
  const isDark = mode === 'dark';
  const { state, dispatch } = useScheduleStore();
  const [loading, setLoading] = useState(false);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(() =>
    internalPreviewItem && typeof previewCurrentMemberId === 'number'
      ? previewCurrentMemberId
      : null,
  );
  const [memberResolved, setMemberResolved] = useState(false);
  const [departureSubmission, setDepartureSubmission] = useState<{
    scheduleId: string;
    status: 'pending' | 'failed' | 'recorded';
  }>();
  const departureRequests = useRef(new Set<string>()).current;
  const departureSubmissionStatus = departureSubmission?.scheduleId === id
    ? departureSubmission?.status
    : undefined;
  const departureActionPending = departureSubmissionStatus === 'pending';
  const [departureNudgePendingMemberId, setDepartureNudgePendingMemberId] =
    useState<number>();
  const [nowMs, setNowMs] = useState(() =>
    internalPreviewItem && typeof previewNowMs === 'number'
      ? previewNowMs
      : Date.now(),
  );
  const [previewDepartedAt, setPreviewDepartedAt] = useState<string>();
  const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string>();
  const [routeSavePending, setRouteSavePending] = useState(false);
  const [confirmedRouteScheduleId, setConfirmedRouteScheduleId] = useState<string>();
  const routeSaveConfirmed = !!id && confirmedRouteScheduleId === id;
  const [failedRouteSave, setFailedRouteSave] = useState<{
    scheduleId: string;
    payload: ScheduleRouteUpdatePayload;
  }>();
  const routeSaveInFlight = useRef(false);
  const routeDetailAdPendingRef = useRef(false);
  const [inspectedTravelPlan, setInspectedTravelPlan] =
    useState<ScheduleTravelPlan>();
  const [travelPlanDetailPendingMemberId, setTravelPlanDetailPendingMemberId] =
    useState<number>();
  const [failedTravelPlanMemberId, setFailedTravelPlanMemberId] = useState<number>();
  const travelPlanRequests = useRef(createLatestRequestGuard()).current;
  const travelPlanRequestPending = useRef(false);
  const routePlannerWasActiveRef = useRef(false);
  const routePlannerReturnFocusRef = useRef<(() => void) | undefined>(undefined);
  const routePlannerFocusTask = useRef<ReturnType<typeof runAfterScreenTransition> | null>(null);
  const autoOpenedRouteSetupItemIdRef = useRef<string | undefined>(undefined);

  useEffect(() => () => routePlannerFocusTask.current?.cancel(), []);

  const { departureStatus } =
    useScheduleDepartureStatusController({
      scheduleId: id,
      previewEnabled: Boolean(internalPreviewItem),
      routePlannerSessionId,
      routeSavePending,
    });

  const item =
    internalPreviewItem
    ?? (id ? state.itemsById[id] : undefined)
    ?? initialItem;
  const fromGuidanceActivity = !internalPreviewItem && entrySource === 'guidance-activity' && automaticUUID(guidanceSession);
  const authoritativeDetailLoaded = !internalPreviewItem && loadedDetailId === id;
  const guidanceActivityHandoff = useGuidanceActivityHandoff(
    fromGuidanceActivity ? guidanceSession : undefined,
    authoritativeDetailLoaded && !loadError && item?.id === id ? id : undefined,
    (item?.myTravelPlan?.memberId ?? item?.ownerMemberId) === currentMemberId ? currentMemberId : null,
  );
  const guidanceRepeatTap = useGuidanceActivityRepeatTap(id, fromGuidanceActivity ? guidanceSession : undefined);
  const guidanceResumeHandoff = guidanceActivityHandoff === 'resume';
  const liveActivityEntry = guidanceActivityHandoff === 'live' || guidanceResumeHandoff
    ? `${guidanceSession}:${guidanceRepeatTap}` : undefined;
  const navigationMode = navigationScheduleId === id || liveActivityEntry !== undefined;
  const {
    compactSummaryScrollable,
    handleCompactContentSizeChange,
    handleExpandedContentLayout,
    handleSheetHeaderLayout,
    largeRouteHeader,
    participantDisclosureAnimatedStyle,
    participantDisclosureProgress,
    participantsExpanded,
    previewParticipantsExpanded,
    reduceMotion,
    routeMapHeaderHeight,
    setExpandedContentHeight,
    setParticipantsExpanded,
    setRouteHeaderHeight,
    sheetBottomPadding,
    sheetMaxHeight,
    sheetMinHeight,
    sheetMode,
    sheetPanResponder,
    sheetQuickSummaryAnimatedStyle,
    sheetExpandedContentAnimatedStyle,
    sheetHandleAnimatedStyle,
    sheetScrollRef,
    sheetTranslateY,
    snapSheet,
    toggleParticipantsExpanded,
  } = useScheduleDetailSheetController({
    windowHeight,
    bottomInset: insets.bottom,
    previewEnabled: Boolean(internalPreviewItem),
    guidanceNavigation: navigationMode || Boolean(internalPreviewItem && previewOfflineGuidanceMap),
    inspectingCompanion: Boolean(inspectedTravelPlan),
    initialSheetMode,
    initialParticipantsExpanded,
  });
  const goBack = useCallback(() => {
    if (guidanceActivityHandoff !== 'ended' || !item?.startAt) {
      goBackNormally();
      return;
    }
    const focusDay = getScheduleFocusDay(item.startAt);
    if (!focusDay) {
      goBackNormally();
      return;
    }
    router.dismissTo({
      pathname: '/schedule',
      params: { focus: 'month', focusDay, focusSchedule: item.id, focusRun: String(Date.now()) },
    });
  }, [goBackNormally, guidanceActivityHandoff, item?.id, item?.startAt, router]);
  useEffect(() => {
    if (!item || currentMemberId == null || internalPreviewItem) return;
    if (fromGuidanceActivity && (!authoritativeDetailLoaded || loadError)) return;
    // Only the authoritative own route invalidates; opening another schedule/participant does not.
    const own = (item.myTravelPlan?.memberId ?? item.ownerMemberId) === currentMemberId;
    const input = own ? buildSavedJourneyInput(item.route, item.origin, item.destination) : null;
    revalidateAutomaticJourneySavedRoute(String(item.id), input).catch(() => undefined);
  }, [item, currentMemberId, internalPreviewItem, fromGuidanceActivity, authoritativeDetailLoaded, loadError]);
  const canManageSchedule = useMemo(
    () => canManagePresentedSchedule(item, currentMemberId),
    [currentMemberId, item],
  );
  const canEditSchedule = canEditPresentedSchedule(item, canManageSchedule);
  const openScheduleEditor = useCallback(() => {
    setMemoSheetVisible(false);
    requestAnimationFrame(() => {
      if (internalPreviewItem) {
        onPreviewOpenEditor?.();
        return;
      }
      if (!routeId && initialItem) {
        router.push({
          pathname: '/schedule/[id]',
          params: { id: initialItem.id, mode: 'edit' },
        });
        return;
      }
      router.setParams({ mode: 'edit' });
    });
  }, [initialItem, internalPreviewItem, onPreviewOpenEditor, routeId, router]);
  const currentMemberDepartedAt =
    previewDepartedAt ??
    item?.myDepartedAt ??
    (canManageSchedule ? item?.departedAt : undefined);
  const departureParticipants = useMemo(() => {
    const participants = item?.departureParticipants ?? [];
    if (!previewDepartedAt || typeof currentMemberId !== 'number')
      return participants;

    return participants.map(participant =>
      participant.memberId === currentMemberId
        ? { ...participant, departed: true, departedAt: previewDepartedAt }
        : participant,
    );
  }, [currentMemberId, item?.departureParticipants, previewDepartedAt]);
  const savedRecommendedDepartureAt = useMemo(
    () => (item ? getRecommendedDepartureAt(item) : undefined),
    [item],
  );
  const inspectedRecommendedDepartureAt = useMemo(() => {
    if (!inspectedTravelPlan) return undefined;
    if (inspectedTravelPlan.departAt) {
      return fromISO(inspectedTravelPlan.departAt);
    }
    if (typeof inspectedTravelPlan.travelMinutes !== 'number' || !item) {
      return undefined;
    }
    return new Date(
      fromISO(item.startAt).getTime() -
        inspectedTravelPlan.travelMinutes * MINUTE_MS,
    );
  }, [inspectedTravelPlan, item]);
  const displayedDepartureTiming = useMemo(
    () =>
      resolveScheduleDetailDepartureTiming({
        status: departureStatus,
        savedRecommendedDepartureAt,
        savedTravelMinutes: item?.travelMinutes,
        isInspectingTravelPlan: Boolean(inspectedTravelPlan),
        inspectedRecommendedDepartureAt,
        inspectedTravelMinutes: inspectedTravelPlan?.travelMinutes,
      }),
    [
      departureStatus,
      inspectedRecommendedDepartureAt,
      inspectedTravelPlan,
      item?.travelMinutes,
      savedRecommendedDepartureAt,
    ],
  );
  const recommendedDepartureAt =
    displayedDepartureTiming.recommendedDepartureAt;
  const {
    camera,
    clearRouteFocus,
    currentLocationPending,
    displayDestination,
    displayMarkers,
    displayOrigin,
    displayPathOverlays,
    guidanceWalkingPaths,
    savedDisplayTravelMinutes,
    displayTravelMode,
    handleMapMarkerPress,
    handleMapCameraChanged,
    canShowPassStopOnMap,
    handleRoutePassStopPress,
    handleMapZoomChanged,
    handleRouteStepPress,
    mapCoords,
    mapRef,
    mapZoom,
    moveToCurrentLocation,
    showWholeRoute,
    routeDetailInfo: savedRouteDetailInfo,
    routeOption,
    routeProgressSegments,
    focusedLegIndex,
    hasFocusedMapLocation,
    selectedRoutePassStop,
    selectedRoutePassStopName,
    selectedRouteStepId,
  } = useScheduleDetailMapController({
    scheduleId: id,
    item,
    currentMemberId,
    inspectedTravelPlan,
    savedRecommendedDepartureAt,
    isDark,
    topInset: insets.top,
    routeMapHeaderHeight: largeRouteHeader ? 0 : routeMapHeaderHeight,
    sheetMinHeight,
    openRouteDetail: fromGuidanceActivity ? undefined : openRouteDetail,
    liveActivityEntry,
    reduceMotion,
    navigationMode,
    snapSheet,
  });
  const currentTravelMinutes = displayedDepartureTiming.travelMinutes;
  const routeDetailInfo = useMemo(() => inspectedTravelPlan
    ? savedRouteDetailInfo
    : applyMatchedTransitTimeline(savedRouteDetailInfo, departureStatus),
    [departureStatus, inspectedTravelPlan, savedRouteDetailInfo]);
  const effectiveTransitRoutePresentation = inspectedTravelPlan
    ? undefined
    : buildPlannedJourneyArrivalPresentation(departureStatus, nowMs) ??
      buildEffectiveTransitRoutePresentation(departureStatus) ??
      buildFutureTimetablePredictionPresentation(departureStatus);
  const departureDisplayState: DepartureDisplayState = item
    ? getDepartureDisplayState(
        recommendedDepartureAt,
        item,
        nowMs,
        currentMemberDepartedAt,
      )
    : { kind: 'status', text: '', tone: 'default' };

  useEffect(() => {
    if (internalPreviewItem) return undefined;
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, DEPARTURE_COUNTDOWN_REFRESH_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [internalPreviewItem]);

  useEffect(() => {
    setParticipantsExpanded(previewParticipantsExpanded);
    participantDisclosureProgress.setValue(previewParticipantsExpanded ? 1 : 0);
    setMemoSheetVisible(false);
    setExpandedContentHeight(0);
    setInspectedTravelPlan(undefined);
    setTravelPlanDetailPendingMemberId(undefined);
    setFailedTravelPlanMemberId(undefined);
    setDepartureNudgePendingMemberId(undefined);
    setPreviewDepartedAt(undefined);
  }, [
    id,
    participantDisclosureProgress,
    previewParticipantsExpanded,
    setExpandedContentHeight,
    setParticipantsExpanded,
  ]);

  useEffect(() => () => {
    travelPlanRequests.invalidate();
    travelPlanRequestPending.current = false;
  }, [id, travelPlanRequests]);

  useEffect(() => {
    if (internalPreviewItem) return undefined;
    let cancelled = false;

    getAuthMember()
      .then(member => {
        if (!cancelled) setCurrentMemberId(member?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrentMemberId(null);
      })
      .finally(() => {
        if (!cancelled) setMemberResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [internalPreviewItem]);

  useEffect(() => {
    if (internalPreviewItem) {
      setLoading(false);
      setLoadError(null);
      return undefined;
    }
    if (!id || routePlannerSessionId || routeSavePending) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const task = runAfterScreenTransition(() => {
      if (cancelled) return;
      measurePerformanceInteraction(
        'schedule.detail_load',
        '/schedule/[id]',
        () => getSchedule(id),
        'NETWORK',
      )
        .then(detail => {
          if (!cancelled) {
            dispatch({ type: 'UPDATE_ITEM', item: detail });
            setLoadedDetailId(id);
          }
        })
        .catch(error => {
          if (!cancelled && !isRoutePlannerFlowPath(pathname))
            setLoadError(getErrorMessage(error));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [
    dispatch,
    id,
    internalPreviewItem,
    pathname,
    retryKey,
    routePlannerSessionId,
    routeSavePending,
  ]);

  const journeyGuidanceAvailable = !internalPreviewItem && !inspectedTravelPlan && canOpenJourneyGuidance(item);

  const completeDeparture = useCallback(async () => {
    if (inspectedTravelPlan) return;
    if (journeyGuidanceAvailable && id) {
      // Enter guidance on the current map. Preparation and GPS, not this tap,
      // determine whether the journey has actually started.
      setNavigationScheduleId(id);
      snapSheet('compact');
      return;
    }
    if (!id || currentMemberDepartedAt || departureRequests.has(id)) return;
    if (internalPreviewItem) {
      setDepartureSubmission({ scheduleId: id, status: 'recorded' });
      setPreviewDepartedAt(new Date(nowMs).toISOString());
      return;
    }

    departureRequests.add(id);
    setDepartureSubmission({ scheduleId: id, status: 'pending' });
    try {
      const updated = await completeScheduleDeparture(id);
      const completedAt = new Date().toISOString();
      dispatch({
        type: 'UPDATE_ITEM',
        item: {
          ...updated,
          myDepartedAt: updated.myDepartedAt ?? completedAt,
          departedAt: canManageSchedule
            ? updated.departedAt ?? completedAt
            : updated.departedAt,
          departureParticipants:
            updated.departureParticipants ?? item?.departureParticipants,
        },
      });
      setDepartureSubmission(current => current?.scheduleId === id
        ? { scheduleId: id, status: 'recorded' } : current);
    } catch {
      setDepartureSubmission(current => current?.scheduleId === id
        ? { scheduleId: id, status: 'failed' } : current);
    } finally {
      departureRequests.delete(id);
    }
  }, [
    canManageSchedule,
    currentMemberDepartedAt,
    departureRequests,
    dispatch,
    id,
    internalPreviewItem,
    inspectedTravelPlan,
    item?.departureParticipants,
    journeyGuidanceAvailable,
    nowMs,
    snapSheet,
  ]);

  const requestDepartureNudge = useCallback(
    async (targetMemberId: number, targetLabel: string) => {
      if (
        internalPreviewItem ||
        !id ||
        departureNudgePendingMemberId !== undefined
      )
        return;

      setDepartureNudgePendingMemberId(targetMemberId);
      try {
        const result = await sendScheduleDepartureNudge(id, targetMemberId);
        const outcome = classifyDepartureNudgeResult(result);
        if (outcome === 'accepted') {
          Alert.alert(
            '알림을 접수했어요',
            result.requestedCount > 0
              ? `${targetLabel}님에게 보낼 출발 확인 알림을 등록했습니다.`
              : `${targetLabel}님의 앱 알림함에 출발 확인 요청을 등록했습니다.`,
          );
          return;
        }
        if (outcome === 'no_registered_device') {
          Alert.alert(
            '알림을 보낼 수 없어요',
            `${targetLabel}님의 기기에 등록된 푸시 알림 정보가 없습니다.`,
          );
          return;
        }
        Alert.alert('알림 전송 실패', '잠시 후 다시 시도해 주세요.');
      } catch (error) {
        Alert.alert('알림 전송 실패', getErrorMessage(error));
      } finally {
        setDepartureNudgePendingMemberId(undefined);
      }
    },
    [departureNudgePendingMemberId, id, internalPreviewItem],
  );

  const confirmDepartureNudge = useCallback(
    (targetMemberId: number, targetLabel: string) => {
      if (departureNudgePendingMemberId !== undefined) return;

      Alert.alert(
        '출발 확인 알림',
        `${targetLabel}님에게 출발 여부를 알려 달라는 푸시를 보낼까요?`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '보내기',
            onPress: () => {
              requestDepartureNudge(targetMemberId, targetLabel).catch(
                () => undefined,
              );
            },
          },
        ],
      );
    },
    [departureNudgePendingMemberId, requestDepartureNudge],
  );

  const returnToOwnTravelPlan = useCallback(() => {
    travelPlanRequests.invalidate();
    travelPlanRequestPending.current = false;
    setTravelPlanDetailPendingMemberId(undefined);
    setFailedTravelPlanMemberId(undefined);
    setInspectedTravelPlan(undefined);
    clearRouteFocus();
  }, [clearRouteFocus, travelPlanRequests]);

  const openParticipantTravelPlan = useCallback(
    async (participant: ScheduleTravelPlanParticipant) => {
      if (
        internalPreviewItem ||
        !id ||
        travelPlanRequestPending.current
      )
        return;
      if (participant.memberId === currentMemberId) {
        if (inspectedTravelPlan) returnToOwnTravelPlan();
        return;
      }
      if (!canOpenParticipantTravelPlan(participant, currentMemberId)) return;
      if (inspectedTravelPlan?.memberId === participant.memberId) {
        snapSheet('compact');
        return;
      }

      const requestId = travelPlanRequests.begin();
      travelPlanRequestPending.current = true;
      setFailedTravelPlanMemberId(undefined);
      setTravelPlanDetailPendingMemberId(participant.memberId);
      try {
        const plan = await getScheduleTravelPlan(id, participant.memberId);
        if (!travelPlanRequests.isCurrent(requestId)) return;
        setInspectedTravelPlan(plan);
        clearRouteFocus();
        snapSheet('compact');
      } catch {
        if (travelPlanRequests.isCurrent(requestId)) setFailedTravelPlanMemberId(participant.memberId);
      } finally {
        if (travelPlanRequests.isCurrent(requestId)) {
          travelPlanRequestPending.current = false;
          setTravelPlanDetailPendingMemberId(undefined);
        }
      }
    },
    [
      currentMemberId,
      clearRouteFocus,
      id,
      internalPreviewItem,
      inspectedTravelPlan,
      returnToOwnTravelPlan,
      snapSheet,
      travelPlanRequests,
    ],
  );

  const openCurrentRoutePlanner = useCallback(async (restoreFocus?: () => void) => {
    if (
      internalPreviewItem ||
      !item ||
      routeSavePending ||
      routeDetailAdPendingRef.current
    )
      return;
    const targetSessionId = `schedule-detail-${item.id}-${Date.now()}`;
    const travelMode = item.travelMode ?? routeOption?.mode ?? 'CAR';
    const hasDetailedRoute = hasPersistableScheduleRoute(
      item.route,
      item.travelMinutes,
      item.origin,
      item.destination,
    );
    // A pending ticket needs its final destination/deadline saved with the common schedule.
    // The personal-plan endpoint only enriches the same existing destination.
    if (getImportedTicket(item.route) && !hasDetailedRoute && canEditSchedule) {
      openScheduleEditor();
      return;
    }
    const entryPath = getSavedRouteEntryPath(
      hasDetailedRoute,
      item.origin,
      item.destination,
    );
    setRoutePlannerInitial(
      targetSessionId,
      {
        ...buildScheduleRoutePlannerInitial({
          origin: item.origin,
          destination: item.destination,
          travelMode,
          travelMinutes: item.travelMinutes,
          locationName: item.locationName,
          targetArrivalAt: item.startAt,
          departureAt: item.departAt,
          route: item.route,
        }),
        appliesToExistingSchedule: true,
      },
    );
    routePlannerWasActiveRef.current = false;
    routePlannerFocusTask.current?.cancel();
    routePlannerReturnFocusRef.current = restoreFocus;
    setRoutePlannerSessionId(targetSessionId);
    routeDetailAdPendingRef.current = true;
    try {
      await showRouteDetailInterstitialIfEligible({
        suppress: fromGuidanceActivity || isRouteDetailEntryRequested(openRouteDetail),
      });
      if (entryPath === '/schedule/route-select') {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        runWithTransitionShell(
          {
            route: '/schedule/route-select',
            title: '경로 선택',
            sceneKey: targetSessionId,
          },
          () => router.push({
            pathname: entryPath,
            params: {
              sessionId: targetSessionId,
              routeId: hasDetailedRoute ? routeOption?.id : undefined,
              routeIndex: '0',
              sheetState: 'middle',
              entrySource: 'schedule-detail',
              departureAt: item.departAt,
            },
          }),
        );
      } else {
        router.push({
          pathname: entryPath,
          params: {
            sessionId: targetSessionId,
            routeId: hasDetailedRoute ? routeOption?.id : undefined,
            routeIndex: '0',
            sheetState: 'middle',
            entrySource: 'schedule-detail',
            departureAt: item.departAt,
          },
        });
      }
    } finally {
      routeDetailAdPendingRef.current = false;
    }
  }, [
    canEditSchedule,
    openScheduleEditor,
    internalPreviewItem,
    item,
    fromGuidanceActivity,
    openRouteDetail,
    routeOption,
    routeSavePending,
    router,
    runWithTransitionShell,
  ]);

  useEffect(() => {
    if (internalPreviewItem) return;
    primeRouteDetailAdvertising().catch(() => undefined);
  }, [internalPreviewItem]);

  useEffect(() => {
    if (
      !item ||
      item.routeSetupRequired !== true ||
      !isRouteSetupEntryRequested(openRouteSetup) ||
      routePlannerSessionId ||
      routeSavePending ||
      autoOpenedRouteSetupItemIdRef.current === item.id
    )
      return;

    // 경로 설정 요청으로 들어온 최초 1회만 선택 화면을 바로 연다.
    // 사용자가 닫고 돌아오면 저장된 경로 유무에 맞는 상세 화면을 보여준다.
    autoOpenedRouteSetupItemIdRef.current = item.id;
    openCurrentRoutePlanner();
  }, [
    item,
    openCurrentRoutePlanner,
    openRouteSetup,
    routePlannerSessionId,
    routeSavePending,
  ]);

  useEffect(() => {
    if (!confirmedRouteScheduleId) return;
    const timeout = setTimeout(() => setConfirmedRouteScheduleId(undefined), 3500);
    return () => clearTimeout(timeout);
  }, [confirmedRouteScheduleId]);

  const saveSelectedRoute = useCallback(async (payload: ScheduleRouteUpdatePayload, isRetry = false) => {
    if (!item || routeSaveInFlight.current) return;
    routeSaveInFlight.current = true;
    if (!isRetry) setFailedRouteSave(undefined);
    setConfirmedRouteScheduleId(undefined);
    setRouteSavePending(true);
    try {
      const updated = await saveScheduleRouteAsMyTravelPlan(item, payload, {
        upsertMyTravelPlan: upsertMyScheduleTravelPlan,
        reloadSchedule: getSchedule,
        canResolveCommonDestination: canEditSchedule,
      });
      setInspectedTravelPlan(undefined);
      dispatch({ type: 'UPDATE_ITEM', item: updated });
      setFailedRouteSave(undefined);
      setConfirmedRouteScheduleId(item.id);
    } catch {
      setFailedRouteSave({ scheduleId: item.id, payload });
    } finally {
      routeSaveInFlight.current = false;
      setRouteSavePending(false);
    }
  }, [canEditSchedule, dispatch, item]);

  const canRetryRouteSave = failedRouteSave !== undefined && failedRouteSave.scheduleId === id;
  useEffect(() => {
    if (Platform.OS !== 'ios' || routeSavePending) return;
    if (routeSaveConfirmed) AccessibilityInfo.announceForAccessibility('경로를 적용했어요');
    else if (canRetryRouteSave) AccessibilityInfo.announceForAccessibility('경로를 적용하지 못했어요');
  }, [canRetryRouteSave, routeSaveConfirmed, routeSavePending]);

  const retryRouteSave = () => {
    if (canRetryRouteSave) void saveSelectedRoute(failedRouteSave.payload, true);
  };

  useEffect(() => {
    if (!item || !routePlannerSessionId) return;
    const observation = observeRoutePlannerReturn(
      pathname,
      routePlannerWasActiveRef.current,
    );
    routePlannerWasActiveRef.current = observation.hasVisitedRouteFlow;
    if (!observation.shouldConsumeResult) return;

    const payload = consumeScheduleRouteUpdatePayload(
      routePlannerSessionId,
      item,
    );
    const restoreFocus = routePlannerReturnFocusRef.current;
    routePlannerReturnFocusRef.current = undefined;
    setRoutePlannerSessionId(undefined);
    if (payload) void saveSelectedRoute(payload);
    else if (restoreFocus) {
      routePlannerFocusTask.current = runAfterScreenTransition(() => {
        routePlannerFocusTask.current = null;
        restoreFocus();
      });
    }
  }, [item, pathname, routePlannerSessionId, saveSelectedRoute]);

  return {
    id,
    goBack,
    insets,
    colors,
    mode,
    isDark,
    mapRef,
    sheetScrollRef,
    internalPreviewItem,
    offlineGuidancePreview: __DEV__ && !!internalPreviewItem && internalPreviewItem.id === '9001'
      && currentMemberId === 7 && previewOfflineGuidanceMap,
    guidancePreviewAuthenticationSource: __DEV__ && !!internalPreviewItem && internalPreviewItem.id === '9001'
      && currentMemberId === 7 && previewOfflineGuidanceMap ? previewGuidanceAuthenticationSource : undefined,
    loading,
    authoritativeDetailLoaded,
    guidanceEndedHandoff: guidanceActivityHandoff === 'ended',
    guidanceResumeHandoff,
    liveActivityEntry,
    guidanceHandoffPending: fromGuidanceActivity && id != null && !loadError
      && (!authoritativeDetailLoaded || !memberResolved || guidanceActivityHandoff === 'pending'),
    loadError,
    setRetryKey,
    setRouteHeaderHeight,
    largeRouteHeader,
    sheetMaxHeight,
    sheetMinHeight,
    sheetBottomPadding,
    sheetTranslateY,
    sheetMode,
    mapZoom,
    shareSheetVisible,
    setShareSheetVisible,
    memoSheetVisible,
    setMemoSheetVisible,
    currentMemberId,
    departureActionPending,
    departureSubmissionStatus,
    departureNudgePendingMemberId,
    participantsExpanded,
    nowMs,
    currentLocationPending,
    routeSavePending,
    routeSaveConfirmed,
    canRetryRouteSave,
    retryRouteSave,
    inspectedTravelPlan,
    returnToOwnTravelPlan,
    travelPlanDetailPendingMemberId,
    failedTravelPlanMemberId,
    item,
    canManageSchedule,
    canEditSchedule,
    openScheduleEditor,
    currentMemberDepartedAt,
    departureParticipants,
    recommendedDepartureAt,
    preservingEarlierDeparture: displayedDepartureTiming.preservingEarlierDeparture,
    departureDisplayState,
    compactSummaryScrollable,
    handleCompactContentSizeChange,
    sheetQuickSummaryAnimatedStyle,
    sheetExpandedContentAnimatedStyle,
    sheetHandleAnimatedStyle,
    snapSheet,
    participantDisclosureAnimatedStyle,
    toggleParticipantsExpanded,
    handleExpandedContentLayout,
    handleSheetHeaderLayout,
    sheetPanResponder,
    displayOrigin,
    displayDestination,
    savedDisplayTravelMinutes,
    currentTravelMinutes,
    departureStatus,
    effectiveTransitRoutePresentation,
    displayTravelMode,
    routeOption,
    displayPathOverlays,
    guidanceWalkingPaths,
    displayMarkers,
    mapCoords,
    routeDetailInfo,
    routeProgressSegments,
    focusedLegIndex,
    hasFocusedMapLocation,
    selectedRouteStepId,
    selectedRoutePassStop,
    selectedRoutePassStopName,
    reduceMotion,
    handleMapMarkerPress,
    handleMapCameraChanged,
    canShowPassStopOnMap,
    handleRoutePassStopPress,
    handleRouteStepPress,
    handleMapZoomChanged,
    moveToCurrentLocation,
    showWholeRoute,
    completeDeparture,
    journeyGuidanceAvailable,
    navigationMode,
    navigationEnd,
    setNavigationEnd,
    confirmDepartureNudge,
    openParticipantTravelPlan,
    openCurrentRoutePlanner,
    camera,
  };
}

/** 일정 상세 렌더러가 소비하는 컨트롤러의 추론된 공개 계약이다. */
export type ScheduleDetailController = ReturnType<
  typeof useScheduleDetailController
>;

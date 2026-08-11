import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getSchedule,
  sendScheduleDepartureNudge,
} from '../../src/api/schedule';
import { fromISO } from '../../lib/util/data';
import {
  getScheduleTravelPlan,
  upsertMyScheduleTravelPlan,
} from '../../src/api/scheduleTravelPlans';
import { canEditPresentedSchedule } from '../../src/modules/schedule/schedulePermissions';
import { hasRenderableSavedRouteGeometry } from '../../src/modules/map/savedRouteMapPresentation';
import { getSavedRouteEntryPath } from '../../src/modules/schedule/savedRouteDetailPresentation';
import { useScheduleStore } from '../../src/modules/schedule/store';
import type {
  ScheduleTravelPlan,
  ScheduleTravelPlanParticipant,
} from '../../src/modules/schedule/types';
import {
  buildScheduleRoutePlannerInitial,
  consumeScheduleRouteUpdatePayload,
  setRoutePlannerInitial,
} from '../../src/modules/schedule/routePlannerSession';
import { isRouteSetupEntryRequested } from '../../src/modules/schedule/routeSetupNavigation';
import { isRouteDetailEntryRequested } from '../../src/modules/schedule/routeDetailNavigation';
import { goBackFromScheduleDetail } from '../../src/modules/schedule/scheduleDetailNavigation';
import { useTheme } from '../../src/modules/theme/ThemeContext';
import { getAuthMember } from '../../src/modules/auth/authStorage';
import { canOpenParticipantTravelPlan } from '../../src/modules/schedule/travelPlanPresentation';
import { completeScheduleDeparture } from '../../src/modules/schedule/scheduleDepartureCompletion';
import { saveScheduleRouteAsMyTravelPlan } from '../../src/modules/schedule/scheduleTravelPlanSave';
import { classifyDepartureNudgeResult } from '../../src/modules/schedule/departureNudgeResult';
import {
  buildEffectiveTransitRoutePresentation,
  resolveScheduleDetailDepartureTiming,
} from '../../src/modules/schedule/effectiveTransitRoutePresentation';
import {
  primeRouteDetailAdvertising,
  showRouteDetailInterstitialIfEligible,
} from '../../src/modules/advertising/routeDetailInterstitial';
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
import { useScheduleDepartureStatusController } from './useScheduleDepartureStatusController';

/**
 * 일정 상세 화면의 데이터 로딩, 지도 초점, 출발 상태, 하단 시트와 경로 편집 동작을 관리한다.
 * 렌더러는 이 훅이 반환한 안정된 화면 모델과 명령만 사용해 표시 책임에 집중한다.
 */
export function useScheduleDetailController({
  previewItem,
  initialSheetMode = 'compact',
  initialParticipantsExpanded = false,
  previewNowMs,
  previewCurrentMemberId,
  onPreviewOpenEditor,
}: ScheduleDetailPreviewProps = {}) {
  const { id, openRouteSetup, openRouteDetail } = useLocalSearchParams<{
    id: string;
    openRouteSetup?: string | string[];
    openRouteDetail?: string | string[];
  }>();
  const pathname = usePathname();
  const router = useRouter();
  const goBack = useCallback(() => goBackFromScheduleDetail(router), [router]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, mode } = useTheme();
  const isDark = mode === 'dark';
  const { state, dispatch } = useScheduleStore();
  const internalPreviewItem =
    typeof __DEV__ === 'boolean' && __DEV__ ? previewItem : undefined;
  const {
    handleExpandedContentLayout,
    participantDisclosureAnimatedStyle,
    participantDisclosureProgress,
    participantsExpanded,
    previewParticipantsExpanded,
    setExpandedContentHeight,
    setParticipantsExpanded,
    sheetBottomPadding,
    sheetMaxHeight,
    sheetMinHeight,
    sheetMode,
    sheetPanResponder,
    sheetQuickSummaryAnimatedStyle,
    sheetScrollRef,
    sheetTranslateY,
    snapSheet,
    toggleParticipantsExpanded,
  } = useScheduleDetailSheetController({
    windowHeight,
    bottomInset: insets.bottom,
    previewEnabled: Boolean(internalPreviewItem),
    initialSheetMode,
    initialParticipantsExpanded,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [memoSheetVisible, setMemoSheetVisible] = useState(false);
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(() =>
    internalPreviewItem && typeof previewCurrentMemberId === 'number'
      ? previewCurrentMemberId
      : null,
  );
  const [departureActionPending, setDepartureActionPending] = useState(false);
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
  const routeDetailAdPendingRef = useRef(false);
  const [inspectedTravelPlan, setInspectedTravelPlan] =
    useState<ScheduleTravelPlan>();
  const [travelPlanDetailPendingMemberId, setTravelPlanDetailPendingMemberId] =
    useState<number>();
  const routePlannerWasActiveRef = useRef(false);
  const autoOpenedRouteSetupItemIdRef = useRef<string | undefined>(undefined);

  const { departureStatus, acceptedDepartureStatus } =
    useScheduleDepartureStatusController({
      scheduleId: id,
      previewEnabled: Boolean(internalPreviewItem),
      routePlannerSessionId,
      routeSavePending,
    });

  const item = internalPreviewItem ?? (id ? state.itemsById[id] : undefined);
  const canManageSchedule = useMemo(() => {
    if (!item) return false;
    if (typeof item.ownerMemberId !== 'number') return true;
    return currentMemberId === item.ownerMemberId;
  }, [currentMemberId, item]);
  const canEditSchedule = canEditPresentedSchedule(item, canManageSchedule);
  const openScheduleEditor = useCallback(() => {
    setMemoSheetVisible(false);
    requestAnimationFrame(() => {
      if (internalPreviewItem) {
        onPreviewOpenEditor?.();
        return;
      }
      router.setParams({ mode: 'edit' });
    });
  }, [internalPreviewItem, onPreviewOpenEditor, router]);
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
        status: acceptedDepartureStatus,
        savedRecommendedDepartureAt,
        savedTravelMinutes: item?.travelMinutes,
        isInspectingTravelPlan: Boolean(inspectedTravelPlan),
        inspectedRecommendedDepartureAt,
        inspectedTravelMinutes: inspectedTravelPlan?.travelMinutes,
      }),
    [
      acceptedDepartureStatus,
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
    savedDisplayTravelMinutes,
    displayTravelMode,
    handleMapMarkerPress,
    handleMapZoomChanged,
    handleRouteStepPress,
    mapCoords,
    mapRef,
    mapZoom,
    moveToCurrentLocation,
    routeDetailInfo,
    routeOption,
    routeProgressSegments,
    selectedRoutePassStop,
    selectedRouteStepId,
  } = useScheduleDetailMapController({
    scheduleId: id,
    item,
    inspectedTravelPlan,
    savedRecommendedDepartureAt,
    isDark,
    topInset: insets.top,
    sheetMinHeight,
    openRouteDetail,
    snapSheet,
  });
  const currentTravelMinutes = displayedDepartureTiming.travelMinutes;
  const effectiveTransitRoutePresentation = inspectedTravelPlan
    ? undefined
    : buildEffectiveTransitRoutePresentation(departureStatus);
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
    setDepartureNudgePendingMemberId(undefined);
    setPreviewDepartedAt(undefined);
  }, [
    id,
    participantDisclosureProgress,
    previewParticipantsExpanded,
    setExpandedContentHeight,
    setParticipantsExpanded,
  ]);

  useEffect(() => {
    if (internalPreviewItem) return undefined;
    let cancelled = false;

    getAuthMember()
      .then(member => {
        if (!cancelled) setCurrentMemberId(member?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrentMemberId(null);
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
    getSchedule(id)
      .then(detail => {
        if (!cancelled) dispatch({ type: 'UPDATE_ITEM', item: detail });
      })
      .catch(error => {
        const routeFlowActive =
          pathname === '/schedule/route-select' ||
          pathname === '/schedule/route-planner';
        if (!cancelled && !routeFlowActive)
          setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
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

  const completeDeparture = useCallback(async () => {
    if (departureActionPending) return;
    if (internalPreviewItem) {
      setPreviewDepartedAt(new Date(nowMs).toISOString());
      return;
    }
    if (!id) return;

    setDepartureActionPending(true);
    try {
      const completedAt = new Date().toISOString();
      const updated = await completeScheduleDeparture(id);
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
    } catch (error) {
      Alert.alert('출발 완료 실패', getErrorMessage(error));
    } finally {
      setDepartureActionPending(false);
    }
  }, [
    canManageSchedule,
    departureActionPending,
    dispatch,
    id,
    internalPreviewItem,
    item?.departureParticipants,
    nowMs,
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

  const openParticipantTravelPlan = useCallback(
    async (participant: ScheduleTravelPlanParticipant) => {
      if (
        internalPreviewItem ||
        !id ||
        travelPlanDetailPendingMemberId !== undefined
      )
        return;
      if (participant.memberId === currentMemberId) {
        setInspectedTravelPlan(undefined);
        return;
      }
      if (!canOpenParticipantTravelPlan(participant, currentMemberId)) return;

      setTravelPlanDetailPendingMemberId(participant.memberId);
      try {
        const plan = await getScheduleTravelPlan(id, participant.memberId);
        setInspectedTravelPlan(plan);
        clearRouteFocus();
        snapSheet('compact');
      } catch (error) {
        Alert.alert('이동 계획을 불러오지 못했어요', getErrorMessage(error));
      } finally {
        setTravelPlanDetailPendingMemberId(undefined);
      }
    },
    [
      currentMemberId,
      clearRouteFocus,
      id,
      internalPreviewItem,
      snapSheet,
      travelPlanDetailPendingMemberId,
    ],
  );

  const openCurrentRoutePlanner = useCallback(async () => {
    if (
      internalPreviewItem ||
      !item ||
      routeSavePending ||
      routeDetailAdPendingRef.current
    )
      return;
    const targetSessionId = `schedule-detail-${item.id}-${Date.now()}`;
    const travelMode = item.travelMode ?? routeOption?.mode ?? 'CAR';
    const hasDetailedRoute = hasRenderableSavedRouteGeometry(
      item.route,
      item.origin,
      item.destination,
    );
    const entryPath = getSavedRouteEntryPath(
      hasDetailedRoute,
      item.origin,
      item.destination,
    );
    setRoutePlannerInitial(
      targetSessionId,
      buildScheduleRoutePlannerInitial({
        origin: item.origin,
        destination: item.destination,
        travelMode,
        travelMinutes: item.travelMinutes,
        locationName: item.locationName,
        targetArrivalAt: item.startAt,
        departureAt: item.departAt,
        route: item.route,
      }),
    );
    routePlannerWasActiveRef.current = false;
    setRoutePlannerSessionId(targetSessionId);
    routeDetailAdPendingRef.current = true;
    try {
      await showRouteDetailInterstitialIfEligible({
        suppress: isRouteDetailEntryRequested(openRouteDetail),
      });
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
    } finally {
      routeDetailAdPendingRef.current = false;
    }
  }, [
    internalPreviewItem,
    item,
    openRouteDetail,
    routeOption,
    routeSavePending,
    router,
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
    const routeFlowActive =
      pathname === '/schedule/route-select' ||
      pathname === '/schedule/route-planner';
    if (routeFlowActive) {
      if (routePlannerSessionId) routePlannerWasActiveRef.current = true;
      return;
    }
    if (!item || !routePlannerSessionId || !routePlannerWasActiveRef.current)
      return;

    routePlannerWasActiveRef.current = false;
    const payload = consumeScheduleRouteUpdatePayload(
      routePlannerSessionId,
      item,
    );
    setRoutePlannerSessionId(undefined);
    if (!payload) return;

    setRouteSavePending(true);
    const saveRoute = saveScheduleRouteAsMyTravelPlan(item, payload, {
      upsertMyTravelPlan: upsertMyScheduleTravelPlan,
      reloadSchedule: getSchedule,
    });

    saveRoute
      .then(updated => {
        setInspectedTravelPlan(undefined);
        dispatch({ type: 'UPDATE_ITEM', item: updated });
      })
      .catch(error => {
        Alert.alert('경로 저장 실패', getErrorMessage(error));
      })
      .finally(() => {
        setRouteSavePending(false);
      });
  }, [dispatch, item, pathname, routePlannerSessionId]);

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
    loading,
    loadError,
    setRetryKey,
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
    departureNudgePendingMemberId,
    participantsExpanded,
    nowMs,
    currentLocationPending,
    routeSavePending,
    inspectedTravelPlan,
    setInspectedTravelPlan,
    travelPlanDetailPendingMemberId,
    item,
    canManageSchedule,
    canEditSchedule,
    openScheduleEditor,
    currentMemberDepartedAt,
    departureParticipants,
    recommendedDepartureAt,
    departureDisplayState,
    sheetQuickSummaryAnimatedStyle,
    snapSheet,
    participantDisclosureAnimatedStyle,
    toggleParticipantsExpanded,
    handleExpandedContentLayout,
    sheetPanResponder,
    displayOrigin,
    displayDestination,
    savedDisplayTravelMinutes,
    currentTravelMinutes,
    effectiveTransitRoutePresentation,
    displayTravelMode,
    routeOption,
    displayPathOverlays,
    displayMarkers,
    mapCoords,
    routeDetailInfo,
    routeProgressSegments,
    selectedRouteStepId,
    selectedRoutePassStop,
    handleMapMarkerPress,
    handleRouteStepPress,
    handleMapZoomChanged,
    moveToCurrentLocation,
    completeDeparture,
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

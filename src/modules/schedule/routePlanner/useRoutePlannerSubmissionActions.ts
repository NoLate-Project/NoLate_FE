import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Alert, BackHandler, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { getStoredRouteOverlayGeometryProvenance } from '../../map/savedRouteMapPresentation';
import type {
  RouteAlternativeOption,
  RoutePathCoord,
} from '../../map/routingService';
import type { TmapPathOverlay } from '../../map/TmapMapView';
import type { BottomSheetSnap } from './bottomSheetLayout';
import type { RoutePointTarget } from './params';
import type { NormalizedRoute } from './routeMapTypesAndStyle';
import type { RouteInfo } from '../routeInfo';
import type { Place, TravelMode } from '../types';
import {
  clearRouteCandidateListSnapshot,
  getRouteCandidateListSnapshot,
  setRouteCandidateListSnapshot,
  setRoutePlannerInitial,
  setRoutePlannerResult,
  type RoutePlannerPayload,
} from '../routePlannerSession';
import { getImportedTicket } from '../importedTicket';
import type { RoutePlannerBackAction } from '../routePlannerNavigation';

type SetValue<T> = Dispatch<SetStateAction<T>>;

export type RoutePlannerPlaceEditor = {
  sessionId: string;
  target: RoutePointTarget;
  initial: RoutePlannerPayload;
};

type Options = {
  bottomSheetSnap: BottomSheetSnap;
  buildCanSubmitRoute: boolean;
  closeLocationPrompt: () => void;
  destinationAddress: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationName: string;
  draftTransitDepartureAt: Date;
  etaLoading: boolean;
  etaMinutes?: number;
  finalSelectedRouteDepartureTime?: string;
  hasDestinationCoords: boolean;
  hasOriginCoords: boolean;
  hasRouteReady: boolean;
  initialTargetArrivalAt?: string;
  initialRequestedDepartureAt?: string;
  returnToScheduleDraft?: boolean;
  appliesToExistingSchedule?: boolean;
  isBottomSheetHidden: boolean;
  isRouteDetailMode: boolean;
  locationPromptTarget: RoutePointTarget | null;
  mapPathOverlays: TmapPathOverlay[];
  originAddress: string;
  originLat?: number;
  originLng?: number;
  originName: string;
  requestedTransitDepartureAt: Date;
  routePathCoords?: RoutePathCoord[];
  routePlannerBackAction: RoutePlannerBackAction;
  routeAlternatives: RouteAlternativeOption[];
  departureTimeEdited: boolean;
  routeSubmitPendingRef: MutableRefObject<boolean>;
  routeSubmitResetTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  router: ReturnType<typeof useRouter>;
  selectedAlternative?: RouteAlternativeOption;
  selectedNormalizedRoute?: NormalizedRoute;
  selectedRouteInfo?: RouteInfo;
  sessionId: string;
  setBottomSheetTo: (snap: BottomSheetSnap) => void;
  setDraftTransitDepartureAt: SetValue<Date>;
  setIsTransitDeparturePickerOpen: SetValue<boolean>;
  setRequestedTransitDepartureAt: SetValue<Date>;
  setRouteRefreshTick: SetValue<number>;
  setRouteSubmitPending: SetValue<boolean>;
  travelMode: TravelMode;
};

/**
 * 선택 경로의 저장 형식을 만들고 뒤로가기·출발 시각 변경·최종 제출 동작을 관리한다.
 * 저장 중복 방지와 세션 복원 데이터를 함께 처리해 화면 이동 중 경로 초안이 유실되지 않게 한다.
 */
export function useRoutePlannerSubmissionActions({
  returnToScheduleDraft,
  appliesToExistingSchedule,
  bottomSheetSnap,
  buildCanSubmitRoute: canSubmitRoute,
  closeLocationPrompt,
  destinationAddress,
  destinationLat,
  destinationLng,
  destinationName,
  draftTransitDepartureAt,
  etaLoading,
  etaMinutes,
  finalSelectedRouteDepartureTime,
  hasDestinationCoords,
  hasOriginCoords,
  hasRouteReady,
  initialTargetArrivalAt,
  initialRequestedDepartureAt,
  isBottomSheetHidden,
  isRouteDetailMode,
  locationPromptTarget,
  mapPathOverlays,
  originAddress,
  originLat,
  originLng,
  originName,
  requestedTransitDepartureAt,
  routePathCoords,
  routePlannerBackAction,
  routeAlternatives,
  departureTimeEdited,
  routeSubmitPendingRef,
  routeSubmitResetTimerRef,
  router,
  selectedAlternative,
  selectedNormalizedRoute,
  selectedRouteInfo,
  sessionId,
  setBottomSheetTo: snapBottomSheetTo,
  setDraftTransitDepartureAt,
  setIsTransitDeparturePickerOpen,
  setRequestedTransitDepartureAt,
  setRouteRefreshTick,
  setRouteSubmitPending,
  travelMode,
}: Options) {
  const [placeEditor, setPlaceEditor] = useState<RoutePlannerPlaceEditor>();
  const initial = { targetArrivalAt: initialTargetArrivalAt };
  const requestedDeparture = departureTimeEdited ? requestedTransitDepartureAt.toISOString() : initialRequestedDepartureAt;
  const travelMinutes = selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative?.minutes ?? etaMinutes;
  const buildPersistableSelectedRoute = useCallback(() => {
    if (!selectedAlternative) return undefined;

    const storedPathOverlays = mapPathOverlays.flatMap(overlay => {
      if (!Array.isArray(overlay.coords) || overlay.coords.length < 2)
        return [];
      const geometryProvenance = getStoredRouteOverlayGeometryProvenance(
        overlay.id,
        selectedNormalizedRoute?.segments,
      );
      return [
        {
          id: overlay.id,
          coords: overlay.coords.map(coord => ({
            lat: coord.latitude,
            lng: coord.longitude,
          })),
          color: overlay.color,
          width: overlay.width,
          outlineColor: overlay.outlineColor,
          outlineWidth: overlay.outlineWidth,
          dashPattern: overlay.dashPattern,
          strokeStyle: overlay.strokeStyle,
          outlineStrokeStyle: overlay.outlineStrokeStyle,
          renderMode: overlay.renderMode,
          shape: overlay.shape,
          showDirection: overlay.showDirection,
          nativeDirection: overlay.nativeDirection,
          nativeDirectionColor: overlay.nativeDirectionColor,
          nativeDirectionOpacity: overlay.nativeDirectionOpacity,
          directionColor: overlay.directionColor,
          directionOpacity: overlay.directionOpacity,
          directionSpacingPx: overlay.directionSpacingPx,
          directionSizePx: overlay.directionSizePx,
          directionInsetPx: overlay.directionInsetPx,
          directionMaxCount: overlay.directionMaxCount,
          dotColor: overlay.dotColor,
          dotOutlineColor: overlay.dotOutlineColor,
          dotOutlineWidth: overlay.dotOutlineWidth,
          dotSizePx: overlay.dotSizePx,
          dotSpacingPx: overlay.dotSpacingPx,
          supportLineColor: overlay.supportLineColor,
          supportLineWidth: overlay.supportLineWidth,
          drawLine: overlay.drawLine,
          cornerRadiusPx: overlay.cornerRadiusPx,
          smoothPath: overlay.smoothPath,
          lineLabel: overlay.lineLabel,
          lineLabelTextColor: overlay.lineLabelTextColor,
          lineLabelBackgroundColor: overlay.lineLabelBackgroundColor,
          lineLabelOffsetPx: overlay.lineLabelOffsetPx,
          zIndex: overlay.zIndex,
          ...(geometryProvenance ?? {}),
        },
      ];
    });
    const overlayPathCoords = storedPathOverlays.find(
      overlay => overlay.coords.length >= 2,
    )?.coords;
    const selectedPathCoords =
      Array.isArray(selectedAlternative.pathCoords) &&
      selectedAlternative.pathCoords.length >= 2
        ? selectedAlternative.pathCoords
        : Array.isArray(routePathCoords) && routePathCoords.length >= 2
        ? routePathCoords
        : overlayPathCoords;

    return {
      ...selectedAlternative,
      schemaVersion: selectedAlternative.intercityJourney ? 3 : 2,
      routeInfo: selectedRouteInfo,
      pathCoords: selectedPathCoords,
      storedPathOverlays,
    };
  }, [
    mapPathOverlays,
    routePathCoords,
    selectedAlternative,
    selectedNormalizedRoute,
    selectedRouteInfo,
  ]);

  const buildCurrentRoutePlannerInitial = useCallback(
    (): RoutePlannerPayload => {
      const normalizedOriginName = originName.trim();
      const normalizedDestinationName = destinationName.trim();
      const normalizedOriginAddress = originAddress.trim();
      const normalizedDestinationAddress = destinationAddress.trim();
      const nextOrigin =
        normalizedOriginName || normalizedOriginAddress || hasOriginCoords
          ? {
              name: normalizedOriginName || normalizedOriginAddress || '출발지',
              address: normalizedOriginAddress || undefined,
              lat: originLat,
              lng: originLng,
            }
          : undefined;
      const nextDestination =
        normalizedDestinationName ||
        normalizedDestinationAddress ||
        hasDestinationCoords
          ? {
              name:
                normalizedDestinationName ||
                normalizedDestinationAddress ||
                '도착지',
              address: normalizedDestinationAddress || undefined,
              lat: destinationLat,
              lng: destinationLng,
            }
          : undefined;

      return {
        returnToScheduleDraft,
        appliesToExistingSchedule,
        origin: nextOrigin,
        destination: nextDestination,
        travelMode,
        travelMinutes,
        locationName:
          nextOrigin?.name && nextDestination?.name
            ? `${nextOrigin.name} → ${nextDestination.name}`
            : nextDestination?.name || nextOrigin?.name,
        targetArrivalAt: initial?.targetArrivalAt,
        departureAt: finalSelectedRouteDepartureTime,
        requestedDepartureAt: travelMode === 'TRANSIT' ? requestedDeparture : undefined,
        route: buildPersistableSelectedRoute(),
      };
    },
    [
      buildPersistableSelectedRoute,
      destinationAddress,
      destinationLat,
      destinationLng,
      destinationName,
      travelMinutes,
      finalSelectedRouteDepartureTime,
      requestedDeparture,
      hasDestinationCoords,
      hasOriginCoords,
      returnToScheduleDraft,
      appliesToExistingSchedule,
      initial?.targetArrivalAt,
      originAddress,
      originLat,
      originLng,
      originName,
      travelMode,
    ],
  );

  const openRoutePointEditorFromHeader = useCallback(
    (target: RoutePointTarget = 'origin') => {
      const targetSessionId =
        sessionId ||
        `route-reset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setPlaceEditor({ sessionId: targetSessionId, target, initial: buildCurrentRoutePlannerInitial() });
    },
    [buildCurrentRoutePlannerInitial, sessionId],
  );

  const closePlaceEditor = useCallback(() => setPlaceEditor(undefined), []);

  const confirmRoutePoints = useCallback((origin: Place, destination: Place) => {
    if (!placeEditor) return;
    const { initial: previous, sessionId: targetSessionId } = placeEditor;
    const pointsChanged = previous.origin?.lat !== origin.lat || previous.origin?.lng !== origin.lng ||
      previous.destination?.lat !== destination.lat || previous.destination?.lng !== destination.lng;
    const importedTicket = getImportedTicket(previous.route);
    if (pointsChanged) clearRouteCandidateListSnapshot(targetSessionId);
    setRoutePlannerInitial(targetSessionId, {
      ...previous,
      origin,
      destination,
      locationName: `${origin.name} → ${destination.name}`,
      ...(pointsChanged && {
        travelMinutes: undefined, departureAt: undefined, requestedDepartureAt: undefined,
        route: importedTicket ? { importedTicket } : undefined,
      }),
    });
    router.replace({ pathname: '/schedule/route-select', params: { sessionId: targetSessionId } });
  }, [placeEditor, router]);

  const closePlanner = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/schedule');
  }, [router]);

  const goToScheduleList = useCallback(() => {
    router.replace('/schedule');
  }, [router]);

  const goBack = useCallback(() => {
    if (routePlannerBackAction === 'close') {
      closePlanner();
      return;
    }

    const targetSessionId =
      sessionId ||
      `route-reset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setRoutePlannerInitial(targetSessionId, buildCurrentRoutePlannerInitial());
    const previousCandidates = getRouteCandidateListSnapshot(targetSessionId);
    if (previousCandidates && departureTimeEdited) {
      clearRouteCandidateListSnapshot(targetSessionId);
      if (!etaLoading && selectedAlternative) {
        setRouteCandidateListSnapshot(targetSessionId, {
          alternatives: routeAlternatives,
          selectedRouteId: selectedAlternative.id,
          transitFilter: previousCandidates.transitFilter,
          scrollY: undefined,
          departureAt: requestedTransitDepartureAt,
        });
      }
    }
    const resumeCandidates = getRouteCandidateListSnapshot(targetSessionId);
    router.replace({
      pathname: '/schedule/route-select',
      params: { sessionId: targetSessionId, ...(resumeCandidates && { returnFromMap: '1' }) },
    });
  }, [
    closePlanner,
    buildCurrentRoutePlannerInitial,
    departureTimeEdited,
    etaLoading,
    requestedTransitDepartureAt,
    routeAlternatives,
    selectedAlternative,
    routePlannerBackAction,
    router,
    sessionId,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'android' || placeEditor) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (locationPromptTarget) {
          closeLocationPrompt();
          return true;
        }
        if (
          isRouteDetailMode &&
          !isBottomSheetHidden &&
          bottomSheetSnap !== 'collapsed'
        ) {
          snapBottomSheetTo('collapsed');
          return true;
        }
        if (routePlannerBackAction === 'return-to-selection') {
          goBack();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [
    bottomSheetSnap,
    closeLocationPrompt,
    goBack,
    isBottomSheetHidden,
    isRouteDetailMode,
    locationPromptTarget,
    placeEditor,
    routePlannerBackAction,
    snapBottomSheetTo,
  ]);

  const openTransitDeparturePicker = useCallback(() => {
    const providerDepartureAt = selectedAlternative?.transitDepartureAt
      ? new Date(selectedAlternative.transitDepartureAt)
      : undefined;
    const initialValue =
      providerDepartureAt && Number.isFinite(providerDepartureAt.getTime())
        ? providerDepartureAt
        : requestedTransitDepartureAt;

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initialValue,
        mode: 'date',
        minimumDate: new Date(Date.now() - 60_000),
        onChange: (dateEvent, selectedDate) => {
          if (dateEvent.type !== 'set' || !selectedDate) return;

          DateTimePickerAndroid.open({
            value: initialValue,
            mode: 'time',
            is24Hour: false,
            onChange: (timeEvent, selectedTime) => {
              if (timeEvent.type !== 'set' || !selectedTime) return;

              const nextDepartureAt = new Date(selectedDate);
              nextDepartureAt.setHours(
                selectedTime.getHours(),
                selectedTime.getMinutes(),
                0,
                0,
              );
              if (nextDepartureAt.getTime() < Date.now() - 60_000) {
                Alert.alert('출발 시각', '현재 시각 이후로 선택해 주세요.');
                return;
              }
              setRequestedTransitDepartureAt(nextDepartureAt);
              setRouteRefreshTick(current => current + 1);
              if (isRouteDetailMode && bottomSheetSnap === 'collapsed') snapBottomSheetTo('middle');
            },
          });
        },
      });
      return;
    }

    setDraftTransitDepartureAt(initialValue);
    setIsTransitDeparturePickerOpen(true);
  }, [
    bottomSheetSnap,
    isRouteDetailMode,
    snapBottomSheetTo,
    requestedTransitDepartureAt,
    selectedAlternative?.transitDepartureAt,
    setDraftTransitDepartureAt,
    setIsTransitDeparturePickerOpen,
    setRequestedTransitDepartureAt,
    setRouteRefreshTick,
  ]);

  const applyTransitDepartureTime = useCallback(() => {
    const nextDepartureAt = new Date(draftTransitDepartureAt);
    nextDepartureAt.setSeconds(0, 0);
    if (
      !Number.isFinite(nextDepartureAt.getTime()) ||
      nextDepartureAt.getTime() < Date.now() - 60_000
    ) {
      Alert.alert('출발 시각', '현재 시각 이후로 선택해 주세요.');
      return;
    }
    setRequestedTransitDepartureAt(nextDepartureAt);
    setIsTransitDeparturePickerOpen(false);
    setRouteRefreshTick(current => current + 1);
    if (isRouteDetailMode && bottomSheetSnap === 'collapsed') snapBottomSheetTo('middle');
  }, [
    bottomSheetSnap,
    isRouteDetailMode,
    snapBottomSheetTo,
    draftTransitDepartureAt,
    setIsTransitDeparturePickerOpen,
    setRequestedTransitDepartureAt,
    setRouteRefreshTick,
  ]);

  const buildCurrentRoutePlaces = useCallback(() => {
    const normalizedOriginName = originName.trim();
    const normalizedDestinationName = destinationName.trim();
    if (!hasRouteReady) {
      return undefined;
    }

    const nextOrigin: Place = {
      name: normalizedOriginName || originAddress.trim() || '출발지',
      address: originAddress.trim() || undefined,
      lat: originLat,
      lng: originLng,
    };
    const nextDestination: Place = {
      name: normalizedDestinationName || destinationAddress.trim() || '도착지',
      address: destinationAddress.trim() || undefined,
      lat: destinationLat,
      lng: destinationLng,
    };

    return { nextOrigin, nextDestination };
  }, [
    destinationAddress,
    destinationLat,
    destinationLng,
    destinationName,
    hasRouteReady,
    originAddress,
    originLat,
    originLng,
    originName,
  ]);

  const submit = () => {
    if (routeSubmitPendingRef.current) return;
    const routePlaces = buildCurrentRoutePlaces();
    if (!routePlaces) {
      Alert.alert(
        '경로 설정 필요',
        '지도에서 출발지와 도착지를 모두 선택해 주세요.',
      );
      return;
    }

    if (!canSubmitRoute) {
      Alert.alert(
        etaLoading ? '경로 계산 중' : '경로 선택 필요',
        etaLoading
          ? '새 경로 계산이 끝난 뒤 저장해 주세요.'
          : '사용할 수 있는 경로를 다시 검색해 선택해 주세요.',
      );
      return;
    }

    if (!sessionId) {
      Alert.alert(
        '저장할 일정이 없어요',
        '일정 화면에서 이동 경로를 다시 열어 주세요.',
      );
      return;
    }

    const { nextOrigin, nextDestination } = routePlaces;
    routeSubmitPendingRef.current = true;
    setRouteSubmitPending(true);
    try {
      setRoutePlannerResult(sessionId, {
        origin: nextOrigin,
        destination: nextDestination,
        travelMode,
        travelMinutes,
        locationName: `${nextOrigin.name} → ${nextDestination.name}`,
        targetArrivalAt: initial?.targetArrivalAt,
        departureAt: finalSelectedRouteDepartureTime,
        route: buildPersistableSelectedRoute(),
      });
      closePlanner();
    } catch {
      routeSubmitPendingRef.current = false;
      setRouteSubmitPending(false);
      Alert.alert('경로 저장 실패', '잠시 후 다시 시도해 주세요.');
      return;
    }

    routeSubmitResetTimerRef.current = setTimeout(() => {
      routeSubmitPendingRef.current = false;
      setRouteSubmitPending(false);
      routeSubmitResetTimerRef.current = null;
    }, 800);
  };


  return {
    applyTransitDepartureTime,
    goBack,
    goToScheduleList,
    openRoutePointEditorFromHeader,
    placeEditor,
    closePlaceEditor,
    confirmRoutePoints,
    openTransitDeparturePicker,
    submit,
  };
}

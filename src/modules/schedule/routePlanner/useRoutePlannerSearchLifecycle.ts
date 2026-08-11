import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Animated } from 'react-native';

import {
  createLatestRequestGuard,
} from '../../map/routeAsyncGuard';
import {
  getRouteAlternativeOptions,
  invalidateRouteSearch,
  type RouteAlternativeOption,
  type RoutePathCoord,
} from '../../map/routingService';
import type { RouteEndpointAccessPath } from '../../map/routeEndpointAccess';
import type { TmapMapViewHandle, TmapPathOverlay } from '../../map/TmapMapView';
import { getRoutePlannerInitial } from '../routePlannerSession';
import type { TravelMode } from '../types';
import type { BottomSheetSnap } from './bottomSheetLayout';
import type {
  DebugSheetState,
  RoutePlannerFocusTarget,
  RoutePointTarget,
  TransitRouteFilter,
} from './params';
import { sortRouteAlternativesForPlanner } from './presentation';
import type { SelectedTransitMapStop } from './routeTransitMarkers';

type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  animateBottomSheetTo: (target: number) => void;
  bottomPanelHeight: number;
  bottomSheetCollapsedOffset: number;
  bottomSheetHiddenOffset: number;
  bottomSheetSnap: BottomSheetSnap;
  bottomSheetTranslateY: Animated.Value;
  destinationAddress: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationName: string;
  forcedEditTarget?: RoutePointTarget;
  forcedFocusTarget?: RoutePlannerFocusTarget;
  forcedRouteId?: string;
  forcedRouteIndex?: number;
  forcedSheetState?: DebugSheetState;
  getBottomSheetSnapTarget: (snap: BottomSheetSnap) => number;
  handoffRoute?: RouteAlternativeOption;
  hasBottomSheetMeasured: boolean;
  hasRouteReady: boolean;
  initial: ReturnType<typeof getRoutePlannerInitial>;
  initialSyncKey: string;
  initializedOriginRef: MutableRefObject<boolean>;
  isBottomSheetHidden: boolean;
  isMapInitialized: boolean;
  isRouteDetailMode: boolean;
  isRoutePointEditMode: boolean;
  isTransitMode: boolean;
  lastAppliedInitialKeyRef: MutableRefObject<string>;
  lastCameraActionKeyRef: MutableRefObject<string>;
  mapRef: MutableRefObject<TmapMapViewHandle | null>;
  originAddress: string;
  originLat?: number;
  originLng?: number;
  originName: string;
  originTouchedRef: MutableRefObject<boolean>;
  prevHasRouteReadyRef: MutableRefObject<boolean>;
  requestedTransitDepartureAt: Date;
  routePointRequestGuardRef: MutableRefObject<ReturnType<typeof createLatestRequestGuard>>;
  routeRefreshTick: number;
  selectedAlternativeId?: string;
  selectedAlternativeIdRef: MutableRefObject<string | undefined>;
  setActiveTarget: SetValue<RoutePointTarget | null>;
  setAlternativesError: SetValue<string | undefined>;
  setBottomSheetSnap: SetValue<BottomSheetSnap>;
  setDestinationAddress: SetValue<string>;
  setDestinationLat: SetValue<number | undefined>;
  setDestinationLng: SetValue<number | undefined>;
  setDestinationName: SetValue<string>;
  setEtaDistanceMeters: SetValue<number | undefined>;
  setEtaLoading: SetValue<boolean>;
  setEtaMinutes: SetValue<number | undefined>;
  setFocusedRouteStepId: SetValue<string | undefined>;
  setFocusedTransitLegIndex: SetValue<number | undefined>;
  setIsBottomSheetCollapsed: SetValue<boolean>;
  setIsBottomSheetHidden: SetValue<boolean>;
  setIsRoutePointEditMode: SetValue<boolean>;
  setOriginAddress: SetValue<string>;
  setOriginLat: SetValue<number | undefined>;
  setOriginLng: SetValue<number | undefined>;
  setOriginName: SetValue<string>;
  setOriginUsesDefault: SetValue<boolean>;
  setRouteAlternatives: SetValue<RouteAlternativeOption[]>;
  setRouteEndpointAccessPaths: SetValue<RouteEndpointAccessPath[]>;
  setRoutePathCoords: SetValue<RoutePathCoord[] | undefined>;
  setRouteRefreshTick: SetValue<number>;
  setSelectedAlternativeId: SetValue<string | undefined>;
  setSelectedTransitMapStop: SetValue<SelectedTransitMapStop | undefined>;
  setTransitConnectorOverlays: SetValue<TmapPathOverlay[]>;
  setTransitRouteFilter: SetValue<TransitRouteFilter>;
  setTransitWalkDetailOverlays: SetValue<TmapPathOverlay[]>;
  setTravelMode: SetValue<TravelMode>;
  transitConnectorCacheRef: MutableRefObject<Map<string, RoutePathCoord[]>>;
  transitFilterCounts: Record<TransitRouteFilter, number>;
  transitRouteFilter: TransitRouteFilter;
  travelMode: TravelMode;
  visibleAlternatives: RouteAlternativeOption[];
  visibleBottomSheetHeight: number;
  windowHeight: number;
  windowWidth: number;
};

/**
 * 초기 세션 반영, 경로 후보 선택·재조회, 바텀시트 자동 상태 전환을 동기화한다.
 * 출발·도착 또는 이동 수단이 바뀌면 이전 결과를 즉시 비워 오래된 경로가 새 요청처럼 보이지 않게 한다.
 */
export function useRoutePlannerSearchLifecycle({
  animateBottomSheetTo,
  bottomPanelHeight,
  bottomSheetCollapsedOffset,
  bottomSheetHiddenOffset,
  bottomSheetSnap,
  bottomSheetTranslateY,
  destinationAddress,
  destinationLat,
  destinationLng,
  destinationName,
  forcedEditTarget,
  forcedFocusTarget,
  forcedRouteId,
  forcedRouteIndex,
  forcedSheetState,
  getBottomSheetSnapTarget,
  handoffRoute,
  hasBottomSheetMeasured,
  hasRouteReady,
  initial,
  initialSyncKey,
  initializedOriginRef,
  isBottomSheetHidden,
  isMapInitialized,
  isRouteDetailMode,
  isRoutePointEditMode,
  isTransitMode,
  lastAppliedInitialKeyRef,
  lastCameraActionKeyRef,
  mapRef,
  originAddress,
  originLat,
  originLng,
  originName,
  originTouchedRef,
  prevHasRouteReadyRef,
  requestedTransitDepartureAt,
  routePointRequestGuardRef,
  routeRefreshTick,
  selectedAlternativeId,
  selectedAlternativeIdRef,
  setActiveTarget,
  setAlternativesError,
  setBottomSheetSnap,
  setDestinationAddress,
  setDestinationLat,
  setDestinationLng,
  setDestinationName,
  setEtaDistanceMeters,
  setEtaLoading,
  setEtaMinutes,
  setFocusedRouteStepId,
  setFocusedTransitLegIndex,
  setIsBottomSheetCollapsed,
  setIsBottomSheetHidden,
  setIsRoutePointEditMode,
  setOriginAddress,
  setOriginLat,
  setOriginLng,
  setOriginName,
  setOriginUsesDefault,
  setRouteAlternatives,
  setRouteEndpointAccessPaths,
  setRoutePathCoords,
  setRouteRefreshTick,
  setSelectedAlternativeId,
  setSelectedTransitMapStop,
  setTransitConnectorOverlays,
  setTransitRouteFilter,
  setTransitWalkDetailOverlays,
  setTravelMode,
  transitConnectorCacheRef,
  transitFilterCounts,
  transitRouteFilter,
  travelMode,
  visibleAlternatives,
  visibleBottomSheetHeight,
  windowHeight,
  windowWidth,
}: Options) {

  const selectAlternativeByIndex = useCallback(
    (index: number, _scrollToCard = false) => {
      if (!visibleAlternatives.length) return;
      const bounded = Math.min(
        Math.max(index, 0),
        visibleAlternatives.length - 1,
      );
      const target = visibleAlternatives[bounded];
      if (!target) return;

      setSelectedAlternativeId(target.id);
      selectedAlternativeIdRef.current = target.id;
      setFocusedTransitLegIndex(undefined);
    },
    [
      selectedAlternativeIdRef,
      setFocusedTransitLegIndex,
      setSelectedAlternativeId,
      visibleAlternatives,
    ],
  );

  useEffect(() => {
    if (travelMode !== 'TRANSIT' && transitRouteFilter !== 'ALL') {
      setTransitRouteFilter('ALL');
    }
  }, [setTransitRouteFilter, travelMode, transitRouteFilter]);

  useEffect(() => {
    if (!isTransitMode || transitRouteFilter === 'ALL') return;
    if (transitFilterCounts[transitRouteFilter] > 0) return;
    setTransitRouteFilter('ALL');
  }, [isTransitMode, setTransitRouteFilter, transitRouteFilter, transitFilterCounts]);

  useEffect(() => {
    if (!initialSyncKey || lastAppliedInitialKeyRef.current === initialSyncKey)
      return;
    lastAppliedInitialKeyRef.current = initialSyncKey;
    routePointRequestGuardRef.current.invalidate();

    setOriginName(initial?.origin?.name ?? '');
    setDestinationName(initial?.destination?.name ?? '');
    setOriginAddress(initial?.origin?.address ?? '');
    setDestinationAddress(initial?.destination?.address ?? '');
    setOriginLat(initial?.origin?.lat);
    setOriginLng(initial?.origin?.lng);
    setOriginUsesDefault(false);
    setDestinationLat(initial?.destination?.lat);
    setDestinationLng(initial?.destination?.lng);
    setTravelMode(initial?.travelMode ?? 'CAR');
    setTransitRouteFilter('ALL');
    setRouteAlternatives(handoffRoute ? [handoffRoute] : []);
    setSelectedAlternativeId(handoffRoute?.id);
    selectedAlternativeIdRef.current = handoffRoute?.id;
    // 새 OD가 들어오면 이전 경로가 새 목적지의 결과처럼 잠시라도 보이지 않게 즉시 비운다.
    setEtaMinutes(initial?.travelMinutes);
    setEtaDistanceMeters(undefined);
    setRoutePathCoords(undefined);
    transitConnectorCacheRef.current.clear();
    setTransitConnectorOverlays([]);
    setTransitWalkDetailOverlays([]);
    setRouteEndpointAccessPaths([]);
    setSelectedTransitMapStop(undefined);
    setAlternativesError(undefined);
    setFocusedTransitLegIndex(undefined);
    setFocusedRouteStepId(undefined);
    lastCameraActionKeyRef.current = '';
    const hasInitialOrigin =
      typeof initial?.origin?.lat === 'number' &&
      typeof initial?.origin?.lng === 'number';
    const hasInitialDestination =
      typeof initial?.destination?.lat === 'number' &&
      typeof initial?.destination?.lng === 'number';
    originTouchedRef.current = hasInitialOrigin;
    initializedOriginRef.current = hasInitialOrigin;
    if (forcedEditTarget) {
      setActiveTarget(forcedEditTarget);
    } else if (forcedFocusTarget === 'origin' && hasInitialOrigin) {
      setActiveTarget('origin');
    } else if (forcedFocusTarget === 'destination' && hasInitialDestination) {
      setActiveTarget('destination');
    } else if (hasInitialOrigin && hasInitialDestination) {
      setActiveTarget(null);
    } else {
      setActiveTarget(hasInitialOrigin ? 'destination' : 'origin');
    }
    setIsRoutePointEditMode(
      !(hasInitialOrigin && hasInitialDestination) || !!forcedEditTarget,
    );
  }, [
    handoffRoute,
    initial,
    initialSyncKey,
    forcedEditTarget,
    forcedFocusTarget,
    initializedOriginRef,
    lastAppliedInitialKeyRef,
    lastCameraActionKeyRef,
    originTouchedRef,
    routePointRequestGuardRef,
    selectedAlternativeIdRef,
    setActiveTarget,
    setAlternativesError,
    setDestinationAddress,
    setDestinationLat,
    setDestinationLng,
    setDestinationName,
    setEtaDistanceMeters,
    setEtaMinutes,
    setFocusedRouteStepId,
    setFocusedTransitLegIndex,
    setIsRoutePointEditMode,
    setOriginAddress,
    setOriginLat,
    setOriginLng,
    setOriginName,
    setOriginUsesDefault,
    setRouteAlternatives,
    setRouteEndpointAccessPaths,
    setRoutePathCoords,
    setSelectedAlternativeId,
    setSelectedTransitMapStop,
    setTransitConnectorOverlays,
    setTransitRouteFilter,
    setTransitWalkDetailOverlays,
    setTravelMode,
    transitConnectorCacheRef,
  ]);

  useEffect(() => {
    // 시트 프리셋은 화면 상태만 바꾸며 현재 선택 경로와 검색 결과를 초기화하지 않는다.
    if (forcedSheetState === 'hidden') {
      setIsBottomSheetHidden(true);
      setBottomSheetSnap('hidden');
      setIsBottomSheetCollapsed(true);
    } else if (forcedSheetState === 'collapsed') {
      setIsBottomSheetHidden(false);
      setBottomSheetSnap('collapsed');
      setIsBottomSheetCollapsed(true);
    } else if (forcedSheetState === 'middle') {
      setIsBottomSheetHidden(false);
      setBottomSheetSnap('middle');
      setIsBottomSheetCollapsed(false);
    } else if (forcedSheetState === 'expanded') {
      setIsBottomSheetHidden(false);
      setBottomSheetSnap('expanded');
      setIsBottomSheetCollapsed(false);
    }
  }, [
    forcedSheetState,
    hasRouteReady,
    setBottomSheetSnap,
    setIsBottomSheetCollapsed,
    setIsBottomSheetHidden,
  ]);

  useEffect(() => {
    if (!visibleAlternatives.length) return;
    if (forcedRouteId) {
      const forcedById = visibleAlternatives.find(
        item => item.id === forcedRouteId,
      );
      if (forcedById) {
        if (forcedById.id !== selectedAlternativeId) {
          setSelectedAlternativeId(forcedById.id);
          selectedAlternativeIdRef.current = forcedById.id;
          setFocusedTransitLegIndex(undefined);
        }
        return;
      }
    }
    if (!forcedRouteId && typeof forcedRouteIndex === 'number') {
      const boundedIndex = Math.min(
        Math.max(forcedRouteIndex, 0),
        visibleAlternatives.length - 1,
      );
      const forced = visibleAlternatives[boundedIndex];
      if (forced && forced.id !== selectedAlternativeId) {
        setSelectedAlternativeId(forced.id);
        selectedAlternativeIdRef.current = forced.id;
        setFocusedTransitLegIndex(undefined);
      }
      return;
    }
    const hasSelectedVisible = visibleAlternatives.some(
      item => item.id === selectedAlternativeId,
    );
    if (hasSelectedVisible) return;
    const fallback = visibleAlternatives[0];
    setSelectedAlternativeId(fallback.id);
    selectedAlternativeIdRef.current = fallback.id;
    setFocusedTransitLegIndex(undefined);
  }, [
    visibleAlternatives,
    selectedAlternativeId,
    forcedRouteId,
    forcedRouteIndex,
    selectedAlternativeIdRef,
    setFocusedTransitLegIndex,
    setSelectedAlternativeId,
  ]);

  useEffect(() => {
    if (!hasRouteReady && !isRoutePointEditMode) {
      setIsRoutePointEditMode(true);
    }
  }, [hasRouteReady, isRoutePointEditMode, setIsRoutePointEditMode]);

  useEffect(() => {
    // 경로 편집으로 돌아가거나 좌표가 사라지면 상세 단계는 자동 해제한다.
    if (!hasRouteReady || isRoutePointEditMode) {
      setBottomSheetSnap('collapsed');
      setIsBottomSheetCollapsed(true);
    }
  }, [
    hasRouteReady,
    isRoutePointEditMode,
    setBottomSheetSnap,
    setIsBottomSheetCollapsed,
  ]);

  useEffect(() => {
    if (!hasBottomSheetMeasured) return;
    if (isBottomSheetHidden) {
      bottomSheetTranslateY.stopAnimation();
      bottomSheetTranslateY.setValue(bottomSheetHiddenOffset);
      return;
    }

    const target = getBottomSheetSnapTarget(bottomSheetSnap);
    bottomSheetTranslateY.stopAnimation(() => {
      animateBottomSheetTo(target);
    });
  }, [
    hasBottomSheetMeasured,
    isBottomSheetHidden,
    bottomSheetSnap,
    bottomSheetCollapsedOffset,
    bottomSheetHiddenOffset,
    bottomSheetTranslateY,
    animateBottomSheetTo,
    getBottomSheetSnapTarget,
  ]);

  useEffect(() => {
    if (!isMapInitialized) return;
    const reason = [
      'BOTTOM_SHEET_LAYOUT',
      bottomSheetSnap,
      isBottomSheetHidden ? 'hidden' : 'shown',
      Math.round(bottomPanelHeight),
      Math.round(visibleBottomSheetHeight),
      Math.round(windowWidth),
      Math.round(windowHeight),
    ].join(':');
    mapRef.current?.resizeMap(reason);
    const timer = setTimeout(() => {
      mapRef.current?.resizeMap(`${reason}:settled`);
    }, 320);
    return () => clearTimeout(timer);
  }, [
    bottomPanelHeight,
    bottomSheetSnap,
    isBottomSheetHidden,
    isMapInitialized,
    mapRef,
    visibleBottomSheetHeight,
    windowHeight,
    windowWidth,
  ]);

  useEffect(() => {
    if (!isMapInitialized || !hasBottomSheetMeasured) return;
    if (forcedSheetState) return;
    const prevHasRouteReady = prevHasRouteReadyRef.current;
    prevHasRouteReadyRef.current = hasRouteReady;

    // 출발/도착 미선택 상태에서는 핸들만 보이도록 접힘 유지
    if (!hasRouteReady) {
      if (isBottomSheetHidden) {
        setIsBottomSheetHidden(false);
      }
      setBottomSheetSnap('collapsed');
      setIsBottomSheetCollapsed(true);
      return;
    }

    // 경로가 처음 준비되는 순간에는 펼쳐서 안내하고,
    // 이후에는 사용자가 숨긴 상태까지 유지한다.
    if (!prevHasRouteReady) {
      if (isBottomSheetHidden) {
        setIsBottomSheetHidden(false);
      }
      const nextSnap: BottomSheetSnap = isRouteDetailMode
        ? 'middle'
        : 'expanded';
      setBottomSheetSnap(nextSnap);
      setIsBottomSheetCollapsed(nextSnap !== 'expanded');
    }
  }, [
    forcedSheetState,
    isMapInitialized,
    hasBottomSheetMeasured,
    isBottomSheetHidden,
    hasRouteReady,
    isRouteDetailMode,
    prevHasRouteReadyRef,
    setBottomSheetSnap,
    setIsBottomSheetCollapsed,
    setIsBottomSheetHidden,
  ]);

  const retryRouteSearch = useCallback(() => {
    invalidateRouteSearch(
      {
        name: originName,
        address: originAddress,
        lat: originLat,
        lng: originLng,
      },
      {
        name: destinationName,
        address: destinationAddress,
        lat: destinationLat,
        lng: destinationLng,
      },
      travelMode,
    );
    setRouteRefreshTick(current => current + 1);
  }, [
    destinationAddress,
    destinationLat,
    destinationLng,
    destinationName,
    originAddress,
    originLat,
    originLng,
    originName,
    setRouteRefreshTick,
    travelMode,
  ]);

  const isHandoffRequestCurrent =
    !!handoffRoute &&
    routeRefreshTick === 0 &&
    travelMode === initial?.travelMode &&
    originLat === initial?.origin?.lat &&
    originLng === initial?.origin?.lng &&
    destinationLat === initial?.destination?.lat &&
    destinationLng === initial?.destination?.lng;

  // 출발지·도착지·이동수단이 바뀌거나 사용자가 재시도할 때만 실제 경로를 다시 조회한다.
  useEffect(() => {
    if (!hasRouteReady) {
      setRouteAlternatives([]);
      setSelectedAlternativeId(undefined);
      selectedAlternativeIdRef.current = undefined;
      setFocusedTransitLegIndex(undefined);
      setAlternativesError(undefined);
      setEtaLoading(false);
      setEtaMinutes(undefined);
      setEtaDistanceMeters(undefined);
      setRoutePathCoords(undefined);
      return;
    }

    // 목록에서 선택한 경로는 이미 완성된 API 응답이다. 최초 진입 재조회로 다른 후보가 덮어쓰지 않게 한다.
    if (isHandoffRequestCurrent && handoffRoute) {
      setRouteAlternatives([handoffRoute]);
      setSelectedAlternativeId(handoffRoute.id);
      selectedAlternativeIdRef.current = handoffRoute.id;
      setFocusedTransitLegIndex(undefined);
      setAlternativesError(undefined);
      setEtaLoading(false);
      return;
    }

    // 새 OD/교통수단/출발 시각이 들어오면 이전 후보를 즉시 숨긴다.
    // debounce 동안 이전 경로를 새 요청의 결과처럼 저장하는 것을 막는다.
    setEtaLoading(true);
    setAlternativesError(undefined);
    setRouteAlternatives([]);
    setSelectedAlternativeId(undefined);
    selectedAlternativeIdRef.current = undefined;
    setFocusedTransitLegIndex(undefined);
    setEtaMinutes(undefined);
    setEtaDistanceMeters(undefined);
    setRoutePathCoords(undefined);

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const nextAlternatives = await getRouteAlternativeOptions(
          {
            name: originName,
            address: originAddress,
            lat: originLat,
            lng: originLng,
          },
          {
            name: destinationName,
            address: destinationAddress,
            lat: destinationLat,
            lng: destinationLng,
          },
          travelMode,
          travelMode === 'TRANSIT'
            ? { departureAt: requestedTransitDepartureAt }
            : undefined,
        );
        if (!active) return;

        const sortedAlternatives = sortRouteAlternativesForPlanner(
          nextAlternatives,
          travelMode,
        );

        setRouteAlternatives(sortedAlternatives);

        if (!sortedAlternatives.length) {
          setSelectedAlternativeId(undefined);
          selectedAlternativeIdRef.current = undefined;
          setFocusedTransitLegIndex(undefined);
          setAlternativesError('표시할 경로가 없습니다.');
          return;
        }

        const selected =
          sortedAlternatives.find(item => item.id === forcedRouteId) ??
          sortedAlternatives.find(
            item => item.id === selectedAlternativeIdRef.current,
          ) ??
          sortedAlternatives[0];
        setSelectedAlternativeId(selected.id);
        selectedAlternativeIdRef.current = selected.id;
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : '경로 계산에 실패했습니다.';
        setRouteAlternatives([]);
        setSelectedAlternativeId(undefined);
        selectedAlternativeIdRef.current = undefined;
        setFocusedTransitLegIndex(undefined);
        setAlternativesError(message);
        setRoutePathCoords(undefined);
      } finally {
        if (active) setEtaLoading(false);
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    hasRouteReady,
    travelMode,
    routeRefreshTick,
    originName,
    originAddress,
    originLat,
    originLng,
    destinationName,
    destinationAddress,
    destinationLat,
    destinationLng,
    forcedRouteId,
    handoffRoute,
    isHandoffRequestCurrent,
    requestedTransitDepartureAt,
    selectedAlternativeIdRef,
    setAlternativesError,
    setEtaDistanceMeters,
    setEtaLoading,
    setEtaMinutes,
    setFocusedTransitLegIndex,
    setRouteAlternatives,
    setRoutePathCoords,
    setSelectedAlternativeId,
  ]);

  return {
    retryRouteSearch,
    selectAlternativeByIndex,
  };
}

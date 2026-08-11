import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';

import { createLatestRequestGuard } from '../../map/routeAsyncGuard';
import type {
  PlaceSearchItem,
  RouteAlternativeOption,
  RoutePathCoord,
} from '../../map/routingService';
import type {
  TmapCameraState,
  TmapMapViewHandle,
  TmapPathOverlay,
} from '../../map/TmapMapView';
import type { RouteEndpointAccessPath } from '../../map/routeEndpointAccess';
import {
  getRoutePlannerInitial,
} from '../routePlannerSession';
import { resolveScheduleRouteDepartureContext } from '../scheduleRouteTiming';
import { resolveRouteSelectionHandoff } from '../routeSelectionHandoff';
import type { TravelMode } from '../types';
import type { BottomSheetSnap } from './bottomSheetLayout';
import {
  getSingleParam,
  parseDepartureAtParam,
  parseFocusTargetParam,
  parseFocusZoomParam,
  parseIntegerParam,
  parseQaCameraPresetParam,
  parseRouteParamPlace,
  parseRoutePointTargetParam,
  parseRouteQaLayerModeParam,
  parseSheetStateParam,
  parseTravelModeParam,
  type QaCameraPresetId,
  type RoutePointTarget,
  type TransitRouteFilter,
} from './params';
import { FALLBACK_LAT, type Coordinate } from './routeMapTypesAndStyle';
import type { SelectedTransitMapStop } from './routeTransitMarkers';

type CameraMode = 'ROUTE_OVERVIEW' | 'SEGMENT_FOCUS_QA' | 'USER_CONTROLLED';
type CameraUpdateReason =
  | 'INITIAL_ROUTE_FIT'
  | 'ROUTE_CHANGED'
  | 'SEGMENT_SELECTED'
  | 'QA_PRESET'
  | 'USER_GESTURE'
  | 'BOTTOM_SHEET_LAYOUT';

const FALLBACK_LNG = 126.978;
const INITIAL_CAMERA = {
  latitude: FALLBACK_LAT,
  longitude: FALLBACK_LNG,
  zoom: 12,
};

/**
 * 경로 계획 query와 세션 초기값을 해석하고 화면 전반에서 공유하는 원본 상태·ref를 생성한다.
 * query 변경과 언마운트 시 비동기 검색·제출 타이머를 정리해 이전 화면 작업이 남지 않게 한다.
 */
export function useRoutePlannerState() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{
    sessionId?: string;
    routeId?: string;
    routeIndex?: string;
    travelMode?: string;
    editTarget?: string;
    focusTarget?: string;
    focusZoom?: string;
    sheetState?: string;
    originName?: string;
    originAddress?: string;
    originLat?: string;
    originLng?: string;
    destinationName?: string;
    destinationAddress?: string;
    destinationLat?: string;
    destinationLng?: string;
    departureAt?: string;
    entrySource?: string;
  }>();
  const isRouteSelectionScreen = pathname === '/schedule/route-select';
  const sessionId =
    typeof params.sessionId === 'string' ? params.sessionId : '';
  const sessionInitial = sessionId
    ? getRoutePlannerInitial(sessionId)
    : undefined;
  const {
    originAddress: paramOriginAddress,
    originLat: paramOriginLat,
    originLng: paramOriginLng,
    originName: paramOriginName,
    destinationAddress: paramDestinationAddress,
    destinationLat: paramDestinationLat,
    destinationLng: paramDestinationLng,
    destinationName: paramDestinationName,
  } = params;
  // Expo Router는 같은 화면에서 query만 바뀔 때 params 객체를 재사용할 수 있다.
  // 객체 identity 대신 실제 장소 필드를 추적해야 다음 길찾기가 이전 좌표를 재사용하지 않는다.
  const paramOrigin = useMemo(
    () =>
      parseRouteParamPlace(
        {
          originAddress: paramOriginAddress,
          originLat: paramOriginLat,
          originLng: paramOriginLng,
          originName: paramOriginName,
        },
        'origin',
      ),
    [paramOriginAddress, paramOriginLat, paramOriginLng, paramOriginName],
  );
  const paramDestination = useMemo(
    () =>
      parseRouteParamPlace(
        {
          destinationAddress: paramDestinationAddress,
          destinationLat: paramDestinationLat,
          destinationLng: paramDestinationLng,
          destinationName: paramDestinationName,
        },
        'destination',
      ),
    [
      paramDestinationAddress,
      paramDestinationLat,
      paramDestinationLng,
      paramDestinationName,
    ],
  );
  const paramTravelMode = useMemo(
    () => parseTravelModeParam(params.travelMode),
    [params.travelMode],
  );
  const paramDepartureAt = useMemo(
    () => parseDepartureAtParam(params.departureAt),
    [params.departureAt],
  );
  const initial = useMemo(
    () =>
      sessionInitial ??
      (paramOrigin || paramDestination || paramTravelMode
        ? {
            origin: paramOrigin,
            destination: paramDestination,
            travelMode: paramTravelMode ?? 'CAR',
          }
        : undefined),
    [sessionInitial, paramOrigin, paramDestination, paramTravelMode],
  );
  const initialRouteDepartureAt = useMemo(() => {
    const persistedDepartureAt = initial?.departureAt
      ? new Date(initial.departureAt)
      : undefined;
    if (
      persistedDepartureAt &&
      Number.isFinite(persistedDepartureAt.getTime())
    ) {
      return persistedDepartureAt;
    }
    return resolveScheduleRouteDepartureContext(
      initial?.targetArrivalAt,
      initial?.travelMinutes,
    ).departureAt;
  }, [initial?.departureAt, initial?.targetArrivalAt, initial?.travelMinutes]);
  const forcedEditTarget = useMemo(
    () => parseRoutePointTargetParam(params.editTarget),
    [params.editTarget],
  );
  // Forced camera focus is a visual-QA aid. Do not let production deep links
  // override the route camera or its zoom level.
  const forcedFocusTarget = useMemo(
    () =>
      typeof __DEV__ === 'boolean' && __DEV__
        ? parseFocusTargetParam(params.focusTarget)
        : undefined,
    [params.focusTarget],
  );
  const forcedFocusZoom = useMemo(
    () =>
      typeof __DEV__ === 'boolean' && __DEV__
        ? parseFocusZoomParam(params.focusZoom)
        : undefined,
    [params.focusZoom],
  );
  const forcedSheetState = useMemo(
    () => parseSheetStateParam(params.sheetState),
    [params.sheetState],
  );
  const forcedRouteId = useMemo(
    () => getSingleParam(params.routeId)?.trim(),
    [params.routeId],
  );
  const forcedRouteIndex = useMemo(
    () => parseIntegerParam(params.routeIndex),
    [params.routeIndex],
  );
  const handoffRoute = useMemo(
    () =>
      resolveRouteSelectionHandoff(
        initial?.route,
        initial?.travelMode ?? 'CAR',
        forcedRouteId,
      ),
    [forcedRouteId, initial?.route, initial?.travelMode],
  );
  // QA 카메라/레이어는 운영 query와 연결하지 않는다. Release에서는 상수 분기로
  // 제거될 수 있도록 __DEV__ 안쪽에만 두고 사용자 입력으로 활성화하지 않는다.
  const qaCameraPresetId =
    typeof __DEV__ === 'boolean' && __DEV__
      ? parseQaCameraPresetParam(undefined)
      : undefined;
  const qaLayerMode =
    typeof __DEV__ === 'boolean' && __DEV__
      ? parseRouteQaLayerModeParam(undefined)
      : 'ALL';
  const isRouteQaBaseOnly = qaLayerMode === 'BASE_ONLY';
  // 지도 테마는 사용자 프로필 테마를 따르고, QA용 dim 막도 기본 화면에는 얹지 않는다.
  const qaMapBaseDimOpacity = 0;
  const shouldReturnToScheduleDetail = params.entrySource === 'schedule-detail';

  const [originName, setOriginName] = useState(initial?.origin?.name ?? '');
  const [destinationName, setDestinationName] = useState(
    initial?.destination?.name ?? '',
  );
  const [originAddress, setOriginAddress] = useState(
    initial?.origin?.address ?? '',
  );
  const [destinationAddress, setDestinationAddress] = useState(
    initial?.destination?.address ?? '',
  );
  const [originLat, setOriginLat] = useState<number | undefined>(
    initial?.origin?.lat,
  );
  const [originLng, setOriginLng] = useState<number | undefined>(
    initial?.origin?.lng,
  );
  const [originUsesDefault, setOriginUsesDefault] = useState(false);
  const [destinationLat, setDestinationLat] = useState<number | undefined>(
    initial?.destination?.lat,
  );
  const [destinationLng, setDestinationLng] = useState<number | undefined>(
    initial?.destination?.lng,
  );
  const [travelMode, setTravelMode] = useState<TravelMode>(
    initial?.travelMode ?? 'CAR',
  );
  const [activeTarget, setActiveTarget] = useState<RoutePointTarget | null>(
    () => {
      const hasInitialOrigin =
        typeof initial?.origin?.lat === 'number' &&
        typeof initial?.origin?.lng === 'number';
      const hasInitialDestination =
        typeof initial?.destination?.lat === 'number' &&
        typeof initial?.destination?.lng === 'number';
      if (forcedEditTarget) return forcedEditTarget;
      if (forcedFocusTarget === 'origin' && hasInitialOrigin) return 'origin';
      if (forcedFocusTarget === 'destination' && hasInitialDestination)
        return 'destination';
      if (hasInitialOrigin && hasInitialDestination) return null;
      return hasInitialOrigin ? 'destination' : 'origin';
    },
  );
  const [locationPromptTarget, setLocationPromptTarget] =
    useState<RoutePointTarget | null>(null);
  const [locationPromptLoading, setLocationPromptLoading] = useState(false);
  const [isRoutePointEditMode, setIsRoutePointEditMode] = useState<boolean>(
    () =>
      !(
        typeof initial?.origin?.lat === 'number' &&
        typeof initial?.origin?.lng === 'number' &&
        typeof initial?.destination?.lat === 'number' &&
        typeof initial?.destination?.lng === 'number'
      ) || !!forcedEditTarget,
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
  const [searchError, setSearchError] = useState<string>();
  const [completedSearchQuery, setCompletedSearchQuery] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const routePointRequestGuardRef = useRef(createLatestRequestGuard());

  const [etaMinutes, setEtaMinutes] = useState<number | undefined>(
    initial?.travelMinutes,
  );
  const [_etaDistanceMeters, setEtaDistanceMeters] = useState<
    number | undefined
  >();
  const [routePathCoords, setRoutePathCoords] = useState<
    RoutePathCoord[] | undefined
  >();
  const [etaLoading, setEtaLoading] = useState(false);
  const [alternativesError, setAlternativesError] = useState<
    string | undefined
  >();
  const [routeSubmitPending, setRouteSubmitPending] = useState(false);
  const routeSubmitPendingRef = useRef(false);
  const routeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [routeAlternatives, setRouteAlternatives] = useState<
    RouteAlternativeOption[]
  >(() => (handoffRoute ? [handoffRoute] : []));
  const [transitRouteFilter, setTransitRouteFilter] =
    useState<TransitRouteFilter>('ALL');
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<
    string | undefined
  >(handoffRoute?.id);
  const [requestedTransitDepartureAt, setRequestedTransitDepartureAt] =
    useState(() => paramDepartureAt ?? initialRouteDepartureAt);
  const [draftTransitDepartureAt, setDraftTransitDepartureAt] = useState(
    () => paramDepartureAt ?? initialRouteDepartureAt,
  );
  const [isTransitDeparturePickerOpen, setIsTransitDeparturePickerOpen] =
    useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(0);
  const [transitActionBarHeight, setTransitActionBarHeight] = useState(0);
  const [hasBottomSheetMeasured, setHasBottomSheetMeasured] = useState(false);
  const [bottomSheetAnimatedOffset, setBottomSheetAnimatedOffset] =
    useState(420);
  const [bottomSheetSnap, setBottomSheetSnap] =
    useState<BottomSheetSnap>('collapsed');
  const [isBottomSheetCollapsed, setIsBottomSheetCollapsed] = useState(true);
  const [isBottomSheetHidden, setIsBottomSheetHidden] = useState(true);
  const [isMapInitialized, setIsMapInitialized] = useState(false);
  const [mapZoom, setMapZoom] = useState<number>(INITIAL_CAMERA.zoom ?? 12);
  const [mapCamera, setMapCamera] = useState<TmapCameraState>({
    latitude: INITIAL_CAMERA.latitude,
    longitude: INITIAL_CAMERA.longitude,
    zoom: INITIAL_CAMERA.zoom ?? 12,
  });
  const [transitConnectorOverlays, setTransitConnectorOverlays] = useState<
    TmapPathOverlay[]
  >([]);
  const [transitWalkDetailOverlays, setTransitWalkDetailOverlays] = useState<
    TmapPathOverlay[]
  >([]);
  const [routeEndpointAccessPaths, setRouteEndpointAccessPaths] = useState<
    RouteEndpointAccessPath[]
  >([]);
  const [selectedTransitMapStop, setSelectedTransitMapStop] = useState<
    SelectedTransitMapStop | undefined
  >();
  const [focusedTransitLegIndex, setFocusedTransitLegIndex] = useState<
    number | undefined
  >();
  const [focusedRouteStepId, setFocusedRouteStepId] = useState<
    string | undefined
  >();
  const selectedAlternativeIdRef = useRef<string | undefined>(handoffRoute?.id);
  const appliedDepartureParamRef = useRef<string | undefined>(
    paramDepartureAt?.toISOString(),
  );
  const [routeRefreshTick, setRouteRefreshTick] = useState(0);
  const initializedOriginRef = useRef(false);
  const originTouchedRef = useRef(Boolean(initial?.origin));
  const prevHasRouteReadyRef = useRef(false);
  const lastCameraActionKeyRef = useRef('');
  const lastCameraQaLogSignatureRef = useRef('');
  const lastMapLayoutLogSignatureRef = useRef('');
  const cameraQaStateRef = useRef<{
    requestedFocusZoom?: number;
    cameraMode: CameraMode;
    autoFitSuppressed: boolean;
    center?: Coordinate;
    reason: CameraUpdateReason;
    presetId?: QaCameraPresetId;
    appliedAtMs?: number;
  }>({
    cameraMode: 'ROUTE_OVERVIEW',
    autoFitSuppressed: false,
    reason: 'INITIAL_ROUTE_FIT',
  });
  const lastAppliedInitialKeyRef = useRef('');
  const transitConnectorCacheRef = useRef<Map<string, RoutePathCoord[]>>(
    new Map(),
  );

  const mapRef = useRef<TmapMapViewHandle | null>(null);
  const bottomSheetTranslateY = useRef(new Animated.Value(420)).current;
  const bottomSheetAnimatedOffsetRef = useRef(420);
  const bottomSheetStartYRef = useRef(0);

  useEffect(
    () => () => {
      searchRequestIdRef.current += 1;
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (routeSubmitResetTimerRef.current)
        clearTimeout(routeSubmitResetTimerRef.current);
      routePointRequestGuardRef.current.invalidate();
    },
    [],
  );

  useEffect(() => {
    const paramKey = paramDepartureAt?.toISOString();
    if (!paramDepartureAt || appliedDepartureParamRef.current === paramKey)
      return;
    appliedDepartureParamRef.current = paramKey;
    setRequestedTransitDepartureAt(paramDepartureAt);
    setDraftTransitDepartureAt(paramDepartureAt);
    setRouteRefreshTick(current => current + 1);
  }, [paramDepartureAt]);


  return {
    activeTarget,
    alternativesError,
    bottomPanelHeight,
    bottomSheetAnimatedOffset,
    bottomSheetAnimatedOffsetRef,
    bottomSheetSnap,
    bottomSheetStartYRef,
    bottomSheetTranslateY,
    cameraQaStateRef,
    completedSearchQuery,
    destinationAddress,
    destinationLat,
    destinationLng,
    destinationName,
    draftTransitDepartureAt,
    etaLoading,
    etaMinutes,
    focusedRouteStepId,
    focusedTransitLegIndex,
    forcedEditTarget,
    forcedFocusTarget,
    forcedFocusZoom,
    forcedRouteId,
    forcedRouteIndex,
    forcedSheetState,
    handoffRoute,
    hasBottomSheetMeasured,
    initial,
    initializedOriginRef,
    initialRouteDepartureAt,
    isBottomSheetCollapsed,
    isBottomSheetHidden,
    isMapInitialized,
    isRoutePointEditMode,
    isRouteQaBaseOnly,
    isRouteSelectionScreen,
    isTransitDeparturePickerOpen,
    lastAppliedInitialKeyRef,
    lastCameraActionKeyRef,
    lastCameraQaLogSignatureRef,
    lastMapLayoutLogSignatureRef,
    locationPromptLoading,
    locationPromptTarget,
    mapCamera,
    mapRef,
    mapZoom,
    originAddress,
    originLat,
    originLng,
    originName,
    originTouchedRef,
    originUsesDefault,
    prevHasRouteReadyRef,
    qaCameraPresetId,
    qaLayerMode,
    qaMapBaseDimOpacity,
    requestedTransitDepartureAt,
    routeAlternatives,
    routeEndpointAccessPaths,
    routePathCoords,
    routePointRequestGuardRef,
    routeRefreshTick,
    routeSubmitPending,
    routeSubmitPendingRef,
    routeSubmitResetTimerRef,
    searchDebounceRef,
    searchError,
    searchQuery,
    searchRequestIdRef,
    searchResults,
    searching,
    selectedAlternativeId,
    selectedAlternativeIdRef,
    selectedTransitMapStop,
    sessionId,
    setActiveTarget,
    setAlternativesError,
    setBottomPanelHeight,
    setBottomSheetAnimatedOffset,
    setBottomSheetSnap,
    setCompletedSearchQuery,
    setDestinationAddress,
    setDestinationLat,
    setDestinationLng,
    setDestinationName,
    setDraftTransitDepartureAt,
    setEtaDistanceMeters,
    setEtaLoading,
    setEtaMinutes,
    setFocusedRouteStepId,
    setFocusedTransitLegIndex,
    setHasBottomSheetMeasured,
    setIsBottomSheetCollapsed,
    setIsBottomSheetHidden,
    setIsMapInitialized,
    setIsRoutePointEditMode,
    setIsTransitDeparturePickerOpen,
    setLocationPromptLoading,
    setLocationPromptTarget,
    setMapCamera,
    setMapZoom,
    setOriginAddress,
    setOriginLat,
    setOriginLng,
    setOriginName,
    setOriginUsesDefault,
    setRequestedTransitDepartureAt,
    setRouteAlternatives,
    setRouteEndpointAccessPaths,
    setRoutePathCoords,
    setRouteRefreshTick,
    setRouteSubmitPending,
    setSearchError,
    setSearchQuery,
    setSearchResults,
    setSearching,
    setSelectedAlternativeId,
    setSelectedTransitMapStop,
    setTransitActionBarHeight,
    setTransitConnectorOverlays,
    setTransitRouteFilter,
    setTransitWalkDetailOverlays,
    setTravelMode,
    shouldReturnToScheduleDetail,
    transitActionBarHeight,
    transitConnectorCacheRef,
    transitConnectorOverlays,
    transitRouteFilter,
    transitWalkDetailOverlays,
    travelMode,
  };
}

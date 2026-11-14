import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, useWindowDimensions } from 'react-native';

import type { TmapMapViewHandle } from '../../modules/map/TmapMapView';
import {
  getCurrentLocation,
  getCurrentLocationPermissionState,
} from '../../modules/map/currentLocation';
import { createLatestRequestGuard } from '../../modules/map/routeAsyncGuard';
import { getPaddedBoundsCamera } from '../../modules/map/routeZoomStyle';
import {
  buildSavedRouteMapPresentation,
  getSavedRouteFitCoords,
  getSavedRouteOverviewFitKey,
  getSavedTransitLegBoardCoord,
  getSavedTransitLegCoords,
} from '../../modules/map/savedRouteMapPresentation';
import { buildTransitStopInteractionId, parseTransitMapInteractionId } from '../../modules/map/transitMapInteraction';
import { routeCoords, toRouteCoord } from '../../modules/map/savedRouteMapGeometry';
import { nearestPathCoordinate } from '../../modules/map/savedRouteMapMarkers';
import { isTransitRideKind } from '../../modules/map/transitModes';
import { buildSavedRouteDetailInfo } from '../../modules/schedule/savedRouteDetailPresentation';
import { buildTransitRouteProgressSegments } from '../../modules/schedule/transitRouteProgress';
import { normalizeStopName, type RoutePassStop, type RouteStep } from '../../modules/schedule/routeInfo';
import type {
  ScheduleItem,
  ScheduleTravelPlan,
} from '../../modules/schedule/types';
import { isRouteDetailEntryRequested } from '../../modules/schedule/routeDetailNavigation';
import { fromISO } from '../../../lib/util/data';
import { buildSavedJourneyInput } from '../../modules/journey/savedJourneyGuidance';
import { useSavedJourneyMapView } from '../../modules/journey/useSavedJourneyPosition';
import {
  APP_ACCENT_BLUE,
  DEFAULT_CAMERA,
  showLocationSettingsAlert,
} from './ScheduleDetailChrome';
import { mapCoordFromUnknown, type SheetSnapMode } from './scheduleDetailModel';

type ScheduleDetailMapControllerOptions = {
  scheduleId?: string;
  item?: ScheduleItem;
  currentMemberId?: number | null;
  inspectedTravelPlan?: ScheduleTravelPlan;
  savedRecommendedDepartureAt?: Date;
  isDark: boolean;
  topInset: number;
  sheetMinHeight: number;
  openRouteDetail?: string | string[];
  reduceMotion: boolean;
  snapSheet: (mode: SheetSnapMode) => void;
};

function isSameRouteStop(a: RoutePassStop, b: RoutePassStop) {
  const name = normalizeStopName(a.name);
  return !!name && name === normalizeStopName(b.name)
    && (!a.code || !b.code || a.code === b.code)
    && (a.sequence == null || b.sequence == null || a.sequence === b.sequence);
}

/**
 * 저장된 경로의 지도 표현, 구간·정류장 초점, 현재 위치 요청과 카메라 맞춤을 관리한다.
 * 일정이 바뀌면 진행 중 위치 요청과 일회성 자동 펼침 표식을 초기화해 이전 일정의 비동기 결과가 섞이지 않게 한다.
 */
export function useScheduleDetailMapController({
  scheduleId,
  item,
  currentMemberId,
  inspectedTravelPlan,
  savedRecommendedDepartureAt,
  isDark,
  topInset,
  sheetMinHeight,
  openRouteDetail,
  reduceMotion,
  snapSheet,
}: ScheduleDetailMapControllerOptions) {
  const { width: mapWidth, height: mapHeight } = useWindowDimensions();
  const mapRef = useRef<TmapMapViewHandle>(null);
  const lastOverviewFitKeyRef = useRef<string | undefined>(undefined);
  const [mapZoom, setMapZoom] = useState(DEFAULT_CAMERA.zoom);
  const [focusedLegIndex, setFocusedLegIndex] = useState<number | undefined>();
  const [focusedEndpoint, setFocusedEndpoint] = useState<'ORIGIN' | 'DESTINATION'>();
  const hasFocusedMapLocation = focusedLegIndex !== undefined || focusedEndpoint !== undefined;
  const [selectedTransitStop, setSelectedTransitStop] = useState<{
    legIndex: number;
    stopIndex: number;
  }>();
  const [currentLocationCoord, setCurrentLocationCoord] = useState<{
    latitude: number;
    longitude: number;
  }>();
  const [currentLocationPending, setCurrentLocationPending] = useState(false);
  const currentLocationPendingRef = useRef(false);
  const currentLocationRequestGuardRef = useRef(createLatestRequestGuard());
  const autoOpenedRouteDetailItemIdRef = useRef<string | undefined>(undefined);

  /** 참여자 경로 등 표시 대상이 바뀔 때 이전 구간·정류장 선택을 함께 해제한다. */
  const clearRouteFocus = useCallback(() => {
    setFocusedLegIndex(undefined);
    setFocusedEndpoint(undefined);
    setSelectedTransitStop(undefined);
  }, []);

  useEffect(() => {
    clearRouteFocus();
    currentLocationRequestGuardRef.current.invalidate();
    currentLocationPendingRef.current = false;
    setCurrentLocationCoord(undefined);
    setCurrentLocationPending(false);
    autoOpenedRouteDetailItemIdRef.current = undefined;
  }, [clearRouteFocus, scheduleId]);

  useEffect(
    () => () => {
      currentLocationRequestGuardRef.current.invalidate();
    },
    [],
  );

  const displayRoute = inspectedTravelPlan?.route ?? item?.route;
  const guidanceInput = useMemo(() => item && currentMemberId != null && !inspectedTravelPlan
    && (item.myTravelPlan?.memberId ?? item.ownerMemberId) === currentMemberId
    ? buildSavedJourneyInput(item.route, item.origin, item.destination) : null,
    [item, currentMemberId, inspectedTravelPlan]);
  const { position: guidancePosition, walkingPaths: guidanceWalkingPaths } = useSavedJourneyMapView(guidanceInput, String(item?.id ?? ''));
  // Stabilize immutable geometry across the hook's freshness clock; do not refit every second.
  const guidanceWalkingJSON = JSON.stringify(guidanceWalkingPaths);
  const guidanceWalkingCoordinates = useMemo(() => new Map<number, {latitude: number; longitude: number}[]>(
    (JSON.parse(guidanceWalkingJSON) as typeof guidanceWalkingPaths).map(path => [path.legIndex, path.coordinates])), [guidanceWalkingJSON]);
  const displayOrigin = inspectedTravelPlan?.origin ?? item?.origin;
  const displayDestination =
    inspectedTravelPlan?.destination ?? item?.destination;
  const savedDisplayTravelMinutes =
    inspectedTravelPlan?.travelMinutes ?? item?.travelMinutes;
  const displayTravelMode = inspectedTravelPlan?.travelMode ?? item?.travelMode;
  const displayDepartureAt = inspectedTravelPlan?.departAt
    ? fromISO(inspectedTravelPlan.departAt)
    : savedRecommendedDepartureAt;
  const mapPresentation = useMemo(
    () =>
      buildSavedRouteMapPresentation({
        route: displayRoute,
        origin: displayOrigin ?? undefined,
        destination: displayDestination ?? undefined,
        mapZoom,
        isDark,
        focusedLegIndex,
        selectedTransitStop,
        guidanceWalkingPaths: guidanceWalkingCoordinates,
      }),
    [
      displayDestination,
      displayOrigin,
      displayRoute,
      focusedLegIndex,
      selectedTransitStop,
      isDark,
      mapZoom,
      guidanceWalkingCoordinates,
    ],
  );
  const {
    routeOption,
    routeLegs,
    pathOverlays: displayPathOverlays,
    markers,
  } = mapPresentation;
  const displayMarkers = useMemo(() => {
    if (guidancePosition) return [...markers, {
      id: 'schedule-detail-guidance-location', ...guidancePosition,
      displayType: 'dot' as const, tintColor: APP_ACCENT_BLUE, badgeBorderColor: '#FFFFFF', dotSize: 14, zIndex: 1001,
    }];
    if (!currentLocationCoord) return markers;
    return [
      ...markers,
      {
        id: 'schedule-detail-current-location',
        ...currentLocationCoord,
        displayType: 'dot' as const,
        tintColor: APP_ACCENT_BLUE,
        badgeBorderColor: '#FFFFFF',
        dotSize: 14,
        zIndex: 1000,
      },
    ];
  }, [currentLocationCoord, markers, guidancePosition]);
  const mapCoords = useMemo(
    () =>
      getSavedRouteFitCoords(
        displayRoute,
        displayOrigin ?? undefined,
        displayDestination ?? undefined,
        guidanceWalkingCoordinates,
      ),
    [displayDestination, displayOrigin, displayRoute, guidanceWalkingCoordinates],
  );
  const mapEdgePadding = useMemo(
    () => ({
      top: topInset + 124,
      right: 44,
      bottom: sheetMinHeight + 28,
      left: 44,
    }),
    [sheetMinHeight, topInset],
  );
  const fitRouteCoordinates = useCallback((coords: typeof mapCoords) => {
    const map = mapRef.current;
    if (!map || coords.length < 2) return;
    if (!reduceMotion) {
      map.fitToCoordinates(coords, { edgePadding: mapEdgePadding });
      return;
    }

    const { latitude, longitude } = coords[0];
    const bounds = { minLat: latitude, maxLat: latitude, minLng: longitude, maxLng: longitude };
    for (const coord of coords) {
      bounds.minLat = Math.min(bounds.minLat, coord.latitude);
      bounds.maxLat = Math.max(bounds.maxLat, coord.latitude);
      bounds.minLng = Math.min(bounds.minLng, coord.longitude);
      bounds.maxLng = Math.max(bounds.maxLng, coord.longitude);
    }
    const target = getPaddedBoundsCamera(bounds, {
      width: mapWidth, height: mapHeight, padding: mapEdgePadding,
    }, { wholeZoomLevels: true, boundsPaddingFactor: 1.08 });
    if (target) map.animateCameraTo({ ...target, duration: 0 });
  }, [mapEdgePadding, mapHeight, mapWidth, reduceMotion]);
  const overviewFitKey = useMemo(
    () => getSavedRouteOverviewFitKey(mapCoords, mapEdgePadding),
    [mapCoords, mapEdgePadding],
  );
  const routeDetailInfo = useMemo(
    () =>
      buildSavedRouteDetailInfo({
        route: displayRoute,
        routeAlternative: routeOption,
        origin: displayOrigin ?? undefined,
        destination: displayDestination ?? undefined,
        departureAt: displayDepartureAt,
      }),
    [
      displayDepartureAt,
      displayDestination,
      displayOrigin,
      displayRoute,
      routeOption,
    ],
  );
  const routeProgressSegments = useMemo(
    () => buildTransitRouteProgressSegments(routeLegs),
    [routeLegs],
  );
  const routeTravelSteps = useMemo(
    () =>
      routeDetailInfo?.steps.filter(
        step => step.type !== 'ORIGIN' && step.type !== 'DESTINATION',
      ) ?? [],
    [routeDetailInfo],
  );
  const selectedRouteStepId =
    typeof focusedLegIndex === 'number'
      ? routeTravelSteps[focusedLegIndex]?.id
      : routeDetailInfo?.steps.find(step => step.type === focusedEndpoint)?.id;
  const selectedStep = selectedTransitStop
    ? routeTravelSteps[selectedTransitStop.legIndex]
    : undefined;
  const selectedRawStop = selectedTransitStop
    ? routeLegs[selectedTransitStop.legIndex]?.passStops?.[selectedTransitStop.stopIndex]
    : undefined;
  const selectedRoutePassStopName = selectedRawStop?.name.replace(/\s+/g, ' ').trim() || undefined;
  // Saved timeline rows can omit unnamed provider stops, so raw indices are not row indices.
  const matchingStopRows = selectedRawStop && selectedRoutePassStopName
    ? (selectedStep?.passStops ?? []).flatMap((stop, index) =>
        isSameRouteStop(stop, selectedRawStop) ? [index] : [])
    : [];
  const selectedRoutePassStop = selectedStep && matchingStopRows.length === 1
    ? { stepId: selectedStep.id, stopIndex: matchingStopRows[0] }
    : undefined;

  useEffect(() => {
    if (
      !item ||
      !isRouteDetailEntryRequested(openRouteDetail) ||
      autoOpenedRouteDetailItemIdRef.current === item.id ||
      (!routeDetailInfo &&
        !savedDisplayTravelMinutes &&
        item.routeSetupRequired !== true)
    )
      return;

    // Notification/native alarm entry expands once after the route-backed sheet exists.
    // Keeping the one-shot marker prevents an offline action retry or a rerender from
    // repeatedly overriding the user's manual collapse gesture.
    autoOpenedRouteDetailItemIdRef.current = item.id;
    snapSheet('expanded');
  }, [
    item,
    openRouteDetail,
    routeDetailInfo,
    savedDisplayTravelMinutes,
    snapSheet,
  ]);

  const focusRouteLeg = useCallback(
    (legIndex: number) => {
      const leg = routeLegs[legIndex];
      if (!leg) return;

      const legCoords = leg.kind === 'WALK' ? guidanceWalkingCoordinates.get(legIndex) ?? getSavedTransitLegCoords(leg) : getSavedTransitLegCoords(leg);
      setFocusedLegIndex(legIndex);
      setFocusedEndpoint(undefined);
      setSelectedTransitStop(undefined);
      snapSheet('compact');
      fitRouteCoordinates(legCoords);
    },
    [fitRouteCoordinates, routeLegs, snapSheet, guidanceWalkingCoordinates],
  );

  const focusRouteBoardingPoint = useCallback(
    (legIndex: number) => {
      const boardingCoord = getSavedTransitLegBoardCoord(routeLegs, legIndex);
      if (!boardingCoord) {
        focusRouteLeg(legIndex);
        return;
      }

      setFocusedLegIndex(legIndex);
      setFocusedEndpoint(undefined);
      setSelectedTransitStop(undefined);
      snapSheet('compact');
      mapRef.current?.animateCameraTo({
        ...boardingCoord,
        zoom: 17.2,
        duration: reduceMotion ? 0 : 520,
      });
    },
    [focusRouteLeg, routeLegs, snapSheet, reduceMotion],
  );

  const focusRouteEndpoint = useCallback(
    (step: RouteStep) => {
      if (step.type !== 'ORIGIN' && step.type !== 'DESTINATION') return;
      const endpoint =
        step.type === 'ORIGIN' ? displayOrigin : displayDestination;
      const routeEndpointCoord =
        step.type === 'ORIGIN' ? mapCoords[0] : mapCoords[mapCoords.length - 1];
      const endpointCoord =
        mapCoordFromUnknown(endpoint) ??
        mapCoordFromUnknown(step.coordinates?.[0]) ??
        mapCoordFromUnknown(routeEndpointCoord);
      if (!endpointCoord) return;

      setFocusedLegIndex(undefined);
      setFocusedEndpoint(step.type);
      setSelectedTransitStop(undefined);
      snapSheet('compact');
      mapRef.current?.animateCameraTo({
        ...endpointCoord,
        zoom: 17.2,
        duration: reduceMotion ? 0 : 520,
      });
    },
    [displayDestination, displayOrigin, mapCoords, snapSheet, reduceMotion],
  );

  const focusTransitStop = useCallback(
    (legIndex: number, stopIndex: number) => {
      const leg = routeLegs[legIndex];
      const rawCoord = toRouteCoord(leg?.passStops?.[stopIndex]?.coord);
      if (!leg || !rawCoord) return;
      const interactionId = buildTransitStopInteractionId(legIndex, stopIndex);
      const marker = markers.find(candidate => candidate.interactionId === interactionId);
      const coord = mapCoordFromUnknown(marker ?? nearestPathCoordinate(rawCoord, routeCoords(leg.pathCoords)));
      if (!coord) return;

      setFocusedLegIndex(legIndex);
      setFocusedEndpoint(undefined);
      setSelectedTransitStop({ legIndex, stopIndex });
      snapSheet('compact');
      mapRef.current?.animateCameraTo({
        ...coord,
        zoom: 17.2,
        duration: reduceMotion ? 0 : 420,
      });
    },
    [markers, routeLegs, snapSheet, reduceMotion],
  );

  const timelineStopTargets = useMemo(() => new Map(routeTravelSteps.flatMap((step, legIndex) => {
    const leg = routeLegs[legIndex];
    if (!isTransitRideKind(step.type) || leg?.kind !== step.type || !leg.passStops?.length) return [];
    const rawStops = leg.passStops;
    return (step.passStops ?? []).flatMap((stop, rowIndex, rows) => {
      if (rowIndex === 0 || rowIndex === rows.length - 1) return [];
      const matches = rawStops.flatMap((raw, stopIndex) =>
        isSameRouteStop(stop, raw) ? [stopIndex] : []);
      const [stopIndex] = matches;
      if (matches.length !== 1 || stopIndex === 0 || stopIndex === rawStops.length - 1
        || !toRouteCoord(rawStops[stopIndex].coord)) return [];
      return [[`${step.id}:${rowIndex}`, { legIndex, stopIndex }] as const];
    });
  })), [routeLegs, routeTravelSteps]);

  const canShowPassStopOnMap = useCallback((stepId: string, index: number) =>
    timelineStopTargets.has(`${stepId}:${index}`), [timelineStopTargets]);

  const handleRoutePassStopPress = useCallback((stepId: string, index: number) => {
    const target = timelineStopTargets.get(`${stepId}:${index}`);
    if (target) focusTransitStop(target.legIndex, target.stopIndex);
  }, [focusTransitStop, timelineStopTargets]);

  const handleMapMarkerPress = useCallback(
    (event: { interactionId?: string }) => {
      const interaction = parseTransitMapInteractionId(event.interactionId);
      if (!interaction) return;
      if (interaction.kind === 'leg') {
        focusRouteLeg(interaction.legIndex);
        return;
      }

      focusTransitStop(interaction.legIndex, interaction.stopIndex);
    },
    [focusRouteLeg, focusTransitStop],
  );

  const handleRouteStepPress = useCallback(
    (step: RouteStep) => {
      if (step.type === 'ORIGIN' || step.type === 'DESTINATION') {
        focusRouteEndpoint(step);
        return;
      }

      const legIndex = routeTravelSteps.findIndex(
        candidate => candidate.id === step.id,
      );
      if (legIndex < 0) return;
      focusRouteBoardingPoint(legIndex);
    },
    [focusRouteBoardingPoint, focusRouteEndpoint, routeTravelSteps],
  );

  const handleMapZoomChanged = useCallback((zoom: number) => {
    if (!Number.isFinite(zoom)) return;
    setMapZoom(current => (Math.abs(current - zoom) < 0.04 ? current : zoom));
  }, []);

  const moveToCurrentLocation = useCallback(async () => {
    if (currentLocationPendingRef.current) return;

    const guard = currentLocationRequestGuardRef.current;
    const requestId = guard.begin();
    currentLocationPendingRef.current = true;
    setCurrentLocationPending(true);
    try {
      const permissionState = await getCurrentLocationPermissionState();
      if (!guard.isCurrent(requestId)) return;
      if (!permissionState.servicesEnabled) {
        showLocationSettingsAlert(
          '위치 서비스가 꺼져 있어요',
          '지도에서 내 위치를 보려면 기기 위치 서비스를 켜 주세요.',
          true,
        );
        return;
      }
      if (!permissionState.granted && !permissionState.canAskAgain) {
        showLocationSettingsAlert(
          '위치 권한이 필요해요',
          '지도에서 내 위치를 보려면 설정에서 NoLate의 위치 권한을 허용해 주세요.',
        );
        return;
      }

      const coord = await getCurrentLocation();
      if (!guard.isCurrent(requestId)) return;
      setCurrentLocationCoord(coord);
      mapRef.current?.animateCameraTo({
        ...coord,
        zoom: 16,
        duration: reduceMotion ? 0 : 420,
      });
    } catch (error) {
      if (!guard.isCurrent(requestId)) return;
      const permissionState = await getCurrentLocationPermissionState().catch(
        () => undefined,
      );
      if (!guard.isCurrent(requestId)) return;
      if (permissionState && !permissionState.servicesEnabled) {
        showLocationSettingsAlert(
          '위치 서비스가 꺼져 있어요',
          '지도에서 내 위치를 보려면 기기 위치 서비스를 켜 주세요.',
          true,
        );
        return;
      }
      if (
        permissionState &&
        !permissionState.granted &&
        !permissionState.canAskAgain
      ) {
        showLocationSettingsAlert(
          '위치 권한이 필요해요',
          '지도에서 내 위치를 보려면 설정에서 NoLate의 위치 권한을 허용해 주세요.',
        );
        return;
      }
      Alert.alert(
        '현재 위치를 찾을 수 없어요',
        error instanceof Error
          ? error.message
          : '현재 위치를 가져오지 못했습니다.',
      );
    } finally {
      if (guard.isCurrent(requestId)) {
        currentLocationPendingRef.current = false;
        setCurrentLocationPending(false);
      }
    }
  }, [reduceMotion]);
  const camera = useMemo(() => {
    if (mapCoords.length === 0) return DEFAULT_CAMERA;
    const latitude =
      mapCoords.reduce((sum, coord) => sum + coord.latitude, 0) /
      mapCoords.length;
    const longitude =
      mapCoords.reduce((sum, coord) => sum + coord.longitude, 0) /
      mapCoords.length;
    return { latitude, longitude, zoom: mapCoords.length > 1 ? 11 : 14 };
  }, [mapCoords]);

  const fitMap = useCallback((force = false) => {
    const map = mapRef.current;
    if (!map || mapCoords.length < 2 || !overviewFitKey) return;
    if (!force && lastOverviewFitKeyRef.current === overviewFitKey) return;

    lastOverviewFitKeyRef.current = overviewFitKey;
    fitRouteCoordinates(mapCoords);
  }, [fitRouteCoordinates, mapCoords, overviewFitKey]);

  const showWholeRoute = useCallback(() => {
    clearRouteFocus();
    fitMap(true);
  }, [clearRouteFocus, fitMap]);

  useEffect(() => {
    if (!hasFocusedMapLocation) fitMap();
  }, [fitMap, hasFocusedMapLocation]);

  return {
    camera,
    canShowPassStopOnMap,
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
    handleMapZoomChanged,
    handleRouteStepPress,
    handleRoutePassStopPress,
    mapCoords,
    mapRef,
    mapZoom,
    moveToCurrentLocation,
    showWholeRoute,
    routeDetailInfo,
    routeOption,
    routeProgressSegments,
    focusedLegIndex,
    hasFocusedMapLocation,
    selectedRoutePassStop,
    selectedRoutePassStopName,
    selectedRouteStepId,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { TmapMapViewHandle } from '../../src/modules/map/TmapMapView';
import {
  getCurrentLocation,
  getCurrentLocationPermissionState,
} from '../../src/modules/map/currentLocation';
import { createLatestRequestGuard } from '../../src/modules/map/routeAsyncGuard';
import {
  buildSavedRouteMapPresentation,
  getSavedRouteFitCoords,
  getSavedRouteOverviewFitKey,
  getSavedTransitLegBoardCoord,
  getSavedTransitLegCoords,
} from '../../src/modules/map/savedRouteMapPresentation';
import { parseTransitMapInteractionId } from '../../src/modules/map/transitMapInteraction';
import { buildSavedRouteDetailInfo } from '../../src/modules/schedule/savedRouteDetailPresentation';
import { buildTransitRouteProgressSegments } from '../../src/modules/schedule/transitRouteProgress';
import type { RouteStep } from '../../src/modules/schedule/routeInfo';
import type {
  ScheduleItem,
  ScheduleTravelPlan,
} from '../../src/modules/schedule/types';
import { isRouteDetailEntryRequested } from '../../src/modules/schedule/routeDetailNavigation';
import { fromISO } from '../../lib/util/data';
import {
  APP_ACCENT_BLUE,
  DEFAULT_CAMERA,
  showLocationSettingsAlert,
} from './ScheduleDetailChrome';
import { mapCoordFromUnknown, type SheetSnapMode } from './scheduleDetailModel';

type ScheduleDetailMapControllerOptions = {
  scheduleId?: string;
  item?: ScheduleItem;
  inspectedTravelPlan?: ScheduleTravelPlan;
  savedRecommendedDepartureAt?: Date;
  isDark: boolean;
  topInset: number;
  sheetMinHeight: number;
  openRouteDetail?: string | string[];
  snapSheet: (mode: SheetSnapMode) => void;
};

/**
 * 저장된 경로의 지도 표현, 구간·정류장 초점, 현재 위치 요청과 카메라 맞춤을 관리한다.
 * 일정이 바뀌면 진행 중 위치 요청과 일회성 자동 펼침 표식을 초기화해 이전 일정의 비동기 결과가 섞이지 않게 한다.
 */
export function useScheduleDetailMapController({
  scheduleId,
  item,
  inspectedTravelPlan,
  savedRecommendedDepartureAt,
  isDark,
  topInset,
  sheetMinHeight,
  openRouteDetail,
  snapSheet,
}: ScheduleDetailMapControllerOptions) {
  const mapRef = useRef<TmapMapViewHandle>(null);
  const lastOverviewFitKeyRef = useRef<string | undefined>(undefined);
  const [mapZoom, setMapZoom] = useState(DEFAULT_CAMERA.zoom);
  const [focusedLegIndex, setFocusedLegIndex] = useState<number | undefined>();
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
    setSelectedTransitStop(undefined);
  }, []);

  useEffect(() => {
    currentLocationRequestGuardRef.current.invalidate();
    currentLocationPendingRef.current = false;
    setCurrentLocationCoord(undefined);
    setCurrentLocationPending(false);
    autoOpenedRouteDetailItemIdRef.current = undefined;
  }, [scheduleId]);

  useEffect(
    () => () => {
      currentLocationRequestGuardRef.current.invalidate();
    },
    [],
  );

  const displayRoute = inspectedTravelPlan?.route ?? item?.route;
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
      }),
    [
      displayDestination,
      displayOrigin,
      displayRoute,
      focusedLegIndex,
      isDark,
      mapZoom,
    ],
  );
  const {
    routeOption,
    routeLegs,
    pathOverlays: displayPathOverlays,
    markers,
  } = mapPresentation;
  const displayMarkers = useMemo(() => {
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
  }, [currentLocationCoord, markers]);
  const mapCoords = useMemo(
    () =>
      getSavedRouteFitCoords(
        displayRoute,
        displayOrigin ?? undefined,
        displayDestination ?? undefined,
      ),
    [displayDestination, displayOrigin, displayRoute],
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
      : undefined;
  const selectedRoutePassStopStepId = selectedTransitStop
    ? routeTravelSteps[selectedTransitStop.legIndex]?.id
    : undefined;
  const selectedRoutePassStop =
    selectedTransitStop && selectedRoutePassStopStepId
      ? {
          stepId: selectedRoutePassStopStepId,
          stopIndex: selectedTransitStop.stopIndex,
        }
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

      const legCoords = getSavedTransitLegCoords(leg);
      if (legCoords.length < 2) return;

      setFocusedLegIndex(legIndex);
      setSelectedTransitStop(undefined);
      snapSheet('compact');
      mapRef.current?.fitToCoordinates(legCoords, {
        edgePadding: {
          top: topInset + 124,
          right: 44,
          bottom: sheetMinHeight + 28,
          left: 44,
        },
      });
    },
    [routeLegs, sheetMinHeight, snapSheet, topInset],
  );

  const focusRouteBoardingPoint = useCallback(
    (legIndex: number) => {
      const boardingCoord = getSavedTransitLegBoardCoord(routeLegs, legIndex);
      if (!boardingCoord) {
        focusRouteLeg(legIndex);
        return;
      }

      setFocusedLegIndex(legIndex);
      setSelectedTransitStop(undefined);
      snapSheet('compact');
      mapRef.current?.animateCameraTo({
        ...boardingCoord,
        zoom: 17.2,
        duration: 520,
        easing: 'Fly',
      });
    },
    [focusRouteLeg, routeLegs, snapSheet],
  );

  const focusRouteEndpoint = useCallback(
    (step: RouteStep) => {
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
      setSelectedTransitStop(undefined);
      snapSheet('compact');
      mapRef.current?.animateCameraTo({
        ...endpointCoord,
        zoom: 17.2,
        duration: 520,
        easing: 'Fly',
      });
    },
    [displayDestination, displayOrigin, mapCoords, snapSheet],
  );

  const focusTransitStop = useCallback(
    (stop: { coord?: unknown }) => {
      const coord = mapCoordFromUnknown(stop.coord);
      if (!coord) return;

      snapSheet('compact');
      mapRef.current?.animateCameraTo({
        ...coord,
        zoom: 17.2,
        duration: 420,
      });
    },
    [snapSheet],
  );

  const handleMapMarkerPress = useCallback(
    (event: { id: string; interactionId?: string }) => {
      const interaction = parseTransitMapInteractionId(event.interactionId);
      if (!interaction) return;
      if (interaction.kind === 'leg') {
        focusRouteLeg(interaction.legIndex);
        return;
      }

      const stop =
        routeLegs[interaction.legIndex]?.passStops?.[interaction.stopIndex];
      if (!stop) return;
      setFocusedLegIndex(interaction.legIndex);
      setSelectedTransitStop({
        legIndex: interaction.legIndex,
        stopIndex: interaction.stopIndex,
      });
      focusTransitStop(stop);
    },
    [focusRouteLeg, focusTransitStop, routeLegs],
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
        duration: 420,
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
  }, []);
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

  const fitMap = useCallback(() => {
    const map = mapRef.current;
    if (!map || mapCoords.length < 2 || !overviewFitKey) return;
    if (lastOverviewFitKeyRef.current === overviewFitKey) return;

    lastOverviewFitKeyRef.current = overviewFitKey;
    map.fitToCoordinates(mapCoords, { edgePadding: mapEdgePadding });
  }, [mapCoords, mapEdgePadding, overviewFitKey]);

  useEffect(() => {
    fitMap();
  }, [fitMap]);

  return {
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
  };
}

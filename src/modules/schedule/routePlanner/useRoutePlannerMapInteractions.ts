import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useRouter } from 'expo-router';

import type {
  RouteAlternativeOption,
} from '../../map/routingService';
import { parseTransitMapInteractionId } from '../../map/transitMapInteraction';
import type {
  TmapCameraState,
  TmapMapLayoutReport,
  TmapMapViewHandle,
  TmapMarker,
  TmapPathOverlay,
} from '../../map/TmapMapView';
import type { RouteStep } from '../routeInfo';
import type { BottomSheetSnap } from './bottomSheetLayout';
import {
  fitCameraToBoundsWithUiPadding,
  getSegmentFocusBounds,
  getTmapRegionCameraTarget,
} from './routeMapCamera';
import {
  isValidCoordinate,
  offsetCoordByMeters,
} from './routeMapCoordinate';
import type { Coordinate, NormalizedRoute } from './routeMapTypesAndStyle';
import { getTransitLegStartCoord } from './routeTransitLegCoordinates';
import { getTransitLegMapCoords } from './routeTransitGeometryBuilder';
import type { SelectedTransitMapStop } from './routeTransitMarkers';

type CameraQaState = {
  requestedFocusZoom?: number;
  cameraMode: 'ROUTE_OVERVIEW' | 'SEGMENT_FOCUS_QA' | 'USER_CONTROLLED';
  autoFitSuppressed: boolean;
  center?: Coordinate;
  reason:
    | 'INITIAL_ROUTE_FIT'
    | 'ROUTE_CHANGED'
    | 'SEGMENT_SELECTED'
    | 'QA_PRESET'
    | 'USER_GESTURE'
    | 'BOTTOM_SHEET_LAYOUT';
  presetId?: string;
  appliedAtMs?: number;
};

type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  bottomPanelHeight: number;
  bottomSheetCollapsedOffset: number;
  bottomSheetExpandedOffset: number;
  bottomSheetMiddleOffset: number;
  bottomSheetSnap: BottomSheetSnap;
  cameraQaStateRef: MutableRefObject<CameraQaState>;
  etaLoading: boolean;
  focusedRouteStepId?: string;
  focusedTransitLegIndex?: number;
  hasRouteReady: boolean;
  insetsTop: number;
  isBottomSheetHidden: boolean;
  isRouteSelectionStage: boolean;
  isTransitMode: boolean;
  lastCameraActionKeyRef: MutableRefObject<string>;
  lastCameraQaLogSignatureRef: MutableRefObject<string>;
  lastMapLayoutLogSignatureRef: MutableRefObject<string>;
  mapMarkers: TmapMarker[];
  mapRef: MutableRefObject<TmapMapViewHandle | null>;
  mapZoom: number;
  persistCurrentRoutePlannerInitial: (targetSessionId?: string) => void;
  router: ReturnType<typeof useRouter>;
  runCameraActionAfterDirectionPrewarm: (
    actionKey: string,
    center: Coordinate,
    zoom: number,
    action: () => void,
  ) => void;
  selectedAlternative?: RouteAlternativeOption;
  selectedNormalizedRoute?: NormalizedRoute;
  selectedVisibleAlternativeIndex: number;
  sessionId: string;
  setBottomSheetSnap: SetValue<BottomSheetSnap>;
  setFocusedRouteStepId: SetValue<string | undefined>;
  setFocusedTransitLegIndex: SetValue<number | undefined>;
  setIsBottomSheetCollapsed: SetValue<boolean>;
  setIsBottomSheetHidden: SetValue<boolean>;
  setMapCamera: SetValue<TmapCameraState>;
  setMapZoom: SetValue<number>;
  setSelectedTransitMapStop: SetValue<SelectedTransitMapStop | undefined>;
  transitMapBottomOcclusionHeight: number;
  transitWalkDetailOverlays: TmapPathOverlay[];
  visibleBottomSheetHeight: number;
  windowHeight: number;
  windowWidth: number;
};

/**
 * 지도 확대·카메라 보고·대중교통 구간 및 정류장 포커스 상호작용을 관리한다.
 * 상세 진입 시 선택 경로 세션을 먼저 보존해 목록에서 상세로 이동해도 초안이 유지되게 한다.
 */
export function useRoutePlannerMapInteractions({
  bottomPanelHeight,
  bottomSheetCollapsedOffset,
  bottomSheetExpandedOffset,
  bottomSheetMiddleOffset,
  bottomSheetSnap,
  cameraQaStateRef,
  etaLoading,
  focusedRouteStepId,
  focusedTransitLegIndex,
  hasRouteReady,
  insetsTop,
  isBottomSheetHidden,
  isRouteSelectionStage,
  isTransitMode,
  lastCameraActionKeyRef,
  lastCameraQaLogSignatureRef,
  lastMapLayoutLogSignatureRef,
  mapMarkers,
  mapRef,
  mapZoom,
  persistCurrentRoutePlannerInitial,
  router,
  runCameraActionAfterDirectionPrewarm,
  selectedAlternative,
  selectedNormalizedRoute,
  selectedVisibleAlternativeIndex,
  sessionId,
  setBottomSheetSnap,
  setFocusedRouteStepId,
  setFocusedTransitLegIndex,
  setIsBottomSheetCollapsed,
  setIsBottomSheetHidden,
  setMapCamera,
  setMapZoom,
  setSelectedTransitMapStop,
  transitMapBottomOcclusionHeight,
  transitWalkDetailOverlays,
  visibleBottomSheetHeight,
  windowHeight,
  windowWidth,
}: Options) {
  const insets = { top: insetsTop };
  const onPressZoomIn = useCallback(() => {
    mapRef.current?.zoomBy(1);
  }, [mapRef]);

  const onPressZoomOut = useCallback(() => {
    mapRef.current?.zoomBy(-1);
  }, [mapRef]);

  const onMapLayoutReport = useCallback(
    (report: TmapMapLayoutReport) => {
      if (typeof __DEV__ === 'boolean' && !__DEV__) return;
      const cameraQaState = cameraQaStateRef.current;
      const row = {
        mapContainerWidth: Math.round(report.mapContainerWidth ?? windowWidth),
        mapContainerHeight: Math.round(
          report.mapContainerHeight ?? windowHeight,
        ),
        webViewWidth: Math.round(
          report.webViewWidth ?? report.mapContainerWidth ?? windowWidth,
        ),
        webViewHeight: Math.round(
          report.webViewHeight ?? report.mapContainerHeight ?? windowHeight,
        ),
        deviceWidth: Math.round(windowWidth),
        deviceHeight: Math.round(windowHeight),
        bottomSheetHeight: Math.round(visibleBottomSheetHeight),
        cameraMode: cameraQaState.cameraMode,
        cameraUpdateReason: cameraQaState.reason,
        layoutReason: report.reason ?? 'UNKNOWN',
        isCameraAnimating: report.isCameraAnimating === true,
        isMapIdle: report.isMapIdle !== false,
      };
      const signature = JSON.stringify(row);
      if (lastMapLayoutLogSignatureRef.current === signature) return;
      lastMapLayoutLogSignatureRef.current = signature;
      console.log('[map-layout]', row);
      if (
        row.mapContainerWidth > 0 &&
        row.mapContainerHeight > 0 &&
        (row.webViewWidth < row.mapContainerWidth * 0.92 ||
          row.webViewHeight < row.mapContainerHeight * 0.92)
      ) {
        console.warn('[map-layout] possible tile viewport shrink', row);
      }
    },
    [
      cameraQaStateRef,
      lastMapLayoutLogSignatureRef,
      visibleBottomSheetHeight,
      windowHeight,
      windowWidth,
    ],
  );

  const onMapZoomChanged = useCallback((nextZoom: number) => {
    setMapZoom(prev => (Math.abs(prev - nextZoom) < 0.05 ? prev : nextZoom));
    const cameraQaState = cameraQaStateRef.current;
    const signature = JSON.stringify({
      actualZoom: Math.round(nextZoom * 10) / 10,
      requestedFocusZoom: cameraQaState.requestedFocusZoom,
      cameraMode: cameraQaState.cameraMode,
      presetId: cameraQaState.presetId,
      reason: cameraQaState.reason,
      autoFitSuppressed: cameraQaState.autoFitSuppressed,
      center: cameraQaState.center,
      appliedAtMs: cameraQaState.appliedAtMs,
    });
    if (lastCameraQaLogSignatureRef.current === signature) return;
    lastCameraQaLogSignatureRef.current = signature;
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;

    const requestedFocusZoom = cameraQaState.requestedFocusZoom;
    const zoomDelta =
      typeof requestedFocusZoom === 'number'
        ? Math.abs(requestedFocusZoom - nextZoom)
        : undefined;
    console.log('[camera-qa] requestedFocusZoom:', requestedFocusZoom);
    console.log('[camera-qa] actualZoom:', nextZoom);
    console.log('[camera-qa] cameraMode:', cameraQaState.cameraMode);
    console.log(
      '[camera-qa] autoFitSuppressed:',
      cameraQaState.autoFitSuppressed,
    );
    console.log('[camera-qa] center:', cameraQaState.center);
    console.log('[camera-qa] reason:', cameraQaState.reason);
    console.log('[camera-qa] presetId:', cameraQaState.presetId);
    const isCameraSettled =
      !cameraQaState.appliedAtMs ||
      Date.now() - cameraQaState.appliedAtMs >= 500;
    if (typeof zoomDelta === 'number' && zoomDelta > 0.3 && isCameraSettled) {
      console.warn('[camera-qa] requested/actual zoom mismatch', {
        requestedFocusZoom,
        actualZoom: nextZoom,
        zoomDelta,
        presetId: cameraQaState.presetId,
      });
    }
  }, [cameraQaStateRef, lastCameraQaLogSignatureRef, setMapZoom]);

  const onMapCameraChanged = useCallback((nextCamera: TmapCameraState) => {
    setMapCamera(previous => {
      const previousScale = previous.metersPerPixel;
      const nextScale = nextCamera.metersPerPixel;
      const scaleUnchanged =
        (typeof previousScale !== 'number' && typeof nextScale !== 'number') ||
        (typeof previousScale === 'number' &&
          typeof nextScale === 'number' &&
          Math.abs(previousScale - nextScale) <=
            Math.max(0.001, previousScale * 0.015));
      if (
        Math.abs(previous.latitude - nextCamera.latitude) < 0.000002 &&
        Math.abs(previous.longitude - nextCamera.longitude) < 0.000002 &&
        Math.abs(previous.zoom - nextCamera.zoom) < 0.05 &&
        scaleUnchanged
      ) {
        return previous;
      }
      return nextCamera;
    });
  }, [setMapCamera]);

  const focusMapOnTransitLeg = useCallback(
    (legIndex: number) => {
      const legs = selectedAlternative?.transitLegs;
      if (!selectedAlternative || !Array.isArray(legs) || !legs[legIndex])
        return;

      setFocusedTransitLegIndex(legIndex);

      const walkOverlayById = new Map(
        transitWalkDetailOverlays.map(overlay => [overlay.id, overlay.coords]),
      );
      const leg = legs[legIndex];
      const legCoords = getTransitLegMapCoords(
        selectedAlternative.id,
        legs,
        legIndex,
        walkOverlayById,
      );
      const displayedStart = legCoords[0];
      const rawStart = getTransitLegStartCoord(leg);
      const startCoord = displayedStart
        ? { lat: displayedStart.latitude, lng: displayedStart.longitude }
        : rawStart;
      if (!startCoord) return;

      const focusZoom = 18;
      const activeSheetOffset =
        bottomSheetSnap === 'expanded'
          ? bottomSheetExpandedOffset
          : bottomSheetSnap === 'middle'
          ? bottomSheetMiddleOffset
          : bottomSheetCollapsedOffset;
      const rawVisibleSheetTopY =
        !isBottomSheetHidden && bottomPanelHeight > 0
          ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
          : windowHeight;
      const visibleSheetTopY = !isBottomSheetHidden
        ? Math.min(
            rawVisibleSheetTopY,
            windowHeight - transitMapBottomOcclusionHeight,
          )
        : rawVisibleSheetTopY;
      const visibleMapTopY = Math.max(insets.top + 104, 126);
      const visibleMapBottomY = Math.max(visibleMapTopY + 80, visibleSheetTopY);
      const visibleMapCenterY = (visibleMapTopY + visibleMapBottomY) / 2;
      const verticalPixelShift = Math.max(
        0,
        windowHeight / 2 - visibleMapCenterY,
      );
      const metersPerPixel =
        (156_543.03392 * Math.cos((startCoord.lat * Math.PI) / 180)) /
        2 ** focusZoom;
      const cameraCenter = offsetCoordByMeters(
        startCoord,
        -(verticalPixelShift * metersPerPixel),
        0,
      );
      const focusedSegment = selectedNormalizedRoute?.segments.find(
        segment => segment.sequence === legIndex,
      );
      const focusBounds = focusedSegment
        ? getSegmentFocusBounds(focusedSegment)
        : legCoords.filter(isValidCoordinate);
      const focusPadding = {
        top: Math.max(insets.top + 132, 150),
        bottom: Math.max(transitMapBottomOcclusionHeight + 32, 180),
        left: 48,
        right: 48,
      };
      const fitRegion = fitCameraToBoundsWithUiPadding(
        focusBounds,
        focusPadding,
        { width: windowWidth, height: windowHeight },
      );

      const focusKey = [
        'focus-leg-bounds-v2',
        selectedAlternative.id,
        legIndex,
        startCoord.lat.toFixed(6),
        startCoord.lng.toFixed(6),
        bottomSheetSnap,
        Math.round(visibleBottomSheetHeight),
      ].join(':');
      lastCameraActionKeyRef.current = focusKey;
      cameraQaStateRef.current = {
        requestedFocusZoom: fitRegion ? undefined : focusZoom,
        cameraMode: 'SEGMENT_FOCUS_QA',
        autoFitSuppressed: false,
        center: fitRegion
          ? { latitude: fitRegion.latitude, longitude: fitRegion.longitude }
          : { latitude: cameraCenter.lat, longitude: cameraCenter.lng },
        reason: 'SEGMENT_SELECTED',
        appliedAtMs: Date.now(),
      };
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[camera-fit] segment focus padding:', {
          selectedRouteId: selectedNormalizedRoute?.id,
          legIndex,
          segmentId: focusedSegment?.id,
          pointCount: focusBounds.length,
          padding: focusPadding,
          fitRegion,
        });
      }
      mapRef.current?.resizeMap('SEGMENT_FOCUS_BEFORE_CAMERA');
      if (fitRegion) {
        const targetRegion = {
          ...fitRegion,
          zoomOffset: 0,
          duration: 680,
          easing: 'Fly',
        };
        const targetCamera = getTmapRegionCameraTarget(targetRegion);
        runCameraActionAfterDirectionPrewarm(
          focusKey,
          targetCamera.center,
          targetCamera.zoom,
          () => mapRef.current?.animateRegionTo(targetRegion),
        );
      } else {
        runCameraActionAfterDirectionPrewarm(
          focusKey,
          { latitude: cameraCenter.lat, longitude: cameraCenter.lng },
          focusZoom,
          () =>
            mapRef.current?.animateCameraTo({
              latitude: cameraCenter.lat,
              longitude: cameraCenter.lng,
              zoom: focusZoom,
              duration: 680,
              easing: 'Fly',
            }),
        );
      }
      setTimeout(() => {
        mapRef.current?.resizeMap('SEGMENT_FOCUS_AFTER_CAMERA');
      }, 760);
    },
    [
      bottomPanelHeight,
      bottomSheetCollapsedOffset,
      bottomSheetExpandedOffset,
      bottomSheetMiddleOffset,
      bottomSheetSnap,
      cameraQaStateRef,
      insets.top,
      isBottomSheetHidden,
      lastCameraActionKeyRef,
      mapRef,
      selectedAlternative,
      selectedNormalizedRoute,
      transitWalkDetailOverlays,
      transitMapBottomOcclusionHeight,
      visibleBottomSheetHeight,
      windowWidth,
      windowHeight,
      runCameraActionAfterDirectionPrewarm,
      setFocusedTransitLegIndex,
    ],
  );

  const onMapMarkerPress = useCallback(
    (event: { id: string; interactionId?: string }) => {
      const interaction = parseTransitMapInteractionId(event.interactionId);
      const legs = selectedAlternative?.transitLegs;
      if (!interaction || !Array.isArray(legs) || !legs[interaction.legIndex])
        return;

      setFocusedRouteStepId(`leg-${interaction.legIndex}`);
      setFocusedTransitLegIndex(interaction.legIndex);
      setIsBottomSheetHidden(false);
      setBottomSheetSnap('middle');
      setIsBottomSheetCollapsed(false);

      if (interaction.kind === 'leg') {
        setSelectedTransitMapStop(undefined);
        focusMapOnTransitLeg(interaction.legIndex);
        return;
      }

      const stop =
        legs[interaction.legIndex].passStops?.[interaction.stopIndex];
      if (!stop?.coord) {
        focusMapOnTransitLeg(interaction.legIndex);
        return;
      }
      setSelectedTransitMapStop({
        legIndex: interaction.legIndex,
        stopIndex: interaction.stopIndex,
      });

      const pressedMarker = mapMarkers.find(marker => marker.id === event.id);
      const markerCoord = pressedMarker
        ? { lat: pressedMarker.latitude, lng: pressedMarker.longitude }
        : stop.coord;
      const focusZoom = Math.min(18, Math.max(17, mapZoom));
      const cameraCenter = offsetCoordByMeters(markerCoord, -55, 0);
      mapRef.current?.resizeMap('TRANSIT_STOP_FOCUS_BEFORE_CAMERA');
      mapRef.current?.animateCameraTo({
        latitude: cameraCenter.lat,
        longitude: cameraCenter.lng,
        zoom: focusZoom,
        duration: 460,
        easing: 'Fly',
      });
      setTimeout(() => {
        mapRef.current?.resizeMap('TRANSIT_STOP_FOCUS_AFTER_CAMERA');
      }, 540);
    },
    [
      focusMapOnTransitLeg,
      mapMarkers,
      mapRef,
      mapZoom,
      selectedAlternative,
      setBottomSheetSnap,
      setFocusedRouteStepId,
      setFocusedTransitLegIndex,
      setIsBottomSheetCollapsed,
      setIsBottomSheetHidden,
      setSelectedTransitMapStop,
    ],
  );

  const selectedRouteStepId =
    focusedRouteStepId ??
    (typeof focusedTransitLegIndex === 'number'
      ? `leg-${focusedTransitLegIndex}`
      : undefined);
  const focusRouteInfoStep = useCallback(
    (step: RouteStep) => {
      setFocusedRouteStepId(step.id);
      const match = step.id.match(/^leg-(\d+)$/);
      if (match?.[1] && isTransitMode) {
        focusMapOnTransitLeg(Number(match[1]));
        return;
      }

      const coordinates = step.coordinates ?? [];
      if (coordinates.length >= 2) {
        mapRef.current?.fitToCoordinates(coordinates, { padding: 84 });
        return;
      }
      const coordinate = coordinates[0];
      if (coordinate) {
        mapRef.current?.animateCameraTo({
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          zoom: Math.max(mapZoom, 16),
          duration: 520,
          easing: 'Fly',
        });
      }
    },
    [focusMapOnTransitLeg, isTransitMode, mapRef, mapZoom, setFocusedRouteStepId],
  );

  const canEnterRouteDetail =
    isRouteSelectionStage &&
    hasRouteReady &&
    !!selectedAlternative &&
    !etaLoading;
  const onEnterRouteDetailView = useCallback(() => {
    if (!canEnterRouteDetail || !sessionId) return;

    persistCurrentRoutePlannerInitial();
    router.replace({
      pathname: '/schedule/route-planner',
      params: {
        sessionId,
        routeIndex:
          selectedVisibleAlternativeIndex >= 0
            ? String(selectedVisibleAlternativeIndex)
            : '0',
        sheetState: 'middle',
      },
    });
  }, [
    canEnterRouteDetail,
    persistCurrentRoutePlannerInitial,
    router,
    selectedVisibleAlternativeIndex,
    sessionId,
  ]);

  return {
    canEnterRouteDetail,
    focusMapOnTransitLeg,
    focusRouteInfoStep,
    onEnterRouteDetailView,
    onMapCameraChanged,
    onMapLayoutReport,
    onMapMarkerPress,
    onMapZoomChanged,
    onPressZoomIn,
    onPressZoomOut,
    selectedRouteStepId,
  };
}

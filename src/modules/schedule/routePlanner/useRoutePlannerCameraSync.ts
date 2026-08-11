import { useEffect, type MutableRefObject } from 'react';

import type {
  RouteAlternativeOption,
  RoutePathCoord,
} from '../../map/routingService';
import type {
  TmapLatLng,
  TmapMapViewHandle,
  TmapPathOverlay,
} from '../../map/TmapMapView';
import {
  getPaddedBoundsCamera,
  getRouteOverviewFitKey,
  shouldDeferInitialRouteCamera,
} from '../../map/routeZoomStyle';
import type { RouteInfo } from '../routeInfo';
import type { TravelMode } from '../types';
import type { BottomSheetSnap } from './bottomSheetLayout';
import type {
  QaCameraPresetId,
  RoutePlannerFocusTarget,
  RoutePointTarget,
} from './params';
import {
  getCoordinateBounds,
  getPaddedCameraCenterForFixedZoom,
  type QaCameraPreset,
} from './routeMapCamera';
import { offsetCoordByMeters } from './routeMapCoordinate';
import type { Coordinate, NormalizedRoute } from './routeMapTypesAndStyle';
import {
  getTransitRouteFirstSubwayFocusCoord,
  getTransitRouteStartFocusCoord,
} from './routeTransitWalkGeometry';
import { haversineDistanceKm } from './presentation';

const ROUTE_ENDPOINT_PIN_TOP_HEADROOM = 110;
const ROUTE_PATH_BOTTOM_HEADROOM = 92;

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
  presetId?: QaCameraPresetId;
  appliedAtMs?: number;
};

type Options = {
  activeTarget: RoutePointTarget | null;
  bottomPanelHeight: number;
  bottomSheetCollapsedOffset: number;
  bottomSheetExpandedOffset: number;
  bottomSheetMiddleOffset: number;
  bottomSheetSnap: BottomSheetSnap;
  cameraQaStateRef: MutableRefObject<CameraQaState>;
  destinationLat?: number;
  destinationLng?: number;
  etaLoading: boolean;
  forcedFocusTarget?: RoutePlannerFocusTarget;
  forcedFocusZoom?: number;
  hasBottomSheetMeasured: boolean;
  hasRouteReady: boolean;
  insetsTop: number;
  isBottomSheetCollapsed: boolean;
  isBottomSheetHidden: boolean;
  isMapInitialized: boolean;
  isQaCameraLocked: boolean;
  isRouteDetailMode: boolean;
  isTransitDetailMode: boolean;
  lastCameraActionKeyRef: MutableRefObject<string>;
  mapRef: MutableRefObject<TmapMapViewHandle | null>;
  originLat?: number;
  originLng?: number;
  pathOverlayCoords?: TmapLatLng[];
  qaCameraPreset?: QaCameraPreset;
  requestedTransitDepartureAt: Date;
  routeRefreshTick: number;
  runCameraActionAfterDirectionPrewarm: (
    actionKey: string,
    center: Coordinate,
    zoom: number,
    action: () => void,
  ) => void;
  selectedAlternative?: RouteAlternativeOption;
  selectedAlternativeId?: string;
  selectedNormalizedRoute?: NormalizedRoute;
  selectedRouteInfo?: RouteInfo;
  transitConnectorOverlays: TmapPathOverlay[];
  transitMapBottomOcclusionHeight: number;
  transitWalkDetailOverlays: TmapPathOverlay[];
  travelMode: TravelMode;
  visibleBottomSheetHeight: number;
  windowHeight: number;
  windowWidth: number;
};

/**
 * 경로·시트·포커스 상태가 바뀔 때 지도 카메라의 중심과 확대 수준을 결정한다.
 * imperative 지도 명령을 하나의 effect에 모아 경로 재계산 중 불필요한 카메라 초기화를 막는다.
 */
export function useRoutePlannerCameraSync({
  activeTarget,
  bottomPanelHeight,
  bottomSheetCollapsedOffset,
  bottomSheetExpandedOffset,
  bottomSheetMiddleOffset,
  bottomSheetSnap,
  cameraQaStateRef,
  destinationLat,
  destinationLng,
  etaLoading,
  forcedFocusTarget,
  forcedFocusZoom,
  hasBottomSheetMeasured,
  hasRouteReady,
  insetsTop,
  isBottomSheetCollapsed,
  isBottomSheetHidden,
  isMapInitialized,
  isQaCameraLocked,
  isRouteDetailMode,
  isTransitDetailMode,
  lastCameraActionKeyRef,
  mapRef,
  originLat,
  originLng,
  pathOverlayCoords,
  qaCameraPreset,
  requestedTransitDepartureAt,
  routeRefreshTick,
  runCameraActionAfterDirectionPrewarm,
  selectedAlternative,
  selectedAlternativeId,
  selectedNormalizedRoute,
  selectedRouteInfo,
  transitConnectorOverlays,
  transitMapBottomOcclusionHeight,
  transitWalkDetailOverlays,
  travelMode,
  visibleBottomSheetHeight,
  windowHeight,
  windowWidth,
}: Options) {
  const insets = { top: insetsTop };
  // 카메라는 prop으로 계속 넘기지 않고 imperative ref로만 제어한다.
  // 그래야 경로 재계산/마커 갱신 때 불필요한 카메라 리셋 없이 원하는 포커스만 이동시킬 수 있다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const hasOrigin =
      typeof originLat === 'number' && typeof originLng === 'number';
    const hasDest =
      typeof destinationLat === 'number' && typeof destinationLng === 'number';
    const isTransitForcedFocusPending =
      (forcedFocusTarget === 'startRide' ||
        forcedFocusTarget === 'firstSubway') &&
      travelMode === 'TRANSIT' &&
      (!Array.isArray(selectedAlternative?.transitLegs) ||
        selectedAlternative.transitLegs.length === 0);
    if (isTransitForcedFocusPending) return;
    if (
      shouldDeferInitialRouteCamera({
        isRouteDetailMode,
        mapInitialized: isMapInitialized,
        hasOrigin,
        hasDestination: hasDest,
        routeLoading: etaLoading,
        bottomSheetVisible: !isBottomSheetHidden,
        bottomSheetMeasured: hasBottomSheetMeasured,
      })
    ) {
      return;
    }

    const getSheetAwareCameraCenter = (
      coord: RoutePathCoord,
      focusZoom: number,
    ): RoutePathCoord => {
      const activeSheetOffset =
        bottomSheetSnap === 'expanded'
          ? bottomSheetExpandedOffset
          : bottomSheetSnap === 'middle'
          ? bottomSheetMiddleOffset
          : bottomSheetCollapsedOffset;
      const rawVisibleSheetTopY =
        isRouteDetailMode && !isBottomSheetHidden && bottomPanelHeight > 0
          ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
          : isRouteDetailMode && !isBottomSheetHidden
          ? Math.round(windowHeight * 0.56)
          : windowHeight;
      const visibleSheetTopY =
        isRouteDetailMode && !isBottomSheetHidden
          ? Math.min(
              rawVisibleSheetTopY,
              windowHeight - transitMapBottomOcclusionHeight,
            )
          : rawVisibleSheetTopY;
      const visibleMapTopY = isRouteDetailMode
        ? Math.max(insets.top + 104, 126)
        : Math.max(insets.top + 84, 112);
      const visibleMapBottomY = Math.max(
        visibleMapTopY + 120,
        visibleSheetTopY,
      );
      const visibleMapCenterY =
        visibleMapTopY + (visibleMapBottomY - visibleMapTopY) * 0.22;
      const verticalPixelShift = Math.max(
        0,
        windowHeight / 2 - visibleMapCenterY,
      );
      const metersPerPixel =
        (156_543.03392 * Math.cos((coord.lat * Math.PI) / 180)) /
        2 ** focusZoom;
      const rawShiftMeters = verticalPixelShift * metersPerPixel;
      const maxShiftMeters =
        focusZoom < 12
          ? 780
          : focusZoom < 14
          ? 420
          : focusZoom < 16
          ? 170
          : 360;
      const shiftMeters = Math.min(maxShiftMeters, Math.max(0, rawShiftMeters));
      return offsetCoordByMeters(coord, -shiftMeters, 0);
    };

    if (qaCameraPreset) {
      const qaPadding = {
        top: isRouteDetailMode
          ? Math.max(insets.top + 168, 184)
          : Math.max(insets.top + 88, 112),
        bottom:
          isRouteDetailMode && !isBottomSheetHidden
            ? Math.max(
                transitMapBottomOcclusionHeight + ROUTE_PATH_BOTTOM_HEADROOM,
                208,
              )
            : 72,
        left: 48,
        right: 48,
      };
      const qaOverviewBounds =
        qaCameraPreset.id === 'routeOverview'
          ? getCoordinateBounds(qaCameraPreset.boundsCoordinates)
          : undefined;
      // 전체 경로 QA도 제품의 첫 진입 카메라와 같은 Web Mercator bounds 계산을 사용한다.
      // 고정 zoom은 근거리 경로를 점처럼 만들고 장거리 경로를 자르는 잘못된 비교 결과를 만든다.
      const qaOverviewCamera = qaOverviewBounds
        ? getPaddedBoundsCamera(
            {
              minLat: qaOverviewBounds.minLat,
              maxLat: qaOverviewBounds.maxLat,
              minLng: qaOverviewBounds.minLng,
              maxLng: qaOverviewBounds.maxLng,
            },
            {
              width: windowWidth,
              height: windowHeight,
              padding: qaPadding,
            },
            {
              minZoom: 6,
              maxZoom: 16,
              minimumSpanMeters: 420,
              boundsPaddingFactor: 1.1,
            },
          )
        : undefined;
      const qaZoom = qaOverviewCamera?.zoom ?? qaCameraPreset.zoom;
      const shouldKeepDetailPresetCenter =
        qaZoom >= 16 || qaCameraPreset.id === 'walkTransferZoom17';
      const qaCenter = qaOverviewCamera
        ? {
            latitude: qaOverviewCamera.latitude,
            longitude: qaOverviewCamera.longitude,
          }
        : shouldKeepDetailPresetCenter
        ? qaCameraPreset.center
        : getPaddedCameraCenterForFixedZoom(
            qaCameraPreset.boundsCoordinates,
            qaPadding,
            { width: windowWidth, height: windowHeight },
            qaZoom,
          ) ?? qaCameraPreset.center;
      const focusKey = [
        'qa-preset-v3',
        qaCameraPreset.id,
        selectedAlternativeId ?? 'none',
        qaCenter.latitude.toFixed(5),
        qaCenter.longitude.toFixed(5),
        qaZoom.toFixed(2),
        Math.round(transitMapBottomOcclusionHeight).toString(),
      ].join(':');
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      cameraQaStateRef.current = {
        requestedFocusZoom: qaZoom,
        cameraMode: 'SEGMENT_FOCUS_QA',
        autoFitSuppressed: true,
        center: qaCenter,
        reason: 'QA_PRESET',
        presetId: qaCameraPreset.id,
        appliedAtMs: Date.now(),
      };
      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[camera-qa] applying preset:', {
          presetId: qaCameraPreset.id,
          requestedFocusZoom: qaZoom,
          cameraMode: 'SEGMENT_FOCUS_QA',
          autoFitSuppressed: true,
          center: qaCenter,
          rawCenter: qaCameraPreset.center,
          padding: qaPadding,
          boundsPointCount: qaCameraPreset.boundsCoordinates?.length ?? 0,
          dynamicOverviewFit: !!qaOverviewCamera,
          reason: 'QA_PRESET',
          description: qaCameraPreset.description,
        });
      }
      map.resizeMap('QA_PRESET_BEFORE_CAMERA');
      runCameraActionAfterDirectionPrewarm(focusKey, qaCenter, qaZoom, () =>
        map.animateCameraTo({
          latitude: qaCenter.latitude,
          longitude: qaCenter.longitude,
          zoom: qaZoom,
          duration: 450,
          easing: 'Fly',
        }),
      );
      setTimeout(() => {
        mapRef.current?.resizeMap('QA_PRESET_AFTER_CAMERA');
      }, 620);
      return;
    }

    if (
      forcedFocusTarget === 'startRide' &&
      travelMode === 'TRANSIT' &&
      Array.isArray(selectedAlternative?.transitLegs) &&
      selectedAlternative.transitLegs.length > 0
    ) {
      const focusCoord = getTransitRouteStartFocusCoord(
        selectedAlternative.transitLegs,
      );
      if (focusCoord) {
        const focusZoom = forcedFocusZoom ?? 17.1;
        const focusKey = `focus-v4:start-ride:${
          selectedAlternativeId ?? 'none'
        }:${focusCoord.lat.toFixed(5)}:${focusCoord.lng.toFixed(
          5,
        )}:${focusZoom.toFixed(2)}`;
        if (lastCameraActionKeyRef.current === focusKey) return;
        lastCameraActionKeyRef.current = focusKey;
        const shiftedCenter = getSheetAwareCameraCenter(focusCoord, focusZoom);
        runCameraActionAfterDirectionPrewarm(
          focusKey,
          { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
          focusZoom,
          () =>
            map.animateCameraTo({
              latitude: shiftedCenter.lat,
              longitude: shiftedCenter.lng,
              zoom: focusZoom,
              duration: 800,
              easing: 'Fly',
            }),
        );
        return;
      }
    }
    if (
      forcedFocusTarget === 'firstSubway' &&
      travelMode === 'TRANSIT' &&
      Array.isArray(selectedAlternative?.transitLegs) &&
      selectedAlternative.transitLegs.length > 0
    ) {
      const focusCoord = getTransitRouteFirstSubwayFocusCoord(
        selectedAlternative.transitLegs,
      );
      if (focusCoord) {
        const focusZoom = forcedFocusZoom ?? 17.1;
        const focusKey = `focus-v4:first-subway:${
          selectedAlternativeId ?? 'none'
        }:${focusCoord.lat.toFixed(5)}:${focusCoord.lng.toFixed(
          5,
        )}:${focusZoom.toFixed(2)}`;
        if (lastCameraActionKeyRef.current === focusKey) return;
        lastCameraActionKeyRef.current = focusKey;
        const shiftedCenter = getSheetAwareCameraCenter(focusCoord, focusZoom);
        runCameraActionAfterDirectionPrewarm(
          focusKey,
          { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
          focusZoom,
          () =>
            map.animateCameraTo({
              latitude: shiftedCenter.lat,
              longitude: shiftedCenter.lng,
              zoom: focusZoom,
              duration: 800,
              easing: 'Fly',
            }),
        );
        return;
      }
    }
    if (forcedFocusTarget === 'origin' && hasOrigin) {
      const focusZoom = forcedFocusZoom ?? 16.1;
      const focusKey = `focus:origin-forced:${originLat.toFixed(
        5,
      )}:${originLng.toFixed(5)}:${focusZoom.toFixed(2)}`;
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      const shiftedCenter = offsetCoordByMeters(
        { lat: originLat, lng: originLng },
        -70,
        0,
      );
      runCameraActionAfterDirectionPrewarm(
        focusKey,
        { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
        focusZoom,
        () =>
          map.animateCameraTo({
            latitude: shiftedCenter.lat,
            longitude: shiftedCenter.lng,
            zoom: focusZoom,
            duration: 750,
            easing: 'Fly',
          }),
      );
      return;
    }
    if (forcedFocusTarget === 'destination' && hasDest) {
      const focusZoom = forcedFocusZoom ?? 16.1;
      const focusKey = `focus:destination-forced:${destinationLat.toFixed(
        5,
      )}:${destinationLng.toFixed(5)}:${focusZoom.toFixed(2)}`;
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      const shiftedCenter = offsetCoordByMeters(
        { lat: destinationLat, lng: destinationLng },
        -70,
        0,
      );
      runCameraActionAfterDirectionPrewarm(
        focusKey,
        { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
        focusZoom,
        () =>
          map.animateCameraTo({
            latitude: shiftedCenter.lat,
            longitude: shiftedCenter.lng,
            zoom: focusZoom,
            duration: 750,
            easing: 'Fly',
          }),
      );
      return;
    }

    if (hasOrigin && hasDest) {
      cameraQaStateRef.current = {
        cameraMode: 'ROUTE_OVERVIEW',
        autoFitSuppressed: false,
        reason: hasRouteReady ? 'ROUTE_CHANGED' : 'INITIAL_ROUTE_FIT',
      };
      const originPoint = { latitude: originLat, longitude: originLng };
      const destinationPoint = {
        latitude: destinationLat,
        longitude: destinationLng,
      };
      const transitConnectorFitPoints = isTransitDetailMode
        ? [...transitConnectorOverlays, ...transitWalkDetailOverlays].flatMap(
            overlay => overlay.coords,
          )
        : [];
      const routeInfoFitPoints =
        selectedRouteInfo?.steps.flatMap(step => step.coordinates ?? []) ?? [];
      const segmentFitPoints =
        travelMode === 'TRANSIT'
          ? selectedNormalizedRoute?.segments.flatMap(segment =>
              Array.isArray(segment.renderedCoordinates) &&
              segment.renderedCoordinates.length >= 2
                ? segment.renderedCoordinates
                : segment.coordinates,
            ) ?? []
          : [];
      const routePoints = segmentFitPoints.length
        ? [originPoint, ...segmentFitPoints, destinationPoint]
        : pathOverlayCoords?.length
        ? [
            originPoint,
            ...pathOverlayCoords,
            ...transitConnectorFitPoints,
            destinationPoint,
          ]
        : routeInfoFitPoints.length
        ? [
            originPoint,
            ...routeInfoFitPoints,
            ...transitConnectorFitPoints,
            destinationPoint,
          ]
        : [originPoint, destinationPoint];
      const activeSheetOffset =
        bottomSheetSnap === 'expanded'
          ? bottomSheetExpandedOffset
          : bottomSheetSnap === 'middle'
          ? bottomSheetMiddleOffset
          : bottomSheetCollapsedOffset;
      const rawVisibleSheetTopY =
        isRouteDetailMode && !isBottomSheetHidden && bottomPanelHeight > 0
          ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
          : windowHeight;
      const visibleSheetTopY =
        isRouteDetailMode && !isBottomSheetHidden
          ? Math.min(
              rawVisibleSheetTopY,
              windowHeight - transitMapBottomOcclusionHeight,
            )
          : rawVisibleSheetTopY;
      const routeHeaderReserveY = isRouteDetailMode
        ? Math.max(insets.top + 54, 108)
        : Math.max(insets.top + 84, 112);
      const availableRouteMapHeight = Math.max(
        180,
        visibleSheetTopY - routeHeaderReserveY,
      );
      const routeFitPadding = {
        top: isRouteDetailMode
          ? routeHeaderReserveY + ROUTE_ENDPOINT_PIN_TOP_HEADROOM
          : routeHeaderReserveY,
        bottom:
          isRouteDetailMode && !isBottomSheetHidden
            ? Math.max(
                192,
                Math.round(
                  windowHeight - visibleSheetTopY + ROUTE_PATH_BOTTOM_HEADROOM,
                ),
              )
            : 72,
        left: isRouteDetailMode ? 64 : 56,
        right: isRouteDetailMode ? 64 : 56,
      };
      const usableFitWidth = Math.max(
        1,
        windowWidth - routeFitPadding.left - routeFitPadding.right,
      );
      const usableFitHeight = Math.max(
        1,
        windowHeight - routeFitPadding.top - routeFitPadding.bottom,
      );
      const routeRevision = [
        routeRefreshTick,
        travelMode === 'TRANSIT'
          ? requestedTransitDepartureAt.toISOString()
          : 'static',
        selectedAlternative?.minutes ?? 'minutes-unknown',
        selectedAlternative?.distanceMeters ?? 'distance-unknown',
      ].join(':');
      const fitKey = getRouteOverviewFitKey({
        routeId: selectedAlternativeId,
        routeRevision,
        routeMode: isRouteDetailMode ? 'detail' : 'edit',
        travelMode,
        origin: originPoint,
        destination: destinationPoint,
        sheetSnap: bottomSheetSnap,
        sheetHidden: isBottomSheetHidden,
        bottomPanelHeight,
        animatedSheetOffset: activeSheetOffset,
        visibleSheetTopY,
        padding: routeFitPadding,
      });
      if (lastCameraActionKeyRef.current === fitKey) return;
      lastCameraActionKeyRef.current = fitKey;

      let minLat = Number.POSITIVE_INFINITY;
      let maxLat = Number.NEGATIVE_INFINITY;
      let minLng = Number.POSITIVE_INFINITY;
      let maxLng = Number.NEGATIVE_INFINITY;

      routePoints.forEach(point => {
        minLat = Math.min(minLat, point.latitude);
        maxLat = Math.max(maxLat, point.latitude);
        minLng = Math.min(minLng, point.longitude);
        maxLng = Math.max(maxLng, point.longitude);
      });

      const rawLatDelta = Math.max(0, maxLat - minLat);
      const rawLngDelta = Math.max(0, maxLng - minLng);
      const routeDistanceKm = haversineDistanceKm(
        { latitude: originLat, longitude: originLng },
        { latitude: destinationLat, longitude: destinationLng },
      );
      const minSpanMeters = isBottomSheetCollapsed
        ? routeDistanceKm < 2
          ? 520
          : routeDistanceKm < 10
          ? 680
          : 880
        : routeDistanceKm < 2
        ? 420
        : routeDistanceKm < 10
        ? 560
        : 760;
      const boundsPaddingFactor =
        routeDistanceKm < 2 ? 1.12 : routeDistanceKm < 12 ? 1.1 : 1.08;
      const overviewCamera = getPaddedBoundsCamera(
        { minLat, maxLat, minLng, maxLng },
        {
          width: windowWidth,
          height: windowHeight,
          padding: routeFitPadding,
        },
        {
          minZoom: 6,
          maxZoom: isRouteDetailMode ? 16 : 18,
          minimumSpanMeters: minSpanMeters,
          boundsPaddingFactor,
        },
      );
      if (!overviewCamera) return;

      if (typeof __DEV__ === 'boolean' && __DEV__) {
        console.log('[camera-fit] route overview padding:', {
          selectedRouteId: selectedNormalizedRoute?.id,
          cameraMode: 'ROUTE_OVERVIEW',
          reason: hasRouteReady ? 'ROUTE_CHANGED' : 'INITIAL_ROUTE_FIT',
          routePointCount: routePoints.length,
          padding: routeFitPadding,
          visibleSheetTopY: Math.round(visibleSheetTopY),
          routeHeaderReserveY: Math.round(routeHeaderReserveY),
          availableRouteMapHeight: Math.round(availableRouteMapHeight),
          usableFitWidth: Math.round(usableFitWidth),
          usableFitHeight: Math.round(usableFitHeight),
          rawLatDelta,
          rawLngDelta,
          targetCamera: overviewCamera,
        });
      }

      runCameraActionAfterDirectionPrewarm(
        fitKey,
        {
          latitude: overviewCamera.latitude,
          longitude: overviewCamera.longitude,
        },
        overviewCamera.zoom,
        () =>
          map.fitToCoordinates(routePoints, { edgePadding: routeFitPadding }),
      );
    } else if (activeTarget === 'destination' && hasDest) {
      const focusKey = `focus:destination:${destinationLat.toFixed(
        5,
      )}:${destinationLng.toFixed(5)}`;
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      runCameraActionAfterDirectionPrewarm(
        focusKey,
        { latitude: destinationLat, longitude: destinationLng },
        14,
        () =>
          map.animateCameraTo({
            latitude: destinationLat,
            longitude: destinationLng,
            zoom: 14,
            duration: 700,
            easing: 'Fly',
          }),
      );
    } else if (activeTarget === 'origin' && hasOrigin) {
      const focusKey = `focus:origin:${originLat.toFixed(
        5,
      )}:${originLng.toFixed(5)}`;
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      runCameraActionAfterDirectionPrewarm(
        focusKey,
        { latitude: originLat, longitude: originLng },
        14,
        () =>
          map.animateCameraTo({
            latitude: originLat,
            longitude: originLng,
            zoom: 14,
            duration: 700,
            easing: 'Fly',
          }),
      );
    } else if (hasOrigin) {
      const focusKey = `focus:origin-only:${originLat.toFixed(
        5,
      )}:${originLng.toFixed(5)}`;
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      runCameraActionAfterDirectionPrewarm(
        focusKey,
        { latitude: originLat, longitude: originLng },
        14,
        () =>
          map.animateCameraTo({
            latitude: originLat,
            longitude: originLng,
            zoom: 14,
            duration: 700,
            easing: 'Fly',
          }),
      );
    } else if (hasDest) {
      const focusKey = `focus:destination-only:${destinationLat.toFixed(
        5,
      )}:${destinationLng.toFixed(5)}`;
      if (lastCameraActionKeyRef.current === focusKey) return;
      lastCameraActionKeyRef.current = focusKey;
      runCameraActionAfterDirectionPrewarm(
        focusKey,
        { latitude: destinationLat, longitude: destinationLng },
        14,
        () =>
          map.animateCameraTo({
            latitude: destinationLat,
            longitude: destinationLng,
            zoom: 14,
            duration: 700,
            easing: 'Fly',
          }),
      );
    } else {
      lastCameraActionKeyRef.current = '';
    }
  }, [
    activeTarget,
    cameraQaStateRef,
    originLat,
    originLng,
    destinationLat,
    destinationLng,
    forcedFocusTarget,
    forcedFocusZoom,
    pathOverlayCoords,
    selectedAlternative,
    selectedAlternativeId,
    selectedNormalizedRoute,
    selectedRouteInfo,
    qaCameraPreset,
    isQaCameraLocked,
    travelMode,
    isBottomSheetCollapsed,
    isBottomSheetHidden,
    isRouteDetailMode,
    isTransitDetailMode,
    lastCameraActionKeyRef,
    mapRef,
    bottomSheetSnap,
    bottomPanelHeight,
    bottomSheetCollapsedOffset,
    bottomSheetMiddleOffset,
    bottomSheetExpandedOffset,
    transitConnectorOverlays,
    transitWalkDetailOverlays,
    insets.top,
    windowWidth,
    windowHeight,
    isMapInitialized,
    etaLoading,
    hasBottomSheetMeasured,
    hasRouteReady,
    routeRefreshTick,
    requestedTransitDepartureAt,
    transitMapBottomOcclusionHeight,
    visibleBottomSheetHeight,
    runCameraActionAfterDirectionPrewarm,
  ]);

}

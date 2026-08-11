import { useEffect, useMemo, useRef } from 'react';

import type { RouteAlternativeOption } from '../../map/routingService';
import type {
  TmapCameraState,
  TmapLatLng,
  TmapPathOverlay,
} from '../../map/TmapMapView';
import { TRANSIT_ROUTE_ZOOM_STYLE } from '../../map/transitRoutePresentation';
import {
  ENABLE_NATIVE_ROUTE_DIRECTION,
  getNativeDirectionCarrierWidth,
  getNativeDirectionOpacity,
  getRenderableStopCoordinate,
  getSegmentColor,
  getTransitCasingExtraWidth,
  getTransitCasingWidth,
  getTransitMainWidth,
  getTransitMapZoomTier,
  getWalkCasingWidth,
  getWalkWidth,
  isTransitRideSegmentMode,
  ROUTE_LINE_STYLE,
  ROUTE_WALK_CASING_OPACITY,
  shouldRenderNativeTransitDirection,
  shouldUseNativeTransitDirection,
  type NormalizedRoute,
} from './routeMapTypesAndStyle';
import {
  getSegmentLengthMeters,
  getSegmentRenderableCoordinates,
  getTransitPathOrderScores,
  validateSegmentPathOrder,
} from './routeMapCoordinate';

const TRANSIT_NATIVE_DIRECTION_MIN_ZOOM =
  TRANSIT_ROUTE_ZOOM_STYLE.directionMinZoom;

type Options = {
  mapCamera: TmapCameraState;
  mapPathOverlays: TmapPathOverlay[];
  mapZoom: number;
  pathOverlayCoords?: TmapLatLng[];
  routeAlternatives: RouteAlternativeOption[];
  selectedNormalizedRoute?: NormalizedRoute;
};

/**
 * 개발 환경에서 선택 경로의 좌표·구간 순서·정류장 anchor·방향 화살표 상태를 기록한다.
 * 동일한 진단 값은 서명으로 걸러 지도 이동 중 중복 로그가 쌓이지 않게 한다.
 */
export function useRoutePlannerRouteDiagnostics({
  mapCamera,
  mapPathOverlays,
  mapZoom,
  pathOverlayCoords,
  routeAlternatives,
  selectedNormalizedRoute,
}: Options) {
  const routeCoordinatesForLog = useMemo(() => {
    if (selectedNormalizedRoute?.segments.length) {
      return selectedNormalizedRoute.segments.flatMap(
        segment => segment.coordinates,
      );
    }
    const primaryOverlay = mapPathOverlays.find(
      overlay =>
        overlay.id.endsWith('-selected') ||
        overlay.id === 'route-selected-fallback',
    );
    return primaryOverlay?.coords ?? pathOverlayCoords ?? [];
  }, [mapPathOverlays, pathOverlayCoords, selectedNormalizedRoute]);
  const lastRouteLogSignatureRef = useRef('');
  const lastRouteSegmentLogSignatureRef = useRef('');
  const lastRouteArrowLogSignatureRef = useRef('');
  const lastRoutePathOrderLogSignatureRef = useRef('');
  const lastRouteStopAnchorLogSignatureRef = useRef('');

  const selectedRouteArrowStats = useMemo(() => {
    if (!selectedNormalizedRoute?.segments?.length) return [];
    const nativeDirectionPolylineIds = new Set(
      mapPathOverlays
        .filter(overlay => overlay.nativeDirection === true)
        .map(overlay => overlay.id),
    );
    return selectedNormalizedRoute.segments.map(segment => ({
      id: segment.id,
      mode: segment.mode,
      lineName: segment.lineName,
      busType: segment.busType,
      routeColor: segment.routeColor,
      displayColor: segment.displayColor,
      geometrySource: segment.geometrySource,
      geometryQuality: segment.geometryQuality,
      isManualSamplePath: segment.isManualSamplePath === true,
      boardSnapDistanceMeters:
        typeof segment.boardAnchor?.snapDistanceMeters === 'number'
          ? Math.round(segment.boardAnchor.snapDistanceMeters)
          : undefined,
      boardAnchorSource: segment.boardAnchor?.anchorSource,
      alightSnapDistanceMeters:
        typeof segment.alightAnchor?.snapDistanceMeters === 'number'
          ? Math.round(segment.alightAnchor.snapDistanceMeters)
          : undefined,
      alightAnchorSource: segment.alightAnchor?.anchorSource,
      pointCount: segment.coordinates?.length ?? 0,
      rawPointCount: segment.rawPointCount,
      renderPointCount:
        segment.renderPointCount ??
        segment.renderedCoordinates?.length ??
        segment.coordinates?.length ??
        0,
      renderedPointCount:
        segment.renderPointCount ??
        segment.renderedCoordinates?.length ??
        segment.coordinates?.length ??
        0,
      lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
      color: getSegmentColor(segment),
      nativeDirectionEnabled: shouldRenderNativeTransitDirection(
        segment,
        mapZoom,
      ),
      screenOverlayArrowFallbackEnabled: false,
      directionRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
        ? 'tmap-native-polyline-direction'
        : 'none',
      pathOrderValid: validateSegmentPathOrder(segment),
      showArrows: shouldRenderNativeTransitDirection(segment, mapZoom),
      nativeDirectionPolylineCount: nativeDirectionPolylineIds.has(segment.id)
        ? 1
        : 0,
      mainWidth:
        segment.mode === 'BUS' || segment.mode === 'SUBWAY'
          ? getTransitMainWidth(mapZoom)
          : getWalkWidth(mapZoom),
      casingWidth:
        segment.mode === 'BUS' || segment.mode === 'SUBWAY'
          ? getTransitCasingWidth(mapZoom)
          : undefined,
    }));
  }, [mapPathOverlays, mapZoom, selectedNormalizedRoute]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    const routeCoordinates = routeCoordinatesForLog;
    const currentZoom = mapZoom;
    const firstCoordinate = routeCoordinates[0];
    const lastCoordinate = routeCoordinates[routeCoordinates.length - 1];
    const routeLogSignature = JSON.stringify({
      length: routeCoordinates.length,
      first: firstCoordinate,
      last: lastCoordinate,
      zoom: currentZoom,
    });
    if (lastRouteLogSignatureRef.current === routeLogSignature) return;
    lastRouteLogSignatureRef.current = routeLogSignature;

    console.log('[route] coordinates length:', routeCoordinates.length);
    console.log('[route] first coordinate:', firstCoordinate);
    console.log('[route] last coordinate:', lastCoordinate);
    console.log('[route] zoom:', currentZoom);
  }, [mapZoom, routeCoordinatesForLog]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
    const table =
      selectedNormalizedRoute?.segments?.map(segment => ({
        id: segment.id,
        mode: segment.mode,
        lineName: segment.lineName,
        busType: segment.busType,
        routeColor: segment.routeColor,
        displayColor: segment.displayColor,
        geometrySource: segment.geometrySource,
        geometryQuality: segment.geometryQuality,
        isManualSamplePath: segment.isManualSamplePath === true,
        rawCoordinateCount:
          segment.rawCoordinates?.length ?? segment.rawPointCount,
        boardSnapDistanceMeters:
          typeof segment.boardAnchor?.snapDistanceMeters === 'number'
            ? Math.round(segment.boardAnchor.snapDistanceMeters)
            : undefined,
        boardAnchorSource: segment.boardAnchor?.anchorSource,
        boardRawCoordinate: segment.boardAnchor?.rawCoordinate,
        boardRenderCoordinate: segment.boardAnchor?.renderCoordinate,
        alightSnapDistanceMeters:
          typeof segment.alightAnchor?.snapDistanceMeters === 'number'
            ? Math.round(segment.alightAnchor.snapDistanceMeters)
            : undefined,
        alightAnchorSource: segment.alightAnchor?.anchorSource,
        alightRawCoordinate: segment.alightAnchor?.rawCoordinate,
        alightRenderCoordinate: segment.alightAnchor?.renderCoordinate,
        startAnchorType: segment.startAnchor?.type,
        startAnchorSource: segment.startAnchor?.source,
        startSnapDistanceMeters:
          typeof segment.startAnchor?.snapDistanceMeters === 'number'
            ? Math.round(segment.startAnchor.snapDistanceMeters)
            : undefined,
        endAnchorType: segment.endAnchor?.type,
        endAnchorSource: segment.endAnchor?.source,
        endSnapDistanceMeters:
          typeof segment.endAnchor?.snapDistanceMeters === 'number'
            ? Math.round(segment.endAnchor.snapDistanceMeters)
            : undefined,
        pointCount: segment.coordinates?.length ?? 0,
        rawPointCount: segment.rawPointCount,
        renderPointCount:
          segment.renderPointCount ??
          segment.renderedCoordinates?.length ??
          segment.coordinates.length,
        renderedPointCount:
          segment.renderPointCount ??
          segment.renderedCoordinates?.length ??
          segment.coordinates.length,
        lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
        color: getSegmentColor(segment),
        nativeDirectionEnabled: shouldUseNativeTransitDirection(segment),
        screenOverlayArrowFallbackEnabled: false,
        directionRenderer: shouldUseNativeTransitDirection(segment)
          ? 'tmap-native-polyline-direction'
          : 'none',
        pathOrderValid: validateSegmentPathOrder(segment),
        showArrows: shouldUseNativeTransitDirection(segment),
        from: segment.fromName,
        to: segment.toName,
      })) ?? [];
    const busColorRows =
      selectedNormalizedRoute?.segments
        ?.filter(segment => segment.mode === 'BUS')
        .map(segment => ({
          lineName: segment.lineName,
          routeColor: segment.routeColor,
          displayColor: segment.displayColor,
          busType: segment.busType,
        })) ?? [];
    const routeSegmentLogSignature = JSON.stringify({
      selectedRouteId: selectedNormalizedRoute?.id,
      candidates: routeAlternatives.length,
      segments: table,
      busColorRows,
    });
    if (lastRouteSegmentLogSignatureRef.current === routeSegmentLogSignature)
      return;
    lastRouteSegmentLogSignatureRef.current = routeSegmentLogSignature;

    console.log('[route-qa] selectedRouteId:', selectedNormalizedRoute?.id);
    console.log('[route-qa] route candidates:', routeAlternatives.length);
    console.log(
      '[route-qa] selected segments:',
      selectedNormalizedRoute?.segments?.length,
    );
    console.table(table);
    console.log('[route-qa] selected segment rows:', table);
    if (busColorRows.length > 0) {
      console.log(
        '[route-bus-color] selectedRouteId:',
        selectedNormalizedRoute?.id,
      );
      console.table(busColorRows);
      console.log('[route-bus-color] rows:', busColorRows);
    }
  }, [routeAlternatives.length, selectedNormalizedRoute]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
    const rows =
      selectedNormalizedRoute?.segments
        ?.filter(segment => isTransitRideSegmentMode(segment.mode))
        .map(segment => {
          const coordinates = getSegmentRenderableCoordinates(segment);
          const scores = getTransitPathOrderScores(
            coordinates,
            segment.boardAnchor,
            segment.alightAnchor,
          );
          return {
            id: segment.id,
            mode: segment.mode,
            lineName: segment.lineName,
            fromName: segment.fromName,
            toName: segment.toName,
            pointCount: coordinates.length,
            first: coordinates[0],
            last: coordinates[coordinates.length - 1],
            boardAnchor: getRenderableStopCoordinate(segment.boardAnchor),
            alightAnchor: getRenderableStopCoordinate(segment.alightAnchor),
            boardSnapDistanceMeters:
              typeof segment.boardAnchor?.snapDistanceMeters === 'number'
                ? Math.round(segment.boardAnchor.snapDistanceMeters)
                : undefined,
            alightSnapDistanceMeters:
              typeof segment.alightAnchor?.snapDistanceMeters === 'number'
                ? Math.round(segment.alightAnchor.snapDistanceMeters)
                : undefined,
            forwardScore: scores ? Math.round(scores.forwardScore) : undefined,
            reverseScore: scores ? Math.round(scores.reverseScore) : undefined,
            pathOrderValid: validateSegmentPathOrder(segment),
            nativeDirectionEnabled: shouldUseNativeTransitDirection(segment),
          };
        }) ?? [];
    const pathOrderSignature = JSON.stringify({
      selectedRouteId: selectedNormalizedRoute?.id,
      rows,
    });
    if (lastRoutePathOrderLogSignatureRef.current === pathOrderSignature)
      return;
    lastRoutePathOrderLogSignatureRef.current = pathOrderSignature;

    console.log(
      '[route-path-order] selectedRouteId:',
      selectedNormalizedRoute?.id,
    );
    console.table(rows);
    console.log('[route-path-order] rows:', rows);
    rows.forEach(row => {
      if (!row.pathOrderValid) {
        console.warn('[route-path-order] invalid path order', row);
      }
    });
  }, [routeAlternatives.length, selectedNormalizedRoute]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
    const rows =
      selectedNormalizedRoute?.segments
        ?.filter(segment => isTransitRideSegmentMode(segment.mode))
        .flatMap(segment =>
          [
            {
              role: 'BOARD' as const,
              stopName: segment.fromName,
              anchor: segment.boardAnchor,
            },
            {
              role: 'ALIGHT' as const,
              stopName: segment.toName,
              anchor: segment.alightAnchor,
            },
          ]
            .filter(item => !!item.anchor)
            .map(item => ({
              segmentId: segment.id,
              mode: segment.mode,
              lineName: segment.lineName,
              stopRole: item.role,
              stopName: item.stopName,
              rawCoordinate: item.anchor?.rawCoordinate,
              renderCoordinate: item.anchor?.renderCoordinate,
              stopCoordinate: item.anchor?.stopCoordinate,
              routeAnchorCoordinate: item.anchor?.routeAnchorCoordinate,
              snapDistanceMeters:
                typeof item.anchor?.snapDistanceMeters === 'number'
                  ? Math.round(item.anchor.snapDistanceMeters)
                  : undefined,
              anchorSource: item.anchor?.anchorSource,
              withinPassThreshold:
                typeof item.anchor?.snapDistanceMeters === 'number'
                  ? item.anchor.snapDistanceMeters <= 30
                  : false,
              warningThreshold:
                typeof item.anchor?.snapDistanceMeters === 'number'
                  ? item.anchor.snapDistanceMeters > 30 &&
                    item.anchor.snapDistanceMeters <= 60
                  : false,
              mismatchWarning:
                typeof item.anchor?.snapDistanceMeters === 'number'
                  ? item.anchor.snapDistanceMeters > 60 &&
                    item.anchor.snapDistanceMeters <= 80
                  : false,
              geometryMismatch:
                typeof item.anchor?.snapDistanceMeters === 'number'
                  ? item.anchor.snapDistanceMeters > 80
                  : item.anchor?.anchorSource === 'UNSNAPPED',
            })),
        ) ?? [];
    const stopAnchorSignature = JSON.stringify({
      selectedRouteId: selectedNormalizedRoute?.id,
      rows,
    });
    if (lastRouteStopAnchorLogSignatureRef.current === stopAnchorSignature)
      return;
    lastRouteStopAnchorLogSignatureRef.current = stopAnchorSignature;

    console.log(
      '[route-stop-anchor] selectedRouteId:',
      selectedNormalizedRoute?.id,
    );
    console.table(rows);
    console.log('[route-stop-anchor] rows:', rows);
    rows.forEach(row => {
      if (row.geometryMismatch) {
        console.warn('[route-stop-anchor] geometry mismatch', row);
      } else if (row.mismatchWarning) {
        console.warn('[route-stop-anchor] geometry mismatch warning', row);
      } else if (row.warningThreshold) {
        console.warn('[route-stop-anchor] snap warning', row);
      }
    });
  }, [routeAlternatives.length, selectedNormalizedRoute]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
    const arrowLogSignature = JSON.stringify({
      zoom: Math.round(mapZoom * 10) / 10,
      selectedRouteId: selectedNormalizedRoute?.id,
      rows: selectedRouteArrowStats,
    });
    if (lastRouteArrowLogSignatureRef.current === arrowLogSignature) return;
    lastRouteArrowLogSignatureRef.current = arrowLogSignature;

    console.log('[route-qa] zoom:', mapZoom);
    console.log('[route-qa] zoomBucket:', getTransitMapZoomTier(mapZoom));
    console.log('[route-arrows] selectedRouteId:', selectedNormalizedRoute?.id);
    console.table(selectedRouteArrowStats);
    console.log('[route-arrows] rows:', selectedRouteArrowStats);
    const subwayRows = selectedRouteArrowStats.filter(
      row => row.mode === 'SUBWAY',
    );
    if (subwayRows.length > 0) {
      console.table(subwayRows);
      console.log('[route-subway-qa] rows:', subwayRows);
    }
    const busRows = selectedRouteArrowStats.filter(row => row.mode === 'BUS');
    if (busRows.length > 0) {
      console.table(busRows);
      console.log('[route-bus-qa] rows:', busRows);
    }
    console.log('[route-style]', {
      transitMainWidth: getTransitMainWidth(mapZoom),
      transitCasingWidth: getTransitCasingWidth(mapZoom),
      transitCasingExtraWidth: getTransitCasingExtraWidth(mapZoom),
      transitCasingOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
      walkColor: ROUTE_LINE_STYLE.walk.color,
      walkWidth: getWalkWidth(mapZoom),
      walkCasingWidth: getWalkCasingWidth(mapZoom),
      walkCasingOpacity: ROUTE_WALK_CASING_OPACITY,
      walkDashPattern: ROUTE_LINE_STYLE.walk.dashPattern,
      nativeDirectionEnabled:
        ENABLE_NATIVE_ROUTE_DIRECTION &&
        mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
      nativeDirectionMinZoom: TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
      screenOverlayArrowFallbackEnabled: false,
      directionRenderer:
        ENABLE_NATIVE_ROUTE_DIRECTION &&
        mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM
          ? 'tmap-native-polyline-direction'
          : 'none',
      nativeDirectionPolylineWidth: getNativeDirectionCarrierWidth(mapZoom),
      nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
      nativeDirectionViewportCenter: mapCamera,
      nativeDirectionOverlayCount: selectedRouteArrowStats.reduce(
        (total, row) => total + row.nativeDirectionPolylineCount,
        0,
      ),
    });
  }, [
    mapCamera,
    mapZoom,
    routeAlternatives.length,
    selectedNormalizedRoute,
    selectedRouteArrowStats,
  ]);

}

import { useEffect, useRef } from 'react';

import type { RouteAlternativeOption } from '../../map/routingService';
import type { TmapPathOverlay } from '../../map/TmapMapView';
import type { RouteInfo } from '../routeInfo';
import { getRouteStepColor } from '../routeInfo';
import type { TransitRouteProgressSegment } from '../transitRouteProgress';
import { TRANSIT_WALK_RIDE_SNAP_MAX_METERS } from './routeMapAnchors';
import {
  getSegmentLengthMeters,
  getSegmentRenderableCoordinates,
} from './routeMapCoordinate';
import {
  getNativeDirectionOpacity,
  getSegmentColor,
  getTransitCasingExtraWidth,
  getTransitCasingWidth,
  getTransitMainWidth,
  getWalkCasingWidth,
  getWalkWidth,
  isWalkTransferSegment,
  shouldRenderNativeTransitDirection,
  shouldRenderRouteSegmentGeometry,
  type NormalizedRoute,
} from './routeMapTypesAndStyle';
import { TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS } from './routeTransitWalkGeometry';
import type { RouteQaLayerMode } from './params';

type Options = {
  mapZoom: number;
  qaLayerMode: RouteQaLayerMode;
  routeAlternatives: RouteAlternativeOption[];
  selectedNormalizedRoute?: NormalizedRoute;
  selectedRouteInfo?: RouteInfo;
  selectedTransitProgressSegments: TransitRouteProgressSegment[];
  transitConnectorOverlays: TmapPathOverlay[];
  transitWalkDetailOverlays: TmapPathOverlay[];
};

/**
 * 개발 환경에서 경로 형상 품질·렌더러·QA 레이어·상세 시트 동기화 상태를 기록한다.
 * 화면 로직과 진단 로직을 분리하면서도 기존 QA 로그 형식은 그대로 유지한다.
 */
export function useRoutePlannerGeometryDiagnostics({
  mapZoom,
  qaLayerMode,
  routeAlternatives,
  selectedNormalizedRoute,
  selectedRouteInfo,
  selectedTransitProgressSegments,
  transitConnectorOverlays,
  transitWalkDetailOverlays,
}: Options) {
  const lastRouteGeometryQualityLogSignatureRef = useRef('');
  const lastRouteRendererLogSignatureRef = useRef('');
  const lastRouteQaLayerLogSignatureRef = useRef('');
  const lastWalkRenderPartsLogSignatureRef = useRef('');
  const lastRouteSheetSyncLogSignatureRef = useRef('');

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
    const allRows =
      selectedNormalizedRoute?.segments?.map(segment => ({
        id: segment.id,
        mode: segment.mode,
        lineName: segment.lineName,
        routeColor: segment.routeColor,
        displayColor: segment.displayColor,
        geometrySource: segment.geometrySource,
        geometryQuality: segment.geometryQuality,
        isManualSamplePath: segment.isManualSamplePath === true,
        rawCoordinateCount:
          segment.rawCoordinates?.length ?? segment.rawPointCount,
        pointCount: segment.coordinates?.length ?? 0,
        renderedPointCount:
          segment.renderedCoordinates?.length ??
          segment.coordinates?.length ??
          0,
        lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
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
        renderedInMap: shouldRenderRouteSegmentGeometry(segment),
      })) ?? [];
    const walkRows =
      selectedNormalizedRoute?.segments
        ?.filter(
          segment => segment.mode === 'WALK' || segment.mode === 'TRANSFER',
        )
        .map(segment => ({
          id: segment.id,
          mode: segment.mode,
          geometrySource: segment.geometrySource,
          geometryQuality: segment.geometryQuality,
          rawCoordinateCount:
            segment.rawCoordinates?.length ?? segment.rawPointCount,
          pointCount: segment.coordinates?.length ?? 0,
          renderedPointCount:
            segment.renderedCoordinates?.length ??
            segment.coordinates?.length ??
            0,
          lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
          isDirectFallback: segment.geometrySource === 'START_END_ONLY',
          startAnchorSource: segment.startAnchor?.source,
          startSnapDistanceMeters:
            typeof segment.startAnchor?.snapDistanceMeters === 'number'
              ? Math.round(segment.startAnchor.snapDistanceMeters)
              : undefined,
          endAnchorSource: segment.endAnchor?.source,
          endSnapDistanceMeters:
            typeof segment.endAnchor?.snapDistanceMeters === 'number'
              ? Math.round(segment.endAnchor.snapDistanceMeters)
              : undefined,
          snapEndpointMeters: TRANSIT_WALK_RIDE_SNAP_MAX_METERS,
          maxDirectConnectorMeters: TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS,
          renderedInMap: shouldRenderRouteSegmentGeometry(segment),
        })) ?? [];
    const busRows =
      selectedNormalizedRoute?.segments
        ?.filter(segment => segment.mode === 'BUS')
        .map(segment => ({
          id: segment.id,
          lineName: segment.lineName,
          busType: segment.busType,
          routeColor: segment.routeColor,
          displayColor: segment.displayColor,
          geometrySource: segment.geometrySource,
          geometryQuality: segment.geometryQuality,
          isManualSamplePath: segment.isManualSamplePath === true,
          rawCoordinateCount:
            segment.rawCoordinates?.length ?? segment.rawPointCount,
          pointCount: segment.coordinates?.length ?? 0,
          renderedPointCount:
            segment.renderedCoordinates?.length ??
            segment.coordinates?.length ??
            0,
          lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
          color: getSegmentColor(segment),
          nativeDirectionEnabled: shouldRenderNativeTransitDirection(
            segment,
            mapZoom,
          ),
          directionRenderer: shouldRenderNativeTransitDirection(
            segment,
            mapZoom,
          )
            ? 'tmap-native-polyline-direction'
            : 'none',
          showArrows: shouldRenderNativeTransitDirection(segment, mapZoom),
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
          renderedInMap: shouldRenderRouteSegmentGeometry(segment),
        })) ?? [];
    const geometryLogSignature = JSON.stringify({
      selectedRouteId: selectedNormalizedRoute?.id,
      zoom: Math.round(mapZoom * 10) / 10,
      allRows,
      walkRows,
      busRows,
    });
    if (
      lastRouteGeometryQualityLogSignatureRef.current === geometryLogSignature
    )
      return;
    lastRouteGeometryQualityLogSignatureRef.current = geometryLogSignature;

    console.log(
      '[route-geometry-quality] selectedRouteId:',
      selectedNormalizedRoute?.id,
    );
    if (allRows.length > 0) {
      console.table(allRows);
      console.log('[route-geometry-source] rows:', allRows);
    }
    if (walkRows.length > 0) {
      console.table(walkRows);
      console.log('[route-walk-geometry] rows:', walkRows);
    }
    if (busRows.length > 0) {
      console.table(busRows);
      console.log('[route-bus-geometry] rows:', busRows);
    }
    busRows.forEach(row => {
      if (row.isManualSamplePath || row.geometryQuality === 'MANUAL_SAMPLE') {
        console.warn(
          '[route-bus-geometry] manual sample path is renderer-only',
          row,
        );
      }
      if (
        row.geometryQuality === 'PASS_STOP_ONLY' ||
        row.geometrySource === 'PASS_STOP_LIST'
      ) {
        console.warn(
          '[route-bus-geometry] pass-stop-only geometry is incomplete',
          row,
        );
      }
      if (
        (typeof row.boardSnapDistanceMeters === 'number' &&
          row.boardSnapDistanceMeters > 30) ||
        (typeof row.alightSnapDistanceMeters === 'number' &&
          row.alightSnapDistanceMeters > 30)
      ) {
        console.warn('[route-bus-geometry] stop anchor snap warning', row);
      }
    });
    walkRows.forEach(row => {
      if (row.isDirectFallback && row.lengthMeters > 40) {
        console.warn(
          '[route-walk-geometry] long direct fallback hidden/incomplete',
          row,
        );
      }
    });
  }, [mapZoom, routeAlternatives.length, selectedNormalizedRoute]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
    const actualZoom = Math.round(mapZoom * 10) / 10;
    const rows =
      selectedNormalizedRoute?.segments.map(segment => ({
        segmentId: segment.id,
        mode: segment.mode,
        lineName: segment.lineName,
        routeColor: segment.routeColor,
        displayColor: segment.displayColor,
        geometrySource: segment.geometrySource,
        geometryQuality: segment.geometryQuality,
        isManualSamplePath: segment.isManualSamplePath === true,
        pointCount: segment.coordinates?.length ?? 0,
        renderedPointCount:
          segment.renderPointCount ??
          segment.renderedCoordinates?.length ??
          segment.coordinates.length,
        mainRenderer: 'geo-map-overlay',
        casingRenderer:
          segment.mode === 'BUS' ||
          segment.mode === 'SUBWAY' ||
          isWalkTransferSegment(segment)
            ? 'geo-map-overlay'
            : 'none',
        directionRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
          ? 'tmap-native-polyline-direction'
          : 'none',
        arrowRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
          ? 'tmap-native-polyline-direction'
          : 'none',
        nativeDirectionEnabled: shouldRenderNativeTransitDirection(
          segment,
          mapZoom,
        ),
        screenOverlayArrowFallbackEnabled: false,
        isCameraMoving: 'webview-controlled',
        actualZoom,
        projectionVersion: 'webview-route-overlay-state',
        lineWidth:
          segment.mode === 'BUS' || segment.mode === 'SUBWAY'
            ? getTransitMainWidth(mapZoom)
            : getWalkWidth(mapZoom),
        transitMainWidth:
          segment.mode === 'BUS' || segment.mode === 'SUBWAY'
            ? getTransitMainWidth(mapZoom)
            : undefined,
        casingWidth:
          segment.mode === 'BUS' || segment.mode === 'SUBWAY'
            ? getTransitCasingWidth(mapZoom)
            : isWalkTransferSegment(segment)
            ? getWalkCasingWidth(mapZoom)
            : undefined,
        transitCasingExtraWidth:
          segment.mode === 'BUS' || segment.mode === 'SUBWAY'
            ? getTransitCasingExtraWidth(mapZoom)
            : undefined,
        walkWidth:
          segment.mode === 'WALK' || segment.mode === 'TRANSFER'
            ? getWalkWidth(mapZoom)
            : undefined,
        arrowVisibleWhileMoving: shouldRenderNativeTransitDirection(
          segment,
          mapZoom,
        ),
        directionOpacity: shouldRenderNativeTransitDirection(segment, mapZoom)
          ? getNativeDirectionOpacity(mapZoom)
          : undefined,
      })) ?? [];
    const rendererLogSignature = JSON.stringify({
      selectedRouteId: selectedNormalizedRoute?.id,
      actualZoom,
      rows,
    });
    if (lastRouteRendererLogSignatureRef.current === rendererLogSignature)
      return;
    lastRouteRendererLogSignatureRef.current = rendererLogSignature;

    console.table(rows);
    console.log('[route-renderer] rows:', rows);
  }, [mapZoom, routeAlternatives.length, selectedNormalizedRoute]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (qaLayerMode === 'ALL') return;
    const rows = [
      {
        area: 'Selected route screen',
        qaLayerMode,
        baseLayerIssue: qaLayerMode === 'BASE_ONLY',
        appOverlayIssue: qaLayerMode !== 'BASE_ONLY',
        connectorIssue: qaLayerMode === 'CONNECTOR_DEBUG',
        anchorIssue: qaLayerMode === 'ANCHOR_DEBUG',
        routeVisibilityIssue: qaLayerMode === 'ROUTE_VISIBILITY_DEBUG',
        note:
          qaLayerMode === 'BASE_ONLY'
            ? 'App route overlays and route markers are intentionally hidden.'
            : qaLayerMode === 'APP_ROUTE_ONLY' ||
              qaLayerMode === 'APP_ROUTE_DIM_BASE' ||
              qaLayerMode === 'ROUTE_VISIBILITY_DEBUG'
            ? 'Tmap base is dimmed so app route overlay can be inspected separately.'
            : 'Debug overlays are enabled only for QA.',
      },
    ];
    const signature = JSON.stringify(rows);
    if (lastRouteQaLayerLogSignatureRef.current === signature) return;
    lastRouteQaLayerLogSignatureRef.current = signature;
    console.log('[route-qa-layer-mode]', qaLayerMode);
    console.table(rows);
  }, [qaLayerMode]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (qaLayerMode !== 'CONNECTOR_DEBUG') return;
    const segmentRows =
      selectedNormalizedRoute?.segments
        ?.filter(
          segment => segment.mode === 'WALK' || segment.mode === 'TRANSFER',
        )
        .map(segment => {
          const lengthMeters = Math.round(
            getSegmentLengthMeters(getSegmentRenderableCoordinates(segment)),
          );
          const source =
            segment.geometrySource === 'WALK_STEPS_LINESTRING'
              ? 'WALK_STEPS_LINESTRING'
              : segment.geometryQuality === 'ANCHOR_ADJUSTED_GEOMETRY'
              ? 'ANCHOR_SHORT_CONNECTOR'
              : segment.geometrySource === 'START_END_ONLY' ||
                segment.geometryQuality === 'START_END_ONLY'
              ? 'HIDDEN_TOO_LONG'
              : segment.geometrySource ?? 'UNKNOWN';
          const partType =
            source === 'WALK_STEPS_LINESTRING'
              ? 'STEPS_GEOMETRY'
              : source === 'HIDDEN_TOO_LONG'
              ? 'HIDDEN_CONNECTOR'
              : 'CONNECTOR_OR_ADJUSTED_GEOMETRY';
          return {
            segmentId: segment.id,
            mode: segment.mode,
            partType,
            source,
            geometryQuality: segment.geometryQuality,
            distanceMeters: lengthMeters,
            pointCount: getSegmentRenderableCoordinates(segment).length,
          };
        }) ?? [];
    const overlayRows = [
      ...transitConnectorOverlays.map(overlay => ({
        overlayId: overlay.id,
        partType: 'API_CONNECTOR_OVERLAY',
        source: 'WALK_API_CONNECTOR',
        distanceMeters: Math.round(getSegmentLengthMeters(overlay.coords)),
        pointCount: overlay.coords.length,
      })),
      ...transitWalkDetailOverlays.map(overlay => ({
        overlayId: overlay.id,
        partType: overlay.id.endsWith('-path')
          ? 'WALK_DETAIL_PATH'
          : 'WALK_DETAIL_SOURCE',
        source: 'WALK_API_DETAIL',
        distanceMeters: Math.round(getSegmentLengthMeters(overlay.coords)),
        pointCount: overlay.coords.length,
      })),
    ];
    const signature = JSON.stringify({
      routeId: selectedNormalizedRoute?.id,
      segmentRows,
      overlayRows,
    });
    if (lastWalkRenderPartsLogSignatureRef.current === signature) return;
    lastWalkRenderPartsLogSignatureRef.current = signature;

    console.log(
      '[route-walk-render-parts] selectedRouteId:',
      selectedNormalizedRoute?.id,
    );
    console.table(segmentRows);
    console.table(overlayRows);
    console.log('[route-walk-render-parts] segment rows:', segmentRows);
    console.log('[route-walk-render-parts] overlay rows:', overlayRows);
  }, [
    qaLayerMode,
    selectedNormalizedRoute,
    transitConnectorOverlays,
    transitWalkDetailOverlays,
  ]);

  useEffect(() => {
    if (typeof __DEV__ === 'boolean' && !__DEV__) return;
    if (
      !selectedNormalizedRoute?.segments?.length &&
      !selectedRouteInfo?.steps?.length
    )
      return;

    const segmentRows =
      selectedNormalizedRoute?.segments.map((segment, index) => ({
        index,
        id: segment.id,
        mode: segment.mode,
        lineName: segment.lineName,
        duration: segment.duration,
        color: getSegmentColor(segment),
        routeColor: segment.routeColor,
        displayColor: segment.displayColor,
        geometrySource: segment.geometrySource,
        geometryQuality: segment.geometryQuality,
        isManualSamplePath: segment.isManualSamplePath === true,
      })) ?? [];
    const timelineRows =
      selectedRouteInfo?.steps
        .filter(step => step.type !== 'ORIGIN' && step.type !== 'DESTINATION')
        .map((step, index) => ({
          index,
          id: step.id,
          type: step.type,
          lineName: step.lineName,
          duration: step.durationMinutes,
          color: getRouteStepColor(step),
        })) ?? [];
    const summaryRows = selectedTransitProgressSegments.map(
      (segment, index) => ({
        index,
        key: segment.key,
        kind: segment.kind,
        lineLabel: segment.lineLabel,
        minutes: segment.minutes,
        color: segment.color,
        isRide: segment.isRide,
      }),
    );
    const routeSheetLogSignature = JSON.stringify({
      selectedRouteId: selectedNormalizedRoute?.id,
      segments: segmentRows,
      timeline: timelineRows,
      summary: summaryRows,
    });
    if (lastRouteSheetSyncLogSignatureRef.current === routeSheetLogSignature)
      return;
    lastRouteSheetSyncLogSignatureRef.current = routeSheetLogSignature;

    console.log(
      '[route-sheet-sync] selectedRouteId:',
      selectedNormalizedRoute?.id,
    );
    console.log('[route-sheet-sync] segmentCount:', segmentRows.length);
    console.log('[route-sheet-sync] timelineStepCount:', timelineRows.length);
    console.log('[route-sheet-sync] summarySegmentCount:', summaryRows.length);
    console.table(segmentRows);
    console.table(timelineRows);
    console.table(summaryRows);
    console.log('[route-sheet-sync] segment rows:', segmentRows);
    console.log('[route-sheet-sync] timeline rows:', timelineRows);
    console.log('[route-sheet-sync] summary rows:', summaryRows);
  }, [
    selectedNormalizedRoute,
    selectedRouteInfo,
    selectedTransitProgressSegments,
  ]);

}

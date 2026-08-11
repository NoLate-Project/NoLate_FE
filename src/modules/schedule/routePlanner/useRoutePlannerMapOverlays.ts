import { useMemo } from 'react';

import type {
  RouteAlternativeOption,
  RoutePathCoord,
} from '../../map/routingService';
import type { RouteEndpointAccessPath } from '../../map/routeEndpointAccess';
import type { TmapLatLng, TmapPathOverlay } from '../../map/TmapMapView';
import {
  applyTransitRouteThemeToOverlay,
  getTransitWalkGuidePresentation,
  TRANSIT_ROUTE_ZOOM_STYLE,
} from '../../map/transitRoutePresentation';
import {
  applyFocusedTransitRideOverlayOwnership,
  shouldUseRouteInfoStepOverlays,
} from '../../map/transitRouteSegmentPolicy';
import type { RouteInfo } from '../routeInfo';
import type { TravelMode } from '../types';
import type { RouteQaLayerMode } from './params';
import {
  RouteSegmentLayers,
  buildAnchorDebugPathOverlays,
  buildTransitStopAccessLinkOverlays,
} from './RouteMapOverlays';
import {
  buildRouteEndpointAccessOverlays,
  buildRouteInfoPathOverlays,
} from './routePlannerRouteInfo';
import { getSegmentRenderableCoordinates } from './routeMapCoordinate';
import {
  ENABLE_NATIVE_ROUTE_DIRECTION,
  getBikeOutlineWidth,
  getBikeWidth,
  getDriveOutlineWidth,
  getDriveWidth,
  getNativeDirectionOpacity,
  getTransitCasingWidth,
  getTransitMainWidth,
  getWalkOutlineWidth,
  getWalkWidth,
  isWalkTransferSegment,
  ROUTE_LINE_STYLE,
  ROUTE_STYLE,
  ROUTE_WALK_CASING_COLOR,
  ROUTE_WALK_CASING_OPACITY,
  ROUTE_WALK_GUIDE_COLOR,
  ROUTE_WALK_GUIDE_OPACITY,
  shouldUseNativeTransitDirection,
  type NormalizedRoute,
} from './routeMapTypesAndStyle';
import {
  getMapTransitLegVisualColor,
  isRideLegKind,
} from './routeTransitLegCoordinates';
import { getTransitLegMapCoords } from './routeTransitGeometryBuilder';
import { toDisplayOverlayCoords } from './routeTransitWalkGeometry';

// 전체 경로에서도 대중교통 노선색을 확인할 수 있도록 저배율부터 구간을 표시한다.
const TRANSIT_SEGMENT_RENDER_MIN_ZOOM = 6;
// 본선과 방향 화살표는 같은 native polyline의 확대 기준을 공유한다.
const TRANSIT_NATIVE_DIRECTION_MIN_ZOOM =
  TRANSIT_ROUTE_ZOOM_STYLE.directionMinZoom;

type Options = {
  focusedTransitLegIndex?: number;
  hasRouteReady: boolean;
  isRouteQaBaseOnly: boolean;
  mapZoom: number;
  pathRouteCoords?: RoutePathCoord[];
  qaLayerMode: RouteQaLayerMode;
  routeAlternatives: RouteAlternativeOption[];
  routeEndpointAccessPaths: RouteEndpointAccessPath[];
  selectedAlternativeId?: string;
  selectedNormalizedRoute?: NormalizedRoute;
  selectedRouteInfo?: RouteInfo;
  shouldRenderTransitDetailDark: boolean;
  transitConnectorOverlays: TmapPathOverlay[];
  transitWalkDetailOverlays: TmapPathOverlay[];
  travelMode: TravelMode;
};

/**
 * 선택 경로와 확대 수준에 맞춰 지도 polyline 레이어를 구성한다.
 * 일반 경로, 대중교통 구간, 도보 연결선, 교통정보, QA 레이어의 렌더 순서를 한곳에서 보장한다.
 */
export function useRoutePlannerMapOverlays({
  focusedTransitLegIndex,
  hasRouteReady,
  isRouteQaBaseOnly,
  mapZoom,
  pathRouteCoords: routePathCoords,
  qaLayerMode,
  routeAlternatives,
  routeEndpointAccessPaths,
  selectedAlternativeId,
  selectedNormalizedRoute,
  selectedRouteInfo,
  shouldRenderTransitDetailDark,
  transitConnectorOverlays,
  transitWalkDetailOverlays,
  travelMode,
}: Options) {
  const pathOverlayCoords = useMemo(() => {
    if (Array.isArray(routePathCoords) && routePathCoords.length >= 2) {
      return routePathCoords.map(point => ({
        latitude: point.lat,
        longitude: point.lng,
      }));
    }
    return undefined;
  }, [routePathCoords]);

  // 지도에 전달할 실제 polyline 목록.
  // inactive 대안 경로, 선택된 대중교통 ride/walk 세그먼트, fallback 메인 경로를 한곳에서 조합한다.
  const mapPathOverlays = useMemo((): TmapPathOverlay[] => {
    if (isRouteQaBaseOnly) return [];
    if (!hasRouteReady) return [];

    const transitWalkGuide = getTransitWalkGuidePresentation(mapZoom);
    const fallbackPathCoords: TmapLatLng[] = [];
    const selectedRoute = routeAlternatives.find(
      option => option.id === selectedAlternativeId,
    );
    const shouldUseTransitLegOverlays =
      travelMode === 'TRANSIT' &&
      selectedRoute &&
      Array.isArray(selectedRoute.transitLegs) &&
      selectedRoute.transitLegs.length > 0;
    const trafficSectionOverlays: TmapPathOverlay[] =
      travelMode === 'CAR' && selectedRoute?.trafficSections
        ? selectedRoute.trafficSections.flatMap((section, index) => {
            if (
              !Array.isArray(section.pathCoords) ||
              section.pathCoords.length < 2
            )
              return [];
            const color =
              section.level === 'smooth'
                ? '#18A957'
                : section.level === 'slow'
                ? '#F5A623'
                : section.level === 'congested'
                ? '#E5484D'
                : '#2979FF';
            return [
              {
                id: `${selectedRoute.id}-traffic-${index}`,
                coords: section.pathCoords.map(coord => ({
                  latitude: coord.lat,
                  longitude: coord.lng,
                })),
                color,
                width: getDriveWidth(mapZoom),
                opacity: ROUTE_LINE_STYLE.drive.opacity,
                outlineColor: ROUTE_LINE_STYLE.drive.casingColor,
                outlineWidth: getDriveOutlineWidth(mapZoom),
                outlineOpacity: ROUTE_LINE_STYLE.drive.casingOpacity,
                strokeStyle: 'solid',
                renderMode: 'native',
                nativeDirection: ROUTE_LINE_STYLE.drive.arrows,
                nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                zIndex: 35 + index,
              } as TmapPathOverlay,
            ];
          })
        : [];
    const endpointAccessOverlays = buildRouteEndpointAccessOverlays(
      routeEndpointAccessPaths,
      mapZoom,
      shouldRenderTransitDetailDark,
    );
    const routeInfoStepOverlays = buildRouteInfoPathOverlays(
      selectedRouteInfo,
      mapZoom,
    );
    const hasSelectedMainPath =
      Array.isArray(selectedRoute?.pathCoords) &&
      selectedRoute.pathCoords.length >= 2;
    const hasRenderableNormalizedTransitRoute =
      travelMode === 'TRANSIT' &&
      selectedNormalizedRoute?.segments.some(
        segment => getSegmentRenderableCoordinates(segment).length >= 2,
      ) === true;
    const useRouteInfoStepOverlays = shouldUseRouteInfoStepOverlays({
      routeMode: travelMode,
      routeInfoOverlayCount: routeInfoStepOverlays.length,
      hasTransitLegOverlays: !!shouldUseTransitLegOverlays,
      hasSelectedMainPath,
      hasRenderableNormalizedTransitRoute,
    });
    if (useRouteInfoStepOverlays) {
      return [
        ...endpointAccessOverlays,
        ...routeInfoStepOverlays,
        ...trafficSectionOverlays,
      ];
    }

    if (
      travelMode === 'TRANSIT' &&
      selectedNormalizedRoute &&
      selectedNormalizedRoute.segments.length > 0
    ) {
      const segmentLineOverlays = selectedNormalizedRoute.segments
        .flatMap(segment => {
          const overlays = RouteSegmentLayers(segment, mapZoom, true);
          if (overlays.length === 0) return [];
          const ownedOverlays = applyFocusedTransitRideOverlayOwnership(
            overlays,
            {
              mode: segment.mode,
              zoom: mapZoom,
              focused: segment.sequence === focusedTransitLegIndex,
              directionEnabled: shouldUseNativeTransitDirection(segment),
              directionColor: ROUTE_LINE_STYLE.arrows.color,
            },
          );
          if (
            qaLayerMode === 'CONNECTOR_DEBUG' &&
            isWalkTransferSegment(segment)
          ) {
            const isFallback =
              segment.geometrySource === 'START_END_ONLY' ||
              segment.geometryQuality === 'START_END_ONLY' ||
              segment.geometryQuality === 'GEOMETRY_MISMATCH';
            const isAnchorAdjusted =
              segment.geometryQuality === 'ANCHOR_ADJUSTED_GEOMETRY';
            const debugColor = isFallback
              ? '#FF3B30'
              : isAnchorAdjusted
              ? '#FF9500'
              : ROUTE_WALK_GUIDE_COLOR;
            return ownedOverlays.map(
              item =>
                ({
                  ...item,
                  color: debugColor,
                  dotColor:
                    item.renderMode === 'screen' ? debugColor : item.dotColor,
                  supportLineColor:
                    item.renderMode === 'screen'
                      ? isFallback
                        ? 'rgba(255,59,48,0.24)'
                        : 'rgba(255,149,0,0.22)'
                      : item.supportLineColor,
                  opacity:
                    item.renderMode === 'screen' ? 1 : isFallback ? 0.86 : 0.72,
                  width:
                    item.renderMode === 'screen'
                      ? item.width
                      : Math.max(
                          1.4,
                          item.width ?? ROUTE_STYLE.connectorWalkWidth,
                        ),
                  dashPattern:
                    item.renderMode === 'screen'
                      ? undefined
                      : isFallback
                      ? [2, 7]
                      : [2, 9],
                  zIndex:
                    210 +
                    segment.sequence +
                    (item.renderMode === 'screen' ? 5 : 0),
                } as TmapPathOverlay),
            );
          }
          return ownedOverlays;
        })
        .filter((overlay): overlay is TmapPathOverlay => overlay !== null);
      const stopAccessLinkOverlays = buildTransitStopAccessLinkOverlays(
        selectedNormalizedRoute,
        mapZoom,
      );
      const boundaryConnectorOverlays = transitConnectorOverlays
        .filter(
          overlay =>
            overlay.id.endsWith('-path') &&
            Array.isArray(overlay.coords) &&
            overlay.coords.length >= 2,
        )
        .map(
          (overlay, index): TmapPathOverlay => ({
            id: `selected-connector-${overlay.id}`,
            coords: overlay.coords,
            color: ROUTE_WALK_GUIDE_COLOR,
            width: getWalkWidth(mapZoom),
            opacity: ROUTE_LINE_STYLE.walk.opacity,
            outlineColor: ROUTE_WALK_CASING_COLOR,
            outlineWidth: getWalkOutlineWidth(mapZoom),
            outlineOpacity: ROUTE_WALK_CASING_OPACITY,
            dashPattern: [...transitWalkGuide.dashPattern],
            strokeStyle: transitWalkGuide.strokeStyle,
            outlineStrokeStyle: transitWalkGuide.outlineStrokeStyle,
            renderMode: 'native',
            zIndex: 32 + Math.min(index, 9) * 0.1,
          }),
        );
      const anchorDebugOverlays =
        qaLayerMode === 'ANCHOR_DEBUG'
          ? buildAnchorDebugPathOverlays(selectedNormalizedRoute)
          : [];
      return [
        ...boundaryConnectorOverlays,
        ...stopAccessLinkOverlays,
        ...segmentLineOverlays,
        ...anchorDebugOverlays,
      ];
    }

    const shouldShowDetailedTransitSegments =
      travelMode === 'TRANSIT' && mapZoom >= TRANSIT_SEGMENT_RENDER_MIN_ZOOM;
    const shouldEmphasizeMainTransitBaseLine = mapZoom < 15.3;
    const walkOverlayById = new Map(
      transitWalkDetailOverlays.map(overlay => [overlay.id, overlay.coords]),
    );
    const selectedTransitBaseOverlays =
      travelMode === 'TRANSIT' &&
      shouldShowDetailedTransitSegments &&
      selectedRoute &&
      Array.isArray(selectedRoute.transitLegs)
        ? selectedRoute.transitLegs.flatMap((leg, index) => {
            if (leg.kind === 'WALK') return [];
            const legCoords = getTransitLegMapCoords(
              selectedRoute.id,
              selectedRoute.transitLegs,
              index,
              walkOverlayById,
            );
            if (legCoords.length < 2) return [];
            const color = getMapTransitLegVisualColor(leg);
            return [
              {
                id: `${selectedRoute.id}-segment-base-${index}`,
                coords: legCoords,
                color,
                width: getTransitMainWidth(mapZoom),
                outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
                outlineWidth:
                  (getTransitCasingWidth(mapZoom) -
                    getTransitMainWidth(mapZoom)) /
                  2,
                outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
                renderMode: 'native',
                strokeStyle: 'solid',
                // 정규화 fallback도 본선 하나에 SDK native direction을 직접 적용한다.
                nativeDirection:
                  isRideLegKind(leg.kind) &&
                  index !== focusedTransitLegIndex &&
                  ENABLE_NATIVE_ROUTE_DIRECTION &&
                  mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
                nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                zIndex: 40 + Math.min(index, 9) * 0.1,
              } as TmapPathOverlay,
            ];
          })
        : [];
    const selectedTransitWalkFallbackOverlays =
      travelMode === 'TRANSIT' &&
      shouldShowDetailedTransitSegments &&
      selectedRoute &&
      Array.isArray(selectedRoute.transitLegs)
        ? selectedRoute.transitLegs.flatMap((leg, index) => {
            if (leg.kind !== 'WALK') return [];
            const walkOverlayId = `${selectedRoute.id}-walk-leg-${index}`;
            if (
              walkOverlayById.has(walkOverlayId) ||
              walkOverlayById.has(`${walkOverlayId}-path`)
            )
              return [];
            const legCoords = getTransitLegMapCoords(
              selectedRoute.id,
              selectedRoute.transitLegs,
              index,
              walkOverlayById,
            );
            if (legCoords.length < 2) return [];
            return [
              {
                id: `${selectedRoute.id}-walk-fallback-${index}`,
                coords: legCoords,
                color: ROUTE_WALK_GUIDE_COLOR,
                width: getWalkWidth(mapZoom),
                opacity: ROUTE_WALK_GUIDE_OPACITY,
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(mapZoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                dashPattern: [...transitWalkGuide.dashPattern],
                strokeStyle: transitWalkGuide.strokeStyle,
                outlineStrokeStyle: transitWalkGuide.outlineStrokeStyle,
              } as TmapPathOverlay,
            ];
          })
        : [];
    const selectedTransitWalkOverlays =
      travelMode === 'TRANSIT' && shouldShowDetailedTransitSegments
        ? [
            ...selectedTransitWalkFallbackOverlays,
            ...transitConnectorOverlays,
            ...transitWalkDetailOverlays,
          ]
            .filter(
              overlay =>
                typeof overlay.id === 'string' &&
                (overlay.id.endsWith('-path') ||
                  overlay.id.includes('-walk-fallback-')) &&
                Array.isArray(overlay.coords) &&
                overlay.coords.length >= 2,
            )
            .map((overlay, index) => {
              const isConnectorDebug =
                qaLayerMode === 'CONNECTOR_DEBUG' &&
                transitConnectorOverlays.some(
                  connectorOverlay => connectorOverlay.id === overlay.id,
                );
              const isFallbackDebug =
                qaLayerMode === 'CONNECTOR_DEBUG' &&
                overlay.id.includes('-walk-fallback-');
              return {
                id: `selected-walk-${index}-${overlay.id}`,
                coords: overlay.coords,
                color: isConnectorDebug
                  ? '#FF9500'
                  : isFallbackDebug
                  ? '#FF3B30'
                  : ROUTE_WALK_GUIDE_COLOR,
                width:
                  isConnectorDebug || isFallbackDebug
                    ? 2.4
                    : getWalkWidth(mapZoom),
                opacity:
                  isConnectorDebug || isFallbackDebug
                    ? 0.9
                    : ROUTE_LINE_STYLE.walk.opacity,
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(mapZoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                dashPattern: [...transitWalkGuide.dashPattern],
                strokeStyle: transitWalkGuide.strokeStyle,
                outlineStrokeStyle: transitWalkGuide.outlineStrokeStyle,
                renderMode: 'native',
                // 승차 본선(40+)이 환승 접합부를 덮어 점선이 본선을 자르지 않게 한다.
                zIndex: 30 + Math.min(index, 9) * 0.1,
              } as TmapPathOverlay;
            })
        : [];
    const focusedTransitLegOverlay =
      travelMode === 'TRANSIT' &&
      selectedRoute &&
      Array.isArray(selectedRoute.transitLegs) &&
      typeof focusedTransitLegIndex === 'number'
        ? (() => {
            const focusedLeg =
              selectedRoute.transitLegs?.[focusedTransitLegIndex];
            if (!focusedLeg) return null;
            const focusedCoords = getTransitLegMapCoords(
              selectedRoute.id,
              selectedRoute.transitLegs,
              focusedTransitLegIndex,
              walkOverlayById,
            );
            if (focusedCoords.length < 2) return null;
            const focusedIsWalk = focusedLeg.kind === 'WALK';
            const focusedColor = focusedIsWalk
              ? ROUTE_WALK_GUIDE_COLOR
              : getMapTransitLegVisualColor(focusedLeg);
            const focusedIsRide = isRideLegKind(focusedLeg.kind);
            return {
              id: `${selectedRoute.id}-focused-leg-${focusedTransitLegIndex}`,
              coords: focusedCoords,
              color: focusedColor,
              width: focusedIsWalk
                ? getWalkWidth(mapZoom) + 0.4
                : getTransitMainWidth(mapZoom) + 0.4,
              opacity: focusedIsWalk ? ROUTE_LINE_STYLE.walk.opacity : 1,
              outlineColor: focusedIsWalk
                ? ROUTE_WALK_CASING_COLOR
                : shouldRenderTransitDetailDark
                ? 'rgba(5,10,20,0.08)'
                : 'rgba(255,255,255,0.18)',
              outlineWidth: focusedIsWalk
                ? getWalkOutlineWidth(mapZoom)
                : (getTransitCasingWidth(mapZoom) -
                    getTransitMainWidth(mapZoom)) /
                  2,
              outlineOpacity: focusedIsWalk
                ? ROUTE_WALK_CASING_OPACITY
                : undefined,
              renderMode: 'native',
              dashPattern: focusedIsWalk
                ? [...transitWalkGuide.dashPattern]
                : undefined,
              strokeStyle: focusedIsWalk
                ? transitWalkGuide.strokeStyle
                : 'solid',
              outlineStrokeStyle: focusedIsWalk
                ? transitWalkGuide.outlineStrokeStyle
                : 'solid',
              // 포커스 강조선이 기본 본선을 덮어도 진행 방향이 사라지지 않게 유지한다.
              nativeDirection:
                focusedIsRide &&
                ENABLE_NATIVE_ROUTE_DIRECTION &&
                mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
              nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
              nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
              zIndex: 90,
            } as TmapPathOverlay;
          })()
        : null;
    const selectedMainOverlay = selectedRoute
      ? (() => {
          const isWalkRoute = selectedRoute.mode === 'WALK';
          const isBikeRoute = selectedRoute.mode === 'BIKE';
          const isDriveRoute =
            selectedRoute.mode === 'CAR' || selectedRoute.mode === 'ETC';
          const hasDetailedTransitOverlay =
            selectedTransitBaseOverlays.length > 0;
          const selectedCoords =
            Array.isArray(selectedRoute.pathCoords) &&
            selectedRoute.pathCoords.length >= 2
              ? toDisplayOverlayCoords(
                  selectedRoute.pathCoords,
                  selectedRoute.mode === 'WALK' ? 'WALK' : undefined,
                )
              : fallbackPathCoords;
          if (selectedCoords.length < 2) return null;
          return {
            id: `${selectedRoute.id}-selected`,
            coords: selectedCoords,
            color: isWalkRoute
              ? ROUTE_WALK_GUIDE_COLOR
              : isBikeRoute
              ? ROUTE_LINE_STYLE.bike.color
              : hasDetailedTransitOverlay
              ? shouldEmphasizeMainTransitBaseLine
                ? 'rgba(180, 193, 211, 0.32)'
                : 'rgba(180, 193, 211, 0.12)'
              : ROUTE_LINE_STYLE.drive.color,
            width: isWalkRoute
              ? getWalkWidth(mapZoom)
              : isBikeRoute
              ? getBikeWidth(mapZoom)
              : hasDetailedTransitOverlay
              ? // 상세 줌에서는 메인 fallback 라인을 약하게 낮춰
                // 도보 점선/대중교통 색상 세그먼트가 더 먼저 읽히게 한다.
                shouldEmphasizeMainTransitBaseLine
                ? Math.max(ROUTE_STYLE.transitWalkWidth, 2.8)
                : 1.8
              : getDriveWidth(mapZoom),
            opacity: isWalkRoute
              ? ROUTE_LINE_STYLE.walk.opacity
              : isBikeRoute
              ? ROUTE_LINE_STYLE.bike.opacity
              : 1,
            outlineColor: isWalkRoute
              ? ROUTE_WALK_CASING_COLOR
              : isBikeRoute
              ? ROUTE_LINE_STYLE.bike.casingColor
              : hasDetailedTransitOverlay
              ? shouldEmphasizeMainTransitBaseLine
                ? shouldRenderTransitDetailDark
                  ? 'rgba(15,20,35,0.20)'
                  : 'rgba(255,255,255,0.28)'
                : shouldRenderTransitDetailDark
                ? 'rgba(15,20,35,0.12)'
                : 'rgba(255,255,255,0.12)'
              : ROUTE_LINE_STYLE.drive.casingColor,
            outlineWidth: isWalkRoute
              ? getWalkOutlineWidth(mapZoom)
              : isBikeRoute
              ? getBikeOutlineWidth(mapZoom)
              : hasDetailedTransitOverlay
              ? shouldEmphasizeMainTransitBaseLine
                ? 0.5
                : 0
              : getDriveOutlineWidth(mapZoom),
            outlineOpacity: isWalkRoute
              ? ROUTE_WALK_CASING_OPACITY
              : isBikeRoute
              ? ROUTE_LINE_STYLE.bike.casingOpacity
              : isDriveRoute
              ? ROUTE_LINE_STYLE.drive.casingOpacity
              : undefined,
            dashPattern: isWalkRoute
              ? [...transitWalkGuide.dashPattern]
              : undefined,
            strokeStyle: isWalkRoute ? transitWalkGuide.strokeStyle : 'solid',
            outlineStrokeStyle: isWalkRoute
              ? transitWalkGuide.outlineStrokeStyle
              : 'solid',
            renderMode: 'native',
            // 교통정보 구간이 있으면 하부 본선은 끊김만 메우고 화살표는 상부 구간에 한 번만 그린다.
            nativeDirection:
              (isBikeRoute ||
                (isDriveRoute && trafficSectionOverlays.length === 0)) &&
              ENABLE_NATIVE_ROUTE_DIRECTION,
            nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
            nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
          } as TmapPathOverlay;
        })()
      : null;

    if (
      selectedTransitBaseOverlays.length > 0 ||
      selectedTransitWalkOverlays.length > 0
    ) {
      const overlays: TmapPathOverlay[] = [];
      if (selectedTransitBaseOverlays.length > 0) {
        overlays.push(...selectedTransitBaseOverlays);
      }
      overlays.push(...selectedTransitWalkOverlays);
      if (focusedTransitLegOverlay) {
        overlays.push(focusedTransitLegOverlay);
      }
      if (qaLayerMode === 'ANCHOR_DEBUG') {
        overlays.push(...buildAnchorDebugPathOverlays(selectedNormalizedRoute));
      }
      return overlays;
    }

    if (!selectedMainOverlay) {
      if (pathOverlayCoords && pathOverlayCoords.length >= 2) {
        const isFallbackWalk = travelMode === 'WALK';
        const isFallbackBike = travelMode === 'BIKE';
        const isFallbackDrive = travelMode === 'CAR';
        const overlays: TmapPathOverlay[] = [
          {
            id: 'route-selected-fallback',
            coords: pathOverlayCoords,
            color: isFallbackWalk
              ? ROUTE_WALK_GUIDE_COLOR
              : isFallbackBike
              ? ROUTE_LINE_STYLE.bike.color
              : ROUTE_LINE_STYLE.drive.color,
            width: isFallbackWalk
              ? getWalkWidth(mapZoom)
              : isFallbackBike
              ? getBikeWidth(mapZoom)
              : getDriveWidth(mapZoom),
            opacity: isFallbackWalk
              ? ROUTE_LINE_STYLE.walk.opacity
              : isFallbackBike
              ? ROUTE_LINE_STYLE.bike.opacity
              : 1,
            outlineColor: isFallbackWalk
              ? ROUTE_WALK_CASING_COLOR
              : isFallbackBike
              ? ROUTE_LINE_STYLE.bike.casingColor
              : ROUTE_LINE_STYLE.drive.casingColor,
            outlineWidth: isFallbackWalk
              ? getWalkOutlineWidth(mapZoom)
              : isFallbackBike
              ? getBikeOutlineWidth(mapZoom)
              : getDriveOutlineWidth(mapZoom),
            outlineOpacity: isFallbackWalk
              ? ROUTE_WALK_CASING_OPACITY
              : isFallbackBike
              ? ROUTE_LINE_STYLE.bike.casingOpacity
              : ROUTE_LINE_STYLE.drive.casingOpacity,
            dashPattern: isFallbackWalk
              ? [...transitWalkGuide.dashPattern]
              : undefined,
            strokeStyle: isFallbackWalk
              ? transitWalkGuide.strokeStyle
              : 'solid',
            outlineStrokeStyle: isFallbackWalk
              ? transitWalkGuide.outlineStrokeStyle
              : 'solid',
            renderMode: 'native',
            nativeDirection:
              (isFallbackDrive || isFallbackBike) &&
              ENABLE_NATIVE_ROUTE_DIRECTION,
            nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
            nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
          },
        ];
        if (focusedTransitLegOverlay) {
          overlays.push(focusedTransitLegOverlay);
        }
        return [
          ...endpointAccessOverlays,
          ...overlays,
          ...trafficSectionOverlays,
        ];
      }
      return focusedTransitLegOverlay
        ? [...endpointAccessOverlays, focusedTransitLegOverlay]
        : endpointAccessOverlays;
    }

    return focusedTransitLegOverlay
      ? [
          ...endpointAccessOverlays,
          selectedMainOverlay,
          ...trafficSectionOverlays,
          focusedTransitLegOverlay,
        ]
      : [
          ...endpointAccessOverlays,
          selectedMainOverlay,
          ...trafficSectionOverlays,
        ];
  }, [
    hasRouteReady,
    routeAlternatives,
    selectedAlternativeId,
    pathOverlayCoords,
    travelMode,
    mapZoom,
    selectedNormalizedRoute,
    transitConnectorOverlays,
    transitWalkDetailOverlays,
    routeEndpointAccessPaths,
    focusedTransitLegIndex,
    selectedRouteInfo,
    shouldRenderTransitDetailDark,
    isRouteQaBaseOnly,
    qaLayerMode,
  ]);

  const themedMapPathOverlays = useMemo(() => {
    if (!shouldRenderTransitDetailDark) return mapPathOverlays;
    return mapPathOverlays.map(overlay =>
      applyTransitRouteThemeToOverlay(overlay, mapZoom, 'dark'),
    );
  }, [mapPathOverlays, mapZoom, shouldRenderTransitDetailDark]);


  return {
    mapPathOverlays,
    pathOverlayCoords,
    themedMapPathOverlays,
  };
}

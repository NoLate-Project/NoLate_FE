import { useMemo } from 'react';

import { getRouteEndpointMarkerPresentation } from '../../map/routeMarkerPresentation';
import { isRedundantEndpointTransitEvent } from '../../map/transitMarkerHierarchy';
import type { RouteAlternativeOption } from '../../map/routingService';
import type { TmapMarker } from '../../map/TmapMapView';
import type { TravelMode } from '../types';
import type { RouteQaLayerMode } from './params';
import { buildAnchorDebugMarkers } from './RouteMapOverlays';
import type { NormalizedRoute } from './routeMapTypesAndStyle';
import {
  buildTransitEventMarkers,
  buildTransitPassStopMarkers,
  buildTransitRouteIdentityMarkers,
  type SelectedTransitMapStop,
} from './routeTransitMarkers';
import { DESTINATION_COLOR, ORIGIN_COLOR } from './styles';

type Options = {
  destinationLat?: number;
  destinationLng?: number;
  hasDestinationCoords: boolean;
  hasOriginCoords: boolean;
  isRouteQaBaseOnly: boolean;
  mapZoom: number;
  originLat?: number;
  originLng?: number;
  qaLayerMode: RouteQaLayerMode;
  selectedAlternative?: RouteAlternativeOption;
  selectedNormalizedRoute?: NormalizedRoute;
  selectedTransitMapStop?: SelectedTransitMapStop;
  shouldRenderTransitDetailDark: boolean;
  travelMode: TravelMode;
};

/**
 * 출발·도착 핀과 대중교통 정류장·승하차·노선 식별 마커를 렌더 순서대로 조합한다.
 * 끝점과 겹치는 대중교통 이벤트는 확대 수준에 따라 제거해 핀의 의미를 보존한다.
 */
export function useRoutePlannerMapMarkers({
  destinationLat,
  destinationLng,
  hasDestinationCoords,
  hasOriginCoords,
  isRouteQaBaseOnly,
  mapZoom,
  originLat,
  originLng,
  qaLayerMode,
  selectedAlternative,
  selectedNormalizedRoute,
  selectedTransitMapStop,
  shouldRenderTransitDetailDark,
  travelMode,
}: Options) {
  // 지도에 전달할 실제 marker 목록.
  // 출발/도착 pin, 방향 화살표, 버스 정류장, 환승/승하차 배지까지 최종 단계에서 모은다.
  const mapMarkers = useMemo<TmapMarker[]>(() => {
    if (isRouteQaBaseOnly) return [];
    const markers: TmapMarker[] = [];
    // 출발/도착 핀은 항상 사용자가 선택한 실제 좌표에 고정한다.
    // (TRANSIT에서 walk path 중간으로 이동시키면 "마커가 틀린 위치"처럼 보이는 문제가 생김)
    const originMarkerCoord = hasOriginCoords
      && typeof originLat === 'number'
      && typeof originLng === 'number'
      ? { lat: originLat, lng: originLng }
      : undefined;
    const destinationMarkerCoord = hasDestinationCoords
      && typeof destinationLat === 'number'
      && typeof destinationLng === 'number'
      ? { lat: destinationLat, lng: destinationLng }
      : undefined;
    const endpointPresentation = getRouteEndpointMarkerPresentation(
      originMarkerCoord,
      destinationMarkerCoord,
      mapZoom,
    );
    if (originMarkerCoord) {
      markers.push({
        id: 'origin',
        latitude: originMarkerCoord.lat,
        longitude: originMarkerCoord.lng,
        tintColor: ORIGIN_COLOR,
        markerStyle: 'origin',
        displayType: 'pin',
        // 전체 경로에서는 본선을 가리지 않고, 상세 배율에서는 행동 지점을 크게 보여준다.
        pinLabel: endpointPresentation.showLabels ? '출발' : undefined,
        markerScale: endpointPresentation.markerScale,
        caption: '출발',
        // 출발 마커를 최상단 우선순위로 렌더링.
        zIndex: 4000,
      });
    }
    if (destinationMarkerCoord) {
      markers.push({
        id: 'destination',
        latitude: destinationMarkerCoord.lat,
        longitude: destinationMarkerCoord.lng,
        tintColor: DESTINATION_COLOR,
        markerStyle: 'destination',
        displayType: 'pin',
        pinLabel: endpointPresentation.showLabels ? '도착' : undefined,
        markerScale: endpointPresentation.markerScale,
        caption: '도착',
        // 도착 마커는 출발보다 한 단계 낮은 우선순위.
        zIndex: 3990,
      });
    }

    if (
      travelMode === 'TRANSIT' &&
      Array.isArray(selectedAlternative?.transitLegs) &&
      selectedAlternative.transitLegs.length > 0
    ) {
      markers.push(
        ...buildTransitPassStopMarkers(
          selectedAlternative.id,
          selectedAlternative.transitLegs,
          mapZoom,
          selectedTransitMapStop,
        ),
      );
      markers.push(
        ...buildTransitRouteIdentityMarkers(
          selectedAlternative.id,
          selectedAlternative.transitLegs,
          mapZoom,
        ),
      );
      const transitEventMarkers = buildTransitEventMarkers(
        selectedAlternative.id,
        selectedAlternative.transitLegs,
        mapZoom,
        shouldRenderTransitDetailDark,
        selectedNormalizedRoute,
      );
      markers.push(
        ...transitEventMarkers.filter(
          marker =>
            !isRedundantEndpointTransitEvent(
              marker.eventIntent,
              { lat: marker.latitude, lng: marker.longitude },
              {
                origin: originMarkerCoord,
                destination: destinationMarkerCoord,
              },
              // 광역에서는 첫 노선 태그를 보존하고, 중간 배율부터 핀과 실제 충돌하는 라벨만 줄인다.
              marker.displayType === 'routeLabel' && mapZoom >= 14
                ? mapZoom
                : undefined,
            ),
        ),
      );
    }

    if (qaLayerMode === 'ANCHOR_DEBUG') {
      markers.push(...buildAnchorDebugMarkers(selectedNormalizedRoute));
    }

    return markers;
  }, [
    hasOriginCoords,
    hasDestinationCoords,
    originLat,
    originLng,
    destinationLat,
    destinationLng,
    travelMode,
    mapZoom,
    selectedAlternative,
    selectedTransitMapStop,
    shouldRenderTransitDetailDark,
    isRouteQaBaseOnly,
    qaLayerMode,
    selectedNormalizedRoute,
  ]);

  return mapMarkers;
}

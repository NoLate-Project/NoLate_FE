/** 경로 세그먼트 레이어와 접근·디버그 오버레이 생성 컴포넌트입니다. */
import { type TmapMarker, type TmapPathOverlay } from '../../map/TmapMapView';
import {
  getTransitStopAccessLink,
  getTransitWalkAccessLink,
  resolveTransitStopAccessCoordinate,
} from '../../map/transitRouteGeometry';
import {
  getTransitWalkGuidePresentation,
  shouldRenderTransitStopAccessLinks,
} from '../../map/transitRoutePresentation';
import { haversineDistanceKm } from './presentation';
import {
  getNativeDirectionOpacity,
  getSegmentColor,
  getSegmentStyle,
  getTransitMainWidth,
  getWalkOutlineWidth,
  isTransitRideSegmentMode,
  isWalkTransferSegment,
  type NormalizedRoute,
  ROUTE_LINE_STYLE,
  ROUTE_TRANSFER_GUIDE_COLOR,
  ROUTE_WALK_CASING_COLOR,
  ROUTE_WALK_CASING_OPACITY,
  type RouteSegment,
  shouldRenderNativeTransitDirection,
  type TransitStopAnchor,
  warnRouteDebug,
} from './routeMapTypesAndStyle';
import {
  getSegmentRenderableCoordinateParts,
  getSegmentRenderableCoordinates,
} from './routeMapCoordinate';

/** 정규화 세그먼트를 본선·외곽선·방향 레이어로 나눠 TMAP 오버레이 컴포넌트로 렌더링합니다. 입력 세그먼트와 앵커는 변경하지 않습니다. */
export function RouteSegmentLayers(
  segment: RouteSegment,
  zoom: number,
  selected: boolean,
): TmapPathOverlay[] {
  const coordinateParts = getSegmentRenderableCoordinateParts(segment);
  if (coordinateParts.length === 0) {
    if (!(segment.mode === 'TRANSFER' && (segment.distance ?? 0) <= 1)) {
      warnRouteDebug('[route-segment] invalid coordinates', {
        id: segment.id,
        mode: segment.mode,
        geometrySource: segment.geometrySource,
        rawPointCount: segment.rawPointCount,
        length: getSegmentRenderableCoordinates(segment).length,
      });
    }
    return [];
  }

  const style = getSegmentStyle(segment, zoom, selected);
  const walkGuide = isWalkTransferSegment(segment)
    ? getTransitWalkGuidePresentation(zoom)
    : undefined;
  return coordinateParts.map((coordinates, partIndex) => ({
    id:
      coordinateParts.length === 1
        ? segment.id
        : `${segment.id}-part-${partIndex}`,
    coords: coordinates,
    color: style.strokeColor,
    width: style.strokeWidth,
    opacity: style.opacity,
    outlineColor: style.outlineColor ?? 'rgba(0,0,0,0)',
    outlineWidth: style.outlineWidth ?? 0,
    outlineOpacity: style.outlineOpacity,
    dashPattern: walkGuide ? [...walkGuide.dashPattern] : style.dashPattern,
    strokeStyle: walkGuide?.strokeStyle ?? 'solid',
    outlineStrokeStyle: walkGuide?.outlineStrokeStyle ?? 'solid',
    renderMode: 'native',
    // 본선과 방향표를 하나의 TMAP Polyline으로 그려 줌 중에도 같은 좌표계에서 움직이게 한다.
    nativeDirection: shouldRenderNativeTransitDirection(segment, zoom),
    nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
    nativeDirectionOpacity: getNativeDirectionOpacity(zoom),
    zIndex: style.zIndex,
  }));
}

/** 환승 구간이 역 내부 단순 연결로 축약할 수 있는지 거리와 구간 정보를 기준으로 판별합니다. 입력 세그먼트와 앵커는 변경하지 않습니다. */
export function isSimplifiedStationTransferSegment(
  segment: RouteSegment | undefined,
): boolean {
  if (!segment || segment.mode !== 'TRANSFER') return false;
  const rawPointCount =
    segment.rawCoordinates?.length ?? segment.rawPointCount ?? 0;
  return (
    rawPointCount >= 3 &&
    segment.coordinates.length === 2 &&
    segment.coordinates.length < rawPointCount
  );
}

/** 정류장·역 출입구와 운행 경로 사이를 연결하는 짧은 접근 오버레이를 생성합니다. 입력 세그먼트와 앵커는 변경하지 않습니다. */
export function buildTransitStopAccessLinkOverlays(
  route: NormalizedRoute | undefined,
  zoom: number,
): TmapPathOverlay[] {
  if (!route?.segments?.length || !shouldRenderTransitStopAccessLinks(zoom))
    return [];
  const walkGuide = getTransitWalkGuidePresentation(zoom);
  const seen = new Set<string>();
  const overlays: TmapPathOverlay[] = route.segments.flatMap(
    (segment, segmentIndex) => {
      if (!isTransitRideSegmentMode(segment.mode)) return [];
      return [segment.boardAnchor, segment.alightAnchor].flatMap(
        (anchor, anchorIndex) => {
          const neighboringSegment =
            anchorIndex === 0
              ? route.segments[segmentIndex - 1]
              : route.segments[segmentIndex + 1];
          if (isSimplifiedStationTransferSegment(neighboringSegment)) return [];
          const link = getTransitStopAccessLink(anchor);
          if (!link) return [];
          const key = link
            .map(
              coord =>
                `${coord.latitude.toFixed(5)}:${coord.longitude.toFixed(5)}`,
            )
            .join('>');
          if (seen.has(key)) return [];
          seen.add(key);

          // 보행 geometry가 아니라 역 POI와 선로 중심을 잇는 도식적 역사 내부 연결이다.
          return [
            {
              id: `${segment.id}-access-link-${anchorIndex}`,
              coords: link,
              color: ROUTE_TRANSFER_GUIDE_COLOR,
              width: Math.max(2.2, getTransitMainWidth(zoom) * 0.55),
              opacity: ROUTE_LINE_STYLE.transfer.opacity,
              outlineColor: ROUTE_WALK_CASING_COLOR,
              outlineWidth: getWalkOutlineWidth(zoom),
              outlineOpacity: ROUTE_WALK_CASING_OPACITY,
              dashPattern: [...walkGuide.dashPattern],
              strokeStyle: walkGuide.strokeStyle,
              outlineStrokeStyle: walkGuide.outlineStrokeStyle,
              renderMode: 'native',
              zIndex: 34 + Math.min(segment.sequence, 9) * 0.1,
            } as TmapPathOverlay,
          ];
        },
      );
    },
  );

  route.segments.forEach((segment, segmentIndex) => {
    // 버스 정류장 간 gap은 실제 보행 경로가 필요하다. 역사 내부로 해석 가능한 지하철만 도식 연결한다.
    if (segment.mode !== 'SUBWAY') return;
    const neighboringWalks = [
      {
        position: 'board' as const,
        walkSegment: route.segments[segmentIndex - 1],
        anchor: segment.boardAnchor,
      },
      {
        position: 'alight' as const,
        walkSegment: route.segments[segmentIndex + 1],
        anchor: segment.alightAnchor,
      },
    ];

    neighboringWalks.forEach(
      ({ position, walkSegment, anchor }, accessIndex) => {
        if (
          !walkSegment ||
          (walkSegment.mode !== 'WALK' && walkSegment.mode !== 'TRANSFER')
        )
          return;
        if (isSimplifiedStationTransferSegment(walkSegment)) return;
        const walkCoordinates = walkSegment.coordinates.map(coord => ({
          lat: coord.latitude,
          lng: coord.longitude,
        }));
        const stopMapCoord = resolveTransitStopAccessCoordinate(anchor);
        const stopCoord = stopMapCoord
          ? { lat: stopMapCoord.latitude, lng: stopMapCoord.longitude }
          : undefined;
        const link = getTransitWalkAccessLink(
          walkCoordinates,
          stopCoord,
          position,
        );
        if (!link) return;
        const key = link
          .map(
            coord =>
              `${coord.latitude.toFixed(5)}:${coord.longitude.toFixed(5)}`,
          )
          .join('>');
        if (seen.has(key)) return;
        seen.add(key);

        overlays.push({
          id: `${segment.id}-walk-access-link-${accessIndex}`,
          coords: link,
          color: ROUTE_TRANSFER_GUIDE_COLOR,
          width: Math.max(1.8, getTransitMainWidth(zoom) * 0.42),
          opacity: ROUTE_LINE_STYLE.transfer.opacity,
          outlineColor: ROUTE_WALK_CASING_COLOR,
          outlineWidth: getWalkOutlineWidth(zoom),
          outlineOpacity: ROUTE_WALK_CASING_OPACITY,
          dashPattern: [...walkGuide.dashPattern],
          strokeStyle: walkGuide.strokeStyle,
          outlineStrokeStyle: walkGuide.outlineStrokeStyle,
          renderMode: 'native',
          zIndex: 33.5 + Math.min(segment.sequence, 9) * 0.1,
        });
      },
    );
  });

  return overlays;
}

/** 개발 QA 모드에서 원본 앵커와 보정 앵커 사이의 연결선을 지도 오버레이로 생성합니다. 입력 세그먼트와 앵커는 변경하지 않습니다. */
export function buildAnchorDebugPathOverlays(
  route: NormalizedRoute | undefined,
): TmapPathOverlay[] {
  if (!route?.segments?.length) return [];
  return route.segments.flatMap(segment => {
    if (!isTransitRideSegmentMode(segment.mode)) return [];
    const anchors: Array<{
      role: 'board' | 'alight';
      anchor?: TransitStopAnchor;
    }> = [
      { role: 'board', anchor: segment.boardAnchor },
      { role: 'alight', anchor: segment.alightAnchor },
    ];
    return anchors.flatMap(({ role, anchor }) => {
      if (!anchor) return [];
      const raw = anchor.rawCoordinate ?? anchor.stopCoordinate;
      const render = anchor.renderCoordinate ?? anchor.routeAnchorCoordinate;
      if (!raw || !render) return [];
      const distanceMeters =
        typeof anchor.snapDistanceMeters === 'number'
          ? anchor.snapDistanceMeters
          : haversineDistanceKm(raw, render) * 1000;
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0.6) return [];
      const isMismatch =
        distanceMeters > 60 || anchor.anchorSource === 'UNSNAPPED';
      return [
        {
          id: `anchor-debug-${route.id}-${segment.id}-${role}`,
          coords: [raw, render],
          color: isMismatch ? '#FF3B30' : '#FF9500',
          width: isMismatch ? 2.4 : 1.8,
          opacity: 0.95,
          outlineColor: 'rgba(0,0,0,0)',
          outlineWidth: 0,
          dashPattern: [2, 6],
          renderMode: 'native',
          zIndex: 280,
        } as TmapPathOverlay,
      ];
    });
  });
}

/** 개발 QA 모드에서 앵커 종류·출처·스냅 거리를 확인할 수 있는 지도 마커를 생성합니다. 입력 세그먼트와 앵커는 변경하지 않습니다. */
export function buildAnchorDebugMarkers(
  route: NormalizedRoute | undefined,
): TmapMarker[] {
  if (!route?.segments?.length) return [];
  return route.segments.flatMap(segment => {
    if (!isTransitRideSegmentMode(segment.mode)) return [];
    const segmentColor = getSegmentColor(segment);
    const anchors: Array<{
      role: 'board' | 'alight';
      anchor?: TransitStopAnchor;
    }> = [
      { role: 'board', anchor: segment.boardAnchor },
      { role: 'alight', anchor: segment.alightAnchor },
    ];
    return anchors.flatMap(({ role, anchor }) => {
      if (!anchor) return [];
      const raw = anchor.rawCoordinate ?? anchor.stopCoordinate;
      const render = anchor.renderCoordinate ?? anchor.routeAnchorCoordinate;
      if (!raw || !render) return [];
      const snapMeters =
        typeof anchor.snapDistanceMeters === 'number'
          ? Math.round(anchor.snapDistanceMeters)
          : undefined;
      return [
        {
          id: `anchor-debug-${route.id}-${segment.id}-${role}-raw`,
          latitude: raw.latitude,
          longitude: raw.longitude,
          tintColor: 'rgba(156, 163, 175, 0.96)',
          badgeBorderColor: 'rgba(255,255,255,0.92)',
          displayType: 'dot',
          dotSize: 8,
          caption: `${role} raw`,
          zIndex: 4090,
        },
        {
          id: `anchor-debug-${route.id}-${segment.id}-${role}-render`,
          latitude: render.latitude,
          longitude: render.longitude,
          tintColor: segmentColor,
          badgeBorderColor:
            snapMeters !== undefined && snapMeters > 60 ? '#FF3B30' : '#FFFFFF',
          displayType: 'dot',
          dotSize: 10,
          caption:
            snapMeters !== undefined
              ? `${role} ${snapMeters}m`
              : `${role} anchor`,
          zIndex: 4100,
        },
      ] as TmapMarker[];
    });
  });
}

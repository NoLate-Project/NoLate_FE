/** 정규화 경로를 진행 막대·타임라인·저장 경로·지도 오버레이 표현으로 변환합니다. */
import { type TransitLegDetail } from '../../map/routingService';
import { type TmapPathOverlay } from '../../map/TmapMapView';
import { joinWalkPathEndpoint } from '../../map/transitRouteGeometry';
import { type RouteEndpointAccessPath } from '../../map/routeEndpointAccess';
import { getTransitWalkGuidePresentation } from '../../map/transitRoutePresentation';
import { formatDistance, formatDuration } from './presentation';
import {
  ENABLE_NATIVE_ROUTE_DIRECTION,
  getBikeOutlineWidth,
  getBikeWidth,
  getDriveOutlineWidth,
  getDriveWidth,
  getNativeDirectionOpacity,
  getSegmentColor,
  getTransitCasingExtraWidth,
  getTransitMainWidth,
  getWalkOutlineWidth,
  getWalkWidth,
  isTransitRideSegmentMode,
  type NormalizedRoute,
  ROUTE_LINE_STYLE,
  ROUTE_TRANSFER_GUIDE_COLOR,
  ROUTE_WALK_CASING_COLOR,
  ROUTE_WALK_CASING_OPACITY,
  ROUTE_WALK_GUIDE_COLOR,
  type RouteMode,
  type RouteSegment,
} from './routeMapTypesAndStyle';
import { isRideLegKind } from './routeTransitLegCoordinates';
import { toDisplayOverlayCoords } from './routeTransitWalkGeometry';
import {
  compactTransitLineLabel,
  getRouteStepColor,
  type RouteInfo,
  type RouteStep,
} from '../routeInfo';
import {
  TRANSIT_PROGRESS_NEUTRAL_COLOR,
  type TransitRouteProgressSegment,
} from '../transitRouteProgress';

/** 정규화 세그먼트 수단을 경로 진행 막대가 사용하는 대중교통 구간 종류로 변환합니다. 입력 경로 정보는 변경하지 않습니다. */
export function routeSegmentModeToProgressKind(
  mode: RouteMode,
): TransitLegDetail['kind'] {
  if (mode === 'BUS') return 'BUS';
  if (mode === 'SUBWAY') return 'SUBWAY';
  if (mode === 'WALK') return 'WALK';
  return 'ETC';
}

/** 정규화 경로의 각 세그먼트를 소요 시간 비중과 의미 색상이 포함된 진행 막대 항목으로 변환합니다. 입력 경로 정보는 변경하지 않습니다. */
export function buildTransitProgressSegmentsFromRoute(
  route?: NormalizedRoute,
): TransitRouteProgressSegment[] {
  if (!route?.segments?.length) return [];
  return route.segments
    .map(segment => {
      const minutes =
        typeof segment.duration === 'number' &&
        Number.isFinite(segment.duration)
          ? Math.max(1, Math.round(segment.duration))
          : 1;
      const kind = routeSegmentModeToProgressKind(segment.mode);
      // 진행 막대의 이동 수단 판정은 screen-space 화살표 fallback과 무관하다.
      const isRide = isTransitRideSegmentMode(segment.mode);
      return {
        key: segment.id,
        label: formatDuration(minutes),
        lineLabel: isRide
          ? compactTransitLineLabel(segment.lineName)
          : undefined,
        kind,
        minutes,
        color: isRide
          ? getSegmentColor(segment)
          : TRANSIT_PROGRESS_NEUTRAL_COLOR,
        flex: Math.max(0.8, minutes),
        isRide,
      };
    })
    .filter(segment => segment.minutes > 0);
}

/** 정규화 세그먼트 수단을 경로 타임라인 단계 종류로 변환합니다. 입력 경로 정보는 변경하지 않습니다. */
export function routeStepTypeFromSegmentMode(
  mode: RouteMode,
): RouteStep['type'] {
  if (mode === 'BUS') return 'BUS';
  if (mode === 'SUBWAY') return 'SUBWAY';
  if (mode === 'TRANSFER') return 'TRANSFER';
  return 'WALK';
}

/** 세그먼트의 표시 좌표를 우선 사용해 타임라인 포커스용 좌표 목록을 만듭니다. 입력 경로 정보는 변경하지 않습니다. */
export function routeSegmentCoordinatesForStep(
  segment: RouteSegment,
): RouteStep['coordinates'] {
  const coords =
    Array.isArray(segment.renderedCoordinates) &&
    segment.renderedCoordinates.length >= 2
      ? segment.renderedCoordinates
      : segment.coordinates;
  return coords.map(coord => ({
    latitude: coord.latitude,
    longitude: coord.longitude,
  }));
}

/** 구간 거리·시간·승하차 지점을 조합해 타임라인의 보조 설명을 생성합니다. 입력 경로 정보는 변경하지 않습니다. */
export function buildSegmentStepDescription(
  segment: RouteSegment,
  fallback?: string,
): string | undefined {
  if (segment.mode === 'TRANSFER') {
    const durationText =
      typeof segment.duration === 'number'
        ? formatDuration(segment.duration)
        : undefined;
    return ['환승', durationText].filter(Boolean).join(' · ') || undefined;
  }
  if (fallback?.trim()) return fallback;
  const distanceText = formatDistance(segment.distance);
  const durationText =
    typeof segment.duration === 'number'
      ? formatDuration(segment.duration)
      : undefined;
  const destinationText = segment.toName?.trim()
    ? `${segment.toName.trim()}까지`
    : undefined;
  return (
    [destinationText, distanceText, durationText].filter(Boolean).join(' · ') ||
    undefined
  );
}

/** 구간 수단과 노선·출발·도착 정보를 조합해 타임라인 대표 제목을 생성합니다. 입력 경로 정보는 변경하지 않습니다. */
export function buildSegmentStepTitle(
  segment: RouteSegment,
  fallback?: string,
): string {
  if (segment.mode === 'TRANSFER') return '환승';
  if (fallback?.trim()) return fallback;
  if (segment.mode === 'BUS' || segment.mode === 'SUBWAY') {
    return (
      segment.fromName?.trim() ||
      segment.lineName?.trim() ||
      (segment.mode === 'BUS' ? '버스 승차' : '지하철 승차')
    );
  }
  return '도보';
}

/** 기본 경로 정보에 정규화 세그먼트 단계와 형상을 병합해 저장 가능한 경로 정보를 만듭니다. 입력 경로 정보는 변경하지 않습니다. */
export function buildRouteInfoFromNormalizedRoute(
  baseRouteInfo: RouteInfo,
  route: NormalizedRoute | undefined,
): RouteInfo {
  if (!route?.segments?.length) return baseRouteInfo;
  const originStep =
    baseRouteInfo.steps.find(step => step.type === 'ORIGIN') ??
    baseRouteInfo.steps[0];
  const destinationStep =
    [...baseRouteInfo.steps]
      .reverse()
      .find(step => step.type === 'DESTINATION') ??
    baseRouteInfo.steps[baseRouteInfo.steps.length - 1];
  const baseTravelSteps = baseRouteInfo.steps.filter(
    step => step.type !== 'ORIGIN' && step.type !== 'DESTINATION',
  );
  const segmentSteps: RouteStep[] = route.segments.map((segment, index) => {
    const baseStep = baseTravelSteps[index];
    const type = routeStepTypeFromSegmentMode(segment.mode);
    const lineColor =
      segment.mode === 'BUS' || segment.mode === 'SUBWAY'
        ? getSegmentColor(segment)
        : undefined;
    return {
      ...baseStep,
      id: baseStep?.id ?? `leg-${index}`,
      type,
      title: buildSegmentStepTitle(segment, baseStep?.title),
      description: buildSegmentStepDescription(segment, baseStep?.description),
      durationMinutes:
        typeof segment.duration === 'number'
          ? Math.max(1, Math.round(segment.duration))
          : baseStep?.durationMinutes,
      distanceMeters: segment.distance ?? baseStep?.distanceMeters,
      lineName: segment.lineName ?? baseStep?.lineName,
      lineColor: lineColor ?? baseStep?.lineColor,
      badgeText: segment.lineName ?? baseStep?.badgeText,
      coordinates: routeSegmentCoordinatesForStep(segment),
    };
  });

  return {
    ...baseRouteInfo,
    id: route.id || baseRouteInfo.id,
    totalDurationMinutes:
      typeof route.totalDuration === 'number'
        ? Math.max(0, Math.round(route.totalDuration))
        : baseRouteInfo.totalDurationMinutes,
    fare: route.fare ?? baseRouteInfo.fare,
    totalDistanceMeters:
      route.totalDistance ?? baseRouteInfo.totalDistanceMeters,
    steps: [originStep, ...segmentSteps, destinationStep].filter(
      (step): step is RouteStep => !!step,
    ),
  };
}

/** 대중교통 구간에서 첫 대표 버스·지하철 노선명을 선택합니다. 입력 경로 정보는 변경하지 않습니다. */
export function getPrimaryTransitLineLabel(legs?: TransitLegDetail[]): string {
  const firstRide = Array.isArray(legs)
    ? legs.find(leg => isRideLegKind(leg.kind))
    : undefined;
  return (
    compactTransitLineLabel(firstRide?.lineName) ??
    compactTransitLineLabel(firstRide?.label) ??
    '대중교통'
  );
}

/** 저장 경로 단계 좌표를 수단별 지도 선 오버레이로 변환합니다. 입력 경로 정보는 변경하지 않습니다. */
export function buildRouteInfoPathOverlays(
  routeInfo: RouteInfo | undefined,
  mapZoom: number,
): TmapPathOverlay[] {
  if (!routeInfo) return [];
  const walkGuide = getTransitWalkGuidePresentation(mapZoom);
  const movementSteps = routeInfo.steps.filter(
    step => step.type !== 'ORIGIN' && step.type !== 'DESTINATION',
  );
  const isWalkingOnlyRoute =
    movementSteps.length > 0 &&
    movementSteps.every(step => step.type === 'WALK');
  const isBicycleOnlyRoute =
    movementSteps.length > 0 &&
    movementSteps.every(step => step.type === 'BIKE');
  if (isWalkingOnlyRoute || isBicycleOnlyRoute) {
    const routeCoords = movementSteps.flatMap(step => step.coordinates ?? []);
    const dedupedCoords = routeCoords.filter((coord, index) => {
      const previous = routeCoords[index - 1];
      return (
        !previous ||
        previous.latitude !== coord.latitude ||
        previous.longitude !== coord.longitude
      );
    });
    if (dedupedCoords.length >= 2) {
      const originCoord = routeInfo.steps.find(step => step.type === 'ORIGIN')
        ?.coordinates?.[0];
      const destinationCoord = routeInfo.steps.find(
        step => step.type === 'DESTINATION',
      )?.coordinates?.[0];
      let endpointAlignedPath = dedupedCoords.map(coord => ({
        lat: coord.latitude,
        lng: coord.longitude,
      }));
      endpointAlignedPath = joinWalkPathEndpoint(
        endpointAlignedPath,
        originCoord
          ? { lat: originCoord.latitude, lng: originCoord.longitude }
          : undefined,
        'start',
      ).pathCoords;
      endpointAlignedPath = joinWalkPathEndpoint(
        endpointAlignedPath,
        destinationCoord
          ? { lat: destinationCoord.latitude, lng: destinationCoord.longitude }
          : undefined,
        'end',
      ).pathCoords;
      return [
        {
          id: `${routeInfo.id}-${isBicycleOnlyRoute ? 'bike' : 'walk'}-route`,
          coords: endpointAlignedPath.map(coord => ({
            latitude: coord.lat,
            longitude: coord.lng,
          })),
          color: isBicycleOnlyRoute
            ? ROUTE_LINE_STYLE.bike.color
            : ROUTE_WALK_GUIDE_COLOR,
          width: isBicycleOnlyRoute
            ? getBikeWidth(mapZoom)
            : getWalkWidth(mapZoom),
          opacity: isBicycleOnlyRoute
            ? ROUTE_LINE_STYLE.bike.opacity
            : ROUTE_LINE_STYLE.walk.opacity,
          outlineColor: isBicycleOnlyRoute
            ? ROUTE_LINE_STYLE.bike.casingColor
            : ROUTE_WALK_CASING_COLOR,
          outlineWidth: isBicycleOnlyRoute
            ? getBikeOutlineWidth(mapZoom)
            : getWalkOutlineWidth(mapZoom),
          outlineOpacity: isBicycleOnlyRoute
            ? ROUTE_LINE_STYLE.bike.casingOpacity
            : ROUTE_WALK_CASING_OPACITY,
          dashPattern: isBicycleOnlyRoute
            ? undefined
            : [...walkGuide.dashPattern],
          strokeStyle: isBicycleOnlyRoute ? 'solid' : walkGuide.strokeStyle,
          outlineStrokeStyle: isBicycleOnlyRoute
            ? 'solid'
            : walkGuide.outlineStrokeStyle,
          renderMode: 'native',
          nativeDirection: isBicycleOnlyRoute && ROUTE_LINE_STYLE.bike.arrows,
          nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
          nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
          zIndex: isBicycleOnlyRoute
            ? ROUTE_LINE_STYLE.bike.zIndex
            : ROUTE_LINE_STYLE.walk.zIndex,
        },
      ];
    }
  }
  return routeInfo.steps.flatMap((step, index) => {
    if (step.type === 'ORIGIN' || step.type === 'DESTINATION') return [];
    if (!Array.isArray(step.coordinates) || step.coordinates.length < 2)
      return [];
    const isWalk = step.type === 'WALK' || step.type === 'TRANSFER';
    const isTransitRide = step.type === 'BUS' || step.type === 'SUBWAY';
    const isDrive = step.type === 'DRIVE';
    const isBike = step.type === 'BIKE';
    // Transit fallback에는 viewport-aware carrier 계획이 없으므로 SDK 기본 과밀 화살표를 켜지 않는다.
    // 정상 대중교통 경로는 NormalizedRoute 분기에서 native direction window를 사용한다.
    const rendersNativeDirection =
      (isDrive || isBike) && ENABLE_NATIVE_ROUTE_DIRECTION;
    const color = isWalk
      ? step.type === 'TRANSFER'
        ? ROUTE_TRANSFER_GUIDE_COLOR
        : ROUTE_WALK_GUIDE_COLOR
      : isDrive
      ? ROUTE_LINE_STYLE.drive.color
      : isBike
      ? ROUTE_LINE_STYLE.bike.color
      : getRouteStepColor(step);
    const width = isWalk
      ? getWalkWidth(mapZoom)
      : isDrive
      ? getDriveWidth(mapZoom)
      : isBike
      ? getBikeWidth(mapZoom)
      : getTransitMainWidth(mapZoom);
    const outlineColor = isWalk
      ? ROUTE_WALK_CASING_COLOR
      : isDrive
      ? ROUTE_LINE_STYLE.drive.casingColor
      : isBike
      ? ROUTE_LINE_STYLE.bike.casingColor
      : ROUTE_LINE_STYLE.transit.casingColor;
    const outlineWidth = isWalk
      ? getWalkOutlineWidth(mapZoom)
      : isDrive
      ? getDriveOutlineWidth(mapZoom)
      : isBike
      ? getBikeOutlineWidth(mapZoom)
      : getTransitCasingExtraWidth(mapZoom) / 2;
    return [
      {
        id: `${routeInfo.id}-${step.id}`,
        coords: step.coordinates,
        color,
        width,
        opacity: isWalk
          ? ROUTE_LINE_STYLE.walk.opacity
          : isBike
          ? ROUTE_LINE_STYLE.bike.opacity
          : 1,
        outlineColor,
        outlineWidth,
        outlineOpacity: isWalk
          ? ROUTE_WALK_CASING_OPACITY
          : isDrive
          ? ROUTE_LINE_STYLE.drive.casingOpacity
          : isBike
          ? ROUTE_LINE_STYLE.bike.casingOpacity
          : ROUTE_LINE_STYLE.transit.casingOpacity,
        dashPattern: isWalk ? [...walkGuide.dashPattern] : undefined,
        strokeStyle: isWalk ? walkGuide.strokeStyle : 'solid',
        outlineStrokeStyle: isWalk ? walkGuide.outlineStrokeStyle : 'solid',
        renderMode: 'native',
        nativeDirection: rendersNativeDirection,
        nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
        nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
        zIndex:
          (isTransitRide
            ? ROUTE_LINE_STYLE.transit.busZIndex
            : isDrive
            ? ROUTE_LINE_STYLE.drive.zIndex
            : isBike
            ? ROUTE_LINE_STYLE.bike.zIndex
            : ROUTE_LINE_STYLE.walk.zIndex) + index,
      } as TmapPathOverlay,
    ];
  });
}

/** 출발·도착 지점과 본 경로 사이의 접근 경로를 별도 오버레이로 생성합니다. 입력 경로 정보는 변경하지 않습니다. */
export function buildRouteEndpointAccessOverlays(
  accessPaths: RouteEndpointAccessPath[],
  mapZoom: number,
  _isDark: boolean,
): TmapPathOverlay[] {
  if (!accessPaths.length) return [];
  const walkGuide = getTransitWalkGuidePresentation(mapZoom);

  return accessPaths.flatMap((accessPath, accessIndex) => {
    const displayCoords = toDisplayOverlayCoords(accessPath.pathCoords, 'WALK');
    if (displayCoords.length < 2) return [];
    const zIndex = 32 + accessIndex;
    const overlays: TmapPathOverlay[] = [
      {
        id: `${accessPath.id}-support`,
        coords: displayCoords,
        color: ROUTE_WALK_GUIDE_COLOR,
        width: getWalkWidth(mapZoom),
        opacity: ROUTE_LINE_STYLE.walk.opacity,
        outlineColor: ROUTE_WALK_CASING_COLOR,
        outlineWidth: getWalkOutlineWidth(mapZoom),
        outlineOpacity: ROUTE_WALK_CASING_OPACITY,
        dashPattern: [...walkGuide.dashPattern],
        strokeStyle: walkGuide.strokeStyle,
        outlineStrokeStyle: walkGuide.outlineStrokeStyle,
        renderMode: 'native',
        zIndex,
      },
    ];

    accessPath.schematicPaths.forEach((schematicPath, schematicIndex) => {
      const schematicCoords = toDisplayOverlayCoords(schematicPath);
      if (schematicCoords.length < 2) return;
      overlays.push({
        id: `${accessPath.id}-network-link-${schematicIndex}`,
        coords: schematicCoords,
        color: ROUTE_TRANSFER_GUIDE_COLOR,
        width: Math.max(2.2, getWalkWidth(mapZoom) - 0.4),
        opacity: ROUTE_LINE_STYLE.transfer.opacity,
        outlineColor: ROUTE_WALK_CASING_COLOR,
        outlineWidth: getWalkOutlineWidth(mapZoom),
        outlineOpacity: ROUTE_WALK_CASING_OPACITY,
        dashPattern: [...walkGuide.dashPattern],
        strokeStyle: walkGuide.strokeStyle,
        outlineStrokeStyle: walkGuide.outlineStrokeStyle,
        renderMode: 'native',
        zIndex: zIndex - 1,
      });
    });

    return overlays;
  });
}

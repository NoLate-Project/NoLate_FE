/** 대중교통 API 응답을 지도에 표시 가능한 정규화 세그먼트와 형상 품질 정보로 변환합니다. */
import {
  type RouteAlternativeOption,
  type RoutePathCoord,
  type TransitLegDetail,
  type TransitPassStop,
} from '../../map/routingService';
import { type TmapLatLng } from '../../map/TmapMapView';
import { resolveDetailedWalkGeometrySource } from '../../map/savedRouteMapPresentation';
import { splitWalkPathAtDiscontinuities } from '../../map/transitRouteGeometry';
import {
  getNormalizedFallbackRouteMode,
  getNormalizedTransitLegMode,
} from '../../map/transitRouteSegmentPolicy';
import {
  type Coordinate,
  ENABLE_NATIVE_ROUTE_DIRECTION,
  type GeometrySource,
  getMapBusRouteColor,
  isTransitRideSegmentMode,
  type NormalizedRoute,
  normalizeRouteColor,
  type RouteAnchor,
  type RouteGeometryQuality,
  type RouteMode,
  type RouteSegment,
  type TransitStopAnchor,
  warnRouteDebug,
} from './routeMapTypesAndStyle';
import {
  ensureTransitSegmentPathOrder,
  isValidCoordinate,
  routePathCoordsToCoordinates,
  toCoordinate,
} from './routeMapCoordinate';
import {
  createRenderedCoordinateParts,
  createRenderedCoordinates,
  createTransitStopAnchor,
  createWalkEndpointAnchor,
  dedupeCoordinatesByDistance,
  getRouteGeometryQuality,
  hasRouteAnchorAdjustment,
  slicePolylineBetweenAnchors,
} from './routeMapAnchors';
import {
  getSubwayLineColor,
  getTransitLegAlightCoord,
  getTransitLegBoardCoord,
  isRideLegKind,
} from './routeTransitLegCoordinates';
import {
  alignWalkPathToRideEndpoints,
  buildEndpointPathCoords,
  normalizeDisplayPathCoords,
  routeCoordDistanceMeters,
  toDisplayOverlayCoords,
} from './routeTransitWalkGeometry';
import {
  compactTransitLineLabel,
  getBusBadgeType,
  getBusLineColor as getSharedBusLineColor,
} from '../routeInfo';

/** 경로 후보가 QA용 수동 샘플 형상을 포함하는지 식별자로 판별합니다. */
export function isManualSampleRouteOption(
  option: RouteAlternativeOption | undefined,
): boolean {
  return typeof option?.id === 'string' && option.id.startsWith('qa-');
}

export type RouteSegmentGeometry = {
  rawCoordinates?: Coordinate[];
  coordinates: Coordinate[];
  coordinateParts?: Coordinate[][];
  geometrySource?: GeometrySource;
  geometryQuality?: RouteGeometryQuality;
  startAnchor?: RouteAnchor;
  endAnchor?: RouteAnchor;
  boardAnchor?: TransitStopAnchor;
  alightAnchor?: TransitStopAnchor;
  rawPointCount?: number;
};

/** API 경로 좌표 목록을 유효한 지도 좌표 목록으로 변환합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function routePathCoordsToMapCoordinates(
  pathCoords: RoutePathCoord[] | undefined,
  kind?: TransitLegDetail['kind'],
): Coordinate[] {
  return toDisplayOverlayCoords(pathCoords, kind).filter(isValidCoordinate);
}

/** 통과 정류장 목록에서 유효한 좌표만 골라 지도 좌표로 변환합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function passStopsToMapCoordinates(
  passStops?: TransitPassStop[],
): Coordinate[] {
  if (!Array.isArray(passStops)) return [];
  const coordinates = passStops
    .map(stop => stop.coord)
    .filter(
      (coord): coord is RoutePathCoord =>
        !!coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng),
    )
    .map(coord => ({ latitude: coord.lat, longitude: coord.lng }));
  return dedupeCoordinatesByDistance(coordinates, 1.5);
}

/** 개발 빌드에서만 경로 형상 fallback 사유와 구간 정보를 진단 로그로 남깁니다. 입력 경로 데이터는 변경하지 않습니다. */
export function warnRouteGeometryFallback(
  reason: 'PASS_STOP_LIST' | 'START_END_ONLY' | 'UNKNOWN',
  leg: TransitLegDetail,
  legIndex: number,
) {
  if (typeof __DEV__ === 'boolean' && !__DEV__) return;
  if (leg.kind === 'WALK' && (leg.distanceMeters ?? 0) <= 1) return;
  console.warn('[route-geometry] fallback', {
    reason,
    legIndex,
    kind: leg.kind,
    lineName: leg.lineName,
    label: leg.label,
    pathGeometrySource: leg.pathGeometrySource,
    rawPathPointCount: leg.rawPathPointCount,
    pathCoordsLength: leg.pathCoords?.length ?? 0,
    passStopsLength: leg.passStops?.length ?? 0,
  });
}

/** 구간 형상 메타데이터를 검사해 실제 좌표 출처를 표준 형상 출처 값으로 정규화합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function getLegGeometrySource(
  leg: TransitLegDetail,
  mode: RouteMode,
): GeometrySource | undefined {
  if (leg.pathGeometrySource) return leg.pathGeometrySource;
  // 환승 구간은 화면 모드만 TRANSFER로 바뀌며 원본 보행 geometry의 출처는 유지한다.
  if (leg.pathCoordsIsExact && leg.kind === 'WALK')
    return 'WALK_STEPS_LINESTRING';
  if (leg.pathCoordsIsExact && (mode === 'BUS' || mode === 'SUBWAY'))
    return 'TRANSIT_PASS_SHAPE_LINESTRING';
  return undefined;
}

/** 대중교통 구간의 API 형상·정류장·승하차 앵커를 결합해 표시 좌표와 품질 정보를 생성합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function buildTransitLegSegmentGeometry(
  routeId: string | undefined,
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  mode: RouteMode,
  walkOverlayById?: Map<string, TmapLatLng[]>,
  isManualSamplePath = false,
): RouteSegmentGeometry {
  if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length)
    return { coordinates: [] };
  const leg = legs[legIndex];
  const legSource = getLegGeometrySource(leg, mode);
  const segmentId = `${routeId ?? 'route'}-segment-${legIndex}`;

  if (isRideLegKind(leg.kind)) {
    const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
    const basePath =
      Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
        : [];
    const routeCoordinates = routePathCoordsToCoordinates(basePath);
    const boardAnchor = createTransitStopAnchor(
      toCoordinate(getTransitLegBoardCoord(leg)),
      routeCoordinates,
      'start',
      {
        id: `${segmentId}-boarding`,
        name: leg.startName,
        type: 'BOARDING',
        segmentId,
      },
    );
    const alightAnchor = createTransitStopAnchor(
      toCoordinate(getTransitLegAlightCoord(leg)),
      routeCoordinates,
      'end',
      {
        id: `${segmentId}-alighting`,
        name: leg.endName,
        type: 'ALIGHTING',
        segmentId,
      },
    );
    const displayCoords =
      routeCoordinates.length >= 2
        ? slicePolylineBetweenAnchors(
            routeCoordinates,
            boardAnchor,
            alightAnchor,
          )
        : [];
    if (displayCoords.length >= 2) {
      if (legSource === 'PASS_STOP_LIST')
        warnRouteGeometryFallback('PASS_STOP_LIST', leg, legIndex);
      if (!legSource || legSource === 'UNKNOWN')
        warnRouteGeometryFallback('UNKNOWN', leg, legIndex);
      const anchorAdjusted =
        displayCoords.length !== routeCoordinates.length ||
        hasRouteAnchorAdjustment([boardAnchor, alightAnchor]);
      return {
        rawCoordinates:
          rawCoordinates.length >= 2 ? rawCoordinates : routeCoordinates,
        coordinates: displayCoords,
        geometrySource: legSource ?? 'UNKNOWN',
        geometryQuality: getRouteGeometryQuality(
          mode,
          legSource ?? 'UNKNOWN',
          displayCoords.length,
          isManualSamplePath,
          [boardAnchor, alightAnchor],
          anchorAdjusted,
        ),
        startAnchor: boardAnchor,
        endAnchor: alightAnchor,
        boardAnchor,
        alightAnchor,
        rawPointCount:
          leg.rawPathPointCount ??
          leg.pathCoords?.length ??
          displayCoords.length,
      };
    }

    if (rawCoordinates.length >= 2) {
      if (legSource === 'PASS_STOP_LIST')
        warnRouteGeometryFallback('PASS_STOP_LIST', leg, legIndex);
      if (!legSource || legSource === 'UNKNOWN')
        warnRouteGeometryFallback('UNKNOWN', leg, legIndex);
      return {
        rawCoordinates,
        coordinates: rawCoordinates,
        geometrySource: legSource ?? 'UNKNOWN',
        geometryQuality: getRouteGeometryQuality(
          mode,
          legSource ?? 'UNKNOWN',
          rawCoordinates.length,
          isManualSamplePath,
          [boardAnchor, alightAnchor],
          false,
        ),
        startAnchor: boardAnchor,
        endAnchor: alightAnchor,
        boardAnchor,
        alightAnchor,
        rawPointCount:
          leg.rawPathPointCount ??
          leg.pathCoords?.length ??
          rawCoordinates.length,
      };
    }
  }

  // ODsay의 기타 교통수단(셔틀·선박 등)도 공급자가 준 실제 geometry는 버리지 않는다.
  // 교통수단을 확정할 수 없으므로 중립 실선·무화살표인 UNKNOWN으로 표시한다.
  if (
    leg.kind === 'ETC' &&
    Array.isArray(leg.pathCoords) &&
    leg.pathCoords.length >= 2
  ) {
    const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
    const coordinates = routePathCoordsToMapCoordinates(
      leg.pathCoords,
      leg.kind,
    );
    if (coordinates.length >= 2) {
      const geometrySource = legSource ?? 'UNKNOWN';
      return {
        rawCoordinates:
          rawCoordinates.length >= 2 ? rawCoordinates : coordinates,
        coordinates,
        geometrySource,
        geometryQuality: getRouteGeometryQuality(
          mode,
          geometrySource,
          coordinates.length,
          isManualSamplePath,
        ),
        rawPointCount: leg.rawPathPointCount ?? leg.pathCoords.length,
      };
    }
  }

  if (leg.kind === 'WALK') {
    const baseId = routeId ? `${routeId}-walk-leg-${legIndex}` : undefined;
    const walkDetailCoords =
      baseId && walkOverlayById
        ? walkOverlayById.get(baseId) ?? walkOverlayById.get(`${baseId}-path`)
        : undefined;

    // 보행 상세 조회가 끝났다면 출발/도착 및 승하차점에 보정된 좌표를 우선 사용한다.
    if (Array.isArray(walkDetailCoords) && walkDetailCoords.length >= 2) {
      const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
      const filteredCoords = walkDetailCoords.filter(isValidCoordinate);
      // walkOverlayById는 공급자 정밀 linestring 또는 별도 보행 API 성공 결과만 담는다.
      // 정규화 후 overlay id가 segment id로 바뀌어도 저장 단계에서 provenance를 남길 수 있게 한다.
      const geometrySource = resolveDetailedWalkGeometrySource(legSource);
      const startAnchor = createWalkEndpointAnchor(
        `${segmentId}-walk-start`,
        'WALK_START',
        rawCoordinates[0] ?? filteredCoords[0],
        filteredCoords[0],
        segmentId,
      );
      const endAnchor = createWalkEndpointAnchor(
        `${segmentId}-walk-end`,
        'WALK_END',
        rawCoordinates[rawCoordinates.length - 1] ??
          filteredCoords[filteredCoords.length - 1],
        filteredCoords[filteredCoords.length - 1],
        segmentId,
      );
      return {
        rawCoordinates:
          rawCoordinates.length >= 2 ? rawCoordinates : filteredCoords,
        coordinates: filteredCoords,
        geometrySource,
        geometryQuality: getRouteGeometryQuality(
          mode,
          geometrySource,
          filteredCoords.length,
          isManualSamplePath,
          [startAnchor, endAnchor],
          hasRouteAnchorAdjustment([startAnchor, endAnchor]),
        ),
        startAnchor,
        endAnchor,
        rawPointCount: leg.rawPathPointCount ?? walkDetailCoords.length,
      };
    }

    if (Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2) {
      const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
      const alignedPath = alignWalkPathToRideEndpoints(
        legs,
        legIndex,
        leg.pathCoords,
      );
      const coordinateParts = splitWalkPathAtDiscontinuities(alignedPath)
        .map(part => routePathCoordsToMapCoordinates(part, leg.kind))
        .filter(part => part.length >= 2);
      const coordinates =
        coordinateParts.length > 0
          ? coordinateParts.flat()
          : routePathCoordsToMapCoordinates(alignedPath, leg.kind);
      if (coordinates.length >= 2) {
        const geometrySource =
          legSource ??
          (leg.pathCoordsIsExact ? 'WALK_STEPS_LINESTRING' : 'UNKNOWN');
        const startAnchor = createWalkEndpointAnchor(
          `${segmentId}-walk-start`,
          'WALK_START',
          rawCoordinates[0],
          coordinates[0],
          segmentId,
        );
        const endAnchor = createWalkEndpointAnchor(
          `${segmentId}-walk-end`,
          'WALK_END',
          rawCoordinates[rawCoordinates.length - 1],
          coordinates[coordinates.length - 1],
          segmentId,
        );
        const anchorAdjusted =
          alignedPath.length !== leg.pathCoords.length ||
          hasRouteAnchorAdjustment([startAnchor, endAnchor]);
        return {
          rawCoordinates:
            rawCoordinates.length >= 2 ? rawCoordinates : coordinates,
          coordinates,
          coordinateParts:
            coordinateParts.length > 1 ? coordinateParts : undefined,
          geometrySource,
          geometryQuality: getRouteGeometryQuality(
            mode,
            geometrySource,
            coordinates.length,
            isManualSamplePath,
            [startAnchor, endAnchor],
            anchorAdjusted,
          ),
          startAnchor,
          endAnchor,
          rawPointCount: leg.rawPathPointCount ?? leg.pathCoords.length,
        };
      }
    }
  }

  const passStopCoords = passStopsToMapCoordinates(leg.passStops);
  if (passStopCoords.length >= 2) {
    warnRouteGeometryFallback('PASS_STOP_LIST', leg, legIndex);
    return {
      coordinates: passStopCoords,
      geometrySource: 'PASS_STOP_LIST',
      geometryQuality: getRouteGeometryQuality(
        mode,
        'PASS_STOP_LIST',
        passStopCoords.length,
        isManualSamplePath,
      ),
      rawPointCount: passStopCoords.length,
    };
  }

  if (isRideLegKind(leg.kind)) {
    warnRouteGeometryFallback('UNKNOWN', leg, legIndex);
    return {
      coordinates: [],
      geometrySource: legSource ?? 'UNKNOWN',
      geometryQuality: getRouteGeometryQuality(
        mode,
        legSource ?? 'UNKNOWN',
        0,
        isManualSamplePath,
      ),
      rawPointCount: leg.rawPathPointCount,
    };
  }

  const endpointPath = buildEndpointPathCoords(leg);
  const endpointDistanceMeters =
    endpointPath.length >= 2
      ? routeCoordDistanceMeters(
          endpointPath[0],
          endpointPath[endpointPath.length - 1],
        )
      : 0;
  const endpointCoords = routePathCoordsToMapCoordinates(
    leg.kind === 'WALK'
      ? alignWalkPathToRideEndpoints(legs, legIndex, endpointPath)
      : endpointPath,
    leg.kind,
  );
  if (endpointCoords.length >= 2) {
    warnRouteGeometryFallback('START_END_ONLY', leg, legIndex);
    if (
      (mode === 'WALK' || mode === 'TRANSFER') &&
      endpointDistanceMeters > 40
    ) {
      warnRouteDebug('[route-geometry] hidden long direct walk fallback', {
        legIndex,
        mode,
        distanceMeters: Math.round(endpointDistanceMeters),
        label: leg.label,
        startName: leg.startName,
        endName: leg.endName,
      });
      return {
        coordinates: [],
        geometrySource: 'START_END_ONLY',
        geometryQuality: getRouteGeometryQuality(
          mode,
          'START_END_ONLY',
          endpointCoords.length,
          isManualSamplePath,
        ),
        rawPointCount: endpointCoords.length,
      };
    }
    return {
      coordinates: endpointCoords,
      geometrySource: 'START_END_ONLY',
      geometryQuality: getRouteGeometryQuality(
        mode,
        'START_END_ONLY',
        endpointCoords.length,
        isManualSamplePath,
      ),
      rawPointCount: endpointCoords.length,
    };
  }

  warnRouteGeometryFallback('UNKNOWN', leg, legIndex);
  return {
    coordinates: [],
    geometrySource: legSource ?? 'UNKNOWN',
    geometryQuality: getRouteGeometryQuality(
      mode,
      legSource ?? 'UNKNOWN',
      0,
      isManualSamplePath,
    ),
    rawPointCount: leg.rawPathPointCount,
  };
}

/** 구간 형상 생성 결과에서 지도 오버레이에 사용할 대표 좌표 목록을 반환합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function getTransitLegMapCoords(
  routeId: string | undefined,
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
  walkOverlayById?: Map<string, TmapLatLng[]>,
): TmapLatLng[] {
  if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length)
    return [];
  const mode = resolveRouteSegmentMode(legs[legIndex], legIndex, legs);
  const geometry = buildTransitLegSegmentGeometry(
    routeId,
    legs,
    legIndex,
    mode,
    walkOverlayById,
  );
  return geometry.coordinates.map(coord => ({
    latitude: coord.latitude,
    longitude: coord.longitude,
  }));
}

/** 대중교통 구간 종류를 앱의 정규화된 경로 세그먼트 수단으로 변환합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function resolveRouteSegmentMode(
  leg: TransitLegDetail,
  index: number,
  legs: TransitLegDetail[] | undefined,
): RouteMode {
  return getNormalizedTransitLegMode(leg, index, legs);
}

/** 경로 후보의 모든 구간을 이동 순서와 앵커가 보존된 정규화 경로로 변환합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function normalizeRouteAlternativeToSegments(
  option: RouteAlternativeOption | undefined,
  walkOverlayById?: Map<string, TmapLatLng[]>,
): NormalizedRoute | undefined {
  if (!option) return undefined;

  const segments: RouteSegment[] = [];
  const isManualSamplePath = isManualSampleRouteOption(option);
  if (Array.isArray(option.transitLegs) && option.transitLegs.length > 0) {
    option.transitLegs.forEach((leg, index) => {
      const mode = resolveRouteSegmentMode(leg, index, option.transitLegs);
      const geometry = buildTransitLegSegmentGeometry(
        option.id,
        option.transitLegs,
        index,
        mode,
        walkOverlayById,
        isManualSamplePath,
      );
      const lineLabel =
        compactTransitLineLabel(leg.lineName) ??
        compactTransitLineLabel(leg.label);
      const busType =
        leg.kind === 'BUS' ? getBusBadgeType(lineLabel) : undefined;
      const routeColor =
        leg.kind === 'BUS'
          ? normalizeRouteColor(leg.lineColor) ??
            getSharedBusLineColor(lineLabel, leg.lineColor)
          : leg.kind === 'SUBWAY'
          ? getSubwayLineColor(leg.lineName ?? leg.label)
          : undefined;
      const displayColor =
        leg.kind === 'BUS'
          ? getMapBusRouteColor(lineLabel, busType)
          : routeColor;
      const baseSegment = ensureTransitSegmentPathOrder({
        id: `${option.id}-segment-${index}`,
        mode,
        rawCoordinates: geometry.rawCoordinates,
        coordinates: geometry.coordinates,
        coordinateParts: geometry.coordinateParts,
        distance: leg.distanceMeters,
        duration: leg.durationMinutes,
        lineName: lineLabel,
        lineColor: routeColor,
        routeColor,
        displayColor,
        busType,
        fromName: leg.startName,
        toName: leg.endName,
        geometrySource: geometry.geometrySource,
        geometryQuality:
          geometry.geometryQuality ??
          getRouteGeometryQuality(
            mode,
            geometry.geometrySource,
            geometry.coordinates.length,
            isManualSamplePath,
          ),
        isManualSamplePath,
        nativeDirectionEnabled:
          isTransitRideSegmentMode(mode) && ENABLE_NATIVE_ROUTE_DIRECTION,
        startAnchor: geometry.startAnchor ?? geometry.boardAnchor,
        endAnchor: geometry.endAnchor ?? geometry.alightAnchor,
        boardAnchor: geometry.boardAnchor,
        alightAnchor: geometry.alightAnchor,
        rawPointCount: geometry.rawPointCount,
        sequence: index,
      });
      const renderedCoordinates = createRenderedCoordinates(baseSegment);
      const renderedCoordinateParts =
        createRenderedCoordinateParts(baseSegment);
      segments.push({
        ...baseSegment,
        renderedCoordinates,
        renderedCoordinateParts,
        renderPointCount: renderedCoordinates.length,
      });
    });
  } else {
    const coordinates = toDisplayOverlayCoords(
      option.pathCoords,
      option.mode === 'WALK' ? 'WALK' : undefined,
    );
    if (coordinates.length > 0) {
      const fallbackMode = getNormalizedFallbackRouteMode(option.mode);
      segments.push({
        id: `${option.id}-segment-0`,
        mode: fallbackMode,
        coordinates,
        distance: option.distanceMeters,
        duration: option.minutes,
        geometrySource:
          Array.isArray(option.pathCoords) && option.pathCoords.length >= 2
            ? 'UNKNOWN'
            : 'START_END_ONLY',
        geometryQuality: getRouteGeometryQuality(
          fallbackMode,
          Array.isArray(option.pathCoords) && option.pathCoords.length >= 2
            ? 'UNKNOWN'
            : 'START_END_ONLY',
          coordinates.length,
          isManualSamplePath,
        ),
        isManualSamplePath,
        nativeDirectionEnabled:
          fallbackMode === 'TRANSIT' && ENABLE_NATIVE_ROUTE_DIRECTION,
        rawPointCount: option.pathCoords?.length ?? coordinates.length,
        renderedCoordinates: coordinates,
        renderPointCount: coordinates.length,
        sequence: 0,
      });
    }
  }

  return {
    id: option.id,
    totalDuration: option.minutes,
    totalDistance: option.distanceMeters,
    fare: option.fareWon,
    segments,
  };
}

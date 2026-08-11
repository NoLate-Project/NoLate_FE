/** 대중교통 승하차 이벤트·통과 정류장·노선 식별 지도 마커 생성 모듈입니다. */
import {
  type RoutePathCoord,
  type TransitLegDetail,
} from '../../map/routingService';
import { type TmapMarker } from '../../map/TmapMapView';
import { resolveTransitRouteNodeCoordinate } from '../../map/transitRouteGeometry';
import {
  buildTransitLegInteractionId,
  buildTransitStopInteractionId,
} from '../../map/transitMapInteraction';
import {
  allocateTransitStopMarkerCounts,
  getTransitStopMarkerPolicy,
  sampleTransitStopIndices,
  type TransitStopMarkerKind,
} from '../../map/transitStopVisibility';
import { getTransitBoardingDirectionHint } from '../../map/transitStopLabelPresentation';
import { collapseRedundantTransferAlights } from '../../map/transitMarkerHierarchy';
import {
  getTransitEventMarkerPresentation,
  getTransitModeMarkerStyle,
  shouldPreserveTransitBoundaryEvents,
  shouldShowTransitRouteIdentityLabel,
} from '../../map/transitMarkerPresentation';
import { selectTransitRouteLabelCoordinate } from '../../map/transitRouteLabelPlacement';
import {
  TRANSIT_LEG_COLOR,
  compactTransitStopLabel,
  getTransitLegKindMeta,
} from './presentation';
import { type NormalizedRoute } from './routeMapTypesAndStyle';
import {
  routePathCoordsToCoordinates,
  toCoordinate,
  toRoutePathCoord,
} from './routeMapCoordinate';
import { createTransitStopAnchor } from './routeMapAnchors';
import {
  getRideStopRouteMarkerCoord,
  getTransitKindLineColor,
  getTransitLegAlightAnchorOnPath,
  getTransitLegAlightCoord,
  getTransitLegBoardAnchorOnPath,
  getTransitLegBoardCoord,
  getTransitLegEndCoord,
  getTransitLegStartCoord,
  isRideLegKind,
} from './routeTransitLegCoordinates';
import {
  getRideStopVisualCoord,
  normalizeDisplayPathCoords,
  routeCoordDistanceMeters,
} from './routeTransitWalkGeometry';
import { compactTransitLineLabel } from '../routeInfo';

export const TRANSIT_BADGE_MAX_COUNT = 18;
const KAKAO_LABEL_TEXT_COLOR = '#1F2937';
const KAKAO_LABEL_BORDER_COLOR = 'rgba(148,163,184,0.62)';

/** 사용자가 지도에서 선택한 대중교통 구간과 통과 정류장 인덱스입니다. */
export type SelectedTransitMapStop = {
  legIndex: number;
  stopIndex: number;
};

/** 정류장명의 괄호·역 접미어·중복 공백을 정리해 비교 가능한 이름으로 정규화합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function normalizeTransitStopName(name?: string): string | undefined {
  if (!name) return undefined;
  const normalized = name.trim();
  if (!normalized) return undefined;
  return normalized.length > 16 ? `${normalized.slice(0, 16)}…` : normalized;
}

/** 대중교통 구간의 승차·하차·방면 정보를 지도 배지의 보조 문구로 조합합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function buildTransitLegAssistText(
  legs: TransitLegDetail[] | undefined,
  legIndex: number,
): string | undefined {
  if (!Array.isArray(legs) || !legs[legIndex]) return undefined;
  const leg = legs[legIndex];

  if (isRideLegKind(leg.kind)) {
    const board = normalizeTransitStopName(leg.startName);
    const alight = normalizeTransitStopName(leg.endName);
    if (board && alight) return `${board} · ${alight}까지`;
    if (board) return board;
    if (alight) return `${alight}까지`;
    return undefined;
  }

  if (leg.kind !== 'WALK') return undefined;

  let prevRide: TransitLegDetail | undefined;
  for (let index = legIndex - 1; index >= 0; index -= 1) {
    const candidate = legs[index];
    if (isRideLegKind(candidate.kind)) {
      prevRide = candidate;
      break;
    }
  }
  let nextRide: TransitLegDetail | undefined;
  for (let index = legIndex + 1; index < legs.length; index += 1) {
    const candidate = legs[index];
    if (isRideLegKind(candidate.kind)) {
      nextRide = candidate;
      break;
    }
  }

  if (prevRide && nextRide) {
    const nextKindLabel = getTransitLegKindMeta(nextRide.kind).label;
    const nextBoardName = normalizeTransitStopName(nextRide.startName);
    if (nextBoardName)
      return `환승 도보: ${nextBoardName}(${nextKindLabel})까지 이동`;
    return `환승 도보: ${nextKindLabel} 지점까지 이동`;
  }
  if (nextRide) {
    const nextKindLabel = getTransitLegKindMeta(nextRide.kind).label;
    const nextBoardName = normalizeTransitStopName(nextRide.startName);
    if (nextBoardName)
      return `${nextBoardName}(${nextKindLabel})까지 도보 이동`;
    return `${nextKindLabel} 지점까지 도보 이동`;
  }
  if (prevRide) {
    const prevKindLabel = getTransitLegKindMeta(prevRide.kind).label;
    const prevAlightName = normalizeTransitStopName(prevRide.endName);
    if (prevAlightName)
      return `${prevAlightName}(${prevKindLabel})에서 목적지까지 도보 이동`;
    return `${prevKindLabel} 이후 목적지까지 도보 이동`;
  }
  return '목적지까지 도보 이동';
}

export type TransitEventDraft = {
  coord: RoutePathCoord;
  intent: 'BOARD' | 'ALIGHT' | 'TRANSFER';
  kind: TransitLegDetail['kind'];
  legIndex: number;
  lineLabel?: string;
  lineColor?: string;
  stopName?: string;
  directionLabel?: string;
  badgeSide?: 'left' | 'right';
  boundaryRole?: 'walk-exit' | 'transfer-exit' | 'ride-entry';
  order: number;
};

/** 마커 인덱스와 이벤트 종류를 바탕으로 배지의 좌우 배치 방향을 결정합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function getTransitEventBadgeSide(
  leg: TransitLegDetail,
  intent: 'BOARD' | 'ALIGHT',
): 'left' | 'right' {
  const path = leg.pathCoords ?? [];
  if (path.length < 2) return intent === 'ALIGHT' ? 'left' : 'right';

  if (intent === 'BOARD') {
    const start = path[0];
    const next =
      path.find(coord => routeCoordDistanceMeters(start, coord) >= 24) ??
      path[1];
    const longitudeDelta = next.lng - start.lng;
    // 라벨은 다음 노선이 진행하는 쪽의 반대편으로 열어 본선을 가리지 않는다.
    if (Math.abs(longitudeDelta) >= 0.00003)
      return longitudeDelta > 0 ? 'left' : 'right';
    return 'right';
  }

  const end = path[path.length - 1];
  const previous =
    [...path]
      .reverse()
      .find(coord => routeCoordDistanceMeters(end, coord) >= 24) ??
    path[path.length - 2];
  const longitudeDelta = end.lng - previous.lng;
  if (Math.abs(longitudeDelta) >= 0.00003)
    return longitudeDelta > 0 ? 'right' : 'left';
  return 'left';
}

/** 승차·하차·환승 이벤트를 우선순위와 중복 제거 정책에 따라 지도 마커로 생성합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function buildTransitEventMarkers(
  selectedAlternativeId: string | undefined,
  legs: TransitLegDetail[] | undefined,
  mapZoom: number,
  _isDark: boolean,
  normalizedRoute?: NormalizedRoute,
): TmapMarker[] {
  if (!Array.isArray(legs) || !legs.length) return [];

  const drafts: TransitEventDraft[] = [];
  const rideLegIndexes = legs
    .map((leg, index) => (isRideLegKind(leg.kind) ? index : -1))
    .filter(index => index >= 0);
  const firstRideLegIndex = rideLegIndexes[0];
  const lastRideLegIndex = rideLegIndexes[rideLegIndexes.length - 1];
  let rideLegSeen = false;

  legs.forEach((leg, index) => {
    const boardMarkerCoord =
      getRideStopRouteMarkerCoord(normalizedRoute, index, 'BOARD') ??
      getRideStopVisualCoord(legs, index, 'BOARD') ??
      getTransitLegBoardCoord(leg) ??
      getTransitLegStartCoord(leg) ??
      getTransitLegBoardAnchorOnPath(leg);
    const alightMarkerCoord =
      getRideStopRouteMarkerCoord(normalizedRoute, index, 'ALIGHT') ??
      getRideStopVisualCoord(legs, index, 'ALIGHT') ??
      getTransitLegAlightCoord(leg) ??
      getTransitLegEndCoord(leg) ??
      getTransitLegAlightAnchorOnPath(leg);
    const lineLabel =
      compactTransitLineLabel(leg.lineName) ??
      compactTransitLineLabel(leg.label);
    const baseOrder = index * 10;

    if (isRideLegKind(leg.kind)) {
      const hasWalkBeforeRide = legs
        .slice(0, index)
        .some(candidate => candidate.kind === 'WALK');
      const hasWalkAfterRide = legs
        .slice(index + 1)
        .some(candidate => candidate.kind === 'WALK');
      const hasLaterRide = rideLegIndexes.some(rideIndex => rideIndex > index);
      // 출발·도착 핀과 같은 좌표의 승하차 원은 이중 마커가 되므로 터미널 핀을 우선한다.
      const boardOverlapsOrigin =
        index === firstRideLegIndex && !hasWalkBeforeRide;
      const alightOverlapsDestination =
        index === lastRideLegIndex && !hasWalkAfterRide;

      if (boardMarkerCoord && !boardOverlapsOrigin) {
        drafts.push({
          coord: boardMarkerCoord,
          intent: 'BOARD',
          kind: leg.kind,
          legIndex: index,
          lineLabel,
          lineColor: leg.lineColor,
          stopName: normalizeTransitStopName(leg.startName),
          directionLabel: getTransitBoardingDirectionHint(leg),
          badgeSide: getTransitEventBadgeSide(leg, 'BOARD'),
          boundaryRole:
            legs[index - 1]?.kind === 'WALK' ? 'ride-entry' : undefined,
          order: baseOrder + 1,
        });
      }
      if (alightMarkerCoord && !alightOverlapsDestination) {
        drafts.push({
          coord: alightMarkerCoord,
          intent: 'ALIGHT',
          kind: leg.kind,
          legIndex: index,
          lineLabel,
          lineColor: leg.lineColor,
          stopName: normalizeTransitStopName(leg.endName),
          badgeSide: getTransitEventBadgeSide(leg, 'ALIGHT'),
          boundaryRole:
            legs[index + 1]?.kind === 'WALK'
              ? hasLaterRide
                ? 'transfer-exit'
                : 'walk-exit'
              : undefined,
          order: baseOrder + 7,
        });
      }
      if (rideLegSeen && boardMarkerCoord) {
        drafts.push({
          coord: boardMarkerCoord,
          intent: 'TRANSFER',
          kind: leg.kind,
          legIndex: index,
          lineLabel,
          lineColor: leg.lineColor,
          stopName: normalizeTransitStopName(leg.startName),
          directionLabel: getTransitBoardingDirectionHint(leg),
          badgeSide: getTransitEventBadgeSide(leg, 'BOARD'),
          boundaryRole: 'ride-entry',
          order: baseOrder,
        });
      }
      rideLegSeen = true;
      return;
    }
  });

  if (!drafts.length) return [];

  // 광역에서는 환승을 한 노드로 축약하고, 상세 줌에서는 점선 양 끝의 실제 경계를 보존한다.
  const hierarchyDrafts = shouldPreserveTransitBoundaryEvents(mapZoom)
    ? drafts
    : collapseRedundantTransferAlights(drafts);

  // 나머지 같은 지점 이벤트는 문자열 좌표가 아닌 공간 거리로 묶는다.
  const grouped: TransitEventDraft[][] = [];
  hierarchyDrafts.forEach(draft => {
    const nearbyGroup = grouped.find(
      group =>
        Math.abs(group[0].order - draft.order) <= 16 &&
        routeCoordDistanceMeters(group[0].coord, draft.coord) <= 18,
    );
    if (nearbyGroup) nearbyGroup.push(draft);
    else grouped.push([draft]);
  });

  const sortedGroups = grouped
    .map(group => group.sort((a, b) => a.order - b.order))
    .sort((a, b) => a[0].order - b[0].order)
    .slice(0, TRANSIT_BADGE_MAX_COUNT);

  return sortedGroups.flatMap((group, index): TmapMarker[] => {
    const base = group[0];
    const intents = new Set(group.map(item => item.intent));

    let tintColor = TRANSIT_LEG_COLOR.WALK;
    let caption = '도보 구간';
    let markerStyle: TmapMarker['markerStyle'] = 'default';
    let actionLabel: '승차' | '환승' | '하차' = '승차';
    let detailLineLabel = base.lineLabel;
    let detailStopName = base.stopName;
    let detailDirectionLabel = base.directionLabel;
    let interactionLegIndex = base.legIndex;
    let markerCoord = base.coord;
    let detailBadgeSide = base.badgeSide ?? 'right';
    let isTransferExitBoundary = false;

    if (intents.has('TRANSFER')) {
      const transfer = group.find(item => item.intent === 'TRANSFER') ?? base;
      const transferLine = transfer.lineLabel;
      tintColor = getTransitKindLineColor(
        transfer.kind,
        transfer.lineLabel,
        transfer.lineColor,
      );
      // 환승 자체를 상징하는 문양 대신 다음에 실제로 탈 버스/지하철 아이콘을 보여준다.
      markerStyle = getTransitModeMarkerStyle(transfer.kind);
      caption = transferLine ? `${transferLine} 환승` : '환승 지점';
      actionLabel = '환승';
      detailLineLabel = transferLine;
      detailStopName = transfer.stopName;
      detailDirectionLabel = transfer.directionLabel;
      interactionLegIndex = transfer.legIndex;
      markerCoord = transfer.coord;
      detailBadgeSide = transfer.badgeSide ?? 'right';
    } else if (intents.has('BOARD')) {
      const board = group.find(item => item.intent === 'BOARD') ?? base;
      const kindMeta = getTransitLegKindMeta(board.kind);
      const normalizedLine = board.lineLabel
        ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, '')
        .trim();
      tintColor = getTransitKindLineColor(
        board.kind,
        normalizedLine ?? board.lineLabel,
        board.lineColor,
      );
      markerStyle = getTransitModeMarkerStyle(board.kind);
      caption = board.stopName ?? `${kindMeta.label} 지점`;
      actionLabel = '승차';
      detailLineLabel = normalizedLine ?? board.lineLabel;
      detailStopName = board.stopName;
      detailDirectionLabel = board.directionLabel;
      interactionLegIndex = board.legIndex;
      markerCoord = board.coord;
      detailBadgeSide = board.badgeSide ?? 'right';
    } else if (intents.has('ALIGHT')) {
      const alight = group.find(item => item.intent === 'ALIGHT') ?? base;
      const kindMeta = getTransitLegKindMeta(alight.kind);
      const normalizedLine = alight.lineLabel
        ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, '')
        .trim();
      tintColor = getTransitKindLineColor(
        alight.kind,
        normalizedLine ?? alight.lineLabel,
        alight.lineColor,
      );
      markerStyle = getTransitModeMarkerStyle(alight.kind);
      // 목적지까지 이어지는 최종 보행만 보행 아이콘으로 전환한다.
      // 환승 보행 앞의 하차 노드는 이전 노선의 수단 아이콘을 유지해야 두 경계가 읽힌다.
      if (alight.boundaryRole === 'walk-exit') markerStyle = 'walk';
      isTransferExitBoundary = alight.boundaryRole === 'transfer-exit';
      caption = alight.stopName ?? `${kindMeta.label} 지점`;
      actionLabel = '하차';
      detailLineLabel = normalizedLine ?? alight.lineLabel;
      detailStopName = alight.stopName;
      detailDirectionLabel = undefined;
      interactionLegIndex = alight.legIndex;
      markerCoord = alight.coord;
      detailBadgeSide = alight.badgeSide ?? 'left';
    }

    const eventIntent =
      actionLabel === '환승'
        ? 'transfer'
        : actionLabel === '하차'
        ? 'alight'
        : 'board';
    const presentation = getTransitEventMarkerPresentation(
      eventIntent,
      mapZoom,
      isTransferExitBoundary,
    );
    if (!presentation.visible) return [];
    const compactLineLabel = compactTransitLineLabel(detailLineLabel);
    const showContextLabel = mapZoom >= 16.8;
    const contextPrimary = [
      compactLineLabel,
      compactTransitStopLabel(detailStopName, 14),
    ]
      .filter((value): value is string => !!value)
      .join(' · ');
    const contextSecondary =
      actionLabel === '하차' ? '하차 지점' : detailDirectionLabel;
    const markerIdBase = `transit-event-${
      selectedAlternativeId ?? 'selected'
    }-${interactionLegIndex}-${eventIntent}`;
    const interactionId = buildTransitLegInteractionId(interactionLegIndex);
    const markers: TmapMarker[] = [
      {
        id: `${markerIdBase}-node`,
        interactionId,
        latitude: markerCoord.lat,
        longitude: markerCoord.lng,
        tintColor,
        markerStyle,
        caption,
        displayType: 'station',
        stationVariant: presentation.stationVariant,
        eventIntent,
        dotSize: presentation.nodeSize,
        zIndex: 3700 + index * 2,
      },
    ];
    if (presentation.showRouteLabel) {
      markers.push({
        id: `${markerIdBase}-label`,
        interactionId,
        latitude: markerCoord.lat,
        longitude: markerCoord.lng,
        tintColor,
        markerStyle,
        caption,
        displayType: 'routeLabel',
        badgeLabel:
          showContextLabel && contextPrimary
            ? contextPrimary
            : compactLineLabel ?? actionLabel,
        badgeSubLabel: showContextLabel ? contextSecondary : undefined,
        badgeVariant: showContextLabel ? 'context' : 'route',
        badgeSide: detailBadgeSide,
        eventIntent,
        zIndex: 3701 + index * 2,
      });
    }
    return markers;
  });
}

/** 통과 정류장 가시성 정책과 줌을 반영해 표시할 정류장 마커를 샘플링합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function buildTransitPassStopMarkers(
  selectedAlternativeId: string | undefined,
  legs: TransitLegDetail[] | undefined,
  mapZoom: number,
  selectedStop: SelectedTransitMapStop | undefined,
): TmapMarker[] {
  if (!Array.isArray(legs)) return [];

  type StopMarkerCandidate = TmapMarker & { selected: boolean };
  type StopMarkerGroup = {
    kind: TransitStopMarkerKind;
    markers: StopMarkerCandidate[];
  };

  const groups: StopMarkerGroup[] = [];
  const seenCoordinates = new Set<string>();
  legs.forEach((leg, legIndex) => {
    if (
      !isRideLegKind(leg.kind) ||
      !Array.isArray(leg.passStops) ||
      leg.passStops.length < 3
    )
      return;
    const kind: TransitStopMarkerKind = leg.kind;
    const policy = getTransitStopMarkerPolicy(kind, mapZoom);
    const selectedBelongsToLeg = selectedStop?.legIndex === legIndex;
    if (!policy.visible && !selectedBelongsToLeg) return;

    const lineLabel =
      compactTransitLineLabel(leg.lineName) ??
      compactTransitLineLabel(leg.label);
    const lineColor = getTransitKindLineColor(
      leg.kind,
      lineLabel,
      leg.lineColor,
    );
    const markerStyle: TmapMarker['markerStyle'] =
      leg.kind === 'BUS' ? 'bus' : 'subway';
    const displayPath =
      Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
        : [];
    const routeCoordinates = routePathCoordsToCoordinates(displayPath);
    const markers: StopMarkerCandidate[] = [];

    leg.passStops.forEach((stop, stopIndex) => {
      // 승차·하차점은 더 강한 event marker가 이미 담당하므로 중간 정류장만 추가한다.
      if (
        stopIndex === 0 ||
        stopIndex === leg.passStops!.length - 1 ||
        !stop.coord
      )
        return;
      const selected =
        selectedStop?.legIndex === legIndex &&
        selectedStop.stopIndex === stopIndex;
      // 축소 후에도 사용자가 직접 고른 정류장은 맥락을 잃지 않도록 한 개만 유지한다.
      if (!policy.visible && !selected) return;

      const key = `${stop.coord.lat.toFixed(5)}:${stop.coord.lng.toFixed(5)}`;
      if (seenCoordinates.has(key)) return;
      seenCoordinates.add(key);

      const stopName = normalizeTransitStopName(stop.name) ?? stop.name;
      const stopAnchor = createTransitStopAnchor(
        toCoordinate(stop.coord),
        routeCoordinates,
        'start',
        {
          id: `transit-pass-stop-anchor-${
            selectedAlternativeId ?? 'selected'
          }-${legIndex}-${stopIndex}`,
          name: stopName,
          type: 'BUS_STOP',
        },
      );
      // 통과 정류장은 노선 구조를 읽는 노드다. 공급자 오차 범위 안에서는 본선 좌표를 공유하고,
      // 80m를 넘는 실제 불일치만 POI 좌표에 남겨 잘못된 경로로 꾸미지 않는다.
      const markerCoord =
        toRoutePathCoord(resolveTransitRouteNodeCoordinate(stopAnchor)) ??
        stop.coord;
      markers.push({
        id: `transit-pass-stop-${
          selectedAlternativeId ?? 'selected'
        }-${legIndex}-${stopIndex}`,
        interactionId: buildTransitStopInteractionId(legIndex, stopIndex),
        latitude: markerCoord.lat,
        longitude: markerCoord.lng,
        tintColor: lineColor,
        markerStyle,
        caption: stopName,
        displayType: selected ? 'badge' : 'station',
        badgeLabel: selected
          ? [lineLabel, compactTransitStopLabel(stopName, 12)]
              .filter(Boolean)
              .join(' · ')
          : undefined,
        badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
        badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
        badgeConnectorColor: lineColor,
        badgeSide: stopIndex % 2 === 0 ? 'left' : 'right',
        stationVariant: selected ? undefined : 'compact',
        // 선택 정류장은 핵심 승하차 노드와 같은 계층으로, 일반 정류장은 정책 크기로 고정한다.
        dotSize: selected ? 24 : policy.markerSize,
        zIndex: selected ? 3590 : 3520 + stopIndex,
        selected,
      });
    });

    if (markers.length > 0) groups.push({ kind, markers });
  });

  const result: TmapMarker[] = [];
  (['BUS', 'SUBWAY'] as const).forEach(kind => {
    const kindGroups = groups.filter(group => group.kind === kind);
    if (kindGroups.length === 0) return;

    const policy = getTransitStopMarkerPolicy(kind, mapZoom);
    const maxPerLeg = policy.visible ? policy.maxPerLeg : 1;
    const maxTotal = policy.visible ? policy.maxTotal : 1;
    const candidateCounts = kindGroups.map(group =>
      Math.min(group.markers.length, maxPerLeg),
    );
    const allocations = allocateTransitStopMarkerCounts(
      candidateCounts,
      maxTotal,
    );
    const selectedMarkersByGroup: StopMarkerCandidate[][] = [];

    kindGroups.forEach((group, groupIndex) => {
      const selectedIndex = group.markers.findIndex(marker => marker.selected);
      const sampledIndices = sampleTransitStopIndices(
        group.markers.length,
        allocations[groupIndex] ?? 0,
        selectedIndex >= 0 ? selectedIndex : undefined,
      );
      const selectedMarkers = sampledIndices.map(index => group.markers[index]);
      selectedMarkersByGroup.push(selectedMarkers);
      result.push(...selectedMarkers);
    });

    if (!policy.showLabels) return;
    const labelCandidatesByGroup = selectedMarkersByGroup.map(markers =>
      markers.filter(marker => !marker.selected),
    );
    const labelCandidateCounts = labelCandidatesByGroup.map(markers =>
      Math.min(markers.length, policy.maxLabelsPerLeg),
    );
    const labelAllocations = allocateTransitStopMarkerCounts(
      labelCandidateCounts,
      policy.maxLabelsTotal,
    );
    labelCandidatesByGroup.forEach((candidates, groupIndex) => {
      const labelIndices = sampleTransitStopIndices(
        candidates.length,
        labelAllocations[groupIndex] ?? 0,
      );
      labelIndices.forEach(candidateIndex => {
        const marker = candidates[candidateIndex];
        const stopLabel = compactTransitStopLabel(
          marker.caption,
          mapZoom >= 17.5 ? 18 : 14,
        );
        if (!stopLabel) return;
        result.push({
          ...marker,
          id: `${marker.id}-label`,
          displayType: 'routeLabel',
          badgeVariant: 'stop',
          badgeLabel: stopLabel,
          badgeSubLabel: undefined,
          dotSize: undefined,
          stationVariant: undefined,
          zIndex: (marker.zIndex ?? 3520) + 1,
        });
      });
    });
  });

  return result;
}

/** 버스·지하철 운행 구간의 대표 위치에 노선 식별 배지 마커를 생성합니다. 입력 경로 데이터는 변경하지 않습니다. */
export function buildTransitRouteIdentityMarkers(
  selectedAlternativeId: string | undefined,
  legs: TransitLegDetail[] | undefined,
  mapZoom: number,
): TmapMarker[] {
  if (!Array.isArray(legs) || !shouldShowTransitRouteIdentityLabel(mapZoom))
    return [];

  return legs.flatMap((leg, legIndex): TmapMarker[] => {
    if (!isRideLegKind(leg.kind)) return [];
    const lineLabel =
      compactTransitLineLabel(leg.lineName) ??
      compactTransitLineLabel(leg.label);
    if (!lineLabel) return [];
    const displayPath =
      Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
        : [];
    const markerCoord = selectTransitRouteLabelCoordinate(displayPath);
    if (!markerCoord) return [];

    return [
      {
        id: `transit-route-identity-${
          selectedAlternativeId ?? 'selected'
        }-${legIndex}`,
        interactionId: buildTransitLegInteractionId(legIndex),
        latitude: markerCoord.lat,
        longitude: markerCoord.lng,
        tintColor: getTransitKindLineColor(leg.kind, lineLabel, leg.lineColor),
        markerStyle: getTransitModeMarkerStyle(leg.kind),
        caption: lineLabel,
        displayType: 'routeLabel',
        badgeVariant: 'route',
        badgeLabel: lineLabel,
        badgeSide: legIndex % 2 === 0 ? 'right' : 'left',
        zIndex: 3600 + legIndex,
      },
    ];
  });
}

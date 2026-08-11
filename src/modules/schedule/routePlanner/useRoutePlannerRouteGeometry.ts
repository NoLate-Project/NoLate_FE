import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  getRouteAlternativeOptions,
  type RouteAlternativeOption,
  type RoutePathCoord,
  type TransitLegDetail,
} from '../../map/routingService';
import {
  buildRouteEndpointAccessRequests,
  resolveRouteEndpointAccessPath,
  type RouteEndpointAccessPath,
} from '../../map/routeEndpointAccess';
import type { TmapPathOverlay } from '../../map/TmapMapView';
import {
  filterTransitConnectorRequestsForSuccessfulWalks,
  resolveTransitWalkRequestEndpoints,
  splitWalkPathAtDiscontinuities,
  stitchTransitWalkPathToAnchors,
  TRANSIT_CONNECTOR_POLICY,
} from '../../map/transitRouteGeometry';
import type { TravelMode } from '../types';
import { haversineDistanceKm } from './presentation';
import {
  getTransitLegAlightAnchorOnPath,
  getTransitLegAlightCoord,
  getTransitLegBoardAnchorOnPath,
  getTransitLegBoardCoord,
  getTransitLegEndCoord,
  getTransitLegStartCoord,
  isRideLegKind,
} from './routeTransitLegCoordinates';
import {
  alignWalkPathToRideEndpoints,
  getRideStopConnectorCoord,
  toDisplayOverlayCoords,
  trimWalkApproachTail,
} from './routeTransitWalkGeometry';

const TRANSIT_TERMINAL_CONNECTOR_MAX_METERS =
  TRANSIT_CONNECTOR_POLICY.maxTerminalConnectorMeters;

type Options = {
  destinationLat?: number;
  destinationLng?: number;
  destinationName: string;
  hasRouteReady: boolean;
  originLat?: number;
  originLng?: number;
  originName: string;
  selectedAlternative?: RouteAlternativeOption;
  setEtaDistanceMeters: Dispatch<SetStateAction<number | undefined>>;
  setEtaMinutes: Dispatch<SetStateAction<number | undefined>>;
  setRouteEndpointAccessPaths: Dispatch<SetStateAction<RouteEndpointAccessPath[]>>;
  setRoutePathCoords: Dispatch<SetStateAction<RoutePathCoord[] | undefined>>;
  setTransitConnectorOverlays: Dispatch<SetStateAction<TmapPathOverlay[]>>;
  setTransitWalkDetailOverlays: Dispatch<SetStateAction<TmapPathOverlay[]>>;
  transitConnectorCacheRef: MutableRefObject<Map<string, RoutePathCoord[]>>;
  travelMode: TravelMode;
};

/**
 * 선택 경로의 기본 polyline과 대중교통 도보 연결선, 자동차·자전거 끝점 접근로를 계산한다.
 * 비동기 보행 경로 응답은 effect 수명과 캐시로 관리해 이전 경로의 결과가 새 화면에 섞이지 않게 한다.
 */
export function useRoutePlannerRouteGeometry({
  destinationLat,
  destinationLng,
  destinationName,
  hasRouteReady,
  originLat,
  originLng,
  originName,
  selectedAlternative,
  setEtaDistanceMeters,
  setEtaMinutes,
  setRouteEndpointAccessPaths,
  setRoutePathCoords,
  setTransitConnectorOverlays,
  setTransitWalkDetailOverlays,
  transitConnectorCacheRef,
  travelMode,
}: Options) {
  // 선택된 경로 옵션에서 "지도 전체 polyline"의 기준이 될 경로를 정리한다.
  // 대중교통은 option.pathCoords가 비어 있을 수 있어 leg path들을 다시 합쳐 fallback으로 쓴다.
  useEffect(() => {
    if (!selectedAlternative) {
      setEtaMinutes(undefined);
      setEtaDistanceMeters(undefined);
      setRoutePathCoords(undefined);
      return;
    }

    setEtaMinutes(selectedAlternative.minutes);
    setEtaDistanceMeters(selectedAlternative.distanceMeters);
    const mergedTransitLegPath = Array.isArray(selectedAlternative.transitLegs)
      ? selectedAlternative.transitLegs
          .flatMap(leg => (Array.isArray(leg.pathCoords) ? leg.pathCoords : []))
          .filter(
            (point): point is RoutePathCoord =>
              typeof point?.lat === 'number' && typeof point?.lng === 'number',
          )
      : [];
    const routePath =
      Array.isArray(selectedAlternative.pathCoords) &&
      selectedAlternative.pathCoords.length >= 2
        ? selectedAlternative.pathCoords
        : mergedTransitLegPath.length >= 2
        ? mergedTransitLegPath
        : undefined;
    setRoutePathCoords(routePath);
  }, [
    selectedAlternative,
    setEtaDistanceMeters,
    setEtaMinutes,
    setRoutePathCoords,
  ]);

  // 대중교통의 도보 연결선은 "출발/도착 ↔ 승하차점", "환승 ↔ 다음 승차점"을 따로 계산한다.
  // 이 useEffect는 보행자 전용 API로 connector/walk detail path를 구해 지도 오버레이용 state로 저장한다.
  useEffect(() => {
    if (
      travelMode !== 'TRANSIT' ||
      !hasRouteReady ||
      !selectedAlternative ||
      !Array.isArray(selectedAlternative.transitLegs) ||
      selectedAlternative.transitLegs.length === 0 ||
      typeof originLat !== 'number' ||
      typeof originLng !== 'number' ||
      typeof destinationLat !== 'number' ||
      typeof destinationLng !== 'number'
    ) {
      transitConnectorCacheRef.current.clear();
      setTransitConnectorOverlays([]);
      setTransitWalkDetailOverlays([]);
      return;
    }

    const transitLegs = selectedAlternative.transitLegs;
    const legSegments = transitLegs
      .map(leg =>
        Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
          ? leg.pathCoords
          : null,
      )
      .filter((coords): coords is RoutePathCoord[] => Array.isArray(coords));

    if (!legSegments.length) {
      transitConnectorCacheRef.current.clear();
      setTransitConnectorOverlays([]);
      setTransitWalkDetailOverlays([]);
      return;
    }

    const firstPointFromPath = legSegments[0][0];
    const lastSegment = legSegments[legSegments.length - 1];
    const lastPointFromPath = lastSegment[lastSegment.length - 1];
    if (!firstPointFromPath || !lastPointFromPath) {
      transitConnectorCacheRef.current.clear();
      setTransitConnectorOverlays([]);
      setTransitWalkDetailOverlays([]);
      return;
    }

    transitConnectorCacheRef.current.clear();

    const firstRideLegIndex = transitLegs.findIndex(leg =>
      isRideLegKind(leg.kind),
    );
    const lastRideLegIndex = (() => {
      for (let index = transitLegs.length - 1; index >= 0; index -= 1) {
        if (isRideLegKind(transitLegs[index].kind)) return index;
      }
      return -1;
    })();
    const firstLegForBoundary =
      transitLegs[firstRideLegIndex >= 0 ? firstRideLegIndex : 0];
    const lastLegForBoundary =
      transitLegs[
        lastRideLegIndex >= 0 ? lastRideLegIndex : transitLegs.length - 1
      ];
    const firstAnchorPoint =
      (firstRideLegIndex >= 0
        ? getRideStopConnectorCoord(transitLegs, firstRideLegIndex, 'BOARD')
        : undefined) ??
      getRideStopConnectorCoord(
        transitLegs,
        firstRideLegIndex >= 0 ? firstRideLegIndex : 0,
        'BOARD',
      ) ??
      getTransitLegBoardCoord(firstLegForBoundary) ??
      getTransitLegBoardAnchorOnPath(firstLegForBoundary) ??
      getTransitLegStartCoord(firstLegForBoundary) ??
      firstPointFromPath;
    const lastAnchorPoint =
      (lastRideLegIndex >= 0
        ? getRideStopConnectorCoord(transitLegs, lastRideLegIndex, 'ALIGHT')
        : undefined) ??
      getRideStopConnectorCoord(
        transitLegs,
        lastRideLegIndex >= 0 ? lastRideLegIndex : transitLegs.length - 1,
        'ALIGHT',
      ) ??
      getTransitLegAlightCoord(lastLegForBoundary) ??
      getTransitLegAlightAnchorOnPath(lastLegForBoundary) ??
      getTransitLegEndCoord(lastLegForBoundary) ??
      lastPointFromPath;

    const originPoint: RoutePathCoord = { lat: originLat, lng: originLng };
    const destinationPoint: RoutePathCoord = {
      lat: destinationLat,
      lng: destinationLng,
    };
    // 승하차 지점 주변의 짧은 도보 gap도 지도에서 끊겨 보이지 않도록 낮게 잡는다.
    const connectorMinMeters = 10;
    const connectorMinSegmentMeters = 5;

    const distanceMeters = (from: RoutePathCoord, to: RoutePathCoord) =>
      haversineDistanceKm(
        { latitude: from.lat, longitude: from.lng },
        { latitude: to.lat, longitude: to.lng },
      ) * 1000;
    type ConnectorPathRequest = {
      id: string;
      from: RoutePathCoord;
      to: RoutePathCoord;
      snapFrom: boolean;
      snapTo: boolean;
    };
    const connectorRequests: ConnectorPathRequest[] = [];
    const connectorKeys = new Set<string>();
    const pushConnectorRequest = (
      id: string,
      from: RoutePathCoord | undefined,
      to: RoutePathCoord | undefined,
      snapFrom: boolean,
      snapTo: boolean,
    ) => {
      if (!from || !to) return;
      const gapMeters = distanceMeters(from, to);
      if (!Number.isFinite(gapMeters) || gapMeters < connectorMinMeters) return;
      const directKey = `${from.lat.toFixed(5)},${from.lng.toFixed(
        5,
      )}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
      const reverseKey = `${to.lat.toFixed(5)},${to.lng.toFixed(
        5,
      )}>${from.lat.toFixed(5)},${from.lng.toFixed(5)}`;
      if (connectorKeys.has(directKey) || connectorKeys.has(reverseKey)) return;
      connectorKeys.add(directKey);
      connectorRequests.push({ id, from, to, snapFrom, snapTo });
    };

    // WALK 레그가 steps[].linestring으로 정밀 경로를 가진 경우 → walkLegRequests에서 직접 처리하므로
    // 해당 구간에 대한 connector 재조회를 건너뜀 (중복 dot 방지 및 도로 중앙선 라우팅 회피)
    const walkLegHasPrecisePath = (
      leg: TransitLegDetail | undefined,
    ): boolean =>
      leg?.kind === 'WALK' &&
      !!leg.pathCoordsIsExact &&
      Array.isArray(leg.pathCoords) &&
      (leg.pathCoords.length ?? 0) >= 3 &&
      splitWalkPathAtDiscontinuities(leg.pathCoords).length === 1;

    const firstWalkLeg =
      transitLegs[0]?.kind === 'WALK' ? transitLegs[0] : undefined;
    const lastWalkLeg =
      transitLegs[transitLegs.length - 1]?.kind === 'WALK'
        ? transitLegs[transitLegs.length - 1]
        : undefined;
    const exactWalkLegOverlays = transitLegs.flatMap(
      (leg, legIndex): TmapPathOverlay[] => {
        if (!walkLegHasPrecisePath(leg) || !Array.isArray(leg.pathCoords))
          return [];
        let alignedPath = alignWalkPathToRideEndpoints(
          transitLegs,
          legIndex,
          leg.pathCoords,
        );
        const isFirstLeg = legIndex === 0;
        const isLastLeg = legIndex === transitLegs.length - 1;
        alignedPath = stitchTransitWalkPathToAnchors(
          alignedPath,
          isFirstLeg ? originPoint : undefined,
          isLastLeg ? destinationPoint : undefined,
          { terminalStart: isFirstLeg, terminalEnd: isLastLeg },
        );
        const displayCoords = toDisplayOverlayCoords(alignedPath, 'WALK');
        if (displayCoords.length < 2) return [];
        const baseId = `${selectedAlternative.id}-walk-leg-${legIndex}`;
        const overlay = {
          id: baseId,
          coords: displayCoords,
          color: 'rgba(0,0,0,0)',
          width: 1,
          outlineColor: 'rgba(0,0,0,0)',
          outlineWidth: 0,
        } as TmapPathOverlay;
        const pathOverlay = {
          ...overlay,
          id: `${baseId}-path`,
          width: 0.5,
        } as TmapPathOverlay;
        return [overlay, pathOverlay];
      },
    );

    // 출발/도착은 고정하고, 승/하차측 끝점은 보행 API가 반환한 실제 보행 가능점(보도측)을 우선한다.
    // 첫/마지막 WALK 레그에 정밀 경로가 있으면 exactWalkLegOverlays가 담당한다.
    if (!walkLegHasPrecisePath(firstWalkLeg)) {
      pushConnectorRequest(
        `${selectedAlternative.id}-walk-boundary-start`,
        originPoint,
        firstAnchorPoint,
        true,
        false,
      );
    } else {
      const preciseStart = firstWalkLeg?.pathCoords?.[0];
      if (
        preciseStart &&
        distanceMeters(originPoint, preciseStart) >
          TRANSIT_TERMINAL_CONNECTOR_MAX_METERS
      ) {
        pushConnectorRequest(
          `${selectedAlternative.id}-walk-boundary-start`,
          originPoint,
          preciseStart,
          true,
          true,
        );
      }
    }
    if (!walkLegHasPrecisePath(lastWalkLeg)) {
      pushConnectorRequest(
        `${selectedAlternative.id}-walk-boundary-end`,
        lastAnchorPoint,
        destinationPoint,
        false,
        true,
      );
    } else {
      const precisePath = lastWalkLeg?.pathCoords;
      const preciseEnd = Array.isArray(precisePath)
        ? precisePath[precisePath.length - 1]
        : undefined;
      if (
        preciseEnd &&
        distanceMeters(preciseEnd, destinationPoint) >
          TRANSIT_TERMINAL_CONNECTOR_MAX_METERS
      ) {
        pushConnectorRequest(
          `${selectedAlternative.id}-walk-boundary-end`,
          preciseEnd,
          destinationPoint,
          true,
          true,
        );
      }
    }

    for (let legIndex = 0; legIndex < transitLegs.length - 1; legIndex += 1) {
      const currentLeg = transitLegs[legIndex];
      const nextLeg = transitLegs[legIndex + 1];
      // 현재/다음 레그 중 하나가 WALK이고 정밀 경로를 가진다면 walkLegRequests가 처리
      if (walkLegHasPrecisePath(currentLeg) || walkLegHasPrecisePath(nextLeg))
        continue;
      const currentAnchor =
        getRideStopConnectorCoord(transitLegs, legIndex, 'ALIGHT') ??
        getTransitLegAlightCoord(currentLeg) ??
        getTransitLegAlightAnchorOnPath(currentLeg) ??
        getTransitLegEndCoord(currentLeg);
      const nextAnchor =
        getRideStopConnectorCoord(transitLegs, legIndex + 1, 'BOARD') ??
        getTransitLegBoardCoord(nextLeg) ??
        getTransitLegBoardAnchorOnPath(nextLeg) ??
        getTransitLegStartCoord(nextLeg);
      pushConnectorRequest(
        `${selectedAlternative.id}-walk-gap-${legIndex}`,
        currentAnchor,
        nextAnchor,
        false,
        false,
      );
    }

    if (!connectorRequests.length) {
      setTransitConnectorOverlays([]);
    }

    const walkLegRequests = transitLegs
      .map((leg, legIndex) => {
        if (leg.kind !== 'WALK') return null;
        if (walkLegHasPrecisePath(leg)) return null;
        const previousLeg = transitLegs[legIndex - 1];
        const nextLeg = transitLegs[legIndex + 1];
        const endpoints = resolveTransitWalkRequestEndpoints({
          legIndex,
          legCount: transitLegs.length,
          origin: originPoint,
          destination: destinationPoint,
          legStart:
            getTransitLegBoardCoord(leg) ??
            getTransitLegBoardAnchorOnPath(leg) ??
            getTransitLegStartCoord(leg),
          legEnd:
            getTransitLegAlightCoord(leg) ??
            getTransitLegAlightAnchorOnPath(leg) ??
            getTransitLegEndCoord(leg),
          previousIsRide: !!previousLeg && isRideLegKind(previousLeg.kind),
          previousRideAlight:
            previousLeg && isRideLegKind(previousLeg.kind)
              ? getRideStopConnectorCoord(
                  transitLegs,
                  legIndex - 1,
                  'ALIGHT',
                ) ?? getTransitLegAlightCoord(previousLeg)
              : undefined,
          nextIsRide: !!nextLeg && isRideLegKind(nextLeg.kind),
          nextRideBoard:
            nextLeg && isRideLegKind(nextLeg.kind)
              ? getRideStopConnectorCoord(transitLegs, legIndex + 1, 'BOARD') ??
                getTransitLegBoardCoord(nextLeg)
              : undefined,
        });
        if (!endpoints) return null;
        const walkGapMeters = distanceMeters(endpoints.from, endpoints.to);
        if (!Number.isFinite(walkGapMeters) || walkGapMeters < 35) return null;
        return {
          id: `${selectedAlternative.id}-walk-leg-${legIndex}`,
          ...endpoints,
        };
      })
      .filter((value): value is ConnectorPathRequest => value !== null);

    const firstWalkRequestId =
      transitLegs[0]?.kind === 'WALK'
        ? `${selectedAlternative.id}-walk-leg-0`
        : undefined;
    const lastWalkIndex = transitLegs.length - 1;
    const lastWalkRequestId =
      transitLegs[lastWalkIndex]?.kind === 'WALK'
        ? `${selectedAlternative.id}-walk-leg-${lastWalkIndex}`
        : undefined;

    if (!connectorRequests.length && !walkLegRequests.length) {
      setTransitWalkDetailOverlays(exactWalkLegOverlays);
      return;
    }

    const normalizeConnectorPath = (
      rawPath: RoutePathCoord[],
    ): RoutePathCoord[] | undefined => {
      if (!Array.isArray(rawPath) || rawPath.length < 2) return undefined;

      const filtered: RoutePathCoord[] = [rawPath[0]];
      for (let index = 1; index < rawPath.length; index += 1) {
        const prev = filtered[filtered.length - 1];
        const current = rawPath[index];
        if (distanceMeters(prev, current) < connectorMinSegmentMeters) continue;
        filtered.push(current);
      }
      if (filtered.length < 2) return undefined;
      // 끝점 보정은 stitchWalkPathToAnchors 한 곳에서만 수행해 24m 정책을 우회하지 못하게 한다.
      return filtered;
    };

    let cancelled = false;
    const fetchConnectorPath = async (
      from: RoutePathCoord,
      to: RoutePathCoord,
      snapFrom: boolean,
      snapTo: boolean,
    ): Promise<RoutePathCoord[] | undefined> => {
      const key = `${from.lat.toFixed(5)},${from.lng.toFixed(
        5,
      )}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}|${snapFrom ? 1 : 0}${
        snapTo ? 1 : 0
      }`;
      const cached = transitConnectorCacheRef.current.get(key);
      if (cached && cached.length >= 2) return cached;

      const alternatives = await getRouteAlternativeOptions(
        { name: '출발', lat: from.lat, lng: from.lng },
        { name: '도착', lat: to.lat, lng: to.lng },
        'WALK',
      );
      const hasRenderableWalkPath = (item: RouteAlternativeOption) =>
        Array.isArray(item.pathCoords) &&
        item.pathCoords.length >= 2 &&
        (item.pathCoords.length >= 3 || item.fallbackKind !== 'straight');
      const byPrecision = (
        a: RouteAlternativeOption,
        b: RouteAlternativeOption,
      ) => {
        const aDistance =
          typeof a.distanceMeters === 'number'
            ? a.distanceMeters
            : Number.POSITIVE_INFINITY;
        const bDistance =
          typeof b.distanceMeters === 'number'
            ? b.distanceMeters
            : Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) return aDistance - bDistance;
        const aMinutes =
          typeof a.minutes === 'number' ? a.minutes : Number.POSITIVE_INFINITY;
        const bMinutes =
          typeof b.minutes === 'number' ? b.minutes : Number.POSITIVE_INFINITY;
        return aMinutes - bMinutes;
      };
      const walkCandidates = alternatives
        .filter(item => hasRenderableWalkPath(item))
        .sort(byPrecision);
      const best = walkCandidates.find(item => item.source === 'api');

      if (!best?.pathCoords || !hasRenderableWalkPath(best)) {
        return undefined;
      }
      const normalizedPath = normalizeConnectorPath(best.pathCoords);
      if (!normalizedPath || normalizedPath.length < 2) return undefined;
      transitConnectorCacheRef.current.set(key, normalizedPath);
      return normalizedPath;
    };

    (async () => {
      const overlays: TmapPathOverlay[] = [];
      const walkDetailOverlays: TmapPathOverlay[] = [...exactWalkLegOverlays];
      const successfulWalkRequestIds = new Set<string>();
      const successfulWalkLegIndexes = new Set<number>();

      for (const request of walkLegRequests) {
        if (cancelled) break;
        // 대중교통 API steps linestring은 도로 인도를 따라가는 경우가 많아
        // 보행자 전용 API(fetchConnectorPath)를 사용해 이면도로 우선 경로를 구한다
        const rawWalkPath = await fetchConnectorPath(
          request.from,
          request.to,
          request.snapFrom,
          request.snapTo,
        );
        // WALK→BUS/SUBWAY: 경로 끝이 버스/지하철 도로 위로 진입하는 구간 제거
        // request.snapTo=false → 버스/지하철 승차지점(도로 중앙)이 목적지
        let walkPath = rawWalkPath;
        if (rawWalkPath && !request.snapTo) {
          const legIdxMatch = request.id.match(/-walk-leg-(\d+)$/);
          const legIdx = legIdxMatch ? parseInt(legIdxMatch[1], 10) : -1;
          const adjacentRideLeg = transitLegs.find((leg, i) => {
            if (!isRideLegKind(leg.kind)) return false;
            if (legIdx >= 0 && i <= legIdx) return false;
            const boardCoord = getTransitLegBoardCoord(leg);
            return boardCoord && distanceMeters(boardCoord, request.to) < 40;
          });
          const ridePath = Array.isArray(adjacentRideLeg?.pathCoords)
            ? (adjacentRideLeg!.pathCoords as RoutePathCoord[]).slice(0, 25)
            : [];
          walkPath =
            trimWalkApproachTail(rawWalkPath, request.to, ridePath) ??
            rawWalkPath;
        }
        if (walkPath && !cancelled) {
          const stitchedWalkPath = stitchTransitWalkPathToAnchors(
            walkPath,
            request.from,
            request.to,
            { terminalStart: request.snapFrom, terminalEnd: request.snapTo },
          );
          const displayCoords = toDisplayOverlayCoords(
            stitchedWalkPath,
            'WALK',
          );
          if (displayCoords.length < 2) continue;
          successfulWalkRequestIds.add(request.id);
          const legIndexMatch = request.id.match(/-walk-leg-(\d+)$/);
          if (legIndexMatch)
            successfulWalkLegIndexes.add(Number(legIndexMatch[1]));
          walkDetailOverlays.push({
            id: request.id,
            coords: displayCoords,
            color: 'rgba(0,0,0,0)',
            width: 1,
            outlineColor: 'rgba(0,0,0,0)',
            outlineWidth: 0,
          });
          walkDetailOverlays.push({
            id: `${request.id}-path`,
            coords: displayCoords,
            color: 'rgba(0,0,0,0)',
            width: 0.5,
            outlineColor: 'rgba(0,0,0,0)',
            outlineWidth: 0,
          });
        }
      }

      // 상세 WALK 조회가 실제로 성공한 구간만 boundary/gap fallback을 억제한다.
      // WALK API가 실패하면 connector를 남겨 출발·도착/승하차 접점이 끊기지 않게 한다.
      const effectiveConnectorRequests =
        filterTransitConnectorRequestsForSuccessfulWalks(connectorRequests, {
          firstWalkRequestId,
          lastWalkRequestId,
          successfulWalkRequestIds,
          successfulWalkLegIndexes,
          legKinds: transitLegs.map(leg => leg.kind),
        });

      for (const request of effectiveConnectorRequests) {
        const rawConnectorPath = await fetchConnectorPath(
          request.from,
          request.to,
          request.snapFrom,
          request.snapTo,
        );
        if (rawConnectorPath && !cancelled) {
          // WALK→BUS/SUBWAY: 경로 끝이 버스/지하철 도로 위로 진입하는 구간 제거
          // snapTo=false → 버스/지하철 승차지점(도로 중앙)이 목적지
          let connectorPath: RoutePathCoord[] = rawConnectorPath;
          if (!request.snapTo) {
            // 승차 지점에 인접한 버스/지하철 레그 경로 좌표 취득 (도로 중앙선)
            const adjacentRideLeg = transitLegs.find(leg => {
              if (!isRideLegKind(leg.kind)) return false;
              const boardCoord = getTransitLegBoardCoord(leg);
              return boardCoord && distanceMeters(boardCoord, request.to) < 40;
            });
            const ridePath = Array.isArray(adjacentRideLeg?.pathCoords)
              ? (adjacentRideLeg!.pathCoords as RoutePathCoord[]).slice(0, 25)
              : [];
            connectorPath =
              trimWalkApproachTail(rawConnectorPath, request.to, ridePath) ??
              rawConnectorPath;
          }
          const stitchedConnectorPath = stitchTransitWalkPathToAnchors(
            connectorPath,
            request.from,
            request.to,
            { terminalStart: request.snapFrom, terminalEnd: request.snapTo },
          );
          const displayCoords = toDisplayOverlayCoords(
            stitchedConnectorPath,
            'WALK',
          );
          if (displayCoords.length < 2) continue;
          overlays.push({
            id: `${request.id}-path`,
            coords: displayCoords,
            color: 'rgba(0,0,0,0)',
            width: 0.5,
            outlineColor: 'rgba(0,0,0,0)',
            outlineWidth: 0,
          });
        }
      }

      if (!cancelled) {
        setTransitConnectorOverlays(overlays);
        setTransitWalkDetailOverlays(walkDetailOverlays);
      }
    })().catch(() => {
      if (!cancelled) {
        setTransitConnectorOverlays([]);
        setTransitWalkDetailOverlays([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    travelMode,
    hasRouteReady,
    selectedAlternative,
    originLat,
    originLng,
    destinationLat,
    destinationLng,
    setTransitConnectorOverlays,
    setTransitWalkDetailOverlays,
    transitConnectorCacheRef,
  ]);

  // 자동차·자전거 공급자는 선택한 POI 대신 가까운 도로망 좌표에서 경로를 시작하거나 끝낸다.
  // 짧은 끝점 gap만 TMAP 보행 경로로 보완하고, 장거리·과도한 우회 형상은 표시하지 않는다.
  useEffect(() => {
    if (
      (travelMode !== 'CAR' && travelMode !== 'BIKE') ||
      !selectedAlternative ||
      !Array.isArray(selectedAlternative.pathCoords) ||
      selectedAlternative.pathCoords.length < 2 ||
      typeof originLat !== 'number' ||
      typeof originLng !== 'number' ||
      typeof destinationLat !== 'number' ||
      typeof destinationLng !== 'number'
    ) {
      setRouteEndpointAccessPaths([]);
      return;
    }

    const requests = buildRouteEndpointAccessRequests(
      selectedAlternative.id,
      selectedAlternative.pathCoords,
      { lat: originLat, lng: originLng },
      { lat: destinationLat, lng: destinationLng },
    );
    if (!requests.length) {
      setRouteEndpointAccessPaths([]);
      return;
    }

    let cancelled = false;
    void Promise.all(
      requests.map(async request => {
        const directPath = resolveRouteEndpointAccessPath(request);
        if (directPath) return directPath;

        try {
          const alternatives = await getRouteAlternativeOptions(
            {
              name:
                request.position === 'start'
                  ? originName || '출발지'
                  : '경로 끝점',
              lat: request.from.lat,
              lng: request.from.lng,
            },
            {
              name:
                request.position === 'end'
                  ? destinationName || '도착지'
                  : '경로 시작점',
              lat: request.to.lat,
              lng: request.to.lng,
            },
            'WALK',
          );
          const providerWalkPath = alternatives
            .filter(
              option =>
                option.source === 'api' &&
                option.fallbackKind !== 'straight' &&
                Array.isArray(option.pathCoords) &&
                option.pathCoords.length >= 2,
            )
            .sort(
              (a, b) =>
                (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
                (b.distanceMeters ?? Number.POSITIVE_INFINITY),
            )[0]?.pathCoords;
          return resolveRouteEndpointAccessPath(request, providerWalkPath);
        } catch {
          return undefined;
        }
      }),
    ).then(resolvedPaths => {
      if (cancelled) return;
      setRouteEndpointAccessPaths(
        resolvedPaths.filter((path): path is RouteEndpointAccessPath => !!path),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    travelMode,
    selectedAlternative,
    originName,
    originLat,
    originLng,
    destinationName,
    destinationLat,
    destinationLng,
    setRouteEndpointAccessPaths,
  ]);
}

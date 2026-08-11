import type { Place } from '../schedule/types';
import { getRouteInfoFromRoute } from '../schedule/routeInfo';

import type { TmapLatLng, TmapPathOverlay } from './TmapMapView';

import { applyTransitRouteThemeToOverlay } from './transitRoutePresentation';

import {
  compactConsecutiveMapCoords,
  getExplicitSavedRouteRootPathCoords,
  getSavedRouteAlternative,
  getSavedRoutePathCoords,
  distinctMapCoords,
  toMapCoord,
  getSavedTransitLegCoords,
  type SavedRouteMapPresentation,
  type SavedRouteMapPresentationInput,
} from './savedRouteMapGeometry';
import {
  buildFocusedLegOverlay,
  buildRouteInfoPathOverlays,
  buildTransitLegOverlay,
  getStoredTransitOverlayAssignments,
  isValidStoredTransitAccessLink,
  parseStoredPathOverlays,
  styleNonTransitOverlay,
  styleStoredTransitOverlay,
} from './savedRouteMapOverlays';
import {
  buildNonTransitOverlays,
  buildRouteMarkers,
  buildTransitOptionPath,
  normalizeLegacySavedTransitLegs,
  placeCoord,
} from './savedRouteMapMarkers';

export type {
  SavedRouteMapPresentation,
  StoredRouteOverlayGeometryProvenance,
} from './savedRouteMapGeometry';
export {
  getSavedRouteAlternative,
  getSavedRouteOverviewFitKey,
  getSavedTransitLegCoords,
  getStoredRouteOverlayGeometryProvenance,
  resolveDetailedWalkGeometrySource,
} from './savedRouteMapGeometry';
export { getSavedTransitLegBoardCoord } from './savedRouteMapMarkers';

/** 저장 presentation 중 실제로 채택될 geometry만 사용해 고정 bounds를 만든다. */
export function getSavedRouteFitCoords(
  route: unknown,
  origin?: Place,
  destination?: Place,
): TmapLatLng[] {
  const routeOption = getSavedRouteAlternative(route);
  const storedLegs = Array.isArray(routeOption?.transitLegs)
    ? routeOption.transitLegs
    : [];
  const legs = normalizeLegacySavedTransitLegs(
    route,
    storedLegs,
    placeCoord(origin),
    placeCoord(destination),
  );
  const storedOverlays = parseStoredPathOverlays(route);
  let activeGeometry: TmapLatLng[];

  if (routeOption?.mode === 'TRANSIT' && legs.length > 0) {
    const assignments = getStoredTransitOverlayAssignments(
      storedOverlays,
      legs,
    );
    const storedOverlayIndexByLeg = new Map(
      [...assignments].map(([overlayIndex, legIndex]) => [
        legIndex,
        overlayIndex,
      ]),
    );
    const legGeometry = legs.flatMap((leg, legIndex) => {
      // A legacy WALK repaired below is authoritative. Reusing a persisted
      // overlay for that leg would put the old loop back into fit bounds.
      const overlayIndex =
        leg !== storedLegs[legIndex]
          ? undefined
          : storedOverlayIndexByLeg.get(legIndex);
      return typeof overlayIndex === 'number'
        ? storedOverlays[overlayIndex]?.coords ?? getSavedTransitLegCoords(leg)
        : getSavedTransitLegCoords(leg);
    });
    const hasMissingLegGeometry = legs.some(
      leg => getSavedTransitLegCoords(leg).length < 2,
    );
    const routeFallback = hasMissingLegGeometry
      ? getExplicitSavedRouteRootPathCoords(route)
      : [];
    activeGeometry =
      routeFallback.length >= 2
        ? [...routeFallback, ...legGeometry]
        : legGeometry;
  } else if (storedOverlays.length > 0) {
    activeGeometry = storedOverlays.flatMap(overlay => overlay.coords);
  } else {
    activeGeometry = getSavedRoutePathCoords(route, legs);
  }

  return distinctMapCoords([
    ...activeGeometry,
    ...[toMapCoord(origin), toMapCoord(destination)].filter(
      (coord): coord is TmapLatLng => !!coord,
    ),
  ]);
}

export function buildSavedRouteMapPresentation({
  route,
  origin,
  destination,
  mapZoom,
  isDark,
  focusedLegIndex,
}: SavedRouteMapPresentationInput): SavedRouteMapPresentation {
  const storedRouteOption = getSavedRouteAlternative(route);
  const routeInfo = getRouteInfoFromRoute(route);
  const storedRouteLegs = Array.isArray(storedRouteOption?.transitLegs)
    ? storedRouteOption.transitLegs
    : [];
  const routeLegs = normalizeLegacySavedTransitLegs(
    route,
    storedRouteLegs,
    placeCoord(origin),
    placeCoord(destination),
  );
  const normalizedTransitPath =
    routeLegs !== storedRouteLegs
      ? buildTransitOptionPath(routeLegs)
      : undefined;
  const routeOption =
    storedRouteOption && routeLegs !== storedRouteLegs
      ? {
          ...storedRouteOption,
          transitLegs: routeLegs,
          pathCoords: normalizedTransitPath ?? storedRouteOption.pathCoords,
        }
      : storedRouteOption;
  const pathCoords =
    routeOption?.mode === 'TRANSIT' && routeLegs.length > 0
      ? compactConsecutiveMapCoords(routeLegs.flatMap(getSavedTransitLegCoords))
      : getSavedRoutePathCoords(route, routeLegs);
  const storedOverlays = parseStoredPathOverlays(route);
  let pathOverlays: TmapPathOverlay[];

  if (routeOption?.mode === 'TRANSIT' && routeLegs.length) {
    const assignments = getStoredTransitOverlayAssignments(
      storedOverlays,
      routeLegs,
    );
    const storedOverlayIndexByLeg = new Map(
      [...assignments].map(([overlayIndex, legIndex]) => [
        legIndex,
        overlayIndex,
      ]),
    );
    const adoptedBaseCoordsByLeg = new Map<number, TmapLatLng[]>();
    const baseOverlays = routeLegs.flatMap(
      (leg, legIndex): TmapPathOverlay[] => {
        // Never resurrect a malformed persisted WALK overlay after its leg
        // geometry has been repaired for this presentation.
        const storedOverlayIndex =
          leg !== storedRouteLegs[legIndex]
            ? undefined
            : storedOverlayIndexByLeg.get(legIndex);
        const storedOverlay =
          typeof storedOverlayIndex === 'number'
            ? storedOverlays[storedOverlayIndex]
            : undefined;
        const overlay = storedOverlay
          ? styleStoredTransitOverlay(
              storedOverlay,
              mapZoom,
              leg,
              legIndex,
              focusedLegIndex,
            )
          : buildTransitLegOverlay(leg, legIndex, mapZoom, focusedLegIndex);
        if (!overlay) return [];
        adoptedBaseCoordsByLeg.set(legIndex, overlay.coords);
        return [overlay];
      },
    );
    const accessLinks =
      assignments.size > 0
        ? storedOverlays.flatMap((overlay): TmapPathOverlay[] => {
            if (!isValidStoredTransitAccessLink(overlay, routeLegs)) return [];
            const styled = styleStoredTransitOverlay(overlay, mapZoom);
            return styled ? [styled] : [];
          })
        : [];
    const hasMissingLegGeometry = routeLegs.some(
      leg => getSavedTransitLegCoords(leg).length < 2,
    );
    const explicitRootPath = hasMissingLegGeometry
      ? getExplicitSavedRouteRootPathCoords(route)
      : [];
    const fallbackOverlay =
      explicitRootPath.length >= 2
        ? {
            ...styleNonTransitOverlay(
              routeOption,
              {
                id: 'saved-route-transit-fallback',
                coords: explicitRootPath,
              },
              mapZoom,
              false,
            ),
            opacity: 0.7,
            nativeDirection: false,
            nativeDirectionColor: undefined,
            nativeDirectionOpacity: undefined,
            zIndex: 20,
          }
        : undefined;
    pathOverlays = [
      ...(fallbackOverlay ? [fallbackOverlay] : []),
      ...baseOverlays,
      ...accessLinks,
    ];
    const focused = buildFocusedLegOverlay(
      routeLegs,
      focusedLegIndex,
      mapZoom,
      typeof focusedLegIndex === 'number'
        ? adoptedBaseCoordsByLeg.get(focusedLegIndex)
        : undefined,
    );
    if (focused) pathOverlays = [...pathOverlays, focused];
    if (isDark) {
      pathOverlays = pathOverlays.map(overlay =>
        applyTransitRouteThemeToOverlay(overlay, mapZoom, 'dark'),
      );
    }
  } else if (storedOverlays.length && routeOption) {
    // 저장본에서는 경로 geometry와 안정적인 id만 복원한다. 선 색상·폭·점선·casing·
    // 방향 표시는 현재 줌/모드/테마 정책으로 다시 계산해 구형 presentation이 살아나지 않게 한다.
    pathOverlays = storedOverlays.map(overlay =>
      styleNonTransitOverlay(routeOption, overlay, mapZoom, isDark),
    );
  } else if (storedOverlays.length) {
    // 모드를 판별할 수 없는 비정상 구형 데이터는 geometry와 기존 선 표현을 유지하되,
    // 다크 지도에서 라이트 casing이 남지 않도록 최소한의 테마만 적용한다.
    pathOverlays = isDark
      ? storedOverlays.map(overlay =>
          applyTransitRouteThemeToOverlay(overlay, mapZoom, 'dark'),
        )
      : storedOverlays;
  } else if (!routeOption && routeInfo) {
    pathOverlays = buildRouteInfoPathOverlays(routeInfo, mapZoom, isDark);
  } else {
    pathOverlays = buildNonTransitOverlays(
      routeOption,
      pathCoords,
      mapZoom,
      isDark,
    );
  }

  const markers = buildRouteMarkers(
    routeOption,
    routeLegs,
    origin,
    destination,
    mapZoom,
  );
  const fitCoords = getSavedRouteFitCoords(route, origin, destination);

  return {
    routeOption,
    routeLegs,
    pathCoords,
    pathOverlays,
    markers,
    fitCoords,
  };
}

/** 저장 상세 지도에서 실제 안내선으로 그릴 수 있는 geometry가 있는지 확인한다. */
export function hasRenderableSavedRouteGeometry(
  route: unknown,
  origin?: Place,
  destination?: Place,
) {
  try {
    return buildSavedRouteMapPresentation({
      route,
      origin,
      destination,
      mapZoom: 13,
      isDark: false,
    }).pathOverlays.some(overlay => overlay.coords.length >= 2);
  } catch {
    return false;
  }
}

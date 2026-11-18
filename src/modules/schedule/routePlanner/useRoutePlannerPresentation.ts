import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import { applyOdsayBusPreview, applyOdsayEntranceEstimate, buildOdsayBusPreviewInput, buildOdsayTimetablePreviewInput } from '../../../api/transitTimetablePreview';

import {
  canPersistResolvedRoute,
} from '../../map/routeAsyncGuard';
import {
  getRouteQualityNotice,
  type RouteAlternativeOption,
  type TransitLegDetail,
} from '../../map/routingService';
import type { TmapPathOverlay } from '../../map/TmapMapView';
import {
  buildTransitRouteTimeMeta,
  formatTransitClockWithDayContext,
  getTransitModeLabels,
  getTransitRouteCategory,
  shouldShowTransitDurationOnly,
  TIMETABLE_DESTINATION_ARRIVAL_LABEL,
} from './presentation';
import {
  buildQaCameraPreset,
} from './routeMapCamera';
import {
  getRouteStrokeStyleForZoom,
  type NormalizedRoute,
} from './routeMapTypesAndStyle';
import { normalizeRouteAlternativeToSegments } from './routeTransitGeometryBuilder';
import {
  getTransitLegVisualColor,
  isRideLegKind,
} from './routeTransitLegCoordinates';
import {
  buildRouteInfoFromNormalizedRoute,
  buildTransitProgressSegmentsFromRoute,
  getPrimaryTransitLineLabel,
} from './routePlannerRouteInfo';
import {
  buildRouteSummaryMetrics,
  buildRouteInfoFromAlternative,
  formatRouteClock,
  isOdsayTimetableRouteInfo,
  roundRouteArrivalMinute,
  formatRouteDuration as formatRouteInfoDuration,
  type RouteInfo,
} from '../routeInfo';
import { buildTransitRouteProgressSegments, formatTransitWalkingSummary, getTransitRouteWalkingMinutes } from '../transitRouteProgress';
import { getRoutePlannerInitial } from '../routePlannerSession';
import { resolveSelectedRouteTiming } from '../scheduleRouteTiming';
import { TRAVEL_MODE_META } from '../travelMode';
import { useOdsayTimetablePreview } from '../useOdsayTimetablePreview';
import type { TravelMode } from '../types';
import type {
  QaCameraPresetId,
  RoutePointTarget,
  RouteQaLayerMode,
  TransitRouteFilter,
} from './params';

const TRANSIT_SEGMENT_DETAIL_MIN_ZOOM = 13.8;
const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
  { key: 'ALL', label: '전체' },
  { key: 'BUS', label: '버스' },
  { key: 'SUBWAY', label: '지하철' },
  { key: 'MIXED', label: '버스+지하철' },
];

type Options = {
  alternativesError?: string;
  destinationAddress: string;
  destinationDisplay: string;
  destinationLat?: number;
  destinationLng?: number;
  etaLoading: boolean;
  forcedEditTarget?: RoutePointTarget;
  forcedFocusZoom?: number;
  forcedRouteId?: string;
  forcedRouteIndex?: number;
  handoffRoute?: RouteAlternativeOption;
  hasDestinationCoords: boolean;
  hasOriginCoords: boolean;
  hasRouteReady: boolean;
  initial: ReturnType<typeof getRoutePlannerInitial>;
  initialRouteDepartureAt: Date;
  hasExplicitDeparture: boolean;
  isTransitMode: boolean;
  isBottomSheetHidden: boolean;
  mapZoom: number;
  originAddress: string;
  originDisplay: string;
  originLat?: number;
  originLng?: number;
  qaCameraPresetId?: QaCameraPresetId;
  qaLayerMode: RouteQaLayerMode;
  routeAlternatives: RouteAlternativeOption[];
  routeSubmitPending: boolean;
  selectedAlternativeId?: string;
  sessionId: string;
  setFocusedRouteStepId: (value: string | undefined) => void;
  transitRouteFilter: TransitRouteFilter;
  transitWalkDetailOverlays: TmapPathOverlay[];
  travelMode: TravelMode;
};

/**
 * 경로 후보 필터링부터 선택 경로의 시간·요약·헤더·정규화 형상까지 화면 표현 값을 계산한다.
 * 동일한 선택 경로를 목록, 지도, 상세 시트가 공유하도록 파생 데이터 생성을 한 경계에 모은다.
 */
export function useRoutePlannerPresentation({
  alternativesError,
  destinationAddress,
  destinationDisplay,
  destinationLat,
  destinationLng,
  etaLoading,
  forcedEditTarget,
  forcedFocusZoom,
  forcedRouteId,
  forcedRouteIndex,
  handoffRoute,
  hasDestinationCoords,
  hasOriginCoords,
  hasRouteReady,
  initial,
  initialRouteDepartureAt,
  hasExplicitDeparture,
  isBottomSheetHidden,
  isTransitMode,
  mapZoom,
  originAddress,
  originDisplay,
  originLat,
  originLng,
  qaCameraPresetId,
  qaLayerMode,
  routeAlternatives,
  routeSubmitPending,
  selectedAlternativeId,
  sessionId,
  setFocusedRouteStepId,
  transitRouteFilter,
  transitWalkDetailOverlays,
  travelMode,
}: Options) {
  const transitFilterCounts = useMemo(() => {
    const counts = {
      ALL: routeAlternatives.length,
      BUS: 0,
      SUBWAY: 0,
      MIXED: 0,
    } as Record<TransitRouteFilter, number>;
    routeAlternatives.forEach(option => {
      const category = getTransitRouteCategory(option);
      if (category !== 'ALL') counts[category] += 1;
    });
    return counts;
  }, [routeAlternatives]);
  const visibleTransitFilterItems = useMemo(
    () =>
      TRANSIT_FILTER_ITEMS.filter(
        item => item.key === 'ALL' || transitFilterCounts[item.key] > 0,
      ),
    [transitFilterCounts],
  );
  const shouldShowZoomControls = !hasRouteReady || isBottomSheetHidden;
  const initialSyncKey = useMemo(
    () =>
      JSON.stringify({
        sessionId,
        origin: initial?.origin ?? null,
        destination: initial?.destination ?? null,
        travelMode: initial?.travelMode ?? 'CAR',
        editTarget: forcedEditTarget ?? null,
        routeId: forcedRouteId ?? null,
        handoffRouteId: handoffRoute?.id ?? null,
      }),
    [sessionId, initial, forcedEditTarget, forcedRouteId, handoffRoute?.id],
  );
  const visibleAlternatives = useMemo(() => {
    if (!isTransitMode || transitRouteFilter === 'ALL')
      return routeAlternatives;
    return routeAlternatives.filter(
      option => getTransitRouteCategory(option) === transitRouteFilter,
    );
  }, [isTransitMode, routeAlternatives, transitRouteFilter]);
  const selectedAlternativeIndex = useMemo(
    () =>
      routeAlternatives.findIndex(item => item.id === selectedAlternativeId),
    [routeAlternatives, selectedAlternativeId],
  );
  const selectedVisibleAlternativeIndex = useMemo(
    () =>
      visibleAlternatives.findIndex(item => item.id === selectedAlternativeId),
    [selectedAlternativeId, visibleAlternatives],
  );
  const baseSelection = routeAlternatives[selectedAlternativeIndex];
  const targetArrivalAt = initial?.targetArrivalAt;
  const requestedDepartureAt = hasExplicitDeparture ? initialRouteDepartureAt.toISOString() : undefined;
  const handedOffPreview = baseSelection?.odsayTimetablePreview;
  const canUseHandoff = Boolean(handedOffPreview && baseSelection === handoffRoute &&
    baseSelection.provider === 'odsay' && baseSelection.transitServiceState !== 'not_operating' &&
    !etaLoading && Date.parse(handedOffPreview.departureAt) > Date.now() &&
    originLat === initial?.origin?.lat && originLng === initial?.origin?.lng &&
    destinationLat === initial?.destination?.lat && destinationLng === initial?.destination?.lng &&
    (requestedDepartureAt
      ? Date.parse(handedOffPreview.departureAt) === Date.parse(requestedDepartureAt)
      : targetArrivalAt && Date.parse(handedOffPreview.arrivalAt) <= Date.parse(targetArrivalAt)));
  const previewInput = useMemo(() => {
    if (!hasRouteReady || !isTransitMode || etaLoading || !baseSelection || canUseHandoff ||
        baseSelection.transitServiceState === 'not_operating') return undefined;
    const origin = { lat: originLat, lng: originLng };
    const destination = { lat: destinationLat, lng: destinationLng };
    if (requestedDepartureAt) {
      const time = { requestedDepartureAt };
      return { timetable: buildOdsayTimetablePreviewInput(baseSelection, time, origin, destination),
        bus: buildOdsayBusPreviewInput(baseSelection, time, origin, destination) };
    }
    if (targetArrivalAt) {
      const time = { targetArrivalAt };
      return { timetable: buildOdsayTimetablePreviewInput(baseSelection, time, origin, destination),
        bus: buildOdsayBusPreviewInput(baseSelection, time, origin, destination) };
    }
  }, [baseSelection, canUseHandoff, destinationLat, destinationLng, etaLoading, hasRouteReady,
      isTransitMode, originLat, originLng, requestedDepartureAt, targetArrivalAt]);
  const { preview, missingEntranceWalk, busPreview, waiting } = useOdsayTimetablePreview(previewInput?.timetable, previewInput?.bus);
  const selectedAlternative = useMemo(() => {
    const currentPreview = canUseHandoff ? handedOffPreview : preview;
    if (baseSelection && busPreview) return applyOdsayBusPreview(baseSelection, busPreview);
    if (baseSelection && missingEntranceWalk && !currentPreview) {
      return applyOdsayEntranceEstimate({...baseSelection, odsayTimetablePreview: undefined}, missingEntranceWalk);
    }
    return baseSelection && (currentPreview !== baseSelection.odsayTimetablePreview || busPreview !== baseSelection.odsayBusPreview)
      ? { ...baseSelection, odsayTimetablePreview: currentPreview, odsayBusPreview: busPreview }
      : baseSelection;
  }, [baseSelection, busPreview, canUseHandoff, handedOffPreview, preview, missingEntranceWalk]);
  const canSubmitRoute =
    !routeSubmitPending && !waiting &&
    canPersistResolvedRoute({
      hasRouteReady,
      routeLoading: etaLoading,
      hasSelectedRoute: !!selectedAlternative,
      routeError: alternativesError,
    });
  const openSelectedRouteAttribution = useCallback(() => {
    const attributionUrl = selectedAlternative?.attributionUrl;
    if (!attributionUrl) return;
    Linking.openURL(attributionUrl).catch(() => {
      Alert.alert('지도 정보', 'OpenStreetMap 페이지를 열지 못했습니다.');
    });
  }, [selectedAlternative?.attributionUrl]);
  const routeSegmentWalkOverlayById = useMemo(
    () =>
      new Map(
        transitWalkDetailOverlays.map(overlay => [overlay.id, overlay.coords]),
      ),
    [transitWalkDetailOverlays],
  );
  const normalizedRouteCandidates = useMemo(
    () =>
      routeAlternatives
        .map(option =>
          normalizeRouteAlternativeToSegments(
            option,
            routeSegmentWalkOverlayById,
          ),
        )
        .filter((route): route is NormalizedRoute => !!route),
    [routeAlternatives, routeSegmentWalkOverlayById],
  );
  const selectedNormalizedRoute = useMemo(
    () =>
      normalizedRouteCandidates.find(
        route => route.id === selectedAlternativeId,
      ),
    [normalizedRouteCandidates, selectedAlternativeId],
  );
  const qaCameraPreset = useMemo(
    () =>
      buildQaCameraPreset(
        qaCameraPresetId,
        selectedNormalizedRoute,
        forcedFocusZoom,
        {
          origin: hasOriginCoords
            ? { latitude: originLat!, longitude: originLng! }
            : undefined,
          destination: hasDestinationCoords
            ? { latitude: destinationLat!, longitude: destinationLng! }
            : undefined,
          transitLegs: selectedAlternative?.transitLegs,
        },
      ),
    [
      destinationLat,
      destinationLng,
      forcedFocusZoom,
      hasDestinationCoords,
      hasOriginCoords,
      originLat,
      originLng,
      qaCameraPresetId,
      selectedAlternative?.transitLegs,
      selectedNormalizedRoute,
    ],
  );
  const isQaCameraLocked = !!qaCameraPreset?.disableAutoFit;
  const transitLegendKinds = useMemo(() => {
    if (!isTransitMode || !Array.isArray(selectedAlternative?.transitLegs))
      return [];
    const orderedKinds: TransitLegDetail['kind'][] = [
      'SUBWAY',
      'BUS',
      'WALK',
      'ETC',
    ];
    const used = new Set<TransitLegDetail['kind']>(
      selectedAlternative.transitLegs.map(leg => leg.kind),
    );
    return orderedKinds.filter(kind => used.has(kind));
  }, [isTransitMode, selectedAlternative]);
  const shouldShowTransitLegend =
    transitLegendKinds.length > 0 && mapZoom >= TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
  const shouldShowTransitLegendHint =
    isTransitMode &&
    hasRouteReady &&
    transitLegendKinds.length > 0 &&
    mapZoom < TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
  const selectedAlternativeTransitModeLabels = useMemo(
    () => getTransitModeLabels(selectedAlternative?.transitLegs),
    [selectedAlternative],
  );
  const selectedAlternativeQualityNotice = useMemo(
    () =>
      selectedAlternative
        ? getRouteQualityNotice(selectedAlternative)
        : undefined,
    [selectedAlternative],
  );
  const [selectedRouteDepartureAt, setSelectedRouteDepartureAt] = useState(
    () => initialRouteDepartureAt,
  );
  const selectedTransitMeta = useMemo(
    () =>
      selectedAlternative
        ? buildTransitRouteTimeMeta(
            selectedAlternative,
            selectedRouteDepartureAt,
          )
        : undefined,
    [selectedAlternative, selectedRouteDepartureAt],
  );
  const selectedTransitProgressSegments = useMemo(() => {
    if (selectedAlternative?.transitLegs?.some(leg => leg.journeyPhase === 'BUFFER')) {
      return buildTransitRouteProgressSegments(selectedAlternative.transitLegs);
    }
    const segmentBasedProgress = buildTransitProgressSegmentsFromRoute(
      selectedNormalizedRoute,
    );
    return segmentBasedProgress.length > 0
      ? segmentBasedProgress
      : buildTransitRouteProgressSegments(selectedAlternative?.transitLegs);
  }, [selectedAlternative, selectedNormalizedRoute]);
  const primaryTransitLineLabel = useMemo(
    () =>
      selectedAlternative
        ? getPrimaryTransitLineLabel(selectedAlternative.transitLegs)
        : '대중교통',
    [selectedAlternative],
  );
  const selectedRouteInfo = useMemo<RouteInfo | undefined>(() => {
    if (!selectedAlternative) return undefined;
    const originPlace = hasOriginCoords
      ? {
          name: originDisplay,
          address: originAddress.trim() || undefined,
          lat: originLat,
          lng: originLng,
        }
      : undefined;
    const destinationPlace = hasDestinationCoords
      ? {
          name: destinationDisplay,
          address: destinationAddress.trim() || undefined,
          lat: destinationLat,
          lng: destinationLng,
        }
      : undefined;
    const baseRouteInfo = buildRouteInfoFromAlternative(
      selectedAlternative,
      originPlace,
      destinationPlace,
      selectedRouteDepartureAt,
      selectedAlternativeIndex,
    );
    const candidateRouteInfo = isTransitMode && !selectedAlternative.odsayTimetablePreview &&
      !selectedAlternative.odsayBusPreview && !missingEntranceWalk
      ? buildRouteInfoFromNormalizedRoute(
          baseRouteInfo,
          selectedNormalizedRoute,
        )
      : baseRouteInfo;
    const selectedTiming = resolveSelectedRouteTiming({
      targetArrivalAt: hasExplicitDeparture || selectedAlternative.odsayBusPreview ? undefined : initial?.targetArrivalAt,
      routeInfo: candidateRouteInfo,
      fallbackDepartureAt: selectedRouteDepartureAt,
    });
    return {
      ...candidateRouteInfo,
      departureTime: selectedTiming.departureAt.toISOString(),
      arrivalTime: selectedTiming.arrivalAt.toISOString(),
    };
  }, [
    destinationAddress,
    destinationDisplay,
    destinationLat,
    destinationLng,
    hasDestinationCoords,
    hasOriginCoords,
    initial?.targetArrivalAt,
    hasExplicitDeparture,
    isTransitMode,
    missingEntranceWalk,
    originAddress,
    originDisplay,
    originLat,
    originLng,
    selectedAlternative,
    selectedAlternativeIndex,
    selectedNormalizedRoute,
    selectedRouteDepartureAt,
  ]);
  const finalSelectedRouteDepartureTime =
    selectedRouteInfo?.departureTime ?? selectedRouteDepartureAt.toISOString();
  const selectedCollapsedRouteSummary = useMemo(() => {
    if (!selectedRouteInfo) return undefined;
    const arrival = selectedRouteInfo.arrivalTime;
    const timetableArrival = isOdsayTimetableRouteInfo(selectedRouteInfo) ? roundRouteArrivalMinute(arrival) : undefined;
    const arrivalText = timetableArrival && selectedRouteInfo.departureTime
      ? formatTransitClockWithDayContext(timetableArrival, new Date(selectedRouteInfo.departureTime))
      : formatRouteClock(timetableArrival ?? arrival);
    const legs = selectedAlternative?.transitLegs;
    const hasTransitLegs = selectedAlternative?.mode === 'TRANSIT' && Boolean(legs?.length);
    const walkingSummary = hasTransitLegs && legs
      ? formatTransitWalkingSummary(getTransitRouteWalkingMinutes(legs, selectedAlternative?.odsayTimetablePreview))
      : undefined;
    const metrics = buildRouteSummaryMetrics(selectedRouteInfo)
      .filter(
        ({ key }) => key === 'fare' || key === 'transfer' || (key === 'walk' && !hasTransitLegs),
      )
      .map(({ label }) => label);
    if (walkingSummary) metrics.push(walkingSummary);
    return {
      arrivalText: shouldShowTransitDurationOnly(selectedAlternative) || selectedAlternative?.transitServiceState === 'not_operating'
        ? undefined
        : (arrivalText
        ? `${arrivalText} ${selectedAlternative?.odsayTimetablePreview ? TIMETABLE_DESTINATION_ARRIVAL_LABEL :
          selectedAlternative?.odsayBusPreview ? '예상 도착 · 실시간 반영' :
          selectedRouteInfo.timeBasis === 'provider_schedule' ? '도착' : '예상 도착'}`
        : undefined),
      metricsText: metrics.join(' · '),
    };
  }, [selectedAlternative, selectedRouteInfo]);
  const selectedTransitPrimaryRideLeg = useMemo(
    () =>
      selectedAlternative?.transitLegs?.find(leg => isRideLegKind(leg.kind)),
    [selectedAlternative],
  );
  const selectedRouteDuration = selectedAlternative
    ? selectedAlternative.transitServiceState === 'not_operating'
      ? '운행 종료'
      : formatRouteInfoDuration(
          selectedRouteInfo?.totalDurationMinutes ??
            selectedAlternative.minutes,
        )
    : TRAVEL_MODE_META[travelMode].label;
  const selectedTransitHeaderLineColor = selectedTransitPrimaryRideLeg
    ? getTransitLegVisualColor(selectedTransitPrimaryRideLeg)
    : '#22C55E';
  const selectedDetailHeaderColor = isTransitMode
    ? selectedTransitHeaderLineColor
    : travelMode === 'BIKE'
    ? '#00897B'
    : travelMode === 'WALK'
    ? '#64748B'
    : '#2979FF';
  const nextHeaderAlternativeIndex =
    visibleAlternatives.length > 1
      ? ((selectedVisibleAlternativeIndex >= 0
          ? selectedVisibleAlternativeIndex
          : 0) +
          1) %
        visibleAlternatives.length
      : undefined;
  const nextHeaderAlternative =
    typeof nextHeaderAlternativeIndex === 'number'
      ? visibleAlternatives[nextHeaderAlternativeIndex]
      : undefined;
  const nextHeaderRideLeg = nextHeaderAlternative?.transitLegs?.find(leg =>
    isRideLegKind(leg.kind),
  );
  const nextHeaderIcon: React.ComponentProps<typeof ExpoIonicons>['name'] =
    nextHeaderRideLeg?.kind === 'BUS' ? 'bus-outline' : 'train-outline';
  const nextHeaderColor = nextHeaderRideLeg
    ? getTransitLegVisualColor(nextHeaderRideLeg)
    : selectedDetailHeaderColor;
  const nextHeaderLabel = nextHeaderAlternative
    ? `${getPrimaryTransitLineLabel(
        nextHeaderAlternative.transitLegs,
      )} · ${formatRouteInfoDuration(nextHeaderAlternative.minutes)}`
    : undefined;
  const routeStrokeStyle = getRouteStrokeStyleForZoom(mapZoom);
  const routeOverlayScopeKey = useMemo(
    () =>
      [
        travelMode,
        selectedNormalizedRoute?.id ?? selectedAlternativeId ?? 'none',
        forcedRouteId ?? 'route',
        typeof forcedRouteIndex === 'number' ? forcedRouteIndex : 'auto',
        qaLayerMode,
      ].join(':'),
    [
      forcedRouteId,
      forcedRouteIndex,
      qaLayerMode,
      selectedAlternativeId,
      selectedNormalizedRoute?.id,
      travelMode,
    ],
  );

  useEffect(() => {
    const providerDepartureAt = selectedAlternative?.transitDepartureAt
      ? new Date(selectedAlternative.transitDepartureAt)
      : undefined;
    setSelectedRouteDepartureAt(
      providerDepartureAt && Number.isFinite(providerDepartureAt.getTime())
        ? providerDepartureAt
        : initialRouteDepartureAt,
    );
    setFocusedRouteStepId(undefined);
  }, [
    initialRouteDepartureAt,
    selectedAlternative?.transitDepartureAt,
    selectedAlternativeId,
    setFocusedRouteStepId,
  ]);

  return {
    canSubmitRoute,
    finalSelectedRouteDepartureTime,
    initialSyncKey,
    isQaCameraLocked,
    nextHeaderColor,
    nextHeaderAlternativeIndex,
    nextHeaderIcon,
    nextHeaderLabel,
    normalizedRouteCandidates,
    openSelectedRouteAttribution,
    primaryTransitLineLabel,
    qaCameraPreset,
    routeOverlayScopeKey,
    routeStrokeStyle,
    selectedAlternative,
    selectedAlternativeIndex,
    selectedAlternativeQualityNotice,
    selectedAlternativeTransitModeLabels,
    selectedCollapsedRouteSummary,
    selectedRouteDepartureAt,
    selectedRouteInfo,
    selectedNormalizedRoute,
    selectedTransitMeta,
    selectedTransitProgressSegments,
    selectedRouteDuration,
    shouldShowTransitLegend,
    shouldShowTransitLegendHint,
    shouldShowZoomControls,
    transitFilterCounts,
    transitLegendKinds,
    visibleAlternatives,
    visibleTransitFilterItems,
    selectedVisibleAlternativeIndex,
  };
}

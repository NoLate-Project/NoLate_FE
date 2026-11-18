import { assertTicketService, getImportedTicket } from '../../modules/schedule/importedTicket';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Easing, Keyboard, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useImmediateNavigationTransition } from "../../modules/performance/ImmediateNavigationTransition";
import { usePreMountedSceneActivity } from "../../modules/performance/preMountedSceneActivity";
import { useSystemReduceMotion } from "../../modules/performance/useSystemReduceMotion";
import { applyOdsayBusPreview, applyOdsayEntranceEstimate, buildOdsayBusPreviewInput, buildOdsayTimetablePreviewInput, isFreshOdsayBusPreview } from "../../api/transitTimetablePreview";
import { useOdsayTimetablePreview } from "../../modules/schedule/useOdsayTimetablePreview";

import {
    getRouteAlternativeOptions,
    invalidateRouteSearch,
    RouteSearchError,
    type RouteAlternativeOption,
    type RouteSearchErrorCode,
} from "../../modules/map/routingService";
import {
    getRouteCandidateListSnapshot,
    getRoutePlannerInitial,
    setRouteCandidateListSnapshot,
    setRoutePlannerInitial,
    setRoutePlannerResult,
} from "../../modules/schedule/routePlannerSession";
import { isOdsayTimetableDepartureExpired, resolveScheduleRouteDepartureContext } from "../../modules/schedule/scheduleRouteTiming";
import type { Place, TravelMode } from "../../modules/schedule/types";
import { buildIntercityJourney, validateIntercityJourneyTiming, type IntercitySelection } from "../../modules/schedule/intercityJourney";
import { buildRouteInfoFromAlternative } from "../../modules/schedule/routeInfo";
import {
    primeRouteDetailAdvertising,
    showRouteDetailInterstitialIfEligible,
} from "../../modules/advertising/routeDetailInterstitial";
import {
    TRANSIT_FILTER_ITEMS,
    type TransitRouteFilter,
} from "./RouteSelectAnimatedControls";
import {
    getTransitFilterCount,
    resolveRouteOptionTiming,
    sortRouteAlternativesForDisplay,
} from "./routeSelectRouteModel";
import { buildPlace } from "./routeSelectPlaceModel";

type RouteSelectRouteControllerOptions = {
    initial: ReturnType<typeof getRoutePlannerInitial>;
    returnFromMap?: boolean;
    deferRouteSearch?: boolean;
    initialTravelMode: TravelMode;
    sessionId?: string;
    origin?: Place;
    destination?: Place;
    hasRouteCoords: boolean;
    shouldShowRouteResults: boolean;
    bottomInset: number;
    originText: string;
    originAddress?: string;
    originLat?: number;
    originLng?: number;
    destinationText: string;
    destinationAddress?: string;
    destinationLat?: number;
    destinationLng?: number;
};

/**
 * 이동수단별 경로 검색, 필터·선택 애니메이션, 상세 지도 진입과 최종 경로 저장을 관리한다.
 * 일정 도착 시각이 있으면 첫 대중교통 결과로 출발 시각을 한 번 보정하고 재시도 시 초기 정책으로 되돌린다.
 */
export function useRouteSelectRouteController({
    initial,
    returnFromMap = false,
    deferRouteSearch = false,
    initialTravelMode,
    sessionId,
    origin,
    destination,
    hasRouteCoords,
    shouldShowRouteResults,
    bottomInset,
    originText,
    originAddress,
    originLat,
    originLng,
    destinationText,
    destinationAddress,
    destinationLat,
    destinationLng,
}: RouteSelectRouteControllerOptions) {
    const importedTicket = getImportedTicket(initial?.route);
    const router = useRouter();
    const { closeActiveScene, runWithTransitionShell } = useImmediateNavigationTransition();
    const sceneActive = usePreMountedSceneActivity();
    const returnedRoute = initial?.route as RouteAlternativeOption | undefined;
    const resumedList = useMemo(() => {
        if (!returnFromMap || !sessionId || !returnedRoute?.id) return undefined;
        const snapshot = getRouteCandidateListSnapshot(sessionId);
        if (!snapshot?.alternatives.some((option) => option.id === returnedRoute.id)) return undefined;
        const filter = snapshot.transitFilter;
        const canKeepFilter = filter === "ALL" || getTransitFilterCount([returnedRoute], filter) > 0;
        const returnsToSameCandidate = canKeepFilter && snapshot.selectedRouteId === returnedRoute.id;
        return {
            ...snapshot,
            selectedRouteId: returnedRoute.id,
            transitFilter: canKeepFilter ? filter : "ALL" as const,
            scrollY: returnsToSameCandidate ? snapshot.scrollY : undefined,
            selectedDetailsCollapsed: returnsToSameCandidate && snapshot.selectedDetailsCollapsed,
        };
    }, [returnFromMap, returnedRoute, sessionId]);
    const [travelMode, setTravelMode] = useState<TravelMode>(initialTravelMode);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>(resumedList?.alternatives ?? []);
    const [requestedRouteId, setSelectedRouteId] = useState<string | undefined>(resumedList?.selectedRouteId);
    const [collapsedCandidateId, setCollapsedCandidateId] = useState(
        resumedList?.selectedDetailsCollapsed ? resumedList.selectedRouteId : undefined,
    );
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>(resumedList?.transitFilter ?? "ALL");
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeFailure, setRouteFailure] = useState<{ message: string; code?: RouteSearchErrorCode }>();
    const routeError = routeFailure?.message;
    const [noProviderRoute, setNoProviderRoute] = useState(false);
    const reduceMotion = useSystemReduceMotion();
    const [routeRequestVersion, setRouteRequestVersion] = useState(0);
    const [routeSubmitPending, setRouteSubmitPending] = useState(false);
    const [pendingMapEntryContext, setPendingMapEntryContext] = useState<object>();
    const [failedMapEntry, setFailedMapEntry] = useState<{ selection: object; routeId: string }>();
    const routeSubmitPendingRef = useRef(false);
    const pendingMapEntryRef = useRef<{ context: object } | undefined>(undefined);
    const routeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const matchesInitialRoute = travelMode === initial?.travelMode &&
        origin?.lat === initial?.origin?.lat && origin?.lng === initial?.origin?.lng &&
        destination?.lat === initial?.destination?.lat && destination?.lng === initial?.destination?.lng;
    const initialEstimateMinutes = matchesInitialRoute ? initial?.travelMinutes : undefined;
    const requestedDepartureAt = matchesInitialRoute && travelMode === "TRANSIT"
        ? initial?.requestedDepartureAt
        : undefined;
    const routeTimingKey = JSON.stringify([
        origin?.lat, origin?.lng, destination?.lat, destination?.lng,
        sessionId, travelMode, initial?.targetArrivalAt, initialEstimateMinutes, requestedDepartureAt, routeRequestVersion,
    ]);
    const resumedTimingKey = useRef(resumedList ? routeTimingKey : undefined);
    const usingResumedList = Boolean(resumedList && resumedTimingKey.current === routeTimingKey);
    const selectionContextRef = useRef(routeTimingKey);
    selectionContextRef.current = routeTimingKey;
    const selectionMountedRef = useRef(true);
    useEffect(() => { selectionMountedRef.current = true; return () => { selectionMountedRef.current = false; }; }, []);
    const explicitDeparture = useMemo(() => {
        const date = requestedDepartureAt ? new Date(requestedDepartureAt) : undefined;
        return date && Number.isFinite(date.getTime()) ? date : undefined;
    }, [requestedDepartureAt]);
    const initialDepartureContext = useMemo(() => {
        const context = resolveScheduleRouteDepartureContext(initial?.targetArrivalAt, initialEstimateMinutes);
        return {
            key: routeTimingKey,
            context: explicitDeparture ? { ...context, departureAt: explicitDeparture, scheduleBased: false } : context,
        };
    }, [initial?.targetArrivalAt, initialEstimateMinutes, explicitDeparture, routeTimingKey]);
    const [refinedDepartureContext, setRefinedDepartureContext] = useState<typeof initialDepartureContext>();
    // 새 장소/수단의 첫 렌더부터 이전 경로의 출발 기준을 사용하지 않는다.
    const routeDepartureContext = usingResumedList && resumedList
        ? { ...initialDepartureContext.context, departureAt: resumedList.departureAt }
        : refinedDepartureContext?.key === routeTimingKey
        ? refinedDepartureContext.context
        : initialDepartureContext.context;
    const routeDepartureAt = routeDepartureContext.departureAt;
    const routeScheduleBased = routeDepartureContext.scheduleBased;
    const routeTargetArrivalAt = explicitDeparture ? undefined : routeDepartureContext.targetArrivalAt;
    const scheduleTimingRefinedRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        scheduleTimingRefinedRef.current = undefined;
        setRefinedDepartureContext(undefined);
    }, [routeTimingKey]);
    const routeContentAnim = useRef(new Animated.Value(1)).current;

    const transitFilterCounts = useMemo(
        () => TRANSIT_FILTER_ITEMS.reduce<Record<TransitRouteFilter, number>>((acc, item) => {
            acc[item.key] = getTransitFilterCount(routeAlternatives, item.key);
            return acc;
        }, { ALL: 0, SUBWAY: 0, BUS: 0, MIXED: 0 }),
        [routeAlternatives]
    );
    const [routeResultsTimingKey, setRouteResultsTimingKey] = useState<string>();
    const baseVisibleRoutes = useMemo(() => {
        const sorted = sortRouteAlternativesForDisplay(routeAlternatives.filter(option => !option.intercityJourney), travelMode, transitRouteFilter);
        const anchored = routeAlternatives.filter(option => option.intercityJourney && (transitRouteFilter === "ALL" || getTransitFilterCount([option], transitRouteFilter) > 0));
        return [...anchored, ...sorted].slice(0, 5);
    }, [routeAlternatives, transitRouteFilter, travelMode]);
    const baseSelection = baseVisibleRoutes.find(option => option.id === requestedRouteId) ?? baseVisibleRoutes[0];
    const previewInput = useMemo(() => {
        if (routeResultsTimingKey !== routeTimingKey && !usingResumedList) return undefined;
        if (!baseSelection || routeLoading ||
            !shouldShowRouteResults || sceneActive === false) return undefined;
        if (explicitDeparture) {
            const time = { requestedDepartureAt: explicitDeparture.toISOString() };
            return { timetable: buildOdsayTimetablePreviewInput(baseSelection, time, origin, destination),
                bus: buildOdsayBusPreviewInput(baseSelection, time, origin, destination) };
        }
        if (!routeTargetArrivalAt) return undefined;
        const time = { targetArrivalAt: routeTargetArrivalAt.toISOString() };
        return { timetable: buildOdsayTimetablePreviewInput(baseSelection, time, origin, destination),
            bus: buildOdsayBusPreviewInput(baseSelection, time, origin, destination) };
    }, [baseSelection, destination, explicitDeparture, origin, routeLoading, routeResultsTimingKey,
        routeTargetArrivalAt, routeTimingKey, sceneActive, shouldShowRouteResults, usingResumedList]);
    const { preview: currentPreview, missingEntranceWalk, busPreview, waiting: waitingForPreview } =
        useOdsayTimetablePreview(previewInput?.timetable, previewInput?.bus);
    const visibleRouteAlternatives = useMemo(() => (currentPreview || missingEntranceWalk || busPreview) && baseSelection
        ? baseVisibleRoutes.map(option => option === baseSelection
            ? busPreview ? applyOdsayBusPreview(option, busPreview)
                : missingEntranceWalk ? applyOdsayEntranceEstimate(option, missingEntranceWalk)
                    : { ...option, odsayTimetablePreview: currentPreview }
            : option)
        : baseVisibleRoutes, [baseSelection, baseVisibleRoutes, currentPreview, missingEntranceWalk, busPreview]);
    const selectedRoute = visibleRouteAlternatives.find(option => option.id === requestedRouteId)
        ?? visibleRouteAlternatives[0];
    const selectedRouteId = selectedRoute?.id;
    const mapEntrySelection = useMemo(() => ({
        routeTimingKey, transitRouteFilter, selectedRouteId,
    }), [routeTimingKey, transitRouteFilter, selectedRouteId]);
    const mapEntryContext = useMemo(() => ({
        selection: mapEntrySelection, shouldShowRouteResults,
        sceneActive, collapsedCandidateId, visibleRouteAlternatives,
    }), [
        mapEntrySelection, shouldShowRouteResults,
        sceneActive, collapsedCandidateId, visibleRouteAlternatives,
    ]);
    const mapEntryContextRef = useRef(mapEntryContext);
    mapEntryContextRef.current = mapEntryContext;
    const routeMapPending = pendingMapEntryContext === mapEntryContext;
    const failedMapRouteId = failedMapEntry?.selection === mapEntrySelection ? failedMapEntry.routeId : undefined;
    const visibleRouteSignature = useMemo(
        () => visibleRouteAlternatives.map((option) => option.id).join("|"),
        [visibleRouteAlternatives]
    );
    const lastAnimatedResultKey = useRef<string | undefined>(undefined);
    const showTransitRecovery = travelMode === "TRANSIT" && !routeLoading && noProviderRoute;
    const routeContentAnimatedStyle = useMemo(() => ({
        opacity: routeContentAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.82, 1],
        }),
    }), [routeContentAnim]);

    useEffect(() => {
        if (!reduceMotion) return;
        routeContentAnim.stopAnimation();
        routeContentAnim.setValue(1);
    }, [reduceMotion, routeContentAnim]);

    const animateRouteContent = useCallback(() => {
        routeContentAnim.stopAnimation();
        if (reduceMotion) {
            routeContentAnim.setValue(1);
            return;
        }
        routeContentAnim.setValue(0);
        Animated.timing(routeContentAnim, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [reduceMotion, routeContentAnim]);

    const selectTravelMode = useCallback((nextMode: TravelMode) => {
        if (travelMode === nextMode) return;
        setRouteLoading(true);
        setTravelMode(nextMode);
    }, [travelMode]);

    const selectTransitFilter = useCallback((nextFilter: TransitRouteFilter) => {
        if (transitRouteFilter === nextFilter) return;
        if (nextFilter !== "ALL" && transitFilterCounts[nextFilter] === 0) return;
        setTransitRouteFilter(nextFilter);
    }, [transitFilterCounts, transitRouteFilter]);
    const hasTransitFilters = travelMode === "TRANSIT" && hasRouteCoords && routeAlternatives.length > 0 &&
        !(routeLoading);
    const routeListBottomPadding = Math.max(bottomInset + 24, 36);

    const persistInitial = useCallback((
        travelMinutes?: number,
        targetSessionId = sessionId,
        routeToStore?: RouteAlternativeOption
    ) => {
        if (!targetSessionId) return;
        const nextOrigin = buildPlace(originText, originAddress, originLat, originLng);
        const nextDestination = buildPlace(destinationText, destinationAddress, destinationLat, destinationLng);
        setRoutePlannerInitial(targetSessionId, {
            returnToScheduleDraft: initial?.returnToScheduleDraft,
            appliesToExistingSchedule: initial?.appliesToExistingSchedule,
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name || nextOrigin?.name,
            targetArrivalAt: initial?.targetArrivalAt,
            departureAt: routeToStore?.intercityJourney?.departureAt ?? routeDepartureAt.toISOString(),
            requestedDepartureAt,
            route: routeToStore ? { ...routeToStore, importedTicket } : initial?.route,
        });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        initial?.targetArrivalAt,
        initial?.returnToScheduleDraft,
        initial?.appliesToExistingSchedule,
        initial?.route,
        importedTicket,
        originAddress,
        originLat,
        originLng,
        originText,
        routeDepartureAt,
        requestedDepartureAt,
        sessionId,
        travelMode,
    ]);

    const close = useCallback(() => {
        if (closeActiveScene()) return;
        if (router.canGoBack()) {
            router.back();
            return;
        }
        router.replace("/schedule");
    }, [closeActiveScene, router]);

    const goToScheduleList = useCallback(() => {
        Keyboard.dismiss();
        runWithTransitionShell(
            { route: "/schedule", title: "일정", showBack: false },
            () => router.replace("/schedule"),
        );
    }, [router, runWithTransitionShell]);

    const openPlaceSettings = useCallback(() => {
        Keyboard.dismiss();
        const openSettings = () => router.push({
            pathname: "/settings/places",
            params: { from: "route-search" },
        });
        if (sceneActive) {
            runWithTransitionShell(
                { route: "/settings/places", title: "내 장소" },
                openSettings,
            );
            return;
        }
        openSettings();
    }, [router, runWithTransitionShell, sceneActive]);

    useEffect(() => {
        if (!shouldShowRouteResults) {
            lastAnimatedResultKey.current = undefined;
            return;
        }
        const key = JSON.stringify([travelMode, transitRouteFilter, routeLoading, routeError, visibleRouteSignature]);
        const previous = lastAnimatedResultKey.current;
        if (previous === key) return;
        lastAnimatedResultKey.current = key;
        if (previous === undefined && usingResumedList) return;
        animateRouteContent();
    }, [animateRouteContent, routeError, routeLoading, shouldShowRouteResults, transitRouteFilter, travelMode, usingResumedList, visibleRouteSignature]);

    useEffect(() => {
        if (travelMode !== "TRANSIT" && transitRouteFilter !== "ALL") {
            setTransitRouteFilter("ALL");
        }
    }, [transitRouteFilter, travelMode]);

    const retryRouteSearch = useCallback(() => {
        invalidateRouteSearch(origin, destination, travelMode);
        setRouteRequestVersion((current) => current + 1);
    }, [destination, origin, travelMode]);

    const openRouteAttribution = useCallback((option: RouteAlternativeOption) => {
        if (!option.attributionUrl) return;
        Linking.openURL(option.attributionUrl).catch(() => {
            Alert.alert("지도 정보", "OpenStreetMap 페이지를 열지 못했습니다.");
        });
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (usingResumedList || deferRouteSearch) return;
        resumedTimingKey.current = undefined;
        setSelectedRouteId(undefined);
        setCollapsedCandidateId(undefined);
        setRouteAlternatives([]);
        setRouteFailure(undefined);
        setNoProviderRoute(false);

        if (!hasRouteCoords) {
            setRouteLoading(false);
            return;
        }

        const saved = initial?.route as RouteAlternativeOption | undefined;
        if (matchesInitialRoute && routeRequestVersion === 0 && saved?.intercityJourney) {
            setRouteAlternatives([saved]); setSelectedRouteId(saved.id); setRouteLoading(false);
            return;
        }
        setRouteLoading(true);
        getRouteAlternativeOptions(
            origin,
            destination,
            travelMode,
            travelMode === "TRANSIT" ? { departureAt: routeDepartureAt } : undefined
        )
            .then((items) => {
                if (cancelled) return;
                const candidates = travelMode === "TRANSIT"
                    ? items.filter((option) => option.mode === "TRANSIT" && !(
                        option.transitLegs?.length && option.transitLegs.every((leg) => leg.kind === "WALK")
                    ))
                    : items;
                const displayItems = sortRouteAlternativesForDisplay(candidates, travelMode, "ALL");
                const firstDisplayRouteId = displayItems[0]?.id;
                setRouteAlternatives(candidates);
                setRouteResultsTimingKey(routeTimingKey);
                setSelectedRouteId(firstDisplayRouteId);
                setNoProviderRoute(travelMode === "TRANSIT" && candidates.length === 0);
                setRouteFailure(candidates.length ? undefined : { message: "표시할 경로가 없습니다." });

                const firstRoute = displayItems[0];
                if (
                    travelMode === "TRANSIT" &&
                    !explicitDeparture &&
                    initial?.targetArrivalAt &&
                    firstRoute &&
                    // maasRP의 SearchTime은 추정 구간의 기준 시각만 바꾼다.
                    // 같은 후보를 다시 검색해도 예정 대기나 환승 시간이 보정되지 않는다.
                    !(firstRoute.provider === "odsay" && firstRoute.providerTimeBasis === "route_estimate") &&
                    scheduleTimingRefinedRef.current !== routeTimingKey
                ) {
                    scheduleTimingRefinedRef.current = routeTimingKey;
                    const refined = resolveScheduleRouteDepartureContext(
                        initial.targetArrivalAt,
                        firstRoute.minutes
                    );
                    const adjustmentMinutes = Math.abs(
                        refined.departureAt.getTime() - routeDepartureAt.getTime()
                    ) / 60_000;
                    if (refined.scheduleBased && adjustmentMinutes >= 5) {
                        setRefinedDepartureContext({ key: routeTimingKey, context: refined });
                    }
                }
            })
            .catch((error) => {
                if (cancelled) return;
                const code = error instanceof RouteSearchError ? error.code : undefined;
                setNoProviderRoute(code === "NO_PROVIDER_ROUTE");
                const message = error instanceof Error ? error.message : "경로 계산에 실패했습니다.";
                setRouteFailure({ message, code });
            })
            .finally(() => {
                if (!cancelled) setRouteLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        deferRouteSearch,
        destination,
        hasRouteCoords,
        initial?.targetArrivalAt,
        initial?.route,
        matchesInitialRoute,
        origin,
        routeDepartureAt,
        routeRequestVersion,
        routeTimingKey,
        travelMode,
        usingResumedList,
        explicitDeparture,
    ]);

    useEffect(() => {
        if (selectedRouteId !== undefined && selectedRouteId !== requestedRouteId) {
            setSelectedRouteId(selectedRouteId);
        }
    }, [requestedRouteId, selectedRouteId]);

    const openMapForOption = useCallback(async (routeOption?: RouteAlternativeOption, scrollY = 0) => {
        if (pendingMapEntryRef.current?.context === mapEntryContext) return;
        const targetRoute = routeOption ?? selectedRoute;
        if (!targetRoute) {
            Alert.alert("경로 선택 필요", "상세 지도에서 확인할 경로를 선택해 주세요.");
            return;
        }
        if (importedTicket) {
            try { assertTicketService(importedTicket, targetRoute.intercityJourney?.service); }
            catch (cause) { Alert.alert("승차권 연결 필요", cause instanceof Error ? cause.message : "승차권 운행편을 연결해 주세요."); return; }
        }
        const targetIndex = routeAlternatives.findIndex((option) => option.id === targetRoute.id);
        const targetSessionId = sessionId || `route-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const entry = { context: mapEntryContext };
        pendingMapEntryRef.current = entry;
        setPendingMapEntryContext(mapEntryContext);
        setFailedMapEntry(undefined);
        const isCurrentEntry = () => selectionMountedRef.current &&
            pendingMapEntryRef.current === entry && mapEntryContextRef.current === mapEntryContext;
        try {
            await showRouteDetailInterstitialIfEligible();
            if (!isCurrentEntry()) return;
            // Use the candidate and list the user still sees after the ad check.
            persistInitial(targetRoute.minutes, targetSessionId, targetRoute);
            setRouteCandidateListSnapshot(targetSessionId, {
                alternatives: routeAlternatives,
                visibleRouteIds: visibleRouteAlternatives.map(option => option.id),
                selectedRouteId: targetRoute.id,
                selectedDetailsCollapsed: collapsedCandidateId === targetRoute.id,
                transitFilter: transitRouteFilter,
                scrollY,
                departureAt: routeDepartureAt,
            });
            router.replace({
                pathname: "/schedule/route-planner",
                params: {
                    sessionId: targetSessionId,
                    routeId: targetRoute.id,
                    routeIndex: targetIndex >= 0 ? String(targetIndex) : "0",
                    entrySource: "route-candidates",
                },
            });
        } catch {
            if (isCurrentEntry()) setFailedMapEntry({ selection: mapEntrySelection, routeId: targetRoute.id });
        } finally {
            if (pendingMapEntryRef.current === entry) {
                pendingMapEntryRef.current = undefined;
                if (selectionMountedRef.current) setPendingMapEntryContext(undefined);
            }
        }
    }, [collapsedCandidateId, importedTicket, mapEntryContext, mapEntrySelection, persistInitial, routeAlternatives, routeDepartureAt, router, selectedRoute, sessionId, transitRouteFilter, visibleRouteAlternatives]);

    useEffect(() => {
        primeRouteDetailAdvertising().catch(() => undefined);
    }, []);

    const applyIntercityService = useCallback(async (option: RouteAlternativeOption, legIndex: number, selection: IntercitySelection, isCurrent: () => boolean) => {
        if (!origin || !destination) throw new Error("출발지와 도착지를 다시 선택해 주세요.");
        const context = selectionContextRef.current;
        if (importedTicket) assertTicketService(importedTicket, selection.service);
        const connected = await buildIntercityJourney({ option: { ...option, importedTicket }, legIndex, origin, destination, selection, targetArrivalAt: initial?.targetArrivalAt, search: getRouteAlternativeOptions });
        if (!selectionMountedRef.current || context !== selectionContextRef.current || !isCurrent()) throw new Error("경로가 변경되어 적용하지 않았습니다. 다시 선택해 주세요.");
        setRouteAlternatives(current => [connected, ...current.filter(item => !item.intercityJourney)]);
        setTransitRouteFilter("ALL"); setSelectedRouteId(connected.id);
        return connected.id;
    }, [destination, importedTicket, initial?.targetArrivalAt, origin]);

    const saveRouteOption = useCallback((routeOption: RouteAlternativeOption, routeIndex: number) => {
        if (routeSubmitPendingRef.current || waitingForPreview) return;
        if (!sessionId) {
            Alert.alert("저장할 일정이 없어요", "일정 화면에서 이동 경로를 다시 열어 주세요.");
            return;
        }

        if (importedTicket) {
            try { assertTicketService(importedTicket, routeOption.intercityJourney?.service); }
            catch (cause) { Alert.alert("승차권 연결 필요", cause instanceof Error ? cause.message : "승차권 운행편을 연결해 주세요."); return; }
        }
        if (routeOption.intercityJourney) {
            try { validateIntercityJourneyTiming(routeOption.intercityJourney, initial?.targetArrivalAt); }
            catch (cause) { Alert.alert("운행편 확인 필요", cause instanceof Error ? cause.message : "다시 선택해 주세요."); return; }
        }
        // Preview data only belongs to this selected candidate and this search context.
        const preview = routeOption.id === baseSelection?.id ? currentPreview : undefined;
        const bus = routeOption.id === baseSelection?.id && isFreshOdsayBusPreview(busPreview) ? busPreview : undefined;
        if (routeOption.odsayBusPreview && !bus) {
            Alert.alert("버스 예측이 만료됐어요", "경로를 다시 검색해 최신 도착 시각을 확인해 주세요.", [
                { text: "닫기", style: "cancel" },
                { text: "다시 검색", onPress: retryRouteSearch },
            ]);
            return;
        }
        if (isOdsayTimetableDepartureExpired(preview?.departureAt)) {
            Alert.alert("출발 시각이 지났어요", explicitDeparture
                ? "지도에서 새 출발 시각을 선택한 뒤 경로를 다시 확인해 주세요."
                : "다시 검색해 일정에 맞는 경로를 확인해 주세요.",
                explicitDeparture ? undefined : [
                    { text: "닫기", style: "cancel" },
                    { text: "다시 검색", onPress: retryRouteSearch },
                ]);
            return;
        }
        const nextOrigin = buildPlace(originText, originAddress, originLat, originLng);
        const nextDestination = buildPlace(destinationText, destinationAddress, destinationLat, destinationLng);
        const candidateRouteInfo = buildRouteInfoFromAlternative(
            { ...routeOption, odsayTimetablePreview: preview, odsayBusPreview: bus },
            nextOrigin,
            nextDestination,
            routeDepartureAt,
            routeIndex
        );
        const selectedTiming = resolveRouteOptionTiming(routeOption, routeDepartureAt, {
            targetArrivalAt: explicitDeparture || bus ? undefined : initial?.targetArrivalAt,
            routeInfo: candidateRouteInfo,
        });
        const routeInfo = {
            ...candidateRouteInfo,
            departureTime: selectedTiming.departureAt.toISOString(),
            arrivalTime: selectedTiming.arrivalAt.toISOString(),
        };

        routeSubmitPendingRef.current = true;
        setRouteSubmitPending(true);
        try {
            setRoutePlannerResult(sessionId, {
                origin: nextOrigin,
                destination: nextDestination,
                travelMode,
                travelMinutes: routeInfo.totalDurationMinutes,
                locationName: nextOrigin?.name && nextDestination?.name
                    ? `${nextOrigin.name} → ${nextDestination.name}`
                    : nextDestination?.name || nextOrigin?.name,
                targetArrivalAt: initial?.targetArrivalAt,
                departureAt: routeInfo.departureTime,
                route: {
                    ...routeOption,
                    odsayTimetablePreview: undefined,
                    odsayBusPreview: undefined,
                    schemaVersion: routeOption.intercityJourney ? 3 : 2,
                    routeInfo,
                },
            });
            close();
        } catch {
            routeSubmitPendingRef.current = false;
            setRouteSubmitPending(false);
            Alert.alert("경로 저장 실패", "잠시 후 다시 시도해 주세요.");
            return;
        }

        // 화면 전환 애니메이션 중 연속 탭만 막고, 전환이 중단된 경우에는 다시 시도할 수 있게 한다.
        routeSubmitResetTimerRef.current = setTimeout(() => {
            routeSubmitPendingRef.current = false;
            setRouteSubmitPending(false);
            routeSubmitResetTimerRef.current = null;
        }, 800);
    }, [
        busPreview,
        importedTicket,
        close,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        initial?.targetArrivalAt,
        explicitDeparture,
        originAddress,
        originLat,
        originLng,
        originText,
        retryRouteSearch,
        routeDepartureAt,
        sessionId,
        travelMode,
        baseSelection?.id,
        currentPreview,
        waitingForPreview,
    ]);

    useEffect(() => () => {
        if (routeSubmitResetTimerRef.current) {
            clearTimeout(routeSubmitResetTimerRef.current);
        }
    }, []);

    return {
        applyIntercityService,
        importedTicket,
        close,
        goToScheduleList,
        hasTransitFilters,
        failedMapRouteId,
        openMapForOption,
        routeMapPending,
        openPlaceSettings,
        openRouteAttribution,
        persistInitial,
        retryRouteSearch,
        reduceMotion,
        routeContentAnimatedStyle,
        restoredScrollY: usingResumedList ? resumedList?.scrollY : undefined,
        restoredCandidateId: usingResumedList && resumedList?.scrollY === undefined ? resumedList?.selectedRouteId : undefined,
        restoredExpandedCandidateId: usingResumedList && !resumedList?.selectedDetailsCollapsed
            ? resumedList?.selectedRouteId : undefined,
        routeDepartureAt,
        hasExplicitDeparture: Boolean(explicitDeparture),
        routeError,
        routeErrorCode: routeFailure?.code,
        showTransitRecovery,
        routeListBottomPadding,
        routeLoading,
        routeScheduleBased,
        routeSubmitPending,
        waitingForPreview,
        routeTargetArrivalAt,
        saveRouteOption,
        selectTransitFilter,
        selectTravelMode,
        selectedRouteId,
        setSelectedRouteId,
        collapsedCandidateId,
        setCollapsedCandidateId,
        setTravelMode,
        transitFilterCounts,
        transitRouteFilter,
        travelMode,
        visibleRouteAlternatives,
    };
}

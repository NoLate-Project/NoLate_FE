import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Keyboard, Linking } from "react-native";
import { useRouter } from "expo-router";

import {
    getRouteAlternativeOptions,
    invalidateRouteSearch,
    type RouteAlternativeOption,
} from "../../src/modules/map/routingService";
import {
    getRoutePlannerInitial,
    setRoutePlannerInitial,
    setRoutePlannerResult,
} from "../../src/modules/schedule/routePlannerSession";
import {
    resolveScheduleRouteDepartureContext,
    resolveSelectedRouteTiming,
} from "../../src/modules/schedule/scheduleRouteTiming";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import { buildRouteInfoFromAlternative } from "../../src/modules/schedule/routeInfo";
import {
    primeRouteDetailAdvertising,
    showRouteDetailInterstitialIfEligible,
} from "../../src/modules/advertising/routeDetailInterstitial";
import {
    TRANSIT_FILTER_ITEMS,
    type TransitRouteFilter,
} from "./RouteSelectAnimatedControls";
import {
    getTransitFilterCount,
    sortRouteAlternativesForDisplay,
} from "./routeSelectRouteModel";
import { buildPlace } from "./routeSelectPlaceModel";

type RouteSelectRouteControllerOptions = {
    initial: ReturnType<typeof getRoutePlannerInitial>;
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
    const router = useRouter();
    const [travelMode, setTravelMode] = useState<TravelMode>(initialTravelMode);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState<string>();
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState<string>();
    const [routeRequestVersion, setRouteRequestVersion] = useState(0);
    const [routeSubmitPending, setRouteSubmitPending] = useState(false);
    const routeSubmitPendingRef = useRef(false);
    const routeDetailAdPendingRef = useRef(false);
    const routeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [routeDepartureContext, setRouteDepartureContext] = useState(() =>
        resolveScheduleRouteDepartureContext(initial?.targetArrivalAt, initial?.travelMinutes)
    );
    const routeDepartureAt = routeDepartureContext.departureAt;
    const routeScheduleBased = routeDepartureContext.scheduleBased;
    const routeTargetArrivalAt = routeDepartureContext.targetArrivalAt;
    const scheduleTimingRefinedRef = useRef(false);
    const routeContentAnim = useRef(new Animated.Value(1)).current;

    const selectedRouteIndex = useMemo(
        () => routeAlternatives.findIndex((option) => option.id === selectedRouteId),
        [routeAlternatives, selectedRouteId]
    );
    const selectedRoute = selectedRouteIndex >= 0 ? routeAlternatives[selectedRouteIndex] : undefined;
    const transitFilterCounts = useMemo(
        () => TRANSIT_FILTER_ITEMS.reduce<Record<TransitRouteFilter, number>>((acc, item) => {
            acc[item.key] = getTransitFilterCount(routeAlternatives, item.key);
            return acc;
        }, { ALL: 0, SUBWAY: 0, BUS: 0, MIXED: 0 }),
        [routeAlternatives]
    );
    const visibleRouteAlternatives = useMemo(() => {
        return sortRouteAlternativesForDisplay(routeAlternatives, travelMode, transitRouteFilter);
    }, [routeAlternatives, transitRouteFilter, travelMode]);
    const visibleRouteSignature = useMemo(
        () => visibleRouteAlternatives.map((option) => option.id).join("|"),
        [visibleRouteAlternatives]
    );
    const routeContentAnimatedStyle = useMemo(() => ({
        opacity: routeContentAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.82, 1],
        }),
    }), [routeContentAnim]);

    const animateRouteContent = useCallback(() => {
        routeContentAnim.stopAnimation();
        routeContentAnim.setValue(0);
        Animated.spring(routeContentAnim, {
            toValue: 1,
            friction: 9,
            tension: 95,
            useNativeDriver: true,
        }).start();
    }, [routeContentAnim]);

    const selectTravelMode = useCallback((nextMode: TravelMode) => {
        if (travelMode === nextMode) return;
        setTravelMode(nextMode);
        animateRouteContent();
    }, [animateRouteContent, travelMode]);

    const selectTransitFilter = useCallback((nextFilter: TransitRouteFilter) => {
        if (transitRouteFilter === nextFilter) return;
        if (nextFilter !== "ALL" && transitFilterCounts[nextFilter] === 0) return;
        setTransitRouteFilter(nextFilter);
        animateRouteContent();
    }, [animateRouteContent, transitFilterCounts, transitRouteFilter]);
    const hasTransitFilters = travelMode === "TRANSIT" && hasRouteCoords && routeAlternatives.length > 0;
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
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name || nextOrigin?.name,
            targetArrivalAt: initial?.targetArrivalAt,
            departureAt: routeDepartureAt.toISOString(),
            route: routeToStore,
        });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        initial?.targetArrivalAt,
        originAddress,
        originLat,
        originLng,
        originText,
        routeDepartureAt,
        sessionId,
        travelMode,
    ]);

    const close = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }
        router.replace("/schedule");
    }, [router]);

    const goToScheduleList = useCallback(() => {
        Keyboard.dismiss();
        router.replace("/schedule");
    }, [router]);

    const openPlaceSettings = useCallback(() => {
        Keyboard.dismiss();
        router.push("/settings/places");
    }, [router]);

    useEffect(() => {
        if (!shouldShowRouteResults) return;
        animateRouteContent();
    }, [animateRouteContent, routeError, routeLoading, shouldShowRouteResults, visibleRouteSignature]);

    useEffect(() => {
        if (travelMode !== "TRANSIT" && transitRouteFilter !== "ALL") {
            setTransitRouteFilter("ALL");
        }
    }, [transitRouteFilter, travelMode]);

    const retryRouteSearch = useCallback(() => {
        invalidateRouteSearch(origin, destination, travelMode);
        scheduleTimingRefinedRef.current = false;
        setRouteDepartureContext(resolveScheduleRouteDepartureContext(
            initial?.targetArrivalAt,
            initial?.travelMinutes
        ));
        setRouteRequestVersion((current) => current + 1);
    }, [destination, initial?.targetArrivalAt, initial?.travelMinutes, origin, travelMode]);

    const openRouteAttribution = useCallback((option: RouteAlternativeOption) => {
        if (!option.attributionUrl) return;
        Linking.openURL(option.attributionUrl).catch(() => {
            Alert.alert("지도 정보", "OpenStreetMap 페이지를 열지 못했습니다.");
        });
    }, []);

    useEffect(() => {
        let cancelled = false;
        setSelectedRouteId(undefined);
        setRouteAlternatives([]);
        setRouteError(undefined);

        if (!hasRouteCoords) {
            setRouteLoading(false);
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
                const displayItems = sortRouteAlternativesForDisplay(items, travelMode, "ALL");
                const firstDisplayRouteId = displayItems[0]?.id;
                setRouteAlternatives(items);
                setSelectedRouteId(firstDisplayRouteId);
                setRouteError(items.length ? undefined : "표시할 경로가 없습니다.");

                const firstRoute = displayItems[0];
                if (
                    travelMode === "TRANSIT" &&
                    initial?.targetArrivalAt &&
                    firstRoute &&
                    !scheduleTimingRefinedRef.current
                ) {
                    scheduleTimingRefinedRef.current = true;
                    const refined = resolveScheduleRouteDepartureContext(
                        initial.targetArrivalAt,
                        firstRoute.minutes
                    );
                    const adjustmentMinutes = Math.abs(
                        refined.departureAt.getTime() - routeDepartureAt.getTime()
                    ) / 60_000;
                    if (refined.scheduleBased && adjustmentMinutes >= 5) {
                        setRouteDepartureContext(refined);
                    }
                }
            })
            .catch((error) => {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : "경로 계산에 실패했습니다.";
                setRouteError(message);
            })
            .finally(() => {
                if (!cancelled) setRouteLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        destination,
        hasRouteCoords,
        initial?.targetArrivalAt,
        origin,
        routeDepartureAt,
        routeRequestVersion,
        travelMode,
    ]);

    useEffect(() => {
        if (!visibleRouteAlternatives.length) return;
        if (selectedRouteId && visibleRouteAlternatives.some((option) => option.id === selectedRouteId)) return;
        setSelectedRouteId(visibleRouteAlternatives[0].id);
    }, [selectedRouteId, visibleRouteAlternatives]);

    const openMapForOption = useCallback(async (routeOption?: RouteAlternativeOption) => {
        if (routeDetailAdPendingRef.current) return;
        const targetRoute = routeOption ?? selectedRoute;
        if (!targetRoute) {
            Alert.alert("경로 선택 필요", "상세 지도에서 확인할 경로를 선택해 주세요.");
            return;
        }
        const targetIndex = targetRoute
            ? routeAlternatives.findIndex((option) => option.id === targetRoute.id)
            : selectedRouteIndex;
        const targetSessionId = sessionId || `route-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // 목록과 상세 화면이 같은 경로 객체를 사용해야 필터/정렬 순서 차이로 경로가 바뀌지 않는다.
        persistInitial(targetRoute.minutes, targetSessionId, targetRoute);
        routeDetailAdPendingRef.current = true;
        try {
            await showRouteDetailInterstitialIfEligible();
            router.replace({
                pathname: "/schedule/route-planner",
                params: {
                    sessionId: targetSessionId,
                    routeId: targetRoute.id,
                    routeIndex: targetIndex >= 0 ? String(targetIndex) : "0",
                },
            });
        } finally {
            routeDetailAdPendingRef.current = false;
        }
    }, [persistInitial, routeAlternatives, router, selectedRoute, selectedRouteIndex, sessionId]);

    useEffect(() => {
        primeRouteDetailAdvertising().catch(() => undefined);
    }, []);

    const saveRouteOption = useCallback((routeOption: RouteAlternativeOption, routeIndex: number) => {
        if (routeSubmitPendingRef.current) return;
        if (!sessionId) {
            Alert.alert("저장할 일정이 없어요", "일정 화면에서 이동 경로를 다시 열어 주세요.");
            return;
        }

        const nextOrigin = buildPlace(originText, originAddress, originLat, originLng);
        const nextDestination = buildPlace(destinationText, destinationAddress, destinationLat, destinationLng);
        const candidateRouteInfo = buildRouteInfoFromAlternative(
            routeOption,
            nextOrigin,
            nextDestination,
            routeDepartureAt,
            routeIndex
        );
        const selectedTiming = resolveSelectedRouteTiming({
            targetArrivalAt: initial?.targetArrivalAt,
            routeInfo: candidateRouteInfo,
            fallbackDepartureAt: routeDepartureAt,
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
        close,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        initial?.targetArrivalAt,
        originAddress,
        originLat,
        originLng,
        originText,
        routeDepartureAt,
        sessionId,
        travelMode,
    ]);

    useEffect(() => () => {
        if (routeSubmitResetTimerRef.current) {
            clearTimeout(routeSubmitResetTimerRef.current);
        }
    }, []);

    return {
        close,
        goToScheduleList,
        hasTransitFilters,
        openMapForOption,
        openPlaceSettings,
        openRouteAttribution,
        persistInitial,
        retryRouteSearch,
        routeContentAnimatedStyle,
        routeDepartureAt,
        routeError,
        routeListBottomPadding,
        routeLoading,
        routeScheduleBased,
        routeSubmitPending,
        routeTargetArrivalAt,
        saveRouteOption,
        selectTransitFilter,
        selectTravelMode,
        selectedRouteId,
        setSelectedRouteId,
        setTravelMode,
        transitFilterCounts,
        transitRouteFilter,
        travelMode,
        visibleRouteAlternatives,
    };
}

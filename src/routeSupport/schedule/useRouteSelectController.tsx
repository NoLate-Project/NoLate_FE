import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    BackHandler,
    Keyboard,
    Platform,
    UIManager,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getCurrentLocation, getCurrentLocationPermissionState } from "../../modules/map/currentLocation";
import { createLatestRequestGuard } from "../../modules/map/routeAsyncGuard";
import {
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    type PlaceSearchItem,
} from "../../modules/map/routingService";
import {
    getRoutePlannerInitial,
    type RoutePlannerPayload,
} from "../../modules/schedule/routePlannerSession";
import {
    getFavoriteDeparturePlace,
    getRecentRoutePlaces,
    removeRecentRoutePlace,
    saveRecentRoutePlace,
} from "../../modules/schedule/favoriteDeparture";
import {
} from "../../modules/schedule/favoritePlaceSelection";
import type { Place, TravelMode } from "../../modules/schedule/types";
import {
    resolveDefaultOriginUiUpdate,
    resolveInitialRoutePointTarget,
    resolveNextMissingRoutePointTarget,
    shouldShowRoutePointSearchResults,
    type RoutePointTarget,
} from "../../modules/schedule/routePointSelection";
import { useTheme } from "../../modules/theme/ThemeContext";

import {
    SELECTABLE_TRAVEL_MODES,
    showLocationSettingsAlert,
} from "./RouteSelectAnimatedControls";
import {
    buildPlace,
    buildPlaceFromSearchItem,
    getPlaceDisplayText,
    placeHasCoords,
    readNumberParam,
    readParam,
    readTravelModeParam,
} from "./routeSelectPlaceModel";
import { buildRouteSelectTheme } from "./routeSelectTheme";
import { useRouteSelectFavoriteController } from "./useRouteSelectFavoriteController";
import { useRouteSelectMapPickerController } from "./useRouteSelectMapPickerController";
import { useRouteSelectRouteController } from "./useRouteSelectRouteController";


/**
 * 경로 선택 화면의 장소 검색, 즐겨찾기, 지도 지점 지정과 경로 대안 저장 흐름을 관리한다.
 * 화면 컴포넌트는 반환된 상태와 명령만 사용하며 비동기 요청의 최신성·저장 정책은 이 훅에서 보장한다.
 */
export function useRouteSelectController({
    sessionIdOverride,
    placeEditor,
}: {
    sessionIdOverride?: string;
    placeEditor?: {
        initial: RoutePlannerPayload;
        target: RoutePointTarget;
        onCancel: () => void;
        onConfirm: (origin: Place, destination: Place) => void;
        isFocused: boolean;
    };
} = {}) {
    const insets = useSafeAreaInsets();
    const { mode, colors } = useTheme();
    const isDark = mode === "dark";
    const params = useLocalSearchParams<{
        sessionId?: string;
        originName?: string;
        originAddress?: string;
        originLat?: string;
        originLng?: string;
        destinationName?: string;
        destinationAddress?: string;
        destinationLat?: string;
        destinationLng?: string;
        travelMode?: string;
        editTarget?: string;
        returnFromMap?: string;
        entrySource?: string;
    }>();
    const sessionId = sessionIdOverride ?? readParam(params.sessionId) ?? "";
    const enteredFromQuickLocation = readParam(params.entrySource) === "quick-schedule-location";
    const editTargetParam = placeEditor?.target ?? readParam(params.editTarget);
    const forcedEditTarget: RoutePointTarget | undefined = editTargetParam === "origin" || editTargetParam === "destination"
        ? editTargetParam
        : undefined;
    const sessionInitial = sessionId ? getRoutePlannerInitial(sessionId) : undefined;
    const paramInitial = useMemo<RoutePlannerPayload | undefined>(() => {
        const paramTravelMode = readTravelModeParam(params.travelMode);
        const paramOrigin = buildPlace(
            readParam(params.originName) ?? "",
            readParam(params.originAddress),
            readNumberParam(params.originLat),
            readNumberParam(params.originLng)
        );
        const paramDestination = buildPlace(
            readParam(params.destinationName) ?? "",
            readParam(params.destinationAddress),
            readNumberParam(params.destinationLat),
            readNumberParam(params.destinationLng)
        );

        if (!paramOrigin && !paramDestination && !paramTravelMode) return undefined;
        return {
            origin: paramOrigin,
            destination: paramDestination,
            travelMode: paramTravelMode ?? "TRANSIT",
            locationName: paramOrigin?.name && paramDestination?.name
                ? `${paramOrigin.name} → ${paramDestination.name}`
                : paramDestination?.name || paramOrigin?.name,
        };
    }, [
        params.destinationAddress,
        params.destinationLat,
        params.destinationLng,
        params.destinationName,
        params.originAddress,
        params.originLat,
        params.originLng,
        params.originName,
        params.travelMode,
    ]);
    const initial = placeEditor?.initial ?? sessionInitial ?? paramInitial;
    const initialTravelMode = SELECTABLE_TRAVEL_MODES.includes(initial?.travelMode as TravelMode)
        ? initial?.travelMode as TravelMode
        : "TRANSIT";
    const initialHasOriginCoords =
        typeof initial?.origin?.lat === "number" &&
        typeof initial?.origin?.lng === "number";
    const initialHasDestinationCoords =
        typeof initial?.destination?.lat === "number" &&
        typeof initial?.destination?.lng === "number";
    const initialHasRouteCoords = initialHasOriginCoords && initialHasDestinationCoords;
    const initialRoutePointTarget = resolveInitialRoutePointTarget(
        initial?.origin,
        initial?.destination,
        forcedEditTarget
    );

    const [originText, setOriginText] = useState(initial?.origin?.name ?? "");
    const [originAddress, setOriginAddress] = useState(initial?.origin?.address);
    const [originLat, setOriginLat] = useState<number | undefined>(initial?.origin?.lat);
    const [originLng, setOriginLng] = useState<number | undefined>(initial?.origin?.lng);
    const [destinationText, setDestinationText] = useState(initial?.destination?.name ?? "");
    const [destinationAddress, setDestinationAddress] = useState(initial?.destination?.address);
    const [destinationLat, setDestinationLat] = useState<number | undefined>(initial?.destination?.lat);
    const [destinationLng, setDestinationLng] = useState<number | undefined>(initial?.destination?.lng);
    const [searchQueries, setSearchQueries] = useState<Partial<Record<RoutePointTarget, string>>>({});
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget>(initialRoutePointTarget);
    const [isEditingRoutePoint, setIsEditingRoutePoint] = useState(Boolean(forcedEditTarget) || !initialHasRouteCoords);
    const [originUsesDefault, setOriginUsesDefault] = useState(false);
    const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [searchError, setSearchError] = useState<string>();
    const [hasTypedSearchQuery, setHasTypedSearchQuery] = useState(false);
    const [hasSearchAttempt, setHasSearchAttempt] = useState(false);
    const [searching, setSearching] = useState(false);
    const [currentLocationPending, setCurrentLocationPending] = useState(false);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRequestIdRef = useRef(0);
    const automaticSearchKeyRef = useRef("");
    const currentLocationRequestGuardRef = useRef(createLatestRequestGuard());
    const recentPlacesLoadedRef = useRef(false);
    const originTouchedRef = useRef(Boolean(initial?.origin));
    const routePointUiRevisionRef = useRef(0);
    const destinationHasCoordinatesRef = useRef(initialHasDestinationCoords);
    destinationHasCoordinatesRef.current =
        typeof destinationLat === "number" && typeof destinationLng === "number";

    useEffect(() => {
        if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

    const origin = useMemo(
        () => buildPlace(originText, originAddress, originLat, originLng),
        [originAddress, originLat, originLng, originText]
    );
    const destination = useMemo(
        () => buildPlace(destinationText, destinationAddress, destinationLat, destinationLng),
        [destinationAddress, destinationLat, destinationLng, destinationText]
    );
    const activeTargetLabel = activeTarget === "origin" ? "출발지" : "도착지";
    const activeSearchQuery = searchQueries[activeTarget];
    const activeSearchText = activeSearchQuery ?? (activeTarget === "origin" ? originText : destinationText);
    const hasRouteCoords =
        typeof originLat === "number" &&
        typeof originLng === "number" &&
        typeof destinationLat === "number" &&
        typeof destinationLng === "number";
    const showingSearchResults = shouldShowRoutePointSearchResults({
        isEditingRoutePoint,
        searching,
        hasTypedSearchQuery,
        hasSearchAttempt,
        resultCount: searchResults.length,
    });
    const shouldShowRouteResults = hasRouteCoords && !isEditingRoutePoint;
    const {
        close,
        goToScheduleList,
        hasTransitFilters,
        failedMapRouteId,
        openMapForOption,
        routeMapPending,
        openPlaceSettings,
        openRouteAttribution,
        retryRouteSearch,
        reduceMotion,
        routeContentAnimatedStyle,
        restoredScrollY,
        restoredCandidateId,
        restoredExpandedCandidateId,
        collapsedCandidateId,
        setCollapsedCandidateId,
        routeDepartureAt,
        hasExplicitDeparture,
        routeError,
        routeErrorCode,
        showTransitRecovery,
        routeListBottomPadding,
        routeLoading,
        routeScheduleBased,
        routeSubmitPending,
        waitingForPreview,
        routeTargetArrivalAt,
        saveRouteOption,
        applyIntercityService,
        importedTicket,
        selectTransitFilter,
        selectTravelMode,
        selectedRouteId,
        setSelectedRouteId,
        setTravelMode,
        transitFilterCounts,
        transitRouteFilter,
        travelMode,
        visibleRouteAlternatives,
    } = useRouteSelectRouteController({
        initial,
        returnFromMap: readParam(params.returnFromMap) === "1" && !forcedEditTarget,
        deferRouteSearch: Boolean(placeEditor),
        initialTravelMode,
        sessionId,
        origin,
        destination,
        hasRouteCoords,
        shouldShowRouteResults,
        bottomInset: insets.bottom,
        originText,
        originAddress,
        originLat,
        originLng,
        destinationText,
        destinationAddress,
        destinationLat,
        destinationLng,
    });

    const clearSearch = useCallback(() => {
        searchRequestIdRef.current += 1;
        automaticSearchKeyRef.current = "";
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchResults([]);
        setSearchError(undefined);
        setHasTypedSearchQuery(false);
        setHasSearchAttempt(false);
        setSearching(false);
    }, []);

    const openRoutePointEditor = useCallback((target: RoutePointTarget = "origin") => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        Keyboard.dismiss();
        setActiveTarget(target);
        clearSearch();
        setIsEditingRoutePoint(true);
    }, [clearSearch]);

    useEffect(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        setOriginText(initial?.origin?.name ?? "");
        setOriginAddress(initial?.origin?.address);
        setOriginLat(initial?.origin?.lat);
        setOriginLng(initial?.origin?.lng);
        setDestinationText(initial?.destination?.name ?? "");
        setDestinationAddress(initial?.destination?.address);
        setDestinationLat(initial?.destination?.lat);
        setDestinationLng(initial?.destination?.lng);
        setSearchQueries({});
        setTravelMode(initialTravelMode);
        setActiveTarget(initialRoutePointTarget);
        setIsEditingRoutePoint(Boolean(forcedEditTarget) || !initialHasRouteCoords);
        setOriginUsesDefault(false);
        originTouchedRef.current = Boolean(
            initial?.origin?.name ||
            initial?.origin?.address ||
            typeof initial?.origin?.lat === "number" ||
            typeof initial?.origin?.lng === "number"
        );
        clearSearch();
    }, [
        clearSearch,
        initial?.destination?.address,
        initial?.destination?.lat,
        initial?.destination?.lng,
        initial?.destination?.name,
        initial?.origin?.address,
        initial?.origin?.lat,
        initial?.origin?.lng,
        initial?.origin?.name,
        initialTravelMode,
        setTravelMode,
        initialHasRouteCoords,
        initialRoutePointTarget,
        forcedEditTarget,
        sessionId,
    ]);

    useEffect(() => {
        if (!forcedEditTarget) return;
        Keyboard.dismiss();
        setActiveTarget(forcedEditTarget);
        setIsEditingRoutePoint(true);
        clearSearch();
    }, [clearSearch, forcedEditTarget]);

    useEffect(() => {
        const hasExplicitOrigin = Boolean(
            initial?.origin?.name ||
            initial?.origin?.address ||
            typeof initial?.origin?.lat === "number" ||
            typeof initial?.origin?.lng === "number"
        );
        if (hasExplicitOrigin || forcedEditTarget === "origin") return;

        let cancelled = false;
        const requestUiRevision = routePointUiRevisionRef.current;
        getFavoriteDeparturePlace()
            .then((place) => {
                // URL/session 값과 사용자의 직접 입력이 기본값보다 항상 우선한다.
                if (cancelled || originTouchedRef.current || !placeHasCoords(place)) return;

                const uiUpdate = resolveDefaultOriginUiUpdate({
                    requestUiRevision,
                    currentUiRevision: routePointUiRevisionRef.current,
                    destinationHasCoordinates: destinationHasCoordinatesRef.current,
                    forcedTarget: forcedEditTarget,
                });

                setOriginText(getPlaceDisplayText(place));
                setOriginAddress(place.address);
                setOriginLat(place.lat);
                setOriginLng(place.lng);
                setOriginUsesDefault(true);
                if (uiUpdate) {
                    setActiveTarget(uiUpdate.activeTarget);
                    setIsEditingRoutePoint(uiUpdate.isEditingRoutePoint);
                    clearSearch();
                }
            })
            .catch(() => {
                // 저장된 기본 출발지가 없거나 조회가 실패하면 기존 빈 입력 흐름을 유지한다.
            });

        return () => {
            cancelled = true;
        };
    }, [
        clearSearch,
        forcedEditTarget,
        initial?.origin?.address,
        initial?.origin?.lat,
        initial?.origin?.lng,
        initial?.origin?.name,
        sessionId,
    ]);

    const applyPlaceToTarget = useCallback((target: RoutePointTarget, place: Place) => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        const nextTarget = resolveNextMissingRoutePointTarget(
            target,
            target === "origin" || (typeof originLat === "number" && typeof originLng === "number"),
            target === "destination" || (typeof destinationLat === "number" && typeof destinationLng === "number")
        );
        const nextOrigin = target === "origin" ? place : origin;
        const nextDestination = target === "destination" ? place : destination;
        setSearchQueries(queries => nextTarget ? { [nextTarget]: queries[nextTarget] } : {});
        if (placeEditor && placeHasCoords(nextOrigin) && placeHasCoords(nextDestination)) {
            Keyboard.dismiss();
            clearSearch();
            placeEditor.onConfirm(nextOrigin, nextDestination);
            return;
        }
        if (target === "origin") {
            originTouchedRef.current = true;
            setOriginUsesDefault(false);
            setOriginText(getPlaceDisplayText(place));
            setOriginAddress(place.address);
            setOriginLat(place.lat);
            setOriginLng(place.lng);
            setActiveTarget(nextTarget ?? "origin");
        } else {
            setDestinationText(getPlaceDisplayText(place));
            setDestinationAddress(place.address);
            setDestinationLat(place.lat);
            setDestinationLng(place.lng);
            setActiveTarget(nextTarget ?? "destination");
        }
        setIsEditingRoutePoint(nextTarget !== null);
        clearSearch();
    }, [clearSearch, destination, destinationLat, destinationLng, origin, originLat, originLng, placeEditor]);

    const removeRecentPlace = useCallback((place: Place) => {
        removeRecentRoutePlace(place)
            .then(setRecentPlaces)
            .catch(() => {
                Alert.alert("최근 검색 삭제 실패", "잠시 후 다시 시도해 주세요.");
            });
    }, []);

    const rememberRecentPlace = useCallback((place: Place) => {
        if (!placeHasCoords(place)) return;
        saveRecentRoutePlace(place)
            .then(setRecentPlaces)
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (recentPlacesLoadedRef.current) return;
        recentPlacesLoadedRef.current = true;
        let cancelled = false;

        getRecentRoutePlaces()
            .then((recent) => {
                if (cancelled) return;
                setRecentPlaces(recent);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);

    const searchRoutePoint = useCallback(async (target: RoutePointTarget, query: string, requestId: number) => {
        const oppositeLat = target === "origin" ? destinationLat : originLat;
        const oppositeLng = target === "origin" ? destinationLng : originLng;
        const center = typeof oppositeLat === "number" && typeof oppositeLng === "number"
            ? { lat: oppositeLat, lng: oppositeLng }
            : undefined;
        try {
            const items = await searchAddressByKeyword(query, { center, radiusKm: 33 });
            if (searchRequestIdRef.current === requestId) setSearchResults(items);
        } catch (error) {
            if (searchRequestIdRef.current !== requestId) return;
            setSearchResults([]);
            setSearchError(error instanceof Error ? error.message : "주소 검색에 실패했습니다.");
        } finally {
            if (searchRequestIdRef.current === requestId) setSearching(false);
        }
    }, [destinationLat, destinationLng, originLat, originLng]);

    useEffect(() => {
        if (!isEditingRoutePoint || hasTypedSearchQuery) return;

        const query = activeSearchText.trim();
        const hasCoordinates = activeTarget === "origin"
            ? typeof originLat === "number" && typeof originLng === "number"
            : typeof destinationLat === "number" && typeof destinationLng === "number";
        if (!query || (activeSearchQuery === undefined && hasCoordinates)) return;

        const searchKey = `${activeTarget}:${query}`;
        if (automaticSearchKeyRef.current === searchKey) return;
        automaticSearchKeyRef.current = searchKey;

        const requestId = ++searchRequestIdRef.current;
        setSearching(true);
        setHasSearchAttempt(true);
        setSearchError(undefined);
        void searchRoutePoint(activeTarget, query, requestId);
    }, [
        activeSearchQuery,
        activeSearchText,
        activeTarget,
        destinationLat,
        destinationLng,
        hasTypedSearchQuery,
        isEditingRoutePoint,
        originLat,
        originLng,
        searchRoutePoint,
    ]);

    const handleSearchChange = useCallback((target: RoutePointTarget, text: string) => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        routePointUiRevisionRef.current += 1;
        const query = text.trim();
        const hasQuery = query.length > 0;
        setActiveTarget(target);
        setIsEditingRoutePoint(true);
        setHasTypedSearchQuery(hasQuery);
        setHasSearchAttempt(hasQuery);
        setSearchResults([]);
        setSearchError(undefined);
        setSearching(hasQuery);
        setSearchQueries(queries => ({ ...queries, [target]: text }));
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (!hasQuery) return;

        searchDebounceRef.current = setTimeout(() => {
            searchDebounceRef.current = null;
            void searchRoutePoint(target, query, requestId);
        }, 450);
    }, [searchRoutePoint]);

    const retryPlaceSearch = useCallback(() => {
        const query = activeSearchText.trim();
        if (!query || searching) return;
        const requestId = ++searchRequestIdRef.current;
        setSearching(true);
        setSearchError(undefined);
        void searchRoutePoint(activeTarget, query, requestId);
    }, [activeSearchText, activeTarget, searching, searchRoutePoint]);

    const applyPlace = useCallback((target: RoutePointTarget, item: PlaceSearchItem) => {
        const nextPlace = buildPlaceFromSearchItem(item);
        rememberRecentPlace(nextPlace);
        applyPlaceToTarget(
            target,
            nextPlace
        );
    }, [applyPlaceToTarget, rememberRecentPlace]);

    const applyCurrentLocationToTarget = useCallback(async (target: RoutePointTarget) => {
        const guard = currentLocationRequestGuardRef.current;
        const requestId = guard.begin();
        setCurrentLocationPending(true);
        try {
            const permissionState = await getCurrentLocationPermissionState();
            if (!guard.isCurrent(requestId)) return;
            if (!permissionState.servicesEnabled) {
                showLocationSettingsAlert(
                    "위치 서비스가 꺼져 있어요",
                    "현재 위치를 사용하려면 기기 위치 서비스를 켜 주세요.",
                    true
                );
                return;
            }
            if (!permissionState.granted && !permissionState.canAskAgain) {
                showLocationSettingsAlert(
                    "위치 권한이 필요해요",
                    "현재 위치를 사용하려면 설정에서 NoLate의 위치 권한을 허용해 주세요."
                );
                return;
            }

            setSearching(true);
            const location = await getCurrentLocation();
            const address = await reverseGeocodeToAddress(location.latitude, location.longitude)
                .catch(() => undefined);
            if (!guard.isCurrent(requestId)) return;
            // applyPlaceToTarget이 현재 요청을 invalidate하기 전에 로딩 상태를 먼저 정리한다.
            setSearching(false);
            applyPlaceToTarget(
                target,
                {
                    name: address || "현재 위치",
                    address: address || undefined,
                    lat: location.latitude,
                    lng: location.longitude,
                }
            );
        } catch (error) {
            if (!guard.isCurrent(requestId)) return;
            const permissionState = await getCurrentLocationPermissionState().catch(() => undefined);
            if (!guard.isCurrent(requestId)) return;
            if (permissionState && !permissionState.servicesEnabled) {
                showLocationSettingsAlert(
                    "위치 서비스가 꺼져 있어요",
                    "현재 위치를 사용하려면 기기 위치 서비스를 켜 주세요.",
                    true
                );
                return;
            }
            if (permissionState && !permissionState.granted && !permissionState.canAskAgain) {
                showLocationSettingsAlert(
                    "위치 권한이 필요해요",
                    "현재 위치를 사용하려면 설정에서 NoLate의 위치 권한을 허용해 주세요."
                );
                return;
            }
            const message = error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.";
            Alert.alert("현재 위치 실패", message);
        } finally {
            if (guard.isCurrent(requestId)) {
                setSearching(false);
                setCurrentLocationPending(false);
            }
        }
    }, [applyPlaceToTarget]);

    const applyCurrentLocationToActiveTarget = useCallback(() => {
        routePointUiRevisionRef.current += 1;
        applyCurrentLocationToTarget(activeTarget);
    }, [activeTarget, applyCurrentLocationToTarget]);

    const applyRecentPlaceToActiveTarget = useCallback((place: Place) => {
        applyPlaceToTarget(activeTarget, place);
    }, [activeTarget, applyPlaceToTarget]);

    /** 지도 선택 진입 전에 현재 위치 요청과 키보드를 정리하고 UI 변경 순서를 기록한다. */
    const prepareMapPickerOpen = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        Keyboard.dismiss();
    }, []);

    const mapPickerController = useRouteSelectMapPickerController({
        activeTarget,
        applyPlaceToTarget,
        destination,
        destinationLat,
        destinationLng,
        onOpenMapPicker: prepareMapPickerOpen,
        origin,
        originLat,
        originLng,
        rememberRecentPlace,
    });

    const favoriteController = useRouteSelectFavoriteController({
        applyPlaceToTarget,
        clearSearch,
        destinationHasCoordinatesRef,
        forcedEditTarget,
        origin,
        originTouchedRef,
        originUsesDefault,
        routePointUiRevisionRef,
        setActiveTarget,
        setIsEditingRoutePoint,
        setOriginAddress,
        setOriginLat,
        setOriginLng,
        setOriginText,
        setOriginUsesDefault,
    });

    const swapPlaces = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        const prevOrigin = { text: originText, address: originAddress, lat: originLat, lng: originLng };
        originTouchedRef.current = true;
        setOriginUsesDefault(false);
        setOriginText(destinationText);
        setOriginAddress(destinationAddress);
        setOriginLat(destinationLat);
        setOriginLng(destinationLng);
        setDestinationText(prevOrigin.text);
        setDestinationAddress(prevOrigin.address);
        setDestinationLat(prevOrigin.lat);
        setDestinationLng(prevOrigin.lng);
        setSearchQueries({});
        clearSearch();
    }, [
        clearSearch,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        originAddress,
        originLat,
        originLng,
        originText,
    ]);

    useEffect(() => () => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        currentLocationRequestGuardRef.current.invalidate();
    }, []);

    const exitSearchMode = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        Keyboard.dismiss();
        setSearchQueries({});
        clearSearch();
        if (placeEditor) {
            placeEditor.onCancel();
            return;
        }
        if (enteredFromQuickLocation && !hasRouteCoords) {
            close();
            return;
        }
        setIsEditingRoutePoint(false);
    }, [clearSearch, close, enteredFromQuickLocation, hasRouteCoords, placeEditor]);

    useEffect(() => {
        if (Platform.OS !== "android" || !isEditingRoutePoint || placeEditor?.isFocused === false) return;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            exitSearchMode();
            return true;
        });
        return () => subscription.remove();
    }, [exitSearchMode, isEditingRoutePoint, placeEditor?.isFocused]);

    const editDefaultOrigin = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        originTouchedRef.current = true;
        setActiveTarget("origin");
        setIsEditingRoutePoint(true);
        clearSearch();
    }, [clearSearch]);

    const visibleRecentPlaces = recentPlaces;

    const routeUi = buildRouteSelectTheme(isDark, colors);
    const modeSelectedText = "#FFFFFF";
    const statusBarStyle: "light-content" | "dark-content" = isDark
        ? "light-content"
        : "dark-content";
    return {
        returnsToScheduleDraft: initial?.returnToScheduleDraft === true,
        appliesToSchedule: Boolean(initial?.returnToScheduleDraft || initial?.appliesToExistingSchedule || readParam(params.entrySource) === "schedule-detail"),
        ...favoriteController,
        ...mapPickerController,
        modeSelectedText,
        statusBarStyle,
        insets,
        colors,
        isDark,
        originText,
        destinationText,
        travelMode,
        activeTarget,
        setActiveTarget,
        isEditingRoutePoint,
        setIsEditingRoutePoint,
        originUsesDefault,
        recentPlaces,
        searchResults,
        searchError,
        retryPlaceSearch,
        searching,
        currentLocationPending,
        selectedRouteId,
        setSelectedRouteId,
        transitRouteFilter,
        routeLoading,
        routeError,
        routeErrorCode,
        showTransitRecovery,
        routeSubmitPending,
        waitingForPreview,
        routePointUiRevisionRef,
        routeDepartureAt,
        hasExplicitDeparture,
        routeScheduleBased,
        routeTargetArrivalAt,
        origin,
        destination,
        activeTargetLabel,
        activeSearchText,
        hasRouteCoords,
        showingSearchResults,
        shouldShowRouteResults,
        transitFilterCounts,
        visibleRouteAlternatives,
        routeContentAnimatedStyle,
        reduceMotion,
        restoredScrollY,
        restoredCandidateId,
        restoredExpandedCandidateId,
        collapsedCandidateId,
        setCollapsedCandidateId,
        selectTravelMode,
        selectTransitFilter,
        hasTransitFilters,
        routeListBottomPadding,
        close,
        goToScheduleList,
        openPlaceSettings,
        openRoutePointEditor,
        removeRecentPlace,
        handleSearchChange,
        applyPlace,
        applyCurrentLocationToActiveTarget,
        applyRecentPlaceToActiveTarget,
        swapPlaces,
        retryRouteSearch,
        openRouteAttribution,
        failedMapRouteId,
        openMapForOption,
        routeMapPending,
        saveRouteOption,
        applyIntercityService,
        importedTicket,
        exitSearchMode,
        editDefaultOrigin,
        visibleRecentPlaces,
        routeUi,
    };
}

/** 경로 선택 렌더러가 소비하는 컨트롤러의 추론된 공개 계약이다. */
export type RouteSelectController = ReturnType<typeof useRouteSelectController>;

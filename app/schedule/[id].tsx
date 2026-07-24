import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    BackHandler,
    Linking,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
    type LayoutChangeEvent,
} from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getSchedule,
    markScheduleDeparted,
    sendScheduleDepartureNudge,
} from "../../src/api/schedule";
import {
    getScheduleTravelPlan,
    upsertMyScheduleTravelPlan,
} from "../../src/api/scheduleTravelPlans";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import PlainScheduleDetailView from "../../src/modules/schedule/components/detail/PlainScheduleDetailView";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { getScheduleAccessibilityVisibility } from "../../src/modules/schedule/accessibilityVisibility";
import TmapMapView, {
    type TmapMapViewHandle,
} from "../../src/modules/map/TmapMapView";
import { getCurrentLocation, getCurrentLocationPermissionState } from "../../src/modules/map/currentLocation";
import { createLatestRequestGuard } from "../../src/modules/map/routeAsyncGuard";
import type { RouteAlternativeOption } from "../../src/modules/map/tmapApi";
import {
    buildSavedRouteMapPresentation,
    getSavedRouteFitCoords,
    getSavedRouteOverviewFitKey,
    getSavedTransitLegBoardCoord,
    getSavedTransitLegCoords,
    hasRenderableSavedRouteGeometry,
} from "../../src/modules/map/savedRouteMapPresentation";
import { parseTransitMapInteractionId } from "../../src/modules/map/transitMapInteraction";
import RouteStepTimeline from "../../src/modules/schedule/components/route/RouteStepTimeline";
import TransitRouteProgressBar from "../../src/modules/schedule/components/route/TransitRouteProgressBar";
import TransitRouteSummaryRow, {
    getTransitRouteSummaryAccessibilityLabel,
} from "../../src/modules/schedule/components/route/TransitRouteSummaryRow";
import {
    buildSavedRouteDetailInfo,
    getScheduleDetailLayout,
    getSavedRouteEntryPath,
    getSavedRouteSummaryKind,
    shouldRenderScheduleDetailMap,
} from "../../src/modules/schedule/savedRouteDetailPresentation";
import { buildTransitRouteProgressSegments } from "../../src/modules/schedule/transitRouteProgress";
import type { RouteStep } from "../../src/modules/schedule/routeInfo";
import { getScheduleDetailActionPermissions } from "../../src/modules/schedule/schedulePermissions";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type {
    ScheduleItem,
    ScheduleTravelPlan,
    ScheduleTravelPlanParticipant,
    TravelMode,
} from "../../src/modules/schedule/types";
import {
    buildScheduleRoutePlannerInitial,
    consumeScheduleRouteUpdatePayload,
    setRoutePlannerInitial,
} from "../../src/modules/schedule/routePlannerSession";
import { isRouteSetupEntryRequested } from "../../src/modules/schedule/routeSetupNavigation";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { fromISO } from "../../lib/util/data";
import { getAuthMember } from "../../src/modules/auth/authStorage";
import BrandedLoader, { BrandedLoadingState } from "../../src/ui/BrandedLoader";
import {
    buildDepartureParticipantPresentations,
    canSendDepartureNudge,
    getDepartureOverview,
    getScheduleCountdownPresentation,
    getScheduleDetailSheetHeights,
    resolveScheduleCountdownEndAt,
} from "../../src/modules/schedule/detailPresentation";
import {
    canOpenParticipantTravelPlan,
    travelPlanStatusLabel,
} from "../../src/modules/schedule/travelPlanPresentation";
import { saveScheduleRouteAsMyTravelPlan } from "../../src/modules/schedule/scheduleTravelPlanSave";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdText = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmmText = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const DEFAULT_CAMERA = { latitude: 37.5665, longitude: 126.978, zoom: 12 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const SHEET_SNAP_VELOCITY_PROJECTION = 140;
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;
const DEPARTURE_COUNTDOWN_REFRESH_MS = SECOND_MS;
const APP_ACCENT_BLUE = "#2979FF";
const SHEET_HANDLE_HEIGHT = 32;

async function openDeviceLocationSettings(preferServiceSettings = false) {
    try {
        if (preferServiceSettings && Platform.OS === "android") {
            await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
            return;
        }
        await Linking.openSettings();
    } catch {
        Alert.alert("설정을 열 수 없어요", "기기 설정에서 NoLate의 위치 권한을 확인해 주세요.");
    }
}

function showLocationSettingsAlert(title: string, message: string, preferServiceSettings = false) {
    Alert.alert(title, message, [
        { text: "취소", style: "cancel" },
        {
            text: "설정 열기",
            onPress: () => {
                openDeviceLocationSettings(preferServiceSettings).catch(() => undefined);
            },
        },
    ]);
}
type SheetSnapMode = "compact" | "expanded";

type DepartureDisplayState =
    | { kind: "countdown"; hours: number; minutes: number; seconds: number }
    | { kind: "status"; text: string; tone: "default" | "completed" | "disabled" };

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

function mapCoordFromUnknown(value: unknown): { latitude: number; longitude: number } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const point = value as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown; coord?: unknown };
    if (point.coord) return mapCoordFromUnknown(point.coord);
    const lat = point.lat ?? point.latitude;
    const lng = point.lng ?? point.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return undefined;
    return { latitude: lat, longitude: lng };
}

function formatCompactScheduleRange(startAt: string, endAt: string, hasEndTime = true, allDay = false) {
    const start = fromISO(startAt);
    const shortDate = `${pad2(start.getMonth() + 1)}.${pad2(start.getDate())}`;
    if (allDay) return `${shortDate} · 종일`;
    if (!hasEndTime) return `${shortDate} · ${hhmmText(start)}`;
    const end = fromISO(endAt);
    const sameDay = ymdText(start) === ymdText(end);
    return sameDay
        ? `${shortDate} · ${hhmmText(start)}-${hhmmText(end)}`
        : `${shortDate} ${hhmmText(start)}-${pad2(end.getMonth() + 1)}.${pad2(end.getDate())} ${hhmmText(end)}`;
}

function travelModeLabel(mode?: TravelMode) {
    switch (mode) {
        case "CAR": return "자동차";
        case "TRANSIT": return "대중교통";
        case "WALK": return "도보";
        case "BIKE": return "자전거";
        default: return "이동";
    }
}

function travelPlanParticipantLabel(participant: ScheduleTravelPlanParticipant): string {
    const emailName = participant.email?.split("@")[0]?.trim();
    if (emailName) return emailName;
    if (participant.role === "OWNER") return "오너";
    return `참여자 ${participant.memberId}`;
}

function routeNumberText(route: RouteAlternativeOption | undefined, fallbackMinutes?: number) {
    const minutes = route?.minutes ?? fallbackMinutes;
    return typeof minutes === "number" ? `${minutes}분` : "경로";
}

function getRecommendedDepartureAt(item: ScheduleItem): Date | undefined {
    if (item.departAt) {
        return fromISO(item.departAt);
    }

    if (typeof item.travelMinutes !== "number") {
        return undefined;
    }

    const startAt = fromISO(item.startAt);
    return new Date(startAt.getTime() - (item.travelMinutes * MINUTE_MS));
}

function getDepartureDisplayState(
    departureAt: Date | undefined,
    item: ScheduleItem,
    nowMs: number,
    currentMemberDepartedAt?: string
): DepartureDisplayState {
    if (currentMemberDepartedAt) {
        return { kind: "status", text: `${hhmmText(fromISO(currentMemberDepartedAt))}에 출발 완료됨`, tone: "completed" };
    }

    if (!departureAt) {
        return {
            kind: "status",
            text: item.notificationEnabled ? "출발 알림 대기 중" : "출발 알림 꺼짐",
            tone: item.notificationEnabled ? "default" : "disabled",
        };
    }

    const diffSeconds = Math.ceil((departureAt.getTime() - nowMs) / SECOND_MS);

    if (diffSeconds > 0) {
        const hours = Math.floor(diffSeconds / 3600);
        const minutes = Math.floor((diffSeconds % 3600) / 60);
        const seconds = diffSeconds % 60;

        return { kind: "countdown", hours, minutes, seconds };
    }

    return { kind: "status", text: "출발해야 할 시간이 지났어요", tone: "disabled" };
}

export default function ScheduleRoute() {
    const { mode } = useLocalSearchParams<{ id?: string; mode?: string }>();

    if (mode === "edit") {
        return <ScheduleEditScreen />;
    }
    return <ScheduleDetail />;
}

function ScheduleDetail() {
    const { id, openRouteSetup } = useLocalSearchParams<{
        id: string;
        openRouteSetup?: string | string[];
    }>();
    const pathname = usePathname();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const isDark = mode === "dark";
    const { state, dispatch } = useScheduleStore();
    const mapRef = useRef<TmapMapViewHandle>(null);
    const lastOverviewFitKeyRef = useRef<string | undefined>(undefined);
    const sheetScrollRef = useRef<ScrollView>(null);
    const sheetStartOffsetRef = useRef(0);
    const sheetSnapModeRef = useRef<SheetSnapMode>("compact");
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const {
        minHeight: sheetMinHeight,
        maxHeight: sheetMaxHeight,
    } = getScheduleDetailSheetHeights(windowHeight);
    const sheetBottomPadding = Math.max(insets.bottom, 14);
    const [expandedContentHeight, setExpandedContentHeight] = useState(0);
    const desiredExpandedHeight = expandedContentHeight > 0
        ? SHEET_HANDLE_HEIGHT + expandedContentHeight + sheetBottomPadding
        : sheetMaxHeight;
    const expandedVisibleHeight = clamp(
        desiredExpandedHeight,
        Math.min(sheetMaxHeight, sheetMinHeight + 1),
        sheetMaxHeight
    );
    const sheetCollapsedOffset = sheetMaxHeight - sheetMinHeight;
    const sheetExpandedOffset = Math.min(
        sheetMaxHeight - expandedVisibleHeight,
        Math.max(0, sheetCollapsedOffset - 1)
    );
    const sheetCompactContentHeight = Math.max(92, sheetMinHeight - SHEET_HANDLE_HEIGHT);
    const sheetTranslateY = useRef(new Animated.Value(sheetCollapsedOffset)).current;
    const [sheetMode, setSheetMode] = useState<SheetSnapMode>("compact");
    const [mapZoom, setMapZoom] = useState(DEFAULT_CAMERA.zoom);
    const [focusedLegIndex, setFocusedLegIndex] = useState<number | undefined>();
    const [selectedTransitStop, setSelectedTransitStop] = useState<{
        legIndex: number;
        stopIndex: number;
    }>();
    const [shareSheetVisible, setShareSheetVisible] = useState(false);
    const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
    const [departureActionPending, setDepartureActionPending] = useState(false);
    const [departureNudgePendingMemberId, setDepartureNudgePendingMemberId] = useState<number>();
    const [participantsExpanded, setParticipantsExpanded] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [currentLocationCoord, setCurrentLocationCoord] = useState<{
        latitude: number;
        longitude: number;
    }>();
    const [currentLocationPending, setCurrentLocationPending] = useState(false);
    const currentLocationPendingRef = useRef(false);
    const currentLocationRequestGuardRef = useRef(createLatestRequestGuard());
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string>();
    const [routeSavePending, setRouteSavePending] = useState(false);
    const [inspectedTravelPlan, setInspectedTravelPlan] = useState<ScheduleTravelPlan>();
    const [travelPlanDetailPendingMemberId, setTravelPlanDetailPendingMemberId] = useState<number>();
    const routePlannerWasActiveRef = useRef(false);
    const autoOpenedRouteSetupItemIdRef = useRef<string | undefined>(undefined);

    const item = id ? state.itemsById[id] : undefined;
    const detailActionPermissions = useMemo(
        () => getScheduleDetailActionPermissions(item, currentMemberId),
        [currentMemberId, item],
    );
    const canManageSchedule = detailActionPermissions.canShare;
    const canEditSchedule = detailActionPermissions.canEdit;
    const currentMemberDepartedAt = item?.myDepartedAt ?? (canManageSchedule ? item?.departedAt : undefined);
    const departureParticipants = item?.departureParticipants ?? [];
    const recommendedDepartureAt = useMemo(
        () => item ? getRecommendedDepartureAt(item) : undefined,
        [item]
    );
    const departureDisplayState: DepartureDisplayState = item
        ? getDepartureDisplayState(recommendedDepartureAt, item, nowMs, currentMemberDepartedAt)
        : { kind: "status", text: "", tone: "default" };

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, DEPARTURE_COUNTDOWN_REFRESH_MS);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        currentLocationRequestGuardRef.current.invalidate();
        currentLocationPendingRef.current = false;
        setParticipantsExpanded(false);
        setExpandedContentHeight(0);
        setCurrentLocationCoord(undefined);
        setCurrentLocationPending(false);
        setInspectedTravelPlan(undefined);
        setTravelPlanDetailPendingMemberId(undefined);
        setDepartureNudgePendingMemberId(undefined);
    }, [id]);

    useEffect(() => () => {
        currentLocationRequestGuardRef.current.invalidate();
    }, []);

    useEffect(() => {
        let cancelled = false;

        getAuthMember()
            .then((member) => {
                if (!cancelled) setCurrentMemberId(member?.id ?? null);
            })
            .catch(() => {
                if (!cancelled) setCurrentMemberId(null);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const sheetQuickSummaryAnimatedStyle = useMemo(() => ({
        height: sheetTranslateY.interpolate({
            inputRange: [sheetExpandedOffset, sheetCollapsedOffset],
            outputRange: [0, sheetCompactContentHeight],
            extrapolate: "clamp",
        }),
        opacity: sheetTranslateY.interpolate({
            inputRange: [sheetExpandedOffset, sheetCollapsedOffset],
            outputRange: [0, 1],
            extrapolate: "clamp",
        }),
    }), [sheetCollapsedOffset, sheetCompactContentHeight, sheetExpandedOffset, sheetTranslateY]);

    useEffect(() => {
        sheetTranslateY.stopAnimation(() => {
            const nextOffset = sheetSnapModeRef.current === "expanded"
                ? sheetExpandedOffset
                : sheetCollapsedOffset;
            sheetTranslateY.setValue(nextOffset);
        });
    }, [sheetCollapsedOffset, sheetExpandedOffset, sheetTranslateY]);

    const getSheetSnapMode = useCallback((current: number, velocityY: number): SheetSnapMode => {
        const projectedOffset = clamp(
            current + (velocityY * SHEET_SNAP_VELOCITY_PROJECTION),
            sheetExpandedOffset,
            sheetCollapsedOffset
        );
        return Math.abs(projectedOffset - sheetExpandedOffset) < Math.abs(projectedOffset - sheetCollapsedOffset)
            ? "expanded"
            : "compact";
    }, [sheetCollapsedOffset, sheetExpandedOffset]);

    const snapSheet = useCallback((nextMode: SheetSnapMode) => {
        sheetSnapModeRef.current = nextMode;
        setSheetMode(nextMode);
        if (nextMode === "compact") {
            setParticipantsExpanded(false);
            sheetScrollRef.current?.scrollTo({ y: 0, animated: false });
        }
        Animated.spring(sheetTranslateY, {
            toValue: nextMode === "expanded" ? sheetExpandedOffset : sheetCollapsedOffset,
            damping: 26,
            stiffness: 210,
            mass: 0.92,
            restDisplacementThreshold: 0.35,
            restSpeedThreshold: 0.35,
            useNativeDriver: false,
        }).start();
    }, [sheetCollapsedOffset, sheetExpandedOffset, sheetTranslateY]);

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            if (sheetSnapModeRef.current !== "expanded") return false;
            snapSheet("compact");
            return true;
        });
        return () => subscription.remove();
    }, [snapSheet]);

    const handleExpandedContentLayout = useCallback((event: LayoutChangeEvent) => {
        const nextHeight = Math.ceil(event.nativeEvent.layout.height);
        setExpandedContentHeight((current) => Math.abs(current - nextHeight) > 1 ? nextHeight : current);
    }, []);

    const sheetPanResponder = useMemo(
        () => PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_event, gesture) =>
                Math.abs(gesture.dy) > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
            onPanResponderTerminationRequest: () => false,
            onPanResponderGrant: () => {
                sheetTranslateY.stopAnimation((current) => {
                    sheetStartOffsetRef.current = current;
                });
            },
            onPanResponderMove: (_event, gesture) => {
                sheetTranslateY.setValue(clamp(
                    sheetStartOffsetRef.current + gesture.dy,
                    sheetExpandedOffset,
                    sheetCollapsedOffset
                ));
            },
            onPanResponderRelease: (_event, gesture) => {
                const currentOffset = clamp(
                    sheetStartOffsetRef.current + gesture.dy,
                    sheetExpandedOffset,
                    sheetCollapsedOffset
                );
                snapSheet(getSheetSnapMode(currentOffset, gesture.vy));
            },
            onPanResponderTerminate: (_event, gesture) => {
                const currentOffset = clamp(
                    sheetStartOffsetRef.current + gesture.dy,
                    sheetExpandedOffset,
                    sheetCollapsedOffset
                );
                snapSheet(getSheetSnapMode(currentOffset, gesture.vy));
            },
        }),
        [getSheetSnapMode, sheetCollapsedOffset, sheetExpandedOffset, sheetTranslateY, snapSheet]
    );

    useEffect(() => {
        if (!id || routePlannerSessionId || routeSavePending) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        getSchedule(id)
            .then((detail) => {
                if (!cancelled) dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                const routeFlowActive = pathname === "/schedule/route-select" || pathname === "/schedule/route-planner";
                if (!cancelled && !routeFlowActive) setLoadError(getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch, id, pathname, retryKey, routePlannerSessionId, routeSavePending]);

    const displayRoute = inspectedTravelPlan?.route ?? item?.route;
    const displayOrigin = inspectedTravelPlan?.origin ?? item?.origin;
    const displayDestination = inspectedTravelPlan?.destination ?? item?.destination;
    const displayTravelMinutes = inspectedTravelPlan?.travelMinutes ?? item?.travelMinutes;
    const displayTravelMode = inspectedTravelPlan?.travelMode ?? item?.travelMode;
    const displayDepartureAt = inspectedTravelPlan?.departAt
        ? fromISO(inspectedTravelPlan.departAt)
        : recommendedDepartureAt;
    const mapPresentation = useMemo(() => buildSavedRouteMapPresentation({
        route: displayRoute,
        origin: displayOrigin ?? undefined,
        destination: displayDestination ?? undefined,
        mapZoom,
        isDark,
        focusedLegIndex,
    }), [displayDestination, displayOrigin, displayRoute, focusedLegIndex, isDark, mapZoom]);
    const {
        routeOption,
        routeLegs,
        pathOverlays: displayPathOverlays,
        markers,
    } = mapPresentation;
    const displayMarkers = useMemo(() => {
        if (!currentLocationCoord) return markers;
        return [
            ...markers,
            {
                id: "schedule-detail-current-location",
                ...currentLocationCoord,
                displayType: "dot" as const,
                tintColor: APP_ACCENT_BLUE,
                badgeBorderColor: "#FFFFFF",
                dotSize: 14,
                zIndex: 1000,
            },
        ];
    }, [currentLocationCoord, markers]);
    const mapCoords = useMemo(
        () => getSavedRouteFitCoords(displayRoute, displayOrigin ?? undefined, displayDestination ?? undefined),
        [displayDestination, displayOrigin, displayRoute]
    );
    const mapEdgePadding = useMemo(() => ({
        top: insets.top + 124,
        right: 44,
        bottom: sheetMinHeight + 28,
        left: 44,
    }), [insets.top, sheetMinHeight]);
    const overviewFitKey = useMemo(
        () => getSavedRouteOverviewFitKey(mapCoords, mapEdgePadding),
        [mapCoords, mapEdgePadding]
    );
    const routeDetailInfo = useMemo(() => buildSavedRouteDetailInfo({
        route: displayRoute,
        routeAlternative: routeOption,
        origin: displayOrigin ?? undefined,
        destination: displayDestination ?? undefined,
        departureAt: displayDepartureAt,
    }), [displayDepartureAt, displayDestination, displayOrigin, displayRoute, routeOption]);
    const routeProgressSegments = useMemo(
        () => buildTransitRouteProgressSegments(routeLegs),
        [routeLegs]
    );
    const routeTravelSteps = useMemo(
        () => routeDetailInfo?.steps.filter((step) => step.type !== "ORIGIN" && step.type !== "DESTINATION") ?? [],
        [routeDetailInfo]
    );
    const selectedRouteStepId = typeof focusedLegIndex === "number"
        ? routeTravelSteps[focusedLegIndex]?.id
        : undefined;
    const selectedRoutePassStopStepId = selectedTransitStop
        ? routeTravelSteps[selectedTransitStop.legIndex]?.id
        : undefined;
    const selectedRoutePassStop = selectedTransitStop && selectedRoutePassStopStepId
        ? {
            stepId: selectedRoutePassStopStepId,
            stopIndex: selectedTransitStop.stopIndex,
        }
        : undefined;

    const focusRouteLeg = useCallback((legIndex: number) => {
        const leg = routeLegs[legIndex];
        if (!leg) return;

        const legCoords = getSavedTransitLegCoords(leg);
        if (legCoords.length < 2) return;

        setFocusedLegIndex(legIndex);
        setSelectedTransitStop(undefined);
        snapSheet("compact");
        mapRef.current?.fitToCoordinates(legCoords, {
            edgePadding: {
                top: insets.top + 124,
                right: 44,
                bottom: sheetMinHeight + 28,
                left: 44,
            },
        });
    }, [insets.top, routeLegs, sheetMinHeight, snapSheet]);

    const focusRouteBoardingPoint = useCallback((legIndex: number) => {
        const boardingCoord = getSavedTransitLegBoardCoord(routeLegs, legIndex);
        if (!boardingCoord) {
            focusRouteLeg(legIndex);
            return;
        }

        setFocusedLegIndex(legIndex);
        setSelectedTransitStop(undefined);
        snapSheet("compact");
        mapRef.current?.animateCameraTo({
            ...boardingCoord,
            zoom: 17.2,
            duration: 520,
            easing: "Fly",
        });
    }, [focusRouteLeg, routeLegs, snapSheet]);

    const focusRouteEndpoint = useCallback((step: RouteStep) => {
        const endpoint = step.type === "ORIGIN" ? displayOrigin : displayDestination;
        const routeEndpointCoord = step.type === "ORIGIN"
            ? mapCoords[0]
            : mapCoords[mapCoords.length - 1];
        const endpointCoord = mapCoordFromUnknown(endpoint)
            ?? mapCoordFromUnknown(step.coordinates?.[0])
            ?? mapCoordFromUnknown(routeEndpointCoord);
        if (!endpointCoord) return;

        setFocusedLegIndex(undefined);
        setSelectedTransitStop(undefined);
        snapSheet("compact");
        mapRef.current?.animateCameraTo({
            ...endpointCoord,
            zoom: 17.2,
            duration: 520,
            easing: "Fly",
        });
    }, [displayDestination, displayOrigin, mapCoords, snapSheet]);

    const focusTransitStop = useCallback((stop: { coord?: unknown }) => {
        const coord = mapCoordFromUnknown(stop.coord);
        if (!coord) return;

        snapSheet("compact");
        mapRef.current?.animateCameraTo({
            ...coord,
            zoom: 17.2,
            duration: 420,
        });
    }, [snapSheet]);

    const handleMapMarkerPress = useCallback((event: { id: string; interactionId?: string }) => {
        const interaction = parseTransitMapInteractionId(event.interactionId);
        if (!interaction) return;
        if (interaction.kind === "leg") {
            focusRouteLeg(interaction.legIndex);
            return;
        }

        const stop = routeLegs[interaction.legIndex]?.passStops?.[interaction.stopIndex];
        if (!stop) return;
        setFocusedLegIndex(interaction.legIndex);
        setSelectedTransitStop({
            legIndex: interaction.legIndex,
            stopIndex: interaction.stopIndex,
        });
        focusTransitStop(stop);
    }, [focusRouteLeg, focusTransitStop, routeLegs]);

    const handleRouteStepPress = useCallback((step: RouteStep) => {
        if (step.type === "ORIGIN" || step.type === "DESTINATION") {
            focusRouteEndpoint(step);
            return;
        }

        const legIndex = routeTravelSteps.findIndex((candidate) => candidate.id === step.id);
        if (legIndex < 0) return;
        focusRouteBoardingPoint(legIndex);
    }, [focusRouteBoardingPoint, focusRouteEndpoint, routeTravelSteps]);

    const handleMapZoomChanged = useCallback((zoom: number) => {
        if (!Number.isFinite(zoom)) return;
        setMapZoom((current) => Math.abs(current - zoom) < 0.04 ? current : zoom);
    }, []);

    const moveToCurrentLocation = useCallback(async () => {
        if (currentLocationPendingRef.current) return;

        const guard = currentLocationRequestGuardRef.current;
        const requestId = guard.begin();
        currentLocationPendingRef.current = true;
        setCurrentLocationPending(true);
        try {
            const permissionState = await getCurrentLocationPermissionState();
            if (!guard.isCurrent(requestId)) return;
            if (!permissionState.servicesEnabled) {
                showLocationSettingsAlert(
                    "위치 서비스가 꺼져 있어요",
                    "지도에서 내 위치를 보려면 기기 위치 서비스를 켜 주세요.",
                    true
                );
                return;
            }
            if (!permissionState.granted && !permissionState.canAskAgain) {
                showLocationSettingsAlert(
                    "위치 권한이 필요해요",
                    "지도에서 내 위치를 보려면 설정에서 NoLate의 위치 권한을 허용해 주세요."
                );
                return;
            }

            const coord = await getCurrentLocation();
            if (!guard.isCurrent(requestId)) return;
            setCurrentLocationCoord(coord);
            mapRef.current?.animateCameraTo({
                ...coord,
                zoom: 16,
                duration: 420,
            });
        } catch (error) {
            if (!guard.isCurrent(requestId)) return;
            const permissionState = await getCurrentLocationPermissionState().catch(() => undefined);
            if (!guard.isCurrent(requestId)) return;
            if (permissionState && !permissionState.servicesEnabled) {
                showLocationSettingsAlert(
                    "위치 서비스가 꺼져 있어요",
                    "지도에서 내 위치를 보려면 기기 위치 서비스를 켜 주세요.",
                    true
                );
                return;
            }
            if (permissionState && !permissionState.granted && !permissionState.canAskAgain) {
                showLocationSettingsAlert(
                    "위치 권한이 필요해요",
                    "지도에서 내 위치를 보려면 설정에서 NoLate의 위치 권한을 허용해 주세요."
                );
                return;
            }
            Alert.alert(
                "현재 위치를 찾을 수 없어요",
                error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다."
            );
        } finally {
            if (guard.isCurrent(requestId)) {
                currentLocationPendingRef.current = false;
                setCurrentLocationPending(false);
            }
        }
    }, []);

    const completeDeparture = useCallback(async () => {
        if (!id || departureActionPending) return;

        setDepartureActionPending(true);
        try {
            const completedAt = new Date().toISOString();
            const updated = await markScheduleDeparted(id);
            dispatch({
                type: "UPDATE_ITEM",
                item: {
                    ...updated,
                    myDepartedAt: updated.myDepartedAt ?? completedAt,
                    departedAt: canManageSchedule ? (updated.departedAt ?? completedAt) : updated.departedAt,
                    departureParticipants: updated.departureParticipants ?? item?.departureParticipants,
                },
            });
        } catch (error) {
            Alert.alert("출발 완료 실패", getErrorMessage(error));
        } finally {
            setDepartureActionPending(false);
        }
    }, [canManageSchedule, departureActionPending, dispatch, id, item?.departureParticipants]);

    const requestDepartureNudge = useCallback(async (targetMemberId: number, targetLabel: string) => {
        if (!id || departureNudgePendingMemberId !== undefined) return;

        setDepartureNudgePendingMemberId(targetMemberId);
        try {
            const result = await sendScheduleDepartureNudge(id, targetMemberId);
            if (result.sentCount > 0) {
                Alert.alert("알림을 보냈어요", `${targetLabel}님에게 출발 확인 알림을 보냈습니다.`);
                return;
            }
            if (result.requestedCount === 0) {
                Alert.alert(
                    "알림을 보낼 수 없어요",
                    `${targetLabel}님의 기기에 등록된 푸시 알림 정보가 없습니다.`
                );
                return;
            }
            Alert.alert("알림 전송 실패", "잠시 후 다시 시도해 주세요.");
        } catch (error) {
            Alert.alert("알림 전송 실패", getErrorMessage(error));
        } finally {
            setDepartureNudgePendingMemberId(undefined);
        }
    }, [departureNudgePendingMemberId, id]);

    const confirmDepartureNudge = useCallback((targetMemberId: number, targetLabel: string) => {
        if (departureNudgePendingMemberId !== undefined) return;

        Alert.alert(
            "출발 확인 알림",
            `${targetLabel}님에게 출발 여부를 알려 달라는 푸시를 보낼까요?`,
            [
                { text: "취소", style: "cancel" },
                {
                    text: "보내기",
                    onPress: () => {
                        requestDepartureNudge(targetMemberId, targetLabel).catch(() => undefined);
                    },
                },
            ]
        );
    }, [departureNudgePendingMemberId, requestDepartureNudge]);

    const openParticipantTravelPlan = useCallback(async (
        participant: ScheduleTravelPlanParticipant
    ) => {
        if (!id || travelPlanDetailPendingMemberId !== undefined) return;
        if (participant.memberId === currentMemberId) {
            setInspectedTravelPlan(undefined);
            return;
        }
        if (!canOpenParticipantTravelPlan(participant, currentMemberId)) return;

        setTravelPlanDetailPendingMemberId(participant.memberId);
        try {
            const plan = await getScheduleTravelPlan(id, participant.memberId);
            setInspectedTravelPlan(plan);
            setFocusedLegIndex(undefined);
            setSelectedTransitStop(undefined);
            snapSheet("compact");
        } catch (error) {
            Alert.alert("이동 계획을 불러오지 못했어요", getErrorMessage(error));
        } finally {
            setTravelPlanDetailPendingMemberId(undefined);
        }
    }, [currentMemberId, id, snapSheet, travelPlanDetailPendingMemberId]);

    const openCurrentRoutePlanner = useCallback(() => {
        if (!item || routeSavePending) return;
        const targetSessionId = `schedule-detail-${item.id}-${Date.now()}`;
        const travelMode = item.travelMode ?? routeOption?.mode ?? "CAR";
        const hasDetailedRoute = hasRenderableSavedRouteGeometry(
            item.route,
            item.origin,
            item.destination
        );
        const entryPath = getSavedRouteEntryPath(hasDetailedRoute, item.origin, item.destination);
        setRoutePlannerInitial(targetSessionId, buildScheduleRoutePlannerInitial({
            origin: item.origin,
            destination: item.destination,
            travelMode,
            travelMinutes: item.travelMinutes,
            locationName: item.locationName,
            targetArrivalAt: item.startAt,
            departureAt: item.departAt,
            route: item.route,
        }));
        routePlannerWasActiveRef.current = false;
        setRoutePlannerSessionId(targetSessionId);
        router.push({
            pathname: entryPath,
            params: {
                sessionId: targetSessionId,
                routeId: hasDetailedRoute ? routeOption?.id : undefined,
                routeIndex: "0",
                sheetState: "middle",
                entrySource: "schedule-detail",
                departureAt: item.departAt,
            },
        });
    }, [item, routeOption, routeSavePending, router]);

    useEffect(() => {
        if (
            !item ||
            item.routeSetupRequired !== true ||
            !isRouteSetupEntryRequested(openRouteSetup) ||
            routePlannerSessionId ||
            routeSavePending ||
            autoOpenedRouteSetupItemIdRef.current === item.id
        ) return;

        // 경로 설정 요청으로 들어온 최초 1회만 선택 화면을 바로 연다.
        // 사용자가 닫고 돌아오면 저장된 경로 유무에 맞는 상세 화면을 보여준다.
        autoOpenedRouteSetupItemIdRef.current = item.id;
        openCurrentRoutePlanner();
    }, [
        item,
        openCurrentRoutePlanner,
        openRouteSetup,
        routePlannerSessionId,
        routeSavePending,
    ]);

    useEffect(() => {
        const routeFlowActive = pathname === "/schedule/route-select" || pathname === "/schedule/route-planner";
        if (routeFlowActive) {
            if (routePlannerSessionId) routePlannerWasActiveRef.current = true;
            return;
        }
        if (!item || !routePlannerSessionId || !routePlannerWasActiveRef.current) return;

        routePlannerWasActiveRef.current = false;
        const payload = consumeScheduleRouteUpdatePayload(routePlannerSessionId, item);
        setRoutePlannerSessionId(undefined);
        if (!payload) return;

        setRouteSavePending(true);
        const saveRoute = saveScheduleRouteAsMyTravelPlan(item, payload, {
            upsertMyTravelPlan: upsertMyScheduleTravelPlan,
            reloadSchedule: getSchedule,
        });

        saveRoute
            .then((updated) => {
                setInspectedTravelPlan(undefined);
                dispatch({ type: "UPDATE_ITEM", item: updated });
            })
            .catch((error) => {
                Alert.alert("경로 저장 실패", getErrorMessage(error));
            })
            .finally(() => {
                setRouteSavePending(false);
            });
    }, [dispatch, item, pathname, routePlannerSessionId]);

    const camera = useMemo(() => {
        if (mapCoords.length === 0) return DEFAULT_CAMERA;
        const latitude = mapCoords.reduce((sum, coord) => sum + coord.latitude, 0) / mapCoords.length;
        const longitude = mapCoords.reduce((sum, coord) => sum + coord.longitude, 0) / mapCoords.length;
        return { latitude, longitude, zoom: mapCoords.length > 1 ? 11 : 14 };
    }, [mapCoords]);

    const fitMap = useCallback(() => {
        const map = mapRef.current;
        if (!map || mapCoords.length < 2 || !overviewFitKey) return;
        if (lastOverviewFitKeyRef.current === overviewFitKey) return;

        lastOverviewFitKeyRef.current = overviewFitKey;
        map.fitToCoordinates(mapCoords, { edgePadding: mapEdgePadding });
    }, [mapCoords, mapEdgePadding, overviewFitKey]);

    useEffect(() => {
        fitMap();
    }, [fitMap]);

    if (!item) {
        if (loading) {
            return (
                <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
                    <BrandedLoadingState
                        fill
                        size="full"
                        variant="schedule"
                        accessibilityLabel="일정을 불러오고 있어요"
                        title="일정을 불러오고 있어요"
                        caption="일정과 이동 정보를 확인하고 있어요"
                    />
                </View>
            );
        }

        return (
            <View style={[styles.missingScreen, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
                <Ionicons name="calendar-outline" size={36} color={colors.textSecondary} />
                <Text style={[styles.missingTitle, { color: colors.textPrimary }]}>일정을 불러오지 못했어요</Text>
                <Text style={[styles.missingCaption, { color: colors.textSecondary }]}>
                    {loadError ?? "삭제되었거나 접근할 수 없는 일정이에요."}
                </Text>
                <View style={styles.missingActions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="이전 화면으로 돌아가기"
                        onPress={() => router.canGoBack() ? router.back() : router.replace("/schedule")}
                        style={[styles.missingSecondaryButton, { borderColor: colors.border }]}
                    >
                        <Text style={{ color: colors.textPrimary, fontWeight: "800" }}>돌아가기</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 다시 불러오기"
                        onPress={() => setRetryKey((value) => value + 1)}
                        style={styles.missingRetryButton}
                    >
                        <Ionicons name="refresh" size={17} color="#FFFFFF" />
                        <Text style={styles.missingRetryText}>다시 시도</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    const routeTitle = item.locationName
        || (displayOrigin?.name && displayDestination?.name
            ? `${displayOrigin.name} → ${displayDestination.name}`
            : undefined)
        || displayDestination?.name
        || displayOrigin?.name
        || "선택된 경로가 없어요";
    const travelText = displayTravelMinutes
        ? `${travelModeLabel(displayTravelMode ?? undefined)} ${displayTravelMinutes}분`
        : travelModeLabel(displayTravelMode ?? undefined);
    const hasDepartureInfo = Boolean(recommendedDepartureAt || currentMemberDepartedAt || typeof item.travelMinutes === "number");
    const departureCompleted = Boolean(currentMemberDepartedAt);
    const sheetBorder = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.11)";
    const primaryText = isDark ? "#F3F4F6" : "#111827";
    const secondaryText = isDark ? "#B8B8B8" : "#64748B";
    const topCardControlBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.05)";
    const topCardAccentText = isDark ? "#78B4FF" : APP_ACCENT_BLUE;
    const departureStatusMuted = departureDisplayState.kind === "status" && departureDisplayState.tone === "disabled";
    const departureStatusAccent = departureCompleted
        ? (isDark ? "#86EFAC" : "#16A34A")
        : departureStatusMuted
            ? secondaryText
            : colors.selectedDayBg;
    const participantPresentations = buildDepartureParticipantPresentations(departureParticipants, currentMemberId);
    const travelPlanParticipants = item.travelPlanParticipants ?? [];
    const inspectedParticipant = inspectedTravelPlan
        ? travelPlanParticipants.find((participant) => participant.memberId === inspectedTravelPlan.memberId)
        : undefined;
    const departureOverview = getDepartureOverview(departureParticipants, currentMemberId);
    const scheduleRangeLabel = formatCompactScheduleRange(
        item.startAt,
        item.endAt,
        item.hasEndTime !== false,
        item.allDay === true,
    );
    const scheduleCountdownEndAt = resolveScheduleCountdownEndAt({
        startAtMs: fromISO(item.startAt).getTime(),
        endAtMs: fromISO(item.endAt).getTime(),
        hasEndTime: item.hasEndTime !== false,
        allDay: item.allDay,
    });
    const scheduleCountdown = getScheduleCountdownPresentation(
        fromISO(item.startAt).getTime(),
        scheduleCountdownEndAt,
        nowMs
    );
    const scheduleCountdownAccent = scheduleCountdown.phase === "active"
        ? "#22C55E"
        : scheduleCountdown.phase === "ended"
            ? secondaryText
            : topCardAccentText;
    const scheduleCountdownOverviewLabel = scheduleCountdown.phase === "ended"
        ? scheduleCountdown.label
        : `${scheduleCountdown.label} 남은 시간`;
    const arrivalTimeLabel = hhmmText(fromISO(item.startAt));
    const hasRenderableDetailedRoute = displayPathOverlays.some(
        (overlay) => overlay.coords.length >= 2
    );
    const routeSummaryKind = getSavedRouteSummaryKind(
        hasRenderableDetailedRoute,
        displayTravelMinutes ?? undefined
    );
    const hasRouteSummary = routeSummaryKind !== "none";
    const hasDetailedRoute = routeSummaryKind === "detailed";
    const shouldRenderMap = shouldRenderScheduleDetailMap(
        hasDetailedRoute,
        mapCoords.length
    );
    const isPlainSchedule = getScheduleDetailLayout({
        routeSummaryKind,
        routeSetupRequired: item.routeSetupRequired,
    }) === "plain";
    const showTopRouteBar = !isPlainSchedule;
    const notesText = item.notes?.trim();
    const routeDetailMeta = [
        hasDetailedRoute
            ? `${arrivalTimeLabel} 도착`
            : routeSummaryKind === "duration_only"
                ? "예상 이동 시간만 저장됨"
                : "이동 경로 미설정",
        hasDetailedRoute && typeof routeOption?.transferCount === "number"
            ? `환승 ${routeOption.transferCount}회`
            : undefined,
    ].filter(Boolean).join(" · ");
    const routeSummaryTitle = hasDetailedRoute
        ? "최적 경로"
        : routeSummaryKind === "duration_only"
            ? "상세 경로 미설정"
            : "저장된 경로 없음";
    const departureCountLabel = departureOverview.totalCount > 0
        ? `${departureOverview.departedCount}/${departureOverview.totalCount}`
        : departureCompleted
            ? "완료"
            : "대기";
    const routeDurationLabel = hasRouteSummary
        ? routeNumberText(routeOption, displayTravelMinutes ?? undefined)
        : "미설정";
    const departureActionTitle = departureCompleted
        ? "출발 알림 완료"
        : departureStatusMuted && departureDisplayState.kind === "status"
            ? departureDisplayState.text
            : recommendedDepartureAt
                ? `권장 출발 ${hhmmText(recommendedDepartureAt)}`
                : departureDisplayState.kind === "status"
                    ? departureDisplayState.text
                    : "출발 준비";
    const compactDepartureSummary = [
        hasDepartureInfo ? departureActionTitle : undefined,
        departureOverview.totalCount > 0 ? `${departureCountLabel} 출발` : undefined,
        departureOverview.totalCount > 0 ? departureOverview.movingLabel : undefined,
    ].filter(Boolean).join(" · ");
    const renderDepartureParticipantChips = () => {
        if (departureParticipants.length <= 1) return null;

        return (
            <View style={styles.departureParticipants}>
                {participantPresentations.map((participant) => {
                    const departed = participant.departed;
                    const canNudge = canSendDepartureNudge(
                        participant,
                        currentMemberId,
                        item.ownerMemberId
                    );
                    const nudgePending = departureNudgePendingMemberId === participant.memberId;

                    return (
                        <View
                            key={`${participant.memberId}-${participant.role}`}
                            // 알림 버튼이 있는 오너 화면에서는 부모가 자식 접근성 요소를
                            // 삼키지 않도록 분리한다. 읽기 전용 화면은 기존처럼 한 번에 읽는다.
                            accessible={!canNudge}
                            accessibilityLabel={`${participant.label}, ${departed ? "출발함" : "대기 중"}`}
                            style={styles.departureParticipantItem}
                        >
                            <View
                                style={[
                                    styles.departureParticipantAvatar,
                                    {
                                        backgroundColor: departed
                                            ? (isDark ? "rgba(34,197,94,0.22)" : "rgba(34,197,94,0.14)")
                                            : (isDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.07)"),
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.departureParticipantAvatarText,
                                        { color: departed ? (isDark ? "#BBF7D0" : "#166534") : secondaryText },
                                    ]}
                                >
                                    {participant.avatarLabel}
                                </Text>
                                {departed && (
                                    <View style={styles.departureParticipantCheck}>
                                        <Ionicons name="checkmark" size={8} color="#FFFFFF" />
                                    </View>
                                )}
                            </View>
                            <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={[styles.departureParticipantName, { color: primaryText }]}
                            >
                                {participant.label}
                            </Text>
                            <View style={styles.departureParticipantStatusRow}>
                                <Text
                                    style={[
                                        styles.departureParticipantStatus,
                                        {
                                            color: departed
                                                ? (isDark ? "#86EFAC" : "#15803D")
                                                : secondaryText,
                                        },
                                    ]}
                                >
                                    {departed ? "출발 완료" : "대기 중"}
                                </Text>
                                {canNudge && (
                                    <Pressable
                                        onPress={() => confirmDepartureNudge(participant.memberId, participant.label)}
                                        disabled={departureNudgePendingMemberId !== undefined}
                                        hitSlop={8}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${participant.label}님에게 출발 확인 알림 보내기`}
                                        accessibilityHint="해당 참가자의 기기로 푸시 알림을 보냅니다."
                                        accessibilityState={{
                                            busy: nudgePending,
                                            disabled: departureNudgePendingMemberId !== undefined,
                                        }}
                                        style={({ pressed }) => [
                                            styles.departureParticipantNudgeButton,
                                            {
                                                backgroundColor: pressed
                                                    ? (isDark ? "rgba(41,121,255,0.30)" : "rgba(41,121,255,0.16)")
                                                    : (isDark ? "rgba(41,121,255,0.18)" : "rgba(41,121,255,0.09)"),
                                                opacity: departureNudgePendingMemberId !== undefined && !nudgePending
                                                    ? 0.42
                                                    : 1,
                                            },
                                        ]}
                                    >
                                        {nudgePending ? (
                                            <ActivityIndicator size="small" color={topCardAccentText} />
                                        ) : (
                                            <Ionicons name="notifications-outline" size={14} color={topCardAccentText} />
                                        )}
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    );
                })}
            </View>
        );
    };

    const renderTravelPlanRows = () => {
        if (travelPlanParticipants.length <= 1) return null;

        return (
            <View style={[styles.travelPlanList, { borderTopColor: sheetBorder }]}>
                {travelPlanParticipants.map((participant) => {
                    const canOpen = canOpenParticipantTravelPlan(participant, currentMemberId);
                    const selected = inspectedTravelPlan?.memberId === participant.memberId ||
                        (!inspectedTravelPlan && participant.memberId === currentMemberId);
                    const pending = travelPlanDetailPendingMemberId === participant.memberId;
                    const detail = participant.status === "READY" && participant.travelMinutes
                        ? `${travelModeLabel(participant.travelMode ?? undefined)} ${participant.travelMinutes}분`
                        : travelPlanStatusLabel(participant.status);

                    return (
                        <Pressable
                            key={`travel-plan-${participant.memberId}`}
                            onPress={() => openParticipantTravelPlan(participant)}
                            disabled={!canOpen || pending}
                            accessibilityRole={canOpen ? "button" : undefined}
                            accessibilityLabel={`${travelPlanParticipantLabel(participant)}, ${detail}`}
                            accessibilityState={{ selected, busy: pending, disabled: !canOpen }}
                            style={({ pressed }) => [
                                styles.travelPlanRow,
                                {
                                    backgroundColor: selected
                                        ? (isDark ? "rgba(41,121,255,0.16)" : "rgba(41,121,255,0.08)")
                                        : "transparent",
                                    opacity: pressed ? 0.58 : 1,
                                },
                            ]}
                        >
                            <View
                                style={[
                                    styles.travelPlanAvatar,
                                    {
                                        backgroundColor: participant.status === "READY"
                                            ? (isDark ? "rgba(41,121,255,0.24)" : "rgba(41,121,255,0.12)")
                                            : topCardControlBg,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={participant.status === "READY" ? "navigate" : "location-outline"}
                                    size={14}
                                    color={participant.status === "READY" ? topCardAccentText : secondaryText}
                                />
                            </View>
                            <View style={styles.travelPlanCopy}>
                                <Text numberOfLines={1} style={[styles.travelPlanName, { color: primaryText }]}>
                                    {travelPlanParticipantLabel(participant)}
                                    {participant.memberId === currentMemberId ? " · 나" : ""}
                                </Text>
                                <Text numberOfLines={1} style={[styles.travelPlanMeta, { color: secondaryText }]}>
                                    {participant.originName ? `${participant.originName} · ` : ""}{detail}
                                </Text>
                            </View>
                            {pending ? (
                                <ActivityIndicator size="small" color={topCardAccentText} />
                            ) : canOpen ? (
                                <Ionicons name="chevron-forward" size={15} color={secondaryText} />
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
            {shouldRenderMap ? (
                <TmapMapView
                    ref={mapRef}
                    errorOverlayTop={Math.max(insets.top + 188, 236)}
                    camera={camera}
                    markers={displayMarkers}
                    pathOverlays={displayPathOverlays}
                    pathOverlayZoom={mapZoom}
                    clearRouteOverlays={displayPathOverlays.length === 0}
                    routeOverlayScope={`schedule-detail-${item.id}-${routeOption?.id ?? "route"}`}
                    routeFocusMode
                    nightModeEnabled={mode === "dark"}
                    showLocationButton={false}
                    showZoomControls={false}
                    onMarkerPress={handleMapMarkerPress}
                    onZoomChanged={handleMapZoomChanged}
                    fallbackBackgroundColor={colors.surface2}
                    fallbackTextColor={colors.textSecondary}
                    style={styles.fullMap}
                />
            ) : isPlainSchedule ? (
                <PlainScheduleDetailView
                    item={item}
                    contentTopInset={insets.top + 88}
                    contentBottomInset={Math.max(insets.bottom + 32, 48)}
                    travelPlan={item.routeSetupRequired === true || travelPlanParticipants.length > 1
                        ? {
                            statusLabel: travelPlanStatusLabel(item.travelPlanStatus ?? "NOT_CONFIGURED"),
                            actionLabel: item.travelPlanStatus === "READY" ? "수정" : "설정",
                            pending: routeSavePending,
                            onPress: openCurrentRoutePlanner,
                            participantContent: travelPlanParticipants.length > 1 ? (
                                <View style={[styles.plainTravelPlanParticipants, { borderTopColor: sheetBorder }]}>
                                    <Pressable
                                        onPress={() => setParticipantsExpanded((expanded) => !expanded)}
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded: participantsExpanded }}
                                        accessibilityLabel={`참여자 이동 계획 ${travelPlanParticipants.length}명 ${participantsExpanded ? "접기" : "보기"}`}
                                        style={({ pressed }) => [
                                            styles.plainTravelPlanDisclosure,
                                            { opacity: pressed ? 0.58 : 1 },
                                        ]}
                                    >
                                        <View style={styles.plainTravelPlanDisclosureTitle}>
                                            <Ionicons name="people-outline" size={16} color={secondaryText} />
                                            <Text style={[styles.plainTravelPlanDisclosureText, { color: primaryText }]}>
                                                참여자 이동 계획
                                            </Text>
                                        </View>
                                        <View style={styles.plainTravelPlanDisclosureMeta}>
                                            <Text style={[styles.plainTravelPlanCount, { color: secondaryText }]}>
                                                {travelPlanParticipants.length}명
                                            </Text>
                                            <Ionicons
                                                name={participantsExpanded ? "chevron-up" : "chevron-down"}
                                                size={15}
                                                color={secondaryText}
                                            />
                                        </View>
                                    </Pressable>
                                    {participantsExpanded ? renderTravelPlanRows() : null}
                                </View>
                            ) : undefined,
                        }
                        : undefined}
                />
            ) : (
                <View
                    style={[
                        styles.scheduleOnlySurface,
                        {
                            backgroundColor: colors.surface2,
                            paddingTop: insets.top + (showTopRouteBar ? 122 : 76),
                            paddingBottom: sheetMinHeight + 28,
                        },
                    ]}
                >
                    <View
                        style={[
                            styles.scheduleOnlyCard,
                            {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                            },
                        ]}
                    >
                        <View style={styles.scheduleOnlyHeader}>
                            <View style={styles.scheduleOnlyIcon}>
                                <Ionicons name="calendar-clear-outline" size={20} color={topCardAccentText} />
                            </View>
                            <View style={styles.scheduleOnlyCopy}>
                                <Text style={[styles.scheduleOnlyDate, { color: primaryText }]}>
                                    {scheduleRangeLabel}
                                </Text>
                                <View style={styles.scheduleOnlyCategoryRow}>
                                    <View
                                        style={[
                                            styles.scheduleOnlyCategoryDot,
                                            { backgroundColor: item.category.color },
                                        ]}
                                    />
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.scheduleOnlyCategoryText, { color: secondaryText }]}
                                    >
                                        {item.category.title}
                                    </Text>
                                </View>
                            </View>
                        </View>
                        {notesText ? (
                            <Text
                                numberOfLines={4}
                                style={[
                                    styles.scheduleOnlyNotes,
                                    { color: secondaryText, borderTopColor: colors.border },
                                ]}
                            >
                                {notesText}
                            </Text>
                        ) : null}
                    </View>
                </View>
            )}

            {shouldRenderMap ? (
                <Pressable
                    onPress={moveToCurrentLocation}
                    disabled={currentLocationPending}
                    accessibilityRole="button"
                    accessibilityLabel="지도에서 내 현재 위치 보기"
                    accessibilityState={{ busy: currentLocationPending, disabled: currentLocationPending }}
                    style={({ pressed }) => [
                        styles.currentLocationButton,
                        {
                            bottom: sheetMinHeight + 16,
                            backgroundColor: isDark ? "#20242C" : "#FFFFFF",
                            borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.12)",
                            opacity: pressed || currentLocationPending ? 0.72 : 1,
                        },
                    ]}
                >
                    {currentLocationPending ? (
                        <ActivityIndicator size="small" color={topCardAccentText} />
                    ) : (
                        <Ionicons name="locate" size={19} color={topCardAccentText} />
                    )}
                    <Text style={[styles.currentLocationButtonText, { color: primaryText }]}>내 위치</Text>
                </Pressable>
            ) : null}

            <View style={styles.topOverlay}>
                <CalendarGlassSurface
                    variant="sheet"
                    tone="flat"
                    style={[
                        styles.topHeaderGlass,
                        isPlainSchedule && styles.plainPageHeader,
                        {
                            paddingTop: insets.top + 6,
                            borderBottomColor: sheetBorder,
                        },
                    ]}
                >
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            styles.panelOpaqueBackdrop,
                            isPlainSchedule
                                ? { backgroundColor: colors.background }
                                : isDark
                                    ? styles.panelOpaqueBackdropDark
                                    : styles.panelOpaqueBackdropLight,
                        ]}
                    />
                    <View style={styles.topHeaderRow}>
                        <Pressable
                            onPress={() => router.replace("/schedule")}
                            accessibilityRole="button"
                            accessibilityLabel="일정 목록으로 돌아가기"
                            style={({ pressed }) => [
                                styles.topHeaderIconButton,
                                {
                                    backgroundColor: pressed ? topCardControlBg : "transparent",
                                    opacity: pressed ? 0.58 : 1,
                                },
                            ]}
                        >
                            <Ionicons name="chevron-back" size={21} color={primaryText} />
                        </Pressable>

                        <View style={styles.topHeaderContent}>
                            <View style={styles.topHeaderTitleRow}>
                                {!isPlainSchedule ? (
                                    <View style={styles.topHeaderKindBadge}>
                                        <Ionicons name="calendar-clear-outline" size={13} color={topCardAccentText} />
                                        <Text style={[styles.topHeaderKindText, { color: topCardAccentText }]}>일정</Text>
                                    </View>
                                ) : null}
                                <Text style={[styles.topHeaderTitle, { color: primaryText }]} numberOfLines={1}>
                                    {isPlainSchedule ? "일정 상세" : item.title}
                                </Text>
                            </View>
                        </View>

                        {(canManageSchedule || canEditSchedule) && (
                            <View style={styles.topHeaderActions}>
                                {canManageSchedule ? (
                                    <Pressable
                                        onPress={() => setShareSheetVisible(true)}
                                        accessibilityRole="button"
                                        accessibilityLabel="일정 공유"
                                        style={({ pressed }) => [
                                            styles.topHeaderIconButton,
                                            {
                                                backgroundColor: pressed ? topCardControlBg : "transparent",
                                                opacity: pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons name="share-social-outline" size={20} color={primaryText} />
                                    </Pressable>
                                ) : null}
                                {canEditSchedule ? (
                                    <Pressable
                                        onPress={() => router.setParams({ mode: "edit" })}
                                        accessibilityRole="button"
                                        accessibilityLabel="일정 수정"
                                        style={({ pressed }) => [
                                            styles.topHeaderIconButton,
                                            {
                                                backgroundColor: pressed ? topCardControlBg : "transparent",
                                                opacity: pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons name="create-outline" size={20} color={primaryText} />
                                    </Pressable>
                                ) : null}
                            </View>
                        )}
                    </View>

                    {showTopRouteBar ? (
                        <View
                            style={[
                                styles.topHeaderRouteBar,
                                { borderTopColor: sheetBorder },
                            ]}
                        >
                            <View style={styles.topHeaderRouteBarMain}>
                                <Ionicons
                                    name={hasDetailedRoute ? "navigate-outline" : "location-outline"}
                                    size={13}
                                    color={topCardAccentText}
                                />
                                <Text style={[styles.topHeaderRouteBarText, { color: primaryText }]} numberOfLines={1}>
                                    {routeTitle}
                                </Text>
                            </View>
                            {hasRouteSummary ? (
                                <View style={styles.topHeaderTravelPill}>
                                    <Text style={[styles.topHeaderTravelText, { color: topCardAccentText }]} numberOfLines={1}>
                                        {travelText}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                </CalendarGlassSurface>
            </View>

            {!isPlainSchedule ? (
            <Animated.View
                style={[
                    styles.routeSheet,
                    {
                        height: sheetMaxHeight,
                        transform: [{ translateY: sheetTranslateY }],
                    },
                ]}
            >
                <CalendarGlassSurface
                    variant="sheet"
                    tone="flat"
                    style={[
                        styles.routeSheetGlass,
                        { borderColor: sheetBorder },
                    ]}
                >
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            styles.panelOpaqueBackdrop,
                            isDark ? styles.panelOpaqueBackdropDark : styles.panelOpaqueBackdropLight,
                        ]}
                    />
                    <View style={styles.sheetHandleHitArea} {...sheetPanResponder.panHandlers}>
                        <View style={[styles.sheetHandle, { backgroundColor: sheetBorder }]} />
                    </View>
                    <ScrollView
                        ref={sheetScrollRef}
                        style={styles.sheetScroll}
                        contentContainerStyle={[
                            styles.sheetScrollContent,
                            { paddingBottom: sheetBottomPadding },
                        ]}
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                        scrollEnabled={sheetMode === "expanded"}
                    >
                        <Animated.View
                            {...getScheduleAccessibilityVisibility(sheetMode === "compact")}
                            style={[styles.sheetQuickSummaryClip, sheetQuickSummaryAnimatedStyle]}
                        >
                            <Pressable
                                onPress={() => snapSheet("expanded")}
                                accessibilityRole="button"
                                accessibilityLabel={[
                                    "일정 상세 시트 펼치기",
                                    `${scheduleCountdownOverviewLabel} ${scheduleCountdown.compactValue}`,
                                    compactDepartureSummary,
                                    routeProgressSegments.length > 0
                                        ? getTransitRouteSummaryAccessibilityLabel(routeProgressSegments)
                                        : undefined,
                                ].filter(Boolean).join(", ")}
                                style={({ pressed }) => [
                                    styles.sheetQuickSummary,
                                    { borderBottomColor: sheetBorder, opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <View style={styles.sheetQuickSummaryMain}>
                                    <View style={styles.sheetQuickCountdown}>
                                        <View style={styles.sheetQuickLabelRow}>
                                            <Ionicons name="time-outline" size={13} color={scheduleCountdownAccent} />
                                            <Text style={[styles.sheetQuickLabel, { color: secondaryText }]}>
                                                {scheduleCountdownOverviewLabel}
                                            </Text>
                                        </View>
                                        <Text style={[styles.sheetQuickValue, { color: primaryText }]}>
                                            {scheduleCountdown.compactValue}
                                        </Text>
                                    </View>
                                    <View style={styles.sheetQuickTrailing}>
                                        <Text style={[styles.sheetQuickDate, { color: secondaryText }]} numberOfLines={1}>
                                            {scheduleRangeLabel}
                                        </Text>
                                        <View style={styles.sheetQuickExpand}>
                                            <Ionicons name="chevron-up" size={17} color={primaryText} />
                                        </View>
                                    </View>
                                </View>
                                {!!compactDepartureSummary && (
                                    <View style={styles.sheetQuickStatusRow}>
                                        <Ionicons
                                            name={departureCompleted ? "checkmark-circle-outline" : "walk-outline"}
                                            size={13}
                                            color={departureStatusAccent}
                                        />
                                        <Text
                                            style={[styles.sheetQuickStatus, { color: secondaryText }]}
                                            numberOfLines={1}
                                        >
                                            {compactDepartureSummary}
                                        </Text>
                                    </View>
                                )}
                                {routeProgressSegments.length > 0 && (
                                    <TransitRouteSummaryRow
                                        segments={routeProgressSegments}
                                        isDark={isDark}
                                    />
                                )}
                            </Pressable>
                        </Animated.View>

                        <View
                            onLayout={handleExpandedContentLayout}
                            pointerEvents={sheetMode === "expanded" ? "auto" : "none"}
                            accessibilityElementsHidden={sheetMode !== "expanded"}
                            importantForAccessibility={sheetMode === "expanded" ? "auto" : "no-hide-descendants"}
                            style={styles.sheetExpandedContent}
                        >
                        <View style={[styles.sheetStatusSection, { borderBottomColor: sheetBorder }]}>
                            <View
                                style={[
                                    styles.sheetStatusHero,
                                    { borderLeftColor: scheduleCountdownAccent },
                                ]}
                            >
                                <View style={styles.sheetStatusHeader}>
                                    <View style={styles.sheetScheduleOverviewLabelRow}>
                                        <Ionicons
                                            name={scheduleCountdown.phase === "ended" ? "checkmark-circle-outline" : "time-outline"}
                                            size={14}
                                            color={scheduleCountdownAccent}
                                        />
                                        <Text style={[styles.sheetScheduleOverviewLabel, { color: secondaryText }]}>
                                            {scheduleCountdownOverviewLabel}
                                        </Text>
                                    </View>
                                    <View style={styles.sheetStatusHeaderTrailing}>
                                        <Text style={[styles.sheetScheduleOverviewDate, { color: secondaryText }]} numberOfLines={1}>
                                            {scheduleRangeLabel}
                                        </Text>
                                        <Pressable
                                            onPress={() => snapSheet("compact")}
                                            accessibilityRole="button"
                                            accessibilityLabel="일정 상세 시트 접기"
                                            style={({ pressed }) => [
                                                styles.sheetScheduleCollapse,
                                                {
                                                    backgroundColor: pressed ? topCardControlBg : "transparent",
                                                    opacity: pressed ? 0.58 : 1,
                                                },
                                            ]}
                                        >
                                            <Ionicons name="chevron-down" size={19} color={primaryText} />
                                        </Pressable>
                                    </View>
                                </View>

                                <View style={styles.sheetStatusMainRow}>
                                    <Text
                                        style={[styles.sheetScheduleOverviewValue, { color: primaryText }]}
                                        numberOfLines={1}
                                        adjustsFontSizeToFit
                                        minimumFontScale={0.72}
                                    >
                                        {scheduleCountdown.compactValue}
                                    </Text>
                                    {hasDepartureInfo && (
                                        <Pressable
                                            onPress={completeDeparture}
                                            disabled={departureCompleted || departureActionPending}
                                            accessibilityRole="button"
                                            accessibilityLabel="출발 알리기"
                                            style={({ pressed }) => [
                                                styles.sheetDepartureActionButton,
                                                {
                                                    backgroundColor: departureCompleted
                                                        ? (isDark ? "rgba(41,121,255,0.20)" : "rgba(41,121,255,0.12)")
                                                        : APP_ACCENT_BLUE,
                                                    opacity: pressed || departureActionPending ? 0.64 : 1,
                                                },
                                            ]}
                                        >
                                        {departureActionPending ? (
                                            <View style={styles.sheetDepartureActionLoading}>
                                                <BrandedLoader
                                                    size="button"
                                                    variant="route"
                                                    accessibilityLabel="출발 알림을 처리하고 있어요"
                                                />
                                                <Text style={[styles.sheetDepartureActionButtonText, { color: "#FFFFFF" }]}>
                                                    처리 중
                                                </Text>
                                            </View>
                                        ) : (
                                            <Text
                                                style={[
                                                    styles.sheetDepartureActionButtonText,
                                                    { color: departureCompleted ? topCardAccentText : "#FFFFFF" },
                                                ]}
                                            >
                                                {departureCompleted ? "알림 완료" : "출발 알리기"}
                                            </Text>
                                        )}
                                        </Pressable>
                                    )}
                                </View>

                                {!!compactDepartureSummary && (
                                    <View style={styles.sheetStatusMetaRow}>
                                        <Ionicons
                                            name={departureCompleted ? "checkmark-circle-outline" : "walk-outline"}
                                            size={14}
                                            color={departureStatusAccent}
                                        />
                                        <Text
                                            style={[styles.sheetStatusMeta, { color: secondaryText }]}
                                            numberOfLines={1}
                                        >
                                            {compactDepartureSummary}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {departureParticipants.length > 1 && (
                                <Pressable
                                    onPress={() => setParticipantsExpanded((expanded) => !expanded)}
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded: participantsExpanded }}
                                    accessibilityLabel={`참여자 ${departureParticipants.length}명 ${participantsExpanded ? "접기" : "보기"}, ${departureOverview.movingLabel}, ${departureCountLabel} 출발`}
                                    style={({ pressed }) => [
                                        styles.sheetParticipantDisclosure,
                                        {
                                            borderTopColor: sheetBorder,
                                            opacity: pressed ? 0.56 : 1,
                                        },
                                    ]}
                                >
                                    <View style={styles.sheetParticipantDisclosureTitle}>
                                        <Ionicons name="people-outline" size={16} color={secondaryText} />
                                        <Text style={[styles.sheetSectionTitle, { color: primaryText }]}>
                                            참여자 {departureParticipants.length}명
                                        </Text>
                                    </View>
                                    <View style={styles.sheetParticipantDisclosureSummary}>
                                        <Text
                                            numberOfLines={1}
                                            style={[styles.sheetParticipantSummary, { color: secondaryText }]}
                                        >
                                            {departureOverview.movingLabel} · {departureCountLabel} 출발
                                        </Text>
                                        <Ionicons
                                            name={participantsExpanded ? "chevron-up" : "chevron-down"}
                                            size={15}
                                            color={secondaryText}
                                        />
                                    </View>
                                </Pressable>
                            )}

                            {participantsExpanded && (
                                <>
                                    {renderDepartureParticipantChips()}
                                    {renderTravelPlanRows()}
                                </>
                            )}
                        </View>

                        <>
                        <View
                            style={[
                                styles.sheetRouteSummary,
                                { borderBottomColor: sheetBorder },
                            ]}
                        >
                            {inspectedTravelPlan && (
                                <View style={[styles.inspectedPlanBar, { borderBottomColor: sheetBorder }]}>
                                    <View style={styles.inspectedPlanIdentity}>
                                        <Ionicons name="person-circle-outline" size={17} color={topCardAccentText} />
                                        <Text numberOfLines={1} style={[styles.inspectedPlanText, { color: primaryText }]}>
                                            {inspectedParticipant
                                                ? `${travelPlanParticipantLabel(inspectedParticipant)}의 이동 계획`
                                                : "참여자 이동 계획"}
                                        </Text>
                                    </View>
                                    <Pressable
                                        onPress={() => setInspectedTravelPlan(undefined)}
                                        accessibilityRole="button"
                                        accessibilityLabel="내 이동 계획으로 돌아가기"
                                        style={({ pressed }) => [
                                            styles.inspectedPlanClose,
                                            { opacity: pressed ? 0.5 : 1 },
                                        ]}
                                    >
                                        <Ionicons name="close" size={17} color={secondaryText} />
                                    </Pressable>
                                </View>
                            )}
                            <View style={styles.sheetRouteTopRow}>
                                <View style={styles.sheetRouteCopy}>
                                    <View style={styles.sheetRouteKickerRow}>
                                        <View
                                            style={[
                                                styles.sheetRouteLiveDot,
                                                { backgroundColor: hasDetailedRoute ? "#22C55E" : secondaryText },
                                            ]}
                                        />
                                        <Text style={[styles.sheetRouteMeta, { color: secondaryText }]}>
                                            {routeDetailMeta}
                                        </Text>
                                    </View>
                                    <Text
                                        style={[styles.sheetRouteTitle, { color: primaryText }]}
                                    >
                                        {routeSummaryTitle}
                                    </Text>
                                </View>
                                <View style={styles.sheetRouteActions}>
                                    <Text style={[styles.sheetRouteDuration, { color: primaryText }]}>
                                        {routeDurationLabel}
                                    </Text>
                                    {!inspectedTravelPlan && (
                                    <Pressable
                                        onPress={openCurrentRoutePlanner}
                                        disabled={routeSavePending}
                                        accessibilityRole="button"
                                        accessibilityLabel={hasDetailedRoute
                                            ? "현재 길찾기 화면에서 전체 경로 보기"
                                            : "이동 경로 설정"}
                                        accessibilityState={{
                                            busy: routeSavePending,
                                            disabled: routeSavePending,
                                        }}
                                        style={({ pressed }) => [
                                            styles.sheetRouteMapButton,
                                            {
                                                backgroundColor: pressed ? topCardControlBg : "transparent",
                                                opacity: routeSavePending
                                                    ? 0.35
                                                    : pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        {routeSavePending ? (
                                            <ActivityIndicator size="small" color={primaryText} />
                                        ) : (
                                            <Ionicons name="map-outline" size={21} color={primaryText} />
                                        )}
                                    </Pressable>
                                    )}
                                </View>
                            </View>
                            {hasDetailedRoute && routeProgressSegments.length > 0 && (
                                <View style={styles.routeProgressSection}>
                                    <TransitRouteProgressBar
                                        segments={routeProgressSegments}
                                        isDark={isDark}
                                        compact
                                    />
                                </View>
                            )}
                        </View>

                        {hasDetailedRoute && routeDetailInfo ? (
                            <>
                                <View style={[styles.routeDetailHeader, { borderBottomColor: sheetBorder }]}>
                                    <Text style={[styles.routeDetailSectionTitle, { color: primaryText }]}>경로 상세</Text>
                                    <Text style={[styles.routeDetailBaseTimeText, { color: secondaryText }]}>
                                        {hhmmText(fromISO(routeDetailInfo.departureTime))} 출발 기준
                                    </Text>
                                </View>
                                <RouteStepTimeline
                                    routeInfo={routeDetailInfo}
                                    selectedStepId={selectedRouteStepId}
                                    selectedPassStop={selectedRoutePassStop}
                                    onStepPress={handleRouteStepPress}
                                    allowEndpointPress
                                    forceDark={isDark}
                                    primaryTextColor={primaryText}
                                    secondaryTextColor={secondaryText}
                                    compact
                                />
                            </>
                        ) : (
                            <Text style={[styles.sheetEmptyText, { color: secondaryText }]}>
                                저장된 상세 경로가 없어요.
                            </Text>
                        )}
                        </>
                        </View>
                    </ScrollView>
                </CalendarGlassSurface>
            </Animated.View>
            ) : null}

            <ShareInvitationSheet
                visible={shareSheetVisible}
                resourceType="schedule"
                resourceId={item.id}
                title={item.title}
                subtitle={formatCompactScheduleRange(item.startAt, item.endAt, item.hasEndTime !== false, item.allDay === true)}
                onClose={() => setShareSheetVisible(false)}
            />

        </View>
    );
}

const styles = StyleSheet.create({
    missingScreen: {
        flex: 1,
        paddingHorizontal: 28,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
    },
    missingTitle: { fontSize: 20, fontWeight: "900", textAlign: "center" },
    missingCaption: { fontSize: 14, fontWeight: "600", lineHeight: 21, textAlign: "center" },
    missingActions: { flexDirection: "row", gap: 10, marginTop: 12 },
    missingSecondaryButton: {
        minHeight: 46,
        paddingHorizontal: 18,
        borderWidth: 1,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    missingRetryButton: {
        minHeight: 46,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: APP_ACCENT_BLUE,
        flexDirection: "row",
        gap: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    missingRetryText: { color: "#FFFFFF", fontWeight: "800" },
    loadingScreen: {
        flex: 1,
    },
    container: { flex: 1 },
    fullMap: { flex: 1 },
    scheduleOnlySurface: {
        flex: 1,
        paddingHorizontal: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    scheduleOnlyCard: {
        width: "100%",
        maxWidth: 420,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 22,
        padding: 18,
        gap: 14,
    },
    scheduleOnlyHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    scheduleOnlyIcon: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(41,121,255,0.11)",
    },
    scheduleOnlyCopy: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    scheduleOnlyDate: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "900",
        letterSpacing: 0,
    },
    scheduleOnlyCategoryRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    scheduleOnlyCategoryDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    scheduleOnlyCategoryText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    scheduleOnlyNotes: {
        paddingTop: 13,
        borderTopWidth: StyleSheet.hairlineWidth,
        fontSize: 13,
        lineHeight: 20,
        fontWeight: "600",
    },
    currentLocationButton: {
        position: "absolute",
        right: 16,
        zIndex: 20,
        elevation: 18,
        height: 44,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
    },
    currentLocationButtonText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    topOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        elevation: 0,
    },
    topHeaderGlass: {
        minHeight: 112,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 16,
        paddingBottom: 12,
        overflow: "hidden",
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    plainPageHeader: {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingBottom: 10,
    },
    topHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    topHeaderIconButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    topHeaderContent: {
        flex: 1,
        minWidth: 0,
    },
    topHeaderTitleRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    topHeaderKindBadge: {
        minHeight: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        flexShrink: 0,
    },
    topHeaderKindText: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    topHeaderTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: "900",
        letterSpacing: 0,
    },
    topHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
    },
    topHeaderRouteBar: {
        minHeight: 42,
        marginTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 10,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    topHeaderRouteBarMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    topHeaderRouteBarText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
    topHeaderTravelPill: {
        maxWidth: 112,
        minHeight: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    topHeaderTravelText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    departureParticipants: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
        rowGap: 10,
        paddingTop: 8,
        paddingBottom: 2,
    },
    departureParticipantItem: {
        width: "25%",
        flexGrow: 0,
        flexShrink: 0,
        minWidth: 0,
        alignItems: "center",
        gap: 4,
    },
    departureParticipantAvatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    departureParticipantAvatarText: {
        maxWidth: 22,
        fontSize: 10,
        lineHeight: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
    departureParticipantCheck: {
        position: "absolute",
        right: -2,
        bottom: -1,
        width: 13,
        height: 13,
        borderRadius: 7,
        backgroundColor: "#22C55E",
        alignItems: "center",
        justifyContent: "center",
    },
    departureParticipantName: {
        width: "100%",
        textAlign: "center",
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "700",
        letterSpacing: 0,
    },
    departureParticipantStatusRow: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    departureParticipantStatus: {
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "700",
        letterSpacing: 0,
    },
    departureParticipantNudgeButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    routeSheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 28,
        elevation: 28,
    },
    routeSheetGlass: {
        flex: 1,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        overflow: "hidden",
    },
    panelOpaqueBackdrop: {
        opacity: 1,
    },
    panelOpaqueBackdropDark: {
        backgroundColor: "#171A20",
    },
    panelOpaqueBackdropLight: {
        backgroundColor: "#F8FAFC",
    },
    sheetHandleHitArea: {
        height: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetHandle: {
        width: 34,
        height: 4,
        borderRadius: 999,
    },
    sheetScroll: { flex: 1 },
    sheetScrollContent: { paddingBottom: 0 },
    sheetQuickSummaryClip: {
        overflow: "hidden",
    },
    sheetQuickSummary: {
        minHeight: 92,
        justifyContent: "center",
        gap: 5,
        paddingTop: 3,
        paddingBottom: 8,
        paddingHorizontal: 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetQuickSummaryMain: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 12,
    },
    sheetQuickCountdown: {
        flex: 1,
        minWidth: 0,
    },
    sheetQuickLabelRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    sheetQuickLabel: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sheetQuickValue: {
        marginTop: 1,
        fontSize: 24,
        lineHeight: 29,
        fontWeight: "900",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
    sheetQuickTrailing: {
        minWidth: 108,
        alignItems: "flex-end",
        justifyContent: "flex-end",
    },
    sheetQuickDate: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetQuickExpand: {
        width: 44,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetQuickStatusRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    sheetQuickStatus: {
        flex: 1,
        minWidth: 0,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetExpandedContent: {
        width: "100%",
    },
    sheetStatusSection: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
        paddingBottom: 8,
    },
    sheetStatusHero: {
        borderLeftWidth: 3,
        borderRadius: 2,
        paddingLeft: 12,
        paddingVertical: 5,
    },
    sheetStatusHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    sheetStatusHeaderTrailing: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 2,
    },
    sheetStatusMainRow: {
        minHeight: 44,
        marginTop: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    sheetScheduleOverviewLabelRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    sheetScheduleOverviewLabel: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sheetScheduleOverviewValue: {
        flex: 1,
        minWidth: 0,
        fontSize: 28,
        lineHeight: 33,
        fontWeight: "900",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
    sheetScheduleOverviewDate: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetScheduleCollapse: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetSectionTitle: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sheetParticipantDisclosure: {
        width: "100%",
        minHeight: 44,
        marginTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    sheetParticipantDisclosureTitle: {
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    sheetParticipantDisclosureSummary: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 5,
    },
    sheetParticipantSummary: {
        flexShrink: 1,
        textAlign: "right",
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sheetStatusMetaRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    sheetStatusMeta: {
        flex: 1,
        minWidth: 0,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sheetDepartureActionButton: {
        minWidth: 96,
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetDepartureActionButtonText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetDepartureActionLoading: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    travelPlanList: {
        marginTop: 8,
        paddingTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 2,
    },
    travelPlanRow: {
        minHeight: 52,
        borderRadius: 6,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    travelPlanAvatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    travelPlanCopy: {
        flex: 1,
        minWidth: 0,
    },
    travelPlanName: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    travelPlanMeta: {
        marginTop: 2,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    inspectedPlanBar: {
        minHeight: 34,
        marginBottom: 10,
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    inspectedPlanIdentity: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    inspectedPlanText: {
        flex: 1,
        minWidth: 0,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    inspectedPlanClose: {
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    plainTravelPlanParticipants: {
        marginTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    plainTravelPlanDisclosure: {
        minHeight: 46,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    plainTravelPlanDisclosureTitle: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    plainTravelPlanDisclosureText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    plainTravelPlanDisclosureMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    plainTravelPlanCount: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetRouteSummary: {
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetRouteTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sheetRouteCopy: {
        flex: 1,
        minWidth: 0,
    },
    sheetRouteKickerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    sheetRouteLiveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    sheetRouteMeta: {
        flexShrink: 1,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetRouteTitle: {
        marginTop: 2,
        fontSize: 18,
        lineHeight: 23,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetRouteDuration: {
        fontSize: 26,
        lineHeight: 30,
        fontWeight: "900",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
    sheetRouteActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    sheetRouteMapButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
    },
    routeProgressSection: {
        marginTop: 12,
    },
    routeDetailHeader: {
        minHeight: 38,
        marginTop: 12,
        paddingHorizontal: 2,
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    routeDetailSectionTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
    routeDetailBaseTimeText: {
        flexShrink: 1,
        fontSize: 10,
        fontWeight: "800",
        lineHeight: 14,
        textAlign: "right",
    },
    sheetEmptyText: {
        fontSize: 14,
        fontWeight: "800",
        paddingVertical: 20,
        textAlign: "center",
    },
});

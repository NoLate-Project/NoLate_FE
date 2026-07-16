import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    PanResponder,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
    type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSchedule, markScheduleDeparted } from "../../src/api/schedule";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import TmapMapView, {
    type TmapMapViewHandle,
} from "../../src/modules/map/TmapMapView";
import type { RouteAlternativeOption } from "../../src/modules/map/tmapApi";
import {
    buildSavedRouteMapPresentation,
    getSavedRouteFitCoords,
    getSavedTransitLegCoords,
} from "../../src/modules/map/savedRouteMapPresentation";
import { parseTransitMapInteractionId } from "../../src/modules/map/transitMapInteraction";
import RouteStepTimeline from "../../src/modules/schedule/components/route/RouteStepTimeline";
import TransitRouteProgressBar from "../../src/modules/schedule/components/route/TransitRouteProgressBar";
import TransitRouteSummaryRow, {
    getTransitRouteSummaryAccessibilityLabel,
} from "../../src/modules/schedule/components/route/TransitRouteSummaryRow";
import { buildSavedRouteDetailInfo } from "../../src/modules/schedule/savedRouteDetailPresentation";
import { buildTransitRouteProgressSegments } from "../../src/modules/schedule/transitRouteProgress";
import type { RouteStep } from "../../src/modules/schedule/routeInfo";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { ScheduleItem, TravelMode } from "../../src/modules/schedule/types";
import { setRoutePlannerInitial } from "../../src/modules/schedule/routePlannerSession";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { fromISO } from "../../lib/util/data";
import { getAuthMember } from "../../src/modules/auth/authStorage";
import BrandedLoader, { BrandedLoadingState } from "../../src/ui/BrandedLoader";
import {
    buildDepartureParticipantPresentations,
    getDepartureOverview,
    getScheduleCountdownPresentation,
    getScheduleDetailSheetHeights,
} from "../../src/modules/schedule/detailPresentation";

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
const SHEET_COMPACT_BOTTOM_GUTTER = 20;
const DETAIL_OVERVIEW_ZOOM_DELTA = -1;

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

function formatCompactScheduleRange(startAt: string, endAt: string, hasEndTime = true) {
    const start = fromISO(startAt);
    const shortDate = `${pad2(start.getMonth() + 1)}.${pad2(start.getDate())}`;
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
    const { id } = useLocalSearchParams<{ id: string }>();
    const pathname = usePathname();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const isDark = mode === "dark";
    const { state, dispatch } = useScheduleStore();
    const mapRef = useRef<TmapMapViewHandle>(null);
    const sheetScrollRef = useRef<ScrollView>(null);
    const sheetStartOffsetRef = useRef(0);
    const sheetSnapModeRef = useRef<SheetSnapMode>("compact");
    const [loading, setLoading] = useState(false);
    const {
        minHeight: sheetBaseMinHeight,
        maxHeight: sheetMaxHeight,
    } = getScheduleDetailSheetHeights(windowHeight);
    const sheetMinHeight = sheetBaseMinHeight + SHEET_COMPACT_BOTTOM_GUTTER;
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
    const [participantsExpanded, setParticipantsExpanded] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const item = id ? state.itemsById[id] : undefined;
    const canManageSchedule = useMemo(() => {
        if (!item) return false;
        if (typeof item.ownerMemberId !== "number") return true;
        return currentMemberId === item.ownerMemberId;
    }, [currentMemberId, item]);
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
        setParticipantsExpanded(false);
        setExpandedContentHeight(0);
    }, [id]);

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
        if (!id) return;
        let cancelled = false;
        setLoading(true);
        getSchedule(id)
            .then((detail) => {
                if (!cancelled) dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                const routeFlowActive = pathname === "/schedule/route-select" || pathname === "/schedule/route-planner";
                if (!cancelled && !routeFlowActive) Alert.alert("일정 조회 실패", getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch, id, pathname]);

    const displayRoute = item?.route;
    const mapPresentation = useMemo(() => buildSavedRouteMapPresentation({
        route: displayRoute,
        origin: item?.origin,
        destination: item?.destination,
        mapZoom,
        isDark,
        focusedLegIndex,
    }), [displayRoute, focusedLegIndex, isDark, item?.destination, item?.origin, mapZoom]);
    const {
        routeOption,
        routeLegs,
        pathOverlays: displayPathOverlays,
        markers,
    } = mapPresentation;
    const mapCoords = useMemo(
        () => getSavedRouteFitCoords(displayRoute, item?.origin, item?.destination),
        [displayRoute, item?.destination, item?.origin]
    );
    const routeDetailInfo = useMemo(() => buildSavedRouteDetailInfo({
        route: displayRoute,
        routeAlternative: routeOption,
        origin: item?.origin,
        destination: item?.destination,
        departureAt: recommendedDepartureAt,
    }), [displayRoute, item?.destination, item?.origin, recommendedDepartureAt, routeOption]);
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
        const legIndex = routeTravelSteps.findIndex((candidate) => candidate.id === step.id);
        if (legIndex < 0) return;
        // 타임라인 탭은 정류장 상세를 읽는 동작이므로 시트와 스크롤 위치를 유지한다.
        setFocusedLegIndex(legIndex);
        setSelectedTransitStop(undefined);
    }, [routeTravelSteps]);

    const handleMapZoomChanged = useCallback((zoom: number) => {
        if (!Number.isFinite(zoom)) return;
        setMapZoom((current) => Math.abs(current - zoom) < 0.04 ? current : zoom);
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

    const openCurrentRoutePlanner = useCallback(() => {
        if (!item) return;
        const targetSessionId = `schedule-detail-${item.id}-${Date.now()}`;
        const travelMode = item.travelMode ?? routeOption?.mode ?? "CAR";
        setRoutePlannerInitial(targetSessionId, {
            origin: item.origin,
            destination: item.destination,
            travelMode,
            travelMinutes: item.travelMinutes,
            locationName: item.locationName,
            route: item.route,
        });
        router.push({
            pathname: "/schedule/route-planner",
            params: {
                sessionId: targetSessionId,
                routeId: routeOption?.id,
                routeIndex: "0",
                sheetState: "middle",
                entrySource: "schedule-detail",
                departureAt: item.departAt ?? new Date().toISOString(),
            },
        });
    }, [item, routeOption?.id, routeOption?.mode, router]);

    const camera = useMemo(() => {
        if (mapCoords.length === 0) return DEFAULT_CAMERA;
        const latitude = mapCoords.reduce((sum, coord) => sum + coord.latitude, 0) / mapCoords.length;
        const longitude = mapCoords.reduce((sum, coord) => sum + coord.longitude, 0) / mapCoords.length;
        return { latitude, longitude, zoom: mapCoords.length > 1 ? 11 : 14 };
    }, [mapCoords]);

    const fitMap = useCallback(() => {
        if (mapCoords.length > 1) {
            mapRef.current?.fitToCoordinates(mapCoords, {
                edgePadding: {
                    top: insets.top + 124,
                    right: 44,
                    bottom: sheetMinHeight + 28,
                    left: 44,
                },
            });
            mapRef.current?.zoomBy(DETAIL_OVERVIEW_ZOOM_DELTA);
        }
    }, [insets.top, mapCoords, sheetMinHeight]);

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
            <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: insets.top + 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary }}>
                    일정을 찾을 수 없어요.
                </Text>
            </View>
        );
    }

    const routeTitle = item.locationName
        || (item.origin?.name && item.destination?.name ? `${item.origin.name} → ${item.destination.name}` : undefined)
        || item.destination?.name
        || item.origin?.name
        || "선택된 경로가 없어요";
    const travelText = item.travelMinutes
        ? `${travelModeLabel(item.travelMode)} ${item.travelMinutes}분`
        : travelModeLabel(item.travelMode);
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
    const departureOverview = getDepartureOverview(departureParticipants, currentMemberId);
    const scheduleRangeLabel = formatCompactScheduleRange(
        item.startAt,
        item.endAt,
        item.hasEndTime !== false
    );
    const scheduleCountdown = getScheduleCountdownPresentation(
        fromISO(item.startAt).getTime(),
        item.hasEndTime !== false ? fromISO(item.endAt).getTime() : undefined,
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
    const routeDetailMeta = [
        `${arrivalTimeLabel} 도착`,
        typeof routeOption?.transferCount === "number" ? `환승 ${routeOption.transferCount}회` : undefined,
    ].filter(Boolean).join(" · ");
    const departureCountLabel = departureOverview.totalCount > 0
        ? `${departureOverview.departedCount}/${departureOverview.totalCount}`
        : departureCompleted
            ? "완료"
            : "대기";
    const routeDurationLabel = routeNumberText(routeOption, item.travelMinutes);
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

                    return (
                        <View
                            key={`${participant.memberId}-${participant.role}`}
                            accessible
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
                        </View>
                    );
                })}
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
            <TmapMapView
                ref={mapRef}
                camera={camera}
                markers={markers}
                pathOverlays={displayPathOverlays}
                clearRouteOverlays={displayPathOverlays.length === 0}
                routeOverlayScope={`schedule-detail-${item.id}-${routeOption?.id ?? "route"}`}
                routeFocusMode
                nightModeEnabled={mode === "dark"}
                showLocationButton={false}
                showZoomControls={false}
                onMarkerPress={handleMapMarkerPress}
                onZoomChanged={handleMapZoomChanged}
                onInitialized={fitMap}
                fallbackBackgroundColor={colors.surface2}
                fallbackTextColor={colors.textSecondary}
                style={styles.fullMap}
            />

            <View style={styles.topOverlay}>
                <CalendarGlassSurface
                    variant="sheet"
                    tone="flat"
                    style={[
                        styles.topHeaderGlass,
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
                            isDark ? styles.panelOpaqueBackdropDark : styles.panelOpaqueBackdropLight,
                        ]}
                    />
                    <View style={styles.topHeaderRow}>
                        <Pressable
                            onPress={() => router.replace("/schedule")}
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
                                <View style={styles.topHeaderKindBadge}>
                                    <Ionicons name="calendar-clear-outline" size={13} color={topCardAccentText} />
                                    <Text style={[styles.topHeaderKindText, { color: topCardAccentText }]}>일정</Text>
                                </View>
                                <Text style={[styles.topHeaderTitle, { color: primaryText }]} numberOfLines={1}>
                                    {item.title}
                                </Text>
                            </View>
                        </View>

                        {canManageSchedule && (
                            <View style={styles.topHeaderActions}>
                                <Pressable
                                    onPress={() => setShareSheetVisible(true)}
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
                                <Pressable
                                    onPress={() => router.setParams({ mode: "edit" })}
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
                            </View>
                        )}
                    </View>

                    <View
                        style={[
                            styles.topHeaderRouteBar,
                            { borderTopColor: sheetBorder },
                        ]}
                    >
                        <View style={styles.topHeaderRouteBarMain}>
                            <Ionicons name="navigate-outline" size={13} color={topCardAccentText} />
                            <Text style={[styles.topHeaderRouteBarText, { color: primaryText }]} numberOfLines={1}>
                                {routeTitle}
                            </Text>
                        </View>
                        <View style={styles.topHeaderTravelPill}>
                            <Text style={[styles.topHeaderTravelText, { color: topCardAccentText }]} numberOfLines={1}>
                                {travelText}
                            </Text>
                        </View>
                    </View>
                </CalendarGlassSurface>
            </View>

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
                        <Animated.View style={[styles.sheetQuickSummaryClip, sheetQuickSummaryAnimatedStyle]}>
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

                            {participantsExpanded && renderDepartureParticipantChips()}
                        </View>

                        <View
                            style={[
                                styles.sheetRouteSummary,
                                { borderBottomColor: sheetBorder },
                            ]}
                        >
                            <View style={styles.sheetRouteTopRow}>
                                <View style={styles.sheetRouteCopy}>
                                    <View style={styles.sheetRouteKickerRow}>
                                        <View style={[styles.sheetRouteLiveDot, { backgroundColor: "#22C55E" }]} />
                                        <Text style={[styles.sheetRouteMeta, { color: secondaryText }]}>
                                            {routeDetailMeta}
                                        </Text>
                                    </View>
                                    <Text style={[styles.sheetRouteTitle, { color: primaryText }]}>최적 경로</Text>
                                </View>
                                <View style={styles.sheetRouteActions}>
                                    <Text style={[styles.sheetRouteDuration, { color: primaryText }]}>
                                        {routeDurationLabel}
                                    </Text>
                                    <Pressable
                                        onPress={openCurrentRoutePlanner}
                                        disabled={!item.origin || !item.destination}
                                        accessibilityRole="button"
                                        accessibilityLabel="현재 길찾기 화면에서 전체 경로 보기"
                                        style={({ pressed }) => [
                                            styles.sheetRouteMapButton,
                                            {
                                                backgroundColor: pressed ? topCardControlBg : "transparent",
                                                opacity: !item.origin || !item.destination ? 0.35 : pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons name="map-outline" size={21} color={primaryText} />
                                    </Pressable>
                                </View>
                            </View>
                            {routeProgressSegments.length > 0 && (
                                <View style={styles.routeProgressSection}>
                                    <TransitRouteProgressBar
                                        segments={routeProgressSegments}
                                        isDark={isDark}
                                        compact
                                    />
                                </View>
                            )}
                        </View>

                        {routeDetailInfo ? (
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
                        </View>
                    </ScrollView>
                </CalendarGlassSurface>
            </Animated.View>

            {mapCoords.length === 0 && (
                <View style={styles.emptyFloating}>
                    <Text style={styles.emptyMapText}>경로를 수정하면 지도가 표시돼요.</Text>
                </View>
            )}

            <ShareInvitationSheet
                visible={shareSheetVisible}
                resourceType="schedule"
                resourceId={item.id}
                title={item.title}
                subtitle={formatCompactScheduleRange(item.startAt, item.endAt, item.hasEndTime !== false)}
                accentColor={item.category.color}
                onClose={() => setShareSheetVisible(false)}
            />

        </View>
    );
}

const styles = StyleSheet.create({
    loadingScreen: {
        flex: 1,
    },
    container: { flex: 1 },
    fullMap: { flex: 1 },
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
    emptyFloating: {
        position: "absolute",
        left: 24,
        right: 24,
        bottom: 52,
        borderRadius: 18,
        paddingVertical: 16,
        paddingHorizontal: 18,
        backgroundColor: "rgba(16,17,20,0.86)",
        alignItems: "center",
    },
    emptyMapText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", textAlign: "center" },
});

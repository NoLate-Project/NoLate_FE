import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Easing, PanResponder, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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
import { buildSavedRouteDetailInfo } from "../../src/modules/schedule/savedRouteDetailPresentation";
import { buildTransitRouteProgressSegments } from "../../src/modules/schedule/transitRouteProgress";
import type { RouteStep } from "../../src/modules/schedule/routeInfo";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { ScheduleItem, TravelMode } from "../../src/modules/schedule/types";
import { setRoutePlannerInitial } from "../../src/modules/schedule/routePlannerSession";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { fromISO } from "../../lib/util/data";
import { createQaScheduleItem, QA_SCHEDULE_ID } from "../../src/modules/schedule/qaSamples";
import { getAuthMember } from "../../src/modules/auth/authStorage";
import {
    buildDepartureParticipantPresentations,
    getDepartureOverview,
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

function formatDepartureAssistText(item: ScheduleItem) {
    const chunks = [
        typeof item.travelMinutes === "number"
            ? `${travelModeLabel(item.travelMode)} ${item.travelMinutes}분`
            : travelModeLabel(item.travelMode),
        `${hhmmText(fromISO(item.startAt))} 일정 기준`,
    ];

    if (item.notificationEnabled && typeof item.notificationLeadMinutes === "number") {
        chunks.push(`${item.notificationLeadMinutes}분 전 알림 시작`);
    }

    return chunks.join(" · ");
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
    const { id, mode } = useLocalSearchParams<{ id?: string; mode?: string }>();
    const { state, dispatch } = useScheduleStore();

    useEffect(() => {
        if (id !== QA_SCHEDULE_ID || state.itemsById[QA_SCHEDULE_ID]) return;
        dispatch({ type: "UPDATE_ITEM", item: createQaScheduleItem() });
    }, [dispatch, id, state.itemsById]);

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
    const sheetStartOffsetRef = useRef(0);
    const [loading, setLoading] = useState(false);
    const {
        minHeight: sheetMinHeight,
        midHeight: sheetMidHeight,
        maxHeight: sheetMaxHeight,
    } = getScheduleDetailSheetHeights(windowHeight);
    const sheetCollapsedOffset = sheetMaxHeight - sheetMinHeight;
    const sheetMiddleOffset = sheetMaxHeight - sheetMidHeight;
    const sheetTranslateY = useRef(new Animated.Value(sheetMiddleOffset)).current;
    const [mapZoom, setMapZoom] = useState(DEFAULT_CAMERA.zoom);
    const [focusedLegIndex, setFocusedLegIndex] = useState<number | undefined>();
    const [selectedTransitStop, setSelectedTransitStop] = useState<{
        legIndex: number;
        stopIndex: number;
    }>();
    const [shareSheetVisible, setShareSheetVisible] = useState(false);
    const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
    const [departureActionPending, setDepartureActionPending] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const countdownTickAnim = useRef(new Animated.Value(1)).current;
    const previousCountdownKeyRef = useRef<string | undefined>(undefined);

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
    const countdownAnimationKey = departureDisplayState.kind === "countdown"
        ? `${departureDisplayState.hours}:${departureDisplayState.minutes}:${departureDisplayState.seconds}`
        : undefined;

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, DEPARTURE_COUNTDOWN_REFRESH_MS);

        return () => {
            clearInterval(intervalId);
        };
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

    useEffect(() => {
        if (!countdownAnimationKey) {
            previousCountdownKeyRef.current = undefined;
            countdownTickAnim.setValue(1);
            return;
        }
        if (previousCountdownKeyRef.current === undefined) {
            previousCountdownKeyRef.current = countdownAnimationKey;
            return;
        }
        if (previousCountdownKeyRef.current === countdownAnimationKey) return;

        previousCountdownKeyRef.current = countdownAnimationKey;
        countdownTickAnim.stopAnimation();
        countdownTickAnim.setValue(0.86);
        Animated.timing(countdownTickAnim, {
            toValue: 1,
            duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [countdownAnimationKey, countdownTickAnim]);

    const countdownAnimatedStyle = useMemo(() => ({
        opacity: countdownTickAnim,
    }), [countdownTickAnim]);
    const sheetQuickSummaryAnimatedStyle = useMemo(() => ({
        height: sheetTranslateY.interpolate({
            inputRange: [sheetMiddleOffset, sheetCollapsedOffset],
            outputRange: [0, 108],
            extrapolate: "clamp",
        }),
        opacity: sheetTranslateY.interpolate({
            inputRange: [sheetMiddleOffset, sheetCollapsedOffset],
            outputRange: [0, 1],
            extrapolate: "clamp",
        }),
    }), [sheetCollapsedOffset, sheetMiddleOffset, sheetTranslateY]);

    useEffect(() => {
        sheetTranslateY.stopAnimation((current) => {
            sheetTranslateY.setValue(clamp(current, 0, sheetCollapsedOffset));
        });
    }, [sheetCollapsedOffset, sheetTranslateY]);

    const getSheetSnapOffset = useCallback((current: number, velocityY: number) => {
        const projectedOffset = clamp(
            current + (velocityY * SHEET_SNAP_VELOCITY_PROJECTION),
            0,
            sheetCollapsedOffset
        );
        const snapPoints = [0, sheetMiddleOffset, sheetCollapsedOffset];

        return snapPoints.reduce((closest, point) => (
            Math.abs(point - projectedOffset) < Math.abs(closest - projectedOffset)
                ? point
                : closest
        ), sheetMiddleOffset);
    }, [sheetCollapsedOffset, sheetMiddleOffset]);

    const snapSheetToOffset = useCallback((nextOffset: number) => {
        Animated.spring(sheetTranslateY, {
            toValue: nextOffset,
            damping: 26,
            stiffness: 210,
            mass: 0.92,
            restDisplacementThreshold: 0.35,
            restSpeedThreshold: 0.35,
            useNativeDriver: true,
        }).start();
    }, [sheetTranslateY]);

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
                sheetTranslateY.setValue(clamp(sheetStartOffsetRef.current + gesture.dy, 0, sheetCollapsedOffset));
            },
            onPanResponderRelease: (_event, gesture) => {
                const currentOffset = clamp(sheetStartOffsetRef.current + gesture.dy, 0, sheetCollapsedOffset);
                snapSheetToOffset(getSheetSnapOffset(currentOffset, gesture.vy));
            },
            onPanResponderTerminate: (_event, gesture) => {
                const currentOffset = clamp(sheetStartOffsetRef.current + gesture.dy, 0, sheetCollapsedOffset);
                snapSheetToOffset(getSheetSnapOffset(currentOffset, gesture.vy));
            },
        }),
        [getSheetSnapOffset, sheetCollapsedOffset, sheetTranslateY, snapSheetToOffset]
    );

    useEffect(() => {
        if (!id) return;
        if (id === QA_SCHEDULE_ID) return;

        let cancelled = false;
        setLoading(true);
        getSchedule(id)
            .then((detail) => {
                if (!cancelled) dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                const routeFlowActive = pathname === "/schedule/route-select" || pathname === "/schedule/route-planner";
                if (!__DEV__ && !cancelled && !routeFlowActive) Alert.alert("일정 조회 실패", getErrorMessage(error));
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
        snapSheetToOffset(sheetCollapsedOffset);
        mapRef.current?.fitToCoordinates(legCoords, {
            edgePadding: {
                top: insets.top + 124,
                right: 44,
                bottom: sheetMinHeight + 28,
                left: 44,
            },
        });
    }, [insets.top, routeLegs, sheetCollapsedOffset, sheetMinHeight, snapSheetToOffset]);

    const focusTransitStop = useCallback((stop: { coord?: unknown }) => {
        const coord = mapCoordFromUnknown(stop.coord);
        if (!coord) return;

        snapSheetToOffset(sheetCollapsedOffset);
        mapRef.current?.animateCameraTo({
            ...coord,
            zoom: 17.2,
            duration: 420,
        });
    }, [sheetCollapsedOffset, snapSheetToOffset]);

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
                    bottom: sheetMidHeight + 28,
                    left: 44,
                },
            });
        }
    }, [insets.top, mapCoords, sheetMidHeight]);

    useEffect(() => {
        fitMap();
    }, [fitMap]);

    if (!item) {
        return (
            <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: insets.top + 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary }}>
                    {loading ? "일정을 불러오는 중이에요." : "일정을 찾을 수 없어요."}
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
    const sheetBorder = isDark ? "#343434" : "#E2E8F0";
    const primaryText = isDark ? "#F3F4F6" : "#111827";
    const secondaryText = isDark ? "#B8B8B8" : "#64748B";
    const topCardBorder = isDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)";
    const topCardControlBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.05)";
    const topCardAccentText = isDark ? "#78B4FF" : APP_ACCENT_BLUE;
    const topCardAccentBg = isDark ? "rgba(41,121,255,0.18)" : "rgba(41,121,255,0.10)";
    const departureStatusMuted = departureDisplayState.kind === "status" && departureDisplayState.tone === "disabled";
    const departureStatusAccent = departureCompleted
        ? (isDark ? "#86EFAC" : "#16A34A")
        : departureStatusMuted
            ? secondaryText
            : colors.selectedDayBg;
    const departureStatusIconBackground = departureCompleted
        ? (isDark ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.12)")
        : departureStatusMuted
            ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)")
            : (isDark ? "rgba(96,165,250,0.18)" : "rgba(37,99,235,0.10)");
    const participantPresentations = buildDepartureParticipantPresentations(departureParticipants, currentMemberId);
    const departureOverview = getDepartureOverview(departureParticipants, currentMemberId);
    const departedParticipantCount = departureOverview.departedCount;
    const scheduleScopeLabel = departureParticipants.length > 1
        ? `${departureParticipants.length}명 공유`
        : item.category.title;
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
    const collapsedRouteMeta = [
        routeDurationLabel,
        typeof routeOption?.transferCount === "number" ? `환승 ${routeOption.transferCount}회` : undefined,
    ].filter(Boolean).join(" · ");
    const departureActionTitle = departureCompleted
        ? "출발 알림 완료"
        : departureDisplayState.kind === "countdown"
            ? `출발까지 ${departureDisplayState.hours > 0 ? `${departureDisplayState.hours}시간 ` : ""}${departureDisplayState.minutes}분 ${pad2(departureDisplayState.seconds)}초`
            : departureStatusMuted
                ? "아직 출발 전이에요"
                : departureDisplayState.text;
    const departureActionMeta = recommendedDepartureAt
        ? `권장 출발 ${hhmmText(recommendedDepartureAt)}`
        : formatDepartureAssistText(item);
    const renderDepartureParticipantChips = () => {
        if (departureParticipants.length <= 1) return null;
        const hasHiddenParticipants = departureParticipants.length > 5;
        const visibleParticipants = hasHiddenParticipants
            ? participantPresentations.slice(0, 4)
            : participantPresentations.slice(0, 5);

        return (
            <View style={styles.departureParticipants}>
                {visibleParticipants.map((participant) => {
                    const departed = participant.departed;

                    return (
                        <View
                            key={`${participant.memberId}-${participant.role}`}
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
                {hasHiddenParticipants && (
                    <View style={styles.departureParticipantItem}>
                        <View
                            style={[
                                styles.departureParticipantMore,
                                { backgroundColor: isDark ? "rgba(255,255,255,0.075)" : "rgba(15,23,42,0.055)" },
                            ]}
                        >
                            <Text style={[styles.departureParticipantMoreText, { color: secondaryText }]}>
                                +{departureParticipants.length - 4}
                            </Text>
                        </View>
                        <Text style={[styles.departureParticipantName, { color: secondaryText }]}>더보기</Text>
                    </View>
                )}
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar hidden />
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

            <View style={[styles.topOverlay, { paddingTop: insets.top + 2 }]}>
                <CalendarGlassSurface
                    interactive
                    variant="mapCard"
                    tone="solidCard"
                    style={[styles.topHeaderGlass, { borderColor: topCardBorder }]}
                >
                    <View style={styles.topHeaderRow}>
                        <Pressable
                            onPress={() => router.replace("/schedule")}
                            accessibilityLabel="일정 목록으로 돌아가기"
                            style={({ pressed }) => [
                                styles.topHeaderIconButton,
                                {
                                    backgroundColor: topCardControlBg,
                                    borderColor: topCardBorder,
                                    opacity: pressed ? 0.58 : 1,
                                },
                            ]}
                        >
                            <Ionicons name="chevron-back" size={21} color={primaryText} />
                        </Pressable>

                        <View style={styles.topHeaderContent}>
                            <View style={styles.topHeaderTitleRow}>
                                <View style={[styles.topHeaderKindBadge, { backgroundColor: topCardAccentBg }]}>
                                    <Ionicons name="calendar-clear-outline" size={11} color={topCardAccentText} />
                                    <Text style={[styles.topHeaderKindText, { color: topCardAccentText }]}>일정</Text>
                                </View>
                                <Text style={[styles.topHeaderTitle, { color: primaryText }]} numberOfLines={1}>
                                    {item.title}
                                </Text>
                            </View>
                            <View style={styles.topHeaderRouteRow}>
                                <Ionicons name="navigate-outline" size={11} color={topCardAccentText} />
                                <Text style={[styles.topHeaderRoute, { color: primaryText }]} numberOfLines={1}>
                                    {routeTitle}
                                </Text>
                            </View>
                            <View style={styles.topHeaderMetaRow}>
                                <View style={styles.topHeaderScope}>
                                    <View style={[styles.topHeaderCategoryDot, { backgroundColor: item.category.color }]} />
                                    <Text style={[styles.topHeaderMetaText, { color: secondaryText }]} numberOfLines={1}>
                                        {scheduleScopeLabel}
                                    </Text>
                                </View>
                                <Text style={[styles.topHeaderMetaSeparator, { color: secondaryText }]}>·</Text>
                                <Text style={[styles.topHeaderMetaText, { color: secondaryText }]} numberOfLines={1}>
                                    {formatCompactScheduleRange(item.startAt, item.endAt, item.hasEndTime !== false)}
                                </Text>
                                <Text style={[styles.topHeaderMetaSeparator, { color: secondaryText }]}>·</Text>
                                <Text style={[styles.topHeaderMetaText, styles.topHeaderTravelMeta, { color: secondaryText }]} numberOfLines={1}>
                                    {travelText}
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
                                            backgroundColor: topCardControlBg,
                                            borderColor: topCardBorder,
                                            opacity: pressed ? 0.58 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons name="share-social-outline" size={17} color={primaryText} />
                                </Pressable>
                                <Pressable
                                    onPress={() => router.setParams({ mode: "edit" })}
                                    accessibilityLabel="일정 수정"
                                    style={({ pressed }) => [
                                        styles.topHeaderIconButton,
                                        {
                                            backgroundColor: topCardControlBg,
                                            borderColor: topCardBorder,
                                            opacity: pressed ? 0.58 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons name="create-outline" size={17} color={primaryText} />
                                </Pressable>
                            </View>
                        )}
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
                    variant="mapCard"
                    style={[
                        styles.routeSheetGlass,
                        {
                            paddingBottom: Math.max(insets.bottom, 14),
                            borderColor: sheetBorder,
                        },
                    ]}
                >
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            styles.routeSheetOpaqueBackdrop,
                            isDark
                                ? styles.routeSheetOpaqueBackdropDark
                                : styles.routeSheetOpaqueBackdropLight,
                        ]}
                    />
                    <View style={styles.sheetHandleHitArea} {...sheetPanResponder.panHandlers}>
                        <View style={[styles.sheetHandle, { backgroundColor: sheetBorder }]} />
                    </View>
                    <ScrollView
                        style={styles.sheetScroll}
                        contentContainerStyle={styles.sheetScrollContent}
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                    >
                        <Animated.View style={[styles.sheetQuickSummaryClip, sheetQuickSummaryAnimatedStyle]}>
                            <Pressable
                                onPress={() => snapSheetToOffset(sheetMiddleOffset)}
                                accessibilityRole="button"
                                accessibilityLabel="일정 상세 시트 펼치기"
                                style={({ pressed }) => [
                                    styles.sheetQuickSummary,
                                    { borderBottomColor: sheetBorder, opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <View style={styles.sheetQuickStat}>
                                    <Text style={[styles.sheetQuickLabel, { color: secondaryText }]}>출발 현황</Text>
                                    <Text style={[styles.sheetQuickValue, { color: departureStatusAccent }]}>
                                        {departureCountLabel}
                                    </Text>
                                    <Text style={[styles.sheetQuickAssist, { color: secondaryText }]} numberOfLines={1}>
                                        {departureOverview.movingLabel}
                                    </Text>
                                </View>
                                <View style={styles.sheetQuickStat}>
                                    <Text style={[styles.sheetQuickLabel, { color: secondaryText }]}>도착 예정</Text>
                                    <Text style={[styles.sheetQuickValue, { color: primaryText }]}>{arrivalTimeLabel}</Text>
                                    <Text style={[styles.sheetQuickAssist, { color: secondaryText }]} numberOfLines={1}>
                                        {collapsedRouteMeta}
                                    </Text>
                                </View>
                                <View
                                    style={[
                                        styles.sheetQuickExpand,
                                        { backgroundColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(15,23,42,0.06)" },
                                    ]}
                                >
                                    <Ionicons name="chevron-up" size={16} color={primaryText} />
                                </View>
                            </Pressable>
                        </Animated.View>

                        {(hasDepartureInfo || departureParticipants.length > 1) && (
                            <View style={[styles.sheetDepartureSection, { borderBottomColor: sheetBorder }]}>
                                <View style={styles.sheetSectionHeader}>
                                    <Text style={[styles.sheetSectionTitle, { color: primaryText }]}>출발 현황</Text>
                                    <Text
                                        style={[
                                            styles.sheetSectionCount,
                                            { color: departedParticipantCount > 0 ? departureStatusAccent : secondaryText },
                                        ]}
                                    >
                                        {departureCountLabel} 출발
                                    </Text>
                                </View>

                                {hasDepartureInfo && (
                                    <View
                                        style={[
                                            styles.sheetDepartureAction,
                                            {
                                                backgroundColor: isDark ? "rgba(255,255,255,0.055)" : "rgba(248,250,252,0.78)",
                                                borderColor: sheetBorder,
                                            },
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.sheetDepartureStatusIcon,
                                                { backgroundColor: departureStatusIconBackground },
                                            ]}
                                        >
                                            <Ionicons
                                                name={departureCompleted ? "checkmark" : "walk-outline"}
                                                size={16}
                                                color={departureStatusAccent}
                                            />
                                        </View>
                                        <View style={styles.sheetDepartureActionCopy}>
                                            <Animated.Text
                                                style={[
                                                    styles.sheetDepartureActionTitle,
                                                    { color: primaryText },
                                                    countdownAnimatedStyle,
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {departureActionTitle}
                                            </Animated.Text>
                                            <Text
                                                style={[styles.sheetDepartureActionMeta, { color: secondaryText }]}
                                                numberOfLines={1}
                                            >
                                                {departureActionMeta}
                                            </Text>
                                        </View>
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
                                            <Text
                                                style={[
                                                    styles.sheetDepartureActionButtonText,
                                                    { color: departureCompleted ? topCardAccentText : "#FFFFFF" },
                                                ]}
                                            >
                                                {departureCompleted ? "알림 완료" : departureActionPending ? "처리 중" : "출발 알리기"}
                                            </Text>
                                        </Pressable>
                                    </View>
                                )}

                                {renderDepartureParticipantChips()}
                            </View>
                        )}

                        <View style={styles.sheetRouteSummary}>
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
                                                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.05)",
                                                borderColor: sheetBorder,
                                                opacity: !item.origin || !item.destination ? 0.35 : pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons name="map-outline" size={21} color={primaryText} />
                                    </Pressable>
                                </View>
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

                        {!!routeDetailInfo && (
                            <View style={[styles.routeDetailDivider, { backgroundColor: sheetBorder }]} />
                        )}

                        {routeDetailInfo ? (
                            <>
                                <Text style={[styles.routeDetailBaseTimeText, { color: secondaryText }]}>
                                    {hhmmText(fromISO(routeDetailInfo.departureTime))} 기준
                                </Text>
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
    container: { flex: 1 },
    fullMap: { flex: 1 },
    topOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        zIndex: 30,
        elevation: 30,
    },
    topHeaderGlass: {
        minHeight: 96,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 8,
        overflow: "hidden",
    },
    topHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    topHeaderIconButton: {
        width: 36,
        height: 36,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
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
        gap: 7,
    },
    topHeaderKindBadge: {
        height: 20,
        borderRadius: 6,
        paddingHorizontal: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        flexShrink: 0,
    },
    topHeaderKindText: {
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "900",
        letterSpacing: 0,
    },
    topHeaderTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 19,
        fontWeight: "900",
        letterSpacing: 0,
    },
    topHeaderRouteRow: {
        minWidth: 0,
        marginTop: 3,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    topHeaderRoute: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    topHeaderMetaRow: {
        minWidth: 0,
        marginTop: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        overflow: "hidden",
    },
    topHeaderScope: {
        maxWidth: 70,
        flexShrink: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    topHeaderCategoryDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        flexShrink: 0,
    },
    topHeaderMetaText: {
        flexShrink: 1,
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    topHeaderMetaSeparator: {
        flexShrink: 0,
        fontSize: 9,
        lineHeight: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
    topHeaderTravelMeta: {
        maxWidth: 62,
    },
    topHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    departureParticipants: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 6,
    },
    departureParticipantItem: {
        flex: 1,
        minWidth: 0,
        maxWidth: 54,
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
    departureParticipantMore: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    departureParticipantMoreText: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "900",
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
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 18,
        borderTopWidth: 1,
        overflow: "hidden",
    },
    routeSheetOpaqueBackdrop: {
        opacity: 1,
    },
    routeSheetOpaqueBackdropDark: {
        backgroundColor: "#171A20",
    },
    routeSheetOpaqueBackdropLight: {
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
    sheetScrollContent: { paddingBottom: 24 },
    sheetQuickSummaryClip: {
        overflow: "hidden",
    },
    sheetQuickSummary: {
        minHeight: 108,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 2,
        paddingBottom: 9,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetQuickStat: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    sheetQuickLabel: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sheetQuickValue: {
        fontSize: 19,
        lineHeight: 24,
        fontWeight: "900",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
    sheetQuickAssist: {
        fontSize: 9,
        lineHeight: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetQuickExpand: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetDepartureSection: {
        gap: 10,
        paddingTop: 8,
        paddingBottom: 13,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetSectionHeader: {
        minHeight: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    sheetSectionTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetSectionCount: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetDepartureAction: {
        minHeight: 54,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    sheetDepartureStatusIcon: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetDepartureActionCopy: {
        flex: 1,
        minWidth: 0,
    },
    sheetDepartureActionTitle: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetDepartureActionMeta: {
        marginTop: 2,
        fontSize: 9,
        lineHeight: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sheetDepartureActionButton: {
        minWidth: 82,
        height: 34,
        borderRadius: 8,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetDepartureActionButtonText: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetRouteSummary: {
        paddingTop: 13,
    },
    sheetRouteTopRow: {
        flexDirection: "row",
        alignItems: "flex-end",
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
        fontSize: 20,
        lineHeight: 25,
        fontWeight: "900",
        letterSpacing: 0,
    },
    sheetRouteDuration: {
        fontSize: 28,
        lineHeight: 32,
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
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    routeProgressSection: {
        marginTop: 10,
    },
    routeDetailDivider: {
        height: StyleSheet.hairlineWidth,
        marginTop: 6,
        marginBottom: 8,
        opacity: 0.72,
    },
    routeDetailBaseTimeText: {
        fontSize: 13,
        fontWeight: "900",
        lineHeight: 18,
        paddingBottom: 5,
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

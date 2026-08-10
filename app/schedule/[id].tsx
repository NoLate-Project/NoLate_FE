import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    BackHandler,
    Easing,
    LayoutAnimation,
    Linking,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    UIManager,
    useWindowDimensions,
    View,
    type LayoutChangeEvent,
} from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getSchedule,
    getScheduleDepartureStatus,
    sendScheduleDepartureNudge,
    type ScheduleDepartureStatus,
} from "../../src/api/schedule";
import {
    getScheduleTravelPlan,
    upsertMyScheduleTravelPlan,
} from "../../src/api/scheduleTravelPlans";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { getUserVisibleScheduleNotes } from "../../src/modules/schedule/calendarImportNotes";
import PlainScheduleDetailView, {
    PLAIN_SCHEDULE_DETAIL_CONTENT_GAP,
    PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT,
} from "../../src/modules/schedule/components/detail/PlainScheduleDetailView";
import ScheduleArrivalObservationAction from "../../src/modules/schedule/components/detail/ScheduleArrivalObservationAction";
import ScheduleMemoSheet from "../../src/modules/schedule/components/detail/ScheduleMemoSheet";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { canEditPresentedSchedule } from "../../src/modules/schedule/schedulePermissions";
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
import { getTransitRouteSummaryAccessibilityLabel } from "../../src/modules/schedule/components/route/TransitRouteSummaryRow";
import {
    buildSavedRouteDetailInfo,
    getScheduleDetailLayout,
    getSavedRouteEntryPath,
    getSavedRouteSummaryKind,
    shouldRenderScheduleDetailMap,
} from "../../src/modules/schedule/savedRouteDetailPresentation";
import {
    buildTransitRouteProgressSegments,
    type TransitRouteProgressSegment,
} from "../../src/modules/schedule/transitRouteProgress";
import type { RouteStep } from "../../src/modules/schedule/routeInfo";
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
import { isRouteDetailEntryRequested } from "../../src/modules/schedule/routeDetailNavigation";
import { goBackFromScheduleDetail } from "../../src/modules/schedule/scheduleDetailNavigation";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { fromISO } from "../../lib/util/data";
import { getAuthMember } from "../../src/modules/auth/authStorage";
import { BrandedLoadingState } from "../../src/ui/BrandedLoader";
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
import { completeScheduleDeparture } from "../../src/modules/schedule/scheduleDepartureCompletion";
import { saveScheduleRouteAsMyTravelPlan } from "../../src/modules/schedule/scheduleTravelPlanSave";
import {
    buildEffectiveTransitRoutePresentation,
    resolveScheduleDetailDepartureTiming,
} from "../../src/modules/schedule/effectiveTransitRoutePresentation";

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
const IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT = 196;

function configureParticipantDisclosureAnimation(expanded: boolean) {
    LayoutAnimation.configureNext({
        duration: expanded ? 200 : 170,
        create: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
        update: {
            type: LayoutAnimation.Types.easeInEaseOut,
        },
        delete: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
        },
    });
}

function getDepartureRemainingLabel(state: DepartureDisplayState): string | undefined {
    if (state.kind !== "countdown") return undefined;

    const remainingMinutes = Math.max(
        1,
        (state.hours * 60) + state.minutes + (state.seconds > 0 ? 1 : 0)
    );
    if (remainingMinutes < 60) return `${remainingMinutes}분 남음`;

    const hours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    return minutes > 0
        ? `${hours}시간 ${minutes}분 남음`
        : `${hours}시간 남음`;
}

function CompactRouteProgressStrip({
    segments,
    isDark,
}: {
    segments: TransitRouteProgressSegment[];
    isDark: boolean;
}) {
    if (segments.length === 0) return null;

    const neutralColor = isDark ? "#7A8491" : "#A5AFBC";

    return (
        <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={getTransitRouteSummaryAccessibilityLabel(segments)}
            style={styles.compactRouteStrip}
        >
            {segments.map((segment, index) => (
                <View
                    key={`compact-strip-${segment.key}`}
                    style={[
                        styles.compactRouteStripSegment,
                        index > 0 && styles.compactRouteStripSpacing,
                        {
                            flex: segment.flex,
                            backgroundColor: segment.isRide ? segment.color : neutralColor,
                        },
                    ]}
                />
            ))}
        </View>
    );
}

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

type ScheduleDetailPreviewProps = {
    /** Internal QA only. Production routes always resolve the item from the schedule store. */
    previewItem?: ScheduleItem;
    initialSheetMode?: SheetSnapMode;
    initialParticipantsExpanded?: boolean;
    previewNowMs?: number;
    previewCurrentMemberId?: number;
};

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

export function ScheduleDetail({
    previewItem,
    initialSheetMode = "compact",
    initialParticipantsExpanded = false,
    previewNowMs,
    previewCurrentMemberId,
}: ScheduleDetailPreviewProps = {}) {
    const { id, openRouteSetup, openRouteDetail } = useLocalSearchParams<{
        id: string;
        openRouteSetup?: string | string[];
        openRouteDetail?: string | string[];
    }>();
    const pathname = usePathname();
    const router = useRouter();
    const goBack = useCallback(() => goBackFromScheduleDetail(router), [router]);
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const isDark = mode === "dark";
    const { state, dispatch } = useScheduleStore();
    const mapRef = useRef<TmapMapViewHandle>(null);
    const lastOverviewFitKeyRef = useRef<string | undefined>(undefined);
    const sheetScrollRef = useRef<ScrollView>(null);
    const sheetStartOffsetRef = useRef(0);
    const internalPreviewItem = typeof __DEV__ === "boolean" && __DEV__
        ? previewItem
        : undefined;
    const sheetSnapModeRef = useRef<SheetSnapMode>(
        internalPreviewItem ? initialSheetMode : "compact"
    );
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [departureStatus, setDepartureStatus] = useState<ScheduleDepartureStatus>();
    const [retryKey, setRetryKey] = useState(0);
    const baseSheetHeights = getScheduleDetailSheetHeights(windowHeight);
    const sheetMaxHeight = baseSheetHeights.maxHeight;
    const sheetMinHeight = Math.min(
        sheetMaxHeight - 1,
        Math.max(
            baseSheetHeights.minHeight,
            IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT + insets.bottom
        )
    );
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
    const sheetTranslateY = useRef(new Animated.Value(
        internalPreviewItem && initialSheetMode === "expanded"
            ? sheetExpandedOffset
            : sheetCollapsedOffset
    )).current;
    const [sheetMode, setSheetMode] = useState<SheetSnapMode>(
        internalPreviewItem ? initialSheetMode : "compact"
    );
    const [mapZoom, setMapZoom] = useState(DEFAULT_CAMERA.zoom);
    const [focusedLegIndex, setFocusedLegIndex] = useState<number | undefined>();
    const [selectedTransitStop, setSelectedTransitStop] = useState<{
        legIndex: number;
        stopIndex: number;
    }>();
    const [shareSheetVisible, setShareSheetVisible] = useState(false);
    const [memoSheetVisible, setMemoSheetVisible] = useState(false);
    const [currentMemberId, setCurrentMemberId] = useState<number | null>(() => (
        internalPreviewItem && typeof previewCurrentMemberId === "number"
            ? previewCurrentMemberId
            : null
    ));
    const [departureActionPending, setDepartureActionPending] = useState(false);
    const [departureNudgePendingMemberId, setDepartureNudgePendingMemberId] = useState<number>();
    const previewParticipantsExpanded = Boolean(internalPreviewItem && initialParticipantsExpanded);
    const [participantsExpanded, setParticipantsExpanded] = useState(previewParticipantsExpanded);
    const participantDisclosureProgress = useRef(
        new Animated.Value(previewParticipantsExpanded ? 1 : 0)
    ).current;
    const [nowMs, setNowMs] = useState(() => (
        internalPreviewItem && typeof previewNowMs === "number"
            ? previewNowMs
            : Date.now()
    ));
    const [previewDepartedAt, setPreviewDepartedAt] = useState<string>();
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
    const autoOpenedRouteDetailItemIdRef = useRef<string | undefined>(undefined);

    const item = internalPreviewItem ?? (id ? state.itemsById[id] : undefined);
    const canManageSchedule = useMemo(() => {
        if (!item) return false;
        if (typeof item.ownerMemberId !== "number") return true;
        return currentMemberId === item.ownerMemberId;
    }, [currentMemberId, item]);
    const canEditSchedule = canEditPresentedSchedule(item, canManageSchedule);
    const openScheduleEditor = useCallback(() => {
        if (internalPreviewItem) return;
        setMemoSheetVisible(false);
        requestAnimationFrame(() => {
            router.setParams({ mode: "edit" });
        });
    }, [internalPreviewItem, router]);
    const currentMemberDepartedAt = previewDepartedAt
        ?? item?.myDepartedAt
        ?? (canManageSchedule ? item?.departedAt : undefined);
    const departureParticipants = useMemo(() => {
        const participants = item?.departureParticipants ?? [];
        if (!previewDepartedAt || typeof currentMemberId !== "number") return participants;

        return participants.map((participant) => (
            participant.memberId === currentMemberId
                ? { ...participant, departed: true, departedAt: previewDepartedAt }
                : participant
        ));
    }, [currentMemberId, item?.departureParticipants, previewDepartedAt]);
    const savedRecommendedDepartureAt = useMemo(
        () => item ? getRecommendedDepartureAt(item) : undefined,
        [item]
    );
    const inspectedRecommendedDepartureAt = useMemo(() => {
        if (!inspectedTravelPlan) return undefined;
        if (inspectedTravelPlan.departAt) return fromISO(inspectedTravelPlan.departAt);
        if (typeof inspectedTravelPlan.travelMinutes !== "number" || !item) return undefined;
        return new Date(
            fromISO(item.startAt).getTime() - (inspectedTravelPlan.travelMinutes * MINUTE_MS),
        );
    }, [inspectedTravelPlan, item]);
    const displayedDepartureTiming = useMemo(
        () => resolveScheduleDetailDepartureTiming({
            status: departureStatus,
            savedRecommendedDepartureAt,
            savedTravelMinutes: item?.travelMinutes,
            isInspectingTravelPlan: Boolean(inspectedTravelPlan),
            inspectedRecommendedDepartureAt,
            inspectedTravelMinutes: inspectedTravelPlan?.travelMinutes,
        }),
        [
            departureStatus,
            inspectedRecommendedDepartureAt,
            inspectedTravelPlan,
            item?.travelMinutes,
            savedRecommendedDepartureAt,
        ],
    );
    const recommendedDepartureAt = displayedDepartureTiming.recommendedDepartureAt;
    const departureDisplayState: DepartureDisplayState = item
        ? getDepartureDisplayState(recommendedDepartureAt, item, nowMs, currentMemberDepartedAt)
        : { kind: "status", text: "", tone: "default" };

    useEffect(() => {
        if (internalPreviewItem) return undefined;
        const intervalId = setInterval(() => {
            setNowMs(Date.now());
        }, DEPARTURE_COUNTDOWN_REFRESH_MS);

        return () => {
            clearInterval(intervalId);
        };
    }, [internalPreviewItem]);

    useEffect(() => {
        if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

    useEffect(() => {
        currentLocationRequestGuardRef.current.invalidate();
        currentLocationPendingRef.current = false;
        setParticipantsExpanded(previewParticipantsExpanded);
        participantDisclosureProgress.setValue(previewParticipantsExpanded ? 1 : 0);
        setMemoSheetVisible(false);
        setExpandedContentHeight(0);
        setCurrentLocationCoord(undefined);
        setCurrentLocationPending(false);
        setInspectedTravelPlan(undefined);
        setTravelPlanDetailPendingMemberId(undefined);
        setDepartureNudgePendingMemberId(undefined);
        setPreviewDepartedAt(undefined);
        setDepartureStatus(undefined);
        autoOpenedRouteDetailItemIdRef.current = undefined;
    }, [id, participantDisclosureProgress, previewParticipantsExpanded]);

    useEffect(() => () => {
        currentLocationRequestGuardRef.current.invalidate();
    }, []);

    useEffect(() => {
        if (internalPreviewItem) return undefined;
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
    }, [internalPreviewItem]);

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
            participantDisclosureProgress.setValue(0);
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
    }, [participantDisclosureProgress, sheetCollapsedOffset, sheetExpandedOffset, sheetTranslateY]);

    const participantDisclosureAnimatedStyle = useMemo(() => ({
        transform: [{
            rotate: participantDisclosureProgress.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "180deg"],
            }),
        }],
    }), [participantDisclosureProgress]);

    const toggleParticipantsExpanded = useCallback(() => {
        const nextExpanded = !participantsExpanded;
        configureParticipantDisclosureAnimation(nextExpanded);
        participantDisclosureProgress.stopAnimation();
        Animated.timing(participantDisclosureProgress, {
            toValue: nextExpanded ? 1 : 0,
            duration: nextExpanded ? 200 : 170,
            easing: nextExpanded ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
            useNativeDriver: true,
        }).start();
        setParticipantsExpanded(nextExpanded);
    }, [participantDisclosureProgress, participantsExpanded]);

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
        if (internalPreviewItem) {
            setLoading(false);
            setLoadError(null);
            return undefined;
        }
        if (!id || routePlannerSessionId || routeSavePending) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        setDepartureStatus(undefined);

        getScheduleDepartureStatus(id)
            .then((status) => {
                if (!cancelled) setDepartureStatus(status);
            })
            .catch(() => {
                // ETA 상태는 보조 정보다. 실패해도 저장된 일정과 경로는 정상 표시한다.
                if (!cancelled) setDepartureStatus(undefined);
            });

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
    }, [dispatch, id, internalPreviewItem, pathname, retryKey, routePlannerSessionId, routeSavePending]);

    const displayRoute = inspectedTravelPlan?.route ?? item?.route;
    const displayOrigin = inspectedTravelPlan?.origin ?? item?.origin;
    const displayDestination = inspectedTravelPlan?.destination ?? item?.destination;
    const savedDisplayTravelMinutes = inspectedTravelPlan?.travelMinutes ?? item?.travelMinutes;
    const currentTravelMinutes = displayedDepartureTiming.travelMinutes;
    const displayTravelMode = inspectedTravelPlan?.travelMode ?? item?.travelMode;
    const displayDepartureAt = inspectedTravelPlan?.departAt
        ? fromISO(inspectedTravelPlan.departAt)
        : savedRecommendedDepartureAt;
    const effectiveTransitRoutePresentation = inspectedTravelPlan
        ? undefined
        : buildEffectiveTransitRoutePresentation(departureStatus);
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

    useEffect(() => {
        if (
            !item ||
            !isRouteDetailEntryRequested(openRouteDetail) ||
            autoOpenedRouteDetailItemIdRef.current === item.id ||
            (!routeDetailInfo && !savedDisplayTravelMinutes && item.routeSetupRequired !== true)
        ) return;

        // Notification/native alarm entry expands once after the route-backed sheet exists.
        // Keeping the one-shot marker prevents an offline action retry or a rerender from
        // repeatedly overriding the user's manual collapse gesture.
        autoOpenedRouteDetailItemIdRef.current = item.id;
        snapSheet("expanded");
    }, [item, openRouteDetail, routeDetailInfo, savedDisplayTravelMinutes, snapSheet]);

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
        if (departureActionPending) return;
        if (internalPreviewItem) {
            setPreviewDepartedAt(new Date(nowMs).toISOString());
            return;
        }
        if (!id) return;

        setDepartureActionPending(true);
        try {
            const completedAt = new Date().toISOString();
            const updated = await completeScheduleDeparture(id);
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
    }, [canManageSchedule, departureActionPending, dispatch, id, internalPreviewItem, item?.departureParticipants, nowMs]);

    const requestDepartureNudge = useCallback(async (targetMemberId: number, targetLabel: string) => {
        if (internalPreviewItem || !id || departureNudgePendingMemberId !== undefined) return;

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
    }, [departureNudgePendingMemberId, id, internalPreviewItem]);

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
        if (internalPreviewItem || !id || travelPlanDetailPendingMemberId !== undefined) return;
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
    }, [currentMemberId, id, internalPreviewItem, snapSheet, travelPlanDetailPendingMemberId]);

    const openCurrentRoutePlanner = useCallback(() => {
        if (internalPreviewItem || !item || routeSavePending) return;
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
    }, [internalPreviewItem, item, routeOption, routeSavePending, router]);

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
                        onPress={goBack}
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
    const routeIdentityTitle = displayOrigin?.name && displayDestination?.name
        ? `${displayOrigin.name} → ${displayDestination.name}`
        : routeTitle;
    const travelText = savedDisplayTravelMinutes
        ? `${travelModeLabel(displayTravelMode ?? undefined)} ${savedDisplayTravelMinutes}분`
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
    const arrivalTimeLabel = hhmmText(fromISO(item.startAt));
    const hasRenderableDetailedRoute = displayPathOverlays.some(
        (overlay) => overlay.coords.length >= 2
    );
    const routeSummaryKind = getSavedRouteSummaryKind(
        hasRenderableDetailedRoute,
        savedDisplayTravelMinutes ?? undefined
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
    const plainHeaderHeight = insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT;
    const showTopRouteBar = !isPlainSchedule;
    const notesText = getUserVisibleScheduleNotes(item.notes);
    const routeDetailMeta = [
        hasDetailedRoute
            ? effectiveTransitRoutePresentation
                ? "지도에 표시된 저장 경로"
                : `${arrivalTimeLabel} 도착`
            : routeSummaryKind === "duration_only"
                ? "예상 이동 시간만 저장됨"
                : "이동 경로 미설정",
        hasDetailedRoute && typeof routeOption?.transferCount === "number"
            ? `환승 ${routeOption.transferCount}회`
            : undefined,
    ].filter(Boolean).join(" · ");
    const routeSummaryTitle = hasDetailedRoute
        ? effectiveTransitRoutePresentation ? "저장한 경로" : "최적 경로"
        : routeSummaryKind === "duration_only"
            ? "상세 경로 미설정"
            : "저장된 경로 없음";
    const departureCountLabel = departureOverview.totalCount > 0
        ? `${departureOverview.departedCount}/${departureOverview.totalCount}`
        : departureCompleted
            ? "완료"
            : "대기";
    const currentRouteDurationLabel = hasRouteSummary
        ? typeof currentTravelMinutes === "number"
            ? `${currentTravelMinutes}분`
            : routeNumberText(routeOption)
        : "미설정";
    const routeDurationLabel = hasRouteSummary
        ? typeof savedDisplayTravelMinutes === "number"
            ? `${savedDisplayTravelMinutes}분`
            : routeNumberText(routeOption)
        : "미설정";
    const departureRemainingLabel = getDepartureRemainingLabel(departureDisplayState);
    const recommendedDepartureTimeLabel = recommendedDepartureAt
        ? hhmmText(recommendedDepartureAt)
        : departureDisplayState.kind === "status"
            ? departureDisplayState.text
            : scheduleCountdown.compactValue;
    const routeArrivalSummary = hasRouteSummary
        ? `${arrivalTimeLabel} 도착 · 총 ${currentRouteDurationLabel}`
        : scheduleRangeLabel;
    const routeWalkingMinutes = routeDetailInfo?.steps.reduce((total, step) => (
        step.type === "WALK" && typeof step.durationMinutes === "number"
            ? total + step.durationMinutes
            : total
    ), 0) ?? 0;
    const routeFactLabels = effectiveTransitRoutePresentation ? [] : [
        typeof routeDetailInfo?.transferCount === "number"
            ? `환승 ${routeDetailInfo.transferCount}회`
            : typeof routeOption?.transferCount === "number"
                ? `환승 ${routeOption.transferCount}회`
                : undefined,
        routeWalkingMinutes > 0 ? `도보 ${routeWalkingMinutes}분` : undefined,
        typeof routeDetailInfo?.fare === "number"
            ? `${routeDetailInfo.fare.toLocaleString()}원`
            : typeof routeOption?.fareWon === "number"
                ? `${routeOption.fareWon.toLocaleString()}원`
                : undefined,
    ].filter((label): label is string => Boolean(label));
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
                    const profile = (
                        <>
                            <View
                                style={[
                                    styles.departureParticipantAvatar,
                                    {
                                        backgroundColor: departed
                                            ? (isDark ? "rgba(34,197,94,0.22)" : "rgba(34,197,94,0.14)")
                                            : canNudge
                                                ? (isDark ? "rgba(41,121,255,0.24)" : "rgba(41,121,255,0.12)")
                                                : (isDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.07)"),
                                        borderColor: canNudge ? topCardAccentText : "transparent",
                                        borderWidth: canNudge ? 1 : 0,
                                    },
                                ]}
                            >
                                {nudgePending ? (
                                    <ActivityIndicator size="small" color={topCardAccentText} />
                                ) : (
                                    <Text
                                        style={[
                                            styles.departureParticipantAvatarText,
                                            {
                                                color: departed
                                                    ? (isDark ? "#BBF7D0" : "#166534")
                                                    : canNudge
                                                        ? topCardAccentText
                                                        : secondaryText,
                                            },
                                        ]}
                                    >
                                        {participant.avatarLabel}
                                    </Text>
                                )}
                                {departed && (
                                    <View style={styles.departureParticipantCheck}>
                                        <Ionicons name="checkmark" size={8} color="#FFFFFF" />
                                    </View>
                                )}
                                {canNudge && !nudgePending && (
                                    <View style={[styles.departureParticipantBell, { backgroundColor: topCardAccentText }]}>
                                        <Ionicons name="notifications" size={8} color="#FFFFFF" />
                                    </View>
                                )}
                            </View>
                            <View style={styles.departureParticipantCopy}>
                                <Text
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                    style={[styles.departureParticipantName, { color: primaryText }]}
                                >
                                    {participant.label}
                                </Text>
                                <Text
                                    numberOfLines={1}
                                    style={[
                                        styles.departureParticipantStatus,
                                        {
                                            color: departed
                                                ? (isDark ? "#86EFAC" : "#15803D")
                                                : canNudge
                                                    ? topCardAccentText
                                                    : secondaryText,
                                        },
                                    ]}
                                >
                                    {departed ? "출발 완료" : "대기 중"}
                                </Text>
                            </View>
                        </>
                    );

                    return canNudge ? (
                        <Pressable
                            key={`${participant.memberId}-${participant.role}`}
                            onPress={() => confirmDepartureNudge(participant.memberId, participant.label)}
                            disabled={departureNudgePendingMemberId !== undefined}
                            accessibilityRole="button"
                            accessibilityLabel={`${participant.label}, 대기 중, 출발 확인 알림 보내기`}
                            accessibilityHint="프로필을 누르면 해당 참가자의 기기로 출발 확인 푸시를 보냅니다."
                            accessibilityState={{
                                busy: nudgePending,
                                disabled: departureNudgePendingMemberId !== undefined,
                            }}
                            style={({ pressed }) => [
                                styles.departureParticipantItem,
                                {
                                    opacity: pressed
                                        ? 0.56
                                        : departureNudgePendingMemberId !== undefined && !nudgePending
                                            ? 0.42
                                            : 1,
                                },
                            ]}
                        >
                            {profile}
                        </Pressable>
                    ) : (
                        <View
                            key={`${participant.memberId}-${participant.role}`}
                            accessible
                            accessibilityLabel={`${participant.label}, ${departed ? "출발함" : "대기 중"}`}
                            style={styles.departureParticipantItem}
                        >
                            {profile}
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
                    contentTopInset={plainHeaderHeight + PLAIN_SCHEDULE_DETAIL_CONTENT_GAP}
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
                                        onPress={toggleParticipantsExpanded}
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
                                            <Animated.View style={participantDisclosureAnimatedStyle}>
                                                <Ionicons name="chevron-down" size={15} color={secondaryText} />
                                            </Animated.View>
                                        </View>
                                    </Pressable>
                                    {participantsExpanded ? renderTravelPlanRows() : null}
                                </View>
                            ) : undefined,
                        }
                        : undefined}
                    arrivalObservation={item.myDepartedAt ? (
                        <ScheduleArrivalObservationAction
                            scheduleId={item.id}
                            myDepartedAt={item.myDepartedAt}
                        />
                    ) : undefined}
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

            {!isPlainSchedule && notesText ? (
                <Pressable
                    testID="schedule-memo-trigger"
                    onPress={() => setMemoSheetVisible(true)}
                    accessibilityRole="button"
                    accessibilityLabel="일정 메모 보기"
                    accessibilityHint="메모 시트를 아래에서 엽니다"
                    style={({ pressed }) => [
                        styles.memoButton,
                        {
                            bottom: sheetMinHeight + 16,
                            backgroundColor: isDark ? "#20242C" : "#FFFFFF",
                            borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.12)",
                            opacity: pressed ? 0.72 : 1,
                        },
                    ]}
                >
                    <Ionicons name="document-text-outline" size={18} color={topCardAccentText} />
                    <Text style={[styles.memoButtonText, { color: primaryText }]}>메모</Text>
                    <Ionicons name="chevron-up" size={14} color={secondaryText} />
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
                            ...(isPlainSchedule ? { height: plainHeaderHeight } : null),
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
                            onPress={goBack}
                            accessibilityRole="button"
                            accessibilityLabel="이전 화면으로 돌아가기"
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

                        <View style={[
                            styles.topHeaderContent,
                            isPlainSchedule && styles.plainTopHeaderContent,
                        ]}>
                            <View style={[
                                styles.topHeaderTitleRow,
                                isPlainSchedule && styles.plainTopHeaderTitleRow,
                            ]}>
                                {!isPlainSchedule ? (
                                    <View style={styles.topHeaderKindBadge}>
                                        <Ionicons name="calendar-clear-outline" size={13} color={topCardAccentText} />
                                        <Text style={[styles.topHeaderKindText, { color: topCardAccentText }]}>일정</Text>
                                    </View>
                                ) : null}
                                <Text
                                    style={[
                                        styles.topHeaderTitle,
                                        isPlainSchedule && styles.plainTopHeaderTitle,
                                        { color: primaryText },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {isPlainSchedule ? "일정 상세" : item.title}
                                </Text>
                            </View>
                        </View>

                        {(canManageSchedule || canEditSchedule) && (
                            <View style={[
                                styles.topHeaderActions,
                                isPlainSchedule && styles.plainTopHeaderActions,
                            ]}>
                                {canManageSchedule ? (
                                    <Pressable
                                        onPress={() => {
                                            if (!internalPreviewItem) setShareSheetVisible(true);
                                        }}
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
                                        onPress={openScheduleEditor}
                                        accessibilityRole="button"
                                        accessibilityLabel="일정 수정"
                                        style={({ pressed }) => [
                                            styles.topHeaderIconButton,
                                            {
                                                backgroundColor: pressed
                                                    ? isPlainSchedule
                                                        ? isDark
                                                            ? "rgba(75,157,255,0.14)"
                                                            : "rgba(41,121,255,0.08)"
                                                        : topCardControlBg
                                                    : "transparent",
                                                opacity: pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons
                                            name={isPlainSchedule ? "pencil-outline" : "create-outline"}
                                            size={isPlainSchedule ? 19 : 20}
                                            color={isPlainSchedule ? topCardAccentText : primaryText}
                                        />
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
                            <View style={styles.improvedCompactSummary}>
                                <View style={styles.improvedRouteIdentityCompact}>
                                    <Pressable
                                        onPress={() => snapSheet("expanded")}
                                        accessibilityRole="button"
                                        accessibilityLabel={`일정 상세 시트 펼치기, ${routeIdentityTitle}`}
                                        style={({ pressed }) => [
                                            styles.improvedRouteIdentityMain,
                                            { opacity: pressed ? 0.62 : 1 },
                                        ]}
                                    >
                                        <Ionicons name="navigate-outline" size={15} color={topCardAccentText} />
                                        <Text
                                            numberOfLines={1}
                                            style={[styles.improvedRouteIdentityTitle, { color: primaryText }]}
                                        >
                                            {routeIdentityTitle}
                                        </Text>
                                    </Pressable>
                                    {hasDepartureInfo && (
                                        <Pressable
                                            onPress={completeDeparture}
                                            disabled={departureCompleted || departureActionPending}
                                            accessibilityRole="button"
                                            accessibilityLabel={departureCompleted ? "출발 완료" : "출발했어요"}
                                            accessibilityState={{
                                                selected: departureCompleted,
                                                busy: departureActionPending,
                                                disabled: departureCompleted || departureActionPending,
                                            }}
                                            style={({ pressed }) => [
                                                styles.improvedCompactDepartureAction,
                                                {
                                                    backgroundColor: departureCompleted
                                                        ? (isDark ? "rgba(41,121,255,0.20)" : "rgba(41,121,255,0.12)")
                                                        : APP_ACCENT_BLUE,
                                                    opacity: pressed || departureActionPending ? 0.64 : 1,
                                                },
                                            ]}
                                        >
                                            {departureActionPending ? (
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                            ) : (
                                                <Ionicons
                                                    name={departureCompleted ? "checkmark" : "navigate"}
                                                    size={14}
                                                    color={departureCompleted ? topCardAccentText : "#FFFFFF"}
                                                />
                                            )}
                                            <Text
                                                style={[
                                                    styles.improvedCompactDepartureActionText,
                                                    { color: departureCompleted ? topCardAccentText : "#FFFFFF" },
                                                ]}
                                            >
                                                {departureActionPending
                                                    ? "처리 중"
                                                    : departureCompleted ? "출발 완료" : "출발했어요"}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>

                                <Pressable
                                    onPress={() => snapSheet("expanded")}
                                    accessibilityRole="button"
                                    accessibilityLabel={[
                                        "일정 상세 시트 펼치기",
                                        `권장 출발 ${recommendedDepartureTimeLabel}`,
                                        departureRemainingLabel,
                                        routeArrivalSummary,
                                        effectiveTransitRoutePresentation
                                            ? `실시간 추천 경로, ${effectiveTransitRoutePresentation.itinerary}, ${effectiveTransitRoutePresentation.mapNote}`
                                            : undefined,
                                        ...routeFactLabels,
                                        routeProgressSegments.length > 0
                                            ? getTransitRouteSummaryAccessibilityLabel(routeProgressSegments)
                                            : undefined,
                                    ].filter(Boolean).join(", ")}
                                    style={({ pressed }) => [
                                        styles.improvedCompactBody,
                                        { opacity: pressed ? 0.72 : 1 },
                                    ]}
                                >
                                    <View style={styles.improvedCompactTopRow}>
                                        <View style={styles.improvedCompactTimeCopy}>
                                            <Text style={[styles.improvedDepartureEyebrow, { color: topCardAccentText }]}>권장 출발</Text>
                                            <View style={styles.improvedDepartureTimeRow}>
                                                <Text
                                                    numberOfLines={1}
                                                    adjustsFontSizeToFit
                                                    minimumFontScale={0.72}
                                                    style={[styles.improvedCompactDepartureTime, { color: primaryText }]}
                                                >
                                                    {recommendedDepartureTimeLabel}
                                                </Text>
                                                {departureRemainingLabel ? (
                                                    <View
                                                        style={[
                                                            styles.improvedRemainingChip,
                                                            {
                                                                backgroundColor: isDark
                                                                    ? "rgba(41,121,255,0.20)"
                                                                    : "rgba(41,121,255,0.10)",
                                                            },
                                                        ]}
                                                    >
                                                        <Text style={[styles.improvedRemainingChipText, { color: topCardAccentText }]}>
                                                            {departureRemainingLabel}
                                                        </Text>
                                                    </View>
                                                ) : null}
                                            </View>
                                        </View>
                                        <Ionicons name="chevron-up" size={18} color={secondaryText} />
                                    </View>
                                    <Text numberOfLines={1} style={[styles.improvedArrivalSummary, { color: secondaryText }]}>
                                        {routeArrivalSummary}
                                    </Text>
                                    {!effectiveTransitRoutePresentation ? (
                                        <CompactRouteProgressStrip segments={routeProgressSegments} isDark={isDark} />
                                    ) : null}
                                    {effectiveTransitRoutePresentation ? (
                                        <View style={styles.effectiveRouteCompactNotice}>
                                            <Ionicons name="swap-horizontal" size={14} color={topCardAccentText} />
                                            <Text
                                                numberOfLines={1}
                                                style={[styles.effectiveRouteCompactNoticeText, { color: topCardAccentText }]}
                                            >
                                                실시간 추천 경로 · {effectiveTransitRoutePresentation.itinerary}
                                            </Text>
                                        </View>
                                    ) : departureCompleted ? (
                                        <View style={styles.improvedDepartureSharedRow}>
                                            <Ionicons name="checkmark-circle" size={15} color={departureStatusAccent} />
                                            <Text style={[styles.improvedCompactFacts, { color: secondaryText }]}>출발 상태를 공유했어요</Text>
                                        </View>
                                    ) : routeFactLabels.length > 0 ? (
                                        <Text numberOfLines={1} style={[styles.improvedCompactFacts, { color: secondaryText }]}>
                                            {routeFactLabels.join(" · ")}
                                        </Text>
                                    ) : null}
                                </Pressable>
                            </View>
                        </Animated.View>

                        <View
                            onLayout={handleExpandedContentLayout}
                            pointerEvents={sheetMode === "expanded" ? "auto" : "none"}
                            accessibilityElementsHidden={sheetMode !== "expanded"}
                            importantForAccessibility={sheetMode === "expanded" ? "auto" : "no-hide-descendants"}
                            style={styles.sheetExpandedContent}
                        >
                        <View style={[styles.sheetStatusSection, { borderBottomColor: sheetBorder }]}>
                            <View style={styles.improvedExpandedHero}>
                                <View style={styles.improvedExpandedIdentityRow}>
                                    <View style={styles.improvedRouteIdentityExpanded}>
                                        <Ionicons name="navigate-outline" size={15} color={topCardAccentText} />
                                        <Text
                                            numberOfLines={1}
                                            style={[styles.improvedRouteIdentityTitle, { color: primaryText }]}
                                        >
                                            {routeIdentityTitle}
                                        </Text>
                                        <Text
                                            numberOfLines={1}
                                            style={[styles.improvedRouteIdentityMeta, { color: secondaryText }]}
                                        >
                                            {travelModeLabel(displayTravelMode ?? undefined)}
                                        </Text>
                                    </View>
                                    <Pressable
                                        testID="schedule-route-sheet-collapse"
                                        onPress={() => snapSheet("compact")}
                                        accessibilityRole="button"
                                        accessibilityLabel="일정 상세 시트 접기"
                                        accessibilityHint="접힌 경로 요약으로 전환합니다"
                                        style={({ pressed }) => [
                                            styles.improvedExpandedCollapseButton,
                                            { opacity: pressed ? 0.56 : 1 },
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.improvedExpandedCollapseButtonFace,
                                                { backgroundColor: topCardControlBg },
                                            ]}
                                        >
                                            <Ionicons name="chevron-down" size={16} color={secondaryText} />
                                        </View>
                                    </Pressable>
                                </View>

                                <View style={styles.improvedExpandedHeroMain}>
                                    <View style={styles.improvedExpandedHeroCopy}>
                                        <Text style={[styles.improvedDepartureEyebrow, { color: topCardAccentText }]}>권장 출발</Text>
                                        <View style={styles.improvedDepartureTimeRow}>
                                            <Text
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                minimumFontScale={0.72}
                                                style={[styles.improvedExpandedDepartureTime, { color: primaryText }]}
                                            >
                                                {recommendedDepartureTimeLabel}
                                            </Text>
                                            {departureRemainingLabel ? (
                                                <View
                                                    style={[
                                                        styles.improvedRemainingChip,
                                                        {
                                                            backgroundColor: isDark
                                                                ? "rgba(41,121,255,0.20)"
                                                                : "rgba(41,121,255,0.10)",
                                                        },
                                                    ]}
                                                >
                                                    <Text style={[styles.improvedRemainingChipText, { color: topCardAccentText }]}>
                                                        {departureRemainingLabel}
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                        <Text numberOfLines={1} style={[styles.improvedArrivalSummary, { color: secondaryText }]}>
                                            {routeArrivalSummary}
                                        </Text>
                                    </View>

                                    {hasDepartureInfo && (
                                        <Pressable
                                            onPress={completeDeparture}
                                            disabled={departureCompleted || departureActionPending}
                                            accessibilityRole="button"
                                            accessibilityLabel={departureCompleted ? "출발 완료" : "출발했어요"}
                                            accessibilityState={{
                                                selected: departureCompleted,
                                                busy: departureActionPending,
                                                disabled: departureCompleted || departureActionPending,
                                            }}
                                            style={({ pressed }) => [
                                                styles.improvedExpandedDepartureAction,
                                                {
                                                    backgroundColor: departureCompleted
                                                        ? (isDark ? "rgba(41,121,255,0.20)" : "rgba(41,121,255,0.12)")
                                                        : APP_ACCENT_BLUE,
                                                    opacity: pressed || departureActionPending ? 0.64 : 1,
                                                },
                                            ]}
                                        >
                                            {departureActionPending ? (
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                            ) : (
                                                <Ionicons
                                                    name={departureCompleted ? "checkmark" : "navigate"}
                                                    size={15}
                                                    color={departureCompleted ? topCardAccentText : "#FFFFFF"}
                                                />
                                            )}
                                            <Text
                                                style={[
                                                    styles.improvedExpandedDepartureActionText,
                                                    { color: departureCompleted ? topCardAccentText : "#FFFFFF" },
                                                ]}
                                            >
                                                {departureActionPending
                                                    ? "처리 중"
                                                    : departureCompleted ? "출발 완료" : "출발했어요"}
                                            </Text>
                                        </Pressable>
                                    )}
                                </View>

                                {routeFactLabels.length > 0 ? (
                                    <View style={styles.improvedRouteFacts}>
                                        {routeFactLabels.map((label, index) => (
                                            <React.Fragment key={label}>
                                                {index > 0 ? (
                                                    <View style={[styles.improvedRouteFactDivider, { backgroundColor: sheetBorder }]} />
                                                ) : null}
                                                <Text style={[styles.improvedRouteFactText, { color: secondaryText }]}>
                                                    {label}
                                                </Text>
                                            </React.Fragment>
                                        ))}
                                    </View>
                                ) : null}

                                {item.myDepartedAt ? (
                                    <ScheduleArrivalObservationAction
                                        scheduleId={item.id}
                                        myDepartedAt={item.myDepartedAt}
                                        compact
                                    />
                                ) : null}
                            </View>

                            {departureParticipants.length > 1 && (
                                <View style={[styles.sheetSharedPeopleSection, { borderTopColor: sheetBorder }]}>
                                    <Pressable
                                        onPress={toggleParticipantsExpanded}
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded: participantsExpanded }}
                                        accessibilityLabel={`함께하는 사람 ${departureParticipants.length}명, ${departureCountLabel} 출발, 참여자 목록 ${participantsExpanded ? "접기" : "보기"}`}
                                        style={({ pressed }) => [
                                            styles.sheetParticipantDisclosure,
                                            { opacity: pressed ? 0.56 : 1 },
                                        ]}
                                    >
                                        <View style={styles.sheetParticipantDisclosureTitle}>
                                            <Ionicons name="people-outline" size={16} color={secondaryText} />
                                            <Text style={[styles.sheetSectionTitle, { color: primaryText }]}>
                                                함께하는 사람 {departureParticipants.length}
                                            </Text>
                                        </View>
                                        <View style={styles.sheetParticipantDisclosureSummary}>
                                            <Text
                                                numberOfLines={1}
                                                style={[styles.sheetParticipantSummary, { color: secondaryText }]}
                                            >
                                                {departureCountLabel} 출발
                                            </Text>
                                            <Animated.View style={participantDisclosureAnimatedStyle}>
                                                <Ionicons name="chevron-down" size={14} color={secondaryText} />
                                            </Animated.View>
                                        </View>
                                    </Pressable>
                                    {participantsExpanded ? (
                                        <View style={styles.sheetParticipantExpandedContent}>
                                            {renderDepartureParticipantChips()}
                                            {renderTravelPlanRows()}
                                        </View>
                                    ) : null}
                                </View>
                            )}
                        </View>

                        {effectiveTransitRoutePresentation ? (
                            <View
                                accessible
                                accessibilityRole="summary"
                                accessibilityLabel={`실시간 추천 경로, ${effectiveTransitRoutePresentation.summary}, ${effectiveTransitRoutePresentation.itinerary}, ${effectiveTransitRoutePresentation.mapNote}`}
                                style={[
                                    styles.effectiveRouteCard,
                                    isDark
                                        ? styles.effectiveRouteCardDark
                                        : styles.effectiveRouteCardLight,
                                ]}
                            >
                                <View style={styles.effectiveRouteCardHeader}>
                                    <View style={styles.effectiveRouteCardTitleRow}>
                                        <View
                                            style={[
                                                styles.effectiveRouteCardIcon,
                                                isDark
                                                    ? styles.effectiveRouteCardIconDark
                                                    : styles.effectiveRouteCardIconLight,
                                            ]}
                                        >
                                            <Ionicons name="swap-horizontal" size={15} color={topCardAccentText} />
                                        </View>
                                        <Text style={[styles.effectiveRouteCardTitle, { color: primaryText }]}>실시간 추천 경로</Text>
                                    </View>
                                    {effectiveTransitRoutePresentation.summary ? (
                                        <Text style={[styles.effectiveRouteCardSummary, { color: topCardAccentText }]}>
                                            {effectiveTransitRoutePresentation.summary}
                                        </Text>
                                    ) : null}
                                </View>
                                <Text
                                    numberOfLines={3}
                                    style={[styles.effectiveRouteCardItinerary, { color: primaryText }]}
                                >
                                    {effectiveTransitRoutePresentation.itinerary}
                                </Text>
                                <View style={styles.effectiveRouteMapNoteRow}>
                                    <Ionicons name="map-outline" size={13} color={secondaryText} />
                                    <Text style={[styles.effectiveRouteMapNote, { color: secondaryText }]}>
                                        {effectiveTransitRoutePresentation.mapNote}
                                    </Text>
                                </View>
                            </View>
                        ) : null}

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
                                    {hasDetailedRoute ? (
                                        <View style={styles.sheetRouteTitleRow}>
                                            <View
                                                style={[
                                                    styles.sheetRouteLiveDot,
                                                    styles.sheetRouteLiveDotActive,
                                                ]}
                                            />
                                            <Text
                                                style={[
                                                    styles.sheetRouteTitle,
                                                    styles.sheetRouteTitleInline,
                                                    { color: primaryText },
                                                ]}
                                            >
                                                {routeSummaryTitle}
                                            </Text>
                                        </View>
                                    ) : (
                                        <>
                                            <View style={styles.sheetRouteKickerRow}>
                                                <View
                                                    style={[
                                                        styles.sheetRouteLiveDot,
                                                        { backgroundColor: secondaryText },
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
                                        </>
                                    )}
                                </View>
                                {(!hasDetailedRoute || !inspectedTravelPlan) ? (
                                    <View style={styles.sheetRouteActions}>
                                        {!hasDetailedRoute ? (
                                            <Text style={[styles.sheetRouteDuration, { color: primaryText }]}>
                                                {routeDurationLabel}
                                            </Text>
                                        ) : null}
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
                                ) : null}
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
                                    {inspectedTravelPlan ? (
                                        <Text style={[styles.routeDetailBaseTimeText, { color: secondaryText }]}>
                                            {hhmmText(fromISO(routeDetailInfo.departureTime))} 출발 기준
                                        </Text>
                                    ) : null}
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
                                    realtimeArrivalsEnabled={!internalPreviewItem}
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

            <ScheduleMemoSheet
                visible={!isPlainSchedule && memoSheetVisible && Boolean(notesText)}
                title={item.title}
                notes={notesText ?? ""}
                bottomInset={insets.bottom}
                onEdit={canEditSchedule ? openScheduleEditor : undefined}
                onClose={() => setMemoSheetVisible(false)}
            />

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
    memoButton: {
        position: "absolute",
        left: 16,
        zIndex: 20,
        elevation: 18,
        height: 44,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
    },
    memoButtonText: {
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
        minHeight: 0,
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
    plainTopHeaderContent: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 88,
        right: 88,
        alignItems: "center",
        justifyContent: "center",
    },
    topHeaderTitleRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    plainTopHeaderTitleRow: {
        width: "100%",
        justifyContent: "center",
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
    plainTopHeaderTitle: {
        textAlign: "center",
        fontWeight: "700",
    },
    topHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
    },
    plainTopHeaderActions: {
        marginLeft: "auto",
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
        alignItems: "center",
        columnGap: 10,
        rowGap: 12,
        paddingTop: 10,
        paddingBottom: 5,
    },
    departureParticipantItem: {
        minHeight: 44,
        flexBasis: 96,
        flexGrow: 1,
        flexShrink: 0,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    departureParticipantAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
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
    departureParticipantBell: {
        position: "absolute",
        right: -3,
        bottom: -2,
        width: 14,
        height: 14,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    departureParticipantCopy: {
        flex: 1,
        minWidth: 0,
    },
    departureParticipantName: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: -0.1,
    },
    departureParticipantStatus: {
        marginTop: 1,
        fontSize: 9,
        lineHeight: 13,
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
    improvedCompactSummary: {
        minHeight: IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT - SHEET_HANDLE_HEIGHT,
        paddingHorizontal: 1,
    },
    improvedRouteIdentityCompact: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    improvedRouteIdentityMain: {
        flex: 1,
        minWidth: 0,
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    improvedRouteIdentityExpanded: {
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    improvedExpandedIdentityRow: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    improvedExpandedCollapseButton: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    improvedExpandedCollapseButtonFace: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    improvedRouteIdentityTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    improvedRouteIdentityMeta: {
        flexShrink: 0,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    improvedCompactDepartureAction: {
        height: 38,
        paddingHorizontal: 11,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    improvedCompactDepartureActionText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    improvedCompactBody: {
        flex: 1,
        minHeight: 120,
        paddingBottom: 8,
    },
    improvedCompactTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    improvedCompactTimeCopy: {
        flex: 1,
        minWidth: 0,
    },
    improvedDepartureEyebrow: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    improvedDepartureTimeRow: {
        minWidth: 0,
        marginTop: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    improvedCompactDepartureTime: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 25,
        lineHeight: 31,
        fontWeight: "900",
        letterSpacing: -0.5,
        fontVariant: ["tabular-nums"],
    },
    improvedExpandedDepartureTime: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 28,
        lineHeight: 34,
        fontWeight: "900",
        letterSpacing: -0.6,
        fontVariant: ["tabular-nums"],
    },
    improvedRemainingChip: {
        minHeight: 25,
        paddingHorizontal: 9,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
    },
    improvedRemainingChipText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    improvedArrivalSummary: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
        letterSpacing: 0,
    },
    compactRouteStrip: {
        width: "100%",
        height: 6,
        marginTop: 12,
        borderRadius: 3,
        flexDirection: "row",
        overflow: "hidden",
    },
    compactRouteStripSegment: {
        height: 6,
        minWidth: 3,
        borderRadius: 3,
    },
    compactRouteStripSpacing: {
        marginLeft: 2,
    },
    improvedCompactFacts: {
        marginTop: 8,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    effectiveRouteCompactNotice: {
        minWidth: 0,
        marginTop: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    effectiveRouteCompactNoticeText: {
        flex: 1,
        minWidth: 0,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    improvedDepartureSharedRow: {
        marginTop: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    improvedExpandedHero: {
        paddingBottom: 6,
    },
    improvedExpandedHeroMain: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    improvedExpandedHeroCopy: {
        flex: 1,
        minWidth: 0,
    },
    improvedExpandedDepartureAction: {
        minWidth: 100,
        height: 44,
        paddingHorizontal: 13,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    improvedExpandedDepartureActionText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    improvedRouteFacts: {
        marginTop: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    improvedRouteFactDivider: {
        width: 1,
        height: 11,
    },
    improvedRouteFactText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    effectiveRouteCard: {
        marginTop: 10,
        marginBottom: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        paddingHorizontal: 13,
        paddingVertical: 12,
    },
    effectiveRouteCardDark: {
        backgroundColor: "rgba(41,121,255,0.12)",
        borderColor: "rgba(120,180,255,0.28)",
    },
    effectiveRouteCardLight: {
        backgroundColor: "rgba(41,121,255,0.07)",
        borderColor: "rgba(41,121,255,0.20)",
    },
    effectiveRouteCardHeader: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    effectiveRouteCardTitleRow: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    effectiveRouteCardIcon: {
        width: 28,
        height: 28,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    effectiveRouteCardIconDark: {
        backgroundColor: "rgba(41,121,255,0.22)",
    },
    effectiveRouteCardIconLight: {
        backgroundColor: "rgba(41,121,255,0.12)",
    },
    effectiveRouteCardTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        letterSpacing: -0.1,
    },
    effectiveRouteCardSummary: {
        flexShrink: 1,
        maxWidth: "56%",
        textAlign: "right",
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    effectiveRouteCardItinerary: {
        marginTop: 9,
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "700",
        letterSpacing: 0,
    },
    effectiveRouteMapNoteRow: {
        minWidth: 0,
        marginTop: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    effectiveRouteMapNote: {
        flex: 1,
        minWidth: 0,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "600",
        letterSpacing: 0,
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
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "800",
        letterSpacing: -0.1,
    },
    sheetSharedPeopleSection: {
        width: "100%",
        marginTop: 6,
        paddingTop: 5,
        paddingBottom: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    sheetParticipantDisclosure: {
        width: "100%",
        minHeight: 44,
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
    sheetParticipantExpandedContent: {
        overflow: "hidden",
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
    sheetRouteTitleRow: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    sheetRouteLiveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    sheetRouteLiveDotActive: {
        backgroundColor: "#22C55E",
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
    sheetRouteTitleInline: {
        marginTop: 0,
        fontSize: 16,
        lineHeight: 22,
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

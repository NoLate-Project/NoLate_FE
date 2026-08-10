import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Alert,
    Animated,
    BackHandler,
    Easing,
    Keyboard,
    LayoutAnimation,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    StatusBar,
    Text,
    TextInput,
    UIManager,
    View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createFavoritePlaceCategoryToApi,
    deleteFavoritePlaceFromApi,
    getFavoritePlaceCategoriesFromApi,
    getFavoritePlacesFromApi,
    saveFavoritePlaceToApi,
    type FavoritePlace,
    type FavoritePlaceCategory,
} from "../../src/api/favoritePlaces";
import { getCurrentLocation, getCurrentLocationPermissionState } from "../../src/modules/map/currentLocation";
import { createLatestRequestGuard } from "../../src/modules/map/routeAsyncGuard";
import TmapMapView, { type TmapMarker } from "../../src/modules/map/TmapMapView";
import {
    getRouteAlternativeOptions,
    invalidateRouteSearch,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    shouldShowRequiredMapAttribution,
    type PlaceSearchItem,
    type RouteAlternativeOption,
} from "../../src/modules/map/routingService";
import {
    getRoutePlannerInitial,
    setRoutePlannerInitial,
    setRoutePlannerResult,
    type RoutePlannerPayload,
} from "../../src/modules/schedule/routePlannerSession";
import {
    clearFavoriteDeparturePlaces,
    getFavoriteDeparturePlace,
    getRecentRoutePlaces,
    removeRecentRoutePlace,
    saveFavoriteDepartureFavorite,
    saveFavoriteDeparturePlace,
    saveRecentRoutePlace,
} from "../../src/modules/schedule/favoriteDeparture";
import {
    buildFavoritePlaceTabs,
    DEFAULT_ADDRESS_FAVORITE_TAB_ID,
    excludeFavoritePlacesFromRecents,
    findMatchingFavoritePlace,
    findMatchingFavoritePlaces,
    getFavoritePlaceCategoryDisplayName,
    getFavoritePlaceCategoryColor,
    isReservedFavoritePlaceCategoryName,
    mergeLoadedFavoritePlaces,
    resolveManagedDefaultOriginSync,
    selectFavoritePlacesByTab,
    upsertFavoritePlace,
} from "../../src/modules/schedule/favoritePlaceSelection";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import {
    resolveScheduleRouteDepartureContext,
    resolveSelectedRouteTiming,
} from "../../src/modules/schedule/scheduleRouteTiming";
import {
    createMapPickerSessionState,
    resolveMapPickerCommit,
    resolveMapPickerPostCommitTransition,
    resolveDefaultOriginUiUpdate,
    resolveInitialRoutePointTarget,
    resolveNextMissingRoutePointTarget,
    selectMapPickerSessionCoordinate,
    shouldShowRoutePointSearchResults,
    type MapPickerSessionState,
    type RoutePointTarget,
} from "../../src/modules/schedule/routePointSelection";
import {
    buildRouteInfoFromAlternative,
    compactTransitLineLabel as compactSharedTransitLineLabel,
    formatRouteDuration as formatRouteInfoDuration,
    getBusLineColor as getSharedBusLineColor,
    getSubwayLineColor as getSharedSubwayLineColor,
} from "../../src/modules/schedule/routeInfo";
import {
    getNaverLikeRouteRecommendationLabel,
    getNaverLikeRoutePriority,
    getNaverLikeRouteTransferCount,
    getNaverLikeRouteWalkMinutes,
    selectNaverLikeRouteAlternatives,
} from "../../src/modules/schedule/routeAlternativeRanking";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import MapPickerTargetActions from "../../src/modules/schedule/components/route/MapPickerTargetActions";
import RouteEndpointReselectCard from "../../src/modules/schedule/components/route/RouteEndpointReselectCard";
import TransitRouteProgressBar from "../../src/modules/schedule/components/route/TransitRouteProgressBar";
import BrandedLoader from "../../src/ui/BrandedLoader";
import {
    primeRouteDetailAdvertising,
    showRouteDetailInterstitialIfEligible,
} from "../../src/modules/advertising/routeDetailInterstitial";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];
const MAP_PICKER_FALLBACK_LAT = 37.5665;
const MAP_PICKER_FALLBACK_LNG = 126.978;
const MAP_PICKER_DEFAULT_ZOOM = 14;

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

type TransitRouteFilter = "ALL" | "SUBWAY" | "BUS" | "MIXED";
type RouteSelectTransitLeg = NonNullable<RouteAlternativeOption["transitLegs"]>[number];
type RouteProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    minutes: number;
    color: string;
    kind: RouteSelectTransitLeg["kind"] | "TRANSFER";
    flex: number;
    isRide: boolean;
};
type RouteMetricChip = {
    key: string;
    label: string;
};
type RouteDropdownSummaryKind = RouteSelectTransitLeg["kind"] | "TRANSFER";
type RouteDropdownSummaryItem = {
    key: string;
    kind: RouteDropdownSummaryKind;
    color?: string;
    title: string;
    subtitle?: string;
};
type PlaceListIconName = React.ComponentProps<typeof Ionicons>["name"];
type PlaceIconSource = {
    name?: string;
    address?: string;
    category?: string;
};
type AnimatedTravelModeButtonProps = {
    selected: boolean;
    label: string;
    iconName: React.ComponentProps<typeof Ionicons>["name"];
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    onPress: () => void;
};
type AnimatedTransitFilterButtonProps = {
    selected: boolean;
    disabled: boolean;
    label: string;
    textColor: string;
    accentColor: string;
    onPress: () => void;
};
type AnimatedRouteCardShellProps = {
    selected: boolean;
    style: StyleProp<ViewStyle>;
    children: React.ReactNode;
};
type AnimatedRouteExpansionProps = {
    children: React.ReactNode;
    style: StyleProp<ViewStyle>;
};

const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "BUS", label: "버스" },
    { key: "SUBWAY", label: "지하철" },
    { key: "MIXED", label: "버스+지하철" },
];
const FAVORITE_CATEGORY_COLORS = [
    "#4B9DFF",
    "#22C55E",
    "#F0524C",
    "#F59E0B",
    "#A855F7",
    "#14B8A6",
    "#64748B",
];
const ROUTE_SEGMENT_FALLBACK_COLORS = {
    walk: "#9CA3AF",
    bus: "#2979FF",
    subway: "#00B140",
    etc: "#7C8794",
};

const TRAVEL_MODE_ICONS: Partial<Record<TravelMode, React.ComponentProps<typeof Ionicons>["name"]>> = {
    CAR: "car",
    TRANSIT: "bus",
    WALK: "walk",
    BIKE: "bicycle",
};
function useSelectedSpring(selected: boolean) {
    const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        Animated.spring(progress, {
            toValue: selected ? 1 : 0,
            friction: 8,
            tension: 120,
            useNativeDriver: true,
        }).start();
    }, [progress, selected]);

    return progress;
}

function AnimatedTravelModeButton({
    selected,
    label,
    iconName,
    backgroundColor,
    borderColor,
    textColor,
    onPress,
}: AnimatedTravelModeButtonProps) {
    const progress = useSelectedSpring(selected);
    const scale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.018],
    });

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            style={[styles.modeButtonShell, selected && styles.modeButtonShellSelected]}
        >
            <Animated.View
                style={[
                    styles.modeButton,
                    selected ? styles.modeButtonSelected : styles.modeButtonIconOnly,
                    {
                        backgroundColor,
                        borderColor,
                        transform: [{ scale }],
                    },
                ]}
            >
                <Ionicons name={iconName} size={selected ? 22 : 24} color={textColor} />
            </Animated.View>
        </Pressable>
    );
}

function AnimatedTransitFilterButton({
    selected,
    disabled,
    label,
    textColor,
    accentColor,
    onPress,
}: AnimatedTransitFilterButtonProps) {
    const progress = useSelectedSpring(selected);
    const indicatorScale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.32, 1],
    });

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${label} 경로 필터`}
            accessibilityState={{ selected, disabled }}
            style={[
                styles.transitFilterTab,
                {
                    opacity: disabled ? 0.38 : 1,
                    borderColor: "transparent",
                    backgroundColor: "transparent",
                },
            ]}
        >
            <Text style={[styles.transitFilterText, { color: textColor }]}>
                {label}
            </Text>
            <Animated.View
                style={[
                    styles.transitFilterIndicator,
                    {
                        backgroundColor: accentColor,
                        opacity: progress,
                        transform: [{ scaleX: indicatorScale }],
                    },
                ]}
            />
        </Pressable>
    );
}

function AnimatedRouteCardShell({ selected, style, children }: AnimatedRouteCardShellProps) {
    const progress = useSelectedSpring(selected);
    const scale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.997, 1],
    });

    return (
        <Animated.View style={[style, { transform: [{ scale }] }]}>
            {children}
        </Animated.View>
    );
}

function AnimatedRouteExpansion({ children, style }: AnimatedRouteExpansionProps) {
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(progress, {
            toValue: 1,
            duration: 190,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [progress]);

    const translateY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-4, 0],
    });

    return (
        <Animated.View
            style={[
                style,
                {
                    opacity: progress,
                    transform: [{ translateY }],
                },
            ]}
        >
            {children}
        </Animated.View>
    );
}

function FavoriteFilterSelectionIndicator({
    selected,
    color,
    reduceMotionEnabled,
}: {
    selected: boolean;
    color: string;
    reduceMotionEnabled: boolean;
}) {
    const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;

    useEffect(() => {
        progress.stopAnimation();
        if (reduceMotionEnabled) {
            progress.setValue(selected ? 1 : 0);
            return;
        }
        const animation = Animated.timing(progress, {
            toValue: selected ? 1 : 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [progress, reduceMotionEnabled, selected]);

    return (
        <Animated.View
            pointerEvents="none"
            style={[
                styles.favoriteFilterIndicator,
                {
                    backgroundColor: color,
                    opacity: progress,
                    transform: [{
                        scaleX: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.35, 1],
                        }),
                    }],
                },
            ]}
        />
    );
}

function configureRouteExpansionAnimation(duration = 210) {
    LayoutAnimation.configureNext({
        duration,
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

// 미터 단위 거리를 m/km 화면 문자열로 바꾼다.
function formatDistance(distanceMeters?: number): string | undefined {
    if (typeof distanceMeters !== "number") return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}

function formatSearchResultDistance(distanceMeters?: number): string | undefined {
    const formatted = formatDistance(distanceMeters);
    return formatted ? `기준점에서 ${formatted}` : undefined;
}

// 카드에서 쓰는 오전/오후 시간 문자열을 만든다.
function formatRouteClock(date: Date): string {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "오전" : "오후";
    const displayHour = hours % 12 || 12;
    return `${period} ${displayHour}:${minutes}`;
}

function formatCurrentRouteNoticeTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function formatScheduleRouteNoticeTime(date: Date): string {
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${formatRouteClock(date)}`;
}

// 경로 카드의 출발-도착 시간과 요금을 한 줄로 만든다.
function formatRouteTimeFare(option: RouteAlternativeOption, departureAt: Date): string | undefined {
    const chunks: string[] = [];
    if (typeof option.minutes === "number") {
        const arrivalAt = new Date(departureAt.getTime() + Math.max(0, option.minutes) * 60 * 1000);
        chunks.push(`${formatRouteClock(arrivalAt)} 예상 도착`);
    }
    if (typeof option.fareWon === "number") chunks.push(`${option.fareWon.toLocaleString()}원`);
    return chunks.length ? chunks.join(" · ") : undefined;
}

// 대중교통 필터 탭에 표시할 경로 개수를 계산한다.
function getTransitFilterCount(options: RouteAlternativeOption[], filter: TransitRouteFilter): number {
    return selectNaverLikeRouteAlternatives(options, "TRANSIT", filter).length;
}

function getRouteDisplayPriority(option: RouteAlternativeOption, mode: TravelMode): number {
    return getNaverLikeRoutePriority(option, mode);
}

function sortRouteAlternativesForDisplay(
    options: RouteAlternativeOption[],
    mode: TravelMode,
    filter: TransitRouteFilter = "ALL"
): RouteAlternativeOption[] {
    if (mode === "TRANSIT") return selectNaverLikeRouteAlternatives(options, mode, filter);
    return [...options].sort((a, b) => {
        const scoreDiff = getRouteDisplayPriority(a, mode) - getRouteDisplayPriority(b, mode);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.minutes ?? 9999) - (b.minutes ?? 9999);
    }).slice(0, 4);
}

// 노선명을 카드 막대 아래에 들어갈 짧은 라벨로 정리한다.
function compactLineLabel(leg: RouteSelectTransitLeg): string | undefined {
    const sharedLabel = compactSharedTransitLineLabel(leg.lineName) ?? compactSharedTransitLineLabel(leg.label);
    if (sharedLabel) return sharedLabel;

    const raw = (leg.lineName || leg.label || "").trim();
    if (!raw) return undefined;
    let normalized = raw;
    const leadingTokenRegex = /^(승차|하차|환승|승|하|환|버스|지하철)\s*/i;
    for (let index = 0; index < 3; index += 1) {
        const next = normalized.replace(leadingTokenRegex, "").trim();
        if (next === normalized) break;
        normalized = next;
    }
    normalized = normalized
        .replace(/간선\s*[:：]?\s*/g, "")
        .replace(/지선\s*[:：]?\s*/g, "")
        .replace(/광역\s*[:：]?\s*/g, "")
        .replace(/순환\s*[:：]?\s*/g, "")
        .replace(/마을\s*[:：]?\s*/g, "")
        .replace(/공항\s*[:：]?\s*/g, "")
        .replace(/버스\s*/g, "")
        .replace(/수도권\s*/g, "")
        .replace(/노선$/u, "")
        .trim();

    const lineMatch = normalized.match(/\d+호선/);
    if (lineMatch?.[0]) return lineMatch[0];
    const first = normalized.split(",")[0]?.trim() ?? normalized;
    if (!first) return undefined;
    return first.length > 10 ? `${first.slice(0, 10)}…` : first;
}

// 지하철 노선명을 기준으로 실제 노선색에 가까운 색을 찾는다.
function getSubwayLineColor(lineName?: string): string {
    return getSharedSubwayLineColor(lineName);
}

// 대중교통 구간의 노선색을 결정한다.
function getTransitLegColor(leg: RouteSelectTransitLeg): string {
    const lineLabel = compactLineLabel(leg) ?? leg.lineName ?? leg.label;
    if (leg.kind === "BUS") return getSharedBusLineColor(lineLabel, leg.lineColor);
    if (leg.kind === "SUBWAY") return getSubwayLineColor(lineLabel);
    if (leg.kind === "WALK") return ROUTE_SEGMENT_FALLBACK_COLORS.walk;
    return ROUTE_SEGMENT_FALLBACK_COLORS.etc;
}

// 구간별 소요 시간을 분 단위로 정규화한다.
function getLegDurationMinutes(leg: RouteSelectTransitLeg): number {
    if (typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes)) {
        return Math.max(1, Math.round(leg.durationMinutes));
    }
    if (typeof leg.distanceMeters === "number" && leg.distanceMeters > 0) {
        const metersPerMinute = leg.kind === "WALK" ? 67 : 350;
        return Math.max(1, Math.round(leg.distanceMeters / metersPerMinute));
    }
    return 1;
}

// 경로 후보를 공용 구간 막대 데이터로 변환한다.
function buildRouteProgressSegments(option: RouteAlternativeOption): RouteProgressSegment[] {
    const legs = option.transitLegs ?? [];
    if (!legs.length) return [];

    return legs
        .map((leg, index) => {
            const minutes = getLegDurationMinutes(leg);
            const prevLeg = legs[index - 1];
            const nextLeg = legs[index + 1];
            const isTransferWalk = leg.kind === "WALK" &&
                index > 0 &&
                index < legs.length - 1 &&
                isRideLegKind(prevLeg?.kind) &&
                isRideLegKind(nextLeg?.kind);
            const lineLabel = leg.kind === "WALK" ? undefined : compactLineLabel(leg);
            const segmentKind: RouteProgressSegment["kind"] = isTransferWalk ? "TRANSFER" : leg.kind;
            const color = isTransferWalk ? ROUTE_SEGMENT_FALLBACK_COLORS.etc : getTransitLegColor(leg);
            return {
                key: `${segmentKind}:${lineLabel ?? leg.label}:${index}`,
                label: `${minutes}분`,
                lineLabel,
                minutes,
                color,
                kind: segmentKind,
                flex: Math.max(0.8, minutes),
                isRide: isRideLegKind(segmentKind),
            };
        })
        .filter((segment) => segment.minutes > 0);
}

function getTransitKindLabel(kind: RouteSelectTransitLeg["kind"]): string {
    if (kind === "SUBWAY") return "지하철";
    if (kind === "BUS") return "버스";
    if (kind === "WALK") return "도보";
    return "이동";
}

function isRideLegKind(kind?: RouteSelectTransitLeg["kind"] | "TRANSFER"): boolean {
    return kind === "SUBWAY" || kind === "BUS";
}

function getRouteTransferCount(option: RouteAlternativeOption): number {
    return getNaverLikeRouteTransferCount(option);
}

function getRouteWalkMinutes(option: RouteAlternativeOption): number {
    return getNaverLikeRouteWalkMinutes(option);
}

function buildRouteMetricChips(option: RouteAlternativeOption): RouteMetricChip[] {
    const chips: RouteMetricChip[] = [];

    if (option.mode === "TRANSIT") {
        chips.push({ key: "transfer", label: `환승 ${getRouteTransferCount(option)}회` });
        chips.push({ key: "walk", label: `도보 ${getRouteWalkMinutes(option)}분` });
    } else {
        const distance = formatDistance(option.distanceMeters);
        if (distance) chips.push({ key: "distance", label: distance });
        if (typeof option.tollFareWon === "number" && option.tollFareWon > 0) {
            chips.push({ key: "toll", label: `통행료 ${option.tollFareWon.toLocaleString()}원` });
        }
        if (typeof option.taxiFareWon === "number" && option.taxiFareWon > 0) {
            chips.push({ key: "taxi", label: `택시 예상 ${option.taxiFareWon.toLocaleString()}원` });
        }
    }

    return chips;
}

function formatRouteStopName(name?: string): string | undefined {
    const normalized = name
        ?.replace(/\s+/g, " ")
        .replace(/\(.+?\)/g, "")
        .replace(/(\S)(\d+\s*번\s*출구)/g, "$1 $2")
        .trim();
    return normalized || undefined;
}

function formatRouteFlowPointName(name?: string): string | undefined {
    const normalized = formatRouteStopName(name)
        ?.replace(/\[.+?\]/g, "")
        .replace(/\s*\d+\s*번\s*출구.*$/g, "")
        .replace(/\s*출구.*$/g, "")
        .trim();
    return normalized || undefined;
}

function formatRouteFlowStopDisplayName(
    name?: string,
    kind?: RouteSelectTransitLeg["kind"] | "TRANSFER"
): string | undefined {
    const normalized = formatRouteFlowPointName(name);
    if (!normalized) return undefined;
    if ((kind === "SUBWAY" || kind === "TRANSFER") && !normalized.endsWith("역")) {
        return `${normalized}역`;
    }
    return normalized;
}

function buildRouteBoardingSummary(
    option: RouteAlternativeOption,
    originName?: string
): string | undefined {
    const rideLegs = (option.transitLegs ?? []).filter((leg) => isRideLegKind(leg.kind));
    if (!rideLegs.length) return undefined;

    return rideLegs.map((leg, index) => {
        const lineLabel = compactLineLabel(leg) ?? getTransitKindLabel(leg.kind);
        const startName = formatRouteFlowStopDisplayName(leg.startName, leg.kind) ??
            formatRouteFlowPointName(originName);
        const action = index === 0 ? "승차" : "환승";
        return [lineLabel, startName ? `${startName} ${action}` : action]
            .filter(Boolean)
            .join(" ");
    }).join("  →  ");
}

function formatDropdownPlaceName(
    name?: string,
    kind?: RouteDropdownSummaryKind
): string | undefined {
    const normalized = formatRouteStopName(name);
    if (!normalized) return undefined;
    if (
        (kind === "SUBWAY" || kind === "TRANSFER") &&
        !normalized.endsWith("역") &&
        normalized !== "출발지" &&
        normalized !== "도착지"
    ) {
        return `${normalized}역`;
    }
    return normalized;
}

function sanitizeRouteFlowText(text: string): string {
    return text
        .replace(/\s*(승차|하차|환승)\s*/g, " ")
        .replace(/\s*→\s*/g, " → ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function getRideLegStopCount(leg: RouteSelectTransitLeg): number | undefined {
    if (typeof leg.stationCount === "number" && Number.isFinite(leg.stationCount) && leg.stationCount > 0) {
        return Math.round(leg.stationCount);
    }
    if (Array.isArray(leg.passStops) && leg.passStops.length > 1) {
        return Math.max(1, leg.passStops.length - 1);
    }
    return undefined;
}

function formatRideLegStopCount(leg: RouteSelectTransitLeg): string | undefined {
    const count = getRideLegStopCount(leg);
    if (!count) return undefined;
    return leg.kind === "BUS" ? `${count}개 정류장` : `${count}정거장`;
}

// 선택된 경로는 구간 순서를 유지한 채 도보·승차·환승 정보를 세로로 펼친다.
function buildRouteDropdownSummaryItems(
    option: RouteAlternativeOption,
    originName?: string,
    destinationName?: string
): RouteDropdownSummaryItem[] {
    const legs = option.transitLegs ?? [];
    if (!legs.length) {
        const summary = option.stepSummary ? sanitizeRouteFlowText(option.stepSummary) : "";
        return summary
            ? [{
                key: `${option.id}:summary`,
                kind: "ETC",
                title: "경로 요약",
                subtitle: summary.replace(/→/g, " "),
            }]
            : [];
    }

    const originFallback = formatDropdownPlaceName(originName) ?? "출발지";
    const destinationFallback = formatDropdownPlaceName(destinationName) ?? "도착지";

    return legs.map((leg, index) => {
        const minutes = getLegDurationMinutes(leg);
        const prevLeg = legs[index - 1];
        const nextLeg = legs[index + 1];
        const startName = formatDropdownPlaceName(leg.startName, leg.kind);
        const endName = formatDropdownPlaceName(leg.endName, leg.kind);
        const key = `${option.id}:${leg.kind}:${leg.label}:${index}`;

        if (leg.kind === "WALK") {
            const isTransferWalk = index > 0 &&
                index < legs.length - 1 &&
                isRideLegKind(prevLeg?.kind) &&
                isRideLegKind(nextLeg?.kind);
            if (isTransferWalk) {
                const transferName = formatDropdownPlaceName(leg.startName, "TRANSFER") ??
                    formatDropdownPlaceName(leg.endName, "TRANSFER") ??
                    formatDropdownPlaceName(prevLeg?.endName, prevLeg?.kind) ??
                    formatDropdownPlaceName(nextLeg?.startName, nextLeg?.kind) ??
                    "환승 지점";
                return {
                    key,
                    kind: "TRANSFER" as const,
                    title: `환승 ${minutes}분`,
                    subtitle: transferName,
                };
            }

            const nextStopName = endName ??
                formatDropdownPlaceName(nextLeg?.startName, nextLeg?.kind) ??
                (index === legs.length - 1 ? destinationFallback : undefined);
            return {
                key,
                kind: "WALK" as const,
                title: `도보 ${minutes}분`,
                subtitle: index === legs.length - 1
                    ? "도착지까지"
                    : `${nextStopName ?? "다음 지점"}까지`,
            };
        }

        if (isRideLegKind(leg.kind)) {
            const lineLabel = compactLineLabel(leg) ?? getTransitKindLabel(leg.kind);
            const placeName = startName ?? (index === 0 ? originFallback : undefined);
            const stopCountText = formatRideLegStopCount(leg);
            return {
                key,
                kind: leg.kind,
                color: getTransitLegColor(leg),
                title: `${lineLabel} ${minutes}분`,
                subtitle: [placeName, stopCountText].filter(Boolean).join(" · "),
            };
        }

        return {
            key,
            kind: "ETC" as const,
            title: `이동 ${minutes}분`,
            subtitle: startName ?? endName,
        };
    });
}

// 입력 텍스트와 좌표를 경로 계산에 쓰는 장소 객체로 만든다.
function buildPlace(name: string, address: string | undefined, lat?: number, lng?: number): Place | undefined {
    const normalizedName = name.trim();
    const normalizedAddress = address?.trim();
    if (!normalizedName && !normalizedAddress && typeof lat !== "number" && typeof lng !== "number") return undefined;
    return {
        name: normalizedName || normalizedAddress || "위치",
        address: normalizedAddress || undefined,
        lat,
        lng,
    };
}

function placeHasCoords(place: Place | null | undefined): place is Place & { lat: number; lng: number } {
    return typeof place?.lat === "number" && Number.isFinite(place.lat) &&
        typeof place.lng === "number" && Number.isFinite(place.lng);
}

function getPlaceDisplayText(place: Place): string {
    return place.name?.trim() || place.address?.trim() || "출발지";
}

function getPlaceActionKey(place: Place): string {
    return [
        place.lat ?? "x",
        place.lng ?? "x",
        place.name?.trim() || "",
        place.address?.trim() || "",
    ].join(":");
}

function buildPlaceFromSearchItem(item: PlaceSearchItem): Place {
    return {
        name: item.name,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        provider: item.provider,
        providerPlaceId: item.providerPlaceId,
    };
}

function textIncludesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

function resolvePlaceListIcon(source: PlaceIconSource): PlaceListIconName {
    const text = [
        source.category,
        source.name,
        source.address,
    ].filter(Boolean).join(" ").toLowerCase();

    if (textIncludesAny(text, ["출구", "exit"]) || /\d+\s*번\s*출구/.test(text)) {
        return "exit-outline";
    }
    if (textIncludesAny(text, ["버스", "정류장", "정류소", "bus"])) {
        return "bus-outline";
    }
    if (textIncludesAny(text, ["지하철", "전철", "도시철도", "철도", "ktx", "호선"]) || /역(\s|$|\[|\(|\d)/.test(text)) {
        return "train-outline";
    }
    if (textIncludesAny(text, ["공항", "터미널", "airport"])) {
        return "airplane-outline";
    }
    if (textIncludesAny(text, ["집", "아파트", "빌라", "오피스텔", "주택", "home"])) {
        return "home-outline";
    }
    if (textIncludesAny(text, ["회사", "사무실", "오피스", "빌딩", "센터", "business", "office"])) {
        return "business-outline";
    }
    if (textIncludesAny(text, ["카페", "커피", "cafe", "coffee"])) {
        return "cafe-outline";
    }
    if (textIncludesAny(text, ["음식", "식당", "맛집", "레스토랑", "restaurant", "food"])) {
        return "restaurant-outline";
    }
    if (textIncludesAny(text, ["학교", "대학교", "캠퍼스", "학원", "school", "university"])) {
        return "school-outline";
    }
    if (textIncludesAny(text, ["병원", "약국", "의원", "치과", "medical", "hospital", "pharmacy"])) {
        return "medical-outline";
    }
    if (textIncludesAny(text, ["마트", "백화점", "상가", "몰", "쇼핑", "store", "mall", "shop"])) {
        return "cart-outline";
    }
    if (textIncludesAny(text, ["호텔", "모텔", "숙소", "hotel"])) {
        return "bed-outline";
    }
    if (textIncludesAny(text, ["주차", "parking"])) {
        return "car-outline";
    }

    return "location-outline";
}

// 딥링크 URL로 전달된 첫 번째 문자열 값을 꺼낸다.
function readParam(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

// URL 파라미터로 전달된 좌표 문자열을 숫자로 변환한다.
function readNumberParam(value: string | string[] | undefined): number | undefined {
    const rawValue = readParam(value);
    if (!rawValue) return undefined;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : undefined;
}

// URL 파라미터의 이동수단 값이 앱에서 쓰는 타입인지 확인한다.
function readTravelModeParam(value: string | string[] | undefined): TravelMode | undefined {
    const rawValue = readParam(value);
    return SELECTABLE_TRAVEL_MODES.includes(rawValue as TravelMode) ? rawValue as TravelMode : undefined;
}

export default function RouteSelectScreen() {
    const router = useRouter();
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
    }>();
    const sessionId = readParam(params.sessionId) ?? "";
    const editTargetParam = readParam(params.editTarget);
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
    const initial = sessionInitial ?? paramInitial;
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
    const [travelMode, setTravelMode] = useState<TravelMode>(initialTravelMode);
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget>(initialRoutePointTarget);
    const [isEditingRoutePoint, setIsEditingRoutePoint] = useState(Boolean(forcedEditTarget) || !initialHasRouteCoords);
    const [originUsesDefault, setOriginUsesDefault] = useState(false);
    const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
    const [favoritePlaces, setFavoritePlaces] = useState<FavoritePlace[]>([]);
    const [favoritePlacesLoaded, setFavoritePlacesLoaded] = useState(false);
    const [favoritePlacesError, setFavoritePlacesError] = useState<string>();
    const [favoriteReloadVersion, setFavoriteReloadVersion] = useState(0);
    const [selectedFavoriteFilterId, setSelectedFavoriteFilterId] = useState<string>();
    const [reduceFavoriteMotionEnabled, setReduceFavoriteMotionEnabled] = useState(false);
    const [favoriteSavingKey, setFavoriteSavingKey] = useState<string>();
    const [defaultOriginSavingKey, setDefaultOriginSavingKey] = useState<string>();
    const [favoriteSheetPlace, setFavoriteSheetPlace] = useState<Place>();
    const [saveFavoriteAsDefaultOrigin, setSaveFavoriteAsDefaultOrigin] = useState(false);
    const [favoriteCategories, setFavoriteCategories] = useState<FavoritePlaceCategory[]>([]);
    const [favoriteCategoryLoading, setFavoriteCategoryLoading] = useState(false);
    const [favoriteCategoryError, setFavoriteCategoryError] = useState<string>();
    const [selectedFavoriteCategoryId, setSelectedFavoriteCategoryId] = useState<string>();
    const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [newCategoryColor, setNewCategoryColor] = useState(FAVORITE_CATEGORY_COLORS[0]);
    const [creatingFavoriteCategory, setCreatingFavoriteCategory] = useState(false);
    const [mapPickerVisible, setMapPickerVisible] = useState(false);
    const [mapPickerSession, setMapPickerSession] = useState<MapPickerSessionState>(
        createMapPickerSessionState
    );
    const mapPickerCoord = mapPickerSession.pickedCoordinate;
    const mapPickerHasSelection = mapPickerSession.hasSelection;
    const [mapPickerName, setMapPickerName] = useState<string>();
    const [mapPickerAddress, setMapPickerAddress] = useState<string>();
    const [mapPickerResolving, setMapPickerResolving] = useState(false);
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [searchError, setSearchError] = useState<string>();
    const [hasTypedSearchQuery, setHasTypedSearchQuery] = useState(false);
    const [hasSearchAttempt, setHasSearchAttempt] = useState(false);
    const [searching, setSearching] = useState(false);
    const [currentLocationPending, setCurrentLocationPending] = useState(false);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState<string | undefined>();
    const [routeRequestVersion, setRouteRequestVersion] = useState(0);
    const [routeSubmitPending, setRouteSubmitPending] = useState(false);
    const favoritePanelEntrance = useRef(new Animated.Value(1)).current;
    const favoritePanelDirectionRef = useRef<1 | -1>(1);
    const routeSubmitPendingRef = useRef(false);
    const routeDetailAdPendingRef = useRef(false);
    const routeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRequestIdRef = useRef(0);
    const automaticSearchKeyRef = useRef("");
    const mapPickerRequestIdRef = useRef(0);
    const currentLocationRequestGuardRef = useRef(createLatestRequestGuard());
    const recentPlacesLoadedRef = useRef(false);
    const favoriteMutationRevisionRef = useRef(0);
    const favoriteCategoryMutationRevisionRef = useRef(0);
    const favoritePlaceLoadSerialRef = useRef(0);
    const favoritePlaceLoadRequestRef = useRef<{ id: number; reloadVersion: number } | undefined>(undefined);
    const originTouchedRef = useRef(Boolean(initial?.origin));
    const routePointUiRevisionRef = useRef(0);
    const destinationHasCoordinatesRef = useRef(initialHasDestinationCoords);
    destinationHasCoordinatesRef.current =
        typeof destinationLat === "number" && typeof destinationLng === "number";
    const [routeDepartureContext, setRouteDepartureContext] = useState(() => (
        resolveScheduleRouteDepartureContext(initial?.targetArrivalAt, initial?.travelMinutes)
    ));
    const routeDepartureAt = routeDepartureContext.departureAt;
    const routeScheduleBased = routeDepartureContext.scheduleBased;
    const routeTargetArrivalAt = routeDepartureContext.targetArrivalAt;
    const scheduleTimingRefinedRef = useRef(false);
    const routeContentAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

    useEffect(() => {
        let active = true;
        AccessibilityInfo.isReduceMotionEnabled?.()
            .then((enabled) => {
                if (active) setReduceFavoriteMotionEnabled(enabled);
            })
            .catch(() => undefined);
        const subscription = AccessibilityInfo.addEventListener?.(
            "reduceMotionChanged",
            setReduceFavoriteMotionEnabled
        );
        return () => {
            active = false;
            subscription?.remove();
        };
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
    const activeSearchText = activeTarget === "origin" ? originText : destinationText;
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
    const routeListBottomPadding = Math.max(insets.bottom + 24, 36);

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
    }, [clearSearch, destinationLat, destinationLng, originLat, originLng]);

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

    useFocusEffect(useCallback(() => {
        let cancelled = false;
        const favoriteLoadRequest = {
            id: favoritePlaceLoadSerialRef.current + 1,
            reloadVersion: favoriteReloadVersion,
        };
        favoritePlaceLoadSerialRef.current = favoriteLoadRequest.id;
        favoritePlaceLoadRequestRef.current = favoriteLoadRequest;
        const favoriteRevision = favoriteMutationRevisionRef.current;
        const categoryRevision = favoriteCategoryMutationRevisionRef.current;

        setFavoritePlacesError(undefined);
        getFavoritePlacesFromApi()
            .then((favorites) => {
                if (!cancelled && favoritePlaceLoadRequestRef.current === favoriteLoadRequest) {
                    setFavoritePlaces((current) => (
                        favoriteMutationRevisionRef.current === favoriteRevision
                            ? favorites
                            : mergeLoadedFavoritePlaces(current, favorites)
                    ));
                    setFavoritePlacesLoaded(true);
                }
            })
            .catch(() => {
                if (cancelled || favoritePlaceLoadRequestRef.current !== favoriteLoadRequest) return;
                setFavoritePlacesError("즐겨찾기를 불러오지 못했습니다.");
                setFavoritePlacesLoaded(true);
            });

        setFavoriteCategoryLoading(true);
        setFavoriteCategoryError(undefined);
        getFavoritePlaceCategoriesFromApi()
            .then((categories) => {
                if (cancelled) return;
                if (favoriteCategoryMutationRevisionRef.current === categoryRevision) {
                    setFavoriteCategories(categories);
                }
            })
            .catch(() => {
                if (!cancelled) setFavoriteCategoryError("카테고리를 불러오지 못했습니다.");
            })
            .finally(() => {
                if (!cancelled) setFavoriteCategoryLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [favoriteReloadVersion]));

    const favoritePlaceTabs = useMemo(
        () => buildFavoritePlaceTabs(favoritePlaces, favoriteCategories),
        [favoriteCategories, favoritePlaces]
    );

    const toggleFavoriteFilter = useCallback((tabId: string) => {
        const nextId = selectedFavoriteFilterId === tabId ? undefined : tabId;
        const currentIndex = favoritePlaceTabs.findIndex((tab) => tab.id === selectedFavoriteFilterId);
        const nextIndex = favoritePlaceTabs.findIndex((tab) => tab.id === nextId);
        favoritePanelDirectionRef.current = nextIndex >= 0 && currentIndex >= 0 && nextIndex < currentIndex
            ? -1
            : 1;
        favoritePanelEntrance.stopAnimation();
        favoritePanelEntrance.setValue(reduceFavoriteMotionEnabled ? 1 : 0);
        if (!reduceFavoriteMotionEnabled) configureRouteExpansionAnimation(260);
        setSelectedFavoriteFilterId(nextId);
    }, [
        favoritePanelEntrance,
        favoritePlaceTabs,
        reduceFavoriteMotionEnabled,
        selectedFavoriteFilterId,
    ]);

    useEffect(() => {
        if (reduceFavoriteMotionEnabled) {
            favoritePanelEntrance.setValue(1);
            return;
        }
        const animation = Animated.timing(favoritePanelEntrance, {
            toValue: 1,
            duration: 190,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [favoritePanelEntrance, reduceFavoriteMotionEnabled, selectedFavoriteFilterId]);

    useEffect(() => {
        if (
            selectedFavoriteFilterId
            && !favoritePlaceTabs.some((tab) => tab.id === selectedFavoriteFilterId)
        ) {
            setSelectedFavoriteFilterId(undefined);
        }
    }, [favoritePlaceTabs, selectedFavoriteFilterId]);

    const loadedDefaultOrigin = useMemo(
        () => favoritePlaces.find((favorite) => favorite.defaultOrigin),
        [favoritePlaces]
    );

    useEffect(() => {
        if (!favoritePlacesLoaded) return;

        if (originUsesDefault) {
            const managedDefaultSync = resolveManagedDefaultOriginSync(
                origin,
                originUsesDefault,
                loadedDefaultOrigin
            );
            if (managedDefaultSync.kind === "clear-default-label") {
                // 기본 주소 관리에서 변경/해제해도 현재 편집 중인 경로는 보존하되,
                // 더 이상 기본 출발지로 잘못 표시하지 않는다.
                setOriginUsesDefault(false);
            } else if (managedDefaultSync.kind === "replace") {
                setOriginText(getPlaceDisplayText(managedDefaultSync.place));
                setOriginAddress(managedDefaultSync.place.address);
                setOriginLat(managedDefaultSync.place.lat);
                setOriginLng(managedDefaultSync.place.lng);
            }
            return;
        }

        if (
            originTouchedRef.current
            || forcedEditTarget === "origin"
            || !placeHasCoords(loadedDefaultOrigin)
        ) {
            return;
        }

        const requestUiRevision = routePointUiRevisionRef.current;
        setOriginText(getPlaceDisplayText(loadedDefaultOrigin));
        setOriginAddress(loadedDefaultOrigin.address);
        setOriginLat(loadedDefaultOrigin.lat);
        setOriginLng(loadedDefaultOrigin.lng);
        setOriginUsesDefault(true);

        const uiUpdate = resolveDefaultOriginUiUpdate({
            requestUiRevision,
            currentUiRevision: routePointUiRevisionRef.current,
            destinationHasCoordinates: destinationHasCoordinatesRef.current,
            forcedTarget: forcedEditTarget,
        });
        if (uiUpdate) {
            setActiveTarget(uiUpdate.activeTarget);
            setIsEditingRoutePoint(uiUpdate.isEditingRoutePoint);
            clearSearch();
        }
    }, [
        clearSearch,
        favoritePlacesLoaded,
        forcedEditTarget,
        loadedDefaultOrigin,
        origin,
        originUsesDefault,
    ]);

    useEffect(() => {
        if (!isEditingRoutePoint || hasTypedSearchQuery) return;

        const query = activeTarget === "origin" ? originText.trim() : destinationText.trim();
        const hasCoordinates = activeTarget === "origin"
            ? typeof originLat === "number" && typeof originLng === "number"
            : typeof destinationLat === "number" && typeof destinationLng === "number";
        if (!query || hasCoordinates) return;

        const searchKey = `${activeTarget}:${query}`;
        if (automaticSearchKeyRef.current === searchKey) return;
        automaticSearchKeyRef.current = searchKey;

        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        const oppositePoint = activeTarget === "origin"
            ? (typeof destinationLat === "number" && typeof destinationLng === "number"
                ? { lat: destinationLat, lng: destinationLng }
                : undefined)
            : (typeof originLat === "number" && typeof originLng === "number"
                ? { lat: originLat, lng: originLng }
                : undefined);

        setSearching(true);
        setHasSearchAttempt(true);
        setSearchError(undefined);
        searchAddressByKeyword(query, { center: oppositePoint, radiusKm: 33 })
            .then((items) => {
                if (searchRequestIdRef.current !== requestId) return;
                setSearchResults(items);
            })
            .catch((error) => {
                if (searchRequestIdRef.current !== requestId) return;
                const message = error instanceof Error ? error.message : "주소 검색에 실패했습니다.";
                setSearchResults([]);
                setSearchError(message);
            })
            .finally(() => {
                if (searchRequestIdRef.current === requestId) setSearching(false);
            });
    }, [
        activeTarget,
        destinationLat,
        destinationLng,
        destinationText,
        hasTypedSearchQuery,
        isEditingRoutePoint,
        originLat,
        originLng,
        originText,
    ]);

    const handleSearchChange = useCallback((target: RoutePointTarget, text: string) => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        routePointUiRevisionRef.current += 1;
        const hasQuery = text.trim().length > 0;
        setActiveTarget(target);
        setIsEditingRoutePoint(true);
        setHasTypedSearchQuery(hasQuery);
        setHasSearchAttempt(hasQuery);
        setSearchResults([]);
        setSearchError(undefined);
        setSearching(hasQuery);
        if (target === "origin") {
            originTouchedRef.current = true;
            setOriginUsesDefault(false);
            setOriginText(text);
            setOriginAddress(undefined);
            setOriginLat(undefined);
            setOriginLng(undefined);
        } else {
            setDestinationText(text);
            setDestinationAddress(undefined);
            setDestinationLat(undefined);
            setDestinationLng(undefined);
        }

        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (!hasQuery) return;

        searchDebounceRef.current = setTimeout(async () => {
            try {
                setSearching(true);
                const oppositePoint = target === "origin"
                    ? (typeof destinationLat === "number" && typeof destinationLng === "number"
                        ? { lat: destinationLat, lng: destinationLng }
                        : undefined)
                    : (typeof originLat === "number" && typeof originLng === "number"
                        ? { lat: originLat, lng: originLng }
                        : undefined);
                const items = await searchAddressByKeyword(text.trim(), {
                    center: oppositePoint,
                    radiusKm: 33,
                });
                if (searchRequestIdRef.current !== requestId) return;
                setSearchResults(items);
            } catch (error) {
                if (searchRequestIdRef.current !== requestId) return;
                const message = error instanceof Error ? error.message : "주소 검색에 실패했습니다.";
                setSearchResults([]);
                setSearchError(message);
            } finally {
                if (searchRequestIdRef.current === requestId) setSearching(false);
            }
        }, 450);
    }, [destinationLat, destinationLng, originLat, originLng]);

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

    const getMapPickerInitialCoord = useCallback((target: RoutePointTarget) => {
        const targetLat = target === "origin" ? originLat : destinationLat;
        const targetLng = target === "origin" ? originLng : destinationLng;
        if (typeof targetLat === "number" && typeof targetLng === "number") {
            return { latitude: targetLat, longitude: targetLng };
        }

        const pairedLat = target === "origin" ? destinationLat : originLat;
        const pairedLng = target === "origin" ? destinationLng : originLng;
        if (typeof pairedLat === "number" && typeof pairedLng === "number") {
            return { latitude: pairedLat, longitude: pairedLng };
        }

        return { latitude: MAP_PICKER_FALLBACK_LAT, longitude: MAP_PICKER_FALLBACK_LNG };
    }, [destinationLat, destinationLng, originLat, originLng]);

    const openMapForPointSelection = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        Keyboard.dismiss();
        const target = activeTarget;
        const targetPlace = target === "origin" ? origin : destination;
        const targetHasCoordinates = placeHasCoords(targetPlace);
        const initialCoord = getMapPickerInitialCoord(target);
        setMapPickerSession(createMapPickerSessionState(initialCoord, targetHasCoordinates));
        setMapPickerName(targetHasCoordinates ? targetPlace.name : undefined);
        setMapPickerAddress(targetHasCoordinates ? targetPlace.address : undefined);
        setMapPickerVisible(true);
    }, [activeTarget, destination, getMapPickerInitialCoord, origin]);

    const closeMapPicker = useCallback(() => {
        mapPickerRequestIdRef.current += 1;
        setMapPickerVisible(false);
        setMapPickerSession((current) => createMapPickerSessionState(current.cameraCoordinate));
        setMapPickerName(undefined);
        setMapPickerAddress(undefined);
        setMapPickerResolving(false);
    }, []);

    const selectMapPickerCoord = useCallback(async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
        const requestId = mapPickerRequestIdRef.current + 1;
        mapPickerRequestIdRef.current = requestId;
        setMapPickerSession((current) => selectMapPickerSessionCoordinate(
            current,
            { latitude, longitude }
        ));
        setMapPickerName(undefined);
        setMapPickerAddress(undefined);
        setMapPickerResolving(true);
        try {
            const address = await reverseGeocodeToAddress(latitude, longitude);
            if (mapPickerRequestIdRef.current !== requestId) return;
            setMapPickerAddress(address);
        } catch {
            if (mapPickerRequestIdRef.current !== requestId) return;
            setMapPickerAddress(undefined);
        } finally {
            if (mapPickerRequestIdRef.current === requestId) setMapPickerResolving(false);
        }
    }, []);

    const confirmMapPickerSelection = useCallback((target: RoutePointTarget) => {
        const commit = resolveMapPickerCommit(mapPickerSession, target, mapPickerResolving);
        if (!commit) {
            if (mapPickerResolving) {
                Alert.alert("주소 확인 중", "선택한 위치의 주소를 확인한 뒤 다시 시도해 주세요.");
                return;
            }
            Alert.alert("위치 선택 필요", "지도에서 위치를 선택해 주세요.");
            return;
        }

        const label = target === "origin" ? "지도 선택 출발지" : "지도 선택 도착지";
        const place: Place = {
            name: mapPickerName || mapPickerAddress || label,
            address: mapPickerAddress,
            lat: commit.coordinate.latitude,
            lng: commit.coordinate.longitude,
        };
        const transition = resolveMapPickerPostCommitTransition(
            mapPickerSession,
            commit.target,
            typeof originLat === "number" && typeof originLng === "number",
            typeof destinationLat === "number" && typeof destinationLng === "number"
        );

        mapPickerRequestIdRef.current += 1;
        rememberRecentPlace(place);
        applyPlaceToTarget(commit.target, place);
        setMapPickerResolving(false);
        if (transition.keepPickerOpen) {
            setMapPickerSession(transition.nextSession);
            setMapPickerName(undefined);
            setMapPickerAddress(undefined);
            return;
        }
        setMapPickerVisible(false);
    }, [
        applyPlaceToTarget,
        destinationLat,
        destinationLng,
        mapPickerAddress,
        mapPickerName,
        mapPickerResolving,
        mapPickerSession,
        originLat,
        originLng,
        rememberRecentPlace,
    ]);

    const loadFavoriteCategories = useCallback(async () => {
        setFavoriteCategoryLoading(true);
        setFavoriteCategoryError(undefined);
        try {
            const categories = await getFavoritePlaceCategoriesFromApi();
            setFavoriteCategories(categories);
        } catch {
            setFavoriteCategoryError("카테고리를 불러오지 못했습니다.");
        } finally {
            setFavoriteCategoryLoading(false);
        }
    }, []);

    const openFavoriteSaveSheet = useCallback((place: Place) => {
        if (!placeHasCoords(place)) {
            Alert.alert("즐겨찾기 저장", "지도에서 위치를 확인할 수 있는 장소만 저장할 수 있어요.");
            return;
        }

        Keyboard.dismiss();
        setFavoriteSheetPlace(place);
        setSaveFavoriteAsDefaultOrigin(false);
        setSelectedFavoriteCategoryId(undefined);
        setShowNewCategoryForm(false);
        setNewCategoryName("");
        setNewCategoryColor(FAVORITE_CATEGORY_COLORS[0]);
        loadFavoriteCategories().catch(() => undefined);
    }, [loadFavoriteCategories]);

    const closeFavoriteSaveSheet = useCallback(() => {
        if (favoriteSavingKey || creatingFavoriteCategory) return;
        setFavoriteSheetPlace(undefined);
        setSaveFavoriteAsDefaultOrigin(false);
        setFavoriteCategoryError(undefined);
        setShowNewCategoryForm(false);
        setNewCategoryName("");
    }, [creatingFavoriteCategory, favoriteSavingKey]);

    const createFavoriteCategory = useCallback(async () => {
        const categoryName = newCategoryName.trim();
        if (!categoryName) {
            Alert.alert("카테고리 추가", "카테고리 이름을 입력해 주세요.");
            return;
        }
        if (isReservedFavoritePlaceCategoryName(categoryName)) {
            Alert.alert("카테고리 추가", "기본 주소와 미분류는 기본 제공 카테고리 이름입니다.");
            return;
        }

        setCreatingFavoriteCategory(true);
        try {
            const category = await createFavoritePlaceCategoryToApi(categoryName, newCategoryColor);
            favoriteCategoryMutationRevisionRef.current += 1;
            setFavoriteCategories((current) => {
                const next = [
                    ...current.filter((item) => item.id !== category.id),
                    category,
                ];
                return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            });
            setSaveFavoriteAsDefaultOrigin(false);
            setSelectedFavoriteCategoryId(category.id);
            setShowNewCategoryForm(false);
            setNewCategoryName("");
            setNewCategoryColor(FAVORITE_CATEGORY_COLORS[0]);
        } catch (error) {
            const message = error instanceof Error ? error.message : "카테고리를 추가하지 못했습니다.";
            Alert.alert("카테고리 추가 실패", message);
        } finally {
            setCreatingFavoriteCategory(false);
        }
    }, [newCategoryColor, newCategoryName]);

    const savePlaceAsFavorite = useCallback(async (place: Place, categoryId?: string) => {
        if (!placeHasCoords(place)) {
            Alert.alert("즐겨찾기 저장", "지도에서 위치를 확인할 수 있는 장소만 저장할 수 있어요.");
            return;
        }

        const savingKey = getPlaceActionKey(place);
        setFavoriteSavingKey(savingKey);
        try {
            const saved = await saveFavoritePlaceToApi(place, { categoryId });
            favoriteMutationRevisionRef.current += 1;
            setFavoritePlaces((current) => upsertFavoritePlace(current, saved));

            if (saveFavoriteAsDefaultOrigin) {
                try {
                    const defaultOrigin = saved.id
                        ? await saveFavoriteDepartureFavorite(saved)
                        : await saveFavoriteDeparturePlace(saved);
                    if (defaultOrigin) {
                        favoriteMutationRevisionRef.current += 1;
                        if (activeTarget !== "origin") {
                            // 도착지 검색 중 기본 주소를 바꾸더라도 현재 경로의 출발지는
                            // 이번 편집 세션 동안 그대로 둔다.
                            originTouchedRef.current = true;
                            setOriginUsesDefault(false);
                        }
                        setFavoritePlaces((current) => upsertFavoritePlace(
                            current.map((item) => ({ ...item, defaultOrigin: false })),
                            { ...defaultOrigin, defaultOrigin: true }
                        ));
                        if (activeTarget === "origin") {
                            applyPlaceToTarget("origin", defaultOrigin);
                            setOriginUsesDefault(true);
                        }
                    }
                } catch {
                    setFavoriteSheetPlace(undefined);
                    setSaveFavoriteAsDefaultOrigin(false);
                    Alert.alert(
                        "기본 주소 저장 실패",
                        "즐겨찾기는 저장했지만 기본 주소는 설정하지 못했습니다. 잠시 후 다시 시도해 주세요."
                    );
                    return;
                }
            }

            setFavoriteSheetPlace(undefined);
            setSaveFavoriteAsDefaultOrigin(false);
            Alert.alert(
                "즐겨찾기 저장",
                saveFavoriteAsDefaultOrigin
                    ? `${getPlaceDisplayText(place)} 장소를 즐겨찾기와 기본 주소로 저장했습니다.`
                    : `${getPlaceDisplayText(place)} 장소를 저장했습니다.`
            );
        } catch {
            Alert.alert("즐겨찾기 저장 실패", "잠시 후 다시 시도해 주세요.");
        } finally {
            setFavoriteSavingKey((current) => current === savingKey ? undefined : current);
        }
    }, [activeTarget, applyPlaceToTarget, saveFavoriteAsDefaultOrigin]);

    const saveFavoriteSheetPlace = useCallback(() => {
        if (!favoriteSheetPlace) return;
        savePlaceAsFavorite(favoriteSheetPlace, selectedFavoriteCategoryId).catch(() => undefined);
    }, [favoriteSheetPlace, savePlaceAsFavorite, selectedFavoriteCategoryId]);

    const removePlaceFromFavorites = useCallback((
        favorite: FavoritePlace,
        actionPlace: Place = favorite
    ) => {
        if (!favorite.id || favoriteSavingKey) return;

        const removalTargetsById = new Map<string, FavoritePlace>();
        [...findMatchingFavoritePlaces(actionPlace, favoritePlaces), favorite].forEach((target) => {
            if (target.id) removalTargetsById.set(target.id, target);
        });
        const removalTargets = [...removalTargetsById.values()];
        const removesDefaultOrigin = removalTargets.some((target) => target.defaultOrigin);

        const executeRemoval = async () => {
            const savingKey = getPlaceActionKey(actionPlace);
            setFavoriteSavingKey(savingKey);
            try {
                const results = await Promise.allSettled(
                    removalTargets.map((target) => deleteFavoritePlaceFromApi(target.id!))
                );
                const deletedTargets = removalTargets.filter((_, index) => results[index].status === "fulfilled");
                if (deletedTargets.length === 0) {
                    throw new Error("즐겨찾기를 삭제하지 못했습니다.");
                }

                if (deletedTargets.some((target) => target.defaultOrigin)) {
                    // 삭제가 먼저 성공해야 요청 실패 시 기존 기본 출발지가 보존된다.
                    // 서버에서는 삭제된 장소가 기본 출발지 조회에서 제외되므로 로컬 캐시를 우선 비운다.
                    await clearFavoriteDeparturePlaces().catch(() => undefined);
                    setOriginUsesDefault(false);
                }

                // 포커스 직후 시작된 오래된 GET이 삭제한 장소를 다시 목록에 넣지 못하게 한다.
                favoritePlaceLoadRequestRef.current = undefined;
                favoriteMutationRevisionRef.current += 1;
                const deletedIds = new Set(deletedTargets.map((target) => target.id));
                setFavoritePlaces((current) => current.filter((item) => !item.id || !deletedIds.has(item.id)));

                if (deletedTargets.length !== removalTargets.length) {
                    Alert.alert(
                        "일부 즐겨찾기를 해제하지 못했어요",
                        "중복 저장된 항목 일부가 남았습니다. 잠시 후 다시 시도해 주세요."
                    );
                }
            } catch {
                Alert.alert("즐겨찾기 해제 실패", "잠시 후 다시 시도해 주세요.");
            } finally {
                setFavoriteSavingKey((current) => current === savingKey ? undefined : current);
            }
        };

        if (removesDefaultOrigin) {
            Alert.alert(
                "기본 출발지 즐겨찾기를 해제할까요?",
                "즐겨찾기에서 삭제하면 기본 출발지도 함께 해제됩니다. 현재 입력한 출발지는 그대로 유지됩니다.",
                [
                    { text: "취소", style: "cancel" },
                    {
                        text: "해제",
                        style: "destructive",
                        onPress: () => {
                            executeRemoval().catch(() => undefined);
                        },
                    },
                ]
            );
            return;
        }

        executeRemoval().catch(() => undefined);
    }, [favoritePlaces, favoriteSavingKey]);

    const setFavoriteAsDefaultOrigin = useCallback(async (place: FavoritePlace) => {
        const savingKey = getPlaceActionKey(place);
        setDefaultOriginSavingKey(savingKey);
        try {
            if (!place.id) throw new Error("즐겨찾기 정보를 확인하지 못했어요. 다시 선택해 주세요.");
            const saved = await saveFavoriteDepartureFavorite(place);
            if (!saved) throw new Error("기본 출발지를 저장하지 못했어요. 다시 시도해 주세요.");

            favoriteMutationRevisionRef.current += 1;
            setFavoritePlaces((current) => upsertFavoritePlace(
                current.map((item) => ({ ...item, defaultOrigin: false })),
                { ...saved, defaultOrigin: true }
            ));
            applyPlaceToTarget("origin", saved);
            setOriginUsesDefault(true);
            Alert.alert(
                "기본 출발지 설정",
                `${getPlaceDisplayText(saved)} 장소를 기본 출발지로 설정했습니다.`
            );
        } catch {
            Alert.alert("기본 출발지 설정 실패", "잠시 후 다시 시도해 주세요.");
        } finally {
            setDefaultOriginSavingKey((current) => current === savingKey ? undefined : current);
        }
    }, [applyPlaceToTarget]);

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
        if (routeSubmitResetTimerRef.current) clearTimeout(routeSubmitResetTimerRef.current);
        currentLocationRequestGuardRef.current.invalidate();
    }, []);

    useEffect(() => {
        if (!shouldShowRouteResults) return;
        animateRouteContent();
    }, [
        animateRouteContent,
        routeError,
        routeLoading,
        shouldShowRouteResults,
        visibleRouteSignature,
    ]);

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

    const exitSearchMode = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        clearSearch();
        setIsEditingRoutePoint(false);
    }, [clearSearch]);

    useEffect(() => {
        if (Platform.OS !== "android" || !isEditingRoutePoint) return;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            exitSearchMode();
            return true;
        });
        return () => subscription.remove();
    }, [exitSearchMode, isEditingRoutePoint]);

    const editDefaultOrigin = useCallback(() => {
        currentLocationRequestGuardRef.current.invalidate();
        setCurrentLocationPending(false);
        routePointUiRevisionRef.current += 1;
        originTouchedRef.current = true;
        setActiveTarget("origin");
        setIsEditingRoutePoint(true);
        clearSearch();
    }, [clearSearch]);

    const visibleFavoritePlaces = useMemo(
        () => selectFavoritePlacesByTab(
            favoritePlaces,
            selectedFavoriteFilterId,
            favoriteCategories
        ),
        [favoriteCategories, favoritePlaces, selectedFavoriteFilterId]
    );
    const visibleRecentPlaces = useMemo(
        () => excludeFavoritePlacesFromRecents(recentPlaces, favoritePlaces),
        [favoritePlaces, recentPlaces]
    );
    const favoritePanelAnimatedStyle = {
        opacity: favoritePanelEntrance,
        transform: [{
            translateX: favoritePanelEntrance.interpolate({
                inputRange: [0, 1],
                outputRange: [favoritePanelDirectionRef.current * 10, 0],
            }),
        }, {
            translateY: favoritePanelEntrance.interpolate({
                inputRange: [0, 1],
                outputRange: [-6, 0],
            }),
        }],
    };
    const hasConfiguredDefaultOrigin = placeHasCoords(loadedDefaultOrigin);

    const routeUi = isDark
        ? {
            background: "#0F1117",
            surface: "#171A20",
            surface2: "#23262D",
            selectedSurface: "#171A20",
            selectedBorder: "rgba(47,140,255,0.72)",
            selectedModeBg: "rgba(41,121,255,0.13)",
            neutralChipBg: "rgba(255,255,255,0.025)",
            neutralChipBorder: "rgba(255,255,255,0.10)",
            border: "#2A2F3A",
            borderStrong: "#474950",
            textPrimary: "#F5F7FA",
            textSecondary: "#9CA3AF",
            textDisabled: "#6B7280",
            inputBackground: "#0B0D12",
            inputBorder: "#2A2F3A",
            inputBorderFocused: "#2979FF",
            inputPlaceholder: "#6B7280",
            clearButtonBg: "#474950",
            clearButtonText: "#FFFFFF",
            accentBlue: "#2979FF",
            accentGreen: "#22C55E",
            accentRed: "#FF4444",
        }
        : {
            background: colors.background,
            surface: "#FFFFFF",
            surface2: "#F2F4F8",
            selectedSurface: "#FFFFFF",
            selectedBorder: "rgba(30,104,255,0.72)",
            selectedModeBg: "rgba(41,121,255,0.10)",
            neutralChipBg: "#F8FAFC",
            neutralChipBorder: "#E2E8F0",
            border: "#E2E8F0",
            borderStrong: "#CBD5E1",
            textPrimary: "#111827",
            textSecondary: "#667085",
            textDisabled: "#98A2B3",
            inputBackground: colors.inputBackground,
            inputBorder: colors.inputBorder,
            inputBorderFocused: "#2979FF",
            inputPlaceholder: colors.inputPlaceholder,
            clearButtonBg: "#E5E7EB",
            clearButtonText: "#111827",
            accentBlue: "#1E68FF",
            accentGreen: "#16A34A",
            accentRed: "#EF4444",
        };
    const modeSelectedText = "#FFFFFF";
    const statusBarStyle = isDark ? "light-content" : "dark-content";
    const favoriteSheetSaving = favoriteSheetPlace
        ? favoriteSavingKey === getPlaceActionKey(favoriteSheetPlace)
        : false;
    const favoriteSaveSheet = (
        <Modal
            visible={Boolean(favoriteSheetPlace)}
            transparent
            animationType="fade"
            onRequestClose={closeFavoriteSaveSheet}
        >
            <View accessibilityViewIsModal style={styles.favoriteModalRoot}>
                <Pressable
                    onPress={closeFavoriteSaveSheet}
                    disabled={favoriteSheetSaving || creatingFavoriteCategory}
                    accessibilityRole="button"
                    accessibilityLabel="즐겨찾기 저장 창 닫기"
                    style={styles.favoriteModalBackdrop}
                />
                <CalendarGlassSurface
                    prominent
                    variant="sheet"
                    style={[
                        styles.favoriteSheet,
                        {
                            borderColor: routeUi.border,
                            paddingBottom: Math.max(insets.bottom + 16, 22),
                        },
                    ]}
                >
                    <View style={[styles.favoriteSheetHandle, { backgroundColor: routeUi.borderStrong }]} />
                    <View style={styles.favoriteSheetHeader}>
                        <View>
                            <Text style={[styles.favoriteSheetTitle, { color: routeUi.textPrimary }]}>
                                즐겨찾기 저장
                            </Text>
                            <Text style={[styles.favoriteSheetSubtitle, { color: routeUi.textSecondary }]}>
                                저장할 카테고리를 선택하세요
                            </Text>
                        </View>
                        <Pressable
                            onPress={closeFavoriteSaveSheet}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="즐겨찾기 저장 창 닫기"
                            style={[styles.favoriteSheetCloseButton, { backgroundColor: routeUi.surface2 }]}
                        >
                            <Text style={[styles.favoriteSheetCloseText, { color: routeUi.textSecondary }]}>×</Text>
                        </Pressable>
                    </View>

                    <ScrollView
                        style={styles.favoriteSheetScroll}
                        contentContainerStyle={styles.favoriteSheetScrollContent}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                        automaticallyAdjustKeyboardInsets
                        showsVerticalScrollIndicator={false}
                    >
                    <View style={[styles.favoritePlaceBox, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}>
                        <Ionicons name="star" size={18} color={routeUi.accentBlue} />
                        <View style={styles.favoritePlaceTextWrap}>
                            <Text numberOfLines={1} style={[styles.favoritePlaceName, { color: routeUi.textPrimary }]}>
                                {favoriteSheetPlace ? getPlaceDisplayText(favoriteSheetPlace) : ""}
                            </Text>
                            {!!favoriteSheetPlace?.address && (
                                <Text numberOfLines={1} style={[styles.favoritePlaceAddress, { color: routeUi.textSecondary }]}>
                                    {favoriteSheetPlace.address}
                                </Text>
                            )}
                        </View>
                    </View>

                    <View style={styles.favoriteSectionHeaderRow}>
                        <Text style={[styles.favoriteSectionLabel, { color: routeUi.textPrimary }]}>카테고리</Text>
                        {favoriteCategoryLoading && (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="즐겨찾기 카테고리를 불러오고 있어요"
                            />
                        )}
                    </View>
                    <View style={styles.favoriteCategoryWrap}>
                        <Pressable
                            onPress={() => {
                                setSaveFavoriteAsDefaultOrigin(true);
                                setSelectedFavoriteCategoryId(undefined);
                            }}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="기본 주소 카테고리"
                            accessibilityHint="이 장소를 다음 경로부터 사용할 기본 주소로 저장합니다"
                            accessibilityState={{ selected: saveFavoriteAsDefaultOrigin }}
                            style={[
                                styles.favoriteCategoryChip,
                                {
                                    backgroundColor: saveFavoriteAsDefaultOrigin ? routeUi.accentBlue : routeUi.surface2,
                                    borderColor: saveFavoriteAsDefaultOrigin ? routeUi.accentBlue : routeUi.border,
                                },
                            ]}
                        >
                            <Ionicons
                                name={saveFavoriteAsDefaultOrigin ? "home" : "home-outline"}
                                size={15}
                                color={saveFavoriteAsDefaultOrigin ? modeSelectedText : routeUi.accentBlue}
                            />
                            <Text
                                style={[
                                    styles.favoriteCategoryChipText,
                                    { color: saveFavoriteAsDefaultOrigin ? modeSelectedText : routeUi.textPrimary },
                                ]}
                            >
                                기본 주소
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                setSaveFavoriteAsDefaultOrigin(false);
                                setSelectedFavoriteCategoryId(undefined);
                            }}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="미분류 카테고리"
                            accessibilityState={{
                                selected: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId,
                            }}
                            style={[
                                styles.favoriteCategoryChip,
                                {
                                    backgroundColor: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId
                                        ? routeUi.accentBlue
                                        : routeUi.surface2,
                                    borderColor: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId
                                        ? routeUi.accentBlue
                                        : routeUi.border,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.favoriteCategoryChipText,
                                    {
                                        color: !saveFavoriteAsDefaultOrigin && !selectedFavoriteCategoryId
                                            ? modeSelectedText
                                            : routeUi.textSecondary,
                                    },
                                ]}
                            >
                                미분류
                            </Text>
                        </Pressable>
                        {favoriteCategories.map((category) => {
                            const selected = !saveFavoriteAsDefaultOrigin
                                && selectedFavoriteCategoryId === category.id;
                            const categoryColor = category.color || routeUi.accentBlue;
                            const categoryDisplayName = getFavoritePlaceCategoryDisplayName(category.name);
                            return (
                                <Pressable
                                    key={category.id ?? `${category.name}:${categoryColor}`}
                                    onPress={() => {
                                        setSaveFavoriteAsDefaultOrigin(false);
                                        setSelectedFavoriteCategoryId(category.id);
                                    }}
                                    disabled={!category.id || favoriteSheetSaving || creatingFavoriteCategory}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${categoryDisplayName} 카테고리`}
                                    accessibilityState={{
                                        selected,
                                        disabled: !category.id || favoriteSheetSaving || creatingFavoriteCategory,
                                    }}
                                    style={[
                                        styles.favoriteCategoryChip,
                                        {
                                            backgroundColor: selected ? categoryColor : routeUi.surface2,
                                            borderColor: selected ? categoryColor : routeUi.border,
                                            opacity: category.id ? 1 : 0.5,
                                        },
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.favoriteCategorySwatch,
                                            { backgroundColor: selected ? modeSelectedText : categoryColor },
                                        ]}
                                    />
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.favoriteCategoryChipText,
                                            { color: selected ? modeSelectedText : routeUi.textPrimary },
                                        ]}
                                    >
                                        {categoryDisplayName}
                                    </Text>
                                </Pressable>
                            );
                        })}
                        <Pressable
                            onPress={() => setShowNewCategoryForm((current) => !current)}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            accessibilityRole="button"
                            accessibilityLabel="새 카테고리 입력"
                            accessibilityState={{ expanded: showNewCategoryForm }}
                            style={[
                                styles.favoriteCategoryChip,
                                { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                            ]}
                        >
                            <Ionicons name={showNewCategoryForm ? "remove" : "add"} size={16} color={routeUi.textPrimary} />
                            <Text style={[styles.favoriteCategoryChipText, { color: routeUi.textPrimary }]}>
                                새 카테고리
                            </Text>
                        </Pressable>
                    </View>
                    {!!favoriteCategoryError && (
                        <Text style={[styles.favoriteCategoryError, { color: routeUi.accentRed }]}>
                            {favoriteCategoryError}
                        </Text>
                    )}

                    {showNewCategoryForm && (
                        <View style={[styles.favoriteNewCategoryBox, { backgroundColor: routeUi.inputBackground, borderColor: routeUi.inputBorder }]}>
                            <TextInput
                                value={newCategoryName}
                                onChangeText={setNewCategoryName}
                                placeholder="카테고리 이름"
                                placeholderTextColor={routeUi.inputPlaceholder}
                                selectionColor={routeUi.accentBlue}
                                style={[
                                    styles.favoriteNewCategoryInput,
                                    {
                                        color: routeUi.textPrimary,
                                        borderColor: routeUi.inputBorder,
                                    },
                                ]}
                            />
                            <View style={styles.favoriteColorRow}>
                                {FAVORITE_CATEGORY_COLORS.map((color, colorIndex) => {
                                    const selected = newCategoryColor === color;
                                    return (
                                        <Pressable
                                            key={color}
                                            onPress={() => setNewCategoryColor(color)}
                                            disabled={creatingFavoriteCategory || favoriteSheetSaving}
                                            accessibilityRole="button"
                                            accessibilityLabel={`카테고리 색상 ${colorIndex + 1}`}
                                            accessibilityState={{ selected }}
                                            style={[
                                                styles.favoriteColorButton,
                                                {
                                                    borderColor: selected ? routeUi.textPrimary : "transparent",
                                                },
                                            ]}
                                        >
                                            <View style={[styles.favoriteColorSwatch, { backgroundColor: color }]} />
                                        </Pressable>
                                    );
                                })}
                            </View>
                            <Pressable
                                onPress={createFavoriteCategory}
                                disabled={creatingFavoriteCategory || favoriteSheetSaving}
                                accessibilityRole="button"
                                accessibilityLabel="카테고리 추가"
                                style={[
                                    styles.favoriteCreateCategoryButton,
                                    { backgroundColor: routeUi.textPrimary },
                                ]}
                            >
                                {creatingFavoriteCategory ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="즐겨찾기 카테고리를 추가하고 있어요"
                                    />
                                ) : (
                                    <Text style={[styles.favoriteCreateCategoryText, { color: routeUi.background }]}>
                                        카테고리 추가
                                    </Text>
                                )}
                            </Pressable>
                        </View>
                    )}

                    <Pressable
                        onPress={saveFavoriteSheetPlace}
                        disabled={!favoriteSheetPlace || favoriteSheetSaving || creatingFavoriteCategory}
                        accessibilityRole="button"
                        accessibilityLabel="즐겨찾기 저장"
                        style={[
                            styles.favoriteSaveButton,
                            {
                                backgroundColor: routeUi.accentBlue,
                                opacity: favoriteSheetSaving || creatingFavoriteCategory ? 0.58 : 1,
                            },
                        ]}
                    >
                        {favoriteSheetSaving ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="즐겨찾기를 저장하고 있어요"
                            />
                        ) : (
                            <Text style={[styles.favoriteSaveButtonText, { color: modeSelectedText }]}>
                                즐겨찾기 저장
                            </Text>
                        )}
                    </Pressable>
                    </ScrollView>
                </CalendarGlassSurface>
            </View>
        </Modal>
    );
    const mapPickerCamera = {
        latitude: mapPickerSession.cameraCoordinate?.latitude ?? MAP_PICKER_FALLBACK_LAT,
        longitude: mapPickerSession.cameraCoordinate?.longitude ?? MAP_PICKER_FALLBACK_LNG,
        zoom: MAP_PICKER_DEFAULT_ZOOM,
    };
    const mapPickerMarkers = useMemo<TmapMarker[]>(() => {
        const markers: TmapMarker[] = [];
        if (placeHasCoords(origin)) {
            markers.push({
                id: "map-picker-origin",
                latitude: origin.lat,
                longitude: origin.lng,
                markerStyle: "origin",
                tintColor: routeUi.accentGreen,
                pinLabel: "출",
                caption: "출발지",
                zIndex: 20,
            });
        }
        if (placeHasCoords(destination)) {
            markers.push({
                id: "map-picker-destination",
                latitude: destination.lat,
                longitude: destination.lng,
                markerStyle: "destination",
                tintColor: routeUi.accentRed,
                pinLabel: "도",
                caption: "도착지",
                zIndex: 20,
            });
        }
        if (mapPickerCoord && mapPickerHasSelection) {
            markers.push({
                id: "map-picker-selected",
                latitude: mapPickerCoord.latitude,
                longitude: mapPickerCoord.longitude,
                markerStyle: "default",
                tintColor: routeUi.accentBlue,
                pinLabel: "선택",
                caption: "선택한 위치",
                zIndex: 40,
            });
        }
        return markers;
    }, [
        destination,
        mapPickerCoord,
        mapPickerHasSelection,
        origin,
        routeUi.accentBlue,
        routeUi.accentGreen,
        routeUi.accentRed,
    ]);
    const mapPickerTitle = "지도에서 위치 선택";
    const mapPickerOriginMissing = !placeHasCoords(origin);
    const mapPickerDestinationMissing = !placeHasCoords(destination);
    const mapPickerMissingTarget = mapPickerOriginMissing === mapPickerDestinationMissing
        ? undefined
        : mapPickerOriginMissing
            ? "출발지"
            : "도착지";
    const mapPickerInstruction = mapPickerHasSelection
        ? "이 위치를 어디로 설정할까요?"
        : mapPickerMissingTarget
            ? `${mapPickerMissingTarget}로 사용할 위치를 지도에서 탭하세요`
            : "지도에서 사용할 위치를 탭하세요";
    const mapPickerSelectionLabel = !mapPickerHasSelection
        ? "아직 선택한 위치가 없습니다"
        : mapPickerName ?? mapPickerAddress ?? (mapPickerCoord
            ? `${mapPickerCoord.latitude.toFixed(5)}, ${mapPickerCoord.longitude.toFixed(5)}`
            : "아직 선택한 위치가 없습니다");
    const mapPickerSheet = (
        <Modal
            visible={mapPickerVisible}
            animationType="slide"
            onRequestClose={closeMapPicker}
        >
            <View accessibilityViewIsModal style={[styles.mapPickerRoot, { backgroundColor: routeUi.background }]}>
                <TmapMapView
                    style={styles.mapPickerMap}
                    errorOverlayTop={Math.max(insets.top + 72, 104)}
                    camera={mapPickerCamera}
                    markers={mapPickerMarkers}
                    nightModeEnabled={isDark}
                    showLocationButton={false}
                    showZoomControls
                    onTapMap={selectMapPickerCoord}
                    fallbackBackgroundColor={routeUi.surface2}
                    fallbackTextColor={routeUi.textSecondary}
                />
                <View style={[styles.mapPickerHeader, { paddingTop: insets.top + 8 }]}>
                    <Pressable
                        onPress={closeMapPicker}
                        accessibilityRole="button"
                        accessibilityLabel="지도 선택 닫기"
                        style={[styles.mapPickerIconButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Text style={[styles.mapPickerBackText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={[styles.mapPickerTitleBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <Text numberOfLines={1} style={[styles.mapPickerTitle, { color: routeUi.textPrimary }]}>
                            {mapPickerTitle}
                        </Text>
                    </View>
                </View>
                <CalendarGlassSurface
                    prominent
                    variant="mapCard"
                    style={[
                        styles.mapPickerBottomSheet,
                        {
                            borderColor: routeUi.border,
                            paddingBottom: Math.max(insets.bottom + 14, 22),
                        },
                    ]}
                >
                    <Text style={[styles.mapPickerInstruction, { color: routeUi.textPrimary }]}>
                        {mapPickerInstruction}
                    </Text>
                    <View style={styles.mapPickerAddressRow}>
                        {mapPickerResolving ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="선택한 위치의 주소를 확인하고 있어요"
                            />
                        ) : (
                            <Ionicons name="location" size={17} color={routeUi.accentBlue} />
                        )}
                        <Text
                            numberOfLines={2}
                            accessibilityLiveRegion="polite"
                            style={[styles.mapPickerAddressText, { color: routeUi.textSecondary }]}
                        >
                            {mapPickerSelectionLabel}
                        </Text>
                    </View>
                    <MapPickerTargetActions
                        disabled={!mapPickerCoord || !mapPickerHasSelection || mapPickerResolving}
                        onConfirm={confirmMapPickerSelection}
                        colors={{
                            surface2: routeUi.surface2,
                            border: routeUi.border,
                            textPrimary: routeUi.textPrimary,
                            textDisabled: routeUi.textDisabled,
                            accentGreen: routeUi.accentGreen,
                            accentRed: routeUi.accentRed,
                        }}
                    />
                </CalendarGlassSurface>
            </View>
        </Modal>
    );

    if (isEditingRoutePoint) {
        return (
            <View style={[styles.screen, { backgroundColor: routeUi.background, paddingTop: insets.top + 10 }]}>
                <StatusBar barStyle={statusBarStyle} />
                {favoriteSaveSheet}
                {mapPickerSheet}
                <View style={styles.searchModeHeader}>
                    <Pressable
                        onPress={exitSearchMode}
                        accessibilityRole="button"
                        accessibilityLabel="장소 검색 닫기"
                        style={styles.searchModeBackButton}
                    >
                        <Text style={[styles.searchModeBackText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={[styles.searchModeSearchBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <View style={styles.searchModeTargetContext} accessible={false}>
                            <View
                                style={[
                                    styles.searchModeTargetDot,
                                    {
                                        borderColor: activeTarget === "origin"
                                            ? routeUi.accentGreen
                                            : routeUi.accentRed,
                                    },
                                ]}
                            />
                            <Text style={[styles.searchModeTargetText, { color: routeUi.textSecondary }]}>
                                {activeTargetLabel}
                            </Text>
                        </View>
                        <TextInput
                            autoFocus
                            value={activeSearchText}
                            onChangeText={(text) => handleSearchChange(activeTarget, text)}
                            accessibilityLabel={`${activeTargetLabel} 검색`}
                            accessibilityHint="장소 이름이나 주소를 입력하세요"
                            placeholder="장소명 또는 주소를 검색하세요"
                            placeholderTextColor={routeUi.inputPlaceholder}
                            selectionColor={routeUi.accentBlue}
                            returnKeyType="search"
                            textContentType="none"
                            autoComplete="off"
                            secureTextEntry={false}
                            style={[styles.searchModeInput, { color: routeUi.textPrimary }]}
                        />
                        {!!activeSearchText.trim() && (
                            <Pressable
                                onPress={() => handleSearchChange(activeTarget, "")}
                                accessibilityRole="button"
                                accessibilityLabel={`${activeTargetLabel} 검색어 지우기`}
                                style={[styles.searchModeClearButton, { backgroundColor: routeUi.clearButtonBg }]}
                            >
                                <Text style={[styles.searchModeClearText, { color: routeUi.clearButtonText }]}>×</Text>
                            </Pressable>
                        )}
                    </View>
                    <Pressable
                        onPress={goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 이동"
                        style={[styles.scheduleListIconButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="calendar-outline" size={20} color={routeUi.textPrimary} />
                    </Pressable>
                </View>

                {originUsesDefault && activeTarget === "destination" && (
                    <Pressable
                        onPress={editDefaultOrigin}
                        accessibilityRole="button"
                        accessibilityLabel={`기본 출발지 ${originText}, 변경`}
                        style={[
                            styles.defaultOriginBar,
                            { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                        ]}
                    >
                        <Ionicons name="location-outline" size={19} color={routeUi.accentBlue} />
                        <View style={styles.defaultOriginCopy}>
                            <Text style={[styles.defaultOriginLabel, { color: routeUi.textSecondary }]}>기본 출발지</Text>
                            <Text numberOfLines={1} style={[styles.defaultOriginName, { color: routeUi.textPrimary }]}>
                                {originText}
                            </Text>
                        </View>
                        <Text style={[styles.defaultOriginAction, { color: routeUi.accentBlue }]}>변경</Text>
                    </Pressable>
                )}

                {activeTarget === "origin" && favoritePlacesLoaded && !favoritePlacesError && !hasConfiguredDefaultOrigin && (
                    <Pressable
                        onPress={openPlaceSettings}
                        accessibilityRole="button"
                        accessibilityLabel="기본 출발지 설정"
                        accessibilityHint="내 장소 관리 화면에서 기본 출발지를 설정합니다"
                        style={[
                            styles.defaultOriginSetupBar,
                            { backgroundColor: routeUi.selectedModeBg, borderColor: routeUi.selectedBorder },
                        ]}
                    >
                        <View style={[styles.defaultOriginSetupIcon, { backgroundColor: routeUi.surface }]}>
                            <Ionicons name="home-outline" size={19} color={routeUi.accentBlue} />
                        </View>
                        <View style={styles.defaultOriginCopy}>
                            <Text style={[styles.defaultOriginSetupTitle, { color: routeUi.textPrimary }]}>기본 출발지가 없어요</Text>
                            <Text numberOfLines={2} style={[styles.defaultOriginSetupDescription, { color: routeUi.textSecondary }]}>
                                자주 출발하는 장소를 설정하면 다음부터 자동으로 입력돼요
                            </Text>
                        </View>
                        <Text style={[styles.defaultOriginAction, { color: routeUi.accentBlue }]}>설정</Text>
                    </Pressable>
                )}

                <View style={styles.searchModeActionRow}>
                    <Pressable
                        onPress={applyCurrentLocationToActiveTarget}
                        accessibilityRole="button"
                        accessibilityLabel={`${activeTargetLabel}를 현재 위치로 설정`}
                        accessibilityState={{
                            busy: currentLocationPending,
                            disabled: currentLocationPending,
                        }}
                        disabled={currentLocationPending}
                        style={[styles.searchModeActionButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        {currentLocationPending ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="현재 위치를 확인하고 있어요"
                            />
                        ) : (
                            <Ionicons name="navigate-outline" size={22} color={routeUi.accentBlue} />
                        )}
                        <Text style={[styles.searchModeActionText, { color: routeUi.accentBlue }]}>내 위치</Text>
                    </Pressable>
                    <Pressable
                        onPress={openMapForPointSelection}
                        accessibilityRole="button"
                        accessibilityLabel="지도에서 출발지 또는 도착지 선택"
                        style={[styles.searchModeActionButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="map-outline" size={23} color={routeUi.textSecondary} />
                        <Text style={[styles.searchModeActionText, { color: routeUi.textSecondary }]}>지도에서 선택</Text>
                    </Pressable>
                </View>

                <ScrollView
                    directionalLockEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[styles.searchModeContent, { paddingBottom: Math.max(insets.bottom + 24, 36) }]}
                >
                    {showingSearchResults ? (
                        <View style={styles.searchModePanel}>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>검색 결과</Text>
                            </View>
                            {searching && (
                                <View style={styles.searchingRow}>
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="주소를 검색하고 있어요"
                                    />
                                    <Text style={[styles.searchingText, { color: routeUi.textSecondary }]}>주소 검색 중...</Text>
                                </View>
                            )}
                            {!searching && searchError && (
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        주소 검색에 실패했습니다. 네트워크를 확인해 주세요.
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="주소 다시 검색"
                                        onPress={() => handleSearchChange(activeTarget, activeSearchText)}
                                        style={[styles.emptyRetryButton, { backgroundColor: routeUi.accentBlue }]}
                                    >
                                        <Ionicons name="refresh" size={15} color="#FFFFFF" />
                                        <Text style={styles.emptyRetryText}>다시 검색</Text>
                                    </Pressable>
                                </View>
                            )}
                            {!searching && !searchError && searchResults.length === 0 && (
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        검색 결과가 없습니다.
                                    </Text>
                                </View>
                            )}
                            {searchResults.slice(0, 10).map((item, index) => {
                                const resultPlace = buildPlaceFromSearchItem(item);
                                const resultIcon = resolvePlaceListIcon({ ...resultPlace, category: item.category });
                                const savingKey = getPlaceActionKey(resultPlace);
                                const isSaving = favoriteSavingKey === savingKey;
                                const savedFavorite = findMatchingFavoritePlace(resultPlace, favoritePlaces);

                                return (
                                    <View
                                        key={`${item.lat}:${item.lng}:${index}`}
                                        style={[
                                            styles.searchModeResultRow,
                                            { borderColor: routeUi.border, backgroundColor: routeUi.surface },
                                        ]}
                                    >
                                        <Pressable
                                            onPress={() => applyPlace(activeTarget, item)}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${item.name}, ${item.address || "주소 정보 없음"}`}
                                            style={styles.searchModeResultMain}
                                        >
                                            <View style={[styles.searchModeListIcon, { backgroundColor: routeUi.surface2 }]}>
                                                <Ionicons name={resultIcon} size={18} color={routeUi.textSecondary} />
                                            </View>
                                            <View style={styles.searchModeResultTextWrap}>
                                                <Text numberOfLines={1} style={[styles.searchResultTitle, { color: routeUi.textPrimary }]}>
                                                    {item.name}
                                                </Text>
                                                {!!(item.category || formatSearchResultDistance(item.distanceMeters)) && (
                                                    <Text numberOfLines={1} style={styles.searchResultCategory}>
                                                        {[item.category, formatSearchResultDistance(item.distanceMeters)].filter(Boolean).join(" · ")}
                                                    </Text>
                                                )}
                                                <Text numberOfLines={1} style={[styles.searchResultAddress, { color: routeUi.textSecondary }]}>
                                                    {item.address}
                                                </Text>
                                            </View>
                                        </Pressable>
                                        <Pressable
                                            onPress={() => savedFavorite
                                                ? removePlaceFromFavorites(savedFavorite, resultPlace)
                                                : openFavoriteSaveSheet(resultPlace)}
                                            disabled={Boolean(favoriteSavingKey)}
                                            accessibilityRole="button"
                                            accessibilityLabel={savedFavorite
                                                ? `${item.name} 즐겨찾기 해제`
                                                : `${item.name} 즐겨찾기에 저장`}
                                            accessibilityState={{ disabled: Boolean(favoriteSavingKey) }}
                                            style={styles.searchModeFavoriteButton}
                                        >
                                            {isSaving ? (
                                                <BrandedLoader
                                                    size="button"
                                                    variant="route"
                                                    accessibilityLabel="즐겨찾기를 저장하고 있어요"
                                                />
                                            ) : (
                                                <Ionicons
                                                    name={savedFavorite ? "star" : "star-outline"}
                                                    size={21}
                                                    color={savedFavorite ? routeUi.accentBlue : routeUi.textSecondary}
                                                />
                                            )}
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                    ) : (
                        <View style={styles.searchModePanel}>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>즐겨찾기</Text>
                                <Pressable
                                    onPress={openPlaceSettings}
                                    accessibilityRole="button"
                                    accessibilityLabel="내 장소 관리"
                                    style={styles.favoriteManageButton}
                                >
                                    <Ionicons name="options-outline" size={15} color={routeUi.accentBlue} />
                                    <Text style={[styles.searchModeEditText, { color: routeUi.accentBlue }]}>관리</Text>
                                </Pressable>
                            </View>
                            {!!favoritePlacesError && (
                                <View
                                    style={[
                                        styles.favoriteLoadErrorRow,
                                        { backgroundColor: routeUi.surface2, borderColor: routeUi.border },
                                    ]}
                                >
                                    <Text style={[styles.favoriteLoadErrorText, { color: routeUi.textSecondary }]}>
                                        {favoritePlacesError}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="즐겨찾기 다시 불러오기"
                                        hitSlop={6}
                                        onPress={() => setFavoriteReloadVersion((current) => current + 1)}
                                        style={[
                                            styles.favoriteRetryButton,
                                            { backgroundColor: routeUi.surface, borderColor: routeUi.borderStrong },
                                        ]}
                                    >
                                        <Ionicons name="refresh" size={14} color={routeUi.accentBlue} />
                                        <Text style={[styles.favoriteRetryText, { color: routeUi.accentBlue }]}>다시 시도</Text>
                                    </Pressable>
                                </View>
                            )}
                            <ScrollView
                                horizontal
                                directionalLockEnabled
                                keyboardShouldPersistTaps="handled"
                                showsHorizontalScrollIndicator={false}
                                style={styles.favoriteFilterScroll}
                                contentContainerStyle={styles.favoriteFilterContent}
                            >
                                {favoritePlaceTabs.map((tab) => {
                                    const selected = selectedFavoriteFilterId === tab.id;
                                    const tabLabel = tab.kind === "default-address" ? "기본 주소" : tab.name;
                                    const tabColor = tab.kind === "default-address"
                                        ? routeUi.accentBlue
                                        : tab.color ?? routeUi.textSecondary;
                                    return (
                                    <Pressable
                                        key={tab.id}
                                        onPress={() => toggleFavoriteFilter(tab.id)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${tabLabel} 즐겨찾기`}
                                        accessibilityHint={selected
                                            ? "다시 누르면 장소 목록을 접습니다"
                                            : "누르면 장소 목록을 펼칩니다"}
                                        accessibilityState={{ selected, expanded: selected }}
                                        style={[
                                            styles.favoriteFilterChip,
                                            {
                                                backgroundColor: selected
                                                    ? routeUi.selectedModeBg
                                                    : routeUi.surface2,
                                                borderColor: selected ? tabColor : routeUi.border,
                                            },
                                        ]}
                                    >
                                        {tab.kind === "default-address" ? (
                                            <Ionicons
                                                name={selected ? "home" : "home-outline"}
                                                size={14}
                                                color={selected ? routeUi.accentBlue : routeUi.textSecondary}
                                            />
                                        ) : (
                                            <View style={[styles.favoriteCategoryDot, { backgroundColor: tabColor }]} />
                                        )}
                                        <Text style={[
                                            styles.favoriteFilterChipText,
                                            {
                                                color: selected
                                                    ? (tab.kind === "default-address"
                                                        ? routeUi.accentBlue
                                                        : routeUi.textPrimary)
                                                    : routeUi.textSecondary,
                                            },
                                        ]}>
                                            {tabLabel}
                                        </Text>
                                        <FavoriteFilterSelectionIndicator
                                            selected={selected}
                                            color={tabColor}
                                            reduceMotionEnabled={reduceFavoriteMotionEnabled}
                                        />
                                    </Pressable>
                                    );
                                })}
                            </ScrollView>
                            <Animated.View style={[styles.favoritePanelClip, favoritePanelAnimatedStyle]}>
                            {visibleFavoritePlaces.map((place, index) => {
                                const favoriteIcon = place.defaultOrigin ? "home-outline" : resolvePlaceListIcon(place);
                                const isDefaultSaving = defaultOriginSavingKey === getPlaceActionKey(place);
                                const isFavoriteSaving = favoriteSavingKey === getPlaceActionKey(place);
                                const categoryColor = place.defaultOrigin
                                    ? undefined
                                    : getFavoritePlaceCategoryColor(place, favoriteCategories);
                                const categoryName = place.defaultOrigin || !place.categoryName
                                    ? undefined
                                    : getFavoritePlaceCategoryDisplayName(place.categoryName);
                                return (
                                    <View
                                        key={place.id ?? `${place.lat ?? "x"}:${place.lng ?? "x"}:${index}`}
                                        style={[
                                            styles.searchModeRecentRow,
                                            { borderColor: routeUi.border, backgroundColor: routeUi.surface },
                                        ]}
                                    >
                                        <Pressable
                                            onPress={() => applyRecentPlaceToActiveTarget(place)}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${getPlaceDisplayText(place)}, 즐겨찾기 장소 선택`}
                                            style={styles.searchModeRecentMain}
                                        >
                                            <View
                                                style={[
                                                    styles.searchModeListIcon,
                                                    styles.favoriteListIcon,
                                                    {
                                                        backgroundColor: routeUi.surface2,
                                                        borderColor: categoryColor ?? "transparent",
                                                    },
                                                ]}
                                            >
                                                <Ionicons
                                                    name={favoriteIcon}
                                                    size={18}
                                                    color={place.defaultOrigin ? routeUi.accentBlue : routeUi.textSecondary}
                                                />
                                            </View>
                                            <View style={styles.searchModeResultTextWrap}>
                                                <View style={styles.favoriteTitleRow}>
                                                    <Text
                                                        numberOfLines={1}
                                                        style={[styles.recentPlaceTitle, styles.favoriteTitle, { color: routeUi.textPrimary }]}
                                                    >
                                                        {getPlaceDisplayText(place)}
                                                    </Text>
                                                    {place.defaultOrigin && (
                                                        <View style={[styles.defaultOriginBadge, { backgroundColor: routeUi.selectedModeBg }]}>
                                                            <Text style={[styles.defaultOriginBadgeText, { color: routeUi.accentBlue }]}>기본</Text>
                                                        </View>
                                                    )}
                                                </View>
                                                {!!(categoryName || place.address) && (
                                                    <View style={styles.favoriteMetaRow}>
                                                        {!!categoryColor && (
                                                            <View style={[styles.favoriteCategoryDot, { backgroundColor: categoryColor }]} />
                                                        )}
                                                        <Text
                                                            numberOfLines={1}
                                                            style={[styles.recentPlaceAddress, styles.favoriteMetaText, { color: routeUi.textSecondary }]}
                                                        >
                                                            {[categoryName, place.address].filter(Boolean).join(" · ")}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                        </Pressable>
                                        <View style={styles.favoriteRowActions}>
                                            {place.defaultOrigin ? (
                                                <View
                                                    accessibilityRole="image"
                                                    accessibilityLabel={`${getPlaceDisplayText(place)} 기본 출발지`}
                                                    style={styles.searchModeFavoriteButton}
                                                >
                                                    <Ionicons name="home" size={20} color={routeUi.accentBlue} />
                                                </View>
                                            ) : activeTarget === "origin" ? (
                                                <Pressable
                                                    onPress={() => setFavoriteAsDefaultOrigin(place)}
                                                    disabled={Boolean(defaultOriginSavingKey) || Boolean(favoriteSavingKey)}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${getPlaceDisplayText(place)} 기본 출발지로 설정`}
                                                    accessibilityState={{
                                                        disabled: Boolean(defaultOriginSavingKey) || Boolean(favoriteSavingKey),
                                                    }}
                                                    style={styles.searchModeFavoriteButton}
                                                >
                                                    {isDefaultSaving ? (
                                                        <BrandedLoader
                                                            size="button"
                                                            variant="route"
                                                            accessibilityLabel="기본 출발지를 저장하고 있어요"
                                                        />
                                                    ) : (
                                                        <Ionicons name="home-outline" size={20} color={routeUi.textSecondary} />
                                                    )}
                                                </Pressable>
                                            ) : null}
                                            <Pressable
                                                onPress={() => removePlaceFromFavorites(place)}
                                                disabled={Boolean(favoriteSavingKey) || Boolean(defaultOriginSavingKey)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 즐겨찾기 해제`}
                                                accessibilityState={{
                                                    disabled: Boolean(favoriteSavingKey) || Boolean(defaultOriginSavingKey),
                                                }}
                                                style={styles.searchModeFavoriteButton}
                                            >
                                                {isFavoriteSaving ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel="즐겨찾기를 해제하고 있어요"
                                                    />
                                                ) : (
                                                    <Ionicons name="star" size={21} color={routeUi.accentBlue} />
                                                )}
                                            </Pressable>
                                        </View>
                                    </View>
                                );
                            })}
                            {selectedFavoriteFilterId === DEFAULT_ADDRESS_FAVORITE_TAB_ID
                                && favoritePlacesLoaded
                                && !favoritePlacesError
                                && !hasConfiguredDefaultOrigin && (
                                <Pressable
                                    onPress={openPlaceSettings}
                                    accessibilityRole="button"
                                    accessibilityLabel="기본 주소 설정"
                                    accessibilityHint="내 장소 관리 화면에서 기본 주소를 설정합니다"
                                    style={[
                                        styles.defaultOriginSetupBar,
                                        { backgroundColor: routeUi.selectedModeBg, borderColor: routeUi.selectedBorder },
                                    ]}
                                >
                                    <View style={[styles.defaultOriginSetupIcon, { backgroundColor: routeUi.surface }]}>
                                        <Ionicons name="home-outline" size={19} color={routeUi.accentBlue} />
                                    </View>
                                    <View style={styles.defaultOriginCopy}>
                                        <Text style={[styles.defaultOriginSetupTitle, { color: routeUi.textPrimary }]}>기본 주소가 없어요</Text>
                                        <Text numberOfLines={2} style={[styles.defaultOriginSetupDescription, { color: routeUi.textSecondary }]}>
                                            자주 출발하는 장소를 기본 주소로 설정해 보세요
                                        </Text>
                                    </View>
                                    <Text style={[styles.defaultOriginAction, { color: routeUi.accentBlue }]}>설정</Text>
                                </Pressable>
                            )}
                            {!!selectedFavoriteFilterId
                                && visibleFavoritePlaces.length === 0
                                && !favoritePlacesError
                                && (
                                    selectedFavoriteFilterId !== DEFAULT_ADDRESS_FAVORITE_TAB_ID
                                    || !favoritePlacesLoaded
                                ) && (
                                <View style={styles.favoriteEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        {!favoritePlacesLoaded
                                            ? "즐겨찾기를 불러오는 중입니다."
                                            : "이 장소 그룹에 저장된 즐겨찾기가 없습니다."}
                                    </Text>
                                </View>
                            )}
                            </Animated.View>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>최근 검색</Text>
                            </View>
                            {visibleRecentPlaces.length > 0 ? (
                                visibleRecentPlaces.map((place, index) => {
                                    const recentIcon = resolvePlaceListIcon(place);
                                    const savingKey = getPlaceActionKey(place);
                                    const isSaving = favoriteSavingKey === savingKey;

                                    return (
                                        <View
                                            key={`${place.lat ?? "x"}:${place.lng ?? "x"}:${place.name ?? ""}:${index}`}
                                            style={[
                                                styles.searchModeRecentRow,
                                                { borderColor: routeUi.border, backgroundColor: routeUi.surface },
                                            ]}
                                        >
                                            <Pressable
                                                onPress={() => applyRecentPlaceToActiveTarget(place)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)}, 최근 장소 선택`}
                                                style={styles.searchModeRecentMain}
                                            >
                                                <View style={[styles.searchModeListIcon, { backgroundColor: routeUi.surface2 }]}>
                                                    <Ionicons name={recentIcon} size={18} color={routeUi.textSecondary} />
                                                </View>
                                                <View style={styles.searchModeResultTextWrap}>
                                                    <Text numberOfLines={1} style={[styles.recentPlaceTitle, { color: routeUi.textPrimary }]}>
                                                        {getPlaceDisplayText(place)}
                                                    </Text>
                                                    {!!place.address && (
                                                        <Text numberOfLines={1} style={[styles.recentPlaceAddress, { color: routeUi.textSecondary }]}>
                                                            {place.address}
                                                        </Text>
                                                    )}
                                                </View>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => openFavoriteSaveSheet(place)}
                                                disabled={Boolean(favoriteSavingKey)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 즐겨찾기에 저장`}
                                                accessibilityState={{ disabled: Boolean(favoriteSavingKey) }}
                                                style={styles.searchModeFavoriteButton}
                                            >
                                                {isSaving ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel="즐겨찾기를 저장하고 있어요"
                                                    />
                                                ) : (
                                                    <Ionicons
                                                        name="star-outline"
                                                        size={21}
                                                        color={routeUi.textSecondary}
                                                    />
                                                )}
                                            </Pressable>
                                            <Pressable
                                                onPress={() => removeRecentPlace(place)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${getPlaceDisplayText(place)} 최근 검색에서 삭제`}
                                                style={styles.searchModeRemoveButton}
                                            >
                                                <Text style={[styles.searchModeRemoveText, { color: routeUi.textSecondary }]}>×</Text>
                                            </Pressable>
                                        </View>
                                    );
                                })
                            ) : (
                                <View style={styles.searchModeEmptyRow}>
                                    <Text style={[styles.recentEmptyText, { color: routeUi.textSecondary }]}>
                                        {recentPlaces.length > 0
                                            ? "즐겨찾기에 저장된 장소를 제외한 최근 검색이 없습니다."
                                            : "최근 검색 내역이 없습니다."}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}
                </ScrollView>
            </View>
        );
    }

    return (
        <View
            style={[
                styles.screen,
                {
                    backgroundColor: routeUi.background,
                    paddingTop: shouldShowRouteResults ? Math.max(insets.top - 10, 24) : insets.top + 8,
                },
            ]}
        >
            <StatusBar barStyle={statusBarStyle} />
            {favoriteSaveSheet}
            {mapPickerSheet}
            {!shouldShowRouteResults && (
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel="이동 경로 화면 닫기"
                        style={[styles.headerButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                    >
                        <Text style={[styles.headerButtonText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={styles.headerTitleWrap}>
                        <Text style={[styles.headerTitle, { color: routeUi.textPrimary }]}>이동 경로</Text>
                        <Text style={[styles.headerSubtitle, { color: routeUi.textSecondary }]}>
                            출발지와 도착지를 입력하고 경로를 선택하세요
                        </Text>
                    </View>
                    <Pressable
                        onPress={goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 이동"
                        style={[styles.headerScheduleButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="calendar-outline" size={17} color={routeUi.textPrimary} />
                        <Text style={[styles.headerScheduleButtonText, { color: routeUi.textPrimary }]}>일정</Text>
                    </Pressable>
                </View>
            )}

            <ScrollView
                directionalLockEnabled
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.content, { paddingBottom: routeListBottomPadding }]}
            >
                {!shouldShowRouteResults && (
                    <View style={[styles.routeCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <View style={styles.routeInputRows}>
                            <View style={styles.routeRail}>
                                <View style={[styles.routeDot, { borderColor: routeUi.accentGreen, backgroundColor: "transparent" }]} />
                                <View style={[styles.routeRailLine, { backgroundColor: routeUi.border }]} />
                                <View style={[styles.routeDot, { borderColor: routeUi.accentRed, backgroundColor: "transparent" }]} />
                            </View>
                            <View style={styles.routeInputs}>
                                <TextInput
                                    value={originText}
                                    onFocus={() => {
                                        routePointUiRevisionRef.current += 1;
                                        setActiveTarget("origin");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("origin", text)}
                                    accessibilityLabel="출발지 검색"
                                    accessibilityHint="장소 이름이나 주소를 입력하세요"
                                    placeholder="출발지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    textContentType="none"
                                    autoComplete="off"
                                    secureTextEntry={false}
                                    style={[styles.routeInput, { color: routeUi.textPrimary, borderBottomColor: routeUi.inputBorder }]}
                                />
                                <TextInput
                                    value={destinationText}
                                    onFocus={() => {
                                        routePointUiRevisionRef.current += 1;
                                        setActiveTarget("destination");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("destination", text)}
                                    accessibilityLabel="도착지 검색"
                                    accessibilityHint="장소 이름이나 주소를 입력하세요"
                                    placeholder="도착지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    textContentType="none"
                                    autoComplete="off"
                                    secureTextEntry={false}
                                    style={[styles.routeInput, { color: routeUi.textPrimary }]}
                                />
                            </View>
                            <Pressable
                                onPress={swapPlaces}
                                accessibilityRole="button"
                                accessibilityLabel="출발지와 도착지 바꾸기"
                                style={[styles.swapButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                            >
                                <Text style={[styles.swapButtonText, { color: routeUi.textSecondary }]}>⇅</Text>
                            </Pressable>
                        </View>

                    </View>
                )}

                {shouldShowRouteResults && (
                    <View style={styles.routeResultHeaderRow}>
                        <RouteEndpointReselectCard
                            originText={originText}
                            destinationText={destinationText}
                            onEditOrigin={() => openRoutePointEditor("origin")}
                            onEditDestination={() => openRoutePointEditor("destination")}
                            onSwap={swapPlaces}
                            colors={{
                                surface: routeUi.surface,
                                surface2: routeUi.surface2,
                                border: routeUi.border,
                                textPrimary: routeUi.textPrimary,
                                textSecondary: routeUi.textSecondary,
                                accentGreen: routeUi.accentGreen,
                                accentRed: routeUi.accentRed,
                            }}
                            style={styles.routeCompactCardInHeader}
                        />
                        <Pressable
                            onPress={goToScheduleList}
                            accessibilityRole="button"
                            accessibilityLabel="일정 목록으로 이동"
                            style={[styles.routeResultScheduleButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                        >
                            <Ionicons name="calendar-outline" size={20} color={routeUi.textPrimary} />
                            <Text style={[styles.routeResultScheduleButtonText, { color: routeUi.textSecondary }]}>일정</Text>
                        </Pressable>
                    </View>
                )}

                {shouldShowRouteResults && (
                <View style={styles.modeRow}>
                    {SELECTABLE_TRAVEL_MODES.map((modeItem) => {
                        const selected = travelMode === modeItem;
                        return (
                            <AnimatedTravelModeButton
                                key={modeItem}
                                selected={selected}
                                label={TRAVEL_MODE_META[modeItem].label}
                                iconName={TRAVEL_MODE_ICONS[modeItem] ?? "navigate"}
	                                backgroundColor={selected ? routeUi.selectedModeBg : "transparent"}
                                borderColor={selected ? "rgba(41,121,255,0.95)" : "transparent"}
                                textColor={selected ? routeUi.accentBlue : routeUi.textSecondary}
                                onPress={() => selectTravelMode(modeItem)}
                            />
                        );
                    })}
                </View>
                )}

                {shouldShowRouteResults && (
                    <Animated.View style={routeContentAnimatedStyle}>
                {hasTransitFilters && (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
	                        contentContainerStyle={[styles.transitFilterRow, { borderBottomColor: routeUi.border }]}
                    >
                        {TRANSIT_FILTER_ITEMS.map((item) => {
                            const selected = transitRouteFilter === item.key;
                            const count = transitFilterCounts[item.key];
                            const disabled = item.key !== "ALL" && count === 0;
                            const label = item.key === "ALL" ? item.label : `${item.label} ${count}`;
                            return (
                                <AnimatedTransitFilterButton
                                    key={item.key}
                                    onPress={() => selectTransitFilter(item.key)}
                                    disabled={disabled}
                                    selected={selected}
                                    label={label}
                                    textColor={selected ? routeUi.textPrimary : routeUi.textSecondary}
                                    accentColor={routeUi.accentBlue}
                                />
                            );
                        })}
                    </ScrollView>
                )}

                {hasTransitFilters && visibleRouteAlternatives.length > 0 && (
                    <View style={styles.currentRouteNotice}>
                        <View style={styles.currentRouteTimeGroup}>
                            <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>
                                {routeScheduleBased ? "일정" : "현재 시간"}
                            </Text>
                            <Text style={[styles.currentRouteNoticeTimeText, { color: routeUi.accentBlue }]}>
                                {routeScheduleBased && routeTargetArrivalAt
                                    ? `${formatScheduleRouteNoticeTime(routeTargetArrivalAt)} 도착`
                                    : formatCurrentRouteNoticeTime(routeDepartureAt)}
                            </Text>
                            <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>
                                기준
                            </Text>
                        </View>
                        <View accessibilityLabel="추천 경로순" style={styles.currentRouteSortGroup}>
                            <Text style={[styles.currentRouteSortText, { color: routeUi.textSecondary }]}>
                                추천 경로순
                            </Text>
                        </View>
                    </View>
                )}

                    <View style={styles.routeList}>
                    {hasRouteCoords && routeLoading && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <BrandedLoader
                                size="section"
                                variant="route"
                                accessibilityLabel="경로를 계산하고 있어요"
                            />
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>경로 계산 중...</Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !!routeError && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>{routeError}</Text>
                            <Pressable
                                onPress={retryRouteSearch}
                                accessibilityRole="button"
                                accessibilityLabel="경로 다시 검색"
                                style={[styles.emptyRetryButton, { backgroundColor: routeUi.accentBlue }]}
                            >
                                <Ionicons name="refresh" size={15} color="#FFFFFF" />
                                <Text style={styles.emptyRetryText}>다시 검색</Text>
                            </Pressable>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.length === 0 && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>
                                선택한 교통수단에 해당하는 경로가 없습니다.
                            </Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.map((option, displayIndex) => {
                        const selected = selectedRouteId === option.id;
                        const routeInfo = buildRouteInfoFromAlternative(
                            option,
                            origin ?? undefined,
                            destination ?? undefined,
                            routeDepartureAt,
                            displayIndex
                        );
                        const progressSegments = buildRouteProgressSegments(option);
                        const routeMetricChips = buildRouteMetricChips(option);
                        const accent = selected ? routeUi.selectedBorder : routeUi.border;
                        const cardBackground = selected ? routeUi.selectedSurface : routeUi.surface;
                        const routeTimeFare = formatRouteTimeFare(option, routeDepartureAt);
                        const routeBoardingSummary = buildRouteBoardingSummary(option, originText);
                        const dropdownSummaryItems = buildRouteDropdownSummaryItems(
                            option,
                            originText,
                            destinationText
                        );
                        const selectRoute = () => {
                            configureRouteExpansionAnimation();
                            setSelectedRouteId(option.id);
                        };
                        return (
                            <View key={option.id} style={styles.routeCandidateItem}>
                                <AnimatedRouteCardShell
                                    selected={selected}
                                    style={[
                                        styles.routeOptionCard,
                                        {
                                            backgroundColor: cardBackground,
                                            borderColor: accent,
                                        },
	                                        selected
	                                            ? (isDark ? styles.routeOptionCardSelectedDark : styles.routeOptionCardSelectedLight)
	                                            : styles.routeOptionCardInactive,
	                                    ]}
	                                >
	                                    <Pressable
                                            onPress={selectRoute}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${formatRouteInfoDuration(routeInfo.totalDurationMinutes)} 경로`}
                                            accessibilityState={{ selected, expanded: selected }}
                                            style={styles.routeOptionPressable}
                                        >
                                        <View style={styles.routeOptionHeader}>
                                            <View style={styles.routeOptionHeaderRow}>
                                                <View style={styles.routeOptionTitleMetaRow}>
                                                    <View
                                                        style={[
                                                            styles.routeOptionLabelPill,
                                                            { backgroundColor: selected ? routeUi.selectedBorder : routeUi.surface2 },
                                                        ]}
                                                    >
                                                        {selected && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
                                                        <Text style={[styles.routeOptionLabel, { color: selected ? "#FFFFFF" : routeUi.textSecondary }]}>
                                                            {getNaverLikeRouteRecommendationLabel(
                                                                option,
                                                                visibleRouteAlternatives,
                                                                displayIndex
                                                            )}
                                                        </Text>
                                                    </View>
                                                    {!!routeTimeFare && (
                                                        <Text numberOfLines={1} style={[styles.routeOptionTimeFare, { color: routeUi.textSecondary }]}>
                                                            {routeTimeFare}
                                                        </Text>
                                                    )}
                                                </View>
                                                <View style={styles.routeOptionDurationWrap}>
                                                    <Text numberOfLines={1} style={[styles.routeOptionDuration, { color: routeUi.textPrimary }]}>
                                                        {formatRouteInfoDuration(routeInfo.totalDurationMinutes)}
                                                    </Text>
                                                </View>
                                            </View>
                                            {routeMetricChips.length > 0 && <View style={styles.routeMetricRow}>
                                                {routeMetricChips.map((metric) => {
                                                    return (
                                                        <View
                                                            key={`${option.id}-${metric.key}`}
                                                            style={[
                                                                styles.routeMetricChip,
                                                                {
                                                                    backgroundColor: routeUi.neutralChipBg,
                                                                    borderColor: routeUi.neutralChipBorder,
                                                                },
                                                            ]}
                                                        >
                                                            <Text
                                                                numberOfLines={1}
                                                                style={[
                                                                    styles.routeMetricText,
                                                                    { color: routeUi.textSecondary },
                                                                ]}
                                                            >
                                                                {metric.label}
                                                            </Text>
                                                        </View>
                                                    );
                                                })}
                                            </View>}
                                            {progressSegments.length > 0 && (
                                                <TransitRouteProgressBar
                                                    segments={progressSegments}
                                                    isDark={isDark}
                                                    compact
                                                />
	                                        )}
	                                            {!selected && !!routeBoardingSummary && (
	                                                <View
	                                                    style={[styles.routeBoardingSummaryRow, { borderTopColor: routeUi.border }]}
	                                                >
	                                                    <Ionicons name="navigate-circle-outline" size={17} color={routeUi.textSecondary} />
	                                                    <Text
	                                                        numberOfLines={1}
	                                                        style={[styles.routeBoardingSummaryText, { color: routeUi.textSecondary }]}
	                                                    >
	                                                        {routeBoardingSummary}
	                                                    </Text>
	                                                </View>
	                                            )}
	                                        </View>
									</Pressable>
                                    {selected && dropdownSummaryItems.length > 0 && (
                                        <AnimatedRouteExpansion
                                            style={[
                                                styles.routeOptionExpansion,
                                                { borderTopColor: routeUi.border },
                                            ]}
                                        >
                                            <View style={styles.routeDropdownSummaryList}>
                                                {dropdownSummaryItems.map((summary, summaryIndex) => {
                                                    const isRide = isRideLegKind(summary.kind);
                                                    const itemColor = summary.color ??
                                                        (summary.kind === "TRANSFER"
                                                            ? routeUi.textSecondary
                                                            : routeUi.borderStrong);
                                                    const iconName: React.ComponentProps<typeof Ionicons>["name"] =
                                                        summary.kind === "SUBWAY"
                                                            ? "train"
                                                            : summary.kind === "BUS"
                                                                ? "bus"
                                                                : summary.kind === "TRANSFER"
                                                                    ? "swap-horizontal"
                                                                    : summary.kind === "WALK"
                                                                        ? "walk"
                                                                        : "navigate-outline";
                                                    return (
                                                        <View key={summary.key} style={styles.routeDropdownSummaryRow}>
                                                            <View style={styles.routeDropdownMarkerColumn}>
                                                                <View
                                                                    style={[
                                                                        styles.routeDropdownIcon,
                                                                        {
                                                                            borderColor: itemColor,
                                                                            backgroundColor: isRide ? itemColor : "transparent",
                                                                        },
                                                                    ]}
                                                                >
                                                                    <Ionicons
                                                                        name={iconName}
                                                                        size={14}
                                                                        color={isRide ? "#FFFFFF" : itemColor}
                                                                    />
                                                                </View>
                                                                {summaryIndex < dropdownSummaryItems.length - 1 && (
                                                                    <View
                                                                        style={[
                                                                            styles.routeDropdownConnector,
                                                                            { backgroundColor: itemColor },
                                                                        ]}
                                                                    />
                                                                )}
                                                            </View>
                                                            <View style={styles.routeDropdownStepTextWrap}>
                                                                <Text
                                                                    numberOfLines={1}
                                                                    style={[
                                                                        styles.routeDropdownStepLine,
                                                                        { color: isRide ? itemColor : routeUi.textPrimary },
                                                                    ]}
                                                                >
                                                                    {summary.title}
                                                                </Text>
                                                                {!!summary.subtitle && (
                                                                    <Text
                                                                        numberOfLines={1}
                                                                        style={[
                                                                            styles.routeDropdownStepMeta,
                                                                            { color: routeUi.textSecondary },
                                                                        ]}
                                                                    >
                                                                        {summary.subtitle}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                        </AnimatedRouteExpansion>
                                    )}
                                    {shouldShowRequiredMapAttribution(option) && !!option.attributionText && !!option.attributionUrl && (
                                        <Pressable
                                            accessibilityRole="link"
                                            accessibilityLabel={`${option.attributionText} 지도 정보 열기`}
                                            onPress={() => openRouteAttribution(option)}
                                            style={[styles.routeAttributionLink, { borderTopColor: routeUi.border }]}
                                        >
                                            <Text style={[styles.routeAttributionText, { color: routeUi.textSecondary }]}>
                                                {option.attributionText} · 지도 수정
                                            </Text>
                                            <Ionicons name="open-outline" size={13} color={routeUi.textSecondary} />
                                        </Pressable>
                                    )}
									{selected && (
                                        <View
                                            style={[
                                                styles.routeCardActions,
                                                { borderTopColor: routeUi.border },
                                            ]}
                                        >
                                            <Pressable
                                                onPress={() => openMapForOption(option)}
                                                accessibilityRole="button"
                                                accessibilityLabel="경로 상세 보기"
                                                style={[
                                                    styles.routeCardSecondaryButton,
                                                    {
                                                        backgroundColor: routeUi.surface,
                                                        borderColor: routeUi.border,
                                                    },
                                                ]}
                                            >
                                                <Ionicons name="map-outline" size={15} color={routeUi.textPrimary} />
                                                <Text style={[styles.routeCardSecondaryButtonText, { color: routeUi.textPrimary }]}>
                                                    경로 상세 보기
                                                </Text>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => saveRouteOption(option, displayIndex)}
                                                disabled={routeSubmitPending}
                                                accessibilityRole="button"
                                                accessibilityLabel="이 경로 저장"
                                                accessibilityState={{
                                                    busy: routeSubmitPending,
                                                    disabled: routeSubmitPending,
                                                }}
                                                style={[
                                                    styles.routeCardPrimaryButton,
                                                    {
                                                        backgroundColor: routeUi.accentBlue,
                                                        opacity: routeSubmitPending ? 0.58 : 1,
                                                    },
                                                ]}
                                            >
                                                {routeSubmitPending ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel="선택한 경로를 저장하고 있어요"
                                                    />
                                                ) : (
                                                    <Text style={styles.routeCardPrimaryButtonText}>
                                                        이 경로로 저장
                                                    </Text>
                                                )}
                                            </Pressable>
                                        </View>
                                    )}
	                                </AnimatedRouteCardShell>
	                            </View>
                        );
                    })}
                    </View>
                    </Animated.View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    headerButton: {
        width: 42,
        height: 42,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    headerButtonText: {
        marginTop: -3,
        fontSize: 38,
        fontWeight: "300",
        lineHeight: 42,
    },
    headerTitleWrap: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: "900",
        lineHeight: 25,
    },
    headerSubtitle: {
        marginTop: 1,
        fontSize: 12,
        fontWeight: "600",
    },
    headerScheduleButton: {
        minWidth: 64,
        height: 42,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    headerScheduleButtonText: {
        fontSize: 13,
        fontWeight: "900",
        lineHeight: 16,
        letterSpacing: 0,
    },
    content: {
        paddingHorizontal: 16,
        gap: 10,
    },
    routeResultHeaderRow: {
        flexDirection: "row",
        alignItems: "stretch",
        gap: 8,
    },
    routeCard: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 14,
    },
    routeCompactCardInHeader: {
        flex: 1,
    },
    routeResultScheduleButton: {
        width: 62,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    routeResultScheduleButtonText: {
        fontSize: 11,
        fontWeight: "900",
        lineHeight: 14,
        letterSpacing: 0,
    },
    routeInputRows: {
        flexDirection: "row",
        alignItems: "center",
    },
    routeRail: {
        width: 24,
        alignItems: "center",
        paddingVertical: 8,
    },
    routeDot: {
        width: 12,
        height: 12,
        borderRadius: 999,
        borderWidth: 3.5,
    },
    routeRailLine: {
        width: 2,
        flex: 1,
        minHeight: 42,
        marginVertical: 4,
    },
    routeInputs: {
        flex: 1,
    },
    routeInput: {
        minHeight: 40,
        borderBottomWidth: StyleSheet.hairlineWidth,
        fontSize: 14,
        fontWeight: "800",
    },
    swapButton: {
        width: 34,
        height: 60,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 10,
    },
    swapButtonText: {
        fontSize: 22,
        fontWeight: "800",
        lineHeight: 24,
    },
    searchModeHeader: {
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    searchModeBackButton: {
        width: 34,
        height: 42,
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeBackText: {
        marginTop: -3,
        fontSize: 42,
        fontWeight: "300",
        lineHeight: 44,
    },
    scheduleListIconButton: {
        width: 40,
        height: 40,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeSearchBox: {
        flex: 1,
        minWidth: 0,
        height: 40,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        paddingLeft: 13,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
    },
    searchModeInput: {
        flex: 1,
        minWidth: 0,
        height: 40,
        paddingVertical: 0,
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    searchModeTargetContext: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        marginRight: 8,
    },
    searchModeTargetDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
        borderWidth: 2,
    },
    searchModeTargetText: {
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
    },
    searchModeClearButton: {
        width: 24,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeClearText: {
        marginTop: -2,
        fontSize: 20,
        fontWeight: "900",
        lineHeight: 22,
    },
    defaultOriginBar: {
        minHeight: 52,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 20,
        paddingVertical: 8,
    },
    defaultOriginCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    defaultOriginLabel: {
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0,
    },
    defaultOriginName: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    defaultOriginAction: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    defaultOriginSetupBar: {
        minHeight: 68,
        marginHorizontal: 20,
        marginTop: 2,
        marginBottom: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    defaultOriginSetupIcon: {
        width: 36,
        height: 36,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    defaultOriginSetupTitle: {
        fontSize: 13,
        fontWeight: "900",
    },
    defaultOriginSetupDescription: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 16,
    },
    searchModeActionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 10,
    },
    searchModeActionButton: {
        flex: 1,
        minHeight: 58,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
    },
    searchModeActionText: {
        fontSize: 15,
        fontWeight: "800",
    },
    searchModeContent: {
        flexGrow: 1,
        paddingTop: 4,
    },
    searchModePanel: {
        width: "100%",
    },
    searchModeSectionHeader: {
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        marginBottom: 4,
    },
    searchModeSectionTitle: {
        fontSize: 14,
        fontWeight: "900",
    },
    searchModeEditText: {
        fontSize: 13,
        fontWeight: "800",
    },
    favoriteManageButton: {
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 4,
    },
    favoriteFilterScroll: {
        marginBottom: 6,
    },
    favoriteFilterContent: {
        gap: 8,
        paddingHorizontal: 20,
        paddingBottom: 2,
    },
    favoriteFilterChip: {
        position: "relative",
        minHeight: 34,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 13,
        paddingVertical: 7,
        overflow: "hidden",
    },
    favoriteFilterChipText: {
        fontSize: 12,
        fontWeight: "800",
    },
    favoriteFilterIndicator: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 1,
        height: 2,
        borderRadius: 999,
    },
    favoritePanelClip: {
        overflow: "hidden",
    },
    favoriteCategoryDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
    },
    favoriteTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    favoriteTitle: {
        flex: 1,
        minWidth: 0,
    },
    defaultOriginBadge: {
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    defaultOriginBadgeText: {
        fontSize: 10,
        fontWeight: "900",
    },
    favoriteMetaRow: {
        marginTop: 3,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    favoriteMetaText: {
        flex: 1,
        minWidth: 0,
        marginTop: 0,
    },
    favoriteRowActions: {
        flexDirection: "row",
        alignItems: "center",
    },
    favoriteEmptyRow: {
        minHeight: 48,
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    favoriteLoadErrorRow: {
        minHeight: 52,
        marginHorizontal: 20,
        marginBottom: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    favoriteLoadErrorText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 18,
    },
    favoriteRetryButton: {
        minHeight: 32,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    favoriteRetryText: {
        fontSize: 12,
        fontWeight: "800",
        lineHeight: 16,
    },
    searchModeResultRow: {
        minHeight: 68,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        marginHorizontal: 20,
        marginBottom: 8,
        overflow: "hidden",
    },
    searchModeResultMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 12,
        paddingRight: 8,
        paddingVertical: 10,
    },
    searchModeRecentRow: {
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        marginHorizontal: 20,
        marginBottom: 8,
        overflow: "hidden",
    },
    searchModeRecentMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 12,
        paddingRight: 8,
        paddingVertical: 10,
    },
    searchModeListIcon: {
        width: 34,
        height: 34,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    favoriteListIcon: {
        borderWidth: StyleSheet.hairlineWidth,
    },
    searchModeResultTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    searchModeFavoriteButton: {
        width: 48,
        alignSelf: "stretch",
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeRemoveButton: {
        width: 52,
        alignSelf: "stretch",
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeRemoveText: {
        marginTop: -1,
        fontSize: 24,
        fontWeight: "300",
        lineHeight: 26,
    },
    searchModeEmptyRow: {
        minHeight: 48,
        justifyContent: "center",
        gap: 10,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    recentPlaceTitle: {
        fontSize: 13,
        fontWeight: "900",
    },
    recentPlaceAddress: {
        marginTop: 3,
        fontSize: 11,
        fontWeight: "700",
    },
    recentEmptyText: {
        fontSize: 13,
        fontWeight: "700",
    },
    searchingRow: {
        minHeight: 46,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
    },
    searchingText: {
        fontSize: 13,
        fontWeight: "700",
    },
    searchResultTitle: {
        fontSize: 13,
        fontWeight: "900",
    },
    searchResultCategory: {
        marginTop: 2,
        color: "#1B9B50",
        fontSize: 11,
        fontWeight: "800",
    },
    searchResultAddress: {
        marginTop: 3,
        fontSize: 11,
        fontWeight: "600",
    },
    favoriteModalRoot: {
        flex: 1,
        justifyContent: "flex-end",
    },
    favoriteModalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0, 0, 0, 0.46)",
    },
    favoriteSheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        maxHeight: "92%",
        paddingHorizontal: 18,
        paddingTop: 10,
        gap: 14,
    },
    favoriteSheetScroll: {
        flexShrink: 1,
    },
    favoriteSheetScrollContent: {
        gap: 14,
        paddingBottom: 4,
    },
    favoriteSheetHandle: {
        alignSelf: "center",
        width: 48,
        height: 5,
        borderRadius: 999,
        marginBottom: 2,
    },
    favoriteSheetHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    favoriteSheetTitle: {
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 22,
    },
    favoriteSheetSubtitle: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 16,
    },
    favoriteSheetCloseButton: {
        width: 32,
        height: 32,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    favoriteSheetCloseText: {
        marginTop: -2,
        fontSize: 24,
        fontWeight: "500",
        lineHeight: 28,
    },
    favoritePlaceBox: {
        minHeight: 58,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    favoritePlaceTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    favoritePlaceName: {
        fontSize: 14,
        fontWeight: "900",
    },
    favoritePlaceAddress: {
        marginTop: 3,
        fontSize: 11,
        fontWeight: "700",
    },
    favoriteSectionHeaderRow: {
        minHeight: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    favoriteSectionLabel: {
        fontSize: 13,
        fontWeight: "900",
    },
    favoriteCategoryWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    favoriteCategoryChip: {
        minHeight: 36,
        maxWidth: "100%",
        borderWidth: 1,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 12,
    },
    favoriteCategoryChipText: {
        maxWidth: 180,
        fontSize: 12,
        fontWeight: "900",
    },
    favoriteCategorySwatch: {
        width: 9,
        height: 9,
        borderRadius: 999,
    },
    favoriteCategoryError: {
        marginTop: -5,
        fontSize: 11,
        fontWeight: "700",
    },
    favoriteNewCategoryBox: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        padding: 12,
        gap: 10,
    },
    favoriteNewCategoryInput: {
        height: 40,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingHorizontal: 12,
        fontSize: 13,
        fontWeight: "800",
    },
    favoriteColorRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    favoriteColorButton: {
        width: 32,
        height: 32,
        borderRadius: 999,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    favoriteColorSwatch: {
        width: 24,
        height: 24,
        borderRadius: 999,
    },
    favoriteCreateCategoryButton: {
        height: 40,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    favoriteCreateCategoryText: {
        fontSize: 12,
        fontWeight: "900",
    },
    favoriteSaveButton: {
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    favoriteSaveButtonText: {
        fontSize: 14,
        fontWeight: "900",
    },
    modeRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        paddingTop: 0,
        paddingBottom: 6,
        paddingHorizontal: 0,
    },
    modeButtonShell: {
        flex: 0,
        minWidth: 50,
    },
    modeButtonShellSelected: {
        flex: 0,
        minWidth: 72,
    },
    modeButton: {
        minHeight: 42,
        borderWidth: 0,
        borderRadius: 18,
        paddingVertical: 7,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 0,
    },
    modeButtonSelected: {
        borderWidth: 1,
        width: 72,
    },
    modeButtonIconOnly: {
        width: 50,
        paddingHorizontal: 0,
    },
    modeButtonText: {
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0,
    },
    transitFilterRow: {
        width: "100%",
        justifyContent: "space-between",
        gap: 0,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.12)",
    },
    transitFilterTab: {
        position: "relative",
        minHeight: 39,
        borderWidth: 0,
        borderRadius: 0,
        minWidth: 76,
        paddingHorizontal: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    transitFilterIndicator: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        borderRadius: 999,
    },
    transitFilterText: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeSortRow: {
        minHeight: 46,
        borderTopWidth: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    routeSortPrimaryText: {
        fontSize: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    routeSortSecondary: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    routeSortSecondaryText: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    currentRouteNotice: {
        minHeight: 46,
        paddingHorizontal: 8,
        paddingTop: 9,
        paddingBottom: 9,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    currentRouteTimeGroup: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    currentRouteNoticeText: {
        fontSize: 13,
        fontWeight: "600",
        lineHeight: 19,
        letterSpacing: 0,
    },
    currentRouteNoticeTimeText: {
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
        letterSpacing: 0,
    },
    currentRouteSortGroup: {
        minHeight: 28,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
    },
    currentRouteSortText: {
        flexShrink: 0,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
        letterSpacing: 0,
    },
    routeList: {
        gap: 8,
        paddingTop: 2,
    },
    routeCandidateItem: {
        gap: 0,
    },
    emptyCard: {
        minHeight: 84,
        borderWidth: 1,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
        gap: 8,
    },
    emptyText: {
        textAlign: "center",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
    },
    emptyRetryButton: {
        minHeight: 36,
        borderRadius: 8,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    emptyRetryText: {
        color: "#FFFFFF",
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 17,
        letterSpacing: 0,
    },
    routeOptionCard: {
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        gap: 0,
        overflow: "hidden",
    },
    routeOptionCardInactive: {
        borderWidth: 1,
        shadowColor: "#000000",
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
    },
    routeOptionCardSelectedLight: {
        borderWidth: 1,
        shadowColor: "#1E68FF",
        shadowOpacity: 0.05,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
        elevation: 1,
    },
    routeOptionCardSelectedDark: {
        borderWidth: 1,
        shadowColor: "#2F8CFF",
        shadowOpacity: 0.08,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
        elevation: 1,
    },
    routeOptionExpansion: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 8,
        overflow: "hidden",
    },
    routeDropdownSummaryList: {
        gap: 4,
    },
    routeDropdownSummaryRow: {
        minHeight: 39,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 3,
    },
    routeDropdownMarkerColumn: {
        width: 26,
        alignItems: "center",
        alignSelf: "stretch",
        paddingTop: 1,
    },
    routeDropdownIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.4,
        alignItems: "center",
        justifyContent: "center",
    },
    routeDropdownConnector: {
        width: 2,
        flex: 1,
        minHeight: 11,
        marginTop: 3,
        opacity: 0.32,
        borderRadius: 1,
    },
    routeDropdownStepTextWrap: {
        flex: 1,
        minWidth: 0,
        gap: 1,
        paddingTop: 1,
    },
    routeDropdownStepLine: {
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 20,
        letterSpacing: 0,
    },
    routeDropdownStepMeta: {
        fontSize: 12.5,
        fontWeight: "700",
        lineHeight: 17,
        letterSpacing: 0,
    },
    routeAttributionLink: {
        minHeight: 34,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 4,
    },
    routeAttributionText: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
        letterSpacing: 0,
    },
    routeCardActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 10,
        paddingBottom: 12,
        paddingHorizontal: 14,
    },
    routeCardSecondaryButton: {
        flex: 1,
        minHeight: 42,
        borderWidth: 1,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 5,
        paddingHorizontal: 10,
    },
    routeCardSecondaryButtonText: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeCardPrimaryButton: {
        flex: 1.15,
        minHeight: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 5,
        paddingHorizontal: 10,
    },
    routeCardPrimaryButtonText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeOptionPressable: {
        paddingHorizontal: 16,
        paddingVertical: 13,
        gap: 7,
    },
    routeOptionHeader: {
        alignItems: "flex-start",
        gap: 8,
    },
    routeOptionHeaderRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    routeOptionTitleMetaRow: {
        flex: 1,
        minWidth: 0,
        alignItems: "flex-start",
        gap: 5,
    },
    routeOptionLabelPill: {
        minHeight: 25,
        borderRadius: 999,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    routeOptionTopRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    routeOptionLabel: {
        fontSize: 12,
        fontWeight: "900",
        letterSpacing: 0,
        lineHeight: 15,
    },
    routeOptionDuration: {
        flexShrink: 0,
        maxWidth: 164,
        textAlign: "right",
        fontSize: 34,
        fontWeight: "800",
        letterSpacing: 0,
        lineHeight: 39,
    },
    routeOptionDurationWrap: {
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    routeOptionTimeFare: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 19,
        letterSpacing: 0,
    },
    routeOptionCondition: {
        fontSize: 12,
        fontWeight: "800",
        lineHeight: 17,
        letterSpacing: 0,
    },
    routeMetricRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 5,
        paddingTop: 0,
        paddingBottom: 2,
    },
    routeMetricChip: {
        minHeight: 24,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    routeMetricText: {
        fontSize: 12,
        fontWeight: "900",
        lineHeight: 14,
        letterSpacing: 0,
    },
    routeStepBadgeRow: {
        gap: 6,
        paddingRight: 2,
    },
    routeStepBadge: {
        minWidth: 38,
        maxWidth: 96,
        minHeight: 24,
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    routeStepBadgeText: {
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0,
    },
    routeProgressBlock: {
        width: "100%",
        flexShrink: 1,
        paddingTop: 4,
        paddingBottom: 2,
        overflow: "hidden",
    },
    routeProgressScroll: {
        width: "100%",
        flexGrow: 0,
    },
    routeFlowStrip: {
        width: "100%",
        minHeight: 70,
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 10,
        paddingHorizontal: 0,
        overflow: "hidden",
    },
    routeFlowStripSparseSpacing: {
        justifyContent: "center",
        columnGap: 22,
    },
    routeFlowStripRegularSpacing: {
        justifyContent: "space-between",
        columnGap: 2,
    },
    routeFlowSegment: {
        minWidth: 0,
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 1,
        position: "relative",
    },
    routeFlowSegmentSparse: {
        width: 86,
    },
    routeFlowSegmentRegular: {
        width: 64,
    },
    routeFlowSegmentDense: {
        width: 54,
    },
    routeFlowTopLine: {
        minHeight: 24,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        maxWidth: "100%",
    },
    routeFlowConnector: {
        position: "absolute",
        top: 30,
        right: -1,
        width: 2,
        height: 18,
        borderRadius: 999,
        opacity: 0.42,
    },
    routeFlowMarker: {
        minHeight: 23,
        maxWidth: "100%",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 4,
    },
    routeFlowLineText: {
        maxWidth: 62,
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: 0,
        lineHeight: 16,
    },
    routeFlowPointText: {
        maxWidth: "100%",
        fontSize: 10.75,
        fontWeight: "800",
        lineHeight: 13.5,
        letterSpacing: 0,
        textAlign: "center",
    },
    routeFlowPathSummary: {
        maxWidth: "100%",
        paddingTop: 2,
        paddingLeft: 2,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 17,
        letterSpacing: 0,
    },
    routeSelectionActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingTop: 4,
        paddingBottom: 2,
    },
    routeSelectionSecondaryButton: {
        flex: 1,
        minHeight: 46,
        borderWidth: 1,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        paddingHorizontal: 10,
    },
    routeSelectionSecondaryButtonText: {
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeSelectionPrimaryButton: {
        flex: 1.15,
        minHeight: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
    },
    routeSelectionPrimaryButtonText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeProgressTrackLight: {
        backgroundColor: "transparent",
    },
    routeProgressTrackDark: {
        backgroundColor: "transparent",
    },
    routeProgressBadgeText: {
        fontSize: 9,
        fontWeight: "900",
        lineHeight: 11,
        letterSpacing: 0,
    },
    routeBoardingSummaryRow: {
        width: "100%",
        minHeight: 32,
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 5,
        paddingTop: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    routeBoardingSummaryText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 17,
        letterSpacing: 0,
    },
    routeOptionDetailTapArea: {
        gap: 12,
    },
    routeOptionFooterRow: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 4,
        paddingTop: 0,
    },
    routeOptionFooterText: {
        fontSize: 13,
        fontWeight: "900",
    },
    routeOptionFooterIcon: {
        marginTop: -1,
        fontSize: 20,
        fontWeight: "900",
        lineHeight: 20,
    },
    mapPickerRoot: {
        flex: 1,
    },
    mapPickerMap: {
        ...StyleSheet.absoluteFillObject,
    },
    mapPickerHeader: {
        position: "absolute",
        left: 16,
        right: 16,
        top: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        zIndex: 5,
    },
    mapPickerIconButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    mapPickerBackText: {
        fontSize: 34,
        fontWeight: "700",
        lineHeight: 38,
        marginTop: -2,
    },
    mapPickerTitleBox: {
        flex: 1,
        minHeight: 48,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
    mapPickerTitle: {
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    mapPickerBottomSheet: {
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 12,
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        paddingTop: 18,
        paddingHorizontal: 16,
        gap: 13,
        zIndex: 5,
    },
    mapPickerInstruction: {
        fontSize: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
    mapPickerAddressRow: {
        minHeight: 42,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 9,
    },
    mapPickerAddressText: {
        flex: 1,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        letterSpacing: 0,
    },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
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
    TouchableOpacity,
    UIManager,
    View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createFavoritePlaceCategoryToApi,
    getFavoritePlaceCategoriesFromApi,
    saveFavoritePlaceToApi,
    type FavoritePlaceCategory,
} from "../../src/api/favoritePlaces";
import { getCurrentLocation } from "../../src/modules/map/currentLocation";
import TmapMapView, { type TmapMarker } from "../../src/modules/map/TmapMapView";
import {
    getRouteAlternativeOptions,
    getRouteQualityLabel,
    invalidateRouteSearch,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    type PlaceSearchItem,
    type RouteAlternativeOption,
} from "../../src/modules/map/routingService";
import { getRoutePlannerInitial, setRoutePlannerInitial, setRoutePlannerResult } from "../../src/modules/schedule/routePlannerSession";
import {
    getRecentRoutePlaces,
    removeRecentRoutePlace,
    saveFavoriteDeparturePlace,
    saveRecentRoutePlace,
} from "../../src/modules/schedule/favoriteDeparture";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
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

const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];
const MAP_PICKER_FALLBACK_LAT = 37.5665;
const MAP_PICKER_FALLBACK_LNG = 126.978;
const MAP_PICKER_DEFAULT_ZOOM = 14;

type RoutePointTarget = "origin" | "destination";
type TransitRouteFilter = "ALL" | "SUBWAY" | "BUS" | "MIXED";
type RouteSelectTransitLeg = NonNullable<RouteAlternativeOption["transitLegs"]>[number];
type RouteProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    detailLabel: string;
    pointLabel?: string;
    minutes: number;
    color: string;
    kind: RouteSelectTransitLeg["kind"] | "TRANSFER";
    iconName: React.ComponentProps<typeof Ionicons>["name"];
    flex: number;
    isRide: boolean;
};
type RouteMetricChip = {
    key: string;
    label: string;
    tone?: "default" | "success";
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
const QA_GANGNAM_SEARCH_RESULTS: PlaceSearchItem[] = [
    {
        name: "강남역 (2호선)",
        address: "서울 강남구 강남대로 지하 396",
        lat: 37.4979,
        lng: 127.0276,
        category: "2호선",
    },
    {
        name: "강남역 11번출구",
        address: "서울 강남구 강남대로 지하 396",
        lat: 37.4981,
        lng: 127.0279,
        category: "2호선 11번 출구",
    },
    {
        name: "강남역 (신분당선)",
        address: "서울 강남구 강남대로 지하 396",
        lat: 37.4968,
        lng: 127.028,
        category: "신분당선",
    },
    {
        name: "강남역 10번출구",
        address: "서울 강남구 강남대로 지하 390",
        lat: 37.4975,
        lng: 127.0274,
        category: "2호선 10번 출구",
    },
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

function configureRouteExpansionAnimation() {
    LayoutAnimation.configureNext({
        duration: 210,
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

// 경로 후보를 카드의 구간 막대 데이터로 변환한다.
function buildRouteProgressSegments(option: RouteAlternativeOption, destinationName?: string): RouteProgressSegment[] {
    const legs = option.transitLegs ?? [];
    if (!legs.length) return [];
    const destinationFlowName = formatRouteFlowPointName(destinationName);

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
            const startName = formatRouteFlowStopDisplayName(leg.startName, segmentKind);
            const endName = formatRouteFlowStopDisplayName(leg.endName, segmentKind);
            const prevEndName = formatRouteFlowStopDisplayName(prevLeg?.endName, prevLeg?.kind);
            const color = isTransferWalk ? ROUTE_SEGMENT_FALLBACK_COLORS.etc : getTransitLegColor(leg);
            const iconName: RouteProgressSegment["iconName"] = segmentKind === "SUBWAY"
                ? "train"
                : segmentKind === "BUS"
                    ? "bus"
                    : segmentKind === "TRANSFER"
                        ? "swap-horizontal"
                        : segmentKind === "WALK"
                            ? "walk"
                            : "navigate-outline";
            const label = isTransferWalk
                ? "환승"
                : lineLabel ?? (leg.kind === "WALK" ? "도보" : getTransitKindLabel(leg.kind));
            const detailLabel = isTransferWalk ? `환승 ${minutes}분` : `${minutes}분`;
            const pointLabel = (() => {
                if (isTransferWalk) return `${formatRouteFlowPointLabel(startName ?? endName ?? prevEndName ?? "환승")} 이동`;
                if (leg.kind === "WALK") {
                    if (index === legs.length - 1) {
                        return `${formatRouteFlowPointLabel(endName ?? destinationFlowName ?? "도착지")} 도착`;
                    }
                    return `${formatRouteFlowPointLabel(endName ?? "다음 지점")}까지`;
                }
                return `${formatRouteFlowPointLabel(startName ?? "정류장")} 승차`;
            })();
            return {
                key: `${segmentKind}:${lineLabel ?? leg.label}:${index}`,
                label,
                lineLabel,
                detailLabel,
                pointLabel,
                minutes,
                color,
                kind: segmentKind,
                iconName,
                flex: Math.max(0.8, minutes),
                isRide: isRideLegKind(segmentKind),
            };
        })
        .filter((segment) => segment.minutes > 0);
}

// 대중교통 구간의 종류를 사용자가 이해하기 쉬운 이름으로 바꾼다.
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

    chips.push({ key: "provider", label: getRouteQualityLabel(option), tone: "success" });
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

function truncateRouteFlowLabel(label: string, maxLength = 6): string {
    return label.length > maxLength ? `${label.slice(0, maxLength)}…` : label;
}

function formatRouteFlowPointLabel(label: string): string {
    return truncateRouteFlowLabel(label.replace(/\s+/g, " ").trim(), 6);
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

// 딥링크나 테스트 URL로 전달된 첫 번째 문자열 값을 꺼낸다.
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
        qaSearchQuery?: string;
        qaSearchTarget?: string;
    }>();
    const sessionId = readParam(params.sessionId) ?? "";
    const editTargetParam = readParam(params.editTarget);
    const forcedEditTarget: RoutePointTarget | undefined = editTargetParam === "origin" || editTargetParam === "destination"
        ? editTargetParam
        : undefined;
    const qaSearchQuery = readParam(params.qaSearchQuery);
    const qaSearchTarget: RoutePointTarget = readParam(params.qaSearchTarget) === "destination" ? "destination" : "origin";
    const sessionInitial = sessionId ? getRoutePlannerInitial(sessionId) : undefined;
    const paramInitial = useMemo(() => {
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
    const initialHasRouteCoords =
        typeof initial?.origin?.lat === "number" &&
        typeof initial.origin.lng === "number" &&
        typeof initial.destination?.lat === "number" &&
        typeof initial.destination.lng === "number";

    const [originText, setOriginText] = useState(initial?.origin?.name ?? "");
    const [originAddress, setOriginAddress] = useState(initial?.origin?.address);
    const [originLat, setOriginLat] = useState<number | undefined>(initial?.origin?.lat);
    const [originLng, setOriginLng] = useState<number | undefined>(initial?.origin?.lng);
    const [destinationText, setDestinationText] = useState(initial?.destination?.name ?? "");
    const [destinationAddress, setDestinationAddress] = useState(initial?.destination?.address);
    const [destinationLat, setDestinationLat] = useState<number | undefined>(initial?.destination?.lat);
    const [destinationLng, setDestinationLng] = useState<number | undefined>(initial?.destination?.lng);
    const [travelMode, setTravelMode] = useState<TravelMode>(initialTravelMode);
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget>(forcedEditTarget ?? "origin");
    const [isEditingRoutePoint, setIsEditingRoutePoint] = useState(Boolean(forcedEditTarget) || !initialHasRouteCoords);
    const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
    const [favoriteSavingKey, setFavoriteSavingKey] = useState<string>();
    const [favoriteSheetPlace, setFavoriteSheetPlace] = useState<Place>();
    const [favoriteCategories, setFavoriteCategories] = useState<FavoritePlaceCategory[]>([]);
    const [favoriteCategoryLoading, setFavoriteCategoryLoading] = useState(false);
    const [favoriteCategoryError, setFavoriteCategoryError] = useState<string>();
    const [selectedFavoriteCategoryId, setSelectedFavoriteCategoryId] = useState<string>();
    const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [newCategoryColor, setNewCategoryColor] = useState(FAVORITE_CATEGORY_COLORS[0]);
    const [creatingFavoriteCategory, setCreatingFavoriteCategory] = useState(false);
    const [mapPickerVisible, setMapPickerVisible] = useState(false);
    const [mapPickerTarget, setMapPickerTarget] = useState<RoutePointTarget>("origin");
    const [mapPickerCoord, setMapPickerCoord] = useState<{ latitude: number; longitude: number }>();
    const [mapPickerAddress, setMapPickerAddress] = useState<string>();
    const [mapPickerResolving, setMapPickerResolving] = useState(false);
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [hasTypedSearchQuery, setHasTypedSearchQuery] = useState(false);
    const [searching, setSearching] = useState(false);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState<string | undefined>();
    const [routeRequestVersion, setRouteRequestVersion] = useState(0);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRequestIdRef = useRef(0);
    const mapPickerRequestIdRef = useRef(0);
    const recentPlacesLoadedRef = useRef(false);
    const originTouchedRef = useRef(Boolean(initial?.origin));
    const [routeDepartureAt, setRouteDepartureAt] = useState(() => new Date());
    const routeContentAnim = useRef(new Animated.Value(1)).current;

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
    const activeSearchText = activeTarget === "origin" ? originText : destinationText;
    const hasRouteCoords =
        typeof originLat === "number" &&
        typeof originLng === "number" &&
        typeof destinationLat === "number" &&
        typeof destinationLng === "number";
    const showingSearchResults = isEditingRoutePoint && (
        searching ||
        hasTypedSearchQuery ||
        searchResults.length > 0
    );
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
            route: routeToStore,
        });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        originAddress,
        originLat,
        originLng,
        originText,
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

    const clearSearch = useCallback(() => {
        searchRequestIdRef.current += 1;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchResults([]);
        setHasTypedSearchQuery(false);
        setSearching(false);
    }, []);

    const openRoutePointEditor = useCallback((target: RoutePointTarget = "origin") => {
        Keyboard.dismiss();
        setActiveTarget(target);
        clearSearch();
        setIsEditingRoutePoint(true);
    }, [clearSearch]);

    useEffect(() => {
        setOriginText(initial?.origin?.name ?? "");
        setOriginAddress(initial?.origin?.address);
        setOriginLat(initial?.origin?.lat);
        setOriginLng(initial?.origin?.lng);
        setDestinationText(initial?.destination?.name ?? "");
        setDestinationAddress(initial?.destination?.address);
        setDestinationLat(initial?.destination?.lat);
        setDestinationLng(initial?.destination?.lng);
        setTravelMode(initialTravelMode);
        setActiveTarget(forcedEditTarget ?? "origin");
        setIsEditingRoutePoint(Boolean(forcedEditTarget) || !initialHasRouteCoords);
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
        const query = qaSearchQuery?.trim();
        if (!query) return;

        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setActiveTarget(qaSearchTarget);
        setIsEditingRoutePoint(true);
        setHasTypedSearchQuery(true);
        setSearching(false);
        setSearchResults(QA_GANGNAM_SEARCH_RESULTS);
        if (qaSearchTarget === "origin") {
            originTouchedRef.current = true;
            setOriginText(query);
            setOriginAddress(undefined);
            setOriginLat(undefined);
            setOriginLng(undefined);
            return;
        }

        setDestinationText(query);
        setDestinationAddress(undefined);
        setDestinationLat(undefined);
        setDestinationLng(undefined);
    }, [qaSearchQuery, qaSearchTarget]);

    const applyPlaceToTarget = useCallback((target: RoutePointTarget, place: Place) => {
        if (target === "origin") {
            originTouchedRef.current = true;
            setOriginText(getPlaceDisplayText(place));
            setOriginAddress(place.address);
            setOriginLat(place.lat);
            setOriginLng(place.lng);
            setActiveTarget("origin");
        } else {
            setDestinationText(getPlaceDisplayText(place));
            setDestinationAddress(place.address);
            setDestinationLat(place.lat);
            setDestinationLng(place.lng);
            setActiveTarget("destination");
        }
        setIsEditingRoutePoint(false);
        clearSearch();
    }, [clearSearch]);

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

    const handleSearchChange = useCallback((target: RoutePointTarget, text: string) => {
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        setActiveTarget(target);
        setIsEditingRoutePoint(true);
        setHasTypedSearchQuery(text.trim().length > 0);
        if (target === "origin") {
            originTouchedRef.current = true;
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
        if (!text.trim()) {
            setSearchResults([]);
            setSearching(false);
            return;
        }

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
                Alert.alert("검색 실패", message);
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
        try {
            setSearching(true);
            const location = await getCurrentLocation();
            const address = await reverseGeocodeToAddress(location.latitude, location.longitude)
                .catch(() => undefined);
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
            const message = error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.";
            Alert.alert("현재 위치 실패", message);
        } finally {
            setSearching(false);
        }
    }, [applyPlaceToTarget]);

    const applyCurrentLocationToActiveTarget = useCallback(() => {
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
        Keyboard.dismiss();
        const target = activeTarget;
        const initialCoord = getMapPickerInitialCoord(target);
        setMapPickerTarget(target);
        setMapPickerCoord(initialCoord);
        setMapPickerAddress(undefined);
        setMapPickerVisible(true);
    }, [activeTarget, getMapPickerInitialCoord]);

    const closeMapPicker = useCallback(() => {
        mapPickerRequestIdRef.current += 1;
        setMapPickerVisible(false);
        setMapPickerResolving(false);
    }, []);

    const selectMapPickerCoord = useCallback(async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
        const requestId = mapPickerRequestIdRef.current + 1;
        mapPickerRequestIdRef.current = requestId;
        setMapPickerCoord({ latitude, longitude });
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

    const confirmMapPickerSelection = useCallback(() => {
        if (!mapPickerCoord) {
            Alert.alert("위치 선택 필요", "지도에서 위치를 선택해 주세요.");
            return;
        }

        const label = mapPickerTarget === "origin" ? "지도 선택 출발지" : "지도 선택 도착지";
        const place: Place = {
            name: mapPickerAddress || label,
            address: mapPickerAddress,
            lat: mapPickerCoord.latitude,
            lng: mapPickerCoord.longitude,
        };

        rememberRecentPlace(place);
        applyPlaceToTarget(mapPickerTarget, place);
        setMapPickerVisible(false);
    }, [applyPlaceToTarget, mapPickerAddress, mapPickerCoord, mapPickerTarget, rememberRecentPlace]);

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
            Alert.alert("즐겨찾기 저장", "좌표가 있는 장소만 저장할 수 있습니다.");
            return;
        }

        Keyboard.dismiss();
        setFavoriteSheetPlace(place);
        setSelectedFavoriteCategoryId(undefined);
        setShowNewCategoryForm(false);
        setNewCategoryName("");
        setNewCategoryColor(FAVORITE_CATEGORY_COLORS[0]);
        void loadFavoriteCategories();
    }, [loadFavoriteCategories]);

    const closeFavoriteSaveSheet = useCallback(() => {
        if (favoriteSavingKey || creatingFavoriteCategory) return;
        setFavoriteSheetPlace(undefined);
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

        setCreatingFavoriteCategory(true);
        try {
            const category = await createFavoritePlaceCategoryToApi(categoryName, newCategoryColor);
            setFavoriteCategories((current) => {
                const next = [
                    ...current.filter((item) => item.id !== category.id),
                    category,
                ];
                return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            });
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
            Alert.alert("즐겨찾기 저장", "좌표가 있는 장소만 저장할 수 있습니다.");
            return;
        }

        const savingKey = getPlaceActionKey(place);
        setFavoriteSavingKey(savingKey);
        let saved = false;
        let apiSaveFailed = false;

        try {
            await saveFavoritePlaceToApi(place, { categoryId });
            saved = true;
        } catch {
            apiSaveFailed = true;
        }

        if (!saved && !categoryId) {
            try {
                await saveFavoriteDeparturePlace(place);
                saved = true;
            } catch {
                // 아래 공통 실패 처리로 넘긴다.
            }
        }

        if (saved && !apiSaveFailed) {
            try {
                await saveFavoriteDeparturePlace(place);
            } catch {
                // 원격 저장은 성공했으므로 로컬 캐시 실패는 무시한다.
            }
        }

        try {
            if (!saved) {
                Alert.alert("즐겨찾기 저장 실패", "잠시 후 다시 시도해 주세요.");
                return;
            }

            setFavoriteSheetPlace(undefined);
            Alert.alert("즐겨찾기 저장", `${getPlaceDisplayText(place)}을(를) 저장했습니다.`);
        } finally {
            setFavoriteSavingKey((current) => current === savingKey ? undefined : current);
        }
    }, []);

    const saveFavoriteSheetPlace = useCallback(() => {
        if (!favoriteSheetPlace) return;
        void savePlaceAsFavorite(favoriteSheetPlace, selectedFavoriteCategoryId);
    }, [favoriteSheetPlace, savePlaceAsFavorite, selectedFavoriteCategoryId]);

    const swapPlaces = useCallback(() => {
        const prevOrigin = { text: originText, address: originAddress, lat: originLat, lng: originLng };
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

    const openCompactRouteEditor = useCallback((event: GestureResponderEvent) => {
        const tapY = event.nativeEvent.locationY;
        openRoutePointEditor(tapY > 34 ? "destination" : "origin");
    }, [openRoutePointEditor]);

    useEffect(() => () => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
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
        setSelectedRouteId(undefined);
        setRouteAlternatives([]);
        setRouteError(undefined);

        if (!hasRouteCoords) return;

        setRouteDepartureAt(new Date());
        setRouteLoading(true);
        getRouteAlternativeOptions(origin, destination, travelMode)
            .then((items) => {
                if (cancelled) return;
                const displayItems = sortRouteAlternativesForDisplay(items, travelMode, "ALL");
                const firstDisplayRouteId = displayItems[0]?.id;
                setRouteAlternatives(items);
                setSelectedRouteId(firstDisplayRouteId);
                setRouteError(items.length ? undefined : "표시할 경로가 없습니다.");
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
    }, [destination, hasRouteCoords, origin, routeRequestVersion, travelMode]);

    useEffect(() => {
        if (!visibleRouteAlternatives.length) return;
        if (selectedRouteId && visibleRouteAlternatives.some((option) => option.id === selectedRouteId)) return;
        setSelectedRouteId(visibleRouteAlternatives[0].id);
    }, [selectedRouteId, visibleRouteAlternatives]);

    const openMapForOption = useCallback((routeOption?: RouteAlternativeOption) => {
        const targetRoute = routeOption ?? selectedRoute;
        if (!targetRoute) {
            Alert.alert("경로 선택 필요", "상세 지도에서 확인할 경로를 선택해 주세요.");
            return;
        }
        const targetIndex = targetRoute
            ? routeAlternatives.findIndex((option) => option.id === targetRoute.id)
            : selectedRouteIndex;
        const targetSessionId = sessionId || `route-preview-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // 목록과 상세 화면이 같은 경로 객체를 사용해야 필터/정렬 순서 차이로 경로가 바뀌지 않는다.
        persistInitial(targetRoute.minutes, targetSessionId, targetRoute);
        router.replace({
            pathname: "/schedule/route-planner",
            params: {
                sessionId: targetSessionId,
                routeId: targetRoute.id,
                routeIndex: targetIndex >= 0 ? String(targetIndex) : "0",
            },
        });
    }, [persistInitial, routeAlternatives, router, selectedRoute, selectedRouteIndex, sessionId]);

    const saveRouteOption = useCallback((routeOption: RouteAlternativeOption, routeIndex: number) => {
        if (!sessionId) {
            close();
            return;
        }

        const nextOrigin = buildPlace(originText, originAddress, originLat, originLng);
        const nextDestination = buildPlace(destinationText, destinationAddress, destinationLat, destinationLng);
        const routeInfo = buildRouteInfoFromAlternative(
            routeOption,
            nextOrigin,
            nextDestination,
            routeDepartureAt,
            routeIndex
        );

        setRoutePlannerResult(sessionId, {
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes: routeInfo.totalDurationMinutes,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name || nextOrigin?.name,
            route: {
                ...routeOption,
                routeInfo,
            },
        });
        close();
    }, [
        close,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        originAddress,
        originLat,
        originLng,
        originText,
        routeDepartureAt,
        sessionId,
        travelMode,
    ]);

    const exitSearchMode = useCallback(() => {
        clearSearch();
        setIsEditingRoutePoint(false);
    }, [clearSearch]);

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
            successChipBg: "rgba(34,197,94,0.09)",
            successChipBorder: "rgba(34,197,94,0.18)",
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
            progressTrackBg: "#4F5760",
            progressTrackBorder: "rgba(255,255,255,0.04)",
            progressTrackText: "#FFFFFF",
            progressNeutralIconBg: "#9CA3AF",
            progressIconBorder: "rgba(10,11,14,0.9)",
            progressIconShadowOpacity: 0.24,
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
            successChipBg: "rgba(34,197,94,0.10)",
            successChipBorder: "rgba(34,197,94,0.22)",
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
            progressTrackBg: "#EEF3F8",
            progressTrackBorder: "#DDE6F0",
            progressTrackText: "#667085",
            progressNeutralIconBg: "#A6B0BD",
            progressIconBorder: "#FFFFFF",
            progressIconShadowOpacity: 0.12,
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
            <View style={styles.favoriteModalRoot}>
                <Pressable
                    onPress={closeFavoriteSaveSheet}
                    disabled={favoriteSheetSaving || creatingFavoriteCategory}
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
                                카테고리를 선택하거나 새로 추가하세요
                            </Text>
                        </View>
                        <Pressable
                            onPress={closeFavoriteSaveSheet}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            style={[styles.favoriteSheetCloseButton, { backgroundColor: routeUi.surface2 }]}
                        >
                            <Text style={[styles.favoriteSheetCloseText, { color: routeUi.textSecondary }]}>×</Text>
                        </Pressable>
                    </View>

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
                            <ActivityIndicator size="small" color={routeUi.textSecondary} />
                        )}
                    </View>
                    <View style={styles.favoriteCategoryWrap}>
                        <Pressable
                            onPress={() => setSelectedFavoriteCategoryId(undefined)}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
                            style={[
                                styles.favoriteCategoryChip,
                                {
                                    backgroundColor: selectedFavoriteCategoryId ? routeUi.surface2 : routeUi.accentBlue,
                                    borderColor: selectedFavoriteCategoryId ? routeUi.border : routeUi.accentBlue,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.favoriteCategoryChipText,
                                    { color: selectedFavoriteCategoryId ? routeUi.textSecondary : modeSelectedText },
                                ]}
                            >
                                카테고리 없음
                            </Text>
                        </Pressable>
                        {favoriteCategories.map((category) => {
                            const selected = selectedFavoriteCategoryId === category.id;
                            const categoryColor = category.color || routeUi.accentBlue;
                            return (
                                <Pressable
                                    key={category.id ?? `${category.name}:${categoryColor}`}
                                    onPress={() => setSelectedFavoriteCategoryId(category.id)}
                                    disabled={!category.id || favoriteSheetSaving || creatingFavoriteCategory}
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
                                        {category.name}
                                    </Text>
                                </Pressable>
                            );
                        })}
                        <Pressable
                            onPress={() => setShowNewCategoryForm((current) => !current)}
                            disabled={favoriteSheetSaving || creatingFavoriteCategory}
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
                                {FAVORITE_CATEGORY_COLORS.map((color) => {
                                    const selected = newCategoryColor === color;
                                    return (
                                        <Pressable
                                            key={color}
                                            onPress={() => setNewCategoryColor(color)}
                                            disabled={creatingFavoriteCategory || favoriteSheetSaving}
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
                                style={[
                                    styles.favoriteCreateCategoryButton,
                                    { backgroundColor: routeUi.textPrimary },
                                ]}
                            >
                                {creatingFavoriteCategory ? (
                                    <ActivityIndicator size="small" color={routeUi.background} />
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
                        style={[
                            styles.favoriteSaveButton,
                            {
                                backgroundColor: routeUi.accentBlue,
                                opacity: favoriteSheetSaving || creatingFavoriteCategory ? 0.58 : 1,
                            },
                        ]}
                    >
                        {favoriteSheetSaving ? (
                            <ActivityIndicator size="small" color={modeSelectedText} />
                        ) : (
                            <Text style={[styles.favoriteSaveButtonText, { color: modeSelectedText }]}>
                                즐겨찾기 저장
                            </Text>
                        )}
                    </Pressable>
                </CalendarGlassSurface>
            </View>
        </Modal>
    );
    const mapPickerCamera = {
        latitude: mapPickerCoord?.latitude ?? MAP_PICKER_FALLBACK_LAT,
        longitude: mapPickerCoord?.longitude ?? MAP_PICKER_FALLBACK_LNG,
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
                pinLabel: "도",
                caption: "도착지",
                zIndex: 20,
            });
        }
        if (mapPickerCoord) {
            markers.push({
                id: "map-picker-selected",
                latitude: mapPickerCoord.latitude,
                longitude: mapPickerCoord.longitude,
                markerStyle: mapPickerTarget === "origin" ? "origin" : "destination",
                pinLabel: mapPickerTarget === "origin" ? "출" : "도",
                caption: mapPickerTarget === "origin" ? "선택한 출발지" : "선택한 도착지",
                zIndex: 40,
            });
        }
        return markers;
    }, [destination, mapPickerCoord, mapPickerTarget, origin]);
    const mapPickerTitle = mapPickerTarget === "origin" ? "출발지 지도 선택" : "도착지 지도 선택";
    const mapPickerSheet = (
        <Modal
            visible={mapPickerVisible}
            animationType="slide"
            onRequestClose={closeMapPicker}
        >
            <View style={[styles.mapPickerRoot, { backgroundColor: routeUi.background }]}>
                <TmapMapView
                    style={styles.mapPickerMap}
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
                    <Pressable onPress={closeMapPicker} style={[styles.mapPickerIconButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
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
                        지도에서 사용할 위치를 탭하세요
                    </Text>
                    <View style={styles.mapPickerAddressRow}>
                        {mapPickerResolving ? (
                            <ActivityIndicator size="small" color={routeUi.accentBlue} />
                        ) : (
                            <Ionicons name="location" size={17} color={routeUi.accentBlue} />
                        )}
                        <Text numberOfLines={2} style={[styles.mapPickerAddressText, { color: routeUi.textSecondary }]}>
                            {mapPickerAddress || (
                                mapPickerCoord
                                    ? `${mapPickerCoord.latitude.toFixed(5)}, ${mapPickerCoord.longitude.toFixed(5)}`
                                    : "아직 선택한 위치가 없습니다"
                            )}
                        </Text>
                    </View>
                    <View style={styles.mapPickerActionRow}>
                        <Pressable
                            onPress={closeMapPicker}
                            style={[styles.mapPickerSecondaryButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                        >
                            <Text style={[styles.mapPickerSecondaryText, { color: routeUi.textPrimary }]}>취소</Text>
                        </Pressable>
                        <Pressable
                            onPress={confirmMapPickerSelection}
                            style={[styles.mapPickerPrimaryButton, { backgroundColor: routeUi.accentBlue }]}
                        >
                            <Text style={styles.mapPickerPrimaryText}>이 위치 사용</Text>
                        </Pressable>
                    </View>
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
                    <Pressable onPress={exitSearchMode} style={styles.searchModeBackButton}>
                        <Text style={[styles.searchModeBackText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={[styles.searchModeSearchBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <TextInput
                            autoFocus
                            value={activeSearchText}
                            onChangeText={(text) => handleSearchChange(activeTarget, text)}
                            placeholder={`${activeTargetLabel}를 입력하세요`}
                            placeholderTextColor={routeUi.inputPlaceholder}
                            selectionColor={routeUi.accentBlue}
                            returnKeyType="search"
                            style={[styles.searchModeInput, { color: routeUi.textPrimary }]}
                        />
                        {!!activeSearchText.trim() && (
                            <Pressable
                                onPress={() => handleSearchChange(activeTarget, "")}
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

                <View style={styles.searchModeActionRow}>
                    <Pressable
                        onPress={applyCurrentLocationToActiveTarget}
                        style={[styles.searchModeActionButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="navigate-outline" size={22} color={routeUi.accentBlue} />
                        <Text style={[styles.searchModeActionText, { color: routeUi.accentBlue }]}>내 위치</Text>
                    </Pressable>
                    <Pressable
                        onPress={openMapForPointSelection}
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
                                    <ActivityIndicator size="small" color={routeUi.textPrimary} />
                                    <Text style={[styles.searchingText, { color: routeUi.textSecondary }]}>주소 검색 중...</Text>
                                </View>
                            )}
                            {!searching && searchResults.length === 0 && (
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
                                            onPress={() => openFavoriteSaveSheet(resultPlace)}
                                            disabled={Boolean(favoriteSavingKey)}
                                            style={styles.searchModeFavoriteButton}
                                        >
                                            {isSaving ? (
                                                <ActivityIndicator size="small" color={routeUi.textSecondary} />
                                            ) : (
                                                <Ionicons name="star-outline" size={21} color={routeUi.textSecondary} />
                                            )}
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                    ) : (
                        <View style={styles.searchModePanel}>
                            <View style={[styles.searchModeSectionHeader, { borderBottomColor: routeUi.border }]}>
                                <Text style={[styles.searchModeSectionTitle, { color: routeUi.textSecondary }]}>최근검색</Text>
                                <Text style={[styles.searchModeEditText, { color: routeUi.textSecondary }]}>편집</Text>
                            </View>
                            {recentPlaces.length > 0 ? (
                                recentPlaces.map((place, index) => {
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
                                                style={styles.searchModeFavoriteButton}
                                            >
                                                {isSaving ? (
                                                    <ActivityIndicator size="small" color={routeUi.textSecondary} />
                                                ) : (
                                                    <Ionicons name="star-outline" size={21} color={routeUi.textSecondary} />
                                                )}
                                            </Pressable>
                                            <Pressable
                                                onPress={() => removeRecentPlace(place)}
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
                                        최근 검색 내역이 없습니다.
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
                    <Pressable onPress={close} style={[styles.headerButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}>
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
                                        setActiveTarget("origin");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("origin", text)}
                                    placeholder="출발지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    style={[styles.routeInput, { color: routeUi.textPrimary, borderBottomColor: routeUi.inputBorder }]}
                                />
                                <TextInput
                                    value={destinationText}
                                    onFocus={() => {
                                        setActiveTarget("destination");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("destination", text)}
                                    placeholder="도착지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    style={[styles.routeInput, { color: routeUi.textPrimary }]}
                                />
                            </View>
                            <Pressable onPress={swapPlaces} style={[styles.swapButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}>
                                <Text style={[styles.swapButtonText, { color: routeUi.textSecondary }]}>⇅</Text>
                            </Pressable>
                        </View>

                    </View>
                )}

                {shouldShowRouteResults && (
                    <View style={styles.routeResultHeaderRow}>
                    <TouchableOpacity
                        testID="route-compact-edit-card"
                        accessibilityRole="button"
                        accessibilityLabel="출발지와 도착지 수정"
                        hitSlop={8}
                        activeOpacity={0.86}
                        onPressIn={openCompactRouteEditor}
                        onPress={openCompactRouteEditor}
                        style={[
                            styles.routeCompactCard,
                            styles.routeCompactCardInHeader,
                            { backgroundColor: routeUi.surface, borderColor: routeUi.border },
                        ]}
                    >
                        <View pointerEvents="none" style={styles.routeCompactEditArea}>
                            <View style={styles.routeCompactRail}>
                                <View style={[styles.routeCompactLine, { backgroundColor: routeUi.border }]} />
                                <View style={styles.routeCompactMarkerRow}>
                                    <View style={[styles.routeCompactDot, { borderColor: routeUi.accentGreen }]} />
                                </View>
                                <View style={styles.routeCompactMarkerRow}>
                                    <View style={[styles.routeCompactDot, { borderColor: routeUi.accentRed }]} />
                                </View>
                            </View>
                            <View style={styles.routeCompactTexts}>
                                <Text numberOfLines={1} style={[styles.routeCompactText, { color: routeUi.textPrimary }]}>
                                    {originText || "출발지"}
                                </Text>
                                <View style={[styles.routeCompactDivider, { backgroundColor: routeUi.border }]} />
                                <Text numberOfLines={1} style={[styles.routeCompactText, { color: routeUi.textPrimary }]}>
                                    {destinationText || "도착지"}
                                </Text>
                            </View>
                        </View>
                        <View pointerEvents="none" style={styles.routeCompactSwap}>
                            <Ionicons name="swap-vertical" size={23} color={routeUi.textSecondary} />
                        </View>
                    </TouchableOpacity>
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
                                현재 시간
                            </Text>
                            <Text style={[styles.currentRouteNoticeTimeText, { color: routeUi.accentBlue }]}>
                                {formatCurrentRouteNoticeTime(routeDepartureAt)}
                            </Text>
                            <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>
                                기준
                            </Text>
                        </View>
                        <View style={styles.currentRouteSortGroup}>
                            <Text style={[styles.currentRouteSortText, { color: routeUi.textSecondary }]}>
                                최적 경로순
                            </Text>
                            <Ionicons name="chevron-down" size={14} color={routeUi.textSecondary} />
                        </View>
                    </View>
                )}

                    <View style={styles.routeList}>
                    {hasRouteCoords && routeLoading && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <ActivityIndicator size="small" color={routeUi.textPrimary} />
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>경로 계산 중...</Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !!routeError && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>{routeError}</Text>
                            <Pressable
                                onPress={retryRouteSearch}
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
                        const progressSegments = buildRouteProgressSegments(option, destinationText);
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
	                                    <Pressable onPress={selectRoute} style={styles.routeOptionPressable}>
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
                                            <View style={styles.routeMetricRow}>
                                                {routeMetricChips.map((metric) => {
                                                    const success = metric.tone === "success";
                                                    return (
                                                        <View
                                                            key={`${option.id}-${metric.key}`}
                                                            style={[
                                                                styles.routeMetricChip,
	                                                                {
	                                                                    backgroundColor: success ? routeUi.successChipBg : routeUi.neutralChipBg,
	                                                                    borderColor: success ? routeUi.successChipBorder : routeUi.neutralChipBorder,
	                                                                },
                                                            ]}
                                                        >
                                                            <Text
                                                                numberOfLines={1}
                                                                style={[
                                                                    styles.routeMetricText,
                                                                    { color: success ? routeUi.accentGreen : routeUi.textSecondary },
                                                                ]}
                                                            >
                                                                {metric.label}
                                                            </Text>
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                            {progressSegments.length > 0 && (
                                                <View
                                                    style={[
                                                        styles.routeFlowTrack,
                                                        {
                                                            backgroundColor: routeUi.progressTrackBg,
                                                            borderColor: routeUi.progressTrackBorder,
                                                        },
                                                    ]}
                                                >
                                                    {progressSegments.map((segment, segmentIndex) => {
                                                        const isFirstSegment = segmentIndex === 0;
                                                        const isLastSegment = segmentIndex === progressSegments.length - 1;
                                                        const shouldFloatOnBaseTrack = !segment.isRide;
                                                        const isTransitTransferSpacer = shouldFloatOnBaseTrack && !isFirstSegment && !isLastSegment;
                                                        const shouldShowSegmentLabel = segment.isRide || isFirstSegment || isLastSegment;
                                                        const isEdgeWalkSegment = segment.kind === "WALK" && (isFirstSegment || isLastSegment);
                                                        const shouldUsePinnedDuration = shouldShowSegmentLabel &&
                                                            (segment.isRide || isEdgeWalkSegment) &&
                                                            segment.minutes <= 4;
                                                        const segmentDisplayColor = segment.isRide ? segment.color : routeUi.progressNeutralIconBg;
                                                        return (
                                                            <View
                                                                key={`${option.id}-${segment.key}`}
                                                                style={[
                                                                    styles.routeFlowTrackSegment,
                                                                    {
                                                                        flex: isTransitTransferSpacer ? 0 : segment.flex,
                                                                        width: isTransitTransferSpacer ? 10 : undefined,
                                                                        minWidth: isTransitTransferSpacer ? 10 : segment.isRide ? 44 : isEdgeWalkSegment ? 52 : 18,
                                                                        backgroundColor: shouldFloatOnBaseTrack ? "transparent" : segmentDisplayColor,
                                                                        marginLeft: segmentIndex === 0 ? 0 : 0,
                                                                    },
                                                                ]}
                                                            >
                                                                {(segment.isRide || isFirstSegment) && (
                                                                    <View
                                                                        style={[
                                                                            styles.routeFlowSegmentIconBadge,
                                                                            {
                                                                                backgroundColor: segmentDisplayColor,
                                                                                borderColor: routeUi.progressIconBorder,
                                                                                shadowOpacity: routeUi.progressIconShadowOpacity,
                                                                            },
                                                                        ]}
                                                                    >
                                                                        <Ionicons name={segment.iconName} size={15} color="#FFFFFF" />
                                                                    </View>
                                                                )}
                                                                {shouldShowSegmentLabel && (
                                                                    <Text
                                                                        numberOfLines={1}
                                                                        style={[
                                                                            styles.routeFlowDurationText,
                                                                            shouldUsePinnedDuration && styles.routeFlowPinnedDurationText,
                                                                            segment.isRide && styles.routeFlowRideDurationText,
                                                                            isFirstSegment && styles.routeFlowLeadingDurationText,
                                                                            isLastSegment && styles.routeFlowTrailingDurationText,
                                                                            { color: segment.isRide ? "#FFFFFF" : routeUi.progressTrackText },
                                                                        ]}
                                                                    >
                                                                        {segment.detailLabel.replace("환승 ", "")}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        );
                                                    })}
                                                </View>
                                            )}
                                            {progressSegments.length > 0 && (
                                                <View style={styles.routeFlowLineLabelRow}>
                                                    {progressSegments.map((segment, segmentIndex) => {
                                                        const isTransitTransferSpacer = !segment.isRide &&
                                                            segmentIndex > 0 &&
                                                            segmentIndex < progressSegments.length - 1;
                                                        return (
                                                            <View
                                                                key={`${option.id}-${segment.key}-line`}
                                                                style={[
                                                                    styles.routeFlowLineLabelCell,
                                                                    {
                                                                        flex: isTransitTransferSpacer ? 0 : segment.flex,
                                                                        width: isTransitTransferSpacer ? 10 : undefined,
                                                                        minWidth: isTransitTransferSpacer ? 10 : undefined,
                                                                    },
                                                                ]}
                                                            >
                                                                {!!segment.lineLabel && (
                                                                    <Text numberOfLines={1} style={[styles.routeFlowLineLabelText, { color: segment.color }]}>
                                                                        {segment.lineLabel}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        );
                                                    })}
	                                                </View>
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
                                    {!!option.attributionText && !!option.attributionUrl && (
                                        <Pressable
                                            accessibilityRole="link"
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
                                                style={[styles.routeCardPrimaryButton, { backgroundColor: routeUi.accentBlue }]}
                                            >
                                                <Text style={styles.routeCardPrimaryButtonText}>
                                                    이 경로로 저장
                                                </Text>
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
    routeCompactCard: {
        minHeight: 78,
        borderWidth: 1,
        borderRadius: 20,
        paddingLeft: 18,
        paddingRight: 12,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        position: "relative",
        overflow: "hidden",
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
    routeCompactCardPressed: {
        opacity: 0.86,
    },
    routeCompactSwap: {
        width: 40,
        height: 54,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3,
    },
    routeCompactTapOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
    routeCompactEditArea: {
        flex: 1,
        minWidth: 0,
        alignSelf: "stretch",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    routeCompactRail: {
        width: 20,
        alignSelf: "stretch",
        justifyContent: "space-between",
        paddingVertical: 3,
        position: "relative",
    },
    routeCompactMarkerRow: {
        minHeight: 22,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    routeCompactDot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    routeCompactLine: {
        position: "absolute",
        left: 9.5,
        top: 25,
        bottom: 25,
        width: StyleSheet.hairlineWidth,
        borderRadius: 999,
    },
    routeCompactTexts: {
        flex: 1,
        minWidth: 0,
        gap: 5,
    },
    routeCompactText: {
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 22,
    },
    routeCompactDivider: {
        height: StyleSheet.hairlineWidth,
        width: "100%",
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
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeSearchBox: {
        flex: 1,
        minWidth: 0,
        height: 40,
        borderRadius: 8,
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
    searchModeActionRow: {
        minHeight: 86,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 14,
    },
    searchModeActionButton: {
        flex: 1,
        minHeight: 64,
        borderRadius: 8,
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
        paddingTop: 10,
    },
    searchModePanel: {
        width: "100%",
    },
    searchModeSectionHeader: {
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        marginBottom: 6,
    },
    searchModeSectionTitle: {
        fontSize: 14,
        fontWeight: "900",
    },
    searchModeEditText: {
        fontSize: 13,
        fontWeight: "800",
    },
    searchModeResultRow: {
        minHeight: 68,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        marginHorizontal: 16,
        marginBottom: 6,
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
        borderRadius: 8,
        marginHorizontal: 16,
        marginBottom: 6,
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
        minHeight: 72,
        justifyContent: "center",
        paddingHorizontal: 22,
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
        paddingHorizontal: 18,
        paddingTop: 10,
        gap: 14,
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
    routeFlowTrack: {
        width: "100%",
        height: 16,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "visible",
        marginTop: 7,
    },
    routeFlowTrackSegment: {
        height: "100%",
        minWidth: 12,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 2,
        borderTopLeftRadius: 999,
        borderBottomLeftRadius: 999,
        borderTopRightRadius: 999,
        borderBottomRightRadius: 999,
        overflow: "visible",
    },
    routeFlowSegmentIconBadge: {
        position: "absolute",
        left: -2,
        top: -8,
        width: 30,
        height: 30,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        shadowColor: "#000000",
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        zIndex: 4,
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
    routeFlowDurationText: {
        maxWidth: "100%",
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 12,
        letterSpacing: 0,
        textAlign: "center",
    },
    routeFlowPinnedDurationText: {
        position: "absolute",
        left: 0,
        top: 2,
        minWidth: 30,
        maxWidth: 42,
        paddingHorizontal: 2,
        zIndex: 6,
    },
    routeFlowRideDurationText: {
        marginLeft: 24,
        paddingRight: 3,
    },
    routeFlowLeadingDurationText: {
        marginLeft: 32,
        paddingRight: 2,
    },
    routeFlowTrailingDurationText: {
        marginLeft: 12,
    },
    routeFlowLineLabelRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        minHeight: 14,
        marginTop: 2,
    },
    routeFlowLineLabelCell: {
        minWidth: 12,
        alignItems: "center",
    },
    routeFlowLineLabelText: {
        fontSize: 11,
        fontWeight: "900",
        lineHeight: 14,
        letterSpacing: 0,
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
    mapPickerActionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    mapPickerSecondaryButton: {
        flex: 1,
        minHeight: 48,
        borderRadius: 14,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    mapPickerSecondaryText: {
        fontSize: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    mapPickerPrimaryButton: {
        flex: 1.25,
        minHeight: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    mapPickerPrimaryText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Keyboard,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    StatusBar,
    Text,
    TextInput,
    View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
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
import {
    getRouteAlternativeOptions,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    type PlaceSearchItem,
    type RouteAlternativeOption,
} from "../../src/modules/map/tmapApi";
import { getRoutePlannerInitial, setRoutePlannerInitial } from "../../src/modules/schedule/routePlannerSession";
import {
    getRecentRoutePlaces,
    removeRecentRoutePlace,
    saveFavoriteDeparturePlace,
    saveRecentRoutePlace,
} from "../../src/modules/schedule/favoriteDeparture";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";

const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];

type RoutePointTarget = "origin" | "destination";
type TransitRouteFilter = "ALL" | "SUBWAY" | "BUS" | "MIXED";
type RouteSelectTransitLeg = NonNullable<RouteAlternativeOption["transitLegs"]>[number];
type RouteProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    minutes: number;
    color: string;
    kind: RouteSelectTransitLeg["kind"];
};
type RouteLineHighlight = {
    key: string;
    label: string;
    color: string;
    kind: RouteSelectTransitLeg["kind"];
    title: string;
    detail: string;
    badgeTone: "filled" | "walk";
};
type RouteDisplayLeg = {
    leg: RouteSelectTransitLeg;
    index: number;
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

const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "SUBWAY", label: "지하철" },
    { key: "BUS", label: "버스" },
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
    walk: "#5F6670",
    bus: "#2F6FED",
    subway: "#16A34A",
    etc: "#7C8794",
};
const SUBWAY_LINE_COLOR_RULES: Array<{ pattern: RegExp; color: string }> = [
    { pattern: /1호선/, color: "#0052A4" },
    { pattern: /2호선/, color: "#00A84D" },
    { pattern: /3호선/, color: "#EF7C1C" },
    { pattern: /4호선/, color: "#00A5DE" },
    { pattern: /5호선/, color: "#996CAC" },
    { pattern: /6호선/, color: "#CD7C2F" },
    { pattern: /7호선/, color: "#747F00" },
    { pattern: /8호선/, color: "#E6186C" },
    { pattern: /9호선/, color: "#BDB092" },
    { pattern: /공항철도|AREX/i, color: "#0090D2" },
    { pattern: /경의중앙/, color: "#77C4A3" },
    { pattern: /수인분당|분당선|수인선/, color: "#E7B416" },
    { pattern: /신분당/, color: "#D31145" },
    { pattern: /경춘/, color: "#178C72" },
    { pattern: /경강/, color: "#0054A6" },
    { pattern: /서해/, color: "#8FC31F" },
    { pattern: /김포골드|김포도시철도/, color: "#A17800" },
    { pattern: /우이신설/, color: "#B7C452" },
    { pattern: /신림선/, color: "#6789CA" },
    { pattern: /용인경전철|에버라인/, color: "#6FB245" },
    { pattern: /의정부경전철/, color: "#FDA600" },
    { pattern: /인천1호선/, color: "#7CA8D5" },
    { pattern: /인천2호선/, color: "#ED8B00" },
];

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
        <Pressable onPress={onPress} style={styles.modeButtonShell}>
            <Animated.View
                style={[
                    styles.modeButton,
                    {
                        backgroundColor,
                        borderColor,
                        transform: [{ scale }],
                    },
                ]}
            >
                <Text style={[styles.modeButtonText, { color: textColor }]}>
                    {label}
                </Text>
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
                { opacity: disabled ? 0.38 : 1 },
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

// 분 단위 소요 시간을 화면용 한국어 문자열로 바꾼다.
function formatDuration(minutes?: number): string {
    if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "-";
    const totalMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(totalMinutes / 60);
    const remainMinutes = totalMinutes % 60;
    if (hours === 0) return `${remainMinutes}분`;
    if (remainMinutes === 0) return `${hours}시간`;
    return `${hours}시간 ${remainMinutes}분`;
}

// 미터 단위 거리를 m/km 화면 문자열로 바꾼다.
function formatDistance(distanceMeters?: number): string | undefined {
    if (typeof distanceMeters !== "number") return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}

// 카드에서 쓰는 오전/오후 시간 문자열을 만든다.
function formatRouteClock(date: Date): string {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "오전" : "오후";
    const displayHour = hours % 12 || 12;
    return `${period} ${displayHour}:${minutes}`;
}

// 경로 카드의 출발-도착 시간과 요금을 한 줄로 만든다.
function formatRouteTimeFare(option: RouteAlternativeOption, departureAt: Date): string | undefined {
    const chunks: string[] = [];
    if (typeof option.minutes === "number") {
        const arrivalAt = new Date(departureAt.getTime() + Math.max(0, option.minutes) * 60 * 1000);
        chunks.push(`${formatRouteClock(departureAt)} - ${formatRouteClock(arrivalAt)}`);
    }
    if (typeof option.fareWon === "number") chunks.push(`${option.fareWon.toLocaleString()}원`);
    return chunks.length ? chunks.join(" | ") : undefined;
}

// 경로 카드에서 요금을 제외한 이동 조건 요약을 만든다.
function formatRouteConditionLine(option: RouteAlternativeOption): string | undefined {
    const chunks: string[] = [];
    if (typeof option.transferCount === "number") chunks.push(`환승 ${option.transferCount}회`);
    const walkText = formatDistance(option.walkMeters);
    if (walkText) chunks.push(`도보 ${walkText}`);
    const distanceText = formatDistance(option.distanceMeters);
    if (distanceText) chunks.push(distanceText);
    return chunks.length ? chunks.join(" · ") : undefined;
}

// 긴 경로명을 배지 안에 들어가도록 줄인다.
function compactCardBadgeLabel(label: string): string {
    return label.length > 5 ? `${label.slice(0, 5)}…` : label;
}

// 대중교통 경로 후보를 지하철/버스/복합 경로로 분류한다.
function getTransitRouteCategory(option: RouteAlternativeOption): TransitRouteFilter {
    const legs = option.transitLegs ?? [];
    const hasSubway = legs.some((leg) => leg.kind === "SUBWAY");
    const hasBus = legs.some((leg) => leg.kind === "BUS");
    if (hasSubway && hasBus) return "MIXED";
    if (hasSubway) return "SUBWAY";
    if (hasBus) return "BUS";
    return "ALL";
}

// 대중교통 필터 탭에 표시할 경로 개수를 계산한다.
function getTransitFilterCount(options: RouteAlternativeOption[], filter: TransitRouteFilter): number {
    if (filter === "ALL") return options.length;
    return options.filter((option) => getTransitRouteCategory(option) === filter).length;
}

// 노선명을 카드 막대 아래에 들어갈 짧은 라벨로 정리한다.
function compactLineLabel(leg: RouteSelectTransitLeg): string | undefined {
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
    const normalized = lineName?.trim();
    if (!normalized) return ROUTE_SEGMENT_FALLBACK_COLORS.subway;
    const matched = SUBWAY_LINE_COLOR_RULES.find((item) => item.pattern.test(normalized));
    return matched?.color ?? ROUTE_SEGMENT_FALLBACK_COLORS.subway;
}

// 버스 번호 패턴을 기준으로 간선/지선/광역 톤에 가까운 색을 찾는다.
function getBusLineColor(lineName?: string): string {
    const compactLabel = lineName?.trim();
    if (!compactLabel) return ROUTE_SEGMENT_FALLBACK_COLORS.bus;

    const upper = compactLabel.toUpperCase();
    if (/^M\d+/.test(upper)) return "#E84B4B";

    const numberToken = upper.match(/\d+/)?.[0];
    if (!numberToken) return ROUTE_SEGMENT_FALLBACK_COLORS.bus;
    if (numberToken.startsWith("9")) return "#E84B4B";
    if (/^\d{4}$/.test(numberToken)) return "#25B853";
    if (/^\d{2}$/.test(numberToken)) return "#E5B93B";
    if (/^\d{3}$/.test(numberToken)) return "#1D72FF";
    if (/^\d{5,}$/.test(numberToken)) return "#25B853";
    return ROUTE_SEGMENT_FALLBACK_COLORS.bus;
}

// 대중교통 구간의 노선색을 결정한다.
function getTransitLegColor(leg: RouteSelectTransitLeg): string {
    if (leg.lineColor && /^#[0-9A-F]{6}$/i.test(leg.lineColor)) return leg.lineColor;
    const lineLabel = compactLineLabel(leg) ?? leg.lineName ?? leg.label;
    if (leg.kind === "BUS") return getBusLineColor(lineLabel);
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
function buildRouteProgressSegments(option: RouteAlternativeOption): RouteProgressSegment[] {
    const legs = option.transitLegs ?? [];
    if (!legs.length) return [];

    return legs
        .map((leg, index) => {
            const minutes = getLegDurationMinutes(leg);
            const color = getTransitLegColor(leg);
            const label = `${minutes}분`;
            const lineLabel = leg.kind === "WALK" ? undefined : compactLineLabel(leg);
            return {
                key: `${leg.kind}:${lineLabel ?? leg.label}:${index}`,
                label,
                lineLabel,
                minutes,
                color,
                kind: leg.kind,
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

// 도보 구간의 시작/도착 문구를 경로 흐름에 맞게 만든다.
function buildWalkHighlightTitle(
    leg: RouteSelectTransitLeg,
    index: number,
    legs: RouteSelectTransitLeg[]
): string {
    const isFirst = index === 0;
    const isLast = index === legs.length - 1;
    const startText = leg.startName ?? (isFirst ? "출발지" : "이전 하차지점");
    const endText = leg.endName ?? (isLast ? "도착지" : "다음 승차지점");
    return `${startText} → ${endText}`;
}

// 경로 카드에는 시작 도보, 주요 탑승, 마지막 도보를 우선 노출한다.
function pickRouteCardLegs(legs: RouteSelectTransitLeg[]): RouteDisplayLeg[] {
    const picked: RouteDisplayLeg[] = [];
    const addLeg = (leg: RouteSelectTransitLeg, index: number) => {
        if (picked.some((item) => item.index === index)) return;
        picked.push({ leg, index });
    };

    legs.forEach((leg, index) => {
        const isEdgeWalk = leg.kind === "WALK" && (index === 0 || index === legs.length - 1);
        const isRide = leg.kind === "SUBWAY" || leg.kind === "BUS";
        if (isEdgeWalk || isRide) addLeg(leg, index);
    });

    if (picked.length <= 5) return picked;

    const firstWalk = picked.find((item) => item.leg.kind === "WALK" && item.index === 0);
    const lastWalk = [...picked].reverse().find((item) => item.leg.kind === "WALK" && item.index === legs.length - 1);
    const rideLegs = picked.filter((item) => item.leg.kind === "SUBWAY" || item.leg.kind === "BUS").slice(0, 3);
    const compactPicked = [firstWalk, ...rideLegs, lastWalk].filter((item): item is RouteDisplayLeg => Boolean(item));
    return compactPicked.length > 0 ? compactPicked : picked.slice(0, 5);
}

// 카드 안에서 단계별 핵심 이동 구간을 뽑는다.
function buildRouteLineHighlights(option: RouteAlternativeOption): RouteLineHighlight[] {
    const legs = option.transitLegs ?? [];
    const displayLegs = pickRouteCardLegs(legs);

    return displayLegs.map(({ leg, index }) => {
        const label = leg.kind === "WALK" ? "도보" : (compactLineLabel(leg) ?? getTransitKindLabel(leg.kind));
        const startText = leg.kind === "WALK"
            ? buildWalkHighlightTitle(leg, index, legs)
            : (leg.startName ? `${leg.startName} 승차` : `${getTransitKindLabel(leg.kind)} 승차`);
        const endText = leg.kind === "WALK" ? undefined : (leg.endName ? `${leg.endName} 하차` : undefined);
        const stationText = typeof leg.stationCount === "number" ? `${leg.stationCount}정거장` : undefined;
        const distanceText = formatDistance(leg.distanceMeters);
        const detail = leg.kind === "WALK"
            ? [distanceText, `${getLegDurationMinutes(leg)}분`].filter(Boolean).join(" · ")
            : [stationText, `${getLegDurationMinutes(leg)}분`].filter(Boolean).join(" · ");
        return {
            key: `${leg.kind}:${label}:${index}`,
            label,
            color: getTransitLegColor(leg),
            kind: leg.kind,
            title: [startText, endText].filter(Boolean).join(" → "),
            detail,
            badgeTone: leg.kind === "WALK" ? "walk" : "filled",
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

    if (textIncludesAny(text, ["지하철", "전철", "도시철도", "철도", "ktx", "호선"]) || /역(\s|$|\[|\(|\d)/.test(text)) {
        return "train-outline";
    }
    if (textIncludesAny(text, ["버스", "정류장", "bus"])) {
        return "bus-outline";
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
    const { colors, mode } = useTheme();
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
    }>();
    const sessionId = readParam(params.sessionId) ?? "";
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
    const [travelMode, setTravelMode] = useState<TravelMode>(initial?.travelMode ?? "CAR");
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget>("origin");
    const [isEditingRoutePoint, setIsEditingRoutePoint] = useState(!initialHasRouteCoords);
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
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [hasTypedSearchQuery, setHasTypedSearchQuery] = useState(false);
    const [searching, setSearching] = useState(false);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState<string | undefined>();
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recentPlacesLoadedRef = useRef(false);
    const originTouchedRef = useRef(Boolean(initial?.origin));
    const routeDepartureAt = useMemo(() => new Date(), []);
    const routeContentAnim = useRef(new Animated.Value(1)).current;

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
        if (travelMode !== "TRANSIT" || transitRouteFilter === "ALL") return routeAlternatives;
        return routeAlternatives.filter((option) => getTransitRouteCategory(option) === transitRouteFilter);
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

    const persistInitial = useCallback((travelMinutes?: number) => {
        if (!sessionId) return;
        const nextOrigin = buildPlace(originText, originAddress, originLat, originLng);
        const nextDestination = buildPlace(destinationText, destinationAddress, destinationLat, destinationLng);
        setRoutePlannerInitial(sessionId, {
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name || nextOrigin?.name,
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

    const clearSearch = useCallback(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchResults([]);
        setHasTypedSearchQuery(false);
        setSearching(false);
    }, []);

    useEffect(() => {
        setOriginText(initial?.origin?.name ?? "");
        setOriginAddress(initial?.origin?.address);
        setOriginLat(initial?.origin?.lat);
        setOriginLng(initial?.origin?.lng);
        setDestinationText(initial?.destination?.name ?? "");
        setDestinationAddress(initial?.destination?.address);
        setDestinationLat(initial?.destination?.lat);
        setDestinationLng(initial?.destination?.lng);
        setTravelMode(initial?.travelMode ?? "CAR");
        setActiveTarget("origin");
        setIsEditingRoutePoint(!initialHasRouteCoords);
        originTouchedRef.current = Boolean(initial?.origin);
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
        initial?.travelMode,
        initialHasRouteCoords,
        sessionId,
    ]);

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
                const items = await searchAddressByKeyword(text.trim());
                setSearchResults(items);
            } catch (error) {
                const message = error instanceof Error ? error.message : "주소 검색에 실패했습니다.";
                Alert.alert("검색 실패", message);
            } finally {
                setSearching(false);
            }
        }, 450);
    }, []);

    const applyPlace = useCallback((target: RoutePointTarget, item: PlaceSearchItem) => {
        const nextPlace = buildPlaceFromSearchItem(item);
        rememberRecentPlace(nextPlace);
        applyPlaceToTarget(
            target,
            nextPlace
        );
    }, [applyPlaceToTarget, rememberRecentPlace]);

    const useCurrentLocationForTarget = useCallback(async (target: RoutePointTarget) => {
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

    const useCurrentLocationForActiveTarget = useCallback(() => {
        useCurrentLocationForTarget(activeTarget);
    }, [activeTarget, useCurrentLocationForTarget]);

    const useRecentPlaceForActiveTarget = useCallback((place: Place) => {
        applyPlaceToTarget(activeTarget, place);
    }, [activeTarget, applyPlaceToTarget]);

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

    useEffect(() => {
        let cancelled = false;
        setSelectedRouteId(undefined);
        setRouteAlternatives([]);
        setRouteError(undefined);

        if (!hasRouteCoords) return;

        setRouteLoading(true);
        getRouteAlternativeOptions(origin, destination, travelMode)
            .then((items) => {
                if (cancelled) return;
                setRouteAlternatives(items);
                setSelectedRouteId(items[0]?.id);
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
    }, [destination, hasRouteCoords, origin, travelMode]);

    useEffect(() => {
        if (!visibleRouteAlternatives.length) return;
        if (selectedRouteId && visibleRouteAlternatives.some((option) => option.id === selectedRouteId)) return;
        setSelectedRouteId(visibleRouteAlternatives[0].id);
    }, [selectedRouteId, visibleRouteAlternatives]);

    const openMapForOption = useCallback((routeOption?: RouteAlternativeOption) => {
        if (!sessionId) return;
        const targetRoute = routeOption ?? selectedRoute;
        const targetIndex = targetRoute
            ? routeAlternatives.findIndex((option) => option.id === targetRoute.id)
            : selectedRouteIndex;
        persistInitial(targetRoute?.minutes);
        router.replace({
            pathname: "/schedule/route-planner",
            params: {
                sessionId,
                routeIndex: targetIndex >= 0 ? String(targetIndex) : "0",
            },
        });
    }, [persistInitial, routeAlternatives, router, selectedRoute, selectedRouteIndex, sessionId]);

    const openMapForRouteReset = useCallback(() => {
        openMapForOption();
    }, [openMapForOption]);

    const exitSearchMode = useCallback(() => {
        clearSearch();
        setIsEditingRoutePoint(false);
    }, [clearSearch]);

    const routeUi = {
        background: colors.background,
        surface: colors.surface,
        surface2: colors.surface2,
        border: colors.border,
        borderStrong: isDark ? "#474950" : "#CBD5E1",
        textPrimary: colors.textPrimary,
        textSecondary: colors.textSecondary,
        textDisabled: colors.textDisabled,
        clearButtonBg: isDark ? "#474950" : "#8E8E93",
        clearButtonText: "#FFFFFF",
        accentBlue: isDark ? "#4B9DFF" : "#0B63FF",
        accentGreen: "#22C55E",
        accentRed: "#F0524C",
    };
    const modeSelectedBg = routeUi.accentBlue;
    const modeSelectedText = isDark ? "#101114" : "#FFFFFF";
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
                        <View style={[styles.favoriteNewCategoryBox, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}>
                            <TextInput
                                value={newCategoryName}
                                onChangeText={setNewCategoryName}
                                placeholder="카테고리 이름"
                                placeholderTextColor={routeUi.textDisabled}
                                selectionColor={routeUi.accentBlue}
                                style={[
                                    styles.favoriteNewCategoryInput,
                                    {
                                        color: routeUi.textPrimary,
                                        borderColor: routeUi.border,
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

    if (isEditingRoutePoint) {
        return (
            <View style={[styles.screen, { backgroundColor: routeUi.background, paddingTop: insets.top + 10 }]}>
                <StatusBar barStyle={statusBarStyle} />
                {favoriteSaveSheet}
                <View style={styles.searchModeHeader}>
                    <Pressable onPress={exitSearchMode} style={styles.searchModeBackButton}>
                        <Text style={[styles.searchModeBackText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <TextInput
                        autoFocus
                        value={activeSearchText}
                        onChangeText={(text) => handleSearchChange(activeTarget, text)}
                        placeholder={`${activeTargetLabel}를 입력하세요`}
                        placeholderTextColor={routeUi.textDisabled}
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

                <View style={[styles.searchModeActionRow, { borderBottomColor: routeUi.border }]}>
                    <Pressable onPress={useCurrentLocationForActiveTarget} style={styles.searchModeActionButton}>
                        <Ionicons name="navigate-outline" size={22} color={routeUi.accentBlue} />
                        <Text style={[styles.searchModeActionText, { color: routeUi.accentBlue }]}>내위치</Text>
                    </Pressable>
                    <Pressable onPress={openMapForRouteReset} style={styles.searchModeActionButton}>
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
                                            { borderBottomColor: routeUi.border },
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
                                                {!!item.category && (
                                                    <Text numberOfLines={1} style={styles.searchResultCategory}>
                                                        {item.category}
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
                                                { borderBottomColor: routeUi.border },
                                            ]}
                                        >
                                            <Pressable
                                                onPress={() => useRecentPlaceForActiveTarget(place)}
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
        <View style={[styles.screen, { backgroundColor: routeUi.background, paddingTop: insets.top + 8 }]}>
            <StatusBar barStyle={statusBarStyle} />
            {favoriteSaveSheet}
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
            </View>

            <ScrollView
                directionalLockEnabled
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, 36) }]}
            >
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
                                placeholderTextColor={routeUi.textDisabled}
                                style={[styles.routeInput, { color: routeUi.textPrimary, borderBottomColor: routeUi.border }]}
                            />
                            <TextInput
                                value={destinationText}
                                onFocus={() => {
                                    setActiveTarget("destination");
                                    setIsEditingRoutePoint(true);
                                }}
                                onChangeText={(text) => handleSearchChange("destination", text)}
                                placeholder="도착지를 입력하세요"
                                placeholderTextColor={routeUi.textDisabled}
                                style={[styles.routeInput, { color: routeUi.textPrimary }]}
                            />
                        </View>
                        <Pressable onPress={swapPlaces} style={[styles.swapButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}>
                            <Text style={[styles.swapButtonText, { color: routeUi.textSecondary }]}>⇅</Text>
                        </Pressable>
                    </View>

                </View>

                {shouldShowRouteResults && (
                <View style={styles.modeRow}>
                    {SELECTABLE_TRAVEL_MODES.map((modeItem) => {
                        const selected = travelMode === modeItem;
                        return (
                            <AnimatedTravelModeButton
                                key={modeItem}
                                selected={selected}
                                label={TRAVEL_MODE_META[modeItem].label}
                                backgroundColor={selected ? modeSelectedBg : routeUi.surface}
                                borderColor={selected ? modeSelectedBg : routeUi.border}
                                textColor={selected ? modeSelectedText : routeUi.textSecondary}
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
                        contentContainerStyle={styles.transitFilterRow}
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
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.length === 0 && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>
                                선택한 교통수단에 해당하는 경로가 없습니다.
                            </Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.map((option) => {
                        const selected = selectedRouteId === option.id;
                        const absoluteIndex = routeAlternatives.findIndex((routeOption) => routeOption.id === option.id);
                        const accent = selected ? routeUi.accentBlue : routeUi.border;
                        const cardBackground = routeUi.surface;
                        const progressSegments = buildRouteProgressSegments(option);
                        const routeTimeFare = formatRouteTimeFare(option, routeDepartureAt);
                        const routeConditionLine = formatRouteConditionLine(option);
                        const lineHighlights = buildRouteLineHighlights(option);
                        const progressTrackBg = routeUi.borderStrong;
                        const stepRailBg = routeUi.border;
                        const walkBadgeBg = routeUi.surface2;
                        const walkBadgeText = routeUi.textSecondary;
                        const openRouteDetail = () => {
                            setSelectedRouteId(option.id);
                            openMapForOption(option);
                        };
                        return (
                            <AnimatedRouteCardShell
                                key={option.id}
                                selected={selected}
                                style={[
                                    styles.routeOptionCard,
                                    {
                                        backgroundColor: cardBackground,
                                        borderColor: accent,
                                    },
                                    selected
                                        ? styles.routeOptionCardSelectedDark
                                        : styles.routeOptionCardInactive,
                                ]}
                            >
                                <Pressable onPress={openRouteDetail}>
                                    <View style={styles.routeOptionHeader}>
                                        <View style={styles.routeOptionTopRow}>
                                            <Text style={[styles.routeOptionLabel, { color: selected ? routeUi.accentBlue : routeUi.textSecondary }]}>
                                                {absoluteIndex <= 0 ? "최적" : `대안 경로 ${absoluteIndex + 1}`}
                                            </Text>
                                            <Text numberOfLines={1} style={[styles.routeOptionDuration, { color: routeUi.textPrimary }]}>
                                                {formatDuration(option.minutes)}
                                            </Text>
                                        </View>
                                        {!!routeTimeFare && (
                                            <Text numberOfLines={1} style={[styles.routeOptionTimeFare, { color: routeUi.textSecondary }]}>
                                                {routeTimeFare}
                                            </Text>
                                        )}
                                        {!!routeConditionLine && (
                                            <Text numberOfLines={1} style={[styles.routeOptionCondition, { color: routeUi.textSecondary }]}>
                                                {routeConditionLine}
                                            </Text>
                                        )}
                                    </View>
                                </Pressable>

                                {progressSegments.length > 0 && (
                                    <View style={styles.routeProgressBlock}>
                                        <ScrollView
                                            horizontal
                                            directionalLockEnabled
                                            nestedScrollEnabled
                                            scrollEnabled={progressSegments.length > 1}
                                            showsHorizontalScrollIndicator={false}
                                            style={styles.routeProgressScroll}
                                            contentContainerStyle={[
                                                styles.routeProgressTrack,
                                                styles.routeProgressTrackDark,
                                            ]}
                                        >
                                            {progressSegments.map((segment) => {
                                                const segmentBg = segment.kind === "WALK" ? progressTrackBg : segment.color;
                                                const segmentBadge = segment.kind === "WALK" ? "도" : segment.kind === "BUS" ? "버" : "지";
                                                return (
                                                    <View
                                                        key={segment.key}
                                                        style={[
                                                            styles.routeProgressSegment,
                                                            {
                                                                backgroundColor: segmentBg,
                                                                width: Math.min(240, Math.max(47, segment.minutes * 7)),
                                                            },
                                                        ]}
                                                    >
                                                        <View style={[styles.routeProgressBadge, { backgroundColor: cardBackground }]}>
                                                            <Text style={[styles.routeProgressBadgeText, { color: segmentBg }]}>{segmentBadge}</Text>
                                                        </View>
                                                        <Text
                                                            numberOfLines={1}
                                                            style={[
                                                                styles.routeProgressSegmentText,
                                                                segment.kind === "WALK" ? styles.routeProgressWalkText : null,
                                                            ]}
                                                        >
                                                            {segment.label}
                                                        </Text>
                                                    </View>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>
                                )}

                                <Pressable onPress={openRouteDetail} style={styles.routeOptionDetailTapArea}>
                                    {lineHighlights.length > 0 && (
                                        <View style={[styles.routeHighlightList, { borderTopColor: routeUi.border }]}>
                                            {lineHighlights.map((highlight, highlightIndex) => (
                                                <View key={highlight.key} style={styles.routeHighlightRow}>
                                                    <View style={styles.routeHighlightRail}>
                                                        <View
                                                            style={[
                                                                styles.routeHighlightDot,
                                                                {
                                                                    backgroundColor: highlight.badgeTone === "walk" ? cardBackground : highlight.color,
                                                                    borderColor: highlight.color,
                                                                },
                                                            ]}
                                                        />
                                                        {highlightIndex < lineHighlights.length - 1 && (
                                                            <View
                                                                style={[
                                                                    styles.routeHighlightRailLine,
                                                                    {
                                                                        backgroundColor: highlight.badgeTone === "walk" ? stepRailBg : highlight.color,
                                                                    },
                                                                ]}
                                                            />
                                                        )}
                                                    </View>
                                                    <View style={styles.routeHighlightTextWrap}>
                                                        <View style={styles.routeHighlightTitleRow}>
                                                            <View
                                                                style={[
                                                                    styles.routeHighlightBadge,
                                                                    {
                                                                        backgroundColor: highlight.badgeTone === "walk" ? walkBadgeBg : highlight.color,
                                                                        borderColor: highlight.badgeTone === "walk" ? stepRailBg : highlight.color,
                                                                    },
                                                                ]}
                                                            >
                                                                <Text
                                                                    numberOfLines={1}
                                                                    style={[
                                                                        styles.routeHighlightBadgeText,
                                                                        { color: highlight.badgeTone === "walk" ? walkBadgeText : "#FFFFFF" },
                                                                    ]}
                                                                >
                                                                    {compactCardBadgeLabel(highlight.label)}
                                                                </Text>
                                                            </View>
                                                            <Text numberOfLines={2} style={[styles.routeHighlightTitle, { color: routeUi.textPrimary }]}>
                                                                {highlight.title}
                                                            </Text>
                                                        </View>
                                                        <Text numberOfLines={1} style={[styles.routeHighlightDetail, { color: routeUi.textSecondary }]}>
                                                            {highlight.detail}
                                                        </Text>
                                                    </View>
                                                </View>
                                            ))}
                                        </View>
                                    )}
                                    <View style={styles.routeOptionFooterRow}>
                                        <Text style={[styles.routeOptionFooterText, { color: routeUi.accentBlue }]}>
                                            탭해서 상세 경로 보기
                                        </Text>
                                        <Text style={[styles.routeOptionFooterIcon, { color: routeUi.accentBlue }]}>›</Text>
                                    </View>
                                </Pressable>
                            </AnimatedRouteCardShell>
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
    content: {
        paddingHorizontal: 16,
        gap: 12,
    },
    routeCard: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 14,
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
        minHeight: 62,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 6,
    },
    searchModeBackButton: {
        width: 34,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    searchModeBackText: {
        marginTop: -3,
        fontSize: 42,
        fontWeight: "300",
        lineHeight: 44,
    },
    searchModeInput: {
        flex: 1,
        minWidth: 0,
        height: 48,
        paddingVertical: 0,
        fontSize: 21,
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
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-evenly",
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 18,
        paddingBottom: 8,
    },
    searchModeActionButton: {
        minWidth: 120,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingVertical: 10,
    },
    searchModeActionText: {
        fontSize: 15,
        fontWeight: "800",
    },
    searchModeContent: {
        flexGrow: 1,
        paddingTop: 18,
    },
    searchModePanel: {
        width: "100%",
    },
    searchModeSectionHeader: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 22,
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
        minHeight: 66,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchModeResultMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 22,
        paddingRight: 8,
        paddingVertical: 10,
    },
    searchModeRecentRow: {
        minHeight: 66,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchModeRecentMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 22,
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
        gap: 10,
        paddingVertical: 4,
    },
    modeButtonShell: {
        flex: 1,
    },
    modeButton: {
        borderWidth: 1,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    modeButtonText: {
        fontSize: 12,
        fontWeight: "900",
    },
    transitFilterRow: {
        gap: 24,
        paddingHorizontal: 2,
        paddingTop: 4,
        paddingBottom: 2,
    },
    transitFilterTab: {
        position: "relative",
        minWidth: 52,
        paddingBottom: 10,
    },
    transitFilterIndicator: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 3,
        borderRadius: 999,
    },
    transitFilterText: {
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
    routeList: {
        gap: 10,
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
    routeOptionCard: {
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 14,
        gap: 11,
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
        shadowColor: "#000000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
    },
    routeOptionCardSelectedDark: {
        borderWidth: 1,
        shadowColor: "#000000",
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
    },
    routeOptionHeader: {
        alignItems: "flex-start",
        gap: 6,
    },
    routeOptionTopRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    routeOptionLabel: {
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
        paddingTop: 5,
    },
    routeOptionDuration: {
        flexShrink: 0,
        maxWidth: "72%",
        textAlign: "right",
        fontSize: 28,
        fontWeight: "900",
        letterSpacing: 0,
        lineHeight: 33,
    },
    routeOptionTimeFare: {
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 18,
        letterSpacing: 0,
    },
    routeOptionCondition: {
        fontSize: 12,
        fontWeight: "800",
        lineHeight: 17,
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
    routeProgressTrack: {
        minHeight: 24,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: "transparent",
        paddingRight: 2,
    },
    routeProgressTrackLight: {
        backgroundColor: "transparent",
    },
    routeProgressTrackDark: {
        backgroundColor: "transparent",
    },
    routeProgressSegment: {
        height: 23,
        minWidth: 42,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 5,
        borderRadius: 999,
        paddingHorizontal: 6,
        position: "relative",
    },
    routeProgressSegmentText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0,
        lineHeight: 13,
    },
    routeProgressWalkText: {
        color: "#F3F4F6",
        opacity: 0.86,
    },
    routeProgressBadge: {
        width: 16,
        height: 16,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    routeProgressBadgeText: {
        fontSize: 9,
        fontWeight: "900",
        lineHeight: 11,
        letterSpacing: 0,
    },
    routeHighlightList: {
        gap: 0,
        paddingTop: 11,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#D8DEE7",
    },
    routeHighlightRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        minHeight: 48,
    },
    routeHighlightRail: {
        width: 18,
        alignItems: "center",
        alignSelf: "stretch",
        paddingTop: 6,
    },
    routeHighlightDot: {
        width: 11,
        height: 11,
        borderRadius: 999,
        borderWidth: 3,
    },
    routeHighlightRailLine: {
        width: 2,
        flex: 1,
        marginTop: 4,
        borderRadius: 999,
        opacity: 0.72,
    },
    routeHighlightTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    routeHighlightBadge: {
        minWidth: 38,
        maxWidth: 52,
        minHeight: 23,
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 7,
        paddingVertical: 4,
        alignItems: "center",
        justifyContent: "center",
    },
    routeHighlightBadgeText: {
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0,
    },
    routeHighlightTextWrap: {
        flex: 1,
        minWidth: 0,
        paddingBottom: 12,
    },
    routeHighlightTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 18,
        letterSpacing: 0,
    },
    routeHighlightDetail: {
        marginTop: 1,
        fontSize: 11,
        fontWeight: "800",
        lineHeight: 15,
    },
    routeOptionDetailTapArea: {
        gap: 12,
    },
    routeOptionFooterRow: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 5,
        paddingTop: 2,
    },
    routeOptionFooterText: {
        fontSize: 12,
        fontWeight: "800",
    },
    routeOptionFooterIcon: {
        marginTop: -1,
        fontSize: 20,
        fontWeight: "900",
        lineHeight: 20,
    },
});

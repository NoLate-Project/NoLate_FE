import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getCurrentLocation } from "../../src/modules/map/currentLocation";
import {
    getRouteAlternativeOptions,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    type PlaceSearchItem,
    type RouteAlternativeOption,
} from "../../src/modules/map/tmapApi";
import { getRoutePlannerInitial, setRoutePlannerInitial } from "../../src/modules/schedule/routePlannerSession";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";

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

const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "SUBWAY", label: "지하철" },
    { key: "BUS", label: "버스" },
    { key: "MIXED", label: "버스+지하철" },
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
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [searching, setSearching] = useState(false);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState<string | undefined>();
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const routeDepartureAt = useMemo(() => new Date(), []);

    const origin = useMemo(
        () => buildPlace(originText, originAddress, originLat, originLng),
        [originAddress, originLat, originLng, originText]
    );
    const destination = useMemo(
        () => buildPlace(destinationText, destinationAddress, destinationLat, destinationLng),
        [destinationAddress, destinationLat, destinationLng, destinationText]
    );
    const hasRouteCoords =
        typeof originLat === "number" &&
        typeof originLng === "number" &&
        typeof destinationLat === "number" &&
        typeof destinationLng === "number";
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
        setSearching(false);
    }, []);

    const handleSearchChange = useCallback((target: RoutePointTarget, text: string) => {
        setActiveTarget(target);
        if (target === "origin") {
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
        if (target === "origin") {
            setOriginText(item.name);
            setOriginAddress(item.address);
            setOriginLat(item.lat);
            setOriginLng(item.lng);
            setActiveTarget("destination");
        } else {
            setDestinationText(item.name);
            setDestinationAddress(item.address);
            setDestinationLat(item.lat);
            setDestinationLng(item.lng);
        }
        clearSearch();
    }, [clearSearch]);

    const useCurrentLocationAsOrigin = useCallback(async () => {
        try {
            setSearching(true);
            const location = await getCurrentLocation();
            const address = await reverseGeocodeToAddress(location.latitude, location.longitude);
            setOriginText(address || "현재 위치");
            setOriginAddress(address || undefined);
            setOriginLat(location.latitude);
            setOriginLng(location.longitude);
            setActiveTarget("destination");
            clearSearch();
        } catch (error) {
            const message = error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.";
            Alert.alert("현재 위치 실패", message);
        } finally {
            setSearching(false);
        }
    }, [clearSearch]);

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

    const modeSelectedBg = isDark ? "#FFFFFF" : "#000000";
    const modeSelectedText = isDark ? "#000000" : "#FFFFFF";

    return (
        <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
            <View style={styles.headerRow}>
                <Pressable onPress={close} style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.headerButtonText, { color: colors.textPrimary }]}>‹</Text>
                </Pressable>
                <View style={styles.headerTitleWrap}>
                    <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>이동 경로</Text>
                    <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
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
                <View style={[styles.routeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.routeInputRows}>
                        <View style={styles.routeRail}>
                            <View style={[styles.routeDot, { borderColor: "#22C55E" }]} />
                            <View style={[styles.routeRailLine, { backgroundColor: colors.border }]} />
                            <View style={[styles.routeDot, { borderColor: "#EF4444" }]} />
                        </View>
                        <View style={styles.routeInputs}>
                            <TextInput
                                value={originText}
                                onFocus={() => setActiveTarget("origin")}
                                onChangeText={(text) => handleSearchChange("origin", text)}
                                placeholder="출발지를 입력하세요"
                                placeholderTextColor={colors.textDisabled}
                                style={[styles.routeInput, { color: colors.textPrimary, borderBottomColor: colors.border }]}
                            />
                            <TextInput
                                value={destinationText}
                                onFocus={() => setActiveTarget("destination")}
                                onChangeText={(text) => handleSearchChange("destination", text)}
                                placeholder="도착지를 입력하세요"
                                placeholderTextColor={colors.textDisabled}
                                style={[styles.routeInput, { color: colors.textPrimary }]}
                            />
                        </View>
                        <Pressable onPress={swapPlaces} style={[styles.swapButton, { borderColor: colors.border }]}>
                            <Text style={[styles.swapButtonText, { color: colors.textSecondary }]}>⇅</Text>
                        </Pressable>
                    </View>

                    <View style={styles.quickActionRow}>
                        <Pressable onPress={useCurrentLocationAsOrigin} style={[styles.quickActionButton, { borderColor: colors.border }]}>
                            <Text style={[styles.quickActionText, { color: colors.textPrimary }]}>현재 위치 출발</Text>
                        </Pressable>
                        <Pressable onPress={openMapForRouteReset} style={[styles.quickActionButton, { borderColor: colors.border }]}>
                            <Text style={[styles.quickActionText, { color: colors.textPrimary }]}>지도에서 위치 선택</Text>
                        </Pressable>
                    </View>
                </View>

                {(searching || searchResults.length > 0) && (
                    <View style={[styles.searchResultCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        {searching && (
                            <View style={styles.searchingRow}>
                                <ActivityIndicator size="small" color={colors.textPrimary} />
                                <Text style={[styles.searchingText, { color: colors.textSecondary }]}>주소 검색 중...</Text>
                            </View>
                        )}
                        {searchResults.slice(0, 8).map((item, index) => (
                            <Pressable
                                key={`${item.lat}:${item.lng}:${index}`}
                                onPress={() => applyPlace(activeTarget, item)}
                                style={[styles.searchResultItem, { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth }]}
                            >
                                <Text numberOfLines={1} style={[styles.searchResultTitle, { color: colors.textPrimary }]}>{item.name}</Text>
                                {!!item.category && <Text numberOfLines={1} style={styles.searchResultCategory}>{item.category}</Text>}
                                <Text numberOfLines={1} style={[styles.searchResultAddress, { color: colors.textSecondary }]}>{item.address}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}

                <View style={styles.modeRow}>
                    {SELECTABLE_TRAVEL_MODES.map((modeItem) => {
                        const selected = travelMode === modeItem;
                        return (
                            <Pressable
                                key={modeItem}
                                onPress={() => setTravelMode(modeItem)}
                                style={[
                                    styles.modeButton,
                                    {
                                        backgroundColor: selected ? modeSelectedBg : colors.surface,
                                        borderColor: selected ? modeSelectedBg : colors.border,
                                    },
                                ]}
                            >
                                <Text style={[styles.modeButtonText, { color: selected ? modeSelectedText : colors.textPrimary }]}>
                                    {TRAVEL_MODE_META[modeItem].label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

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
                                <Pressable
                                    key={item.key}
                                    onPress={() => setTransitRouteFilter(item.key)}
                                    disabled={disabled}
                                    style={[
                                        styles.transitFilterTab,
                                        {
                                            borderBottomColor: selected ? colors.textPrimary : "transparent",
                                            opacity: disabled ? 0.38 : 1,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.transitFilterText,
                                            { color: selected ? colors.textPrimary : colors.textSecondary },
                                        ]}
                                    >
                                        {label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                )}

                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>경로 선택</Text>
                    <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
                        {hasRouteCoords ? `${visibleRouteAlternatives.length}개 경로` : "출발지와 도착지를 먼저 선택"}
                    </Text>
                </View>

                <View style={styles.routeList}>
                    {!hasRouteCoords && (
                        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                검색 결과에서 출발지와 도착지를 선택하면 경로 후보가 표시됩니다.
                            </Text>
                        </View>
                    )}

                    {hasRouteCoords && routeLoading && (
                        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <ActivityIndicator size="small" color={colors.textPrimary} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>경로 계산 중...</Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !!routeError && (
                        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{routeError}</Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.length === 0 && (
                        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                선택한 교통수단에 해당하는 경로가 없습니다.
                            </Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.map((option) => {
                        const selected = selectedRouteId === option.id;
                        const absoluteIndex = routeAlternatives.findIndex((routeOption) => routeOption.id === option.id);
                        const accent = selected ? (isDark ? "#D7DCE4" : "#111827") : (isDark ? "#303236" : "#E0E4EA");
                        const cardBackground = isDark ? "#1B1B1D" : "#FFFFFF";
                        const progressSegments = buildRouteProgressSegments(option);
                        const routeTimeFare = formatRouteTimeFare(option, routeDepartureAt);
                        const routeConditionLine = formatRouteConditionLine(option);
                        const lineHighlights = buildRouteLineHighlights(option);
                        const progressTrackBg = isDark ? "#3C4148" : "#68707B";
                        const stepRailBg = isDark ? "#303236" : "#E5E7EB";
                        const walkBadgeBg = isDark ? "#26282D" : "#F8FAFC";
                        const walkBadgeText = isDark ? "#D1D5DB" : "#4B5563";
                        const openRouteDetail = () => {
                            setSelectedRouteId(option.id);
                            openMapForOption(option);
                        };
                        return (
                            <View
                                key={option.id}
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
                                <Pressable onPress={openRouteDetail}>
                                    <View style={styles.routeOptionHeader}>
                                        <View style={styles.routeOptionTopRow}>
                                            <Text style={[styles.routeOptionLabel, { color: colors.textSecondary }]}>
                                                {absoluteIndex <= 0 ? "최적" : `대안 경로 ${absoluteIndex + 1}`}
                                            </Text>
                                            <Text numberOfLines={1} style={[styles.routeOptionDuration, { color: colors.textPrimary }]}>
                                                {formatDuration(option.minutes)}
                                            </Text>
                                        </View>
                                        {!!routeTimeFare && (
                                            <Text numberOfLines={1} style={[styles.routeOptionTimeFare, { color: colors.textSecondary }]}>
                                                {routeTimeFare}
                                            </Text>
                                        )}
                                        {!!routeConditionLine && (
                                            <Text numberOfLines={1} style={[styles.routeOptionCondition, { color: colors.textSecondary }]}>
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
                                                isDark ? styles.routeProgressTrackDark : styles.routeProgressTrackLight,
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
                                        <View style={[styles.routeHighlightList, { borderTopColor: isDark ? "#303236" : "#E5E7EB" }]}>
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
                                                            <Text numberOfLines={2} style={[styles.routeHighlightTitle, { color: colors.textPrimary }]}>
                                                                {highlight.title}
                                                            </Text>
                                                        </View>
                                                        <Text numberOfLines={1} style={[styles.routeHighlightDetail, { color: colors.textSecondary }]}>
                                                            {highlight.detail}
                                                        </Text>
                                                    </View>
                                                </View>
                                            ))}
                                        </View>
                                    )}
                                    <View style={styles.routeOptionFooterRow}>
                                        <Text style={[styles.routeOptionFooterText, { color: colors.textPrimary }]}>
                                            탭해서 상세 경로 보기
                                        </Text>
                                        <Text style={[styles.routeOptionFooterIcon, { color: colors.textPrimary }]}>›</Text>
                                    </View>
                                </Pressable>
                            </View>
                        );
                    })}
                </View>
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
        gap: 14,
        paddingHorizontal: 16,
        paddingBottom: 14,
    },
    headerButton: {
        width: 54,
        height: 54,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    headerButtonText: {
        marginTop: -4,
        fontSize: 46,
        fontWeight: "300",
        lineHeight: 52,
    },
    headerTitleWrap: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: "900",
        lineHeight: 28,
    },
    headerSubtitle: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: "600",
    },
    content: {
        paddingHorizontal: 16,
        gap: 14,
    },
    routeCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        gap: 12,
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
        width: 11,
        height: 11,
        borderRadius: 999,
        borderWidth: 3,
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
        minHeight: 44,
        borderBottomWidth: StyleSheet.hairlineWidth,
        fontSize: 16,
        fontWeight: "800",
    },
    swapButton: {
        width: 38,
        height: 38,
        borderRadius: 999,
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
    quickActionRow: {
        flexDirection: "row",
        gap: 8,
    },
    quickActionButton: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 10,
        alignItems: "center",
    },
    quickActionText: {
        fontSize: 12,
        fontWeight: "800",
    },
    searchResultCard: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
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
    searchResultItem: {
        paddingHorizontal: 14,
        paddingVertical: 11,
    },
    searchResultTitle: {
        fontSize: 14,
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
        fontSize: 12,
        fontWeight: "600",
    },
    modeRow: {
        flexDirection: "row",
        gap: 8,
    },
    modeButton: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 11,
        alignItems: "center",
    },
    modeButtonText: {
        fontSize: 13,
        fontWeight: "900",
    },
    transitFilterRow: {
        gap: 28,
        paddingHorizontal: 2,
        paddingTop: 4,
        paddingBottom: 2,
    },
    transitFilterTab: {
        borderBottomWidth: 3,
        paddingBottom: 8,
        minWidth: 52,
    },
    transitFilterText: {
        fontSize: 15,
        fontWeight: "900",
        letterSpacing: -0.2,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: 2,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: "900",
    },
    sectionHint: {
        fontSize: 13,
        fontWeight: "800",
    },
    routeList: {
        gap: 14,
    },
    emptyCard: {
        minHeight: 84,
        borderWidth: 1,
        borderRadius: 16,
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
        borderRadius: 22,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 18,
        gap: 15,
    },
    routeOptionCardInactive: {
        borderWidth: 1,
        shadowColor: "#000000",
        shadowOpacity: 0.025,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 1,
    },
    routeOptionCardSelectedLight: {
        borderWidth: 1.5,
        shadowColor: "#000000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
    },
    routeOptionCardSelectedDark: {
        borderWidth: 1.5,
        shadowColor: "#000000",
        shadowOpacity: 0.22,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
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
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: -0.2,
        paddingTop: 6,
    },
    routeOptionDuration: {
        flexShrink: 0,
        maxWidth: "72%",
        textAlign: "right",
        fontSize: 38,
        fontWeight: "900",
        letterSpacing: -1.7,
        lineHeight: 43,
    },
    routeOptionTimeFare: {
        fontSize: 16,
        fontWeight: "800",
        lineHeight: 22,
        letterSpacing: -0.3,
    },
    routeOptionCondition: {
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 20,
        letterSpacing: -0.2,
    },
    routeProgressBlock: {
        width: "100%",
        flexShrink: 1,
        paddingTop: 6,
        paddingBottom: 3,
        overflow: "hidden",
    },
    routeProgressScroll: {
        width: "100%",
        flexGrow: 0,
    },
    routeProgressTrack: {
        minHeight: 28,
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
        height: 26,
        minWidth: 47,
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
        fontSize: 12,
        fontWeight: "900",
        letterSpacing: -0.35,
        lineHeight: 15,
    },
    routeProgressWalkText: {
        color: "#F3F4F6",
        opacity: 0.86,
    },
    routeProgressBadge: {
        width: 18,
        height: 18,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    routeProgressBadgeText: {
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 12,
        letterSpacing: -0.5,
    },
    routeHighlightList: {
        gap: 0,
        paddingTop: 13,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#D8DEE7",
    },
    routeHighlightRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        minHeight: 56,
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
        minWidth: 44,
        maxWidth: 58,
        minHeight: 26,
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 7,
        paddingVertical: 4,
        alignItems: "center",
        justifyContent: "center",
    },
    routeHighlightBadgeText: {
        fontSize: 12,
        fontWeight: "900",
        letterSpacing: -0.25,
    },
    routeHighlightTextWrap: {
        flex: 1,
        minWidth: 0,
        paddingBottom: 14,
    },
    routeHighlightTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 21,
        letterSpacing: -0.4,
    },
    routeHighlightDetail: {
        marginTop: 1,
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 18,
    },
    routeOptionDetailTapArea: {
        gap: 15,
    },
    routeOptionFooterRow: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 5,
        paddingTop: 2,
    },
    routeOptionFooterText: {
        fontSize: 13,
        fontWeight: "800",
    },
    routeOptionFooterIcon: {
        marginTop: -1,
        fontSize: 20,
        fontWeight: "900",
        lineHeight: 20,
    },
});

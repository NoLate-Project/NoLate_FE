import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    ActivityIndicator,
    Animated,
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getCurrentLocation } from "../../src/modules/map/currentLocation";
import {
    getRouteAlternativeOptions,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    type PlaceSearchItem,
    type RouteAlternativeOption,
    type RoutePathCoord,
    type TransitLegDetail,
    type TransitPassStop,
} from "../../src/modules/map/tmapApi";
import TmapMapView, {
    type TmapMapViewHandle,
    type TmapLatLng,
    type TmapMarker,
    type TmapPathOverlay,
} from "../../src/modules/map/TmapMapView";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import { getRoutePlannerInitial, setRoutePlannerInitial, setRoutePlannerResult } from "../../src/modules/schedule/routePlannerSession";

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;
const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];
const ORIGIN_COLOR = "#21B85A";
const DESTINATION_COLOR = "#FF6A3D";
const SELECTED_ROUTE_COLOR = "#2F80FF";
const TRANSIT_LEG_COLOR: Record<TransitLegDetail["kind"], string> = {
    SUBWAY: "#24B348",
    BUS: "#1D72FF",
    // 도보는 버스보다 한 톤 밝은 파랑으로 두어 "보행 안내"라는 느낌을 유지한다.
    WALK: "#5A96FF",
    ETC: "#94A3B8",
};
const BOTTOM_SHEET_HANDLE_PEEK_HEIGHT = 24;
// UI tuning: 바텀시트는 최소 20%를 남기고(=최대 80%까지만) 내려간다.
const BOTTOM_SHEET_COLLAPSED_VISIBLE_RATIO = 0.2;
// 대중교통 상세 화면에서는 하단 안내 바 위로 핸들만 보이도록 접힌 높이를 보정한다.
const TRANSIT_DETAIL_COLLAPSED_VISIBLE_BASE_HEIGHT = 112;
// 전체 경로 화면에서도 지하철/버스 노선색이 바로 읽혀야 해서
// 세그먼트 렌더링은 저배율부터 허용하고, 배지/범례만 별도 줌에서 제어한다.
const TRANSIT_SEGMENT_RENDER_MIN_ZOOM = 8.8;
const TRANSIT_SEGMENT_DETAIL_MIN_ZOOM = 13.8;
const TRANSIT_DIRECTION_MARKER_MIN_ZOOM = 16.8;
// 대중교통 이벤트 배지 노출 최소 줌.
const TRANSIT_BADGE_MIN_ZOOM = 14.6;
// 화면 혼잡을 줄이기 위한 이벤트 배지 최대 개수.
const TRANSIT_BADGE_MAX_COUNT = 18;
// 버스 정류장 마커 노출 최소 줌.
const TRANSIT_BUS_STOP_MIN_ZOOM = 15.2;
const TRANSIT_BOARD_BADGE_MIN_ZOOM = 16.6;
const TRANSIT_TRANSFER_COLOR = "#F4A100";
const KAKAO_LABEL_TEXT_COLOR = "#1F2937";
const KAKAO_LABEL_BORDER_COLOR = "rgba(148,163,184,0.62)";
// 환승/접근 보행 안내선 점선 계열 색상.
const TRANSIT_CONNECTOR_DOT_COLOR = "#2F7BFF";
const TRANSIT_CONNECTOR_DOT_BORDER_COLOR = "#FFFFFF";
// 실제 승하차 지점을 나타내는 중립 링 포인트 색상.
const TRANSIT_STOP_POINT_COLOR = "#FFFFFF";
const TRANSIT_STOP_POINT_BORDER_COLOR = "rgba(17,24,39,0.78)";
// 접근 점선은 fill 위주로 보이게 border를 제거한다.
const TRANSIT_WALK_DOT_BORDER_COLOR = "transparent";
// 도보 실선은 회색 대신 밝은 블루 톤으로 그려 버스/지하철과 연결감이 생기게 한다.
const TRANSIT_WALK_ROUTE_COLOR_LIGHT = "rgba(90, 150, 255, 0.98)";
const TRANSIT_WALK_ROUTE_COLOR_DARK = "rgba(112, 182, 255, 0.96)";
const ROUTE_STYLE = {
    // 지도 라인 기본 두께/외곽선 설정.
    inactiveWidth: 5,
    inactiveOutlineWidth: 1.6,
    selectedWidth: 9.8,
    selectedOutlineWidth: 2.5,
    transitRideWidth: 12.8,
    transitRideOutlineWidth: 2.8,
    // 도보 보조선은 ride보다 얇게 유지하되, 지도 위에서 사라지지 않을 정도로 확보한다.
    transitWalkWidth: 6.4,
    transitWalkOutlineWidth: 1.9,
    connectorWalkWidth: 4.8,
} as const;
type RoutePointTarget = "origin" | "destination";
type TransitRouteFilter = "ALL" | "BUS" | "SUBWAY" | "MIXED";
type RoutePlannerFocusTarget = "origin" | "destination" | "startRide" | "firstSubway";
type DebugSheetState = "collapsed" | "hidden" | "expanded";
type BottomSheetSnap = "expanded" | "middle" | "collapsed" | "hidden";
const DEBUG_FOCUS_MIN_ZOOM = 5;
const DEBUG_FOCUS_MAX_ZOOM = 18;
const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "BUS", label: "버스" },
    { key: "SUBWAY", label: "지하철" },
    { key: "MIXED", label: "버스+지하철" },
];
// 모듈 레벨 상수 — 렌더마다 새 객체를 만들면 지도가 카메라를 계속 리셋할 수 있음
const INITIAL_CAMERA = { latitude: FALLBACK_LAT, longitude: FALLBACK_LNG, zoom: 12 };

function getSingleParam(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
}

function parseNumberParam(value: string | string[] | undefined): number | undefined {
    const raw = getSingleParam(value);
    if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIntegerParam(value: string | string[] | undefined): number | undefined {
    const parsed = parseNumberParam(value);
    if (typeof parsed !== "number") return undefined;
    return Number.isInteger(parsed) ? parsed : undefined;
}

function parseTravelModeParam(value: string | string[] | undefined): TravelMode | undefined {
    const raw = getSingleParam(value)?.trim().toUpperCase();
    if (!raw) return undefined;
    return SELECTABLE_TRAVEL_MODES.includes(raw as TravelMode)
        ? (raw as TravelMode)
        : undefined;
}

function parseFocusTargetParam(value: string | string[] | undefined): RoutePlannerFocusTarget | undefined {
    const raw = getSingleParam(value)?.trim();
    if (raw === "origin" || raw === "destination" || raw === "startRide" || raw === "firstSubway") return raw;
    return undefined;
}

function parseFocusZoomParam(value: string | string[] | undefined): number | undefined {
    const parsed = parseNumberParam(value);
    if (typeof parsed !== "number") return undefined;
    return Math.max(DEBUG_FOCUS_MIN_ZOOM, Math.min(DEBUG_FOCUS_MAX_ZOOM, parsed));
}

function parseSheetStateParam(value: string | string[] | undefined): DebugSheetState | undefined {
    const raw = getSingleParam(value)?.trim().toLowerCase();
    if (raw === "collapsed" || raw === "hidden" || raw === "expanded") return raw;
    return undefined;
}

function parseRouteParamPlace(
    params: Record<string, string | string[] | undefined>,
    prefix: "origin" | "destination"
): Place | undefined {
    const lat = parseNumberParam(params[`${prefix}Lat`]);
    const lng = parseNumberParam(params[`${prefix}Lng`]);
    if (typeof lat !== "number" || typeof lng !== "number") return undefined;

    const name = getSingleParam(params[`${prefix}Name`])?.trim();
    const address = getSingleParam(params[`${prefix}Address`])?.trim();

    return {
        name: name || address || (prefix === "origin" ? "출발지" : "도착지"),
        address: address || name || "",
        lat,
        lng,
    };
}

function formatDistance(distanceMeters?: number): string | undefined {
    if (typeof distanceMeters !== "number") return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}

function formatDuration(minutes?: number): string {
    if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "-";
    const totalMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(totalMinutes / 60);
    const remainMinutes = totalMinutes % 60;
    if (hours === 0) return `${remainMinutes}분`;
    if (remainMinutes === 0) return `${hours}시간`;
    return `${hours}시간 ${remainMinutes}분`;
}

type CameraCoord = { latitude: number; longitude: number };
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

function haversineDistanceKm(from: CameraCoord, to: CameraCoord): number {
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRadians(to.latitude - from.latitude);
    const dLng = toRadians(to.longitude - from.longitude);
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

function formatAlternativeInfo(option: RouteAlternativeOption): string {
    const chunks: string[] = [];

    if (typeof option.transferCount === "number") {
        chunks.push(`환승 ${option.transferCount}회`);
    }

    const walkText = formatDistance(option.walkMeters);
    if (walkText) {
        chunks.push(`도보 ${walkText}`);
    }

    if (typeof option.fareWon === "number") {
        chunks.push(`요금 ${option.fareWon.toLocaleString()}원`);
    }

    const distanceText = formatDistance(option.distanceMeters);
    if (distanceText) {
        chunks.push(distanceText);
    }

    if (!chunks.length) {
        if (option.source === "api") return "실경로 데이터";
        return option.fallbackKind === "road" ? "도로 기반 보정" : "직선거리 추정";
    }

    return chunks.join(" · ");
}

function getAlternativeMetricTags(option: RouteAlternativeOption): string[] {
    const metrics: string[] = [];
    if (typeof option.transferCount === "number") {
        metrics.push(`환승 ${option.transferCount}회`);
    }

    const walkText = formatDistance(option.walkMeters);
    if (walkText) {
        metrics.push(`도보 ${walkText}`);
    }

    if (typeof option.fareWon === "number") {
        metrics.push(`요금 ${option.fareWon.toLocaleString()}원`);
    }

    const distanceText = formatDistance(option.distanceMeters);
    if (distanceText) {
        metrics.push(`총 ${distanceText}`);
    }

    return metrics;
}

function getTransitModeLabels(legs?: TransitLegDetail[]): string[] {
    if (!Array.isArray(legs) || !legs.length) return [];

    const labelsByKind: Record<TransitLegDetail["kind"], string> = {
        SUBWAY: "지하철",
        BUS: "버스",
        WALK: "도보",
        ETC: "기타",
    };
    const orderedKinds: TransitLegDetail["kind"][] = ["SUBWAY", "BUS", "WALK", "ETC"];
    const used = new Set<TransitLegDetail["kind"]>(legs.map((leg) => leg.kind));
    return orderedKinds.filter((kind) => used.has(kind)).map((kind) => labelsByKind[kind]);
}

function buildTransitLegPreview(legs?: TransitLegDetail[]): string | undefined {
    if (!Array.isArray(legs) || !legs.length) return undefined;
    const labels = legs
        .map((leg) => leg.label?.trim())
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!labels.length) return undefined;
    return labels.slice(0, 3).join(" → ");
}

function getTransitLegKindMeta(kind: TransitLegDetail["kind"]): { label: string; short: string; color: string } {
    if (kind === "SUBWAY") return { label: "지하철", short: "지", color: TRANSIT_LEG_COLOR.SUBWAY };
    if (kind === "BUS") return { label: "버스", short: "버", color: TRANSIT_LEG_COLOR.BUS };
    if (kind === "WALK") return { label: "도보", short: "도", color: TRANSIT_LEG_COLOR.WALK };
    return { label: "기타", short: "기", color: "#64748B" };
}

function getTransitRouteCategory(option: RouteAlternativeOption): TransitRouteFilter {
    const legs = Array.isArray(option.transitLegs) ? option.transitLegs : [];
    const hasBus = legs.some((leg) => leg.kind === "BUS");
    const hasSubway = legs.some((leg) => leg.kind === "SUBWAY");

    if (hasBus && hasSubway) return "MIXED";
    if (hasBus) return "BUS";
    if (hasSubway) return "SUBWAY";
    return "ALL";
}

function buildTransitLegMeta(leg: TransitLegDetail): string | undefined {
    const chunks: string[] = [];
    if (typeof leg.durationMinutes === "number") {
        chunks.push(formatDuration(leg.durationMinutes));
    }
    const distanceText = formatDistance(leg.distanceMeters);
    if (distanceText) {
        chunks.push(distanceText);
    }
    return chunks.length ? chunks.join(" · ") : undefined;
}

function buildTransitTimelineTitle(leg: TransitLegDetail): string {
    if (leg.kind === "WALK") return leg.label;
    const kindLabel = getTransitLegKindMeta(leg.kind).label;
    const lineName = leg.lineName?.trim() || compactTransitLineLabel(leg.label);
    const titleChunks = [kindLabel, lineName].filter((value): value is string => !!value);
    const stationText = typeof leg.stationCount === "number" ? `${leg.stationCount}정거장` : undefined;
    return stationText ? `${titleChunks.join(" ")} · ${stationText}` : (titleChunks.join(" ") || leg.label);
}

function compactTransitLineLabel(lineName?: string): string | undefined {
    if (!lineName) return undefined;
    let normalized = lineName.trim();
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
        .trim();
    if (!normalized) return undefined;
    const lineMatch = normalized.match(/\d+호선/);
    if (lineMatch?.[0]) return lineMatch[0];
    const first = normalized.split(",")[0]?.trim() ?? normalized;
    if (!first) return undefined;
    return first.length > 10 ? `${first.slice(0, 10)}…` : first;
}

function compactTransitStopLabel(stopName?: string, maxLength = 10): string | undefined {
    if (!stopName) return undefined;
    const normalized = stopName
        .replace(/\s+/g, "")
        .replace(/[()]/g, "")
        .replace(/\.+/g, " ")
        .trim();
    if (!normalized) return undefined;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function getSubwayLineColor(lineName?: string): string {
    const normalized = lineName?.trim();
    if (!normalized) return TRANSIT_LEG_COLOR.SUBWAY;
    const matched = SUBWAY_LINE_COLOR_RULES.find((item) => item.pattern.test(normalized));
    return matched?.color ?? TRANSIT_LEG_COLOR.SUBWAY;
}

function getBusLineColor(lineName?: string): string {
    const compactLabel = compactTransitLineLabel(lineName);
    const normalized = compactLabel?.trim() || lineName?.trim();
    if (!normalized) return TRANSIT_LEG_COLOR.BUS;

    // 버스 노선 문자열은 공급자/지역별로 포맷이 달라서(예: 3411, M7731, 지선 3411),
    // 1) compact label 정리 -> 2) 숫자 토큰 기반 분류 순서로 최대한 안정적으로 색을 결정한다.
    // 목적은 "지선 4자리 = 녹색"처럼 사용자가 익숙한 지도 색 체계에 맞추는 것이다.
    const upper = normalized.toUpperCase();
    if (/^M\d+/.test(upper)) return "#E84B4B";

    const numberToken = upper.match(/\d+/)?.[0];
    if (!numberToken) return TRANSIT_LEG_COLOR.BUS;

    // 9번대/M버스 계열은 광역(적색)으로 처리하고, 4자리 지선은 녹색으로 우선 매핑한다.
    // 2자리는 순환/마을 계열(황색), 3자리는 일반 간선(청색)으로 fallback 한다.
    if (numberToken.startsWith("9")) return "#E84B4B";
    if (/^\d{4}$/.test(numberToken)) return "#25B853";
    if (/^\d{2}$/.test(numberToken)) return "#E5B93B";
    if (/^\d{3}$/.test(numberToken)) return "#1D72FF";
    if (/^\d{5,}$/.test(numberToken)) return "#25B853";

    return TRANSIT_LEG_COLOR.BUS;
}

function getTransitLegVisualColor(leg: Pick<TransitLegDetail, "kind" | "lineName" | "lineColor">): string {
    // Tmap이 실제 노선색(routeColor / lane.color)을 내려 주는 구간은
    // 추정 규칙보다 원본 값을 우선 써야 레퍼런스 지도와 가장 가까운 색이 나온다.
    // 특히 지선/광역 버스는 사업자별 표기 흔들림이 있어서 lineName 추정만으로는
    // 파랑/초록/빨강이 틀어질 수 있으므로, 원본 색이 있으면 그 값을 그대로 채택한다.
    if (typeof leg.lineColor === "string" && leg.lineColor.trim().length > 0) {
        return leg.lineColor;
    }
    if (leg.kind === "SUBWAY") return getSubwayLineColor(leg.lineName);
    if (leg.kind === "BUS") return getBusLineColor(leg.lineName);
    return TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR;
}

function isRideLegKind(kind: TransitLegDetail["kind"]): boolean {
    return kind === "SUBWAY" || kind === "BUS";
}

// 지도에 안내선을 그릴 때 leg별 시작/종료/승하차 기준점을 안정적으로 뽑아내는 보조 함수들.
function getTransitLegStartCoord(leg: TransitLegDetail): RoutePathCoord | undefined {
    if (typeof leg.startCoord?.lat === "number" && typeof leg.startCoord?.lng === "number") {
        return leg.startCoord;
    }
    if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
        return leg.pathCoords[0];
    }
    return undefined;
}

function getTransitLegEndCoord(leg: TransitLegDetail): RoutePathCoord | undefined {
    if (typeof leg.endCoord?.lat === "number" && typeof leg.endCoord?.lng === "number") {
        return leg.endCoord;
    }
    if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
        return leg.pathCoords[leg.pathCoords.length - 1];
    }
    return undefined;
}

function squaredDistance(a: RoutePathCoord, b: RoutePathCoord): number {
    const dLat = a.lat - b.lat;
    const dLng = a.lng - b.lng;
    return (dLat * dLat) + (dLng * dLng);
}

function snapCoordToPathRange(
    pathCoords: RoutePathCoord[] | undefined,
    coord: RoutePathCoord | undefined,
    rangeStartRatio: number,
    rangeEndRatio: number
): RoutePathCoord | undefined {
    if (!Array.isArray(pathCoords) || pathCoords.length === 0) return coord;
    if (!coord) return pathCoords[0];
    const lastIndex = pathCoords.length - 1;
    const rawStart = Math.max(0, Math.min(lastIndex, Math.floor(lastIndex * rangeStartRatio)));
    const rawEnd = Math.max(rawStart, Math.min(lastIndex, Math.ceil(lastIndex * rangeEndRatio)));
    let nearest = pathCoords[rawStart];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = rawStart; index <= rawEnd; index += 1) {
        const point = pathCoords[index];
        const distance = squaredDistance(point, coord);
        if (distance < nearestDistance) {
            nearest = point;
            nearestDistance = distance;
        }
    }
    return nearest;
}

function getTransitLegBoardCoord(leg: TransitLegDetail): RoutePathCoord | undefined {
    const startCoord = getTransitLegStartCoord(leg);
    return startCoord ?? (Array.isArray(leg.pathCoords) ? leg.pathCoords[0] : undefined);
}

function getTransitLegAlightCoord(leg: TransitLegDetail): RoutePathCoord | undefined {
    const endCoord = getTransitLegEndCoord(leg);
    return endCoord ?? (
        Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0
            ? leg.pathCoords[leg.pathCoords.length - 1]
            : undefined
    );
}

function getTransitLegBoardAnchorOnPath(leg: TransitLegDetail): RoutePathCoord | undefined {
    const startCoord = getTransitLegStartCoord(leg);
    const snappedHead = snapCoordToPathRange(leg.pathCoords, startCoord, 0, 0.35);
    return snappedHead ?? startCoord ?? (Array.isArray(leg.pathCoords) ? leg.pathCoords[0] : undefined);
}

function getTransitLegAlightAnchorOnPath(leg: TransitLegDetail): RoutePathCoord | undefined {
    const endCoord = getTransitLegEndCoord(leg);
    const snappedTail = snapCoordToPathRange(leg.pathCoords, endCoord, 0.65, 1);
    return snappedTail ?? endCoord ?? (
        Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0
            ? leg.pathCoords[leg.pathCoords.length - 1]
            : undefined
    );
}

function offsetCoordByMeters(coord: RoutePathCoord, northMeters: number, eastMeters: number): RoutePathCoord {
    const latMetersPerDeg = 111_320;
    const lngMetersPerDeg = Math.max(1, 111_320 * Math.cos((coord.lat * Math.PI) / 180));
    return {
        lat: coord.lat + (northMeters / latMetersPerDeg),
        lng: coord.lng + (eastMeters / lngMetersPerDeg),
    };
}

// 버스 승하차 좌표는 API 원본만 쓰면 차도 중앙선에 붙기 쉬워서,
// 정류장 마커 / 보행 연결선 / 버스 레그 표시선을 같은 시각 기준으로 보정한다.
function offsetBusStopCoordFromPath(
    leg: TransitLegDetail,
    baseCoord: RoutePathCoord | undefined,
    position: "BOARD" | "ALIGHT"
): RoutePathCoord | undefined {
    if (!Array.isArray(leg.pathCoords) || leg.pathCoords.length < 2) return baseCoord;
    if (leg.kind !== "BUS") return baseCoord;

    const pathAnchor = position === "BOARD"
        ? getTransitLegBoardAnchorOnPath(leg)
        : getTransitLegAlightAnchorOnPath(leg);
    if (pathAnchor) {
        const pathCoords = leg.pathCoords;
        let anchorIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < pathCoords.length; index += 1) {
            const point = pathCoords[index];
            const distance = squaredDistance(point, pathAnchor);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                anchorIndex = index;
            }
        }

        const directionStep = position === "BOARD" ? 1 : -1;
        const neighborIndex = Math.max(0, Math.min(pathCoords.length - 1, anchorIndex + (directionStep * 2)));
        const neighbor = pathCoords[neighborIndex];
        if (neighbor && (neighbor.lat !== pathAnchor.lat || neighbor.lng !== pathAnchor.lng)) {
            const dLat = neighbor.lat - pathAnchor.lat;
            const dLng = neighbor.lng - pathAnchor.lng;
            const norm = Math.hypot(dLat, dLng);
            if (Number.isFinite(norm) && norm >= 1e-9) {
                const unitPerpLat = -dLng / norm;
                const unitPerpLng = dLat / norm;
                const reference = baseCoord ?? pathAnchor;
                const referenceDistance = routeCoordDistanceMeters(reference, pathAnchor);
                const anchorBlend = referenceDistance <= 36
                    ? interpolateRouteCoord(pathAnchor, reference, 0.45)
                    : pathAnchor;
                const refLat = reference.lat - pathAnchor.lat;
                const refLng = reference.lng - pathAnchor.lng;
                const cross = (dLat * refLng) - (dLng * refLat);
                const side = cross >= 0 ? 1 : -1;
                const offsetMeters = referenceDistance <= 16 ? 15 : 18;
                return offsetCoordByMeters(
                    anchorBlend,
                    unitPerpLat * side * offsetMeters,
                    unitPerpLng * side * offsetMeters
                );
            }
        }
        return baseCoord ?? pathAnchor;
    }

    return baseCoord;
    /*

    const distanceToAnchor = routeCoordDistanceMeters(baseCoord, anchor);
    // 정류장 좌표가 지나치게 멀면(오탐 가능성) 보정하지 않는다.
    if (distanceToAnchor > 95) return baseCoord;

    const dLat = neighbor.lat - anchor.lat;
    const dLng = neighbor.lng - anchor.lng;
    const norm = Math.hypot(dLat, dLng);
    if (!Number.isFinite(norm) || norm < 1e-9) return baseCoord;

    const unitPerpLat = -dLng / norm;
    const unitPerpLng = dLat / norm;
    const refLat = baseCoord.lat - anchor.lat;
    const refLng = baseCoord.lng - anchor.lng;
    const cross = (dLat * refLng) - (dLng * refLat);
    const side = cross >= 0 ? 1 : -1;
    const offsetMeters = 18;

    return offsetCoordByMeters(
        baseCoord,
        unitPerpLat * side * offsetMeters,
        unitPerpLng * side * offsetMeters
    );
    */
}

function getWalkLegStartCoord(leg: TransitLegDetail | undefined): RoutePathCoord | undefined {
    if (!leg || leg.kind !== "WALK") return undefined;
    if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) return leg.pathCoords[0];
    return getTransitLegStartCoord(leg) ?? getTransitLegBoardAnchorOnPath(leg);
}

function getWalkLegEndCoord(leg: TransitLegDetail | undefined): RoutePathCoord | undefined {
    if (!leg || leg.kind !== "WALK") return undefined;
    if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
        return leg.pathCoords[leg.pathCoords.length - 1];
    }
    return getTransitLegEndCoord(leg) ?? getTransitLegAlightAnchorOnPath(leg);
}

function nudgeBusStopTowardReference(
    baseCoord: RoutePathCoord | undefined,
    referenceCoord: RoutePathCoord | undefined
): RoutePathCoord | undefined {
    if (!baseCoord || !referenceCoord) return undefined;
    const distanceMeters = routeCoordDistanceMeters(baseCoord, referenceCoord);
    if (!Number.isFinite(distanceMeters) || distanceMeters < 2 || distanceMeters > 90) return undefined;
    const moveMeters = Math.min(5, Math.max(1, distanceMeters * 0.15));
    const ratio = Math.min(1, moveMeters / distanceMeters);
    return interpolateRouteCoord(baseCoord, referenceCoord, ratio);
}

function getAdjacentWalkReferenceCoord(
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    position: "BOARD" | "ALIGHT"
): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return undefined;
    if (position === "BOARD") {
        return getWalkLegEndCoord(legs[legIndex - 1]);
    }
    return getWalkLegStartCoord(legs[legIndex + 1]);
}

function getRideStopDisplayCoord(
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    position: "BOARD" | "ALIGHT"
): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return undefined;
    const leg = legs[legIndex];

    const stopCoord = position === "BOARD" ? getTransitLegBoardCoord(leg) : getTransitLegAlightCoord(leg);
    const fallbackCoord = position === "BOARD" ? getTransitLegStartCoord(leg) : getTransitLegEndCoord(leg);

    if (leg.kind !== "BUS") return stopCoord ?? fallbackCoord;

    const pathAnchorCoord = position === "BOARD"
        ? getTransitLegBoardAnchorOnPath(leg)
        : getTransitLegAlightAnchorOnPath(leg);

    const base = stopCoord ?? pathAnchorCoord ?? fallbackCoord;
    if (!base) return undefined;
    if (!pathAnchorCoord || !stopCoord) return base;

    // Tmap 정류장 좌표가 차도 중앙으로 내려오는 케이스를 줄이기 위해
    // 정류장 마커는 "노선 path 앵커 → 정류장" 방향으로 한 번 더 차도 바깥으로 민다.
    const dist = routeCoordDistanceMeters(stopCoord, pathAnchorCoord);
    if (dist < 2) {
        // 정류장이 경로 위에 있음 — 경로 수직 방향으로 오프셋
        return offsetBusStopCoordFromPath(leg, stopCoord, position) ?? stopCoord;
    }

    // Tmap API 좌표가 도로 위(차선 위치)에 있음.
    // pathAnchor → stopCoord 방향으로 충분히 더 밀어서 정류장 점이 차도 중앙에 뜨지 않게 한다.
    const latMetersPerDeg = 111_320;
    const lngMetersPerDeg = 111_320 * Math.cos((stopCoord.lat * Math.PI) / 180);
    const northMeters = (stopCoord.lat - pathAnchorCoord.lat) * latMetersPerDeg;
    const eastMeters = (stopCoord.lng - pathAnchorCoord.lng) * lngMetersPerDeg;
    const unitNorth = northMeters / dist;
    const unitEast = eastMeters / dist;
    return {
        lat: stopCoord.lat + (unitNorth * 10) / latMetersPerDeg,
        lng: stopCoord.lng + (unitEast * 10) / lngMetersPerDeg,
    };
}

function getRideStopConnectorCoord(
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    position: "BOARD" | "ALIGHT"
): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return undefined;
    const leg = legs[legIndex];
    const stopCoord = position === "BOARD" ? getTransitLegBoardCoord(leg) : getTransitLegAlightCoord(leg);
    const fallbackCoord = position === "BOARD" ? getTransitLegStartCoord(leg) : getTransitLegEndCoord(leg);

    if (leg.kind !== "BUS") return stopCoord ?? fallbackCoord;

    // 보행 connector는 정류장 마커(displayCoord)보다 한 번 더 보도 쪽 reference에 붙여서,
    // "출발/도보 선 ↔ 승차 정류장"이 서로 다른 점을 가리키는 느낌을 줄인다.
    const displayCoord = getRideStopDisplayCoord(legs, legIndex, position);
    const walkReferenceCoord = getAdjacentWalkReferenceCoord(legs, legIndex, position);

    return nudgeBusStopTowardReference(displayCoord, walkReferenceCoord)
        ?? nudgeBusStopTowardReference(stopCoord, walkReferenceCoord)
        ?? displayCoord
        ?? stopCoord
        ?? fallbackCoord;
}

function getTransitRouteStartFocusCoord(legs: TransitLegDetail[] | undefined): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legs.length === 0) return undefined;

    const firstRideLegIndex = legs.findIndex((leg) => isRideLegKind(leg.kind));
    if (firstRideLegIndex < 0) {
        return getWalkLegStartCoord(legs[0]) ?? getWalkLegEndCoord(legs[0]);
    }

    const firstRideLeg = legs[firstRideLegIndex];
    if (firstRideLeg.kind === "BUS") {
        return getRideStopConnectorCoord(legs, firstRideLegIndex, "BOARD")
            ?? getRideStopDisplayCoord(legs, firstRideLegIndex, "BOARD")
            ?? getTransitLegBoardCoord(firstRideLeg)
            ?? getTransitLegBoardAnchorOnPath(firstRideLeg);
    }

    return getTransitLegBoardCoord(firstRideLeg)
        ?? getAdjacentWalkReferenceCoord(legs, firstRideLegIndex, "BOARD")
        ?? getTransitLegBoardAnchorOnPath(firstRideLeg)
        ?? getTransitLegStartCoord(firstRideLeg);
}

function getTransitRouteFirstSubwayFocusCoord(legs: TransitLegDetail[] | undefined): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legs.length === 0) return undefined;
    const firstSubwayLeg = legs.find((leg) => leg.kind === "SUBWAY");
    if (!firstSubwayLeg) return undefined;

    return getTransitLegMidCoord(firstSubwayLeg)
        ?? getTransitLegBoardCoord(firstSubwayLeg)
        ?? getTransitLegBoardAnchorOnPath(firstSubwayLeg)
        ?? getTransitLegStartCoord(firstSubwayLeg);
}

function getMinimumDistanceToPathMeters(point: RoutePathCoord, pathCoords: RoutePathCoord[]): number {
    if (!Array.isArray(pathCoords) || pathCoords.length === 0) return Number.POSITIVE_INFINITY;
    return pathCoords.reduce((minimum, pathPoint) => (
        Math.min(minimum, routeCoordDistanceMeters(point, pathPoint))
    ), Number.POSITIVE_INFINITY);
}

function trimWalkApproachTail(
    rawPath: RoutePathCoord[] | undefined,
    stopCoord: RoutePathCoord | undefined,
    ridePath: RoutePathCoord[]
): RoutePathCoord[] | undefined {
    if (!Array.isArray(rawPath) || rawPath.length < 3 || !stopCoord) return rawPath;

    // 보행 API가 버스/지하철 선형 위로 살짝 들어가는 꼬리를 줄 때가 있어
    // 승차 직전/하차 직후의 "도로 중앙으로 파고드는" 마지막 몇 미터만 잘라낸다.
    const stopTrimDistanceMeters = ridePath.length > 0 ? 12 : 8;
    const ridePathTrimDistanceMeters = 5.5;
    let trimIdx = rawPath.length;

    while (trimIdx > 2) {
        const point = rawPath[trimIdx - 1];
        const distanceToStop = routeCoordDistanceMeters(point, stopCoord);
        if (distanceToStop >= stopTrimDistanceMeters) break;

        const distanceToRidePath = ridePath.length > 0
            ? getMinimumDistanceToPathMeters(point, ridePath)
            : distanceToStop;
        if (distanceToRidePath >= ridePathTrimDistanceMeters) break;

        trimIdx -= 1;
    }

    if (trimIdx >= rawPath.length) return rawPath;
    return rawPath.slice(0, trimIdx);
}

function getTransitLegMidCoord(leg: TransitLegDetail): RoutePathCoord | undefined {
    if (Array.isArray(leg.pathCoords) && leg.pathCoords.length > 0) {
        const midpointIndex = Math.floor((leg.pathCoords.length - 1) * 0.5);
        return leg.pathCoords[midpointIndex] ?? leg.pathCoords[leg.pathCoords.length - 1];
    }
    const start = getTransitLegStartCoord(leg);
    const end = getTransitLegEndCoord(leg);
    if (start && end) {
        return {
            lat: (start.lat + end.lat) / 2,
            lng: (start.lng + end.lng) / 2,
        };
    }
    return start ?? end;
}

function routeCoordDistanceMeters(from: RoutePathCoord, to: RoutePathCoord): number {
    return haversineDistanceKm(
        { latitude: from.lat, longitude: from.lng },
        { latitude: to.lat, longitude: to.lng }
    ) * 1000;
}

function interpolateRouteCoord(from: RoutePathCoord, to: RoutePathCoord, ratio: number): RoutePathCoord {
    const clamped = Math.max(0, Math.min(1, ratio));
    return {
        lat: from.lat + ((to.lat - from.lat) * clamped),
        lng: from.lng + ((to.lng - from.lng) * clamped),
    };
}

function routeCoordHeadingDeg(from: RoutePathCoord, to: RoutePathCoord): number | undefined {
    const averageLatRad = ((from.lat + to.lat) * 0.5 * Math.PI) / 180;
    const eastMeters = (to.lng - from.lng) * 111_320 * Math.cos(averageLatRad);
    const northMeters = (to.lat - from.lat) * 111_320;
    if (!Number.isFinite(eastMeters) || !Number.isFinite(northMeters)) return undefined;
    if (Math.hypot(eastMeters, northMeters) < 0.8) return undefined;
    return (Math.atan2(-northMeters, eastMeters) * 180) / Math.PI;
}

// 네이버 지도처럼 selected path 위에 진행 방향을 보여 주기 위한 화살표 마커 생성.
function buildDirectionalMarkersForPath(
    idPrefix: string,
    pathCoords: RoutePathCoord[] | undefined,
    tintColor: string,
    spacingMeters: number,
    edgeInsetMeters: number,
    maxMarkers: number,
    arrowSize = 16,
    arrowBorderColor = "rgba(255,255,255,0.96)"
): TmapMarker[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2 || maxMarkers <= 0) return [];

    const segmentDistances: number[] = [];
    let totalDistance = 0;
    for (let index = 1; index < pathCoords.length; index += 1) {
        const distance = routeCoordDistanceMeters(pathCoords[index - 1], pathCoords[index]);
        segmentDistances.push(distance);
        totalDistance += distance;
    }

    if (!Number.isFinite(totalDistance) || totalDistance < Math.max(28, edgeInsetMeters * 2)) return [];

    const inset = Math.min(edgeInsetMeters, totalDistance * 0.32);
    const endLimit = totalDistance - inset;
    let nextDistance = totalDistance < spacingMeters * 1.45
        ? totalDistance * 0.5
        : inset + (spacingMeters * 0.5);
    const markers: TmapMarker[] = [];
    let traveled = 0;

    for (let index = 1; index < pathCoords.length && markers.length < maxMarkers; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        const segmentDistance = segmentDistances[index - 1];
        if (!Number.isFinite(segmentDistance) || segmentDistance < 4) {
            traveled += Number.isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
        }

        const heading = routeCoordHeadingDeg(from, to);
        if (typeof heading !== "number") {
            traveled += segmentDistance;
            continue;
        }

        while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && markers.length < maxMarkers) {
            const ratio = (nextDistance - traveled) / segmentDistance;
            const coord = interpolateRouteCoord(from, to, ratio);
            markers.push({
                id: `${idPrefix}-arrow-${markers.length}`,
                latitude: coord.lat,
                longitude: coord.lng,
                tintColor,
                badgeBorderColor: arrowBorderColor,
                displayType: "arrow",
                arrowSize,
                rotationDeg: heading,
                zIndex: 3400,
            });
            nextDistance += spacingMeters;
        }

        traveled += segmentDistance;
    }

    return markers;
}

// marker 대신 polyline chevron을 사용해 안내선 위에 자연스럽게 얹히는 방향 표시를 만든다.
function buildDirectionalChevronOverlaysForPath(
    idPrefix: string,
    pathCoords: RoutePathCoord[] | undefined,
    spacingMeters: number,
    edgeInsetMeters: number,
    maxChevrons: number,
    arrowLengthMeters: number,
    arrowHalfWidthMeters: number,
    width: number,
    outlineColor: string,
    outlineWidth: number
): TmapPathOverlay[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2 || maxChevrons <= 0) return [];

    const segmentDistances: number[] = [];
    let totalDistance = 0;
    for (let index = 1; index < pathCoords.length; index += 1) {
        const distance = routeCoordDistanceMeters(pathCoords[index - 1], pathCoords[index]);
        segmentDistances.push(distance);
        totalDistance += distance;
    }

    if (!Number.isFinite(totalDistance) || totalDistance < Math.max(18, edgeInsetMeters * 2)) return [];

    const inset = Math.min(edgeInsetMeters, totalDistance * 0.24);
    const endLimit = totalDistance - inset;
    let nextDistance = totalDistance < spacingMeters * 1.35
        ? totalDistance * 0.5
        : inset + (spacingMeters * 0.5);
    const overlays: TmapPathOverlay[] = [];
    let traveled = 0;

    for (let index = 1; index < pathCoords.length && overlays.length < maxChevrons; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        const segmentDistance = segmentDistances[index - 1];
        if (!Number.isFinite(segmentDistance) || segmentDistance < 3) {
            traveled += Number.isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
        }

        const averageLatRad = ((from.lat + to.lat) * 0.5 * Math.PI) / 180;
        const eastMeters = (to.lng - from.lng) * 111_320 * Math.cos(averageLatRad);
        const northMeters = (to.lat - from.lat) * 111_320;
        const vectorLength = Math.hypot(eastMeters, northMeters);
        if (!Number.isFinite(vectorLength) || vectorLength < 0.8) {
            traveled += segmentDistance;
            continue;
        }
        const unitEast = eastMeters / vectorLength;
        const unitNorth = northMeters / vectorLength;
        const leftEast = -unitNorth;
        const leftNorth = unitEast;

        while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && overlays.length < maxChevrons) {
            const ratio = (nextDistance - traveled) / segmentDistance;
            const center = interpolateRouteCoord(from, to, ratio);
            const tip = offsetCoordByMeters(
                center,
                unitNorth * arrowLengthMeters * 0.55,
                unitEast * arrowLengthMeters * 0.55
            );
            const tailCenter = offsetCoordByMeters(
                center,
                -unitNorth * arrowLengthMeters * 0.45,
                -unitEast * arrowLengthMeters * 0.45
            );
            const tailLeft = offsetCoordByMeters(
                tailCenter,
                leftNorth * arrowHalfWidthMeters,
                leftEast * arrowHalfWidthMeters
            );
            const tailRight = offsetCoordByMeters(
                tailCenter,
                -leftNorth * arrowHalfWidthMeters,
                -leftEast * arrowHalfWidthMeters
            );

            overlays.push({
                id: `${idPrefix}-chevron-${overlays.length}`,
                coords: [
                    { latitude: tailLeft.lat, longitude: tailLeft.lng },
                    { latitude: tip.lat, longitude: tip.lng },
                    { latitude: tailRight.lat, longitude: tailRight.lng },
                ],
                color: "#FFFFFF",
                width,
                outlineColor,
                outlineWidth,
            });
            nextDistance += spacingMeters;
        }

        traveled += segmentDistance;
    }

    return overlays;
}

function buildDotMarkersForPath(
    idPrefix: string,
    pathCoords: RoutePathCoord[] | undefined,
    tintColor: string,
    spacingMeters: number,
    edgeInsetMeters: number,
    maxMarkers: number,
    dotSize: number,
    borderColor = TRANSIT_CONNECTOR_DOT_BORDER_COLOR
): TmapMarker[] {
    // Polyline dash 옵션이 없는 환경에서도 동일한 시각 결과를 유지하기 위해
    // 경로 길이를 따라 일정 간격으로 dot marker를 찍어 "점선 안내선"을 만든다.
    if (!Array.isArray(pathCoords) || pathCoords.length < 2 || maxMarkers <= 0) return [];

    const segmentDistances: number[] = [];
    let totalDistance = 0;
    for (let index = 1; index < pathCoords.length; index += 1) {
        const distance = routeCoordDistanceMeters(pathCoords[index - 1], pathCoords[index]);
        segmentDistances.push(distance);
        totalDistance += distance;
    }

    if (!Number.isFinite(totalDistance) || totalDistance < Math.max(16, edgeInsetMeters * 2)) return [];

    const inset = Math.min(edgeInsetMeters, totalDistance * 0.34);
    const endLimit = totalDistance - inset;
    let nextDistance = totalDistance < spacingMeters * 1.3
        ? totalDistance * 0.5
        : Math.max(inset, spacingMeters * 0.55);
    const markers: TmapMarker[] = [];
    let traveled = 0;

    for (let index = 1; index < pathCoords.length && markers.length < maxMarkers; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        const segmentDistance = segmentDistances[index - 1];
        if (!Number.isFinite(segmentDistance) || segmentDistance < 1.2) {
            traveled += Number.isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
        }

        while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && markers.length < maxMarkers) {
            const ratio = (nextDistance - traveled) / segmentDistance;
            const coord = interpolateRouteCoord(from, to, ratio);
            markers.push({
                id: `${idPrefix}-dot-${markers.length}`,
                latitude: coord.lat,
                longitude: coord.lng,
                tintColor,
                badgeBorderColor: borderColor,
                displayType: "dot",
                dotSize,
            });
            nextDistance += spacingMeters;
        }

        traveled += segmentDistance;
    }

    return markers;
}

function mergeConnectedGuidePaths(paths: RoutePathCoord[][]): RoutePathCoord[][] {
    const merged: RoutePathCoord[][] = [];

    paths.forEach((path) => {
        if (!Array.isArray(path) || path.length < 2) return;
        if (!merged.length) {
            merged.push(path.slice());
            return;
        }

        const previous = merged[merged.length - 1];
        const previousEnd = previous[previous.length - 1];
        const currentStart = path[0];
        const currentEnd = path[path.length - 1];

        if (routeCoordDistanceMeters(previousEnd, currentStart) <= 22) {
            merged[merged.length - 1] = previous.concat(path.slice(1));
            return;
        }
        if (routeCoordDistanceMeters(previousEnd, currentEnd) <= 22) {
            merged[merged.length - 1] = previous.concat(path.slice(0, -1).reverse());
            return;
        }

        merged.push(path.slice());
    });

    return merged;
}

function filterDensePathCoords(pathCoords: RoutePathCoord[] | undefined, minSegmentMeters: number): RoutePathCoord[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return [];
    const minimum = Math.max(0.5, minSegmentMeters);
    const filtered: RoutePathCoord[] = [pathCoords[0]];
    for (let index = 1; index < pathCoords.length; index += 1) {
        const point = pathCoords[index];
        const prev = filtered[filtered.length - 1];
        const isTail = index === pathCoords.length - 1;
        if (isTail || routeCoordDistanceMeters(prev, point) >= minimum) {
            filtered.push(point);
        }
    }
    return filtered;
}

function smoothWalkPathForDisplay(pathCoords: RoutePathCoord[] | undefined): RoutePathCoord[] {
    return filterDensePathCoords(pathCoords, 2.8);
}

// 지도 오버레이는 leg 원본 path를 그대로 쓰지 않고,
// 도보/대중교통 종류에 맞게 밀도와 모양을 먼저 정리한 뒤 전달한다.
function normalizeDisplayPathCoords(pathCoords: RoutePathCoord[] | undefined, kind?: TransitLegDetail["kind"]): RoutePathCoord[] {
    return kind === "WALK"
        ? smoothWalkPathForDisplay(pathCoords)
        : filterDensePathCoords(pathCoords, 1.6);
}

function toDisplayOverlayCoords(pathCoords: RoutePathCoord[] | undefined, kind?: TransitLegDetail["kind"]): TmapLatLng[] {
    const normalized = normalizeDisplayPathCoords(pathCoords, kind);
    if (!normalized.length) return [];
    return normalized.map((point) => ({ latitude: point.lat, longitude: point.lng }));
}

function offsetPathLaterally(
    pathCoords: RoutePathCoord[] | undefined,
    offsetMeters: number,
    edgeBlendFloor = 0
): RoutePathCoord[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2 || Math.abs(offsetMeters) < 0.1) {
        return Array.isArray(pathCoords) ? pathCoords : [];
    }

    const lastIndex = pathCoords.length - 1;
    const fadeSpan = Math.max(3, Math.min(10, Math.floor(lastIndex * 0.18)));

    return pathCoords.map((point, index) => {
        const prev = pathCoords[Math.max(0, index - 1)] ?? point;
        const next = pathCoords[Math.min(lastIndex, index + 1)] ?? point;
        const dLat = next.lat - prev.lat;
        const dLng = next.lng - prev.lng;
        const norm = Math.hypot(dLat, dLng);
        if (!Number.isFinite(norm) || norm < 1e-9) return point;

        const startBlend = fadeSpan <= 0 ? 1 : Math.min(1, index / fadeSpan);
        const endBlend = fadeSpan <= 0 ? 1 : Math.min(1, (lastIndex - index) / fadeSpan);
        const baseBlend = Math.max(0, Math.min(1, startBlend, endBlend));
        const blend = edgeBlendFloor + ((1 - edgeBlendFloor) * baseBlend);
        if (blend <= 0) return point;

        return offsetCoordByMeters(
            point,
            (-dLng / norm) * offsetMeters * blend,
            (dLat / norm) * offsetMeters * blend
        );
    });
}

function resolveRidePathOffsetMeters(
    legs: TransitLegDetail[] | undefined,
    legIndex: number
): number {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return 0;
    const leg = legs[legIndex];
    if (leg.kind !== "BUS" || !Array.isArray(leg.pathCoords) || leg.pathCoords.length < 2) return 0;

    const boardAnchor = getTransitLegBoardAnchorOnPath(leg) ?? getTransitLegBoardCoord(leg);
    const boardDisplay = getRideStopDisplayCoord(legs, legIndex, "BOARD");
    const alightAnchor = getTransitLegAlightAnchorOnPath(leg) ?? getTransitLegAlightCoord(leg);
    const alightDisplay = getRideStopDisplayCoord(legs, legIndex, "ALIGHT");
    const pathCoords = leg.pathCoords;

    const resolveSide = (
        anchor: RoutePathCoord | undefined,
        reference: RoutePathCoord | undefined,
        fromIndex: number,
        toIndex: number
    ): { side: number; distanceMeters: number } | undefined => {
        if (!anchor || !reference) return undefined;
        const from = pathCoords[fromIndex];
        const to = pathCoords[toIndex];
        if (!from || !to) return undefined;
        const dLat = to.lat - from.lat;
        const dLng = to.lng - from.lng;
        const norm = Math.hypot(dLat, dLng);
        if (!Number.isFinite(norm) || norm < 1e-9) return undefined;
        const refLat = reference.lat - anchor.lat;
        const refLng = reference.lng - anchor.lng;
        const cross = (dLat * refLng) - (dLng * refLat);
        if (!Number.isFinite(cross) || Math.abs(cross) < 1e-12) return undefined;
        const distanceMeters = routeCoordDistanceMeters(anchor, reference);
        if (!Number.isFinite(distanceMeters) || distanceMeters < 2) return undefined;
        return {
            side: cross >= 0 ? 1 : -1,
            distanceMeters,
        };
    };

    const boardSide = resolveSide(boardAnchor, boardDisplay, 0, Math.min(pathCoords.length - 1, 2));
    const alightSide = resolveSide(
        alightAnchor,
        alightDisplay,
        Math.max(0, pathCoords.length - 3),
        pathCoords.length - 1
    );
    const candidates = [boardSide, alightSide]
        .filter((value): value is { side: number; distanceMeters: number } => value !== undefined)
        .sort((left, right) => right.distanceMeters - left.distanceMeters);
    const preferred = candidates[0];
    if (!preferred) return 0;

    // 정류장 마커만 옆으로 밀고 버스 path는 중앙에 두면 둘이 서로 어긋나 보인다.
    // 그래서 버스 레그 자체도 같은 쪽으로 옮겨 노선과 정류장이 한 세트처럼 보이게 맞춘다.
    const offsetMagnitude = Math.max(10, Math.min(14, preferred.distanceMeters * 0.55));
    return preferred.side * offsetMagnitude;
}

function getRideLegDisplayPathCoords(
    legs: TransitLegDetail[] | undefined,
    legIndex: number
): RoutePathCoord[] {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return [];
    const leg = legs[legIndex];
    const basePath = Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
        : [];
    if (basePath.length < 2) return [];
    if (leg.kind !== "BUS") return basePath;

    // 버스 레그는 원본 중심선 대신, 정류장 위치 보정 결과와 같은 측면 오프셋을 적용한 표시 path를 쓴다.
    const offsetMeters = resolveRidePathOffsetMeters(legs, legIndex);
    return offsetPathLaterally(basePath, offsetMeters, 0.9);
}

function getRideLegDisplayCoords(
    legs: TransitLegDetail[] | undefined,
    legIndex: number
): TmapLatLng[] {
    return getRideLegDisplayPathCoords(legs, legIndex)
        .map((point) => ({ latitude: point.lat, longitude: point.lng }));
}

function buildEndpointPathCoords(leg: TransitLegDetail): RoutePathCoord[] {
    const start = getTransitLegStartCoord(leg);
    const end = getTransitLegEndCoord(leg);
    if (start && end) return [start, end];
    if (start) return [start];
    if (end) return [end];
    return [];
}

function getTransitLegMapCoords(
    routeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    walkOverlayById?: Map<string, TmapLatLng[]>
): TmapLatLng[] {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return [];
    const leg = legs[legIndex];

    if (leg.kind === "BUS") {
        const displayCoords = getRideLegDisplayCoords(legs, legIndex);
        if (displayCoords.length >= 2) return displayCoords;
    }

    if (leg.kind === "WALK" && routeId && walkOverlayById) {
        const baseId = `${routeId}-walk-leg-${legIndex}`;
        const walkDetailCoords = walkOverlayById.get(baseId) ?? walkOverlayById.get(`${baseId}-path`);
        if (Array.isArray(walkDetailCoords) && walkDetailCoords.length >= 2) {
            return walkDetailCoords;
        }
    }

    const fallbackPath = Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
        ? leg.pathCoords
        : buildEndpointPathCoords(leg);
    return toDisplayOverlayCoords(fallbackPath, leg.kind);
}

function normalizeTransitStopName(name?: string): string | undefined {
    if (!name) return undefined;
    const normalized = name.trim();
    if (!normalized) return undefined;
    return normalized.length > 16 ? `${normalized.slice(0, 16)}…` : normalized;
}

function buildTransitLegAssistText(legs: TransitLegDetail[] | undefined, legIndex: number): string | undefined {
    if (!Array.isArray(legs) || !legs[legIndex]) return undefined;
    const leg = legs[legIndex];

    if (isRideLegKind(leg.kind)) {
        const board = normalizeTransitStopName(leg.startName);
        const alight = normalizeTransitStopName(leg.endName);
        if (board && alight) return `${board} 승차 → ${alight} 하차`;
        if (board) return `${board} 승차`;
        if (alight) return `${alight} 하차`;
        return undefined;
    }

    if (leg.kind !== "WALK") return undefined;

    let prevRide: TransitLegDetail | undefined;
    for (let index = legIndex - 1; index >= 0; index -= 1) {
        const candidate = legs[index];
        if (isRideLegKind(candidate.kind)) {
            prevRide = candidate;
            break;
        }
    }
    let nextRide: TransitLegDetail | undefined;
    for (let index = legIndex + 1; index < legs.length; index += 1) {
        const candidate = legs[index];
        if (isRideLegKind(candidate.kind)) {
            nextRide = candidate;
            break;
        }
    }

    if (prevRide && nextRide) {
        const nextKindLabel = getTransitLegKindMeta(nextRide.kind).label;
        const nextBoardName = normalizeTransitStopName(nextRide.startName);
        if (nextBoardName) return `환승 도보: ${nextBoardName}(${nextKindLabel}) 승차지점까지 이동`;
        return `환승 도보: ${nextKindLabel} 승차지점까지 이동`;
    }
    if (nextRide) {
        const nextKindLabel = getTransitLegKindMeta(nextRide.kind).label;
        const nextBoardName = normalizeTransitStopName(nextRide.startName);
        if (nextBoardName) return `${nextBoardName}(${nextKindLabel}) 승차지점까지 도보 이동`;
        return `${nextKindLabel} 승차지점까지 도보 이동`;
    }
    if (prevRide) {
        const prevKindLabel = getTransitLegKindMeta(prevRide.kind).label;
        const prevAlightName = normalizeTransitStopName(prevRide.endName);
        if (prevAlightName) return `${prevAlightName}(${prevKindLabel}) 하차 후 목적지까지 도보 이동`;
        return `${prevKindLabel} 하차 후 목적지까지 도보 이동`;
    }
    return "목적지까지 도보 이동";
}

type TransitEventDraft = {
    coord: RoutePathCoord;
    intent: "BOARD" | "ALIGHT" | "TRANSFER";
    kind: TransitLegDetail["kind"];
    lineLabel?: string;
    stopName?: string;
    order: number;
};

// 확대 수준에 따라 버스 정류장 마커를 생성한다.
function buildBusStopMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number
): TmapMarker[] {
    // 저배율에서는 정류장 마커를 숨겨 지도 혼잡을 줄인다.
    if (!Array.isArray(legs) || !legs.length || mapZoom < TRANSIT_BUS_STOP_MIN_ZOOM) return [];

    const markers: TmapMarker[] = [];
    const seen = new Set<string>();

    legs.forEach((leg, index) => {
        if (leg.kind !== "BUS") return;
        const pushStop = (
            coord: RoutePathCoord | undefined,
            role: "BOARD" | "ALIGHT",
            stopName?: string,
            lineName?: string
        ) => {
            if (!coord) return;
            const key = `${coord.lat.toFixed(5)}:${coord.lng.toFixed(5)}`;
            if (seen.has(key)) return;
            seen.add(key);
            // 줌 단계별 정류장 도트 크기.
            const dotSize = mapZoom >= 16.2 ? 10 : mapZoom >= 15 ? 9 : 8;
            const compactStop = compactTransitStopLabel(stopName, 9);
            const compactLine = compactTransitLineLabel(lineName);
            // 승/하차 지점에 번호+정류장 배지 노출.
            const shouldUseStopBadge = mapZoom >= TRANSIT_BOARD_BADGE_MIN_ZOOM;
            if (shouldUseStopBadge) {
                // 배지 본문: 노선번호 + 정류장명.
                const badgeLabel = [compactLine, compactStop].filter(Boolean).join(" ") || compactLine || compactStop || "버스";
                markers.push({
                    id: `bus-stop-${role.toLowerCase()}-${selectedAlternativeId ?? "sel"}-${index}`,
                    latitude: coord.lat,
                    longitude: coord.lng,
                    tintColor: "#26A65B",
                    markerStyle: "bus",
                    displayType: "badge",
                    badgeLabel: badgeLabel || "버스 정류장",
                    badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
                    badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
                    // 정류장 실지점은 접근 점선과 구분되는 중립 링 색상 사용.
                    badgeConnectorColor: TRANSIT_STOP_POINT_BORDER_COLOR,
                    caption: [compactLine, stopName].filter(Boolean).join(" · ") || (role === "BOARD" ? "승차 정류장" : "하차 정류장"),
                });
                return;
            }
            markers.push({
                id: `bus-stop-${role.toLowerCase()}-${selectedAlternativeId ?? "sel"}-${index}`,
                latitude: coord.lat,
                longitude: coord.lng,
                // 승하차 지점은 접근 점선과 구분되는 작은 링 포인트로 렌더링.
                tintColor: TRANSIT_STOP_POINT_COLOR,
                displayType: "dot",
                dotSize,
                caption: stopName ?? (role === "BOARD" ? "승차 정류장" : "하차 정류장"),
                badgeBorderColor: TRANSIT_STOP_POINT_BORDER_COLOR,
            });
        };

        pushStop(
            // connector 좌표보다 실제 정류장 표시 좌표(displayCoord)를 우선 사용한다.
            getRideStopDisplayCoord(legs, index, "BOARD") ?? getRideStopConnectorCoord(legs, index, "BOARD"),
            "BOARD",
            leg.startName,
            leg.lineName
        );
        pushStop(
            getRideStopDisplayCoord(legs, index, "ALIGHT") ?? getRideStopConnectorCoord(legs, index, "ALIGHT"),
            "ALIGHT",
            leg.endName,
            leg.lineName
        );
    });

    return markers;
}

function buildTransitEventMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number,
    _isDark: boolean
): TmapMarker[] {
    if (!Array.isArray(legs) || !legs.length || mapZoom < TRANSIT_BADGE_MIN_ZOOM) return [];

    const drafts: TransitEventDraft[] = [];
    let rideLegSeen = false;

    legs.forEach((leg, index) => {
        const boardMarkerCoord = leg.kind === "BUS"
            ? getRideStopDisplayCoord(legs, index, "BOARD")
            : (getTransitLegBoardCoord(leg) ??
                getTransitLegStartCoord(leg) ??
                getTransitLegBoardAnchorOnPath(leg));
        const alightMarkerCoord = leg.kind === "BUS"
            ? getRideStopDisplayCoord(legs, index, "ALIGHT")
            : (getTransitLegAlightCoord(leg) ??
                getTransitLegEndCoord(leg) ??
                getTransitLegAlightAnchorOnPath(leg));
        const lineLabel = compactTransitLineLabel(leg.lineName);
        const baseOrder = index * 10;

        if (isRideLegKind(leg.kind)) {
            if (leg.kind !== "BUS" && boardMarkerCoord) {
                drafts.push({
                    coord: boardMarkerCoord,
                    intent: "BOARD",
                    kind: leg.kind,
                    lineLabel,
                    stopName: normalizeTransitStopName(leg.startName),
                    order: baseOrder + 1,
                });
            }
            if (alightMarkerCoord && leg.kind !== "BUS") {
                drafts.push({
                    coord: alightMarkerCoord,
                    intent: "ALIGHT",
                    kind: leg.kind,
                    lineLabel,
                    stopName: normalizeTransitStopName(leg.endName),
                    order: baseOrder + 7,
                });
            }
            if (rideLegSeen && boardMarkerCoord) {
                drafts.push({
                    coord: boardMarkerCoord,
                    intent: "TRANSFER",
                    kind: leg.kind,
                    lineLabel,
                    stopName: normalizeTransitStopName(leg.startName),
                    order: baseOrder,
                });
            }
            rideLegSeen = true;
            return;
        }
    });

    if (!drafts.length) return [];

    const grouped = new Map<string, TransitEventDraft[]>();
    drafts.forEach((draft) => {
        const key = `${draft.coord.lat.toFixed(5)}:${draft.coord.lng.toFixed(5)}`;
        const list = grouped.get(key);
        if (list) {
            list.push(draft);
            return;
        }
        grouped.set(key, [draft]);
    });

    const sortedGroups = Array.from(grouped.values())
        .map((group) => group.sort((a, b) => a.order - b.order))
        .sort((a, b) => a[0].order - b[0].order)
        .slice(0, TRANSIT_BADGE_MAX_COUNT);

    return sortedGroups.map((group, index) => {
        const base = group[0];
        const intents = new Set(group.map((item) => item.intent));

        let badgeLabel = "도보";
        let badgeGlyph = "도";
        let tintColor = TRANSIT_LEG_COLOR.WALK;
        let caption = "도보 구간";
        let markerStyle: TmapMarker["markerStyle"] = "default";

        if (intents.has("TRANSFER")) {
            const transfer = group.find((item) => item.intent === "TRANSFER") ?? base;
            badgeLabel = compactTransitStopLabel(transfer.stopName, 11) ?? "환승";
            badgeGlyph = "환";
            tintColor = TRANSIT_TRANSFER_COLOR;
            markerStyle = "transfer";
            // 환승 지점은 실제 환승 수단 아이콘(bus/subway)을 우선 사용한다.
            if (transfer.kind === "SUBWAY") {
                markerStyle = "subway";
                tintColor = getSubwayLineColor(transfer.lineLabel);
            } else if (transfer.kind === "BUS") {
                markerStyle = "bus";
                tintColor = getBusLineColor(transfer.lineLabel);
            }
            const transferLine = transfer.lineLabel;
            caption = transferLine ? `${transferLine} 환승` : "환승 지점";
        } else if (intents.has("BOARD")) {
            const board = group.find((item) => item.intent === "BOARD") ?? base;
            const kindMeta = getTransitLegKindMeta(board.kind);
            const normalizedLine = board.lineLabel
                ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, "")
                .trim();
            badgeLabel = board.kind === "SUBWAY"
                ? (compactTransitStopLabel(board.stopName, 11) ?? normalizedLine ?? kindMeta.label)
                : (normalizedLine ?? kindMeta.label);
            badgeGlyph = "승";
            tintColor = getTransitLegVisualColor(board);
            if (board.kind === "BUS") {
                badgeGlyph = "버";
                // 버스 승차 이벤트는 버스 아이콘 스타일로 고정.
                markerStyle = "bus";
            }
            if (board.kind === "SUBWAY") markerStyle = "subway";
            caption = board.stopName ? `${board.stopName} 승차` : `${kindMeta.label} 승차 지점`;
        } else if (intents.has("ALIGHT")) {
            const alight = group.find((item) => item.intent === "ALIGHT") ?? base;
            const kindMeta = getTransitLegKindMeta(alight.kind);
            const normalizedLine = alight.lineLabel
                ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, "")
                .trim();
            badgeLabel = alight.kind === "SUBWAY"
                ? (compactTransitStopLabel(alight.stopName, 11) ?? normalizedLine ?? kindMeta.label)
                : (normalizedLine ?? kindMeta.label);
            badgeGlyph = "하";
            tintColor = getTransitLegVisualColor(alight);
            if (alight.kind === "BUS") {
                // 버스 하차 이벤트는 버스 아이콘 스타일로 고정.
                markerStyle = "bus";
            }
            if (alight.kind === "SUBWAY") markerStyle = "subway";
            caption = alight.stopName ? `${alight.stopName} 하차` : `${kindMeta.label} 하차 지점`;
        }

        return {
            id: `transit-event-${selectedAlternativeId ?? "selected"}-${index}`,
            latitude: base.coord.lat,
            longitude: base.coord.lng,
            tintColor,
            markerStyle,
            caption,
            displayType: "badge",
            badgeLabel,
            badgeGlyph,
            badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
            badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
        };
    });
}

function buildTransitLegLabelMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number,
    _isDark: boolean
): TmapMarker[] {
    if (!Array.isArray(legs) || !legs.length || mapZoom < 15.6) return [];

    const markers: TmapMarker[] = [];
    legs.forEach((leg, legIndex) => {
        if (leg.kind === "ETC" || leg.kind === "WALK" || leg.kind === "BUS") return;
        const coord = getTransitLegMidCoord(leg);
        if (!coord) return;

        const meta = getTransitLegKindMeta(leg.kind);
        const compactLine = compactTransitLineLabel(leg.lineName);
        let badgeLabel = compactLine ?? meta.label;
        let badgeGlyph = meta.short;

        markers.push({
            id: `transit-leg-label-${selectedAlternativeId ?? "selected"}-${legIndex}`,
            latitude: coord.lat,
            longitude: coord.lng,
            tintColor: getTransitLegVisualColor(leg),
            markerStyle: leg.kind === "SUBWAY" ? "subway" : "default",
            caption: `${meta.label} 구간`,
            displayType: "badge",
            badgeLabel,
            badgeGlyph,
            badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
            badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
        });
    });

    return markers.slice(0, mapZoom >= 16.25 ? 6 : 4);
}

function buildSelectedRouteDirectionMarkers(
    selectedAlternative: RouteAlternativeOption | undefined,
    travelMode: TravelMode,
    mapZoom: number
): TmapMarker[] {
    if (!selectedAlternative) return [];
    if (travelMode === "TRANSIT") {
        return [];
    }

    if (travelMode !== "CAR" || mapZoom < 11.2) return [];
    const displayPath = Array.isArray(selectedAlternative.pathCoords) && selectedAlternative.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(selectedAlternative.pathCoords, undefined)
        : [];
    return buildDirectionalMarkersForPath(
        `${selectedAlternative.id}-car`,
        displayPath,
        "#FFFFFF",
        mapZoom >= 16.5 ? 64 : mapZoom >= 14.5 ? 86 : mapZoom >= 12.8 ? 108 : 132,
        20,
        20,
        mapZoom >= 16.2 ? 18 : mapZoom >= 13.8 ? 16 : 14,
        "rgba(15,23,42,0.18)"
    );
}

function buildTransitWalkGuideMarkers(
    selectedAlternative: RouteAlternativeOption | undefined,
    travelMode: TravelMode,
    mapZoom: number,
    connectorOverlays: TmapPathOverlay[],
    walkDetailOverlays: TmapPathOverlay[]
): TmapMarker[] {
    // 저배율에서는 보행 점선을 숨겨 지도 노이즈를 줄인다.
    // UI tuning: 안내선을 한 단계 이른 줌부터 노출한다.
    if (travelMode !== "TRANSIT" || !selectedAlternative || mapZoom < 13.2) return [];

    // 점선 안내는 connector뿐 아니라 실제 WALK 상세 경로에도 함께 찍어
    // 확대 시 "실선 도보"가 아니라 점선 안내가 먼저 읽히게 한다.
    const walkGuideOverlays = [...connectorOverlays, ...walkDetailOverlays]
        .filter((overlay) => (
            typeof overlay.id === "string" &&
            overlay.id.endsWith("-path") &&
            Array.isArray(overlay.coords) &&
            overlay.coords.length >= 2
        ));
    const walkOverlayById = new Map(walkDetailOverlays.map((overlay) => [overlay.id, overlay.coords]));
    const fallbackWalkPaths = Array.isArray(selectedAlternative.transitLegs)
        ? selectedAlternative.transitLegs.flatMap((leg, legIndex) => {
            if (leg.kind !== "WALK") return [];
            const detailId = `${selectedAlternative.id}-walk-leg-${legIndex}`;
            if (walkOverlayById.has(detailId) || walkOverlayById.has(`${detailId}-path`)) return [];
            const coords = getTransitLegMapCoords(
                selectedAlternative.id,
                selectedAlternative.transitLegs,
                legIndex,
                walkOverlayById
            );
            if (coords.length < 2) return [];
            return [coords.map((point) => ({ lat: point.latitude, lng: point.longitude }))];
        })
        : [];
    if (!walkGuideOverlays.length && !fallbackWalkPaths.length) return [];

    const mergedGuidePaths = mergeConnectedGuidePaths(
        [
            ...walkGuideOverlays.map((overlay) => normalizeDisplayPathCoords(
                overlay.coords.map((point) => ({ lat: point.latitude, lng: point.longitude })),
                "WALK"
            )),
            ...fallbackWalkPaths.map((path) => normalizeDisplayPathCoords(path, "WALK")),
        ]
    );
    if (!mergedGuidePaths.length) return [];

    // 줌 단계별 점선 간격/크기 설정.
    const spacingMeters = mapZoom >= 16.4 ? 11 : mapZoom >= 15.2 ? 13 : mapZoom >= 14 ? 16 : 20;
    const dotSize = mapZoom >= 16.4 ? 7 : mapZoom >= 15.2 ? 6 : mapZoom >= 14.2 ? 5 : 4;
    const maxTotalMarkers = mapZoom >= 16.2 ? 34 : mapZoom >= 15 ? 26 : mapZoom >= 14 ? 18 : 12;
    const maxPerPath = Math.max(8, Math.floor(maxTotalMarkers / mergedGuidePaths.length));
    const markers: TmapMarker[] = [];

    mergedGuidePaths.forEach((routePath, overlayIndex) => {
        if (markers.length >= maxTotalMarkers) return;
        if (routePath.length < 2) return;

        const remaining = maxTotalMarkers - markers.length;
        markers.push(
            ...buildDotMarkersForPath(
                `${selectedAlternative.id}-walk-guide-${overlayIndex}`,
                routePath,
                TRANSIT_CONNECTOR_DOT_COLOR,
                spacingMeters,
                1.5,
                Math.min(maxPerPath, remaining),
                dotSize,
                TRANSIT_WALK_DOT_BORDER_COLOR
            )
        );
    });

    return markers;
}

function formatTransitDepartureNow(date = new Date()): string {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `오늘 ${hh}:${mm} 출발`;
}

function formatTransitClock(date: Date): string {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "오전" : "오후";
    const displayHour = hours % 12 || 12;
    return `${period} ${displayHour}:${minutes}`;
}

function formatTransitRouteTimeRange(option: RouteAlternativeOption, departureAt: Date): string {
    const chunks: string[] = [];
    if (typeof option.minutes === "number") {
        const arrivalAt = new Date(departureAt.getTime() + Math.max(0, option.minutes) * 60 * 1000);
        chunks.push(`${formatTransitClock(departureAt)} - ${formatTransitClock(arrivalAt)}`);
    }
    if (typeof option.fareWon === "number") {
        chunks.push(`${option.fareWon.toLocaleString()}원`);
    }
    return chunks.join(" | ");
}

type TransitProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    minutes: number;
    color: string;
    flex: number;
    isRide: boolean;
};

function buildTransitProgressSegments(legs?: TransitLegDetail[]): TransitProgressSegment[] {
    if (!Array.isArray(legs)) return [];
    return legs
        .map((leg, index) => {
            const minutes = typeof leg.durationMinutes === "number"
                ? Math.max(1, Math.round(leg.durationMinutes))
                : 1;
            return {
                key: `${leg.kind}-${index}`,
                label: formatDuration(minutes),
                lineLabel: leg.kind === "WALK"
                    ? undefined
                    : (compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label)),
                minutes,
                color: leg.kind === "WALK" ? "#5F6368" : getTransitLegVisualColor(leg),
                flex: Math.max(0.8, minutes),
                isRide: isRideLegKind(leg.kind),
            };
        })
        .filter((segment) => segment.minutes > 0);
}

function getPrimaryTransitLineLabel(legs?: TransitLegDetail[]): string {
    const firstRide = Array.isArray(legs) ? legs.find((leg) => isRideLegKind(leg.kind)) : undefined;
    return compactTransitLineLabel(firstRide?.lineName) ?? compactTransitLineLabel(firstRide?.label) ?? "대중교통";
}

function formatTransitRouteChipLabel(option: RouteAlternativeOption, index: number): string {
    if (index === 0) return `최적 | ${formatDuration(option.minutes)}`;
    const lineLabel = getPrimaryTransitLineLabel(option.transitLegs);
    const transferLabel = typeof option.transferCount === "number" ? ` + 환승 ${option.transferCount}회` : "";
    return `${lineLabel}${transferLabel} | ${formatDuration(option.minutes)}`;
}

function buildTransitDetailTimelineTitle(
    leg: TransitLegDetail,
    legIndex: number,
    legs: TransitLegDetail[],
    originLabel: string,
    destinationLabel: string
): string {
    if (leg.kind === "WALK") {
        if (legIndex === 0) return originLabel;
        if (legIndex === legs.length - 1) return destinationLabel;
        return leg.label;
    }

    const boardName = normalizeTransitStopName(leg.startName);
    return boardName ? `${boardName} 승차` : `${buildTransitTimelineTitle(leg)} 승차`;
}

function buildTransitRideDetailText(leg: TransitLegDetail): string | undefined {
    if (!isRideLegKind(leg.kind)) return undefined;
    const chunks: string[] = [];
    const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
    if (lineLabel) chunks.push(lineLabel);
    const alightName = normalizeTransitStopName(leg.endName);
    if (alightName) chunks.push(`${alightName} 하차`);
    return chunks.length ? chunks.join(" · ") : undefined;
}

function normalizeStopNameForCompare(stopName?: string): string {
    return (normalizeTransitStopName(stopName) ?? "")
        .replace(/\s+/g, "")
        .replace(/[·.]/g, "")
        .toLowerCase();
}

function getTransitLegDisplayStops(leg: TransitLegDetail): TransitPassStop[] {
    if (!Array.isArray(leg.passStops) || leg.passStops.length === 0) return [];

    const startName = normalizeStopNameForCompare(leg.startName);
    return leg.passStops.filter((stop, index) => {
        const stopName = normalizeStopNameForCompare(stop.name);
        if (!stopName) return false;
        return !(index === 0 && startName && stopName === startName);
    });
}

function buildTransitStopMoveSummary(leg: TransitLegDetail): string | undefined {
    if (!isRideLegKind(leg.kind)) return undefined;

    const displayStops = getTransitLegDisplayStops(leg);
    const stopCount = typeof leg.stationCount === "number"
        ? leg.stationCount
        : displayStops.length;
    if (stopCount <= 0) return undefined;

    const unit = leg.kind === "BUS" ? "개 정류장" : "정거장";
    const durationText = typeof leg.durationMinutes === "number"
        ? ` · ${formatDuration(Math.max(1, Math.round(leg.durationMinutes)))}`
        : "";
    return `${stopCount}${unit} 이동${durationText}`;
}

export default function RoutePlannerScreen() {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const isDark = mode === "dark";
    const overlayBoxBg = isDark ? "rgba(8, 12, 20, 0.78)" : "rgba(255, 255, 255, 0.9)";
    const overlayPanelBg = isDark ? "rgba(7, 11, 18, 0.9)" : "rgba(248, 250, 255, 0.92)";
    const overlayCardBg = isDark ? "rgba(18, 24, 34, 0.9)" : "rgba(255, 255, 255, 0.95)";
    const params = useLocalSearchParams<{
        sessionId?: string;
        routeIndex?: string;
        travelMode?: string;
        focusTarget?: string;
        focusZoom?: string;
        sheetState?: string;
        originName?: string;
        originAddress?: string;
        originLat?: string;
        originLng?: string;
        destinationName?: string;
        destinationAddress?: string;
        destinationLat?: string;
        destinationLng?: string;
    }>();
    const isRouteSelectionScreen = pathname === "/schedule/route-select";
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const sessionInitial = sessionId ? getRoutePlannerInitial(sessionId) : undefined;
    const paramOrigin = useMemo(() => parseRouteParamPlace(params, "origin"), [params]);
    const paramDestination = useMemo(() => parseRouteParamPlace(params, "destination"), [params]);
    const paramTravelMode = useMemo(() => parseTravelModeParam(params.travelMode), [params.travelMode]);
    const initial = useMemo(() => (
        sessionInitial ?? (
            paramOrigin || paramDestination || paramTravelMode
                ? {
                    origin: paramOrigin,
                    destination: paramDestination,
                    travelMode: paramTravelMode ?? "CAR",
                }
                : undefined
        )
    ), [sessionInitial, paramOrigin, paramDestination, paramTravelMode]);
    const forcedFocusTarget = useMemo(() => parseFocusTargetParam(params.focusTarget), [params.focusTarget]);
    const forcedFocusZoom = useMemo(() => parseFocusZoomParam(params.focusZoom), [params.focusZoom]);
    const forcedSheetState = useMemo(() => parseSheetStateParam(params.sheetState), [params.sheetState]);
    const forcedRouteIndex = useMemo(() => parseIntegerParam(params.routeIndex), [params.routeIndex]);

    const [originName, setOriginName] = useState(initial?.origin?.name ?? "");
    const [destinationName, setDestinationName] = useState(initial?.destination?.name ?? "");
    const [originAddress, setOriginAddress] = useState(initial?.origin?.address ?? "");
    const [destinationAddress, setDestinationAddress] = useState(initial?.destination?.address ?? "");
    const [originLat, setOriginLat] = useState<number | undefined>(initial?.origin?.lat);
    const [originLng, setOriginLng] = useState<number | undefined>(initial?.origin?.lng);
    const [destinationLat, setDestinationLat] = useState<number | undefined>(initial?.destination?.lat);
    const [destinationLng, setDestinationLng] = useState<number | undefined>(initial?.destination?.lng);
    const [travelMode, setTravelMode] = useState<TravelMode>(initial?.travelMode ?? "CAR");
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget | null>(() => {
        const hasInitialOrigin = typeof initial?.origin?.lat === "number" && typeof initial?.origin?.lng === "number";
        const hasInitialDestination = typeof initial?.destination?.lat === "number" && typeof initial?.destination?.lng === "number";
        if (forcedFocusTarget === "origin" && hasInitialOrigin) return "origin";
        if (forcedFocusTarget === "destination" && hasInitialDestination) return "destination";
        if (hasInitialOrigin && hasInitialDestination) return null;
        return hasInitialOrigin ? "destination" : "origin";
    });
    const [isRoutePointEditMode, setIsRoutePointEditMode] = useState<boolean>(() => !(
        typeof initial?.origin?.lat === "number" &&
        typeof initial?.origin?.lng === "number" &&
        typeof initial?.destination?.lat === "number" &&
        typeof initial?.destination?.lng === "number"
    ));

    const [searchQuery, setSearchQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [etaMinutes, setEtaMinutes] = useState<number | undefined>(initial?.travelMinutes);
    const [_etaDistanceMeters, setEtaDistanceMeters] = useState<number | undefined>();
    const [etaSource, setEtaSource] = useState<"api" | "fallback" | undefined>();
    const [etaFallbackKind, setEtaFallbackKind] = useState<"road" | "straight" | undefined>();
    const [routePathCoords, setRoutePathCoords] = useState<RoutePathCoord[] | undefined>();
    const [etaLoading, setEtaLoading] = useState(false);
    const [alternativesError, setAlternativesError] = useState<string | undefined>();
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>([]);
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | undefined>();
    const [bottomPanelHeight, setBottomPanelHeight] = useState(0);
    const [hasBottomSheetMeasured, setHasBottomSheetMeasured] = useState(false);
    const [bottomSheetSnap, setBottomSheetSnap] = useState<BottomSheetSnap>("collapsed");
    const [isBottomSheetCollapsed, setIsBottomSheetCollapsed] = useState(true);
    const [isBottomSheetHidden, setIsBottomSheetHidden] = useState(true);
    const [isMapInitialized, setIsMapInitialized] = useState(false);
    const [mapZoom, setMapZoom] = useState<number>(INITIAL_CAMERA.zoom ?? 12);
    const [transitConnectorOverlays, setTransitConnectorOverlays] = useState<TmapPathOverlay[]>([]);
    const [transitWalkDetailOverlays, setTransitWalkDetailOverlays] = useState<TmapPathOverlay[]>([]);
    const [focusedTransitLegIndex, setFocusedTransitLegIndex] = useState<number | undefined>();
    const [expandedTransitStopKeys, setExpandedTransitStopKeys] = useState<Record<string, boolean>>({});
    const selectedAlternativeIdRef = useRef<string | undefined>(undefined);
    const [carTrafficRefreshTick, setCarTrafficRefreshTick] = useState(0);
    const initializedOriginRef = useRef(false);
    const prevHasRouteReadyRef = useRef(false);
    const lastCameraActionKeyRef = useRef("");
    const lastAppliedInitialKeyRef = useRef("");
    const transitConnectorCacheRef = useRef<Map<string, RoutePathCoord[]>>(new Map());

    const mapRef = useRef<TmapMapViewHandle | null>(null);
    const bottomSheetTranslateY = useRef(new Animated.Value(420)).current;
    const bottomSheetStartYRef = useRef(0);

    const isTransitMode = travelMode === "TRANSIT";
    const hasOriginCoords = typeof originLat === "number" && typeof originLng === "number";
    const hasDestinationCoords = typeof destinationLat === "number" && typeof destinationLng === "number";
    const hasRouteReady = hasOriginCoords && hasDestinationCoords;
    const isTransitDetailMode = isTransitMode && hasRouteReady && !isRouteSelectionScreen;
    const detailPanelBg = isTransitDetailMode ? (isDark ? "#1F1F1F" : "#F8FAFC") : overlayPanelBg;
    const detailCardBg = isTransitDetailMode ? (isDark ? "#1F1F1F" : "#F8FAFC") : overlayCardBg;
    const detailPrimaryText = isTransitDetailMode ? (isDark ? "#F3F4F6" : "#111827") : colors.textPrimary;
    const detailSecondaryText = isTransitDetailMode ? (isDark ? "#B8B8B8" : "#64748B") : colors.textSecondary;
    const detailBorderColor = isTransitDetailMode ? (isDark ? "#343434" : "#E2E8F0") : colors.border;
    const transitRouteChipBg = isDark ? "rgba(18,18,18,0.94)" : "rgba(248,250,252,0.96)";
    const transitRouteChipText = isDark ? "#D7D7DA" : "#334155";
    const transitMapOverlayColor = isDark ? "rgba(0,0,0,0.34)" : "rgba(248,250,252,0.02)";
    const transitActionBarBg = isDark ? "#171717" : "#F8FAFC";
    const transitFocusedLegBg = isDark ? "rgba(47,128,255,0.16)" : "#DBEAFE";
    const transitDetailPrimaryActionBg = isDark ? "#F3F4F6" : "#111827";
    const transitDetailPrimaryActionText = isDark ? "#111827" : "#FFFFFF";
    const transitDetailControlText = isDark ? "#F3F4F6" : "#111827";
    const isRoutePointLocked = hasRouteReady && !isRoutePointEditMode;
    const isRouteSelectionStage = isRouteSelectionScreen;
    const hasActiveTarget = activeTarget === "origin" || activeTarget === "destination";
    const originDisplay = originName.trim() || originAddress.trim() || "출발지 미선택";
    const destinationDisplay = destinationName.trim() || destinationAddress.trim() || "도착지 미선택";
    const bottomSheetPeekHeight = BOTTOM_SHEET_HANDLE_PEEK_HEIGHT;
    const bottomSheetCollapsedVisibleHeight = useMemo(() => {
        if (bottomPanelHeight <= 0) return bottomSheetPeekHeight;
        if (isTransitDetailMode) {
            return Math.min(
                bottomPanelHeight,
                Math.max(bottomSheetPeekHeight, TRANSIT_DETAIL_COLLAPSED_VISIBLE_BASE_HEIGHT + insets.bottom)
            );
        }
        return Math.max(bottomSheetPeekHeight, Math.round(bottomPanelHeight * BOTTOM_SHEET_COLLAPSED_VISIBLE_RATIO));
    }, [bottomPanelHeight, bottomSheetPeekHeight, insets.bottom, isTransitDetailMode]);
    const bottomSheetCollapsedOffset = useMemo(
        () => Math.max(0, bottomPanelHeight - bottomSheetCollapsedVisibleHeight),
        [bottomPanelHeight, bottomSheetCollapsedVisibleHeight]
    );
    const bottomSheetMiddleOffset = useMemo(() => {
        if (!isTransitDetailMode) return Math.round(bottomSheetCollapsedOffset * 0.52);
        if (bottomPanelHeight <= 0) return Math.round(bottomSheetCollapsedOffset * 0.45);
        return Math.min(bottomSheetCollapsedOffset, Math.max(0, Math.round(bottomPanelHeight * 0.34)));
    }, [bottomPanelHeight, bottomSheetCollapsedOffset, isTransitDetailMode]);
    const bottomSheetExpandedOffset = useMemo(() => {
        if (!isTransitDetailMode) return 0;
        const routeHeaderBottom = Math.max(insets.top + 92, 118);
        const naturalPanelTop = windowHeight - bottomPanelHeight;
        const safeExpandedOffset = Math.max(54, Math.ceil(routeHeaderBottom - naturalPanelTop));
        return Math.min(bottomSheetCollapsedOffset, Math.max(0, safeExpandedOffset));
    }, [bottomPanelHeight, bottomSheetCollapsedOffset, insets.top, isTransitDetailMode, windowHeight]);
    const bottomSheetHiddenOffset = useMemo(() => {
        if (!hasBottomSheetMeasured) return 420;
        return Math.max(320, bottomPanelHeight + insets.bottom + 32);
    }, [bottomPanelHeight, hasBottomSheetMeasured, insets.bottom]);
    const bottomSheetDragMaxOffset = bottomSheetCollapsedOffset;

    const transitFilterCounts = useMemo(() => {
        const counts = { ALL: routeAlternatives.length, BUS: 0, SUBWAY: 0, MIXED: 0 } as Record<TransitRouteFilter, number>;
        routeAlternatives.forEach((option) => {
            const category = getTransitRouteCategory(option);
            if (category !== "ALL") counts[category] += 1;
        });
        return counts;
    }, [routeAlternatives]);
    const visibleTransitFilterItems = useMemo(
        () => TRANSIT_FILTER_ITEMS.filter((item) => item.key === "ALL" || transitFilterCounts[item.key] > 0),
        [transitFilterCounts]
    );
    const shouldShowZoomControls = !hasRouteReady || isBottomSheetHidden;
    const initialSyncKey = useMemo(() => JSON.stringify({
        sessionId,
        origin: initial?.origin ?? null,
        destination: initial?.destination ?? null,
        travelMode: initial?.travelMode ?? "CAR",
        focusTarget: forcedFocusTarget ?? null,
        focusZoom: forcedFocusZoom ?? null,
        sheetState: forcedSheetState ?? null,
        routeIndex: typeof forcedRouteIndex === "number" ? forcedRouteIndex : null,
    }), [sessionId, initial, forcedFocusTarget, forcedFocusZoom, forcedSheetState, forcedRouteIndex]);
    const visibleAlternatives = useMemo(() => {
        if (!isTransitMode || transitRouteFilter === "ALL") return routeAlternatives;
        return routeAlternatives.filter((option) => getTransitRouteCategory(option) === transitRouteFilter);
    }, [isTransitMode, routeAlternatives, transitRouteFilter]);
    const selectedAlternativeIndex = useMemo(
        () => routeAlternatives.findIndex((item) => item.id === selectedAlternativeId),
        [routeAlternatives, selectedAlternativeId]
    );
    const selectedVisibleAlternativeIndex = useMemo(
        () => visibleAlternatives.findIndex((item) => item.id === selectedAlternativeId),
        [selectedAlternativeId, visibleAlternatives]
    );
    const selectedAlternative = selectedAlternativeIndex >= 0 ? routeAlternatives[selectedAlternativeIndex] : undefined;
    const transitLegendKinds = useMemo(() => {
        if (!isTransitMode || !Array.isArray(selectedAlternative?.transitLegs)) return [];
        const orderedKinds: TransitLegDetail["kind"][] = ["SUBWAY", "BUS", "WALK", "ETC"];
        const used = new Set<TransitLegDetail["kind"]>(selectedAlternative.transitLegs.map((leg) => leg.kind));
        return orderedKinds.filter((kind) => used.has(kind));
    }, [isTransitMode, selectedAlternative]);
    const shouldShowTransitLegend = transitLegendKinds.length > 0 && mapZoom >= TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
    const shouldShowTransitLegendHint =
        isTransitMode &&
        hasRouteReady &&
        transitLegendKinds.length > 0 &&
        mapZoom < TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
    const selectedAlternativeMetricTags = useMemo(
        () => (selectedAlternative ? getAlternativeMetricTags(selectedAlternative) : []),
        [selectedAlternative]
    );
    const selectedAlternativeTransitModeLabels = useMemo(
        () => getTransitModeLabels(selectedAlternative?.transitLegs),
        [selectedAlternative]
    );
    const selectedAlternativeStepPreview = useMemo(
        () => buildTransitLegPreview(selectedAlternative?.transitLegs) ?? selectedAlternative?.stepSummary,
        [selectedAlternative]
    );
    const [selectedRouteDepartureAt, setSelectedRouteDepartureAt] = useState(() => new Date());
    const selectedTransitTimeRange = useMemo(
        () => selectedAlternative ? formatTransitRouteTimeRange(selectedAlternative, selectedRouteDepartureAt) : "",
        [selectedAlternative, selectedRouteDepartureAt]
    );
    const selectedTransitProgressSegments = useMemo(
        () => buildTransitProgressSegments(selectedAlternative?.transitLegs),
        [selectedAlternative]
    );

    useEffect(() => {
        setSelectedRouteDepartureAt(new Date());
    }, [selectedAlternativeId]);

    useEffect(() => {
        setExpandedTransitStopKeys({});
    }, [selectedAlternativeId]);

    const toggleTransitStopList = useCallback((key: string) => {
        setExpandedTransitStopKeys((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    }, []);

    useEffect(() => {
        if (typeof focusedTransitLegIndex !== "number") return;
        if (!Array.isArray(selectedAlternative?.transitLegs)) {
            setFocusedTransitLegIndex(undefined);
            return;
        }
        if (focusedTransitLegIndex < 0 || focusedTransitLegIndex >= selectedAlternative.transitLegs.length) {
            setFocusedTransitLegIndex(undefined);
        }
    }, [focusedTransitLegIndex, selectedAlternative]);

    const animateBottomSheetTo = useCallback((toValue: number) => {
        Animated.spring(bottomSheetTranslateY, {
            toValue,
            useNativeDriver: true,
            damping: 30,
            stiffness: 250,
            mass: 1,
            overshootClamping: true,
            restDisplacementThreshold: 0.6,
            restSpeedThreshold: 0.8,
        }).start();
    }, [bottomSheetTranslateY]);

    const getBottomSheetSnapTarget = useCallback((snap: BottomSheetSnap) => {
        if (snap === "hidden") return bottomSheetHiddenOffset;
        if (snap === "expanded") return bottomSheetExpandedOffset;
        if (snap === "middle") return isTransitDetailMode ? bottomSheetMiddleOffset : bottomSheetCollapsedOffset;
        return bottomSheetCollapsedOffset;
    }, [bottomSheetCollapsedOffset, bottomSheetExpandedOffset, bottomSheetHiddenOffset, bottomSheetMiddleOffset, isTransitDetailMode]);

    const snapBottomSheetTo = useCallback((snap: BottomSheetSnap) => {
        const target = getBottomSheetSnapTarget(snap);
        if (snap === "hidden") {
            setBottomSheetSnap("hidden");
            setIsBottomSheetCollapsed(true);
            animateBottomSheetTo(target);
            setIsBottomSheetHidden(true);
            return;
        }
        if (isBottomSheetHidden) {
            setIsBottomSheetHidden(false);
        }
        setBottomSheetSnap(snap);
        setIsBottomSheetCollapsed(snap !== "expanded");
        animateBottomSheetTo(target);
    }, [animateBottomSheetTo, getBottomSheetSnapTarget, isBottomSheetHidden]);

    const getSnapFromGesture = useCallback((current: number, velocityY: number): BottomSheetSnap => {
        if (bottomSheetCollapsedOffset <= 0) return "collapsed";
        if (!isTransitDetailMode) {
            const midpoint = bottomSheetCollapsedOffset * 0.52;
            const projected = current + (velocityY * 26);

            if (velocityY <= -0.45) return "expanded";
            if (velocityY >= 0.65) return "collapsed";
            return projected >= midpoint ? "collapsed" : "expanded";
        }

        if (velocityY <= -0.65) {
            return current > bottomSheetMiddleOffset ? "middle" : "expanded";
        }
        if (velocityY >= 0.65) {
            return current < bottomSheetMiddleOffset ? "middle" : "collapsed";
        }

        const projected = Math.min(
            Math.max(0, current + (velocityY * 26)),
            bottomSheetDragMaxOffset
        );
        const snapPoints: Array<{ snap: BottomSheetSnap; value: number }> = [
            { snap: "expanded", value: bottomSheetExpandedOffset },
            { snap: "middle", value: bottomSheetMiddleOffset },
            { snap: "collapsed", value: bottomSheetCollapsedOffset },
        ];
        return snapPoints.reduce((nearest, candidate) => (
            Math.abs(candidate.value - projected) < Math.abs(nearest.value - projected)
                ? candidate
                : nearest
        )).snap;
    }, [
        bottomSheetCollapsedOffset,
        bottomSheetDragMaxOffset,
        bottomSheetExpandedOffset,
        bottomSheetMiddleOffset,
        isTransitDetailMode,
    ]);

    const bottomHandlePanResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => !isBottomSheetHidden && bottomSheetCollapsedOffset > 0,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
            !isBottomSheetHidden && bottomSheetCollapsedOffset > 0 && Math.abs(gestureState.dy) > 3,
        onPanResponderGrant: () => {
            bottomSheetTranslateY.stopAnimation((value) => {
                bottomSheetStartYRef.current = value;
            });
        },
        onPanResponderMove: (_event, gestureState) => {
            const next = Math.min(
                Math.max(0, bottomSheetStartYRef.current + gestureState.dy),
                bottomSheetDragMaxOffset
            );
            bottomSheetTranslateY.setValue(next);
        },
        onPanResponderRelease: (_event, gestureState) => {
            bottomSheetTranslateY.stopAnimation((current) => {
                snapBottomSheetTo(getSnapFromGesture(current, gestureState.vy));
            });
        },
        onPanResponderTerminate: (_event, gestureState) => {
            bottomSheetTranslateY.stopAnimation((current) => {
                snapBottomSheetTo(getSnapFromGesture(current, gestureState.vy));
            });
        },
    }), [
        bottomSheetCollapsedOffset,
        bottomSheetDragMaxOffset,
        bottomSheetTranslateY,
        getSnapFromGesture,
        isBottomSheetHidden,
        snapBottomSheetTo,
    ]);

    const selectAlternativeByIndex = useCallback((index: number, _scrollToCard = false) => {
        if (!visibleAlternatives.length) return;
        const bounded = Math.min(Math.max(index, 0), visibleAlternatives.length - 1);
        const target = visibleAlternatives[bounded];
        if (!target) return;

        setSelectedAlternativeId(target.id);
        selectedAlternativeIdRef.current = target.id;
        setFocusedTransitLegIndex(undefined);
    }, [visibleAlternatives]);

    useEffect(() => {
        if (travelMode !== "TRANSIT" && transitRouteFilter !== "ALL") {
            setTransitRouteFilter("ALL");
        }
    }, [travelMode, transitRouteFilter]);

    useEffect(() => {
        if (!isTransitMode || transitRouteFilter === "ALL") return;
        if (transitFilterCounts[transitRouteFilter] > 0) return;
        setTransitRouteFilter("ALL");
    }, [isTransitMode, transitRouteFilter, transitFilterCounts]);

    useEffect(() => {
        if (!initialSyncKey || lastAppliedInitialKeyRef.current === initialSyncKey) return;
        lastAppliedInitialKeyRef.current = initialSyncKey;

        setOriginName(initial?.origin?.name ?? "");
        setDestinationName(initial?.destination?.name ?? "");
        setOriginAddress(initial?.origin?.address ?? "");
        setDestinationAddress(initial?.destination?.address ?? "");
        setOriginLat(initial?.origin?.lat);
        setOriginLng(initial?.origin?.lng);
        setDestinationLat(initial?.destination?.lat);
        setDestinationLng(initial?.destination?.lng);
        setTravelMode(initial?.travelMode ?? "CAR");
        setTransitRouteFilter("ALL");
        setSelectedAlternativeId(undefined);
        selectedAlternativeIdRef.current = undefined;
        setFocusedTransitLegIndex(undefined);
        lastCameraActionKeyRef.current = "";
        const hasInitialOrigin = typeof initial?.origin?.lat === "number" && typeof initial?.origin?.lng === "number";
        const hasInitialDestination = typeof initial?.destination?.lat === "number" && typeof initial?.destination?.lng === "number";
        if (forcedFocusTarget === "origin" && hasInitialOrigin) {
            setActiveTarget("origin");
        } else if (forcedFocusTarget === "destination" && hasInitialDestination) {
            setActiveTarget("destination");
        } else if (hasInitialOrigin && hasInitialDestination) {
            setActiveTarget(null);
        } else {
            setActiveTarget(hasInitialOrigin ? "destination" : "origin");
        }
        setIsRoutePointEditMode(!(hasInitialOrigin && hasInitialDestination));
        if (forcedSheetState === "hidden") {
            setIsBottomSheetHidden(true);
            setBottomSheetSnap("hidden");
            setIsBottomSheetCollapsed(true);
        } else if (forcedSheetState === "collapsed") {
            setIsBottomSheetHidden(false);
            setBottomSheetSnap("collapsed");
            setIsBottomSheetCollapsed(true);
        } else if (forcedSheetState === "expanded") {
            setIsBottomSheetHidden(false);
            setBottomSheetSnap("expanded");
            setIsBottomSheetCollapsed(false);
        }
    }, [initial, initialSyncKey, forcedFocusTarget, forcedSheetState]);

    useEffect(() => {
        if (!visibleAlternatives.length) return;
        if (typeof forcedRouteIndex === "number") {
            const boundedIndex = Math.min(Math.max(forcedRouteIndex, 0), visibleAlternatives.length - 1);
            const forced = visibleAlternatives[boundedIndex];
            if (forced && forced.id !== selectedAlternativeId) {
                setSelectedAlternativeId(forced.id);
                selectedAlternativeIdRef.current = forced.id;
                setFocusedTransitLegIndex(undefined);
            }
            return;
        }
        const hasSelectedVisible = visibleAlternatives.some((item) => item.id === selectedAlternativeId);
        if (hasSelectedVisible) return;
        const fallback = visibleAlternatives[0];
        setSelectedAlternativeId(fallback.id);
        selectedAlternativeIdRef.current = fallback.id;
        setFocusedTransitLegIndex(undefined);
    }, [visibleAlternatives, selectedAlternativeId, forcedRouteIndex]);

    useEffect(() => {
        if (!hasRouteReady && !isRoutePointEditMode) {
            setIsRoutePointEditMode(true);
        }
    }, [hasRouteReady, isRoutePointEditMode]);

    useEffect(() => {
        // 경로 편집으로 돌아가거나 좌표가 사라지면 상세 단계는 자동 해제한다.
        if (!hasRouteReady || isRoutePointEditMode) {
            setBottomSheetSnap("collapsed");
            setIsBottomSheetCollapsed(true);
        }
    }, [hasRouteReady, isRoutePointEditMode]);

    useEffect(() => {
        if (!hasBottomSheetMeasured) return;
        if (isBottomSheetHidden) {
            bottomSheetTranslateY.stopAnimation();
            bottomSheetTranslateY.setValue(bottomSheetHiddenOffset);
            return;
        }

        const target = getBottomSheetSnapTarget(bottomSheetSnap);
        bottomSheetTranslateY.stopAnimation(() => {
            animateBottomSheetTo(target);
        });
    }, [
        hasBottomSheetMeasured,
        isBottomSheetHidden,
        bottomSheetSnap,
        bottomSheetCollapsedOffset,
        bottomSheetHiddenOffset,
        bottomSheetTranslateY,
        animateBottomSheetTo,
        getBottomSheetSnapTarget,
    ]);

    useEffect(() => {
        if (!isMapInitialized || !hasBottomSheetMeasured) return;
        if (forcedSheetState) return;
        const prevHasRouteReady = prevHasRouteReadyRef.current;
        prevHasRouteReadyRef.current = hasRouteReady;

        // 출발/도착 미선택 상태에서는 핸들만 보이도록 접힘 유지
        if (!hasRouteReady) {
            if (isBottomSheetHidden) {
                setIsBottomSheetHidden(false);
            }
            setBottomSheetSnap("collapsed");
            setIsBottomSheetCollapsed(true);
            return;
        }

        // 경로가 처음 준비되는 순간에는 펼쳐서 안내하고,
        // 이후에는 사용자가 숨긴 상태까지 유지한다.
        if (!prevHasRouteReady) {
            if (isBottomSheetHidden) {
                setIsBottomSheetHidden(false);
            }
            const nextSnap: BottomSheetSnap = isTransitDetailMode ? "middle" : "expanded";
            setBottomSheetSnap(nextSnap);
            setIsBottomSheetCollapsed(nextSnap !== "expanded");
        }
    }, [forcedSheetState, isMapInitialized, hasBottomSheetMeasured, isBottomSheetHidden, hasRouteReady, isTransitDetailMode]);

    // 경로 대안 계산
    useEffect(() => {
        if (!hasRouteReady) {
            setRouteAlternatives([]);
            setSelectedAlternativeId(undefined);
            selectedAlternativeIdRef.current = undefined;
            setFocusedTransitLegIndex(undefined);
            setAlternativesError(undefined);
            setEtaMinutes(undefined);
            setEtaDistanceMeters(undefined);
            setEtaSource(undefined);
            setEtaFallbackKind(undefined);
            setRoutePathCoords(undefined);
            return;
        }

        let active = true;
        const timer = setTimeout(async () => {
            try {
                setEtaLoading(true);
                setAlternativesError(undefined);

                const nextAlternatives = await getRouteAlternativeOptions(
                    { name: originName, address: originAddress, lat: originLat, lng: originLng },
                    { name: destinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng },
                    travelMode
                );
                if (!active) return;

                const sortedAlternatives = [...nextAlternatives].sort((a, b) => {
                    const aMinutes = typeof a.minutes === "number" ? a.minutes : Number.POSITIVE_INFINITY;
                    const bMinutes = typeof b.minutes === "number" ? b.minutes : Number.POSITIVE_INFINITY;
                    return aMinutes - bMinutes;
                });

                setRouteAlternatives(sortedAlternatives);

                if (!sortedAlternatives.length) {
                    setSelectedAlternativeId(undefined);
                    selectedAlternativeIdRef.current = undefined;
                    setFocusedTransitLegIndex(undefined);
                    setAlternativesError("표시할 경로가 없습니다.");
                    return;
                }

                const selected = sortedAlternatives.find((item) => item.id === selectedAlternativeIdRef.current) ?? sortedAlternatives[0];
                setSelectedAlternativeId(selected.id);
                selectedAlternativeIdRef.current = selected.id;
            } catch (error) {
                if (!active) return;
                const message = error instanceof Error ? error.message : "경로 계산에 실패했습니다.";
                setRouteAlternatives([]);
                setSelectedAlternativeId(undefined);
                selectedAlternativeIdRef.current = undefined;
                setFocusedTransitLegIndex(undefined);
                setAlternativesError(message);
                setRoutePathCoords(undefined);
            } finally {
                if (active) setEtaLoading(false);
            }
        }, 220);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [
        hasRouteReady,
        travelMode,
        carTrafficRefreshTick,
        originName,
        originAddress,
        originLat,
        originLng,
        destinationName,
        destinationAddress,
        destinationLat,
        destinationLng,
    ]);

    // 선택된 경로 옵션에서 "지도 전체 polyline"의 기준이 될 경로를 정리한다.
    // 대중교통은 option.pathCoords가 비어 있을 수 있어 leg path들을 다시 합쳐 fallback으로 쓴다.
    useEffect(() => {
        if (!selectedAlternative) {
            setEtaMinutes(undefined);
            setEtaDistanceMeters(undefined);
            setEtaSource(undefined);
            setEtaFallbackKind(undefined);
            setRoutePathCoords(undefined);
            return;
        }

        setEtaMinutes(selectedAlternative.minutes);
        setEtaDistanceMeters(selectedAlternative.distanceMeters);
        setEtaSource(selectedAlternative.source);
        setEtaFallbackKind(selectedAlternative.fallbackKind);
        const mergedTransitLegPath = Array.isArray(selectedAlternative.transitLegs)
            ? selectedAlternative.transitLegs
                .flatMap((leg) => (Array.isArray(leg.pathCoords) ? leg.pathCoords : []))
                .filter((point): point is RoutePathCoord => (
                    typeof point?.lat === "number" &&
                    typeof point?.lng === "number"
                ))
            : [];
        const routePath = Array.isArray(selectedAlternative.pathCoords) && selectedAlternative.pathCoords.length >= 2
            ? selectedAlternative.pathCoords
            : (mergedTransitLegPath.length >= 2 ? mergedTransitLegPath : undefined);
        setRoutePathCoords(routePath);
    }, [selectedAlternative]);

    // 대중교통의 도보 연결선은 "출발/도착 ↔ 승하차점", "환승 ↔ 다음 승차점"을 따로 계산한다.
    // 이 useEffect는 보행자 전용 API로 connector/walk detail path를 구해 지도 오버레이용 state로 저장한다.
    useEffect(() => {
        if (
            travelMode !== "TRANSIT" ||
            !hasRouteReady ||
            !selectedAlternative ||
            !Array.isArray(selectedAlternative.transitLegs) ||
            selectedAlternative.transitLegs.length === 0 ||
            typeof originLat !== "number" ||
            typeof originLng !== "number" ||
            typeof destinationLat !== "number" ||
            typeof destinationLng !== "number"
        ) {
            transitConnectorCacheRef.current.clear();
            setTransitConnectorOverlays([]);
            setTransitWalkDetailOverlays([]);
            return;
        }

        const transitLegs = selectedAlternative.transitLegs;
        const legSegments = transitLegs
            .map((leg) => (
                Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
                    ? leg.pathCoords
                    : null
            ))
            .filter((coords): coords is RoutePathCoord[] => Array.isArray(coords));

        if (!legSegments.length) {
            transitConnectorCacheRef.current.clear();
            setTransitConnectorOverlays([]);
            setTransitWalkDetailOverlays([]);
            return;
        }

        const firstPointFromPath = legSegments[0][0];
        const lastSegment = legSegments[legSegments.length - 1];
        const lastPointFromPath = lastSegment[lastSegment.length - 1];
        if (!firstPointFromPath || !lastPointFromPath) {
            transitConnectorCacheRef.current.clear();
            setTransitConnectorOverlays([]);
            setTransitWalkDetailOverlays([]);
            return;
        }

        transitConnectorCacheRef.current.clear();

        const firstRideLegIndex = transitLegs.findIndex((leg) => isRideLegKind(leg.kind));
        const lastRideLegIndex = (() => {
            for (let index = transitLegs.length - 1; index >= 0; index -= 1) {
                if (isRideLegKind(transitLegs[index].kind)) return index;
            }
            return -1;
        })();
        const firstLegForBoundary = transitLegs[firstRideLegIndex >= 0 ? firstRideLegIndex : 0];
        const lastLegForBoundary = transitLegs[lastRideLegIndex >= 0 ? lastRideLegIndex : (transitLegs.length - 1)];
        const firstAnchorPoint = (firstRideLegIndex >= 0
                ? getRideStopConnectorCoord(transitLegs, firstRideLegIndex, "BOARD")
                : undefined)
            ?? getRideStopConnectorCoord(transitLegs, firstRideLegIndex >= 0 ? firstRideLegIndex : 0, "BOARD")
            ?? getTransitLegBoardCoord(firstLegForBoundary)
            ?? getTransitLegBoardAnchorOnPath(firstLegForBoundary)
            ?? getTransitLegStartCoord(firstLegForBoundary)
            ?? firstPointFromPath;
        const lastAnchorPoint = (lastRideLegIndex >= 0
                ? getRideStopConnectorCoord(transitLegs, lastRideLegIndex, "ALIGHT")
                : undefined)
            ?? getRideStopConnectorCoord(
                transitLegs,
                lastRideLegIndex >= 0 ? lastRideLegIndex : (transitLegs.length - 1),
                "ALIGHT"
            )
            ?? getTransitLegAlightCoord(lastLegForBoundary)
            ?? getTransitLegAlightAnchorOnPath(lastLegForBoundary)
            ?? getTransitLegEndCoord(lastLegForBoundary)
            ?? lastPointFromPath;

        const originPoint: RoutePathCoord = { lat: originLat, lng: originLng };
        const destinationPoint: RoutePathCoord = { lat: destinationLat, lng: destinationLng };
        const connectorMinMeters = 22;
        const connectorSnapMeters = 7;
        const connectorMinSegmentMeters = 5;

        const distanceMeters = (from: RoutePathCoord, to: RoutePathCoord) =>
            haversineDistanceKm(
                { latitude: from.lat, longitude: from.lng },
                { latitude: to.lat, longitude: to.lng }
            ) * 1000;
        type ConnectorPathRequest = {
            id: string;
            from: RoutePathCoord;
            to: RoutePathCoord;
            snapFrom: boolean;
            snapTo: boolean;
        };
        const connectorRequests: ConnectorPathRequest[] = [];
        const connectorKeys = new Set<string>();
        const pushConnectorRequest = (
            id: string,
            from: RoutePathCoord | undefined,
            to: RoutePathCoord | undefined,
            snapFrom: boolean,
            snapTo: boolean
        ) => {
            if (!from || !to) return;
            const gapMeters = distanceMeters(from, to);
            if (!Number.isFinite(gapMeters) || gapMeters < connectorMinMeters) return;
            const directKey = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
            const reverseKey = `${to.lat.toFixed(5)},${to.lng.toFixed(5)}>${from.lat.toFixed(5)},${from.lng.toFixed(5)}`;
            if (connectorKeys.has(directKey) || connectorKeys.has(reverseKey)) return;
            connectorKeys.add(directKey);
            connectorRequests.push({ id, from, to, snapFrom, snapTo });
        };

        // WALK 레그가 steps[].linestring으로 정밀 경로를 가진 경우 → walkLegRequests에서 직접 처리하므로
        // 해당 구간에 대한 connector 재조회를 건너뜀 (중복 dot 방지 및 도로 중앙선 라우팅 회피)
        const walkLegHasPrecisePath = (leg: TransitLegDetail | undefined): boolean =>
            leg?.kind === "WALK" &&
            !!leg.pathCoordsIsExact &&
            Array.isArray(leg.pathCoords) &&
            (leg.pathCoords.length ?? 0) >= 3;

        const firstWalkLeg = transitLegs[0]?.kind === "WALK" ? transitLegs[0] : undefined;
        const lastWalkLeg = transitLegs[transitLegs.length - 1]?.kind === "WALK"
            ? transitLegs[transitLegs.length - 1]
            : undefined;

        // 출발/도착은 고정하고, 승/하차측 끝점은 보행 API가 반환한 실제 보행 가능점(보도측)을 우선한다.
        // 첫/마지막 WALK 레그에 정밀 경로가 있으면 해당 connector는 walkLegRequests가 담당
        if (!walkLegHasPrecisePath(firstWalkLeg)) {
            pushConnectorRequest(`${selectedAlternative.id}-walk-boundary-start`, originPoint, firstAnchorPoint, true, false);
        }
        if (!walkLegHasPrecisePath(lastWalkLeg)) {
            pushConnectorRequest(`${selectedAlternative.id}-walk-boundary-end`, lastAnchorPoint, destinationPoint, false, true);
        }

        for (let legIndex = 0; legIndex < transitLegs.length - 1; legIndex += 1) {
            const currentLeg = transitLegs[legIndex];
            const nextLeg = transitLegs[legIndex + 1];
            // 현재/다음 레그 중 하나가 WALK이고 정밀 경로를 가진다면 walkLegRequests가 처리
            if (walkLegHasPrecisePath(currentLeg) || walkLegHasPrecisePath(nextLeg)) continue;
            const currentAnchor = getRideStopConnectorCoord(transitLegs, legIndex, "ALIGHT")
                ?? getTransitLegAlightCoord(currentLeg)
                ?? getTransitLegAlightAnchorOnPath(currentLeg)
                ?? getTransitLegEndCoord(currentLeg);
            const nextAnchor = getRideStopConnectorCoord(transitLegs, legIndex + 1, "BOARD")
                ?? getTransitLegBoardCoord(nextLeg)
                ?? getTransitLegBoardAnchorOnPath(nextLeg)
                ?? getTransitLegStartCoord(nextLeg);
            pushConnectorRequest(`${selectedAlternative.id}-walk-gap-${legIndex}`, currentAnchor, nextAnchor, false, false);
        }

        if (!connectorRequests.length) {
            setTransitConnectorOverlays([]);
        }

        const walkLegRequests = transitLegs
            .map((leg, legIndex) => {
                if (leg.kind !== "WALK") return null;
                let prevRideIndex = -1;
                for (let index = legIndex - 1; index >= 0; index -= 1) {
                    if (isRideLegKind(transitLegs[index].kind)) {
                        prevRideIndex = index;
                        break;
                    }
                }
                let nextRideIndex = -1;
                for (let index = legIndex + 1; index < transitLegs.length; index += 1) {
                    if (isRideLegKind(transitLegs[index].kind)) {
                        nextRideIndex = index;
                        break;
                    }
                }
                const from = (prevRideIndex >= 0
                        ? getRideStopConnectorCoord(transitLegs, prevRideIndex, "ALIGHT")
                        : undefined)
                    ?? (prevRideIndex >= 0 ? getTransitLegAlightCoord(transitLegs[prevRideIndex]) : undefined)
                    ?? getTransitLegBoardCoord(leg)
                    ?? getTransitLegBoardAnchorOnPath(leg)
                    ?? getTransitLegStartCoord(leg);
                const to = (nextRideIndex >= 0
                        ? getRideStopConnectorCoord(transitLegs, nextRideIndex, "BOARD")
                        : undefined)
                    ?? (nextRideIndex >= 0 ? getTransitLegBoardCoord(transitLegs[nextRideIndex]) : undefined)
                    ?? getTransitLegAlightCoord(leg)
                    ?? getTransitLegAlightAnchorOnPath(leg)
                    ?? getTransitLegEndCoord(leg);
                if (!from || !to) return null;
                const walkGapMeters = distanceMeters(from, to);
                if (!Number.isFinite(walkGapMeters) || walkGapMeters < 35) return null;
                return {
                    id: `${selectedAlternative.id}-walk-leg-${legIndex}`,
                    from,
                    to,
                    snapFrom: prevRideIndex < 0,
                    snapTo: nextRideIndex < 0,
                };
            })
            .filter((value): value is ConnectorPathRequest => value !== null);

        if (!connectorRequests.length && !walkLegRequests.length) {
            setTransitWalkDetailOverlays([]);
            return;
        }

        const normalizeConnectorPath = (
            rawPath: RoutePathCoord[],
            from: RoutePathCoord,
            to: RoutePathCoord,
            snapFrom: boolean,
            snapTo: boolean
        ): RoutePathCoord[] | undefined => {
            if (!Array.isArray(rawPath) || rawPath.length < 2) return undefined;

            const filtered: RoutePathCoord[] = [rawPath[0]];
            for (let index = 1; index < rawPath.length; index += 1) {
                const prev = filtered[filtered.length - 1];
                const current = rawPath[index];
                if (distanceMeters(prev, current) < connectorMinSegmentMeters) continue;
                filtered.push(current);
            }
            if (filtered.length < 2) return undefined;

            const normalized = [...filtered];
            if (snapFrom) {
                if (distanceMeters(from, normalized[0]) > connectorSnapMeters) {
                    normalized.unshift(from);
                } else {
                    normalized[0] = from;
                }
            }
            if (snapTo) {
                if (distanceMeters(normalized[normalized.length - 1], to) > connectorSnapMeters) {
                    normalized.push(to);
                } else {
                    normalized[normalized.length - 1] = to;
                }
            }

            return normalized.length >= 2 ? normalized : undefined;
        };

        let cancelled = false;
        const fetchConnectorPath = async (
            from: RoutePathCoord,
            to: RoutePathCoord,
            snapFrom: boolean,
            snapTo: boolean
        ): Promise<RoutePathCoord[] | undefined> => {
            const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}|${snapFrom ? 1 : 0}${snapTo ? 1 : 0}`;
            const cached = transitConnectorCacheRef.current.get(key);
            if (cached && cached.length >= 2) return cached;

            const alternatives = await getRouteAlternativeOptions(
                { name: "출발", lat: from.lat, lng: from.lng },
                { name: "도착", lat: to.lat, lng: to.lng },
                "WALK"
            );
            const hasRenderableWalkPath = (item: RouteAlternativeOption) =>
                Array.isArray(item.pathCoords) &&
                item.pathCoords.length >= 2 &&
                (item.pathCoords.length >= 3 || item.fallbackKind !== "straight");
            const byPrecision = (a: RouteAlternativeOption, b: RouteAlternativeOption) => {
                const aDistance = typeof a.distanceMeters === "number" ? a.distanceMeters : Number.POSITIVE_INFINITY;
                const bDistance = typeof b.distanceMeters === "number" ? b.distanceMeters : Number.POSITIVE_INFINITY;
                if (aDistance !== bDistance) return aDistance - bDistance;
                const aMinutes = typeof a.minutes === "number" ? a.minutes : Number.POSITIVE_INFINITY;
                const bMinutes = typeof b.minutes === "number" ? b.minutes : Number.POSITIVE_INFINITY;
                return aMinutes - bMinutes;
            };
            const walkCandidates = alternatives.filter((item) => hasRenderableWalkPath(item)).sort(byPrecision);
            const best = walkCandidates.find((item) => item.source === "api") ?? walkCandidates[0];

            if (!best?.pathCoords || !hasRenderableWalkPath(best)) {
                if (distanceMeters(from, to) <= 120) {
                    return [from, to];
                }
                return undefined;
            }
            const normalizedPath = normalizeConnectorPath(best.pathCoords, from, to, snapFrom, snapTo);
            if (!normalizedPath || normalizedPath.length < 2) return undefined;
            transitConnectorCacheRef.current.set(key, normalizedPath);
            return normalizedPath;
        };

        (async () => {
            const overlays: TmapPathOverlay[] = [];
            const walkDetailOverlays: TmapPathOverlay[] = [];

            for (const request of connectorRequests) {
                const rawConnectorPath = await fetchConnectorPath(
                    request.from,
                    request.to,
                    request.snapFrom,
                    request.snapTo
                );
                if (rawConnectorPath && !cancelled) {
                    // WALK→BUS/SUBWAY: 경로 끝이 버스/지하철 도로 위로 진입하는 구간 제거
                    // snapTo=false → 버스/지하철 승차지점(도로 중앙)이 목적지
                    let connectorPath: RoutePathCoord[] = rawConnectorPath;
                    if (!request.snapTo) {
                        // 승차 지점에 인접한 버스/지하철 레그 경로 좌표 취득 (도로 중앙선)
                        const adjacentRideLeg = transitLegs.find((leg) => {
                            if (!isRideLegKind(leg.kind)) return false;
                            const boardCoord = getTransitLegBoardCoord(leg);
                            return boardCoord && distanceMeters(boardCoord, request.to) < 40;
                        });
                        const ridePath = Array.isArray(adjacentRideLeg?.pathCoords)
                            ? (adjacentRideLeg!.pathCoords as RoutePathCoord[]).slice(0, 25)
                            : [];
                        connectorPath = trimWalkApproachTail(rawConnectorPath, request.to, ridePath) ?? rawConnectorPath;
                    }
                    const displayCoords = toDisplayOverlayCoords(connectorPath, "WALK");
                    if (displayCoords.length < 2) continue;
                    overlays.push({
                        id: `${request.id}-path`,
                        coords: displayCoords,
                        color: "rgba(0,0,0,0)",
                        width: 0.5,
                        outlineColor: "rgba(0,0,0,0)",
                        outlineWidth: 0,
                    });
                }
            }

            for (const request of walkLegRequests) {
                if (cancelled) break;
                // 대중교통 API steps linestring은 도로 인도를 따라가는 경우가 많아
                // 보행자 전용 API(fetchConnectorPath)를 사용해 이면도로 우선 경로를 구한다
                const rawWalkPath = await fetchConnectorPath(
                    request.from,
                    request.to,
                    request.snapFrom,
                    request.snapTo
                );
                // WALK→BUS/SUBWAY: 경로 끝이 버스/지하철 도로 위로 진입하는 구간 제거
                // request.snapTo=false → 버스/지하철 승차지점(도로 중앙)이 목적지
                let walkPath = rawWalkPath;
                if (rawWalkPath && !request.snapTo) {
                    const legIdxMatch = request.id.match(/-walk-leg-(\d+)$/);
                    const legIdx = legIdxMatch ? parseInt(legIdxMatch[1], 10) : -1;
                    const adjacentRideLeg = transitLegs.find((leg, i) => {
                        if (!isRideLegKind(leg.kind)) return false;
                        if (legIdx >= 0 && i <= legIdx) return false;
                        const boardCoord = getTransitLegBoardCoord(leg);
                        return boardCoord && distanceMeters(boardCoord, request.to) < 40;
                    });
                    const ridePath = Array.isArray(adjacentRideLeg?.pathCoords)
                        ? (adjacentRideLeg!.pathCoords as RoutePathCoord[]).slice(0, 25)
                        : [];
                    walkPath = trimWalkApproachTail(rawWalkPath, request.to, ridePath) ?? rawWalkPath;
                }
                if (walkPath && !cancelled) {
                    const displayCoords = toDisplayOverlayCoords(walkPath, "WALK");
                    if (displayCoords.length < 2) continue;
                    walkDetailOverlays.push({
                        id: request.id,
                        coords: displayCoords,
                        color: "rgba(0,0,0,0)",
                        width: 1,
                        outlineColor: "rgba(0,0,0,0)",
                        outlineWidth: 0,
                    });
                    walkDetailOverlays.push({
                        id: `${request.id}-path`,
                        coords: displayCoords,
                        color: "rgba(0,0,0,0)",
                        width: 0.5,
                        outlineColor: "rgba(0,0,0,0)",
                        outlineWidth: 0,
                    });
                }
            }

            if (!cancelled) {
                setTransitConnectorOverlays(overlays);
                setTransitWalkDetailOverlays(walkDetailOverlays);
            }
        })().catch(() => {
            if (!cancelled) {
                setTransitConnectorOverlays([]);
                setTransitWalkDetailOverlays([]);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        travelMode,
        hasRouteReady,
        selectedAlternative,
        originLat,
        originLng,
        destinationLat,
        destinationLng,
    ]);

    const pathOverlayCoords = useMemo(() => {
        if (Array.isArray(routePathCoords) && routePathCoords.length >= 2) {
            return routePathCoords.map((point) => ({
                latitude: point.lat,
                longitude: point.lng,
            }));
        }
        if (travelMode === "TRANSIT") {
            return undefined;
        }
        if (
            typeof originLat === "number" &&
            typeof originLng === "number" &&
            typeof destinationLat === "number" &&
            typeof destinationLng === "number"
        ) {
            return [
                { latitude: originLat, longitude: originLng },
                { latitude: destinationLat, longitude: destinationLng },
            ];
        }
        return undefined;
    }, [routePathCoords, originLat, originLng, destinationLat, destinationLng, travelMode]);

    // 지도에 전달할 실제 polyline 목록.
    // inactive 대안 경로, 선택된 대중교통 ride/walk 세그먼트, fallback 메인 경로를 한곳에서 조합한다.
    const mapPathOverlays = useMemo((): TmapPathOverlay[] => {
        if (!hasRouteReady) return [];

        const allowStraightFallback = travelMode !== "TRANSIT";
        const fallbackPathCoords = (
            allowStraightFallback &&
            typeof originLat === "number" &&
            typeof originLng === "number" &&
            typeof destinationLat === "number" &&
            typeof destinationLng === "number"
        )
            ? [
                { latitude: originLat, longitude: originLng },
                { latitude: destinationLat, longitude: destinationLng },
            ]
            : [];

        const selectedRoute = routeAlternatives.find((option) => option.id === selectedAlternativeId);
        const shouldShowDetailedTransitSegments =
            travelMode === "TRANSIT" && mapZoom >= TRANSIT_SEGMENT_RENDER_MIN_ZOOM;
        const shouldEmphasizeMainTransitBaseLine = mapZoom < 15.3;
        const walkOverlayById = new Map(
            transitWalkDetailOverlays.map((overlay) => [overlay.id, overlay.coords])
        );
        const selectedTransitSegmentOverlays = (
            travelMode === "TRANSIT" &&
            shouldShowDetailedTransitSegments &&
            selectedRoute &&
            Array.isArray(selectedRoute.transitLegs)
        )
            ? selectedRoute.transitLegs
                .flatMap((leg, index) => {
                    const legCoords = getTransitLegMapCoords(
                        selectedRoute.id,
                        selectedRoute.transitLegs,
                        index,
                        walkOverlayById
                    );
                    if (legCoords.length < 2) return [];
                    const isWalkLeg = leg.kind === "WALK";

                    if (isWalkLeg) {
                        // 도보 구간은 별도 walk overlay로 정리해 표시한다.
                        return [];
                    }

                    return [{
                        id: `${selectedRoute.id}-segment-${index}`,
                        coords: legCoords,
                        color: getTransitLegVisualColor(leg),
                        width: ROUTE_STYLE.transitRideWidth,
                        outlineColor: isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.96)",
                        outlineWidth: ROUTE_STYLE.transitRideOutlineWidth,
                    } as TmapPathOverlay];
                })
            : [];
        const selectedTransitWalkFallbackOverlays = (
            travelMode === "TRANSIT" &&
            shouldShowDetailedTransitSegments &&
            selectedRoute &&
            Array.isArray(selectedRoute.transitLegs)
        )
            ? selectedRoute.transitLegs.flatMap((leg, index) => {
                if (leg.kind !== "WALK") return [];
                const walkOverlayId = `${selectedRoute.id}-walk-leg-${index}`;
                if (walkOverlayById.has(walkOverlayId) || walkOverlayById.has(`${walkOverlayId}-path`)) return [];
                const legCoords = getTransitLegMapCoords(
                    selectedRoute.id,
                    selectedRoute.transitLegs,
                    index,
                    walkOverlayById
                );
                if (legCoords.length < 2) return [];
                return [{
                    id: `${selectedRoute.id}-walk-fallback-${index}`,
                    coords: legCoords,
                    color: isDark ? TRANSIT_WALK_ROUTE_COLOR_DARK : TRANSIT_WALK_ROUTE_COLOR_LIGHT,
                    width: ROUTE_STYLE.transitWalkWidth,
                    outlineColor: isDark ? "rgba(15,20,35,0.64)" : "rgba(255,255,255,0.95)",
                    outlineWidth: ROUTE_STYLE.transitWalkOutlineWidth,
                } as TmapPathOverlay];
            })
            : [];
        const selectedTransitWalkOverlays = (
            travelMode === "TRANSIT" &&
            shouldShowDetailedTransitSegments
        )
            ? [...selectedTransitWalkFallbackOverlays, ...transitConnectorOverlays, ...transitWalkDetailOverlays]
                .filter((overlay) => (
                    typeof overlay.id === "string" &&
                    (overlay.id.endsWith("-path") || overlay.id.includes("-walk-fallback-")) &&
                    Array.isArray(overlay.coords) &&
                    overlay.coords.length >= 2
                ))
                .map((overlay, index) => ({
                    id: `selected-walk-${index}-${overlay.id}`,
                    coords: overlay.coords,
                    // 상세 줌 전에는 바탕선을 유지하고,
                    // 상세 줌에서는 점선 마커만 남겨 도보 안내선을 점선으로 읽히게 한다.
                    color: isDark ? TRANSIT_WALK_ROUTE_COLOR_DARK : TRANSIT_WALK_ROUTE_COLOR_LIGHT,
                    width: ROUTE_STYLE.transitWalkWidth,
                    outlineColor: isDark ? "rgba(15,20,35,0.64)" : "rgba(255,255,255,0.95)",
                    outlineWidth: ROUTE_STYLE.transitWalkOutlineWidth,
                } as TmapPathOverlay))
            : [];
        const selectedDirectionOverlays: TmapPathOverlay[] = (
            travelMode === "TRANSIT" &&
            mapZoom >= TRANSIT_DIRECTION_MARKER_MIN_ZOOM &&
            selectedRoute &&
            Array.isArray(selectedRoute.transitLegs)
        )
            ? selectedRoute.transitLegs.flatMap((leg, index) => {
                if (leg.kind !== "BUS" && leg.kind !== "SUBWAY") return [];
                const displayPath = leg.kind === "BUS"
                    ? getRideLegDisplayPathCoords(selectedRoute.transitLegs, index)
                    : normalizeDisplayPathCoords(
                        Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2 ? leg.pathCoords : undefined,
                        leg.kind
                    );
                return buildDirectionalChevronOverlaysForPath(
                    `${selectedRoute.id}-${leg.kind.toLowerCase()}-${index}`,
                    displayPath,
                    leg.kind === "SUBWAY" ? 42 : 34,
                    10,
                    leg.kind === "SUBWAY" ? 24 : 28,
                    leg.kind === "SUBWAY" ? 7.2 : 6.2,
                    leg.kind === "SUBWAY" ? 2.4 : 2.1,
                    2.4,
                    isDark ? "rgba(15,20,35,0.24)" : "rgba(15,23,42,0.18)",
                    1.1
                );
            })
            : [];
        const focusedTransitLegOverlay = (
            travelMode === "TRANSIT" &&
            selectedRoute &&
            Array.isArray(selectedRoute.transitLegs) &&
            typeof focusedTransitLegIndex === "number"
        )
            ? (() => {
                const focusedLeg = selectedRoute.transitLegs?.[focusedTransitLegIndex];
                if (!focusedLeg) return null;
                const focusedCoords = getTransitLegMapCoords(
                    selectedRoute.id,
                    selectedRoute.transitLegs,
                    focusedTransitLegIndex,
                    walkOverlayById
                );
                if (focusedCoords.length < 2) return null;
                return {
                    id: `${selectedRoute.id}-focused-leg-${focusedTransitLegIndex}`,
                    coords: focusedCoords,
                    color: focusedLeg.kind === "WALK"
                        ? (isDark ? "#A7D8FF" : "#0B63FF")
                        : getTransitLegVisualColor(focusedLeg),
                    width: focusedLeg.kind === "WALK"
                        ? ROUTE_STYLE.transitWalkWidth + 2.6
                        : ROUTE_STYLE.transitRideWidth + 3,
                    outlineColor: isDark ? "rgba(5,10,20,0.86)" : "rgba(255,255,255,0.98)",
                    outlineWidth: focusedLeg.kind === "WALK"
                        ? ROUTE_STYLE.transitWalkOutlineWidth + 1.1
                        : ROUTE_STYLE.transitRideOutlineWidth + 1.2,
                } as TmapPathOverlay;
            })()
            : null;
        const selectedMainOverlay = selectedRoute
            ? (() => {
                const selectedCoords = Array.isArray(selectedRoute.pathCoords) && selectedRoute.pathCoords.length >= 2
                    ? toDisplayOverlayCoords(
                        selectedRoute.pathCoords,
                        selectedRoute.mode === "WALK" ? "WALK" : undefined
                    )
                    : fallbackPathCoords;
                if (selectedCoords.length < 2) return null;
                return {
                    id: `${selectedRoute.id}-selected`,
                    coords: selectedCoords,
                    color: selectedTransitSegmentOverlays.length > 0
                        ? (shouldEmphasizeMainTransitBaseLine ? "rgba(180, 193, 211, 0.82)" : "rgba(180, 193, 211, 0.34)")
                        : SELECTED_ROUTE_COLOR,
                    width: selectedTransitSegmentOverlays.length > 0
                        // 상세 줌에서는 메인 fallback 라인을 약하게 낮춰
                        // 도보 점선/대중교통 색상 세그먼트가 더 먼저 읽히게 한다.
                        ? (shouldEmphasizeMainTransitBaseLine
                            ? Math.max(ROUTE_STYLE.transitWalkWidth + 0.8, 3.8)
                            : 3.2)
                        : ROUTE_STYLE.selectedWidth,
                    outlineColor: selectedTransitSegmentOverlays.length > 0
                        ? (shouldEmphasizeMainTransitBaseLine
                            ? (isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.62)")
                            : (isDark ? "rgba(15,20,35,0.28)" : "rgba(255,255,255,0.26)"))
                        : (isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.9)"),
                    outlineWidth: selectedTransitSegmentOverlays.length > 0
                        ? (shouldEmphasizeMainTransitBaseLine
                            ? Math.max(ROUTE_STYLE.transitWalkOutlineWidth + 0.1, 1.2)
                            : 0.8)
                        : ROUTE_STYLE.selectedOutlineWidth,
                } as TmapPathOverlay;
            })()
            : null;

        if (selectedTransitSegmentOverlays.length > 0 || selectedTransitWalkOverlays.length > 0) {
            const overlays: TmapPathOverlay[] = [];
            if (selectedMainOverlay) {
                overlays.push(selectedMainOverlay);
            }
            overlays.push(...selectedTransitWalkOverlays);
            if (selectedTransitSegmentOverlays.length > 0) {
                overlays.push(...selectedTransitSegmentOverlays);
            }
            overlays.push(...selectedDirectionOverlays);
            if (focusedTransitLegOverlay) {
                overlays.push(focusedTransitLegOverlay);
            }
            return overlays;
        }

        if (!selectedMainOverlay) {
            if (pathOverlayCoords && pathOverlayCoords.length >= 2) {
                const overlays: TmapPathOverlay[] = [{
                    id: "route-selected-fallback",
                    coords: pathOverlayCoords,
                    color: SELECTED_ROUTE_COLOR,
                    width: ROUTE_STYLE.selectedWidth,
                    outlineColor: isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.95)",
                    outlineWidth: ROUTE_STYLE.selectedOutlineWidth,
                }];
                if (focusedTransitLegOverlay) {
                    overlays.push(focusedTransitLegOverlay);
                }
                return overlays;
            }
            return focusedTransitLegOverlay ? [focusedTransitLegOverlay] : [];
        }

        return focusedTransitLegOverlay ? [selectedMainOverlay, focusedTransitLegOverlay] : [selectedMainOverlay];
    }, [
        hasRouteReady,
        routeAlternatives,
        selectedAlternativeId,
        pathOverlayCoords,
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        travelMode,
        mapZoom,
        transitConnectorOverlays,
        transitWalkDetailOverlays,
        focusedTransitLegIndex,
        isDark,
    ]);

    // 지도에 전달할 실제 marker 목록.
    // 출발/도착 pin, 방향 화살표, 버스 정류장, 환승/승하차 배지까지 최종 단계에서 모은다.
    const mapMarkers = useMemo<TmapMarker[]>(() => {
        const markers: TmapMarker[] = [];
        // 출발/도착 핀은 항상 사용자가 선택한 실제 좌표에 고정한다.
        // (TRANSIT에서 walk path 중간으로 이동시키면 "마커가 틀린 위치"처럼 보이는 문제가 생김)
        const originMarkerCoord = hasOriginCoords ? { lat: originLat, lng: originLng } : undefined;
        const destinationMarkerCoord = hasDestinationCoords ? { lat: destinationLat, lng: destinationLng } : undefined;
        if (hasOriginCoords) {
            markers.push({
                id: "origin",
                latitude: originMarkerCoord?.lat ?? originLat,
                longitude: originMarkerCoord?.lng ?? originLng,
                tintColor: ORIGIN_COLOR,
                markerStyle: "origin",
                displayType: "pin",
                pinLabel: "출발",
                caption: "출발",
                // 출발 마커를 최상단 우선순위로 렌더링.
                zIndex: 4000,
            });
        }
        if (hasDestinationCoords) {
            markers.push({
                id: "destination",
                latitude: destinationMarkerCoord?.lat ?? destinationLat,
                longitude: destinationMarkerCoord?.lng ?? destinationLng,
                tintColor: DESTINATION_COLOR,
                markerStyle: "destination",
                displayType: "pin",
                pinLabel: "도착",
                caption: "도착",
                // 도착 마커는 출발보다 한 단계 낮은 우선순위.
                zIndex: 3990,
            });
        }

        markers.push(...buildSelectedRouteDirectionMarkers(selectedAlternative, travelMode, mapZoom));

        if (
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            // 라인 라벨은 고배율에서만 표시한다.
            const showLegLabels = mapZoom >= 17.2;
            // 승/하차/환승 이벤트 배지 노출 여부.
            const showEventMarkers = mapZoom >= TRANSIT_BADGE_MIN_ZOOM;
            if (showLegLabels) {
                markers.push(
                    ...buildTransitLegLabelMarkers(
                        selectedAlternative.id,
                        selectedAlternative.transitLegs,
                        mapZoom,
                        isDark
                    )
                );
            }
            // 환승/정류장 접근 보행용 점선(dot) 마커.
            markers.push(
                ...buildTransitWalkGuideMarkers(
                    selectedAlternative,
                    travelMode,
                    mapZoom,
                    transitConnectorOverlays,
                    transitWalkDetailOverlays
                )
            );
            markers.push(
                ...buildBusStopMarkers(
                    selectedAlternative.id,
                    selectedAlternative.transitLegs,
                    mapZoom
                )
            );
            if (showEventMarkers) {
                const transitEventMarkers = buildTransitEventMarkers(
                    selectedAlternative.id,
                    selectedAlternative.transitLegs,
                    mapZoom,
                    isDark
                );
                markers.push(...transitEventMarkers);
            }
        }

        return markers;
    }, [
        hasOriginCoords,
        hasDestinationCoords,
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        travelMode,
        mapZoom,
        selectedAlternative,
        isDark,
        transitConnectorOverlays,
        transitWalkDetailOverlays,
    ]);

    useEffect(() => {
        if (travelMode !== "CAR" || !hasRouteReady) return;
        const interval = setInterval(() => {
            setCarTrafficRefreshTick((prev) => prev + 1);
        }, 45000);
        return () => clearInterval(interval);
    }, [travelMode, hasRouteReady]);

    // 카메라는 prop으로 계속 넘기지 않고 imperative ref로만 제어한다.
    // 그래야 경로 재계산/마커 갱신 때 불필요한 카메라 리셋 없이 원하는 포커스만 이동시킬 수 있다.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const hasOrigin = typeof originLat === "number" && typeof originLng === "number";
        const hasDest = typeof destinationLat === "number" && typeof destinationLng === "number";
        if (
            forcedFocusTarget === "startRide" &&
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            const focusCoord = getTransitRouteStartFocusCoord(selectedAlternative.transitLegs);
            if (focusCoord) {
                const focusKey = `focus:start-ride:${selectedAlternativeId ?? "none"}:${focusCoord.lat.toFixed(5)}:${focusCoord.lng.toFixed(5)}`;
                if (lastCameraActionKeyRef.current === focusKey) return;
                lastCameraActionKeyRef.current = focusKey;
                const shiftedCenter = offsetCoordByMeters(focusCoord, -70, 0);
                map.animateCameraTo({
                    latitude: shiftedCenter.lat,
                    longitude: shiftedCenter.lng,
                    zoom: forcedFocusZoom ?? 16.6,
                    duration: 800,
                    easing: "Fly",
                });
                return;
            }
        }
        if (
            forcedFocusTarget === "firstSubway" &&
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            const focusCoord = getTransitRouteFirstSubwayFocusCoord(selectedAlternative.transitLegs);
            if (focusCoord) {
                const focusKey = `focus:first-subway:${selectedAlternativeId ?? "none"}:${focusCoord.lat.toFixed(5)}:${focusCoord.lng.toFixed(5)}`;
                if (lastCameraActionKeyRef.current === focusKey) return;
                lastCameraActionKeyRef.current = focusKey;
                const shiftedCenter = offsetCoordByMeters(focusCoord, -70, 0);
                map.animateCameraTo({
                    latitude: shiftedCenter.lat,
                    longitude: shiftedCenter.lng,
                    zoom: forcedFocusZoom ?? 16.6,
                    duration: 800,
                    easing: "Fly",
                });
                return;
            }
        }
        if (forcedFocusTarget === "origin" && hasOrigin) {
            const focusKey = `focus:origin-forced:${originLat.toFixed(5)}:${originLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            const shiftedCenter = offsetCoordByMeters({ lat: originLat, lng: originLng }, -70, 0);
            map.animateCameraTo({
                latitude: shiftedCenter.lat,
                longitude: shiftedCenter.lng,
                zoom: forcedFocusZoom ?? 16.1,
                duration: 750,
                easing: "Fly",
            });
            return;
        }
        if (forcedFocusTarget === "destination" && hasDest) {
            const focusKey = `focus:destination-forced:${destinationLat.toFixed(5)}:${destinationLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            const shiftedCenter = offsetCoordByMeters({ lat: destinationLat, lng: destinationLng }, -70, 0);
            map.animateCameraTo({
                latitude: shiftedCenter.lat,
                longitude: shiftedCenter.lng,
                zoom: forcedFocusZoom ?? 16.1,
                duration: 750,
                easing: "Fly",
            });
            return;
        }

        if (hasOrigin && hasDest) {
            const originPoint = { latitude: originLat, longitude: originLng };
            const destinationPoint = { latitude: destinationLat, longitude: destinationLng };
            const transitConnectorFitPoints = isTransitDetailMode
                ? [...transitConnectorOverlays, ...transitWalkDetailOverlays].flatMap((overlay) => overlay.coords)
                : [];
            const routePoints = pathOverlayCoords?.length
                ? [originPoint, ...pathOverlayCoords, ...transitConnectorFitPoints, destinationPoint]
                : [originPoint, destinationPoint];
            const firstPoint = routePoints[0];
            const midPoint = routePoints[Math.floor(routePoints.length / 2)];
            const lastPoint = routePoints[routePoints.length - 1];
            const activeSheetOffset = bottomSheetSnap === "expanded"
                ? bottomSheetExpandedOffset
                : bottomSheetSnap === "middle"
                    ? bottomSheetMiddleOffset
                    : bottomSheetCollapsedOffset;
            const visibleSheetTopY = isTransitDetailMode && !isBottomSheetHidden && bottomPanelHeight > 0
                ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
                : windowHeight;
            const routeHeaderReserveY = isTransitDetailMode ? Math.max(insets.top + 102, 132) : Math.max(insets.top + 84, 112);
            const availableRouteMapHeight = Math.max(180, visibleSheetTopY - routeHeaderReserveY);
            const availableRouteMapRatio = Math.max(0.18, Math.min(1, availableRouteMapHeight / Math.max(1, windowHeight)));
            const fitKey = [
                "fit",
                selectedAlternativeId ?? "none",
                isTransitDetailMode ? "detail" : "edit",
                bottomSheetSnap,
                isBottomSheetHidden ? "hidden" : "shown",
                Math.round(bottomPanelHeight).toString(),
                Math.round(activeSheetOffset).toString(),
                Math.round(visibleSheetTopY).toString(),
                routePoints.length.toString(),
                firstPoint.latitude.toFixed(4),
                firstPoint.longitude.toFixed(4),
                midPoint.latitude.toFixed(4),
                midPoint.longitude.toFixed(4),
                lastPoint.latitude.toFixed(4),
                lastPoint.longitude.toFixed(4),
            ].join(":");
            if (lastCameraActionKeyRef.current === fitKey) return;
            lastCameraActionKeyRef.current = fitKey;

            let minLat = Number.POSITIVE_INFINITY;
            let maxLat = Number.NEGATIVE_INFINITY;
            let minLng = Number.POSITIVE_INFINITY;
            let maxLng = Number.NEGATIVE_INFINITY;

            routePoints.forEach((point) => {
                minLat = Math.min(minLat, point.latitude);
                maxLat = Math.max(maxLat, point.latitude);
                minLng = Math.min(minLng, point.longitude);
                maxLng = Math.max(maxLng, point.longitude);
            });

            const rawLatDelta = Math.max(0, maxLat - minLat);
            const rawLngDelta = Math.max(0, maxLng - minLng);
            const centerLat = (minLat + maxLat) / 2;
            const lngMetersPerDegree = Math.max(1, 111_320 * Math.cos((centerLat * Math.PI) / 180));
            const routeDistanceKm = haversineDistanceKm(
                { latitude: originLat, longitude: originLng },
                { latitude: destinationLat, longitude: destinationLng }
            );

            const marginScale = routeDistanceKm < 2
                ? 2.1
                : routeDistanceKm < 5
                    ? 1.85
                    : routeDistanceKm < 12
                        ? 1.62
                        : routeDistanceKm < 25
                            ? 1.42
                            : 1.28;

            // 상세 바텀시트가 올라온 상태에서도 전체 경로가 보이도록 실제 가시 영역 기준 여백을 더 준다.
            const detailFitScale = isTransitDetailMode && !isBottomSheetHidden ? 1.34 : 1;
            const fitScale = (isBottomSheetCollapsed ? 1.18 : 1.08) * detailFitScale;
            const transitDetailVerticalScale = isTransitDetailMode && !isBottomSheetHidden
                ? Math.min(6.0, Math.max(2.55, (1 / availableRouteMapRatio) * 1.38))
                : 1;
            const transitDetailHorizontalScale = isTransitDetailMode && !isBottomSheetHidden ? 1.78 : 1;
            const minSpanMeters = isBottomSheetCollapsed
                ? (routeDistanceKm < 2 ? 680 : routeDistanceKm < 10 ? 920 : 1220)
                : (routeDistanceKm < 2 ? 540 : routeDistanceKm < 10 ? 780 : 1020);
            const minLatDelta = minSpanMeters / 111_320;
            const minLngDelta = minSpanMeters / lngMetersPerDegree;

            const latitudeDelta = Math.max(minLatDelta, rawLatDelta * marginScale * fitScale * transitDetailVerticalScale);
            const longitudeDelta = Math.max(minLngDelta, rawLngDelta * marginScale * fitScale * transitDetailHorizontalScale);

            const paddedMinLat = minLat - (latitudeDelta - rawLatDelta) / 2;
            const paddedMinLng = minLng - (longitudeDelta - rawLngDelta) / 2;
            const pivotY = isTransitDetailMode && !isBottomSheetHidden
                ? Math.max(0.18, Math.min(0.38, (routeHeaderReserveY + (availableRouteMapHeight * 0.34)) / Math.max(1, windowHeight)))
                : (isBottomSheetCollapsed ? 0.42 : 0.34);

            map.animateRegionTo({
                latitude: paddedMinLat,
                longitude: paddedMinLng,
                latitudeDelta,
                longitudeDelta,
                duration: 900,
                easing: "Fly",
                pivot: { x: 0.5, y: pivotY },
            });
        } else if (activeTarget === "destination" && hasDest) {
            const focusKey = `focus:destination:${destinationLat.toFixed(5)}:${destinationLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            map.animateCameraTo({ latitude: destinationLat, longitude: destinationLng, zoom: 14, duration: 700, easing: "Fly" });
        } else if (activeTarget === "origin" && hasOrigin) {
            const focusKey = `focus:origin:${originLat.toFixed(5)}:${originLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            map.animateCameraTo({ latitude: originLat, longitude: originLng, zoom: 14, duration: 700, easing: "Fly" });
        } else if (hasOrigin) {
            const focusKey = `focus:origin-only:${originLat.toFixed(5)}:${originLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            map.animateCameraTo({ latitude: originLat, longitude: originLng, zoom: 14, duration: 700, easing: "Fly" });
        } else if (hasDest) {
            const focusKey = `focus:destination-only:${destinationLat.toFixed(5)}:${destinationLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            map.animateCameraTo({ latitude: destinationLat, longitude: destinationLng, zoom: 14, duration: 700, easing: "Fly" });
        } else {
            lastCameraActionKeyRef.current = "";
        }
    }, [
        activeTarget,
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        forcedFocusTarget,
        forcedFocusZoom,
        pathOverlayCoords,
        selectedAlternative,
        selectedAlternativeId,
        travelMode,
        isBottomSheetCollapsed,
        isBottomSheetHidden,
        isTransitDetailMode,
        bottomSheetSnap,
        bottomPanelHeight,
        bottomSheetCollapsedOffset,
        bottomSheetMiddleOffset,
        bottomSheetExpandedOffset,
        transitConnectorOverlays,
        transitWalkDetailOverlays,
        insets.top,
        windowHeight,
    ]);

    const applyPlace = (target: RoutePointTarget, place: PlaceSearchItem) => {
        if (isRoutePointLocked || !hasActiveTarget) {
            setSearchQuery("");
            setSearchResults([]);
            return;
        }

        if (target === "origin") {
            setOriginLat(place.lat);
            setOriginLng(place.lng);
            setOriginAddress(place.address);
            setOriginName(place.name);
            setActiveTarget("destination"); // 출발지 설정 후 도착지 탭으로 자동 전환
        } else {
            setDestinationLat(place.lat);
            setDestinationLng(place.lng);
            setDestinationAddress(place.address);
            setDestinationName(place.name);
        }

        const nextHasOrigin = target === "origin" ? true : hasOriginCoords;
        const nextHasDestination = target === "destination" ? true : hasDestinationCoords;
        if (nextHasOrigin && nextHasDestination) {
            setIsRoutePointEditMode(false);
        } else {
            setIsRoutePointEditMode(true);
        }

        setSearchQuery("");
        setSearchResults([]);
    };

    const syncAddressFromCoords = useCallback(async (target: RoutePointTarget, lat: number, lng: number) => {
        try {
            const address = await reverseGeocodeToAddress(lat, lng);
            if (!address) return;
            if (target === "origin") {
                setOriginAddress(address);
            } else {
                setDestinationAddress(address);
            }
        } catch {
            // ignore
        }
    }, []);

    const setCurrentLocation = useCallback(async (target: RoutePointTarget) => {
        try {
            const loc = await getCurrentLocation();
            if (target === "origin") {
                setOriginLat(loc.latitude);
                setOriginLng(loc.longitude);
                setOriginName("현재 위치");
                setActiveTarget("destination");
            } else {
                setDestinationLat(loc.latitude);
                setDestinationLng(loc.longitude);
                setDestinationName("현재 위치");
            }

            const nextHasOrigin = target === "origin" ? true : hasOriginCoords;
            const nextHasDestination = target === "destination" ? true : hasDestinationCoords;
            if (nextHasOrigin && nextHasDestination) {
                setIsRoutePointEditMode(false);
            } else {
                setIsRoutePointEditMode(true);
            }

            await syncAddressFromCoords(target, loc.latitude, loc.longitude);
        } catch (error) {
            const message = error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.";
            Alert.alert("위치 가져오기 실패", message);
        }
    }, [hasDestinationCoords, hasOriginCoords, syncAddressFromCoords]);

    useEffect(() => {
        if (initializedOriginRef.current) return;
        if (typeof originLat === "number" && typeof originLng === "number") {
            initializedOriginRef.current = true;
            return;
        }
        initializedOriginRef.current = true;
        setCurrentLocation("origin").catch(() => {
            // ignore
        });
    }, [originLat, originLng, setCurrentLocation]);

    const onPressOriginTarget = () => {
        if (activeTarget === "origin") {
            setActiveTarget(null);
            setSearchQuery("");
            setSearchResults([]);
            return;
        }

        setActiveTarget("origin");
        setIsRoutePointEditMode(true);
        if (typeof originLat === "number" && typeof originLng === "number") {
            return;
        }
        setCurrentLocation("origin").catch(() => {
            // ignore
        });
    };

    const onPressDestinationTarget = () => {
        if (activeTarget === "destination") {
            setActiveTarget(null);
            setSearchQuery("");
            setSearchResults([]);
            return;
        }

        setActiveTarget("destination");
        setIsRoutePointEditMode(true);
    };

    // onTapMap: SDK는 event.nativeEvent 없이 { latitude, longitude } 직접 전달
    const onTapMap = async (event: { latitude: number; longitude: number }) => {
        if (isRoutePointLocked || !hasActiveTarget) return;
        if (activeTarget !== "origin" && activeTarget !== "destination") return;
        const { latitude, longitude } = event;
        const tappedTarget = activeTarget;

        if (tappedTarget === "origin") {
            setOriginLat(latitude);
            setOriginLng(longitude);
            setActiveTarget("destination");
        } else {
            setDestinationLat(latitude);
            setDestinationLng(longitude);
        }

        const nextHasOrigin = tappedTarget === "origin" ? true : hasOriginCoords;
        const nextHasDestination = tappedTarget === "destination" ? true : hasDestinationCoords;
        if (nextHasOrigin && nextHasDestination) {
            setIsRoutePointEditMode(false);
        } else {
            setIsRoutePointEditMode(true);
        }

        try {
            const address = await reverseGeocodeToAddress(latitude, longitude);
            if (address) {
                if (tappedTarget === "origin") {
                    setOriginName(address);
                    setOriginAddress(address);
                } else {
                    setDestinationName(address);
                    setDestinationAddress(address);
                }
            }
        } catch {
            // ignore
        }
    };

    const handleSearchChange = (text: string) => {
        if (isRoutePointLocked || !hasActiveTarget) return;
        setSearchQuery(text);
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
        }, 500);
    };

    const persistCurrentRoutePlannerInitial = useCallback((targetSessionId = sessionId) => {
        if (!targetSessionId) return;

        const normalizedOriginName = originName.trim();
        const normalizedDestinationName = destinationName.trim();
        const normalizedOriginAddress = originAddress.trim();
        const normalizedDestinationAddress = destinationAddress.trim();
        const nextOrigin = (normalizedOriginName || normalizedOriginAddress || hasOriginCoords)
            ? {
                name: normalizedOriginName || normalizedOriginAddress || "출발지",
                address: normalizedOriginAddress || undefined,
                lat: originLat,
                lng: originLng,
            }
            : undefined;
        const nextDestination = (normalizedDestinationName || normalizedDestinationAddress || hasDestinationCoords)
            ? {
                name: normalizedDestinationName || normalizedDestinationAddress || "도착지",
                address: normalizedDestinationAddress || undefined,
                lat: destinationLat,
                lng: destinationLng,
            }
            : undefined;

        setRoutePlannerInitial(targetSessionId, {
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes: etaMinutes,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name || nextOrigin?.name,
        });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationName,
        etaMinutes,
        hasDestinationCoords,
        hasOriginCoords,
        originAddress,
        originLat,
        originLng,
        originName,
        sessionId,
        travelMode,
    ]);

    const closePlanner = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace("/schedule");
    }, [router]);

    const goBack = useCallback(() => {
        if (!isRouteSelectionStage) {
            const targetSessionId = sessionId || `route-reset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            persistCurrentRoutePlannerInitial(targetSessionId);
            router.replace({ pathname: "/schedule/route-select", params: { sessionId: targetSessionId } });
            return;
        }

        closePlanner();
    }, [closePlanner, isRouteSelectionStage, persistCurrentRoutePlannerInitial, router, sessionId]);

    const submit = () => {
        const normalizedOriginName = originName.trim();
        const normalizedDestinationName = destinationName.trim();
        if (!hasRouteReady) {
            Alert.alert("경로 설정 필요", "지도에서 출발지와 도착지를 모두 선택해 주세요.");
            return;
        }

        if (!sessionId) {
            closePlanner();
            return;
        }

        const nextOrigin: Place = {
            name: normalizedOriginName || originAddress.trim() || "출발지",
            address: originAddress.trim() || undefined,
            lat: originLat,
            lng: originLng,
        };
        const nextDestination: Place = {
            name: normalizedDestinationName || destinationAddress.trim() || "도착지",
            address: destinationAddress.trim() || undefined,
            lat: destinationLat,
            lng: destinationLng,
        };

        setRoutePlannerResult(sessionId, {
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes: etaMinutes,
            locationName: `${nextOrigin.name} → ${nextDestination.name}`,
        });
        closePlanner();
    };

    const onPressZoomIn = useCallback(() => {
        mapRef.current?.zoomBy(1);
    }, []);

    const onPressZoomOut = useCallback(() => {
        mapRef.current?.zoomBy(-1);
    }, []);

    const onMapZoomChanged = useCallback((nextZoom: number) => {
        setMapZoom((prev) => (Math.abs(prev - nextZoom) < 0.05 ? prev : nextZoom));
    }, []);

    const focusMapOnTransitLeg = useCallback((legIndex: number) => {
        const legs = selectedAlternative?.transitLegs;
        if (!selectedAlternative || !Array.isArray(legs) || !legs[legIndex]) return;

        setFocusedTransitLegIndex(legIndex);

        const walkOverlayById = new Map(
            transitWalkDetailOverlays.map((overlay) => [overlay.id, overlay.coords])
        );
        const leg = legs[legIndex];
        const legCoords = getTransitLegMapCoords(selectedAlternative.id, legs, legIndex, walkOverlayById);
        const midCoord = getTransitLegMidCoord(leg);
        const focusCoords = legCoords.length > 0
            ? legCoords
            : (midCoord ? [{ latitude: midCoord.lat, longitude: midCoord.lng }] : []);
        if (!focusCoords.length) return;

        let minLat = Number.POSITIVE_INFINITY;
        let maxLat = Number.NEGATIVE_INFINITY;
        let minLng = Number.POSITIVE_INFINITY;
        let maxLng = Number.NEGATIVE_INFINITY;
        focusCoords.forEach((point) => {
            minLat = Math.min(minLat, point.latitude);
            maxLat = Math.max(maxLat, point.latitude);
            minLng = Math.min(minLng, point.longitude);
            maxLng = Math.max(maxLng, point.longitude);
        });

        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;
        const shiftedCenter = offsetCoordByMeters(
            { lat: centerLat, lng: centerLng },
            isBottomSheetCollapsed ? -44 : -86,
            0
        );
        const diagonalMeters = haversineDistanceKm(
            { latitude: minLat, longitude: minLng },
            { latitude: maxLat, longitude: maxLng }
        ) * 1000;

        if (focusCoords.length < 2 || diagonalMeters < 150) {
            mapRef.current?.animateCameraTo({
                latitude: shiftedCenter.lat,
                longitude: shiftedCenter.lng,
                zoom: Math.min(18, Math.max(mapZoom, leg.kind === "WALK" ? 17 : 16.4)),
                duration: 650,
                easing: "Fly",
            });
            return;
        }

        const lngMetersPerDegree = Math.max(1, 111_320 * Math.cos((centerLat * Math.PI) / 180));
        const minSpanMeters = leg.kind === "WALK" ? 260 : 420;
        const latitudeDelta = Math.max(
            (maxLat - minLat) * 1.55,
            minSpanMeters / 111_320
        );
        const longitudeDelta = Math.max(
            (maxLng - minLng) * 1.55,
            minSpanMeters / lngMetersPerDegree
        );

        mapRef.current?.animateRegionTo({
            latitude: shiftedCenter.lat - (latitudeDelta / 2),
            longitude: shiftedCenter.lng - (longitudeDelta / 2),
            latitudeDelta,
            longitudeDelta,
            duration: 720,
            easing: "Fly",
            pivot: { x: 0.5, y: isBottomSheetCollapsed ? 0.42 : 0.32 },
        });
    }, [isBottomSheetCollapsed, mapZoom, selectedAlternative, transitWalkDetailOverlays]);

    const canEnterRouteDetail = isRouteSelectionStage && hasRouteReady && !!selectedAlternative && !etaLoading;
    const onEnterRouteDetailView = useCallback(() => {
        if (!canEnterRouteDetail || !sessionId) return;

        persistCurrentRoutePlannerInitial();
        router.replace({
            pathname: "/schedule/route-planner",
            params: {
                sessionId,
                routeIndex: selectedVisibleAlternativeIndex >= 0 ? String(selectedVisibleAlternativeIndex) : "0",
            },
        });
    }, [
        canEnterRouteDetail,
        persistCurrentRoutePlannerInitial,
        router,
        selectedVisibleAlternativeIndex,
        sessionId,
    ]);

    const shouldUseTransitReferenceScreen = false;

    if (isTransitDetailMode && shouldUseTransitReferenceScreen) {
        const transitLegs = selectedAlternative?.transitLegs ?? [];
        const departureText = formatTransitDepartureNow();
        const departureTimeText = departureText.replace(/\s*출발$/, "");
        const referenceTravelModes: TravelMode[] = ["TRANSIT", "CAR", "WALK", "BIKE"];

        return (
            <View style={styles.transitReferenceScreen}>
                <ScrollView
                    contentContainerStyle={[
                        styles.transitReferenceScrollContent,
                        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom + 20, 32) },
                    ]}
                    bounces={false}
                    alwaysBounceVertical={false}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.transitReferenceAddressCard}>
                        <View style={styles.transitReferenceRouteRows}>
                            <View style={styles.transitReferenceSwapRail}>
                                <Text style={styles.transitReferenceSwapText}>↑↓</Text>
                            </View>
                            <View style={styles.transitReferenceAddressContent}>
                                <View style={styles.transitReferenceAddressRow}>
                                    <View style={[styles.transitReferencePointDot, styles.transitReferenceOriginDot]} />
                                    <Text numberOfLines={1} style={styles.transitReferenceAddressText}>
                                        {originDisplay}
                                    </Text>
                                    <Pressable onPress={goBack} hitSlop={10} style={styles.transitReferenceCloseButton}>
                                        <Text style={styles.transitReferenceCloseText}>×</Text>
                                    </Pressable>
                                </View>
                                <View style={styles.transitReferenceAddressDivider} />
                                <View style={styles.transitReferenceAddressRow}>
                                    <View style={[styles.transitReferencePointDot, styles.transitReferenceDestinationDot]} />
                                    <Text numberOfLines={1} style={styles.transitReferenceAddressText}>
                                        {destinationDisplay}
                                    </Text>
                                    <Text style={styles.transitReferenceMoreText}>⋮</Text>
                                </View>
                            </View>
                        </View>
                        <View style={styles.transitReferenceEntranceRow}>
                            <Text style={styles.transitReferenceEntranceLabel}>정문</Text>
                            <Text style={styles.transitReferenceEntranceAction}>출입구 변경 ›</Text>
                        </View>
                    </View>

                    <View style={styles.transitReferenceModeRow}>
                        {referenceTravelModes.map((travelModeItem) => {
                            const selected = travelModeItem === "TRANSIT";
                            const label = travelModeItem === "TRANSIT"
                                ? (selectedAlternative ? formatDuration(selectedAlternative.minutes) : "대중교통")
                                : TRAVEL_MODE_META[travelModeItem].label;
                            return (
                                <Pressable
                                    key={`reference-mode-${travelModeItem}`}
                                    onPress={() => setTravelMode(travelModeItem)}
                                    style={[
                                        styles.transitReferenceModeButton,
                                        selected ? styles.transitReferenceModeButtonSelected : null,
                                    ]}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.transitReferenceModeText,
                                            selected ? styles.transitReferenceModeTextSelected : null,
                                        ]}
                                    >
                                        {label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    <View style={styles.transitReferenceFilterRow}>
                        {TRANSIT_FILTER_ITEMS.map((item) => {
                            const selected = transitRouteFilter === item.key;
                            const count = item.key === "ALL" ? undefined : transitFilterCounts[item.key];
                            const label = typeof count === "number" ? `${item.label} ${count}` : item.label;
                            return (
                                <Pressable
                                    key={`reference-filter-${item.key}`}
                                    onPress={() => setTransitRouteFilter(item.key)}
                                    style={styles.transitReferenceFilterTab}
                                >
                                    <Text
                                        style={[
                                            styles.transitReferenceFilterText,
                                            selected ? styles.transitReferenceFilterTextSelected : null,
                                        ]}
                                    >
                                        {label}
                                    </Text>
                                    {selected && <View style={styles.transitReferenceFilterUnderline} />}
                                </Pressable>
                            );
                        })}
                    </View>

                    <View style={styles.transitReferenceControlRow}>
                        <Text style={styles.transitReferenceDepartureText}>
                            <Text style={styles.transitReferenceDepartureBlue}>{departureTimeText}</Text>
                            {" 출발⌄"}
                        </Text>
                        <Text style={styles.transitReferenceSortText}>최적 경로순, 계단 포함⌄</Text>
                    </View>

                    <View style={styles.transitReferenceDetailPanel}>
                        <View style={styles.transitReferenceNoticeCard}>
                            <Text style={styles.transitReferenceNoticeText}>▭ 기후동행카드 사용가능한 경로가 있습니다.</Text>
                            <Text style={styles.transitReferenceNoticeClose}>×</Text>
                        </View>

                        {etaLoading ? (
                            <View style={styles.transitReferenceLoadingRow}>
                                <ActivityIndicator size="small" color="#4D9BFF" />
                                <Text style={styles.transitReferenceLoadingText}>경로 옵션 계산 중...</Text>
                            </View>
                        ) : null}

                        {!etaLoading && !!alternativesError ? (
                            <Text style={styles.transitReferenceStateText}>{alternativesError}</Text>
                        ) : null}

                        {!etaLoading && !alternativesError && !selectedAlternative ? (
                            <Text style={styles.transitReferenceStateText}>표시할 대중교통 경로가 없습니다.</Text>
                        ) : null}

                        {!etaLoading && !alternativesError && !!selectedAlternative && (
                            <>
                                <View style={styles.transitReferenceSummaryHeader}>
                                    <View style={styles.transitReferenceSummaryMain}>
                                        <Text style={styles.transitReferenceOptimalText}>최적</Text>
                                        <Text style={styles.transitReferenceDurationText}>
                                            {formatDuration(selectedAlternative.minutes)}
                                        </Text>
                                        {!!selectedTransitTimeRange && (
                                            <Text style={styles.transitReferenceRouteMetaText}>
                                                {selectedTransitTimeRange}
                                            </Text>
                                        )}
                                    </View>
                                    <View style={styles.transitReferenceFeedbackButton}>
                                        <Text style={styles.transitReferenceFeedbackText}>의견 남기기</Text>
                                    </View>
                                </View>

                                <Text style={styles.transitReferenceRouteSummaryText}>
                                    {selectedAlternative.transitModeSummary ?? "선택한 대중교통 경로"}
                                </Text>

                                {selectedTransitProgressSegments.length > 0 && (
                                    <View style={styles.transitReferenceProgressTrack}>
                                        {selectedTransitProgressSegments.map((segment, index) => (
                                            <View
                                                key={`reference-${segment.key}`}
                                                style={[
                                                    styles.transitReferenceProgressSegment,
                                                    {
                                                        flex: segment.flex,
                                                        backgroundColor: segment.color,
                                                        marginLeft: index === 0 ? 0 : 3,
                                                    },
                                                ]}
                                            >
                                                <Text numberOfLines={1} style={styles.transitReferenceProgressText}>
                                                    {segment.label}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                {transitLegs.length > 0 && (
                                    <View style={styles.transitReferenceFullTimeline}>
                                        {transitLegs.map((leg, legIndex) => {
                                            const kindMeta = getTransitLegKindMeta(leg.kind);
                                            const legMetaText = buildTransitLegMeta(leg);
                                            const timelineTitle = buildTransitTimelineTitle(leg);
                                            const assistText = buildTransitLegAssistText(transitLegs, legIndex);
                                            const isFocusedLeg = focusedTransitLegIndex === legIndex;
                                            const isLastLeg = legIndex === transitLegs.length - 1;
                                            return (
                                                <Pressable
                                                    key={`${selectedAlternative.id}-reference-timeline-${legIndex}`}
                                                    onPress={() => focusMapOnTransitLeg(legIndex)}
                                                    style={[
                                                        styles.transitReferenceTimelineItem,
                                                        isFocusedLeg ? styles.transitReferenceTimelineItemFocused : null,
                                                    ]}
                                                >
                                                    <View style={styles.transitReferenceTimelineRail}>
                                                        <View style={[styles.transitReferenceTimelineDot, { backgroundColor: kindMeta.color }]}>
                                                            <Text style={styles.transitReferenceTimelineDotText}>{kindMeta.short}</Text>
                                                        </View>
                                                        {!isLastLeg && <View style={styles.transitReferenceTimelineLine} />}
                                                    </View>
                                                    <View style={styles.transitReferenceTimelineContent}>
                                                        <View style={styles.transitReferenceTimelineTopRow}>
                                                            <Text numberOfLines={2} style={styles.transitReferenceTimelineTitle}>
                                                                {timelineTitle}
                                                            </Text>
                                                            {!!legMetaText && (
                                                                <Text numberOfLines={1} style={styles.transitReferenceTimelineMeta}>
                                                                    {legMetaText}
                                                                </Text>
                                                            )}
                                                        </View>
                                                        {!!assistText && (
                                                            <Text numberOfLines={2} style={styles.transitReferenceTimelineAssist}>
                                                                {assistText}
                                                            </Text>
                                                        )}
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                )}

                                <Pressable style={styles.transitReferenceGuideButton}>
                                    <Text style={styles.transitReferenceGuideText}>▣ 바로 안내시작</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <TmapMapView
                ref={mapRef}
                style={styles.fullMap}
                camera={INITIAL_CAMERA}
                // RoutePlanner 화면은 이미 ThemeContext에서 isDark를 계산하고 있다.
                // 여기서 false로 고정하면 주변 카드/패널만 다크로 바뀌고 WebView 안의 지도는 항상 라이트 테마로 남는다.
                // 현재 테마 값을 그대로 내려서 TmapMapView 내부의 native dark mapType 또는 CSS fallback이 실행되도록 연결한다.
                nightModeEnabled={isDark}
                showLocationButton={true}
                showZoomControls={false}
                onTapMap={onTapMap}
                onZoomChanged={onMapZoomChanged}
                onInitialized={() => setIsMapInitialized(true)}
                markers={mapMarkers}
                pathOverlays={mapPathOverlays}
                pathCoords={pathOverlayCoords}
                pathColor={SELECTED_ROUTE_COLOR}
                pathWidth={10}
                pathOutlineColor={isDark ? "rgba(15,20,35,0.55)" : "#FFFFFF"}
                pathOutlineWidth={3}
                fallbackBackgroundColor={colors.surface2}
                fallbackTextColor={colors.textSecondary}
            />

            {isTransitDetailMode && (
                <View pointerEvents="none" style={[styles.transitMapDimOverlay, { backgroundColor: transitMapOverlayColor }]} />
            )}

            {shouldShowZoomControls && !isTransitDetailMode && (
                <View style={styles.zoomOverlay}>
                    <View style={[styles.zoomControlCard, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                        <Pressable onPress={onPressZoomIn} style={styles.zoomControlBtn}>
                            <Text style={[styles.zoomControlText, { color: colors.textPrimary }]}>+</Text>
                        </Pressable>
                        <View style={[styles.zoomDivider, { backgroundColor: colors.border }]} />
                        <Pressable onPress={onPressZoomOut} style={styles.zoomControlBtn}>
                            <Text style={[styles.zoomControlText, { color: colors.textPrimary }]}>-</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {isTransitDetailMode ? (
                <View style={[styles.transitMapRouteHeader, { paddingTop: Math.max(insets.top - 6, 4) }]}>
                    <Pressable onPress={goBack} style={[styles.transitMapBackButton, { backgroundColor: transitRouteChipBg }]}>
                        <Text style={[styles.transitMapBackText, { color: isDark ? "#FFFFFF" : "#111827" }]}>‹</Text>
                    </Pressable>
                    <ScrollView
                        horizontal
                        bounces={false}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.transitMapRouteChipContent}
                    >
                        {visibleAlternatives.map((option, index) => {
                            const selected = option.id === selectedAlternativeId;
                            return (
                                <Pressable
                                    key={`map-route-chip-${option.id}`}
                                    onPress={() => {
                                        if (isBottomSheetHidden) {
                                            snapBottomSheetTo(isTransitDetailMode ? "middle" : "expanded");
                                        }
                                        selectAlternativeByIndex(index, false);
                                    }}
                                    style={[
                                        styles.transitMapRouteChip,
                                        { backgroundColor: transitRouteChipBg },
                                        selected ? styles.transitMapRouteChipSelected : null,
                                    ]}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.transitMapRouteChipText,
                                            { color: transitRouteChipText },
                                            selected ? styles.transitMapRouteChipTextSelected : null,
                                        ]}
                                    >
                                        {formatTransitRouteChipLabel(option, index)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>
            ) : (
            <View style={[styles.topOverlay, { paddingTop: insets.top + 4 }]}>
                <View style={styles.searchOverlayRow}>
                    <Pressable
                        onPress={goBack}
                        style={[styles.inlineCloseBtn, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}
                    >
                        <Text style={[styles.inlineCloseBtnText, { color: colors.textPrimary }]}>‹</Text>
                    </Pressable>

                    <View
                        style={[
                            styles.searchInputWrap,
                            styles.searchField,
                            styles.overlaySurface,
                            { borderColor: searching ? colors.selectedDayBg : colors.border, backgroundColor: overlayBoxBg },
                        ]}
                    >
                        <TextInput
                            value={searchQuery}
                            onChangeText={handleSearchChange}
                            placeholder={
                                isRoutePointLocked
                                    ? "출/도 탭을 눌러 위치 수정"
                                    : !hasActiveTarget
                                        ? "출/도 탭을 선택해 주세요"
                                        : (activeTarget === "origin" ? "출발지 검색" : "도착지 검색")
                            }
                            placeholderTextColor={colors.textDisabled}
                            returnKeyType="search"
                            editable={!isRoutePointLocked && hasActiveTarget}
                            style={[styles.searchInput, { color: colors.textPrimary }]}
                        />
                        {searching
                            ? <ActivityIndicator size="small" color={colors.selectedDayBg} style={styles.searchIcon} />
                            : searchQuery.length > 0
                                ? (
                                    <Pressable onPress={() => { setSearchQuery(""); setSearchResults([]); }} style={styles.searchIcon}>
                                        <Text style={{ color: colors.textDisabled, fontSize: 16 }}>✕</Text>
                                    </Pressable>
                                ) : null
                        }
                    </View>

                    <View style={[styles.targetCompactWrap, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                        <Pressable
                            onPress={onPressOriginTarget}
                            style={[
                                styles.targetCompactBtn,
                                activeTarget === "origin" ? styles.targetCompactBtnActiveOrigin : null,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.targetCompactText,
                                    activeTarget === "origin" ? styles.targetCompactTextActive : { color: colors.textPrimary },
                                ]}
                            >
                                출
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={onPressDestinationTarget}
                            style={[
                                styles.targetCompactBtn,
                                activeTarget === "destination" ? styles.targetCompactBtnActiveDestination : null,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.targetCompactText,
                                    activeTarget === "destination" ? styles.targetCompactTextActive : { color: colors.textPrimary },
                                ]}
                            >
                                도
                            </Text>
                        </Pressable>
                    </View>
                </View>

                {!!searchResults.length && !isRoutePointLocked && hasActiveTarget && (
                    <View style={[styles.searchResultWrap, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayPanelBg }]}>
                        {searchResults.slice(0, 6).map((item, index) => (
                            <Pressable
                                key={`${item.lat}:${item.lng}:${index}`}
                                onPress={() => {
                                    if (activeTarget !== "origin" && activeTarget !== "destination") return;
                                    applyPlace(activeTarget, item);
                                }}
                                style={[
                                    styles.searchResultItem,
                                    { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth },
                                ]}
                            >
                                <Text numberOfLines={1} style={{ color: colors.textPrimary, fontWeight: "700", fontSize: 14 }}>
                                    {item.name}
                                </Text>
                                {!!item.category && (
                                    <Text numberOfLines={1} style={{ color: "#1B9B50", fontSize: 11, marginTop: 1 }}>
                                        {item.category}
                                    </Text>
                                )}
                                <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                                    {item.address}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}

                <View style={[styles.routePreviewCard, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                    <Text numberOfLines={1} style={[styles.routePreviewMain, { color: colors.textPrimary }]}>
                        {originDisplay} → {destinationDisplay}
                    </Text>
                    {!hasRouteReady && (
                        <Text style={[styles.routePreviewSub, { color: colors.textSecondary }]}>
                            출/도 탭을 선택한 뒤 지도 탭으로 위치를 지정하세요.
                        </Text>
                    )}

                    {(shouldShowTransitLegend || shouldShowTransitLegendHint) && (
                        <View style={styles.transitLegendInlineRow}>
                            {transitLegendKinds.map((kind) => {
                                const kindMeta = getTransitLegKindMeta(kind);
                                return (
                                    <View
                                        key={`legend-${kind}`}
                                        style={[
                                            styles.transitLegendInlineChip,
                                            { borderColor: colors.border, backgroundColor: overlayPanelBg },
                                        ]}
                                    >
                                        <View style={[styles.transitLegendSwatch, { backgroundColor: kindMeta.color }]} />
                                        <Text style={[styles.transitLegendText, { color: colors.textPrimary }]}>
                                            {kindMeta.label}
                                        </Text>
                                    </View>
                                );
                            })}

                            {shouldShowTransitLegendHint && !transitLegendKinds.length && (
                                <Text style={[styles.transitLegendHintText, { color: colors.textSecondary }]}>
                                    확대 시 구간 라벨 표시
                                </Text>
                            )}
                        </View>
                    )}

                </View>
            </View>
            )}

            {isRouteSelectionStage && (
                <View style={styles.routeSelectionStageOverlay} pointerEvents="box-none">
                    <View
                        style={[
                            styles.routeSelectionStagePanel,
                            styles.overlaySurface,
                            { borderColor: colors.border, backgroundColor: overlayPanelBg, paddingBottom: Math.max(insets.bottom + 12, 20) },
                        ]}
                    >
                        <Text style={[styles.routeSelectionStageTitle, { color: colors.textPrimary }]}>
                            경로를 먼저 선택해주세요
                        </Text>
                        <Text style={[styles.routeSelectionStageSubtitle, { color: colors.textSecondary }]}>
                            선택한 뒤 지도에서 상세 경로를 확인할 수 있습니다.
                        </Text>

                        <View style={styles.modeRow}>
                            {SELECTABLE_TRAVEL_MODES.map((travelModeItem) => (
                                <Pressable
                                    key={`selection-stage-${travelModeItem}`}
                                    onPress={() => setTravelMode(travelModeItem)}
                                    style={[
                                        styles.modeChip,
                                        {
                                            borderColor: travelMode === travelModeItem ? colors.selectedDayBg : colors.border,
                                            backgroundColor: travelMode === travelModeItem ? colors.selectedDayBg : overlayBoxBg,
                                        },
                                    ]}
                                >
                                    <Text style={{ color: travelMode === travelModeItem ? colors.selectedDayText : colors.textPrimary, fontSize: 12, fontWeight: "700" }}>
                                        {TRAVEL_MODE_META[travelModeItem].label}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>

                        <View style={[styles.routeSelectionStageListWrap, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                            {travelMode === "TRANSIT" && !etaLoading && !alternativesError && !!routeAlternatives.length && visibleTransitFilterItems.length > 1 && (
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    style={[styles.transitFilterRow, { borderBottomColor: colors.border }]}
                                    contentContainerStyle={styles.transitFilterRowContent}
                                >
                                    {visibleTransitFilterItems.map((item) => {
                                        const selected = transitRouteFilter === item.key;
                                        const count = transitFilterCounts[item.key];
                                        const label = item.key === "ALL" ? item.label : `${item.label} ${count}`;
                                        return (
                                            <Pressable
                                                key={`stage-filter-${item.key}`}
                                                onPress={() => setTransitRouteFilter(item.key)}
                                                style={[
                                                    styles.transitFilterTab,
                                                    { borderBottomColor: selected ? colors.textPrimary : "transparent" },
                                                ]}
                                            >
                                                <Text
                                                    style={[
                                                        styles.transitFilterTabText,
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

                            {etaLoading ? (
                                <View style={styles.alternativeLoadingRow}>
                                    <ActivityIndicator size="small" color={colors.selectedDayBg} />
                                    <Text style={[styles.alternativeLoadingText, { color: colors.textSecondary }]}>
                                        경로 옵션 계산 중..
                                    </Text>
                                </View>
                            ) : null}

                            {!etaLoading && !!alternativesError ? (
                                <Text style={[styles.alternativeErrorText, { color: colors.textSecondary }]}>
                                    {alternativesError}
                                </Text>
                            ) : null}

                            {!etaLoading && !alternativesError && !visibleAlternatives.length ? (
                                <Text style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}>
                                    표시할 경로가 없습니다.
                                </Text>
                            ) : null}

                            {!etaLoading && !alternativesError && !!visibleAlternatives.length && (
                                <ScrollView
                                    bounces={false}
                                    alwaysBounceVertical={false}
                                    contentContainerStyle={styles.routeSelectionStageList}
                                >
                                    {visibleAlternatives.map((option, index) => {
                                        const selected = option.id === selectedAlternativeId;
                                        const routeLabel = index === 0 ? "추천 경로" : `대안 경로 ${index}`;
                                        const summary = option.transitModeSummary ?? formatAlternativeInfo(option);
                                        const stepSummary = option.stepSummary?.trim();
                                        return (
                                            <Pressable
                                                key={`stage-${option.id}`}
                                                onPress={() => selectAlternativeByIndex(index, false)}
                                                style={[
                                                    styles.routeSelectionStageCard,
                                                    {
                                                        borderColor: selected ? colors.selectedDayBg : colors.border,
                                                        backgroundColor: selected
                                                            ? (isDark ? "rgba(29,114,255,0.22)" : "#EAF2FF")
                                                            : overlayCardBg,
                                                    },
                                                ]}
                                            >
                                                <View style={styles.routeSelectionStageCardTop}>
                                                    <Text style={[styles.alternativeRouteLabel, { color: colors.textPrimary }]}>
                                                        {routeLabel}
                                                    </Text>
                                                    <Text style={[styles.routeSelectionStageDuration, { color: colors.textPrimary }]}>
                                                        {formatDuration(option.minutes)}
                                                    </Text>
                                                </View>
                                                <Text numberOfLines={1} style={[styles.routeSelectionStageSummary, { color: colors.textSecondary }]}>
                                                    {summary}
                                                </Text>
                                                {!!stepSummary && (
                                                    <Text numberOfLines={2} style={[styles.routeSelectionStageStep, { color: colors.textSecondary }]}>
                                                        {stepSummary}
                                                    </Text>
                                                )}
                                            </Pressable>
                                        );
                                    })}
                                </ScrollView>
                            )}
                        </View>

                        <Pressable
                            onPress={onEnterRouteDetailView}
                            disabled={!canEnterRouteDetail}
                            style={[
                                styles.confirmBtn,
                                {
                                    marginTop: 10,
                                    backgroundColor: canEnterRouteDetail ? colors.selectedDayBg : colors.border,
                                },
                            ]}
                        >
                            <Text style={[styles.confirmText, { color: colors.selectedDayText }]}>
                                지도에서 상세 경로 보기
                            </Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {!isRouteSelectionStage && (
            <View style={styles.bottomOverlay} pointerEvents={isBottomSheetHidden ? "none" : "box-none"}>
                <Animated.View
                    pointerEvents={isBottomSheetHidden ? "none" : "auto"}
                    onLayout={(event) => {
                        const measured = Math.round(event.nativeEvent.layout.height);
                        setHasBottomSheetMeasured(true);
                        setBottomPanelHeight((prev) => (prev === measured ? prev : measured));
                    }}
                    style={[
                        styles.bottomPanel,
                        {
                            borderColor: isTransitDetailMode ? "transparent" : colors.border,
                            backgroundColor: detailPanelBg,
                            maxHeight: isTransitDetailMode ? 760 : 560,
                            transform: [{ translateY: bottomSheetTranslateY }],
                        },
                    ]}
                >
                    <View style={styles.bottomHandleTouchArea} {...bottomHandlePanResponder.panHandlers}>
                        <View
                            style={[
                                styles.bottomHandle,
                                {
                                    backgroundColor: colors.border,
                                    opacity: 0.75,
                                },
                            ]}
                        />
                    </View>
                    <ScrollView
                        contentContainerStyle={[
                            styles.bottomPanelScrollContent,
                            { paddingBottom: Math.max(insets.bottom + (isTransitDetailMode ? 104 : 8), 12) },
                        ]}
                        keyboardShouldPersistTaps="handled"
                        scrollEnabled={!isBottomSheetCollapsed}
                        bounces={false}
                        alwaysBounceVertical={false}
                    >
                        {!hasRouteReady ? (
                            <View style={[styles.routeHintCard, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                                <Text style={[styles.routeHintText, { color: colors.textSecondary }]}>
                                    출발지와 도착지를 모두 선택하면 경로 정보가 표시됩니다.
                                </Text>
                            </View>
                        ) : (
                            <>
                                {travelMode === "CAR" && (
                                    <Text style={[styles.summary, { color: colors.textSecondary }]}>
                                        {etaLoading ? "실시간 교통 반영 ETA 계산 중..." : "실시간 교통 기준으로 약 45초마다 ETA를 갱신합니다."}
                                    </Text>
                                )}
                                {etaSource === "fallback" && !etaLoading && (
                                    <Text style={[styles.summary, { color: colors.textDisabled, fontSize: 11 }]}>
                                        {etaFallbackKind === "road"
                                            ? "API 보조 경로를 사용해 도로 기반으로 보정했습니다."
                                            : "API 응답이 없어 직선거리 기반으로 추정했습니다."}
                                    </Text>
                                )}

                                <View style={[
                                    styles.alternativeSection,
                                    {
                                        borderColor: isTransitDetailMode ? "transparent" : colors.border,
                                        backgroundColor: detailPanelBg,
                                    },
                                ]}>
                                    {travelMode === "TRANSIT" && !isTransitDetailMode && !etaLoading && !alternativesError && !!routeAlternatives.length && (
                                        <>
                                            <View style={[styles.transitDepartureRow, { borderBottomColor: detailBorderColor }]}>
                                                <Text style={[styles.transitDepartureText, { color: detailPrimaryText }]}>
                                                    {formatTransitDepartureNow()}
                                                </Text>
                                                <Text numberOfLines={1} style={[styles.transitDepartureHint, { color: detailSecondaryText }]}>
                                                    {selectedAlternative?.transitModeSummary ?? "대중교통 경로"}
                                                </Text>
                                            </View>
                                        </>
                                    )}

                                    {etaLoading ? (
                                        <View style={styles.alternativeLoadingRow}>
                                            <ActivityIndicator size="small" color={colors.selectedDayBg} />
                                            <Text style={[styles.alternativeLoadingText, { color: colors.textSecondary }]}>경로 옵션 계산 중...</Text>
                                        </View>
                                    ) : null}

                                    {!etaLoading && !!alternativesError ? (
                                        <Text style={[styles.alternativeErrorText, { color: colors.textSecondary }]}>{alternativesError}</Text>
                                    ) : null}

                                    {!etaLoading && !alternativesError && !routeAlternatives.length ? (
                                        <Text style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}>표시할 대안 경로가 없습니다.</Text>
                                    ) : null}

                                    {!etaLoading && !alternativesError && !!routeAlternatives.length && !visibleAlternatives.length ? (
                                        <Text style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}>선택한 필터에 해당하는 경로가 없습니다.</Text>
                                    ) : null}

                                    {!etaLoading && !alternativesError && !!visibleAlternatives.length && (
                                        <View style={styles.selectedRouteSection}>
                                            {!!selectedAlternative && (
                                                <View
                                                    style={[
                                                        isTransitMode ? styles.transitReferenceSummaryCard : styles.transitAlternativeCard,
                                                        !isTransitMode ? styles.selectedRouteDetailCard : null,
                                                        {
                                                            borderColor: isTransitMode ? "transparent" : colors.selectedDayBg,
                                                            backgroundColor: detailCardBg,
                                                        },
                                                    ]}
                                                >
                                                    <View style={styles.selectedRouteSummaryHeader}>
                                                        <View style={styles.selectedRouteDurationBlock}>
                                                            <Text style={[styles.selectedRouteOptimalText, { color: isTransitDetailMode ? transitDetailControlText : colors.selectedDayBg }]}>
                                                                최적
                                                            </Text>
                                                            <Text style={[styles.transitDurationLarge, { color: detailPrimaryText }]}>
                                                                {formatDuration(selectedAlternative.minutes)}
                                                            </Text>
                                                        </View>
                                                    </View>

                                                    {!!selectedTransitTimeRange && isTransitMode && (
                                                        <Text style={[styles.transitReferenceMetaText, { color: detailSecondaryText }]}>
                                                            {selectedTransitTimeRange}
                                                        </Text>
                                                    )}

                                                    {!isTransitMode && (
                                                        <Text style={[styles.selectedRouteSummaryText, { color: detailPrimaryText }]}>
                                                            {formatAlternativeInfo(selectedAlternative)}
                                                        </Text>
                                                    )}

                                                    {isTransitMode && selectedTransitProgressSegments.length > 0 && (
                                                        <>
                                                            <View style={styles.transitProgressTrack}>
                                                                {selectedTransitProgressSegments.map((segment, index) => (
                                                                    <View
                                                                        key={segment.key}
                                                                        style={[
                                                                            styles.transitProgressSegment,
                                                                            {
                                                                                flex: segment.flex,
                                                                                backgroundColor: segment.color,
                                                                                marginLeft: index === 0 ? 0 : 3,
                                                                            },
                                                                        ]}
                                                                    >
                                                                        <Text numberOfLines={1} style={styles.transitProgressSegmentText}>
                                                                            {segment.label}
                                                                        </Text>
                                                                    </View>
                                                                ))}
                                                            </View>
                                                            <View style={styles.transitProgressLineLabelRow}>
                                                                {selectedTransitProgressSegments.map((segment, index) => (
                                                                    <View
                                                                        key={`${segment.key}-line`}
                                                                        style={[
                                                                            styles.transitProgressLineLabelCell,
                                                                            {
                                                                                flex: segment.flex,
                                                                                marginLeft: index === 0 ? 0 : 3,
                                                                            },
                                                                        ]}
                                                                    >
                                                                        {!!segment.lineLabel && (
                                                                            <Text numberOfLines={1} style={[styles.transitProgressLineLabelText, { color: segment.color }]}>
                                                                                {segment.lineLabel}
                                                                            </Text>
                                                                        )}
                                                                    </View>
                                                                ))}
                                                            </View>
                                                        </>
                                                    )}

                                                    {isTransitMode && (
                                                        <View style={[styles.transitDetailBaseTimeRow, { borderTopColor: detailBorderColor }]}>
                                                            <Text style={[styles.transitDetailBaseTimeText, { color: detailSecondaryText }]}>
                                                                {formatTransitClock(selectedRouteDepartureAt)} 기준
                                                            </Text>
                                                        </View>
                                                    )}
                                                    {!isTransitMode && selectedAlternativeTransitModeLabels.length > 0 && (
                                                        <View style={styles.transitModeChipRow}>
                                                            {selectedAlternativeTransitModeLabels.map((modeLabel) => (
                                                                <View
                                                                    key={`selected-${modeLabel}`}
                                                                    style={[
                                                                        styles.transitModeChip,
                                                                        { borderColor: colors.border, backgroundColor: overlayPanelBg },
                                                                    ]}
                                                                >
                                                                    <Text style={[styles.transitModeChipText, { color: colors.textPrimary }]}>
                                                                        {modeLabel}
                                                                    </Text>
                                                                </View>
                                                            ))}
                                                        </View>
                                                    )}

                                                    {!isTransitMode && selectedAlternativeMetricTags.length > 0 && (
                                                        <View style={styles.transitMetricTagRow}>
                                                            {selectedAlternativeMetricTags.map((metric) => (
                                                                <View
                                                                    key={`selected-${metric}`}
                                                                    style={[
                                                                        styles.transitMetricTag,
                                                                        { borderColor: colors.border, backgroundColor: overlayPanelBg },
                                                                    ]}
                                                                >
                                                                    <Text style={[styles.transitMetricTagText, { color: colors.textPrimary }]}>
                                                                        {metric}
                                                                    </Text>
                                                                </View>
                                                            ))}
                                                        </View>
                                                    )}

                                                    {!!selectedAlternativeStepPreview && (!Array.isArray(selectedAlternative.transitLegs) || selectedAlternative.transitLegs.length === 0) && (
                                                        <Text style={[styles.selectedRouteBodyText, { color: colors.textSecondary }]}>
                                                            {selectedAlternativeStepPreview}
                                                        </Text>
                                                    )}
                                                </View>
                                            )}

                                            {Array.isArray(selectedAlternative?.transitLegs) && selectedAlternative.transitLegs.length > 0 && (
                                                isTransitMode ? (
                                                    <View style={styles.transitReferenceTimeline}>
                                                        {selectedAlternative.transitLegs.map((leg, legIndex) => {
                                                            const kindMeta = getTransitLegKindMeta(leg.kind);
                                                            const legMetaText = buildTransitLegMeta(leg);
                                                            const timelineTitle = buildTransitDetailTimelineTitle(
                                                                leg,
                                                                legIndex,
                                                                selectedAlternative.transitLegs ?? [],
                                                                originDisplay,
                                                                destinationDisplay
                                                            );
                                                            const assistText = buildTransitLegAssistText(selectedAlternative.transitLegs, legIndex);
                                                            const rideLineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
                                                            const rideDetailText = buildTransitRideDetailText(leg);
                                                            const rideStopSummaryText = buildTransitStopMoveSummary(leg);
                                                            const rideDisplayStops = getTransitLegDisplayStops(leg);
                                                            const stopListKey = `${selectedAlternative.id}-stop-list-${legIndex}`;
                                                            const canToggleStops = isRideLegKind(leg.kind) && rideDisplayStops.length > 0;
                                                            const isStopListExpanded = !!expandedTransitStopKeys[stopListKey];
                                                            const isFocusedLeg = focusedTransitLegIndex === legIndex;
                                                            const isLastLeg = legIndex === selectedAlternative.transitLegs!.length - 1;
                                                            const dotText = leg.kind === "WALK" && legIndex === 0 ? "출" : kindMeta.short;
                                                            const dotColor = leg.kind === "WALK" && legIndex === 0 ? ORIGIN_COLOR : kindMeta.color;
                                                            const lineColor = leg.kind === "WALK" ? detailBorderColor : getTransitLegVisualColor(leg);
                                                            return (
                                                                <Pressable
                                                                    key={`${selectedAlternative.id}-timeline-${legIndex}`}
                                                                    onPress={() => focusMapOnTransitLeg(legIndex)}
                                                                    style={[
                                                                        styles.transitTimelineItem,
                                                                        isFocusedLeg ? { backgroundColor: transitFocusedLegBg } : null,
                                                                    ]}
                                                                >
                                                                    <View style={styles.transitTimelineRail}>
                                                                        <View style={[styles.transitTimelineDot, { backgroundColor: dotColor }]}>
                                                                            <Text style={styles.transitTimelineDotText}>{dotText}</Text>
                                                                        </View>
                                                                        {!isLastLeg && (
                                                                            <View style={[styles.transitTimelineLine, { backgroundColor: lineColor }]} />
                                                                        )}
                                                                    </View>
                                                                    <View style={styles.transitTimelineContent}>
                                                                        <View style={styles.transitTimelineTopRow}>
                                                                            <Text numberOfLines={2} style={[styles.transitTimelineTitle, { color: detailPrimaryText }]}>
                                                                                {timelineTitle}
                                                                            </Text>
                                                                            {!!legMetaText && (
                                                                                <Text numberOfLines={1} style={[styles.transitTimelineMeta, { color: detailSecondaryText }]}>
                                                                                    {legMetaText}
                                                                                </Text>
                                                                            )}
                                                                        </View>
                                                                        {!!assistText && (
                                                                            <Text numberOfLines={2} style={[styles.transitTimelineAssist, { color: detailSecondaryText }]}>
                                                                                {assistText}
                                                                            </Text>
                                                                        )}
                                                                        {isRideLegKind(leg.kind) && !!rideLineLabel && (
                                                                            <View style={[styles.transitTimelineRideCard, { borderColor: detailBorderColor }]}>
                                                                                <View style={[styles.transitTimelineRideBadge, { backgroundColor: getTransitLegVisualColor(leg) }]}>
                                                                                    <Text numberOfLines={1} style={styles.transitTimelineRideBadgeText}>
                                                                                        {rideLineLabel}
                                                                                    </Text>
                                                                                </View>
                                                                                {!!rideDetailText && (
                                                                                    <Text numberOfLines={1} style={[styles.transitTimelineRideText, { color: detailSecondaryText }]}>
                                                                                        {rideDetailText}
                                                                                    </Text>
                                                                                )}
                                                                            </View>
                                                                        )}
                                                                        {isRideLegKind(leg.kind) && !!rideStopSummaryText && (
                                                                            <Pressable
                                                                                disabled={!canToggleStops}
                                                                                onPress={(event) => {
                                                                                    event.stopPropagation();
                                                                                    if (canToggleStops) toggleTransitStopList(stopListKey);
                                                                                }}
                                                                                style={[styles.transitStopToggleRow, { borderTopColor: detailBorderColor }]}
                                                                            >
                                                                                <Text
                                                                                    numberOfLines={1}
                                                                                    style={[
                                                                                        styles.transitStopToggleText,
                                                                                        { color: canToggleStops ? detailSecondaryText : colors.textDisabled },
                                                                                    ]}
                                                                                >
                                                                                    {rideStopSummaryText}
                                                                                </Text>
                                                                                {canToggleStops && (
                                                                                    <Text style={[styles.transitStopToggleChevron, { color: detailSecondaryText }]}>
                                                                                        {isStopListExpanded ? "⌃" : "⌄"}
                                                                                    </Text>
                                                                                )}
                                                                            </Pressable>
                                                                        )}
                                                                        {isStopListExpanded && (
                                                                            <View style={styles.transitStopList}>
                                                                                {rideDisplayStops.map((stop, stopIndex) => (
                                                                                    <View
                                                                                        key={`${stopListKey}-${stop.sequence ?? stopIndex}-${stop.name}`}
                                                                                        style={styles.transitStopListItem}
                                                                                    >
                                                                                        <View style={[styles.transitStopListDot, { backgroundColor: lineColor }]} />
                                                                                        <Text numberOfLines={2} style={[styles.transitStopListText, { color: detailPrimaryText }]}>
                                                                                            {stop.name}
                                                                                        </Text>
                                                                                    </View>
                                                                                ))}
                                                                            </View>
                                                                        )}
                                                                    </View>
                                                                </Pressable>
                                                            );
                                                        })}
                                                    </View>
                                                ) : (
                                                    <View style={[styles.selectedRouteLegSection, { borderColor: colors.border, backgroundColor: overlayCardBg }]}>
                                                        <Text style={[styles.selectedRouteSectionTitle, { color: colors.textPrimary }]}>
                                                            선택한 경로 상세
                                                        </Text>
                                                        <View style={styles.transitLegList}>
                                                            {selectedAlternative.transitLegs.map((leg, legIndex) => {
                                                                const kindMeta = getTransitLegKindMeta(leg.kind);
                                                                const legMetaText = buildTransitLegMeta(leg);
                                                                const fromTo = leg.startName && leg.endName
                                                                    ? `${leg.startName} → ${leg.endName}`
                                                                    : "";
                                                                const assistText = buildTransitLegAssistText(selectedAlternative.transitLegs, legIndex);
                                                                const isFocusedLeg = focusedTransitLegIndex === legIndex;
                                                                return (
                                                                    <Pressable
                                                                        key={`${selectedAlternative.id}-leg-${legIndex}`}
                                                                        onPress={() => focusMapOnTransitLeg(legIndex)}
                                                                        style={[
                                                                            styles.transitLegItemCard,
                                                                            styles.selectedRouteLegItemCard,
                                                                            {
                                                                                borderColor: isFocusedLeg ? colors.selectedDayBg : colors.border,
                                                                                backgroundColor: isFocusedLeg
                                                                                    ? (isDark ? "rgba(29,114,255,0.22)" : "#EAF2FF")
                                                                                    : overlayPanelBg,
                                                                            },
                                                                        ]}
                                                                    >
                                                                        <View style={styles.transitLegRow}>
                                                                            <View style={[styles.transitLegKindDot, { backgroundColor: kindMeta.color }]}>
                                                                                <Text style={styles.transitLegKindDotText}>{kindMeta.short}</Text>
                                                                            </View>
                                                                            <View style={styles.transitLegTextWrap}>
                                                                                <View style={styles.transitLegPrimaryRow}>
                                                                                    <Text numberOfLines={1} style={[styles.transitLegLabel, { color: colors.textPrimary }]}>
                                                                                        {leg.label}
                                                                                    </Text>
                                                                                    {!!legMetaText && (
                                                                                        <Text numberOfLines={1} style={[styles.transitLegMeta, { color: colors.textSecondary }]}>
                                                                                            {legMetaText}
                                                                                        </Text>
                                                                                    )}
                                                                                </View>
                                                                                {!assistText && !!fromTo && (
                                                                                    <Text numberOfLines={1} style={[styles.transitLegFromTo, { color: colors.textDisabled }]}>
                                                                                        {fromTo}
                                                                                    </Text>
                                                                                )}
                                                                                {!!assistText && (
                                                                                    <Text numberOfLines={2} style={[styles.transitLegAssist, { color: colors.textSecondary }]}>
                                                                                        {assistText}
                                                                                    </Text>
                                                                                )}
                                                                            </View>
                                                                        </View>
                                                                    </Pressable>
                                                                );
                                                            })}
                                                        </View>
                                                    </View>
                                                )
                                            )}
                                        </View>
                                    )}
                                </View>

                                {!isTransitDetailMode && (
                                    <Pressable onPress={submit} style={[styles.confirmBtn, { backgroundColor: colors.selectedDayBg }]}>
                                        <Text style={[styles.confirmText, { color: colors.selectedDayText }]}>경로 저장</Text>
                                    </Pressable>
                                )}
                            </>
                        )}
                    </ScrollView>
                </Animated.View>
                {isTransitDetailMode && !!selectedAlternative && !isBottomSheetHidden && (
                    <View
                        style={[
                            styles.transitDetailActionBar,
                            {
                                backgroundColor: transitActionBarBg,
                                borderTopColor: detailBorderColor,
                                paddingBottom: Math.max(insets.bottom - 4, 8),
                            },
                        ]}
                    >
                        <View style={styles.transitDetailActionEta}>
                            <Text style={[styles.transitDetailActionDuration, { color: transitDetailControlText }]}>
                                {formatDuration(selectedAlternative.minutes)}
                            </Text>
                            {!!selectedTransitTimeRange && (
                                <Text style={[styles.transitDetailActionArrival, { color: transitDetailControlText }]}>
                                    {selectedTransitTimeRange.split(" | ")[0]?.split(" - ")[1] ?? "도착 시간 확인"}
                                    {" 도착"}
                                </Text>
                            )}
                        </View>
                        <Pressable style={[styles.transitDetailPreviewButton, { borderColor: detailBorderColor }]}>
                            <Text style={[styles.transitDetailPreviewText, { color: transitDetailControlText }]}>버스 미리보기</Text>
                        </Pressable>
                        <Pressable
                            onPress={submit}
                            style={[styles.transitDetailStartButton, { backgroundColor: transitDetailPrimaryActionBg }]}
                        >
                            <Text style={[styles.transitDetailStartText, { color: transitDetailPrimaryActionText }]}>안내시작</Text>
                        </Pressable>
                    </View>
                )}
            </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    transitReferenceScreen: {
        flex: 1,
        backgroundColor: "#1C1C1E",
    },
    transitReferenceScrollContent: {
        backgroundColor: "#1C1C1E",
    },
    transitReferenceAddressCard: {
        marginHorizontal: 16,
        borderWidth: 1,
        borderColor: "#303033",
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: "#1D1D1F",
    },
    transitReferenceRouteRows: {
        minHeight: 74,
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 6,
    },
    transitReferenceSwapRail: {
        width: 36,
        alignItems: "flex-start",
        justifyContent: "center",
    },
    transitReferenceSwapText: {
        color: "#A9A9AC",
        fontSize: 24,
        fontWeight: "700",
    },
    transitReferenceAddressContent: {
        flex: 1,
    },
    transitReferenceAddressRow: {
        minHeight: 31,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    transitReferencePointDot: {
        width: 12,
        height: 12,
        borderRadius: 999,
        borderWidth: 3,
    },
    transitReferenceOriginDot: {
        borderColor: "rgba(33,184,90,0.36)",
        backgroundColor: "#21B85A",
    },
    transitReferenceDestinationDot: {
        borderColor: "rgba(255,106,61,0.35)",
        backgroundColor: "#FF563D",
    },
    transitReferenceAddressText: {
        flex: 1,
        color: "#E5E5EA",
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: -0.2,
        lineHeight: 22,
    },
    transitReferenceCloseButton: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    transitReferenceCloseText: {
        color: "#A5A5AA",
        fontSize: 30,
        fontWeight: "300",
        lineHeight: 30,
    },
    transitReferenceMoreText: {
        width: 28,
        color: "#8E8E93",
        fontSize: 24,
        lineHeight: 27,
        textAlign: "center",
    },
    transitReferenceAddressDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 30,
        backgroundColor: "#343438",
    },
    transitReferenceEntranceRow: {
        minHeight: 36,
        paddingHorizontal: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#2C2C2E",
    },
    transitReferenceEntranceLabel: {
        color: "#A7A7AA",
        fontSize: 14,
        fontWeight: "900",
    },
    transitReferenceEntranceAction: {
        color: "#4D9BFF",
        fontSize: 14,
        fontWeight: "900",
    },
    transitReferenceModeRow: {
        height: 56,
        marginTop: 8,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#2D2D30",
    },
    transitReferenceModeButton: {
        minWidth: 72,
        minHeight: 38,
        borderRadius: 999,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    transitReferenceModeButtonSelected: {
        minWidth: 132,
        backgroundColor: "#5AA0FF",
    },
    transitReferenceModeText: {
        color: "#C7C7CC",
        fontSize: 15,
        fontWeight: "900",
    },
    transitReferenceModeTextSelected: {
        color: "#0B0B0C",
        fontSize: 17,
    },
    transitReferenceFilterRow: {
        height: 56,
        flexDirection: "row",
        alignItems: "flex-end",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#303033",
        paddingHorizontal: 16,
        gap: 24,
    },
    transitReferenceFilterTab: {
        minHeight: 54,
        justifyContent: "flex-end",
        paddingBottom: 11,
    },
    transitReferenceFilterText: {
        color: "#8F8F94",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 22,
    },
    transitReferenceFilterTextSelected: {
        color: "#E5E5EA",
    },
    transitReferenceFilterUnderline: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 3,
        backgroundColor: "#E5E5EA",
    },
    transitReferenceControlRow: {
        height: 58,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#303033",
    },
    transitReferenceDepartureText: {
        color: "#D7D7DA",
        fontSize: 15,
        fontWeight: "900",
    },
    transitReferenceDepartureBlue: {
        color: "#4D9BFF",
    },
    transitReferenceSortText: {
        color: "#D2D2D5",
        fontSize: 15,
        fontWeight: "800",
    },
    transitReferenceDetailPanel: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 24,
        backgroundColor: "#1F1F1F",
    },
    transitReferenceNoticeCard: {
        minHeight: 40,
        borderRadius: 10,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#2C2C2E",
    },
    transitReferenceNoticeText: {
        flex: 1,
        color: "#D7D7DA",
        fontSize: 14,
        fontWeight: "900",
    },
    transitReferenceNoticeClose: {
        color: "#C7C7CC",
        fontSize: 24,
        fontWeight: "300",
        lineHeight: 26,
    },
    transitReferenceLoadingRow: {
        minHeight: 120,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    transitReferenceLoadingText: {
        color: "#B8B8B8",
        fontSize: 14,
        fontWeight: "800",
    },
    transitReferenceStateText: {
        color: "#B8B8B8",
        paddingVertical: 28,
        fontSize: 14,
        fontWeight: "800",
        textAlign: "center",
    },
    transitReferenceSummaryHeader: {
        marginTop: 16,
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    transitReferenceSummaryMain: {
        flex: 1,
    },
    transitReferenceOptimalText: {
        color: "#4D9BFF",
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 18,
        marginBottom: 4,
    },
    transitReferenceDurationText: {
        color: "#F2F2F7",
        fontSize: 36,
        fontWeight: "900",
        letterSpacing: -1.4,
        lineHeight: 41,
    },
    transitReferenceRouteMetaText: {
        color: "#C7C7CC",
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 21,
        marginTop: 3,
    },
    transitReferenceFeedbackButton: {
        marginTop: 7,
        borderWidth: 1,
        borderColor: "#4A4A4D",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    transitReferenceFeedbackText: {
        color: "#D3D3D6",
        fontSize: 13,
        fontWeight: "900",
    },
    transitReferenceRouteSummaryText: {
        color: "#F2F2F7",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 22,
        marginTop: 8,
    },
    transitReferenceProgressTrack: {
        height: 21,
        marginTop: 8,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 999,
        overflow: "hidden",
    },
    transitReferenceProgressSegment: {
        height: "100%",
        minWidth: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    transitReferenceProgressText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "900",
    },
    transitReferenceFullTimeline: {
        marginTop: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#323235",
        paddingTop: 12,
    },
    transitReferenceTimelineItem: {
        flexDirection: "row",
        minHeight: 62,
        borderRadius: 12,
    },
    transitReferenceTimelineItemFocused: {
        backgroundColor: "rgba(77,155,255,0.14)",
    },
    transitReferenceTimelineRail: {
        width: 40,
        alignItems: "center",
    },
    transitReferenceTimelineDot: {
        width: 24,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
    transitReferenceTimelineDotText: {
        color: "#FFFFFF",
        fontSize: 13,
        fontWeight: "900",
    },
    transitReferenceTimelineLine: {
        width: 2,
        flex: 1,
        marginTop: 5,
        marginBottom: 5,
        backgroundColor: "#38383B",
    },
    transitReferenceTimelineContent: {
        flex: 1,
        paddingBottom: 13,
        gap: 4,
    },
    transitReferenceTimelineTopRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    transitReferenceTimelineTitle: {
        flex: 1,
        color: "#F2F2F7",
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 23,
        letterSpacing: -0.5,
    },
    transitReferenceTimelineMeta: {
        flexShrink: 0,
        color: "#B8B8B8",
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 20,
    },
    transitReferenceTimelineAssist: {
        color: "#B8B8B8",
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 20,
    },
    transitReferenceGuideButton: {
        minHeight: 56,
        marginTop: 10,
        borderWidth: 1,
        borderColor: "#55555A",
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    transitReferenceGuideText: {
        color: "#4D9BFF",
        fontSize: 17,
        fontWeight: "900",
    },
    container: {
        flex: 1,
    },
    fullMap: {
        ...StyleSheet.absoluteFillObject,
    },
    transitMapDimOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.34)",
    },
    mapFallbackFull: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
    },
    transitMapRouteHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingBottom: 8,
    },
    transitMapBackButton: {
        width: 54,
        height: 54,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(18,18,18,0.94)",
    },
    transitMapBackText: {
        color: "#FFFFFF",
        fontSize: 46,
        fontWeight: "300",
        lineHeight: 50,
        marginTop: -4,
    },
    transitMapRouteChipContent: {
        gap: 8,
        paddingRight: 18,
    },
    transitMapRouteChip: {
        height: 46,
        maxWidth: 250,
        borderRadius: 999,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(18,18,18,0.94)",
    },
    transitMapRouteChipSelected: {
        backgroundColor: "#5AA0FF",
    },
    transitMapRouteChipText: {
        color: "#D7D7DA",
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: -0.2,
    },
    transitMapRouteChipTextSelected: {
        color: "#101114",
    },
    topOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 12,
        gap: 7,
    },
    searchOverlayRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    inlineCloseBtn: {
        width: 54,
        height: 54,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineCloseBtnText: {
        fontSize: 46,
        fontWeight: "300",
        lineHeight: 52,
        marginTop: -4,
    },
    searchField: {
        flex: 1,
    },
    searchInputWrap: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 11,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 8,
        fontSize: 15,
        fontWeight: "600",
    },
    searchIcon: {
        paddingLeft: 8,
        justifyContent: "center",
        alignItems: "center",
    },
    targetCompactWrap: {
        width: 84,
        minHeight: 38,
        borderWidth: 1,
        borderRadius: 12,
        flexDirection: "row",
        padding: 3,
        gap: 3,
    },
    targetCompactBtn: {
        flex: 1,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    targetCompactBtnActiveOrigin: {
        backgroundColor: ORIGIN_COLOR,
    },
    targetCompactBtnActiveDestination: {
        backgroundColor: DESTINATION_COLOR,
    },
    targetCompactText: {
        fontSize: 12,
        fontWeight: "800",
    },
    targetCompactTextActive: {
        color: "#FFFFFF",
    },
    searchResultWrap: {
        maxHeight: 220,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        overflow: "hidden",
    },
    searchResultItem: {
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    routePreviewCard: {
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 9,
        gap: 4,
    },
    overlaySurface: {
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
    },
    routePreviewMain: {
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 18,
    },
    routePreviewSub: {
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 15,
    },
    routePreviewActionRow: {
        marginTop: 2,
        flexDirection: "row",
        justifyContent: "flex-end",
    },
    routePreviewActionBtn: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    routePreviewActionText: {
        fontSize: 11,
        fontWeight: "800",
    },
    transitLegendInlineRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
    transitLegendInlineChip: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    transitLegendHintText: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 14,
    },
    transitLegendSwatch: {
        width: 14,
        height: 6,
        borderRadius: 99,
    },
    transitLegendText: {
        fontSize: 11,
        fontWeight: "800",
    },
    routeSelectionStageOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: "flex-end",
        paddingHorizontal: 12,
        paddingBottom: 8,
    },
    routeSelectionStagePanel: {
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingTop: 12,
        maxHeight: "68%",
        gap: 10,
    },
    routeSelectionStageTitle: {
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 22,
    },
    routeSelectionStageSubtitle: {
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 16,
    },
    routeSelectionStageListWrap: {
        borderWidth: 1,
        borderRadius: 12,
        minHeight: 170,
        maxHeight: 330,
        overflow: "hidden",
    },
    routeSelectionStageList: {
        paddingHorizontal: 10,
        paddingVertical: 10,
        gap: 8,
    },
    routeSelectionStageCard: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 4,
    },
    routeSelectionStageCardTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    routeSelectionStageDuration: {
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: -0.4,
    },
    routeSelectionStageSummary: {
        fontSize: 12,
        fontWeight: "700",
    },
    routeSelectionStageStep: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
    },
    zoomOverlay: {
        position: "absolute",
        right: 12,
        top: "46%",
        zIndex: 20,
    },
    zoomControlCard: {
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
    zoomControlBtn: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    zoomControlText: {
        fontSize: 26,
        fontWeight: "700",
        lineHeight: 30,
        marginTop: -2,
    },
    zoomDivider: {
        height: StyleSheet.hairlineWidth,
        width: "100%",
    },
    bottomOverlay: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 0,
        paddingBottom: 0,
    },
    bottomPanel: {
        borderWidth: 1,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: 560,
        overflow: "hidden",
    },
    bottomHandleTouchArea: {
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 6,
        paddingBottom: 4,
    },
    bottomHandle: {
        width: 46,
        height: 5,
        borderRadius: 2,
        alignSelf: "center",
        marginTop: 0,
        marginBottom: 0,
    },
    bottomPanelScrollContent: {
        paddingHorizontal: 12,
        gap: 10,
    },
    routeHintCard: {
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 12,
    },
    routeHintText: {
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
    modeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        gap: 8,
    },
    modeChip: {
        minWidth: 72,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 13,
        alignItems: "center",
        justifyContent: "center",
    },
    summary: {
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 17,
    },
    alternativeSection: {
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
    transitFilterRow: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    transitFilterRowContent: {
        paddingHorizontal: 12,
        paddingTop: 10,
        gap: 18,
    },
    transitFilterTab: {
        paddingBottom: 10,
        borderBottomWidth: 3,
    },
    transitFilterTabText: {
        fontSize: 14,
        fontWeight: "800",
    },
    transitDepartureRow: {
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 3,
    },
    transitDepartureText: {
        fontSize: 17,
        fontWeight: "800",
    },
    transitDepartureHint: {
        fontSize: 13,
        fontWeight: "600",
        lineHeight: 18,
    },
    alternativeLoadingRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    alternativeLoadingText: {
        fontSize: 12,
    },
    alternativeErrorText: {
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    alternativeEmptyText: {
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    selectedRouteSection: {
        paddingHorizontal: 10,
        paddingVertical: 10,
        gap: 10,
    },
    routeChipSelectorScroll: {
        marginHorizontal: -10,
    },
    routeChipSelectorContent: {
        paddingHorizontal: 10,
        gap: 8,
    },
    routeChipSelector: {
        minWidth: 132,
        maxWidth: 194,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 4,
    },
    routeChipSelectorTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    routeChipSelectorLabel: {
        fontSize: 12,
        fontWeight: "800",
    },
    routeChipSelectorDuration: {
        fontSize: 13,
        fontWeight: "900",
    },
    routeChipSelectorSummary: {
        fontSize: 11,
        fontWeight: "600",
    },
    alternativeScrollContent: {
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    transitAlternativeList: {
        paddingHorizontal: 10,
        paddingVertical: 10,
        gap: 8,
    },
    transitAlternativeCard: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 13,
        paddingVertical: 12,
        gap: 9,
    },
    transitReferenceSummaryCard: {
        paddingHorizontal: 0,
        paddingTop: 12,
        paddingBottom: 8,
        gap: 8,
    },
    selectedRouteDetailCard: {
        gap: 10,
    },
    selectedRouteSummaryHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    selectedRouteDurationBlock: {
        alignItems: "flex-start",
        gap: 2,
    },
    selectedRouteOptimalText: {
        fontSize: 13,
        fontWeight: "900",
        lineHeight: 17,
    },
    selectedRouteSummaryText: {
        fontSize: 16,
        fontWeight: "800",
        lineHeight: 22,
    },
    transitReferenceMetaText: {
        fontSize: 14,
        fontWeight: "700",
        lineHeight: 19,
    },
    transitProgressTrack: {
        flexDirection: "row",
        alignItems: "center",
        height: 22,
        borderRadius: 999,
        overflow: "hidden",
        marginTop: 2,
    },
    transitProgressSegment: {
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        minWidth: 26,
    },
    transitProgressSegmentText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "900",
        lineHeight: 13,
    },
    transitProgressLineLabelRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        minHeight: 16,
        marginTop: 3,
    },
    transitProgressLineLabelCell: {
        minWidth: 26,
        alignItems: "center",
    },
    transitProgressLineLabelText: {
        fontSize: 11,
        fontWeight: "900",
        lineHeight: 14,
    },
    transitDetailBaseTimeRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 12,
        paddingTop: 12,
    },
    transitDetailBaseTimeText: {
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
    },
    selectedRouteBodyText: {
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 18,
    },
    selectedRouteLegSection: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 10,
    },
    selectedRouteSectionTitle: {
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 20,
    },
    selectedRouteLegItemCard: {
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    transitDurationLarge: {
        fontSize: 30,
        fontWeight: "900",
        letterSpacing: -0.6,
    },
    alternativePage: {
        paddingHorizontal: 0,
        paddingVertical: 0,
    },
    alternativeCard: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 9,
        justifyContent: "space-between",
        marginHorizontal: 0,
    },
    alternativeTopRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
    },
    alternativeRouteLabel: {
        fontSize: 12,
        fontWeight: "800",
    },
    alternativeDuration: {
        fontSize: 18,
        fontWeight: "900",
        letterSpacing: -0.3,
    },
    transitModeChipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 5,
    },
    transitModeChip: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    transitModeChipText: {
        fontSize: 11,
        fontWeight: "700",
    },
    transitMetricTagRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    transitMetricTag: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    transitMetricTagText: {
        fontSize: 11,
        fontWeight: "700",
    },
    alternativeMeta: {
        fontSize: 12,
        fontWeight: "700",
    },
    transitLegList: {
        gap: 5,
    },
    transitReferenceTimeline: {
        paddingTop: 4,
        paddingBottom: 8,
    },
    transitTimelineItem: {
        flexDirection: "row",
        borderRadius: 10,
        minHeight: 64,
    },
    transitTimelineItemFocused: {
        backgroundColor: "rgba(47,128,255,0.16)",
    },
    transitTimelineRail: {
        width: 36,
        alignItems: "center",
        paddingTop: 2,
    },
    transitTimelineDot: {
        width: 26,
        height: 26,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
    transitTimelineDotText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "900",
        lineHeight: 14,
    },
    transitTimelineLine: {
        width: 4,
        flex: 1,
        marginTop: 4,
        marginBottom: 4,
    },
    transitTimelineContent: {
        flex: 1,
        paddingBottom: 13,
        gap: 4,
    },
    transitTimelineTopRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    transitTimelineTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 20,
    },
    transitTimelineMeta: {
        flexShrink: 0,
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 18,
    },
    transitTimelineAssist: {
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
    },
    transitTimelineRideCard: {
        minHeight: 54,
        borderWidth: 1,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 10,
        marginTop: 7,
    },
    transitTimelineRideBadge: {
        minWidth: 52,
        borderRadius: 7,
        paddingHorizontal: 8,
        paddingVertical: 5,
        alignItems: "center",
    },
    transitTimelineRideBadgeText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 18,
    },
    transitTimelineRideText: {
        flex: 1,
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 18,
    },
    transitStopToggleRow: {
        marginTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 12,
        paddingBottom: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    transitStopToggleText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 20,
    },
    transitStopToggleChevron: {
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 20,
    },
    transitStopList: {
        paddingTop: 4,
        paddingBottom: 4,
        gap: 8,
    },
    transitStopListItem: {
        minHeight: 26,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    transitStopListDot: {
        width: 6,
        height: 6,
        borderRadius: 999,
        opacity: 0.92,
    },
    transitStopListText: {
        flex: 1,
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
    },
    transitDetailActionBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: 74,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#303033",
        paddingTop: 10,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 9,
        backgroundColor: "#171717",
    },
    transitDetailActionEta: {
        flex: 1,
        paddingBottom: 2,
    },
    transitDetailActionDuration: {
        fontSize: 19,
        fontWeight: "900",
        lineHeight: 24,
    },
    transitDetailActionArrival: {
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
    },
    transitDetailPreviewButton: {
        minHeight: 44,
        borderWidth: 1,
        borderColor: "#4A4A4D",
        borderRadius: 999,
        paddingHorizontal: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    transitDetailPreviewText: {
        fontSize: 15,
        fontWeight: "900",
    },
    transitDetailStartButton: {
        minHeight: 46,
        borderRadius: 999,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    transitDetailStartText: {
        fontSize: 16,
        fontWeight: "900",
    },
    transitLegItemCard: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    transitLegRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
    },
    transitLegKindDot: {
        width: 16,
        height: 16,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    transitLegKindDotText: {
        color: "#FFFFFF",
        fontSize: 9,
        fontWeight: "800",
        lineHeight: 10,
    },
    transitLegLabel: {
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 16,
    },
    transitLegTextWrap: {
        flex: 1,
        gap: 2,
    },
    transitLegPrimaryRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    transitLegMeta: {
        fontSize: 11,
        fontWeight: "700",
        flexShrink: 0,
    },
    transitLegFromTo: {
        fontSize: 11,
        fontWeight: "500",
    },
    transitLegAssist: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
    },
    alternativeStep: {
        fontSize: 12,
        fontWeight: "500",
        lineHeight: 17,
    },
    confirmBtn: {
        minHeight: 50,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 4,
    },
    confirmText: {
        fontWeight: "700",
        fontSize: 14,
    },
});

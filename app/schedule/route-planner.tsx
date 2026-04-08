import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    ActivityIndicator,
    Animated,
    PanResponder,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
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
    type RoutePathCoord,
    type TransitLegDetail,
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
import { getRoutePlannerInitial, setRoutePlannerResult } from "../../src/modules/schedule/routePlannerSession";

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;
const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];
const ORIGIN_COLOR = "#21B85A";
const DESTINATION_COLOR = "#FF6A3D";
const SELECTED_ROUTE_COLOR = "#2F80FF";
const INACTIVE_ROUTE_COLOR = "rgba(128, 145, 166, 0.62)";
const TRANSIT_LEG_COLOR: Record<TransitLegDetail["kind"], string> = {
    SUBWAY: "#24B348",
    BUS: "#1D72FF",
    WALK: "#6B7280",
    ETC: "#94A3B8",
};
const ALTERNATIVE_CARD_GAP = 10;
const ALTERNATIVE_CARD_MIN_SIZE = 146;
const ALTERNATIVE_CARD_MAX_SIZE = 178;
const BOTTOM_SHEET_HANDLE_PEEK_HEIGHT = 24;
const TRANSIT_SEGMENT_DETAIL_MIN_ZOOM = 13.8;
const TRANSIT_BADGE_MIN_ZOOM = 14.2;
const TRANSIT_BADGE_MAX_COUNT = 30;
const TRANSIT_TRANSFER_COLOR = "#F4A100";
const KAKAO_LABEL_TEXT_COLOR = "#1F2937";
const KAKAO_LABEL_BORDER_COLOR = "rgba(148,163,184,0.62)";
const ROUTE_STYLE = {
    inactiveWidth: 4.5,
    inactiveOutlineWidth: 1.4,
    selectedWidth: 8.5,
    selectedOutlineWidth: 2.2,
    transitRideWidth: 8.5,
    transitRideOutlineWidth: 1.8,
    transitWalkWidth: 5.8,
    transitWalkOutlineWidth: 1.75,
    connectorWalkWidth: 4,
} as const;
type RoutePointTarget = "origin" | "destination";
type TransitRouteFilter = "ALL" | "BUS" | "SUBWAY" | "MIXED";
type RoutePlannerFocusTarget = "origin" | "destination" | "startRide" | "firstSubway";
type DebugSheetState = "collapsed" | "hidden" | "expanded";
const DEBUG_FOCUS_MIN_ZOOM = 5;
const DEBUG_FOCUS_MAX_ZOOM = 18;
const INACTIVE_MAP_ALTERNATIVE_LIMIT = 2;

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

function getTransitLegVisualColor(leg: Pick<TransitLegDetail, "kind" | "lineName">): string {
    if (leg.kind === "SUBWAY") return getSubwayLineColor(leg.lineName);
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
    maxMarkers: number
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
                badgeBorderColor: "rgba(255,255,255,0.96)",
                displayType: "arrow",
                rotationDeg: heading,
            });
            nextDistance += spacingMeters;
        }

        traveled += segmentDistance;
    }

    return markers;
}

function samplePathCoordAtDistance(
    pathCoords: RoutePathCoord[] | undefined,
    distanceMeters: number,
    fromEnd = false
): RoutePathCoord | undefined {
    if (!Array.isArray(pathCoords) || pathCoords.length === 0) return undefined;
    if (pathCoords.length === 1) return pathCoords[0];
    const target = Math.max(0, distanceMeters);
    if (!fromEnd) {
        let traveled = 0;
        for (let index = 1; index < pathCoords.length; index += 1) {
            const from = pathCoords[index - 1];
            const to = pathCoords[index];
            const segmentDistance = routeCoordDistanceMeters(from, to);
            if (!Number.isFinite(segmentDistance) || segmentDistance <= 0.1) continue;
            if ((traveled + segmentDistance) >= target) {
                return interpolateRouteCoord(from, to, (target - traveled) / segmentDistance);
            }
            traveled += segmentDistance;
        }
        return pathCoords[pathCoords.length - 1];
    }

    let traveled = 0;
    for (let index = pathCoords.length - 1; index > 0; index -= 1) {
        const from = pathCoords[index];
        const to = pathCoords[index - 1];
        const segmentDistance = routeCoordDistanceMeters(from, to);
        if (!Number.isFinite(segmentDistance) || segmentDistance <= 0.1) continue;
        if ((traveled + segmentDistance) >= target) {
            return interpolateRouteCoord(from, to, (target - traveled) / segmentDistance);
        }
        traveled += segmentDistance;
    }
    return pathCoords[0];
}

function getPathTotalDistanceMeters(pathCoords: RoutePathCoord[] | undefined): number {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return 0;
    let total = 0;
    for (let index = 1; index < pathCoords.length; index += 1) {
        total += routeCoordDistanceMeters(pathCoords[index - 1], pathCoords[index]);
    }
    return total;
}

function resolveTransitPinDistanceMeters(
    totalDistanceMeters: number,
    ratio: number,
    minDistanceMeters: number,
    maxDistanceMeters: number,
    edgePaddingMeters: number
): number | undefined {
    if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) return undefined;
    const upperBound = Math.max(18, Math.min(maxDistanceMeters, totalDistanceMeters - edgePaddingMeters));
    if (!Number.isFinite(upperBound) || upperBound < 18) return undefined;
    const lowerBound = Math.min(minDistanceMeters, upperBound);
    return Math.max(lowerBound, Math.min(upperBound, totalDistanceMeters * ratio));
}

function getTransitOriginDisplayCoord(
    legs: TransitLegDetail[] | undefined,
    fallback: RoutePathCoord | undefined
): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || !fallback) return fallback;
    const firstRideIndex = legs.findIndex((leg) => isRideLegKind(leg.kind));
    if (firstRideIndex <= 0) return fallback;
    const firstRideLeg = legs[firstRideIndex];
    const firstWalkLeg = legs[firstRideIndex - 1];
    if (!firstWalkLeg || firstWalkLeg.kind !== "WALK") return fallback;

    const walkPath = smoothWalkPathForDisplay(firstWalkLeg.pathCoords);
    const totalDistance = getPathTotalDistanceMeters(walkPath);
    if (walkPath.length < 2 || totalDistance < 24) return fallback;

    const isBusBoard = firstRideLeg?.kind === "BUS";
    const displayDistance = resolveTransitPinDistanceMeters(
        totalDistance,
        isBusBoard ? 0.58 : 0.46,
        isBusBoard ? 64 : 34,
        isBusBoard ? 118 : 86,
        isBusBoard ? 20 : 18
    );
    if (typeof displayDistance !== "number") return fallback;
    return samplePathCoordAtDistance(walkPath, displayDistance) ?? fallback;
}

function getTransitDestinationDisplayCoord(
    legs: TransitLegDetail[] | undefined,
    fallback: RoutePathCoord | undefined
): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || !fallback) return fallback;
    const lastRideIndex = [...legs].reverse().findIndex((leg) => isRideLegKind(leg.kind));
    if (lastRideIndex < 0) return fallback;
    const lastRideLeg = legs[legs.length - 1 - lastRideIndex];
    const walkIndex = legs.length - lastRideIndex;
    const lastWalkLeg = legs[walkIndex];
    if (!lastWalkLeg || lastWalkLeg.kind !== "WALK") return fallback;

    const walkPath = smoothWalkPathForDisplay(lastWalkLeg.pathCoords);
    const totalDistance = getPathTotalDistanceMeters(walkPath);
    if (walkPath.length < 2 || totalDistance < 24) return fallback;

    const endsAfterBus = lastRideLeg?.kind === "BUS";
    const displayDistance = resolveTransitPinDistanceMeters(
        totalDistance,
        endsAfterBus ? 0.54 : 0.42,
        endsAfterBus ? 56 : 28,
        endsAfterBus ? 102 : 78,
        endsAfterBus ? 18 : 16
    );
    if (typeof displayDistance !== "number") return fallback;
    return samplePathCoordAtDistance(walkPath, displayDistance, true) ?? fallback;
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

function getAlternativeOffsetMeters(displayIndex: number, mapZoom: number): number {
    const baseOffset = mapZoom >= 17.2 ? 6 : mapZoom >= 15.3 ? 8 : 10;
    const rank = Math.floor(displayIndex / 2) + 1;
    const direction = displayIndex % 2 === 0 ? 1 : -1;
    return direction * rank * baseOffset;
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

// 확대 수준에 따라 출발/정류장/환승/지하철 마커를 조합하는 지도 전용 마커 빌더들.
function buildBusStopMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number
): TmapMarker[] {
    if (!Array.isArray(legs) || !legs.length || mapZoom < 13) return [];

    const markers: TmapMarker[] = [];
    const seen = new Set<string>();

    legs.forEach((leg, index) => {
        if (leg.kind !== "BUS") return;
        const hasEarlierRide = legs.slice(0, index).some((item) => isRideLegKind(item.kind));
        const lineLabel = compactTransitLineLabel(leg.lineName);

        const pushStop = (coord: RoutePathCoord | undefined, role: "BOARD" | "ALIGHT", stopName?: string) => {
            if (!coord) return;
            const key = `${coord.lat.toFixed(5)}:${coord.lng.toFixed(5)}`;
            if (seen.has(key)) return;
            seen.add(key);
            const dotSize = mapZoom >= 15 ? 11 : mapZoom >= 13.5 ? 9 : 8;
            const compactStop = compactTransitStopLabel(stopName, 9);
            const shouldUseBoardBadge = role === "BOARD" && mapZoom >= 15.1 && !hasEarlierRide;
            if (shouldUseBoardBadge) {
                const badgeLabel = lineLabel && compactStop
                    ? `${lineLabel} (${compactStop})`
                    : lineLabel ?? compactStop ?? "버스 정류장";
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
                    caption: stopName ?? "승차 정류장",
                });
                return;
            }
            markers.push({
                id: `bus-stop-${role.toLowerCase()}-${selectedAlternativeId ?? "sel"}-${index}`,
                latitude: coord.lat,
                longitude: coord.lng,
                tintColor: role === "BOARD" ? "#26A65B" : "#1D72FF",
                displayType: "dot",
                dotSize,
                caption: stopName ?? (role === "BOARD" ? "승차 정류장" : "하차 정류장"),
                badgeBorderColor: "#FFFFFF",
            });
        };

        pushStop(
            getRideStopConnectorCoord(legs, index, "BOARD") ?? getRideStopDisplayCoord(legs, index, "BOARD"),
            "BOARD",
            leg.startName
        );
        pushStop(
            getRideStopConnectorCoord(legs, index, "ALIGHT") ?? getRideStopDisplayCoord(legs, index, "ALIGHT"),
            "ALIGHT",
            leg.endName
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
            badgeLabel = compactTransitStopLabel(group.find((item) => item.intent === "TRANSFER")?.stopName, 11) ?? "환승";
            badgeGlyph = "환";
            tintColor = TRANSIT_TRANSFER_COLOR;
            markerStyle = "transfer";
            const transferLine = group.find((item) => item.intent === "TRANSFER")?.lineLabel;
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
            if (board.kind === "BUS") badgeGlyph = "버";
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
        if (mapZoom < 13.9 || !Array.isArray(selectedAlternative.transitLegs)) return [];
        return selectedAlternative.transitLegs.flatMap((leg, index) => {
            if (leg.kind !== "BUS" && leg.kind !== "SUBWAY") return [];
            const displayPath = leg.kind === "BUS"
                ? getRideLegDisplayPathCoords(selectedAlternative.transitLegs, index)
                : normalizeDisplayPathCoords(
                    Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2 ? leg.pathCoords : undefined,
                    leg.kind
                );
            const spacingMeters = leg.kind === "SUBWAY"
                ? (mapZoom >= 17 ? 64 : mapZoom >= 15.5 ? 86 : 110)
                : (mapZoom >= 17 ? 48 : mapZoom >= 15.5 ? 68 : 88);
            return buildDirectionalMarkersForPath(
                `${selectedAlternative.id}-${leg.kind.toLowerCase()}-${index}`,
                displayPath,
                getTransitLegVisualColor(leg),
                spacingMeters,
                18,
                leg.kind === "SUBWAY" ? 14 : 10
            );
        });
    }

    if (travelMode !== "CAR" || mapZoom < 12.8) return [];
    const displayPath = Array.isArray(selectedAlternative.pathCoords) && selectedAlternative.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(selectedAlternative.pathCoords, undefined)
        : [];
    return buildDirectionalMarkersForPath(
        `${selectedAlternative.id}-car`,
        displayPath,
        SELECTED_ROUTE_COLOR,
        mapZoom >= 16.5 ? 72 : mapZoom >= 14.5 ? 96 : 124,
        24,
        18
    );
}

function formatTransitDepartureNow(date = new Date()): string {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `오늘 ${hh}:${mm} 출발`;
}

export default function RoutePlannerScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
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
    const [isBottomSheetCollapsed, setIsBottomSheetCollapsed] = useState(true);
    const [isBottomSheetHidden, setIsBottomSheetHidden] = useState(true);
    const [isMapInitialized, setIsMapInitialized] = useState(false);
    const [mapZoom, setMapZoom] = useState<number>(INITIAL_CAMERA.zoom ?? 12);
    const [transitConnectorOverlays, setTransitConnectorOverlays] = useState<TmapPathOverlay[]>([]);
    const [transitWalkDetailOverlays, setTransitWalkDetailOverlays] = useState<TmapPathOverlay[]>([]);
    const selectedAlternativeIdRef = useRef<string | undefined>(undefined);
    const [carTrafficRefreshTick, setCarTrafficRefreshTick] = useState(0);
    const initializedOriginRef = useRef(false);
    const prevHasRouteReadyRef = useRef(false);
    const lastCameraActionKeyRef = useRef("");
    const lastAppliedInitialKeyRef = useRef("");
    const transitConnectorCacheRef = useRef<Map<string, RoutePathCoord[]>>(new Map());

    const mapRef = useRef<TmapMapViewHandle | null>(null);
    const alternativeScrollRef = useRef<ScrollView | null>(null);
    const bottomSheetTranslateY = useRef(new Animated.Value(420)).current;
    const bottomSheetStartYRef = useRef(0);
    const [alternativeViewportWidth, setAlternativeViewportWidth] = useState(0);
    const [alternativeContentWidth, setAlternativeContentWidth] = useState(0);

    const isTransitMode = travelMode === "TRANSIT";
    const alternativeCardWidth = useMemo(() => {
        if (isTransitMode) {
            const estimated = Math.round(windowWidth * 0.72);
            return Math.min(320, Math.max(248, estimated));
        }
        const estimated = Math.round(windowWidth * 0.39);
        return Math.min(ALTERNATIVE_CARD_MAX_SIZE, Math.max(ALTERNATIVE_CARD_MIN_SIZE, estimated));
    }, [isTransitMode, windowWidth]);
    const alternativeCardHeight = isTransitMode ? 206 : alternativeCardWidth;
    const alternativeSnapSize = alternativeCardWidth + ALTERNATIVE_CARD_GAP;

    const hasOriginCoords = typeof originLat === "number" && typeof originLng === "number";
    const hasDestinationCoords = typeof destinationLat === "number" && typeof destinationLng === "number";
    const hasRouteReady = hasOriginCoords && hasDestinationCoords;
    const isRoutePointLocked = hasRouteReady && !isRoutePointEditMode;
    const hasActiveTarget = activeTarget === "origin" || activeTarget === "destination";
    const isAlternativeScrollable = alternativeContentWidth > alternativeViewportWidth + 2;
    const originDisplay = originName.trim() || originAddress.trim() || "출발지 미선택";
    const destinationDisplay = destinationName.trim() || destinationAddress.trim() || "도착지 미선택";
    const bottomSheetPeekHeight = BOTTOM_SHEET_HANDLE_PEEK_HEIGHT;
    const bottomSheetCollapsedOffset = useMemo(
        () => Math.max(0, bottomPanelHeight - bottomSheetPeekHeight),
        [bottomPanelHeight, bottomSheetPeekHeight]
    );
    const bottomSheetHiddenOffset = useMemo(() => {
        if (!hasBottomSheetMeasured) return 420;
        return Math.max(320, bottomPanelHeight + insets.bottom + 32);
    }, [bottomPanelHeight, hasBottomSheetMeasured, insets.bottom]);

    const selectedAlternativeIndex = useMemo(
        () => routeAlternatives.findIndex((item) => item.id === selectedAlternativeId),
        [routeAlternatives, selectedAlternativeId]
    );
    const selectedAlternative = selectedAlternativeIndex >= 0 ? routeAlternatives[selectedAlternativeIndex] : undefined;
    const transitLegendKinds = useMemo(() => {
        if (!isTransitMode || !Array.isArray(selectedAlternative?.transitLegs)) return [];
        const orderedKinds: TransitLegDetail["kind"][] = ["SUBWAY", "BUS", "WALK", "ETC"];
        const used = new Set<TransitLegDetail["kind"]>(selectedAlternative.transitLegs.map((leg) => leg.kind));
        return orderedKinds.filter((kind) => used.has(kind));
    }, [isTransitMode, selectedAlternative]);
    const transitFilterCounts = useMemo(() => {
        const counts = { ALL: routeAlternatives.length, BUS: 0, SUBWAY: 0, MIXED: 0 } as Record<TransitRouteFilter, number>;
        routeAlternatives.forEach((option) => {
            const category = getTransitRouteCategory(option);
            if (category !== "ALL") counts[category] += 1;
        });
        return counts;
    }, [routeAlternatives]);
    const shouldShowTransitLegend = transitLegendKinds.length > 0 && mapZoom >= TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
    const shouldShowTransitLegendHint =
        isTransitMode &&
        hasRouteReady &&
        transitLegendKinds.length > 0 &&
        mapZoom < TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
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
    const visibleSelectedAlternativeIndex = useMemo(
        () => visibleAlternatives.findIndex((item) => item.id === selectedAlternativeId),
        [visibleAlternatives, selectedAlternativeId]
    );

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

    const snapBottomSheet = useCallback((collapse: boolean) => {
        if (isBottomSheetHidden) {
            setIsBottomSheetHidden(false);
        }
        const target = collapse ? bottomSheetCollapsedOffset : 0;
        setIsBottomSheetCollapsed(collapse);
        animateBottomSheetTo(target);
    }, [animateBottomSheetTo, bottomSheetCollapsedOffset, isBottomSheetHidden]);

    const shouldCollapseFromGesture = useCallback((current: number, velocityY: number) => {
        if (bottomSheetCollapsedOffset <= 0) return false;
        const midpoint = bottomSheetCollapsedOffset * 0.52;
        const projected = current + (velocityY * 26);

        if (velocityY <= -0.45) return false;
        if (velocityY >= 0.65) return true;
        return projected >= midpoint;
    }, [bottomSheetCollapsedOffset]);

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
                bottomSheetCollapsedOffset
            );
            bottomSheetTranslateY.setValue(next);
        },
        onPanResponderRelease: (_event, gestureState) => {
            bottomSheetTranslateY.stopAnimation((current) => {
                const shouldCollapse = shouldCollapseFromGesture(current, gestureState.vy);
                snapBottomSheet(shouldCollapse);
            });
        },
        onPanResponderTerminate: (_event, gestureState) => {
            bottomSheetTranslateY.stopAnimation((current) => {
                const shouldCollapse = shouldCollapseFromGesture(current, gestureState.vy);
                snapBottomSheet(shouldCollapse);
            });
        },
    }), [bottomSheetCollapsedOffset, bottomSheetTranslateY, isBottomSheetHidden, shouldCollapseFromGesture, snapBottomSheet]);

    const selectAlternativeByIndex = useCallback((index: number, scrollToCard = false) => {
        if (!visibleAlternatives.length) return;
        const bounded = Math.min(Math.max(index, 0), visibleAlternatives.length - 1);
        const target = visibleAlternatives[bounded];
        if (!target) return;

        setSelectedAlternativeId(target.id);
        selectedAlternativeIdRef.current = target.id;

        if (scrollToCard && alternativeScrollRef.current) {
            alternativeScrollRef.current.scrollTo({
                x: bounded * alternativeSnapSize,
                y: 0,
                animated: true,
            });
        }
    }, [visibleAlternatives, alternativeSnapSize]);

    const onAlternativeSwipeEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!visibleAlternatives.length || !isAlternativeScrollable) return;
        const offsetX = event.nativeEvent.contentOffset.x;
        const nextIndex = Math.round(offsetX / alternativeSnapSize);
        selectAlternativeByIndex(nextIndex, false);
    }, [visibleAlternatives, isAlternativeScrollable, alternativeSnapSize, selectAlternativeByIndex]);

    useEffect(() => {
        if (visibleSelectedAlternativeIndex < 0 || !alternativeScrollRef.current) return;
        alternativeScrollRef.current.scrollTo({
            x: visibleSelectedAlternativeIndex * alternativeSnapSize,
            y: 0,
            animated: false,
        });
    }, [visibleSelectedAlternativeIndex, alternativeSnapSize]);

    useEffect(() => {
        if (travelMode !== "TRANSIT" && transitRouteFilter !== "ALL") {
            setTransitRouteFilter("ALL");
        }
    }, [travelMode, transitRouteFilter]);

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
            setIsBottomSheetCollapsed(true);
        } else if (forcedSheetState === "collapsed") {
            setIsBottomSheetHidden(false);
            setIsBottomSheetCollapsed(true);
        } else if (forcedSheetState === "expanded") {
            setIsBottomSheetHidden(false);
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
            }
            return;
        }
        const hasSelectedVisible = visibleAlternatives.some((item) => item.id === selectedAlternativeId);
        if (hasSelectedVisible) return;
        const fallback = visibleAlternatives[0];
        setSelectedAlternativeId(fallback.id);
        selectedAlternativeIdRef.current = fallback.id;
    }, [visibleAlternatives, selectedAlternativeId, forcedRouteIndex]);

    useEffect(() => {
        if (!hasRouteReady && !isRoutePointEditMode) {
            setIsRoutePointEditMode(true);
        }
    }, [hasRouteReady, isRoutePointEditMode]);

    useEffect(() => {
        if (!hasBottomSheetMeasured) return;
        if (isBottomSheetHidden) {
            bottomSheetTranslateY.stopAnimation();
            bottomSheetTranslateY.setValue(bottomSheetHiddenOffset);
            return;
        }

        const target = isBottomSheetCollapsed ? bottomSheetCollapsedOffset : 0;
        bottomSheetTranslateY.stopAnimation(() => {
            animateBottomSheetTo(target);
        });
    }, [
        hasBottomSheetMeasured,
        isBottomSheetHidden,
        isBottomSheetCollapsed,
        bottomSheetCollapsedOffset,
        bottomSheetHiddenOffset,
        bottomSheetTranslateY,
        animateBottomSheetTo,
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
            setIsBottomSheetCollapsed(true);
            return;
        }

        // 경로가 처음 준비되는 순간에는 펼쳐서 안내하고,
        // 이후에는 사용자가 접은 상태를 유지한다.
        if (isBottomSheetHidden) {
            setIsBottomSheetHidden(false);
        }
        if (!prevHasRouteReady) {
            setIsBottomSheetCollapsed(false);
        }
    }, [forcedSheetState, isMapInitialized, hasBottomSheetMeasured, isBottomSheetHidden, hasRouteReady]);

    // 경로 대안 계산
    useEffect(() => {
        if (!hasRouteReady) {
            setRouteAlternatives([]);
            setSelectedAlternativeId(undefined);
            selectedAlternativeIdRef.current = undefined;
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
        const fallbackRoutePath = fallbackPathCoords.map((point) => ({ lat: point.latitude, lng: point.longitude }));

        const selectedRoute = routeAlternatives.find((option) => option.id === selectedAlternativeId);
        const shouldShowInactiveMapAlternatives = mapZoom < 16.8;
        const inactiveOptions = shouldShowInactiveMapAlternatives
            ? routeAlternatives
                .filter((option) => option.id !== selectedAlternativeId)
                .slice(0, INACTIVE_MAP_ALTERNATIVE_LIMIT)
            : [];
        const inactiveOverlays = inactiveOptions
            .map((option, displayIndex) => {
                const sourcePath = Array.isArray(option.pathCoords) && option.pathCoords.length >= 2
                    ? normalizeDisplayPathCoords(option.pathCoords, option.mode === "WALK" ? "WALK" : undefined)
                    : fallbackRoutePath;
                const offsetPath = offsetPathLaterally(
                    sourcePath,
                    getAlternativeOffsetMeters(displayIndex, mapZoom)
                );
                const coords = offsetPath.map((point) => ({
                    latitude: point.lat,
                    longitude: point.lng,
                }));

                if (coords.length < 2) return null;

                return {
                    id: option.id,
                    coords,
                    color: INACTIVE_ROUTE_COLOR,
                    width: ROUTE_STYLE.inactiveWidth,
                    outlineColor: isDark ? "rgba(15,20,35,0.7)" : "rgba(255,255,255,0.82)",
                    outlineWidth: ROUTE_STYLE.inactiveOutlineWidth,
                } as TmapPathOverlay;
            })
            .filter((value: TmapPathOverlay | null): value is TmapPathOverlay => value !== null);

        const shouldShowDetailedTransitSegments = travelMode === "TRANSIT" && mapZoom >= TRANSIT_SEGMENT_DETAIL_MIN_ZOOM;
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
                    const walkOverlayId = `${selectedRoute.id}-walk-leg-${index}`;
                    const walkDetailCoords = walkOverlayById.get(walkOverlayId);
                    const legCoords = leg.kind === "BUS"
                        ? getRideLegDisplayCoords(selectedRoute.transitLegs, index)
                        : (leg.kind === "WALK" && Array.isArray(walkDetailCoords) && walkDetailCoords.length >= 2)
                        ? toDisplayOverlayCoords(
                            walkDetailCoords.map((point) => ({ lat: point.latitude, lng: point.longitude })),
                            "WALK"
                        )
                        : toDisplayOverlayCoords(
                            Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2 ? leg.pathCoords : undefined,
                            leg.kind
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
        const selectedTransitWalkOverlays = (
            travelMode === "TRANSIT" &&
            shouldShowDetailedTransitSegments
        )
            ? [...transitConnectorOverlays, ...transitWalkDetailOverlays]
                .filter((overlay) => (
                    typeof overlay.id === "string" &&
                    overlay.id.endsWith("-path") &&
                    Array.isArray(overlay.coords) &&
                    overlay.coords.length >= 2
                ))
                .map((overlay, index) => ({
                    id: `selected-walk-${index}-${overlay.id}`,
                    coords: overlay.coords,
                    // 도보가 "사라진 것처럼" 보이지 않도록 라이트맵 기준 대비를 조금 더 높인다.
                    color: isDark ? "rgba(170,180,194,0.94)" : "rgba(100,109,123,0.98)",
                    width: ROUTE_STYLE.transitWalkWidth,
                    outlineColor: isDark ? "rgba(15,20,35,0.5)" : "rgba(255,255,255,0.96)",
                    outlineWidth: ROUTE_STYLE.transitWalkOutlineWidth,
                } as TmapPathOverlay))
            : [];
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
                        ? "rgba(180, 193, 211, 0.82)"
                        : SELECTED_ROUTE_COLOR,
                    width: selectedTransitSegmentOverlays.length > 0
                        ? Math.max(ROUTE_STYLE.transitWalkWidth + 1.4, 4.8)
                        : ROUTE_STYLE.selectedWidth,
                    outlineColor: selectedTransitSegmentOverlays.length > 0
                        ? (isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.62)")
                        : (isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.9)"),
                    outlineWidth: selectedTransitSegmentOverlays.length > 0
                        ? Math.max(ROUTE_STYLE.transitWalkOutlineWidth + 0.2, 2)
                        : ROUTE_STYLE.selectedOutlineWidth,
                } as TmapPathOverlay;
            })()
            : null;

        if (selectedTransitSegmentOverlays.length > 0 || selectedTransitWalkOverlays.length > 0) {
            const overlays = [...inactiveOverlays, ...selectedTransitWalkOverlays];
            if (selectedTransitSegmentOverlays.length > 0) {
                overlays.push(...selectedTransitSegmentOverlays);
            } else if (selectedMainOverlay) {
                overlays.push(selectedMainOverlay);
            }
            return overlays;
        }

        if (!inactiveOverlays.length && !selectedMainOverlay) {
            if (pathOverlayCoords && pathOverlayCoords.length >= 2) {
                return [{
                    id: "route-selected-fallback",
                    coords: pathOverlayCoords,
                    color: SELECTED_ROUTE_COLOR,
                    width: ROUTE_STYLE.selectedWidth,
                    outlineColor: isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.95)",
                    outlineWidth: ROUTE_STYLE.selectedOutlineWidth,
                }];
            }
            return [];
        }

        if (selectedMainOverlay) {
            return [...inactiveOverlays, selectedMainOverlay];
        }

        return inactiveOverlays;
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
        isDark,
    ]);

    // 지도에 전달할 실제 marker 목록.
    // 출발/도착 pin, 방향 화살표, 버스 정류장, 환승/승하차 배지까지 최종 단계에서 모은다.
    const mapMarkers = useMemo<TmapMarker[]>(() => {
        const markers: TmapMarker[] = [];
        const originMarkerCoord = (
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs)
        )
            ? getTransitOriginDisplayCoord(
                selectedAlternative.transitLegs,
                hasOriginCoords ? { lat: originLat, lng: originLng } : undefined
            )
            : (hasOriginCoords ? { lat: originLat, lng: originLng } : undefined);
        const destinationMarkerCoord = (
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs)
        )
            ? getTransitDestinationDisplayCoord(
                selectedAlternative.transitLegs,
                hasDestinationCoords ? { lat: destinationLat, lng: destinationLng } : undefined
            )
            : (hasDestinationCoords ? { lat: destinationLat, lng: destinationLng } : undefined);
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
            });
        }

        markers.push(...buildSelectedRouteDirectionMarkers(selectedAlternative, travelMode, mapZoom));

        if (
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            const showLegLabels = mapZoom >= 16.8;
            const showEventMarkers = mapZoom >= 14.2;
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
            const routePoints = pathOverlayCoords?.length ? pathOverlayCoords : [
                { latitude: originLat, longitude: originLng },
                { latitude: destinationLat, longitude: destinationLng },
            ];
            const firstPoint = routePoints[0];
            const midPoint = routePoints[Math.floor(routePoints.length / 2)];
            const lastPoint = routePoints[routePoints.length - 1];
            const fitKey = [
                "fit",
                selectedAlternativeId ?? "none",
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

            const minSpanMeters = routeDistanceKm < 2 ? 650 : routeDistanceKm < 10 ? 900 : 1200;
            const minLatDelta = minSpanMeters / 111_320;
            const minLngDelta = minSpanMeters / lngMetersPerDegree;

            const latitudeDelta = Math.max(minLatDelta, rawLatDelta * marginScale * 1.18);
            const longitudeDelta = Math.max(minLngDelta, rawLngDelta * marginScale);

            const paddedMinLat = minLat - (latitudeDelta - rawLatDelta) / 2;
            const paddedMinLng = minLng - (longitudeDelta - rawLngDelta) / 2;

            map.animateRegionTo({
                latitude: paddedMinLat,
                longitude: paddedMinLng,
                latitudeDelta,
                longitudeDelta,
                duration: 900,
                easing: "Fly",
                pivot: { x: 0.5, y: 0.37 },
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

    const submit = () => {
        const normalizedOriginName = originName.trim();
        const normalizedDestinationName = destinationName.trim();
        if (!hasRouteReady) {
            Alert.alert("경로 설정 필요", "지도에서 출발지와 도착지를 모두 선택해 주세요.");
            return;
        }

        if (!sessionId) {
            router.back();
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
        router.back();
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

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}> 
            <TmapMapView
                ref={mapRef}
                style={styles.fullMap}
                camera={INITIAL_CAMERA}
                nightModeEnabled={false}
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

            <View style={[styles.topOverlay, { paddingTop: insets.top + 4 }]}> 
                <View style={styles.searchOverlayRow}>
                    <Pressable
                        onPress={() => router.back()}
                        style={[styles.inlineCloseBtn, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}
                    >
                        <Text style={[styles.inlineCloseBtnText, { color: colors.textPrimary }]}>{"<"}</Text>
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

            <View style={styles.bottomOverlay}>
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
                            borderColor: colors.border,
                            backgroundColor: overlayPanelBg,
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
                        contentContainerStyle={[styles.bottomPanelScrollContent, { paddingBottom: Math.max(insets.bottom + 8, 12) }]}
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
                                <View style={styles.modeRow}>
                                    {SELECTABLE_TRAVEL_MODES.map((travelModeItem) => (
                                        <Pressable
                                            key={travelModeItem}
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

                                <View style={[styles.alternativeSection, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                                    {travelMode === "TRANSIT" && !etaLoading && !alternativesError && !!routeAlternatives.length && (
                                        <>
                                            <View style={[styles.transitFilterRow, { borderBottomColor: colors.border }]}>
                                                {([
                                                    { key: "ALL", label: "전체" },
                                                    { key: "BUS", label: "버스" },
                                                    { key: "SUBWAY", label: "지하철" },
                                                    { key: "MIXED", label: "버스+지하철" },
                                                ] as Array<{ key: TransitRouteFilter; label: string }>).map((item) => {
                                                    const selected = transitRouteFilter === item.key;
                                                    const count = transitFilterCounts[item.key];
                                                    return (
                                                        <Pressable
                                                            key={item.key}
                                                            onPress={() => setTransitRouteFilter(item.key)}
                                                            style={[
                                                                styles.transitFilterChip,
                                                                {
                                                                    borderColor: selected ? colors.selectedDayBg : colors.border,
                                                                    backgroundColor: selected ? colors.selectedDayBg : "transparent",
                                                                },
                                                            ]}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.transitFilterChipText,
                                                                    { color: selected ? colors.selectedDayText : colors.textSecondary },
                                                                ]}
                                                            >
                                                                {`${item.label} ${count}`}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </View>
                                            <View style={[styles.transitDepartureRow, { borderBottomColor: colors.border }]}>
                                                <Text style={[styles.transitDepartureText, { color: colors.selectedDayBg }]}>
                                                    {formatTransitDepartureNow()}
                                                </Text>
                                                <Text numberOfLines={1} style={[styles.transitDepartureHint, { color: colors.textSecondary }]}>
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
                                        isTransitMode ? (
                                            <View style={styles.transitAlternativeList}>
                                                {visibleAlternatives.map((option, index) => {
                                                    const selected = option.id === selectedAlternativeId;
                                                    const routeLabel = index === 0 ? "추천 경로" : `대안 경로 ${index}`;
                                                    const transitModeLabels = getTransitModeLabels(option.transitLegs);
                                                    const metricTags = getAlternativeMetricTags(option);
                                                    const transitLegPreview = buildTransitLegPreview(option.transitLegs) ?? option.stepSummary;

                                                    return (
                                                        <Pressable
                                                            key={option.id}
                                                            onPress={() => selectAlternativeByIndex(index, false)}
                                                            style={[
                                                                styles.transitAlternativeCard,
                                                                {
                                                                    borderColor: selected ? colors.selectedDayBg : colors.border,
                                                                    backgroundColor: selected
                                                                        ? (isDark ? "rgba(29,114,255,0.18)" : "#EAF2FF")
                                                                        : overlayCardBg,
                                                                },
                                                            ]}
                                                        >
                                                            <View style={styles.transitAlternativeHeader}>
                                                                <View style={styles.transitAlternativeTitleWrap}>
                                                                    <Text style={[styles.alternativeRouteLabel, { color: colors.textPrimary }]}>
                                                                        {routeLabel}
                                                                    </Text>
                                                                    <View style={styles.alternativeBadgeRow}>
                                                                        <View style={[styles.altBadge, { backgroundColor: index === 0 ? "#1B9B50" : "#334155" }]}>
                                                                            <Text style={styles.altBadgeText}>
                                                                                {`${index + 1}/${visibleAlternatives.length}`}
                                                                            </Text>
                                                                        </View>
                                                                        <View style={[styles.altBadge, { backgroundColor: option.source === "api" ? "#334155" : "#6B7280" }]}>
                                                                            <Text style={styles.altBadgeText}>{option.source === "api" ? "API" : "보정"}</Text>
                                                                        </View>
                                                                    </View>
                                                                </View>
                                                                <Text style={[styles.transitDurationLarge, { color: colors.textPrimary }]}>
                                                                    {formatDuration(option.minutes)}
                                                                </Text>
                                                            </View>

                                                            {transitModeLabels.length > 0 && (
                                                                <View style={styles.transitModeChipRow}>
                                                                    {transitModeLabels.map((modeLabel) => (
                                                                        <View
                                                                            key={`${option.id}-${modeLabel}`}
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

                                                            {metricTags.length > 0 && (
                                                                <View style={styles.transitMetricTagRow}>
                                                                    {metricTags.map((metric) => (
                                                                        <View
                                                                            key={`${option.id}-${metric}`}
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

                                                            {Array.isArray(option.transitLegs) && option.transitLegs.length > 0 && (
                                                                <View style={styles.transitLegList}>
                                                                    {option.transitLegs.map((leg, legIndex) => {
                                                                        const kindMeta = getTransitLegKindMeta(leg.kind);
                                                                        const legMetaText = buildTransitLegMeta(leg);
                                                                        const fromTo = leg.startName && leg.endName
                                                                            ? `${leg.startName} → ${leg.endName}`
                                                                            : "";
                                                                        const assistText = buildTransitLegAssistText(option.transitLegs, legIndex);
                                                                        return (
                                                                            <View
                                                                                key={`${option.id}-leg-${legIndex}`}
                                                                                style={[
                                                                                    styles.transitLegItemCard,
                                                                                    { borderColor: colors.border, backgroundColor: overlayPanelBg },
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
                                                                            </View>
                                                                        );
                                                                    })}
                                                                </View>
                                                            )}

                                                            {!!transitLegPreview && (!Array.isArray(option.transitLegs) || option.transitLegs.length === 0) && (
                                                                <Text numberOfLines={2} style={[styles.alternativeStep, { color: colors.textSecondary }]}>
                                                                    {transitLegPreview}
                                                                </Text>
                                                            )}
                                                        </Pressable>
                                                    );
                                                })}
                                            </View>
                                        ) : (
                                            <ScrollView
                                                ref={alternativeScrollRef}
                                                horizontal
                                                bounces={false}
                                                scrollEnabled={isAlternativeScrollable}
                                                showsHorizontalScrollIndicator={false}
                                                decelerationRate="fast"
                                                snapToInterval={isAlternativeScrollable ? alternativeSnapSize : undefined}
                                                snapToAlignment="start"
                                                disableIntervalMomentum={isAlternativeScrollable}
                                                onLayout={(event) => {
                                                    setAlternativeViewportWidth(Math.round(event.nativeEvent.layout.width));
                                                }}
                                                onContentSizeChange={(width) => {
                                                    setAlternativeContentWidth(Math.round(width));
                                                }}
                                                onMomentumScrollEnd={onAlternativeSwipeEnd}
                                                contentContainerStyle={styles.alternativeScrollContent}
                                            >
                                                {visibleAlternatives.map((option, index) => {
                                                    const selected = option.id === selectedAlternativeId;
                                                    const routeLabel = index === 0 ? "추천 경로" : `대안 경로 ${index}`;
                                                    const transitLegPreview = option.stepSummary;

                                                    return (
                                                        <View key={option.id} style={styles.alternativePage}>
                                                            <Pressable
                                                                onPress={() => selectAlternativeByIndex(index, false)}
                                                                style={[
                                                                    styles.alternativeCard,
                                                                    {
                                                                        width: alternativeCardWidth,
                                                                        height: alternativeCardHeight,
                                                                        marginRight: index === visibleAlternatives.length - 1 ? 0 : ALTERNATIVE_CARD_GAP,
                                                                        borderColor: selected ? colors.selectedDayBg : colors.border,
                                                                        backgroundColor: selected
                                                                            ? (isDark ? "#1D72FF22" : "#EAF2FF")
                                                                            : overlayCardBg,
                                                                    },
                                                                ]}
                                                            >
                                                                <View style={styles.alternativeTopRow}>
                                                                    <Text style={[styles.alternativeRouteLabel, { color: colors.textPrimary }]}>
                                                                        {routeLabel}
                                                                    </Text>
                                                                    <View style={styles.alternativeBadgeRow}>
                                                                        <View style={[styles.altBadge, { backgroundColor: index === 0 ? "#1B9B50" : "#334155" }]}>
                                                                            <Text style={styles.altBadgeText}>
                                                                                {`${index + 1}/${visibleAlternatives.length}`}
                                                                            </Text>
                                                                        </View>
                                                                        <View style={[styles.altBadge, { backgroundColor: option.source === "api" ? "#334155" : "#6B7280" }]}>
                                                                            <Text style={styles.altBadgeText}>{option.source === "api" ? "API" : "보정"}</Text>
                                                                        </View>
                                                                    </View>
                                                                </View>
                                                                <Text style={[styles.alternativeDuration, { color: colors.textPrimary }]}>
                                                                    {formatDuration(option.minutes)}
                                                                </Text>
                                                                <Text numberOfLines={2} style={[styles.alternativeMeta, { color: colors.textSecondary }]}>
                                                                    {formatAlternativeInfo(option)}
                                                                </Text>
                                                                {!!transitLegPreview && (
                                                                    <Text numberOfLines={2} style={[styles.alternativeStep, { color: colors.textSecondary }]}>
                                                                        {transitLegPreview}
                                                                    </Text>
                                                                )}
                                                            </Pressable>
                                                        </View>
                                                    );
                                                })}
                                            </ScrollView>
                                        )
                                    )}
                                </View>

                                <Pressable onPress={submit} style={[styles.confirmBtn, { backgroundColor: colors.selectedDayBg }]}> 
                                    <Text style={[styles.confirmText, { color: colors.selectedDayText }]}>경로 저장</Text>
                                </Pressable>
                            </>
                        )}
                    </ScrollView>
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    fullMap: {
        ...StyleSheet.absoluteFillObject,
    },
    mapFallbackFull: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
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
        width: 38,
        height: 38,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineCloseBtnText: {
        fontSize: 20,
        fontWeight: "800",
        lineHeight: 20,
        marginTop: -2,
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
        maxHeight: 500,
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
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        paddingHorizontal: 10,
        paddingTop: 10,
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    transitFilterChip: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    transitFilterChipText: {
        fontSize: 12,
        fontWeight: "700",
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
    transitAlternativeHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    transitAlternativeTitleWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flex: 1,
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
    alternativeBadgeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    altBadge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    altBadgeText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "700",
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

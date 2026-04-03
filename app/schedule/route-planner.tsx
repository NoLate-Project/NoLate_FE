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
const INACTIVE_ROUTE_COLOR = "rgba(120, 135, 154, 0.5)";
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
const TRANSIT_WALK_GUIDE_DOT_MIN_ZOOM = 12;
const TRANSIT_WALK_GUIDE_DOT_MAX_COUNT = 360;
const TRANSIT_RIDE_DOT_MIN_ZOOM = 11.5;
const TRANSIT_RIDE_DOT_MAX_COUNT = 400;
const TRANSIT_TRANSFER_COLOR = "#F4A100";
const KAKAO_LABEL_TEXT_COLOR = "#1F2937";
const KAKAO_LABEL_BORDER_COLOR = "rgba(148,163,184,0.62)";
const ROUTE_STYLE = {
    inactiveWidth: 6,
    inactiveOutlineWidth: 2,
    selectedWidth: 10,
    selectedOutlineWidth: 3,
    transitRideWidth: 10,
    transitRideOutlineWidth: 2.5,
    transitWalkWidth: 6,
    transitWalkOutlineWidth: 1.8,
    connectorWalkWidth: 3,
} as const;
type RoutePointTarget = "origin" | "destination";
type TransitRouteFilter = "ALL" | "BUS" | "SUBWAY" | "MIXED";

// 모듈 레벨 상수 — 렌더마다 새 객체를 만들면 지도가 카메라를 계속 리셋할 수 있음
const INITIAL_CAMERA = { latitude: FALLBACK_LAT, longitude: FALLBACK_LNG, zoom: 12 };

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

function isRideLegKind(kind: TransitLegDetail["kind"]): boolean {
    return kind === "SUBWAY" || kind === "BUS";
}

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
                    ? interpolateRouteCoord(pathAnchor, reference, 0.35)
                    : pathAnchor;
                const refLat = reference.lat - pathAnchor.lat;
                const refLng = reference.lng - pathAnchor.lng;
                const cross = (dLat * refLng) - (dLng * refLat);
                const side = cross >= 0 ? 1 : -1;
                const offsetMeters = referenceDistance <= 16 ? 11 : 14;
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

    const rideStopCoord = position === "BOARD" ? getTransitLegBoardCoord(leg) : getTransitLegAlightCoord(leg);
    const pathAnchorCoord = position === "BOARD"
        ? getTransitLegBoardAnchorOnPath(leg)
        : getTransitLegAlightAnchorOnPath(leg);
    const fallbackCoord = position === "BOARD" ? getTransitLegStartCoord(leg) : getTransitLegEndCoord(leg);
    const resolvedBase = rideStopCoord ?? pathAnchorCoord ?? fallbackCoord;
    if (!resolvedBase) return undefined;
    if (leg.kind !== "BUS") return resolvedBase;

    let resolvedCoord = pathAnchorCoord ?? resolvedBase;
    const walkReference = getAdjacentWalkReferenceCoord(legs, legIndex, position);

    if (rideStopCoord && pathAnchorCoord) {
        const stopToPathMeters = routeCoordDistanceMeters(rideStopCoord, pathAnchorCoord);
        resolvedCoord = stopToPathMeters <= 32
            ? interpolateRouteCoord(pathAnchorCoord, rideStopCoord, 0.3)
            : pathAnchorCoord;
    }

    if (walkReference) {
        const walkDistance = routeCoordDistanceMeters(resolvedCoord, walkReference);
        if (walkDistance >= 2 && walkDistance <= 140) {
            const pullRatio = walkDistance > 45 ? 0.68 : 0.48;
            resolvedCoord = interpolateRouteCoord(resolvedCoord, walkReference, pullRatio);
        }
    }

    const pathOffsetCoord = offsetBusStopCoordFromPath(leg, resolvedCoord, position) ?? resolvedCoord;
    return nudgeBusStopTowardReference(pathOffsetCoord, walkReference) ?? pathOffsetCoord;

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

function toDisplayOverlayCoords(pathCoords: RoutePathCoord[] | undefined, kind?: TransitLegDetail["kind"]): TmapLatLng[] {
    const normalized = kind === "WALK"
        ? smoothWalkPathForDisplay(pathCoords)
        : filterDensePathCoords(pathCoords, 1.6);
    if (!normalized.length) return [];
    return normalized.map((point) => ({ latitude: point.lat, longitude: point.lng }));
}

function samplePathCoordsBySpacing(pathCoords: RoutePathCoord[] | undefined, spacingMeters: number): RoutePathCoord[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return [];
    const spacing = Math.max(10, spacingMeters);
    const sampled: RoutePathCoord[] = [];
    let carry = spacing * 0.5;

    for (let index = 1; index < pathCoords.length; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        const segmentMeters = routeCoordDistanceMeters(from, to);
        if (segmentMeters < 0.8) continue;
        while (carry <= segmentMeters) {
            const ratio = carry / segmentMeters;
            sampled.push(interpolateRouteCoord(from, to, ratio));
            carry += spacing;
        }
        carry -= segmentMeters;
        if (carry < 0) carry = spacing;
    }

    return sampled;
}

function buildTransitWalkGuideDotMarkers(
    selectedAlternativeId: string | undefined,
    _legs: TransitLegDetail[] | undefined,
    connectorOverlays: TmapPathOverlay[] | undefined,
    mapZoom: number
): TmapMarker[] {
    if (mapZoom < TRANSIT_WALK_GUIDE_DOT_MIN_ZOOM) return [];
    const allWalkPaths: RoutePathCoord[][] = [];

    // 대중교통 API의 leg.pathCoords는 도로 중앙선을 따르므로 사용하지 않음.
    // 보행자 API로 별도 조회한 커넥터 오버레이 경로만 사용.

    if (Array.isArray(connectorOverlays) && connectorOverlays.length > 0) {
        connectorOverlays.forEach((overlay) => {
            if (typeof overlay.id !== "string" || !overlay.id.endsWith("-path")) return;
            const coords = Array.isArray(overlay.coords)
                ? overlay.coords
                    .map((point) => {
                        if (typeof point?.latitude !== "number" || typeof point?.longitude !== "number") return null;
                        return { lat: point.latitude, lng: point.longitude } as RoutePathCoord;
                    })
                    .filter((point): point is RoutePathCoord => !!point)
                : [];
            if (coords.length >= 2) {
                allWalkPaths.push(coords);
            }
        });
    }

    if (!allWalkPaths.length) return [];

    const spacingMeters = mapZoom >= 18.2 ? 8 : mapZoom >= 17.3 ? 10 : mapZoom >= 16.4 ? 12 : mapZoom >= 15 ? 14 : mapZoom >= 13.5 ? 22 : 35;
    const dotSize = mapZoom >= 17.4 ? 8 : mapZoom >= 15 ? 7 : 6;
    const markers: TmapMarker[] = [];
    let index = 0;

    allWalkPaths.forEach((pathCoords, pathIndex) => {
        const dots = samplePathCoordsBySpacing(pathCoords, spacingMeters);
        dots.forEach((dot) => {
            markers.push({
                id: `transit-walk-dot-${selectedAlternativeId ?? "selected"}-${pathIndex}-${index}`,
                latitude: dot.lat,
                longitude: dot.lng,
                tintColor: "#6B7280",
                displayType: "dot",
                dotSize,
                badgeBorderColor: "rgba(255,255,255,0.98)",
            });
            index += 1;
        });
    });

    return markers.slice(0, TRANSIT_WALK_GUIDE_DOT_MAX_COUNT);
}

function buildTransitRideGuideDotMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number
): TmapMarker[] {
    if (!Array.isArray(legs) || !legs.length || mapZoom < TRANSIT_RIDE_DOT_MIN_ZOOM) return [];

    const spacingMeters = mapZoom >= 17.5 ? 10 : mapZoom >= 16 ? 14 : mapZoom >= 14.5 ? 20 : mapZoom >= 13 ? 28 : 42;
    const dotSize = mapZoom >= 16.5 ? 14 : mapZoom >= 14.5 ? 13 : 12;
    const markers: TmapMarker[] = [];
    let index = 0;

    legs.forEach((leg, legIndex) => {
        if (!isRideLegKind(leg.kind)) return;
        if (!Array.isArray(leg.pathCoords) || leg.pathCoords.length < 2) return;

        const color = TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR;
        const dots = samplePathCoordsBySpacing(leg.pathCoords, spacingMeters);

        dots.forEach((dot) => {
            markers.push({
                id: `transit-ride-dot-${selectedAlternativeId ?? "selected"}-${legIndex}-${index}`,
                latitude: dot.lat,
                longitude: dot.lng,
                tintColor: color,
                displayType: "dot",
                dotSize,
                badgeBorderColor: "rgba(255,255,255,0.95)",
            });
            index += 1;
        });
    });

    return markers.slice(0, TRANSIT_RIDE_DOT_MAX_COUNT);
}

function computeHeadingDeg(from: RoutePathCoord, to: RoutePathCoord): number {
    const dLat = to.lat - from.lat;
    const dLng = to.lng - from.lng;
    const rad = Math.atan2(dLng, dLat);
    return ((rad * 180) / Math.PI + 360) % 360;
}

function samplePathDirectionPoints(
    pathCoords: RoutePathCoord[] | undefined,
    spacingMeters: number
): Array<{ point: RoutePathCoord; headingDeg: number }> {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return [];
    const spacing = Math.max(18, spacingMeters);
    const sampled: Array<{ point: RoutePathCoord; headingDeg: number }> = [];
    let carry = spacing * 0.7;

    for (let index = 1; index < pathCoords.length; index += 1) {
        const from = pathCoords[index - 1];
        const to = pathCoords[index];
        const segmentMeters = routeCoordDistanceMeters(from, to);
        if (segmentMeters < 1.2) continue;
        const headingDeg = computeHeadingDeg(from, to);
        while (carry <= segmentMeters) {
            const ratio = carry / segmentMeters;
            sampled.push({ point: interpolateRouteCoord(from, to, ratio), headingDeg });
            carry += spacing;
        }
        carry -= segmentMeters;
        if (carry < 0) carry = spacing;
    }

    return sampled;
}

function buildTransitDirectionArrowMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number,
    isDark: boolean
): TmapMarker[] {
    if (!Array.isArray(legs) || !legs.length || mapZoom < 15.2) return [];

    const markers: TmapMarker[] = [];
    legs.forEach((leg, legIndex) => {
        if (!isRideLegKind(leg.kind)) return;
        if (!Array.isArray(leg.pathCoords) || leg.pathCoords.length < 2) return;
        let legMeters = 0;
        for (let pathIndex = 1; pathIndex < leg.pathCoords.length; pathIndex += 1) {
            legMeters += routeCoordDistanceMeters(leg.pathCoords[pathIndex - 1], leg.pathCoords[pathIndex]);
        }
        if (legMeters < 70) return;

        const spacingMeters = mapZoom >= 18.8
            ? 34
            : mapZoom >= 17.8
                ? 46
                : mapZoom >= 16.9
                    ? 58
                    : 74;
        const sampled = samplePathDirectionPoints(leg.pathCoords, spacingMeters);
        const boardCoord = getTransitLegBoardAnchorOnPath(leg) ?? getTransitLegStartCoord(leg);
        const alightCoord = getTransitLegAlightAnchorOnPath(leg) ?? getTransitLegEndCoord(leg);
        sampled.forEach((item, markerIndex) => {
            if (boardCoord && routeCoordDistanceMeters(boardCoord, item.point) < 12) return;
            if (alightCoord && routeCoordDistanceMeters(alightCoord, item.point) < 12) return;
            markers.push({
                id: `transit-direction-${selectedAlternativeId ?? "selected"}-${legIndex}-${markerIndex}`,
                latitude: item.point.lat,
                longitude: item.point.lng,
                tintColor: "rgba(255, 255, 255, 0.98)",
                caption: `${getTransitLegKindMeta(leg.kind).label} 진행`,
                displayType: "arrow",
                badgeBorderColor: isDark ? "rgba(15,23,42,0.46)" : "rgba(51,65,85,0.3)",
                rotationDeg: item.headingDeg,
            });
        });
    });

    const maxArrowCount = mapZoom >= 18.5 ? 220 : mapZoom >= 17.3 ? 150 : 90;
    return markers.slice(0, maxArrowCount);
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

        const pushStop = (coord: RoutePathCoord | undefined, role: "BOARD" | "ALIGHT", stopName?: string) => {
            if (!coord) return;
            const key = `${coord.lat.toFixed(5)}:${coord.lng.toFixed(5)}`;
            if (seen.has(key)) return;
            seen.add(key);
            const dotSize = mapZoom >= 15 ? 13 : mapZoom >= 13.5 ? 11 : 9;
            markers.push({
                id: `bus-stop-${role.toLowerCase()}-${selectedAlternativeId ?? "sel"}-${index}`,
                latitude: coord.lat,
                longitude: coord.lng,
                tintColor: "#1D72FF",
                displayType: "dot",
                dotSize,
                caption: stopName ?? (role === "BOARD" ? "승차 정류장" : "하차 정류장"),
                badgeBorderColor: "#FFFFFF",
            });
        };

        pushStop(getTransitLegBoardCoord(leg), "BOARD", leg.startName);
        pushStop(getTransitLegAlightCoord(leg), "ALIGHT", leg.endName);
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
        const boardMarkerCoord =
            getTransitLegBoardCoord(leg) ??
            getTransitLegStartCoord(leg) ??
            getTransitLegBoardAnchorOnPath(leg);
        const alightMarkerCoord =
            getTransitLegAlightCoord(leg) ??
            getTransitLegEndCoord(leg) ??
            getTransitLegAlightAnchorOnPath(leg);
        const lineLabel = compactTransitLineLabel(leg.lineName);
        const baseOrder = index * 10;

        if (isRideLegKind(leg.kind)) {
            if (boardMarkerCoord) {
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

        if (intents.has("TRANSFER")) {
            badgeLabel = "환승";
            badgeGlyph = "환";
            tintColor = TRANSIT_TRANSFER_COLOR;
            const transferLine = group.find((item) => item.intent === "TRANSFER")?.lineLabel;
            caption = transferLine ? `${transferLine} 환승` : "환승 지점";
        } else if (intents.has("BOARD")) {
            const board = group.find((item) => item.intent === "BOARD") ?? base;
            const kindMeta = getTransitLegKindMeta(board.kind);
            const normalizedLine = board.lineLabel
                ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, "")
                .trim();
            badgeLabel = normalizedLine ?? kindMeta.label;
            badgeGlyph = "승";
            tintColor = TRANSIT_LEG_COLOR[board.kind] ?? kindMeta.color;
            if (board.kind === "BUS") badgeGlyph = "버";
            caption = board.stopName ? `${board.stopName} 승차` : `${kindMeta.label} 승차 지점`;
        } else if (intents.has("ALIGHT")) {
            const alight = group.find((item) => item.intent === "ALIGHT") ?? base;
            const kindMeta = getTransitLegKindMeta(alight.kind);
            const normalizedLine = alight.lineLabel
                ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, "")
                .trim();
            badgeLabel = normalizedLine ?? kindMeta.label;
            badgeGlyph = "하";
            tintColor = TRANSIT_LEG_COLOR[alight.kind] ?? kindMeta.color;
            caption = alight.stopName ? `${alight.stopName} 하차` : `${kindMeta.label} 하차 지점`;
        }

        return {
            id: `transit-event-${selectedAlternativeId ?? "selected"}-${index}`,
            latitude: base.coord.lat,
            longitude: base.coord.lng,
            tintColor,
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
    let walkLabelUsed = false;
    legs.forEach((leg, legIndex) => {
        if (leg.kind === "ETC") return;
        const coord = getTransitLegMidCoord(leg);
        if (!coord) return;

        const meta = getTransitLegKindMeta(leg.kind);
        const compactLine = compactTransitLineLabel(leg.lineName);
        let badgeLabel = compactLine ?? meta.label;
        let badgeGlyph = meta.short;
        if (leg.kind === "WALK") {
            const walkDistance = typeof leg.distanceMeters === "number" ? leg.distanceMeters : 0;
            const walkMinutes = typeof leg.durationMinutes === "number" ? leg.durationMinutes : 0;
            if (walkDistance < 90 && walkMinutes < 2) return;
            if (walkLabelUsed) return;
            walkLabelUsed = true;
            badgeLabel = "도보 따라가기";
            badgeGlyph = "도";
        }

        markers.push({
            id: `transit-leg-label-${selectedAlternativeId ?? "selected"}-${legIndex}`,
            latitude: coord.lat,
            longitude: coord.lng,
            tintColor: TRANSIT_LEG_COLOR[leg.kind] ?? meta.color,
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
    const params = useLocalSearchParams<{ sessionId?: string }>();
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const initial = sessionId ? getRoutePlannerInitial(sessionId) : undefined;

    const [originName, setOriginName] = useState(initial?.origin?.name ?? "");
    const [destinationName, setDestinationName] = useState(initial?.destination?.name ?? "");
    const [originAddress, setOriginAddress] = useState(initial?.origin?.address ?? "");
    const [destinationAddress, setDestinationAddress] = useState(initial?.destination?.address ?? "");
    const [originLat, setOriginLat] = useState<number | undefined>(initial?.origin?.lat);
    const [originLng, setOriginLng] = useState<number | undefined>(initial?.origin?.lng);
    const [destinationLat, setDestinationLat] = useState<number | undefined>(initial?.destination?.lat);
    const [destinationLng, setDestinationLng] = useState<number | undefined>(initial?.destination?.lng);
    const [travelMode, setTravelMode] = useState<TravelMode>("CAR");
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget | null>(() => {
        const hasInitialOrigin = typeof initial?.origin?.lat === "number" && typeof initial?.origin?.lng === "number";
        const hasInitialDestination = typeof initial?.destination?.lat === "number" && typeof initial?.destination?.lng === "number";
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
        if (!visibleAlternatives.length) return;
        const hasSelectedVisible = visibleAlternatives.some((item) => item.id === selectedAlternativeId);
        if (hasSelectedVisible) return;
        const fallback = visibleAlternatives[0];
        setSelectedAlternativeId(fallback.id);
        selectedAlternativeIdRef.current = fallback.id;
    }, [visibleAlternatives, selectedAlternativeId]);

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
    }, [isMapInitialized, hasBottomSheetMeasured, isBottomSheetHidden, hasRouteReady]);

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
            ? getTransitLegBoardCoord(transitLegs[firstRideLegIndex])
            : undefined)
            ?? getTransitLegBoardCoord(firstLegForBoundary)
            ?? getTransitLegBoardAnchorOnPath(firstLegForBoundary)
            ?? getTransitLegStartCoord(firstLegForBoundary)
            ?? firstPointFromPath;
        const lastAnchorPoint = (lastRideLegIndex >= 0
            ? getTransitLegAlightCoord(transitLegs[lastRideLegIndex])
            : undefined)
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

        // 출발/도착은 고정하고, 승/하차측 끝점은 보행 API가 반환한 실제 보행 가능점(보도측)을 우선한다.
        pushConnectorRequest(`${selectedAlternative.id}-walk-boundary-start`, originPoint, firstAnchorPoint, true, false);
        pushConnectorRequest(`${selectedAlternative.id}-walk-boundary-end`, lastAnchorPoint, destinationPoint, false, true);

        for (let legIndex = 0; legIndex < transitLegs.length - 1; legIndex += 1) {
            const currentLeg = transitLegs[legIndex];
            const nextLeg = transitLegs[legIndex + 1];
            const currentAnchor = getTransitLegAlightCoord(currentLeg)
                ?? getTransitLegAlightAnchorOnPath(currentLeg)
                ?? getTransitLegEndCoord(currentLeg);
            const nextAnchor = getTransitLegBoardCoord(nextLeg)
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
                    ? getTransitLegAlightCoord(transitLegs[prevRideIndex])
                    : undefined)
                    ?? getTransitLegBoardCoord(leg)
                    ?? getTransitLegBoardAnchorOnPath(leg)
                    ?? getTransitLegStartCoord(leg);
                const to = (nextRideIndex >= 0
                    ? getTransitLegBoardCoord(transitLegs[nextRideIndex])
                    : undefined)
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
                const connectorPath = await fetchConnectorPath(
                    request.from,
                    request.to,
                    request.snapFrom,
                    request.snapTo
                );
                if (connectorPath && !cancelled) {
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
                const walkPath = await fetchConnectorPath(
                    request.from,
                    request.to,
                    request.snapFrom,
                    request.snapTo
                );
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

    const mapPathOverlays = useMemo((): TmapPathOverlay[] => {
        if (!hasRouteReady) return [];

        const allowStraightFallback = travelMode !== "TRANSIT";
        const fallbackCoords = (
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
        const inactiveOverlays = routeAlternatives
            .map((option) => {
                if (option.id === selectedAlternativeId) return null;
                const coords = Array.isArray(option.pathCoords) && option.pathCoords.length >= 2
                    ? toDisplayOverlayCoords(option.pathCoords, option.mode === "WALK" ? "WALK" : undefined)
                    : fallbackCoords;

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
                    const legCoords = (leg.kind === "WALK" && Array.isArray(walkDetailCoords) && walkDetailCoords.length >= 2)
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
                        // 도보 구간은 dot 마커로 표시 (polyline 없음)
                        return [];
                    }

                    return [{
                        id: `${selectedRoute.id}-segment-${index}`,
                        coords: legCoords,
                        color: TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR,
                        width: ROUTE_STYLE.transitRideWidth,
                        outlineColor: isDark ? "rgba(15,20,35,0.55)" : "rgba(255,255,255,0.96)",
                        outlineWidth: ROUTE_STYLE.transitRideOutlineWidth,
                    } as TmapPathOverlay];
                })
            : [];
        const selectedMainOverlay = selectedRoute
            ? (() => {
                const selectedCoords = Array.isArray(selectedRoute.pathCoords) && selectedRoute.pathCoords.length >= 2
                    ? toDisplayOverlayCoords(
                        selectedRoute.pathCoords,
                        selectedRoute.mode === "WALK" ? "WALK" : undefined
                    )
                    : fallbackCoords;
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

        // ride dot 마커가 표시되는 줌 레벨에서는 실선 오버레이 대신 dot 마커만 사용
        // 세그먼트 오버레이가 있으면 우선 표시 (hasRideDots 보다 우선)
        if (selectedTransitSegmentOverlays.length > 0 || transitConnectorOverlays.length > 0) {
            return [...inactiveOverlays, ...transitConnectorOverlays, ...selectedTransitSegmentOverlays];
        }

        // 상세 세그먼트 없을 때 ride dot 표시 구간: 선택 경로선 없이 dot 마커만 사용
        const hasRideDots = travelMode === "TRANSIT" && mapZoom >= TRANSIT_RIDE_DOT_MIN_ZOOM;
        if (hasRideDots) {
            return inactiveOverlays;
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

    const mapMarkers = useMemo<TmapMarker[]>(() => {
        const markers: TmapMarker[] = [];
        if (hasOriginCoords) {
            markers.push({
                id: "origin",
                latitude: originLat,
                longitude: originLng,
                tintColor: ORIGIN_COLOR,
                displayType: "badge",
                badgeLabel: "출발",
                badgeGlyph: "출",
                badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
                badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
                caption: "출발",
            });
        }
        if (hasDestinationCoords) {
            markers.push({
                id: "destination",
                latitude: destinationLat,
                longitude: destinationLng,
                tintColor: DESTINATION_COLOR,
                displayType: "badge",
                badgeLabel: "도착",
                badgeGlyph: "도",
                badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
                badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
                caption: "도착",
            });
        }

        if (
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            const showLegLabels = false;
            const showEventMarkers = mapZoom >= 14.2;
            markers.push(
                ...buildTransitRideGuideDotMarkers(
                    selectedAlternative.id,
                    selectedAlternative.transitLegs,
                    mapZoom
                )
            );
            markers.push(
                ...buildTransitWalkGuideDotMarkers(
                    selectedAlternative.id,
                    selectedAlternative.transitLegs,
                    [...transitConnectorOverlays, ...transitWalkDetailOverlays],
                    mapZoom
                )
            );
            markers.push(
                ...buildTransitDirectionArrowMarkers(
                    selectedAlternative.id,
                    selectedAlternative.transitLegs,
                    mapZoom,
                    isDark
                )
            );
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
        transitConnectorOverlays,
        transitWalkDetailOverlays,
        isDark,
    ]);

    useEffect(() => {
        if (travelMode !== "CAR" || !hasRouteReady) return;
        const interval = setInterval(() => {
            setCarTrafficRefreshTick((prev) => prev + 1);
        }, 45000);
        return () => clearInterval(interval);
    }, [travelMode, hasRouteReady]);

    // 카메라 애니메이션 — ref로만 제어, camera prop은 INITIAL_CAMERA 고정
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const hasOrigin = typeof originLat === "number" && typeof originLng === "number";
        const hasDest = typeof destinationLat === "number" && typeof destinationLng === "number";

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
        pathOverlayCoords,
        selectedAlternativeId,
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

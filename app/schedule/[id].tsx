import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, PanResponder, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getSchedule } from "../../src/api/schedule";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import TmapMapView, {
    type TmapLatLng,
    type TmapMapViewHandle,
    type TmapMarker,
    type TmapPathOverlay,
} from "../../src/modules/map/TmapMapView";
import type { RouteAlternativeOption } from "../../src/modules/map/tmapApi";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { TravelMode } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { fromISO } from "../../lib/util/data";

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdText = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmmText = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const DEFAULT_CAMERA = { latitude: 37.5665, longitude: 126.978, zoom: 12 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

function mapCoordFromPlace(place?: { lat?: number; lng?: number }): TmapLatLng | undefined {
    if (typeof place?.lat !== "number" || typeof place.lng !== "number") return undefined;
    return { latitude: place.lat, longitude: place.lng };
}

function mapCoordFromUnknown(value: unknown): TmapLatLng | undefined {
    if (!value || typeof value !== "object") return undefined;
    const point = value as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown; coord?: unknown };
    if (point.coord) return mapCoordFromUnknown(point.coord);
    const lat = point.lat ?? point.latitude;
    const lng = point.lng ?? point.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return undefined;
    return { latitude: lat, longitude: lng };
}

function routePathCoords(route: unknown): TmapLatLng[] {
    const coords = (route as { pathCoords?: unknown })?.pathCoords;
    if (!Array.isArray(coords)) return [];

    return coords.flatMap((point) => {
        const coord = mapCoordFromUnknown(point);
        return coord ? [coord] : [];
    });
}

function asRouteAlternative(route: unknown): RouteAlternativeOption | undefined {
    if (!route || typeof route !== "object") return undefined;
    return route as RouteAlternativeOption;
}

function routeVisualOverlays(route: unknown, isDark: boolean): TmapPathOverlay[] {
    const storedOverlays = (route as { storedPathOverlays?: unknown })?.storedPathOverlays;
    if (Array.isArray(storedOverlays)) {
        const overlays = storedOverlays.flatMap((overlay, index) => {
            const raw = overlay as {
                id?: unknown;
                coords?: unknown;
                color?: unknown;
                width?: unknown;
                outlineColor?: unknown;
                outlineWidth?: unknown;
            };
            if (!Array.isArray(raw.coords)) return [];
            const coords = raw.coords.flatMap((coord) => {
                const mapped = mapCoordFromUnknown(coord);
                return mapped ? [mapped] : [];
            });
            if (coords.length < 2) return [];
            return [{
                id: typeof raw.id === "string" ? raw.id : `stored-route-overlay-${index}`,
                coords,
                color: typeof raw.color === "string" ? raw.color : "#A3AD1D",
                width: typeof raw.width === "number" ? raw.width : 10,
                outlineColor: typeof raw.outlineColor === "string"
                    ? raw.outlineColor
                    : (isDark ? "rgba(15,20,35,0.65)" : "rgba(255,255,255,0.95)"),
                outlineWidth: typeof raw.outlineWidth === "number" ? raw.outlineWidth : 3,
            }];
        });
        if (overlays.length > 0) return overlays;
    }

    const routeOption = asRouteAlternative(route);
    const legs = routeOption?.transitLegs;
    if (!Array.isArray(legs) || legs.length === 0) return [];

    return legs.flatMap((leg, index) => {
        const coords = getTransitLegStoredCoords(leg);
        if (coords.length < 2) return [];
        const isWalk = leg.kind === "WALK";
        return [{
            id: `detail-route-leg-${index}`,
            coords,
            color: isWalk ? (isDark ? "#E8E2A6" : "#7C8A13") : (leg.lineColor ? `#${leg.lineColor.replace(/^#/, "")}` : "#5AA2FF"),
            width: isWalk ? 8 : 10,
            outlineColor: isDark ? "rgba(15,20,35,0.65)" : "rgba(255,255,255,0.95)",
            outlineWidth: 3,
        }];
    });
}

function getTransitLegStoredCoords(leg: NonNullable<RouteAlternativeOption["transitLegs"]>[number]): TmapLatLng[] {
    const pathCoords = routePathCoords({ pathCoords: leg.pathCoords });
    if (pathCoords.length >= 2) return pathCoords;

    const coords = [
        mapCoordFromUnknown(leg.startCoord),
        ...(Array.isArray(leg.passStops) ? leg.passStops.flatMap((stop) => {
            const coord = mapCoordFromUnknown(stop.coord);
            return coord ? [coord] : [];
        }) : []),
        mapCoordFromUnknown(leg.endCoord),
    ].filter((coord): coord is TmapLatLng => !!coord);

    return coords;
}

function storedRouteCoords(route: unknown): TmapLatLng[] {
    const rootPath = routePathCoords(route);
    if (rootPath.length >= 2) return rootPath;

    const legs = asRouteAlternative(route)?.transitLegs;
    if (!Array.isArray(legs)) return [];
    return legs.flatMap(getTransitLegStoredCoords);
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

function routeMetricText(route: RouteAlternativeOption | undefined) {
    if (!route) return undefined;
    const metrics: string[] = [];
    if (typeof route.transferCount === "number") metrics.push(`환승 ${route.transferCount}회`);
    if (typeof route.walkMeters === "number") metrics.push(`도보 ${route.walkMeters}m`);
    if (typeof route.fareWon === "number") metrics.push(`${route.fareWon.toLocaleString()}원`);
    return metrics.join(" · ") || route.transitModeSummary;
}

function legTitle(leg: NonNullable<RouteAlternativeOption["transitLegs"]>[number]) {
    if (leg.kind === "WALK") return "도보";
    return leg.lineName || (leg.kind === "BUS" ? "버스" : leg.kind === "SUBWAY" ? "지하철" : "이동");
}

function legColor(leg: NonNullable<RouteAlternativeOption["transitLegs"]>[number]) {
    if (leg.kind === "WALK") return "#70B6FF";
    if (leg.lineColor) return `#${leg.lineColor.replace(/^#/, "")}`;
    return leg.kind === "BUS" ? "#2D7FF9" : "#A3AD1D";
}

function legDescription(leg: NonNullable<RouteAlternativeOption["transitLegs"]>[number]) {
    const chunks = [
        leg.startName && leg.endName ? `${leg.startName} → ${leg.endName}` : undefined,
        typeof leg.stationCount === "number" ? `${leg.stationCount}정거장` : undefined,
        typeof leg.distanceMeters === "number" ? `${leg.distanceMeters}m` : undefined,
    ].filter(Boolean);
    return chunks.join(" · ");
}

function legTimelineTitle(
    leg: NonNullable<RouteAlternativeOption["transitLegs"]>[number],
    index: number,
    total: number
) {
    if (leg.kind === "WALK") {
        if (index === 0) return `${leg.endName || "승차 지점"}까지 도보`;
        if (index === total - 1) return `${leg.endName || "도착지"}까지 도보`;
        return `${leg.endName || "환승 지점"}까지 이동`;
    }
    return `${leg.startName || "승차"}에서 ${leg.endName || "하차"}까지`;
}

function legStopText(leg: NonNullable<RouteAlternativeOption["transitLegs"]>[number]) {
    if (typeof leg.stationCount !== "number") return undefined;
    return `${leg.stationCount}개 정류장 이동`;
}

export default function ScheduleRoute() {
    const { mode } = useLocalSearchParams<{ mode?: string }>();
    if (mode === "edit") {
        return <ScheduleEditScreen />;
    }
    return <ScheduleDetail />;
}

function ScheduleDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const isDark = mode === "dark";
    const { state, dispatch } = useScheduleStore();
    const mapRef = useRef<TmapMapViewHandle>(null);
    const sheetStartOffsetRef = useRef(0);
    const [loading, setLoading] = useState(false);
    const sheetMinHeight = Math.max(210, Math.round(windowHeight * 0.24));
    const sheetMidHeight = Math.max(sheetMinHeight, Math.round(windowHeight * 0.34));
    const sheetMaxHeight = Math.max(sheetMidHeight, Math.round(windowHeight * 0.66));
    const sheetCollapsedOffset = sheetMaxHeight - sheetMinHeight;
    const sheetMiddleOffset = sheetMaxHeight - sheetMidHeight;
    const sheetTranslateY = useRef(new Animated.Value(sheetMiddleOffset)).current;
    const [focusedLegIndex, setFocusedLegIndex] = useState<number | undefined>();
    const [expandedStopLegs, setExpandedStopLegs] = useState<Record<number, boolean>>({});

    const item = id ? state.itemsById[id] : undefined;

    useEffect(() => {
        sheetTranslateY.stopAnimation((current) => {
            sheetTranslateY.setValue(clamp(current, 0, sheetCollapsedOffset));
        });
    }, [sheetCollapsedOffset, sheetTranslateY]);

    const sheetPanResponder = useMemo(
        () => PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 6,
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
                const projectedOffset = clamp(sheetStartOffsetRef.current + gesture.dy + (gesture.vy * 80), 0, sheetCollapsedOffset);
                const snapPoints = [0, sheetMiddleOffset, sheetCollapsedOffset];
                const nextOffset = snapPoints.reduce((closest, point) => (
                    Math.abs(point - projectedOffset) < Math.abs(closest - projectedOffset)
                        ? point
                        : closest
                ), sheetMiddleOffset);
                Animated.spring(sheetTranslateY, {
                    toValue: nextOffset,
                    damping: 30,
                    stiffness: 250,
                    mass: 1,
                    overshootClamping: true,
                    useNativeDriver: true,
                }).start();
            },
            onPanResponderTerminate: (_event, gesture) => {
                const projectedOffset = clamp(sheetStartOffsetRef.current + gesture.dy, 0, sheetCollapsedOffset);
                const snapPoints = [0, sheetMiddleOffset, sheetCollapsedOffset];
                const nextOffset = snapPoints.reduce((closest, point) => (
                    Math.abs(point - projectedOffset) < Math.abs(closest - projectedOffset)
                        ? point
                        : closest
                ), sheetMiddleOffset);
                Animated.spring(sheetTranslateY, {
                    toValue: nextOffset,
                    damping: 30,
                    stiffness: 250,
                    mass: 1,
                    overshootClamping: true,
                    useNativeDriver: true,
                }).start();
            },
        }),
        [sheetCollapsedOffset, sheetMiddleOffset, sheetTranslateY]
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
                if (!cancelled) Alert.alert("일정 조회 실패", getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch, id]);

    const originCoord = useMemo(() => mapCoordFromPlace(item?.origin), [item?.origin]);
    const destinationCoord = useMemo(() => mapCoordFromPlace(item?.destination), [item?.destination]);
    const displayRoute = item?.route;

    const pathCoords = useMemo(() => {
        const savedPath = storedRouteCoords(displayRoute);
        if (savedPath.length >= 2) return savedPath;
        return [];
    }, [displayRoute]);

    const pathOverlays = useMemo(
        () => routeVisualOverlays(displayRoute, mode === "dark"),
        [displayRoute, mode]
    );
    const routeOption = useMemo(() => asRouteAlternative(displayRoute), [displayRoute]);
    const routeLegs = useMemo(
        () => Array.isArray(routeOption?.transitLegs) ? routeOption.transitLegs : [],
        [routeOption]
    );
    const displayPathOverlays = useMemo(() => {
        if (typeof focusedLegIndex !== "number") return pathOverlays;
        const leg = routeLegs[focusedLegIndex];
        if (!leg) return pathOverlays;
        const coords = getTransitLegStoredCoords(leg);
        if (coords.length < 2) return pathOverlays;

        return [
            ...pathOverlays,
            {
                id: `focused-detail-leg-${focusedLegIndex}`,
                coords,
                color: legColor(leg),
                width: 15,
                outlineColor: isDark ? "#111827" : "#FFFFFF",
                outlineWidth: 4,
            },
        ];
    }, [focusedLegIndex, isDark, pathOverlays, routeLegs]);

    const focusRouteLeg = useCallback((legIndex: number) => {
        const leg = routeLegs[legIndex];
        if (!leg) return;

        const legCoords = getTransitLegStoredCoords(leg);
        if (legCoords.length < 2) return;

        setFocusedLegIndex(legIndex);
        mapRef.current?.fitToCoordinates(legCoords, { padding: 90 });
    }, [routeLegs]);

    const toggleLegStops = useCallback((legIndex: number) => {
        setExpandedStopLegs((current) => ({
            ...current,
            [legIndex]: !current[legIndex],
        }));
    }, []);

    const focusTransitStop = useCallback((stop: { coord?: unknown }) => {
        const coord = mapCoordFromUnknown(stop.coord);
        if (!coord) return;

        mapRef.current?.animateCameraTo({
            ...coord,
            zoom: 17,
            duration: 420,
        });
    }, []);

    const mapCoords = useMemo(() => {
        const coords = [...pathCoords];
        if (originCoord) coords.push(originCoord);
        if (destinationCoord) coords.push(destinationCoord);
        return coords;
    }, [destinationCoord, originCoord, pathCoords]);

    const markers = useMemo<TmapMarker[]>(() => {
        const nextMarkers: TmapMarker[] = [];
        if (originCoord) {
            nextMarkers.push({
                id: "origin",
                ...originCoord,
                caption: item?.origin?.name ?? "출발지",
                markerStyle: "origin",
                pinLabel: "출",
            });
        }
        if (destinationCoord) {
            nextMarkers.push({
                id: "destination",
                ...destinationCoord,
                caption: item?.destination?.name ?? "도착지",
                markerStyle: "destination",
                pinLabel: "도",
            });
        }
        return nextMarkers;
    }, [destinationCoord, item?.destination?.name, item?.origin?.name, originCoord]);

    const camera = useMemo(() => {
        if (mapCoords.length === 0) return DEFAULT_CAMERA;
        const latitude = mapCoords.reduce((sum, coord) => sum + coord.latitude, 0) / mapCoords.length;
        const longitude = mapCoords.reduce((sum, coord) => sum + coord.longitude, 0) / mapCoords.length;
        return { latitude, longitude, zoom: mapCoords.length > 1 ? 11 : 14 };
    }, [mapCoords]);

    const fitMap = useCallback(() => {
        if (mapCoords.length > 1) {
            mapRef.current?.fitToCoordinates(mapCoords, { padding: 120 });
        }
    }, [mapCoords]);

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
    const sheetBorder = isDark ? "#343434" : "#E2E8F0";
    const primaryText = isDark ? "#F3F4F6" : "#111827";
    const secondaryText = isDark ? "#B8B8B8" : "#64748B";

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar hidden />
            <TmapMapView
                ref={mapRef}
                camera={camera}
                markers={markers}
                pathOverlays={displayPathOverlays}
                pathCoords={pathCoords}
                pathColor="#A3AD1D"
                pathWidth={10}
                pathOutlineColor={mode === "dark" ? "rgba(15,20,35,0.62)" : "#FFFFFF"}
                pathOutlineWidth={3}
                nightModeEnabled={mode === "dark"}
                showLocationButton={false}
                onInitialized={fitMap}
                fallbackBackgroundColor={colors.surface2}
                fallbackTextColor={colors.textSecondary}
                style={styles.fullMap}
            />

            <View style={[styles.topOverlay, { paddingTop: insets.top + 2 }]}>
                <View style={styles.topRow}>
                    <CalendarGlassSurface
                        interactive
                        style={[styles.roundButtonGlass, { borderColor: sheetBorder }]}
                    >
                        <Pressable
                            onPress={() => router.replace("/schedule")}
                            style={({ pressed }) => [
                                styles.roundButton,
                                { opacity: pressed ? 0.58 : 1 },
                            ]}
                        >
                            <Text style={[styles.backIcon, { color: primaryText }]}>‹</Text>
                        </Pressable>
                    </CalendarGlassSurface>

                    <CalendarGlassSurface
                        style={[styles.infoPanel, { borderColor: sheetBorder }]}
                    >
                        <View style={styles.infoHeaderRow}>
                            <View style={styles.infoHeading}>
                                <View style={[styles.categoryDot, { backgroundColor: item.category.color }]} />
                                <Text style={[styles.infoTitle, { color: primaryText }]} numberOfLines={1}>{item.title}</Text>
                            </View>
                            <Pressable
                                onPress={() => router.setParams({ mode: "edit" })}
                                style={[styles.editInlineButton, { backgroundColor: colors.selectedDayBg }]}
                            >
                                <Text style={[styles.editInlineText, { color: colors.selectedDayText }]}>수정</Text>
                            </Pressable>
                        </View>
                        <View style={[styles.infoDivider, { backgroundColor: sheetBorder }]} />
                        <Text style={[styles.infoRoute, { color: primaryText }]} numberOfLines={1}>{routeTitle}</Text>
                        <View style={styles.infoMetaRow}>
                            <Text style={[styles.infoTime, { color: secondaryText }]} numberOfLines={1}>
                                {formatCompactScheduleRange(item.startAt, item.endAt, item.hasEndTime !== false)}
                            </Text>
                            <View style={[styles.metaSeparator, { backgroundColor: sheetBorder }]} />
                            <Text style={[styles.infoTravel, { color: secondaryText }]} numberOfLines={1}>
                                {routeMetricText(routeOption) || travelText}
                            </Text>
                        </View>
                    </CalendarGlassSurface>
                </View>
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
                    style={[
                        styles.routeSheetGlass,
                        {
                            paddingBottom: Math.max(insets.bottom, 14),
                            borderColor: sheetBorder,
                        },
                    ]}
                >
                    <View style={styles.sheetHandleHitArea} {...sheetPanResponder.panHandlers}>
                        <View style={[styles.sheetHandle, { backgroundColor: sheetBorder }]} />
                    </View>
                    <ScrollView
                        style={styles.sheetScroll}
                        contentContainerStyle={styles.sheetScrollContent}
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                    >
                        <View style={[styles.sheetHeader, { borderBottomColor: sheetBorder }]}>
                            <View>
                                <Text style={[styles.sheetEyebrow, { color: colors.selectedDayBg }]}>최적</Text>
                                <Text style={[styles.sheetTitle, { color: primaryText }]}>
                                    {routeNumberText(routeOption, item.travelMinutes)}
                                </Text>
                            </View>
                            <Text style={[styles.sheetMeta, { color: secondaryText }]} numberOfLines={2}>
                                {routeMetricText(routeOption) || travelText}
                            </Text>
                        </View>

                        {routeLegs.length > 0 && (
                            <View style={styles.progressTrack}>
                                {routeLegs.map((leg, index) => (
                                    <View
                                        key={`progress-${leg.kind}-${index}`}
                                        style={[
                                            styles.progressSegment,
                                            {
                                                flex: Math.max(1, leg.durationMinutes || 1),
                                                marginLeft: index === 0 ? 0 : 3,
                                                backgroundColor: legColor(leg),
                                            },
                                        ]}
                                    >
                                        <Text style={styles.progressSegmentText} numberOfLines={1}>
                                            {leg.kind === "WALK" ? `${leg.durationMinutes || ""}분` : legTitle(leg)}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        {routeLegs.length > 0 ? (
                            <View style={styles.timeline}>
                                {routeLegs.map((leg, index) => (
                                <Pressable
                                    key={`${leg.kind}-${index}-${leg.startName ?? ""}`}
                                    onPress={() => focusRouteLeg(index)}
                                    style={[
                                        styles.timelineItem,
                                        focusedLegIndex === index && {
                                            backgroundColor: isDark ? "rgba(47,128,255,0.10)" : "#EFF6FF",
                                            borderColor: isDark ? "rgba(96,165,250,0.28)" : "#BFDBFE",
                                        },
                                    ]}
                                >
                                    <View style={styles.timelineRail}>
                                        <View style={[styles.timelineDot, { backgroundColor: legColor(leg) }]}>
                                            <Text style={styles.timelineDotText}>
                                                {leg.kind === "WALK" && index === 0 ? "출" : leg.kind === "WALK" ? "도" : leg.kind === "BUS" ? "B" : "S"}
                                            </Text>
                                        </View>
                                        {index < routeLegs.length - 1 && (
                                            <View style={[styles.timelineLine, { backgroundColor: leg.kind === "WALK" ? sheetBorder : legColor(leg) }]} />
                                        )}
                                    </View>
                                    <View style={styles.timelineContent}>
                                        <View style={styles.timelineTopRow}>
                                            <Text style={[styles.timelineTitle, { color: primaryText }]} numberOfLines={2}>
                                                {legTimelineTitle(leg, index, routeLegs.length)}
                                            </Text>
                                            <Text style={[styles.timelineMeta, { color: secondaryText }]}>
                                                {leg.durationMinutes ? `${leg.durationMinutes}분` : ""}
                                            </Text>
                                        </View>
                                        <Text style={[styles.timelineAssist, { color: secondaryText }]} numberOfLines={2}>
                                            {legDescription(leg) || leg.label || "구간 정보"}
                                        </Text>
                                        {leg.kind !== "WALK" && (
                                            <View style={[styles.rideCard, { borderColor: sheetBorder }]}>
                                                <View style={[styles.rideBadge, { backgroundColor: legColor(leg) }]}>
                                                    <Text style={styles.rideBadgeText} numberOfLines={1}>{legTitle(leg)}</Text>
                                                </View>
                                                <Text style={[styles.rideText, { color: secondaryText }]} numberOfLines={1}>
                                                    {legStopText(leg) || `${leg.distanceMeters || 0}m 이동`}
                                                </Text>
                                            </View>
                                        )}
                                        {!!legStopText(leg) && (
                                            <>
                                                <Pressable
                                                    onPress={(event) => {
                                                        event.stopPropagation();
                                                        toggleLegStops(index);
                                                    }}
                                                    style={[styles.stopSummary, { borderTopColor: sheetBorder }]}
                                                >
                                                    <Text style={[styles.stopSummaryText, { color: secondaryText }]}>
                                                        정류장 상세보기
                                                    </Text>
                                                    <View style={styles.stopSummaryAction}>
                                                        <Text style={[styles.stopSummaryCount, { color: secondaryText }]}>
                                                            {leg.passStops?.length ?? leg.stationCount ?? 0}개
                                                        </Text>
                                                        <Text style={[styles.stopSummaryChevron, { color: secondaryText }]}>
                                                            {expandedStopLegs[index] ? "⌃" : "⌄"}
                                                        </Text>
                                                    </View>
                                                </Pressable>

                                                {expandedStopLegs[index] && Array.isArray(leg.passStops) && (
                                                    <View
                                                        style={[
                                                            styles.stopList,
                                                            {
                                                                backgroundColor: isDark ? "#29292C" : "#FFFFFF",
                                                                borderColor: sheetBorder,
                                                            },
                                                        ]}
                                                    >
                                                        {leg.passStops.map((stop, stopIndex) => (
                                                            <Pressable
                                                                key={`${index}-${stop.sequence ?? stopIndex}-${stop.name}`}
                                                                onPress={(event) => {
                                                                    event.stopPropagation();
                                                                    focusTransitStop(stop);
                                                                }}
                                                                style={[
                                                                    styles.stopListItem,
                                                                    stopIndex < leg.passStops!.length - 1 && {
                                                                        borderBottomColor: sheetBorder,
                                                                        borderBottomWidth: StyleSheet.hairlineWidth,
                                                                    },
                                                                ]}
                                                            >
                                                                <View style={styles.stopListRail}>
                                                                    <View style={[styles.stopListDot, { backgroundColor: legColor(leg) }]} />
                                                                    {stopIndex < leg.passStops!.length - 1 && (
                                                                        <View style={[styles.stopListLine, { backgroundColor: legColor(leg) }]} />
                                                                    )}
                                                                </View>
                                                                <View style={styles.stopListTextWrap}>
                                                                    <Text style={[styles.stopListName, { color: primaryText }]} numberOfLines={1}>
                                                                        {stop.name}
                                                                    </Text>
                                                                    {!!stop.code && (
                                                                        <Text style={[styles.stopListCode, { color: secondaryText }]}>
                                                                            정류장 {stop.code}
                                                                        </Text>
                                                                    )}
                                                                </View>
                                                                {!!mapCoordFromUnknown(stop.coord) && (
                                                                    <View
                                                                        style={[
                                                                            styles.stopMapButton,
                                                                            { backgroundColor: isDark ? "#3A3A3D" : "#F1F5F9" },
                                                                        ]}
                                                                    >
                                                                        <Text style={[styles.stopMapAction, { color: primaryText }]}>지도</Text>
                                                                    </View>
                                                                )}
                                                            </Pressable>
                                                        ))}
                                                    </View>
                                                )}
                                            </>
                                        )}
                                    </View>
                                </Pressable>
                                ))}
                            </View>
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
    topRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    roundButtonGlass: {
        width: 46,
        height: 46,
        borderRadius: 23,
        borderWidth: 1,
        overflow: "hidden",
        zIndex: 31,
        elevation: 31,
    },
    roundButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    backIcon: {
        fontSize: 40,
        lineHeight: 44,
        marginTop: -4,
        fontWeight: "300",
    },
    editInlineButton: {
        height: 27,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
    },
    editInlineText: { fontSize: 12, fontWeight: "900" },
    infoPanel: {
        flex: 1,
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 10,
        gap: 5,
        borderWidth: 1,
    },
    infoHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    infoHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
    categoryDot: { width: 7, height: 7, borderRadius: 4 },
    infoTitle: { flex: 1, fontSize: 15, fontWeight: "900" },
    infoDivider: { height: StyleSheet.hairlineWidth, marginVertical: 1 },
    infoRoute: { fontSize: 15, fontWeight: "900", lineHeight: 20 },
    infoMetaRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    infoTime: { flexShrink: 1, fontSize: 10, fontWeight: "700" },
    metaSeparator: { width: 1, height: 10 },
    infoTravel: { flex: 1, fontSize: 10, fontWeight: "800" },
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
        paddingHorizontal: 18,
        borderTopWidth: 1,
        overflow: "hidden",
    },
    sheetHandleHitArea: {
        height: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetHandle: {
        width: 52,
        height: 5,
        borderRadius: 999,
    },
    sheetScroll: { flex: 1 },
    sheetScrollContent: { paddingBottom: 24 },
    sheetHeader: {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    sheetEyebrow: { fontSize: 13, fontWeight: "900" },
    sheetTitle: { fontSize: 30, fontWeight: "900", marginTop: 4 },
    sheetMeta: {
        flex: 1,
        fontSize: 13,
        fontWeight: "800",
        textAlign: "right",
        paddingBottom: 4,
    },
    progressTrack: {
        flexDirection: "row",
        alignItems: "center",
        height: 22,
        marginTop: 14,
        marginBottom: 14,
    },
    progressSegment: {
        minWidth: 24,
        height: "100%",
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    progressSegmentText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
    },
    timeline: { paddingTop: 2 },
    timelineItem: {
        flexDirection: "row",
        minHeight: 74,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "transparent",
        paddingHorizontal: 5,
        paddingTop: 5,
    },
    timelineRail: {
        width: 30,
        alignItems: "center",
    },
    timelineDot: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: "#FFFFFF",
        zIndex: 2,
    },
    timelineDotText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
    timelineLine: {
        flex: 1,
        width: 3,
        minHeight: 38,
    },
    timelineContent: { flex: 1, paddingLeft: 8, paddingBottom: 18 },
    timelineTopRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    timelineTitle: { flex: 1, fontSize: 16, fontWeight: "900", lineHeight: 22 },
    timelineMeta: { fontSize: 13, fontWeight: "800", lineHeight: 22 },
    timelineAssist: {
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        marginTop: 4,
    },
    rideCard: {
        minHeight: 52,
        borderWidth: 1,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 10,
        marginTop: 8,
    },
    rideBadge: {
        maxWidth: 130,
        borderRadius: 7,
        paddingHorizontal: 8,
        paddingVertical: 5,
    },
    rideBadgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
    rideText: { flex: 1, fontSize: 13, fontWeight: "800" },
    stopSummary: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 8,
        paddingTop: 9,
        paddingBottom: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    stopSummaryText: { flex: 1, fontSize: 13, fontWeight: "800" },
    stopSummaryAction: { flexDirection: "row", alignItems: "center", gap: 7 },
    stopSummaryCount: { fontSize: 11, fontWeight: "800" },
    stopSummaryChevron: { fontSize: 15, fontWeight: "900" },
    stopList: {
        marginTop: 4,
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
    stopListItem: {
        minHeight: 54,
        flexDirection: "row",
        alignItems: "stretch",
        paddingHorizontal: 8,
    },
    stopListRail: {
        width: 20,
        alignItems: "center",
        paddingTop: 22,
    },
    stopListDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        zIndex: 2,
    },
    stopListLine: {
        position: "absolute",
        top: 29,
        bottom: -26,
        width: 2,
        opacity: 0.45,
    },
    stopListTextWrap: {
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 8,
        paddingVertical: 7,
    },
    stopListName: { fontSize: 14, fontWeight: "800" },
    stopListCode: { fontSize: 10, fontWeight: "700", marginTop: 2 },
    stopMapButton: {
        alignSelf: "center",
        minWidth: 42,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 9,
    },
    stopMapAction: {
        fontSize: 11,
        fontWeight: "900",
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    BackHandler,
    Linking,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    StatusBar,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import BrandedLoader from "../../src/ui/BrandedLoader";

import { getCurrentLocation, getCurrentLocationPermissionState } from "../../src/modules/map/currentLocation";
import {
    canPersistResolvedRoute,
    createLatestRequestGuard,
} from "../../src/modules/map/routeAsyncGuard";
import {
    getRouteQualityNotice,
    getRouteAlternativeOptions,
    invalidateRouteSearch,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    shouldShowRequiredMapAttribution,
    type PlaceSearchItem,
    type RouteAlternativeOption,
    type RoutePathCoord,
    type TransitGeometrySource,
    type TransitLegDetail,
    type TransitPassStop,
} from "../../src/modules/map/routingService";
import TmapMapView, {
    type TmapCameraState,
    type TmapMapViewHandle,
    type TmapLatLng,
    type TmapMapLayoutReport,
    type TmapMarker,
    type TmapPathOverlay,
} from "../../src/modules/map/TmapMapView";
import {
    getStoredRouteOverlayGeometryProvenance,
    resolveDetailedWalkGeometrySource,
} from "../../src/modules/map/savedRouteMapPresentation";
import {
    getTransitStopAccessLink,
    getTransitWalkAccessLink,
    filterTransitConnectorRequestsForSuccessfulWalks,
    joinWalkPathEndpoint,
    resolveTransitWalkRequestEndpoints,
    resolveTransitRouteNodeCoordinate,
    resolveTransitStopAccessCoordinate,
    splitWalkPathAtDiscontinuities,
    stitchTransitWalkPathToAnchors,
    TRANSIT_CONNECTOR_POLICY as CONNECTOR_POLICY,
} from "../../src/modules/map/transitRouteGeometry";
import { getStationTransferDisplayPath } from "../../src/modules/map/stationTransferGeometry";
import {
    buildTransitLegInteractionId,
    buildTransitStopInteractionId,
    parseTransitMapInteractionId,
} from "../../src/modules/map/transitMapInteraction";
import {
    allocateTransitStopMarkerCounts,
    getTransitStopMarkerPolicy,
    sampleTransitStopIndices,
    type TransitStopMarkerKind,
} from "../../src/modules/map/transitStopVisibility";
import {
    getTransitBoardingDirectionHint,
} from "../../src/modules/map/transitStopLabelPresentation";
import {
    collapseRedundantTransferAlights,
    isRedundantEndpointTransitEvent,
} from "../../src/modules/map/transitMarkerHierarchy";
import {
    getTransitEventMarkerPresentation,
    getTransitModeMarkerStyle,
    shouldPreserveTransitBoundaryEvents,
    shouldShowTransitRouteIdentityLabel,
} from "../../src/modules/map/transitMarkerPresentation";
import {
    buildRouteEndpointAccessRequests,
    resolveRouteEndpointAccessPath,
    type RouteEndpointAccessPath,
} from "../../src/modules/map/routeEndpointAccess";
import {
    getPaddedBoundsCamera,
    getRouteOverviewFitKey,
    getZoomStyleValue,
    shouldDeferInitialRouteCamera,
    type ZoomStyleStops,
} from "../../src/modules/map/routeZoomStyle";
import { getRouteEndpointMarkerPresentation } from "../../src/modules/map/routeMarkerPresentation";
import {
    applyTransitRouteThemeToOverlay,
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    getTransitWalkGuidePresentation,
    shouldRenderTransitStopAccessLinks,
    TRANSIT_ROUTE_ZOOM_STYLE,
    TRANSIT_WALK_DASH_PATTERN,
} from "../../src/modules/map/transitRoutePresentation";
import {
    applyFocusedTransitRideOverlayOwnership,
    getNormalizedFallbackRouteMode,
    getNormalizedTransitLegMode,
    shouldRenderNormalizedTransitDirection,
    shouldUseRouteInfoStepOverlays,
    type NormalizedTransitSegmentMode,
} from "../../src/modules/map/transitRouteSegmentPolicy";
import { selectTransitRouteLabelCoordinate } from "../../src/modules/map/transitRouteLabelPlacement";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import {
    buildRouteSummaryMetrics,
    buildRouteInfoFromAlternative,
    compactTransitLineLabel,
    formatRouteClock,
    formatRouteDuration as formatRouteInfoDuration,
    getBusBadgeType,
    getBusLineColor as getSharedBusLineColor,
    getRouteStepColor,
    getSubwayLineColor as getSharedSubwayLineColor,
    type RouteInfo,
    type RouteStep,
} from "../../src/modules/schedule/routeInfo";
import {
    getNaverLikeRouteRecommendationLabel,
    getNaverLikeRouteTransferCount,
    getNaverLikeTransitRouteCategory,
    selectNaverLikeRouteAlternatives,
} from "../../src/modules/schedule/routeAlternativeRanking";
import RouteStepTimeline from "../../src/modules/schedule/components/route/RouteStepTimeline";
import TransitRouteProgressBar from "../../src/modules/schedule/components/route/TransitRouteProgressBar";
import {
    getRouteDetailSummarySurface,
    getTransitDetailScrollViewportHeight,
    getTransitDetailSummaryPalette,
} from "../../src/modules/schedule/transitDetailPresentation";
import {
    buildTransitRouteProgressSegments,
    TRANSIT_PROGRESS_NEUTRAL_COLOR,
    type TransitRouteProgressSegment,
} from "../../src/modules/schedule/transitRouteProgress";
import {
    getFavoriteDeparturePlace,
    hasFavoriteDepartureCoords,
    saveFavoriteDeparturePlace,
} from "../../src/modules/schedule/favoriteDeparture";
import { getRoutePlannerInitial, setRoutePlannerInitial, setRoutePlannerResult } from "../../src/modules/schedule/routePlannerSession";
import {
    resolveScheduleRouteDepartureContext,
    resolveSelectedRouteTiming,
} from "../../src/modules/schedule/scheduleRouteTiming";
import { getMapPickedPlaceFallbackName } from "../../src/modules/schedule/routePointSelection";
import { resolveRouteSelectionHandoff } from "../../src/modules/schedule/routeSelectionHandoff";
import {
    getRouteSelectionAccessibilityProps,
    getRouteSelectionConfirmAccessibilityProps,
} from "../../src/modules/schedule/routeSelectionAccessibility";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

const FALLBACK_LAT = 37.5665;
const FALLBACK_LNG = 126.978;
const SELECTABLE_TRAVEL_MODES: TravelMode[] = ["CAR", "TRANSIT", "WALK", "BIKE"];
const ORIGIN_COLOR = "#12A150";
const DESTINATION_COLOR = "#F04452";
const SELECTED_ROUTE_COLOR = "#2979FF";
const MAP_GUIDE_ROUTE_BLUE = "#1DA7F2";

function warnRouteDebug(...args: unknown[]) {
    if (typeof __DEV__ === "boolean" && __DEV__) {
        console.warn(...args);
    }
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
const MAP_BUS_ROUTE_COLORS = {
    trunk: "#1DA7F2",
    branch: "#28C76F",
    metro: "#FF4D57",
    circular: "#FF9F1C",
    village: "#2CCDB7",
    airport: "#8B5CF6",
} as const;
const TRANSIT_LEG_COLOR: Record<TransitLegDetail["kind"], string> = {
    SUBWAY: "#00B140",
    BUS: "#2979FF",
    WALK: "#9CA3AF",
    ETC: "#94A3B8",
};
const BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT = 30;
const BOTTOM_SHEET_HANDLE_PEEK_HEIGHT = BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT;
const TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT = 26;
const BOTTOM_SHEET_EDGE_RESISTANCE = 0.28;
const BOTTOM_SHEET_EDGE_OVERSHOOT = 30;
const TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT = 72;
const TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING = 8;
const TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT = 46;
const TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT = 40;
// 출발/도착 핀은 좌표 anchor 위로 약 54pt 솟는다. 경로 선택 바와 핀 사이의 간격까지
// camera bounds에 포함해야 긴 세로 경로에서도 핀 전체가 헤더 아래에 남는다.
const ROUTE_ENDPOINT_PIN_TOP_HEADROOM = 110;
// 환승 배지와 굵은 노선 casing이 하단 고정 바에 닿지 않도록 경로 자체에도 여백을 둔다.
const ROUTE_PATH_BOTTOM_HEADROOM = 92;
// UI tuning: 바텀시트는 최소 20%를 남기고(=최대 80%까지만) 내려간다.
const BOTTOM_SHEET_COLLAPSED_VISIBLE_RATIO = 0.2;
// 상세 경로 첫 진입은 지도가 같이 읽히도록 패널 절반가량만 노출한다.
const TRANSIT_DETAIL_MIDDLE_VISIBLE_RATIO = 0.5;
// 대중교통 상세 화면에서는 하단 안내 바 위로 핸들과 최소 터치 영역만 남긴다.
const TRANSIT_DETAIL_COLLAPSED_VISIBLE_BASE_HEIGHT = 76;
// 전체 경로 화면에서도 지하철/버스 노선색이 바로 읽혀야 해서
// 세그먼트 렌더링은 저배율부터 허용하고, 배지/범례만 별도 줌에서 제어한다.
const TRANSIT_SEGMENT_RENDER_MIN_ZOOM = 6;
const TRANSIT_SEGMENT_DETAIL_MIN_ZOOM = 13.8;
// BUS/SUBWAY/CAR/BIKE 방향은 경로 좌표 순서를 사용하는 TMAP Polyline native direction에 맡긴다.
const ENABLE_NATIVE_ROUTE_DIRECTION = true;
// 본선과 화살표를 같은 native Polyline에 유지해야 줌 도중 위상과 위치가 함께 갱신된다.
const TRANSIT_NATIVE_DIRECTION_MIN_ZOOM = TRANSIT_ROUTE_ZOOM_STYLE.directionMinZoom;
// 화면 혼잡을 줄이기 위한 이벤트 배지 최대 개수.
const TRANSIT_BADGE_MAX_COUNT = 18;
const TRANSIT_WALK_RIDE_SNAP_MAX_METERS = CONNECTOR_POLICY.snapEndpointMeters;
const TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS = CONNECTOR_POLICY.maxDirectConnectorMeters;
const TRANSIT_TERMINAL_CONNECTOR_MAX_METERS = CONNECTOR_POLICY.maxTerminalConnectorMeters;
const KAKAO_LABEL_TEXT_COLOR = "#1F2937";
const KAKAO_LABEL_BORDER_COLOR = "rgba(148,163,184,0.62)";
const ROUTE_LINE_STYLE = {
    walk: {
        color: "#1A73E8",
        width: TRANSIT_ROUTE_ZOOM_STYLE.walkWidth,
        opacity: 0.94,
        dashPattern: [...TRANSIT_WALK_DASH_PATTERN],
        casing: true,
        arrows: false,
        zIndex: 30,
    },
    transfer: {
        color: "#1A73E8",
        width: TRANSIT_ROUTE_ZOOM_STYLE.walkWidth,
        opacity: 0.92,
        dashPattern: [...TRANSIT_WALK_DASH_PATTERN],
        casing: true,
        arrows: false,
        zIndex: 32,
    },
    transit: {
        mainWidth: TRANSIT_ROUTE_ZOOM_STYLE.rideWidth,
        opacity: 1,
        casingColor: "#FFFFFF",
        casingOpacity: 0.92,
        arrows: true,
        busZIndex: 40,
        subwayZIndex: 42,
    },
    drive: {
        color: SELECTED_ROUTE_COLOR,
        mainWidth: {
            zoom12: 5.8,
            zoom15: 6.2,
            zoom17: 6.6,
            zoom18: 6.8,
        },
        casingExtraWidth: {
            zoom12: 2.2,
            zoom15: 2.4,
            zoom17: 2.6,
            zoom18: 2.6,
        },
        opacity: 1,
        casingColor: "rgba(255,255,255,0.96)",
        casingOpacity: 0.94,
        arrows: true,
        zIndex: 38,
    },
    bike: {
        color: "#00897B",
        mainWidth: {
            zoom12: 4.4,
            zoom15: 4.8,
            zoom17: 5.1,
            zoom18: 5.2,
        },
        casingExtraWidth: {
            zoom12: 1.9,
            zoom15: 2.1,
            zoom17: 2.3,
            zoom18: 2.3,
        },
        opacity: 0.98,
        casingColor: "rgba(255,255,255,0.96)",
        casingOpacity: 0.94,
        arrows: true,
        zIndex: 36,
    },
    arrows: {
        color: "#FFFFFF",
    },
    markerZIndex: {
        routeBadge: 55,
        transitStop: 60,
        endpoint: 70,
        currentLocation: 80,
    },
} as const;
// 지도 위 도보/환승 구간은 라이트 지도에서도 읽히도록 파란 dashed guide로 고정한다.
const ROUTE_WALK_GUIDE_COLOR = ROUTE_LINE_STYLE.walk.color;
const ROUTE_TRANSFER_GUIDE_COLOR = ROUTE_LINE_STYLE.transfer.color;
const ROUTE_WALK_GUIDE_OPACITY = ROUTE_LINE_STYLE.walk.opacity;
const ROUTE_WALK_CASING_COLOR = "#FFFFFF";
const ROUTE_WALK_CASING_OPACITY = 0.9;
const ROUTE_STYLE = {
    // 지도 라인 기본 두께/외곽선 설정.
    inactiveWidth: 5,
    inactiveOutlineWidth: 1.6,
    selectedWidth: 9.8,
    selectedOutlineWidth: 2.5,
    transitRideWidth: 5.55,
    transitRideOutlineWidth: 0.7,
    // 도보 보조선은 ride보다 얇게 유지하되, 지도 위에서 사라지지 않을 정도로 확보한다.
    transitWalkWidth: 1.35,
    transitWalkOutlineWidth: 0,
    connectorWalkWidth: 1.25,
} as const;
type RouteStrokeStyle = {
    mainWidth: number;
    casingWidth: number;
    outlineWidth: number;
};
type RouteMode = NormalizedTransitSegmentMode;
type GeometrySource = TransitGeometrySource | "START_END_ONLY" | "WALK_API_DETAIL";
type TransitStopAnchorSource = "NEAREST_ON_ROUTE" | "ROUTE_ENDPOINT" | "UNSNAPPED";
type RouteGeometryQuality =
    | "HIGH_API_GEOMETRY"
    | "ANCHOR_ADJUSTED_GEOMETRY"
    | "COARSE_API_GEOMETRY"
    | "PASS_STOP_ONLY"
    | "MANUAL_SAMPLE"
    | "START_END_ONLY"
    | "GEOMETRY_MISMATCH"
    | "UNKNOWN";
type Coordinate = {
    latitude: number;
    longitude: number;
};
type RouteAnchorType =
    | "ORIGIN"
    | "DESTINATION"
    | "BOARDING"
    | "ALIGHTING"
    | "TRANSFER"
    | "WALK_START"
    | "WALK_END"
    | "STATION_EXIT"
    | "BUS_STOP";
type RouteAnchorSource =
    | "RAW_API"
    | "NEAREST_ON_ROUTE"
    | "WALK_ENDPOINT"
    | "TRANSIT_ENDPOINT"
    | "STATION_EXIT"
    | "SHORT_CONNECTOR"
    | "ROUTE_ENDPOINT"
    | "UNSNAPPED";
type RouteAnchor = {
    id: string;
    type: RouteAnchorType;
    name?: string;
    rawCoordinate: Coordinate;
    renderCoordinate: Coordinate;
    snapDistanceMeters?: number;
    source: RouteAnchorSource;
    accessPoint?: AccessPoint;
    segmentId?: string;
    relatedSegmentIds?: string[];
};
type AccessPoint = {
    id: string;
    type: "SUBWAY_EXIT" | "BUS_STOP" | "STATION_ENTRANCE" | "PLATFORM" | "UNKNOWN";
    name?: string;
    stationName?: string;
    exitNumber?: string;
    coordinate: Coordinate;
    source: "TMAP_STEP" | "POI_SEARCH" | "STATIC_CACHE" | "INFERRED";
};
type TransitStopAnchor = RouteAnchor & {
    stopCoordinate: Coordinate;
    routeAnchorCoordinate: Coordinate;
    anchorSource: TransitStopAnchorSource;
};
type RouteSegment = {
    id: string;
    mode: RouteMode;
    rawCoordinates?: Coordinate[];
    coordinates: Coordinate[];
    coordinateParts?: Coordinate[][];
    distance?: number;
    duration?: number;
    lineName?: string;
    lineColor?: string;
    routeColor?: string;
    displayColor?: string;
    busType?: string;
    fromName?: string;
    toName?: string;
    geometrySource?: GeometrySource;
    geometryQuality?: RouteGeometryQuality;
    isManualSamplePath?: boolean;
    nativeDirectionEnabled?: boolean;
    startAnchor?: RouteAnchor;
    endAnchor?: RouteAnchor;
    boardAnchor?: TransitStopAnchor;
    alightAnchor?: TransitStopAnchor;
    rawPointCount?: number;
    renderPointCount?: number;
    renderedCoordinates?: Coordinate[];
    renderedCoordinateParts?: Coordinate[][];
    sequence: number;
};
type NormalizedRoute = {
    id: string;
    totalDuration?: number;
    totalDistance?: number;
    fare?: number;
    segments: RouteSegment[];
};
type RouteSegmentStyle = {
    strokeColor: string;
    strokeWidth: number;
    opacity: number;
    dashPattern?: number[];
    outlineColor?: string;
    outlineWidth?: number;
    outlineOpacity?: number;
    zIndex: number;
};
type TransitMapZoomTier = "overview" | "mid" | "detail";
function getTransitMapZoomTier(mapZoom: number): TransitMapZoomTier {
    if (mapZoom >= 15.5) return "detail";
    if (mapZoom >= 13.2) return "mid";
    return "overview";
}

function getRouteStrokeStyleForZoom(mapZoom: number): RouteStrokeStyle {
    return getFallbackRouteStrokePresentation(mapZoom);
}

function getMapRouteCasingColor(isDark: boolean): string {
    return isDark ? "#F8FBFF" : "#EAF6FF";
}

function getZoomAdjustedWidth(baseWidth: number, zoom: number): number {
    if (zoom <= 13) return Math.max(baseWidth - 1, 2);
    if (zoom >= 17) return Math.min(baseWidth + 1, 7);
    return baseWidth;
}

function normalizeRouteColor(value?: string): string | undefined {
    const raw = value?.trim();
    if (!raw) return undefined;
    if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
    if (/^rgba?\(/i.test(raw)) return raw;
    return undefined;
}

type ZoomRouteValue = ZoomStyleStops;

function getRouteValueForZoom(values: ZoomRouteValue, zoom: number): number {
    return getZoomStyleValue(values, zoom);
}

function getTransitMainWidth(zoom: number): number {
    return getTransitRouteLinePresentation(zoom).rideWidth;
}

function getTransitCasingExtraWidth(zoom: number): number {
    const line = getTransitRouteLinePresentation(zoom);
    return line.rideCasingWidth - line.rideWidth;
}

function getTransitCasingWidth(zoom: number): number {
    return getTransitRouteLinePresentation(zoom).rideCasingWidth;
}

function getWalkWidth(zoom: number): number {
    return getTransitRouteLinePresentation(zoom).walkWidth;
}

// 줌 LOD가 바뀌어도 casing은 고정된 화면 폭만 추가해 과도하게 부풀지 않게 한다.
function getWalkOutlineWidth(zoom: number): number {
    const line = getTransitRouteLinePresentation(zoom);
    return (line.walkCasingWidth - line.walkWidth) / 2;
}

function getWalkCasingWidth(zoom: number): number {
    return getTransitRouteLinePresentation(zoom).walkCasingWidth;
}

function getDriveWidth(zoom: number): number {
    return getRouteValueForZoom(ROUTE_LINE_STYLE.drive.mainWidth, zoom);
}

function getDriveOutlineWidth(zoom: number): number {
    return getRouteValueForZoom(ROUTE_LINE_STYLE.drive.casingExtraWidth, zoom) / 2;
}

function getBikeWidth(zoom: number): number {
    return getRouteValueForZoom(ROUTE_LINE_STYLE.bike.mainWidth, zoom);
}

function getBikeOutlineWidth(zoom: number): number {
    return getRouteValueForZoom(ROUTE_LINE_STYLE.bike.casingExtraWidth, zoom) / 2;
}

function getMapBusRouteColor(lineName?: string, busType?: string): string {
    const inferredType = getBusBadgeType(lineName);
    const safeType = busType && busType in MAP_BUS_ROUTE_COLORS
        ? busType as keyof typeof MAP_BUS_ROUTE_COLORS
        : inferredType;
    return MAP_BUS_ROUTE_COLORS[safeType] ?? MAP_GUIDE_ROUTE_BLUE;
}

function getSegmentColor(segment: RouteSegment): string {
    const displayColor = normalizeRouteColor(segment.displayColor);
    const routeColor = normalizeRouteColor(segment.routeColor ?? segment.lineColor);
    if (segment.mode === "BUS") {
        // 버스는 공급자 노선색을 우선해 TMAP 기본 지도 위의 유사한 청색 시설선과 구분한다.
        return routeColor ?? displayColor ?? getMapBusRouteColor(segment.lineName, segment.busType);
    }
    if (displayColor) return displayColor;
    if (routeColor) return routeColor;
    if (segment.mode === "SUBWAY") return getSubwayLineColor(segment.lineName);
    if (segment.mode === "WALK") return ROUTE_WALK_GUIDE_COLOR;
    if (segment.mode === "TRANSFER") return ROUTE_TRANSFER_GUIDE_COLOR;
    if (segment.mode === "ETC") return TRANSIT_LEG_COLOR.ETC;
    return MAP_GUIDE_ROUTE_BLUE;
}

function getSegmentStyle(segment: RouteSegment, zoom: number, selected: boolean): RouteSegmentStyle {
    const opacity = selected ? 1 : 0.3;
    switch (segment.mode) {
        case "WALK":
            return {
                strokeColor: ROUTE_LINE_STYLE.walk.color,
                strokeWidth: getWalkWidth(zoom),
                opacity: selected ? ROUTE_LINE_STYLE.walk.opacity : 0.28,
                dashPattern: [...ROUTE_LINE_STYLE.walk.dashPattern],
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(zoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                zIndex: ROUTE_LINE_STYLE.walk.zIndex + Math.min(segment.sequence, 9) * 0.1,
            };
        case "TRANSFER":
            return {
                strokeColor: ROUTE_LINE_STYLE.transfer.color,
                strokeWidth: getWalkWidth(zoom),
                opacity: selected ? ROUTE_LINE_STYLE.transfer.opacity : 0.28,
                dashPattern: [...ROUTE_LINE_STYLE.transfer.dashPattern],
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(zoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                zIndex: ROUTE_LINE_STYLE.transfer.zIndex + Math.min(segment.sequence, 9) * 0.1,
            };
        case "BUS":
            return {
                strokeColor: getSegmentColor(segment),
                strokeWidth: getTransitMainWidth(zoom),
                opacity,
                outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
                outlineWidth: (getTransitCasingWidth(zoom) - getTransitMainWidth(zoom)) / 2,
                outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
                zIndex: ROUTE_LINE_STYLE.transit.busZIndex + Math.min(segment.sequence, 9) * 0.1,
            };
        case "SUBWAY":
            return {
                strokeColor: getSegmentColor(segment),
                strokeWidth: getTransitMainWidth(zoom),
                opacity,
                outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
                outlineWidth: (getTransitCasingWidth(zoom) - getTransitMainWidth(zoom)) / 2,
                outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
                zIndex: ROUTE_LINE_STYLE.transit.subwayZIndex + Math.min(segment.sequence, 9) * 0.1,
            };
        case "ETC":
            return {
                strokeColor: TRANSIT_LEG_COLOR.ETC,
                strokeWidth: getTransitMainWidth(zoom),
                opacity,
                outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
                outlineWidth: (getTransitCasingWidth(zoom) - getTransitMainWidth(zoom)) / 2,
                outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
                zIndex: 35 + segment.sequence,
            };
        case "TRANSIT": {
            const stroke = getRouteStrokeStyleForZoom(zoom);
            return {
                strokeColor: MAP_GUIDE_ROUTE_BLUE,
                strokeWidth: stroke.mainWidth,
                opacity,
                outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
                outlineWidth: stroke.outlineWidth,
                outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
                zIndex: 40 + segment.sequence,
            };
        }
        case "UNKNOWN":
        default:
            warnRouteDebug("[route-segment] unknown mode", {
                id: segment.id,
                mode: segment.mode,
                lineName: segment.lineName,
            });
            return {
                strokeColor: MAP_GUIDE_ROUTE_BLUE,
                strokeWidth: getZoomAdjustedWidth(4, zoom),
                opacity,
                zIndex: 34 + segment.sequence,
            };
    }
}

function isTransitRideSegmentMode(mode: RouteMode): boolean {
    return mode === "BUS" || mode === "SUBWAY";
}

function shouldUseNativeTransitDirection(segment: RouteSegment): boolean {
    return ENABLE_NATIVE_ROUTE_DIRECTION &&
        (isTransitRideSegmentMode(segment.mode) || segment.mode === "TRANSIT") &&
        segment.nativeDirectionEnabled !== false;
}

function shouldRenderNativeTransitDirection(segment: RouteSegment, zoom: number): boolean {
    return shouldRenderNormalizedTransitDirection(
        segment.mode,
        zoom,
        shouldUseNativeTransitDirection(segment)
    );
}

function isWalkTransferSegment(segment: RouteSegment): boolean {
    return segment.mode === "WALK" || segment.mode === "TRANSFER";
}

function shouldRenderRouteSegmentGeometry(segment: RouteSegment): boolean {
    if (segment.geometryQuality === "START_END_ONLY" || segment.geometrySource === "START_END_ONLY") {
        return false;
    }
    if (
        isTransitRideSegmentMode(segment.mode) &&
        (segment.geometryQuality === "PASS_STOP_ONLY" || segment.geometrySource === "PASS_STOP_LIST")
    ) {
        return false;
    }
    return true;
}

function getNativeDirectionCarrierWidth(zoom: number): number {
    // 별도 carrier 없이 본선 자체가 native direction을 소유한다.
    return getTransitMainWidth(zoom);
}

function getNativeDirectionOpacity(zoom: number): number {
    return getTransitNativeDirectionOpacity(zoom);
}

function estimateMetersPerPixel(latitude: number, zoom: number): number {
    const safeZoom = Number.isFinite(zoom) ? zoom : 14;
    const safeLatitude = Number.isFinite(latitude) ? latitude : FALLBACK_LAT;
    return (
        (156543.03392 * Math.cos((safeLatitude * Math.PI) / 180)) /
        Math.pow(2, safeZoom)
    );
}

function isValidCoordinate(coord: Coordinate | undefined): coord is Coordinate {
    return !!coord &&
        Number.isFinite(coord.latitude) &&
        Number.isFinite(coord.longitude);
}

function distanceMeters(from: Coordinate, to: Coordinate): number {
    return haversineDistanceKm(from, to) * 1000;
}

function interpolateCoordinate(from: Coordinate, to: Coordinate, ratio: number): Coordinate {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    return {
        latitude: from.latitude + ((to.latitude - from.latitude) * clampedRatio),
        longitude: from.longitude + ((to.longitude - from.longitude) * clampedRatio),
    };
}

function getSegmentLengthMeters(coordinates: Coordinate[] | undefined): number {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
    let totalDistance = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
        const from = coordinates[index - 1];
        const to = coordinates[index];
        if (!isValidCoordinate(from) || !isValidCoordinate(to)) continue;
        const distance = distanceMeters(from, to);
        totalDistance += Number.isFinite(distance) ? distance : 0;
    }
    return totalDistance;
}

function getSegmentRenderableCoordinates(segment: RouteSegment): Coordinate[] {
    if (!shouldRenderRouteSegmentGeometry(segment)) return [];
    return Array.isArray(segment.renderedCoordinates) && segment.renderedCoordinates.length >= 2
        ? segment.renderedCoordinates
        : segment.coordinates;
}

function getSegmentRenderableCoordinateParts(segment: RouteSegment): Coordinate[][] {
    if (!shouldRenderRouteSegmentGeometry(segment)) return [];
    const renderedParts = segment.renderedCoordinateParts?.filter((part) => part.length >= 2) ?? [];
    if (renderedParts.length > 0) return renderedParts;
    const coordinateParts = segment.coordinateParts?.filter((part) => part.length >= 2) ?? [];
    if (coordinateParts.length > 0) return coordinateParts;
    const coordinates = getSegmentRenderableCoordinates(segment);
    return coordinates.length >= 2 ? [coordinates] : [];
}

function getTransitPathOrderScores(
    coordinates: Coordinate[] | undefined,
    boardAnchor: TransitStopAnchor | undefined,
    alightAnchor: TransitStopAnchor | undefined
): { forwardScore: number; reverseScore: number } | undefined {
    const validCoordinates = Array.isArray(coordinates)
        ? coordinates.filter(isValidCoordinate)
        : [];
    const boardCoordinate = getRenderableStopCoordinate(boardAnchor);
    const alightCoordinate = getRenderableStopCoordinate(alightAnchor);
    if (validCoordinates.length < 2 || !boardCoordinate || !alightCoordinate) return undefined;
    const first = validCoordinates[0];
    const last = validCoordinates[validCoordinates.length - 1];
    const forwardScore = distanceMeters(first, boardCoordinate) + distanceMeters(last, alightCoordinate);
    const reverseScore = distanceMeters(first, alightCoordinate) + distanceMeters(last, boardCoordinate);
    return { forwardScore, reverseScore };
}

function shouldReverseSegmentCoordinatesForAnchors(segment: RouteSegment): boolean {
    if (!isTransitRideSegmentMode(segment.mode)) return false;
    const scores = getTransitPathOrderScores(segment.coordinates, segment.boardAnchor, segment.alightAnchor);
    if (!scores) return false;
    return scores.reverseScore + 3 < scores.forwardScore;
}

function validateSegmentPathOrder(segment: RouteSegment): boolean {
    if (!isTransitRideSegmentMode(segment.mode)) return true;
    const scores = getTransitPathOrderScores(getSegmentRenderableCoordinates(segment), segment.boardAnchor, segment.alightAnchor);
    if (!scores) return true;
    return scores.forwardScore <= scores.reverseScore + 3;
}

function ensureTransitSegmentPathOrder(segment: RouteSegment): RouteSegment {
    if (!shouldReverseSegmentCoordinatesForAnchors(segment)) return segment;
    warnRouteDebug("[route-path-order] reversing segment coordinates by board/alight anchors", {
        id: segment.id,
        mode: segment.mode,
        lineName: segment.lineName,
        fromName: segment.fromName,
        toName: segment.toName,
        pointCount: segment.coordinates.length,
    });
    return {
        ...segment,
        coordinates: segment.coordinates.slice().reverse(),
    };
}

function toCoordinate(coord: RoutePathCoord | undefined): Coordinate | undefined {
    if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) return undefined;
    return { latitude: coord.lat, longitude: coord.lng };
}

function toRoutePathCoord(coord: Coordinate | undefined): RoutePathCoord | undefined {
    if (!coord || !Number.isFinite(coord.latitude) || !Number.isFinite(coord.longitude)) return undefined;
    return { lat: coord.latitude, lng: coord.longitude };
}

function routePathCoordsToCoordinates(pathCoords: RoutePathCoord[] | undefined): Coordinate[] {
    return Array.isArray(pathCoords)
        ? pathCoords.map(toCoordinate).filter(isValidCoordinate)
        : [];
}

function projectPointToSegment(
    point: Coordinate,
    segStart: Coordinate,
    segEnd: Coordinate
): { coordinate: Coordinate; ratio: number; distanceMeters: number } {
    const originLatRad = (segStart.latitude * Math.PI) / 180;
    const metersPerLng = Math.max(1, 111_320 * Math.cos(originLatRad));
    const start = { x: 0, y: 0 };
    const end = {
        x: (segEnd.longitude - segStart.longitude) * metersPerLng,
        y: (segEnd.latitude - segStart.latitude) * 111_320,
    };
    const target = {
        x: (point.longitude - segStart.longitude) * metersPerLng,
        y: (point.latitude - segStart.latitude) * 111_320,
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    const ratio = lengthSquared <= 0
        ? 0
        : Math.max(0, Math.min(1, ((target.x * dx) + (target.y * dy)) / lengthSquared));
    const coordinate = interpolateCoordinate(segStart, segEnd, ratio);
    return {
        coordinate,
        ratio,
        distanceMeters: distanceMeters(point, coordinate),
    };
}

function nearestPointOnPolyline(
    point: Coordinate | undefined,
    polyline: Coordinate[] | undefined
): { coordinate: Coordinate; segmentIndex: number; ratio: number; distanceMeters: number } | undefined {
    if (!isValidCoordinate(point) || !Array.isArray(polyline) || polyline.length === 0) return undefined;
    const coordinates = polyline.filter(isValidCoordinate);
    if (coordinates.length === 0) return undefined;
    if (coordinates.length === 1) {
        return {
            coordinate: coordinates[0],
            segmentIndex: 0,
            ratio: 0,
            distanceMeters: distanceMeters(point, coordinates[0]),
        };
    }

    let nearest: { coordinate: Coordinate; segmentIndex: number; ratio: number; distanceMeters: number } | undefined;
    for (let index = 1; index < coordinates.length; index += 1) {
        const projection = projectPointToSegment(point, coordinates[index - 1], coordinates[index]);
        if (!nearest || projection.distanceMeters < nearest.distanceMeters) {
            nearest = {
                coordinate: projection.coordinate,
                segmentIndex: index - 1,
                ratio: projection.ratio,
                distanceMeters: projection.distanceMeters,
            };
        }
    }
    return nearest;
}

function createTransitStopAnchor(
    stopCoordinate: Coordinate | undefined,
    routeCoordinates: Coordinate[] | undefined,
    fallback: "start" | "end",
    meta?: {
        id?: string;
        name?: string;
        type?: "BOARDING" | "ALIGHTING" | "BUS_STOP";
        segmentId?: string;
        relatedSegmentIds?: string[];
    }
): TransitStopAnchor | undefined {
    if (!isValidCoordinate(stopCoordinate)) return undefined;
    const coordinates = Array.isArray(routeCoordinates)
        ? routeCoordinates.filter(isValidCoordinate)
        : [];
    const anchorId = meta?.id ??
        `${meta?.segmentId ?? "transit"}-${meta?.type ?? fallback}-${stopCoordinate.latitude.toFixed(5)}-${stopCoordinate.longitude.toFixed(5)}`;
    const anchorType: RouteAnchorType = meta?.type ?? (fallback === "start" ? "BOARDING" : "ALIGHTING");
    const nearest = nearestPointOnPolyline(stopCoordinate, coordinates);
    if (nearest) {
        const anchorSource: TransitStopAnchorSource = nearest.distanceMeters <= CONNECTOR_POLICY.maxSchematicAccessLinkMeters
            ? "NEAREST_ON_ROUTE"
            : "UNSNAPPED";
        return {
            id: anchorId,
            type: anchorType,
            name: meta?.name,
            rawCoordinate: stopCoordinate,
            renderCoordinate: nearest.distanceMeters <= CONNECTOR_POLICY.maxSchematicAccessLinkMeters ? nearest.coordinate : stopCoordinate,
            source: anchorSource,
            segmentId: meta?.segmentId,
            relatedSegmentIds: meta?.relatedSegmentIds,
            stopCoordinate,
            routeAnchorCoordinate: nearest.distanceMeters <= CONNECTOR_POLICY.maxSchematicAccessLinkMeters ? nearest.coordinate : stopCoordinate,
            snapDistanceMeters: nearest.distanceMeters,
            anchorSource,
        };
    }

    const endpoint = fallback === "start" ? coordinates[0] : coordinates[coordinates.length - 1];
    if (endpoint) {
        const snapDistanceMeters = distanceMeters(stopCoordinate, endpoint);
        return {
            id: anchorId,
            type: anchorType,
            name: meta?.name,
            rawCoordinate: stopCoordinate,
            renderCoordinate: endpoint,
            source: "ROUTE_ENDPOINT",
            segmentId: meta?.segmentId,
            relatedSegmentIds: meta?.relatedSegmentIds,
            stopCoordinate,
            routeAnchorCoordinate: endpoint,
            snapDistanceMeters,
            anchorSource: "ROUTE_ENDPOINT",
        };
    }

    return {
        id: anchorId,
        type: anchorType,
        name: meta?.name,
        rawCoordinate: stopCoordinate,
        renderCoordinate: stopCoordinate,
        source: "UNSNAPPED",
        segmentId: meta?.segmentId,
        relatedSegmentIds: meta?.relatedSegmentIds,
        stopCoordinate,
        routeAnchorCoordinate: stopCoordinate,
        snapDistanceMeters: 0,
        anchorSource: "UNSNAPPED",
    };
}

function createWalkEndpointAnchor(
    id: string,
    type: "WALK_START" | "WALK_END",
    rawCoordinate: Coordinate | undefined,
    renderCoordinate: Coordinate | undefined,
    segmentId?: string
): RouteAnchor | undefined {
    if (!isValidCoordinate(rawCoordinate) || !isValidCoordinate(renderCoordinate)) return undefined;
    const snapDistanceMeters = distanceMeters(rawCoordinate, renderCoordinate);
    return {
        id,
        type,
        rawCoordinate,
        renderCoordinate,
        snapDistanceMeters,
        source: snapDistanceMeters <= TRANSIT_WALK_RIDE_SNAP_MAX_METERS
            ? "WALK_ENDPOINT"
            : "SHORT_CONNECTOR",
        segmentId,
    };
}

function getRenderableStopCoordinate(anchor: TransitStopAnchor | undefined): Coordinate | undefined {
    if (!anchor) return undefined;
    if (
        anchor.anchorSource === "UNSNAPPED" &&
        (anchor.snapDistanceMeters ?? Number.POSITIVE_INFINITY) > CONNECTOR_POLICY.maxSchematicAccessLinkMeters
    ) {
        return anchor.stopCoordinate;
    }
    return anchor.routeAnchorCoordinate;
}

function getAnchorPathPosition(
    point: Coordinate | undefined,
    polyline: Coordinate[] | undefined
): { segmentIndex: number; ratio: number; distanceMeters: number } | undefined {
    if (!isValidCoordinate(point) || !Array.isArray(polyline) || polyline.length < 2) return undefined;
    const nearest = nearestPointOnPolyline(point, polyline);
    if (!nearest) return undefined;
    return {
        segmentIndex: nearest.segmentIndex,
        ratio: nearest.ratio,
        distanceMeters: nearest.distanceMeters,
    };
}

function slicePolylineBetweenAnchors(
    coordinates: Coordinate[] | undefined,
    startAnchor: TransitStopAnchor | undefined,
    endAnchor: TransitStopAnchor | undefined
): Coordinate[] {
    const validCoordinates = Array.isArray(coordinates)
        ? coordinates.filter(isValidCoordinate)
        : [];
    if (validCoordinates.length < 2) return validCoordinates;

    const startCoordinate = getRenderableStopCoordinate(startAnchor);
    const endCoordinate = getRenderableStopCoordinate(endAnchor);
    const startPosition = getAnchorPathPosition(startCoordinate, validCoordinates);
    const endPosition = getAnchorPathPosition(endCoordinate, validCoordinates);
    if (!startPosition || !endPosition) return validCoordinates;

    if (startPosition.segmentIndex > endPosition.segmentIndex ||
        (
            startPosition.segmentIndex === endPosition.segmentIndex &&
            startPosition.ratio > endPosition.ratio
        )
    ) {
        const reversed = validCoordinates.slice().reverse();
        return slicePolylineBetweenAnchors(reversed, startAnchor, endAnchor);
    }

    const startPoint = startCoordinate ?? validCoordinates[0];
    const endPoint = endCoordinate ?? validCoordinates[validCoordinates.length - 1];
    const sliced: Coordinate[] = [startPoint];
    for (let index = startPosition.segmentIndex + 1; index <= endPosition.segmentIndex; index += 1) {
        const point = validCoordinates[index];
        if (point && distanceMeters(sliced[sliced.length - 1], point) > 1) {
            sliced.push(point);
        }
    }
    if (distanceMeters(sliced[sliced.length - 1], endPoint) > 1) {
        sliced.push(endPoint);
    } else {
        sliced[sliced.length - 1] = endPoint;
    }
    return sliced.length >= 2 ? sliced : validCoordinates;
}

function getRouteAnchorMaxSnapDistanceMeters(anchors: Array<RouteAnchor | undefined>): number | undefined {
    const distances = anchors
        .map((anchor) => anchor?.snapDistanceMeters)
        .filter((distance): distance is number => typeof distance === "number" && Number.isFinite(distance));
    if (!distances.length) return undefined;
    return Math.max(...distances);
}

function hasRouteAnchorGeometryMismatch(anchors: Array<RouteAnchor | undefined>): boolean {
    return anchors.some((anchor) => {
        if (!anchor) return false;
        if (anchor.source === "UNSNAPPED") return true;
        return typeof anchor.snapDistanceMeters === "number" && anchor.snapDistanceMeters > 60;
    });
}

function hasRouteAnchorAdjustment(anchors: Array<RouteAnchor | undefined>): boolean {
    return anchors.some((anchor) => {
        if (!anchor) return false;
        if (anchor.source === "NEAREST_ON_ROUTE" && typeof anchor.snapDistanceMeters === "number") {
            return anchor.snapDistanceMeters > 0.5;
        }
        if (anchor.source === "SHORT_CONNECTOR") return true;
        return typeof anchor.snapDistanceMeters === "number" && anchor.snapDistanceMeters > 30;
    });
}

function getRouteGeometryQuality(
    mode: RouteMode,
    geometrySource: GeometrySource | undefined,
    pointCount: number,
    isManualSamplePath: boolean,
    anchors: Array<RouteAnchor | undefined> = [],
    anchorAdjusted = false
): RouteGeometryQuality {
    if (isManualSamplePath) return "MANUAL_SAMPLE";
    if (geometrySource === "START_END_ONLY") return "START_END_ONLY";
    if (geometrySource === "PASS_STOP_LIST") return "PASS_STOP_ONLY";
    if (hasRouteAnchorGeometryMismatch(anchors)) return "GEOMETRY_MISMATCH";
    if (
        geometrySource === "TRANSIT_PASS_SHAPE_LINESTRING" ||
        geometrySource === "WALK_STEPS_LINESTRING" ||
        geometrySource === "WALK_PASS_SHAPE_LINESTRING" ||
        geometrySource === "WALK_API_DETAIL"
    ) {
        if (pointCount < (mode === "WALK" || mode === "TRANSFER" ? 3 : 10)) {
            return "COARSE_API_GEOMETRY";
        }
        return anchorAdjusted || hasRouteAnchorAdjustment(anchors) || (getRouteAnchorMaxSnapDistanceMeters(anchors) ?? 0) > 30
            ? "ANCHOR_ADJUSTED_GEOMETRY"
            : "HIGH_API_GEOMETRY";
    }
    if (geometrySource === "ITINERARY_PATH_SNAP") return "COARSE_API_GEOMETRY";
    return "UNKNOWN";
}

function dedupeCoordinatesByDistance(coordinates: Coordinate[] | undefined, minDistanceMeters: number): Coordinate[] {
    const validCoordinates = Array.isArray(coordinates)
        ? coordinates.filter(isValidCoordinate)
        : [];
    if (validCoordinates.length < 2) return validCoordinates;

    const minimum = Math.max(0.5, minDistanceMeters);
    const result: Coordinate[] = [validCoordinates[0]];
    for (let index = 1; index < validCoordinates.length; index += 1) {
        const point = validCoordinates[index];
        const previous = result[result.length - 1];
        const isTail = index === validCoordinates.length - 1;
        if (isTail || distanceMeters(previous, point) >= minimum) {
            result.push(point);
        }
    }
    return result;
}

function createRenderedCoordinates(segment: RouteSegment): Coordinate[] {
    const minDistanceMeters = segment.mode === "WALK" || segment.mode === "TRANSFER" ? 2.4 : 1.4;
    // 공급자 선형의 코너를 임의로 잘라내지 않는다. round lineJoin은 SDK가 화면에서 처리한다.
    return dedupeCoordinatesByDistance(segment.coordinates, minDistanceMeters);
}

function createRenderedCoordinateParts(segment: RouteSegment): Coordinate[][] | undefined {
    if (!segment.coordinateParts?.length) return undefined;
    const minDistanceMeters = segment.mode === "WALK" || segment.mode === "TRANSFER" ? 2.4 : 1.4;
    const parts = segment.coordinateParts
        .map((part) => dedupeCoordinatesByDistance(part, minDistanceMeters))
        .filter((part) => part.length >= 2);
    return parts.length > 1 ? parts : undefined;
}

function getCoordinateAtPathRatio(coordinates: Coordinate[] | undefined, ratio: number): Coordinate | undefined {
    const validCoordinates = Array.isArray(coordinates)
        ? coordinates.filter(isValidCoordinate)
        : [];
    if (validCoordinates.length === 0) return undefined;
    if (validCoordinates.length === 1) return validCoordinates[0];

    const totalLength = getSegmentLengthMeters(validCoordinates);
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
        return validCoordinates[Math.floor((validCoordinates.length - 1) * Math.max(0, Math.min(1, ratio)))];
    }

    const targetDistance = totalLength * Math.max(0, Math.min(1, ratio));
    let traveled = 0;
    for (let index = 1; index < validCoordinates.length; index += 1) {
        const from = validCoordinates[index - 1];
        const to = validCoordinates[index];
        const segmentLength = distanceMeters(from, to);
        if (!Number.isFinite(segmentLength) || segmentLength <= 0) continue;
        if (traveled + segmentLength >= targetDistance) {
            return interpolateCoordinate(from, to, (targetDistance - traveled) / segmentLength);
        }
        traveled += segmentLength;
    }
    return validCoordinates[validCoordinates.length - 1];
}

function findRouteSegmentForQaPreset(
    route: NormalizedRoute | undefined,
    presetId: QaCameraPresetId
): RouteSegment | undefined {
    if (!route?.segments?.length) return undefined;
    if (presetId.startsWith("subway")) {
        return route.segments.find((segment) => segment.mode === "SUBWAY");
    }
    if (presetId.startsWith("bus")) {
        return route.segments.find((segment) => segment.mode === "BUS");
    }
    if (presetId === "walkTransferZoom17" || presetId === "walkTransferZoom18") {
        return route.segments.find((segment) => segment.mode === "TRANSFER") ??
            route.segments.find((segment) => segment.mode === "WALK");
    }
    return route.segments[0];
}

function getQaPresetZoom(presetId: QaCameraPresetId, fallbackZoom?: number): number {
    if (presetId.endsWith("Zoom12")) return 12;
    if (presetId.endsWith("Zoom15")) return 15;
    if (presetId.endsWith("Zoom17")) return 17;
    if (presetId.endsWith("Zoom18")) return 18;
    return fallbackZoom ?? 12;
}

function getQaPassStopCenter(
    legs: TransitLegDetail[] | undefined,
    kind: "BUS" | "SUBWAY"
): Coordinate | undefined {
    const leg = legs?.find((candidate) => candidate.kind === kind);
    const intermediateStops = leg?.passStops?.slice(1, -1).filter((stop) => (
        !!stop.coord && Number.isFinite(stop.coord.lat) && Number.isFinite(stop.coord.lng)
    )) ?? [];
    const stop = intermediateStops[Math.floor(intermediateStops.length / 2)];
    return stop?.coord ? { latitude: stop.coord.lat, longitude: stop.coord.lng } : undefined;
}

function buildQaCameraPreset(
    presetId: QaCameraPresetId | undefined,
    route: NormalizedRoute | undefined,
    fallbackZoom?: number,
    endpoints?: {
        origin?: Coordinate;
        destination?: Coordinate;
        transitLegs?: TransitLegDetail[];
    }
): QaCameraPreset | undefined {
    if (!presetId) return undefined;
    if (presetId === "routeOverview") {
        const overviewCoordinates = route?.segments.flatMap((segment) => (
            segment.renderedCoordinates?.length ? segment.renderedCoordinates : segment.coordinates
        )) ?? [];
        const center = getCoordinateAtPathRatio(overviewCoordinates, 0.5);
        if (!center) return undefined;
        return {
            id: presetId,
            center,
            boundsCoordinates: overviewCoordinates,
            zoom: fallbackZoom ?? 11.4,
            description: "route overview",
            disableAutoFit: true,
        };
    }
    if (presetId === "routeStart" || presetId === "firstBoard" || presetId === "routeEnd") {
        const orderedSegments = route?.segments ?? [];
        const firstSegmentCoordinates = orderedSegments[0]?.renderedCoordinates?.length
            ? orderedSegments[0].renderedCoordinates
            : orderedSegments[0]?.coordinates;
        const lastSegment = orderedSegments[orderedSegments.length - 1];
        const lastSegmentCoordinates = lastSegment?.renderedCoordinates?.length
            ? lastSegment.renderedCoordinates
            : lastSegment?.coordinates;
        const firstRideSegment = orderedSegments.find((segment) => isTransitRideSegmentMode(segment.mode));
        const firstBoardAccessCoordinate = resolveTransitStopAccessCoordinate(firstRideSegment?.boardAnchor);
        const center = presetId === "routeStart"
            ? (endpoints?.origin ?? firstSegmentCoordinates?.[0])
            : presetId === "routeEnd"
                ? (endpoints?.destination ?? lastSegmentCoordinates?.[lastSegmentCoordinates.length - 1])
                : firstBoardAccessCoordinate;
        if (!center) return undefined;
        return {
            id: presetId,
            center,
            zoom: fallbackZoom ?? 17,
            description: presetId === "routeStart"
                ? "route start"
                : presetId === "routeEnd"
                    ? "route end"
                    : "first boarding access point",
            disableAutoFit: true,
        };
    }
    const segment = findRouteSegmentForQaPreset(route, presetId);
    const coordinates = segment?.renderedCoordinates?.length ? segment.renderedCoordinates : segment?.coordinates;
    const isDetailZoomPreset = presetId.endsWith("Zoom17") || presetId.endsWith("Zoom18");
    const isStopDensityPreset = presetId === "busStopsZoom18" || presetId === "subwayStopsZoom18";
    const isTransferPreset = presetId.startsWith("walkTransfer");
    const transferCenter = isTransferPreset ? getCoordinateAtPathRatio(coordinates, 0.5) : undefined;
    const passStopCenter = presetId === "busStopsZoom18"
        ? getQaPassStopCenter(endpoints?.transitLegs, "BUS")
        : presetId === "subwayStopsZoom18"
            ? getQaPassStopCenter(endpoints?.transitLegs, "SUBWAY")
            : undefined;
    const midpointCenter = isStopDensityPreset
        ? (passStopCenter ?? getCoordinateAtPathRatio(coordinates, 0.45))
        : undefined;
    const anchorCenter = transferCenter ?? midpointCenter ??
        segment?.boardAnchor?.routeAnchorCoordinate ??
        segment?.startAnchor?.renderCoordinate ??
        (Array.isArray(coordinates) ? coordinates[0] : undefined);
    const center = isDetailZoomPreset && anchorCenter
        ? anchorCenter
        : getCoordinateAtPathRatio(coordinates, 0.45);
    if (!center) return undefined;
    const segmentFocusCoordinates = segment ? getSegmentFocusBounds(segment) : coordinates;
    const boundsCoordinates = isDetailZoomPreset
        ? getLocalFocusCoordinates(segmentFocusCoordinates, center, 540)
        : segmentFocusCoordinates;
    return {
        id: presetId,
        center,
        boundsCoordinates,
        zoom: getQaPresetZoom(presetId, fallbackZoom),
        description: `${presetId} ${segment?.mode ?? "UNKNOWN"} ${segment?.lineName ?? ""}`.trim(),
        disableAutoFit: true,
    };
}

function getRouteAnchorsForSegment(segment: RouteSegment | undefined): Coordinate[] {
    if (!segment) return [];
    return [
        segment.startAnchor?.renderCoordinate,
        segment.endAnchor?.renderCoordinate,
        segment.boardAnchor?.routeAnchorCoordinate,
        segment.alightAnchor?.routeAnchorCoordinate,
    ].filter(isValidCoordinate);
}

function getSegmentFocusBounds(segment: RouteSegment | undefined): Coordinate[] {
    if (!segment) return [];
    const renderedCoordinates = segment.renderedCoordinates?.length
        ? segment.renderedCoordinates
        : segment.coordinates;
    return [
        ...(Array.isArray(renderedCoordinates) ? renderedCoordinates : []),
        ...getRouteAnchorsForSegment(segment),
    ].filter(isValidCoordinate);
}

function getLocalFocusCoordinates(
    coordinates: Coordinate[] | undefined,
    center: Coordinate,
    radiusMeters: number
): Coordinate[] {
    const validCoordinates = Array.isArray(coordinates) ? coordinates.filter(isValidCoordinate) : [];
    const local = validCoordinates.filter((coord) => distanceMeters(center, coord) <= radiusMeters);
    if (local.length >= 2) return [center, ...local];
    const nearest = validCoordinates
        .map((coord) => ({ coord, distance: distanceMeters(center, coord) }))
        .filter((item) => Number.isFinite(item.distance))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 4)
        .map((item) => item.coord);
    return [center, ...nearest].filter(isValidCoordinate);
}

function getCoordinateBounds(coordinates: Coordinate[] | undefined): {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    center: Coordinate;
} | undefined {
    const validCoordinates = Array.isArray(coordinates) ? coordinates.filter(isValidCoordinate) : [];
    if (validCoordinates.length === 0) return undefined;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    validCoordinates.forEach((coord) => {
        minLat = Math.min(minLat, coord.latitude);
        maxLat = Math.max(maxLat, coord.latitude);
        minLng = Math.min(minLng, coord.longitude);
        maxLng = Math.max(maxLng, coord.longitude);
    });
    return {
        minLat,
        maxLat,
        minLng,
        maxLng,
        center: {
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
        },
    };
}

function fitCameraToBoundsWithUiPadding(
    coordinates: Coordinate[] | undefined,
    padding: { top: number; bottom: number; left: number; right: number },
    viewport: { width: number; height: number }
): {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
    pivot: { x: number; y: number };
} | undefined {
    const bounds = getCoordinateBounds(coordinates);
    if (!bounds || viewport.width <= 0 || viewport.height <= 0) return undefined;
    const usableWidth = Math.max(160, viewport.width - padding.left - padding.right);
    const usableHeight = Math.max(160, viewport.height - padding.top - padding.bottom);
    const centerLat = bounds.center.latitude;
    const lngMetersPerDegree = Math.max(1, 111_320 * Math.cos((centerLat * Math.PI) / 180));
    const minSpanMeters = 180;
    const rawLatDelta = Math.max((bounds.maxLat - bounds.minLat), minSpanMeters / 111_320);
    const rawLngDelta = Math.max((bounds.maxLng - bounds.minLng), minSpanMeters / lngMetersPerDegree);
    const latitudeDelta = rawLatDelta * 1.18 * Math.max(1, viewport.height / usableHeight);
    const longitudeDelta = rawLngDelta * 1.18 * Math.max(1, viewport.width / usableWidth);
    const pivot = {
        x: Math.max(0.18, Math.min(0.82, (padding.left + (usableWidth / 2)) / viewport.width)),
        y: Math.max(0.18, Math.min(0.82, (padding.top + (usableHeight / 2)) / viewport.height)),
    };
    return {
        latitude: bounds.minLat - ((latitudeDelta - rawLatDelta) / 2),
        longitude: bounds.minLng - ((longitudeDelta - rawLngDelta) / 2),
        latitudeDelta,
        longitudeDelta,
        pivot,
    };
}

function inferTmapZoomByRegionDelta(latitudeDelta: number, longitudeDelta: number): number {
    const maxDelta = Math.max(latitudeDelta || 0, longitudeDelta || 0);
    if (maxDelta > 2.2) return 8;
    if (maxDelta > 1.1) return 9;
    if (maxDelta > 0.65) return 10;
    if (maxDelta > 0.35) return 11;
    if (maxDelta > 0.18) return 12;
    if (maxDelta > 0.09) return 13;
    if (maxDelta > 0.045) return 14;
    if (maxDelta > 0.022) return 15;
    return 16;
}

function getTmapRegionCameraTarget(region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
    pivot?: { x: number; y: number };
    zoomOffset?: number;
}): { center: Coordinate; zoom: number } {
    const pivotX = Math.max(0, Math.min(1, region.pivot?.x ?? 0.5));
    const pivotY = Math.max(0, Math.min(1, region.pivot?.y ?? 0.5));
    const regionCenterLatitude = region.latitude + (region.latitudeDelta / 2);
    const regionCenterLongitude = region.longitude + (region.longitudeDelta / 2);
    return {
        center: {
            latitude: regionCenterLatitude - ((0.5 - pivotY) * region.latitudeDelta),
            longitude: regionCenterLongitude - ((pivotX - 0.5) * region.longitudeDelta),
        },
        zoom: Math.max(
            6,
            Math.min(
                18,
                inferTmapZoomByRegionDelta(region.latitudeDelta, region.longitudeDelta) +
                    (region.zoomOffset ?? 0)
            )
        ),
    };
}

function getPaddedCameraCenterForFixedZoom(
    coordinates: Coordinate[] | undefined,
    padding: { top: number; bottom: number; left: number; right: number },
    viewport: { width: number; height: number },
    zoom: number
): Coordinate | undefined {
    const bounds = getCoordinateBounds(coordinates);
    if (!bounds || viewport.width <= 0 || viewport.height <= 0) return undefined;
    const center = bounds.center;
    const usableCenterX = padding.left + ((viewport.width - padding.left - padding.right) / 2);
    const usableCenterY = padding.top + ((viewport.height - padding.top - padding.bottom) / 2);
    const dxPixels = (viewport.width / 2) - usableCenterX;
    const dyPixels = (viewport.height / 2) - usableCenterY;
    const metersPerPixel = (
        156_543.03392 *
        Math.cos((center.latitude * Math.PI) / 180)
    ) / (2 ** Math.max(6, Math.min(18, zoom)));
    const shifted = offsetCoordByMeters(
        { lat: center.latitude, lng: center.longitude },
        dyPixels * metersPerPixel,
        -dxPixels * metersPerPixel
    );
    return { latitude: shifted.lat, longitude: shifted.lng };
}

type RoutePointTarget = "origin" | "destination";
type TransitRouteFilter = "ALL" | "BUS" | "SUBWAY" | "MIXED";
type RoutePlannerFocusTarget = "origin" | "destination" | "startRide" | "firstSubway";
type DebugSheetState = "collapsed" | "middle" | "hidden" | "expanded";
type CameraMode = "ROUTE_OVERVIEW" | "SEGMENT_FOCUS_QA" | "USER_CONTROLLED";
type RouteQaLayerMode =
    | "ALL"
    | "BASE_ONLY"
    | "APP_ROUTE_ONLY"
    | "APP_ROUTE_DIM_BASE"
    | "ANCHOR_DEBUG"
    | "CONNECTOR_DEBUG"
    | "ROUTE_VISIBILITY_DEBUG";
type CameraUpdateReason =
    | "INITIAL_ROUTE_FIT"
    | "ROUTE_CHANGED"
    | "SEGMENT_SELECTED"
    | "QA_PRESET"
    | "USER_GESTURE"
    | "BOTTOM_SHEET_LAYOUT";
type QaCameraPresetId =
    | "routeOverview"
    | "routeStart"
    | "firstBoard"
    | "routeEnd"
    | "subwayZoom12"
    | "subwayZoom15"
    | "subwayZoom17"
    | "subwayStopsZoom18"
    | "busZoom12"
    | "busZoom15"
    | "busZoom17"
    | "busStopsZoom18"
    | "walkTransferZoom17"
    | "walkTransferZoom18";
type QaCameraPreset = {
    id: QaCameraPresetId;
    center: Coordinate;
    boundsCoordinates?: Coordinate[];
    zoom: number;
    description: string;
    disableAutoFit: boolean;
};
type BottomSheetSnap = "expanded" | "middle" | "collapsed" | "hidden";
const BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION = 180;
const BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD = 0.45;
// TMAP Web SDK는 iOS WebView에서 6 미만 setZoom을 적용하지 않으므로 앱 범위도 일치시킨다.
const DEBUG_FOCUS_MIN_ZOOM = 6;
const DEBUG_FOCUS_MAX_ZOOM = 18;
const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> = [
    { key: "ALL", label: "전체" },
    { key: "BUS", label: "버스" },
    { key: "SUBWAY", label: "지하철" },
    { key: "MIXED", label: "버스+지하철" },
];
// 모듈 레벨 상수 — 렌더마다 새 객체를 만들면 지도가 카메라를 계속 리셋할 수 있음
const INITIAL_CAMERA = { latitude: FALLBACK_LAT, longitude: FALLBACK_LNG, zoom: 12 };

function placeHasCoords(place: Place): place is Place & { lat: number; lng: number } {
    return typeof place.lat === "number" && Number.isFinite(place.lat) &&
        typeof place.lng === "number" && Number.isFinite(place.lng);
}

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

function parseDepartureAtParam(value: string | string[] | undefined): Date | undefined {
    const raw = getSingleParam(value)?.trim();
    if (!raw) return undefined;
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function parseRoutePointTargetParam(value: string | string[] | undefined): RoutePointTarget | undefined {
    const raw = getSingleParam(value)?.trim();
    return raw === "origin" || raw === "destination" ? raw : undefined;
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
    // `middle` is the only state used by the production schedule handoff. The
    // remaining states are camera/sheet QA fixtures and must not be reachable
    // from a user-provided deep link in a release build.
    if (raw === "middle") return raw;
    if (
        typeof __DEV__ === "boolean" &&
        __DEV__ &&
        (raw === "collapsed" || raw === "hidden" || raw === "expanded")
    ) return raw;
    return undefined;
}

function parseQaCameraPresetParam(value: string | string[] | undefined): QaCameraPresetId | undefined {
    const raw = getSingleParam(value)?.trim();
    const presets: QaCameraPresetId[] = [
        "routeOverview",
        "routeStart",
        "firstBoard",
        "routeEnd",
        "subwayZoom12",
        "subwayZoom15",
        "subwayZoom17",
        "subwayStopsZoom18",
        "busZoom12",
        "busZoom15",
        "busZoom17",
        "busStopsZoom18",
        "walkTransferZoom17",
        "walkTransferZoom18",
    ];
    return presets.includes(raw as QaCameraPresetId) ? raw as QaCameraPresetId : undefined;
}

function parseRouteQaLayerModeParam(value: string | string[] | undefined): RouteQaLayerMode {
    const raw = getSingleParam(value)?.trim().toUpperCase();
    const modes: RouteQaLayerMode[] = [
        "ALL",
        "BASE_ONLY",
        "APP_ROUTE_ONLY",
        "APP_ROUTE_DIM_BASE",
        "ANCHOR_DEBUG",
        "CONNECTOR_DEBUG",
        "ROUTE_VISIBILITY_DEBUG",
    ];
    return modes.includes(raw as RouteQaLayerMode) ? (raw as RouteQaLayerMode) : "ALL";
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
    if (typeof option.tollFareWon === "number" && option.tollFareWon > 0) {
        chunks.push(`통행료 ${option.tollFareWon.toLocaleString()}원`);
    }
    if (typeof option.taxiFareWon === "number" && option.taxiFareWon > 0) {
        chunks.push(`택시 예상 ${option.taxiFareWon.toLocaleString()}원`);
    }

    const distanceText = formatDistance(option.distanceMeters);
    if (distanceText) {
        chunks.push(distanceText);
    }

    if (!chunks.length) {
        return "경로 안내";
    }

    return chunks.join(" · ");
}

function getAlternativeMetricTags(option: RouteAlternativeOption): string[] {
    const metrics: string[] = [];
    if (option.routePlausibility === "geometry_suspected") {
        metrics.push("좌표 검증 필요");
    }
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
    if (typeof option.tollFareWon === "number" && option.tollFareWon > 0) {
        metrics.push(`통행료 ${option.tollFareWon.toLocaleString()}원`);
    }
    if (typeof option.taxiFareWon === "number" && option.taxiFareWon > 0) {
        metrics.push(`택시 예상 ${option.taxiFareWon.toLocaleString()}원`);
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
    return getNaverLikeTransitRouteCategory(option) as TransitRouteFilter;
}

function getTransitRouteTransferCount(option: RouteAlternativeOption): number {
    return getNaverLikeRouteTransferCount(option);
}

function sortRouteAlternativesForPlanner(options: RouteAlternativeOption[], mode: TravelMode): RouteAlternativeOption[] {
    if (mode === "TRANSIT") return selectNaverLikeRouteAlternatives(options, mode, "ALL");
    return [...options]
        .sort((a, b) => {
            const aMinutes = typeof a.minutes === "number" ? a.minutes : Number.POSITIVE_INFINITY;
            const bMinutes = typeof b.minutes === "number" ? b.minutes : Number.POSITIVE_INFINITY;
            return aMinutes - bMinutes;
        })
        .slice(0, 4);
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
    return getSharedSubwayLineColor(lineName);
}

function getTransitLegVisualColor(
    leg: Pick<TransitLegDetail, "kind" | "lineName" | "lineColor"> & { label?: string }
): string {
    const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
    if (leg.kind === "SUBWAY") return getSubwayLineColor(lineLabel);
    if (leg.kind === "BUS") return getSharedBusLineColor(lineLabel, leg.lineColor);
    return TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR;
}

function getMapTransitLegVisualColor(
    leg: Pick<TransitLegDetail, "kind" | "lineName" | "lineColor"> & { label?: string }
): string {
    const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
    if (leg.kind === "BUS") return getMapBusRouteColor(lineLabel);
    if (leg.kind === "SUBWAY") return getSubwayLineColor(lineLabel);
    return TRANSIT_LEG_COLOR[leg.kind] ?? SELECTED_ROUTE_COLOR;
}

function getTransitKindLineColor(
    kind: TransitLegDetail["kind"],
    lineLabel?: string,
    lineColor?: string
): string {
    if (kind === "SUBWAY") return getSubwayLineColor(lineLabel);
    if (kind === "BUS") return getSharedBusLineColor(lineLabel, lineColor);
    return TRANSIT_LEG_COLOR[kind] ?? SELECTED_ROUTE_COLOR;
}

function isRideLegKind(kind: TransitLegDetail["kind"]): kind is TransitStopMarkerKind {
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

function getTransitLegStopAnchor(
    leg: TransitLegDetail,
    position: "BOARD" | "ALIGHT"
): TransitStopAnchor | undefined {
    const stopCoord = position === "BOARD" ? getTransitLegBoardCoord(leg) : getTransitLegAlightCoord(leg);
    const displayPath = Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
        ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
        : [];
    const routeCoordinates = routePathCoordsToCoordinates(displayPath);
    return createTransitStopAnchor(
        toCoordinate(stopCoord),
        routeCoordinates,
        position === "BOARD" ? "start" : "end"
    );
}

function getTransitLegBoardAnchorOnPath(leg: TransitLegDetail): RoutePathCoord | undefined {
    const anchor = getTransitLegStopAnchor(leg, "BOARD");
    return toRoutePathCoord(anchor?.routeAnchorCoordinate) ??
        getTransitLegStartCoord(leg) ??
        (Array.isArray(leg.pathCoords) ? leg.pathCoords[0] : undefined);
}

function getTransitLegAlightAnchorOnPath(leg: TransitLegDetail): RoutePathCoord | undefined {
    const anchor = getTransitLegStopAnchor(leg, "ALIGHT");
    return toRoutePathCoord(anchor?.routeAnchorCoordinate) ??
        getTransitLegEndCoord(leg) ?? (
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

function getRideStopVisualCoord(
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    position: "BOARD" | "ALIGHT"
): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return undefined;
    const leg = legs[legIndex];
    if (!isRideLegKind(leg.kind)) return undefined;

    return getRideStopDisplayCoord(legs, legIndex, position);
}

/**
 * 승하차/환승 마커는 POI 접근 좌표가 아니라 실제로 렌더링되는 본선 anchor를 사용한다.
 * 보행 API 요청은 기존 20m 접근 정책을 유지하고, 화면의 노선 노드만 최종 선형과 맞춘다.
 */
function getRideStopRouteMarkerCoord(
    route: NormalizedRoute | undefined,
    legIndex: number,
    position: "BOARD" | "ALIGHT"
): RoutePathCoord | undefined {
    const segment = route?.segments.find((candidate) => candidate.sequence === legIndex);
    const anchor = position === "BOARD" ? segment?.boardAnchor : segment?.alightAnchor;
    return toRoutePathCoord(resolveTransitRouteNodeCoordinate(anchor));
}

function connectPathEndpoint(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord | undefined,
    position: "start" | "end"
): RoutePathCoord[] {
    const result = joinWalkPathEndpoint(pathCoords, endpoint, position);
    if (result.action === "rejected") {
        warnRouteDebug("[route-walk-anchor] connector rejected", {
            position,
            distanceMeters: Number.isFinite(result.gapMeters) ? Math.round(result.gapMeters!) : undefined,
            reason: "missing pedestrian geometry exceeds direct connector policy",
            target: position === "start" ? pathCoords[0] : pathCoords[pathCoords.length - 1],
            endpoint,
            maxDirectConnectorMeters: TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS,
        });
    }
    return result.pathCoords;
}

function prependShortConnectorIfNeeded(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord | undefined
): RoutePathCoord[] {
    return connectPathEndpoint(pathCoords, endpoint, "start");
}

function appendShortConnectorIfNeeded(
    pathCoords: RoutePathCoord[],
    endpoint: RoutePathCoord | undefined
): RoutePathCoord[] {
    return connectPathEndpoint(pathCoords, endpoint, "end");
}

function alignWalkSegmentEndpoints(
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    pathCoords: RoutePathCoord[]
): RoutePathCoord[] {
    if (!Array.isArray(legs) || !Array.isArray(pathCoords) || pathCoords.length < 2) return pathCoords;

    let alignedPath = pathCoords.slice();
    for (let index = legIndex - 1; index >= 0; index -= 1) {
        const candidate = legs[index];
        if (!candidate || !isRideLegKind(candidate.kind)) continue;
        alignedPath = prependShortConnectorIfNeeded(alignedPath, getRideStopVisualCoord(legs, index, "ALIGHT"));
        break;
    }
    for (let index = legIndex + 1; index < legs.length; index += 1) {
        const candidate = legs[index];
        if (!candidate || !isRideLegKind(candidate.kind)) continue;
        alignedPath = appendShortConnectorIfNeeded(alignedPath, getRideStopVisualCoord(legs, index, "BOARD"));
        break;
    }

    return alignedPath;
}

function alignWalkPathToRideEndpoints(
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    pathCoords: RoutePathCoord[]
): RoutePathCoord[] {
    const leg = legs?.[legIndex];
    let previousRideCoord: RoutePathCoord | undefined;
    let nextRideCoord: RoutePathCoord | undefined;
    if (Array.isArray(legs)) {
        for (let index = legIndex - 1; index >= 0; index -= 1) {
            if (!isRideLegKind(legs[index]?.kind)) continue;
            previousRideCoord = getTransitLegAlightAnchorOnPath(legs[index]);
            break;
        }
        for (let index = legIndex + 1; index < legs.length; index += 1) {
            if (!isRideLegKind(legs[index]?.kind)) continue;
            nextRideCoord = getTransitLegBoardAnchorOnPath(legs[index]);
            break;
        }
    }
    const displayPath = getStationTransferDisplayPath({
        pathCoords,
        startName: leg?.startName,
        endName: leg?.endName,
        distanceMeters: leg?.distanceMeters,
        previousRideCoord,
        nextRideCoord,
    });
    if (displayPath !== pathCoords) return displayPath;
    return alignWalkSegmentEndpoints(legs, legIndex, displayPath);
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
    const anchor = getTransitLegStopAnchor(leg, position);
    // 보행 안내와 마커는 실제 정류장/역 POI를 따른다. 운행 선형이 20m 안에 있을 때만
    // 선형 위 좌표를 공유해 버스 정류장 마커와 노선선이 자연스럽게 맞닿게 한다.
    const accessCoordinate = toRoutePathCoord(resolveTransitStopAccessCoordinate(anchor));
    return accessCoordinate ?? stopCoord ?? fallbackCoord;
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
    const visualCoord = getRideStopVisualCoord(legs, legIndex, position);
    return visualCoord ?? stopCoord ?? fallbackCoord;
}

function getTransitRouteStartFocusCoord(legs: TransitLegDetail[] | undefined): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legs.length === 0) return undefined;

    const firstRideLegIndex = legs.findIndex((leg) => isRideLegKind(leg.kind));
    if (firstRideLegIndex < 0) {
        return getWalkLegStartCoord(legs[0]) ?? getWalkLegEndCoord(legs[0]);
    }

    const firstRideLeg = legs[firstRideLegIndex];
    const visualCoord = getRideStopVisualCoord(legs, firstRideLegIndex, "BOARD");
    const approachStartCoord = getWalkLegStartCoord(legs[firstRideLegIndex - 1]);
    if (visualCoord && approachStartCoord) {
        const approachDistanceMeters = routeCoordDistanceMeters(approachStartCoord, visualCoord);
        if (Number.isFinite(approachDistanceMeters) && approachDistanceMeters <= 900) {
            return interpolateRouteCoord(approachStartCoord, visualCoord, 0.5);
        }
    }
    if (firstRideLeg.kind === "BUS") {
        return visualCoord
            ?? getRideStopConnectorCoord(legs, firstRideLegIndex, "BOARD")
            ?? getRideStopDisplayCoord(legs, firstRideLegIndex, "BOARD")
            ?? getTransitLegBoardCoord(firstRideLeg)
            ?? getTransitLegBoardAnchorOnPath(firstRideLeg);
    }

    return visualCoord
        ?? getTransitLegBoardCoord(firstRideLeg)
        ?? getAdjacentWalkReferenceCoord(legs, firstRideLegIndex, "BOARD")
        ?? getTransitLegBoardAnchorOnPath(firstRideLeg)
        ?? getTransitLegStartCoord(firstRideLeg);
}

function getTransitRouteFirstSubwayFocusCoord(legs: TransitLegDetail[] | undefined): RoutePathCoord | undefined {
    if (!Array.isArray(legs) || legs.length === 0) return undefined;
    const firstSubwayLegIndex = legs.findIndex((leg) => leg.kind === "SUBWAY");
    const firstSubwayLeg = firstSubwayLegIndex >= 0 ? legs[firstSubwayLegIndex] : undefined;
    if (!firstSubwayLeg) return undefined;

    return getRideStopVisualCoord(legs, firstSubwayLegIndex, "BOARD")
        ?? getTransitLegBoardCoord(firstSubwayLeg)
        ?? getTransitLegBoardAnchorOnPath(firstSubwayLeg)
        ?? getTransitLegStartCoord(firstSubwayLeg)
        ?? getTransitLegMidCoord(firstSubwayLeg);
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

function buildEndpointPathCoords(leg: TransitLegDetail): RoutePathCoord[] {
    const start = getTransitLegStartCoord(leg);
    const end = getTransitLegEndCoord(leg);
    if (start && end) return [start, end];
    if (start) return [start];
    if (end) return [end];
    return [];
}

type RouteSegmentGeometry = {
    rawCoordinates?: Coordinate[];
    coordinates: Coordinate[];
    coordinateParts?: Coordinate[][];
    geometrySource?: GeometrySource;
    geometryQuality?: RouteGeometryQuality;
    startAnchor?: RouteAnchor;
    endAnchor?: RouteAnchor;
    boardAnchor?: TransitStopAnchor;
    alightAnchor?: TransitStopAnchor;
    rawPointCount?: number;
};

function routePathCoordsToMapCoordinates(pathCoords: RoutePathCoord[] | undefined, kind?: TransitLegDetail["kind"]): Coordinate[] {
    return toDisplayOverlayCoords(pathCoords, kind)
        .filter(isValidCoordinate);
}

function passStopsToMapCoordinates(passStops?: TransitPassStop[]): Coordinate[] {
    if (!Array.isArray(passStops)) return [];
    const coordinates = passStops
        .map((stop) => stop.coord)
        .filter((coord): coord is RoutePathCoord => (
            !!coord &&
            Number.isFinite(coord.lat) &&
            Number.isFinite(coord.lng)
        ))
        .map((coord) => ({ latitude: coord.lat, longitude: coord.lng }));
    return dedupeCoordinatesByDistance(coordinates, 1.5);
}

function warnRouteGeometryFallback(
    reason: "PASS_STOP_LIST" | "START_END_ONLY" | "UNKNOWN",
    leg: TransitLegDetail,
    legIndex: number
) {
    if (typeof __DEV__ === "boolean" && !__DEV__) return;
    if (leg.kind === "WALK" && (leg.distanceMeters ?? 0) <= 1) return;
    console.warn("[route-geometry] fallback", {
        reason,
        legIndex,
        kind: leg.kind,
        lineName: leg.lineName,
        label: leg.label,
        pathGeometrySource: leg.pathGeometrySource,
        rawPathPointCount: leg.rawPathPointCount,
        pathCoordsLength: leg.pathCoords?.length ?? 0,
        passStopsLength: leg.passStops?.length ?? 0,
    });
}

function getLegGeometrySource(leg: TransitLegDetail, mode: RouteMode): GeometrySource | undefined {
    if (leg.pathGeometrySource) return leg.pathGeometrySource;
    // 환승 구간은 화면 모드만 TRANSFER로 바뀌며 원본 보행 geometry의 출처는 유지한다.
    if (leg.pathCoordsIsExact && leg.kind === "WALK") return "WALK_STEPS_LINESTRING";
    if (leg.pathCoordsIsExact && (mode === "BUS" || mode === "SUBWAY")) return "TRANSIT_PASS_SHAPE_LINESTRING";
    return undefined;
}

function buildTransitLegSegmentGeometry(
    routeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    mode: RouteMode,
    walkOverlayById?: Map<string, TmapLatLng[]>,
    isManualSamplePath = false
): RouteSegmentGeometry {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return { coordinates: [] };
    const leg = legs[legIndex];
    const legSource = getLegGeometrySource(leg, mode);
    const segmentId = `${routeId ?? "route"}-segment-${legIndex}`;

    if (isRideLegKind(leg.kind)) {
        const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
        const basePath = Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
            ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
            : [];
        const routeCoordinates = routePathCoordsToCoordinates(basePath);
        const boardAnchor = createTransitStopAnchor(
            toCoordinate(getTransitLegBoardCoord(leg)),
            routeCoordinates,
            "start",
            {
                id: `${segmentId}-boarding`,
                name: leg.startName,
                type: "BOARDING",
                segmentId,
            }
        );
        const alightAnchor = createTransitStopAnchor(
            toCoordinate(getTransitLegAlightCoord(leg)),
            routeCoordinates,
            "end",
            {
                id: `${segmentId}-alighting`,
                name: leg.endName,
                type: "ALIGHTING",
                segmentId,
            }
        );
        const displayCoords = routeCoordinates.length >= 2
            ? slicePolylineBetweenAnchors(routeCoordinates, boardAnchor, alightAnchor)
            : [];
        if (displayCoords.length >= 2) {
            if (legSource === "PASS_STOP_LIST") warnRouteGeometryFallback("PASS_STOP_LIST", leg, legIndex);
            if (!legSource || legSource === "UNKNOWN") warnRouteGeometryFallback("UNKNOWN", leg, legIndex);
            const anchorAdjusted = displayCoords.length !== routeCoordinates.length ||
                hasRouteAnchorAdjustment([boardAnchor, alightAnchor]);
            return {
                rawCoordinates: rawCoordinates.length >= 2 ? rawCoordinates : routeCoordinates,
                coordinates: displayCoords,
                geometrySource: legSource ?? "UNKNOWN",
                geometryQuality: getRouteGeometryQuality(
                    mode,
                    legSource ?? "UNKNOWN",
                    displayCoords.length,
                    isManualSamplePath,
                    [boardAnchor, alightAnchor],
                    anchorAdjusted
                ),
                startAnchor: boardAnchor,
                endAnchor: alightAnchor,
                boardAnchor,
                alightAnchor,
                rawPointCount: leg.rawPathPointCount ?? leg.pathCoords?.length ?? displayCoords.length,
            };
        }

        if (rawCoordinates.length >= 2) {
            if (legSource === "PASS_STOP_LIST") warnRouteGeometryFallback("PASS_STOP_LIST", leg, legIndex);
            if (!legSource || legSource === "UNKNOWN") warnRouteGeometryFallback("UNKNOWN", leg, legIndex);
            return {
                rawCoordinates,
                coordinates: rawCoordinates,
                geometrySource: legSource ?? "UNKNOWN",
                geometryQuality: getRouteGeometryQuality(
                    mode,
                    legSource ?? "UNKNOWN",
                    rawCoordinates.length,
                    isManualSamplePath,
                    [boardAnchor, alightAnchor],
                    false
                ),
                startAnchor: boardAnchor,
                endAnchor: alightAnchor,
                boardAnchor,
                alightAnchor,
                rawPointCount: leg.rawPathPointCount ?? leg.pathCoords?.length ?? rawCoordinates.length,
            };
        }
    }

    // ODsay의 기타 교통수단(셔틀·선박 등)도 공급자가 준 실제 geometry는 버리지 않는다.
    // 교통수단을 확정할 수 없으므로 중립 실선·무화살표인 UNKNOWN으로 표시한다.
    if (leg.kind === "ETC" && Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2) {
        const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
        const coordinates = routePathCoordsToMapCoordinates(leg.pathCoords, leg.kind);
        if (coordinates.length >= 2) {
            const geometrySource = legSource ?? "UNKNOWN";
            return {
                rawCoordinates: rawCoordinates.length >= 2 ? rawCoordinates : coordinates,
                coordinates,
                geometrySource,
                geometryQuality: getRouteGeometryQuality(
                    mode,
                    geometrySource,
                    coordinates.length,
                    isManualSamplePath
                ),
                rawPointCount: leg.rawPathPointCount ?? leg.pathCoords.length,
            };
        }
    }

    if (leg.kind === "WALK") {
        const baseId = routeId ? `${routeId}-walk-leg-${legIndex}` : undefined;
        const walkDetailCoords = baseId && walkOverlayById
            ? (walkOverlayById.get(baseId) ?? walkOverlayById.get(`${baseId}-path`))
            : undefined;

        // 보행 상세 조회가 끝났다면 출발/도착 및 승하차점에 보정된 좌표를 우선 사용한다.
        if (Array.isArray(walkDetailCoords) && walkDetailCoords.length >= 2) {
            const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
            const filteredCoords = walkDetailCoords.filter(isValidCoordinate);
            // walkOverlayById는 공급자 정밀 linestring 또는 별도 보행 API 성공 결과만 담는다.
            // 정규화 후 overlay id가 segment id로 바뀌어도 저장 단계에서 provenance를 남길 수 있게 한다.
            const geometrySource = resolveDetailedWalkGeometrySource(legSource);
            const startAnchor = createWalkEndpointAnchor(
                `${segmentId}-walk-start`,
                "WALK_START",
                rawCoordinates[0] ?? filteredCoords[0],
                filteredCoords[0],
                segmentId
            );
            const endAnchor = createWalkEndpointAnchor(
                `${segmentId}-walk-end`,
                "WALK_END",
                rawCoordinates[rawCoordinates.length - 1] ?? filteredCoords[filteredCoords.length - 1],
                filteredCoords[filteredCoords.length - 1],
                segmentId
            );
            return {
                rawCoordinates: rawCoordinates.length >= 2 ? rawCoordinates : filteredCoords,
                coordinates: filteredCoords,
                geometrySource,
                geometryQuality: getRouteGeometryQuality(
                    mode,
                    geometrySource,
                    filteredCoords.length,
                    isManualSamplePath,
                    [startAnchor, endAnchor],
                    hasRouteAnchorAdjustment([startAnchor, endAnchor])
                ),
                startAnchor,
                endAnchor,
                rawPointCount: leg.rawPathPointCount ?? walkDetailCoords.length,
            };
        }

        if (Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2) {
            const rawCoordinates = routePathCoordsToCoordinates(leg.pathCoords);
            const alignedPath = alignWalkPathToRideEndpoints(legs, legIndex, leg.pathCoords);
            const coordinateParts = splitWalkPathAtDiscontinuities(alignedPath)
                .map((part) => routePathCoordsToMapCoordinates(part, leg.kind))
                .filter((part) => part.length >= 2);
            const coordinates = coordinateParts.length > 0
                ? coordinateParts.flat()
                : routePathCoordsToMapCoordinates(alignedPath, leg.kind);
            if (coordinates.length >= 2) {
                const geometrySource = legSource ?? (leg.pathCoordsIsExact ? "WALK_STEPS_LINESTRING" : "UNKNOWN");
                const startAnchor = createWalkEndpointAnchor(
                    `${segmentId}-walk-start`,
                    "WALK_START",
                    rawCoordinates[0],
                    coordinates[0],
                    segmentId
                );
                const endAnchor = createWalkEndpointAnchor(
                    `${segmentId}-walk-end`,
                    "WALK_END",
                    rawCoordinates[rawCoordinates.length - 1],
                    coordinates[coordinates.length - 1],
                    segmentId
                );
                const anchorAdjusted = alignedPath.length !== leg.pathCoords.length ||
                    hasRouteAnchorAdjustment([startAnchor, endAnchor]);
                return {
                    rawCoordinates: rawCoordinates.length >= 2 ? rawCoordinates : coordinates,
                    coordinates,
                    coordinateParts: coordinateParts.length > 1 ? coordinateParts : undefined,
                    geometrySource,
                    geometryQuality: getRouteGeometryQuality(
                        mode,
                        geometrySource,
                        coordinates.length,
                        isManualSamplePath,
                        [startAnchor, endAnchor],
                        anchorAdjusted
                    ),
                    startAnchor,
                    endAnchor,
                    rawPointCount: leg.rawPathPointCount ?? leg.pathCoords.length,
                };
            }
        }

    }

    const passStopCoords = passStopsToMapCoordinates(leg.passStops);
    if (passStopCoords.length >= 2) {
        warnRouteGeometryFallback("PASS_STOP_LIST", leg, legIndex);
        return {
            coordinates: passStopCoords,
            geometrySource: "PASS_STOP_LIST",
            geometryQuality: getRouteGeometryQuality(mode, "PASS_STOP_LIST", passStopCoords.length, isManualSamplePath),
            rawPointCount: passStopCoords.length,
        };
    }

    if (isRideLegKind(leg.kind)) {
        warnRouteGeometryFallback("UNKNOWN", leg, legIndex);
        return {
            coordinates: [],
            geometrySource: legSource ?? "UNKNOWN",
            geometryQuality: getRouteGeometryQuality(mode, legSource ?? "UNKNOWN", 0, isManualSamplePath),
            rawPointCount: leg.rawPathPointCount,
        };
    }

    const endpointPath = buildEndpointPathCoords(leg);
    const endpointDistanceMeters = endpointPath.length >= 2
        ? routeCoordDistanceMeters(endpointPath[0], endpointPath[endpointPath.length - 1])
        : 0;
    const endpointCoords = routePathCoordsToMapCoordinates(
        leg.kind === "WALK" ? alignWalkPathToRideEndpoints(legs, legIndex, endpointPath) : endpointPath,
        leg.kind
    );
    if (endpointCoords.length >= 2) {
        warnRouteGeometryFallback("START_END_ONLY", leg, legIndex);
        if ((mode === "WALK" || mode === "TRANSFER") && endpointDistanceMeters > 40) {
            warnRouteDebug("[route-geometry] hidden long direct walk fallback", {
                legIndex,
                mode,
                distanceMeters: Math.round(endpointDistanceMeters),
                label: leg.label,
                startName: leg.startName,
                endName: leg.endName,
            });
            return {
                coordinates: [],
                geometrySource: "START_END_ONLY",
                geometryQuality: getRouteGeometryQuality(mode, "START_END_ONLY", endpointCoords.length, isManualSamplePath),
                rawPointCount: endpointCoords.length,
            };
        }
        return {
            coordinates: endpointCoords,
            geometrySource: "START_END_ONLY",
            geometryQuality: getRouteGeometryQuality(mode, "START_END_ONLY", endpointCoords.length, isManualSamplePath),
            rawPointCount: endpointCoords.length,
        };
    }

    warnRouteGeometryFallback("UNKNOWN", leg, legIndex);
    return {
        coordinates: [],
        geometrySource: legSource ?? "UNKNOWN",
        geometryQuality: getRouteGeometryQuality(mode, legSource ?? "UNKNOWN", 0, isManualSamplePath),
        rawPointCount: leg.rawPathPointCount,
    };
}

function getTransitLegMapCoords(
    routeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    legIndex: number,
    walkOverlayById?: Map<string, TmapLatLng[]>
): TmapLatLng[] {
    if (!Array.isArray(legs) || legIndex < 0 || legIndex >= legs.length) return [];
    const mode = resolveRouteSegmentMode(legs[legIndex], legIndex, legs);
    const geometry = buildTransitLegSegmentGeometry(routeId, legs, legIndex, mode, walkOverlayById);
    return geometry.coordinates.map((coord) => ({
        latitude: coord.latitude,
        longitude: coord.longitude,
    }));
}

function resolveRouteSegmentMode(
    leg: TransitLegDetail,
    index: number,
    legs: TransitLegDetail[] | undefined
): RouteMode {
    return getNormalizedTransitLegMode(leg, index, legs);
}

function normalizeRouteAlternativeToSegments(
    option: RouteAlternativeOption | undefined,
    walkOverlayById?: Map<string, TmapLatLng[]>
): NormalizedRoute | undefined {
    if (!option) return undefined;

    const segments: RouteSegment[] = [];
    const isManualSamplePath = isManualSampleRouteOption(option);
    if (Array.isArray(option.transitLegs) && option.transitLegs.length > 0) {
        option.transitLegs.forEach((leg, index) => {
            const mode = resolveRouteSegmentMode(leg, index, option.transitLegs);
            const geometry = buildTransitLegSegmentGeometry(
                option.id,
                option.transitLegs,
                index,
                mode,
                walkOverlayById,
                isManualSamplePath
            );
            const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
            const busType = leg.kind === "BUS" ? getBusBadgeType(lineLabel) : undefined;
            const routeColor = leg.kind === "BUS"
                ? (normalizeRouteColor(leg.lineColor) ?? getSharedBusLineColor(lineLabel, leg.lineColor))
                : (leg.kind === "SUBWAY" ? getSubwayLineColor(leg.lineName ?? leg.label) : undefined);
            const displayColor = leg.kind === "BUS"
                ? getMapBusRouteColor(lineLabel, busType)
                : routeColor;
            const baseSegment = ensureTransitSegmentPathOrder({
                id: `${option.id}-segment-${index}`,
                mode,
                rawCoordinates: geometry.rawCoordinates,
                coordinates: geometry.coordinates,
                coordinateParts: geometry.coordinateParts,
                distance: leg.distanceMeters,
                duration: leg.durationMinutes,
                lineName: lineLabel,
                lineColor: routeColor,
                routeColor,
                displayColor,
                busType,
                fromName: leg.startName,
                toName: leg.endName,
                geometrySource: geometry.geometrySource,
                geometryQuality: geometry.geometryQuality ??
                    getRouteGeometryQuality(mode, geometry.geometrySource, geometry.coordinates.length, isManualSamplePath),
                isManualSamplePath,
                nativeDirectionEnabled: isTransitRideSegmentMode(mode) && ENABLE_NATIVE_ROUTE_DIRECTION,
                startAnchor: geometry.startAnchor ?? geometry.boardAnchor,
                endAnchor: geometry.endAnchor ?? geometry.alightAnchor,
                boardAnchor: geometry.boardAnchor,
                alightAnchor: geometry.alightAnchor,
                rawPointCount: geometry.rawPointCount,
                sequence: index,
            });
            const renderedCoordinates = createRenderedCoordinates(baseSegment);
            const renderedCoordinateParts = createRenderedCoordinateParts(baseSegment);
            segments.push({
                ...baseSegment,
                renderedCoordinates,
                renderedCoordinateParts,
                renderPointCount: renderedCoordinates.length,
            });
        });
    } else {
        const coordinates = toDisplayOverlayCoords(
            option.pathCoords,
            option.mode === "WALK" ? "WALK" : undefined
        );
        if (coordinates.length > 0) {
            const fallbackMode = getNormalizedFallbackRouteMode(option.mode);
            segments.push({
                id: `${option.id}-segment-0`,
                mode: fallbackMode,
                coordinates,
                distance: option.distanceMeters,
                duration: option.minutes,
                geometrySource: Array.isArray(option.pathCoords) && option.pathCoords.length >= 2
                    ? "UNKNOWN"
                    : "START_END_ONLY",
                geometryQuality: getRouteGeometryQuality(
                    fallbackMode,
                    Array.isArray(option.pathCoords) && option.pathCoords.length >= 2 ? "UNKNOWN" : "START_END_ONLY",
                    coordinates.length,
                    isManualSamplePath
                ),
                isManualSamplePath,
                nativeDirectionEnabled: fallbackMode === "TRANSIT" && ENABLE_NATIVE_ROUTE_DIRECTION,
                rawPointCount: option.pathCoords?.length ?? coordinates.length,
                renderedCoordinates: coordinates,
                renderPointCount: coordinates.length,
                sequence: 0,
            });
        }
    }

    return {
        id: option.id,
        totalDuration: option.minutes,
        totalDistance: option.distanceMeters,
        fare: option.fareWon,
        segments,
    };
}

function RouteSegmentLayers(
    segment: RouteSegment,
    zoom: number,
    selected: boolean
): TmapPathOverlay[] {
    const coordinateParts = getSegmentRenderableCoordinateParts(segment);
    if (coordinateParts.length === 0) {
        if (!(segment.mode === "TRANSFER" && (segment.distance ?? 0) <= 1)) {
            warnRouteDebug("[route-segment] invalid coordinates", {
                id: segment.id,
                mode: segment.mode,
                geometrySource: segment.geometrySource,
                rawPointCount: segment.rawPointCount,
                length: getSegmentRenderableCoordinates(segment).length,
            });
        }
        return [];
    }

    const style = getSegmentStyle(segment, zoom, selected);
    const walkGuide = isWalkTransferSegment(segment)
        ? getTransitWalkGuidePresentation(zoom)
        : undefined;
    return coordinateParts.map((coordinates, partIndex) => ({
        id: coordinateParts.length === 1 ? segment.id : `${segment.id}-part-${partIndex}`,
        coords: coordinates,
        color: style.strokeColor,
        width: style.strokeWidth,
        opacity: style.opacity,
        outlineColor: style.outlineColor ?? "rgba(0,0,0,0)",
        outlineWidth: style.outlineWidth ?? 0,
        outlineOpacity: style.outlineOpacity,
        dashPattern: walkGuide ? [...walkGuide.dashPattern] : style.dashPattern,
        strokeStyle: walkGuide?.strokeStyle ?? "solid",
        outlineStrokeStyle: walkGuide?.outlineStrokeStyle ?? "solid",
        renderMode: "native",
        // 본선과 방향표를 하나의 TMAP Polyline으로 그려 줌 중에도 같은 좌표계에서 움직이게 한다.
        nativeDirection: shouldRenderNativeTransitDirection(segment, zoom),
        nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
        nativeDirectionOpacity: getNativeDirectionOpacity(zoom),
        zIndex: style.zIndex,
    }));
}

function isSimplifiedStationTransferSegment(segment: RouteSegment | undefined): boolean {
    if (!segment || segment.mode !== "TRANSFER") return false;
    const rawPointCount = segment.rawCoordinates?.length ?? segment.rawPointCount ?? 0;
    return rawPointCount >= 3 && segment.coordinates.length === 2 && segment.coordinates.length < rawPointCount;
}

function buildTransitStopAccessLinkOverlays(
    route: NormalizedRoute | undefined,
    zoom: number
): TmapPathOverlay[] {
    if (!route?.segments?.length || !shouldRenderTransitStopAccessLinks(zoom)) return [];
    const walkGuide = getTransitWalkGuidePresentation(zoom);
    const seen = new Set<string>();
    const overlays: TmapPathOverlay[] = route.segments.flatMap((segment, segmentIndex) => {
        if (!isTransitRideSegmentMode(segment.mode)) return [];
        return [segment.boardAnchor, segment.alightAnchor].flatMap((anchor, anchorIndex) => {
            const neighboringSegment = anchorIndex === 0
                ? route.segments[segmentIndex - 1]
                : route.segments[segmentIndex + 1];
            if (isSimplifiedStationTransferSegment(neighboringSegment)) return [];
            const link = getTransitStopAccessLink(anchor);
            if (!link) return [];
            const key = link
                .map((coord) => `${coord.latitude.toFixed(5)}:${coord.longitude.toFixed(5)}`)
                .join(">");
            if (seen.has(key)) return [];
            seen.add(key);

            // 보행 geometry가 아니라 역 POI와 선로 중심을 잇는 도식적 역사 내부 연결이다.
            return [{
                id: `${segment.id}-access-link-${anchorIndex}`,
                coords: link,
                color: ROUTE_TRANSFER_GUIDE_COLOR,
                width: Math.max(2.2, getTransitMainWidth(zoom) * 0.55),
                opacity: ROUTE_LINE_STYLE.transfer.opacity,
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(zoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                dashPattern: [...walkGuide.dashPattern],
                strokeStyle: walkGuide.strokeStyle,
                outlineStrokeStyle: walkGuide.outlineStrokeStyle,
                renderMode: "native",
                zIndex: 34 + Math.min(segment.sequence, 9) * 0.1,
            } as TmapPathOverlay];
        });
    });

    route.segments.forEach((segment, segmentIndex) => {
        // 버스 정류장 간 gap은 실제 보행 경로가 필요하다. 역사 내부로 해석 가능한 지하철만 도식 연결한다.
        if (segment.mode !== "SUBWAY") return;
        const neighboringWalks = [
            {
                position: "board" as const,
                walkSegment: route.segments[segmentIndex - 1],
                anchor: segment.boardAnchor,
            },
            {
                position: "alight" as const,
                walkSegment: route.segments[segmentIndex + 1],
                anchor: segment.alightAnchor,
            },
        ];

        neighboringWalks.forEach(({ position, walkSegment, anchor }, accessIndex) => {
            if (!walkSegment || (walkSegment.mode !== "WALK" && walkSegment.mode !== "TRANSFER")) return;
            if (isSimplifiedStationTransferSegment(walkSegment)) return;
            const walkCoordinates = walkSegment.coordinates.map((coord) => ({
                lat: coord.latitude,
                lng: coord.longitude,
            }));
            const stopMapCoord = resolveTransitStopAccessCoordinate(anchor);
            const stopCoord = stopMapCoord
                ? { lat: stopMapCoord.latitude, lng: stopMapCoord.longitude }
                : undefined;
            const link = getTransitWalkAccessLink(walkCoordinates, stopCoord, position);
            if (!link) return;
            const key = link
                .map((coord) => `${coord.latitude.toFixed(5)}:${coord.longitude.toFixed(5)}`)
                .join(">");
            if (seen.has(key)) return;
            seen.add(key);

            overlays.push({
                id: `${segment.id}-walk-access-link-${accessIndex}`,
                coords: link,
                color: ROUTE_TRANSFER_GUIDE_COLOR,
                width: Math.max(1.8, getTransitMainWidth(zoom) * 0.42),
                opacity: ROUTE_LINE_STYLE.transfer.opacity,
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(zoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                dashPattern: [...walkGuide.dashPattern],
                strokeStyle: walkGuide.strokeStyle,
                outlineStrokeStyle: walkGuide.outlineStrokeStyle,
                renderMode: "native",
                zIndex: 33.5 + Math.min(segment.sequence, 9) * 0.1,
            });
        });
    });

    return overlays;
}

function buildAnchorDebugPathOverlays(route: NormalizedRoute | undefined): TmapPathOverlay[] {
    if (!route?.segments?.length) return [];
    return route.segments.flatMap((segment) => {
        if (!isTransitRideSegmentMode(segment.mode)) return [];
        const anchors: Array<{ role: "board" | "alight"; anchor?: TransitStopAnchor }> = [
            { role: "board", anchor: segment.boardAnchor },
            { role: "alight", anchor: segment.alightAnchor },
        ];
        return anchors.flatMap(({ role, anchor }) => {
            if (!anchor) return [];
            const raw = anchor.rawCoordinate ?? anchor.stopCoordinate;
            const render = anchor.renderCoordinate ?? anchor.routeAnchorCoordinate;
            if (!raw || !render) return [];
            const distanceMeters = typeof anchor.snapDistanceMeters === "number"
                ? anchor.snapDistanceMeters
                : haversineDistanceKm(raw, render) * 1000;
            if (!Number.isFinite(distanceMeters) || distanceMeters < 0.6) return [];
            const isMismatch = distanceMeters > 60 || anchor.anchorSource === "UNSNAPPED";
            return [{
                id: `anchor-debug-${route.id}-${segment.id}-${role}`,
                coords: [raw, render],
                color: isMismatch ? "#FF3B30" : "#FF9500",
                width: isMismatch ? 2.4 : 1.8,
                opacity: 0.95,
                outlineColor: "rgba(0,0,0,0)",
                outlineWidth: 0,
                dashPattern: [2, 6],
                renderMode: "native",
                zIndex: 280,
            } as TmapPathOverlay];
        });
    });
}

function buildAnchorDebugMarkers(route: NormalizedRoute | undefined): TmapMarker[] {
    if (!route?.segments?.length) return [];
    return route.segments.flatMap((segment) => {
        if (!isTransitRideSegmentMode(segment.mode)) return [];
        const segmentColor = getSegmentColor(segment);
        const anchors: Array<{ role: "board" | "alight"; anchor?: TransitStopAnchor }> = [
            { role: "board", anchor: segment.boardAnchor },
            { role: "alight", anchor: segment.alightAnchor },
        ];
        return anchors.flatMap(({ role, anchor }) => {
            if (!anchor) return [];
            const raw = anchor.rawCoordinate ?? anchor.stopCoordinate;
            const render = anchor.renderCoordinate ?? anchor.routeAnchorCoordinate;
            if (!raw || !render) return [];
            const snapMeters = typeof anchor.snapDistanceMeters === "number"
                ? Math.round(anchor.snapDistanceMeters)
                : undefined;
            return [
                {
                    id: `anchor-debug-${route.id}-${segment.id}-${role}-raw`,
                    latitude: raw.latitude,
                    longitude: raw.longitude,
                    tintColor: "rgba(156, 163, 175, 0.96)",
                    badgeBorderColor: "rgba(255,255,255,0.92)",
                    displayType: "dot",
                    dotSize: 8,
                    caption: `${role} raw`,
                    zIndex: 4090,
                },
                {
                    id: `anchor-debug-${route.id}-${segment.id}-${role}-render`,
                    latitude: render.latitude,
                    longitude: render.longitude,
                    tintColor: segmentColor,
                    badgeBorderColor: snapMeters !== undefined && snapMeters > 60
                        ? "#FF3B30"
                        : "#FFFFFF",
                    displayType: "dot",
                    dotSize: 10,
                    caption: snapMeters !== undefined ? `${role} ${snapMeters}m` : `${role} anchor`,
                    zIndex: 4100,
                },
            ] as TmapMarker[];
        });
    });
}

function normalizeTransitStopName(name?: string): string | undefined {
    if (!name) return undefined;
    const normalized = name.trim();
    if (!normalized) return undefined;
    return normalized.length > 16 ? `${normalized.slice(0, 16)}…` : normalized;
}

function isManualSampleRouteOption(option: RouteAlternativeOption | undefined): boolean {
    return typeof option?.id === "string" && option.id.startsWith("qa-");
}

function buildTransitLegAssistText(legs: TransitLegDetail[] | undefined, legIndex: number): string | undefined {
    if (!Array.isArray(legs) || !legs[legIndex]) return undefined;
    const leg = legs[legIndex];

    if (isRideLegKind(leg.kind)) {
        const board = normalizeTransitStopName(leg.startName);
        const alight = normalizeTransitStopName(leg.endName);
        if (board && alight) return `${board} · ${alight}까지`;
        if (board) return board;
        if (alight) return `${alight}까지`;
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
        if (nextBoardName) return `환승 도보: ${nextBoardName}(${nextKindLabel})까지 이동`;
        return `환승 도보: ${nextKindLabel} 지점까지 이동`;
    }
    if (nextRide) {
        const nextKindLabel = getTransitLegKindMeta(nextRide.kind).label;
        const nextBoardName = normalizeTransitStopName(nextRide.startName);
        if (nextBoardName) return `${nextBoardName}(${nextKindLabel})까지 도보 이동`;
        return `${nextKindLabel} 지점까지 도보 이동`;
    }
    if (prevRide) {
        const prevKindLabel = getTransitLegKindMeta(prevRide.kind).label;
        const prevAlightName = normalizeTransitStopName(prevRide.endName);
        if (prevAlightName) return `${prevAlightName}(${prevKindLabel})에서 목적지까지 도보 이동`;
        return `${prevKindLabel} 이후 목적지까지 도보 이동`;
    }
    return "목적지까지 도보 이동";
}

type TransitEventDraft = {
    coord: RoutePathCoord;
    intent: "BOARD" | "ALIGHT" | "TRANSFER";
    kind: TransitLegDetail["kind"];
    legIndex: number;
    lineLabel?: string;
    lineColor?: string;
    stopName?: string;
    directionLabel?: string;
    badgeSide?: "left" | "right";
    boundaryRole?: "walk-exit" | "transfer-exit" | "ride-entry";
    order: number;
};

type SelectedTransitMapStop = {
    legIndex: number;
    stopIndex: number;
};

function getTransitEventBadgeSide(
    leg: TransitLegDetail,
    intent: "BOARD" | "ALIGHT"
): "left" | "right" {
    const path = leg.pathCoords ?? [];
    if (path.length < 2) return intent === "ALIGHT" ? "left" : "right";

    if (intent === "BOARD") {
        const start = path[0];
        const next = path.find((coord) => routeCoordDistanceMeters(start, coord) >= 24) ?? path[1];
        const longitudeDelta = next.lng - start.lng;
        // 라벨은 다음 노선이 진행하는 쪽의 반대편으로 열어 본선을 가리지 않는다.
        if (Math.abs(longitudeDelta) >= 0.00003) return longitudeDelta > 0 ? "left" : "right";
        return "right";
    }

    const end = path[path.length - 1];
    const previous = [...path]
        .reverse()
        .find((coord) => routeCoordDistanceMeters(end, coord) >= 24) ?? path[path.length - 2];
    const longitudeDelta = end.lng - previous.lng;
    if (Math.abs(longitudeDelta) >= 0.00003) return longitudeDelta > 0 ? "right" : "left";
    return "left";
}

function buildTransitEventMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number,
    _isDark: boolean,
    normalizedRoute?: NormalizedRoute
): TmapMarker[] {
    if (!Array.isArray(legs) || !legs.length) return [];

    const drafts: TransitEventDraft[] = [];
    const rideLegIndexes = legs
        .map((leg, index) => (isRideLegKind(leg.kind) ? index : -1))
        .filter((index) => index >= 0);
    const firstRideLegIndex = rideLegIndexes[0];
    const lastRideLegIndex = rideLegIndexes[rideLegIndexes.length - 1];
    let rideLegSeen = false;

    legs.forEach((leg, index) => {
        const boardMarkerCoord = getRideStopRouteMarkerCoord(normalizedRoute, index, "BOARD")
            ?? getRideStopVisualCoord(legs, index, "BOARD")
            ?? getTransitLegBoardCoord(leg)
            ?? getTransitLegStartCoord(leg)
            ?? getTransitLegBoardAnchorOnPath(leg);
        const alightMarkerCoord = getRideStopRouteMarkerCoord(normalizedRoute, index, "ALIGHT")
            ?? getRideStopVisualCoord(legs, index, "ALIGHT")
            ?? getTransitLegAlightCoord(leg)
            ?? getTransitLegEndCoord(leg)
            ?? getTransitLegAlightAnchorOnPath(leg);
        const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
        const baseOrder = index * 10;

        if (isRideLegKind(leg.kind)) {
            const hasWalkBeforeRide = legs.slice(0, index).some((candidate) => candidate.kind === "WALK");
            const hasWalkAfterRide = legs.slice(index + 1).some((candidate) => candidate.kind === "WALK");
            const hasLaterRide = rideLegIndexes.some((rideIndex) => rideIndex > index);
            // 출발·도착 핀과 같은 좌표의 승하차 원은 이중 마커가 되므로 터미널 핀을 우선한다.
            const boardOverlapsOrigin = index === firstRideLegIndex && !hasWalkBeforeRide;
            const alightOverlapsDestination = index === lastRideLegIndex && !hasWalkAfterRide;

            if (boardMarkerCoord && !boardOverlapsOrigin) {
                drafts.push({
                    coord: boardMarkerCoord,
                    intent: "BOARD",
                    kind: leg.kind,
                    legIndex: index,
                    lineLabel,
                    lineColor: leg.lineColor,
                    stopName: normalizeTransitStopName(leg.startName),
                    directionLabel: getTransitBoardingDirectionHint(leg),
                    badgeSide: getTransitEventBadgeSide(leg, "BOARD"),
                    boundaryRole: legs[index - 1]?.kind === "WALK" ? "ride-entry" : undefined,
                    order: baseOrder + 1,
                });
            }
            if (alightMarkerCoord && !alightOverlapsDestination) {
                drafts.push({
                    coord: alightMarkerCoord,
                    intent: "ALIGHT",
                    kind: leg.kind,
                    legIndex: index,
                    lineLabel,
                    lineColor: leg.lineColor,
                    stopName: normalizeTransitStopName(leg.endName),
                    badgeSide: getTransitEventBadgeSide(leg, "ALIGHT"),
                    boundaryRole: legs[index + 1]?.kind === "WALK"
                        ? (hasLaterRide ? "transfer-exit" : "walk-exit")
                        : undefined,
                    order: baseOrder + 7,
                });
            }
            if (rideLegSeen && boardMarkerCoord) {
                drafts.push({
                    coord: boardMarkerCoord,
                    intent: "TRANSFER",
                    kind: leg.kind,
                    legIndex: index,
                    lineLabel,
                    lineColor: leg.lineColor,
                    stopName: normalizeTransitStopName(leg.startName),
                    directionLabel: getTransitBoardingDirectionHint(leg),
                    badgeSide: getTransitEventBadgeSide(leg, "BOARD"),
                    boundaryRole: "ride-entry",
                    order: baseOrder,
                });
            }
            rideLegSeen = true;
            return;
        }
    });

    if (!drafts.length) return [];

    // 광역에서는 환승을 한 노드로 축약하고, 상세 줌에서는 점선 양 끝의 실제 경계를 보존한다.
    const hierarchyDrafts = shouldPreserveTransitBoundaryEvents(mapZoom)
        ? drafts
        : collapseRedundantTransferAlights(drafts);

    // 나머지 같은 지점 이벤트는 문자열 좌표가 아닌 공간 거리로 묶는다.
    const grouped: TransitEventDraft[][] = [];
    hierarchyDrafts.forEach((draft) => {
        const nearbyGroup = grouped.find((group) => (
            Math.abs(group[0].order - draft.order) <= 16 &&
            routeCoordDistanceMeters(group[0].coord, draft.coord) <= 18
        ));
        if (nearbyGroup) nearbyGroup.push(draft);
        else grouped.push([draft]);
    });

    const sortedGroups = grouped
        .map((group) => group.sort((a, b) => a.order - b.order))
        .sort((a, b) => a[0].order - b[0].order)
        .slice(0, TRANSIT_BADGE_MAX_COUNT);

    return sortedGroups.flatMap((group, index): TmapMarker[] => {
        const base = group[0];
        const intents = new Set(group.map((item) => item.intent));

        let tintColor = TRANSIT_LEG_COLOR.WALK;
        let caption = "도보 구간";
        let markerStyle: TmapMarker["markerStyle"] = "default";
        let actionLabel: "승차" | "환승" | "하차" = "승차";
        let detailLineLabel = base.lineLabel;
        let detailStopName = base.stopName;
        let detailDirectionLabel = base.directionLabel;
        let interactionLegIndex = base.legIndex;
        let markerCoord = base.coord;
        let detailBadgeSide = base.badgeSide ?? "right";
        let isTransferExitBoundary = false;

        if (intents.has("TRANSFER")) {
            const transfer = group.find((item) => item.intent === "TRANSFER") ?? base;
            const transferLine = transfer.lineLabel;
            tintColor = getTransitKindLineColor(
                transfer.kind,
                transfer.lineLabel,
                transfer.lineColor
            );
            // 환승 자체를 상징하는 문양 대신 다음에 실제로 탈 버스/지하철 아이콘을 보여준다.
            markerStyle = getTransitModeMarkerStyle(transfer.kind);
            caption = transferLine ? `${transferLine} 환승` : "환승 지점";
            actionLabel = "환승";
            detailLineLabel = transferLine;
            detailStopName = transfer.stopName;
            detailDirectionLabel = transfer.directionLabel;
            interactionLegIndex = transfer.legIndex;
            markerCoord = transfer.coord;
            detailBadgeSide = transfer.badgeSide ?? "right";
        } else if (intents.has("BOARD")) {
            const board = group.find((item) => item.intent === "BOARD") ?? base;
            const kindMeta = getTransitLegKindMeta(board.kind);
            const normalizedLine = board.lineLabel
                ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, "")
                .trim();
            tintColor = getTransitKindLineColor(
                board.kind,
                normalizedLine ?? board.lineLabel,
                board.lineColor
            );
            markerStyle = getTransitModeMarkerStyle(board.kind);
            caption = board.stopName ?? `${kindMeta.label} 지점`;
            actionLabel = "승차";
            detailLineLabel = normalizedLine ?? board.lineLabel;
            detailStopName = board.stopName;
            detailDirectionLabel = board.directionLabel;
            interactionLegIndex = board.legIndex;
            markerCoord = board.coord;
            detailBadgeSide = board.badgeSide ?? "right";
        } else if (intents.has("ALIGHT")) {
            const alight = group.find((item) => item.intent === "ALIGHT") ?? base;
            const kindMeta = getTransitLegKindMeta(alight.kind);
            const normalizedLine = alight.lineLabel
                ?.replace(/^(승차|하차|환승|승|하|환)\s*/i, "")
                .trim();
            tintColor = getTransitKindLineColor(
                alight.kind,
                normalizedLine ?? alight.lineLabel,
                alight.lineColor
            );
            markerStyle = getTransitModeMarkerStyle(alight.kind);
            // 목적지까지 이어지는 최종 보행만 보행 아이콘으로 전환한다.
            // 환승 보행 앞의 하차 노드는 이전 노선의 수단 아이콘을 유지해야 두 경계가 읽힌다.
            if (alight.boundaryRole === "walk-exit") markerStyle = "walk";
            isTransferExitBoundary = alight.boundaryRole === "transfer-exit";
            caption = alight.stopName ?? `${kindMeta.label} 지점`;
            actionLabel = "하차";
            detailLineLabel = normalizedLine ?? alight.lineLabel;
            detailStopName = alight.stopName;
            detailDirectionLabel = undefined;
            interactionLegIndex = alight.legIndex;
            markerCoord = alight.coord;
            detailBadgeSide = alight.badgeSide ?? "left";
        }

        const eventIntent = actionLabel === "환승"
            ? "transfer"
            : actionLabel === "하차"
                ? "alight"
                : "board";
        const presentation = getTransitEventMarkerPresentation(
            eventIntent,
            mapZoom,
            isTransferExitBoundary
        );
        if (!presentation.visible) return [];
        const compactLineLabel = compactTransitLineLabel(detailLineLabel);
        const showContextLabel = mapZoom >= 16.8;
        const contextPrimary = [
            compactLineLabel,
            compactTransitStopLabel(detailStopName, 14),
        ].filter((value): value is string => !!value).join(" · ");
        const contextSecondary = actionLabel === "하차"
            ? "하차 지점"
            : detailDirectionLabel;
        const markerIdBase = `transit-event-${selectedAlternativeId ?? "selected"}-${interactionLegIndex}-${eventIntent}`;
        const interactionId = buildTransitLegInteractionId(interactionLegIndex);
        const markers: TmapMarker[] = [{
            id: `${markerIdBase}-node`,
            interactionId,
            latitude: markerCoord.lat,
            longitude: markerCoord.lng,
            tintColor,
            markerStyle,
            caption,
            displayType: "station",
            stationVariant: presentation.stationVariant,
            eventIntent,
            dotSize: presentation.nodeSize,
            zIndex: 3700 + (index * 2),
        }];
        if (presentation.showRouteLabel) {
            markers.push({
                id: `${markerIdBase}-label`,
                interactionId,
                latitude: markerCoord.lat,
                longitude: markerCoord.lng,
                tintColor,
                markerStyle,
                caption,
                displayType: "routeLabel",
                badgeLabel: showContextLabel && contextPrimary
                    ? contextPrimary
                    : compactLineLabel ?? actionLabel,
                badgeSubLabel: showContextLabel ? contextSecondary : undefined,
                badgeVariant: showContextLabel ? "context" : "route",
                badgeSide: detailBadgeSide,
                eventIntent,
                zIndex: 3701 + (index * 2),
            });
        }
        return markers;
    });
}

function buildTransitPassStopMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number,
    selectedStop: SelectedTransitMapStop | undefined
): TmapMarker[] {
    if (!Array.isArray(legs)) return [];

    type StopMarkerCandidate = TmapMarker & { selected: boolean };
    type StopMarkerGroup = {
        kind: TransitStopMarkerKind;
        markers: StopMarkerCandidate[];
    };

    const groups: StopMarkerGroup[] = [];
    const seenCoordinates = new Set<string>();
    legs.forEach((leg, legIndex) => {
        if (!isRideLegKind(leg.kind) || !Array.isArray(leg.passStops) || leg.passStops.length < 3) return;
        const kind: TransitStopMarkerKind = leg.kind;
        const policy = getTransitStopMarkerPolicy(kind, mapZoom);
        const selectedBelongsToLeg = selectedStop?.legIndex === legIndex;
        if (!policy.visible && !selectedBelongsToLeg) return;

        const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
        const lineColor = getTransitKindLineColor(leg.kind, lineLabel, leg.lineColor);
        const markerStyle: TmapMarker["markerStyle"] = leg.kind === "BUS" ? "bus" : "subway";
        const displayPath = Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
            ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
            : [];
        const routeCoordinates = routePathCoordsToCoordinates(displayPath);
        const markers: StopMarkerCandidate[] = [];

        leg.passStops.forEach((stop, stopIndex) => {
            // 승차·하차점은 더 강한 event marker가 이미 담당하므로 중간 정류장만 추가한다.
            if (stopIndex === 0 || stopIndex === leg.passStops!.length - 1 || !stop.coord) return;
            const selected = selectedStop?.legIndex === legIndex && selectedStop.stopIndex === stopIndex;
            // 축소 후에도 사용자가 직접 고른 정류장은 맥락을 잃지 않도록 한 개만 유지한다.
            if (!policy.visible && !selected) return;

            const key = `${stop.coord.lat.toFixed(5)}:${stop.coord.lng.toFixed(5)}`;
            if (seenCoordinates.has(key)) return;
            seenCoordinates.add(key);

            const stopName = normalizeTransitStopName(stop.name) ?? stop.name;
            const stopAnchor = createTransitStopAnchor(
                toCoordinate(stop.coord),
                routeCoordinates,
                "start",
                {
                    id: `transit-pass-stop-anchor-${selectedAlternativeId ?? "selected"}-${legIndex}-${stopIndex}`,
                    name: stopName,
                    type: "BUS_STOP",
                }
            );
            // 통과 정류장은 노선 구조를 읽는 노드다. 공급자 오차 범위 안에서는 본선 좌표를 공유하고,
            // 80m를 넘는 실제 불일치만 POI 좌표에 남겨 잘못된 경로로 꾸미지 않는다.
            const markerCoord = toRoutePathCoord(resolveTransitRouteNodeCoordinate(stopAnchor)) ?? stop.coord;
            markers.push({
                id: `transit-pass-stop-${selectedAlternativeId ?? "selected"}-${legIndex}-${stopIndex}`,
                interactionId: buildTransitStopInteractionId(legIndex, stopIndex),
                latitude: markerCoord.lat,
                longitude: markerCoord.lng,
                tintColor: lineColor,
                markerStyle,
                caption: stopName,
                displayType: selected ? "badge" : "station",
                badgeLabel: selected
                    ? [lineLabel, compactTransitStopLabel(stopName, 12)].filter(Boolean).join(" · ")
                    : undefined,
                badgeTextColor: KAKAO_LABEL_TEXT_COLOR,
                badgeBorderColor: KAKAO_LABEL_BORDER_COLOR,
                badgeConnectorColor: lineColor,
                badgeSide: stopIndex % 2 === 0 ? "left" : "right",
                stationVariant: selected ? undefined : "compact",
                // 선택 정류장은 핵심 승하차 노드와 같은 계층으로, 일반 정류장은 정책 크기로 고정한다.
                dotSize: selected ? 24 : policy.markerSize,
                zIndex: selected ? 3590 : 3520 + stopIndex,
                selected,
            });
        });

        if (markers.length > 0) groups.push({ kind, markers });
    });

    const result: TmapMarker[] = [];
    (["BUS", "SUBWAY"] as const).forEach((kind) => {
        const kindGroups = groups.filter((group) => group.kind === kind);
        if (kindGroups.length === 0) return;

        const policy = getTransitStopMarkerPolicy(kind, mapZoom);
        const maxPerLeg = policy.visible ? policy.maxPerLeg : 1;
        const maxTotal = policy.visible ? policy.maxTotal : 1;
        const candidateCounts = kindGroups.map((group) => Math.min(group.markers.length, maxPerLeg));
        const allocations = allocateTransitStopMarkerCounts(candidateCounts, maxTotal);
        const selectedMarkersByGroup: StopMarkerCandidate[][] = [];

        kindGroups.forEach((group, groupIndex) => {
            const selectedIndex = group.markers.findIndex((marker) => marker.selected);
            const sampledIndices = sampleTransitStopIndices(
                group.markers.length,
                allocations[groupIndex] ?? 0,
                selectedIndex >= 0 ? selectedIndex : undefined
            );
            const selectedMarkers = sampledIndices.map((index) => group.markers[index]);
            selectedMarkersByGroup.push(selectedMarkers);
            result.push(...selectedMarkers);
        });

        if (!policy.showLabels) return;
        const labelCandidatesByGroup = selectedMarkersByGroup.map((markers) => (
            markers.filter((marker) => !marker.selected)
        ));
        const labelCandidateCounts = labelCandidatesByGroup.map((markers) => (
            Math.min(markers.length, policy.maxLabelsPerLeg)
        ));
        const labelAllocations = allocateTransitStopMarkerCounts(
            labelCandidateCounts,
            policy.maxLabelsTotal
        );
        labelCandidatesByGroup.forEach((candidates, groupIndex) => {
            const labelIndices = sampleTransitStopIndices(
                candidates.length,
                labelAllocations[groupIndex] ?? 0
            );
            labelIndices.forEach((candidateIndex) => {
                const marker = candidates[candidateIndex];
                const stopLabel = compactTransitStopLabel(marker.caption, mapZoom >= 17.5 ? 18 : 14);
                if (!stopLabel) return;
                result.push({
                    ...marker,
                    id: `${marker.id}-label`,
                    displayType: "routeLabel",
                    badgeVariant: "stop",
                    badgeLabel: stopLabel,
                    badgeSubLabel: undefined,
                    dotSize: undefined,
                    stationVariant: undefined,
                    zIndex: (marker.zIndex ?? 3520) + 1,
                });
            });
        });
    });

    return result;
}

function buildTransitRouteIdentityMarkers(
    selectedAlternativeId: string | undefined,
    legs: TransitLegDetail[] | undefined,
    mapZoom: number
): TmapMarker[] {
    if (!Array.isArray(legs) || !shouldShowTransitRouteIdentityLabel(mapZoom)) return [];

    return legs.flatMap((leg, legIndex): TmapMarker[] => {
        if (!isRideLegKind(leg.kind)) return [];
        const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
        if (!lineLabel) return [];
        const displayPath = Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2
            ? normalizeDisplayPathCoords(leg.pathCoords, leg.kind)
            : [];
        const markerCoord = selectTransitRouteLabelCoordinate(displayPath);
        if (!markerCoord) return [];

        return [{
            id: `transit-route-identity-${selectedAlternativeId ?? "selected"}-${legIndex}`,
            interactionId: buildTransitLegInteractionId(legIndex),
            latitude: markerCoord.lat,
            longitude: markerCoord.lng,
            tintColor: getTransitKindLineColor(leg.kind, lineLabel, leg.lineColor),
            markerStyle: getTransitModeMarkerStyle(leg.kind),
            caption: lineLabel,
            displayType: "routeLabel",
            badgeVariant: "route",
            badgeLabel: lineLabel,
            badgeSide: legIndex % 2 === 0 ? "right" : "left",
            zIndex: 3600 + legIndex,
        }];
    });
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

function getTransitDayDiff(date: Date, referenceDate: Date): number {
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const referenceStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime();
    return Math.round((dateStart - referenceStart) / (24 * 60 * 60 * 1000));
}

function formatTransitClockWithDayContext(date: Date, referenceDate: Date): string {
    const dayDiff = getTransitDayDiff(date, referenceDate);
    if (dayDiff === 0) return formatTransitClock(date);
    if (dayDiff === 1) return `다음날 ${formatTransitClock(date)}`;
    if (dayDiff === -1) return `전날 ${formatTransitClock(date)}`;
    return `${date.getMonth() + 1}/${date.getDate()} ${formatTransitClock(date)}`;
}

type TransitRouteTimeMeta = {
    departureText: string;
    arrivalText?: string;
    timeRangeText?: string;
    fareText?: string;
    combinedText: string;
};

function buildTransitRouteTimeMeta(option: RouteAlternativeOption, departureAt: Date): TransitRouteTimeMeta {
    const fareText = typeof option.fareWon === "number" ? `${option.fareWon.toLocaleString()}원` : undefined;
    if (option.transitServiceState === "not_operating") {
        return {
            departureText: "운행 종료",
            fareText,
            combinedText: ["현재 운행 종료", fareText].filter(Boolean).join(" | "),
        };
    }

    const departureText = formatTransitClock(departureAt);
    let arrivalText: string | undefined;
    if (typeof option.minutes === "number") {
        const arrivalAt = new Date(departureAt.getTime() + Math.max(0, option.minutes) * 60 * 1000);
        arrivalText = formatTransitClockWithDayContext(arrivalAt, departureAt);
    }
    const timeRangeText = arrivalText ? `${departureText} 출발 - ${arrivalText} 예상 도착` : undefined;
    return {
        departureText,
        arrivalText,
        timeRangeText,
        fareText,
        combinedText: [timeRangeText, fareText].filter(Boolean).join(" | "),
    };
}

function routeSegmentModeToProgressKind(mode: RouteMode): TransitLegDetail["kind"] {
    if (mode === "BUS") return "BUS";
    if (mode === "SUBWAY") return "SUBWAY";
    if (mode === "WALK") return "WALK";
    return "ETC";
}

function buildTransitProgressSegmentsFromRoute(route?: NormalizedRoute): TransitRouteProgressSegment[] {
    if (!route?.segments?.length) return [];
    return route.segments
        .map((segment) => {
            const minutes = typeof segment.duration === "number" && Number.isFinite(segment.duration)
                ? Math.max(1, Math.round(segment.duration))
                : 1;
            const kind = routeSegmentModeToProgressKind(segment.mode);
            // 진행 막대의 이동 수단 판정은 screen-space 화살표 fallback과 무관하다.
            const isRide = isTransitRideSegmentMode(segment.mode);
            return {
                key: segment.id,
                label: formatDuration(minutes),
                lineLabel: isRide
                    ? compactTransitLineLabel(segment.lineName)
                    : undefined,
                kind,
                minutes,
                color: isRide ? getSegmentColor(segment) : TRANSIT_PROGRESS_NEUTRAL_COLOR,
                flex: Math.max(0.8, minutes),
                isRide,
            };
        })
        .filter((segment) => segment.minutes > 0);
}

function routeStepTypeFromSegmentMode(mode: RouteMode): RouteStep["type"] {
    if (mode === "BUS") return "BUS";
    if (mode === "SUBWAY") return "SUBWAY";
    if (mode === "TRANSFER") return "TRANSFER";
    return "WALK";
}

function routeSegmentCoordinatesForStep(segment: RouteSegment): RouteStep["coordinates"] {
    const coords = Array.isArray(segment.renderedCoordinates) && segment.renderedCoordinates.length >= 2
        ? segment.renderedCoordinates
        : segment.coordinates;
    return coords.map((coord) => ({ latitude: coord.latitude, longitude: coord.longitude }));
}

function buildSegmentStepDescription(segment: RouteSegment, fallback?: string): string | undefined {
    if (segment.mode === "TRANSFER") {
        const durationText = typeof segment.duration === "number" ? formatDuration(segment.duration) : undefined;
        return ["환승", durationText].filter(Boolean).join(" · ") || undefined;
    }
    if (fallback?.trim()) return fallback;
    const distanceText = formatDistance(segment.distance);
    const durationText = typeof segment.duration === "number" ? formatDuration(segment.duration) : undefined;
    const destinationText = segment.toName?.trim() ? `${segment.toName.trim()}까지` : undefined;
    return [destinationText, distanceText, durationText].filter(Boolean).join(" · ") || undefined;
}

function buildSegmentStepTitle(segment: RouteSegment, fallback?: string): string {
    if (segment.mode === "TRANSFER") return "환승";
    if (fallback?.trim()) return fallback;
    if (segment.mode === "BUS" || segment.mode === "SUBWAY") {
        return segment.fromName?.trim() || segment.lineName?.trim() || (segment.mode === "BUS" ? "버스 승차" : "지하철 승차");
    }
    return "도보";
}

function buildRouteInfoFromNormalizedRoute(
    baseRouteInfo: RouteInfo,
    route: NormalizedRoute | undefined
): RouteInfo {
    if (!route?.segments?.length) return baseRouteInfo;
    const originStep = baseRouteInfo.steps.find((step) => step.type === "ORIGIN") ?? baseRouteInfo.steps[0];
    const destinationStep = [...baseRouteInfo.steps].reverse().find((step) => step.type === "DESTINATION")
        ?? baseRouteInfo.steps[baseRouteInfo.steps.length - 1];
    const baseTravelSteps = baseRouteInfo.steps.filter((step) => step.type !== "ORIGIN" && step.type !== "DESTINATION");
    const segmentSteps: RouteStep[] = route.segments.map((segment, index) => {
        const baseStep = baseTravelSteps[index];
        const type = routeStepTypeFromSegmentMode(segment.mode);
        const lineColor = segment.mode === "BUS" || segment.mode === "SUBWAY"
            ? getSegmentColor(segment)
            : undefined;
        return {
            ...baseStep,
            id: baseStep?.id ?? `leg-${index}`,
            type,
            title: buildSegmentStepTitle(segment, baseStep?.title),
            description: buildSegmentStepDescription(segment, baseStep?.description),
            durationMinutes: typeof segment.duration === "number" ? Math.max(1, Math.round(segment.duration)) : baseStep?.durationMinutes,
            distanceMeters: segment.distance ?? baseStep?.distanceMeters,
            lineName: segment.lineName ?? baseStep?.lineName,
            lineColor: lineColor ?? baseStep?.lineColor,
            badgeText: segment.lineName ?? baseStep?.badgeText,
            coordinates: routeSegmentCoordinatesForStep(segment),
        };
    });

    return {
        ...baseRouteInfo,
        id: route.id || baseRouteInfo.id,
        totalDurationMinutes: typeof route.totalDuration === "number"
            ? Math.max(0, Math.round(route.totalDuration))
            : baseRouteInfo.totalDurationMinutes,
        fare: route.fare ?? baseRouteInfo.fare,
        totalDistanceMeters: route.totalDistance ?? baseRouteInfo.totalDistanceMeters,
        steps: [
            originStep,
            ...segmentSteps,
            destinationStep,
        ].filter((step): step is RouteStep => !!step),
    };
}

function getPrimaryTransitLineLabel(legs?: TransitLegDetail[]): string {
    const firstRide = Array.isArray(legs) ? legs.find((leg) => isRideLegKind(leg.kind)) : undefined;
    return compactTransitLineLabel(firstRide?.lineName) ?? compactTransitLineLabel(firstRide?.label) ?? "대중교통";
}

function buildRouteInfoPathOverlays(routeInfo: RouteInfo | undefined, mapZoom: number): TmapPathOverlay[] {
    if (!routeInfo) return [];
    const walkGuide = getTransitWalkGuidePresentation(mapZoom);
    const movementSteps = routeInfo.steps.filter((step) => step.type !== "ORIGIN" && step.type !== "DESTINATION");
    const isWalkingOnlyRoute = movementSteps.length > 0 && movementSteps.every((step) => step.type === "WALK");
    const isBicycleOnlyRoute = movementSteps.length > 0 && movementSteps.every((step) => step.type === "BIKE");
    if (isWalkingOnlyRoute || isBicycleOnlyRoute) {
        const routeCoords = movementSteps.flatMap((step) => step.coordinates ?? []);
        const dedupedCoords = routeCoords.filter((coord, index) => {
            const previous = routeCoords[index - 1];
            return !previous || previous.latitude !== coord.latitude || previous.longitude !== coord.longitude;
        });
        if (dedupedCoords.length >= 2) {
            const originCoord = routeInfo.steps.find((step) => step.type === "ORIGIN")?.coordinates?.[0];
            const destinationCoord = routeInfo.steps.find((step) => step.type === "DESTINATION")?.coordinates?.[0];
            let endpointAlignedPath = dedupedCoords.map((coord) => ({
                lat: coord.latitude,
                lng: coord.longitude,
            }));
            endpointAlignedPath = joinWalkPathEndpoint(
                endpointAlignedPath,
                originCoord ? { lat: originCoord.latitude, lng: originCoord.longitude } : undefined,
                "start"
            ).pathCoords;
            endpointAlignedPath = joinWalkPathEndpoint(
                endpointAlignedPath,
                destinationCoord ? { lat: destinationCoord.latitude, lng: destinationCoord.longitude } : undefined,
                "end"
            ).pathCoords;
            return [{
                id: `${routeInfo.id}-${isBicycleOnlyRoute ? "bike" : "walk"}-route`,
                coords: endpointAlignedPath.map((coord) => ({
                    latitude: coord.lat,
                    longitude: coord.lng,
                })),
                color: isBicycleOnlyRoute ? ROUTE_LINE_STYLE.bike.color : ROUTE_WALK_GUIDE_COLOR,
                width: isBicycleOnlyRoute ? getBikeWidth(mapZoom) : getWalkWidth(mapZoom),
                opacity: isBicycleOnlyRoute ? ROUTE_LINE_STYLE.bike.opacity : ROUTE_LINE_STYLE.walk.opacity,
                outlineColor: isBicycleOnlyRoute
                    ? ROUTE_LINE_STYLE.bike.casingColor
                    : ROUTE_WALK_CASING_COLOR,
                outlineWidth: isBicycleOnlyRoute
                    ? getBikeOutlineWidth(mapZoom)
                    : getWalkOutlineWidth(mapZoom),
                outlineOpacity: isBicycleOnlyRoute
                    ? ROUTE_LINE_STYLE.bike.casingOpacity
                    : ROUTE_WALK_CASING_OPACITY,
                dashPattern: isBicycleOnlyRoute ? undefined : [...walkGuide.dashPattern],
                strokeStyle: isBicycleOnlyRoute ? "solid" : walkGuide.strokeStyle,
                outlineStrokeStyle: isBicycleOnlyRoute ? "solid" : walkGuide.outlineStrokeStyle,
                renderMode: "native",
                nativeDirection: isBicycleOnlyRoute && ROUTE_LINE_STYLE.bike.arrows,
                nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                zIndex: isBicycleOnlyRoute ? ROUTE_LINE_STYLE.bike.zIndex : ROUTE_LINE_STYLE.walk.zIndex,
            }];
        }
    }
    return routeInfo.steps.flatMap((step, index) => {
        if (step.type === "ORIGIN" || step.type === "DESTINATION") return [];
        if (!Array.isArray(step.coordinates) || step.coordinates.length < 2) return [];
        const isWalk = step.type === "WALK" || step.type === "TRANSFER";
        const isTransitRide = step.type === "BUS" || step.type === "SUBWAY";
        const isDrive = step.type === "DRIVE";
        const isBike = step.type === "BIKE";
        // Transit fallback에는 viewport-aware carrier 계획이 없으므로 SDK 기본 과밀 화살표를 켜지 않는다.
        // 정상 대중교통 경로는 NormalizedRoute 분기에서 native direction window를 사용한다.
        const rendersNativeDirection = (isDrive || isBike) && ENABLE_NATIVE_ROUTE_DIRECTION;
        const color = isWalk
            ? (step.type === "TRANSFER" ? ROUTE_TRANSFER_GUIDE_COLOR : ROUTE_WALK_GUIDE_COLOR)
            : isDrive
                ? ROUTE_LINE_STYLE.drive.color
                : isBike
                    ? ROUTE_LINE_STYLE.bike.color
                    : getRouteStepColor(step);
        const width = isWalk
            ? getWalkWidth(mapZoom)
            : isDrive
                ? getDriveWidth(mapZoom)
                : isBike
                    ? getBikeWidth(mapZoom)
                    : getTransitMainWidth(mapZoom);
        const outlineColor = isWalk
            ? ROUTE_WALK_CASING_COLOR
            : isDrive
                ? ROUTE_LINE_STYLE.drive.casingColor
                : isBike
                    ? ROUTE_LINE_STYLE.bike.casingColor
                    : ROUTE_LINE_STYLE.transit.casingColor;
        const outlineWidth = isWalk
            ? getWalkOutlineWidth(mapZoom)
            : isDrive
                ? getDriveOutlineWidth(mapZoom)
                : isBike
                    ? getBikeOutlineWidth(mapZoom)
                    : getTransitCasingExtraWidth(mapZoom) / 2;
        return [{
            id: `${routeInfo.id}-${step.id}`,
            coords: step.coordinates,
            color,
            width,
            opacity: isWalk
                ? ROUTE_LINE_STYLE.walk.opacity
                : isBike
                    ? ROUTE_LINE_STYLE.bike.opacity
                    : 1,
            outlineColor,
            outlineWidth,
            outlineOpacity: isWalk
                ? ROUTE_WALK_CASING_OPACITY
                : isDrive
                    ? ROUTE_LINE_STYLE.drive.casingOpacity
                    : isBike
                        ? ROUTE_LINE_STYLE.bike.casingOpacity
                        : ROUTE_LINE_STYLE.transit.casingOpacity,
            dashPattern: isWalk ? [...walkGuide.dashPattern] : undefined,
            strokeStyle: isWalk ? walkGuide.strokeStyle : "solid",
            outlineStrokeStyle: isWalk ? walkGuide.outlineStrokeStyle : "solid",
            renderMode: "native",
            nativeDirection: rendersNativeDirection,
            nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
            nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
            zIndex: (isTransitRide
                ? ROUTE_LINE_STYLE.transit.busZIndex
                : isDrive
                    ? ROUTE_LINE_STYLE.drive.zIndex
                    : isBike
                        ? ROUTE_LINE_STYLE.bike.zIndex
                        : ROUTE_LINE_STYLE.walk.zIndex) + index,
        } as TmapPathOverlay];
    });
}

function buildRouteEndpointAccessOverlays(
    accessPaths: RouteEndpointAccessPath[],
    mapZoom: number,
    _isDark: boolean
): TmapPathOverlay[] {
    if (!accessPaths.length) return [];
    const walkGuide = getTransitWalkGuidePresentation(mapZoom);

    return accessPaths.flatMap((accessPath, accessIndex) => {
        const displayCoords = toDisplayOverlayCoords(accessPath.pathCoords, "WALK");
        if (displayCoords.length < 2) return [];
        const zIndex = 32 + accessIndex;
        const overlays: TmapPathOverlay[] = [
            {
                id: `${accessPath.id}-support`,
                coords: displayCoords,
                color: ROUTE_WALK_GUIDE_COLOR,
                width: getWalkWidth(mapZoom),
                opacity: ROUTE_LINE_STYLE.walk.opacity,
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(mapZoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                dashPattern: [...walkGuide.dashPattern],
                strokeStyle: walkGuide.strokeStyle,
                outlineStrokeStyle: walkGuide.outlineStrokeStyle,
                renderMode: "native",
                zIndex,
            },
        ];

        accessPath.schematicPaths.forEach((schematicPath, schematicIndex) => {
            const schematicCoords = toDisplayOverlayCoords(schematicPath);
            if (schematicCoords.length < 2) return;
            overlays.push({
                id: `${accessPath.id}-network-link-${schematicIndex}`,
                coords: schematicCoords,
                color: ROUTE_TRANSFER_GUIDE_COLOR,
                width: Math.max(2.2, getWalkWidth(mapZoom) - 0.4),
                opacity: ROUTE_LINE_STYLE.transfer.opacity,
                outlineColor: ROUTE_WALK_CASING_COLOR,
                outlineWidth: getWalkOutlineWidth(mapZoom),
                outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                dashPattern: [...walkGuide.dashPattern],
                strokeStyle: walkGuide.strokeStyle,
                outlineStrokeStyle: walkGuide.outlineStrokeStyle,
                renderMode: "native",
                zIndex: zIndex - 1,
            });
        });

        return overlays;
    });
}

export default function RoutePlannerScreen() {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const isDark = mode === "dark";
    const overlayBoxBg = isDark ? "rgba(8, 12, 20, 0.58)" : "rgba(255, 255, 255, 0.72)";
    const overlayPanelBg = isDark ? "rgba(7, 11, 18, 0.70)" : "rgba(248, 250, 255, 0.78)";
    const overlayCardBg = isDark ? "rgba(18, 24, 34, 0.68)" : "rgba(255, 255, 255, 0.82)";
    const params = useLocalSearchParams<{
        sessionId?: string;
        routeId?: string;
        routeIndex?: string;
        travelMode?: string;
        editTarget?: string;
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
        departureAt?: string;
        entrySource?: string;
    }>();
    const isRouteSelectionScreen = pathname === "/schedule/route-select";
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const sessionInitial = sessionId ? getRoutePlannerInitial(sessionId) : undefined;
    const {
        originAddress: paramOriginAddress,
        originLat: paramOriginLat,
        originLng: paramOriginLng,
        originName: paramOriginName,
        destinationAddress: paramDestinationAddress,
        destinationLat: paramDestinationLat,
        destinationLng: paramDestinationLng,
        destinationName: paramDestinationName,
    } = params;
    // Expo Router는 같은 화면에서 query만 바뀔 때 params 객체를 재사용할 수 있다.
    // 객체 identity 대신 실제 장소 필드를 추적해야 다음 길찾기가 이전 좌표를 재사용하지 않는다.
    const paramOrigin = useMemo(() => parseRouteParamPlace({
        originAddress: paramOriginAddress,
        originLat: paramOriginLat,
        originLng: paramOriginLng,
        originName: paramOriginName,
    }, "origin"), [
        paramOriginAddress,
        paramOriginLat,
        paramOriginLng,
        paramOriginName,
    ]);
    const paramDestination = useMemo(() => parseRouteParamPlace({
        destinationAddress: paramDestinationAddress,
        destinationLat: paramDestinationLat,
        destinationLng: paramDestinationLng,
        destinationName: paramDestinationName,
    }, "destination"), [
        paramDestinationAddress,
        paramDestinationLat,
        paramDestinationLng,
        paramDestinationName,
    ]);
    const paramTravelMode = useMemo(() => parseTravelModeParam(params.travelMode), [params.travelMode]);
    const paramDepartureAt = useMemo(() => parseDepartureAtParam(params.departureAt), [params.departureAt]);
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
    const initialRouteDepartureAt = useMemo(() => {
        const persistedDepartureAt = initial?.departureAt ? new Date(initial.departureAt) : undefined;
        if (persistedDepartureAt && Number.isFinite(persistedDepartureAt.getTime())) {
            return persistedDepartureAt;
        }
        return resolveScheduleRouteDepartureContext(
            initial?.targetArrivalAt,
            initial?.travelMinutes
        ).departureAt;
    }, [initial?.departureAt, initial?.targetArrivalAt, initial?.travelMinutes]);
    const forcedEditTarget = useMemo(() => parseRoutePointTargetParam(params.editTarget), [params.editTarget]);
    // Forced camera focus is a visual-QA aid. Do not let production deep links
    // override the route camera or its zoom level.
    const forcedFocusTarget = useMemo(
        () => typeof __DEV__ === "boolean" && __DEV__
            ? parseFocusTargetParam(params.focusTarget)
            : undefined,
        [params.focusTarget]
    );
    const forcedFocusZoom = useMemo(
        () => typeof __DEV__ === "boolean" && __DEV__
            ? parseFocusZoomParam(params.focusZoom)
            : undefined,
        [params.focusZoom]
    );
    const forcedSheetState = useMemo(() => parseSheetStateParam(params.sheetState), [params.sheetState]);
    const forcedRouteId = useMemo(() => getSingleParam(params.routeId)?.trim(), [params.routeId]);
    const forcedRouteIndex = useMemo(() => parseIntegerParam(params.routeIndex), [params.routeIndex]);
    const handoffRoute = useMemo(
        () => resolveRouteSelectionHandoff(initial?.route, initial?.travelMode ?? "CAR", forcedRouteId),
        [forcedRouteId, initial?.route, initial?.travelMode]
    );
    // QA 카메라/레이어는 운영 query와 연결하지 않는다. Release에서는 상수 분기로
    // 제거될 수 있도록 __DEV__ 안쪽에만 두고 사용자 입력으로 활성화하지 않는다.
    const qaCameraPresetId = typeof __DEV__ === "boolean" && __DEV__
        ? parseQaCameraPresetParam(undefined)
        : undefined;
    const qaLayerMode = typeof __DEV__ === "boolean" && __DEV__
        ? parseRouteQaLayerModeParam(undefined)
        : "ALL";
    const isRouteQaBaseOnly = qaLayerMode === "BASE_ONLY";
    // 지도 테마는 사용자 프로필 테마를 따르고, QA용 dim 막도 기본 화면에는 얹지 않는다.
    const qaMapBaseDimOpacity = 0;
    const shouldReturnToScheduleDetail = params.entrySource === "schedule-detail";

    const [originName, setOriginName] = useState(initial?.origin?.name ?? "");
    const [destinationName, setDestinationName] = useState(initial?.destination?.name ?? "");
    const [originAddress, setOriginAddress] = useState(initial?.origin?.address ?? "");
    const [destinationAddress, setDestinationAddress] = useState(initial?.destination?.address ?? "");
    const [originLat, setOriginLat] = useState<number | undefined>(initial?.origin?.lat);
    const [originLng, setOriginLng] = useState<number | undefined>(initial?.origin?.lng);
    const [originUsesDefault, setOriginUsesDefault] = useState(false);
    const [destinationLat, setDestinationLat] = useState<number | undefined>(initial?.destination?.lat);
    const [destinationLng, setDestinationLng] = useState<number | undefined>(initial?.destination?.lng);
    const [travelMode, setTravelMode] = useState<TravelMode>(initial?.travelMode ?? "CAR");
    const [activeTarget, setActiveTarget] = useState<RoutePointTarget | null>(() => {
        const hasInitialOrigin = typeof initial?.origin?.lat === "number" && typeof initial?.origin?.lng === "number";
        const hasInitialDestination = typeof initial?.destination?.lat === "number" && typeof initial?.destination?.lng === "number";
        if (forcedEditTarget) return forcedEditTarget;
        if (forcedFocusTarget === "origin" && hasInitialOrigin) return "origin";
        if (forcedFocusTarget === "destination" && hasInitialDestination) return "destination";
        if (hasInitialOrigin && hasInitialDestination) return null;
        return hasInitialOrigin ? "destination" : "origin";
    });
    const [locationPromptTarget, setLocationPromptTarget] = useState<RoutePointTarget | null>(null);
    const [locationPromptLoading, setLocationPromptLoading] = useState(false);
    const [isRoutePointEditMode, setIsRoutePointEditMode] = useState<boolean>(() => !(
        typeof initial?.origin?.lat === "number" &&
        typeof initial?.origin?.lng === "number" &&
        typeof initial?.destination?.lat === "number" &&
        typeof initial?.destination?.lng === "number"
    ) || !!forcedEditTarget);

    const [searchQuery, setSearchQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<PlaceSearchItem[]>([]);
    const [searchError, setSearchError] = useState<string>();
    const [completedSearchQuery, setCompletedSearchQuery] = useState("");
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRequestIdRef = useRef(0);
    const routePointRequestGuardRef = useRef(createLatestRequestGuard());

    const [etaMinutes, setEtaMinutes] = useState<number | undefined>(initial?.travelMinutes);
    const [_etaDistanceMeters, setEtaDistanceMeters] = useState<number | undefined>();
    const [routePathCoords, setRoutePathCoords] = useState<RoutePathCoord[] | undefined>();
    const [etaLoading, setEtaLoading] = useState(false);
    const [alternativesError, setAlternativesError] = useState<string | undefined>();
    const [routeSubmitPending, setRouteSubmitPending] = useState(false);
    const routeSubmitPendingRef = useRef(false);
    const routeSubmitResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternativeOption[]>(
        () => handoffRoute ? [handoffRoute] : []
    );
    const [transitRouteFilter, setTransitRouteFilter] = useState<TransitRouteFilter>("ALL");
    const [selectedAlternativeId, setSelectedAlternativeId] = useState<string | undefined>(handoffRoute?.id);
    const [requestedTransitDepartureAt, setRequestedTransitDepartureAt] = useState(() => paramDepartureAt ?? initialRouteDepartureAt);
    const [draftTransitDepartureAt, setDraftTransitDepartureAt] = useState(() => paramDepartureAt ?? initialRouteDepartureAt);
    const [isTransitDeparturePickerOpen, setIsTransitDeparturePickerOpen] = useState(false);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(0);
    const [transitActionBarHeight, setTransitActionBarHeight] = useState(0);
    const [hasBottomSheetMeasured, setHasBottomSheetMeasured] = useState(false);
    const [bottomSheetAnimatedOffset, setBottomSheetAnimatedOffset] = useState(420);
    const [bottomSheetSnap, setBottomSheetSnap] = useState<BottomSheetSnap>("collapsed");
    const [isBottomSheetCollapsed, setIsBottomSheetCollapsed] = useState(true);
    const [isBottomSheetHidden, setIsBottomSheetHidden] = useState(true);
    const [isMapInitialized, setIsMapInitialized] = useState(false);
    const [mapZoom, setMapZoom] = useState<number>(INITIAL_CAMERA.zoom ?? 12);
    const [mapCamera, setMapCamera] = useState<TmapCameraState>({
        latitude: INITIAL_CAMERA.latitude,
        longitude: INITIAL_CAMERA.longitude,
        zoom: INITIAL_CAMERA.zoom ?? 12,
    });
    const [transitConnectorOverlays, setTransitConnectorOverlays] = useState<TmapPathOverlay[]>([]);
    const [transitWalkDetailOverlays, setTransitWalkDetailOverlays] = useState<TmapPathOverlay[]>([]);
    const [routeEndpointAccessPaths, setRouteEndpointAccessPaths] = useState<RouteEndpointAccessPath[]>([]);
    const [selectedTransitMapStop, setSelectedTransitMapStop] = useState<SelectedTransitMapStop | undefined>();
    const [focusedTransitLegIndex, setFocusedTransitLegIndex] = useState<number | undefined>();
    const [focusedRouteStepId, setFocusedRouteStepId] = useState<string | undefined>();
    const selectedAlternativeIdRef = useRef<string | undefined>(handoffRoute?.id);
    const appliedDepartureParamRef = useRef<string | undefined>(paramDepartureAt?.toISOString());
    const [routeRefreshTick, setRouteRefreshTick] = useState(0);
    const initializedOriginRef = useRef(false);
    const originTouchedRef = useRef(Boolean(initial?.origin));
    const prevHasRouteReadyRef = useRef(false);
    const lastCameraActionKeyRef = useRef("");
    const lastCameraQaLogSignatureRef = useRef("");
    const lastMapLayoutLogSignatureRef = useRef("");
    const cameraQaStateRef = useRef<{
        requestedFocusZoom?: number;
        cameraMode: CameraMode;
        autoFitSuppressed: boolean;
        center?: Coordinate;
        reason: CameraUpdateReason;
        presetId?: QaCameraPresetId;
        appliedAtMs?: number;
    }>({
        cameraMode: "ROUTE_OVERVIEW",
        autoFitSuppressed: false,
        reason: "INITIAL_ROUTE_FIT",
    });
    const lastAppliedInitialKeyRef = useRef("");
    const transitConnectorCacheRef = useRef<Map<string, RoutePathCoord[]>>(new Map());

    const mapRef = useRef<TmapMapViewHandle | null>(null);
    const bottomSheetTranslateY = useRef(new Animated.Value(420)).current;
    const bottomSheetAnimatedOffsetRef = useRef(420);
    const bottomSheetStartYRef = useRef(0);

    useEffect(() => () => {
        searchRequestIdRef.current += 1;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (routeSubmitResetTimerRef.current) clearTimeout(routeSubmitResetTimerRef.current);
        routePointRequestGuardRef.current.invalidate();
    }, []);

    useEffect(() => {
        const paramKey = paramDepartureAt?.toISOString();
        if (!paramDepartureAt || appliedDepartureParamRef.current === paramKey) return;
        appliedDepartureParamRef.current = paramKey;
        setRequestedTransitDepartureAt(paramDepartureAt);
        setDraftTransitDepartureAt(paramDepartureAt);
        setRouteRefreshTick((current) => current + 1);
    }, [paramDepartureAt]);

    const prewarmMapCameraState = useCallback((center: Coordinate, zoom: number) => {
        const nextMetersPerPixel = estimateMetersPerPixel(center.latitude, zoom);
        setMapCamera((previous) => {
            if (
                Math.abs(previous.latitude - center.latitude) < 0.000002 &&
                Math.abs(previous.longitude - center.longitude) < 0.000002 &&
                Math.abs(previous.zoom - zoom) < 0.05 &&
                typeof previous.metersPerPixel === "number" &&
                Math.abs(previous.metersPerPixel - nextMetersPerPixel) <= Math.max(0.001, nextMetersPerPixel * 0.015)
            ) {
                return previous;
            }
            return {
                latitude: center.latitude,
                longitude: center.longitude,
                zoom,
                metersPerPixel: nextMetersPerPixel,
            };
        });
    }, []);

    const runCameraActionAfterDirectionPrewarm = useCallback((
        actionKey: string,
        center: Coordinate,
        zoom: number,
        action: () => void
    ) => {
        prewarmMapCameraState(center, zoom);
        // 카메라 상태와 WebView 명령 순서를 맞춰 QA 프리셋 이동이 이전 줌 값에 덮이지 않게 한다.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (lastCameraActionKeyRef.current === actionKey) action();
            });
        });
    }, [prewarmMapCameraState]);

    const isTransitMode = travelMode === "TRANSIT";
    const hasOriginCoords = typeof originLat === "number" && typeof originLng === "number";
    const hasDestinationCoords = typeof destinationLat === "number" && typeof destinationLng === "number";
    const hasRouteReady = hasOriginCoords && hasDestinationCoords;
    const isRouteDetailMode = hasRouteReady && !isRouteSelectionScreen;
    const isTransitDetailMode = isTransitMode && isRouteDetailMode;
    const shouldRenderTransitDetailDark = isDark;
    const detailPanelBg = isRouteDetailMode
        ? (isDark ? "#0B0C0F" : "#F8FAFC")
        : overlayPanelBg;
    const detailCardBg = isRouteDetailMode
        ? (isDark ? "#0B0C0F" : "#FFFFFF")
        : overlayCardBg;
    const detailPrimaryText = isDark ? "#F3F4F6" : colors.textPrimary;
    const detailSecondaryText = isDark ? "#B8B8B8" : colors.textSecondary;
    const detailBorderColor = isDark ? "#343434" : colors.border;
    const transitDetailSummaryPalette = getTransitDetailSummaryPalette(isDark, colors);
    const routeDetailSummarySurface = getRouteDetailSummarySurface(
        isTransitDetailMode,
        detailCardBg,
        transitDetailSummaryPalette.borderColor
    );
    const transitRouteChipBg = shouldRenderTransitDetailDark ? "rgba(18,18,18,0.94)" : "rgba(248,250,252,0.985)";
    const transitRouteChipText = shouldRenderTransitDetailDark ? "#D7D7DA" : "#334155";
    const transitActionBarBg = shouldRenderTransitDetailDark ? "#0B0C0F" : "#F8FAFC";
    const transitFocusedLegBg = shouldRenderTransitDetailDark ? "rgba(47,128,255,0.16)" : "#DBEAFE";
    const transitDetailPrimaryActionBg = "#2979FF";
    const transitDetailPrimaryActionText = "#FFFFFF";
    const transitDetailControlText = shouldRenderTransitDetailDark ? "#F3F4F6" : "#111827";
    const isRoutePointLocked = hasRouteReady && !isRoutePointEditMode;
    const isRouteSelectionStage = isRouteSelectionScreen;
    const hasActiveTarget = activeTarget === "origin" || activeTarget === "destination";
    const originDisplay = originName.trim() || originAddress.trim() || "출발지 미선택";
    const destinationDisplay = destinationName.trim() || destinationAddress.trim() || "도착지 미선택";
    const transitDetailActionBarPaddingBottom = Math.max(insets.bottom - 4, 8);
    const transitDetailActionBarEstimatedHeight = Math.max(
        TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
        TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING +
        TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT +
        transitDetailActionBarPaddingBottom +
        (bottomSheetSnap === "collapsed" ? TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT : 0)
    );
    const bottomPanelMaxHeight = useMemo(() => {
        if (isRouteDetailMode) {
            // 작은 화면에서도 상단 경로 헤더와 지도가 가려지지 않도록 시트 높이를 제한한다.
            const routeHeaderReserve = Math.max(insets.top + 104, 132);
            const availableHeight = Math.max(300, windowHeight - routeHeaderReserve);
            return Math.min(
                520,
                availableHeight,
                Math.max(340, Math.round(windowHeight * 0.56))
            );
        }
        const editModeReserve = Math.max(insets.top + 104, 140);
        return Math.min(560, Math.max(300, windowHeight - editModeReserve));
    }, [insets.top, isRouteDetailMode, windowHeight]);
    const bottomSheetPeekHeight = BOTTOM_SHEET_HANDLE_PEEK_HEIGHT;
    const bottomSheetCollapsedVisibleHeight = useMemo(() => {
        if (bottomPanelHeight <= 0) return bottomSheetPeekHeight;
        if (isRouteDetailMode) {
            return Math.min(
                bottomPanelHeight,
                Math.max(bottomSheetPeekHeight, TRANSIT_DETAIL_COLLAPSED_VISIBLE_BASE_HEIGHT + insets.bottom)
            );
        }
        return Math.max(bottomSheetPeekHeight, Math.round(bottomPanelHeight * BOTTOM_SHEET_COLLAPSED_VISIBLE_RATIO));
    }, [bottomPanelHeight, bottomSheetPeekHeight, insets.bottom, isRouteDetailMode]);
    const bottomSheetCollapsedOffset = useMemo(
        () => Math.max(0, bottomPanelHeight - bottomSheetCollapsedVisibleHeight),
        [bottomPanelHeight, bottomSheetCollapsedVisibleHeight]
    );
    const bottomSheetMiddleOffset = useMemo(() => {
        if (!isRouteDetailMode) return Math.round(bottomSheetCollapsedOffset * 0.52);
        if (bottomPanelHeight <= 0) return Math.round(bottomSheetCollapsedOffset * 0.45);
        const targetOffset = Math.max(0, Math.round(bottomPanelHeight * (1 - TRANSIT_DETAIL_MIDDLE_VISIBLE_RATIO)));
        return Math.min(bottomSheetCollapsedOffset, targetOffset);
    }, [bottomPanelHeight, bottomSheetCollapsedOffset, isRouteDetailMode]);
    const bottomSheetExpandedOffset = useMemo(() => {
        if (!isRouteDetailMode) return 0;
        const routeHeaderBottom = Math.max(insets.top + 84, 110);
        const naturalPanelTop = windowHeight - bottomPanelHeight;
        const safeExpandedOffset = Math.max(0, Math.ceil(routeHeaderBottom - naturalPanelTop));
        return Math.min(bottomSheetCollapsedOffset, Math.max(0, safeExpandedOffset));
    }, [bottomPanelHeight, bottomSheetCollapsedOffset, insets.top, isRouteDetailMode, windowHeight]);
    const bottomSheetHiddenOffset = useMemo(() => {
        if (!hasBottomSheetMeasured) return 420;
        return Math.max(320, bottomPanelHeight + insets.bottom + 32);
    }, [bottomPanelHeight, hasBottomSheetMeasured, insets.bottom]);
    const bottomSheetDragMinOffset = bottomSheetExpandedOffset;
    const bottomSheetDragMaxOffset = bottomSheetCollapsedOffset;
    const canScrollBottomSheetContent =
        bottomSheetSnap === "expanded" ||
        (isRouteDetailMode && bottomSheetSnap === "middle");
    const transitDetailActionBarReserveHeight = isRouteDetailMode
        ? Math.max(transitActionBarHeight, transitDetailActionBarEstimatedHeight)
        : 0;
    const visibleBottomSheetHeight = bottomPanelHeight > 0
        ? Math.max(
            0,
            bottomPanelHeight - (
                isBottomSheetHidden
                    ? bottomSheetHiddenOffset
                    : Math.min(
                        bottomSheetHiddenOffset,
                        Math.max(bottomSheetDragMinOffset, bottomSheetAnimatedOffset)
                    )
            )
        )
        : bottomPanelMaxHeight;
    const bottomPanelScrollViewportHeight = isRouteDetailMode
        ? getTransitDetailScrollViewportHeight(
            visibleBottomSheetHeight,
            transitDetailActionBarReserveHeight,
            TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT
        )
        : undefined;
    const bottomPanelScrollBottomPadding = isRouteDetailMode
        ? 34
        : Math.max(insets.bottom + 8, 12);
    // 접힌 상세 화면에서는 시트보다 하단 요약·버튼 바가 더 높을 수 있다.
    // 카메라는 둘 중 실제로 지도를 더 많이 가리는 높이를 기준으로 맞춘다.
    const transitMapBottomOcclusionHeight = isRouteDetailMode && !isBottomSheetHidden
        ? Math.max(visibleBottomSheetHeight, transitDetailActionBarReserveHeight)
        : visibleBottomSheetHeight;

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
        editTarget: forcedEditTarget ?? null,
        routeId: forcedRouteId ?? null,
        handoffRouteId: handoffRoute?.id ?? null,
    }), [sessionId, initial, forcedEditTarget, forcedRouteId, handoffRoute?.id]);
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
    const canSubmitRoute = !routeSubmitPending && canPersistResolvedRoute({
        hasRouteReady,
        routeLoading: etaLoading,
        hasSelectedRoute: !!selectedAlternative,
        routeError: alternativesError,
    });
    const openSelectedRouteAttribution = useCallback(() => {
        const attributionUrl = selectedAlternative?.attributionUrl;
        if (!attributionUrl) return;
        Linking.openURL(attributionUrl).catch(() => {
            Alert.alert("지도 정보", "OpenStreetMap 페이지를 열지 못했습니다.");
        });
    }, [selectedAlternative?.attributionUrl]);
    const routeSegmentWalkOverlayById = useMemo(
        () => new Map(transitWalkDetailOverlays.map((overlay) => [overlay.id, overlay.coords])),
        [transitWalkDetailOverlays]
    );
    const normalizedRouteCandidates = useMemo(
        () => routeAlternatives
            .map((option) => normalizeRouteAlternativeToSegments(option, routeSegmentWalkOverlayById))
            .filter((route): route is NormalizedRoute => !!route),
        [routeAlternatives, routeSegmentWalkOverlayById]
    );
    const selectedNormalizedRoute = useMemo(
        () => normalizedRouteCandidates.find((route) => route.id === selectedAlternativeId),
        [normalizedRouteCandidates, selectedAlternativeId]
    );
    const qaCameraPreset = useMemo(
        () => buildQaCameraPreset(
            qaCameraPresetId,
            selectedNormalizedRoute,
            forcedFocusZoom,
            {
                origin: hasOriginCoords ? { latitude: originLat!, longitude: originLng! } : undefined,
                destination: hasDestinationCoords ? { latitude: destinationLat!, longitude: destinationLng! } : undefined,
                transitLegs: selectedAlternative?.transitLegs,
            }
        ),
        [
            destinationLat,
            destinationLng,
            forcedFocusZoom,
            hasDestinationCoords,
            hasOriginCoords,
            originLat,
            originLng,
            qaCameraPresetId,
            selectedAlternative?.transitLegs,
            selectedNormalizedRoute,
        ]
    );
    const isQaCameraLocked = !!qaCameraPreset?.disableAutoFit;
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
    const selectedAlternativeQualityNotice = useMemo(
        () => selectedAlternative ? getRouteQualityNotice(selectedAlternative) : undefined,
        [selectedAlternative]
    );
    const [selectedRouteDepartureAt, setSelectedRouteDepartureAt] = useState(() => initialRouteDepartureAt);
    const selectedTransitMeta = useMemo(
        () => selectedAlternative ? buildTransitRouteTimeMeta(selectedAlternative, selectedRouteDepartureAt) : undefined,
        [selectedAlternative, selectedRouteDepartureAt]
    );
    const selectedTransitTimeRange = useMemo(
        () => selectedTransitMeta?.combinedText ?? "",
        [selectedTransitMeta]
    );
    const selectedTransitStatusLabel = selectedAlternative?.transitServiceState === "not_operating"
        ? "운행 종료"
        : selectedAlternative?.transitDepartureTimeSource === "next_service_search"
            ? "다음 운행"
            : "최적";
    const selectedTransitProgressSegments = useMemo(
        () => {
            const segmentBasedProgress = buildTransitProgressSegmentsFromRoute(selectedNormalizedRoute);
            return segmentBasedProgress.length > 0
                ? segmentBasedProgress
                : buildTransitRouteProgressSegments(selectedAlternative?.transitLegs);
        },
        [selectedAlternative, selectedNormalizedRoute]
    );
    const primaryTransitLineLabel = useMemo(
        () => selectedAlternative ? getPrimaryTransitLineLabel(selectedAlternative.transitLegs) : "대중교통",
        [selectedAlternative]
    );
    const selectedRouteInfo = useMemo<RouteInfo | undefined>(() => {
        if (!selectedAlternative) return undefined;
        const originPlace = hasOriginCoords
            ? { name: originDisplay, address: originAddress.trim() || undefined, lat: originLat, lng: originLng }
            : undefined;
        const destinationPlace = hasDestinationCoords
            ? { name: destinationDisplay, address: destinationAddress.trim() || undefined, lat: destinationLat, lng: destinationLng }
            : undefined;
        const baseRouteInfo = buildRouteInfoFromAlternative(
            selectedAlternative,
            originPlace,
            destinationPlace,
            selectedRouteDepartureAt,
            selectedAlternativeIndex
        );
        const candidateRouteInfo = isTransitMode
            ? buildRouteInfoFromNormalizedRoute(baseRouteInfo, selectedNormalizedRoute)
            : baseRouteInfo;
        const selectedTiming = resolveSelectedRouteTiming({
            targetArrivalAt: initial?.targetArrivalAt,
            routeInfo: candidateRouteInfo,
            fallbackDepartureAt: selectedRouteDepartureAt,
        });
        return {
            ...candidateRouteInfo,
            departureTime: selectedTiming.departureAt.toISOString(),
            arrivalTime: selectedTiming.arrivalAt.toISOString(),
        };
    }, [
        destinationAddress,
        destinationDisplay,
        destinationLat,
        destinationLng,
        hasDestinationCoords,
        hasOriginCoords,
        initial?.targetArrivalAt,
        isTransitMode,
        originAddress,
        originDisplay,
        originLat,
        originLng,
        selectedAlternative,
        selectedAlternativeIndex,
        selectedNormalizedRoute,
        selectedRouteDepartureAt,
    ]);
    const finalSelectedRouteDepartureTime = selectedRouteInfo?.departureTime
        ?? selectedRouteDepartureAt.toISOString();
    const selectedCollapsedRouteSummary = useMemo(() => {
        if (!selectedRouteInfo) return undefined;
        const arrivalText = formatRouteClock(selectedRouteInfo.arrivalTime);
        const metrics = buildRouteSummaryMetrics(selectedRouteInfo)
            .filter(({ key }) => key === "fare" || key === "transfer" || key === "walk")
            .map(({ label }) => label);
        return {
            arrivalText: arrivalText ? `${arrivalText} 도착` : undefined,
            metricsText: metrics.join(" · "),
        };
    }, [selectedRouteInfo]);
    const selectedTransitPrimaryRideLeg = useMemo(
        () => selectedAlternative?.transitLegs?.find((leg) => isRideLegKind(leg.kind)),
        [selectedAlternative]
    );
    const selectedTransitHeaderDuration = selectedAlternative
        ? selectedAlternative.transitServiceState === "not_operating"
            ? "운행 종료"
            : formatRouteInfoDuration(selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative.minutes)
        : TRAVEL_MODE_META[travelMode].label;
    const selectedTransitHeaderTransferText = selectedAlternative
        ? (() => {
            const transferCount = getTransitRouteTransferCount(selectedAlternative);
            return transferCount > 0 ? ` + 환승 ${transferCount}회` : "";
        })()
        : "";
    const selectedTransitHeaderIcon = selectedTransitPrimaryRideLeg?.kind === "BUS" ? "bus" : "train";
    const selectedTransitHeaderLineColor = selectedTransitPrimaryRideLeg
        ? getTransitLegVisualColor(selectedTransitPrimaryRideLeg)
        : "#22C55E";
    const selectedTransitHeaderTitle = `${primaryTransitLineLabel}${selectedTransitHeaderTransferText} | ${selectedTransitHeaderDuration}`;
    const selectedDetailHeaderIcon: React.ComponentProps<typeof Ionicons>["name"] = isTransitMode
        ? selectedTransitHeaderIcon
        : travelMode === "CAR" || travelMode === "ETC"
            ? "car"
            : travelMode === "WALK"
                ? "walk"
                : "bicycle";
    const selectedDetailHeaderColor = isTransitMode
        ? selectedTransitHeaderLineColor
        : travelMode === "BIKE"
            ? "#00897B"
            : travelMode === "WALK"
                ? "#64748B"
                : "#2979FF";
    const selectedDetailHeaderTitle = isTransitMode
        ? selectedTransitHeaderTitle
        : `${TRAVEL_MODE_META[travelMode].label} | ${selectedTransitHeaderDuration}`;
    const nextHeaderAlternativeIndex = visibleAlternatives.length > 1
        ? ((selectedVisibleAlternativeIndex >= 0 ? selectedVisibleAlternativeIndex : 0) + 1) % visibleAlternatives.length
        : undefined;
    const nextHeaderAlternative = typeof nextHeaderAlternativeIndex === "number"
        ? visibleAlternatives[nextHeaderAlternativeIndex]
        : undefined;
    const nextHeaderRideLeg = nextHeaderAlternative?.transitLegs?.find((leg) => isRideLegKind(leg.kind));
    const nextHeaderIcon: React.ComponentProps<typeof Ionicons>["name"] = nextHeaderRideLeg?.kind === "BUS"
        ? "bus"
        : "train";
    const nextHeaderColor = nextHeaderRideLeg
        ? getTransitLegVisualColor(nextHeaderRideLeg)
        : selectedDetailHeaderColor;
    const nextHeaderLabel = nextHeaderAlternative
        ? `${getPrimaryTransitLineLabel(nextHeaderAlternative.transitLegs)} · ${formatRouteInfoDuration(nextHeaderAlternative.minutes)}`
        : undefined;
    const routeStrokeStyle = getRouteStrokeStyleForZoom(mapZoom);
    const routeOverlayScopeKey = useMemo(() => [
        travelMode,
        selectedNormalizedRoute?.id ?? selectedAlternativeId ?? "none",
        forcedRouteId ?? "route",
        typeof forcedRouteIndex === "number" ? forcedRouteIndex : "auto",
        qaLayerMode,
    ].join(":"), [
        forcedRouteId,
        forcedRouteIndex,
        qaLayerMode,
        selectedAlternativeId,
        selectedNormalizedRoute?.id,
        travelMode,
    ]);

    useEffect(() => {
        const providerDepartureAt = selectedAlternative?.transitDepartureAt
            ? new Date(selectedAlternative.transitDepartureAt)
            : undefined;
        setSelectedRouteDepartureAt(
            providerDepartureAt && Number.isFinite(providerDepartureAt.getTime())
                ? providerDepartureAt
                : initialRouteDepartureAt
        );
        setFocusedRouteStepId(undefined);
    }, [initialRouteDepartureAt, selectedAlternative?.transitDepartureAt, selectedAlternativeId]);

    useEffect(() => {
        const listenerId = bottomSheetTranslateY.addListener(({ value }) => {
            const roundedOffset = Math.round(value);
            if (Math.abs(bottomSheetAnimatedOffsetRef.current - roundedOffset) < 3) return;
            bottomSheetAnimatedOffsetRef.current = roundedOffset;
            setBottomSheetAnimatedOffset(roundedOffset);
        });

        return () => {
            bottomSheetTranslateY.removeListener(listenerId);
        };
    }, [bottomSheetTranslateY]);

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

    useEffect(() => {
        setSelectedTransitMapStop(undefined);
    }, [selectedAlternativeId, travelMode]);

    const animateBottomSheetTo = useCallback((toValue: number) => {
        Animated.spring(bottomSheetTranslateY, {
            toValue,
            useNativeDriver: true,
            damping: 34,
            stiffness: 190,
            mass: 1,
            overshootClamping: true,
            restDisplacementThreshold: 0.35,
            restSpeedThreshold: 0.35,
        }).start();
    }, [bottomSheetTranslateY]);

    const getBottomSheetSnapTarget = useCallback((snap: BottomSheetSnap) => {
        if (snap === "hidden") return bottomSheetHiddenOffset;
        if (snap === "expanded") return bottomSheetExpandedOffset;
        if (snap === "middle") return isRouteDetailMode ? bottomSheetMiddleOffset : bottomSheetCollapsedOffset;
        return bottomSheetCollapsedOffset;
    }, [bottomSheetCollapsedOffset, bottomSheetExpandedOffset, bottomSheetHiddenOffset, bottomSheetMiddleOffset, isRouteDetailMode]);

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
        if (!isRouteDetailMode) {
            const midpoint = bottomSheetExpandedOffset + ((bottomSheetCollapsedOffset - bottomSheetExpandedOffset) * 0.52);
            const projected = current + (velocityY * BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION);

            if (velocityY <= -BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) return "expanded";
            if (velocityY >= BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) return "collapsed";
            return projected >= midpoint ? "collapsed" : "expanded";
        }

        if (velocityY <= -BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) {
            return current > bottomSheetMiddleOffset ? "middle" : "expanded";
        }
        if (velocityY >= BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) {
            return current < bottomSheetMiddleOffset ? "middle" : "collapsed";
        }

        const projected = Math.min(
            Math.max(bottomSheetExpandedOffset, current + (velocityY * BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION)),
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
        isRouteDetailMode,
    ]);

    const bottomHandlePanResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => !isBottomSheetHidden && bottomSheetCollapsedOffset > 0,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
            !isBottomSheetHidden &&
            bottomSheetCollapsedOffset > 0 &&
            Math.abs(gestureState.dy) > 1 &&
            Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 0.6,
        onPanResponderGrant: () => {
            bottomSheetTranslateY.stopAnimation((value) => {
                bottomSheetStartYRef.current = value;
            });
        },
        onPanResponderMove: (_event, gestureState) => {
            let next = bottomSheetStartYRef.current + gestureState.dy;
            if (next < bottomSheetDragMinOffset) {
                next = bottomSheetDragMinOffset + ((next - bottomSheetDragMinOffset) * BOTTOM_SHEET_EDGE_RESISTANCE);
            } else if (next > bottomSheetDragMaxOffset) {
                next = bottomSheetDragMaxOffset + ((next - bottomSheetDragMaxOffset) * BOTTOM_SHEET_EDGE_RESISTANCE);
            }
            next = Math.min(
                bottomSheetDragMaxOffset + BOTTOM_SHEET_EDGE_OVERSHOOT,
                Math.max(bottomSheetDragMinOffset - BOTTOM_SHEET_EDGE_OVERSHOOT, next)
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
        bottomSheetDragMinOffset,
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
        routePointRequestGuardRef.current.invalidate();

        setOriginName(initial?.origin?.name ?? "");
        setDestinationName(initial?.destination?.name ?? "");
        setOriginAddress(initial?.origin?.address ?? "");
        setDestinationAddress(initial?.destination?.address ?? "");
        setOriginLat(initial?.origin?.lat);
        setOriginLng(initial?.origin?.lng);
        setOriginUsesDefault(false);
        setDestinationLat(initial?.destination?.lat);
        setDestinationLng(initial?.destination?.lng);
        setTravelMode(initial?.travelMode ?? "CAR");
        setTransitRouteFilter("ALL");
        setRouteAlternatives(handoffRoute ? [handoffRoute] : []);
        setSelectedAlternativeId(handoffRoute?.id);
        selectedAlternativeIdRef.current = handoffRoute?.id;
        // 새 OD가 들어오면 이전 경로가 새 목적지의 결과처럼 잠시라도 보이지 않게 즉시 비운다.
        setEtaMinutes(initial?.travelMinutes);
        setEtaDistanceMeters(undefined);
        setRoutePathCoords(undefined);
        transitConnectorCacheRef.current.clear();
        setTransitConnectorOverlays([]);
        setTransitWalkDetailOverlays([]);
        setRouteEndpointAccessPaths([]);
        setSelectedTransitMapStop(undefined);
        setAlternativesError(undefined);
        setFocusedTransitLegIndex(undefined);
        setFocusedRouteStepId(undefined);
        lastCameraActionKeyRef.current = "";
        const hasInitialOrigin = typeof initial?.origin?.lat === "number" && typeof initial?.origin?.lng === "number";
        const hasInitialDestination = typeof initial?.destination?.lat === "number" && typeof initial?.destination?.lng === "number";
        originTouchedRef.current = hasInitialOrigin;
        initializedOriginRef.current = hasInitialOrigin;
        if (forcedEditTarget) {
            setActiveTarget(forcedEditTarget);
        } else if (forcedFocusTarget === "origin" && hasInitialOrigin) {
            setActiveTarget("origin");
        } else if (forcedFocusTarget === "destination" && hasInitialDestination) {
            setActiveTarget("destination");
        } else if (hasInitialOrigin && hasInitialDestination) {
            setActiveTarget(null);
        } else {
            setActiveTarget(hasInitialOrigin ? "destination" : "origin");
        }
        setIsRoutePointEditMode(!(hasInitialOrigin && hasInitialDestination) || !!forcedEditTarget);
    }, [handoffRoute, initial, initialSyncKey, forcedEditTarget, forcedFocusTarget]);

    useEffect(() => {
        // 시트 프리셋은 화면 상태만 바꾸며 현재 선택 경로와 검색 결과를 초기화하지 않는다.
        if (forcedSheetState === "hidden") {
            setIsBottomSheetHidden(true);
            setBottomSheetSnap("hidden");
            setIsBottomSheetCollapsed(true);
        } else if (forcedSheetState === "collapsed") {
            setIsBottomSheetHidden(false);
            setBottomSheetSnap("collapsed");
            setIsBottomSheetCollapsed(true);
        } else if (forcedSheetState === "middle") {
            setIsBottomSheetHidden(false);
            setBottomSheetSnap("middle");
            setIsBottomSheetCollapsed(false);
        } else if (forcedSheetState === "expanded") {
            setIsBottomSheetHidden(false);
            setBottomSheetSnap("expanded");
            setIsBottomSheetCollapsed(false);
        }
    }, [forcedSheetState, hasRouteReady]);

    useEffect(() => {
        if (!visibleAlternatives.length) return;
        if (forcedRouteId) {
            const forcedById = visibleAlternatives.find((item) => item.id === forcedRouteId);
            if (forcedById) {
                if (forcedById.id !== selectedAlternativeId) {
                    setSelectedAlternativeId(forcedById.id);
                    selectedAlternativeIdRef.current = forcedById.id;
                    setFocusedTransitLegIndex(undefined);
                }
                return;
            }
        }
        if (!forcedRouteId && typeof forcedRouteIndex === "number") {
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
    }, [visibleAlternatives, selectedAlternativeId, forcedRouteId, forcedRouteIndex]);

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
        if (!isMapInitialized) return;
        const reason = [
            "BOTTOM_SHEET_LAYOUT",
            bottomSheetSnap,
            isBottomSheetHidden ? "hidden" : "shown",
            Math.round(bottomPanelHeight),
            Math.round(visibleBottomSheetHeight),
            Math.round(windowWidth),
            Math.round(windowHeight),
        ].join(":");
        mapRef.current?.resizeMap(reason);
        const timer = setTimeout(() => {
            mapRef.current?.resizeMap(`${reason}:settled`);
        }, 320);
        return () => clearTimeout(timer);
    }, [
        bottomPanelHeight,
        bottomSheetSnap,
        isBottomSheetHidden,
        isMapInitialized,
        visibleBottomSheetHeight,
        windowHeight,
        windowWidth,
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
            const nextSnap: BottomSheetSnap = isRouteDetailMode ? "middle" : "expanded";
            setBottomSheetSnap(nextSnap);
            setIsBottomSheetCollapsed(nextSnap !== "expanded");
        }
    }, [forcedSheetState, isMapInitialized, hasBottomSheetMeasured, isBottomSheetHidden, hasRouteReady, isRouteDetailMode]);

    const retryRouteSearch = useCallback(() => {
        invalidateRouteSearch(
            { name: originName, address: originAddress, lat: originLat, lng: originLng },
            { name: destinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng },
            travelMode
        );
        setRouteRefreshTick((current) => current + 1);
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationName,
        originAddress,
        originLat,
        originLng,
        originName,
        travelMode,
    ]);

    const isHandoffRequestCurrent = !!handoffRoute &&
        routeRefreshTick === 0 &&
        travelMode === initial?.travelMode &&
        originLat === initial?.origin?.lat &&
        originLng === initial?.origin?.lng &&
        destinationLat === initial?.destination?.lat &&
        destinationLng === initial?.destination?.lng;

    // 출발지·도착지·이동수단이 바뀌거나 사용자가 재시도할 때만 실제 경로를 다시 조회한다.
    useEffect(() => {
        if (!hasRouteReady) {
            setRouteAlternatives([]);
            setSelectedAlternativeId(undefined);
            selectedAlternativeIdRef.current = undefined;
            setFocusedTransitLegIndex(undefined);
            setAlternativesError(undefined);
            setEtaLoading(false);
            setEtaMinutes(undefined);
            setEtaDistanceMeters(undefined);
            setRoutePathCoords(undefined);
            return;
        }

        // 목록에서 선택한 경로는 이미 완성된 API 응답이다. 최초 진입 재조회로 다른 후보가 덮어쓰지 않게 한다.
        if (isHandoffRequestCurrent && handoffRoute) {
            setRouteAlternatives([handoffRoute]);
            setSelectedAlternativeId(handoffRoute.id);
            selectedAlternativeIdRef.current = handoffRoute.id;
            setFocusedTransitLegIndex(undefined);
            setAlternativesError(undefined);
            setEtaLoading(false);
            return;
        }

        // 새 OD/교통수단/출발 시각이 들어오면 이전 후보를 즉시 숨긴다.
        // debounce 동안 이전 경로를 새 요청의 결과처럼 저장하는 것을 막는다.
        setEtaLoading(true);
        setAlternativesError(undefined);
        setRouteAlternatives([]);
        setSelectedAlternativeId(undefined);
        selectedAlternativeIdRef.current = undefined;
        setFocusedTransitLegIndex(undefined);
        setEtaMinutes(undefined);
        setEtaDistanceMeters(undefined);
        setRoutePathCoords(undefined);

        let active = true;
        const timer = setTimeout(async () => {
            try {
                const nextAlternatives = await getRouteAlternativeOptions(
                    { name: originName, address: originAddress, lat: originLat, lng: originLng },
                    { name: destinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng },
                    travelMode,
                    travelMode === "TRANSIT"
                        ? { departureAt: requestedTransitDepartureAt }
                        : undefined
                );
                if (!active) return;

                const sortedAlternatives = sortRouteAlternativesForPlanner(nextAlternatives, travelMode);

                setRouteAlternatives(sortedAlternatives);

                if (!sortedAlternatives.length) {
                    setSelectedAlternativeId(undefined);
                    selectedAlternativeIdRef.current = undefined;
                    setFocusedTransitLegIndex(undefined);
                    setAlternativesError("표시할 경로가 없습니다.");
                    return;
                }

                const selected = sortedAlternatives.find((item) => item.id === forcedRouteId) ??
                    sortedAlternatives.find((item) => item.id === selectedAlternativeIdRef.current) ??
                    sortedAlternatives[0];
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
        routeRefreshTick,
        originName,
        originAddress,
        originLat,
        originLng,
        destinationName,
        destinationAddress,
        destinationLat,
        destinationLng,
        forcedRouteId,
        handoffRoute,
        isHandoffRequestCurrent,
        requestedTransitDepartureAt,
    ]);

    // 선택된 경로 옵션에서 "지도 전체 polyline"의 기준이 될 경로를 정리한다.
    // 대중교통은 option.pathCoords가 비어 있을 수 있어 leg path들을 다시 합쳐 fallback으로 쓴다.
    useEffect(() => {
        if (!selectedAlternative) {
            setEtaMinutes(undefined);
            setEtaDistanceMeters(undefined);
            setRoutePathCoords(undefined);
            return;
        }

        setEtaMinutes(selectedAlternative.minutes);
        setEtaDistanceMeters(selectedAlternative.distanceMeters);
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
        // 승하차 지점 주변의 짧은 도보 gap도 지도에서 끊겨 보이지 않도록 낮게 잡는다.
        const connectorMinMeters = 10;
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
            (leg.pathCoords.length ?? 0) >= 3 &&
            splitWalkPathAtDiscontinuities(leg.pathCoords).length === 1;

        const firstWalkLeg = transitLegs[0]?.kind === "WALK" ? transitLegs[0] : undefined;
        const lastWalkLeg = transitLegs[transitLegs.length - 1]?.kind === "WALK"
            ? transitLegs[transitLegs.length - 1]
            : undefined;
        const exactWalkLegOverlays = transitLegs.flatMap((leg, legIndex): TmapPathOverlay[] => {
            if (!walkLegHasPrecisePath(leg) || !Array.isArray(leg.pathCoords)) return [];
            let alignedPath = alignWalkPathToRideEndpoints(transitLegs, legIndex, leg.pathCoords);
            const isFirstLeg = legIndex === 0;
            const isLastLeg = legIndex === transitLegs.length - 1;
            alignedPath = stitchTransitWalkPathToAnchors(
                alignedPath,
                isFirstLeg ? originPoint : undefined,
                isLastLeg ? destinationPoint : undefined,
                { terminalStart: isFirstLeg, terminalEnd: isLastLeg }
            );
            const displayCoords = toDisplayOverlayCoords(alignedPath, "WALK");
            if (displayCoords.length < 2) return [];
            const baseId = `${selectedAlternative.id}-walk-leg-${legIndex}`;
            const overlay = {
                id: baseId,
                coords: displayCoords,
                color: "rgba(0,0,0,0)",
                width: 1,
                outlineColor: "rgba(0,0,0,0)",
                outlineWidth: 0,
            } as TmapPathOverlay;
            const pathOverlay = {
                ...overlay,
                id: `${baseId}-path`,
                width: 0.5,
            } as TmapPathOverlay;
            return [overlay, pathOverlay];
        });

        // 출발/도착은 고정하고, 승/하차측 끝점은 보행 API가 반환한 실제 보행 가능점(보도측)을 우선한다.
        // 첫/마지막 WALK 레그에 정밀 경로가 있으면 exactWalkLegOverlays가 담당한다.
        if (!walkLegHasPrecisePath(firstWalkLeg)) {
            pushConnectorRequest(`${selectedAlternative.id}-walk-boundary-start`, originPoint, firstAnchorPoint, true, false);
        } else {
            const preciseStart = firstWalkLeg?.pathCoords?.[0];
            if (
                preciseStart &&
                distanceMeters(originPoint, preciseStart) > TRANSIT_TERMINAL_CONNECTOR_MAX_METERS
            ) {
                pushConnectorRequest(
                    `${selectedAlternative.id}-walk-boundary-start`,
                    originPoint,
                    preciseStart,
                    true,
                    true
                );
            }
        }
        if (!walkLegHasPrecisePath(lastWalkLeg)) {
            pushConnectorRequest(`${selectedAlternative.id}-walk-boundary-end`, lastAnchorPoint, destinationPoint, false, true);
        } else {
            const precisePath = lastWalkLeg?.pathCoords;
            const preciseEnd = Array.isArray(precisePath) ? precisePath[precisePath.length - 1] : undefined;
            if (
                preciseEnd &&
                distanceMeters(preciseEnd, destinationPoint) > TRANSIT_TERMINAL_CONNECTOR_MAX_METERS
            ) {
                pushConnectorRequest(
                    `${selectedAlternative.id}-walk-boundary-end`,
                    preciseEnd,
                    destinationPoint,
                    true,
                    true
                );
            }
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
                if (walkLegHasPrecisePath(leg)) return null;
                const previousLeg = transitLegs[legIndex - 1];
                const nextLeg = transitLegs[legIndex + 1];
                const endpoints = resolveTransitWalkRequestEndpoints({
                    legIndex,
                    legCount: transitLegs.length,
                    origin: originPoint,
                    destination: destinationPoint,
                    legStart: getTransitLegBoardCoord(leg)
                        ?? getTransitLegBoardAnchorOnPath(leg)
                        ?? getTransitLegStartCoord(leg),
                    legEnd: getTransitLegAlightCoord(leg)
                        ?? getTransitLegAlightAnchorOnPath(leg)
                        ?? getTransitLegEndCoord(leg),
                    previousIsRide: !!previousLeg && isRideLegKind(previousLeg.kind),
                    previousRideAlight: previousLeg && isRideLegKind(previousLeg.kind)
                        ? (getRideStopConnectorCoord(transitLegs, legIndex - 1, "ALIGHT")
                        ?? getTransitLegAlightCoord(previousLeg))
                        : undefined,
                    nextIsRide: !!nextLeg && isRideLegKind(nextLeg.kind),
                    nextRideBoard: nextLeg && isRideLegKind(nextLeg.kind)
                        ? (getRideStopConnectorCoord(transitLegs, legIndex + 1, "BOARD")
                        ?? getTransitLegBoardCoord(nextLeg))
                        : undefined,
                });
                if (!endpoints) return null;
                const walkGapMeters = distanceMeters(endpoints.from, endpoints.to);
                if (!Number.isFinite(walkGapMeters) || walkGapMeters < 35) return null;
                return {
                    id: `${selectedAlternative.id}-walk-leg-${legIndex}`,
                    ...endpoints,
                };
            })
            .filter((value): value is ConnectorPathRequest => value !== null);

        const firstWalkRequestId = transitLegs[0]?.kind === "WALK"
            ? `${selectedAlternative.id}-walk-leg-0`
            : undefined;
        const lastWalkIndex = transitLegs.length - 1;
        const lastWalkRequestId = transitLegs[lastWalkIndex]?.kind === "WALK"
            ? `${selectedAlternative.id}-walk-leg-${lastWalkIndex}`
            : undefined;

        if (!connectorRequests.length && !walkLegRequests.length) {
            setTransitWalkDetailOverlays(exactWalkLegOverlays);
            return;
        }

        const normalizeConnectorPath = (
            rawPath: RoutePathCoord[]
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
            // 끝점 보정은 stitchWalkPathToAnchors 한 곳에서만 수행해 24m 정책을 우회하지 못하게 한다.
            return filtered;
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
            const best = walkCandidates.find((item) => item.source === "api");

            if (!best?.pathCoords || !hasRenderableWalkPath(best)) {
                return undefined;
            }
            const normalizedPath = normalizeConnectorPath(best.pathCoords);
            if (!normalizedPath || normalizedPath.length < 2) return undefined;
            transitConnectorCacheRef.current.set(key, normalizedPath);
            return normalizedPath;
        };

        (async () => {
            const overlays: TmapPathOverlay[] = [];
            const walkDetailOverlays: TmapPathOverlay[] = [...exactWalkLegOverlays];
            const successfulWalkRequestIds = new Set<string>();
            const successfulWalkLegIndexes = new Set<number>();

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
                    const stitchedWalkPath = stitchTransitWalkPathToAnchors(
                        walkPath,
                        request.from,
                        request.to,
                        { terminalStart: request.snapFrom, terminalEnd: request.snapTo }
                    );
                    const displayCoords = toDisplayOverlayCoords(stitchedWalkPath, "WALK");
                    if (displayCoords.length < 2) continue;
                    successfulWalkRequestIds.add(request.id);
                    const legIndexMatch = request.id.match(/-walk-leg-(\d+)$/);
                    if (legIndexMatch) successfulWalkLegIndexes.add(Number(legIndexMatch[1]));
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

            // 상세 WALK 조회가 실제로 성공한 구간만 boundary/gap fallback을 억제한다.
            // WALK API가 실패하면 connector를 남겨 출발·도착/승하차 접점이 끊기지 않게 한다.
            const effectiveConnectorRequests = filterTransitConnectorRequestsForSuccessfulWalks(
                connectorRequests,
                {
                    firstWalkRequestId,
                    lastWalkRequestId,
                    successfulWalkRequestIds,
                    successfulWalkLegIndexes,
                    legKinds: transitLegs.map((leg) => leg.kind),
                }
            );

            for (const request of effectiveConnectorRequests) {
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
                    const stitchedConnectorPath = stitchTransitWalkPathToAnchors(
                        connectorPath,
                        request.from,
                        request.to,
                        { terminalStart: request.snapFrom, terminalEnd: request.snapTo }
                    );
                    const displayCoords = toDisplayOverlayCoords(stitchedConnectorPath, "WALK");
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

    // 자동차·자전거 공급자는 선택한 POI 대신 가까운 도로망 좌표에서 경로를 시작하거나 끝낸다.
    // 짧은 끝점 gap만 TMAP 보행 경로로 보완하고, 장거리·과도한 우회 형상은 표시하지 않는다.
    useEffect(() => {
        if (
            (travelMode !== "CAR" && travelMode !== "BIKE") ||
            !selectedAlternative ||
            !Array.isArray(selectedAlternative.pathCoords) ||
            selectedAlternative.pathCoords.length < 2 ||
            typeof originLat !== "number" ||
            typeof originLng !== "number" ||
            typeof destinationLat !== "number" ||
            typeof destinationLng !== "number"
        ) {
            setRouteEndpointAccessPaths([]);
            return;
        }

        const requests = buildRouteEndpointAccessRequests(
            selectedAlternative.id,
            selectedAlternative.pathCoords,
            { lat: originLat, lng: originLng },
            { lat: destinationLat, lng: destinationLng }
        );
        if (!requests.length) {
            setRouteEndpointAccessPaths([]);
            return;
        }

        let cancelled = false;
        void Promise.all(requests.map(async (request) => {
            const directPath = resolveRouteEndpointAccessPath(request);
            if (directPath) return directPath;

            try {
                const alternatives = await getRouteAlternativeOptions(
                    { name: request.position === "start" ? (originName || "출발지") : "경로 끝점", lat: request.from.lat, lng: request.from.lng },
                    { name: request.position === "end" ? (destinationName || "도착지") : "경로 시작점", lat: request.to.lat, lng: request.to.lng },
                    "WALK"
                );
                const providerWalkPath = alternatives
                    .filter((option) => (
                        option.source === "api" &&
                        option.fallbackKind !== "straight" &&
                        Array.isArray(option.pathCoords) &&
                        option.pathCoords.length >= 2
                    ))
                    .sort((a, b) => (
                        (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
                        (b.distanceMeters ?? Number.POSITIVE_INFINITY)
                    ))[0]?.pathCoords;
                return resolveRouteEndpointAccessPath(request, providerWalkPath);
            } catch {
                return undefined;
            }
        })).then((resolvedPaths) => {
            if (cancelled) return;
            setRouteEndpointAccessPaths(
                resolvedPaths.filter((path): path is RouteEndpointAccessPath => !!path)
            );
        });

        return () => {
            cancelled = true;
        };
    }, [
        travelMode,
        selectedAlternative,
        originName,
        originLat,
        originLng,
        destinationName,
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
        return undefined;
    }, [routePathCoords]);

    // 지도에 전달할 실제 polyline 목록.
    // inactive 대안 경로, 선택된 대중교통 ride/walk 세그먼트, fallback 메인 경로를 한곳에서 조합한다.
    const mapPathOverlays = useMemo((): TmapPathOverlay[] => {
        if (isRouteQaBaseOnly) return [];
        if (!hasRouteReady) return [];

        const transitWalkGuide = getTransitWalkGuidePresentation(mapZoom);
        const fallbackPathCoords: TmapLatLng[] = [];
        const selectedRoute = routeAlternatives.find((option) => option.id === selectedAlternativeId);
        const shouldUseTransitLegOverlays = (
            travelMode === "TRANSIT" &&
            selectedRoute &&
            Array.isArray(selectedRoute.transitLegs) &&
            selectedRoute.transitLegs.length > 0
        );
        const trafficSectionOverlays: TmapPathOverlay[] = travelMode === "CAR" && selectedRoute?.trafficSections
            ? selectedRoute.trafficSections.flatMap((section, index) => {
                if (!Array.isArray(section.pathCoords) || section.pathCoords.length < 2) return [];
                const color = section.level === "smooth"
                    ? "#18A957"
                    : section.level === "slow"
                        ? "#F5A623"
                        : section.level === "congested"
                            ? "#E5484D"
                            : "#2979FF";
                return [{
                    id: `${selectedRoute.id}-traffic-${index}`,
                    coords: section.pathCoords.map((coord) => ({ latitude: coord.lat, longitude: coord.lng })),
                    color,
                    width: getDriveWidth(mapZoom),
                    opacity: ROUTE_LINE_STYLE.drive.opacity,
                    outlineColor: ROUTE_LINE_STYLE.drive.casingColor,
                    outlineWidth: getDriveOutlineWidth(mapZoom),
                    outlineOpacity: ROUTE_LINE_STYLE.drive.casingOpacity,
                    strokeStyle: "solid",
                    renderMode: "native",
                    nativeDirection: ROUTE_LINE_STYLE.drive.arrows,
                    nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                    nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                    zIndex: 35 + index,
                } as TmapPathOverlay];
            })
            : [];
        const endpointAccessOverlays = buildRouteEndpointAccessOverlays(
            routeEndpointAccessPaths,
            mapZoom,
            shouldRenderTransitDetailDark
        );
        const routeInfoStepOverlays = buildRouteInfoPathOverlays(selectedRouteInfo, mapZoom);
        const hasSelectedMainPath = Array.isArray(selectedRoute?.pathCoords) && selectedRoute.pathCoords.length >= 2;
        const hasRenderableNormalizedTransitRoute = travelMode === "TRANSIT" &&
            selectedNormalizedRoute?.segments.some((segment) => (
                getSegmentRenderableCoordinates(segment).length >= 2
            )) === true;
        const useRouteInfoStepOverlays = shouldUseRouteInfoStepOverlays({
            routeMode: travelMode,
            routeInfoOverlayCount: routeInfoStepOverlays.length,
            hasTransitLegOverlays: !!shouldUseTransitLegOverlays,
            hasSelectedMainPath,
            hasRenderableNormalizedTransitRoute,
        });
        if (useRouteInfoStepOverlays) {
            return [...endpointAccessOverlays, ...routeInfoStepOverlays, ...trafficSectionOverlays];
        }

        if (
            travelMode === "TRANSIT" &&
            selectedNormalizedRoute &&
            selectedNormalizedRoute.segments.length > 0
        ) {
            const segmentLineOverlays = selectedNormalizedRoute.segments
                .flatMap((segment) => {
                    const overlays = RouteSegmentLayers(segment, mapZoom, true);
                    if (overlays.length === 0) return [];
                    const ownedOverlays = applyFocusedTransitRideOverlayOwnership(overlays, {
                        mode: segment.mode,
                        zoom: mapZoom,
                        focused: segment.sequence === focusedTransitLegIndex,
                        directionEnabled: shouldUseNativeTransitDirection(segment),
                        directionColor: ROUTE_LINE_STYLE.arrows.color,
                    });
                    if (
                        qaLayerMode === "CONNECTOR_DEBUG" &&
                        isWalkTransferSegment(segment)
                    ) {
                        const isFallback = segment.geometrySource === "START_END_ONLY" ||
                            segment.geometryQuality === "START_END_ONLY" ||
                            segment.geometryQuality === "GEOMETRY_MISMATCH";
                        const isAnchorAdjusted = segment.geometryQuality === "ANCHOR_ADJUSTED_GEOMETRY";
                        const debugColor = isFallback
                            ? "#FF3B30"
                            : (isAnchorAdjusted ? "#FF9500" : ROUTE_WALK_GUIDE_COLOR);
                        return ownedOverlays.map((item) => ({
                            ...item,
                            color: debugColor,
                            dotColor: item.renderMode === "screen" ? debugColor : item.dotColor,
                            supportLineColor: item.renderMode === "screen"
                                ? (isFallback ? "rgba(255,59,48,0.24)" : "rgba(255,149,0,0.22)")
                                : item.supportLineColor,
                            opacity: item.renderMode === "screen" ? 1 : (isFallback ? 0.86 : 0.72),
                            width: item.renderMode === "screen"
                                ? item.width
                                : Math.max(1.4, item.width ?? ROUTE_STYLE.connectorWalkWidth),
                            dashPattern: item.renderMode === "screen" ? undefined : (isFallback ? [2, 7] : [2, 9]),
                            zIndex: 210 + segment.sequence + (item.renderMode === "screen" ? 5 : 0),
                        } as TmapPathOverlay));
                    }
                    return ownedOverlays;
                })
                .filter((overlay): overlay is TmapPathOverlay => overlay !== null);
            const stopAccessLinkOverlays = buildTransitStopAccessLinkOverlays(
                selectedNormalizedRoute,
                mapZoom
            );
            const boundaryConnectorOverlays = transitConnectorOverlays
                .filter((overlay) => (
                    overlay.id.endsWith("-path") &&
                    Array.isArray(overlay.coords) &&
                    overlay.coords.length >= 2
                ))
                .map((overlay, index): TmapPathOverlay => ({
                    id: `selected-connector-${overlay.id}`,
                    coords: overlay.coords,
                    color: ROUTE_WALK_GUIDE_COLOR,
                    width: getWalkWidth(mapZoom),
                    opacity: ROUTE_LINE_STYLE.walk.opacity,
                    outlineColor: ROUTE_WALK_CASING_COLOR,
                    outlineWidth: getWalkOutlineWidth(mapZoom),
                    outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                    dashPattern: [...transitWalkGuide.dashPattern],
                    strokeStyle: transitWalkGuide.strokeStyle,
                    outlineStrokeStyle: transitWalkGuide.outlineStrokeStyle,
                    renderMode: "native",
                    zIndex: 32 + Math.min(index, 9) * 0.1,
                }));
            const anchorDebugOverlays = qaLayerMode === "ANCHOR_DEBUG"
                ? buildAnchorDebugPathOverlays(selectedNormalizedRoute)
                : [];
            return [
                ...boundaryConnectorOverlays,
                ...stopAccessLinkOverlays,
                ...segmentLineOverlays,
                ...anchorDebugOverlays,
            ];
        }

        const shouldShowDetailedTransitSegments =
            travelMode === "TRANSIT" && mapZoom >= TRANSIT_SEGMENT_RENDER_MIN_ZOOM;
        const shouldEmphasizeMainTransitBaseLine = mapZoom < 15.3;
        const walkOverlayById = new Map(
            transitWalkDetailOverlays.map((overlay) => [overlay.id, overlay.coords])
        );
        const selectedTransitBaseOverlays = (
            travelMode === "TRANSIT" &&
            shouldShowDetailedTransitSegments &&
            selectedRoute &&
            Array.isArray(selectedRoute.transitLegs)
        )
            ? selectedRoute.transitLegs.flatMap((leg, index) => {
                if (leg.kind === "WALK") return [];
                const legCoords = getTransitLegMapCoords(
                    selectedRoute.id,
                    selectedRoute.transitLegs,
                    index,
                    walkOverlayById
                );
                if (legCoords.length < 2) return [];
                const color = getMapTransitLegVisualColor(leg);
                return [{
                    id: `${selectedRoute.id}-segment-base-${index}`,
                    coords: legCoords,
                    color,
                    width: getTransitMainWidth(mapZoom),
                    outlineColor: ROUTE_LINE_STYLE.transit.casingColor,
                    outlineWidth: (getTransitCasingWidth(mapZoom) - getTransitMainWidth(mapZoom)) / 2,
                    outlineOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
                    renderMode: "native",
                    strokeStyle: "solid",
                    // 정규화 fallback도 본선 하나에 SDK native direction을 직접 적용한다.
                    nativeDirection: isRideLegKind(leg.kind) &&
                        index !== focusedTransitLegIndex &&
                        ENABLE_NATIVE_ROUTE_DIRECTION &&
                        mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
                    nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                    nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                    zIndex: 40 + Math.min(index, 9) * 0.1,
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
                    color: ROUTE_WALK_GUIDE_COLOR,
                    width: getWalkWidth(mapZoom),
                    opacity: ROUTE_WALK_GUIDE_OPACITY,
                    outlineColor: ROUTE_WALK_CASING_COLOR,
                    outlineWidth: getWalkOutlineWidth(mapZoom),
                    outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                    dashPattern: [...transitWalkGuide.dashPattern],
                    strokeStyle: transitWalkGuide.strokeStyle,
                    outlineStrokeStyle: transitWalkGuide.outlineStrokeStyle,
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
                .map((overlay, index) => {
                    const isConnectorDebug = qaLayerMode === "CONNECTOR_DEBUG" &&
                        transitConnectorOverlays.some((connectorOverlay) => connectorOverlay.id === overlay.id);
                    const isFallbackDebug = qaLayerMode === "CONNECTOR_DEBUG" &&
                        overlay.id.includes("-walk-fallback-");
                    return {
                        id: `selected-walk-${index}-${overlay.id}`,
                        coords: overlay.coords,
                        color: isConnectorDebug
                            ? "#FF9500"
                            : isFallbackDebug
                                ? "#FF3B30"
                                : ROUTE_WALK_GUIDE_COLOR,
                        width: isConnectorDebug || isFallbackDebug ? 2.4 : getWalkWidth(mapZoom),
                        opacity: isConnectorDebug || isFallbackDebug ? 0.9 : ROUTE_LINE_STYLE.walk.opacity,
                        outlineColor: ROUTE_WALK_CASING_COLOR,
                        outlineWidth: getWalkOutlineWidth(mapZoom),
                        outlineOpacity: ROUTE_WALK_CASING_OPACITY,
                        dashPattern: [...transitWalkGuide.dashPattern],
                        strokeStyle: transitWalkGuide.strokeStyle,
                        outlineStrokeStyle: transitWalkGuide.outlineStrokeStyle,
                        renderMode: "native",
                        // 승차 본선(40+)이 환승 접합부를 덮어 점선이 본선을 자르지 않게 한다.
                        zIndex: 30 + Math.min(index, 9) * 0.1,
                    } as TmapPathOverlay;
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
                const focusedIsWalk = focusedLeg.kind === "WALK";
                const focusedColor = focusedIsWalk
                    ? ROUTE_WALK_GUIDE_COLOR
                    : getMapTransitLegVisualColor(focusedLeg);
                const focusedIsRide = isRideLegKind(focusedLeg.kind);
                return {
                    id: `${selectedRoute.id}-focused-leg-${focusedTransitLegIndex}`,
                    coords: focusedCoords,
                    color: focusedColor,
                    width: focusedIsWalk
                        ? getWalkWidth(mapZoom) + 0.4
                        : getTransitMainWidth(mapZoom) + 0.4,
                    opacity: focusedIsWalk ? ROUTE_LINE_STYLE.walk.opacity : 1,
                    outlineColor: focusedIsWalk
                        ? ROUTE_WALK_CASING_COLOR
                        : (shouldRenderTransitDetailDark ? "rgba(5,10,20,0.08)" : "rgba(255,255,255,0.18)"),
                    outlineWidth: focusedIsWalk
                        ? getWalkOutlineWidth(mapZoom)
                        : (getTransitCasingWidth(mapZoom) - getTransitMainWidth(mapZoom)) / 2,
                    outlineOpacity: focusedIsWalk ? ROUTE_WALK_CASING_OPACITY : undefined,
                    renderMode: "native",
                    dashPattern: focusedIsWalk
                        ? [...transitWalkGuide.dashPattern]
                        : undefined,
                    strokeStyle: focusedIsWalk ? transitWalkGuide.strokeStyle : "solid",
                    outlineStrokeStyle: focusedIsWalk
                        ? transitWalkGuide.outlineStrokeStyle
                        : "solid",
                    // 포커스 강조선이 기본 본선을 덮어도 진행 방향이 사라지지 않게 유지한다.
                    nativeDirection: focusedIsRide &&
                        ENABLE_NATIVE_ROUTE_DIRECTION &&
                        mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
                    nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                    nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                    zIndex: 90,
                } as TmapPathOverlay;
            })()
            : null;
        const selectedMainOverlay = selectedRoute
            ? (() => {
                const isWalkRoute = selectedRoute.mode === "WALK";
                const isBikeRoute = selectedRoute.mode === "BIKE";
                const isDriveRoute = selectedRoute.mode === "CAR" || selectedRoute.mode === "ETC";
                const hasDetailedTransitOverlay = selectedTransitBaseOverlays.length > 0;
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
                    color: isWalkRoute
                        ? ROUTE_WALK_GUIDE_COLOR
                        : isBikeRoute
                            ? ROUTE_LINE_STYLE.bike.color
                            : hasDetailedTransitOverlay
                                ? (shouldEmphasizeMainTransitBaseLine
                                    ? "rgba(180, 193, 211, 0.32)"
                                    : "rgba(180, 193, 211, 0.12)")
                                : ROUTE_LINE_STYLE.drive.color,
                    width: isWalkRoute
                        ? getWalkWidth(mapZoom)
                        : isBikeRoute
                            ? getBikeWidth(mapZoom)
                            : hasDetailedTransitOverlay
                                // 상세 줌에서는 메인 fallback 라인을 약하게 낮춰
                                // 도보 점선/대중교통 색상 세그먼트가 더 먼저 읽히게 한다.
                                ? (shouldEmphasizeMainTransitBaseLine
                                    ? Math.max(ROUTE_STYLE.transitWalkWidth, 2.8)
                                    : 1.8)
                                : getDriveWidth(mapZoom),
                    opacity: isWalkRoute
                        ? ROUTE_LINE_STYLE.walk.opacity
                        : isBikeRoute
                            ? ROUTE_LINE_STYLE.bike.opacity
                            : 1,
                    outlineColor: isWalkRoute
                        ? ROUTE_WALK_CASING_COLOR
                        : isBikeRoute
                            ? ROUTE_LINE_STYLE.bike.casingColor
                            : hasDetailedTransitOverlay
                                ? (shouldEmphasizeMainTransitBaseLine
                                    ? (shouldRenderTransitDetailDark
                                        ? "rgba(15,20,35,0.20)"
                                        : "rgba(255,255,255,0.28)")
                                    : (shouldRenderTransitDetailDark
                                        ? "rgba(15,20,35,0.12)"
                                        : "rgba(255,255,255,0.12)"))
                                : ROUTE_LINE_STYLE.drive.casingColor,
                    outlineWidth: isWalkRoute
                        ? getWalkOutlineWidth(mapZoom)
                        : isBikeRoute
                            ? getBikeOutlineWidth(mapZoom)
                            : hasDetailedTransitOverlay
                                ? (shouldEmphasizeMainTransitBaseLine ? 0.5 : 0)
                                : getDriveOutlineWidth(mapZoom),
                    outlineOpacity: isWalkRoute
                        ? ROUTE_WALK_CASING_OPACITY
                        : isBikeRoute
                            ? ROUTE_LINE_STYLE.bike.casingOpacity
                            : isDriveRoute
                                ? ROUTE_LINE_STYLE.drive.casingOpacity
                                : undefined,
                    dashPattern: isWalkRoute ? [...transitWalkGuide.dashPattern] : undefined,
                    strokeStyle: isWalkRoute ? transitWalkGuide.strokeStyle : "solid",
                    outlineStrokeStyle: isWalkRoute ? transitWalkGuide.outlineStrokeStyle : "solid",
                    renderMode: "native",
                    // 교통정보 구간이 있으면 하부 본선은 끊김만 메우고 화살표는 상부 구간에 한 번만 그린다.
                    nativeDirection: (
                        (isBikeRoute || (isDriveRoute && trafficSectionOverlays.length === 0)) &&
                        ENABLE_NATIVE_ROUTE_DIRECTION
                    ),
                    nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                    nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                } as TmapPathOverlay;
            })()
            : null;

        if (
            selectedTransitBaseOverlays.length > 0 ||
            selectedTransitWalkOverlays.length > 0
        ) {
            const overlays: TmapPathOverlay[] = [];
            if (selectedTransitBaseOverlays.length > 0) {
                overlays.push(...selectedTransitBaseOverlays);
            }
            overlays.push(...selectedTransitWalkOverlays);
            if (focusedTransitLegOverlay) {
                overlays.push(focusedTransitLegOverlay);
            }
            if (qaLayerMode === "ANCHOR_DEBUG") {
                overlays.push(...buildAnchorDebugPathOverlays(selectedNormalizedRoute));
            }
            return overlays;
        }

        if (!selectedMainOverlay) {
            if (pathOverlayCoords && pathOverlayCoords.length >= 2) {
                const isFallbackWalk = travelMode === "WALK";
                const isFallbackBike = travelMode === "BIKE";
                const isFallbackDrive = travelMode === "CAR";
                const overlays: TmapPathOverlay[] = [{
                    id: "route-selected-fallback",
                    coords: pathOverlayCoords,
                    color: isFallbackWalk
                        ? ROUTE_WALK_GUIDE_COLOR
                        : isFallbackBike
                            ? ROUTE_LINE_STYLE.bike.color
                            : ROUTE_LINE_STYLE.drive.color,
                    width: isFallbackWalk
                        ? getWalkWidth(mapZoom)
                        : isFallbackBike
                            ? getBikeWidth(mapZoom)
                            : getDriveWidth(mapZoom),
                    opacity: isFallbackWalk
                        ? ROUTE_LINE_STYLE.walk.opacity
                        : isFallbackBike
                            ? ROUTE_LINE_STYLE.bike.opacity
                            : 1,
                    outlineColor: isFallbackWalk
                        ? ROUTE_WALK_CASING_COLOR
                        : isFallbackBike
                            ? ROUTE_LINE_STYLE.bike.casingColor
                            : ROUTE_LINE_STYLE.drive.casingColor,
                    outlineWidth: isFallbackWalk
                        ? getWalkOutlineWidth(mapZoom)
                        : isFallbackBike
                            ? getBikeOutlineWidth(mapZoom)
                            : getDriveOutlineWidth(mapZoom),
                    outlineOpacity: isFallbackWalk
                        ? ROUTE_WALK_CASING_OPACITY
                        : isFallbackBike
                            ? ROUTE_LINE_STYLE.bike.casingOpacity
                            : ROUTE_LINE_STYLE.drive.casingOpacity,
                    dashPattern: isFallbackWalk ? [...transitWalkGuide.dashPattern] : undefined,
                    strokeStyle: isFallbackWalk ? transitWalkGuide.strokeStyle : "solid",
                    outlineStrokeStyle: isFallbackWalk ? transitWalkGuide.outlineStrokeStyle : "solid",
                    renderMode: "native",
                    nativeDirection: (isFallbackDrive || isFallbackBike) && ENABLE_NATIVE_ROUTE_DIRECTION,
                    nativeDirectionColor: ROUTE_LINE_STYLE.arrows.color,
                    nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
                }];
                if (focusedTransitLegOverlay) {
                    overlays.push(focusedTransitLegOverlay);
                }
                return [...endpointAccessOverlays, ...overlays, ...trafficSectionOverlays];
            }
            return focusedTransitLegOverlay
                ? [...endpointAccessOverlays, focusedTransitLegOverlay]
                : endpointAccessOverlays;
        }

        return focusedTransitLegOverlay
            ? [...endpointAccessOverlays, selectedMainOverlay, ...trafficSectionOverlays, focusedTransitLegOverlay]
            : [...endpointAccessOverlays, selectedMainOverlay, ...trafficSectionOverlays];
    }, [
        hasRouteReady,
        routeAlternatives,
        selectedAlternativeId,
        pathOverlayCoords,
        travelMode,
        mapZoom,
        selectedNormalizedRoute,
        transitConnectorOverlays,
        transitWalkDetailOverlays,
        routeEndpointAccessPaths,
        focusedTransitLegIndex,
        selectedRouteInfo,
        shouldRenderTransitDetailDark,
        isRouteQaBaseOnly,
        qaLayerMode,
    ]);

    const themedMapPathOverlays = useMemo(() => {
        if (!shouldRenderTransitDetailDark) return mapPathOverlays;
        return mapPathOverlays.map((overlay) => (
            applyTransitRouteThemeToOverlay(overlay, mapZoom, "dark")
        ));
    }, [mapPathOverlays, mapZoom, shouldRenderTransitDetailDark]);

    const routeCoordinatesForLog = useMemo(() => {
        if (selectedNormalizedRoute?.segments.length) {
            return selectedNormalizedRoute.segments.flatMap((segment) => segment.coordinates);
        }
        const primaryOverlay = mapPathOverlays.find((overlay) => (
            overlay.id.endsWith("-selected") ||
            overlay.id === "route-selected-fallback"
        ));
        return primaryOverlay?.coords ?? pathOverlayCoords ?? [];
    }, [mapPathOverlays, pathOverlayCoords, selectedNormalizedRoute]);
    const lastRouteLogSignatureRef = useRef("");
    const lastRouteSegmentLogSignatureRef = useRef("");
    const lastRouteArrowLogSignatureRef = useRef("");
    const lastRouteSheetSyncLogSignatureRef = useRef("");
    const lastRouteRendererLogSignatureRef = useRef("");
    const lastRouteGeometryQualityLogSignatureRef = useRef("");
    const lastRoutePathOrderLogSignatureRef = useRef("");
    const lastRouteStopAnchorLogSignatureRef = useRef("");
    const lastRouteQaLayerLogSignatureRef = useRef("");
    const lastWalkRenderPartsLogSignatureRef = useRef("");

    const selectedRouteArrowStats = useMemo(() => {
        if (!selectedNormalizedRoute?.segments?.length) return [];
        const nativeDirectionPolylineIds = new Set(
            mapPathOverlays
                .filter((overlay) => overlay.nativeDirection === true)
                .map((overlay) => overlay.id)
        );
        return selectedNormalizedRoute.segments.map((segment) => ({
            id: segment.id,
            mode: segment.mode,
            lineName: segment.lineName,
            busType: segment.busType,
            routeColor: segment.routeColor,
            displayColor: segment.displayColor,
            geometrySource: segment.geometrySource,
            geometryQuality: segment.geometryQuality,
            isManualSamplePath: segment.isManualSamplePath === true,
            boardSnapDistanceMeters: typeof segment.boardAnchor?.snapDistanceMeters === "number"
                ? Math.round(segment.boardAnchor.snapDistanceMeters)
                : undefined,
            boardAnchorSource: segment.boardAnchor?.anchorSource,
            alightSnapDistanceMeters: typeof segment.alightAnchor?.snapDistanceMeters === "number"
                ? Math.round(segment.alightAnchor.snapDistanceMeters)
                : undefined,
            alightAnchorSource: segment.alightAnchor?.anchorSource,
            pointCount: segment.coordinates?.length ?? 0,
            rawPointCount: segment.rawPointCount,
            renderPointCount: segment.renderPointCount ?? segment.renderedCoordinates?.length ?? segment.coordinates?.length ?? 0,
            renderedPointCount: segment.renderPointCount ?? segment.renderedCoordinates?.length ?? segment.coordinates?.length ?? 0,
            lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
            color: getSegmentColor(segment),
            nativeDirectionEnabled: shouldRenderNativeTransitDirection(segment, mapZoom),
            screenOverlayArrowFallbackEnabled: false,
            directionRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
                ? "tmap-native-polyline-direction"
                : "none",
            pathOrderValid: validateSegmentPathOrder(segment),
            showArrows: shouldRenderNativeTransitDirection(segment, mapZoom),
            nativeDirectionPolylineCount: nativeDirectionPolylineIds.has(segment.id) ? 1 : 0,
            mainWidth: segment.mode === "BUS" || segment.mode === "SUBWAY"
                ? getTransitMainWidth(mapZoom)
                : getWalkWidth(mapZoom),
            casingWidth: segment.mode === "BUS" || segment.mode === "SUBWAY"
                ? getTransitCasingWidth(mapZoom)
                : undefined,
        }));
    }, [mapPathOverlays, mapZoom, selectedNormalizedRoute]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        const routeCoordinates = routeCoordinatesForLog;
        const currentZoom = mapZoom;
        const firstCoordinate = routeCoordinates[0];
        const lastCoordinate = routeCoordinates[routeCoordinates.length - 1];
        const routeLogSignature = JSON.stringify({
            length: routeCoordinates.length,
            first: firstCoordinate,
            last: lastCoordinate,
            zoom: currentZoom,
        });
        if (lastRouteLogSignatureRef.current === routeLogSignature) return;
        lastRouteLogSignatureRef.current = routeLogSignature;

        console.log("[route] coordinates length:", routeCoordinates.length);
        console.log("[route] first coordinate:", firstCoordinate);
        console.log("[route] last coordinate:", lastCoordinate);
        console.log("[route] zoom:", currentZoom);
    }, [mapZoom, routeCoordinatesForLog]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
        const table = selectedNormalizedRoute?.segments?.map((segment) => ({
            id: segment.id,
            mode: segment.mode,
            lineName: segment.lineName,
            busType: segment.busType,
            routeColor: segment.routeColor,
            displayColor: segment.displayColor,
            geometrySource: segment.geometrySource,
            geometryQuality: segment.geometryQuality,
            isManualSamplePath: segment.isManualSamplePath === true,
            rawCoordinateCount: segment.rawCoordinates?.length ?? segment.rawPointCount,
            boardSnapDistanceMeters: typeof segment.boardAnchor?.snapDistanceMeters === "number"
                ? Math.round(segment.boardAnchor.snapDistanceMeters)
                : undefined,
            boardAnchorSource: segment.boardAnchor?.anchorSource,
            boardRawCoordinate: segment.boardAnchor?.rawCoordinate,
            boardRenderCoordinate: segment.boardAnchor?.renderCoordinate,
            alightSnapDistanceMeters: typeof segment.alightAnchor?.snapDistanceMeters === "number"
                ? Math.round(segment.alightAnchor.snapDistanceMeters)
                : undefined,
            alightAnchorSource: segment.alightAnchor?.anchorSource,
            alightRawCoordinate: segment.alightAnchor?.rawCoordinate,
            alightRenderCoordinate: segment.alightAnchor?.renderCoordinate,
            startAnchorType: segment.startAnchor?.type,
            startAnchorSource: segment.startAnchor?.source,
            startSnapDistanceMeters: typeof segment.startAnchor?.snapDistanceMeters === "number"
                ? Math.round(segment.startAnchor.snapDistanceMeters)
                : undefined,
            endAnchorType: segment.endAnchor?.type,
            endAnchorSource: segment.endAnchor?.source,
            endSnapDistanceMeters: typeof segment.endAnchor?.snapDistanceMeters === "number"
                ? Math.round(segment.endAnchor.snapDistanceMeters)
                : undefined,
            pointCount: segment.coordinates?.length ?? 0,
            rawPointCount: segment.rawPointCount,
            renderPointCount: segment.renderPointCount ?? segment.renderedCoordinates?.length ?? segment.coordinates.length,
            renderedPointCount: segment.renderPointCount ?? segment.renderedCoordinates?.length ?? segment.coordinates.length,
            lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
            color: getSegmentColor(segment),
            nativeDirectionEnabled: shouldUseNativeTransitDirection(segment),
            screenOverlayArrowFallbackEnabled: false,
            directionRenderer: shouldUseNativeTransitDirection(segment)
                ? "tmap-native-polyline-direction"
                : "none",
            pathOrderValid: validateSegmentPathOrder(segment),
            showArrows: shouldUseNativeTransitDirection(segment),
            from: segment.fromName,
            to: segment.toName,
        })) ?? [];
        const busColorRows = selectedNormalizedRoute?.segments
            ?.filter((segment) => segment.mode === "BUS")
            .map((segment) => ({
                lineName: segment.lineName,
                routeColor: segment.routeColor,
                displayColor: segment.displayColor,
                busType: segment.busType,
            })) ?? [];
        const routeSegmentLogSignature = JSON.stringify({
            selectedRouteId: selectedNormalizedRoute?.id,
            candidates: routeAlternatives.length,
            segments: table,
            busColorRows,
        });
        if (lastRouteSegmentLogSignatureRef.current === routeSegmentLogSignature) return;
        lastRouteSegmentLogSignatureRef.current = routeSegmentLogSignature;

        console.log("[route-qa] selectedRouteId:", selectedNormalizedRoute?.id);
        console.log("[route-qa] route candidates:", routeAlternatives.length);
        console.log("[route-qa] selected segments:", selectedNormalizedRoute?.segments?.length);
        console.table(table);
        console.log("[route-qa] selected segment rows:", table);
        if (busColorRows.length > 0) {
            console.log("[route-bus-color] selectedRouteId:", selectedNormalizedRoute?.id);
            console.table(busColorRows);
            console.log("[route-bus-color] rows:", busColorRows);
        }
    }, [routeAlternatives.length, selectedNormalizedRoute]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
        const rows = selectedNormalizedRoute?.segments
            ?.filter((segment) => isTransitRideSegmentMode(segment.mode))
            .map((segment) => {
                const coordinates = getSegmentRenderableCoordinates(segment);
                const scores = getTransitPathOrderScores(coordinates, segment.boardAnchor, segment.alightAnchor);
                return {
                    id: segment.id,
                    mode: segment.mode,
                    lineName: segment.lineName,
                    fromName: segment.fromName,
                    toName: segment.toName,
                    pointCount: coordinates.length,
                    first: coordinates[0],
                    last: coordinates[coordinates.length - 1],
                    boardAnchor: getRenderableStopCoordinate(segment.boardAnchor),
                    alightAnchor: getRenderableStopCoordinate(segment.alightAnchor),
                    boardSnapDistanceMeters: typeof segment.boardAnchor?.snapDistanceMeters === "number"
                        ? Math.round(segment.boardAnchor.snapDistanceMeters)
                        : undefined,
                    alightSnapDistanceMeters: typeof segment.alightAnchor?.snapDistanceMeters === "number"
                        ? Math.round(segment.alightAnchor.snapDistanceMeters)
                        : undefined,
                    forwardScore: scores ? Math.round(scores.forwardScore) : undefined,
                    reverseScore: scores ? Math.round(scores.reverseScore) : undefined,
                    pathOrderValid: validateSegmentPathOrder(segment),
                    nativeDirectionEnabled: shouldUseNativeTransitDirection(segment),
                };
            }) ?? [];
        const pathOrderSignature = JSON.stringify({
            selectedRouteId: selectedNormalizedRoute?.id,
            rows,
        });
        if (lastRoutePathOrderLogSignatureRef.current === pathOrderSignature) return;
        lastRoutePathOrderLogSignatureRef.current = pathOrderSignature;

        console.log("[route-path-order] selectedRouteId:", selectedNormalizedRoute?.id);
        console.table(rows);
        console.log("[route-path-order] rows:", rows);
        rows.forEach((row) => {
            if (!row.pathOrderValid) {
                console.warn("[route-path-order] invalid path order", row);
            }
        });
    }, [routeAlternatives.length, selectedNormalizedRoute]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
        const rows = selectedNormalizedRoute?.segments
            ?.filter((segment) => isTransitRideSegmentMode(segment.mode))
            .flatMap((segment) => ([
                { role: "BOARD" as const, stopName: segment.fromName, anchor: segment.boardAnchor },
                { role: "ALIGHT" as const, stopName: segment.toName, anchor: segment.alightAnchor },
            ].filter((item) => !!item.anchor).map((item) => ({
                segmentId: segment.id,
                mode: segment.mode,
                lineName: segment.lineName,
                stopRole: item.role,
                stopName: item.stopName,
                rawCoordinate: item.anchor?.rawCoordinate,
                renderCoordinate: item.anchor?.renderCoordinate,
                stopCoordinate: item.anchor?.stopCoordinate,
                routeAnchorCoordinate: item.anchor?.routeAnchorCoordinate,
                snapDistanceMeters: typeof item.anchor?.snapDistanceMeters === "number"
                    ? Math.round(item.anchor.snapDistanceMeters)
                    : undefined,
                anchorSource: item.anchor?.anchorSource,
                withinPassThreshold: typeof item.anchor?.snapDistanceMeters === "number"
                    ? item.anchor.snapDistanceMeters <= 30
                    : false,
                warningThreshold: typeof item.anchor?.snapDistanceMeters === "number"
                    ? item.anchor.snapDistanceMeters > 30 && item.anchor.snapDistanceMeters <= 60
                    : false,
                mismatchWarning: typeof item.anchor?.snapDistanceMeters === "number"
                    ? item.anchor.snapDistanceMeters > 60 && item.anchor.snapDistanceMeters <= 80
                    : false,
                geometryMismatch: typeof item.anchor?.snapDistanceMeters === "number"
                    ? item.anchor.snapDistanceMeters > 80
                    : item.anchor?.anchorSource === "UNSNAPPED",
            })))) ?? [];
        const stopAnchorSignature = JSON.stringify({
            selectedRouteId: selectedNormalizedRoute?.id,
            rows,
        });
        if (lastRouteStopAnchorLogSignatureRef.current === stopAnchorSignature) return;
        lastRouteStopAnchorLogSignatureRef.current = stopAnchorSignature;

        console.log("[route-stop-anchor] selectedRouteId:", selectedNormalizedRoute?.id);
        console.table(rows);
        console.log("[route-stop-anchor] rows:", rows);
        rows.forEach((row) => {
            if (row.geometryMismatch) {
                console.warn("[route-stop-anchor] geometry mismatch", row);
            } else if (row.mismatchWarning) {
                console.warn("[route-stop-anchor] geometry mismatch warning", row);
            } else if (row.warningThreshold) {
                console.warn("[route-stop-anchor] snap warning", row);
            }
        });
    }, [routeAlternatives.length, selectedNormalizedRoute]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
        const arrowLogSignature = JSON.stringify({
            zoom: Math.round(mapZoom * 10) / 10,
            selectedRouteId: selectedNormalizedRoute?.id,
            rows: selectedRouteArrowStats,
        });
        if (lastRouteArrowLogSignatureRef.current === arrowLogSignature) return;
        lastRouteArrowLogSignatureRef.current = arrowLogSignature;

        console.log("[route-qa] zoom:", mapZoom);
        console.log("[route-qa] zoomBucket:", getTransitMapZoomTier(mapZoom));
        console.log("[route-arrows] selectedRouteId:", selectedNormalizedRoute?.id);
        console.table(selectedRouteArrowStats);
        console.log("[route-arrows] rows:", selectedRouteArrowStats);
        const subwayRows = selectedRouteArrowStats.filter((row) => row.mode === "SUBWAY");
        if (subwayRows.length > 0) {
            console.table(subwayRows);
            console.log("[route-subway-qa] rows:", subwayRows);
        }
        const busRows = selectedRouteArrowStats.filter((row) => row.mode === "BUS");
        if (busRows.length > 0) {
            console.table(busRows);
            console.log("[route-bus-qa] rows:", busRows);
        }
        console.log("[route-style]", {
            transitMainWidth: getTransitMainWidth(mapZoom),
            transitCasingWidth: getTransitCasingWidth(mapZoom),
            transitCasingExtraWidth: getTransitCasingExtraWidth(mapZoom),
            transitCasingOpacity: ROUTE_LINE_STYLE.transit.casingOpacity,
            walkColor: ROUTE_LINE_STYLE.walk.color,
            walkWidth: getWalkWidth(mapZoom),
            walkCasingWidth: getWalkCasingWidth(mapZoom),
            walkCasingOpacity: ROUTE_WALK_CASING_OPACITY,
            walkDashPattern: ROUTE_LINE_STYLE.walk.dashPattern,
            nativeDirectionEnabled: ENABLE_NATIVE_ROUTE_DIRECTION && mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
            nativeDirectionMinZoom: TRANSIT_NATIVE_DIRECTION_MIN_ZOOM,
            screenOverlayArrowFallbackEnabled: false,
            directionRenderer: ENABLE_NATIVE_ROUTE_DIRECTION && mapZoom >= TRANSIT_NATIVE_DIRECTION_MIN_ZOOM
                ? "tmap-native-polyline-direction"
                : "none",
            nativeDirectionPolylineWidth: getNativeDirectionCarrierWidth(mapZoom),
            nativeDirectionOpacity: getNativeDirectionOpacity(mapZoom),
            nativeDirectionViewportCenter: mapCamera,
            nativeDirectionOverlayCount: selectedRouteArrowStats.reduce(
                (total, row) => total + row.nativeDirectionPolylineCount,
                0
            ),
        });
    }, [mapCamera, mapZoom, routeAlternatives.length, selectedNormalizedRoute, selectedRouteArrowStats]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
        const allRows = selectedNormalizedRoute?.segments
            ?.map((segment) => ({
                id: segment.id,
                mode: segment.mode,
                lineName: segment.lineName,
                routeColor: segment.routeColor,
                displayColor: segment.displayColor,
                geometrySource: segment.geometrySource,
                geometryQuality: segment.geometryQuality,
                isManualSamplePath: segment.isManualSamplePath === true,
                rawCoordinateCount: segment.rawCoordinates?.length ?? segment.rawPointCount,
                pointCount: segment.coordinates?.length ?? 0,
                renderedPointCount: segment.renderedCoordinates?.length ?? segment.coordinates?.length ?? 0,
                lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
                startAnchorType: segment.startAnchor?.type,
                startAnchorSource: segment.startAnchor?.source,
                startSnapDistanceMeters: typeof segment.startAnchor?.snapDistanceMeters === "number"
                    ? Math.round(segment.startAnchor.snapDistanceMeters)
                    : undefined,
                endAnchorType: segment.endAnchor?.type,
                endAnchorSource: segment.endAnchor?.source,
                endSnapDistanceMeters: typeof segment.endAnchor?.snapDistanceMeters === "number"
                    ? Math.round(segment.endAnchor.snapDistanceMeters)
                    : undefined,
                renderedInMap: shouldRenderRouteSegmentGeometry(segment),
            })) ?? [];
        const walkRows = selectedNormalizedRoute?.segments
            ?.filter((segment) => segment.mode === "WALK" || segment.mode === "TRANSFER")
            .map((segment) => ({
                id: segment.id,
                mode: segment.mode,
                geometrySource: segment.geometrySource,
                geometryQuality: segment.geometryQuality,
                rawCoordinateCount: segment.rawCoordinates?.length ?? segment.rawPointCount,
                pointCount: segment.coordinates?.length ?? 0,
                renderedPointCount: segment.renderedCoordinates?.length ?? segment.coordinates?.length ?? 0,
                lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
                isDirectFallback: segment.geometrySource === "START_END_ONLY",
                startAnchorSource: segment.startAnchor?.source,
                startSnapDistanceMeters: typeof segment.startAnchor?.snapDistanceMeters === "number"
                    ? Math.round(segment.startAnchor.snapDistanceMeters)
                    : undefined,
                endAnchorSource: segment.endAnchor?.source,
                endSnapDistanceMeters: typeof segment.endAnchor?.snapDistanceMeters === "number"
                    ? Math.round(segment.endAnchor.snapDistanceMeters)
                    : undefined,
                snapEndpointMeters: TRANSIT_WALK_RIDE_SNAP_MAX_METERS,
                maxDirectConnectorMeters: TRANSIT_WALK_RIDE_CONNECTOR_MAX_METERS,
                renderedInMap: shouldRenderRouteSegmentGeometry(segment),
            })) ?? [];
        const busRows = selectedNormalizedRoute?.segments
            ?.filter((segment) => segment.mode === "BUS")
            .map((segment) => ({
                id: segment.id,
                lineName: segment.lineName,
                busType: segment.busType,
                routeColor: segment.routeColor,
                displayColor: segment.displayColor,
                geometrySource: segment.geometrySource,
                geometryQuality: segment.geometryQuality,
                isManualSamplePath: segment.isManualSamplePath === true,
                rawCoordinateCount: segment.rawCoordinates?.length ?? segment.rawPointCount,
                pointCount: segment.coordinates?.length ?? 0,
                renderedPointCount: segment.renderedCoordinates?.length ?? segment.coordinates?.length ?? 0,
                lengthMeters: Math.round(getSegmentLengthMeters(segment.coordinates)),
                color: getSegmentColor(segment),
                nativeDirectionEnabled: shouldRenderNativeTransitDirection(segment, mapZoom),
                directionRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
                    ? "tmap-native-polyline-direction"
                    : "none",
                showArrows: shouldRenderNativeTransitDirection(segment, mapZoom),
                boardSnapDistanceMeters: typeof segment.boardAnchor?.snapDistanceMeters === "number"
                    ? Math.round(segment.boardAnchor.snapDistanceMeters)
                    : undefined,
                boardAnchorSource: segment.boardAnchor?.anchorSource,
                boardRawCoordinate: segment.boardAnchor?.rawCoordinate,
                boardRenderCoordinate: segment.boardAnchor?.renderCoordinate,
                alightSnapDistanceMeters: typeof segment.alightAnchor?.snapDistanceMeters === "number"
                    ? Math.round(segment.alightAnchor.snapDistanceMeters)
                    : undefined,
                alightAnchorSource: segment.alightAnchor?.anchorSource,
                alightRawCoordinate: segment.alightAnchor?.rawCoordinate,
                alightRenderCoordinate: segment.alightAnchor?.renderCoordinate,
                renderedInMap: shouldRenderRouteSegmentGeometry(segment),
            })) ?? [];
        const geometryLogSignature = JSON.stringify({
            selectedRouteId: selectedNormalizedRoute?.id,
            zoom: Math.round(mapZoom * 10) / 10,
            allRows,
            walkRows,
            busRows,
        });
        if (lastRouteGeometryQualityLogSignatureRef.current === geometryLogSignature) return;
        lastRouteGeometryQualityLogSignatureRef.current = geometryLogSignature;

        console.log("[route-geometry-quality] selectedRouteId:", selectedNormalizedRoute?.id);
        if (allRows.length > 0) {
            console.table(allRows);
            console.log("[route-geometry-source] rows:", allRows);
        }
        if (walkRows.length > 0) {
            console.table(walkRows);
            console.log("[route-walk-geometry] rows:", walkRows);
        }
        if (busRows.length > 0) {
            console.table(busRows);
            console.log("[route-bus-geometry] rows:", busRows);
        }
        busRows.forEach((row) => {
            if (row.isManualSamplePath || row.geometryQuality === "MANUAL_SAMPLE") {
                console.warn("[route-bus-geometry] manual sample path is renderer-only", row);
            }
            if (row.geometryQuality === "PASS_STOP_ONLY" || row.geometrySource === "PASS_STOP_LIST") {
                console.warn("[route-bus-geometry] pass-stop-only geometry is incomplete", row);
            }
            if (
                (typeof row.boardSnapDistanceMeters === "number" && row.boardSnapDistanceMeters > 30) ||
                (typeof row.alightSnapDistanceMeters === "number" && row.alightSnapDistanceMeters > 30)
            ) {
                console.warn("[route-bus-geometry] stop anchor snap warning", row);
            }
        });
        walkRows.forEach((row) => {
            if (row.isDirectFallback && row.lengthMeters > 40) {
                console.warn("[route-walk-geometry] long direct fallback hidden/incomplete", row);
            }
        });
    }, [mapZoom, routeAlternatives.length, selectedNormalizedRoute]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (routeAlternatives.length > 0 && !selectedNormalizedRoute) return;
        const actualZoom = Math.round(mapZoom * 10) / 10;
        const rows = selectedNormalizedRoute?.segments.map((segment) => ({
            segmentId: segment.id,
            mode: segment.mode,
            lineName: segment.lineName,
            routeColor: segment.routeColor,
            displayColor: segment.displayColor,
            geometrySource: segment.geometrySource,
            geometryQuality: segment.geometryQuality,
            isManualSamplePath: segment.isManualSamplePath === true,
            pointCount: segment.coordinates?.length ?? 0,
            renderedPointCount: segment.renderPointCount ?? segment.renderedCoordinates?.length ?? segment.coordinates.length,
            mainRenderer: "geo-map-overlay",
            casingRenderer: segment.mode === "BUS" || segment.mode === "SUBWAY" || isWalkTransferSegment(segment)
                ? "geo-map-overlay"
                : "none",
            directionRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
                ? "tmap-native-polyline-direction"
                : "none",
            arrowRenderer: shouldRenderNativeTransitDirection(segment, mapZoom)
                ? "tmap-native-polyline-direction"
                : "none",
            nativeDirectionEnabled: shouldRenderNativeTransitDirection(segment, mapZoom),
            screenOverlayArrowFallbackEnabled: false,
            isCameraMoving: "webview-controlled",
            actualZoom,
            projectionVersion: "webview-route-overlay-state",
            lineWidth: segment.mode === "BUS" || segment.mode === "SUBWAY"
                ? getTransitMainWidth(mapZoom)
                : getWalkWidth(mapZoom),
            transitMainWidth: segment.mode === "BUS" || segment.mode === "SUBWAY"
                ? getTransitMainWidth(mapZoom)
                : undefined,
            casingWidth: segment.mode === "BUS" || segment.mode === "SUBWAY"
                ? getTransitCasingWidth(mapZoom)
                : isWalkTransferSegment(segment)
                    ? getWalkCasingWidth(mapZoom)
                    : undefined,
            transitCasingExtraWidth: segment.mode === "BUS" || segment.mode === "SUBWAY"
                ? getTransitCasingExtraWidth(mapZoom)
                : undefined,
            walkWidth: segment.mode === "WALK" || segment.mode === "TRANSFER"
                ? getWalkWidth(mapZoom)
                : undefined,
            arrowVisibleWhileMoving: shouldRenderNativeTransitDirection(segment, mapZoom),
            directionOpacity: shouldRenderNativeTransitDirection(segment, mapZoom)
                ? getNativeDirectionOpacity(mapZoom)
                : undefined,
        })) ?? [];
        const rendererLogSignature = JSON.stringify({
            selectedRouteId: selectedNormalizedRoute?.id,
            actualZoom,
            rows,
        });
        if (lastRouteRendererLogSignatureRef.current === rendererLogSignature) return;
        lastRouteRendererLogSignatureRef.current = rendererLogSignature;

        console.table(rows);
        console.log("[route-renderer] rows:", rows);
    }, [mapZoom, routeAlternatives.length, selectedNormalizedRoute]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (qaLayerMode === "ALL") return;
        const rows = [
            {
                area: "Selected route screen",
                qaLayerMode,
                baseLayerIssue: qaLayerMode === "BASE_ONLY",
                appOverlayIssue: qaLayerMode !== "BASE_ONLY",
                connectorIssue: qaLayerMode === "CONNECTOR_DEBUG",
                anchorIssue: qaLayerMode === "ANCHOR_DEBUG",
                routeVisibilityIssue: qaLayerMode === "ROUTE_VISIBILITY_DEBUG",
                note: qaLayerMode === "BASE_ONLY"
                    ? "App route overlays and route markers are intentionally hidden."
                    : qaLayerMode === "APP_ROUTE_ONLY" || qaLayerMode === "APP_ROUTE_DIM_BASE" || qaLayerMode === "ROUTE_VISIBILITY_DEBUG"
                        ? "Tmap base is dimmed so app route overlay can be inspected separately."
                        : "Debug overlays are enabled only for QA.",
            },
        ];
        const signature = JSON.stringify(rows);
        if (lastRouteQaLayerLogSignatureRef.current === signature) return;
        lastRouteQaLayerLogSignatureRef.current = signature;
        console.log("[route-qa-layer-mode]", qaLayerMode);
        console.table(rows);
    }, [qaLayerMode]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (qaLayerMode !== "CONNECTOR_DEBUG") return;
        const segmentRows = selectedNormalizedRoute?.segments
            ?.filter((segment) => segment.mode === "WALK" || segment.mode === "TRANSFER")
            .map((segment) => {
                const lengthMeters = Math.round(getSegmentLengthMeters(getSegmentRenderableCoordinates(segment)));
                const source = segment.geometrySource === "WALK_STEPS_LINESTRING"
                    ? "WALK_STEPS_LINESTRING"
                    : segment.geometryQuality === "ANCHOR_ADJUSTED_GEOMETRY"
                        ? "ANCHOR_SHORT_CONNECTOR"
                        : segment.geometrySource === "START_END_ONLY" || segment.geometryQuality === "START_END_ONLY"
                            ? "HIDDEN_TOO_LONG"
                            : (segment.geometrySource ?? "UNKNOWN");
                const partType = source === "WALK_STEPS_LINESTRING"
                    ? "STEPS_GEOMETRY"
                    : source === "HIDDEN_TOO_LONG"
                        ? "HIDDEN_CONNECTOR"
                        : "CONNECTOR_OR_ADJUSTED_GEOMETRY";
                return {
                    segmentId: segment.id,
                    mode: segment.mode,
                    partType,
                    source,
                    geometryQuality: segment.geometryQuality,
                    distanceMeters: lengthMeters,
                    pointCount: getSegmentRenderableCoordinates(segment).length,
                };
            }) ?? [];
        const overlayRows = [
            ...transitConnectorOverlays.map((overlay) => ({
                overlayId: overlay.id,
                partType: "API_CONNECTOR_OVERLAY",
                source: "WALK_API_CONNECTOR",
                distanceMeters: Math.round(getSegmentLengthMeters(overlay.coords)),
                pointCount: overlay.coords.length,
            })),
            ...transitWalkDetailOverlays.map((overlay) => ({
                overlayId: overlay.id,
                partType: overlay.id.endsWith("-path") ? "WALK_DETAIL_PATH" : "WALK_DETAIL_SOURCE",
                source: "WALK_API_DETAIL",
                distanceMeters: Math.round(getSegmentLengthMeters(overlay.coords)),
                pointCount: overlay.coords.length,
            })),
        ];
        const signature = JSON.stringify({
            routeId: selectedNormalizedRoute?.id,
            segmentRows,
            overlayRows,
        });
        if (lastWalkRenderPartsLogSignatureRef.current === signature) return;
        lastWalkRenderPartsLogSignatureRef.current = signature;

        console.log("[route-walk-render-parts] selectedRouteId:", selectedNormalizedRoute?.id);
        console.table(segmentRows);
        console.table(overlayRows);
        console.log("[route-walk-render-parts] segment rows:", segmentRows);
        console.log("[route-walk-render-parts] overlay rows:", overlayRows);
    }, [qaLayerMode, selectedNormalizedRoute, transitConnectorOverlays, transitWalkDetailOverlays]);

    useEffect(() => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        if (!selectedNormalizedRoute?.segments?.length && !selectedRouteInfo?.steps?.length) return;

        const segmentRows = selectedNormalizedRoute?.segments.map((segment, index) => ({
            index,
            id: segment.id,
            mode: segment.mode,
            lineName: segment.lineName,
            duration: segment.duration,
            color: getSegmentColor(segment),
            routeColor: segment.routeColor,
            displayColor: segment.displayColor,
            geometrySource: segment.geometrySource,
            geometryQuality: segment.geometryQuality,
            isManualSamplePath: segment.isManualSamplePath === true,
        })) ?? [];
        const timelineRows = selectedRouteInfo?.steps
            .filter((step) => step.type !== "ORIGIN" && step.type !== "DESTINATION")
            .map((step, index) => ({
                index,
                id: step.id,
                type: step.type,
                lineName: step.lineName,
                duration: step.durationMinutes,
                color: getRouteStepColor(step),
            })) ?? [];
        const summaryRows = selectedTransitProgressSegments.map((segment, index) => ({
            index,
            key: segment.key,
            kind: segment.kind,
            lineLabel: segment.lineLabel,
            minutes: segment.minutes,
            color: segment.color,
            isRide: segment.isRide,
        }));
        const routeSheetLogSignature = JSON.stringify({
            selectedRouteId: selectedNormalizedRoute?.id,
            segments: segmentRows,
            timeline: timelineRows,
            summary: summaryRows,
        });
        if (lastRouteSheetSyncLogSignatureRef.current === routeSheetLogSignature) return;
        lastRouteSheetSyncLogSignatureRef.current = routeSheetLogSignature;

        console.log("[route-sheet-sync] selectedRouteId:", selectedNormalizedRoute?.id);
        console.log("[route-sheet-sync] segmentCount:", segmentRows.length);
        console.log("[route-sheet-sync] timelineStepCount:", timelineRows.length);
        console.log("[route-sheet-sync] summarySegmentCount:", summaryRows.length);
        console.table(segmentRows);
        console.table(timelineRows);
        console.table(summaryRows);
        console.log("[route-sheet-sync] segment rows:", segmentRows);
        console.log("[route-sheet-sync] timeline rows:", timelineRows);
        console.log("[route-sheet-sync] summary rows:", summaryRows);
    }, [selectedNormalizedRoute, selectedRouteInfo, selectedTransitProgressSegments]);

    // 지도에 전달할 실제 marker 목록.
    // 출발/도착 pin, 방향 화살표, 버스 정류장, 환승/승하차 배지까지 최종 단계에서 모은다.
    const mapMarkers = useMemo<TmapMarker[]>(() => {
        if (isRouteQaBaseOnly) return [];
        const markers: TmapMarker[] = [];
        // 출발/도착 핀은 항상 사용자가 선택한 실제 좌표에 고정한다.
        // (TRANSIT에서 walk path 중간으로 이동시키면 "마커가 틀린 위치"처럼 보이는 문제가 생김)
        const originMarkerCoord = hasOriginCoords ? { lat: originLat, lng: originLng } : undefined;
        const destinationMarkerCoord = hasDestinationCoords ? { lat: destinationLat, lng: destinationLng } : undefined;
        const endpointPresentation = getRouteEndpointMarkerPresentation(
            originMarkerCoord,
            destinationMarkerCoord,
            mapZoom
        );
        if (hasOriginCoords) {
            markers.push({
                id: "origin",
                latitude: originMarkerCoord?.lat ?? originLat,
                longitude: originMarkerCoord?.lng ?? originLng,
                tintColor: ORIGIN_COLOR,
                markerStyle: "origin",
                displayType: "pin",
                // 전체 경로에서는 본선을 가리지 않고, 상세 배율에서는 행동 지점을 크게 보여준다.
                pinLabel: endpointPresentation.showLabels ? "출발" : undefined,
                markerScale: endpointPresentation.markerScale,
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
                pinLabel: endpointPresentation.showLabels ? "도착" : undefined,
                markerScale: endpointPresentation.markerScale,
                caption: "도착",
                // 도착 마커는 출발보다 한 단계 낮은 우선순위.
                zIndex: 3990,
            });
        }

        if (
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            markers.push(...buildTransitPassStopMarkers(
                selectedAlternative.id,
                selectedAlternative.transitLegs,
                mapZoom,
                selectedTransitMapStop
            ));
            markers.push(...buildTransitRouteIdentityMarkers(
                selectedAlternative.id,
                selectedAlternative.transitLegs,
                mapZoom
            ));
            const transitEventMarkers = buildTransitEventMarkers(
                selectedAlternative.id,
                selectedAlternative.transitLegs,
                mapZoom,
                shouldRenderTransitDetailDark,
                selectedNormalizedRoute
            );
            markers.push(...transitEventMarkers.filter((marker) => (
                !isRedundantEndpointTransitEvent(
                    marker.eventIntent,
                    { lat: marker.latitude, lng: marker.longitude },
                    {
                        origin: originMarkerCoord,
                        destination: destinationMarkerCoord,
                    },
                    // 광역에서는 첫 노선 태그를 보존하고, 중간 배율부터 핀과 실제 충돌하는 라벨만 줄인다.
                    marker.displayType === "routeLabel" && mapZoom >= 14 ? mapZoom : undefined
                )
            )));
        }

        if (qaLayerMode === "ANCHOR_DEBUG") {
            markers.push(...buildAnchorDebugMarkers(selectedNormalizedRoute));
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
        selectedTransitMapStop,
        shouldRenderTransitDetailDark,
        isRouteQaBaseOnly,
        qaLayerMode,
        selectedNormalizedRoute,
    ]);

    // 카메라는 prop으로 계속 넘기지 않고 imperative ref로만 제어한다.
    // 그래야 경로 재계산/마커 갱신 때 불필요한 카메라 리셋 없이 원하는 포커스만 이동시킬 수 있다.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const hasOrigin = typeof originLat === "number" && typeof originLng === "number";
        const hasDest = typeof destinationLat === "number" && typeof destinationLng === "number";
        const isTransitForcedFocusPending =
            (forcedFocusTarget === "startRide" || forcedFocusTarget === "firstSubway") &&
            travelMode === "TRANSIT" &&
            (
                !Array.isArray(selectedAlternative?.transitLegs) ||
                selectedAlternative.transitLegs.length === 0
            );
        if (isTransitForcedFocusPending) return;
        if (shouldDeferInitialRouteCamera({
            isRouteDetailMode,
            mapInitialized: isMapInitialized,
            hasOrigin,
            hasDestination: hasDest,
            routeLoading: etaLoading,
            bottomSheetVisible: !isBottomSheetHidden,
            bottomSheetMeasured: hasBottomSheetMeasured,
        })) {
            return;
        }

        const getSheetAwareCameraCenter = (coord: RoutePathCoord, focusZoom: number): RoutePathCoord => {
            const activeSheetOffset = bottomSheetSnap === "expanded"
                ? bottomSheetExpandedOffset
                : bottomSheetSnap === "middle"
                    ? bottomSheetMiddleOffset
                    : bottomSheetCollapsedOffset;
            const rawVisibleSheetTopY = isRouteDetailMode && !isBottomSheetHidden && bottomPanelHeight > 0
                ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
                : isRouteDetailMode && !isBottomSheetHidden
                    ? Math.round(windowHeight * 0.56)
                : windowHeight;
            const visibleSheetTopY = isRouteDetailMode && !isBottomSheetHidden
                ? Math.min(rawVisibleSheetTopY, windowHeight - transitMapBottomOcclusionHeight)
                : rawVisibleSheetTopY;
            const visibleMapTopY = isRouteDetailMode
                ? Math.max(insets.top + 104, 126)
                : Math.max(insets.top + 84, 112);
            const visibleMapBottomY = Math.max(visibleMapTopY + 120, visibleSheetTopY);
            const visibleMapCenterY = visibleMapTopY + ((visibleMapBottomY - visibleMapTopY) * 0.22);
            const verticalPixelShift = Math.max(0, (windowHeight / 2) - visibleMapCenterY);
            const metersPerPixel = (
                156_543.03392 *
                Math.cos((coord.lat * Math.PI) / 180)
            ) / (2 ** focusZoom);
            const rawShiftMeters = verticalPixelShift * metersPerPixel;
            const maxShiftMeters = focusZoom < 12
                ? 780
                : focusZoom < 14
                    ? 420
                : focusZoom < 16
                    ? 170
                    : 360;
            const shiftMeters = Math.min(maxShiftMeters, Math.max(0, rawShiftMeters));
            return offsetCoordByMeters(coord, -shiftMeters, 0);
        };

        if (qaCameraPreset) {
            const qaPadding = {
                top: isRouteDetailMode ? Math.max(insets.top + 168, 184) : Math.max(insets.top + 88, 112),
                bottom: isRouteDetailMode && !isBottomSheetHidden
                    ? Math.max(transitMapBottomOcclusionHeight + ROUTE_PATH_BOTTOM_HEADROOM, 208)
                    : 72,
                left: 48,
                right: 48,
            };
            const qaOverviewBounds = qaCameraPreset.id === "routeOverview"
                ? getCoordinateBounds(qaCameraPreset.boundsCoordinates)
                : undefined;
            // 전체 경로 QA도 제품의 첫 진입 카메라와 같은 Web Mercator bounds 계산을 사용한다.
            // 고정 zoom은 근거리 경로를 점처럼 만들고 장거리 경로를 자르는 잘못된 비교 결과를 만든다.
            const qaOverviewCamera = qaOverviewBounds
                ? getPaddedBoundsCamera(
                    {
                        minLat: qaOverviewBounds.minLat,
                        maxLat: qaOverviewBounds.maxLat,
                        minLng: qaOverviewBounds.minLng,
                        maxLng: qaOverviewBounds.maxLng,
                    },
                    {
                        width: windowWidth,
                        height: windowHeight,
                        padding: qaPadding,
                    },
                    {
                        minZoom: 6,
                        maxZoom: 16,
                        minimumSpanMeters: 420,
                        boundsPaddingFactor: 1.1,
                    }
                )
                : undefined;
            const qaZoom = qaOverviewCamera?.zoom ?? qaCameraPreset.zoom;
            const shouldKeepDetailPresetCenter =
                qaZoom >= 16 ||
                qaCameraPreset.id === "walkTransferZoom17";
            const qaCenter = qaOverviewCamera
                ? { latitude: qaOverviewCamera.latitude, longitude: qaOverviewCamera.longitude }
                : shouldKeepDetailPresetCenter
                    ? qaCameraPreset.center
                    : getPaddedCameraCenterForFixedZoom(
                        qaCameraPreset.boundsCoordinates,
                        qaPadding,
                        { width: windowWidth, height: windowHeight },
                        qaZoom
                    ) ?? qaCameraPreset.center;
            const focusKey = [
                "qa-preset-v3",
                qaCameraPreset.id,
                selectedAlternativeId ?? "none",
                qaCenter.latitude.toFixed(5),
                qaCenter.longitude.toFixed(5),
                qaZoom.toFixed(2),
                Math.round(transitMapBottomOcclusionHeight).toString(),
            ].join(":");
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            cameraQaStateRef.current = {
                requestedFocusZoom: qaZoom,
                cameraMode: "SEGMENT_FOCUS_QA",
                autoFitSuppressed: true,
                center: qaCenter,
                reason: "QA_PRESET",
                presetId: qaCameraPreset.id,
                appliedAtMs: Date.now(),
            };
            if (typeof __DEV__ === "boolean" && __DEV__) {
                console.log("[camera-qa] applying preset:", {
                    presetId: qaCameraPreset.id,
                    requestedFocusZoom: qaZoom,
                    cameraMode: "SEGMENT_FOCUS_QA",
                    autoFitSuppressed: true,
                    center: qaCenter,
                    rawCenter: qaCameraPreset.center,
                    padding: qaPadding,
                    boundsPointCount: qaCameraPreset.boundsCoordinates?.length ?? 0,
                    dynamicOverviewFit: !!qaOverviewCamera,
                    reason: "QA_PRESET",
                    description: qaCameraPreset.description,
                });
            }
            map.resizeMap("QA_PRESET_BEFORE_CAMERA");
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                qaCenter,
                qaZoom,
                () => map.animateCameraTo({
                    latitude: qaCenter.latitude,
                    longitude: qaCenter.longitude,
                    zoom: qaZoom,
                    duration: 450,
                    easing: "Fly",
                })
            );
            setTimeout(() => {
                mapRef.current?.resizeMap("QA_PRESET_AFTER_CAMERA");
            }, 620);
            return;
        }

        if (
            forcedFocusTarget === "startRide" &&
            travelMode === "TRANSIT" &&
            Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0
        ) {
            const focusCoord = getTransitRouteStartFocusCoord(selectedAlternative.transitLegs);
            if (focusCoord) {
                const focusZoom = forcedFocusZoom ?? 17.1;
                const focusKey = `focus-v4:start-ride:${selectedAlternativeId ?? "none"}:${focusCoord.lat.toFixed(5)}:${focusCoord.lng.toFixed(5)}:${focusZoom.toFixed(2)}`;
                if (lastCameraActionKeyRef.current === focusKey) return;
                lastCameraActionKeyRef.current = focusKey;
                const shiftedCenter = getSheetAwareCameraCenter(focusCoord, focusZoom);
                runCameraActionAfterDirectionPrewarm(
                    focusKey,
                    { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
                    focusZoom,
                    () => map.animateCameraTo({
                        latitude: shiftedCenter.lat,
                        longitude: shiftedCenter.lng,
                        zoom: focusZoom,
                        duration: 800,
                        easing: "Fly",
                    })
                );
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
                const focusZoom = forcedFocusZoom ?? 17.1;
                const focusKey = `focus-v4:first-subway:${selectedAlternativeId ?? "none"}:${focusCoord.lat.toFixed(5)}:${focusCoord.lng.toFixed(5)}:${focusZoom.toFixed(2)}`;
                if (lastCameraActionKeyRef.current === focusKey) return;
                lastCameraActionKeyRef.current = focusKey;
                const shiftedCenter = getSheetAwareCameraCenter(focusCoord, focusZoom);
                runCameraActionAfterDirectionPrewarm(
                    focusKey,
                    { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
                    focusZoom,
                    () => map.animateCameraTo({
                        latitude: shiftedCenter.lat,
                        longitude: shiftedCenter.lng,
                        zoom: focusZoom,
                        duration: 800,
                        easing: "Fly",
                    })
                );
                return;
            }
        }
        if (forcedFocusTarget === "origin" && hasOrigin) {
            const focusZoom = forcedFocusZoom ?? 16.1;
            const focusKey = `focus:origin-forced:${originLat.toFixed(5)}:${originLng.toFixed(5)}:${focusZoom.toFixed(2)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            const shiftedCenter = offsetCoordByMeters({ lat: originLat, lng: originLng }, -70, 0);
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
                focusZoom,
                () => map.animateCameraTo({
                    latitude: shiftedCenter.lat,
                    longitude: shiftedCenter.lng,
                    zoom: focusZoom,
                    duration: 750,
                    easing: "Fly",
                })
            );
            return;
        }
        if (forcedFocusTarget === "destination" && hasDest) {
            const focusZoom = forcedFocusZoom ?? 16.1;
            const focusKey = `focus:destination-forced:${destinationLat.toFixed(5)}:${destinationLng.toFixed(5)}:${focusZoom.toFixed(2)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            const shiftedCenter = offsetCoordByMeters({ lat: destinationLat, lng: destinationLng }, -70, 0);
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: shiftedCenter.lat, longitude: shiftedCenter.lng },
                focusZoom,
                () => map.animateCameraTo({
                    latitude: shiftedCenter.lat,
                    longitude: shiftedCenter.lng,
                    zoom: focusZoom,
                    duration: 750,
                    easing: "Fly",
                })
            );
            return;
        }

        if (hasOrigin && hasDest) {
            cameraQaStateRef.current = {
                cameraMode: "ROUTE_OVERVIEW",
                autoFitSuppressed: false,
                reason: hasRouteReady ? "ROUTE_CHANGED" : "INITIAL_ROUTE_FIT",
            };
            const originPoint = { latitude: originLat, longitude: originLng };
            const destinationPoint = { latitude: destinationLat, longitude: destinationLng };
            const transitConnectorFitPoints = isTransitDetailMode
                ? [...transitConnectorOverlays, ...transitWalkDetailOverlays].flatMap((overlay) => overlay.coords)
                : [];
            const routeInfoFitPoints = selectedRouteInfo?.steps.flatMap((step) => step.coordinates ?? []) ?? [];
            const segmentFitPoints = travelMode === "TRANSIT"
                ? selectedNormalizedRoute?.segments.flatMap((segment) => (
                    Array.isArray(segment.renderedCoordinates) && segment.renderedCoordinates.length >= 2
                        ? segment.renderedCoordinates
                        : segment.coordinates
                )) ?? []
                : [];
            const routePoints = segmentFitPoints.length
                ? [originPoint, ...segmentFitPoints, destinationPoint]
                : pathOverlayCoords?.length
                    ? [originPoint, ...pathOverlayCoords, ...transitConnectorFitPoints, destinationPoint]
                    : routeInfoFitPoints.length
                        ? [originPoint, ...routeInfoFitPoints, ...transitConnectorFitPoints, destinationPoint]
                        : [originPoint, destinationPoint];
            const activeSheetOffset = bottomSheetSnap === "expanded"
                ? bottomSheetExpandedOffset
                : bottomSheetSnap === "middle"
                    ? bottomSheetMiddleOffset
                    : bottomSheetCollapsedOffset;
            const rawVisibleSheetTopY = isRouteDetailMode && !isBottomSheetHidden && bottomPanelHeight > 0
                ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
                : windowHeight;
            const visibleSheetTopY = isRouteDetailMode && !isBottomSheetHidden
                ? Math.min(rawVisibleSheetTopY, windowHeight - transitMapBottomOcclusionHeight)
                : rawVisibleSheetTopY;
            const routeHeaderReserveY = isRouteDetailMode
                ? Math.max(insets.top + 54, 108)
                : Math.max(insets.top + 84, 112);
            const availableRouteMapHeight = Math.max(180, visibleSheetTopY - routeHeaderReserveY);
            const routeFitPadding = {
                top: isRouteDetailMode
                    ? routeHeaderReserveY + ROUTE_ENDPOINT_PIN_TOP_HEADROOM
                    : routeHeaderReserveY,
                bottom: isRouteDetailMode && !isBottomSheetHidden
                    ? Math.max(192, Math.round(windowHeight - visibleSheetTopY + ROUTE_PATH_BOTTOM_HEADROOM))
                    : 72,
                left: isRouteDetailMode ? 64 : 56,
                right: isRouteDetailMode ? 64 : 56,
            };
            const usableFitWidth = Math.max(1, windowWidth - routeFitPadding.left - routeFitPadding.right);
            const usableFitHeight = Math.max(1, windowHeight - routeFitPadding.top - routeFitPadding.bottom);
            const routeRevision = [
                routeRefreshTick,
                travelMode === "TRANSIT" ? requestedTransitDepartureAt.toISOString() : "static",
                selectedAlternative?.minutes ?? "minutes-unknown",
                selectedAlternative?.distanceMeters ?? "distance-unknown",
            ].join(":");
            const fitKey = getRouteOverviewFitKey({
                routeId: selectedAlternativeId,
                routeRevision,
                routeMode: isRouteDetailMode ? "detail" : "edit",
                travelMode,
                origin: originPoint,
                destination: destinationPoint,
                sheetSnap: bottomSheetSnap,
                sheetHidden: isBottomSheetHidden,
                bottomPanelHeight,
                animatedSheetOffset: activeSheetOffset,
                visibleSheetTopY,
                padding: routeFitPadding,
            });
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
            const routeDistanceKm = haversineDistanceKm(
                { latitude: originLat, longitude: originLng },
                { latitude: destinationLat, longitude: destinationLng }
            );
            const minSpanMeters = isBottomSheetCollapsed
                ? (routeDistanceKm < 2 ? 520 : routeDistanceKm < 10 ? 680 : 880)
                : (routeDistanceKm < 2 ? 420 : routeDistanceKm < 10 ? 560 : 760);
            const boundsPaddingFactor = routeDistanceKm < 2
                ? 1.12
                : routeDistanceKm < 12
                    ? 1.1
                    : 1.08;
            const overviewCamera = getPaddedBoundsCamera(
                { minLat, maxLat, minLng, maxLng },
                {
                    width: windowWidth,
                    height: windowHeight,
                    padding: routeFitPadding,
                },
                {
                    minZoom: 6,
                    maxZoom: isRouteDetailMode ? 16 : 18,
                    minimumSpanMeters: minSpanMeters,
                    boundsPaddingFactor,
                }
            );
            if (!overviewCamera) return;

            if (typeof __DEV__ === "boolean" && __DEV__) {
                console.log("[camera-fit] route overview padding:", {
                    selectedRouteId: selectedNormalizedRoute?.id,
                    cameraMode: "ROUTE_OVERVIEW",
                    reason: hasRouteReady ? "ROUTE_CHANGED" : "INITIAL_ROUTE_FIT",
                    routePointCount: routePoints.length,
                    padding: routeFitPadding,
                    visibleSheetTopY: Math.round(visibleSheetTopY),
                    routeHeaderReserveY: Math.round(routeHeaderReserveY),
                    availableRouteMapHeight: Math.round(availableRouteMapHeight),
                    usableFitWidth: Math.round(usableFitWidth),
                    usableFitHeight: Math.round(usableFitHeight),
                    rawLatDelta,
                    rawLngDelta,
                    targetCamera: overviewCamera,
                });
            }

            runCameraActionAfterDirectionPrewarm(
                fitKey,
                { latitude: overviewCamera.latitude, longitude: overviewCamera.longitude },
                overviewCamera.zoom,
                () => map.fitToCoordinates(routePoints, { edgePadding: routeFitPadding })
            );
        } else if (activeTarget === "destination" && hasDest) {
            const focusKey = `focus:destination:${destinationLat.toFixed(5)}:${destinationLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: destinationLat, longitude: destinationLng },
                14,
                () => map.animateCameraTo({ latitude: destinationLat, longitude: destinationLng, zoom: 14, duration: 700, easing: "Fly" })
            );
        } else if (activeTarget === "origin" && hasOrigin) {
            const focusKey = `focus:origin:${originLat.toFixed(5)}:${originLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: originLat, longitude: originLng },
                14,
                () => map.animateCameraTo({ latitude: originLat, longitude: originLng, zoom: 14, duration: 700, easing: "Fly" })
            );
        } else if (hasOrigin) {
            const focusKey = `focus:origin-only:${originLat.toFixed(5)}:${originLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: originLat, longitude: originLng },
                14,
                () => map.animateCameraTo({ latitude: originLat, longitude: originLng, zoom: 14, duration: 700, easing: "Fly" })
            );
        } else if (hasDest) {
            const focusKey = `focus:destination-only:${destinationLat.toFixed(5)}:${destinationLng.toFixed(5)}`;
            if (lastCameraActionKeyRef.current === focusKey) return;
            lastCameraActionKeyRef.current = focusKey;
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: destinationLat, longitude: destinationLng },
                14,
                () => map.animateCameraTo({ latitude: destinationLat, longitude: destinationLng, zoom: 14, duration: 700, easing: "Fly" })
            );
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
        selectedNormalizedRoute,
        selectedRouteInfo,
        qaCameraPreset,
        isQaCameraLocked,
        travelMode,
        isBottomSheetCollapsed,
        isBottomSheetHidden,
        isRouteDetailMode,
        isTransitDetailMode,
        bottomSheetSnap,
        bottomPanelHeight,
        bottomSheetCollapsedOffset,
        bottomSheetMiddleOffset,
        bottomSheetExpandedOffset,
        transitConnectorOverlays,
        transitWalkDetailOverlays,
        insets.top,
        windowWidth,
        windowHeight,
        isMapInitialized,
        etaLoading,
        hasBottomSheetMeasured,
        hasRouteReady,
        routeRefreshTick,
        requestedTransitDepartureAt,
        transitMapBottomOcclusionHeight,
        visibleBottomSheetHeight,
        runCameraActionAfterDirectionPrewarm,
    ]);

    const saveCurrentOriginAsFavorite = useCallback(async () => {
        const normalizedOriginName = originName.trim();
        const normalizedOriginAddress = originAddress.trim();
        const originPlace: Place = {
            name: normalizedOriginName || normalizedOriginAddress || "출발지",
            address: normalizedOriginAddress || undefined,
            lat: originLat,
            lng: originLng,
        };

        if (!placeHasCoords(originPlace)) {
            Alert.alert("즐겨찾기 저장", "좌표가 있는 출발지를 먼저 선택해 주세요.");
            return;
        }

        try {
            await saveFavoriteDeparturePlace(originPlace);
            setOriginUsesDefault(true);
            Alert.alert("기본 출발지", "현재 출발지를 기본 출발지로 저장했습니다.");
        } catch {
            Alert.alert("기본 출발지 저장 실패", "잠시 후 다시 시도해 주세요.");
        }
    }, [originAddress, originLat, originLng, originName]);

    const applyPlace = (target: RoutePointTarget, place: PlaceSearchItem) => {
        routePointRequestGuardRef.current.invalidate();
        searchRequestIdRef.current += 1;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (isRoutePointLocked || !hasActiveTarget) {
            setSearchQuery("");
            setSearchResults([]);
            return;
        }

        if (target === "origin") {
            originTouchedRef.current = true;
            setOriginUsesDefault(false);
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
        setSearchError(undefined);
        setCompletedSearchQuery("");
        setSearching(false);
    };

    const applyCurrentLocation = useCallback(async (target: RoutePointTarget) => {
        const guard = routePointRequestGuardRef.current;
        const requestId = guard.begin();
        try {
            const loc = await getCurrentLocation();
            const address = await reverseGeocodeToAddress(loc.latitude, loc.longitude).catch(() => undefined);
            if (!guard.isCurrent(requestId)) return false;
            const placeName = address || "현재 위치";
            if (target === "origin") {
                originTouchedRef.current = true;
                setOriginUsesDefault(false);
                setOriginLat(loc.latitude);
                setOriginLng(loc.longitude);
                setOriginName(placeName);
                setOriginAddress(address || "");
                setActiveTarget("destination");
            } else {
                setDestinationLat(loc.latitude);
                setDestinationLng(loc.longitude);
                setDestinationName(placeName);
                setDestinationAddress(address || "");
            }

            const nextHasOrigin = target === "origin" ? true : hasOriginCoords;
            const nextHasDestination = target === "destination" ? true : hasDestinationCoords;
            if (nextHasOrigin && nextHasDestination) {
                setIsRoutePointEditMode(false);
            } else {
                setIsRoutePointEditMode(true);
            }

            return true;
        } catch (error) {
            if (!guard.isCurrent(requestId)) return false;
            const message = error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.";
            const permission = await getCurrentLocationPermissionState().catch(() => undefined);
            if (!guard.isCurrent(requestId)) return false;
            if (permission && !permission.servicesEnabled) {
                showLocationSettingsAlert(
                    "위치 서비스가 꺼져 있어요",
                    "기기 위치 서비스를 켠 뒤 다시 시도해 주세요.",
                    true
                );
            } else if (permission && !permission.granted && !permission.canAskAgain) {
                showLocationSettingsAlert(
                    "위치 권한이 필요해요",
                    "기기 설정에서 NoLate의 위치 권한을 허용한 뒤 다시 시도해 주세요."
                );
            } else {
                Alert.alert("위치 가져오기 실패", message);
            }
            return false;
        }
    }, [hasDestinationCoords, hasOriginCoords]);

    const requestCurrentLocation = useCallback(async (target: RoutePointTarget) => {
        const guard = routePointRequestGuardRef.current;
        const requestId = guard.begin();
        try {
            const permission = await getCurrentLocationPermissionState();
            if (!guard.isCurrent(requestId)) return;
            if (!permission.servicesEnabled) {
                showLocationSettingsAlert(
                    "위치 서비스가 꺼져 있어요",
                    "기기 위치 서비스를 켠 뒤 다시 시도해 주세요.",
                    true
                );
                return;
            }

            if (!permission.granted) {
                if (!permission.canAskAgain) {
                    showLocationSettingsAlert(
                        "위치 권한이 필요해요",
                        "기기 설정에서 NoLate의 위치 권한을 허용한 뒤 다시 시도해 주세요."
                    );
                    return;
                }
                setLocationPromptTarget(target);
                return;
            }

            await applyCurrentLocation(target);
        } catch (error) {
            if (!guard.isCurrent(requestId)) return;
            const message = error instanceof Error ? error.message : "현재 위치 권한 상태를 확인하지 못했습니다.";
            Alert.alert("위치 확인 실패", message);
        }
    }, [applyCurrentLocation]);

    const closeLocationPrompt = useCallback(() => {
        if (locationPromptLoading) return;
        routePointRequestGuardRef.current.invalidate();
        setLocationPromptTarget(null);
    }, [locationPromptLoading]);

    const confirmLocationPrompt = useCallback(async () => {
        if (!locationPromptTarget || locationPromptLoading) return;
        const target = locationPromptTarget;
        setLocationPromptLoading(true);
        await applyCurrentLocation(target);
        setLocationPromptLoading(false);
        setLocationPromptTarget(null);
    }, [applyCurrentLocation, locationPromptLoading, locationPromptTarget]);

    useEffect(() => {
        if (initializedOriginRef.current) return;
        if (typeof originLat === "number" && typeof originLng === "number") {
            initializedOriginRef.current = true;
            return;
        }
        if (forcedEditTarget === "origin") {
            initializedOriginRef.current = true;
            return;
        }
        initializedOriginRef.current = true;
        let cancelled = false;

        const applyStoredOriginOrCurrentLocation = async () => {
            const storedOrigin = await getFavoriteDeparturePlace().catch(() => null);
            if (cancelled || originTouchedRef.current) return;

            if (hasFavoriteDepartureCoords(storedOrigin)) {
                originTouchedRef.current = true;
                setOriginName(storedOrigin.name?.trim() || storedOrigin.address?.trim() || "기본 출발지");
                setOriginAddress(storedOrigin.address?.trim() || "");
                setOriginLat(storedOrigin.lat);
                setOriginLng(storedOrigin.lng);
                setOriginUsesDefault(true);

                const hasDestination =
                    typeof destinationLat === "number" &&
                    typeof destinationLng === "number";
                if (hasDestination && !forcedEditTarget) {
                    setActiveTarget(null);
                    setIsRoutePointEditMode(false);
                } else {
                    setActiveTarget("destination");
                    setIsRoutePointEditMode(true);
                }
                return;
            }

            // 저장값이 없는 사용자만 기존 동작대로 현재 위치 권한 흐름을 사용한다.
            await requestCurrentLocation("origin");
        };

        applyStoredOriginOrCurrentLocation().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [
        destinationLat,
        destinationLng,
        forcedEditTarget,
        originLat,
        originLng,
        requestCurrentLocation,
    ]);

    const onPressOriginTarget = () => {
        routePointRequestGuardRef.current.invalidate();
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
        originTouchedRef.current = true;
        requestCurrentLocation("origin").catch(() => {
            // ignore
        });
    };

    const onPressDestinationTarget = () => {
        routePointRequestGuardRef.current.invalidate();
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
        const requestGuard = routePointRequestGuardRef.current;
        const requestId = requestGuard.begin();
        searchRequestIdRef.current += 1;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        const { latitude, longitude } = event;
        const tappedTarget = activeTarget;

        if (tappedTarget === "origin") {
            originTouchedRef.current = true;
            setOriginUsesDefault(false);
            setOriginName(getMapPickedPlaceFallbackName("origin"));
            setOriginAddress("");
            setOriginLat(latitude);
            setOriginLng(longitude);
            setActiveTarget("destination");
        } else {
            setDestinationName(getMapPickedPlaceFallbackName("destination"));
            setDestinationAddress("");
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
            if (!requestGuard.isCurrent(requestId)) return;
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
            // 주소 역지오코딩 실패 시 좌표만 유지한다.
        }
    };

    const clearPlaceSearch = () => {
        routePointRequestGuardRef.current.invalidate();
        searchRequestIdRef.current += 1;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchQuery("");
        setSearchResults([]);
        setSearchError(undefined);
        setCompletedSearchQuery("");
        setSearching(false);
    };

    const handleSearchChange = (text: string) => {
        if (isRoutePointLocked || !hasActiveTarget) return;
        routePointRequestGuardRef.current.invalidate();
        if (activeTarget === "origin") {
            originTouchedRef.current = true;
            setOriginUsesDefault(false);
        }
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        setSearchQuery(text);
        setSearchResults([]);
        setSearchError(undefined);
        setCompletedSearchQuery("");
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (!text.trim()) {
            setSearching(false);
            return;
        }
        searchDebounceRef.current = setTimeout(async () => {
            try {
                setSearching(true);
                const oppositePoint = activeTarget === "origin"
                    ? (hasDestinationCoords ? { lat: destinationLat, lng: destinationLng } : undefined)
                    : (hasOriginCoords ? { lat: originLat, lng: originLng } : undefined);
                const items = await searchAddressByKeyword(text.trim(), {
                    center: oppositePoint,
                    radiusKm: 33,
                });
                if (searchRequestIdRef.current !== requestId) return;
                setSearchResults(items);
                setCompletedSearchQuery(text.trim());
            } catch (error) {
                if (searchRequestIdRef.current !== requestId) return;
                const message = error instanceof Error ? error.message : "주소 검색에 실패했습니다.";
                setSearchResults([]);
                setSearchError(message);
                setCompletedSearchQuery(text.trim());
            } finally {
                if (searchRequestIdRef.current === requestId) setSearching(false);
            }
        }, 500);
    };

    const buildPersistableSelectedRoute = useCallback(() => {
        if (!selectedAlternative) return undefined;

        const storedPathOverlays = mapPathOverlays.flatMap((overlay) => {
            if (!Array.isArray(overlay.coords) || overlay.coords.length < 2) return [];
            const geometryProvenance = getStoredRouteOverlayGeometryProvenance(
                overlay.id,
                selectedNormalizedRoute?.segments
            );
            return [{
                id: overlay.id,
                coords: overlay.coords.map((coord) => ({ lat: coord.latitude, lng: coord.longitude })),
                color: overlay.color,
                width: overlay.width,
                outlineColor: overlay.outlineColor,
                outlineWidth: overlay.outlineWidth,
                dashPattern: overlay.dashPattern,
                strokeStyle: overlay.strokeStyle,
                outlineStrokeStyle: overlay.outlineStrokeStyle,
                renderMode: overlay.renderMode,
                shape: overlay.shape,
                showDirection: overlay.showDirection,
                nativeDirection: overlay.nativeDirection,
                nativeDirectionColor: overlay.nativeDirectionColor,
                nativeDirectionOpacity: overlay.nativeDirectionOpacity,
                directionColor: overlay.directionColor,
                directionOpacity: overlay.directionOpacity,
                directionSpacingPx: overlay.directionSpacingPx,
                directionSizePx: overlay.directionSizePx,
                directionInsetPx: overlay.directionInsetPx,
                directionMaxCount: overlay.directionMaxCount,
                dotColor: overlay.dotColor,
                dotOutlineColor: overlay.dotOutlineColor,
                dotOutlineWidth: overlay.dotOutlineWidth,
                dotSizePx: overlay.dotSizePx,
                dotSpacingPx: overlay.dotSpacingPx,
                supportLineColor: overlay.supportLineColor,
                supportLineWidth: overlay.supportLineWidth,
                drawLine: overlay.drawLine,
                cornerRadiusPx: overlay.cornerRadiusPx,
                smoothPath: overlay.smoothPath,
                lineLabel: overlay.lineLabel,
                lineLabelTextColor: overlay.lineLabelTextColor,
                lineLabelBackgroundColor: overlay.lineLabelBackgroundColor,
                lineLabelOffsetPx: overlay.lineLabelOffsetPx,
                zIndex: overlay.zIndex,
                ...(geometryProvenance ?? {}),
            }];
        });
        const overlayPathCoords = storedPathOverlays.find((overlay) => overlay.coords.length >= 2)?.coords;
        const selectedPathCoords = Array.isArray(selectedAlternative.pathCoords) && selectedAlternative.pathCoords.length >= 2
            ? selectedAlternative.pathCoords
            : Array.isArray(routePathCoords) && routePathCoords.length >= 2
                ? routePathCoords
                : overlayPathCoords;

        return {
            ...selectedAlternative,
            routeInfo: selectedRouteInfo,
            pathCoords: selectedPathCoords,
            storedPathOverlays,
        };
    }, [mapPathOverlays, routePathCoords, selectedAlternative, selectedNormalizedRoute, selectedRouteInfo]);

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
            targetArrivalAt: initial?.targetArrivalAt,
            departureAt: finalSelectedRouteDepartureTime,
            route: buildPersistableSelectedRoute(),
        });
    }, [
        buildPersistableSelectedRoute,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationName,
        etaMinutes,
        finalSelectedRouteDepartureTime,
        hasDestinationCoords,
        hasOriginCoords,
        initial?.targetArrivalAt,
        originAddress,
        originLat,
        originLng,
        originName,
        sessionId,
        travelMode,
    ]);

    const openRoutePointEditorFromHeader = useCallback((target: RoutePointTarget = "origin") => {
        const targetSessionId = sessionId || `route-reset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        persistCurrentRoutePlannerInitial(targetSessionId);
        router.replace({
            pathname: "/schedule/route-select",
            params: {
                sessionId: targetSessionId,
                editTarget: target,
            },
        });
    }, [persistCurrentRoutePlannerInitial, router, sessionId]);

    const closePlanner = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace("/schedule");
    }, [router]);

    const goToScheduleList = useCallback(() => {
        router.replace("/schedule");
    }, [router]);

    useEffect(() => {
        if (Platform.OS !== "android") return;
        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            if (locationPromptTarget) {
                closeLocationPrompt();
                return true;
            }
            if (isRouteDetailMode && !isBottomSheetHidden && bottomSheetSnap !== "collapsed") {
                snapBottomSheetTo("collapsed");
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [
        bottomSheetSnap,
        closeLocationPrompt,
        isBottomSheetHidden,
        isRouteDetailMode,
        locationPromptTarget,
        snapBottomSheetTo,
    ]);

    const openTransitDeparturePicker = useCallback(() => {
        const providerDepartureAt = selectedAlternative?.transitDepartureAt
            ? new Date(selectedAlternative.transitDepartureAt)
            : undefined;
        const initialValue = providerDepartureAt && Number.isFinite(providerDepartureAt.getTime())
            ? providerDepartureAt
            : requestedTransitDepartureAt;

        if (Platform.OS === "android") {
            DateTimePickerAndroid.open({
                value: initialValue,
                mode: "date",
                minimumDate: new Date(Date.now() - 60_000),
                onChange: (dateEvent, selectedDate) => {
                    if (dateEvent.type !== "set" || !selectedDate) return;

                    DateTimePickerAndroid.open({
                        value: initialValue,
                        mode: "time",
                        is24Hour: false,
                        onChange: (timeEvent, selectedTime) => {
                            if (timeEvent.type !== "set" || !selectedTime) return;

                            const nextDepartureAt = new Date(selectedDate);
                            nextDepartureAt.setHours(
                                selectedTime.getHours(),
                                selectedTime.getMinutes(),
                                0,
                                0,
                            );
                            if (nextDepartureAt.getTime() < Date.now() - 60_000) {
                                Alert.alert("출발 시각", "현재 시각 이후로 선택해 주세요.");
                                return;
                            }
                            setRequestedTransitDepartureAt(nextDepartureAt);
                            setRouteRefreshTick((current) => current + 1);
                        },
                    });
                },
            });
            return;
        }

        setDraftTransitDepartureAt(initialValue);
        setIsTransitDeparturePickerOpen(true);
    }, [requestedTransitDepartureAt, selectedAlternative?.transitDepartureAt]);

    const applyTransitDepartureTime = useCallback(() => {
        const nextDepartureAt = new Date(draftTransitDepartureAt);
        nextDepartureAt.setSeconds(0, 0);
        if (!Number.isFinite(nextDepartureAt.getTime()) || nextDepartureAt.getTime() < Date.now() - 60_000) {
            Alert.alert("출발 시각", "현재 시각 이후로 선택해 주세요.");
            return;
        }
        setRequestedTransitDepartureAt(nextDepartureAt);
        setIsTransitDeparturePickerOpen(false);
        setRouteRefreshTick((current) => current + 1);
    }, [draftTransitDepartureAt]);

    const goBack = useCallback(() => {
        if (shouldReturnToScheduleDetail) {
            closePlanner();
            return;
        }
        if (!isRouteSelectionStage) {
            const targetSessionId = sessionId || `route-reset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            persistCurrentRoutePlannerInitial(targetSessionId);
            router.replace({ pathname: "/schedule/route-select", params: { sessionId: targetSessionId } });
            return;
        }

        closePlanner();
    }, [closePlanner, isRouteSelectionStage, persistCurrentRoutePlannerInitial, router, sessionId, shouldReturnToScheduleDetail]);

    const buildCurrentRoutePlaces = useCallback(() => {
        const normalizedOriginName = originName.trim();
        const normalizedDestinationName = destinationName.trim();
        if (!hasRouteReady) {
            return undefined;
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

        return { nextOrigin, nextDestination };
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationName,
        hasRouteReady,
        originAddress,
        originLat,
        originLng,
        originName,
    ]);

    const submit = () => {
        if (routeSubmitPendingRef.current) return;
        const routePlaces = buildCurrentRoutePlaces();
        if (!routePlaces) {
            Alert.alert("경로 설정 필요", "지도에서 출발지와 도착지를 모두 선택해 주세요.");
            return;
        }

        if (!canSubmitRoute) {
            Alert.alert(
                etaLoading ? "경로 계산 중" : "경로 선택 필요",
                etaLoading
                    ? "새 경로 계산이 끝난 뒤 저장해 주세요."
                    : "사용할 수 있는 경로를 다시 검색해 선택해 주세요."
            );
            return;
        }

        if (!sessionId) {
            Alert.alert("저장할 일정이 없어요", "일정 화면에서 이동 경로를 다시 열어 주세요.");
            return;
        }

        const { nextOrigin, nextDestination } = routePlaces;
        routeSubmitPendingRef.current = true;
        setRouteSubmitPending(true);
        try {
            setRoutePlannerResult(sessionId, {
                origin: nextOrigin,
                destination: nextDestination,
                travelMode,
                travelMinutes: selectedRouteInfo?.totalDurationMinutes ?? etaMinutes,
                locationName: `${nextOrigin.name} → ${nextDestination.name}`,
                targetArrivalAt: initial?.targetArrivalAt,
                departureAt: finalSelectedRouteDepartureTime,
                route: buildPersistableSelectedRoute(),
            });
            closePlanner();
        } catch {
            routeSubmitPendingRef.current = false;
            setRouteSubmitPending(false);
            Alert.alert("경로 저장 실패", "잠시 후 다시 시도해 주세요.");
            return;
        }

        routeSubmitResetTimerRef.current = setTimeout(() => {
            routeSubmitPendingRef.current = false;
            setRouteSubmitPending(false);
            routeSubmitResetTimerRef.current = null;
        }, 800);
    };

    const onPressZoomIn = useCallback(() => {
        mapRef.current?.zoomBy(1);
    }, []);

    const onPressZoomOut = useCallback(() => {
        mapRef.current?.zoomBy(-1);
    }, []);

    const onMapLayoutReport = useCallback((report: TmapMapLayoutReport) => {
        if (typeof __DEV__ === "boolean" && !__DEV__) return;
        const cameraQaState = cameraQaStateRef.current;
        const row = {
            mapContainerWidth: Math.round(report.mapContainerWidth ?? windowWidth),
            mapContainerHeight: Math.round(report.mapContainerHeight ?? windowHeight),
            webViewWidth: Math.round(report.webViewWidth ?? report.mapContainerWidth ?? windowWidth),
            webViewHeight: Math.round(report.webViewHeight ?? report.mapContainerHeight ?? windowHeight),
            deviceWidth: Math.round(windowWidth),
            deviceHeight: Math.round(windowHeight),
            bottomSheetHeight: Math.round(visibleBottomSheetHeight),
            cameraMode: cameraQaState.cameraMode,
            cameraUpdateReason: cameraQaState.reason,
            layoutReason: report.reason ?? "UNKNOWN",
            isCameraAnimating: report.isCameraAnimating === true,
            isMapIdle: report.isMapIdle !== false,
        };
        const signature = JSON.stringify(row);
        if (lastMapLayoutLogSignatureRef.current === signature) return;
        lastMapLayoutLogSignatureRef.current = signature;
        console.log("[map-layout]", row);
        if (
            row.mapContainerWidth > 0 &&
            row.mapContainerHeight > 0 &&
            (
                row.webViewWidth < row.mapContainerWidth * 0.92 ||
                row.webViewHeight < row.mapContainerHeight * 0.92
            )
        ) {
            console.warn("[map-layout] possible tile viewport shrink", row);
        }
    }, [visibleBottomSheetHeight, windowHeight, windowWidth]);

    const onMapZoomChanged = useCallback((nextZoom: number) => {
        setMapZoom((prev) => (Math.abs(prev - nextZoom) < 0.05 ? prev : nextZoom));
        const cameraQaState = cameraQaStateRef.current;
        const signature = JSON.stringify({
            actualZoom: Math.round(nextZoom * 10) / 10,
            requestedFocusZoom: cameraQaState.requestedFocusZoom,
            cameraMode: cameraQaState.cameraMode,
            presetId: cameraQaState.presetId,
            reason: cameraQaState.reason,
            autoFitSuppressed: cameraQaState.autoFitSuppressed,
            center: cameraQaState.center,
            appliedAtMs: cameraQaState.appliedAtMs,
        });
        if (lastCameraQaLogSignatureRef.current === signature) return;
        lastCameraQaLogSignatureRef.current = signature;
        if (typeof __DEV__ === "boolean" && !__DEV__) return;

        const requestedFocusZoom = cameraQaState.requestedFocusZoom;
        const zoomDelta = typeof requestedFocusZoom === "number"
            ? Math.abs(requestedFocusZoom - nextZoom)
            : undefined;
        console.log("[camera-qa] requestedFocusZoom:", requestedFocusZoom);
        console.log("[camera-qa] actualZoom:", nextZoom);
        console.log("[camera-qa] cameraMode:", cameraQaState.cameraMode);
        console.log("[camera-qa] autoFitSuppressed:", cameraQaState.autoFitSuppressed);
        console.log("[camera-qa] center:", cameraQaState.center);
        console.log("[camera-qa] reason:", cameraQaState.reason);
        console.log("[camera-qa] presetId:", cameraQaState.presetId);
        const isCameraSettled = !cameraQaState.appliedAtMs || Date.now() - cameraQaState.appliedAtMs >= 500;
        if (typeof zoomDelta === "number" && zoomDelta > 0.3 && isCameraSettled) {
            console.warn("[camera-qa] requested/actual zoom mismatch", {
                requestedFocusZoom,
                actualZoom: nextZoom,
                zoomDelta,
                presetId: cameraQaState.presetId,
            });
        }
    }, []);

    const onMapCameraChanged = useCallback((nextCamera: TmapCameraState) => {
        setMapCamera((previous) => {
            const previousScale = previous.metersPerPixel;
            const nextScale = nextCamera.metersPerPixel;
            const scaleUnchanged = (
                typeof previousScale !== "number" && typeof nextScale !== "number"
            ) || (
                typeof previousScale === "number" &&
                typeof nextScale === "number" &&
                Math.abs(previousScale - nextScale) <= Math.max(0.001, previousScale * 0.015)
            );
            if (
                Math.abs(previous.latitude - nextCamera.latitude) < 0.000002 &&
                Math.abs(previous.longitude - nextCamera.longitude) < 0.000002 &&
                Math.abs(previous.zoom - nextCamera.zoom) < 0.05 &&
                scaleUnchanged
            ) {
                return previous;
            }
            return nextCamera;
        });
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
        const displayedStart = legCoords[0];
        const rawStart = getTransitLegStartCoord(leg);
        const startCoord = displayedStart
            ? { lat: displayedStart.latitude, lng: displayedStart.longitude }
            : rawStart;
        if (!startCoord) return;

        const focusZoom = 18;
        const activeSheetOffset = bottomSheetSnap === "expanded"
            ? bottomSheetExpandedOffset
            : bottomSheetSnap === "middle"
                ? bottomSheetMiddleOffset
                : bottomSheetCollapsedOffset;
        const rawVisibleSheetTopY = !isBottomSheetHidden && bottomPanelHeight > 0
            ? Math.max(0, windowHeight - bottomPanelHeight + activeSheetOffset)
            : windowHeight;
        const visibleSheetTopY = !isBottomSheetHidden
            ? Math.min(rawVisibleSheetTopY, windowHeight - transitMapBottomOcclusionHeight)
            : rawVisibleSheetTopY;
        const visibleMapTopY = Math.max(insets.top + 104, 126);
        const visibleMapBottomY = Math.max(visibleMapTopY + 80, visibleSheetTopY);
        const visibleMapCenterY = (visibleMapTopY + visibleMapBottomY) / 2;
        const verticalPixelShift = Math.max(0, (windowHeight / 2) - visibleMapCenterY);
        const metersPerPixel = (
            156_543.03392 *
            Math.cos((startCoord.lat * Math.PI) / 180)
        ) / (2 ** focusZoom);
        const cameraCenter = offsetCoordByMeters(
            startCoord,
            -(verticalPixelShift * metersPerPixel),
            0
        );
        const focusedSegment = selectedNormalizedRoute?.segments.find((segment) => segment.sequence === legIndex);
        const focusBounds = focusedSegment
            ? getSegmentFocusBounds(focusedSegment)
            : legCoords.filter(isValidCoordinate);
        const focusPadding = {
            top: Math.max(insets.top + 132, 150),
            bottom: Math.max(transitMapBottomOcclusionHeight + 32, 180),
            left: 48,
            right: 48,
        };
        const fitRegion = fitCameraToBoundsWithUiPadding(
            focusBounds,
            focusPadding,
            { width: windowWidth, height: windowHeight }
        );

        const focusKey = [
            "focus-leg-bounds-v2",
            selectedAlternative.id,
            legIndex,
            startCoord.lat.toFixed(6),
            startCoord.lng.toFixed(6),
            bottomSheetSnap,
            Math.round(visibleBottomSheetHeight),
        ].join(":");
        lastCameraActionKeyRef.current = focusKey;
        cameraQaStateRef.current = {
            requestedFocusZoom: fitRegion ? undefined : focusZoom,
            cameraMode: "SEGMENT_FOCUS_QA",
            autoFitSuppressed: false,
            center: fitRegion
                ? { latitude: fitRegion.latitude, longitude: fitRegion.longitude }
                : { latitude: cameraCenter.lat, longitude: cameraCenter.lng },
            reason: "SEGMENT_SELECTED",
            appliedAtMs: Date.now(),
        };
        if (typeof __DEV__ === "boolean" && __DEV__) {
            console.log("[camera-fit] segment focus padding:", {
                selectedRouteId: selectedNormalizedRoute?.id,
                legIndex,
                segmentId: focusedSegment?.id,
                pointCount: focusBounds.length,
                padding: focusPadding,
                fitRegion,
            });
        }
        mapRef.current?.resizeMap("SEGMENT_FOCUS_BEFORE_CAMERA");
        if (fitRegion) {
            const targetRegion = {
                ...fitRegion,
                zoomOffset: 0,
                duration: 680,
                easing: "Fly",
            };
            const targetCamera = getTmapRegionCameraTarget(targetRegion);
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                targetCamera.center,
                targetCamera.zoom,
                () => mapRef.current?.animateRegionTo(targetRegion)
            );
        } else {
            runCameraActionAfterDirectionPrewarm(
                focusKey,
                { latitude: cameraCenter.lat, longitude: cameraCenter.lng },
                focusZoom,
                () => mapRef.current?.animateCameraTo({
                    latitude: cameraCenter.lat,
                    longitude: cameraCenter.lng,
                    zoom: focusZoom,
                    duration: 680,
                    easing: "Fly",
                })
            );
        }
        setTimeout(() => {
            mapRef.current?.resizeMap("SEGMENT_FOCUS_AFTER_CAMERA");
        }, 760);
    }, [
        bottomPanelHeight,
        bottomSheetCollapsedOffset,
        bottomSheetExpandedOffset,
        bottomSheetMiddleOffset,
        bottomSheetSnap,
        insets.top,
        isBottomSheetHidden,
        selectedAlternative,
        selectedNormalizedRoute,
        transitWalkDetailOverlays,
        transitMapBottomOcclusionHeight,
        visibleBottomSheetHeight,
        windowWidth,
        windowHeight,
        runCameraActionAfterDirectionPrewarm,
    ]);

    const onMapMarkerPress = useCallback((event: { id: string; interactionId?: string }) => {
        const interaction = parseTransitMapInteractionId(event.interactionId);
        const legs = selectedAlternative?.transitLegs;
        if (!interaction || !Array.isArray(legs) || !legs[interaction.legIndex]) return;

        setFocusedRouteStepId(`leg-${interaction.legIndex}`);
        setFocusedTransitLegIndex(interaction.legIndex);
        setIsBottomSheetHidden(false);
        setBottomSheetSnap("middle");
        setIsBottomSheetCollapsed(false);

        if (interaction.kind === "leg") {
            setSelectedTransitMapStop(undefined);
            focusMapOnTransitLeg(interaction.legIndex);
            return;
        }

        const stop = legs[interaction.legIndex].passStops?.[interaction.stopIndex];
        if (!stop?.coord) {
            focusMapOnTransitLeg(interaction.legIndex);
            return;
        }
        setSelectedTransitMapStop({
            legIndex: interaction.legIndex,
            stopIndex: interaction.stopIndex,
        });

        const pressedMarker = mapMarkers.find((marker) => marker.id === event.id);
        const markerCoord = pressedMarker
            ? { lat: pressedMarker.latitude, lng: pressedMarker.longitude }
            : stop.coord;
        const focusZoom = Math.min(18, Math.max(17, mapZoom));
        const cameraCenter = offsetCoordByMeters(markerCoord, -55, 0);
        mapRef.current?.resizeMap("TRANSIT_STOP_FOCUS_BEFORE_CAMERA");
        mapRef.current?.animateCameraTo({
            latitude: cameraCenter.lat,
            longitude: cameraCenter.lng,
            zoom: focusZoom,
            duration: 460,
            easing: "Fly",
        });
        setTimeout(() => {
            mapRef.current?.resizeMap("TRANSIT_STOP_FOCUS_AFTER_CAMERA");
        }, 540);
    }, [focusMapOnTransitLeg, mapMarkers, mapZoom, selectedAlternative]);

    const selectedRouteStepId = focusedRouteStepId ?? (typeof focusedTransitLegIndex === "number"
        ? `leg-${focusedTransitLegIndex}`
        : undefined);
    const focusRouteInfoStep = useCallback((step: RouteStep) => {
        setFocusedRouteStepId(step.id);
        const match = step.id.match(/^leg-(\d+)$/);
        if (match?.[1] && isTransitMode) {
            focusMapOnTransitLeg(Number(match[1]));
            return;
        }

        const coordinates = step.coordinates ?? [];
        if (coordinates.length >= 2) {
            mapRef.current?.fitToCoordinates(coordinates, { padding: 84 });
            return;
        }
        const coordinate = coordinates[0];
        if (coordinate) {
            mapRef.current?.animateCameraTo({
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                zoom: Math.max(mapZoom, 16),
                duration: 520,
                easing: "Fly",
            });
        }
    }, [focusMapOnTransitLeg, isTransitMode, mapZoom]);

    const canEnterRouteDetail = isRouteSelectionStage && hasRouteReady && !!selectedAlternative && !etaLoading;
    const onEnterRouteDetailView = useCallback(() => {
        if (!canEnterRouteDetail || !sessionId) return;

        persistCurrentRoutePlannerInitial();
        router.replace({
            pathname: "/schedule/route-planner",
            params: {
                sessionId,
                routeIndex: selectedVisibleAlternativeIndex >= 0 ? String(selectedVisibleAlternativeIndex) : "0",
                sheetState: "middle",
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
    const shouldUseDetachedTransitDetailScreen = false;

    if (isTransitDetailMode && shouldUseTransitReferenceScreen) {
        const transitLegs = selectedAlternative?.transitLegs ?? [];
        const departureText = formatTransitDepartureNow();
        const departureTimeText = departureText.replace(/\s*출발$/, "");
        const referenceTravelModes: TravelMode[] = ["TRANSIT", "CAR", "WALK", "BIKE"];

        return (
            <View style={styles.transitReferenceScreen}>
                <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
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
                                    <Pressable
                                        onPress={goBack}
                                        hitSlop={10}
                                        accessibilityRole="button"
                                        accessibilityLabel="경로 화면 닫기"
                                        style={styles.transitReferenceCloseButton}
                                    >
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
                                ? (selectedAlternative ? formatRouteInfoDuration(selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative.minutes) : "대중교통")
                                : TRAVEL_MODE_META[travelModeItem].label;
                            return (
                                <Pressable
                                    key={`reference-mode-${travelModeItem}`}
                                    onPress={() => setTravelMode(travelModeItem)}
                                    accessibilityRole="radio"
                                    accessibilityLabel={`${TRAVEL_MODE_META[travelModeItem].label} 이동수단`}
                                    accessibilityState={{ selected }}
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
                                    accessibilityRole="tab"
                                    accessibilityLabel={`${label} 경로 필터`}
                                    accessibilityState={{ selected }}
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
                            {" 출발 기준"}
                        </Text>
                        <Text style={styles.transitReferenceSortText}>추천 경로순</Text>
                    </View>

                    <View style={styles.transitReferenceDetailPanel}>
                        {etaLoading ? (
                            <View style={styles.transitReferenceLoadingRow}>
                                <BrandedLoader
                                    size="button"
                                    variant="route"
                                    accessibilityLabel="경로 옵션을 계산하고 있어요"
                                />
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
                                            {formatRouteInfoDuration(selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative.minutes)}
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
                                                    accessibilityRole="button"
                                                    accessibilityLabel={[timelineTitle, legMetaText, assistText].filter(Boolean).join(", ")}
                                                    accessibilityHint="지도에서 이 이동 구간을 확대합니다"
                                                    accessibilityState={{ selected: isFocusedLeg }}
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

                                <Pressable
                                    onPress={submit}
                                    accessibilityRole="button"
                                    accessibilityLabel="선택한 경로 저장"
                                    accessibilityState={{ disabled: !canSubmitRoute, busy: etaLoading || routeSubmitPending }}
                                    disabled={!canSubmitRoute}
                                    style={styles.transitReferenceSaveButton}
                                >
                                    <Text style={styles.transitReferenceSaveText}>▣ 경로 저장</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                </ScrollView>
            </View>
        );
    }

    if (isTransitDetailMode && shouldUseDetachedTransitDetailScreen) {
        const routeDurationText = formatRouteInfoDuration(selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative?.minutes);
        const arrivalText = selectedTransitMeta?.arrivalText ?? selectedTransitTimeRange.split(" | ")[0]?.split(" - ")[1] ?? "";
        const routeHeaderLine = selectedAlternative ? getPrimaryTransitLineLabel(selectedAlternative.transitLegs) : "대중교통";
        const routeHeaderTransferText = typeof selectedAlternative?.transferCount === "number" && selectedAlternative.transferCount > 0
            ? ` + 환승 ${selectedAlternative.transferCount}회`
            : "";
        const routeHeaderTitle = `${routeHeaderLine}${routeHeaderTransferText} | ${routeDurationText}`;
        const routeHeaderIcon = selectedAlternative?.transitLegs?.find((leg) => isRideLegKind(leg.kind))?.kind === "BUS"
            ? "bus"
            : "train";

        return (
            <View style={styles.routeDetailScreen}>
                <StatusBar
                    barStyle={isDark ? "light-content" : "dark-content"}
                    backgroundColor="transparent"
                    translucent
                />
                <View style={[styles.routeDetailMapFrame, { height: Math.max(258, Math.round(windowHeight * 0.30)) }]}>
                    <TmapMapView
                        ref={mapRef}
                        style={styles.routeDetailMapView}
                        errorOverlayTop={96}
                        camera={INITIAL_CAMERA}
                        nightModeEnabled={isDark}
                        showLocationButton={false}
                        showZoomControls={false}
                        onTapMap={onTapMap}
                        onMarkerPress={onMapMarkerPress}
                        onZoomChanged={onMapZoomChanged}
                        onCameraChanged={onMapCameraChanged}
                        onInitialized={() => setIsMapInitialized(true)}
                        onMapLayoutReport={onMapLayoutReport}
                        markers={mapMarkers}
                        pathOverlays={themedMapPathOverlays}
                        pathOverlayZoom={mapZoom}
                        pathCoords={travelMode === "TRANSIT" ? undefined : pathOverlayCoords}
                        pathColor={MAP_GUIDE_ROUTE_BLUE}
                        pathWidth={routeStrokeStyle.mainWidth}
                        pathOutlineColor={getMapRouteCasingColor(shouldRenderTransitDetailDark)}
                        pathOutlineWidth={routeStrokeStyle.outlineWidth}
                        clearRouteOverlays={isRouteQaBaseOnly}
                        routeOverlayScope={routeOverlayScopeKey}
                        mapBaseDimOpacity={qaMapBaseDimOpacity}
                        routeFocusMode={isRouteDetailMode}
                        fallbackBackgroundColor={isDark ? "#0B1220" : "#EEF2F6"}
                        fallbackTextColor={colors.textSecondary}
                    />
                    <View pointerEvents="box-none" style={[styles.routeDetailMapHeader, { paddingTop: insets.top + 10 }]}>
                        <Pressable
                            onPress={goBack}
                            accessibilityRole="button"
                            accessibilityLabel="뒤로가기"
                            style={styles.routeDetailFloatingButton}
                        >
                            <Ionicons name="chevron-back" size={28} color="#F5F7FA" />
                        </Pressable>
                        <View style={styles.routeDetailTitlePill}>
                            <Ionicons name={routeHeaderIcon} size={18} color="#8FA20B" />
                            <Text numberOfLines={1} style={styles.routeDetailHeaderTitle}>
                                {routeHeaderTitle}
                            </Text>
                        </View>
                        <Pressable
                            onPress={submit}
                            accessibilityRole="button"
                            accessibilityLabel="선택한 경로 저장"
                            accessibilityState={{ disabled: !canSubmitRoute, busy: etaLoading || routeSubmitPending }}
                            disabled={!canSubmitRoute}
                            style={styles.routeDetailFloatingButton}
                        >
                            <Ionicons name="bookmark-outline" size={24} color="#F5F7FA" />
                        </Pressable>
                    </View>
                </View>

                <View style={styles.routeDetailPanel}>
                    <View style={styles.routeDetailSheetHandle} />
                    <ScrollView
                        style={styles.routeDetailPanelScroll}
                        contentContainerStyle={[
                            styles.routeDetailPanelContent,
                            { paddingBottom: TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT + transitDetailActionBarPaddingBottom + 34 },
                        ]}
                        bounces={false}
                        alwaysBounceVertical={false}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.routeDetailSummaryCard}>
                            <View style={styles.routeDetailCompactSummary}>
                                <Text
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.76}
                                    style={styles.routeDetailCompactDuration}
                                >
                                    {routeDurationText}
                                </Text>
                                {!!selectedTransitMeta?.combinedText && (
                                    <Text numberOfLines={1} style={styles.routeDetailMetaText}>
                                        {selectedTransitMeta.combinedText}
                                    </Text>
                                )}

                                {selectedTransitProgressSegments.length > 0 && (
                                    <TransitRouteProgressBar
                                        segments={selectedTransitProgressSegments}
                                        isDark
                                        compact
                                    />
                                )}
                            </View>

                            <View style={styles.routeDetailDivider} />

                            <Text style={styles.routeDetailBaseTimeText}>
                                {formatTransitClock(selectedRouteDepartureAt)} 기준
                            </Text>

                            {selectedRouteInfo ? (
                                <RouteStepTimeline
                                    routeInfo={selectedRouteInfo}
                                    selectedStepId={selectedRouteStepId}
                                    selectedPassStop={selectedTransitMapStop ? {
                                        stepId: `leg-${selectedTransitMapStop.legIndex}`,
                                        stopIndex: selectedTransitMapStop.stopIndex,
                                    } : undefined}
                                    onStepPress={focusRouteInfoStep}
                                    forceDark
                                    primaryTextColor="#F5F7FA"
                                    secondaryTextColor="#9CA3AF"
                                    compact
                                />
                            ) : (
                                <View style={styles.routeDetailLoadingRow}>
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="상세 경로를 불러오고 있어요"
                                    />
                                    <Text style={styles.routeDetailEmptyText}>
                                        상세 경로를 불러오는 중입니다.
                                    </Text>
                                </View>
                            )}
                        </View>
                    </ScrollView>
                </View>

                {!!selectedAlternative && (
                    <View style={[styles.routeDetailActionBar, { paddingBottom: transitDetailActionBarPaddingBottom }]}>
                        <View style={styles.routeDetailActionEta}>
                            <Text style={styles.routeDetailActionDuration}>{routeDurationText}</Text>
                            <Text style={styles.routeDetailActionArrival}>
                                {arrivalText ? `${arrivalText} 도착` : "도착 시간 확인"}
                            </Text>
                        </View>
                        <View style={styles.routeDetailActionButtons}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="지도에서 전체 경로 미리보기"
                                onPress={() => {
                                    const previewCoords = pathOverlayCoords ?? [];
                                    if (previewCoords.length >= 2) {
                                        mapRef.current?.fitToCoordinates(previewCoords, { padding: 72 });
                                    }
                                }}
                                style={styles.routeDetailPreviewButton}
                            >
                                <Ionicons name="bus" size={18} color="#4B9DFF" />
                                <Text style={styles.routeDetailPreviewButtonText}>미리보기</Text>
                            </Pressable>
                            <Pressable
                                onPress={submit}
                                accessibilityRole="button"
                                accessibilityLabel="선택한 경로 저장"
                                accessibilityState={{ disabled: !canSubmitRoute, busy: etaLoading || routeSubmitPending }}
                                disabled={!canSubmitRoute}
                                style={styles.routeDetailSaveButton}
                            >
                                <Ionicons name="checkmark" size={18} color="#111317" />
                                <Text style={styles.routeDetailSaveButtonText}>경로 저장</Text>
                            </Pressable>
                        </View>
                    </View>
                )}
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <StatusBar
                barStyle={isDark ? "light-content" : "dark-content"}
                backgroundColor="transparent"
                translucent
            />
            <TmapMapView
                ref={mapRef}
                style={styles.fullMap}
                errorOverlayTop={Math.max(insets.top + 72, 104)}
                camera={INITIAL_CAMERA}
                nightModeEnabled={isDark}
                // 경로 상세에서는 출발지/도착지 마커가 기준이다. WebView 자체 위치 버튼은
                // 권한 실패를 사용자에게 설명할 수 없으므로 노출하지 않는다.
                showLocationButton={false}
                showZoomControls={false}
                onTapMap={onTapMap}
                onMarkerPress={onMapMarkerPress}
                onZoomChanged={onMapZoomChanged}
                onCameraChanged={onMapCameraChanged}
                onInitialized={() => setIsMapInitialized(true)}
                onMapLayoutReport={onMapLayoutReport}
                markers={mapMarkers}
                pathOverlays={themedMapPathOverlays}
                pathOverlayZoom={mapZoom}
                pathCoords={travelMode === "TRANSIT" ? undefined : pathOverlayCoords}
                pathColor={MAP_GUIDE_ROUTE_BLUE}
                pathWidth={routeStrokeStyle.mainWidth}
                pathOutlineColor={getMapRouteCasingColor(shouldRenderTransitDetailDark)}
                pathOutlineWidth={routeStrokeStyle.outlineWidth}
                clearRouteOverlays={isRouteQaBaseOnly}
                routeOverlayScope={routeOverlayScopeKey}
                mapBaseDimOpacity={qaMapBaseDimOpacity}
                routeFocusMode={isRouteDetailMode}
                fallbackBackgroundColor={isDark ? "#0B1220" : "#EEF2F6"}
                fallbackTextColor={colors.textSecondary}
            />

            {shouldShowZoomControls && !isRouteDetailMode && (
                <View style={styles.zoomOverlay}>
                    <View style={[styles.zoomControlCard, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="지도 확대"
                            onPress={onPressZoomIn}
                            style={styles.zoomControlBtn}
                        >
                            <Text style={[styles.zoomControlText, { color: colors.textPrimary }]}>+</Text>
                        </Pressable>
                        <View style={[styles.zoomDivider, { backgroundColor: colors.border }]} />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="지도 축소"
                            onPress={onPressZoomOut}
                            style={styles.zoomControlBtn}
                        >
                            <Text style={[styles.zoomControlText, { color: colors.textPrimary }]}>-</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            {isRouteDetailMode ? (
                <View style={[styles.transitMapRouteHeader, { paddingTop: Math.max(insets.top - 2, 8) }]}>
                    <Pressable
                        onPress={goBack}
                        accessibilityRole="button"
                        accessibilityLabel="뒤로가기"
                        style={[styles.transitMapHeaderIconButton, { backgroundColor: transitRouteChipBg }]}
                    >
                        <Ionicons name="chevron-back" size={24} color={shouldRenderTransitDetailDark ? "#FFFFFF" : "#111827"} />
                    </Pressable>
                    <Pressable
                        onPress={() => openRoutePointEditorFromHeader("origin")}
                        accessibilityRole="button"
                        accessibilityLabel="출발지와 도착지 수정"
                        style={styles.transitMapRouteSummaryPill}
                    >
                        <Ionicons name={selectedDetailHeaderIcon} size={16} color="#111317" />
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.76} style={styles.transitMapRouteSummaryText}>
                            {selectedDetailHeaderTitle}
                        </Text>
                    </Pressable>
                    {typeof nextHeaderAlternativeIndex === "number" && !!nextHeaderLabel && (
                        <Pressable
                            onPress={() => selectAlternativeByIndex(nextHeaderAlternativeIndex, false)}
                            accessibilityRole="button"
                            accessibilityLabel={`다음 경로 ${nextHeaderLabel}`}
                            style={[styles.transitMapRouteNextChip, { backgroundColor: transitRouteChipBg }]}
                        >
                            <Ionicons name={nextHeaderIcon} size={15} color={nextHeaderColor} />
                            <Text
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.68}
                                style={[styles.transitMapRouteNextText, { color: shouldRenderTransitDetailDark ? "#FFFFFF" : transitRouteChipText }]}
                            >
                                {nextHeaderLabel}
                            </Text>
                        </Pressable>
                    )}
                    <Pressable
                        onPress={isTransitMode ? openTransitDeparturePicker : goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel={isTransitMode ? "출발 시각 선택" : "일정 목록으로 이동"}
                        style={[styles.transitMapScheduleButton, { backgroundColor: transitRouteChipBg }]}
                    >
                        <Ionicons name="calendar-outline" size={19} color={shouldRenderTransitDetailDark ? "#FFFFFF" : "#111827"} />
                    </Pressable>
                </View>
            ) : (
            <View style={[styles.topOverlay, { paddingTop: insets.top + 4 }]}>
                <View style={styles.searchOverlayRow}>
                    <Pressable
                        onPress={goBack}
                        accessibilityRole="button"
                        accessibilityLabel="뒤로가기"
                        style={[styles.inlineCloseBtn, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}
                    >
                        <Text style={[styles.inlineCloseBtnText, { color: colors.textPrimary }]}>‹</Text>
                    </Pressable>

                    <Pressable
                        onPress={() => openRoutePointEditorFromHeader("origin")}
                        disabled={!isRoutePointLocked}
                        accessible={isRoutePointLocked}
                        accessibilityRole="button"
                        accessibilityLabel="출발지와 도착지 수정"
                        style={[
                            styles.searchInputWrap,
                            styles.searchField,
                            styles.overlaySurface,
                            { borderColor: searching ? colors.inputBorderFocused : colors.inputBorder, backgroundColor: overlayBoxBg },
                        ]}
                    >
                        <TextInput
                            accessible={!isRoutePointLocked}
                            value={searchQuery}
                            onChangeText={handleSearchChange}
                            accessibilityLabel={!hasActiveTarget
                                ? "출발지 또는 도착지 검색"
                                : activeTarget === "destination"
                                    ? "도착지 검색"
                                    : "출발지 검색"}
                            accessibilityHint="장소 이름이나 주소를 입력하세요"
                            placeholder={
                                isRoutePointLocked
                                    ? "출/도 탭을 눌러 위치 수정"
                                    : !hasActiveTarget
                                        ? "출/도 탭을 선택해 주세요"
                                        : (activeTarget === "origin" ? "출발지 검색" : "도착지 검색")
                            }
                            placeholderTextColor={colors.inputPlaceholder}
                            returnKeyType="search"
                            editable={!isRoutePointLocked && hasActiveTarget}
                            textContentType="none"
                            autoComplete="off"
                            secureTextEntry={false}
                            style={[styles.searchInput, { color: colors.textPrimary }]}
                        />
                        {searching
                                ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="장소를 검색하고 있어요"
                                        style={styles.searchIcon}
                                    />
                                )
                                : searchQuery.length > 0
                                    ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="장소 검색어 지우기"
                                            onPress={clearPlaceSearch}
                                            style={styles.searchIcon}
                                        >
                                            <Text style={{ color: colors.textDisabled, fontSize: 16 }}>✕</Text>
                                    </Pressable>
                                    ) : null
                        }
                    </Pressable>

                    <View style={[styles.targetCompactWrap, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                        <Pressable
                            onPress={onPressOriginTarget}
                            accessibilityRole="button"
                            accessibilityLabel="출발지 선택"
                            accessibilityState={{ selected: activeTarget === "origin" }}
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
                            accessibilityRole="button"
                            accessibilityLabel="도착지 선택"
                            accessibilityState={{ selected: activeTarget === "destination" }}
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
                    <Pressable
                        onPress={isTransitMode && hasRouteReady ? openTransitDeparturePicker : goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel={isTransitMode && hasRouteReady ? "출발 시각 선택" : "일정 목록으로 이동"}
                        style={[styles.plannerScheduleButton, styles.overlaySurface, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}
                    >
                        <Ionicons name="calendar-outline" size={19} color={colors.textPrimary} />
                    </Pressable>
                </View>

                {!isRoutePointLocked && hasActiveTarget && !!searchQuery.trim() && !searching &&
                    completedSearchQuery === searchQuery.trim() && (searchError || searchResults.length === 0) && (
                    <CalendarGlassSurface
                        prominent
                        variant="mapCard"
                        style={[styles.searchResultWrap, styles.overlaySurface, { borderColor: colors.border }]}
                    >
                        <View style={styles.searchStateRow} accessibilityLiveRegion="polite">
                            <Text style={[styles.searchStateText, { color: colors.textSecondary }]}>
                                {searchError
                                    ? "장소 검색에 실패했습니다. 네트워크 연결을 확인해 주세요."
                                    : "검색 결과가 없습니다. 다른 장소명이나 주소로 검색해 보세요."}
                            </Text>
                            {!!searchError && (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="장소 다시 검색"
                                    onPress={() => handleSearchChange(searchQuery)}
                                    style={[styles.searchStateRetryButton, { backgroundColor: colors.selectedDayBg }]}
                                >
                                    <Text style={[styles.searchStateRetryText, { color: colors.selectedDayText }]}>다시 검색</Text>
                                </Pressable>
                            )}
                        </View>
                    </CalendarGlassSurface>
                )}

                {!!searchResults.length && !isRoutePointLocked && hasActiveTarget && (
                    <CalendarGlassSurface
                        prominent
                        variant="mapCard"
                        style={[styles.searchResultWrap, styles.overlaySurface, { borderColor: colors.border }]}
                    >
                        {searchResults.slice(0, 6).map((item, index) => (
                            <Pressable
                                key={`${item.lat}:${item.lng}:${index}`}
                                accessibilityRole="button"
                                accessibilityLabel={`${item.name}, ${item.address || "주소 정보 없음"}`}
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
                                {!!(item.category || typeof item.distanceMeters === "number") && (
                                    <Text numberOfLines={1} style={{ color: "#1B9B50", fontSize: 11, marginTop: 1 }}>
                                        {[item.category, typeof item.distanceMeters === "number" ? `기준점에서 ${formatDistance(item.distanceMeters)}` : undefined]
                                            .filter(Boolean)
                                            .join(" · ")}
                                    </Text>
                                )}
                                <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                                    {item.address}
                                </Text>
                            </Pressable>
                        ))}
                    </CalendarGlassSurface>
                )}

                <CalendarGlassSurface
                    variant="mapCard"
                    style={[styles.routePreviewCard, styles.overlaySurface, { borderColor: colors.border }]}
                >
                    <Text numberOfLines={1} style={[styles.routePreviewMain, { color: colors.textPrimary }]}>
                        {originDisplay} → {destinationDisplay}
                    </Text>
                    {!hasRouteReady && (
                        <Text style={[styles.routePreviewSub, { color: colors.textSecondary }]}>
                            출/도 탭을 선택한 뒤 지도 탭으로 위치를 지정하세요.
                        </Text>
                    )}
                    {hasOriginCoords && (
                        <View style={styles.routePreviewActionRow}>
                            <Pressable
                                onPress={saveCurrentOriginAsFavorite}
                                accessibilityRole="button"
                                accessibilityLabel={originUsesDefault
                                    ? `${originDisplay}, 기본 출발지로 설정됨`
                                    : `${originDisplay}, 기본 출발지로 설정`}
                                accessibilityState={{ selected: originUsesDefault }}
                                style={[styles.routePreviewActionBtn, { backgroundColor: overlayPanelBg }]}
                            >
                                <Text style={[styles.routePreviewActionText, { color: colors.textPrimary }]}>
                                    {originUsesDefault ? "기본 출발지" : "기본 출발지로 설정"}
                                </Text>
                            </Pressable>
                        </View>
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

                </CalendarGlassSurface>
            </View>
            )}

            {isRouteSelectionStage && (
                <View style={styles.routeSelectionStageOverlay} pointerEvents="box-none">
                    <CalendarGlassSurface
                        prominent
                        variant="mapCard"
                        style={[
                            styles.routeSelectionStagePanel,
                            styles.overlaySurface,
                            { borderColor: colors.border, paddingBottom: Math.max(insets.bottom + 12, 20) },
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
                                    {...getRouteSelectionAccessibilityProps(
                                        "radio",
                                        `${TRAVEL_MODE_META[travelModeItem].label} 이동수단`,
                                        travelMode === travelModeItem,
                                    )}
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
                                                {...getRouteSelectionAccessibilityProps(
                                                    "tab",
                                                    `${label} 경로 필터`,
                                                    selected,
                                                )}
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
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="경로 옵션을 계산하고 있어요"
                                    />
                                    <Text style={[styles.alternativeLoadingText, { color: colors.textSecondary }]}>
                                        경로 옵션 계산 중..
                                    </Text>
                                </View>
                            ) : null}

                            {!etaLoading && !!alternativesError ? (
                                <View style={styles.alternativeErrorWrap}>
                                    <Text style={[styles.alternativeErrorText, { color: colors.textSecondary }]}>
                                        {alternativesError}
                                    </Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="경로 다시 검색"
                                        onPress={retryRouteSearch}
                                        style={[styles.alternativeRetryButton, { backgroundColor: colors.selectedDayBg }]}
                                    >
                                        <Ionicons name="refresh" size={15} color={colors.selectedDayText} />
                                        <Text style={[styles.alternativeRetryText, { color: colors.selectedDayText }]}>다시 검색</Text>
                                    </Pressable>
                                </View>
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
                                        const routeLabel = getNaverLikeRouteRecommendationLabel(
                                            option,
                                            visibleAlternatives,
                                            index
                                        );
                                        const summary = option.transitModeSummary ?? formatAlternativeInfo(option);
                                        const stepSummary = option.stepSummary?.trim();
                                        return (
                                            <Pressable
                                                key={`stage-${option.id}`}
                                                {...getRouteSelectionAccessibilityProps(
                                                    "radio",
                                                    [
                                                        routeLabel,
                                                        formatDuration(option.minutes),
                                                        summary,
                                                        stepSummary,
                                                    ].filter(Boolean).join(", "),
                                                    selected,
                                                )}
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
                            {...getRouteSelectionConfirmAccessibilityProps(canEnterRouteDetail)}
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
                    </CalendarGlassSurface>
                </View>
            )}

            {!isRouteSelectionStage && (
                <View
                    style={[
                        styles.bottomOverlay,
                    ]}
                    pointerEvents={isBottomSheetHidden ? "none" : "box-none"}
                >
                    <Animated.View
                        pointerEvents={isBottomSheetHidden ? "none" : "auto"}
                        onLayout={(event) => {
                            const measured = Math.round(event.nativeEvent.layout.height);
                            setHasBottomSheetMeasured(true);
                            setBottomPanelHeight((prev) => (prev === measured ? prev : measured));
                        }}
                        style={[
                            styles.bottomPanelMotion,
                            {
                                height: isRouteDetailMode ? bottomPanelMaxHeight : undefined,
                                maxHeight: bottomPanelMaxHeight,
                                opacity: isBottomSheetHidden ? 0 : 1,
                                transform: [{ translateY: bottomSheetTranslateY }],
                            },
                        ]}
                    >
                        <CalendarGlassSurface
                            prominent
                            variant="mapCard"
                            tone={isRouteDetailMode ? "solidCard" : "default"}
                            forceColorScheme={isRouteDetailMode ? mode : undefined}
                            style={[
                                styles.bottomPanel,
                                isRouteDetailMode ? styles.bottomPanelDetail : null,
                                {
                                    borderColor: isRouteDetailMode ? "transparent" : colors.border,
                                    backgroundColor: isRouteDetailMode ? detailPanelBg : undefined,
                                },
                            ]}
                        >
                        <View
                            style={[
                                styles.bottomHandleTouchArea,
                                isRouteDetailMode ? styles.bottomHandleTouchAreaDetail : null,
                            ]}
                            {...bottomHandlePanResponder.panHandlers}
                        >
                            <View
                                style={[
                                    styles.bottomHandle,
                                    isRouteDetailMode ? styles.bottomHandleDetail : null,
                                    {
                                        backgroundColor: isRouteDetailMode ? detailBorderColor : colors.border,
                                        opacity: 0.75,
                                    },
                                ]}
                            />
                        </View>
                        <ScrollView
                            style={[
                                styles.bottomPanelScroll,
                                typeof bottomPanelScrollViewportHeight === "number"
                                    ? {
                                        maxHeight: bottomPanelScrollViewportHeight,
                                        height: isRouteDetailMode ? bottomPanelScrollViewportHeight : undefined,
                                    }
                                    : null,
                            ]}
                            contentContainerStyle={[
                                styles.bottomPanelScrollContent,
                                isRouteDetailMode ? styles.bottomPanelScrollContentDetail : null,
                                { paddingBottom: bottomPanelScrollBottomPadding },
                            ]}
                            keyboardShouldPersistTaps="handled"
                            scrollEnabled={canScrollBottomSheetContent}
                            nestedScrollEnabled
                            bounces={false}
                            alwaysBounceVertical={false}
                            showsVerticalScrollIndicator={false}
                        >
                        {!hasRouteReady ? (
                            <View style={[styles.routeHintCard, { borderColor: colors.border, backgroundColor: overlayBoxBg }]}>
                                <Text style={[styles.routeHintText, { color: colors.textSecondary }]}>
                                    출발지와 도착지를 모두 선택하면 경로 정보가 표시됩니다.
                                </Text>
                            </View>
                        ) : (
                            <>
                                {!!selectedAlternativeQualityNotice && !etaLoading && (
                                    <View style={[
                                        styles.routeQualityWarning,
                                        {
                                            backgroundColor: isDark ? "rgba(120,53,15,0.30)" : "#FFF7E6",
                                            borderColor: isDark ? "rgba(251,191,36,0.42)" : "#F4C76A",
                                        },
                                    ]}>
                                        <Ionicons name="alert-circle-outline" size={17} color={isDark ? "#FCD34D" : "#A15C00"} />
                                        <Text style={[styles.routeQualityWarningText, { color: isDark ? "#FDE68A" : "#7A4500" }]}>
                                            {selectedAlternativeQualityNotice}
                                        </Text>
                                    </View>
                                )}
                                {shouldShowRequiredMapAttribution(selectedAlternative) && !!selectedAlternative?.attributionText && !!selectedAlternative.attributionUrl && !etaLoading && (
                                    <Pressable
                                        accessibilityRole="link"
                                        accessibilityLabel={`${selectedAlternative.attributionText} 지도 정보 열기`}
                                        onPress={openSelectedRouteAttribution}
                                        style={styles.routeAttributionLink}
                                    >
                                        <Text style={[styles.routeAttributionText, { color: colors.textSecondary }]}>
                                            {selectedAlternative.attributionText} · 지도 수정
                                        </Text>
                                        <Ionicons name="open-outline" size={13} color={colors.textSecondary} />
                                    </Pressable>
                                )}

                                <View style={[
                                    styles.alternativeSection,
                                    isRouteDetailMode ? styles.alternativeSectionDetail : null,
                                    {
                                        borderColor: isRouteDetailMode ? "transparent" : colors.border,
                                        backgroundColor: detailPanelBg,
                                    },
                                ]}>
                                    {travelMode === "TRANSIT" && !isRouteDetailMode && !etaLoading && !alternativesError && !!routeAlternatives.length && (
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
                                            <BrandedLoader
                                                size="button"
                                                variant="route"
                                                accessibilityLabel="경로 옵션을 계산하고 있어요"
                                            />
                                            <Text style={[styles.alternativeLoadingText, { color: colors.textSecondary }]}>경로 옵션 계산 중...</Text>
                                        </View>
                                    ) : null}

                                    {!etaLoading && !!alternativesError ? (
                                        <View style={styles.alternativeErrorWrap}>
                                            <Text style={[styles.alternativeErrorText, { color: colors.textSecondary }]}>{alternativesError}</Text>
                                            <Pressable
                                                onPress={retryRouteSearch}
                                                accessibilityRole="button"
                                                accessibilityLabel="경로 다시 검색"
                                                style={[styles.alternativeRetryButton, { backgroundColor: colors.selectedDayBg }]}
                                            >
                                                <Ionicons name="refresh" size={15} color={colors.selectedDayText} />
                                                <Text style={[styles.alternativeRetryText, { color: colors.selectedDayText }]}>다시 검색</Text>
                                            </Pressable>
                                        </View>
                                    ) : null}

                                    {!etaLoading && !alternativesError && !routeAlternatives.length ? (
                                        <Text style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}>표시할 대안 경로가 없습니다.</Text>
                                    ) : null}

                                    {!etaLoading && !alternativesError && !!routeAlternatives.length && !visibleAlternatives.length ? (
                                        <Text style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}>선택한 필터에 해당하는 경로가 없습니다.</Text>
                                    ) : null}

                                    {!etaLoading && !alternativesError && !!visibleAlternatives.length && (
                                        <View style={[
                                            styles.selectedRouteSection,
                                            isRouteDetailMode ? styles.selectedRouteSectionDetail : null,
                                        ]}>
                                            {!!selectedAlternative && (
                                                <View
                                                    style={[
                                                        isTransitMode ? styles.transitReferenceSummaryCard : styles.transitAlternativeCard,
                                                        isRouteDetailMode ? styles.transitReferenceSummaryCardDetail : null,
                                                        !isTransitMode ? styles.selectedRouteDetailCard : null,
                                                        {
                                                            borderColor: isTransitMode ? "transparent" : colors.selectedDayBg,
                                                            borderBottomColor: routeDetailSummarySurface.borderBottomColor,
                                                            backgroundColor: routeDetailSummarySurface.backgroundColor,
                                                        },
                                                    ]}
                                                >
                                                    {isRouteDetailMode ? (
                                                        <View style={styles.transitDetailHeroSummary}>
                                                            <Text
                                                                numberOfLines={1}
                                                                adjustsFontSizeToFit
                                                                minimumFontScale={0.76}
                                                                style={[styles.transitDetailHeroDuration, { color: detailPrimaryText }]}
                                                            >
                                                                {selectedAlternative.transitServiceState === "not_operating"
                                                                    ? "운행 종료"
                                                                    : formatRouteInfoDuration(selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative.minutes)}
                                                            </Text>
                                                            {!!selectedTransitMeta?.combinedText && (
                                                                <Text
                                                                    numberOfLines={1}
                                                                    style={[
                                                                        styles.transitDetailHeroMetaText,
                                                                        { color: transitDetailSummaryPalette.metaTextColor },
                                                                    ]}
                                                                >
                                                                    {selectedTransitMeta.combinedText}
                                                                </Text>
                                                            )}
                                                        </View>
                                                    ) : (
                                                        <>
                                                            <View style={styles.selectedRouteSummaryHeader}>
                                                                <View style={[
                                                                    styles.selectedRouteDurationBlock,
                                                                    isTransitDetailMode && styles.selectedRouteDurationBlockCompact,
                                                                ]}>
                                                                    <Text style={[
                                                                        styles.selectedRouteOptimalText,
                                                                        isTransitDetailMode && styles.selectedRouteOptimalTextCompact,
                                                                        { color: isTransitDetailMode ? transitDetailControlText : colors.selectedDayBg },
                                                                    ]}>
                                                                        {selectedTransitStatusLabel}
                                                                    </Text>
                                                                    <Text style={[
                                                                        styles.transitDurationLarge,
                                                                        isTransitDetailMode && styles.transitDurationLargeCompact,
                                                                        { color: detailPrimaryText },
                                                                    ]}>
                                                                        {selectedAlternative.transitServiceState === "not_operating"
                                                                            ? "운행 종료"
                                                                            : formatRouteInfoDuration(selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative.minutes)}
                                                                    </Text>
                                                                </View>
                                                            </View>

                                                            {!!selectedTransitTimeRange && isTransitMode && (
                                                                <Text style={[
                                                                    styles.transitReferenceMetaText,
                                                                    isTransitDetailMode && styles.transitReferenceMetaTextCompact,
                                                                    { color: detailSecondaryText },
                                                                ]}>
                                                                    {selectedTransitTimeRange}
                                                                </Text>
                                                            )}
                                                        </>
                                                    )}

                                                    {!isTransitMode && (
                                                        <Text style={[styles.selectedRouteSummaryText, { color: detailPrimaryText }]}>
                                                            {formatAlternativeInfo(selectedAlternative)}
                                                        </Text>
                                                    )}

                                                    {isTransitMode && selectedTransitProgressSegments.length > 0 && (
                                                        <TransitRouteProgressBar
                                                            segments={selectedTransitProgressSegments}
                                                            isDark={isDark}
                                                            compact={isTransitDetailMode}
                                                        />
                                                    )}

                                                    {isTransitMode && !isTransitDetailMode && (
                                                        <View style={[
                                                            styles.transitDetailBaseTimeRow,
                                                            isTransitDetailMode && styles.transitDetailBaseTimeRowCompact,
                                                            { borderTopColor: detailBorderColor },
                                                        ]}>
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

                                                    {!isRouteDetailMode && !!selectedAlternativeStepPreview && (!Array.isArray(selectedAlternative.transitLegs) || selectedAlternative.transitLegs.length === 0) && (
                                                        <Text style={[styles.selectedRouteBodyText, { color: colors.textSecondary }]}>
                                                            {selectedAlternativeStepPreview}
                                                        </Text>
                                                    )}
                                                </View>
                                            )}

                                            {selectedRouteInfo ? (
                                                <View style={[
                                                    styles.transitReferenceTimeline,
                                                    isRouteDetailMode ? styles.transitReferenceTimelineDetail : null,
                                                ]}>
                                                    <RouteStepTimeline
                                                        routeInfo={selectedRouteInfo}
                                                        selectedStepId={selectedRouteStepId}
                                                        selectedPassStop={selectedTransitMapStop ? {
                                                            stepId: `leg-${selectedTransitMapStop.legIndex}`,
                                                            stopIndex: selectedTransitMapStop.stopIndex,
                                                        } : undefined}
                                                        onStepPress={focusRouteInfoStep}
                                                        forceDark={shouldRenderTransitDetailDark}
                                                        primaryTextColor={detailPrimaryText}
                                                        secondaryTextColor={detailSecondaryText}
                                                        compact={isRouteDetailMode}
                                                    />
                                                </View>
                                            ) : Array.isArray(selectedAlternative?.transitLegs) && selectedAlternative.transitLegs.length > 0 ? (
                                                    <View style={[styles.selectedRouteLegSection, { borderColor: detailBorderColor, backgroundColor: detailCardBg }]}>
                                                        <Text style={[styles.selectedRouteSectionTitle, { color: detailPrimaryText }]}>
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
                                                                        accessibilityRole="button"
                                                                        accessibilityLabel={[
                                                                            leg.label,
                                                                            fromTo,
                                                                            legMetaText,
                                                                            assistText,
                                                                        ].filter(Boolean).join(", ")}
                                                                        accessibilityHint="지도에서 이 이동 구간을 확대합니다"
                                                                        accessibilityState={{ selected: isFocusedLeg }}
                                                                        style={[
                                                                            styles.transitLegItemCard,
                                                                            styles.selectedRouteLegItemCard,
                                                                            {
                                                                                borderColor: isFocusedLeg ? colors.selectedDayBg : detailBorderColor,
                                                                                backgroundColor: isFocusedLeg
                                                                                    ? transitFocusedLegBg
                                                                                    : detailPanelBg,
                                                                            },
                                                                        ]}
                                                                    >
                                                                        <View style={styles.transitLegRow}>
                                                                            <View style={[styles.transitLegKindDot, { backgroundColor: kindMeta.color }]}>
                                                                                <Text style={styles.transitLegKindDotText}>{kindMeta.short}</Text>
                                                                            </View>
                                                                            <View style={styles.transitLegTextWrap}>
                                                                                <View style={styles.transitLegPrimaryRow}>
                                                                                    <Text numberOfLines={1} style={[styles.transitLegLabel, { color: detailPrimaryText }]}>
                                                                                        {leg.label}
                                                                                    </Text>
                                                                                    {!!legMetaText && (
                                                                                        <Text numberOfLines={1} style={[styles.transitLegMeta, { color: detailSecondaryText }]}>
                                                                                            {legMetaText}
                                                                                        </Text>
                                                                                    )}
                                                                                </View>
                                                                                {!assistText && !!fromTo && (
                                                                                    <Text numberOfLines={1} style={[styles.transitLegFromTo, { color: detailSecondaryText }]}>
                                                                                        {fromTo}
                                                                                    </Text>
                                                                                )}
                                                                                {!!assistText && (
                                                                                    <Text numberOfLines={2} style={[styles.transitLegAssist, { color: detailSecondaryText }]}>
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
                                                ) : null}
                                        </View>
                                    )}
                                </View>

                                {!isRouteDetailMode && (
                                    <Pressable
                                        onPress={submit}
                                        accessibilityRole="button"
                                        accessibilityLabel="선택한 경로 저장"
                                        style={[styles.confirmBtn, { backgroundColor: colors.selectedDayBg }]}
                                    >
                                        <Text style={[styles.confirmText, { color: colors.selectedDayText }]}>경로 저장</Text>
                                    </Pressable>
                                )}
                            </>
                        )}
                    </ScrollView>
                    </CalendarGlassSurface>
                </Animated.View>
                {isRouteDetailMode && !!selectedAlternative && !isBottomSheetHidden && (
                    <View
                        onLayout={(event) => {
                            const measured = Math.round(event.nativeEvent.layout.height);
                            setTransitActionBarHeight((prev) => (prev === measured ? prev : measured));
                        }}
                        style={[
                            styles.transitDetailActionBar,
                            {
                                backgroundColor: transitActionBarBg,
                                borderTopColor: detailBorderColor,
                                paddingBottom: transitDetailActionBarPaddingBottom,
                            },
                        ]}
                    >
                        {bottomSheetSnap === "collapsed" && selectedCollapsedRouteSummary && (
                            <View style={[styles.transitCollapsedSummaryRow, { borderBottomColor: detailBorderColor }]}>
                                <Text
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.82}
                                    style={[styles.transitCollapsedArrivalText, { color: transitDetailControlText }]}
                                >
                                    {selectedCollapsedRouteSummary.arrivalText ?? selectedTransitHeaderDuration}
                                </Text>
                                {!!selectedCollapsedRouteSummary.metricsText && (
                                    <Text
                                        numberOfLines={1}
                                        adjustsFontSizeToFit
                                        minimumFontScale={0.72}
                                        style={[styles.transitCollapsedMetricsText, { color: detailSecondaryText }]}
                                    >
                                        {selectedCollapsedRouteSummary.metricsText}
                                    </Text>
                                )}
                            </View>
                        )}
                        <View style={styles.transitDetailActionButtonRow}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={bottomSheetSnap === "collapsed" ? "상세 경로 보기" : "지도에서 전체 경로 보기"}
                                onPress={() => {
                                    if (bottomSheetSnap === "collapsed") {
                                        setBottomSheetSnap("middle");
                                        setIsBottomSheetCollapsed(false);
                                        return;
                                    }
                                    // 시트 상태가 바뀌면 시트 안전영역을 반영한 전체 경로 카메라가 다시 계산된다.
                                    setSelectedTransitMapStop(undefined);
                                    setFocusedTransitLegIndex(undefined);
                                    setFocusedRouteStepId(undefined);
                                    setBottomSheetSnap("collapsed");
                                    setIsBottomSheetCollapsed(true);
                                }}
                                style={[styles.transitDetailPreviewButton, { borderColor: detailBorderColor }]}
                            >
                                <Ionicons
                                    name={bottomSheetSnap === "collapsed" ? "list-outline" : "map-outline"}
                                    size={18}
                                    color={transitDetailControlText}
                                />
                                <Text
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.8}
                                    style={[styles.transitDetailPreviewText, { color: transitDetailControlText }]}
                                >
                                    {bottomSheetSnap === "collapsed" ? "상세 경로" : "지도 보기"}
                                </Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="선택한 경로 저장"
                                accessibilityState={{ disabled: !canSubmitRoute, busy: etaLoading || routeSubmitPending }}
                                onPress={submit}
                                disabled={!canSubmitRoute}
                                style={[
                                    styles.transitDetailSaveButton,
                                    { backgroundColor: transitDetailPrimaryActionBg },
                                    !canSubmitRoute && styles.transitDetailSaveButtonDisabled,
                                ]}
                            >
                                <Ionicons name="checkmark" size={18} color={transitDetailPrimaryActionText} />
                                <Text
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.8}
                                    style={[styles.transitDetailSaveText, { color: transitDetailPrimaryActionText }]}
                                >
                                    경로 저장
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                )}
            </View>
            )}

            {Platform.OS === "ios" ? (
                <Modal
                    visible={isTransitDeparturePickerOpen}
                    transparent
                    animationType="fade"
                    statusBarTranslucent
                    onRequestClose={() => setIsTransitDeparturePickerOpen(false)}
                    accessibilityViewIsModal
                >
                    <View style={styles.transitDeparturePickerModal}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="출발 시각 선택 닫기"
                            style={styles.transitDeparturePickerBackdrop}
                            onPress={() => setIsTransitDeparturePickerOpen(false)}
                        />
                        <View style={[styles.transitDeparturePickerSheet, { backgroundColor: detailPanelBg }]}>
                            <View style={styles.transitDeparturePickerHeader}>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="출발 시각 선택 취소"
                                    onPress={() => setIsTransitDeparturePickerOpen(false)}
                                    style={styles.transitDeparturePickerCommand}
                                >
                                    <Text style={[styles.transitDeparturePickerCommandText, { color: detailSecondaryText }]}>취소</Text>
                                </Pressable>
                                <View style={styles.transitDeparturePickerTitleRow}>
                                    <Ionicons name="time-outline" size={18} color={detailPrimaryText} />
                                    <Text style={[styles.transitDeparturePickerTitle, { color: detailPrimaryText }]}>출발 시각</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="출발 시각 적용"
                                    onPress={applyTransitDepartureTime}
                                    style={[styles.transitDeparturePickerCommand, styles.transitDeparturePickerApply]}
                                >
                                    <Text style={styles.transitDeparturePickerApplyText}>적용</Text>
                                </Pressable>
                            </View>
                            <DateTimePicker
                                value={draftTransitDepartureAt}
                                mode="datetime"
                                display="spinner"
                                locale="ko-KR"
                                minuteInterval={5}
                                minimumDate={new Date(Date.now() - 60_000)}
                                themeVariant={isDark ? "dark" : "light"}
                                onChange={(_event, value) => {
                                    if (value) setDraftTransitDepartureAt(value);
                                }}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="현재 시각으로 설정"
                                onPress={() => setDraftTransitDepartureAt(new Date())}
                                style={[styles.transitDepartureNowButton, { borderColor: detailBorderColor }]}
                            >
                                <Ionicons name="refresh" size={16} color={detailPrimaryText} />
                                <Text style={[styles.transitDepartureNowText, { color: detailPrimaryText }]}>현재 시각</Text>
                            </Pressable>
                        </View>
                    </View>
                </Modal>
            ) : null}

            {locationPromptTarget && (
                <Modal
                    visible
                    transparent
                    animationType="fade"
                    statusBarTranslucent
                    onRequestClose={closeLocationPrompt}
                >
                <View
                    accessibilityViewIsModal
                    style={styles.permissionOverlay}
                    pointerEvents="box-none"
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="위치 권한 안내 닫기"
                        accessibilityState={{ disabled: locationPromptLoading }}
                        disabled={locationPromptLoading}
                        style={styles.permissionBackdrop}
                        onPress={closeLocationPrompt}
                    />
                    <CalendarGlassSurface
                        variant="mapCard"
                        prominent
                        glow
                        style={[styles.permissionPrompt, { borderColor: colors.border }]}
                    >
                        <View style={styles.permissionIconWrap}>
                            <Ionicons name="navigate-outline" size={28} color={ORIGIN_COLOR} />
                        </View>
                        <Text style={[styles.permissionTitle, { color: colors.textPrimary }]}>
                            현재 위치를 {locationPromptTarget === "origin" ? "출발지" : "도착지"}로 사용할까요?
                        </Text>
                        <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
                            NoLate가 위치를 빠르게 채우고 ETA와 지각 위험도를 계산할 수 있도록 현재 위치 권한이 필요합니다.
                        </Text>
                        <View style={styles.permissionActions}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="위치 권한 안내 닫기"
                                onPress={closeLocationPrompt}
                                disabled={locationPromptLoading}
                                accessibilityState={{ disabled: locationPromptLoading }}
                                style={({ pressed }) => [
                                    styles.permissionSecondaryButton,
                                    {
                                        borderColor: colors.border,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                            >
                                <Text style={[styles.permissionSecondaryText, { color: colors.textPrimary }]}>나중에</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="위치 권한 요청 계속"
                                onPress={confirmLocationPrompt}
                                disabled={locationPromptLoading}
                                accessibilityState={{
                                    busy: locationPromptLoading,
                                    disabled: locationPromptLoading,
                                }}
                                style={({ pressed }) => [
                                    styles.permissionPrimaryButton,
                                    {
                                        backgroundColor: "rgba(33,184,90,0.20)",
                                        borderColor: "rgba(33,184,90,0.52)",
                                        opacity: pressed || locationPromptLoading ? 0.78 : 1,
                                    },
                                ]}
                            >
                                {locationPromptLoading ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="route"
                                        accessibilityLabel="위치 권한을 확인하고 있어요"
                                    />
                                ) : (
                                    <Text style={styles.permissionPrimaryText}>계속</Text>
                                )}
                            </Pressable>
                        </View>
                    </CalendarGlassSurface>
                </View>
                </Modal>
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
        borderColor: "rgba(34,197,94,0.36)",
        backgroundColor: ORIGIN_COLOR,
    },
    transitReferenceDestinationDot: {
        borderColor: "rgba(255,68,68,0.35)",
        backgroundColor: DESTINATION_COLOR,
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
    transitReferenceSaveButton: {
        minHeight: 56,
        marginTop: 10,
        borderWidth: 1,
        borderColor: "#55555A",
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    transitReferenceSaveText: {
        color: "#4D9BFF",
        fontSize: 17,
        fontWeight: "900",
    },
    container: {
        flex: 1,
    },
    routeDetailScreen: {
        flex: 1,
        backgroundColor: "#0B0C0F",
    },
    routeDetailMapHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 14,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        zIndex: 6,
    },
    routeDetailFloatingButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(7,9,13,0.86)",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.10)",
    },
    routeDetailTitlePill: {
        flex: 1,
        minHeight: 48,
        minWidth: 0,
        borderRadius: 24,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 8,
        backgroundColor: "rgba(7,9,13,0.86)",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.10)",
    },
    routeDetailHeaderTitle: {
        flex: 1,
        minWidth: 0,
        color: "#F5F7FA",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 22,
    },
    routeDetailMapFrame: {
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#111827",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.08)",
    },
    routeDetailMapView: {
        ...StyleSheet.absoluteFillObject,
    },
    routeDetailPanel: {
        flex: 1,
        marginTop: -22,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        backgroundColor: "#1C1D22",
        overflow: "hidden",
        zIndex: 5,
    },
    routeDetailSheetHandle: {
        alignSelf: "center",
        width: 54,
        height: 5,
        borderRadius: 999,
        marginTop: 10,
        marginBottom: 6,
        backgroundColor: "rgba(156,163,175,0.54)",
    },
    routeDetailPanelScroll: {
        flex: 1,
    },
    routeDetailPanelContent: {
        paddingHorizontal: 0,
        paddingTop: 8,
    },
    routeDetailSummaryCard: {
        borderWidth: 0,
        borderRadius: 0,
        backgroundColor: "transparent",
        paddingHorizontal: 24,
        paddingTop: 6,
        paddingBottom: 9,
        gap: 7,
    },
    routeDetailCompactSummary: {
        gap: 5,
    },
    routeDetailCompactDuration: {
        color: "#FFFFFF",
        fontSize: 38,
        fontWeight: "900",
        lineHeight: 44,
    },
    routeDetailMetaText: {
        color: "#C8CDD6",
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 20,
    },
    routeDetailDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: "rgba(255,255,255,0.10)",
    },
    routeDetailBaseTimeText: {
        color: "#C8CDD6",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 22,
        paddingTop: 0,
    },
    routeDetailEmptyText: {
        color: "#9CA3AF",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
    },
    routeDetailLoadingRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    routeDetailActionBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9,
        elevation: 9,
        minHeight: TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(255,255,255,0.10)",
        paddingTop: TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 12,
        backgroundColor: "rgba(9,10,13,0.97)",
    },
    routeDetailActionEta: {
        flex: 1,
        paddingBottom: 2,
        minWidth: 82,
    },
    routeDetailActionDuration: {
        color: "#FFFFFF",
        fontSize: 22,
        fontWeight: "900",
        lineHeight: 27,
    },
    routeDetailActionArrival: {
        color: "#F5F7FA",
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 20,
    },
    routeDetailActionButtons: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
    },
    routeDetailPreviewButton: {
        height: TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        minWidth: 108,
        borderRadius: 999,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        borderWidth: 1.4,
        borderColor: "rgba(75,157,255,0.42)",
        backgroundColor: "rgba(12,16,22,0.96)",
    },
    routeDetailPreviewButtonText: {
        color: "#4B9DFF",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 20,
    },
    routeDetailSaveButton: {
        height: TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        minWidth: 116,
        borderRadius: 999,
        paddingHorizontal: 17,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        backgroundColor: "#4B9DFF",
    },
    routeDetailSaveButtonText: {
        color: "#111317",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 20,
    },
    fullMap: {
        ...StyleSheet.absoluteFillObject,
    },
    mapLoadingSurface: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 6,
    },
    mapLoadingSurfaceLight: {
        backgroundColor: "#EEF2F6",
    },
    mapLoadingSurfaceDark: {
        backgroundColor: "#0B1220",
    },
    transitMapRouteHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingBottom: 2,
    },
    transitMapHeaderIconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000000",
        shadowOpacity: 0.16,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
    },
    transitMapRouteSummaryPill: {
        flex: 1,
        minWidth: 0,
        height: 40,
        borderRadius: 20,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        backgroundColor: "#5AA0FF",
        shadowColor: "#000000",
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
    },
    transitMapRouteSummaryText: {
        flexShrink: 1,
        minWidth: 0,
        color: "#111317",
        fontSize: 12.5,
        fontWeight: "900",
        lineHeight: 19,
        letterSpacing: 0,
    },
    transitMapRouteNextChip: {
        height: 40,
        width: 82,
        borderRadius: 20,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        backgroundColor: "rgba(10,11,14,0.92)",
        shadowColor: "#000000",
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
    },
    transitMapRouteNextText: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 11.5,
        fontWeight: "900",
        lineHeight: 19,
        letterSpacing: 0,
    },
    transitMapScheduleButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000000",
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
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
    plannerScheduleButton: {
        width: 44,
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
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
    searchStateRow: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
    },
    searchStateText: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
    },
    searchStateRetryButton: {
        alignSelf: "flex-start",
        minHeight: 36,
        borderRadius: 9,
        paddingHorizontal: 13,
        alignItems: "center",
        justifyContent: "center",
    },
    searchStateRetryText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
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
    permissionOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 80,
        elevation: 80,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
    permissionBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.24)",
    },
    permissionPrompt: {
        width: "100%",
        maxWidth: 390,
        borderWidth: 1,
        borderRadius: 30,
        paddingHorizontal: 22,
        paddingTop: 22,
        paddingBottom: 18,
    },
    permissionIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(33,184,90,0.14)",
        marginBottom: 16,
    },
    permissionTitle: {
        fontSize: 23,
        lineHeight: 29,
        fontWeight: "900",
        letterSpacing: 0,
    },
    permissionBody: {
        marginTop: 10,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "600",
    },
    permissionActions: {
        marginTop: 22,
        flexDirection: "row",
        gap: 10,
    },
    permissionSecondaryButton: {
        flex: 1,
        height: 52,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
    },
    permissionPrimaryButton: {
        flex: 1,
        height: 52,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    permissionSecondaryText: {
        fontSize: 16,
        fontWeight: "800",
    },
    permissionPrimaryText: {
        color: ORIGIN_COLOR,
        fontSize: 16,
        fontWeight: "900",
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
    bottomPanelMotion: {
        maxHeight: 620,
    },
    bottomPanel: {
        borderWidth: 1,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        maxHeight: 620,
        overflow: "hidden",
    },
    bottomPanelDetail: {
        height: "100%",
        borderWidth: 0,
        backgroundColor: "#0B0C0F",
    },
    bottomHandleTouchArea: {
        height: BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 8,
        paddingBottom: 6,
    },
    bottomHandleTouchAreaDetail: {
        height: TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT,
        paddingTop: 6,
        paddingBottom: 4,
    },
    bottomHandle: {
        width: 42,
        height: 4,
        borderRadius: 2,
        alignSelf: "center",
        marginTop: 0,
        marginBottom: 0,
    },
    bottomHandleDetail: {
        width: 34,
        height: 3,
        backgroundColor: "rgba(255,255,255,0.16)",
    },
    bottomPanelScroll: {
        flexShrink: 1,
        minHeight: 0,
    },
    bottomPanelScrollContent: {
        paddingHorizontal: 12,
        gap: 10,
    },
    bottomPanelScrollContentDetail: {
        paddingHorizontal: 10,
        gap: 0,
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
    routeQualityWarning: {
        marginHorizontal: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
    },
    routeQualityWarningText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 17,
        letterSpacing: 0,
    },
    routeAttributionLink: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 4,
    },
    routeAttributionText: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
        letterSpacing: 0,
    },
    alternativeSection: {
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
    alternativeSectionDetail: {
        borderWidth: 0,
        borderRadius: 0,
        overflow: "visible",
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
        textAlign: "center",
    },
    alternativeErrorWrap: {
        alignItems: "center",
        paddingBottom: 12,
    },
    alternativeRetryButton: {
        minHeight: 36,
        borderRadius: 8,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    alternativeRetryText: {
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 17,
        letterSpacing: 0,
    },
    alternativeEmptyText: {
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    selectedRouteSection: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 7,
    },
    selectedRouteSectionDetail: {
        paddingHorizontal: 6,
        paddingTop: 0,
        paddingBottom: 0,
        gap: 6,
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
        paddingTop: 5,
        paddingBottom: 3,
        gap: 4,
    },
    transitReferenceSummaryCardDetail: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
        paddingTop: 0,
        paddingBottom: 4,
        gap: 4,
        backgroundColor: "transparent",
    },
    transitDetailHeroSummary: {
        gap: 2,
        paddingTop: 0,
        paddingBottom: 0,
    },
    transitDetailHeroDuration: {
        fontSize: 34,
        fontWeight: "900",
        lineHeight: 39,
        letterSpacing: 0,
    },
    transitDetailHeroMetaText: {
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
    },
    selectedRouteDetailCard: {
        gap: 10,
    },
    selectedRouteSummaryHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
    },
    selectedRouteDurationBlock: {
        alignItems: "flex-start",
        gap: 2,
    },
    selectedRouteDurationBlockCompact: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 7,
    },
    selectedRouteOptimalText: {
        fontSize: 12,
        fontWeight: "900",
        lineHeight: 16,
    },
    selectedRouteOptimalTextCompact: {
        fontSize: 12,
        lineHeight: 15,
    },
    selectedRouteSummaryText: {
        fontSize: 16,
        fontWeight: "800",
        lineHeight: 22,
    },
    transitReferenceMetaText: {
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 17,
    },
    transitReferenceMetaTextCompact: {
        fontSize: 13,
        lineHeight: 17,
        color: "#AEB4BF",
    },
    transitDetailBaseTimeRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 6,
        paddingTop: 6,
    },
    transitDetailBaseTimeRowCompact: {
        marginTop: 8,
        paddingTop: 9,
    },
    transitDetailBaseTimeText: {
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 18,
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
        fontSize: 24,
        fontWeight: "900",
        lineHeight: 30,
        letterSpacing: 0,
    },
    transitDurationLargeCompact: {
        fontSize: 22,
        lineHeight: 27,
    },
    alternativeRouteLabel: {
        fontSize: 12,
        fontWeight: "800",
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
    transitLegList: {
        gap: 5,
    },
    transitReferenceTimeline: {
        paddingTop: 4,
        paddingBottom: 8,
    },
    transitReferenceTimelineDetail: {
        paddingTop: 6,
        paddingBottom: 0,
    },
    transitDetailActionBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 6,
        minHeight: TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#303033",
        paddingTop: TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING,
        paddingHorizontal: 14,
        justifyContent: "center",
        backgroundColor: "#090A0D",
    },
    transitCollapsedSummaryRow: {
        height: TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT,
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    transitCollapsedArrivalText: {
        flexShrink: 0,
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 22,
    },
    transitCollapsedMetricsText: {
        flex: 1,
        minWidth: 0,
        textAlign: "right",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
    },
    transitDetailActionButtonRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    transitDetailSaveButton: {
        flex: 1.18,
        minWidth: 0,
        height: TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        borderRadius: 999,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
    },
    transitDetailSaveButtonDisabled: {
        opacity: 0.48,
    },
    transitDetailSaveText: {
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 20,
    },
    transitDetailPreviewButton: {
        flex: 0.82,
        minWidth: 0,
        height: TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        borderRadius: 999,
        borderWidth: 1.4,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        backgroundColor: "rgba(255,255,255,0.035)",
    },
    transitDetailPreviewText: {
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 20,
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
    transitDeparturePickerModal: {
        flex: 1,
        justifyContent: "flex-end",
    },
    transitDeparturePickerBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.56)",
    },
    transitDeparturePickerSheet: {
        paddingTop: 12,
        paddingHorizontal: 18,
        paddingBottom: 30,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    transitDeparturePickerHeader: {
        minHeight: 42,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    transitDeparturePickerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    transitDeparturePickerTitle: {
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 22,
    },
    transitDeparturePickerCommand: {
        minWidth: 58,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
    },
    transitDeparturePickerCommandText: {
        fontSize: 14,
        fontWeight: "800",
    },
    transitDeparturePickerApply: {
        borderRadius: 8,
        backgroundColor: "#2F80ED",
    },
    transitDeparturePickerApplyText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "900",
    },
    transitDepartureNowButton: {
        alignSelf: "center",
        minHeight: 38,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    transitDepartureNowText: {
        fontSize: 13,
        fontWeight: "800",
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

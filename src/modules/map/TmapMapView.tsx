import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleProp,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from "react-native";
import { getEnv } from "../../api/env";
import {
    expandNativeDashPathOverlays,
    type NativeDashViewport,
} from "./nativeDashPathPresentation";
import { ROUTE_MAP_TILE_FILTERS } from "./routeMapPresentation";

export type TmapLatLng = {
    latitude: number;
    longitude: number;
};

export type TmapMarker = {
    id: string;
    interactionId?: string;
    latitude: number;
    longitude: number;
    tintColor?: string;
    caption?: string;
    displayType?: "pin" | "badge" | "dot" | "station" | "routeLabel";
    markerStyle?: "default" | "origin" | "destination" | "bus" | "subway" | "walk";
    stationVariant?: "compact";
    badgeVariant?: "default" | "route" | "context" | "stop";
    pinLabel?: string;
    badgeLabel?: string;
    badgeSubLabel?: string;
    badgeTextColor?: string;
    badgeBorderColor?: string;
    badgeConnectorColor?: string;
    badgeGlyph?: string;
    eventIntent?: "board" | "alight" | "transfer";
    badgeSide?: "left" | "right";
    dotSize?: number;
    markerScale?: number;
    zIndex?: number;
};

export type TmapPathOverlay = {
    id: string;
    coords: TmapLatLng[];
    color?: string;
    width?: number;
    opacity?: number;
    outlineColor?: string;
    outlineWidth?: number;
    outlineOpacity?: number;
    dashPattern?: number[];
    strokeStyle?: "solid" | "dash" | "dot";
    outlineStrokeStyle?: "solid" | "dash" | "dot";
    renderMode?: "native" | "screen";
    shape?: "solid" | "dot";
    showDirection?: boolean;
    nativeDirection?: boolean;
    nativeDirectionColor?: string;
    nativeDirectionOpacity?: number;
    directionColor?: string;
    directionOpacity?: number;
    directionSpacingPx?: number;
    directionSizePx?: number;
    directionInsetPx?: number;
    directionMaxCount?: number;
    dotColor?: string;
    dotOutlineColor?: string;
    dotOutlineWidth?: number;
    dotSizePx?: number;
    dotSpacingPx?: number;
    supportLineColor?: string;
    supportLineWidth?: number;
    drawLine?: boolean;
    cornerRadiusPx?: number;
    smoothPath?: boolean;
    lineLabel?: string;
    lineLabelTextColor?: string;
    lineLabelBackgroundColor?: string;
    lineLabelOffsetPx?: number;
    zIndex?: number;
};

export type TmapMapViewHandle = {
    animateCameraTo: (camera: {
        latitude: number;
        longitude: number;
        zoom?: number;
        duration?: number;
        easing?: string;
    }) => void;
    animateRegionTo: (region: {
        latitude: number;
        longitude: number;
        latitudeDelta: number;
        longitudeDelta: number;
        zoomOffset?: number;
        duration?: number;
        easing?: string;
        pivot?: { x: number; y: number };
    }) => void;
    fitToCoordinates: (
        coords: TmapLatLng[],
        options?: {
            padding?: number;
            edgePadding?: { top: number; right: number; bottom: number; left: number };
        }
    ) => void;
    resizeMap: (reason?: string) => void;
    zoomBy: (delta: number) => void;
};

export type TmapMapLayoutReport = {
    reason?: string;
    mapContainerWidth?: number;
    mapContainerHeight?: number;
    webViewWidth?: number;
    webViewHeight?: number;
    windowWidth?: number;
    windowHeight?: number;
    isCameraAnimating?: boolean;
    isMapIdle?: boolean;
};

export type TmapCameraState = {
    latitude: number;
    longitude: number;
    zoom: number;
    metersPerPixel?: number;
};

/**
 * TMAP 지도 객체는 데스크톱에서는 click을, 모바일에서는 touch lifecycle을 보낸다.
 * 모바일 touchend는 drag 뒤에도 오므로 시작점 대비 이동량을 검사한 뒤에만 선택한다.
 */
export const TMAP_MAP_SELECTION_EVENTS = {
    click: "click",
    touchStart: "touchstart",
    touchMove: ["touchmove", "dragstart", "drag", "dragend"],
    touchCancel: ["zoomstart", "zoom_changed", "gesturestart"],
    touchEnd: "touchend",
} as const;

export const TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX = 10;
export const TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS = 500;
export const TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES = 0.00005;

export type TmapMapSelectionSample = {
    latitude: number;
    longitude: number;
    timestampMs: number;
};

export function isDuplicateTmapMapSelection(
    previous: TmapMapSelectionSample | undefined,
    next: TmapMapSelectionSample
): boolean {
    if (!previous) return false;
    const elapsedMs = next.timestampMs - previous.timestampMs;
    return elapsedMs >= 0 &&
        elapsedMs <= TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS &&
        Math.abs(next.latitude - previous.latitude) <= TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES &&
        Math.abs(next.longitude - previous.longitude) <= TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES;
}

export function isValidWgs84Coordinate(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude) && Number.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

type TmapMapViewProps = {
    style?: StyleProp<ViewStyle>;
    /**
     * 전체 화면 지도처럼 하단 시트가 지도를 가리는 화면에서 오류 카드를
     * 안전한 위치로 올릴 때 사용한다. 미리보기 지도는 기본 하단 여백을 쓴다.
     */
    errorOverlayTop?: number;
    camera: {
        latitude: number;
        longitude: number;
        zoom?: number;
    };
    markers?: TmapMarker[];
    pathOverlays?: TmapPathOverlay[];
    pathOverlayZoom?: number;
    pathCoords?: TmapLatLng[];
    pathColor?: string;
    pathWidth?: number;
    pathOutlineColor?: string;
    pathOutlineWidth?: number;
    clearRouteOverlays?: boolean;
    routeOverlayScope?: string;
    mapBaseDimOpacity?: number;
    routeFocusMode?: boolean;
    nightModeEnabled?: boolean;
    showLocationButton?: boolean;
    showZoomControls?: boolean;
    onTapMap?: (event: { latitude: number; longitude: number }) => void;
    onMarkerPress?: (event: { id: string; interactionId?: string }) => void;
    onZoomChanged?: (zoom: number) => void;
    onCameraChanged?: (camera: TmapCameraState) => void;
    onInitialized?: () => void;
    onMapLayoutReport?: (report: TmapMapLayoutReport) => void;
    fallbackBackgroundColor?: string;
    fallbackTextColor?: string;
};

const tmapWebviewModule = (() => {
    try {
        return require("react-native-webview");
    } catch {
        return null;
    }
})();

const WebView = tmapWebviewModule?.WebView as any;
const MAP_INITIALIZATION_TIMEOUT_MS = 15_000;
const MAP_LOAD_ERROR_MESSAGE = "지도를 불러오지 못했습니다. 네트워크 연결을 확인하고 다시 시도해 주세요.";

/**
 * 지도 SDK가 준비되기 전 경로 state가 여러 번 바뀌면 오래된 setData 명령을 전부
 * 재생할 필요가 없다. 마지막 화면 데이터만 남겨 초기화 직후의 긴 멈춤과 깜빡임을 막는다.
 * fitBounds/zoom 같은 사용자 카메라 명령은 순서가 의미 있으므로 그대로 보존한다.
 */
export function enqueueTmapCommand(
    queue: string[],
    command: Record<string, unknown>
): string[] {
    const serialized = JSON.stringify(command);
    if (command.type !== "setData") return [...queue, serialized];

    return [
        ...queue.filter((queued) => !queued.startsWith('{"type":"setData"')),
        serialized,
    ];
}

function safeNumber(value: unknown): number | undefined {
    const numberValue = typeof value === "string" ? Number(value) : (value as number);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

/**
 * TMAP SDK가 native direction을 지원하지 않는 실행 환경에서도 방향 정보가 사라지지 않게
 * 기존 화면 좌표 arrow renderer에 화살표 전용 overlay를 넘긴다. 본선은 native Polyline이
 * 계속 소유하고, fallback은 drawLine=false라 동일 선을 두 번 그리지 않는다.
 */
export function addNativeDirectionScreenFallbacks(
    overlays: TmapPathOverlay[],
    nativeDirectionUsable: boolean | undefined
): TmapPathOverlay[] {
    if (nativeDirectionUsable !== false) return overlays;

    const fallbacks = overlays
        .filter((overlay) => (
            overlay.renderMode !== "screen" &&
            overlay.nativeDirection === true &&
            (overlay.strokeStyle ?? "solid") === "solid" &&
            overlay.coords.length >= 2
        ))
        .map<TmapPathOverlay>((overlay) => ({
            id: `${overlay.id}--screen-direction-fallback`,
            coords: overlay.coords,
            renderMode: "screen",
            shape: "solid",
            drawLine: false,
            showDirection: true,
            nativeDirection: false,
            directionColor: overlay.nativeDirectionColor ?? "#FFFFFF",
            directionOpacity: overlay.nativeDirectionOpacity ?? 0.9,
            directionSpacingPx: overlay.directionSpacingPx ?? 26,
            directionSizePx: overlay.directionSizePx ?? 6.4,
            directionInsetPx: overlay.directionInsetPx ?? 13,
            directionMaxCount: overlay.directionMaxCount ?? 120,
            zIndex: (overlay.zIndex ?? 0) + 2,
        }));

    return fallbacks.length > 0 ? [...overlays, ...fallbacks] : overlays;
}

// SDK 기능 판정은 Release에서도 RN에 전달해야 screen-space 방향표시 fallback을 선택할 수 있다.
// 실제 WebView에 삽입하는 동일한 조각을 테스트에서 실행해 개발 모드 조건이 다시 섞이지 않게 한다.
export const TMAP_NATIVE_DIRECTION_REPORT_SCRIPT = String.raw`
        post("tmapNativeDirectionReport", nativeDirectionReport);
`;

export type TmapNativeDirectionCapability = {
    confirmed: boolean;
    supportsDirection: boolean;
    supportsDirectionColor: boolean;
    supportsDirectionOpacity: boolean;
};

type TmapNativeDirectionProbeLine = {
    _shape_data?: {
        drawInfo?: {
            direction?: unknown;
            directionColor?: unknown;
            directionOpacity?: unknown;
        };
    };
};

/** WebView probe와 동일한 fail-closed 판정을 테스트와 네이티브 코드에서 공유한다. */
export function readTmapNativeDirectionCapability(
    line: unknown
): TmapNativeDirectionCapability {
    const drawInfo = (line as TmapNativeDirectionProbeLine | null)?._shape_data?.drawInfo;
    if (!drawInfo) {
        return {
            confirmed: false,
            supportsDirection: false,
            supportsDirectionColor: false,
            supportsDirectionOpacity: false,
        };
    }
    return {
        confirmed: true,
        supportsDirection: drawInfo.direction === true,
        supportsDirectionColor: String(drawInfo.directionColor ?? "").toUpperCase() === "#FFFFFF",
        supportsDirectionOpacity: Math.abs(Number(drawInfo.directionOpacity) - 0.001) < 0.000001,
    };
}

// 실제 WebView에서 생성된 Polyline의 drawInfo가 옵션을 반영했는지 확인한다. SDK 내부 구조를
// 읽을 수 없으면 지원된다고 추측하지 않고 screen-space fallback을 선택한다.
export const TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT = String.raw`
    function readTmapNativeDirectionCapability(line) {
      var drawInfo = line && line._shape_data && line._shape_data.drawInfo;
      if (!drawInfo) {
        return {
          confirmed: false,
          supportsDirection: false,
          supportsDirectionColor: false,
          supportsDirectionOpacity: false,
        };
      }
      return {
        confirmed: true,
        supportsDirection: drawInfo.direction === true,
        supportsDirectionColor: String(drawInfo.directionColor || "").toUpperCase() === "#FFFFFF",
        supportsDirectionOpacity: Math.abs(Number(drawInfo.directionOpacity) - 0.001) < 0.000001,
      };
    }
`;

// TMAP Polyline은 RGB hex와 별도 opacity를 받으므로 CSS 색상의 alpha를 분리한다.
// 실제 WebView에 삽입되는 스크립트 자체를 테스트해 네이티브 렌더링과 테스트의 구현이 갈라지지 않게 한다.
export const TMAP_NATIVE_STROKE_COLOR_SCRIPT = String.raw`
    function normalizeNativeStrokeColor(value, fallback) {
      function parseColor(input) {
        if (input === undefined || input === null) return null;
        var raw = String(input).trim();
        if (!raw) return null;

        if (raw.toLowerCase() === "transparent") {
            return { color: "#000000", alpha: 0 };
        }

        var shortAlphaHexMatch = raw.match(/^#([0-9a-fA-F]{4})$/);
        if (shortAlphaHexMatch) {
            var shortAlphaHex = shortAlphaHexMatch[1];
            return {
                color: "#" + shortAlphaHex.charAt(0) + shortAlphaHex.charAt(0) +
                    shortAlphaHex.charAt(1) + shortAlphaHex.charAt(1) +
                    shortAlphaHex.charAt(2) + shortAlphaHex.charAt(2),
                alpha: parseInt(shortAlphaHex.charAt(3) + shortAlphaHex.charAt(3), 16) / 255,
            };
        }

        var alphaHexMatch = raw.match(/^#([0-9a-fA-F]{8})$/);
        if (alphaHexMatch) {
            var alphaHex = alphaHexMatch[1];
            return {
                color: "#" + alphaHex.slice(0, 6),
                alpha: parseInt(alphaHex.slice(6, 8), 16) / 255,
            };
        }

        if (/^#[0-9a-fA-F]{6}$/.test(raw)) return { color: raw, alpha: 1 };
        if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
            return {
                color: "#" + raw.charAt(1) + raw.charAt(1) +
                    raw.charAt(2) + raw.charAt(2) +
                    raw.charAt(3) + raw.charAt(3),
                alpha: 1,
            };
        }

        var rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i);
        if (rgbMatch) {
            var parts = rgbMatch[1].split(",").map(function (part) { return String(part).trim(); });
            if (parts.length === 3 || parts.length === 4) {
                var channels = parts.slice(0, 3).map(function (part) { return Number(part); });
                var alpha = 1;
                if (parts.length === 4) {
                    alpha = parts[3].slice(-1) === "%"
                        ? Number(parts[3].slice(0, -1)) / 100
                        : Number(parts[3]);
                }
                if (
                    isFinite(channels[0]) &&
                    isFinite(channels[1]) &&
                    isFinite(channels[2]) &&
                    isFinite(alpha)
                ) {
                    return {
                        color: "#" + channels.map(function (channel) {
                            var clamped = Math.max(0, Math.min(255, Math.round(channel)));
                            return clamped.toString(16).padStart(2, "0");
                        }).join(""),
                        alpha: Math.max(0, Math.min(1, alpha)),
                    };
                }
            }
        }

        return null;
      }

      return parseColor(value) || parseColor(fallback) || { color: "#1D72FF", alpha: 1 };
    }

    function resolveNativeStrokePaint(value, fallback, opacity, fallbackOpacity) {
      var normalized = normalizeNativeStrokeColor(value, fallback);
      var normalizedFallbackOpacity = Number(fallbackOpacity);
      if (!isFinite(normalizedFallbackOpacity)) normalizedFallbackOpacity = 1;
      normalizedFallbackOpacity = Math.max(0, Math.min(1, normalizedFallbackOpacity));

      var requestedOpacity = Number(opacity);
      if (!isFinite(requestedOpacity)) requestedOpacity = normalizedFallbackOpacity;
      requestedOpacity = Math.max(0, Math.min(1, requestedOpacity));

      return {
        color: normalized.color,
        alpha: normalized.alpha,
        requestedOpacity: requestedOpacity,
        opacity: requestedOpacity * normalized.alpha,
      };
    }
`;

const DEFAULT_FALLBACK_BACKGROUND = "#E5E7EB";
const DEFAULT_FALLBACK_TEXT = "#6B7280";
const TMAP_WEBVIEW_HTML_VERSION = "route-native-first-v42-guarded-touch-selection";
// WebView 내부 SVG <image>에서 안정적으로 렌더되도록 아이콘을 data URI로 고정한다.
const BUS_BADGE_GLYPH_URI = "data:image/png;base64,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";
const SUBWAY_BADGE_GLYPH_URI = "data:image/png;base64,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";

const TmapMapView = forwardRef<TmapMapViewHandle, TmapMapViewProps>(function TmapMapView(
    {
        style,
        errorOverlayTop,
        camera,
        markers = [],
        pathOverlays = [],
        pathOverlayZoom,
        pathCoords = [],
        pathColor = "#1D72FF",
        pathWidth = 10,
        pathOutlineColor = "#FFFFFF",
        pathOutlineWidth = 3,
        clearRouteOverlays = false,
        routeOverlayScope,
        mapBaseDimOpacity = 0,
        routeFocusMode = false,
        nightModeEnabled = false,
        showLocationButton = true,
        showZoomControls = true,
        onTapMap,
        onMarkerPress,
        onZoomChanged,
        onCameraChanged,
        onInitialized,
        onMapLayoutReport,
        fallbackBackgroundColor = DEFAULT_FALLBACK_BACKGROUND,
        fallbackTextColor = DEFAULT_FALLBACK_TEXT,
    },
    ref
) {
    // WebView 인스턴스와 초기화 이전 명령 큐를 별도로 유지한다.
    const webViewRef = useRef<any>(null);
    const commandQueueRef = useRef<string[]>([]);
    const lastMapSelectionRef = useRef<TmapMapSelectionSample | undefined>(undefined);
    // isReady=true 이후에만 postMessage를 즉시 보낸다.
    const [isReady, setIsReady] = useState(false);
    const [runtimeErrorMessage, setRuntimeErrorMessage] = useState<string | undefined>(undefined);
    const [webViewReloadRevision, setWebViewReloadRevision] = useState(0);
    const [nativeDirectionUsable, setNativeDirectionUsable] = useState<boolean | undefined>();
    const [nativeDashViewport, setNativeDashViewport] = useState<NativeDashViewport & { zoom: number }>(() => ({
        center: { latitude: camera.latitude, longitude: camera.longitude },
        widthPx: 0,
        heightPx: 0,
        zoom: camera.zoom ?? pathOverlayZoom ?? 15,
    }));
    const routeOverlayScopeToken = routeOverlayScope?.trim() || "default";
    const webViewKey = useMemo(
        () => `${TMAP_WEBVIEW_HTML_VERSION}:${routeOverlayScopeToken}`,
        [routeOverlayScopeToken]
    );
    const activeWebViewKey = [
        webViewKey,
        String(webViewReloadRevision),
        nightModeEnabled ? "dark" : "light",
        routeFocusMode ? "route" : "default",
        showLocationButton ? "location" : "no-location",
        showZoomControls ? "zoom" : "no-zoom",
    ].join(":");
    const readyWebViewKeyRef = useRef<string | null>(null);
    const htmlBootstrapScope = activeWebViewKey;
    const htmlInitialCameraRef = useRef({
        scope: htmlBootstrapScope,
        latitude: camera.latitude,
        longitude: camera.longitude,
        zoom: camera.zoom,
    });
    if (htmlInitialCameraRef.current.scope !== htmlBootstrapScope) {
        htmlInitialCameraRef.current = {
            scope: htmlBootstrapScope,
            latitude: camera.latitude,
            longitude: camera.longitude,
            zoom: camera.zoom,
        };
    }

    const appKey = getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY");

    const hasWebView = !!WebView;
    const canRender = hasWebView && !!appKey;
    const nativePathOverlays = useMemo(
        () => expandNativeDashPathOverlays(
            pathOverlays,
            nativeDashViewport.zoom ?? pathOverlayZoom ?? camera.zoom ?? 15,
            nativeDashViewport.widthPx > 0 && nativeDashViewport.heightPx > 0
                ? nativeDashViewport
                : undefined
        ),
        [camera.zoom, nativeDashViewport, pathOverlayZoom, pathOverlays]
    );
    const renderedPathOverlays = useMemo(
        () => addNativeDirectionScreenFallbacks(nativePathOverlays, nativeDirectionUsable),
        [nativeDirectionUsable, nativePathOverlays]
    );

    useEffect(() => {
        setNativeDashViewport((current) => ({
            ...current,
            center: { latitude: camera.latitude, longitude: camera.longitude },
            zoom: camera.zoom ?? current.zoom,
        }));
    }, [camera.latitude, camera.longitude, camera.zoom, webViewKey]);

    useEffect(() => {
        if (!canRender) {
            setIsReady(false);
            readyWebViewKeyRef.current = null;
            onInitialized?.();
        }
    }, [canRender, onInitialized]);

    // WebView 준비 전에는 명령을 큐에 쌓아 초기화 직후 순차 전송한다.
    const postCommand = useCallback((command: Record<string, unknown>) => {
        const json = JSON.stringify(command);
        if (!isReady || readyWebViewKeyRef.current !== activeWebViewKey || !webViewRef.current) {
            commandQueueRef.current = enqueueTmapCommand(commandQueueRef.current, command);
            return;
        }
        webViewRef.current.postMessage(json);
    }, [activeWebViewKey, isReady]);

    useEffect(() => {
        readyWebViewKeyRef.current = null;
        commandQueueRef.current = [];
        setIsReady(false);
        setRuntimeErrorMessage(undefined);
        setNativeDirectionUsable(undefined);
    }, [activeWebViewKey]);

    useEffect(() => {
        if (!canRender || isReady || runtimeErrorMessage) return;
        const timeoutId = setTimeout(() => {
            setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
        }, MAP_INITIALIZATION_TIMEOUT_MS);
        return () => clearTimeout(timeoutId);
    }, [activeWebViewKey, canRender, isReady, runtimeErrorMessage]);

    const retryMapLoad = useCallback(() => {
        commandQueueRef.current = [];
        readyWebViewKeyRef.current = null;
        setIsReady(false);
        setRuntimeErrorMessage(undefined);
        setWebViewReloadRevision((current) => current + 1);
    }, []);

    const handleNativeWebViewError = useCallback((event: any) => {
        if (typeof __DEV__ === "boolean" && __DEV__) {
            console.warn("[tmap] WebView load failed", event?.nativeEvent);
        }
        setIsReady(false);
        setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
    }, []);

    useImperativeHandle(ref, () => ({
        animateCameraTo(nextCamera) {
            postCommand({ type: "animateCamera", payload: nextCamera });
        },
        animateRegionTo(region) {
            postCommand({ type: "animateRegion", payload: region });
        },
        fitToCoordinates(coords, options) {
            postCommand({
                type: "fitBounds",
                payload: {
                    coords,
                    padding: options?.padding ?? 48,
                    edgePadding: options?.edgePadding,
                },
            });
        },
        resizeMap(reason = "imperative") {
            postCommand({ type: "resizeMap", payload: { reason } });
        },
        zoomBy(delta) {
            postCommand({ type: "zoomBy", payload: { delta } });
        },
    }), [postCommand]);

    const handleContainerLayout = useCallback((event: any) => {
        const width = Math.round(event?.nativeEvent?.layout?.width ?? 0);
        const height = Math.round(event?.nativeEvent?.layout?.height ?? 0);
        if (width <= 0 || height <= 0) return;
        setNativeDashViewport((current) => (
            current.widthPx === width && current.heightPx === height
                ? current
                : { ...current, widthPx: width, heightPx: height }
        ));
        onMapLayoutReport?.({
            reason: "RN_CONTAINER_LAYOUT",
            mapContainerWidth: width,
            mapContainerHeight: height,
            webViewWidth: width,
            webViewHeight: height,
            isCameraAnimating: false,
            isMapIdle: true,
        });
        postCommand({
            type: "resizeMap",
            payload: {
                reason: "RN_CONTAINER_LAYOUT",
                width,
                height,
            },
        });
    }, [onMapLayoutReport, postCommand]);

    useEffect(() => {
        if (!canRender) return;
        postCommand({
            type: "setData",
            payload: {
                markers,
                pathOverlays: renderedPathOverlays,
                pathCoords,
                pathColor,
                pathWidth,
                pathOutlineColor,
                pathOutlineWidth,
                clearRouteOverlays,
                routeOverlayScope,
                mapBaseDimOpacity,
                routeFocusMode,
                nightModeEnabled,
            },
        });
    }, [
        canRender,
        markers,
        renderedPathOverlays,
        pathCoords,
        pathColor,
        pathWidth,
        pathOutlineColor,
        pathOutlineWidth,
        clearRouteOverlays,
        routeOverlayScope,
        mapBaseDimOpacity,
        routeFocusMode,
        nightModeEnabled,
        postCommand,
    ]);

    // camera prop 변경은 HTML 자체를 다시 만들지 않고 준비된 지도에 명령으로 반영한다.
    useEffect(() => {
        if (!canRender) return;
        postCommand({
            type: "animateCamera",
            payload: {
                latitude: camera.latitude,
                longitude: camera.longitude,
                zoom: camera.zoom,
            },
        });
    }, [camera.latitude, camera.longitude, camera.zoom, canRender, postCommand]);

    // WebView -> React Native 메시지를 파싱해 탭/줌/초기화 이벤트로 분기한다.
    const onWebViewMessage = useCallback((event: any) => {
        const data = event?.nativeEvent?.data;
        if (!data) return;

        try {
            const message = JSON.parse(data);
            const type = message?.type;

            if (type === "initialized") {
                readyWebViewKeyRef.current = activeWebViewKey;
                lastMapSelectionRef.current = undefined;
                setIsReady(true);
                setRuntimeErrorMessage(undefined);
                if (webViewRef.current && commandQueueRef.current.length > 0) {
                    commandQueueRef.current.forEach((command) => {
                        webViewRef.current.postMessage(command);
                    });
                    commandQueueRef.current = [];
                }
                onInitialized?.();
                return;
            }

            if (type === "layout") {
                const width = safeNumber(
                    message?.payload?.webViewWidth ?? message?.payload?.mapContainerWidth
                );
                const height = safeNumber(
                    message?.payload?.webViewHeight ?? message?.payload?.mapContainerHeight
                );
                if (typeof width === "number" && width > 0 && typeof height === "number" && height > 0) {
                    setNativeDashViewport((current) => (
                        current.widthPx === width && current.heightPx === height
                            ? current
                            : { ...current, widthPx: width, heightPx: height }
                    ));
                }
                onMapLayoutReport?.(message?.payload ?? {});
                return;
            }

            if (type === "error") {
                if (typeof __DEV__ === "boolean" && __DEV__) {
                    console.warn("[tmap] runtime initialization failed", message?.payload?.message);
                }
                setIsReady(false);
                setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
                return;
            }

            if (type === "tap") {
                const latitude = safeNumber(message?.payload?.latitude);
                const longitude = safeNumber(message?.payload?.longitude);
                if (
                    typeof latitude === "number" &&
                    typeof longitude === "number" &&
                    isValidWgs84Coordinate(latitude, longitude)
                ) {
                    const nextSelection = {
                        latitude,
                        longitude,
                        timestampMs: Date.now(),
                    };
                    if (isDuplicateTmapMapSelection(lastMapSelectionRef.current, nextSelection)) {
                        return;
                    }
                    lastMapSelectionRef.current = nextSelection;
                    onTapMap?.({ latitude, longitude });
                }
                return;
            }

            if (type === "markerPress") {
                const id = typeof message?.payload?.id === "string" ? message.payload.id : undefined;
                const interactionId = typeof message?.payload?.interactionId === "string"
                    ? message.payload.interactionId
                    : undefined;
                if (id) onMarkerPress?.({ id, interactionId });
                return;
            }

            if (type === "zoomChanged") {
                const zoom = safeNumber(message?.payload?.zoom);
                if (typeof zoom === "number") {
                    onZoomChanged?.(zoom);
                    const latitude = safeNumber(message?.payload?.latitude);
                    const longitude = safeNumber(message?.payload?.longitude);
                    if (typeof latitude === "number" && typeof longitude === "number") {
                        setNativeDashViewport((current) => {
                            if (
                                Math.abs(current.center.latitude - latitude) < 1e-7 &&
                                Math.abs(current.center.longitude - longitude) < 1e-7 &&
                                Math.abs(current.zoom - zoom) < 1e-3
                            ) {
                                return current;
                            }
                            return {
                                ...current,
                                center: { latitude, longitude },
                                zoom,
                            };
                        });
                        const metersPerPixel = safeNumber(message?.payload?.metersPerPixel);
                        onCameraChanged?.({ latitude, longitude, zoom, metersPerPixel });
                    }
                }
                return;
            }

            if (type === "routeOverlayState") {
                if (typeof __DEV__ !== "undefined" && __DEV__) {
                    console.log("[route-overlay-state]", message?.payload ?? {});
                }
                return;
            }

            if (type === "routeVisibility") {
                if (typeof __DEV__ !== "undefined" && __DEV__) {
                    const summary = message?.payload?.summary ?? {};
                    console.log("[route-visibility]", summary);
                    if (Array.isArray(message?.payload?.rows)) {
                        console.table(message.payload.rows);
                    }
                }
                return;
            }

            if (type === "tmapNativeDirectionReport") {
                const firstRow = Array.isArray(message?.payload?.rows)
                    ? message.payload.rows[0]
                    : undefined;
                setNativeDirectionUsable(firstRow?.usableForRouteLine === true);
                if (typeof __DEV__ !== "undefined" && __DEV__) {
                    console.log("[tmap-sdk] native direction report:", message?.payload ?? {});
                    if (Array.isArray(message?.payload?.rows)) {
                        console.table(message.payload.rows.map((row: any) => ({
                            sdk: row?.sdk,
                            supportsDirection: row?.supportsDirection === true,
                            supportsDirectionColor: row?.supportsDirectionColor === true,
                            supportsDirectionOpacity: row?.supportsDirectionOpacity === true,
                            supportsDashStroke: row?.supportsDashStroke === true,
                            pathOrderControlsDirection: row?.pathOrderControlsDirection === true,
                            arrowMovesWithPolyline: row?.arrowMovesWithPolyline === true,
                            usableForRouteLine: row?.usableForRouteLine === true,
                            reasonNativeDirectionDisabled: row?.reasonNativeDirectionDisabled ?? row?.reason,
                        })));
                    }
                }
                return;
            }
        } catch {
            // ignore malformed message
        }
    }, [activeWebViewKey, onCameraChanged, onInitialized, onMapLayoutReport, onMarkerPress, onTapMap, onZoomChanged]);

    // Tmap SDK를 포함한 WebView HTML을 생성한다.
    const html = useMemo(() => {
        if (!appKey || !htmlBootstrapScope) return "";
        const initialCamera = htmlInitialCameraRef.current;
        const initialZoom = Math.max(6, Math.min(18, Math.round(initialCamera.zoom ?? 12)));
        const initialLat = initialCamera.latitude;
        const initialLng = initialCamera.longitude;
        const isDevelopmentFlag = typeof __DEV__ === "boolean" && __DEV__ ? "true" : "false";
        const showZoomControlFlag = showZoomControls ? "true" : "false";
        const showLocationControlFlag = showLocationButton ? "true" : "false";
        const darkFlag = nightModeEnabled ? "true" : "false";
        const routeFocusFlag = routeFocusMode ? "true" : "false";
        const initialMapBackground = nightModeEnabled ? "#0B1220" : "#F2F2F7";

        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; min-width: 100vw; min-height: 100vh; background: ${initialMapBackground}; overflow: hidden; }
    #map {
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      min-width: 100vw;
      min-height: 100vh;
      background: ${initialMapBackground};
      transform: translateZ(0);
      backface-visibility: hidden;
    }
    #mapTone {
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 3000;
      opacity: 0;
      transition: opacity 180ms ease, background 180ms ease;
    }
    #routeOverlay {
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
      z-index: 3100;
      opacity: 1;
      transition: opacity 80ms linear;
    }
    #routeOverlay.route-overlay-moving { opacity: 0.42; }
    #locationBtn {
      position: absolute;
      right: 14px;
      bottom: 88px;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      border: 1px solid rgba(17, 24, 39, 0.2);
      background: rgba(255,255,255,0.95);
      color: #111827;
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 10px rgba(0,0,0,0.18);
      z-index: 4000;
      transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
    }
    #locationBtn.hidden { display: none; }
  </style>
  <script>window.__TMAP_SCRIPT_VERSION__ = "jsv2?version=1";</script>
  <script src="https://apis.openapi.sk.com/tmap/jsv2?version=1&appKey=${encodeURIComponent(appKey)}"></script>
</head>
<body>
  <div id="map"></div>
  <div id="mapTone"></div>
  <canvas id="routeOverlay"></canvas>
  <button
    id="locationBtn"
    type="button"
    aria-label="지도에서 내 현재 위치 보기"
    title="현재 위치"
    class="${showLocationControlFlag === "true" ? "" : "hidden"}"
  ><span aria-hidden="true">◎</span></button>
  <script>
    (function () {
      var map = null;
      var markers = {};
      var latestMarkerItems = [];
      var markerCollisionRefreshTimer = null;
      var pathLayers = [];
      var routeOverlayRegistry = {};
      var screenRouteOverlays = [];
      var lastRouteOverlayScope = "";
      var screenRouteFrame = null;
      var screenRouteRenderDelay = null;
      var routeOverlayIdleTimer = null;
      var routeOverlayProjectionVersion = 0;
      var isRouteOverlayMoving = false;
      var isMapIdle = true;
      var lastLayoutReportSignature = "";
      var lastRouteOverlayStateSignature = "";
      var lastRouteVisibilitySignature = "";
      var routeOverlayDpr = 1;
      var nativeDirectionReport = null;
      var nativeDirectionUnavailableWarned = false;
      var pendingData = null;
      var initRetry = 0;
      var isDarkTheme = ${darkFlag};
      var isDevelopment = ${isDevelopmentFlag};
      function debugLog() {
        if (isDevelopment && window.console && typeof window.console.log === "function") {
          window.console.log.apply(window.console, arguments);
        }
      }
      function debugWarn() {
        if (isDevelopment && window.console && typeof window.console.warn === "function") {
          window.console.warn.apply(window.console, arguments);
        }
      }
      function debugTable(value) {
        if (isDevelopment && window.console && typeof window.console.table === "function") {
          window.console.table(value);
        }
      }
      var isRouteFocusMode = ${routeFocusFlag};
      var nativeDarkMapTypeApplied = false;
      var nativeMapTypeCandidates = null;
      var mapTilePresentationObserver = null;
      var routeMapTileFilters = ${JSON.stringify(ROUTE_MAP_TILE_FILTERS)};
      var busBadgeGlyphUri = ${JSON.stringify(BUS_BADGE_GLYPH_URI)};
      var subwayBadgeGlyphUri = ${JSON.stringify(SUBWAY_BADGE_GLYPH_URI)};

      function post(type, payload) {
        if (!window.ReactNativeWebView) return;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload || {} }));
      }

      function reportMapLayout(reason) {
        var mapEl = document.getElementById("map");
        var overlayEl = document.getElementById("routeOverlay");
        var mapRect = mapEl && mapEl.getBoundingClientRect ? mapEl.getBoundingClientRect() : null;
        var overlayRect = overlayEl && overlayEl.getBoundingClientRect ? overlayEl.getBoundingClientRect() : null;
        var mapWidth = Math.round((mapRect && mapRect.width) || (mapEl && mapEl.clientWidth) || window.innerWidth || 0);
        var mapHeight = Math.round((mapRect && mapRect.height) || (mapEl && mapEl.clientHeight) || window.innerHeight || 0);
        var webViewWidth = Math.round((overlayRect && overlayRect.width) || mapWidth);
        var webViewHeight = Math.round((overlayRect && overlayRect.height) || mapHeight);
        var payload = {
          reason: reason || "UNKNOWN",
          mapContainerWidth: mapWidth,
          mapContainerHeight: mapHeight,
          webViewWidth: webViewWidth,
          webViewHeight: webViewHeight,
          windowWidth: Math.round(window.innerWidth || mapWidth),
          windowHeight: Math.round(window.innerHeight || mapHeight),
          isCameraAnimating: isRouteOverlayMoving,
          isMapIdle: isMapIdle,
        };
        var signature = JSON.stringify(payload);
        if (signature === lastLayoutReportSignature) return;
        lastLayoutReportSignature = signature;
        post("layout", payload);
      }

      function resizeMap(reason) {
        var mapEl = document.getElementById("map");
        var overlayEl = document.getElementById("routeOverlay");
        if (mapEl) {
          mapEl.style.width = "100%";
          mapEl.style.height = "100%";
          mapEl.style.minWidth = "100vw";
          mapEl.style.minHeight = "100vh";
        }
        if (overlayEl) {
          overlayEl.style.width = "100%";
          overlayEl.style.height = "100%";
        }
        try {
          if (map && typeof map.resize === "function") map.resize();
        } catch (_resizeError) {}
        try {
          if (map && typeof map.relayout === "function") map.relayout();
        } catch (_relayoutError) {}
        try {
          if (map && typeof map.setSize === "function" && window.Tmapv2 && Tmapv2.Size) {
            var rect = mapEl && mapEl.getBoundingClientRect ? mapEl.getBoundingClientRect() : null;
            var width = Math.max(1, Math.round((rect && rect.width) || window.innerWidth || 1));
            var height = Math.max(1, Math.round((rect && rect.height) || window.innerHeight || 1));
            map.setSize(new Tmapv2.Size(width, height));
          }
        } catch (_sizeError) {}
        scheduleScreenRouteOverlayRender(40);
        setTimeout(function () {
          scheduleScreenRouteOverlayRender();
          emitZoomChanged();
          reportMapLayout(reason || "resizeMap");
          verifyRouteOverlaysAttached(reason || "resizeMap");
        }, 120);
        setTimeout(function () {
          reportMapLayout((reason || "resizeMap") + ":settled");
          verifyRouteOverlaysAttached((reason || "resizeMap") + ":settled");
        }, 360);
      }

      function toLatLng(point) {
        return new Tmapv2.LatLng(point.latitude, point.longitude);
      }

      ${TMAP_NATIVE_STROKE_COLOR_SCRIPT}
      ${TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT}

      function probeTmapNativeDirectionSupport() {
        var sdkReport = {
          hasTmapv2: !!window.Tmapv2,
          hasTmapv3: !!window.Tmapv3,
          polylineV2: !!(window.Tmapv2 && Tmapv2.Polyline),
          polylineV3: !!(window.Tmapv3 && Tmapv3.Polyline),
          scriptVersion: window.__TMAP_SCRIPT_VERSION__,
        };
        var row = {
          sdk: sdkReport.polylineV3 ? "Tmapv3" : (sdkReport.polylineV2 ? "Tmapv2" : "unknown"),
          supportsDirection: false,
          supportsDirectionColor: false,
          supportsDirectionOpacity: false,
          supportsDashStroke: false,
          pathOrderControlsDirection: false,
          arrowMovesWithPolyline: false,
          usableForRouteLine: false,
          reasonNativeDirectionDisabled: "native direction support not probed yet",
        };
        var testLine = null;
        var testDashLine = null;
        try {
          if (map && sdkReport.polylineV2) {
            var center = null;
            try {
              center = readLatLngFields(map.getCenter && map.getCenter());
            } catch (_centerError) {}
            var baseLat = center && isFinite(center.latitude) ? center.latitude : 37.5665;
            var baseLng = center && isFinite(center.longitude) ? center.longitude : 126.9780;
            testLine = new Tmapv2.Polyline({
              path: [
                new Tmapv2.LatLng(baseLat, baseLng),
                new Tmapv2.LatLng(baseLat + 0.0004, baseLng + 0.0012),
                new Tmapv2.LatLng(baseLat + 0.0009, baseLng + 0.0024),
              ],
              strokeColor: "#00A84D",
              strokeWeight: 8,
              strokeOpacity: 0.001,
              lineCap: "round",
              lineJoin: "round",
              direction: true,
              directionColor: "#FFFFFF",
              directionOpacity: 0.001,
              map: map,
            });

            testDashLine = new Tmapv2.Polyline({
              path: [
                new Tmapv2.LatLng(baseLat, baseLng),
                new Tmapv2.LatLng(baseLat + 0.0002, baseLng + 0.0012),
              ],
              strokeColor: "#2F7BFF",
              strokeWeight: 5,
              strokeOpacity: 0.001,
              strokeStyle: "dash",
              map: map,
            });

            // 현재 로드된 SDK가 옵션을 실제 drawInfo에 반영하는지 확인한다.
            var directionCapability = readTmapNativeDirectionCapability(testLine);
            var dashDrawInfo = testDashLine && testDashLine._shape_data && testDashLine._shape_data.drawInfo;
            row.supportsDirection = directionCapability.supportsDirection;
            row.supportsDirectionColor = directionCapability.supportsDirectionColor;
            row.supportsDirectionOpacity = directionCapability.supportsDirectionOpacity;
            row.supportsDashStroke = !!dashDrawInfo && dashDrawInfo.strokeStyle === "dash";
            row.pathOrderControlsDirection = row.supportsDirection;
            row.arrowMovesWithPolyline = row.supportsDirection;
            row.usableForRouteLine = row.supportsDirection &&
              row.supportsDirectionColor &&
              row.supportsDirectionOpacity;
            row.reasonNativeDirectionDisabled = row.usableForRouteLine
              ? null
              : directionCapability.confirmed
              ? "Tmap Polyline direction options were not reflected by the loaded SDK."
              : "Tmap Polyline direction support could not be confirmed by the loaded SDK.";
          }
        } catch (error) {
          row.supportsDirection = false;
          row.supportsDirectionColor = false;
          row.supportsDirectionOpacity = false;
          row.pathOrderControlsDirection = false;
          row.arrowMovesWithPolyline = false;
          row.usableForRouteLine = false;
          row.reasonNativeDirectionDisabled = error && error.message ? String(error.message) : "Polyline direction option rejected";
          row.reason = row.reasonNativeDirectionDisabled;
        } finally {
          if (testLine && testLine.setMap) {
            setTimeout(function () {
              try {
                testLine.setMap(null);
              } catch (_removeError) {}
            }, 60);
          }
          if (testDashLine && testDashLine.setMap) {
            setTimeout(function () {
              try {
                testDashLine.setMap(null);
              } catch (_removeDashError) {}
            }, 60);
          }
        }

	        nativeDirectionReport = {
	          sdk: sdkReport,
	          rows: [row],
	        };
		        debugLog("[tmap-sdk]", sdkReport);
		        debugTable([{
	          sdk: row.sdk,
	          supportsDirection: row.supportsDirection,
	          supportsDirectionColor: row.supportsDirectionColor,
	          supportsDirectionOpacity: row.supportsDirectionOpacity,
	          supportsDashStroke: row.supportsDashStroke,
	          pathOrderControlsDirection: row.pathOrderControlsDirection,
	          arrowMovesWithPolyline: row.arrowMovesWithPolyline,
	          usableForRouteLine: row.usableForRouteLine,
	          reasonNativeDirectionDisabled: row.reasonNativeDirectionDisabled,
	        }]);
${TMAP_NATIVE_DIRECTION_REPORT_SCRIPT}
	        return nativeDirectionReport;
	      }

      function escapeXml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      }

      // 색상 문자열(hex/rgb/rgba)을 alpha가 포함된 rgba 형태로 변환한다.
      function colorWithAlpha(color, alpha) {
        var value = color ? String(color).trim() : "";
        if (!value) return "rgba(248,250,252," + alpha + ")";
        if (value.indexOf("rgba(") === 0) return value.replace(/rgba\(([^)]+)\)/, function (_m, body) {
          var p = body.split(",");
          if (p.length < 3) return value;
          return "rgba(" + p[0].trim() + "," + p[1].trim() + "," + p[2].trim() + "," + alpha + ")";
        });
        if (value.indexOf("rgb(") === 0) return value.replace(/rgb\(([^)]+)\)/, function (_m, body) {
          var p = body.split(",");
          if (p.length < 3) return value;
          return "rgba(" + p[0].trim() + "," + p[1].trim() + "," + p[2].trim() + "," + alpha + ")";
        });
        var hex = value.replace("#", "");
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length !== 6) return value;
        var r = parseInt(hex.slice(0, 2), 16);
        var g = parseInt(hex.slice(2, 4), 16);
        var b = parseInt(hex.slice(4, 6), 16);
        if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return value;
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
      }

      function readNumberField(source, keys) {
        if (!source) return NaN;
        for (var i = 0; i < keys.length; i += 1) {
          var key = keys[i];
          try {
            var value = source[key];
            if (typeof value === "function") value = value.call(source);
            var numberValue = Number(value);
            if (isFinite(numberValue)) return numberValue;
          } catch (_error) {}
        }
        return NaN;
      }

      function readPointXY(point) {
        if (!point) return null;
        var x = readNumberField(point, ["x", "_x", "getX"]);
        var y = readNumberField(point, ["y", "_y", "getY"]);
        if (!isFinite(x) || !isFinite(y)) return null;
        return { x: x, y: y };
      }

      function readLatLngFields(value) {
        if (!value) return null;
        var latitude = readNumberField(value, ["latitude", "lat", "_lat", "getLatitude", "getLat"]);
        var longitude = readNumberField(value, ["longitude", "lng", "_lng", "lon", "getLongitude", "getLng"]);
        if (!isFinite(latitude) || !isFinite(longitude)) return null;
        return { latitude: latitude, longitude: longitude };
      }

      function getRouteOverlaySize() {
        var overlayEl = document.getElementById("routeOverlay");
        var mapEl = document.getElementById("map");
        var rect = overlayEl && overlayEl.getBoundingClientRect ? overlayEl.getBoundingClientRect() : null;
        var width = rect && rect.width ? rect.width : (mapEl ? mapEl.clientWidth : window.innerWidth);
        var height = rect && rect.height ? rect.height : (mapEl ? mapEl.clientHeight : window.innerHeight);
        return {
          width: Math.max(1, Number(width) || 1),
          height: Math.max(1, Number(height) || 1),
        };
      }

      function readMapCenter() {
        if (!map) return null;
        try {
          if (typeof map.getCenter === "function") {
            var center = readLatLngFields(map.getCenter());
            if (center) return center;
          }
        } catch (_error) {}
        return readLatLngFields(map.center);
      }

      function readMapZoom() {
        if (!map) return NaN;
        try {
          return numberFromUnknown(map.getZoom ? map.getZoom() : map.zoom);
        } catch (_error) {
          return NaN;
        }
      }

      function mapDistanceMeters(from, to) {
        if (!from || !to) return NaN;
        var earthRadiusMeters = 6371008.8;
        var toRadians = Math.PI / 180;
        var startLat = from.latitude * toRadians;
        var endLat = to.latitude * toRadians;
        var deltaLat = (to.latitude - from.latitude) * toRadians;
        var deltaLng = (to.longitude - from.longitude) * toRadians;
        var sinLat = Math.sin(deltaLat / 2);
        var sinLng = Math.sin(deltaLng / 2);
        var value = (sinLat * sinLat) + (Math.cos(startLat) * Math.cos(endLat) * sinLng * sinLng);
        return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
      }

      function readBoundsCorner(bounds, methodNames, fieldNames) {
        if (!bounds) return null;
        for (var methodIndex = 0; methodIndex < methodNames.length; methodIndex += 1) {
          var methodName = methodNames[methodIndex];
          try {
            if (typeof bounds[methodName] !== "function") continue;
            var methodCorner = readLatLngFields(bounds[methodName]());
            if (methodCorner) return methodCorner;
          } catch (_methodError) {}
        }
        for (var fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex += 1) {
          try {
            var fieldCorner = readLatLngFields(bounds[fieldNames[fieldIndex]]);
            if (fieldCorner) return fieldCorner;
          } catch (_fieldError) {}
        }
        return null;
      }

      // React 쪽 화살표 샘플러가 추정 줌 대신 현재 TMAP viewport의 실제 축척을 사용한다.
      function readMapMetersPerPixel(center) {
        if (!map || !center) return NaN;
        var bounds = null;
        try {
          bounds = map.getBounds ? map.getBounds() : map.bounds;
        } catch (_boundsError) {}
        var southWest = readBoundsCorner(
          bounds,
          ["getSouthWest", "getSouthwest"],
          ["southWest", "southwest", "_sw", "sw"]
        );
        var northEast = readBoundsCorner(
          bounds,
          ["getNorthEast", "getNortheast"],
          ["northEast", "northeast", "_ne", "ne"]
        );
        if (!southWest || !northEast) return NaN;

        var size = getRouteOverlaySize();
        var horizontalMeters = mapDistanceMeters(
          { latitude: center.latitude, longitude: southWest.longitude },
          { latitude: center.latitude, longitude: northEast.longitude }
        );
        var verticalMeters = mapDistanceMeters(
          { latitude: southWest.latitude, longitude: center.longitude },
          { latitude: northEast.latitude, longitude: center.longitude }
        );
        var candidates = [];
        if (isFinite(horizontalMeters) && horizontalMeters > 0 && size.width > 0) {
          candidates.push(horizontalMeters / size.width);
        }
        if (isFinite(verticalMeters) && verticalMeters > 0 && size.height > 0) {
          candidates.push(verticalMeters / size.height);
        }
        if (candidates.length === 0) return NaN;
        return candidates.reduce(function (sum, value) { return sum + value; }, 0) / candidates.length;
      }

      function mercatorWorldPoint(latitude, longitude, zoom) {
        var clampedLat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
        var sinLat = Math.sin((clampedLat * Math.PI) / 180);
        var scale = 256 * Math.pow(2, zoom);
        return {
          x: ((longitude + 180) / 360) * scale,
          y: (0.5 - (Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))) * scale,
        };
      }

      function projectWithMapCenter(coord) {
        var center = readMapCenter();
        var zoom = readMapZoom();
        if (!center || !isFinite(zoom)) return null;
        var size = getRouteOverlaySize();
        var targetWorld = mercatorWorldPoint(coord.latitude, coord.longitude, zoom);
        var centerWorld = mercatorWorldPoint(center.latitude, center.longitude, zoom);
        return {
          x: (size.width / 2) + targetWorld.x - centerWorld.x,
          y: (size.height / 2) + targetWorld.y - centerWorld.y,
        };
      }

      function projectLatLngToScreenPoint(coord) {
        if (!map || !coord) return null;
        var latitude = Number(coord.latitude);
        var longitude = Number(coord.longitude);
        if (!isFinite(latitude) || !isFinite(longitude)) return null;
        // Tmap Web SDK builds differ on whether projection helpers return container
        // pixels or global world pixels. For the idle-only arrow layer we need stable
        // screen pixels, so prefer our camera/zoom based projection and only fall back
        // to SDK helpers if the camera state is not readable.
        var cameraProjectedPoint = projectWithMapCenter({ latitude: latitude, longitude: longitude });
        if (cameraProjectedPoint) return cameraProjectedPoint;
        var latLng = null;
        try {
          latLng = new Tmapv2.LatLng(latitude, longitude);
        } catch (_error) {
          latLng = { latitude: latitude, longitude: longitude };
        }

        var projection = null;
        try {
          projection = map.getProjection ? map.getProjection() : null;
        } catch (_projectionError) {
          projection = null;
        }

        var methodTargets = [
          { target: projection, methods: ["pointFromLatLngToContainerPixel", "fromLatLngToContainerPixel", "latLngToContainerPixel", "latLngToPoint", "fromLatLngToPoint"] },
          { target: map, methods: ["pointFromLatLngToContainerPixel", "fromLatLngToContainerPixel", "latLngToContainerPixel", "latLngToPoint", "fromLatLngToPoint"] },
        ];
        for (var groupIndex = 0; groupIndex < methodTargets.length; groupIndex += 1) {
          var group = methodTargets[groupIndex];
          if (!group.target) continue;
          for (var methodIndex = 0; methodIndex < group.methods.length; methodIndex += 1) {
            var methodName = group.methods[methodIndex];
            try {
              if (typeof group.target[methodName] !== "function") continue;
              var point = group.target[methodName].call(group.target, latLng);
              var screenPoint = readPointXY(point);
              if (screenPoint) return screenPoint;
            } catch (_methodError) {}
          }
        }

        return null;
      }

      function cleanScreenPoints(coords) {
        if (!Array.isArray(coords)) return [];
        var points = [];
        coords.forEach(function (coord) {
          var point = projectLatLngToScreenPoint(coord) || projectWithMapCenter(coord);
          if (!point || !isFinite(point.x) || !isFinite(point.y)) return;
          points.push(point);
        });
        return points;
      }

      function pointDistance(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
      }

      function isScreenPointNearViewport(point, margin) {
        if (!point || !isFinite(point.x) || !isFinite(point.y)) return false;
        var size = getRouteOverlaySize();
        var padding = isFinite(margin) ? Math.max(24, margin) : 48;
        return (
          point.x >= -padding &&
          point.x <= size.width + padding &&
          point.y >= -padding &&
          point.y <= size.height + padding
        );
      }

      function buildLinearSvgPath(points) {
        if (!Array.isArray(points) || points.length < 2) return "";
        var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
        for (var i = 1; i < points.length; i += 1) {
          path += " L" + points[i].x.toFixed(1) + " " + points[i].y.toFixed(1);
        }
        return path;
      }

      function buildRoundedSvgPath(points, radius) {
        if (!Array.isArray(points) || points.length < 3 || !isFinite(radius) || radius <= 0) {
          return buildLinearSvgPath(points);
        }
        var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
        for (var i = 1; i < points.length - 1; i += 1) {
          var previous = points[i - 1];
          var current = points[i];
          var next = points[i + 1];
          var prevLength = pointDistance(previous, current);
          var nextLength = pointDistance(current, next);
          if (prevLength < 5 || nextLength < 5) {
            path += " L" + current.x.toFixed(1) + " " + current.y.toFixed(1);
            continue;
          }
          var cornerRadius = Math.min(radius, prevLength * 0.42, nextLength * 0.42);
          var prevRatio = cornerRadius / prevLength;
          var nextRatio = cornerRadius / nextLength;
          var before = {
            x: current.x + ((previous.x - current.x) * prevRatio),
            y: current.y + ((previous.y - current.y) * prevRatio),
          };
          var after = {
            x: current.x + ((next.x - current.x) * nextRatio),
            y: current.y + ((next.y - current.y) * nextRatio),
          };
          path += " L" + before.x.toFixed(1) + " " + before.y.toFixed(1);
          path += " Q" + current.x.toFixed(1) + " " + current.y.toFixed(1) + " " + after.x.toFixed(1) + " " + after.y.toFixed(1);
        }
        var last = points[points.length - 1];
        path += " L" + last.x.toFixed(1) + " " + last.y.toFixed(1);
        return path;
      }

      function buildSmoothedSvgPath(points) {
        if (!Array.isArray(points) || points.length < 3) return buildLinearSvgPath(points);
        var path = "M" + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
        for (var i = 1; i < points.length - 1; i += 1) {
          var current = points[i];
          var next = points[i + 1];
          var midX = (current.x + next.x) / 2;
          var midY = (current.y + next.y) / 2;
          path += " Q" + current.x.toFixed(1) + " " + current.y.toFixed(1) + " " + midX.toFixed(1) + " " + midY.toFixed(1);
        }
        var last = points[points.length - 1];
        path += " L" + last.x.toFixed(1) + " " + last.y.toFixed(1);
        return path;
      }

      function buildRouteSvgPath(points, item) {
        if (item && item.smoothPath === true && Array.isArray(points) && points.length >= 4) {
          var smoothRadius = Number(item && item.cornerRadiusPx);
          if (!isFinite(smoothRadius) || smoothRadius <= 0) smoothRadius = 6;
          return buildRoundedSvgPath(points, smoothRadius * 0.72);
        }
        return buildRoundedSvgPath(points, Number(item && item.cornerRadiusPx) || 0);
      }

      function isArrowNearSharpCorner(points, cx, cy, avoidRadius) {
        if (!Array.isArray(points) || points.length < 3) return false;
        var radius = isFinite(avoidRadius) ? Math.max(12, avoidRadius) : 24;
        for (var i = 1; i < points.length - 1; i += 1) {
          var previous = points[i - 1];
          var current = points[i];
          var next = points[i + 1];
          var prevLength = pointDistance(previous, current);
          var nextLength = pointDistance(current, next);
          if (!isFinite(prevLength) || !isFinite(nextLength) || prevLength < 8 || nextLength < 8) continue;
          var incomingX = (current.x - previous.x) / prevLength;
          var incomingY = (current.y - previous.y) / prevLength;
          var outgoingX = (next.x - current.x) / nextLength;
          var outgoingY = (next.y - current.y) / nextLength;
          var dot = Math.max(-1, Math.min(1, (incomingX * outgoingX) + (incomingY * outgoingY)));
          var turnDegrees = Math.acos(dot) * 180 / Math.PI;
          if (!isFinite(turnDegrees) || turnDegrees < 28) continue;
          var cornerDistance = pointDistance({ x: cx, y: cy }, current);
          if (cornerDistance <= radius) return true;
        }
        return false;
      }

      function appendDirectionalArrows(svgParts, points, item) {
        if (!item || !item.showDirection || !Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.directionSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 24;
        var size = Number(item.directionSizePx);
        if (!isFinite(size) || size <= 0) size = 7;
        var arrowColor = item.directionColor ? String(item.directionColor) : "rgba(255,255,255,0.84)";
        var arrowOpacity = Number(item.directionOpacity);
        if (!isFinite(arrowOpacity)) arrowOpacity = 0.86;

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < spacing * 1.05) return;

        var requestedInset = Number(item.directionInsetPx);
        var inset = isFinite(requestedInset) && requestedInset > 0
          ? Math.min(requestedInset, total * 0.24)
          : Math.min(spacing * 0.72, total * 0.18);
        var endLimit = total - inset;
        var nextDistance = inset + (spacing * 0.48);
        var traveled = 0;
        var drawn = 0;
        var requestedMaxArrows = Number(item.directionMaxCount);
        var defaultMaxArrows = Math.max(1, Math.floor((endLimit - inset) / Math.max(8, spacing)) + 1);
        var maxArrows = Math.min(
          isFinite(requestedMaxArrows) && requestedMaxArrows > 0 ? requestedMaxArrows : 120,
          defaultMaxArrows
        );

        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxArrows; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 5) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }

          var ux = (to.x - from.x) / segmentDistance;
          var uy = (to.y - from.y) / segmentDistance;
          var nx = -uy;
          var ny = ux;

          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxArrows) {
	            var ratio = (nextDistance - traveled) / segmentDistance;
	            var cx = from.x + ((to.x - from.x) * ratio);
	            var cy = from.y + ((to.y - from.y) * ratio);
		            if (!isScreenPointNearViewport({ x: cx, y: cy }, Math.max(spacing * 1.4, size * 2.2))) {
		              nextDistance += spacing;
		              continue;
		            }
		            if (isArrowNearSharpCorner(points, cx, cy, Math.max(size * 2.8, spacing * 0.22))) {
		              nextDistance += spacing;
		              continue;
		            }
			            var tipX = cx + (ux * size * 0.38);
			            var tipY = cy + (uy * size * 0.38);
			            var tailX = cx - (ux * size * 0.30);
			            var tailY = cy - (uy * size * 0.30);
			            var halfWidth = size * 0.24;
		            var leftX = tailX + (nx * halfWidth);
		            var leftY = tailY + (ny * halfWidth);
		            var rightX = tailX - (nx * halfWidth);
		            var rightY = tailY - (ny * halfWidth);
		            svgParts.push(
		              '<path d="M' + leftX.toFixed(1) + ' ' + leftY.toFixed(1) +
		              ' L' + tipX.toFixed(1) + ' ' + tipY.toFixed(1) +
		              ' L' + rightX.toFixed(1) + ' ' + rightY.toFixed(1) +
		              ' Z" fill="' + escapeXml(arrowColor) +
		              '" stroke="none" opacity="' + arrowOpacity.toFixed(2) + '" />'
		            );
            drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
      }

      function findPointAtDistance(points, targetDistance) {
        if (!Array.isArray(points) || points.length < 2) return null;
        var traveled = 0;
        for (var i = 1; i < points.length; i += 1) {
          var from = points[i - 1];
          var to = points[i];
          var distance = pointDistance(from, to);
          if (!isFinite(distance) || distance < 0.5) continue;
          if (traveled + distance >= targetDistance) {
            var ratio = (targetDistance - traveled) / distance;
            return {
              x: from.x + ((to.x - from.x) * ratio),
              y: from.y + ((to.y - from.y) * ratio),
              ux: (to.x - from.x) / distance,
              uy: (to.y - from.y) / distance,
            };
          }
          traveled += distance;
        }
        var last = points[points.length - 1];
        var beforeLast = points[points.length - 2];
        var lastDistance = Math.max(1, pointDistance(beforeLast, last));
        return {
          x: last.x,
          y: last.y,
          ux: (last.x - beforeLast.x) / lastDistance,
          uy: (last.y - beforeLast.y) / lastDistance,
        };
      }

      function estimateSvgTextWidth(text) {
        var value = String(text || "");
        var width = 0;
        for (var i = 0; i < value.length; i += 1) {
          var ch = value.charAt(i);
          var code = value.charCodeAt(i);
          if (/[0-9]/.test(ch)) width += 7;
          else if (/[A-Za-z]/.test(ch)) width += 7;
          else if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)) width += 12;
          else width += 8;
        }
        return Math.max(18, width);
      }

      function appendLineLabel(svgParts, points, item, totalDistance) {
        var label = item && item.lineLabel ? String(item.lineLabel).trim() : "";
        if (!label || !Array.isArray(points) || points.length < 2 || !isFinite(totalDistance) || totalDistance < 48) return;
        var anchorDistance = totalDistance < 180
          ? totalDistance * 0.5
          : Math.min(totalDistance * 0.18, 72);
        var anchor = findPointAtDistance(points, anchorDistance);
        if (!anchor) return;
        var offset = Number(item.lineLabelOffsetPx);
        if (!isFinite(offset)) offset = 12;
        var nx = -anchor.uy;
        var ny = anchor.ux;
        var cx = anchor.x + (nx * offset);
        var cy = anchor.y + (ny * offset);
        var displayLabel = label.length <= 7 ? (label + " ›") : label;
        var width = Math.min(68, Math.max(38, estimateSvgTextWidth(displayLabel) + 15));
        var height = 19;
        var x = cx - (width / 2);
        var y = cy - (height / 2);
        var bg = item.lineLabelBackgroundColor ? String(item.lineLabelBackgroundColor) : (item.color || "#2F80FF");
        var textColor = item.lineLabelTextColor ? String(item.lineLabelTextColor) : "#FFFFFF";
        svgParts.push(
          '<g opacity="0.96">' +
            '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + width.toFixed(1) + '" height="' + height + '" rx="5" fill="' + escapeXml(bg) + '" stroke="rgba(255,255,255,0.52)" stroke-width="0.55" />' +
            '<text x="' + cx.toFixed(1) + '" y="' + (cy + 3.7).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-family="Arial, sans-serif" font-weight="800" fill="' + escapeXml(textColor) + '">' + escapeXml(displayLabel) + '</text>' +
          '</g>'
        );
      }

      function appendDotPath(svgParts, points, item) {
        if (!Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.dotSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 14;
        var dotSize = Number(item.dotSizePx);
        if (!isFinite(dotSize) || dotSize <= 0) dotSize = 6;
        var dotColor = item.dotColor ? String(item.dotColor) : (item.color || "#2F7BFF");
        var dotOutlineColor = item.dotOutlineColor ? String(item.dotOutlineColor) : "rgba(235,244,255,0.94)";
        var dotOutlineWidth = Number(item.dotOutlineWidth);
        if (!isFinite(dotOutlineWidth)) dotOutlineWidth = Math.max(0.8, dotSize * 0.16);
        var supportLineWidth = Number(item.supportLineWidth);
        var supportLineColor = item.supportLineColor ? String(item.supportLineColor) : "rgba(47,123,255,0.18)";
        if (isFinite(supportLineWidth) && supportLineWidth > 0) {
          svgParts.push(
            '<path d="' + buildRouteSvgPath(points, item) +
            '" fill="none" stroke="' + escapeXml(supportLineColor) +
            '" stroke-width="' + supportLineWidth.toFixed(1) +
            '" stroke-linecap="round" stroke-linejoin="round" />'
          );
        }

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < 6) return;

        function appendDotCircle(point) {
          svgParts.push(
            '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + dotRadius.toFixed(1) + '" fill="' + escapeXml(dotColor) + '" stroke="' + escapeXml(dotOutlineColor) + '" stroke-width="' + Math.max(0, dotOutlineWidth).toFixed(1) + '" />'
          );
        }

        var nextDistance = Math.min(spacing * 0.82, total * 0.28);
        var endLimit = Math.max(nextDistance, total - Math.min(spacing * 0.24, total * 0.12));
        var traveled = 0;
        var dotRadius = dotSize / 2;
        var maxDots = Math.min(600, Math.max(2, Math.floor(total / Math.max(5, spacing)) + 1));
        var drawn = 0;
        appendDotCircle(points[0]);
        drawn += 1;
        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxDots; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 1) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }
          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxDots) {
            var ratio = (nextDistance - traveled) / segmentDistance;
            var cx = from.x + ((to.x - from.x) * ratio);
            var cy = from.y + ((to.y - from.y) * ratio);
            appendDotCircle({ x: cx, y: cy });
            drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
        if (drawn < maxDots && pointDistance(points[0], points[points.length - 1]) > spacing * 0.42) {
          appendDotCircle(points[points.length - 1]);
        }
      }

      function totalScreenDistance(points) {
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          total += pointDistance(points[i - 1], points[i]);
        }
        return total;
      }

      function prepareRouteCanvas(canvas, size) {
        if (!canvas || !canvas.getContext) return null;
        var dpr = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
        var pixelWidth = Math.max(1, Math.round(size.width * dpr));
        var pixelHeight = Math.max(1, Math.round(size.height * dpr));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        canvas.style.width = size.width + "px";
        canvas.style.height = size.height + "px";
        routeOverlayDpr = dpr;
        var ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        return ctx;
      }

      function traceCanvasRoutePath(ctx, points, item) {
        if (!ctx || !Array.isArray(points) || points.length < 2) return;
        var radius = Number(item && item.cornerRadiusPx);
        if (!isFinite(radius) || radius <= 0) radius = 0;
        if (item && item.smoothPath === true && points.length >= 4) radius *= 0.72;

        ctx.moveTo(points[0].x, points[0].y);
        if (points.length < 3 || radius <= 0) {
          for (var i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          return;
        }

        for (var pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
          var previous = points[pointIndex - 1];
          var current = points[pointIndex];
          var next = points[pointIndex + 1];
          var prevLength = pointDistance(previous, current);
          var nextLength = pointDistance(current, next);
          if (prevLength < 5 || nextLength < 5) {
            ctx.lineTo(current.x, current.y);
            continue;
          }
          var cornerRadius = Math.min(radius, prevLength * 0.42, nextLength * 0.42);
          var prevRatio = cornerRadius / prevLength;
          var nextRatio = cornerRadius / nextLength;
          var before = {
            x: current.x + ((previous.x - current.x) * prevRatio),
            y: current.y + ((previous.y - current.y) * prevRatio),
          };
          var after = {
            x: current.x + ((next.x - current.x) * nextRatio),
            y: current.y + ((next.y - current.y) * nextRatio),
          };
          ctx.lineTo(before.x, before.y);
          ctx.quadraticCurveTo(current.x, current.y, after.x, after.y);
        }

        var last = points[points.length - 1];
        ctx.lineTo(last.x, last.y);
      }

      function strokeCanvasRoutePath(ctx, points, item, color, width, alpha) {
        if (!ctx || !Array.isArray(points) || points.length < 2 || !isFinite(width) || width <= 0) return;
        ctx.save();
        ctx.globalAlpha = isFinite(alpha) ? alpha : 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        traceCanvasRoutePath(ctx, points, item);
        ctx.stroke();
        ctx.restore();
      }

      function drawCanvasDirectionalArrows(ctx, points, item) {
        if (!ctx || !item || !item.showDirection || !Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.directionSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 24;
        var size = Number(item.directionSizePx);
        if (!isFinite(size) || size <= 0) size = 6;
        var arrowColor = item.directionColor ? String(item.directionColor) : "rgba(255,255,255,0.86)";
        var arrowOpacity = Number(item.directionOpacity);
        if (!isFinite(arrowOpacity)) arrowOpacity = 0.88;

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < spacing * 1.05) return;

        var requestedInset = Number(item.directionInsetPx);
        var inset = isFinite(requestedInset) && requestedInset > 0
          ? Math.min(requestedInset, total * 0.24)
          : Math.min(spacing * 0.7, total * 0.18);
        var endLimit = total - inset;
        var nextDistance = inset + (spacing * 0.48);
        var traveled = 0;
        var drawn = 0;
        var requestedMaxArrows = Number(item.directionMaxCount);
        var defaultMaxArrows = Math.max(1, Math.floor((endLimit - inset) / Math.max(8, spacing)) + 1);
        var maxArrows = Math.min(
          isFinite(requestedMaxArrows) && requestedMaxArrows > 0 ? requestedMaxArrows : 120,
          defaultMaxArrows
        );

        ctx.save();
        ctx.fillStyle = arrowColor;
        ctx.globalAlpha = arrowOpacity;
        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxArrows; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 5) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }

          var ux = (to.x - from.x) / segmentDistance;
          var uy = (to.y - from.y) / segmentDistance;
          var nx = -uy;
          var ny = ux;

          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxArrows) {
	            var ratio = (nextDistance - traveled) / segmentDistance;
	            var cx = from.x + ((to.x - from.x) * ratio);
	            var cy = from.y + ((to.y - from.y) * ratio);
		            if (!isScreenPointNearViewport({ x: cx, y: cy }, Math.max(spacing * 1.4, size * 2.2))) {
		              nextDistance += spacing;
		              continue;
		            }
		            if (isArrowNearSharpCorner(points, cx, cy, Math.max(size * 2.8, spacing * 0.22))) {
		              nextDistance += spacing;
		              continue;
		            }
				            var tipX = cx + (ux * size * 0.38);
				            var tipY = cy + (uy * size * 0.38);
				            var tailX = cx - (ux * size * 0.30);
				            var tailY = cy - (uy * size * 0.30);
				            var halfWidth = size * 0.24;
            ctx.beginPath();
			            ctx.moveTo(tailX + (nx * halfWidth), tailY + (ny * halfWidth));
            ctx.lineTo(tipX, tipY);
			            ctx.lineTo(tailX - (nx * halfWidth), tailY - (ny * halfWidth));
			            ctx.closePath();
			            ctx.fill();
            drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
        ctx.restore();
      }

      function drawCanvasRoundedRect(ctx, x, y, width, height, radius) {
        var r = Math.max(0, Math.min(radius, width / 2, height / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }

      function drawCanvasLineLabel(ctx, points, item, totalDistance) {
        var label = item && item.lineLabel ? String(item.lineLabel).trim() : "";
        if (!ctx || !label || !Array.isArray(points) || points.length < 2 || !isFinite(totalDistance) || totalDistance < 48) return;
        var anchorDistance = totalDistance < 180 ? totalDistance * 0.5 : Math.min(totalDistance * 0.18, 72);
        var anchor = findPointAtDistance(points, anchorDistance);
        if (!anchor) return;
        var offset = Number(item.lineLabelOffsetPx);
        if (!isFinite(offset)) offset = 12;
        var nx = -anchor.uy;
        var ny = anchor.ux;
        var cx = anchor.x + (nx * offset);
        var cy = anchor.y + (ny * offset);
        var displayLabel = label.length <= 7 ? (label + " ›") : label;
        var width = Math.min(68, Math.max(38, estimateSvgTextWidth(displayLabel) + 15));
        var height = 19;
        var x = cx - (width / 2);
        var y = cy - (height / 2);
        var bg = item.lineLabelBackgroundColor ? String(item.lineLabelBackgroundColor) : (item.color || "#2F80FF");
        var textColor = item.lineLabelTextColor ? String(item.lineLabelTextColor) : "#FFFFFF";

        ctx.save();
        ctx.globalAlpha = 0.96;
        drawCanvasRoundedRect(ctx, x, y, width, height, 5);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = 0.55;
        ctx.strokeStyle = "rgba(255,255,255,0.52)";
        ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.font = "800 10.5px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayLabel, cx, cy + 0.5);
        ctx.restore();
      }

      function drawCanvasDotPath(ctx, points, item) {
        if (!ctx || !Array.isArray(points) || points.length < 2) return;
        var spacing = Number(item.dotSpacingPx);
        if (!isFinite(spacing) || spacing <= 0) spacing = 14;
        var dotSize = Number(item.dotSizePx);
        if (!isFinite(dotSize) || dotSize <= 0) dotSize = 6;
        var dotRadius = dotSize / 2;
        var dotColor = item.dotColor ? String(item.dotColor) : (item.color || "#2F7BFF");
        var dotOutlineColor = item.dotOutlineColor ? String(item.dotOutlineColor) : "rgba(235,244,255,0.94)";
        var dotOutlineWidth = Number(item.dotOutlineWidth);
        if (!isFinite(dotOutlineWidth)) dotOutlineWidth = Math.max(0.8, dotSize * 0.16);
        var supportLineWidth = Number(item.supportLineWidth);
        var supportLineColor = item.supportLineColor ? String(item.supportLineColor) : "rgba(47,123,255,0.18)";
        if (isFinite(supportLineWidth) && supportLineWidth > 0) {
          strokeCanvasRoutePath(ctx, points, item, supportLineColor, supportLineWidth, 1);
        }

        var distances = [];
        var total = 0;
        for (var i = 1; i < points.length; i += 1) {
          var distance = pointDistance(points[i - 1], points[i]);
          distances.push(distance);
          total += distance;
        }
        if (!isFinite(total) || total < 6) return;

        function drawDot(point) {
          // 긴 경로가 화면 밖에서 시작해도 dot 제한을 소진하지 않게 보이는 점만 센다.
          if (!isScreenPointNearViewport(point, Math.max(spacing * 1.3, dotSize * 2.2))) return false;
          ctx.beginPath();
          ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
          if (dotOutlineWidth > 0 && dotOutlineColor !== "transparent") {
            ctx.lineWidth = dotOutlineWidth;
            ctx.strokeStyle = dotOutlineColor;
            ctx.stroke();
          }
          return true;
        }

        ctx.save();
        var nextDistance = Math.min(spacing * 0.82, total * 0.28);
        var endLimit = Math.max(nextDistance, total - Math.min(spacing * 0.24, total * 0.12));
        var traveled = 0;
        var maxDots = Math.min(600, Math.max(2, Math.floor(total / Math.max(5, spacing)) + 1));
        var drawn = 0;
        if (drawDot(points[0])) drawn += 1;
        for (var segmentIndex = 1; segmentIndex < points.length && drawn < maxDots; segmentIndex += 1) {
          var from = points[segmentIndex - 1];
          var to = points[segmentIndex];
          var segmentDistance = distances[segmentIndex - 1];
          if (!isFinite(segmentDistance) || segmentDistance < 1) {
            traveled += isFinite(segmentDistance) ? segmentDistance : 0;
            continue;
          }
          while (nextDistance <= endLimit && (traveled + segmentDistance) >= nextDistance && drawn < maxDots) {
            var ratio = (nextDistance - traveled) / segmentDistance;
            if (drawDot({
              x: from.x + ((to.x - from.x) * ratio),
              y: from.y + ((to.y - from.y) * ratio),
            })) drawn += 1;
            nextDistance += spacing;
          }
          traveled += segmentDistance;
        }
        if (drawn < maxDots && pointDistance(points[0], points[points.length - 1]) > spacing * 0.42) {
          drawDot(points[points.length - 1]);
        }
        ctx.restore();
      }

      function renderScreenRouteOverlaysNow() {
        screenRouteFrame = null;
        screenRouteRenderDelay = null;
        var overlayEl = document.getElementById("routeOverlay");
        if (!overlayEl) return;
        var items = Array.isArray(screenRouteOverlays) ? screenRouteOverlays : [];
        var size = getRouteOverlaySize();
        var ctx = prepareRouteCanvas(overlayEl, size);
        if (!ctx) return;
        if (isRouteOverlayMoving) {
          return;
        }
        if (!items.length) {
          return;
        }

        var sorted = items.slice().sort(function (a, b) {
          var az = Number(a && a.zIndex);
          var bz = Number(b && b.zIndex);
          if (!isFinite(az)) az = 0;
          if (!isFinite(bz)) bz = 0;
          return az - bz;
        });

        sorted.forEach(function (item) {
          var points = cleanScreenPoints(item.coords);
          if (points.length < 2) return;
          var totalDistance = totalScreenDistance(points);
          var shape = item.shape ? String(item.shape) : "solid";
          if (shape === "dot") {
            drawCanvasDotPath(ctx, points, item);
            return;
          }

          var strokeColor = item.color ? String(item.color) : "#1D72FF";
          var width = Number(item.width);
          if (!isFinite(width) || width <= 0) width = 8;
          var outlineWidth = Number(item.outlineWidth);
          if (!isFinite(outlineWidth)) outlineWidth = 0;
          var shouldDrawLine = item.drawLine !== false;
          if (shouldDrawLine && outlineWidth > 0) {
            var outlineColor = item.outlineColor ? String(item.outlineColor) : "rgba(255,255,255,0.5)";
            strokeCanvasRoutePath(ctx, points, item, outlineColor, width + (outlineWidth * 2), 1);
          }
          if (shouldDrawLine) {
            strokeCanvasRoutePath(ctx, points, item, strokeColor, width, 1);
          }
          drawCanvasDirectionalArrows(ctx, points, item);
          drawCanvasLineLabel(ctx, points, item, totalDistance);
        });
      }

      function scheduleScreenRouteOverlayRender(delayMs) {
        if (screenRouteRenderDelay !== null) {
          clearTimeout(screenRouteRenderDelay);
          screenRouteRenderDelay = null;
        }
        if (screenRouteFrame !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(screenRouteFrame);
        }
        var delay = Number(delayMs);
        if (isFinite(delay) && delay > 0) {
          screenRouteRenderDelay = setTimeout(function () {
            screenRouteRenderDelay = null;
            scheduleScreenRouteOverlayRender();
          }, delay);
          return;
        }
        if (typeof requestAnimationFrame === "function") {
          screenRouteFrame = requestAnimationFrame(renderScreenRouteOverlaysNow);
          return;
        }
        screenRouteFrame = null;
        setTimeout(renderScreenRouteOverlaysNow, 0);
      }

      function setRouteOverlayMoving(active) {
        var overlayEl = document.getElementById("routeOverlay");
        isRouteOverlayMoving = active === true;
        if (overlayEl && overlayEl.classList) {
          if (isRouteOverlayMoving) overlayEl.classList.add("route-overlay-moving");
          else overlayEl.classList.remove("route-overlay-moving");
        }
        var signature = [
          isRouteOverlayMoving ? "moving" : "idle",
          routeOverlayProjectionVersion,
        ].join(":");
        if (signature === lastRouteOverlayStateSignature) return;
        lastRouteOverlayStateSignature = signature;
        post("routeOverlayState", {
          isCameraMoving: isRouteOverlayMoving,
          projectionVersion: routeOverlayProjectionVersion,
          arrowRenderer: screenRouteOverlays.length > 0 ? "screen-overlay-idle-only" : "none",
          visible: !isRouteOverlayMoving,
        });
      }

      function markRouteOverlayMoving() {
        if (routeOverlayIdleTimer !== null) {
          clearTimeout(routeOverlayIdleTimer);
          routeOverlayIdleTimer = null;
        }
        isMapIdle = false;
        setRouteOverlayMoving(true);
        reportMapLayout("CAMERA_MOVING");
      }

      function markRouteOverlayIdleSoon(delayMs) {
        if (routeOverlayIdleTimer !== null) {
          clearTimeout(routeOverlayIdleTimer);
        }
        var delay = Number(delayMs);
        routeOverlayIdleTimer = setTimeout(function () {
          routeOverlayIdleTimer = null;
          routeOverlayProjectionVersion += 1;
          isMapIdle = true;
          setRouteOverlayMoving(false);
          scheduleScreenRouteOverlayRender();
          reportMapLayout("CAMERA_IDLE");
        }, isFinite(delay) ? Math.max(80, delay) : 160);
      }

      function setScreenRouteOverlays(items) {
        screenRouteOverlays = Array.isArray(items) ? items.slice() : [];
        scheduleScreenRouteOverlayRender();
        if (!isRouteOverlayMoving) {
          markRouteOverlayIdleSoon(90);
        }
      }

      // Lucide의 단순한 24px 선형을 마커 크기에 맞춰 배치한다.
      // 작은 지도 아이콘에서도 창문·바퀴·보행 형태가 뭉개지지 않는 형태만 사용한다.
      function markerLucideGlyph(style, centerX, centerY, renderedSize, color) {
        var size = Math.max(10, Number(renderedSize) || 14);
        var scale = size / 24;
        var x = centerX - (size / 2);
        var y = centerY - (size / 2);
        var stroke = color || "#FFFFFF";
        var paths = "";
        if (style === "bus") {
          paths =
            '<path d="M4 6 2 7" />' +
            '<path d="M10 6h4" />' +
            '<path d="m22 7-2-1" />' +
            '<rect width="16" height="16" x="4" y="3" rx="2" />' +
            '<path d="M4 11h16" />' +
            '<path d="M8 15h.01" />' +
            '<path d="M16 15h.01" />' +
            '<path d="M6 19v2" />' +
            '<path d="M18 21v-2" />';
        } else if (style === "subway") {
          paths =
            '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1" />' +
            '<path d="m9 15-1-1" />' +
            '<path d="m15 15 1-1" />' +
            '<path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" />' +
            '<path d="m8 19-2 3" />' +
            '<path d="m16 19 2 3" />';
        } else if (style === "walk") {
          paths =
            '<circle cx="12" cy="5" r="1" />' +
            '<path d="m9 20 3-6 3 6" />' +
            '<path d="m6 8 6 2 6-2" />' +
            '<path d="M12 10v4" />';
        }
        if (!paths) return "";
        return '<g transform="translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') scale(' + scale.toFixed(4) + ')" fill="none" stroke="' + stroke + '" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round">' + paths + '</g>';
      }

      // 출발/도착처럼 "지도 포인트 자체"를 강조할 때 쓰는 핀 렌더러.
      function markerIcon(item) {
        var fill = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var label = item && item.pinLabel ? String(item.pinLabel).trim() : "";
        var rawScale = Number(item && item.markerScale);
        var markerScale = isFinite(rawScale) ? Math.max(0.76, Math.min(1, rawScale)) : 1;
        // 핀 끝점을 TMAP Marker offset으로 반환해 경로 좌표와 시각적 끝점을 일치시킨다.
        var baseWidth = label ? 58 : 42;
        var baseHeight = label ? 64 : 52;
        var w = Math.round(baseWidth * markerScale);
        var h = Math.round(baseHeight * markerScale);
        var centerX = Math.round(baseWidth / 2);
        var textSize = label.length >= 3 ? 10.5 : 11.5;
        var anchorY = label ? 54 : 44;
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + baseWidth + ' ' + baseHeight + '">' +
            '<defs><filter id="pinShadow" x="-35%" y="-25%" width="170%" height="175%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.8" flood-color="#0F172A" flood-opacity="0.22" /></filter></defs>' +
            (label
              ? (
                '<ellipse cx="' + centerX + '" cy="58" rx="8.5" ry="2.6" fill="rgba(15,23,42,0.14)" />' +
                '<path filter="url(#pinShadow)" d="M' + centerX + ' 3 C18.5 3 10 11.3 10 21.5 C10 34.2 24.7 49.6 27.7 52.6 C28.4 53.3 29.6 53.3 30.3 52.6 C33.3 49.6 48 34.2 48 21.5 C48 11.3 39.5 3 ' + centerX + ' 3 Z" fill="' + fill + '" stroke="rgba(255,255,255,0.88)" stroke-width="1.7" stroke-linejoin="round" />' +
                '<circle cx="' + centerX + '" cy="21.5" r="13.2" fill="rgba(15,23,42,0.06)" />' +
                '<text x="' + centerX + '" y="25.2" text-anchor="middle" font-size="' + textSize + '" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="800" fill="#FFFFFF">' + escapeXml(label) + '</text>'
              )
              : '<path filter="url(#pinShadow)" fill="' + fill + '" stroke="rgba(255,255,255,0.88)" stroke-width="1.7" d="M21 3C11.6 3 4 10.6 4 20c0 11.6 13 24.5 15.6 27 .8.8 2 .8 2.8 0C25 44.5 38 31.6 38 20 38 10.6 30.4 3 21 3Zm0 23.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z"/>') +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
          anchorX: centerX * markerScale,
          anchorY: anchorY * markerScale,
        };
      }

      // 문자 종류별 가중치로 텍스트 폭을 추정한다.
      // 한글/숫자/영문의 실제 폭 차이를 반영해 배지 width 오차를 줄인다.
      function estimateBadgeTextWidth(label) {
        var text = String(label || "");
        var width = 0;
        for (var i = 0; i < text.length; i += 1) {
          var ch = text.charAt(i);
          var code = text.charCodeAt(i);
          if (/\s/.test(ch)) {
            width += 3.1;
          } else if (/[0-9]/.test(ch)) {
            width += 6.4;
          } else if (/[A-Z]/.test(ch)) {
            width += 7.0;
          } else if (/[a-z]/.test(ch)) {
            width += 6.1;
          } else if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)) {
            width += 9.7;
          } else {
            width += 7.4;
          }
        }
        return Math.max(16, Math.round(width));
      }

      // 교통 이벤트는 실제 좌표의 작은 원형 아이콘과 한 겹 라벨만 사용한다.
      function buildBadgeConfig(item) {
        var labelRaw = (item && item.badgeLabel) ? String(item.badgeLabel) : "";
        var label = labelRaw.trim();
        if (!label) label = item && item.caption ? String(item.caption) : "구간";

        var style = item && item.markerStyle ? String(item.markerStyle) : "default";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var textColor = item && item.badgeTextColor ? String(item.badgeTextColor) : "#1F2937";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(148,163,184,0.72)";
        var glyph = item && item.badgeGlyph ? String(item.badgeGlyph) : "";
        var eventIntent = item && item.eventIntent ? String(item.eventIntent) : "board";
        var variant = item && item.badgeVariant ? String(item.badgeVariant) : "default";
        var isRouteTag = variant === "route";
        var side = item && item.badgeSide === "left" ? "left" : "right";
        var specialStyle = style === "bus" || style === "subway" || style === "walk";
        var markerSize = specialStyle ? 28 : 24;
        var labelWidth = Math.max(44, Math.min(isRouteTag ? 96 : 116, estimateBadgeTextWidth(label) + 18));
        var overlap = 4;
        return {
          width: markerSize + labelWidth - overlap,
          height: Math.max(32, markerSize + 4),
          markerSize: markerSize,
          labelWidth: labelWidth,
          overlap: overlap,
          label: label,
          accent: accent,
          textColor: textColor,
          borderColor: borderColor,
          glyph: glyph,
          style: style,
          eventIntent: eventIntent,
          isRouteTag: isRouteTag,
          side: side,
          specialStyle: specialStyle,
        };
      }

      // 기준점은 원 중앙에 고정해 라벨 방향이 바뀌어도 승하차 좌표가 움직이지 않는다.
      function markerBadgeIcon(item) {
        var cfg = buildBadgeConfig(item);
        var label = escapeXml(cfg.label);
        var glyph = escapeXml(cfg.glyph);
        var w = cfg.width;
        var h = cfg.height;
        var centerY = h / 2;
        var labelX = cfg.side === "left" ? 0 : (cfg.markerSize - cfg.overlap);
        var iconCenterX = cfg.side === "left"
          ? (cfg.labelWidth - cfg.overlap + cfg.markerSize / 2)
          : cfg.markerSize / 2;
        var textX = labelX + 9;
        var markerFill = cfg.accent;
        var markerStroke = "#FFFFFF";
        var markerRadius = Math.max(10, (cfg.markerSize / 2) - 1);
        var cardFill = cfg.isRouteTag ? cfg.accent : "rgba(255,255,255,0.97)";
        var cardTextColor = cfg.isRouteTag ? "#FFFFFF" : cfg.textColor;
        var cardBorder = cfg.isRouteTag
          ? "rgba(255,255,255,0.72)"
          : (cfg.specialStyle ? colorWithAlpha(cfg.accent, 0.46) : cfg.borderColor);
        var badgeGlyphScale = cfg.style === "walk" ? 0.70 : 0.66;
        var iconMarkup = markerLucideGlyph(cfg.style, iconCenterX, centerY, cfg.markerSize * badgeGlyphScale, "#FFFFFF");
        if (!iconMarkup && glyph) {
          iconMarkup = '<text x="' + iconCenterX + '" y="' + (centerY + 3.5) + '" text-anchor="middle" font-size="10" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-weight="800" fill="#FFFFFF">' + glyph + '</text>';
        }
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<defs><filter id="badgeShadow" x="-25%" y="-35%" width="150%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#0F172A" flood-opacity="0.24" /></filter></defs>' +
            '<g filter="url(#badgeShadow)">' +
              '<rect x="' + (labelX + 0.75) + '" y="2.5" width="' + (cfg.labelWidth - 1.5) + '" height="25" rx="6" fill="' + cardFill + '" stroke="' + cardBorder + '" stroke-width="1.1" />' +
              '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="' + markerRadius + '" fill="' + markerFill + '" stroke="' + markerStroke + '" stroke-width="2" />' +
            '</g>' +
            '<text x="' + textX + '" y="19" font-size="11" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="700" fill="' + cardTextColor + '">' + label + '</text>' +
            iconMarkup +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
          anchorX: iconCenterX,
          anchorY: centerY,
        };
      }

      // 노선명 태그는 승하차 노드와 분리한다. 줌 단계가 바뀌어도 노드 아이콘은 교체되지 않는다.
      function markerRouteLabelIcon(item) {
        var rawLabel = item && item.badgeLabel ? String(item.badgeLabel).trim() : "";
        var label = rawLabel || (item && item.caption ? String(item.caption) : "노선");
        var subLabel = item && item.badgeSubLabel ? String(item.badgeSubLabel).trim() : "";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var side = item && item.badgeSide === "left" ? "left" : "right";
        var variant = item && item.badgeVariant ? String(item.badgeVariant) : "route";
        var isContext = variant === "context";
        var isStop = variant === "stop";
        var widthLimit = isContext ? 158 : (isStop ? 168 : 88);
        var widthFloor = isContext ? 92 : (isStop ? 54 : 40);
        var estimatedWidth = Math.max(
          estimateBadgeTextWidth(label),
          subLabel ? estimateBadgeTextWidth(subLabel) : 0
        );
        var labelWidth = Math.max(widthFloor, Math.min(widthLimit, estimatedWidth + (isContext ? 28 : 18)));
        // 핵심 노드의 바깥 링과 라벨 사이에 여백을 둬서 한 덩어리처럼 뭉쳐 보이지 않게 한다.
        var gap = isContext ? 12 : 11;
        var width = labelWidth + gap;
        var height = isContext ? 44 : (isStop ? 28 : 30);
        var centerY = height / 2;
        var boxX = side === "left" ? 0 : gap;
        var anchorX = side === "left" ? width : 0;
        var boxEdgeX = side === "left" ? labelWidth : gap;
        var textX = isContext || isStop ? boxX + 13 : boxX + (labelWidth / 2);
        var boxY = isContext ? 2.5 : (isStop ? 2.5 : 3.5);
        var boxHeight = isContext ? 39 : (isStop ? 23 : 23);
        var cardFill = isContext || isStop
          ? (isDarkTheme ? "rgba(17,24,39,0.97)" : "rgba(255,255,255,0.98)")
          : accent;
        var primaryColor = isContext || isStop
          ? (isDarkTheme ? "#F9FAFB" : "#111827")
          : "#FFFFFF";
        var secondaryColor = isDarkTheme ? "#CBD5E1" : "#4B5563";
        var textAnchor = isContext || isStop ? "start" : "middle";
        var textMarkup = isContext
          ? (
              '<text x="' + textX + '" y="17" text-anchor="start" font-size="11.2" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="750" fill="' + primaryColor + '">' + escapeXml(label) + '</text>' +
              (subLabel ? '<text x="' + textX + '" y="31.5" text-anchor="start" font-size="9.8" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="600" fill="' + secondaryColor + '">' + escapeXml(subLabel) + '</text>' : '')
            )
          : '<text x="' + textX + '" y="' + (isStop ? 18.1 : 18.9) + '" text-anchor="' + textAnchor + '" font-size="' + (isStop ? 10.2 : 10.5) + '" font-family="-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif" font-weight="700" fill="' + primaryColor + '">' + escapeXml(label) + '</text>';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
            '<defs><filter id="routeLabelShadow" x="-25%" y="-35%" width="150%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#0F172A" flood-opacity="0.20" /></filter></defs>' +
            '<line x1="' + anchorX + '" y1="' + centerY + '" x2="' + boxEdgeX + '" y2="' + centerY + '" stroke="' + accent + '" stroke-width="1.6" stroke-linecap="round" />' +
            '<rect filter="url(#routeLabelShadow)" x="' + (boxX + 0.5) + '" y="' + boxY + '" width="' + (labelWidth - 1) + '" height="' + boxHeight + '" rx="6" fill="' + cardFill + '" stroke="' + (isContext || isStop ? colorWithAlpha(accent, 0.72) : "rgba(255,255,255,0.58)") + '" stroke-width="' + (isContext ? 1.1 : 0.8) + '" />' +
            (isContext ? '<rect x="' + (boxX + 1.5) + '" y="4.5" width="4" height="35" rx="2" fill="' + accent + '" />' : '') +
            textMarkup +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: width,
          height: height,
          anchorX: anchorX,
          anchorY: centerY,
        };
      }

      function markerDotIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(255,255,255,0.95)";
        var rawSize = Number(item && item.dotSize);
        // QA 앵커 비교용 단일 점이다. 경로 점선은 이 마커가 아니라 TMAP Polyline dash를 사용한다.
        var size = isFinite(rawSize) ? Math.max(4, Math.min(14, Math.round(rawSize))) : 8;
        var center = Math.round(size / 2);
        var borderWidth = borderColor === "transparent" ? 0 : Math.max(0.7, size * 0.16);
        var radius = Math.max(0.9, center - (borderWidth > 0 ? 1.0 : 0.7));
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="' + bg + '" stroke="' + borderColor + '" stroke-width="' + borderWidth + '" />' +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: size,
          height: size,
        };
      }

      function markerStationIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var style = item && item.markerStyle ? String(item.markerStyle) : "subway";
        var stationVariant = item && item.stationVariant ? String(item.stationVariant) : "default";
        var isCompact = stationVariant === "compact";
        var rawSize = Number(item && item.dotSize);
        // 통과 정류장은 얇은 노선색 링으로 유지하고, 승하차·환승 노드는 아이콘을 크게 보여준다.
        var size = isFinite(rawSize)
          ? Math.max(isCompact ? 10 : 20, Math.min(isCompact ? 16 : 36, Math.round(rawSize)))
          : (isCompact ? 12 : 28);
        var center = size / 2;
        if (isCompact) {
          var compactOuterStroke = Math.max(0.9, size * 0.08);
          var compactRouteStroke = Math.max(1.25, size * 0.11);
          var compactInnerRadius = Math.max(2.1, center - 3.0);
          var compactSvg = '' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
              '<defs><filter id="compactStopShadow" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="0.6" stdDeviation="0.7" flood-color="#0F172A" flood-opacity="0.24" /></filter></defs>' +
              '<circle filter="url(#compactStopShadow)" cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + (center - 1).toFixed(1) + '" fill="#FFFFFF" stroke="rgba(15,23,42,0.72)" stroke-width="' + compactOuterStroke.toFixed(1) + '" />' +
              '<circle cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + compactInnerRadius.toFixed(1) + '" fill="#FFFFFF" stroke="' + bg + '" stroke-width="' + compactRouteStroke.toFixed(1) + '" />' +
            '</svg>';
          return {
            uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(compactSvg),
            width: size,
            height: size,
          };
        }
        var glyphStyle = style === "bus" || style === "walk" ? style : "subway";
        var glyphScale = glyphStyle === "walk" ? 0.68 : 0.64;
        var glyph = markerLucideGlyph(glyphStyle, center, center, size * glyphScale, "#FFFFFF");
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<defs><filter id="stationNodeShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="0.9" stdDeviation="1.1" flood-color="#0F172A" flood-opacity="0.22" /></filter></defs>' +
            '<circle filter="url(#stationNodeShadow)" cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + (center - 1).toFixed(1) + '" fill="#FFFFFF" />' +
            '<circle cx="' + center.toFixed(1) + '" cy="' + center.toFixed(1) + '" r="' + (center - 3.2).toFixed(1) + '" fill="' + bg + '" />' +
            glyph +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: size,
          height: size,
        };
      }
      // 지도 테마는 앱/프로필 테마 값을 그대로 전달하고, TMAP native mapType을 우선 적용한다.
      // 지도 컨테이너 전체에 필터나 tone overlay를 얹으면 안내선·마커까지 탁해지므로 사용하지 않는다.
      // Tmap Web SDK는 dark mapType 이름이 런타임마다 달라 보이지만,
      // 지원하지 않는 값을 넣어도 setMapType()이 조용히 통과하는 경우가 있다.
      // 기존 구현처럼 후보를 넓게 추측하면 \"적용 성공\"으로 오판해서 타일 fallback이 꺼지고
      // 결과적으로 지도 타일은 계속 라이트로 남는다.
      // 그래서 아래 로직은:
      // 1) SDK가 실제로 export한 정확한 키만 후보로 사용하고
      // 2) getter로 mapType 변화가 확인될 때만 native theme 성공으로 인정한다.
      // 검증이 불가능하면 false를 반환해 기본 타일만 대상으로 하는 dark fallback을 사용한다.
      function resolveVerifiedNativeMapTypeCandidates() {
        if (nativeMapTypeCandidates) return nativeMapTypeCandidates;

        nativeMapTypeCandidates = {
          light: [],
          dark: [],
        };

        try {
          var mapTypeObj = (window.Tmapv2 && Tmapv2.MapType) ? Tmapv2.MapType : null;
          if (!mapTypeObj || typeof mapTypeObj !== "object") return nativeMapTypeCandidates;

          // 여기서는 "SDK가 실제로 export한 키"만 후보로 쓴다.
          // 추정 문자열까지 섞어 넣으면 setMapType()이 조용히 통과하는 런타임에서
          // dark theme 성공으로 오판할 수 있어서, 후보 집합 자체를 보수적으로 유지한다.
          var appendUniqueCandidate = function (bucket, key) {
            var value = mapTypeObj[key];
            if (value === undefined || value === null) return;
            if (bucket.some(function (candidate) { return String(candidate) === String(value); })) return;
            bucket.push(value);
          };

          ["ROAD", "BASIC", "NORMAL", "DEFAULT", "STANDARD", "BASE", "DAY"].forEach(function (key) {
            appendUniqueCandidate(nativeMapTypeCandidates.light, key);
          });
          ["NIGHT", "NAVI_NIGHT", "MIDNIGHT", "DARK", "BLACK", "DARKMODE"].forEach(function (key) {
            appendUniqueCandidate(nativeMapTypeCandidates.dark, key);
          });
        } catch (_error) {
          nativeMapTypeCandidates = {
            light: [],
            dark: [],
          };
        }

        return nativeMapTypeCandidates;
      }

      // 현재 mapType을 읽어 검증할 수 있는 런타임인지 먼저 확인한다.
      // setter만 있고 getter가 전혀 없으면 "실제로 바뀌었는지"를 증명할 수 없으므로
      // native theme 적용 성공으로 보지 않고 CSS fallback 경로를 유지한다.
      function canInspectMapType() {
        if (!map) return false;
        if (typeof map.getMapType === "function") return true;
        if (typeof map.mapType !== "undefined") return true;
        if (typeof map.mapTypeId !== "undefined") return true;
        return false;
      }

      function readCurrentMapType() {
        if (!map) return undefined;

        try {
          // SDK 버전에 따라 노출하는 getter/field 이름이 달라서 읽기 경로를 순서대로 시도한다.
          if (typeof map.getMapType === "function") {
            return map.getMapType();
          }
          if (typeof map.mapType !== "undefined") {
            return map.mapType;
          }
          if (typeof map.mapTypeId !== "undefined") {
            return map.mapTypeId;
          }
        } catch (_error) {}

        return undefined;
      }

      function isSameMapTypeValue(left, right) {
        if (left === right) return true;
        if (left === undefined || left === null || right === undefined || right === null) return false;
        return String(left) === String(right);
      }

      function trySetVerifiedMapType(candidates) {
        if (!map || !map.setMapType || !Array.isArray(candidates) || candidates.length === 0 || !canInspectMapType()) {
          return false;
        }

        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          var before = readCurrentMapType();

          try {
            map.setMapType(candidate);
            var after = readCurrentMapType();
            // setter 호출 직후에도 값을 읽지 못하면 "적용 여부를 입증할 수 없는 상태"다.
            // 이런 경우는 성공으로 치지 않고 다음 후보를 보거나 fallback으로 넘긴다.
            if (after === undefined || after === null) {
              continue;
            }
            // 1) getter가 후보 값을 그대로 돌려주거나
            // 2) before/after 값이 명확히 달라져 실제 변경이 관측될 때만
            // native mapType 적용이 성공했다고 판정한다.
            if (isSameMapTypeValue(after, candidate)) {
              return true;
            }
            if (before !== undefined && before !== null && !isSameMapTypeValue(before, after)) {
              return true;
            }
          } catch (_error) {
            // 다음 후보를 확인한다.
          }
        }

        return false;
      }

      function resolveVerifiedNativeThemeApplied(isDark) {
        var candidates = resolveVerifiedNativeMapTypeCandidates();
        if (isDark) {
          return trySetVerifiedMapType(candidates.dark);
        }
        // 라이트 모드는 대부분의 런타임에서 기본 상태다.
        // 전용 light mapType 상수가 없어도 굳이 실패로 볼 필요가 없고,
        // false를 반환하면 라이트 모드에서 불필요한 fallback tint가 깔릴 수 있으므로
        // 이런 경우는 "이미 정상 상태"로 간주한다.
        if (!Array.isArray(candidates.light) || candidates.light.length === 0) {
          return true;
        }
        return trySetVerifiedMapType(candidates.light);
      }

      function isMapBaseTileImage(imgEl) {
        if (!imgEl) return false;
        var source = "";
        try {
          source = String(imgEl.currentSrc || imgEl.getAttribute("src") || "").trim();
        } catch (_error) {}
        if (!source) return false;

        var imageWidth = Number(imgEl.naturalWidth || imgEl.width || imgEl.clientWidth || 0);
        var imageHeight = Number(imgEl.naturalHeight || imgEl.height || imgEl.clientHeight || 0);
        if ((imageWidth > 0 && imageWidth < 128) || (imageHeight > 0 && imageHeight < 128)) {
          return false;
        }

        // 앱의 Marker 아이콘은 data URI다. 이 이미지는 지도 타일과 달리
        // 경로 정보 자체이므로 색상·명도 필터에서 반드시 제외한다.
        return source.indexOf("data:") !== 0 && source.indexOf("blob:") !== 0;
      }

      function getRouteFocusTileFilter() {
        if (!isRouteFocusMode) return "none";
        if (isDarkTheme) {
          if (nativeDarkMapTypeApplied) {
            return routeMapTileFilters.darkNative;
          }
          // TMAP 런타임에 native dark mapType이 없는 경우에만 기본 타일을 어둡게 변환한다.
          // Marker와 Polyline은 별도 native overlay라 이 필터의 영향을 받지 않는다.
          return routeMapTileFilters.darkFallback;
        }
        return routeMapTileFilters.light;
      }

      function syncMapTilePresentation() {
        var mapEl = document.getElementById("map");
        if (!mapEl || !mapEl.querySelectorAll) return;
        var imgNodes = mapEl.querySelectorAll("img");
        var tileFilter = getRouteFocusTileFilter();
        var tilePanes = [];
        for (var index = 0; index < imgNodes.length; index += 1) {
          var imgEl = imgNodes[index];
          if (!imgEl || !imgEl.style) continue;

          // 타일마다 filter를 적용하면 iOS WKWebView가 각 이미지를 별도 레이어로
          // 합성하면서 줌 이동 후 1px 경계가 생긴다. TMAP의 타일 전용 pane에 한 번만
          // 적용해 경로 Polyline/Marker는 그대로 두고 타일 사이 이음새를 없앤다.
          imgEl.style.filter = "none";
          imgEl.style.transition = "";
          if (!isMapBaseTileImage(imgEl)) continue;

          var tilePane = imgEl.parentElement;
          if (!tilePane || tilePane === mapEl || !tilePane.style) continue;
          if (tilePane.querySelector && tilePane.querySelector("svg, canvas")) continue;
          if (tilePanes.indexOf(tilePane) < 0) tilePanes.push(tilePane);
        }

        for (var paneIndex = 0; paneIndex < tilePanes.length; paneIndex += 1) {
          var pane = tilePanes[paneIndex];
          pane.style.filter = tileFilter;
          pane.style.transition = "none";
          pane.style.backfaceVisibility = "hidden";
        }
      }

      function bindMapTilePresentationObserver() {
        var mapEl = document.getElementById("map");
        if (!mapEl || typeof MutationObserver === "undefined") return;
        if (mapTilePresentationObserver) {
          mapTilePresentationObserver.disconnect();
          mapTilePresentationObserver = null;
        }
        // TMAP은 이동·확대 때 타일 DOM을 교체하므로 새 타일에도 같은 표현 규칙을 적용한다.
        mapTilePresentationObserver = new MutationObserver(function () {
          syncMapTilePresentation();
        });
        mapTilePresentationObserver.observe(mapEl, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"],
        });
        syncMapTilePresentation();
      }

      function applyTheme(isDark) {
        isDarkTheme = !!isDark;
        var mapEl = document.getElementById("map");
        var toneEl = document.getElementById("mapTone");
        var locationBtn = document.getElementById("locationBtn");

        // 우선 native mapType을 사용한다. 지원되지 않을 때만 경로 화면의 기본 타일을
        // 선택적으로 변환하며, 전체 지도 필터나 tone overlay는 사용하지 않는다.
        nativeDarkMapTypeApplied = isDarkTheme && resolveVerifiedNativeThemeApplied(true);
        if (!isDarkTheme) {
          resolveVerifiedNativeThemeApplied(false);
        }

        if (mapEl) {
          mapEl.style.filter = "none";
          mapEl.style.transition = "none";
        }

        syncMapTilePresentation();

        if (toneEl) {
          toneEl.style.background = "transparent";
          toneEl.style.opacity = "0";
        }

        document.body.style.backgroundColor = isDarkTheme ? "#0B1220" : "#F2F2F7";

        if (locationBtn) {
          locationBtn.style.backgroundColor = isDarkTheme
            ? "rgba(22, 28, 39, 0.9)"
            : "rgba(255,255,255,0.95)";
          locationBtn.style.color = isDarkTheme ? "#E5EDF8" : "#111827";
          locationBtn.style.borderColor = isDarkTheme
            ? "rgba(123, 145, 171, 0.4)"
            : "rgba(17, 24, 39, 0.2)";
          locationBtn.style.boxShadow = isDarkTheme
            ? "0 4px 10px rgba(2, 6, 23, 0.45)"
            : "0 4px 10px rgba(0,0,0,0.18)";
        }
      }

      function applyBaseDim(opacity) {
        var toneEl = document.getElementById("mapTone");
        if (!toneEl) return;
        var value = Number(opacity);
        if (!isFinite(value) || value <= 0) {
          toneEl.style.background = "transparent";
          toneEl.style.opacity = "0";
          return;
        }
        var clamped = Math.max(0, Math.min(0.85, value));
        toneEl.style.background = isDarkTheme
          ? "rgba(0,0,0,0.36)"
          : "rgba(255,255,255,0.64)";
        toneEl.style.opacity = String(clamped);
      }

      function clearMarkers() {
        Object.keys(markers).forEach(function (key) {
          var entry = markers[key];
          var marker = entry && entry.marker ? entry.marker : entry;
          if (marker && marker.setMap) marker.setMap(null);
        });
        markers = {};
      }

      function buildMarkerIconInfo(item) {
        var displayType = item && item.displayType ? String(item.displayType) : "pin";
        if (displayType === "routeLabel") return markerRouteLabelIcon(item);
        if (displayType === "badge") return markerBadgeIcon(item);
        if (displayType === "dot") return markerDotIcon(item);
        if (displayType === "station") return markerStationIcon(item);
        return markerIcon(item);
      }

      function markerRectFromIcon(item, iconInfo) {
        var point = projectLatLngToScreenPoint(item);
        if (!point || !iconInfo) return null;
        var anchorX = Number(iconInfo.anchorX);
        var anchorY = Number(iconInfo.anchorY);
        if (!isFinite(anchorX)) anchorX = iconInfo.width / 2;
        if (!isFinite(anchorY)) anchorY = iconInfo.height / 2;
        return {
          left: point.x - anchorX,
          top: point.y - anchorY,
          right: point.x - anchorX + iconInfo.width,
          bottom: point.y - anchorY + iconInfo.height,
        };
      }

      function paddedMarkerRect(rect, padding) {
        var value = isFinite(padding) ? Math.max(0, padding) : 0;
        return {
          left: rect.left - value,
          top: rect.top - value,
          right: rect.right + value,
          bottom: rect.bottom + value,
        };
      }

      function markerRectsOverlap(left, right) {
        return !(
          left.right <= right.left ||
          left.left >= right.right ||
          left.bottom <= right.top ||
          left.top >= right.bottom
        );
      }

      function resolveRouteLabelViewportSide(item, iconInfo) {
        var displayType = item && item.displayType ? String(item.displayType) : "pin";
        if (displayType !== "routeLabel") return { item: item, iconInfo: iconInfo };
        var rect = markerRectFromIcon(item, iconInfo);
        if (!rect) return { item: item, iconInfo: iconInfo };
        var viewport = getRouteOverlaySize();
        var side = item && item.badgeSide === "left" ? "left" : "right";
        var nextSide = side;
        if (rect.right > viewport.width - 10 && side !== "left") nextSide = "left";
        else if (rect.left < 10 && side !== "right") nextSide = "right";
        if (nextSide === side) return { item: item, iconInfo: iconInfo };

        var resolvedItem = Object.assign({}, item, { badgeSide: nextSide });
        return {
          item: resolvedItem,
          iconInfo: buildMarkerIconInfo(resolvedItem),
        };
      }

      // 실제 화면 좌표에서 고우선순위 마커 영역을 먼저 예약한다.
      // 핵심 승하차·출발·도착은 유지하고, 낮은 우선순위 라벨과 통과 정류장은 충돌 시 생략한다.
      function prepareMarkerItemsForRender(sortedItems) {
        var prepared = sortedItems.map(function (item) {
          var iconInfo = null;
          try {
            iconInfo = buildMarkerIconInfo(item);
          } catch (_iconError) {
            try { iconInfo = markerIcon(item); } catch (_fallbackError) {}
          }
          if (!iconInfo) return null;
          var resolved = resolveRouteLabelViewportSide(item, iconInfo);
          return { item: resolved.item, iconInfo: resolved.iconInfo };
        }).filter(function (entry) { return !!entry; });

        var retainedIds = {};
        var occupiedRects = [];
        var viewport = getRouteOverlaySize();
        prepared.slice().reverse().forEach(function (entry) {
          var item = entry.item;
          var displayType = item && item.displayType ? String(item.displayType) : "pin";
          var variant = item && item.badgeVariant ? String(item.badgeVariant) : "";
          var isRouteLabel = displayType === "routeLabel";
          var isContextLabel = isRouteLabel && variant === "context";
          var isPassStopNode = displayType === "station" && !(item && item.eventIntent);
          var markerId = item && item.id != null ? String(item.id) : "";
          if (!markerId) return;

          var rect = markerRectFromIcon(item, entry.iconInfo);
          if (!rect) {
            retainedIds[markerId] = true;
            return;
          }
          var outsideViewport = rect.right < 8 || rect.left > viewport.width - 8 ||
            rect.bottom < 8 || rect.top > viewport.height - 8;
          var collides = occupiedRects.some(function (occupied) {
            // 정류장명 라벨과 같은 정류장의 노드는 한 시각 단위다. 라벨이 먼저 예약한 영역을
            // 자기 노드의 충돌로 계산하면 노선 위 원형 정류장만 사라지므로 이 한 쌍만 제외한다.
            if (isPassStopNode && occupied.markerId === markerId + "-label") return false;
            return markerRectsOverlap(paddedMarkerRect(rect, 5), occupied.rect);
          });

          // 상세 승차·환승 문구는 행동에 필요한 핵심 정보라 근접 핀과 겹쳐도 유지한다.
          // 좌표가 화면 밖인 경우만 생략하고, 일반 노선·정류장 라벨은 충돌 시 정리한다.
          if ((isRouteLabel || isPassStopNode) && outsideViewport) return;
          if (((isRouteLabel && !isContextLabel) || isPassStopNode) && collides) return;
          retainedIds[markerId] = true;
          if (isRouteLabel || displayType === "badge" || displayType === "pin" || displayType === "station") {
            occupiedRects.push({
              markerId: markerId,
              rect: paddedMarkerRect(rect, isRouteLabel ? 5 : 4),
            });
          }
        });

        return prepared.filter(function (entry) {
          var markerId = entry.item && entry.item.id != null ? String(entry.item.id) : "";
          return !!retainedIds[markerId];
        });
      }

      // React 쪽 marker 모델(displayType / markerStyle)을 실제 Tmap Marker/SVG로 변환해 배치한다.
      function renderMarkers(markerItems, preserveCache) {
        if (!map) return;
        if (!preserveCache) latestMarkerItems = Array.isArray(markerItems) ? markerItems.slice() : [];
        var retainedMarkerIds = {};
        // zIndex 낮은 순으로 생성해 고우선순위 마커(출발/도착)가 마지막에 그려지게 한다.
        var sortedItems = Array.isArray(markerItems) ? markerItems.slice() : [];
        sortedItems.sort(function (a, b) {
          var az = Number(a && a.zIndex);
          var bz = Number(b && b.zIndex);
          if (!isFinite(az)) az = 0;
          if (!isFinite(bz)) bz = 0;
          return az - bz;
        });
        var preparedItems = prepareMarkerItemsForRender(sortedItems);
        preparedItems.forEach(function (preparedEntry) {
          var item = preparedEntry.item;
          var displayType = item && item.displayType ? String(item.displayType) : "pin";
          var isBadge = displayType === "badge";
          var isDot = displayType === "dot";
          var isStation = displayType === "station";
          var isRouteLabel = displayType === "routeLabel";
          // 아이콘 생성 실패 시 기본 pin 아이콘으로 fallback 한다.
          var iconInfo = preparedEntry.iconInfo;

          var markerOption = {
            position: toLatLng(item),
            icon: iconInfo.uri,
            iconSize: new Tmapv2.Size(iconInfo.width, iconInfo.height),
            title: item.caption || "",
            map: map,
          };
          var markerZIndex = Number(item && item.zIndex);
          if (!isFinite(markerZIndex)) markerZIndex = undefined;

          if (window.Tmapv2 && Tmapv2.Point) {
            try {
              var markerStyle = item && item.markerStyle ? String(item.markerStyle) : "default";
              var isFloatingBadge = isBadge && (markerStyle === "bus" || markerStyle === "subway" || markerStyle === "walk");
              var customAnchorX = Number(iconInfo && iconInfo.anchorX);
              var customAnchorY = Number(iconInfo && iconInfo.anchorY);
              // TMAP v2 Marker는 iconAnchor가 아니라 이미지 내부 기준점인 offset을 사용한다.
              markerOption.offset = isFinite(customAnchorX) && isFinite(customAnchorY)
                ? new Tmapv2.Point(Math.round(customAnchorX), Math.round(customAnchorY))
                : isBadge
                  ? new Tmapv2.Point(Math.round(iconInfo.width / 2), isFloatingBadge ? (iconInfo.height - 6) : iconInfo.height)
                  : isDot
                    ? new Tmapv2.Point(Math.round(iconInfo.width / 2), Math.round(iconInfo.height / 2))
                    : isStation
                      ? new Tmapv2.Point(Math.round(iconInfo.width / 2), Math.round(iconInfo.height / 2))
                      : new Tmapv2.Point(Math.round(iconInfo.width / 2), iconInfo.height);
            } catch (_error) {}
          }

          var markerId = item && item.id != null ? String(item.id) : "";
          if (!markerId) return;
          var markerSignature = JSON.stringify({
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            icon: iconInfo.uri,
            width: iconInfo.width,
            height: iconInfo.height,
            anchorX: Number(iconInfo.anchorX),
            anchorY: Number(iconInfo.anchorY),
            title: markerOption.title,
            interactionId: item.interactionId || "",
            zIndex: markerZIndex,
          });
          var previousEntry = markers[markerId];
          if (previousEntry && previousEntry.signature === markerSignature && previousEntry.marker) {
            retainedMarkerIds[markerId] = true;
            return;
          }

          try {
            var marker = new Tmapv2.Marker({
              position: markerOption.position,
              icon: markerOption.icon,
              iconSize: markerOption.iconSize,
              title: markerOption.title,
              map: markerOption.map,
              offset: markerOption.offset,
            });
            if (isFinite(markerZIndex) && marker && typeof marker.setZIndex === "function") {
              try {
                marker.setZIndex(markerZIndex);
              } catch (_error) {}
            }
            if (marker && item && item.interactionId) {
              var lastMarkerPressAt = 0;
              var markerPressHandler = function (eventObj) {
                var pressAt = Date.now();
                // iOS WebView는 touchend 뒤 click을 연이어 보낼 수 있어 한 번의 선택으로 합친다.
                if (pressAt - lastMarkerPressAt < 420) return;
                lastMarkerPressAt = pressAt;
                var sourceEvent = eventObj && (eventObj.originalEvent || eventObj.domEvent || eventObj.event);
                if (sourceEvent && typeof sourceEvent.stopPropagation === "function") {
                  try { sourceEvent.stopPropagation(); } catch (_error) {}
                }
                post("markerPress", {
                  id: String(item.id),
                  interactionId: String(item.interactionId),
                });
              };
              var markerPressBound = false;
              try {
                if (typeof marker.addListener === "function") {
                  marker.addListener("click", markerPressHandler);
                  marker.addListener("touchend", markerPressHandler);
                  markerPressBound = true;
                }
              } catch (_error) {}
              if (!markerPressBound) {
                try {
                  if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
                    Tmapv2.events.addListener(marker, "click", markerPressHandler);
                    Tmapv2.events.addListener(marker, "touchend", markerPressHandler);
                    markerPressBound = true;
                  }
                } catch (_error) {}
              }
              if (!markerPressBound) {
                try {
                  if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
                    Tmapv2.Event.addListener(marker, "click", markerPressHandler);
                    Tmapv2.Event.addListener(marker, "touchend", markerPressHandler);
                  }
                } catch (_error) {}
              }
            }
            retainedMarkerIds[markerId] = true;
            markers[markerId] = {
              marker: marker,
              signature: markerSignature,
            };
            var previousMarker = previousEntry && previousEntry.marker ? previousEntry.marker : previousEntry;
            if (previousMarker && previousMarker !== marker && previousMarker.setMap) {
              setTimeout(function () {
                try { previousMarker.setMap(null); } catch (_removeError) {}
              }, 0);
            }
          } catch (_markerError) {
            // 새 아이콘 생성이 실패하면 직전 마커를 유지해 줌 동작 중 깜빡임을 피한다.
            if (previousEntry) retainedMarkerIds[markerId] = true;
          }
        });

        Object.keys(markers).forEach(function (markerId) {
          if (retainedMarkerIds[markerId]) return;
          var entry = markers[markerId];
          var marker = entry && entry.marker ? entry.marker : entry;
          if (marker && marker.setMap) {
            try { marker.setMap(null); } catch (_removeError) {}
          }
          delete markers[markerId];
        });
      }

      function clearPaths() {
        pathLayers.forEach(function (layer) {
          if (layer.line && layer.line.setMap) layer.line.setMap(null);
          if (layer.outline && layer.outline.setMap) layer.outline.setMap(null);
        });
        pathLayers = [];
        Object.keys(routeOverlayRegistry).forEach(function (key) {
          var item = routeOverlayRegistry[key];
          if (!item) return;
          if (item.line && item.line.setMap) item.line.setMap(null);
          if (item.outline && item.outline.setMap) item.outline.setMap(null);
        });
        routeOverlayRegistry = {};
        logRouteVisibility("clearPaths");
      }

      function removePathLayerItem(item) {
        if (!item) return;
        if (item.line && item.line.setMap) {
          try { item.line.setMap(null); } catch (_lineError) {}
        }
        if (item.outline && item.outline.setMap) {
          try { item.outline.setMap(null); } catch (_outlineError) {}
        }
        item.attachedToMap = false;
        item.visible = false;
      }

      function inferRouteOverlayLayerType(id, dashPattern, strokeStyle, outlineWidth) {
        var value = String(id || "");
        if (value.indexOf("direction") >= 0 || value.indexOf("arrow") >= 0) return "DIRECTION_ARROW";
        if (strokeStyle === "dash" || (Array.isArray(dashPattern) && dashPattern.length > 0)) return "WALK_DASHED";
        if (Number(outlineWidth) > 0) return "TRANSIT_MAIN";
        return "TRANSIT_MAIN";
      }

      function pathConfigSignature(pathCoords, color, width, opacity, outlineColor, outlineWidth, outlineOpacity, dashPattern, strokeStyle, outlineStrokeStyle, zIndex, nativeDirection, nativeDirectionColor, nativeDirectionOpacity) {
        return JSON.stringify({
          coords: Array.isArray(pathCoords) ? pathCoords.map(function (point) {
            return [
              Math.round(Number(point.latitude) * 1000000) / 1000000,
              Math.round(Number(point.longitude) * 1000000) / 1000000,
            ];
          }) : [],
          color: color || "",
          width: Number(width) || 0,
          opacity: Number(opacity),
          outlineColor: outlineColor || "",
          outlineWidth: Number(outlineWidth) || 0,
          outlineOpacity: Number(outlineOpacity),
          dashPattern: Array.isArray(dashPattern) ? dashPattern : [],
          strokeStyle: strokeStyle || "solid",
          outlineStrokeStyle: outlineStrokeStyle || "solid",
          zIndex: Number(zIndex),
          nativeDirection: nativeDirection === true,
          nativeDirectionColor: nativeDirectionColor || "",
          nativeDirectionOpacity: Number(nativeDirectionOpacity),
        });
      }

      function ensureRouteLayerAttached(item) {
        if (!item || !map) return false;
        var attached = false;
        try {
          if (item.outline && item.outline.setMap) {
            item.outline.setMap(map);
            attached = true;
          }
        } catch (_outlineError) {}
        try {
          if (item.line && item.line.setMap) {
            item.line.setMap(map);
            attached = true;
          }
        } catch (_lineError) {}
        item.attachedToMap = attached;
        item.visible = attached;
        item.updatedAt = Date.now();
        return attached;
      }

      function getRouteOverlayRegistryRows() {
        return Object.keys(routeOverlayRegistry).map(function (key) {
          var item = routeOverlayRegistry[key];
          return {
            id: item.id,
            segmentId: item.segmentId,
            layerType: item.layerType,
            visible: item.visible === true,
            attachedToMap: item.attachedToMap === true,
            hasLineRef: !!item.line,
            hasOutlineRef: !!item.outline,
            strokeStyle: item.strokeStyle || "solid",
            nativeDirection: item.nativeDirection === true,
          };
        });
      }

      function logRouteVisibility(reason) {
        if (!isDevelopment) return;
        var rows = getRouteOverlayRegistryRows();
        var expectedMainLines = rows.filter(function (row) { return row.layerType === "TRANSIT_MAIN"; }).length;
        var visibleMainLines = rows.filter(function (row) { return row.layerType === "TRANSIT_MAIN" && row.visible; }).length;
        var expectedWalkLines = rows.filter(function (row) { return row.layerType === "WALK_DASHED"; }).length;
        var visibleWalkLines = rows.filter(function (row) { return row.layerType === "WALK_DASHED" && row.visible; }).length;
        var expectedCasingLines = rows.filter(function (row) { return row.hasOutlineRef; }).length;
        var visibleCasingLines = rows.filter(function (row) { return row.hasOutlineRef && row.visible; }).length;
        var expectedNativeDirectionLines = rows.filter(function (row) { return row.nativeDirection; }).length;
        var visibleNativeDirectionLines = rows.filter(function (row) { return row.nativeDirection && row.visible; }).length;
        var payload = {
          reason: reason || "UNKNOWN",
          isCameraMoving: isRouteOverlayMoving,
          isMapIdle: isMapIdle,
          expectedMainLines: expectedMainLines,
          visibleMainLines: visibleMainLines,
          expectedCasingLines: expectedCasingLines,
          visibleCasingLines: visibleCasingLines,
          expectedWalkLines: expectedWalkLines,
          visibleWalkLines: visibleWalkLines,
          expectedNativeDirectionLines: expectedNativeDirectionLines,
          visibleNativeDirectionLines: visibleNativeDirectionLines,
          arrowsVisible: visibleNativeDirectionLines > 0 || (!isRouteOverlayMoving && screenRouteOverlays.length > 0),
        };
        var signature = JSON.stringify({ payload: payload, rows: rows });
        if (signature === lastRouteVisibilitySignature) return;
        lastRouteVisibilitySignature = signature;
        debugLog("[route-visibility]", payload);
        debugTable(rows);
        post("routeVisibility", {
          summary: payload,
          rows: rows,
        });
      }

      function verifyRouteOverlaysAttached(reason) {
        var rows = getRouteOverlayRegistryRows();
        var expected = rows.length;
        var attached = rows.filter(function (row) { return row.attachedToMap; }).length;
        var missing = expected - attached;
        debugLog("[route-overlay-verify]", {
          reason: reason || "UNKNOWN",
          expected: expected,
          attached: attached,
          missing: missing,
          isCameraMoving: isRouteOverlayMoving,
          isMapIdle: isMapIdle,
        });
        if (missing > 0) {
          Object.keys(routeOverlayRegistry).forEach(function (key) {
            var item = routeOverlayRegistry[key];
            if (!item || item.attachedToMap) return;
            ensureRouteLayerAttached(item);
          });
        }
        logRouteVisibility(reason || "verify");
      }

      function reconcileRouteOverlays(activeIds, reason) {
        var active = {};
        (Array.isArray(activeIds) ? activeIds : []).forEach(function (id) {
          if (id) active[String(id)] = true;
        });
        if (Object.keys(active).length === 0) {
          clearPaths();
          logRouteVisibility((reason || "reconcile") + ":clear-empty-active");
          return;
        }
        Object.keys(routeOverlayRegistry).forEach(function (key) {
          if (active[key]) return;
          var item = routeOverlayRegistry[key];
          removePathLayerItem(item);
          delete routeOverlayRegistry[key];
        });
        pathLayers = pathLayers.filter(function (item) {
          return item && routeOverlayRegistry[item.id] === item;
        });
        logRouteVisibility(reason || "reconcile");
      }

      // 모든 안내선은 outline + main stroke 2중 레이어로 그려서 밝은 지도에서도 또렷하게 보이게 한다.
      function renderPath(overlayId, pathCoords, color, width, opacity, outlineColor, outlineWidth, outlineOpacity, dashPattern, strokeStyle, outlineStrokeStyle, zIndex, nativeDirection, nativeDirectionColor, nativeDirectionOpacity) {
        if (!map) return;
        if (!Array.isArray(pathCoords) || pathCoords.length < 2) return;

        var path = pathCoords.map(function (point) { return toLatLng(point); });
        var strokePaint = resolveNativeStrokePaint(color, "#1D72FF", opacity, 1);
        var outlinePaint = resolveNativeStrokePaint(
          outlineColor,
          "#FFFFFF",
          outlineOpacity,
          strokePaint.requestedOpacity
        );
        var strokeColor = strokePaint.color;
        var strokeOutlineColor = outlinePaint.color;
        var normalizedStrokeStyle = strokeStyle === "dash" || strokeStyle === "dot" || strokeStyle === "solid"
          ? strokeStyle
          : (Array.isArray(dashPattern) && dashPattern.length > 0 ? "dash" : "solid");
        // 서로 다른 굵기의 dashed Polyline은 SDK 내부 dash 간격도 달라져 casing 위상이 어긋난다.
        // 보행 본선만 native dash로 두고 외곽선은 기본 solid halo로 유지한다.
        var normalizedOutlineStrokeStyle = outlineStrokeStyle === "dash" || outlineStrokeStyle === "dot" || outlineStrokeStyle === "solid"
          ? outlineStrokeStyle
          : "solid";
        var strokeOpacity = strokePaint.opacity;
        var strokeOutlineOpacity = outlinePaint.opacity;
        var zIndexValue = Number(zIndex);
        var nativeDirectionUsable = !!(
          nativeDirectionReport &&
          nativeDirectionReport.rows &&
          nativeDirectionReport.rows[0] &&
          nativeDirectionReport.rows[0].usableForRouteLine === true
        );
        // TMAP V2 SDK는 solid Polyline에서만 native direction indicator를 그린다.
        var useNativeDirection = nativeDirection === true && normalizedStrokeStyle === "solid" && nativeDirectionUsable;
        if (nativeDirection === true && !useNativeDirection && !nativeDirectionUnavailableWarned) {
          nativeDirectionUnavailableWarned = true;
          debugWarn("[route-direction] native Tmap direction unavailable, drawing route line without arrows", {
            sdk: nativeDirectionReport && nativeDirectionReport.rows ? nativeDirectionReport.rows[0].sdk : "unknown",
            reason: normalizedStrokeStyle !== "solid"
              ? "Tmap native direction requires a solid Polyline stroke."
              : nativeDirectionReport && nativeDirectionReport.rows
              ? (nativeDirectionReport.rows[0].reasonNativeDirectionDisabled || nativeDirectionReport.rows[0].reason)
              : "native direction probe not usable",
            fallback: "screen-overlay",
          });
        }
        var nativeDirectionPaint = resolveNativeStrokePaint(
          nativeDirectionColor,
          "#FFFFFF",
          nativeDirectionOpacity,
          0.9
        );
        var nativeDirectionStrokeColor = nativeDirectionPaint.color;
        var nativeDirectionStrokeOpacity = nativeDirectionPaint.opacity;
        var registryId = overlayId ? String(overlayId) : ["route-path", pathCoords.length, strokeColor, width].join(":");
        var signature = pathConfigSignature(
          pathCoords,
          strokeColor,
          width,
          strokeOpacity,
          strokeOutlineColor,
          outlineWidth,
          strokeOutlineOpacity,
          dashPattern,
          normalizedStrokeStyle,
          normalizedOutlineStrokeStyle,
          zIndexValue,
          useNativeDirection,
          nativeDirectionStrokeColor,
          nativeDirectionStrokeOpacity
        );
        var existing = routeOverlayRegistry[registryId];
        if (existing && existing.signature === signature) {
          ensureRouteLayerAttached(existing);
          return;
        }
        var outlineLayer = null;
        var lineLayer = null;

        if (outlineWidth > 0) {
          var outlineOptions = {
            path: path,
            strokeColor: strokeOutlineColor,
            strokeWeight: width + (outlineWidth * 2),
            strokeOpacity: strokeOutlineOpacity,
            lineCap: "round",
            lineJoin: "round",
            strokeStyle: normalizedOutlineStrokeStyle,
            map: map,
          };
          if (isFinite(zIndexValue)) outlineOptions.zIndex = zIndexValue;
          outlineLayer = new Tmapv2.Polyline(outlineOptions);
        }

        var lineOptions = {
          path: path,
          strokeColor: strokeColor,
          strokeWeight: width,
          strokeOpacity: strokeOpacity,
          lineCap: "round",
          lineJoin: "round",
          strokeStyle: normalizedStrokeStyle,
          map: map,
        };
        if (useNativeDirection) {
          lineOptions.direction = true;
          lineOptions.directionColor = nativeDirectionStrokeColor;
          lineOptions.directionOpacity = nativeDirectionStrokeOpacity;
        }
        if (isFinite(zIndexValue)) lineOptions.zIndex = zIndexValue + 1;
        lineLayer = new Tmapv2.Polyline(lineOptions);

        var nextItem = {
          id: registryId,
          segmentId: registryId,
          layerType: inferRouteOverlayLayerType(registryId, dashPattern, normalizedStrokeStyle, outlineWidth),
          outline: outlineLayer,
          line: lineLayer,
          visible: true,
          attachedToMap: true,
          strokeStyle: normalizedStrokeStyle,
          nativeDirection: useNativeDirection,
          signature: signature,
          createdAt: existing ? existing.createdAt : Date.now(),
          updatedAt: Date.now(),
        };
        routeOverlayRegistry[registryId] = nextItem;
        pathLayers.push(nextItem);
        if (existing) {
          setTimeout(function () {
            removePathLayerItem(existing);
          }, 0);
        }
      }

      function inferZoomByDelta(latDelta, lngDelta) {
        var maxDelta = Math.max(latDelta || 0, lngDelta || 0);
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

      // camera 이동은 확대 레벨 포함 단일 지점 포커스용.
      function setCamera(payload) {
        if (!map || !payload) return;
        var lat = Number(payload.latitude);
        var lng = Number(payload.longitude);
        if (!isFinite(lat) || !isFinite(lng)) return;
        markRouteOverlayMoving();
        map.setCenter(new Tmapv2.LatLng(lat, lng));
        if (isFinite(Number(payload.zoom))) {
          map.setZoom(Math.max(6, Math.min(18, Math.round(Number(payload.zoom)))));
        }
        scheduleScreenRouteOverlayRender();
        emitZoomChanged();
        setTimeout(emitZoomChanged, 120);
        setTimeout(emitZoomChanged, 420);
        markRouteOverlayIdleSoon(220);
      }

      // region 이동은 경로 전체를 한 화면에 담는 fit 동작용.
      function setRegion(payload) {
        if (!payload) return;
        var lat = Number(payload.latitude);
        var lng = Number(payload.longitude);
        var latDelta = Number(payload.latitudeDelta);
        var lngDelta = Number(payload.longitudeDelta);
        if (!isFinite(lat) || !isFinite(lng)) return;
        var regionCenterLat = isFinite(latDelta) ? lat + (latDelta / 2) : lat;
        var regionCenterLng = isFinite(lngDelta) ? lng + (lngDelta / 2) : lng;
        var pivot = payload.pivot || {};
        var pivotX = isFinite(Number(pivot.x)) ? Math.max(0, Math.min(1, Number(pivot.x))) : 0.5;
        var pivotY = isFinite(Number(pivot.y)) ? Math.max(0, Math.min(1, Number(pivot.y))) : 0.5;
        var centerLat = isFinite(latDelta) ? regionCenterLat - ((0.5 - pivotY) * latDelta) : regionCenterLat;
        var centerLng = isFinite(lngDelta) ? regionCenterLng - ((pivotX - 0.5) * lngDelta) : regionCenterLng;
        var zoomOffset = isFinite(Number(payload.zoomOffset)) ? Number(payload.zoomOffset) : 0;
        setCamera({
          latitude: centerLat,
          longitude: centerLng,
          zoom: Math.max(6, Math.min(18, inferZoomByDelta(latDelta, lngDelta) + zoomOffset)),
        });
      }

      // 경로 전체 bounds fit용 보조 함수. SDK 계산이 실패하면 center/zoom 계산으로 fallback 한다.
      function fitBounds(payload) {
        if (!map || !payload || !Array.isArray(payload.coords) || payload.coords.length < 2) return;
        var bounds = new Tmapv2.LatLngBounds();
        var minLat = 90;
        var maxLat = -90;
        var minLng = 180;
        var maxLng = -180;
        payload.coords.forEach(function (coord) {
          var lat = Number(coord.latitude);
          var lng = Number(coord.longitude);
          if (!isFinite(lat) || !isFinite(lng)) return;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          bounds.extend(new Tmapv2.LatLng(lat, lng));
        });

        try {
          markRouteOverlayMoving();
          var rawEdgePadding = payload.edgePadding;
          var edgePadding = rawEdgePadding && typeof rawEdgePadding === "object"
            ? {
                top: Math.max(0, Number(rawEdgePadding.top) || 0),
                right: Math.max(0, Number(rawEdgePadding.right) || 0),
                bottom: Math.max(0, Number(rawEdgePadding.bottom) || 0),
                left: Math.max(0, Number(rawEdgePadding.left) || 0),
              }
            : Math.max(0, Number(payload.padding) || 0);
          // TMAP native fitBounds가 정수 줌과 비대칭 UI 여백을 함께 계산한다.
          if (typeof map.fitBounds === "function") {
            map.fitBounds(bounds, edgePadding);
          } else {
            map.panToBounds(bounds);
          }
          scheduleScreenRouteOverlayRender();
          setTimeout(function () { emitZoomChanged(); }, 50);
          markRouteOverlayIdleSoon(260);
        } catch (_error) {
          var centerLat = (minLat + maxLat) / 2;
          var centerLng = (minLng + maxLng) / 2;
          setCamera({
            latitude: centerLat,
            longitude: centerLng,
            zoom: inferZoomByDelta(maxLat - minLat, maxLng - minLng),
          });
        }
      }

      function zoomBy(payload) {
        if (!map || !payload) return;
        var delta = Number(payload.delta);
        if (!isFinite(delta) || delta === 0) return;

        var currentZoom = NaN;
        try {
          currentZoom = numberFromUnknown(map.getZoom ? map.getZoom() : map.zoom);
        } catch (_error) {}
        if (!isFinite(currentZoom)) {
          currentZoom = ${initialZoom};
        }

        var nextZoom = Math.max(6, Math.min(18, Math.round(currentZoom + delta)));
        try {
          markRouteOverlayMoving();
          map.setZoom(nextZoom);
          scheduleScreenRouteOverlayRender();
          emitZoomChanged();
          markRouteOverlayIdleSoon(220);
        } catch (_error) {}
      }

      function emitZoomChanged() {
        if (!map) return;
        var zoom = NaN;
        try {
          zoom = numberFromUnknown(map.getZoom ? map.getZoom() : map.zoom);
        } catch (_error) {}
        if (!isFinite(zoom)) return;
        var center = readMapCenter();
        var metersPerPixel = readMapMetersPerPixel(center);
        post("zoomChanged", {
          zoom: zoom,
          latitude: center ? center.latitude : undefined,
          longitude: center ? center.longitude : undefined,
          metersPerPixel: isFinite(metersPerPixel)
            ? Number(metersPerPixel.toFixed(6))
            : undefined,
        });
      }

      function applyData(payload) {
        if (!map) {
          pendingData = payload;
          return;
        }
        if (typeof payload.nightModeEnabled === "boolean") {
          applyTheme(payload.nightModeEnabled);
        }
        if (typeof payload.routeFocusMode === "boolean") {
          isRouteFocusMode = payload.routeFocusMode;
          syncMapTilePresentation();
        }
        applyBaseDim(payload.mapBaseDimOpacity);
        var markerItems = Array.isArray(payload.markers) ? payload.markers : [];
        renderMarkers(markerItems);

        var nextRouteOverlayScope = payload && payload.routeOverlayScope != null
          ? String(payload.routeOverlayScope)
          : "";
        if (nextRouteOverlayScope && nextRouteOverlayScope !== lastRouteOverlayScope) {
          clearPaths();
          setScreenRouteOverlays([]);
          lastRouteOverlayScope = nextRouteOverlayScope;
          logRouteVisibility("applyData:routeOverlayScopeChanged");
        }

        if (payload.clearRouteOverlays === true) {
          clearPaths();
          setScreenRouteOverlays([]);
          logRouteVisibility("applyData:clearRouteOverlays");
          return;
        }

        var hasExplicitPathOverlays = Array.isArray(payload.pathOverlays);
        var hasExplicitPathCoords = Array.isArray(payload.pathCoords);
        var overlayItems = hasExplicitPathOverlays ? payload.pathOverlays : [];
        if (overlayItems.length > 0) {
          var nativeOverlayItems = overlayItems.filter(function (overlay) {
            return !overlay || overlay.renderMode !== "screen";
          });
          var screenOverlayItems = overlayItems.filter(function (overlay) {
            return overlay && overlay.renderMode === "screen";
          });
          var activeNativeIds = [];

          nativeOverlayItems.forEach(function (overlay, index) {
            var overlayWidth = Number(overlay.width);
            var overlayOutlineWidth = Number(overlay.outlineWidth);
            var overlayId = overlay && overlay.id ? String(overlay.id) : "native-overlay-" + index;
            var overlayCoords = Array.isArray(overlay.coords) ? overlay.coords : [];
            if (overlayCoords.length < 2) return;
            activeNativeIds.push(overlayId);
            renderPath(
              overlayId,
              overlayCoords,
              overlay.color || "#1D72FF",
              isFinite(overlayWidth) && overlayWidth > 0 ? overlayWidth : 10,
              overlay.opacity,
              overlay.outlineColor || "#FFFFFF",
              isFinite(overlayOutlineWidth) ? Math.max(0, overlayOutlineWidth) : 2.5,
              overlay.outlineOpacity,
              overlay.dashPattern,
              overlay.strokeStyle,
              overlay.outlineStrokeStyle,
              overlay.zIndex,
              overlay.nativeDirection === true,
              overlay.nativeDirectionColor,
              overlay.nativeDirectionOpacity
            );
          });
          reconcileRouteOverlays(activeNativeIds, "applyData:pathOverlays");
          verifyRouteOverlaysAttached("applyData:pathOverlays");
          setScreenRouteOverlays(screenOverlayItems);
          return;
        }

        setScreenRouteOverlays([]);
        var payloadPathWidth = Number(payload.pathWidth);
        var payloadPathOutlineWidth = Number(payload.pathOutlineWidth);
        var fallbackPath = Array.isArray(payload.pathCoords) ? payload.pathCoords : [];
        if (fallbackPath.length < 2) {
          if (hasExplicitPathOverlays || hasExplicitPathCoords) {
            clearPaths();
            setScreenRouteOverlays([]);
            logRouteVisibility("applyData:empty-route-clear");
            return;
          }
          logRouteVisibility("applyData:empty-route-keep-existing");
          return;
        }
        renderPath(
          "route-selected-fallback",
          fallbackPath,
          payload.pathColor || "#1D72FF",
          isFinite(payloadPathWidth) && payloadPathWidth > 0 ? payloadPathWidth : 10,
          undefined,
          payload.pathOutlineColor || "#FFFFFF",
          isFinite(payloadPathOutlineWidth) ? Math.max(0, payloadPathOutlineWidth) : 3,
          undefined,
          undefined
        );
        reconcileRouteOverlays(["route-selected-fallback"], "applyData:fallback");
        verifyRouteOverlaysAttached("applyData:fallback");
      }

      function numberFromUnknown(value) {
        if (typeof value === "number") return isFinite(value) ? value : NaN;
        if (typeof value === "string") {
          var parsed = Number(value);
          return isFinite(parsed) ? parsed : NaN;
        }
        if (typeof value === "function") {
          try {
            var fnResult = value();
            var parsedFn = Number(fnResult);
            return isFinite(parsedFn) ? parsedFn : NaN;
          } catch (_error) {
            return NaN;
          }
        }
        return NaN;
      }

      function parseTapLatLng(eventObj) {
        if (!eventObj || typeof eventObj !== "object") return null;

        var latLng =
          eventObj.latLng ||
          eventObj.latlng ||
          eventObj.coordinate ||
          eventObj.coord ||
          eventObj.position ||
          eventObj._latLng ||
          null;

        var lat = NaN;
        var lng = NaN;

        if (latLng) {
          lat = numberFromUnknown(latLng._lat);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.lat);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.latitude);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.getLat);
          if (!isFinite(lat)) lat = numberFromUnknown(latLng.getLatitude);

          lng = numberFromUnknown(latLng._lng);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.lng);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.longitude);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.getLng);
          if (!isFinite(lng)) lng = numberFromUnknown(latLng.getLongitude);
        }

        if (!isFinite(lat)) lat = numberFromUnknown(eventObj.lat);
        if (!isFinite(lat)) lat = numberFromUnknown(eventObj.latitude);
        if (!isFinite(lng)) lng = numberFromUnknown(eventObj.lng);
        if (!isFinite(lng)) lng = numberFromUnknown(eventObj.longitude);

        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { latitude: lat, longitude: lng };
      }

      function parseSelectionScreenPoint(eventObj) {
        if (!eventObj || typeof eventObj !== "object") return null;
        // touchstart의 screenPoint와 touchend/drag의 mapPixel이 같은 지도 로컬 좌표계다.
        var point = eventObj.mapPixel || eventObj.screenPoint || eventObj.pixel || null;
        if (!point) return null;

        var x = numberFromUnknown(point.x);
        if (!isFinite(x)) x = numberFromUnknown(point._x);
        if (!isFinite(x)) x = numberFromUnknown(point.getX);

        var y = numberFromUnknown(point.y);
        if (!isFinite(y)) y = numberFromUnknown(point._y);
        if (!isFinite(y)) y = numberFromUnknown(point.getY);

        if (!isFinite(x) || !isFinite(y)) return null;
        return { x: x, y: y };
      }

      // 지도 탭 좌표를 React Native 쪽으로 다시 올려, 출발/도착 직접 지정 같은 상호작용에 사용한다.
      function bindMapTap() {
        if (!map) return;
        var selectionEvents = ${JSON.stringify(TMAP_MAP_SELECTION_EVENTS)};
        var touchCandidate = null;

        var postSelection = function (eventObj) {
          var parsed = parseTapLatLng(eventObj);
          if (parsed) post("tap", parsed);
        };

        var beginTouchSelection = function (eventObj) {
          var startPoint = parseSelectionScreenPoint(eventObj);
          touchCandidate = startPoint
            ? { startPoint: startPoint, maxDistance: 0, cancelled: false }
            : null;
        };

        var trackTouchSelection = function (eventObj) {
          if (!touchCandidate) return;
          var point = parseSelectionScreenPoint(eventObj);
          if (!point) {
            touchCandidate.cancelled = true;
            return;
          }
          var dx = point.x - touchCandidate.startPoint.x;
          var dy = point.y - touchCandidate.startPoint.y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          touchCandidate.maxDistance = Math.max(touchCandidate.maxDistance, distance);
          if (touchCandidate.maxDistance > ${TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX}) {
            touchCandidate.cancelled = true;
          }
        };

        var cancelTouchSelection = function () {
          if (touchCandidate) touchCandidate.cancelled = true;
        };

        var endTouchSelection = function (eventObj) {
          if (!touchCandidate) return;
          trackTouchSelection(eventObj);
          var shouldSelect = !touchCandidate.cancelled &&
            touchCandidate.maxDistance <= ${TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX};
          touchCandidate = null;
          if (shouldSelect) postSelection(eventObj);
        };

        var bindings = [
          { name: selectionEvents.click, handler: postSelection },
          { name: selectionEvents.touchStart, handler: beginTouchSelection },
          { name: selectionEvents.touchEnd, handler: endTouchSelection },
        ];
        selectionEvents.touchMove.forEach(function (eventName) {
          bindings.push({ name: eventName, handler: trackTouchSelection });
        });
        selectionEvents.touchCancel.forEach(function (eventName) {
          bindings.push({ name: eventName, handler: cancelTouchSelection });
        });

        var bindAll = function (addListener) {
          var boundAny = false;
          bindings.forEach(function (binding) {
            try {
              addListener(binding.name, binding.handler);
              boundAny = true;
            } catch (_error) {}
          });
          return boundAny;
        };

        try {
          if (map.addListener) {
            if (bindAll(function (eventName, handler) {
              map.addListener(eventName, handler);
            })) return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
            if (bindAll(function (eventName, handler) {
              Tmapv2.events.addListener(map, eventName, handler);
            })) return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
            bindAll(function (eventName, handler) {
              Tmapv2.Event.addListener(map, eventName, handler);
            });
          }
        } catch (_error) {}
      }

      // 현재 zoom 변화를 React 상태로 다시 보내 route-planner가 안내선/마커 레벨을 바꿀 수 있게 한다.
      function bindMapZoom() {
        if (!map) return;
        var zoomHandler = function () {
          emitZoomChanged();
        };

        try {
          if (map.addListener) {
            map.addListener("zoom_changed", zoomHandler);
            map.addListener("zoomend", zoomHandler);
            map.addListener("moveend", zoomHandler);
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
            Tmapv2.events.addListener(map, "zoom_changed", zoomHandler);
            Tmapv2.events.addListener(map, "zoomend", zoomHandler);
            Tmapv2.events.addListener(map, "moveend", zoomHandler);
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
            Tmapv2.Event.addListener(map, "zoom_changed", zoomHandler);
            Tmapv2.Event.addListener(map, "zoomend", zoomHandler);
            Tmapv2.Event.addListener(map, "moveend", zoomHandler);
          }
        } catch (_error) {}
      }

      function bindScreenRouteOverlayEvents() {
        if (!map) return;
        var activeRenderHandler = function () {
          markRouteOverlayMoving();
          markRouteOverlayIdleSoon(260);
        };
        var stableRenderHandler = function () {
          markRouteOverlayIdleSoon(180);
          if (markerCollisionRefreshTimer) clearTimeout(markerCollisionRefreshTimer);
          markerCollisionRefreshTimer = setTimeout(function () {
            renderMarkers(latestMarkerItems, true);
          }, 220);
        };
        var activeEventNames = [
          "dragstart",
          "drag",
          "movestart",
          "move",
          "center_changed",
          "bounds_changed",
          "zoom_changed",
          "zoomstart",
          "touchstart",
          "gesturestart",
        ];
        var stableEventNames = [
          "dragend",
          "moveend",
          "zoomend",
          "idle",
          "touchend",
          "gestureend",
        ];

        try {
          if (map.addListener) {
            activeEventNames.forEach(function (eventName) {
              try {
                map.addListener(eventName, activeRenderHandler);
              } catch (_error) {}
            });
            stableEventNames.forEach(function (eventName) {
              try {
                map.addListener(eventName, stableRenderHandler);
              } catch (_error) {}
            });
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
            activeEventNames.forEach(function (eventName) {
              try {
                Tmapv2.events.addListener(map, eventName, activeRenderHandler);
              } catch (_error) {}
            });
            stableEventNames.forEach(function (eventName) {
              try {
                Tmapv2.events.addListener(map, eventName, stableRenderHandler);
              } catch (_error) {}
            });
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
            activeEventNames.forEach(function (eventName) {
              try {
                Tmapv2.Event.addListener(map, eventName, activeRenderHandler);
              } catch (_error) {}
            });
            stableEventNames.forEach(function (eventName) {
              try {
                Tmapv2.Event.addListener(map, eventName, stableRenderHandler);
              } catch (_error) {}
            });
          }
        } catch (_error) {}
      }

      // 현재 위치 버튼은 WebView 안에서 직접 geolocation을 호출해 지도 중심만 이동시킨다.
      function goToCurrentLocation() {
        if (!navigator.geolocation || !map) return;
        navigator.geolocation.getCurrentPosition(
          function (position) {
            var lat = Number(position.coords.latitude);
            var lng = Number(position.coords.longitude);
            if (!isFinite(lat) || !isFinite(lng)) return;
            markRouteOverlayMoving();
            map.setCenter(new Tmapv2.LatLng(lat, lng));
            map.setZoom(Math.max(14, map.getZoom ? map.getZoom() : 14));
            markRouteOverlayIdleSoon(220);
          },
          function () {},
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
        );
      }

      // 실제 Tmap 인스턴스를 만들고 테마/이벤트/초기 data를 붙이는 지도 초기화 루틴.
      function initMap() {
        if (!window.Tmapv2 || !window.Tmapv2.Map) {
          initRetry += 1;
          if (initRetry > 40) {
            post("error", { message: "Tmap JS SDK 로딩 실패: 앱키 또는 네트워크/권한 설정을 확인해 주세요." });
            return;
          }
          setTimeout(initMap, 220);
          return;
        }

        map = new Tmapv2.Map("map", {
          center: new Tmapv2.LatLng(${initialLat}, ${initialLng}),
          width: "100%",
          height: "100%",
          zoom: ${initialZoom},
          // WebView의 inline HTML은 about:blank에서 실행된다. TMAP의
          // 기본값(http)을 그대로 쓰면 iOS ATS가 모든 지도 타일을 차단한다.
          httpsMode: true,
          zoomControl: ${showZoomControlFlag},
          scrollwheel: true,
        });
        probeTmapNativeDirectionSupport();

        bindMapTilePresentationObserver();
        applyTheme(isDarkTheme);

        bindMapTap();
        bindMapZoom();
        bindScreenRouteOverlayEvents();
        resizeMap("INIT");

        var locationBtn = document.getElementById("locationBtn");
        if (locationBtn) {
          locationBtn.onclick = goToCurrentLocation;
        }

        if (pendingData) {
          applyData(pendingData);
          pendingData = null;
        }

        post("initialized", {});
        emitZoomChanged();
      }

      function onCommand(rawData) {
        if (!rawData) return;
        var parsed;
        try {
          parsed = JSON.parse(rawData);
        } catch (_error) {
          return;
        }
        var type = parsed.type;
        var payload = parsed.payload || {};

        if (type === "setData") {
          applyData(payload);
          return;
        }
        if (type === "animateCamera") {
          setCamera(payload);
          return;
        }
        if (type === "animateRegion") {
          setRegion(payload);
          return;
        }
        if (type === "fitBounds") {
          fitBounds(payload);
          return;
        }
        if (type === "resizeMap") {
          resizeMap(payload && payload.reason ? String(payload.reason) : "COMMAND");
          return;
        }
        if (type === "zoomBy") {
          zoomBy(payload);
        }
      }

      window.addEventListener("resize", function () {
        resizeMap("WINDOW_RESIZE");
      });

      document.addEventListener("message", function (event) {
        onCommand(event && event.data);
      });
      window.addEventListener("message", function (event) {
        onCommand(event && event.data);
      });
      window.addEventListener("error", function (event) {
        var message = (event && event.message) ? String(event.message) : "스크립트 오류";
        if (map && message === "Script error.") {
          debugWarn("[tmap-sdk] ignored generic cross-origin script error after map init");
          return;
        }
        post("error", { message: message });
      });

      initMap();
    })();
  </script>
</body>
</html>`;
    }, [
        appKey,
        htmlBootstrapScope,
        nightModeEnabled,
        routeFocusMode,
        showLocationButton,
        showZoomControls,
    ]);

    if (!canRender) {
        const missingReason = !hasWebView
            ? "이 기기에서는 지도를 표시할 수 없습니다."
            : "지도 설정을 불러오지 못했습니다. 앱을 최신 버전으로 업데이트해 주세요.";
        return (
            <View
                accessible
                accessibilityRole="alert"
                accessibilityLabel={missingReason}
                style={[styles.fallback, { backgroundColor: fallbackBackgroundColor }, style]}
            >
                <Text style={[styles.fallbackText, { color: fallbackTextColor }]}>
                    {missingReason}
                </Text>
            </View>
        );
    }

    return (
        <View
            style={[styles.container, { backgroundColor: fallbackBackgroundColor }, style]}
            onLayout={handleContainerLayout}
        >
            <WebView
                key={activeWebViewKey}
                ref={webViewRef}
                accessibilityLabel="지도"
                accessibilityElementsHidden={!!runtimeErrorMessage}
                importantForAccessibility={runtimeErrorMessage ? "no-hide-descendants" : "auto"}
                originWhitelist={["*"]}
                source={{ html }}
                onMessage={onWebViewMessage}
                onError={handleNativeWebViewError}
                onHttpError={handleNativeWebViewError}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                allowFileAccess={true}
                setSupportMultipleWindows={false}
                mixedContentMode="never"
                style={[styles.webview, { backgroundColor: fallbackBackgroundColor }]}
            />
            {!isReady && !runtimeErrorMessage && (
                <View
                    pointerEvents="none"
                    accessibilityLiveRegion="polite"
                    style={[styles.loadingOverlay, { backgroundColor: fallbackBackgroundColor }]}
                >
                    <ActivityIndicator color="#2979FF" />
                    <Text style={[styles.loadingText, { color: fallbackTextColor }]}>지도를 불러오는 중…</Text>
                </View>
            )}
            {!!runtimeErrorMessage && (
                <View
                    accessibilityLiveRegion="assertive"
                    style={[
                        styles.errorOverlay,
                        typeof errorOverlayTop === "number"
                            ? { top: errorOverlayTop, bottom: undefined }
                            : null,
                    ]}
                >
                    <View style={styles.errorOverlayCopy}>
                        <Text style={styles.errorOverlayTitle}>지도 로딩 실패</Text>
                        <Text style={styles.errorOverlayText}>{runtimeErrorMessage}</Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="지도 다시 불러오기"
                        onPress={retryMapLoad}
                        style={styles.errorRetryButton}
                    >
                        <Text style={styles.errorRetryText}>다시 시도</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    webview: {
        flex: 1,
        backgroundColor: "transparent",
    },
    fallback: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    fallbackText: {
        textAlign: "center",
        fontSize: 12,
        lineHeight: 18,
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    loadingText: {
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "700",
    },
    errorOverlay: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: "rgba(17, 24, 39, 0.86)",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    errorOverlayCopy: {
        flex: 1,
        minWidth: 0,
    },
    errorOverlayTitle: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 12,
        marginBottom: 4,
    },
    errorOverlayText: {
        color: "rgba(255, 255, 255, 0.88)",
        fontSize: 11,
        lineHeight: 15,
    },
    errorRetryButton: {
        minHeight: 36,
        borderRadius: 9,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2979FF",
    },
    errorRetryText: {
        color: "#FFFFFF",
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
    },
});

export default TmapMapView;

import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { getEnv } from "../../api/env";

export type TmapLatLng = {
    latitude: number;
    longitude: number;
};

export type TmapMarker = {
    id: string;
    latitude: number;
    longitude: number;
    tintColor?: string;
    caption?: string;
    displayType?: "pin" | "badge" | "arrow" | "dot";
    markerStyle?: "default" | "origin" | "destination" | "bus" | "subway" | "transfer";
    pinLabel?: string;
    badgeLabel?: string;
    badgeTextColor?: string;
    badgeBorderColor?: string;
    badgeConnectorColor?: string;
    badgeGlyph?: string;
    dotSize?: number;
    rotationDeg?: number;
};

export type TmapPathOverlay = {
    id: string;
    coords: TmapLatLng[];
    color?: string;
    width?: number;
    outlineColor?: string;
    outlineWidth?: number;
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
        duration?: number;
        easing?: string;
        pivot?: { x: number; y: number };
    }) => void;
    fitToCoordinates: (coords: TmapLatLng[], options?: { padding?: number }) => void;
    zoomBy: (delta: number) => void;
};

type TmapMapViewProps = {
    style?: StyleProp<ViewStyle>;
    camera: {
        latitude: number;
        longitude: number;
        zoom?: number;
    };
    markers?: TmapMarker[];
    pathOverlays?: TmapPathOverlay[];
    pathCoords?: TmapLatLng[];
    pathColor?: string;
    pathWidth?: number;
    pathOutlineColor?: string;
    pathOutlineWidth?: number;
    nightModeEnabled?: boolean;
    showLocationButton?: boolean;
    showZoomControls?: boolean;
    onTapMap?: (event: { latitude: number; longitude: number }) => void;
    onZoomChanged?: (zoom: number) => void;
    onInitialized?: () => void;
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

function safeNumber(value: unknown): number | undefined {
    const numberValue = typeof value === "string" ? Number(value) : (value as number);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

const DEFAULT_FALLBACK_BACKGROUND = "#E5E7EB";
const DEFAULT_FALLBACK_TEXT = "#6B7280";

const TmapMapView = forwardRef<TmapMapViewHandle, TmapMapViewProps>(function TmapMapView(
    {
        style,
        camera,
        markers = [],
        pathOverlays = [],
        pathCoords = [],
        pathColor = "#1D72FF",
        pathWidth = 10,
        pathOutlineColor = "#FFFFFF",
        pathOutlineWidth = 3,
        nightModeEnabled = false,
        showLocationButton = true,
        showZoomControls = true,
        onTapMap,
        onZoomChanged,
        onInitialized,
        fallbackBackgroundColor = DEFAULT_FALLBACK_BACKGROUND,
        fallbackTextColor = DEFAULT_FALLBACK_TEXT,
    },
    ref
) {
    const webViewRef = useRef<any>(null);
    const commandQueueRef = useRef<string[]>([]);
    const [isReady, setIsReady] = useState(false);
    const [runtimeErrorMessage, setRuntimeErrorMessage] = useState<string | undefined>(undefined);

    const appKey = getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY");

    const hasWebView = !!WebView;
    const canRender = hasWebView && !!appKey;

    useEffect(() => {
        if (!canRender) {
            setIsReady(false);
            onInitialized?.();
        }
    }, [canRender, onInitialized]);

    const postCommand = useCallback((command: Record<string, unknown>) => {
        const json = JSON.stringify(command);
        if (!isReady || !webViewRef.current) {
            commandQueueRef.current.push(json);
            return;
        }
        webViewRef.current.postMessage(json);
    }, [isReady]);

    useImperativeHandle(ref, () => ({
        animateCameraTo(nextCamera) {
            postCommand({ type: "animateCamera", payload: nextCamera });
        },
        animateRegionTo(region) {
            postCommand({ type: "animateRegion", payload: region });
        },
        fitToCoordinates(coords, options) {
            postCommand({ type: "fitBounds", payload: { coords, padding: options?.padding ?? 48 } });
        },
        zoomBy(delta) {
            postCommand({ type: "zoomBy", payload: { delta } });
        },
    }), [postCommand]);

    useEffect(() => {
        if (!canRender) return;
        postCommand({
            type: "setData",
            payload: {
                markers,
                pathOverlays,
                pathCoords,
                pathColor,
                pathWidth,
                pathOutlineColor,
                pathOutlineWidth,
                nightModeEnabled,
            },
        });
    }, [
        canRender,
        markers,
        pathOverlays,
        pathCoords,
        pathColor,
        pathWidth,
        pathOutlineColor,
        pathOutlineWidth,
        nightModeEnabled,
        postCommand,
    ]);

    const onWebViewMessage = useCallback((event: any) => {
        const data = event?.nativeEvent?.data;
        if (!data) return;

        try {
            const message = JSON.parse(data);
            const type = message?.type;

            if (type === "initialized") {
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

            if (type === "error") {
                const errorMessage = typeof message?.payload?.message === "string"
                    ? message.payload.message
                    : "지도 초기화 중 오류가 발생했습니다.";
                setRuntimeErrorMessage(errorMessage);
                return;
            }

            if (type === "tap") {
                const latitude = safeNumber(message?.payload?.latitude);
                const longitude = safeNumber(message?.payload?.longitude);
                if (typeof latitude === "number" && typeof longitude === "number") {
                    onTapMap?.({ latitude, longitude });
                }
                return;
            }

            if (type === "zoomChanged") {
                const zoom = safeNumber(message?.payload?.zoom);
                if (typeof zoom === "number") {
                    onZoomChanged?.(zoom);
                }
                return;
            }
        } catch {
            // ignore malformed message
        }
    }, [onInitialized, onTapMap, onZoomChanged]);

    const html = useMemo(() => {
        if (!appKey) return "";
        const initialZoom = Math.max(5, Math.min(18, Math.round(camera.zoom ?? 12)));
        const initialLat = camera.latitude;
        const initialLng = camera.longitude;
        const showZoomControlFlag = showZoomControls ? "true" : "false";
        const showLocationControlFlag = showLocationButton ? "true" : "false";
        const darkFlag = nightModeEnabled ? "true" : "false";

        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #111827; }
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
      z-index: 1000;
      transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
    }
    #locationBtn.hidden { display: none; }
  </style>
  <script src="https://apis.openapi.sk.com/tmap/jsv2?version=1&appKey=${encodeURIComponent(appKey)}"></script>
</head>
<body>
  <div id="map"></div>
  <div id="mapTone"></div>
  <button id="locationBtn" class="${showLocationControlFlag === "true" ? "" : "hidden"}">◎</button>
  <script>
    (function () {
      var map = null;
      var markers = {};
      var pathLayers = [];
      var pendingData = null;
      var initRetry = 0;
      var isDarkTheme = ${darkFlag};
      var nativeMapTypeCandidates = null;
      var fallbackTileFilter = "invert(0.89) hue-rotate(182deg) saturate(0.72) brightness(0.84) contrast(1.14)";
      var fallbackTileFilterObserver = null;
      var fallbackTileFilterEnabled = false;

      function post(type, payload) {
        if (!window.ReactNativeWebView) return;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload || {} }));
      }

      function toLatLng(point) {
        return new Tmapv2.LatLng(point.latitude, point.longitude);
      }

      function escapeXml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      }

      // 출발/도착처럼 "지도 포인트 자체"를 강조할 때 쓰는 핀 렌더러.
      function markerIcon(item) {
        var fill = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var label = item && item.pinLabel ? String(item.pinLabel).trim() : "";
        if (!label) {
          var fallbackSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 24 24"><path fill="' + fill + '" d="M12 2C7.6 2 4 5.6 4 10c0 5.2 6.1 11 7.4 12.2c.3.3.9.3 1.2 0C13.9 21 20 15.2 20 10c0-4.4-3.6-8-8-8Zm0 11.2c-1.8 0-3.2-1.4-3.2-3.2S10.2 6.8 12 6.8s3.2 1.4 3.2 3.2s-1.4 3.2-3.2 3.2Z"/></svg>';
          return { uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(fallbackSvg), width: 34, height: 42 };
        }

        var w = 52;
        var h = 64;
        var centerX = Math.round(w / 2);
        var textSize = label.length >= 3 ? 9.4 : 10.4;
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            '<ellipse cx="' + centerX + '" cy="58" rx="8.7" ry="2.9" fill="rgba(15,23,42,0.16)" />' +
            '<path d="M26 4C35.8 4 43.5 11.6 43.5 21.2c0 8.6-6.2 15.6-12.6 22.4L26 51l-4.9-7.4C14.7 36.8 8.5 29.8 8.5 21.2C8.5 11.6 16.2 4 26 4Z" fill="' + fill + '" stroke="#FFFFFF" stroke-width="2.5" stroke-linejoin="round" />' +
            '<path d="M16.8 12.4C19 10.1 22.1 8.9 26 8.9c3.7 0 6.8 1 9 3.1" stroke="rgba(255,255,255,0.28)" stroke-width="1.7" stroke-linecap="round" fill="none" />' +
            '<text x="' + centerX + '" y="24.6" text-anchor="middle" font-size="' + textSize + '" font-family="Arial, sans-serif" font-weight="800" fill="#FFFFFF">' + escapeXml(label) + '</text>' +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
        };
      }

      // 버스/지하철/환승 캡슐 마커는 텍스트 길이에 따라 폭을 먼저 계산해 둔다.
      function buildBadgeConfig(item) {
        var labelRaw = (item && item.badgeLabel) ? String(item.badgeLabel) : "";
        var label = labelRaw.trim();
        if (!label) label = item && item.caption ? String(item.caption) : "구간";

        var style = item && item.markerStyle ? String(item.markerStyle) : "default";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var textColor = item && item.badgeTextColor ? String(item.badgeTextColor) : "#1F2937";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(148,163,184,0.72)";
        // badgeConnectorColor가 주어지면 배지 하단의 수직 가이드/링 색을 강제로 맞춘다.
        // 주지 않으면 기존 동작(버스는 파랑, 그 외는 accent)을 유지한다.
        var connectorColor = item && item.badgeConnectorColor
          ? String(item.badgeConnectorColor)
          // 정류장/역/환승 배지 아래 포인트는 보행 점선과 다른 역할이다.
          // 기본값을 중립 톤으로 두어 "접근 점선(파랑)"과 "실제 승하차 지점(링)"을 구분한다.
          : ((style === "bus" || style === "subway" || style === "transfer")
            ? "rgba(17,24,39,0.78)"
            : accent);
        var glyph = item && item.badgeGlyph ? String(item.badgeGlyph) : "";
        var hasGlyph = glyph.trim().length > 0 || style === "bus" || style === "subway" || style === "transfer";
        var labelLen = label.length;
        // 버스/지하철 배지는 텍스트 + 아이콘이 함께 들어가므로 기본 폭을 더 크게 잡아
        // 찌그러져 보이거나 줄임표가 너무 빨리 붙는 문제를 줄인다.
        var iconBaseWidth = hasGlyph ? 40 : 18;
        if (style === "bus") iconBaseWidth = 62;
        if (style === "subway") iconBaseWidth = 56;
        var width = iconBaseWidth + Math.max(22, Math.min(200, Math.round(labelLen * 7.0)));
        var minWidth = style === "default"
          ? 60
          : (style === "bus" ? 116 : style === "subway" ? 108 : 76);
        var maxWidth = style === "default"
          ? 148
          : (style === "bus" ? 280 : 248);
        width = Math.max(minWidth, Math.min(maxWidth, width));
        return {
          width: width,
          height: style === "default" ? 28 : 34,
          label: label,
          accent: accent,
          textColor: textColor,
          borderColor: borderColor,
          connectorColor: connectorColor,
          glyph: glyph,
          hasGlyph: hasGlyph,
          style: style,
        };
      }

      // 승차 정류장, 지하철역, 환승 지점을 네이버 지도 느낌의 캡슐 배지로 렌더링한다.
      function markerBadgeIcon(item) {
        var cfg = buildBadgeConfig(item);
        var label = escapeXml(cfg.label);
        var glyph = escapeXml(cfg.glyph);
        var w = cfg.width;
        var bubbleH = cfg.height;
        var specialStyle = cfg.style === "bus" || cfg.style === "subway" || cfg.style === "transfer";
        var h = specialStyle ? (bubbleH + 15) : (bubbleH + 6);
        var centerY = Math.round(bubbleH / 2);
        var pointerCenterX = Math.round(w / 2);
        var pointerHalfW = 4;
        var iconCenterX = 23;
        var cardFill = "#FFFFFF";
        var connectorColor = cfg.connectorColor || cfg.accent;
        var labelX = cfg.hasGlyph
          ? ((cfg.style === "bus" || cfg.style === "subway") ? 50 : 39)
          : 13;
        var shadow = specialStyle
          ? '<ellipse cx="' + pointerCenterX + '" cy="' + (h - 2.5) + '" rx="5.7" ry="1.8" fill="rgba(15,23,42,0.12)" />'
          : '';
        var iconMarkup = '';
        if (cfg.style === "bus") {
          iconMarkup =
            '<rect x="' + (iconCenterX - 11.2) + '" y="' + (centerY - 10.3) + '" width="22.4" height="20.6" rx="6.9" fill="' + cfg.accent + '" />' +
            '<rect x="' + (iconCenterX - 7.6) + '" y="' + (centerY - 5.8) + '" width="15.2" height="7.8" rx="2.0" fill="#FFFFFF" />' +
            '<rect x="' + (iconCenterX - 5.6) + '" y="' + (centerY - 4.1) + '" width="4.4" height="3.0" rx="0.8" fill="' + cfg.accent + '" opacity="0.94" />' +
            '<rect x="' + (iconCenterX + 1.2) + '" y="' + (centerY - 4.1) + '" width="4.4" height="3.0" rx="0.8" fill="' + cfg.accent + '" opacity="0.94" />' +
            '<circle cx="' + (iconCenterX - 4.7) + '" cy="' + (centerY + 5.0) + '" r="1.6" fill="#FFFFFF" opacity="0.9" />' +
            '<circle cx="' + (iconCenterX + 4.7) + '" cy="' + (centerY + 5.0) + '" r="1.6" fill="#FFFFFF" opacity="0.9" />';
        } else if (cfg.style === "subway") {
          iconMarkup =
            '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="11.0" fill="' + cfg.accent + '" />' +
            '<rect x="' + (iconCenterX - 7.1) + '" y="' + (centerY - 7.2) + '" width="14.2" height="12.8" rx="3.0" fill="#FFFFFF" />' +
            '<rect x="' + (iconCenterX - 4.9) + '" y="' + (centerY - 5.0) + '" width="3.0" height="2.6" rx="0.8" fill="' + cfg.accent + '" />' +
            '<rect x="' + (iconCenterX + 1.9) + '" y="' + (centerY - 5.0) + '" width="3.0" height="2.6" rx="0.8" fill="' + cfg.accent + '" />' +
            '<path d="M' + (iconCenterX - 5.3) + ' ' + (centerY + 2.5) + ' H' + (iconCenterX + 5.3) + '" stroke="' + cfg.accent + '" stroke-width="1.35" stroke-linecap="round" />' +
            '<path d="M' + (iconCenterX - 4.1) + ' ' + (centerY + 7.0) + ' L' + (iconCenterX - 2.1) + ' ' + (centerY + 4.7) +
              ' M' + (iconCenterX + 4.1) + ' ' + (centerY + 7.0) + ' L' + (iconCenterX + 2.1) + ' ' + (centerY + 4.7) + '" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" />';
        } else if (cfg.style === "transfer") {
          iconMarkup =
            '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="10" fill="' + cfg.accent + '" />' +
            '<path d="M11.2 ' + (centerY - 1.4) + ' H20.3 L17.8 ' + (centerY - 3.9) + ' M22.8 ' + (centerY + 1.4) + ' H13.7 L16.2 ' + (centerY + 3.9) + '" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none" />';
        } else {
          iconMarkup = cfg.hasGlyph
            ? '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="8" fill="' + cfg.accent + '" />' +
              '<text x="' + iconCenterX + '" y="' + (centerY + 3) + '" text-anchor="middle" font-size="9" font-family="Arial, sans-serif" font-weight="800" fill="#FFFFFF">' + glyph + '</text>'
            : '';
        }
        var labelText = '<text x="' + labelX + '" y="' + (centerY + 4.2) + '" font-size="11.1" font-family="Arial, sans-serif" font-weight="800" fill="' + cfg.textColor + '">' + label + '</text>';
        // specialStyle(bus/subway/transfer)은 말풍선 꼬리 대신 "수직 가이드 + 하단 링"으로 렌더링해
        // 레퍼런스 지도 UI처럼 배지와 실제 지점의 연결 관계를 명확히 보여 준다.
        var connectorMarkup = specialStyle
          // 레퍼런스에서는 배지 하단 연결부가 짧고, 끝 포인트도 "작은 링 + 진한 점"에 가깝다.
          // 길고 두꺼운 스템보다 얇고 짧은 스템을 써야 배지와 지도 지점이 자연스럽게 연결된다.
          ? '<path d="M' + pointerCenterX + ' ' + (bubbleH - 0.6) + ' L' + pointerCenterX + ' ' + (bubbleH + 5.6) + '" stroke="' + connectorColor + '" stroke-width="1.15" stroke-linecap="round" />' +
            '<circle cx="' + pointerCenterX + '" cy="' + (bubbleH + 9.2) + '" r="3.4" fill="#FFFFFF" stroke="' + connectorColor + '" stroke-width="1.25" />' +
            '<circle cx="' + pointerCenterX + '" cy="' + (bubbleH + 9.2) + '" r="1.15" fill="' + connectorColor + '" />'
          : '<path d="M' + (pointerCenterX - pointerHalfW) + ' ' + (bubbleH - 1) + ' L' + (pointerCenterX + pointerHalfW) + ' ' + (bubbleH - 1) + ' L' + pointerCenterX + ' ' + (h - 1) + ' Z" fill="' + cardFill + '" stroke="' + cfg.borderColor + '" stroke-width="1.4" stroke-linejoin="round" />';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
            shadow +
            '<rect x="1" y="1" width="' + (w - 2) + '" height="' + (bubbleH - 2) + '" rx="15" ry="15" fill="' + cardFill + '" stroke="' + cfg.borderColor + '" stroke-width="1.35" />' +
            iconMarkup +
            labelText +
            connectorMarkup +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: w,
          height: h,
        };
      }

      function markerArrowIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(255,255,255,0.92)";
        var rotation = Number(item && item.rotationDeg);
        if (!isFinite(rotation)) rotation = 0;
        // 최대 줌에서 화살표가 크면 노선보다 화살표 패턴이 먼저 보여서 UI가 거칠어진다.
        // 본체를 한 단계 줄여 "방향 보조 힌트"로만 읽히게 하고, 라인 실루엣을 먼저 남긴다.
        var size = 8;
        var center = Math.round(size / 2);
        var groupTransform = 'rotate(' + rotation + ' ' + center + ' ' + center + ')';
        var hasVisibleBorder = borderColor && borderColor !== "transparent" && borderColor !== "rgba(0,0,0,0)";
        var arrowPath = '<path d="M0.9 1.4 L7.1 4 L0.9 6.6 L2.6 4 Z" fill="' + bg + '"' +
          (hasVisibleBorder
            ? ' stroke="' + borderColor + '" stroke-width="0.58" stroke-linejoin="round"'
            : '') +
          ' />';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<g transform="' + groupTransform + '">' +
              arrowPath +
            '</g>' +
          '</svg>';
        return {
          uri: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
          width: size,
          height: size,
        };
      }

      function markerDotIcon(item) {
        var bg = item && item.tintColor ? String(item.tintColor) : "#1D72FF";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(255,255,255,0.95)";
        var rawSize = Number(item && item.dotSize);
        // 접근 점선은 작고 균일한 점처럼 보여야 해서 허용 범위를 조금 더 낮춘다.
        var size = isFinite(rawSize) ? Math.max(3, Math.min(14, Math.round(rawSize))) : 8;
        var center = Math.round(size / 2);
        var borderWidth = borderColor === "transparent" ? 0 : Math.max(0.95, size * 0.18);
        var radius = Math.max(1.1, center - (borderWidth > 0 ? 1.2 : 0.8));
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
      // 다크모드 적용은 \"네이티브 mapType 우선, 실패 시 CSS 필터 fallback\" 순서로 처리한다.
      // Tmap Web SDK는 dark mapType 이름이 런타임마다 달라 보이지만,
      // 지원하지 않는 값을 넣어도 setMapType()이 조용히 통과하는 경우가 있다.
      // 기존 구현처럼 후보를 넓게 추측하면 \"적용 성공\"으로 오판해서 CSS fallback이 꺼지고
      // 결과적으로 지도 타일은 계속 라이트로 남는다.
      // 그래서 아래 로직은:
      // 1) SDK가 실제로 export한 정확한 키만 후보로 사용하고
      // 2) getter로 mapType 변화가 확인될 때만 native theme 성공으로 인정한다.
      // 검증이 불가능하면 false를 반환해 CSS dark fallback을 유지한다.
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

      function isFallbackTileImage(imgEl) {
        if (!imgEl || !imgEl.getAttribute) return false;
        var src = "";
        try {
          src = String(imgEl.getAttribute("src") || imgEl.src || "");
        } catch (_error) {
          return false;
        }
        if (!src) return false;
        // 우리가 만든 badge/arrow/dot marker는 data URI SVG라서,
        // 타일 dark filter가 여기에까지 걸리면 흰 배지가 검게 반전되고
        // 작은 화살표 외곽도 탁해져서 사용자 스크린샷처럼 깨진 인상으로 보인다.
        if (/^(data|blob):/i.test(src)) return false;
        return true;
      }

      function syncFallbackTileFilter() {
        var mapEl = document.getElementById("map");
        if (!mapEl || !mapEl.querySelectorAll) return;
        var imgNodes = mapEl.querySelectorAll("img");
        for (var index = 0; index < imgNodes.length; index += 1) {
          var imgEl = imgNodes[index];
          if (!imgEl || !imgEl.style) continue;
          if (!isFallbackTileImage(imgEl)) {
            imgEl.style.filter = "none";
            imgEl.style.transition = "";
            continue;
          }
          // fallback dark mode는 "지도 타일을 어둡게 보정"하는 용도다.
          // 팬/줌 때 타일 img가 자주 갈아끼워지므로 observer와 함께 매번 다시 적용해,
          // 새 타일만 밝게 남는 현상 없이 기본 지도 톤만 안정적으로 유지한다.
          imgEl.style.filter = fallbackTileFilterEnabled ? fallbackTileFilter : "none";
          imgEl.style.transition = "filter 180ms ease";
        }
      }

      function bindFallbackTileFilterObserver() {
        var mapEl = document.getElementById("map");
        if (!mapEl || typeof MutationObserver === "undefined") return;
        if (fallbackTileFilterObserver) {
          fallbackTileFilterObserver.disconnect();
          fallbackTileFilterObserver = null;
        }
        // Tmap은 이동/확대 때 타일 DOM을 계속 교체한다.
        // 그래서 테마 적용을 한 번만 해두면 이후에 로드된 타일은 다시 밝아질 수 있어서,
        // map 내부 변경을 감지할 때마다 tile filter를 재동기화한다.
        fallbackTileFilterObserver = new MutationObserver(function () {
          syncFallbackTileFilter();
        });
        fallbackTileFilterObserver.observe(mapEl, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"],
        });
        syncFallbackTileFilter();
      }

      function applyTheme(isDark) {
        isDarkTheme = !!isDark;
        var mapEl = document.getElementById("map");
        var toneEl = document.getElementById("mapTone");
        var locationBtn = document.getElementById("locationBtn");
        var nativeThemeApplied = false;

        // 지도는 "SDK가 후보를 받았다"가 아니라 "실제로 mapType이 바뀐 증거가 있다"일 때만
        // native theme 적용 성공으로 본다.
        // 증거가 없으면 의도적으로 CSS fallback을 유지해서,
        // 다크 UI 안에 밝은 타일 지도가 끼어드는 회귀를 막는다.
        nativeThemeApplied = resolveVerifiedNativeThemeApplied(isDarkTheme);

        if (mapEl) {
          // #map 전체를 뒤집으면 base tile만 아니라 marker svg도 함께 반전된다.
          // 그 결과 버스 배지는 검은 캡슐처럼 보이고, 화살표도 흐릿하게 깨져 보이므로
          // 컨테이너 filter는 비우고 tile img에만 fallback dark filter를 분리 적용한다.
          mapEl.style.filter = "none";
          mapEl.style.transition = "none";
        }

        fallbackTileFilterEnabled = isDarkTheme && !nativeThemeApplied;
        syncFallbackTileFilter();

        if (toneEl) {
          toneEl.style.background = isDarkTheme
            ? "radial-gradient(circle at 20% 12%, rgba(96,165,250,0.08), rgba(15,23,42,0.18) 58%, rgba(2,6,23,0.36) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.03))";
          toneEl.style.opacity = (isDarkTheme && !nativeThemeApplied) ? "0.72" : "0";
        }

        document.body.style.backgroundColor = isDarkTheme ? "#0B1220" : "#F3F4F6";

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

      function clearMarkers() {
        Object.keys(markers).forEach(function (key) {
          var marker = markers[key];
          if (marker && marker.setMap) marker.setMap(null);
        });
        markers = {};
      }

      // React 쪽 marker 모델(displayType / markerStyle)을 실제 Tmap Marker/SVG로 변환해 배치한다.
      function renderMarkers(markerItems) {
        if (!map) return;
        clearMarkers();
        markerItems.forEach(function (item) {
          var displayType = item && item.displayType ? String(item.displayType) : "pin";
          var isBadge = displayType === "badge";
          var isArrow = displayType === "arrow";
          var isDot = displayType === "dot";
              var iconInfo = isBadge
                ? markerBadgeIcon(item)
                : isArrow
                  ? markerArrowIcon(item)
                  : isDot
                    ? markerDotIcon(item)
                  : markerIcon(item);

          var markerOption = {
            position: toLatLng(item),
            icon: iconInfo.uri,
            iconSize: new Tmapv2.Size(iconInfo.width, iconInfo.height),
            title: item.caption || "",
            map: map,
          };

          if (window.Tmapv2 && Tmapv2.Point) {
            try {
              var markerStyle = item && item.markerStyle ? String(item.markerStyle) : "default";
              var isFloatingBadge = isBadge && (markerStyle === "bus" || markerStyle === "subway" || markerStyle === "transfer");
              markerOption.iconAnchor = isBadge
                ? new Tmapv2.Point(Math.round(iconInfo.width / 2), isFloatingBadge ? (iconInfo.height - 6) : iconInfo.height)
                : isArrow
                  ? new Tmapv2.Point(Math.round(iconInfo.width / 2), Math.round(iconInfo.height / 2))
                  : isDot
                    ? new Tmapv2.Point(Math.round(iconInfo.width / 2), Math.round(iconInfo.height / 2))
                  : new Tmapv2.Point(Math.round(iconInfo.width / 2), iconInfo.height);
            } catch (_error) {}
          }

          var marker = new Tmapv2.Marker({
            position: markerOption.position,
            icon: markerOption.icon,
            iconSize: markerOption.iconSize,
            title: markerOption.title,
            map: markerOption.map,
            iconAnchor: markerOption.iconAnchor,
          });
          markers[item.id] = marker;
        });
      }

      function clearPaths() {
        pathLayers.forEach(function (layer) {
          if (layer.line && layer.line.setMap) layer.line.setMap(null);
          if (layer.outline && layer.outline.setMap) layer.outline.setMap(null);
        });
        pathLayers = [];
      }

      // 모든 안내선은 outline + main stroke 2중 레이어로 그려서 밝은 지도에서도 또렷하게 보이게 한다.
      function renderPath(pathCoords, color, width, outlineColor, outlineWidth) {
        if (!map) return;
        if (!Array.isArray(pathCoords) || pathCoords.length < 2) return;

        var path = pathCoords.map(function (point) { return toLatLng(point); });
        var outlineLayer = null;
        var lineLayer = null;

        if (outlineWidth > 0) {
          outlineLayer = new Tmapv2.Polyline({
            path: path,
            strokeColor: outlineColor,
            strokeWeight: width + (outlineWidth * 2),
            lineCap: "round",
            lineJoin: "round",
            map: map,
          });
        }

        lineLayer = new Tmapv2.Polyline({
          path: path,
          strokeColor: color,
          strokeWeight: width,
          lineCap: "round",
          lineJoin: "round",
          map: map,
        });

        pathLayers.push({
          outline: outlineLayer,
          line: lineLayer,
        });
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
        map.setCenter(new Tmapv2.LatLng(lat, lng));
        if (isFinite(Number(payload.zoom))) {
          map.setZoom(Math.max(5, Math.min(18, Math.round(Number(payload.zoom)))));
        }
        emitZoomChanged();
      }

      // region 이동은 경로 전체를 한 화면에 담는 fit 동작용.
      function setRegion(payload) {
        if (!payload) return;
        var lat = Number(payload.latitude);
        var lng = Number(payload.longitude);
        var latDelta = Number(payload.latitudeDelta);
        var lngDelta = Number(payload.longitudeDelta);
        if (!isFinite(lat) || !isFinite(lng)) return;
        var centerLat = isFinite(latDelta) ? lat + (latDelta / 2) : lat;
        var centerLng = isFinite(lngDelta) ? lng + (lngDelta / 2) : lng;
        setCamera({
          latitude: centerLat,
          longitude: centerLng,
          zoom: inferZoomByDelta(latDelta, lngDelta),
        });
      }

      // 경로 전체 bounds fit용 보조 함수. SDK의 panToBounds가 실패하면 center/zoom 계산으로 fallback 한다.
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
          map.panToBounds(bounds);
          setTimeout(function () { emitZoomChanged(); }, 50);
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

        var nextZoom = Math.max(5, Math.min(18, Math.round(currentZoom + delta)));
        try {
          map.setZoom(nextZoom);
          emitZoomChanged();
        } catch (_error) {}
      }

      function emitZoomChanged() {
        if (!map) return;
        var zoom = NaN;
        try {
          zoom = numberFromUnknown(map.getZoom ? map.getZoom() : map.zoom);
        } catch (_error) {}
        if (!isFinite(zoom)) return;
        post("zoomChanged", { zoom: zoom });
      }

      function applyData(payload) {
        if (!map) {
          pendingData = payload;
          return;
        }
        if (typeof payload.nightModeEnabled === "boolean") {
          applyTheme(payload.nightModeEnabled);
        }
        var markerItems = Array.isArray(payload.markers) ? payload.markers : [];
        renderMarkers(markerItems);
        clearPaths();

        var overlayItems = Array.isArray(payload.pathOverlays) ? payload.pathOverlays : [];
        if (overlayItems.length > 0) {
          overlayItems.forEach(function (overlay) {
            renderPath(
              Array.isArray(overlay.coords) ? overlay.coords : [],
              overlay.color || "#1D72FF",
              Number(overlay.width) || 10,
              overlay.outlineColor || "#FFFFFF",
              Number(overlay.outlineWidth) || 2.5
            );
          });
          return;
        }

        renderPath(
          Array.isArray(payload.pathCoords) ? payload.pathCoords : [],
          payload.pathColor || "#1D72FF",
          Number(payload.pathWidth) || 10,
          payload.pathOutlineColor || "#FFFFFF",
          Number(payload.pathOutlineWidth) || 3
        );
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
        return { latitude: lat, longitude: lng };
      }

      // 지도 탭 좌표를 React Native 쪽으로 다시 올려, 출발/도착 직접 지정 같은 상호작용에 사용한다.
      function bindMapTap() {
        if (!map) return;
        var tapHandler = function (eventObj) {
          var parsed = parseTapLatLng(eventObj);
          if (parsed) post("tap", parsed);
        };

        try {
          if (map.addListener) {
            map.addListener("click", tapHandler);
            map.addListener("tap", tapHandler);
            map.addListener("touchend", tapHandler);
            return;
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.events && Tmapv2.events.addListener) {
            Tmapv2.events.addListener(map, "click", tapHandler);
            Tmapv2.events.addListener(map, "tap", tapHandler);
          }
        } catch (_error) {}

        try {
          if (window.Tmapv2 && Tmapv2.Event && Tmapv2.Event.addListener) {
            Tmapv2.Event.addListener(map, "click", tapHandler);
            Tmapv2.Event.addListener(map, "tap", tapHandler);
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

      // 현재 위치 버튼은 WebView 안에서 직접 geolocation을 호출해 지도 중심만 이동시킨다.
      function goToCurrentLocation() {
        if (!navigator.geolocation || !map) return;
        navigator.geolocation.getCurrentPosition(
          function (position) {
            var lat = Number(position.coords.latitude);
            var lng = Number(position.coords.longitude);
            if (!isFinite(lat) || !isFinite(lng)) return;
            map.setCenter(new Tmapv2.LatLng(lat, lng));
            map.setZoom(Math.max(14, map.getZoom ? map.getZoom() : 14));
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
          zoomControl: ${showZoomControlFlag},
          scrollwheel: true,
        });

        bindFallbackTileFilterObserver();
        applyTheme(isDarkTheme);

        bindMapTap();
        bindMapZoom();

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
        if (type === "zoomBy") {
          zoomBy(payload);
        }
      }

      document.addEventListener("message", function (event) {
        onCommand(event && event.data);
      });
      window.addEventListener("message", function (event) {
        onCommand(event && event.data);
      });
      window.addEventListener("error", function (event) {
        var message = (event && event.message) ? String(event.message) : "스크립트 오류";
        post("error", { message: message });
      });

      initMap();
    })();
  </script>
</body>
</html>`;
    }, [
        appKey,
        camera.latitude,
        camera.longitude,
        camera.zoom,
        nightModeEnabled,
        showLocationButton,
        showZoomControls,
    ]);

    if (!canRender) {
        const missingReason = !hasWebView
            ? "Tmap 지도를 렌더링하려면 react-native-webview가 필요합니다."
            : "Tmap API 키가 없습니다. EXPO_PUBLIC_TMAP_APP_KEY를 설정해 주세요.";
        return (
            <View style={[styles.fallback, { backgroundColor: fallbackBackgroundColor }, style]}>
                <Text style={[styles.fallbackText, { color: fallbackTextColor }]}>
                    {missingReason}
                </Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, style]}>
            <WebView
                ref={webViewRef}
                originWhitelist={["*"]}
                source={{ html }}
                onMessage={onWebViewMessage}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                allowFileAccess={true}
                setSupportMultipleWindows={false}
                mixedContentMode="always"
                style={styles.webview}
            />
            {!!runtimeErrorMessage && (
                <View style={styles.errorOverlay}>
                    <Text style={styles.errorOverlayTitle}>지도 로딩 실패</Text>
                    <Text style={styles.errorOverlayText}>{runtimeErrorMessage}</Text>
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
    errorOverlay: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: "rgba(17, 24, 39, 0.86)",
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
});

export default TmapMapView;

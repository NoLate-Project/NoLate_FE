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
      var nativeLightMapTypeCandidates = [];
      var nativeDarkMapTypeCandidates = [];
      var nativeDarkMapTypeReady = false;

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

      function buildBadgeConfig(item) {
        var labelRaw = (item && item.badgeLabel) ? String(item.badgeLabel) : "";
        var label = labelRaw.trim();
        if (!label) label = item && item.caption ? String(item.caption) : "구간";

        var style = item && item.markerStyle ? String(item.markerStyle) : "default";
        var accent = item && item.tintColor ? String(item.tintColor) : "#2F80FF";
        var textColor = item && item.badgeTextColor ? String(item.badgeTextColor) : "#1F2937";
        var borderColor = item && item.badgeBorderColor ? String(item.badgeBorderColor) : "rgba(148,163,184,0.72)";
        var glyph = item && item.badgeGlyph ? String(item.badgeGlyph) : "";
        var hasGlyph = glyph.trim().length > 0 || style === "bus" || style === "subway" || style === "transfer";
        var labelLen = label.length;
        var width = (hasGlyph ? 42 : 18) + Math.max(20, Math.min(150, Math.round(labelLen * 6.8)));
        width = Math.max(style === "default" ? 60 : 74, Math.min(style === "default" ? 148 : 186, width));
        return {
          width: width,
          height: style === "default" ? 28 : 30,
          label: label,
          accent: accent,
          textColor: textColor,
          borderColor: borderColor,
          glyph: glyph,
          hasGlyph: hasGlyph,
          style: style,
        };
      }

      function markerBadgeIcon(item) {
        var cfg = buildBadgeConfig(item);
        var label = escapeXml(cfg.label);
        var glyph = escapeXml(cfg.glyph);
        var w = cfg.width;
        var bubbleH = cfg.height;
        var specialStyle = cfg.style === "bus" || cfg.style === "subway" || cfg.style === "transfer";
        var h = specialStyle ? (bubbleH + 18) : (bubbleH + 6);
        var centerY = Math.round(bubbleH / 2);
        var pointerCenterX = Math.round(w / 2);
        var pointerHalfW = 4;
        var iconCenterX = 18;
        var cardFill = "#FFFFFF";
        var labelX = cfg.hasGlyph ? 37 : 13;
        var shadow = specialStyle
          ? '<ellipse cx="' + pointerCenterX + '" cy="' + (h - 2.7) + '" rx="6.4" ry="2" fill="rgba(15,23,42,0.14)" />'
          : '';
        var iconMarkup = '';
        if (cfg.style === "bus") {
          iconMarkup =
            '<rect x="7" y="' + (centerY - 9.5) + '" width="22" height="19" rx="6.5" fill="' + cfg.accent + '" />' +
            '<rect x="11.1" y="' + (centerY - 5.4) + '" width="13.3" height="7.1" rx="1.8" fill="#FFFFFF" />' +
            '<rect x="12.7" y="' + (centerY - 3.9) + '" width="4" height="2.4" rx="0.7" fill="' + cfg.accent + '" />' +
            '<rect x="17.7" y="' + (centerY - 3.9) + '" width="4" height="2.4" rx="0.7" fill="' + cfg.accent + '" />' +
            '<circle cx="14.3" cy="' + (centerY + 3.4) + '" r="1.45" fill="' + cfg.accent + '" />' +
            '<circle cx="21.5" cy="' + (centerY + 3.4) + '" r="1.45" fill="' + cfg.accent + '" />';
        } else if (cfg.style === "subway") {
          iconMarkup =
            '<circle cx="' + iconCenterX + '" cy="' + centerY + '" r="10" fill="' + cfg.accent + '" />' +
            '<rect x="12.2" y="' + (centerY - 6.3) + '" width="11.4" height="9.8" rx="2.5" fill="#FFFFFF" />' +
            '<rect x="13.8" y="' + (centerY - 4.4) + '" width="2.7" height="2.3" rx="0.8" fill="' + cfg.accent + '" />' +
            '<rect x="18.8" y="' + (centerY - 4.4) + '" width="2.7" height="2.3" rx="0.8" fill="' + cfg.accent + '" />' +
            '<path d="M13.8 ' + (centerY + 5.9) + ' L16.1 ' + (centerY + 3.1) + ' M22.2 ' + (centerY + 5.9) + ' L19.9 ' + (centerY + 3.1) + '" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" />';
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
        var connectorMarkup = specialStyle
          ? '<path d="M' + pointerCenterX + ' ' + (bubbleH - 0.8) + ' L' + pointerCenterX + ' ' + (bubbleH + 7.2) + '" stroke="' + cfg.borderColor + '" stroke-width="1.4" stroke-linecap="round" />' +
            '<circle cx="' + pointerCenterX + '" cy="' + (bubbleH + 11.8) + '" r="4.2" fill="#FFFFFF" stroke="' + cfg.borderColor + '" stroke-width="1.25" />' +
            '<circle cx="' + pointerCenterX + '" cy="' + (bubbleH + 11.8) + '" r="1.65" fill="' + cfg.accent + '" />'
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
        var size = 14;
        var center = Math.round(size / 2);
        var groupTransform = 'rotate(' + rotation + ' ' + center + ' ' + center + ')';
        var svg = '' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<g transform="' + groupTransform + '">' +
              '<path d="M2.1 2.5 L11.6 7 L2.1 11.5 L4.9 7 Z" fill="' + bg + '" stroke="' + borderColor + '" stroke-width="1.1" stroke-linejoin="round" />' +
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
        var size = isFinite(rawSize) ? Math.max(4, Math.min(16, Math.round(rawSize))) : 8;
        var center = Math.round(size / 2);
        var borderWidth = borderColor === "transparent" ? 0 : Math.max(1.2, size * 0.22);
        var radius = Math.max(1.3, center - (borderWidth > 0 ? 1.6 : 1.0));
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

      function resolveNativeMapTypes() {
        if (nativeDarkMapTypeReady) return;
        nativeDarkMapTypeReady = true;

        try {
          var mapTypeObj = (window.Tmapv2 && Tmapv2.MapType) ? Tmapv2.MapType : null;
          if (!mapTypeObj || typeof mapTypeObj !== "object") return;

          var entries = Object.keys(mapTypeObj).map(function (key) {
            return { key: key, value: mapTypeObj[key] };
          });
          var lightKeys = ["ROAD", "BASIC", "NORMAL", "DEFAULT", "STANDARD", "BASE", "DAY"];
          var darkKeys = ["NIGHT", "DARK", "MIDNIGHT", "NAVI", "NAVI_NIGHT", "BLACK", "DARKMODE"];
          var seenLight = {};
          var seenDark = {};

          lightKeys.forEach(function (key) {
            var direct = mapTypeObj[key];
            if (direct !== undefined && direct !== null && !seenLight[String(direct)]) {
              nativeLightMapTypeCandidates.push(direct);
              seenLight[String(direct)] = true;
            }
          });

          entries.forEach(function (entry) {
            var upper = String(entry.key).toUpperCase();
            var valueKey = String(entry.value);

            if (
              (upper.indexOf("ROAD") >= 0
                || upper.indexOf("BASIC") >= 0
                || upper.indexOf("NORMAL") >= 0
                || upper.indexOf("DEFAULT") >= 0
                || upper.indexOf("STANDARD") >= 0
                || upper.indexOf("BASE") >= 0
                || upper.indexOf("DAY") >= 0)
              && !seenLight[valueKey]
            ) {
              nativeLightMapTypeCandidates.push(entry.value);
              seenLight[valueKey] = true;
            }

            if (
              (upper.indexOf("NIGHT") >= 0
                || upper.indexOf("DARK") >= 0
                || upper.indexOf("MIDNIGHT") >= 0
                || upper.indexOf("NAVI") >= 0
                || upper.indexOf("BLACK") >= 0)
              && !seenDark[valueKey]
            ) {
              nativeDarkMapTypeCandidates.push(entry.value);
              seenDark[valueKey] = true;
            }
          });

          // 일부 환경은 문자열 mapType 식별자를 허용하므로 보조 후보를 같이 둔다.
          darkKeys.forEach(function (key) {
            if (!seenDark[key]) {
              nativeDarkMapTypeCandidates.push(key);
              seenDark[key] = true;
            }
          });
          lightKeys.forEach(function (key) {
            if (!seenLight[key]) {
              nativeLightMapTypeCandidates.push(key);
              seenLight[key] = true;
            }
          });
        } catch (_error) {
          nativeLightMapTypeCandidates = [];
          nativeDarkMapTypeCandidates = [];
        }
      }

      function trySetMapType(candidates) {
        if (!map || !map.setMapType || !Array.isArray(candidates) || candidates.length === 0) {
          return false;
        }

        for (var i = 0; i < candidates.length; i += 1) {
          var candidate = candidates[i];
          try {
            map.setMapType(candidate);
            return true;
          } catch (_error) {
            // 다음 후보 시도
          }
        }
        return false;
      }

      function applyTheme(isDark) {
        isDarkTheme = !!isDark;
        var mapEl = document.getElementById("map");
        var toneEl = document.getElementById("mapTone");
        var locationBtn = document.getElementById("locationBtn");
        var nativeThemeApplied = false;

        resolveNativeMapTypes();
        if (isDarkTheme) {
          nativeThemeApplied = trySetMapType(nativeDarkMapTypeCandidates);
        } else {
          nativeThemeApplied = trySetMapType(nativeLightMapTypeCandidates);
        }

        if (mapEl) {
          mapEl.style.filter = (isDarkTheme && !nativeThemeApplied)
            ? "invert(0.89) hue-rotate(182deg) saturate(0.72) brightness(0.84) contrast(1.14)"
            : "none";
          mapEl.style.transition = "filter 180ms ease";
        }

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

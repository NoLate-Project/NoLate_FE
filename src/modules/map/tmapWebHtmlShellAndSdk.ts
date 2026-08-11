import type { TmapWebHtmlContext } from './tmapWebHtmlContext';

/** TMAP WebView 문서의 ShellAndSdk 영역을 생성합니다. */
export function buildTmapWebHtmlShellAndSdk(
  context: TmapWebHtmlContext,
): string {
  const {
    initialMapBackground,
    vectorScriptVersionJson,
    vectorScriptUrl,
    isDevelopmentFlag,
    showLocationControlFlag,
    darkFlag,
    nativeDirectionCapabilityScript,
    nativeStrokeColorScript,
    nativeDirectionReportScript,
    busBadgeGlyphJson,
    subwayBadgeGlyphJson,
  } = context;
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
  <script>window.__TMAP_SCRIPT_VERSION__ = ${vectorScriptVersionJson};</script>
  <script src="${vectorScriptUrl}"></script>
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
    class="${showLocationControlFlag === 'true' ? '' : 'hidden'}"
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
      var appliedMapType = null;
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
      var busBadgeGlyphUri = ${busBadgeGlyphJson};
      var subwayBadgeGlyphUri = ${subwayBadgeGlyphJson};

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
        return new Tmapv3.LatLng(point.latitude, point.longitude);
      }

      ${nativeStrokeColorScript}
      ${nativeDirectionCapabilityScript}

      function probeTmapNativeDirectionSupport() {
        var sdkReport = {
          hasTmapv3: !!window.Tmapv3,
          polylineV3: !!(window.Tmapv3 && Tmapv3.Polyline),
          scriptVersion: window.__TMAP_SCRIPT_VERSION__,
        };
        var row = {
          sdk: sdkReport.polylineV3 ? "Tmapv3" : "unknown",
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
          if (map && sdkReport.polylineV3) {
            var center = null;
            try {
              center = readLatLngFields(map.getCenter && map.getCenter());
            } catch (_centerError) {}
            var baseLat = center && isFinite(center.latitude) ? center.latitude : 37.5665;
            var baseLng = center && isFinite(center.longitude) ? center.longitude : 126.9780;
            testLine = new Tmapv3.Polyline({
              path: [
                new Tmapv3.LatLng(baseLat, baseLng),
                new Tmapv3.LatLng(baseLat + 0.0004, baseLng + 0.0012),
                new Tmapv3.LatLng(baseLat + 0.0009, baseLng + 0.0024),
              ],
              strokeColor: "#00A84D",
              strokeWeight: 8,
              strokeOpacity: 0.001,
              lineCap: "round",
              lineJoin: "round",
              direction: true,
              directionColor: "#FFFFFF",
              directionOpacity: 0.001,
            });

            testDashLine = new Tmapv3.Polyline({
              path: [
                new Tmapv3.LatLng(baseLat, baseLng),
                new Tmapv3.LatLng(baseLat + 0.0002, baseLng + 0.0012),
              ],
              strokeColor: "#2F7BFF",
              strokeWeight: 5,
              strokeOpacity: 0.001,
              strokeStyle: "dash",
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
            // 앱이 별도 화살표를 그리지 않고 TMAP의 내장 PATTERN:arrow를 사용한다.
            // 색상·투명도 지원 여부는 native direction 사용 조건에 포함하지 않는다.
            row.usableForRouteLine = row.supportsDirection;
            row.reasonNativeDirectionDisabled = row.usableForRouteLine
              ? null
              : directionCapability.confirmed
              ? "TMAP Vector JS native arrow pattern is unavailable."
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
          if (testLine && testLine.getMap && testLine.getMap() && testLine.setMap) {
            setTimeout(function () {
              try {
                testLine.setMap(null);
              } catch (_removeError) {}
            }, 60);
          }
          if (testDashLine && testDashLine.getMap && testDashLine.getMap() && testDashLine.setMap) {
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
${nativeDirectionReportScript}
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
        var latLng = null;
        try {
          latLng = new Tmapv3.LatLng(latitude, longitude);
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
          { target: map, methods: ["realToScreen", "pointFromLatLngToContainerPixel", "fromLatLngToContainerPixel", "latLngToContainerPixel", "latLngToPoint", "fromLatLngToPoint"] },
          { target: projection, methods: ["pointFromLatLngToContainerPixel", "fromLatLngToContainerPixel", "latLngToContainerPixel", "latLngToPoint", "fromLatLngToPoint"] },
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

        return projectWithMapCenter({ latitude: latitude, longitude: longitude });
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

`;
}

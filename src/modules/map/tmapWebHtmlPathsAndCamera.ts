import type { TmapWebHtmlContext } from './tmapWebHtmlContext';

/** TMAP WebView 문서의 PathsAndCamera 영역을 생성합니다. */
export function buildTmapWebHtmlPathsAndCamera(
  context: TmapWebHtmlContext,
): string {
  const { initialZoom } = context;
  return `      function clearPaths() {
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
        var hasLayer = !!(item.outline || item.line);
        var attachLayerOnce = function (layer) {
          if (!layer) return true;
          try {
            // Vector Polyline.setMap(map)은 동일 지도에 다시 호출해도 멱등이 아니며,
            // 같은 layer/style id를 재등록한다. 현재 지도에 붙어 있으면 그대로 둔다.
            if (typeof layer.getMap === "function" && layer.getMap() === map) return true;
            if (typeof layer.setMap !== "function") return false;
            layer.setMap(map);
            return true;
          } catch (_attachError) {
            return false;
          }
        };
        var attached = hasLayer && attachLayerOnce(item.outline) && attachLayerOnce(item.line);
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
        // 방향 화살표는 앱의 Canvas/SVG fallback 대신 TMAP Vector Polyline이 그린다.
        // 현재 사용하는 Vector v3의 direction 옵션은 solid 경로에 적용한다.
        var useNativeDirection = nativeDirection === true && normalizedStrokeStyle === "solid";
        if (nativeDirection === true && !useNativeDirection && !nativeDirectionUnavailableWarned) {
          nativeDirectionUnavailableWarned = true;
          debugWarn("[route-direction] native Tmap direction unavailable, drawing route line without arrows", {
            sdk: nativeDirectionReport && nativeDirectionReport.rows ? nativeDirectionReport.rows[0].sdk : "unknown",
            reason: normalizedStrokeStyle !== "solid"
              ? "Tmap native direction requires a solid Polyline stroke."
              : "native direction disabled",
            fallback: "none",
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
          outlineLayer = new Tmapv3.Polyline(outlineOptions);
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
        }
        if (isFinite(zIndexValue)) lineOptions.zIndex = zIndexValue + 1;
        lineLayer = new Tmapv3.Polyline(lineOptions);

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
        map.setCenter(new Tmapv3.LatLng(lat, lng));
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
        var bounds = new Tmapv3.LatLngBounds();
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
          bounds.extend(new Tmapv3.LatLng(lat, lng));
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
          // Vector Polyline은 zIndex 옵션을 실제 VSM layer 순서에 반영하지 않으므로,
          // 낮은 우선순위부터 생성해 높은 우선순위 경로가 위에 올라오게 한다.
          nativeOverlayItems.sort(function (a, b) {
            var az = Number(a && a.zIndex);
            var bz = Number(b && b.zIndex);
            if (!isFinite(az)) az = 0;
            if (!isFinite(bz)) bz = 0;
            return az - bz;
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

`;
}

import type { TmapWebHtmlContext } from './tmapWebHtmlContext';

/** TMAP WebView 문서의 InteractionAndBootstrap 영역을 생성합니다. */
export function buildTmapWebHtmlInteractionAndBootstrap(
  context: TmapWebHtmlContext,
): string {
  const {
    initialLat,
    initialLng,
    initialZoom,
    showZoomControlFlag,
    mapSelectionEventsJson,
    mapTouchSelectionMaxMovementPx,
  } = context;
  return `      function numberFromUnknown(value) {
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

        var eventData = eventObj.data && typeof eventObj.data === "object"
          ? eventObj.data
          : eventObj;

        var latLng =
          eventData.lngLat ||
          eventData.latLng ||
          eventData.latlng ||
          eventData.coordinate ||
          eventData.coord ||
          eventData.position ||
          eventData._latLng ||
          null;

        var parsedLatLng = readLatLngFields(latLng);
        var lat = parsedLatLng ? parsedLatLng.latitude : NaN;
        var lng = parsedLatLng ? parsedLatLng.longitude : NaN;

        if (!isFinite(lat)) lat = numberFromUnknown(eventData.lat);
        if (!isFinite(lat)) lat = numberFromUnknown(eventData.latitude);
        if (!isFinite(lng)) lng = numberFromUnknown(eventData.lng);
        if (!isFinite(lng)) lng = numberFromUnknown(eventData.longitude);

        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { latitude: lat, longitude: lng };
      }

      function parseSelectionScreenPoint(eventObj) {
        if (!eventObj || typeof eventObj !== "object") return null;
        var eventData = eventObj.data && typeof eventObj.data === "object"
          ? eventObj.data
          : eventObj;
        // Vector 이벤트의 screenPoint는 지도 컨테이너 기준 픽셀이다.
        var point = eventData.screenPoint || eventData.mapPixel || eventData.pixel || null;
        if (!point) return null;

        return readPointXY(point);
      }

      function isMarkerDomInteraction(eventObj) {
        if (!eventObj || typeof eventObj !== "object") return false;
        var eventData = eventObj.data && typeof eventObj.data === "object"
          ? eventObj.data
          : eventObj;
        var domEvent = eventData.domEvent || eventObj.domEvent || eventObj.originalEvent || null;
        var target = domEvent && (domEvent.target || domEvent.srcElement);
        if (!target) return false;
        try {
          if (typeof target.closest === "function" && target.closest(".vsm-marker")) return true;
        } catch (_closestError) {}
        while (target) {
          try {
            if (target.classList && target.classList.contains("vsm-marker")) return true;
          } catch (_classError) {}
          target = target.parentElement;
        }
        return false;
      }

      // 지도 탭 좌표를 React Native 쪽으로 다시 올려, 출발/도착 직접 지정 같은 상호작용에 사용한다.
      function bindMapTap() {
        if (!map) return;
        var selectionEvents = ${mapSelectionEventsJson};
        var touchCandidate = null;

        var postSelection = function (eventObj) {
          // Marker의 DOM touch가 Vector map container까지 버블되더라도 지도 좌표 선택으로
          // 처리하지 않는다. Marker 자체 Click은 별도의 markerPress로만 전달한다.
          if (isMarkerDomInteraction(eventObj)) return;
          var parsed = parseTapLatLng(eventObj);
          if (parsed) post("tap", parsed);
        };

        var beginTouchSelection = function (eventObj) {
          if (isMarkerDomInteraction(eventObj)) {
            touchCandidate = null;
            return;
          }
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
          if (touchCandidate.maxDistance > ${mapTouchSelectionMaxMovementPx}) {
            touchCandidate.cancelled = true;
          }
        };

        var cancelTouchSelection = function () {
          if (touchCandidate) touchCandidate.cancelled = true;
        };

        var endTouchSelection = function (eventObj) {
          if (!touchCandidate) return;
          if (isMarkerDomInteraction(eventObj)) {
            touchCandidate = null;
            return;
          }
          trackTouchSelection(eventObj);
          var shouldSelect = !touchCandidate.cancelled &&
            touchCandidate.maxDistance <= ${mapTouchSelectionMaxMovementPx};
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

        var bindAll = function () {
          bindings.forEach(function (binding) {
            try {
              map.on(binding.name, binding.handler);
            } catch (_error) {}
          });
        };

        try {
          if (typeof map.on === "function") bindAll();
        } catch (_error) {}
      }

      // 현재 zoom 변화를 React 상태로 다시 보내 route-planner가 안내선/마커 레벨을 바꿀 수 있게 한다.
      function bindMapZoom() {
        if (!map) return;
        var zoomHandler = function () {
          emitZoomChanged();
        };

        try { map.on("Zoom", zoomHandler); } catch (_error) {}
        try { map.on("ZoomEnd", zoomHandler); } catch (_error) {}
        try { map.on("MoveEnd", zoomHandler); } catch (_error) {}
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
          "DragStart",
          "Drag",
          "MoveStart",
          "Move",
          "ZoomStart",
          "Zoom",
          "TouchStart",
        ];
        var stableEventNames = [
          "DragEnd",
          "MoveEnd",
          "ZoomEnd",
          "Idle",
          "TouchEnd",
        ];

        try {
          if (typeof map.on === "function") {
            activeEventNames.forEach(function (eventName) {
              try {
                map.on(eventName, activeRenderHandler);
              } catch (_error) {}
            });
            stableEventNames.forEach(function (eventName) {
              try {
                map.on(eventName, stableRenderHandler);
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
            map.setCenter(new Tmapv3.LatLng(lat, lng));
            map.setZoom(Math.max(14, map.getZoom ? map.getZoom() : 14));
            markRouteOverlayIdleSoon(220);
          },
          function () {},
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
        );
      }

      var didFinishMapInitialization = false;

      function finishMapInitialization() {
        if (!map || didFinishMapInitialization) return;
        didFinishMapInitialization = true;

        applyTheme(isDarkTheme);
        bindMapTap();
        bindMapZoom();
        bindScreenRouteOverlayEvents();
        resizeMap("INIT");

        var locationBtn = document.getElementById("locationBtn");
        if (locationBtn) {
          locationBtn.onclick = goToCurrentLocation;
        }

        probeTmapNativeDirectionSupport();

        if (pendingData) {
          applyData(pendingData);
          pendingData = null;
        }

        post("initialized", {});
        emitZoomChanged();
      }

      function handleVectorConfigLoaded() {
        if (!map || didFinishMapInitialization) return;
        if (!isDarkTheme) {
          // Vector JS의 기본 스타일은 ROAD다. 같은 스타일을 다시 loadStyle 하지 않는다.
          appliedMapType = "ROAD";
          finishMapInitialization();
          return;
        }

        try {
          // NIGHT는 별도 벡터 스타일을 로드하므로 완료 뒤 overlay를 생성한다.
          map.on("StyleLoad", finishMapInitialization);
          applyTheme(true);
          // 이미 같은 스타일이 적용된 SDK 빌드는 StyleLoad를 다시 보내지 않을 수 있다.
          setTimeout(finishMapInitialization, 8000);
        } catch (_styleLoadError) {
          finishMapInitialization();
        }
      }

      // Vector 지도는 ConfigLoad 이후에만 Marker/Polyline을 안전하게 생성할 수 있다.
      function initMap() {
        if (!window.Tmapv3 || !window.Tmapv3.Map) {
          initRetry += 1;
          if (initRetry > 40) {
            post("error", { message: "지도를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요." });
            return;
          }
          setTimeout(initMap, 220);
          return;
        }

        try {
          map = new Tmapv3.Map("map", {
            center: new Tmapv3.LatLng(${initialLat}, ${initialLng}),
            width: "100%",
            height: "100%",
            zoom: ${initialZoom},
            minZoom: 6,
            maxZoom: 18,
            mapType: isDarkTheme ? "NIGHT" : "ROAD",
            naviControl: ${showZoomControlFlag},
            scaleBar: false,
            dragEnabled: true,
            zoomEnabled: true,
            rotateEnabled: false,
            pitchEnabled: false,
          });
          map.on("ConfigLoad", handleVectorConfigLoaded);
        } catch (error) {
          map = null;
          post("error", {
            message: "지도를 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          });
        }
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
}

import { StyleProp, ViewStyle } from 'react-native';

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
  displayType?: 'pin' | 'badge' | 'dot' | 'station' | 'routeLabel';
  markerStyle?:
    | 'default'
    | 'origin'
    | 'destination'
    | 'bus'
    | 'subway'
    | 'walk';
  stationVariant?: 'compact';
  badgeVariant?: 'default' | 'route' | 'context' | 'stop';
  pinLabel?: string;
  badgeLabel?: string;
  badgeSubLabel?: string;
  badgeTextColor?: string;
  badgeBorderColor?: string;
  badgeConnectorColor?: string;
  badgeGlyph?: string;
  eventIntent?: 'board' | 'alight' | 'transfer';
  badgeSide?: 'left' | 'right';
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
  strokeStyle?: 'solid' | 'dash' | 'dot';
  outlineStrokeStyle?: 'solid' | 'dash' | 'dot';
  renderMode?: 'native' | 'screen';
  shape?: 'solid' | 'dot';
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
      edgePadding?: {
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
    },
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
 * TMAP Vector 지도 객체는 데스크톱에서는 Click을, 모바일에서는 touch lifecycle을 보낸다.
 * 모바일 touchend는 drag 뒤에도 오므로 시작점 대비 이동량을 검사한 뒤에만 선택한다.
 */
export const TMAP_MAP_SELECTION_EVENTS = {
  click: 'Click',
  touchStart: 'TouchStart',
  touchMove: ['TouchMove', 'DragStart', 'Drag', 'DragEnd'],
  touchCancel: ['TouchCancel', 'ZoomStart', 'Zoom'],
  touchEnd: 'TouchEnd',
} as const;

export const TMAP_VECTOR_JS_SCRIPT_VERSION = 'vectorjs?version=1';
export const TMAP_VECTOR_JS_NAMESPACE = 'Tmapv3';

/** 환경 설정의 앱 키를 인코딩해 TMAP Vector SDK 스크립트 주소를 안전하게 조립합니다. */
export function getTmapVectorScriptUrl(appKey: string): string {
  return `https://apis.openapi.sk.com/tmap/${TMAP_VECTOR_JS_SCRIPT_VERSION}&appKey=${encodeURIComponent(
    appKey,
  )}`;
}

/** 플랫폼과 테마 설정을 바탕으로 WebView에서 사용할 TMAP 지도 유형을 결정합니다. */
export function getTmapVectorMapType(isDark: boolean): 'NIGHT' | 'ROAD' {
  return isDark ? 'NIGHT' : 'ROAD';
}

export const TMAP_MAP_TOUCH_SELECTION_MAX_MOVEMENT_PX = 10;
export const TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS = 500;
export const TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES = 0.00005;

export type TmapMapSelectionSample = {
  latitude: number;
  longitude: number;
  timestampMs: number;
};

/** 연속 지도 선택 이벤트의 좌표와 시각을 비교해 중복 콜백인지 판별합니다. */
export function isDuplicateTmapMapSelection(
  previous: TmapMapSelectionSample | undefined,
  next: TmapMapSelectionSample,
): boolean {
  if (!previous) return false;
  const elapsedMs = next.timestampMs - previous.timestampMs;
  return (
    elapsedMs >= 0 &&
    elapsedMs <= TMAP_MAP_SELECTION_DEDUPE_WINDOW_MS &&
    Math.abs(next.latitude - previous.latitude) <=
      TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES &&
    Math.abs(next.longitude - previous.longitude) <=
      TMAP_MAP_SELECTION_DEDUPE_TOLERANCE_DEGREES
  );
}

/** 위도·경도가 유한하며 WGS84 허용 범위 안에 있는지 검사합니다. */
export function isValidWgs84Coordinate(
  latitude: number,
  longitude: number,
): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export type TmapMapViewProps = {
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
    return require('react-native-webview');
  } catch {
    return null;
  }
})();

export const WebView = tmapWebviewModule?.WebView as any;
export const MAP_INITIALIZATION_TIMEOUT_MS = 15_000;
export const MAP_LOAD_ERROR_MESSAGE =
  '지도를 불러오지 못했습니다. 네트워크 연결을 확인하고 다시 시도해 주세요.';

/**
 * 지도 SDK가 준비되기 전 경로 state가 여러 번 바뀌면 오래된 setData 명령을 전부
 * 재생할 필요가 없다. 마지막 화면 데이터만 남겨 초기화 직후의 긴 멈춤과 깜빡임을 막는다.
 * fitBounds/zoom 같은 사용자 카메라 명령은 순서가 의미 있으므로 그대로 보존한다.
 */
export function enqueueTmapCommand(
  queue: string[],
  command: Record<string, unknown>,
): string[] {
  const serialized = JSON.stringify(command);
  if (command.type !== 'setData') return [...queue, serialized];

  return [
    ...queue.filter(queued => !queued.startsWith('{"type":"setData"')),
    serialized,
  ];
}

/** 알 수 없는 값을 유한한 숫자로 변환하고 변환할 수 없으면 안전한 대체값을 반환합니다. */
export function safeNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

/**
 * 경로 방향 표시는 앱이 screen-space 화살표를 덧그리지 않고
 * TMAP Vector Polyline의 native `direction` 패턴에 전담한다.
 * 호출부 호환성을 위해 기존 함수명은 유지하되 overlay는 그대로 반환한다.
 */
export function addNativeDirectionScreenFallbacks(
  overlays: TmapPathOverlay[],
  _nativeDirectionUsable: boolean | undefined,
): TmapPathOverlay[] {
  return overlays;
}

// SDK 기능 판정은 Release에서도 RN에 전달해 native direction 상태를 진단한다.
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
    vsmStyle?: Record<string, unknown>;
  };
};

/**
 * WebView probe와 동일한 fail-closed 판정을 테스트와 네이티브 코드에서 공유한다.
 * 현재 Vector JS는 directionColor/directionOpacity를 drawInfo에만 보관하고 실제 VSM에는
 * 고정 PATTERN:arrow를 넣으므로, 네이티브 화살표의 색상·투명도 지원으로 판정하지 않는다.
 */
export function readTmapNativeDirectionCapability(
  line: unknown,
): TmapNativeDirectionCapability {
  const shapeData = (line as TmapNativeDirectionProbeLine | null)?._shape_data;
  const drawInfo = shapeData?.drawInfo;
  const strokePattern = String(
    shapeData?.vsmStyle?.['stroke-pattern'] ?? '',
  ).toUpperCase();
  const usesFixedArrowPattern = strokePattern === 'PATTERN:ARROW';
  if (!drawInfo || !usesFixedArrowPattern) {
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
    supportsDirectionColor: false,
    supportsDirectionOpacity: false,
  };
}

// 실제 WebView에서 생성된 Polyline이 TMAP의 고정 PATTERN:arrow를 사용하는지 진단한다.
// 색상·투명도는 지원 여부만 기록하고, 앱 화살표 fallback 선택에는 사용하지 않는다.
export const TMAP_NATIVE_DIRECTION_CAPABILITY_SCRIPT = String.raw`
    function readTmapNativeDirectionCapability(line) {
      var shapeData = line && line._shape_data;
      var drawInfo = shapeData && shapeData.drawInfo;
      var strokePattern = String(shapeData && shapeData.vsmStyle && shapeData.vsmStyle["stroke-pattern"] || "").toUpperCase();
      var usesFixedArrowPattern = strokePattern === "PATTERN:ARROW";
      if (!drawInfo || !usesFixedArrowPattern) {
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
        // Vector JS는 요청값을 drawInfo에 저장하지만 실제 렌더링은 고정 PATTERN:arrow다.
        supportsDirectionColor: false,
        supportsDirectionOpacity: false,
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

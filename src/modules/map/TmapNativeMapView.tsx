import nativeStyles from "./TmapNativeMapView.styles";
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
    NativeSyntheticEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
    ViewProps,
} from "react-native";
import { getEnv } from "../../api/env";
import type {
    TmapCameraState,
    TmapMapViewHandle,
    TmapMapViewProps,
} from "./TmapMapView";

const NATIVE_MODULE_NAME = "NoLateTMap";
const MAP_INITIALIZATION_TIMEOUT_MS = 15_000;
const MAP_LOAD_ERROR_MESSAGE = "지도를 불러오지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
const MIN_ZOOM = 6;
const MAX_ZOOM = 18;
const MAX_COMMAND_HISTORY = 24;

type NativeCommand = {
    sequence: number;
    type: "animateCamera" | "fitBounds" | "resize" | "zoomBy";
    payload: Record<string, unknown>;
};

type NativeCommandBatch = {
    sequence: number;
    type: "batch";
    payload: {
        commands: NativeCommand[];
    };
};

type NativeEventPayload = Record<string, unknown>;

type NativeTMapViewProps = ViewProps & {
    appKey: string;
    data: Record<string, unknown>;
    command: NativeCommandBatch;
    onMapReady: (event: NativeSyntheticEvent<NativeEventPayload>) => void;
    onMapError: (event: NativeSyntheticEvent<NativeEventPayload>) => void;
    onMapTap: (event: NativeSyntheticEvent<NativeEventPayload>) => void;
    onMarkerPress: (event: NativeSyntheticEvent<NativeEventPayload>) => void;
    onCameraChange: (event: NativeSyntheticEvent<NativeEventPayload>) => void;
};

function loadNativeTMapView(): React.ComponentType<NativeTMapViewProps> | null {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
    try {
        // Keep this require inside the guarded native path. Expo Go and the
        // Jest runtime do not bundle the local module (and Jest intentionally
        // does not transform expo-modules-core's TypeScript sources).
        const expoModulesCore = require("expo-modules-core") as {
            requireOptionalNativeModule: (name: string) => unknown;
            requireNativeViewManager: <Props>(name: string) => React.ComponentType<Props>;
        };
        if (!expoModulesCore.requireOptionalNativeModule(NATIVE_MODULE_NAME)) return null;
        return expoModulesCore.requireNativeViewManager<NativeTMapViewProps>(NATIVE_MODULE_NAME);
    } catch {
        // Expo Go and Jest do not contain the local native module. The public
        // facade deliberately falls back to the Web renderer in those runtimes.
        return null;
    }
}

const NativeTMapView = loadNativeTMapView();

export function isNativeTMapViewAvailable(): boolean {
    return NativeTMapView !== null;
}

function clampZoom(value: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value)));
}

function inferZoomByDelta(latitudeDelta: number, longitudeDelta: number): number {
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

function eventPayload(event: NativeSyntheticEvent<NativeEventPayload>): NativeEventPayload {
    return event?.nativeEvent ?? {};
}

function finiteNumber(value: unknown): number | undefined {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

function metersPerPixel(latitude: number, zoom: number): number {
    return (
        156543.033928 *
        Math.max(0.01, Math.cos((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180))
    ) / (2 ** zoom);
}

async function getNativeCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
    // Loading expo-location only when the native control is pressed keeps the
    // WebView/Jest fallback independent from Expo native-module packages.
    const locationModule = require("./currentLocation") as {
        getCurrentLocation: () => Promise<{ latitude: number; longitude: number }>;
    };
    return locationModule.getCurrentLocation();
}

const TmapNativeMapView = forwardRef<TmapMapViewHandle, TmapMapViewProps>(function TmapNativeMapView(
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
        fallbackBackgroundColor = "#E5E7EB",
        fallbackTextColor = "#6B7280",
    },
    ref
) {
    const appKey = getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY") ?? "";
    const sequenceRef = useRef(0);
    const lastZoomRef = useRef<number | undefined>(undefined);
    const [nativeRevision, setNativeRevision] = useState(0);
    const [isReady, setIsReady] = useState(false);
    const [runtimeErrorMessage, setRuntimeErrorMessage] = useState<string | undefined>();
    const [command, setCommand] = useState<NativeCommandBatch>({
        sequence: 0,
        type: "batch",
        payload: { commands: [] },
    });

    const issueCommand = useCallback((
        type: NativeCommand["type"],
        payload: Record<string, unknown>
    ) => {
        sequenceRef.current += 1;
        const nextCommand: NativeCommand = {
            sequence: sequenceRef.current,
            type,
            payload,
        };
        setCommand((current) => {
            const commands = [...current.payload.commands, nextCommand].slice(-MAX_COMMAND_HISTORY);
            return {
                sequence: nextCommand.sequence,
                type: "batch",
                payload: { commands },
            };
        });
    }, []);

    useImperativeHandle(ref, () => ({
        animateCameraTo(nextCamera) {
            issueCommand("animateCamera", nextCamera);
        },
        animateRegionTo(region) {
            const latitudeDelta = Number(region.latitudeDelta);
            const longitudeDelta = Number(region.longitudeDelta);
            const pivotX = Math.max(0, Math.min(1, Number(region.pivot?.x ?? 0.5)));
            const pivotY = Math.max(0, Math.min(1, Number(region.pivot?.y ?? 0.5)));
            const regionCenterLatitude = region.latitude + (latitudeDelta / 2);
            const regionCenterLongitude = region.longitude + (longitudeDelta / 2);
            const zoomOffset = Number.isFinite(region.zoomOffset) ? Number(region.zoomOffset) : 0;
            issueCommand("animateCamera", {
                latitude: regionCenterLatitude - ((0.5 - pivotY) * latitudeDelta),
                longitude: regionCenterLongitude - ((pivotX - 0.5) * longitudeDelta),
                zoom: clampZoom(inferZoomByDelta(latitudeDelta, longitudeDelta) + zoomOffset),
                duration: region.duration,
                easing: region.easing,
            });
        },
        fitToCoordinates(coords, options) {
            if (!Array.isArray(coords) || coords.length < 2) return;
            issueCommand("fitBounds", {
                coords,
                padding: options?.padding ?? 48,
                edgePadding: options?.edgePadding,
            });
        },
        resizeMap(reason = "imperative") {
            issueCommand("resize", { reason });
        },
        zoomBy(delta) {
            issueCommand("zoomBy", { delta });
        },
    }), [issueCommand]);

    const data = useMemo<Record<string, unknown>>(() => ({
        revision: nativeRevision,
        camera,
        markers,
        pathOverlays,
        pathOverlayZoom,
        pathCoords,
        pathColor,
        pathWidth,
        pathOutlineColor,
        pathOutlineWidth,
        clearRouteOverlays,
        routeOverlayScope,
        nightModeEnabled,
        routeFocusMode,
    }), [
        camera,
        clearRouteOverlays,
        markers,
        nativeRevision,
        nightModeEnabled,
        pathColor,
        pathCoords,
        pathOutlineColor,
        pathOutlineWidth,
        pathOverlayZoom,
        pathOverlays,
        pathWidth,
        routeFocusMode,
        routeOverlayScope,
    ]);

    useEffect(() => {
        setIsReady(false);
        setRuntimeErrorMessage(undefined);
        lastZoomRef.current = undefined;
    }, [nativeRevision]);

    useEffect(() => {
        if (isReady || runtimeErrorMessage || !appKey) return;
        const timeoutId = setTimeout(() => {
            setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
        }, MAP_INITIALIZATION_TIMEOUT_MS);
        return () => clearTimeout(timeoutId);
    }, [appKey, isReady, nativeRevision, runtimeErrorMessage]);

    useEffect(() => {
        if (appKey) return;
        onInitialized?.();
    }, [appKey, onInitialized]);

    const handleMapReady = useCallback(() => {
        setIsReady(true);
        setRuntimeErrorMessage(undefined);
        onInitialized?.();
    }, [onInitialized]);

    const handleMapError = useCallback((event: NativeSyntheticEvent<NativeEventPayload>) => {
        const payload = eventPayload(event);
        if (typeof __DEV__ === "boolean" && __DEV__) {
            console.warn("[tmap-native] map error", payload.code, payload.message);
        }
        setIsReady(false);
        setRuntimeErrorMessage(MAP_LOAD_ERROR_MESSAGE);
    }, []);

    const handleMapTap = useCallback((event: NativeSyntheticEvent<NativeEventPayload>) => {
        const payload = eventPayload(event);
        const latitude = finiteNumber(payload.latitude);
        const longitude = finiteNumber(payload.longitude);
        if (latitude === undefined || longitude === undefined) return;
        onTapMap?.({ latitude, longitude });
    }, [onTapMap]);

    const handleMarkerPress = useCallback((event: NativeSyntheticEvent<NativeEventPayload>) => {
        const payload = eventPayload(event);
        if (typeof payload.id !== "string" || payload.id.length === 0) return;
        onMarkerPress?.({
            id: payload.id,
            interactionId: typeof payload.interactionId === "string"
                ? payload.interactionId
                : undefined,
        });
    }, [onMarkerPress]);

    const handleCameraChange = useCallback((event: NativeSyntheticEvent<NativeEventPayload>) => {
        const payload = eventPayload(event);
        const latitude = finiteNumber(payload.latitude);
        const longitude = finiteNumber(payload.longitude);
        const zoom = finiteNumber(payload.zoom);
        if (latitude === undefined || longitude === undefined || zoom === undefined) return;
        const resolvedMetersPerPixel = finiteNumber(payload.metersPerPixel) ?? metersPerPixel(latitude, zoom);
        const cameraState: TmapCameraState = {
            latitude,
            longitude,
            zoom,
            metersPerPixel: resolvedMetersPerPixel,
        };
        onCameraChanged?.(cameraState);
        if (lastZoomRef.current === undefined || Math.abs(lastZoomRef.current - zoom) >= 0.001) {
            lastZoomRef.current = zoom;
            onZoomChanged?.(zoom);
        }
    }, [onCameraChanged, onZoomChanged]);

    const handleContainerLayout = useCallback((event: any) => {
        const width = Math.round(event?.nativeEvent?.layout?.width ?? 0);
        const height = Math.round(event?.nativeEvent?.layout?.height ?? 0);
        if (width <= 0 || height <= 0) return;
        onMapLayoutReport?.({
            reason: "RN_NATIVE_CONTAINER_LAYOUT",
            mapContainerWidth: width,
            mapContainerHeight: height,
            webViewWidth: width,
            webViewHeight: height,
            isCameraAnimating: false,
            isMapIdle: true,
        });
        issueCommand("resize", { reason: "RN_NATIVE_CONTAINER_LAYOUT", width, height });
    }, [issueCommand, onMapLayoutReport]);

    const moveToCurrentLocation = useCallback(async () => {
        try {
            const location = await getNativeCurrentLocation();
            issueCommand("animateCamera", { ...location, zoom: Math.max(camera.zoom ?? 15, 15) });
        } catch (error) {
            if (typeof __DEV__ === "boolean" && __DEV__) {
                console.warn("[tmap-native] current location failed", error);
            }
        }
    }, [camera.zoom, issueCommand]);

    if (!NativeTMapView || !appKey) {
        const message = !NativeTMapView
            ? "이 기기에서는 지도를 사용할 수 없어요."
            : "지도 설정을 불러오지 못했습니다. 앱을 최신 버전으로 업데이트해 주세요.";
        return (
            <View
                accessible
                accessibilityRole="alert"
                accessibilityLabel={message}
                style={[nativeStyles.fallback, { backgroundColor: fallbackBackgroundColor }, style]}
            >
                <Text style={[nativeStyles.fallbackText, { color: fallbackTextColor }]}>{message}</Text>
            </View>
        );
    }

    return (
        <View
            style={[nativeStyles.container, { backgroundColor: fallbackBackgroundColor }, style]}
            onLayout={handleContainerLayout}
        >
            <NativeTMapView
                key={`tmap-native-${nativeRevision}`}
                accessibilityLabel="지도"
                style={StyleSheet.absoluteFill}
                appKey={appKey}
                data={data}
                command={command}
                onMapReady={handleMapReady}
                onMapError={handleMapError}
                onMapTap={handleMapTap}
                onMarkerPress={handleMarkerPress}
                onCameraChange={handleCameraChange}
            />
            {mapBaseDimOpacity > 0 ? (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: nightModeEnabled ? "#020617" : "#FFFFFF",
                            opacity: Math.max(0, Math.min(0.82, mapBaseDimOpacity)),
                        },
                    ]}
                />
            ) : null}
            {showZoomControls ? (
                <View style={nativeStyles.zoomControls}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="지도 확대"
                        onPress={() => issueCommand("zoomBy", { delta: 1 })}
                        style={nativeStyles.controlButton}
                    >
                        <Text style={nativeStyles.controlText}>＋</Text>
                    </Pressable>
                    <View style={nativeStyles.controlDivider} />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="지도 축소"
                        onPress={() => issueCommand("zoomBy", { delta: -1 })}
                        style={nativeStyles.controlButton}
                    >
                        <Text style={nativeStyles.controlText}>−</Text>
                    </Pressable>
                </View>
            ) : null}
            {showLocationButton ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="내 위치로 이동"
                    onPress={moveToCurrentLocation}
                    style={nativeStyles.locationButton}
                >
                    <Text style={nativeStyles.locationText}>◎</Text>
                </Pressable>
            ) : null}
            {!isReady && !runtimeErrorMessage ? (
                <View
                    pointerEvents="none"
                    accessibilityLiveRegion="polite"
                    style={[nativeStyles.loadingOverlay, { backgroundColor: fallbackBackgroundColor }]}
                >
                    <ActivityIndicator color="#2979FF" />
                    <Text style={[nativeStyles.loadingText, { color: fallbackTextColor }]}>지도를 불러오는 중…</Text>
                </View>
            ) : null}
            {runtimeErrorMessage ? (
                <View
                    accessibilityLiveRegion="assertive"
                    style={[
                        nativeStyles.errorOverlay,
                        typeof errorOverlayTop === "number"
                            ? { top: errorOverlayTop, bottom: undefined }
                            : null,
                    ]}
                >
                    <View style={nativeStyles.errorCopy}>
                        <Text style={nativeStyles.errorTitle}>지도 로딩 실패</Text>
                        <Text style={nativeStyles.errorText}>{runtimeErrorMessage}</Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="지도 다시 불러오기"
                        onPress={() => setNativeRevision((current) => current + 1)}
                        style={nativeStyles.retryButton}
                    >
                        <Text style={nativeStyles.retryText}>다시 시도</Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
});

export default TmapNativeMapView;

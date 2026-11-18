import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Animated, Easing, Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { FadeIn, Keyframe, ReduceMotion } from "react-native-reanimated";

import TmapMapView, { type TmapMarker } from "../../modules/map/TmapMapView";
import { getMapPickerAddressLabel, isMapPickedPlaceWithoutAddress } from "../../modules/schedule/routePointSelection";
import styles from "./route-select.styles";
import {
    MAP_PICKER_DEFAULT_ZOOM,
    MAP_PICKER_FALLBACK_LAT,
    MAP_PICKER_FALLBACK_LNG,
} from "./RouteSelectAnimatedControls";
import { Ionicons } from "./RouteSelectAnimatedControls";
import { placeHasCoords } from "./routeSelectPlaceModel";
import type { RouteSelectController } from "./useRouteSelectController";

type RouteSelectMapPickerSheetProps = {
    controller: RouteSelectController;
    onCancelDismissed: () => void;
};
const mapAddressEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const confirmedLocationEntrance = new Keyframe({
    0: { opacity: 0.7, transform: [{ perspective: 180 }, { rotateX: "-28deg" }, { scale: 0.88 }] },
    100: {
        opacity: 1,
        transform: [{ perspective: 180 }, { rotateX: "0deg" }, { scale: 1 }],
    },
}).duration(180).reduceMotion(ReduceMotion.System);

/** 지도 좌표 선택 모달의 카메라, 표식, 안내 문구와 확정 동작을 구성한다. */
export function RouteSelectMapPickerSheet({
    controller,
    onCancelDismissed,
}: RouteSelectMapPickerSheetProps) {
    const {
        insets,
        isDark,
        mapPickerVisible,
        mapPickerSession,
        mapPickerCoord,
        mapPickerHasSelection,
        mapPickerName,
        mapPickerAddress,
        mapPickerAddressUnavailable,
        mapPickerResolving,
        activeTarget,
        reduceFavoriteMotionEnabled,
        origin,
        destination,
        closeMapPicker,
        selectMapPickerCoord,
        confirmMapPickerSelection,
        routeUi,
    } = controller;
    const { fontScale } = useWindowDimensions();
    const previousTarget = useRef(activeTarget);
    const cancelled = useRef(false);
    const restoreAfterCancel = React.useCallback(() => {
        if (!cancelled.current) return;
        cancelled.current = false;
        onCancelDismissed();
    }, [onCancelDismissed]);
    useEffect(() => {
        if (Platform.OS === "ios" || mapPickerVisible || !cancelled.current) return;
        const frame = requestAnimationFrame(restoreAfterCancel);
        return () => cancelAnimationFrame(frame);
    }, [mapPickerVisible, restoreAfterCancel]);
    const cancelPicker = () => {
        cancelled.current = true;
        closeMapPicker();
    };
    const wasVisible = useRef(false);
    const stageOpacity = useRef(new Animated.Value(1)).current;
    useLayoutEffect(() => {
        const targetChanged = previousTarget.current !== activeTarget;
        const remainedOpen = wasVisible.current && mapPickerVisible;
        previousTarget.current = activeTarget;
        wasVisible.current = mapPickerVisible;
        if (!remainedOpen || !targetChanged || reduceFavoriteMotionEnabled) {
            stageOpacity.setValue(1);
            return;
        }
        stageOpacity.setValue(0.28);
        const reveal = Animated.timing(stageOpacity, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        reveal.start();
        return () => reveal.stop();
    }, [activeTarget, mapPickerVisible, reduceFavoriteMotionEnabled, stageOpacity]);
    const mapPickerCamera = useMemo(() => ({
        latitude: mapPickerSession.cameraCoordinate?.latitude ?? MAP_PICKER_FALLBACK_LAT,
        longitude: mapPickerSession.cameraCoordinate?.longitude ?? MAP_PICKER_FALLBACK_LNG,
        zoom: MAP_PICKER_DEFAULT_ZOOM,
    }), [mapPickerSession.cameraCoordinate]);
    const mapPickerMarkers = useMemo<TmapMarker[]>(() => {
        const markers: TmapMarker[] = [];
        if (placeHasCoords(origin)) {
            markers.push({
                id: "map-picker-origin",
                latitude: origin.lat,
                longitude: origin.lng,
                markerStyle: "origin",
                tintColor: routeUi.accentGreen,
                pinLabel: "출",
                caption: "출발지",
                zIndex: 20,
            });
        }
        if (placeHasCoords(destination)) {
            markers.push({
                id: "map-picker-destination",
                latitude: destination.lat,
                longitude: destination.lng,
                markerStyle: "destination",
                tintColor: routeUi.accentRed,
                pinLabel: "도",
                caption: "도착지",
                zIndex: 20,
            });
        }
        if (mapPickerCoord && mapPickerHasSelection) {
            markers.push({
                id: "map-picker-selected",
                latitude: mapPickerCoord.latitude,
                longitude: mapPickerCoord.longitude,
                markerStyle: "default",
                tintColor: routeUi.accentBlue,
                pinLabel: "선택",
                caption: "선택한 위치",
                zIndex: 40,
            });
        }
        return markers;
    }, [
        destination,
        mapPickerCoord,
        mapPickerHasSelection,
        origin,
        routeUi.accentBlue,
        routeUi.accentGreen,
        routeUi.accentRed,
    ]);
    const targetLabel = activeTarget === "origin" ? "출발지" : "도착지";
    const confirmDisabled = !mapPickerCoord || !mapPickerHasSelection || mapPickerResolving;
    const addressConfirmed = mapPickerHasSelection && !mapPickerResolving && !mapPickerAddressUnavailable;
    const addressLabel = getMapPickerAddressLabel(mapPickerAddress);
    const selectedPlaceLabel = mapPickerResolving ? "주소를 확인하고 있어요"
        : mapPickerAddressUnavailable ? "주소를 확인하지 못했어요"
        : mapPickerHasSelection ? mapPickerName ?? addressLabel ?? "선택한 위치"
        : "지도에서 위치를 눌러 주세요";
    const selectedAddress = mapPickerAddressUnavailable
        ? "지도에 표시된 위치로 확정할 수 있어요."
        : mapPickerName && addressLabel !== selectedPlaceLabel ? addressLabel : undefined;
    return (
        <Modal
            visible={mapPickerVisible}
            animationType={reduceFavoriteMotionEnabled ? "none" : "slide"}
            onRequestClose={cancelPicker}
            onDismiss={restoreAfterCancel}
        >
            <View accessibilityViewIsModal style={[styles.mapPickerRoot, { backgroundColor: routeUi.background }]}>
                <TmapMapView
                    style={styles.mapPickerMap}
                    errorOverlayTop={Math.max(insets.top + 72, 104)}
                    camera={mapPickerCamera}
                    markers={mapPickerMarkers}
                    nightModeEnabled={isDark}
                    showLocationButton={false}
                    showZoomControls
                    onTapMap={selectMapPickerCoord}
                    fallbackBackgroundColor={routeUi.surface2}
                    fallbackTextColor={routeUi.textSecondary}
                />
                <View style={[styles.mapPickerHeader, { paddingTop: insets.top + 8 }]}>
                    <View style={styles.mapPickerHeaderRow}>
                        <Pressable
                            onPress={cancelPicker}
                            accessibilityRole="button"
                            accessibilityLabel="지도 선택 닫기"
                            style={[styles.mapPickerIconButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                        >
                            <Ionicons name="chevron-back-outline" size={22} color={routeUi.textPrimary} />
                        </Pressable>
                        <View style={[styles.mapPickerTitleBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Animated.Text
                                accessibilityRole="header"
                                maxFontSizeMultiplier={1.75}
                                style={[styles.mapPickerStageTitle, { color: routeUi.textPrimary, opacity: stageOpacity }]}
                            >
                                {`${targetLabel} 선택`}
                            </Animated.Text>
                        </View>
                    </View>
                    {activeTarget === "destination" && placeHasCoords(origin) && (
                        <Animated.View style={[styles.mapPickerOriginPill, {
                            backgroundColor: routeUi.surface,
                            borderColor: routeUi.border,
                            opacity: stageOpacity,
                        }]}>
                            <Ionicons name="location-outline" size={16} color={routeUi.accentGreen} />
                            <Text numberOfLines={2} maxFontSizeMultiplier={1.5} style={[styles.mapPickerOriginText, { color: routeUi.textPrimary }]}>
                                {isMapPickedPlaceWithoutAddress(origin, "origin")
                                    ? "선택한 출발지"
                                    : `출발지 ${origin.name || origin.address}`}
                            </Text>
                        </Animated.View>
                    )}
                </View>
                <View testID="route-map-handoff-sheet" style={[styles.mapPickerBottomSheet, styles.mapPickerConfirmationSheet, {
                    backgroundColor: routeUi.surface,
                    borderColor: routeUi.border,
                    paddingBottom: Math.max(insets.bottom + 12, 20),
                }]}>
                    <Animated.View style={[styles.mapPickerPlace, { minHeight: Math.max(64, 44 * Math.min(fontScale, 1.75)), opacity: stageOpacity }]}>
                        {addressConfirmed ? (
                            <Reanimated.View entering={confirmedLocationEntrance} pointerEvents="none">
                                <Ionicons name="checkmark-circle-outline" size={20} color={routeUi.accentBlue} />
                            </Reanimated.View>
                        ) : (
                            <Ionicons name="location-outline" size={20} color={routeUi.accentBlue} />
                        )}
                        <View style={styles.mapPickerPlaceCopy} accessibilityLiveRegion="polite">
                            <Reanimated.View key={selectedPlaceLabel} entering={mapPickerHasSelection && !mapPickerResolving ? mapAddressEntrance : undefined} style={styles.mapPickerPlaceDetails}>
                                <Text numberOfLines={fontScale > 1.35 ? undefined : 2} maxFontSizeMultiplier={1.75} style={[styles.mapPickerPlaceTitle, { color: routeUi.textPrimary }]}>{selectedPlaceLabel}</Text>
                                {selectedAddress && <Text numberOfLines={fontScale > 1.35 ? undefined : 2} maxFontSizeMultiplier={1.55} style={[styles.mapPickerPlaceAddress, { color: routeUi.textSecondary }]}>{selectedAddress}</Text>}
                            </Reanimated.View>
                        </View>
                    </Animated.View>
                    <Pressable
                        testID="route-map-handoff-confirm"
                        accessibilityRole="button"
                        accessibilityLabel={`${targetLabel} 확정`}
                        accessibilityState={{ disabled: confirmDisabled, busy: mapPickerResolving }}
                        disabled={confirmDisabled}
                        onPress={() => confirmMapPickerSelection(activeTarget)}
                        style={[styles.mapPickerConfirm, { backgroundColor: confirmDisabled ? routeUi.surface2 : routeUi.accentBlue }]}
                    >
                        <Animated.Text style={[styles.mapPickerConfirmText, {
                            opacity: stageOpacity,
                            color: confirmDisabled ? routeUi.textSecondary : isDark ? routeUi.background : '#FFFFFF',
                        }]} maxFontSizeMultiplier={2}>{`${targetLabel} 확정`}</Animated.Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );

}

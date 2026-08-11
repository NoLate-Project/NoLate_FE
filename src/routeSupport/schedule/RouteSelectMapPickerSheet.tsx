import React, { useMemo } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import TmapMapView, { type TmapMarker } from "../../modules/map/TmapMapView";
import MapPickerTargetActions from "../../modules/schedule/components/route/MapPickerTargetActions";
import CalendarGlassSurface from "../../modules/schedule/components/calendar/CalendarGlassSurface";
import BrandedLoader from "../../ui/BrandedLoader";
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
};

/** 지도 좌표 선택 모달의 카메라, 표식, 안내 문구와 확정 동작을 구성한다. */
export function RouteSelectMapPickerSheet({
    controller,
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
        mapPickerResolving,
        origin,
        destination,
        closeMapPicker,
        selectMapPickerCoord,
        confirmMapPickerSelection,
        routeUi,
    } = controller;
    const mapPickerCamera = {
        latitude: mapPickerSession.cameraCoordinate?.latitude ?? MAP_PICKER_FALLBACK_LAT,
        longitude: mapPickerSession.cameraCoordinate?.longitude ?? MAP_PICKER_FALLBACK_LNG,
        zoom: MAP_PICKER_DEFAULT_ZOOM,
    };
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
    const mapPickerTitle = "지도에서 위치 선택";
    const mapPickerOriginMissing = !placeHasCoords(origin);
    const mapPickerDestinationMissing = !placeHasCoords(destination);
    const mapPickerMissingTarget = mapPickerOriginMissing === mapPickerDestinationMissing
        ? undefined
        : mapPickerOriginMissing
            ? "출발지"
            : "도착지";
    const mapPickerInstruction = mapPickerHasSelection
        ? "이 위치를 어디로 설정할까요?"
        : mapPickerMissingTarget
            ? `${mapPickerMissingTarget}로 사용할 위치를 지도에서 탭하세요`
            : "지도에서 사용할 위치를 탭하세요";
    const mapPickerSelectionLabel = !mapPickerHasSelection
        ? "아직 선택한 위치가 없습니다"
        : mapPickerName ?? mapPickerAddress ?? (mapPickerCoord
            ? `${mapPickerCoord.latitude.toFixed(5)}, ${mapPickerCoord.longitude.toFixed(5)}`
            : "아직 선택한 위치가 없습니다");
    return (
        <Modal
            visible={mapPickerVisible}
            animationType="slide"
            onRequestClose={closeMapPicker}
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
                    <Pressable
                        onPress={closeMapPicker}
                        accessibilityRole="button"
                        accessibilityLabel="지도 선택 닫기"
                        style={[styles.mapPickerIconButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                    >
                        <Text style={[styles.mapPickerBackText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={[styles.mapPickerTitleBox, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <Text numberOfLines={1} style={[styles.mapPickerTitle, { color: routeUi.textPrimary }]}>
                            {mapPickerTitle}
                        </Text>
                    </View>
                </View>
                <CalendarGlassSurface
                    prominent
                    variant="mapCard"
                    style={[
                        styles.mapPickerBottomSheet,
                        {
                            borderColor: routeUi.border,
                            paddingBottom: Math.max(insets.bottom + 14, 22),
                        },
                    ]}
                >
                    <Text style={[styles.mapPickerInstruction, { color: routeUi.textPrimary }]}>
                        {mapPickerInstruction}
                    </Text>
                    <View style={styles.mapPickerAddressRow}>
                        {mapPickerResolving ? (
                            <BrandedLoader
                                size="button"
                                variant="route"
                                accessibilityLabel="선택한 위치의 주소를 확인하고 있어요"
                            />
                        ) : (
                            <Ionicons name="location" size={17} color={routeUi.accentBlue} />
                        )}
                        <Text
                            numberOfLines={2}
                            accessibilityLiveRegion="polite"
                            style={[styles.mapPickerAddressText, { color: routeUi.textSecondary }]}
                        >
                            {mapPickerSelectionLabel}
                        </Text>
                    </View>
                    <MapPickerTargetActions
                        disabled={!mapPickerCoord || !mapPickerHasSelection || mapPickerResolving}
                        onConfirm={confirmMapPickerSelection}
                        colors={{
                            surface2: routeUi.surface2,
                            border: routeUi.border,
                            textPrimary: routeUi.textPrimary,
                            textDisabled: routeUi.textDisabled,
                            accentGreen: routeUi.accentGreen,
                            accentRed: routeUi.accentRed,
                        }}
                    />
                </CalendarGlassSurface>
            </View>
        </Modal>
    );

}

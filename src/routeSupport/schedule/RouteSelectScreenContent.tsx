import React, { useCallback, useRef } from "react";
import { AccessibilityInfo, Platform, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { RouteSelectFavoriteSaveSheet } from "./RouteSelectFavoriteSaveSheet";
import { RouteSelectMapPickerSheet } from "./RouteSelectMapPickerSheet";
import { RouteSelectResultsScreen } from "./RouteSelectResultsScreen";
import { RouteSelectSearchScreen } from "./RouteSelectSearchScreen";
import type { RoutePointTarget } from "../../modules/schedule/routePointSelection";
import type { RouteSelectController } from "./useRouteSelectController";
import { Ionicons } from "./RouteSelectAnimatedControls";
import styles from "./route-select.styles";

const favoriteNoticeEntry = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const favoriteNoticeExit = FadeOut.duration(140).reduceMotion(ReduceMotion.System);

type RouteSelectScreenContentProps = {
    controller: RouteSelectController;
};

/**
 * 검색 화면과 경로 결과 화면을 전환하고 두 화면에서 공유하는 즐겨찾기·지도 모달을 한 번만 마운트한다.
 */
export function RouteSelectScreenContent({
    controller,
}: RouteSelectScreenContentProps) {
    const { favoriteSaveNotice, insets, routeUi } = controller;
    const mapButton = useRef<View>(null);
    const pointEdit = useRef<{
        origin: RouteSelectController["origin"];
        destination: RouteSelectController["destination"];
        target: RoutePointTarget;
        scrollY: number;
    } | undefined>(undefined);
    const openPointEditor = (target: RoutePointTarget, scrollY: number) => {
        pointEdit.current = { origin: controller.origin, destination: controller.destination, target, scrollY };
        controller.openRoutePointEditor(target);
    };
    const snapshot = pointEdit.current;
    const pointEditReturn = snapshot && snapshot.origin === controller.origin && snapshot.destination === controller.destination
        ? snapshot : undefined;
    const restoreMapButtonFocus = useCallback(() => {
        if (mapButton.current) AccessibilityInfo.sendAccessibilityEvent?.(mapButton.current, "focus");
    }, []);
    return (
        <>
            {controller.isEditingRoutePoint ? (
                <RouteSelectSearchScreen controller={controller} mapButton={mapButton} />
            ) : (
                <RouteSelectResultsScreen
                    controller={controller}
                    onEditPoint={openPointEditor}
                    pointEditReturn={pointEditReturn}
                />
            )}
            {favoriteSaveNotice && (
                <Animated.View
                    entering={favoriteNoticeEntry}
                    exiting={favoriteNoticeExit}
                    pointerEvents="none"
                    accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}
                    style={[styles.favoriteSaveNotice, {
                        bottom: Math.max(insets.bottom, 16) + 12,
                        backgroundColor: routeUi.surface,
                        borderColor: routeUi.borderStrong,
                    }]}
                >
                    <Ionicons name="checkmark-circle-outline" size={20} color={routeUi.accentBlue} />
                    <Text maxFontSizeMultiplier={2} style={[styles.favoriteSaveNoticeText, { color: routeUi.textPrimary }]}>
                        {favoriteSaveNotice.message}
                    </Text>
                </Animated.View>
            )}
            <RouteSelectFavoriteSaveSheet controller={controller} />
            <RouteSelectMapPickerSheet controller={controller} onCancelDismissed={restoreMapButtonFocus} />
        </>
    );
}

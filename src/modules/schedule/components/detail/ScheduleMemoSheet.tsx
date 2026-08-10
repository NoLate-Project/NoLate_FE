import React from "react";
import {
    Animated,
    Easing,
    Modal,
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";

import { useTheme } from "../../../theme/ThemeContext";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    visible: boolean;
    title: string;
    notes: string;
    bottomInset: number;
    onEdit?: () => void;
    onClose: () => void;
};

export function shouldDismissScheduleMemoSheet(distance: number, velocity: number): boolean {
    return distance >= 64 || velocity >= 0.75;
}

/**
 * 경로 상세 시트와 독립적으로 여는 일정 메모 시트다.
 * 긴 예약 정보와 연락처를 확인·선택하고, 권한이 있으면 수정 화면으로 이동할 수 있다.
 */
export default function ScheduleMemoSheet({
    visible,
    title,
    notes,
    bottomInset,
    onEdit,
    onClose,
}: Props) {
    const { mode } = useTheme();
    const reduceMotionEnabled = useReducedMotion();
    const memo = notes.trim();
    const sheetBackground = mode === "dark" ? "#171A20" : "#FFFFFF";
    const primaryText = mode === "dark" ? "#F3F4F6" : "#111827";
    const secondaryText = mode === "dark" ? "#A7ABB3" : "#64748B";
    const sheetBorder = mode === "dark"
        ? "rgba(255,255,255,0.13)"
        : "rgba(15,23,42,0.10)";
    const controlPressedBackground = mode === "dark"
        ? "rgba(255,255,255,0.07)"
        : "rgba(15,23,42,0.05)";
    const handleColor = mode === "dark"
        ? "rgba(255,255,255,0.18)"
        : "rgba(15,23,42,0.16)";
    const accent = mode === "dark" ? "#78B4FF" : "#2979FF";
    const dismissTranslateY = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        if (!visible) dismissTranslateY.setValue(0);
    }, [dismissTranslateY, visible]);

    const restoreSheetPosition = React.useCallback(() => {
        if (reduceMotionEnabled) {
            dismissTranslateY.setValue(0);
            return;
        }
        Animated.spring(dismissTranslateY, {
            toValue: 0,
            damping: 24,
            stiffness: 260,
            mass: 0.8,
            useNativeDriver: true,
        }).start();
    }, [dismissTranslateY, reduceMotionEnabled]);

    const finishHandleGesture = React.useCallback((distance: number, velocity: number) => {
        if (!shouldDismissScheduleMemoSheet(distance, velocity)) {
            restoreSheetPosition();
            return;
        }
        if (reduceMotionEnabled) {
            onClose();
            return;
        }
        Animated.timing(dismissTranslateY, {
            toValue: 420,
            duration: 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) onClose();
        });
    }, [dismissTranslateY, onClose, reduceMotionEnabled, restoreSheetPosition]);

    const handlePanResponder = React.useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => (
            gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
        ),
        onPanResponderMove: (_event, gesture) => {
            dismissTranslateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
            finishHandleGesture(Math.max(0, gesture.dy), Math.max(0, gesture.vy));
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: restoreSheetPosition,
    }), [dismissTranslateY, finishHandleGesture, restoreSheetPosition]);

    return (
        <Modal
            visible={visible}
            animationType={reduceMotionEnabled ? "none" : "slide"}
            transparent
            statusBarTranslucent
            navigationBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View
                testID="schedule-memo-sheet"
                accessibilityViewIsModal
                style={styles.backdrop}
            >
                <Pressable
                    testID="schedule-memo-backdrop"
                    accessible={false}
                    importantForAccessibility="no"
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />

                <Animated.View
                    testID="schedule-memo-panel"
                    style={[
                        styles.sheet,
                        mode === "dark" ? styles.sheetShadowDark : styles.sheetShadowLight,
                        {
                            backgroundColor: sheetBackground,
                            borderColor: sheetBorder,
                            paddingBottom: Math.max(bottomInset, 14) + 10,
                            transform: [{ translateY: dismissTranslateY }],
                        },
                    ]}
                >
                    <View
                        testID="schedule-memo-handle"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={styles.handleRow}
                        {...handlePanResponder.panHandlers}
                    >
                        <View style={[styles.handle, { backgroundColor: handleColor }]} />
                    </View>

                    <View style={[styles.header, { borderBottomColor: sheetBorder }]}>
                        <View style={styles.headerTopRow}>
                            <Text
                                accessibilityRole="header"
                                style={[styles.headerTitle, { color: primaryText }]}
                            >
                                메모
                            </Text>
                            <View style={styles.headerActions}>
                                {onEdit ? (
                                    <Pressable
                                        testID="schedule-memo-edit"
                                        accessibilityRole="button"
                                        accessibilityLabel="메모 수정"
                                        accessibilityHint="일정 수정 화면을 엽니다"
                                        onPress={onEdit}
                                        hitSlop={4}
                                        style={({ pressed }) => [
                                            styles.editButton,
                                            {
                                                backgroundColor: pressed
                                                    ? controlPressedBackground
                                                    : "transparent",
                                                opacity: pressed ? 0.64 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons name="create-outline" size={16} color={accent} />
                                        <Text style={[styles.editButtonText, { color: accent }]}>수정</Text>
                                    </Pressable>
                                ) : null}
                                <Pressable
                                    testID="schedule-memo-close"
                                    accessibilityRole="button"
                                    accessibilityLabel="메모 닫기"
                                    accessibilityHint="메모 시트를 닫습니다"
                                    onPress={onClose}
                                    hitSlop={4}
                                    style={({ pressed }) => [
                                        styles.closeButton,
                                        {
                                            backgroundColor: pressed
                                                ? controlPressedBackground
                                                : "transparent",
                                            opacity: pressed ? 0.64 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons name="chevron-down" size={19} color={secondaryText} />
                                </Pressable>
                            </View>
                        </View>
                        <Text
                            accessibilityLabel={`일정 ${title}`}
                            numberOfLines={1}
                            style={[styles.scheduleTitle, { color: secondaryText }]}
                        >
                            {title}
                        </Text>
                    </View>

                    <ScrollView
                        testID="schedule-memo-scroll"
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                    >
                        <Text
                            testID="schedule-memo-text"
                            selectable
                            style={[
                                styles.memo,
                                { color: memo ? primaryText : secondaryText },
                            ]}
                        >
                            {memo || "등록된 메모가 없어요."}
                        </Text>
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "transparent",
    },
    sheet: {
        minHeight: 218,
        maxHeight: "68%",
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderCurve: "continuous",
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        shadowColor: "#000000",
        elevation: 18,
    },
    sheetShadowLight: {
        shadowOpacity: 0.14,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: -6 },
    },
    sheetShadowDark: {
        shadowOpacity: 0.32,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: -5 },
    },
    handleRow: {
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    header: {
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerTopRow: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        lineHeight: 23,
        fontWeight: "800",
        letterSpacing: -0.2,
    },
    scheduleTitle: {
        marginTop: 1,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
        letterSpacing: 0,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    editButton: {
        minWidth: 60,
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    editButtonText: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
        letterSpacing: 0,
    },
    closeButton: {
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    scroll: {
        flexShrink: 1,
    },
    scrollContent: {
        paddingTop: 16,
        paddingBottom: 8,
    },
    memo: {
        fontSize: 15,
        lineHeight: 24,
        fontWeight: "500",
        letterSpacing: -0.1,
    },
});

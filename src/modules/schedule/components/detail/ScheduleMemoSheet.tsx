import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

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
    const { colors, mode } = useTheme();
    const memo = notes.trim();
    const sheetBackground = mode === "dark" ? "#171A20" : "#F8FAFC";
    const iconBackground = mode === "dark"
        ? "rgba(75,157,255,0.16)"
        : "rgba(41,121,255,0.10)";
    const accent = mode === "dark" ? "#78B4FF" : "#2979FF";

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent
            statusBarTranslucent
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View testID="schedule-memo-sheet" style={styles.backdrop}>
                <Pressable
                    testID="schedule-memo-backdrop"
                    accessibilityRole="button"
                    accessibilityLabel="일정 메모 닫기"
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />

                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: sheetBackground,
                            borderColor: colors.border,
                            paddingBottom: Math.max(bottomInset, 14) + 8,
                        },
                    ]}
                >
                    <View style={styles.handleRow}>
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    </View>

                    <View style={styles.header}>
                        <View style={[styles.icon, { backgroundColor: iconBackground }]}>
                            <Ionicons name="document-text-outline" size={20} color={accent} />
                        </View>
                        <View style={styles.headerCopy}>
                            <Text style={[styles.eyebrow, { color: accent }]}>일정 메모</Text>
                            <Text
                                accessibilityLabel={`메모 일정 ${title}`}
                                numberOfLines={1}
                                style={[styles.title, { color: colors.textPrimary }]}
                            >
                                {title}
                            </Text>
                        </View>
                        <View style={styles.headerActions}>
                            {onEdit ? (
                                <Pressable
                                    testID="schedule-memo-edit"
                                    accessibilityRole="button"
                                    accessibilityLabel="일정 메모 수정"
                                    accessibilityHint="일정 수정 화면을 엽니다"
                                    onPress={onEdit}
                                    style={({ pressed }) => [
                                        styles.editButton,
                                        {
                                            backgroundColor: iconBackground,
                                            opacity: pressed ? 0.62 : 1,
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
                                accessibilityLabel="일정 메모 닫기"
                                onPress={onClose}
                                style={({ pressed }) => [
                                    styles.closeButton,
                                    {
                                        backgroundColor: colors.surface2,
                                        opacity: pressed ? 0.62 : 1,
                                    },
                                ]}
                            >
                                <Ionicons name="close" size={20} color={colors.textPrimary} />
                            </Pressable>
                        </View>
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
                                { color: memo ? colors.textPrimary : colors.textSecondary },
                            ]}
                        >
                            {memo || "등록된 메모가 없어요."}
                        </Text>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.42)",
    },
    sheet: {
        minHeight: 240,
        maxHeight: "72%",
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        shadowColor: "#000000",
        shadowOpacity: 0.2,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -10 },
        elevation: 24,
        overflow: "hidden",
    },
    handleRow: {
        height: 30,
        alignItems: "center",
        justifyContent: "center",
    },
    handle: {
        width: 38,
        height: 4,
        borderRadius: 2,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
        paddingBottom: 14,
    },
    icon: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    headerCopy: {
        flex: 1,
        minWidth: 0,
    },
    eyebrow: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    title: {
        marginTop: 2,
        fontSize: 16,
        lineHeight: 21,
        fontWeight: "900",
        letterSpacing: 0,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    editButton: {
        height: 40,
        borderRadius: 20,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    editButtonText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    closeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    scroll: {
        flexShrink: 1,
    },
    scrollContent: {
        paddingTop: 4,
        paddingBottom: 12,
    },
    memo: {
        fontSize: 15,
        lineHeight: 23,
        fontWeight: "600",
        letterSpacing: 0,
    },
});

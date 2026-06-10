import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { useTheme } from "../../../theme/ThemeContext";

type Props = {
    visible: boolean;
    onClose: () => void;
    onParse: (text: string) => void | Promise<void>;
};

export default function QuickScheduleModal({ visible, onClose, onParse }: Props) {
    const { colors, mode } = useTheme();
    const [text, setText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const scale = useRef(new Animated.Value(0.96)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) {
            setText("");
            setSubmitting(false);
            return;
        }

        scale.setValue(0.96);
        opacity.setValue(0);
        Animated.parallel([
            Animated.spring(scale, {
                toValue: 1,
                damping: 18,
                stiffness: 220,
                mass: 0.8,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
            }),
        ]).start();
    }, [opacity, scale, visible]);

    const submit = async () => {
        const normalized = text.trim();
        if (!normalized || submitting) return;

        try {
            setSubmitting(true);
            await onParse(normalized);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.screen}
            >
                <Pressable style={styles.backdrop} onPress={submitting ? undefined : onClose} />

                <Animated.View
                    style={[
                        styles.card,
                        {
                            backgroundColor: mode === "dark" ? "#3a3a3c" : colors.surface,
                            borderColor: mode === "dark" ? "#6b6b6e" : colors.border,
                            opacity,
                            transform: [{ scale }],
                        },
                    ]}
                >
                    <View
                        style={[
                            styles.pointer,
                            {
                                backgroundColor: mode === "dark" ? "#3a3a3c" : colors.surface,
                                borderColor: mode === "dark" ? "#6b6b6e" : colors.border,
                            },
                        ]}
                    />

                    <View style={styles.header}>
                        <View style={[styles.iconCircle, { backgroundColor: mode === "dark" ? "#606063" : colors.surface2 }]}>
                            <Ionicons name="calendar-outline" size={24} color={colors.textPrimary} />
                            <View style={[styles.plusBadge, { backgroundColor: colors.selectedDayBg }]}>
                                <Ionicons name="add" size={10} color={colors.selectedDayText} />
                            </View>
                        </View>
                        <View style={styles.headerCopy}>
                            <Text style={[styles.title, { color: colors.textPrimary }]}>간편 일정 등록</Text>
                            <Text style={[styles.description, { color: colors.textSecondary }]}>
                                날짜, 시간, 장소를 한 문장으로 입력하세요
                            </Text>
                        </View>
                        <Pressable
                            accessibilityLabel="간편 일정 등록 닫기"
                            disabled={submitting}
                            onPress={onClose}
                            style={styles.closeButton}
                        >
                            <Ionicons name="close" size={20} color={colors.textSecondary} />
                        </Pressable>
                    </View>

                    <View style={[styles.divider, { backgroundColor: colors.border }]} />

                    <Text style={[styles.label, { color: colors.textSecondary }]}>빠른 이벤트 생성</Text>
                    <TextInput
                        autoFocus
                        editable={!submitting}
                        multiline
                        value={text}
                        onChangeText={setText}
                        onSubmitEditing={submit}
                        placeholder="예) 금요일 오후 7시 강남역에서 친구와 저녁"
                        placeholderTextColor={colors.textSecondary}
                        returnKeyType="done"
                        style={[
                            styles.input,
                            {
                                backgroundColor: mode === "dark" ? "#202022" : colors.surface2,
                                borderColor: colors.border,
                                color: colors.textPrimary,
                            },
                        ]}
                    />

                    <View style={styles.footer}>
                        <Text style={[styles.hint, { color: colors.textSecondary }]}>
                            분석 후 등록 화면에서 내용을 확인할 수 있어요
                        </Text>
                        <Pressable
                            disabled={!text.trim() || submitting}
                            onPress={submit}
                            style={({ pressed }) => [
                                styles.submitButton,
                                {
                                    backgroundColor: colors.selectedDayBg,
                                    opacity: !text.trim() || submitting ? 0.45 : pressed ? 0.75 : 1,
                                },
                            ]}
                        >
                            {submitting ? (
                                <ActivityIndicator size="small" color={colors.selectedDayText} />
                            ) : (
                                <>
                                    <Text style={[styles.submitText, { color: colors.selectedDayText }]}>분석하기</Text>
                                    <Ionicons name="arrow-forward" size={15} color={colors.selectedDayText} />
                                </>
                            )}
                        </Pressable>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: Platform.OS === "ios" ? 96 : 72,
        paddingHorizontal: 18,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.46)",
    },
    card: {
        width: "100%",
        maxWidth: 430,
        borderRadius: 26,
        borderWidth: 1,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 18,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.32,
        shadowRadius: 28,
        elevation: 24,
    },
    pointer: {
        position: "absolute",
        top: -10,
        left: "50%",
        width: 20,
        height: 20,
        borderLeftWidth: 1,
        borderTopWidth: 1,
        transform: [{ translateX: -10 }, { rotate: "45deg" }],
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
    },
    iconCircle: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: "center",
        justifyContent: "center",
    },
    plusBadge: {
        position: "absolute",
        right: 5,
        bottom: 5,
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    headerCopy: {
        flex: 1,
        marginLeft: 14,
    },
    title: {
        fontSize: 19,
        fontWeight: "800",
    },
    description: {
        fontSize: 12,
        lineHeight: 17,
        marginTop: 3,
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginTop: 18,
        marginBottom: 18,
    },
    label: {
        fontSize: 14,
        fontWeight: "700",
        marginBottom: 8,
    },
    input: {
        minHeight: 88,
        maxHeight: 150,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 13,
        fontSize: 16,
        lineHeight: 23,
        textAlignVertical: "top",
    },
    footer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 14,
    },
    hint: {
        flex: 1,
        fontSize: 11,
        lineHeight: 16,
    },
    submitButton: {
        minWidth: 104,
        height: 42,
        borderRadius: 21,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    submitText: {
        fontSize: 13,
        fontWeight: "800",
    },
});

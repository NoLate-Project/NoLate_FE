import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
    AccessibilityInfo, ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal,
    Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Reanimated, { Easing as ReanimatedEasing, FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSystemReduceMotion } from "../modules/performance/useSystemReduceMotion";
import { useTheme } from "../modules/theme/ThemeContext";
import {
    PROFILE_PASSWORD_RULE, type ProfileAccountAction, type ProfileAccountError, type ProfilePasswordField,
} from "./useProfileScreen";

const titles = { password: "비밀번호 변경", logout: "로그아웃할까요?", withdraw: "회원탈퇴" };
const fields = [
    { key: "currentPassword", label: "현재 비밀번호", autofill: "current-password" },
    { key: "newPassword", label: "새 비밀번호", autofill: "new-password" },
    { key: "confirmPassword", label: "새 비밀번호 확인", autofill: "new-password" },
] as const;
const errorEntrance = FadeInDown.duration(160).easing(ReanimatedEasing.out(ReanimatedEasing.cubic)).withInitialValues({
    opacity: 0.55,
    transform: [{ translateY: -3 }],
}).reduceMotion(ReduceMotion.System);

export default function ProfileAccountSheet({
    action, passwords, error, busy, withdrawalNeedsPassword, withdrawalCommitted,
    onChangeField, onClose, onDismiss, onConfirm,
}: {
    action?: ProfileAccountAction;
    passwords: Record<ProfilePasswordField, string>;
    error?: ProfileAccountError;
    busy: boolean;
    withdrawalNeedsPassword: boolean;
    withdrawalCommitted: boolean;
    onChangeField: (field: ProfilePasswordField, value: string) => void;
    onClose: () => void;
    onDismiss: () => void;
    onConfirm: () => void;
}) {
    const { colors, mode } = useTheme();
    const { bottom } = useSafeAreaInsets();
    const reduceMotion = useSystemReduceMotion();
    const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
    const titleRef = useRef<Text>(null);
    const inputRefs = useRef<Partial<Record<ProfilePasswordField, TextInput | null>>>({});
    const bodyScroll = useRef<ScrollView>(null);
    const dark = mode === "dark";
    const neutral = dark ? colors.surface2 : "#F1F4F8";
    const errorColor = dark ? "#FF9C96" : "#B42318";
    const isWithdrawal = action === "withdraw";
    const canClose = !busy && !withdrawalCommitted;
    const visibleFields = action === "password" ? fields
        : isWithdrawal && withdrawalNeedsPassword && !withdrawalCommitted ? fields.slice(0, 1) : [];
    const disabled = busy || visibleFields.some(field => !passwords[field.key]);
    const confirmationLabel = action === "password" ? "변경하기"
        : action === "logout" ? "로그아웃"
        : withdrawalCommitted ? "로그아웃 다시 시도"
        : withdrawalNeedsPassword ? "확인하고 탈퇴하기" : "탈퇴하기";
    const summary = action === "logout"
        ? "이 기기에서 로그아웃합니다.\n다시 로그인하면 저장된 일정을 확인할 수 있어요."
        : isWithdrawal && !withdrawalCommitted
            ? "NoLate 계정과 저장된 일정이 삭제됩니다.\n탈퇴를 되돌릴 수 없어요."
            : undefined;

    useEffect(() => {
        if (!error || busy) return;
        const frame = requestAnimationFrame(() => {
            if (error.field) inputRefs.current[error.field]?.focus();
            else bodyScroll.current?.scrollToEnd({ animated: !reduceMotion });
            AccessibilityInfo.announceForAccessibility(error.message);
        });
        return () => cancelAnimationFrame(frame);
    }, [busy, error, reduceMotion]);

    useEffect(() => {
        if (reduceMotion) {
            progress.stopAnimation();
            progress.setValue(1);
        }
        return () => progress.stopAnimation();
    }, [progress, reduceMotion]);

    function showSheet() {
        progress.setValue(reduceMotion ? 1 : 0);
        if (!reduceMotion) {
            Animated.timing(progress, {
                toValue: 1,
                duration: 240,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        }
        if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent?.(titleRef.current, "focus");
    }

    function renderError(message: string) {
        return (
            <Reanimated.Text
                key={message}
                entering={reduceMotion ? undefined : errorEntrance}
                style={[styles.helper, { color: errorColor }]}
            >
                {message}
            </Reanimated.Text>
        );
    }

    return (
        <Modal
            visible={action !== undefined}
            transparent
            animationType="none"
            onRequestClose={onClose}
            onShow={showSheet}
            onDismiss={onDismiss}
            statusBarTranslucent
        >
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.root}>
                <Animated.View pointerEvents={canClose ? "auto" : "none"} style={[StyleSheet.absoluteFill, { opacity: progress }]}>
                    <Pressable importantForAccessibility="no" accessibilityElementsHidden onPress={onClose} style={styles.backdrop} />
                </Animated.View>
                <Animated.View
                    accessibilityViewIsModal
                    onAccessibilityEscape={onClose}
                    style={[
                        styles.sheet,
                        { backgroundColor: colors.surface, paddingBottom: Math.max(bottom, 12) },
                        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] },
                    ]}
                >
                    <View style={[styles.header, { borderColor: colors.border }]}>
                        <Text ref={titleRef} accessible accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
                            {action && titles[action]}
                        </Text>
                        {canClose && (
                            <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose}
                                style={({ pressed }) => [styles.closeButton, { backgroundColor: neutral, opacity: pressed ? 0.65 : 1 }]}>
                                <Ionicons name="close-outline" size={22} color={colors.textSecondary} />
                            </Pressable>
                        )}
                    </View>
                    <ScrollView ref={bodyScroll} bounces={false} keyboardShouldPersistTaps="handled"
                        style={styles.body} contentContainerStyle={styles.bodyContent}>
                        {!!summary && (
                            <Text style={[styles.summary, { color: colors.textPrimary }, isWithdrawal && { backgroundColor: neutral }]}>
                                {summary}
                            </Text>
                        )}
                        {visibleFields.map(field => {
                            const fieldError = error?.field === field.key ? error.message : undefined;
                            const hasHint = field.key === "newPassword" && fieldError !== PROFILE_PASSWORD_RULE;
                            return (
                                <View key={field.key} style={styles.field}>
                                    <Text style={[styles.label, { color: colors.textPrimary }]}>{field.label}</Text>
                                    <TextInput
                                        ref={input => { inputRefs.current[field.key] = input; }}
                                        accessibilityLabel={field.label}
                                        accessibilityHint={[hasHint ? PROFILE_PASSWORD_RULE : undefined, fieldError].filter(Boolean).join(" ") || undefined}
                                        autoCapitalize="none"
                                        autoComplete={field.autofill}
                                        autoCorrect={false}
                                        editable={!busy}
                                        onChangeText={value => onChangeField(field.key, value)}
                                        secureTextEntry
                                        value={passwords[field.key]}
                                        style={[styles.input, { borderColor: fieldError ? errorColor : colors.border, color: colors.textPrimary }]}
                                    />
                                    {hasHint && <Text style={[styles.helper, { color: colors.textSecondary }]}>{PROFILE_PASSWORD_RULE}</Text>}
                                    {!!fieldError && renderError(fieldError)}
                                </View>
                            );
                        })}
                        {error && !error.field && renderError(error.message)}
                    </ScrollView>
                    <View style={[styles.actions, { borderColor: colors.border }]}>
                        {!withdrawalCommitted && (
                            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
                                onPress={onClose} style={({ pressed }) => [styles.button, styles.cancel, { backgroundColor: neutral, opacity: pressed ? 0.65 : 1 }]}>
                                <Text style={[styles.buttonText, { color: colors.textPrimary }]}>취소</Text>
                            </Pressable>
                        )}
                        <Pressable accessibilityRole="button" accessibilityLabel={confirmationLabel}
                            accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onConfirm}
                            style={({ pressed }) => [styles.button, styles.confirm, {
                                backgroundColor: disabled && !busy ? neutral : isWithdrawal && !withdrawalCommitted ? "#B42318" : "#205BD0",
                                opacity: pressed ? 0.75 : 1,
                            }]}>
                            {busy ? <ActivityIndicator color="#fff" /> : (
                                <Text style={[styles.buttonText, { color: disabled ? colors.textSecondary : "#fff" }]}>{confirmationLabel}</Text>
                            )}
                        </Pressable>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.36)" },
    sheet: { maxHeight: "94%", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
    header: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    title: { flex: 1, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
    closeButton: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    body: { flexGrow: 0, flexShrink: 1 },
    bodyContent: { padding: 16, gap: 12 },
    summary: { borderRadius: 12, padding: 12, fontSize: 14, fontWeight: "500" },
    field: { gap: 5 },
    label: { fontSize: 14, fontWeight: "700" },
    input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
    helper: { fontSize: 13, fontWeight: "500" },
    actions: { flexDirection: "row", gap: 8, paddingTop: 10, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
    button: { minHeight: 48, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    cancel: { flex: 2 },
    confirm: { flex: 4 },
    buttonText: { fontSize: 15, fontWeight: "800", textAlign: "center" },
});

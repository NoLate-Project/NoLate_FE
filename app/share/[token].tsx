import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { acceptShareInvitation, type ScheduleShareInvitationAcceptResult } from "../../src/api/scheduleSharing";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { useTheme } from "../../src/modules/theme/ThemeContext";

function getErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "초대 수락에 실패했습니다.";

    if (/403|forbidden|status code/i.test(message)) {
        return "이 초대 링크를 수락할 수 없어요.";
    }

    if (/network|timeout/i.test(message)) {
        return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    }

    return message;
}

export default function ShareInvitationAcceptScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { token } = useLocalSearchParams<{ token?: string | string[] }>();
    const { isAuthenticated, isLoading } = useAuth();
    const { colors, mode } = useTheme();
    const [accepting, setAccepting] = useState(false);
    const [accepted, setAccepted] = useState<ScheduleShareInvitationAcceptResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const invitationToken = Array.isArray(token) ? token[0] : token;
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";

    const resourceLabel = useMemo(() => {
        const type = accepted?.invitation.resourceType;
        if (type === "SCHEDULE") return "일정";
        if (type === "CATEGORY") return "캘린더 카테고리";
        return "일정 또는 캘린더";
    }, [accepted]);

    const acceptInvitation = useCallback(async () => {
        if (!invitationToken || accepting) return;

        setAccepting(true);
        setError(null);
        try {
            const result = await acceptShareInvitation(invitationToken);
            setAccepted(result);
        } catch (acceptError) {
            setError(getErrorMessage(acceptError));
        } finally {
            setAccepting(false);
        }
    }, [accepting, invitationToken]);

    const openAcceptedResource = useCallback(() => {
        const resource = accepted?.invitation;
        if (!resource) {
            router.replace("/schedule");
            return;
        }

        if (resource.resourceType === "SCHEDULE") {
            router.replace({
                pathname: "/schedule/[id]",
                params: { id: resource.resourceId },
            });
            return;
        }

        router.replace("/schedule");
    }, [accepted, router]);

    return (
        <View
            style={[
                styles.root,
                {
                    backgroundColor: colors.background,
                    paddingTop: insets.top + 18,
                    paddingBottom: Math.max(insets.bottom, 18),
                },
            ]}
        >
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.replace("/schedule")}
                    accessibilityLabel="캘린더로 돌아가기"
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
                </Pressable>
            </View>

            <View style={styles.body}>
                <View style={[styles.iconCircle, { backgroundColor: `${accent}1F` }]}>
                    <Ionicons name={accepted ? "checkmark" : "link-outline"} size={34} color={accent} />
                </View>

                <Text style={[styles.title, { color: colors.textPrimary }]}>
                    {accepted ? `${resourceLabel} 공유가 연결됐어요` : "공유 초대 링크"}
                </Text>
                <Text style={[styles.description, { color: colors.textSecondary }]}>
                    {accepted
                        ? "이제 내 캘린더에서 공유된 내용을 확인할 수 있어요."
                        : "로그인한 계정에 이 링크의 공유 권한을 연결합니다."}
                </Text>

                {!!invitationToken && !accepted && (
                    <View style={[styles.tokenPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.tokenLabel, { color: colors.textSecondary }]}>초대 토큰</Text>
                        <Text style={[styles.tokenValue, { color: colors.textPrimary }]} numberOfLines={1}>
                            {invitationToken}
                        </Text>
                    </View>
                )}

                {!!error && (
                    <View style={[styles.errorBox, { borderColor: colors.border }]}>
                        <Ionicons name="alert-circle-outline" size={19} color={mode === "dark" ? "#FF8A8A" : "#D70015"} />
                        <Text style={[styles.errorText, { color: colors.textPrimary }]}>{error}</Text>
                    </View>
                )}
            </View>

            <View style={styles.footer}>
                {isLoading ? (
                    <View style={[styles.primaryButton, { backgroundColor: accent, opacity: 0.7 }]}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                ) : !isAuthenticated ? (
                    <Pressable
                        onPress={() => router.replace("/auth/login")}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: accent, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons name="log-in-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.primaryButtonText}>로그인하고 수락</Text>
                    </Pressable>
                ) : accepted ? (
                    <Pressable
                        onPress={openAcceptedResource}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: accent, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons name="calendar-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.primaryButtonText}>캘린더에서 보기</Text>
                    </Pressable>
                ) : (
                    <Pressable
                        disabled={!invitationToken || accepting}
                        onPress={acceptInvitation}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            {
                                backgroundColor: accent,
                                opacity: !invitationToken || accepting ? 0.45 : pressed ? 0.78 : 1,
                            },
                        ]}
                    >
                        {accepting ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
                                <Text style={styles.primaryButtonText}>초대 수락</Text>
                            </>
                        )}
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        paddingHorizontal: 22,
    },
    header: {
        minHeight: 46,
        justifyContent: "center",
    },
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    body: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
    },
    iconCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 4,
    },
    title: {
        fontSize: 24,
        fontWeight: "900",
        textAlign: "center",
        letterSpacing: 0,
    },
    description: {
        maxWidth: 280,
        fontSize: 15,
        fontWeight: "600",
        textAlign: "center",
        lineHeight: 22,
        letterSpacing: 0,
    },
    tokenPreview: {
        width: "100%",
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        marginTop: 10,
        gap: 5,
    },
    tokenLabel: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    tokenValue: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    errorBox: {
        width: "100%",
        borderWidth: 1,
        borderRadius: 16,
        padding: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    errorText: {
        flex: 1,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        letterSpacing: 0,
    },
    footer: {
        gap: 10,
    },
    primaryButton: {
        height: 52,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    primaryButtonText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
});

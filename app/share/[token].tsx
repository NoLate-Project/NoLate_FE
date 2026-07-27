import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { acceptShareInvitation, type ScheduleShareInvitationAcceptResult } from "../../src/api/scheduleSharing";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { getPostAuthRoute } from "../../src/modules/onboarding/curationRouting";
import { createLatestAsyncRequestGuard } from "../../src/modules/share/latestAsyncRequest";
import {
    isScheduleSharingEnabled,
} from "../../src/modules/share/scheduleSharingPolicy";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";

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

function normalizeInvitationToken(value?: string): string | null {
    const normalized = value?.trim();
    return normalized && /^[A-Za-z0-9_-]{16,512}$/.test(normalized) ? normalized : null;
}

export default function ShareInvitationAcceptScreen() {
    if (!isScheduleSharingEnabled()) return null;
    return <EnabledShareInvitationAcceptScreen />;
}

function EnabledShareInvitationAcceptScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { token, autoAccept } = useLocalSearchParams<{
        token?: string | string[];
        autoAccept?: string | string[];
    }>();
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();
    const { colors, mode } = useTheme();
    const [accepting, setAccepting] = useState(false);
    const [accepted, setAccepted] = useState<ScheduleShareInvitationAcceptResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const invitationToken = normalizeInvitationToken(Array.isArray(token) ? token[0] : token);
    const shouldAutoAccept = (Array.isArray(autoAccept) ? autoAccept[0] : autoAccept) === "1";
    const attemptedAutoAcceptRef = useRef(false);
    const acceptingRef = useRef(false);
    const requestGuardRef = useRef(createLatestAsyncRequestGuard<string | null>(invitationToken));
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";
    const authenticatedHomeRoute = getPostAuthRoute(isCurationCompleted);

    const returnFromInvitation = useCallback(() => {
        if (isLoading) return;
        if (isAuthenticated) {
            router.replace(authenticatedHomeRoute);
            return;
        }
        router.replace({
            pathname: "/auth/login",
            params: invitationToken ? { shareToken: invitationToken } : {},
        });
    }, [authenticatedHomeRoute, invitationToken, isAuthenticated, isLoading, router]);

    const resourceLabel = useMemo(() => {
        const type = accepted?.invitation.resourceType;
        if (type === "SCHEDULE") return "일정";
        if (type === "CALENDAR") return "공유 캘린더";
        if (type === "CATEGORY") return "캘린더 카테고리";
        return "일정 또는 캘린더";
    }, [accepted]);

    const acceptInvitation = useCallback(async () => {
        if (!invitationToken || acceptingRef.current) return;

        const ticket = requestGuardRef.current.begin(invitationToken);
        acceptingRef.current = true;
        setAccepting(true);
        setError(null);
        try {
            const result = await acceptShareInvitation(invitationToken);
            if (!requestGuardRef.current.isCurrent(ticket)) return;
            setAccepted(result);
        } catch (acceptError) {
            if (!requestGuardRef.current.isCurrent(ticket)) return;
            setError(getErrorMessage(acceptError));
        } finally {
            if (requestGuardRef.current.isCurrent(ticket)) {
                acceptingRef.current = false;
                setAccepting(false);
            }
        }
    }, [invitationToken]);

    useEffect(() => {
        const requestGuard = requestGuardRef.current;
        requestGuard.setKey(invitationToken);
        acceptingRef.current = false;
        attemptedAutoAcceptRef.current = false;
        setAccepting(false);
        setAccepted(null);
        setError(null);

        return () => {
            requestGuard.invalidate();
        };
    }, [invitationToken]);

    useEffect(() => {
        if (
            !shouldAutoAccept ||
            !isAuthenticated ||
            isLoading ||
            accepted ||
            error ||
            attemptedAutoAcceptRef.current
        ) return;

        attemptedAutoAcceptRef.current = true;
        acceptInvitation().catch(() => undefined);
    }, [acceptInvitation, accepted, error, isAuthenticated, isLoading, shouldAutoAccept]);

    const openAcceptedResource = useCallback(() => {
        if (!isCurationCompleted) {
            router.replace("/onboarding/calendar-import");
            return;
        }

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

        if (resource.resourceType === "CALENDAR") {
            router.replace("/schedule/calendars");
            return;
        }

        router.replace("/schedule/categories");
    }, [accepted, isCurationCompleted, router]);

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
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isLoading, busy: isLoading }}
                    disabled={isLoading}
                    onPress={returnFromInvitation}
                    accessibilityLabel={isLoading
                        ? "로그인 상태를 확인하고 있어요"
                        : isAuthenticated ? "캘린더로 돌아가기" : "로그인 화면으로 돌아가기"}
                    style={[
                        styles.headerButton,
                        isLoading && styles.headerButtonDisabled,
                        {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                        },
                    ]}
                >
                    <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
            >
                <View style={[styles.iconCircle, { backgroundColor: `${accent}1F` }]}>
                    <Ionicons name={accepted ? "checkmark" : "link-outline"} size={34} color={accent} />
                </View>

                <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.title, { color: colors.textPrimary }]}
                >
                    {accepted
                        ? `${resourceLabel} 공유가 연결됐어요`
                        : invitationToken
                            ? "공유 초대 링크"
                            : "유효하지 않은 초대 링크예요"}
                </Text>
                <Text style={[styles.description, { color: colors.textSecondary }]}>
                    {accepted
                        ? "이제 내 캘린더에서 공유된 내용을 확인할 수 있어요."
                        : invitationToken
                            ? "로그인한 계정에 이 링크의 공유 권한을 연결합니다."
                            : "초대 링크 전체를 다시 열어 주세요."}
                </Text>

                {!!invitationToken && !accepted && (
                    <View style={[styles.tokenPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Ionicons name="shield-checkmark-outline" size={19} color={accent} />
                        <Text style={[styles.tokenValue, { color: colors.textPrimary }]}>초대 링크가 준비됐어요</Text>
                    </View>
                )}

                {!!error && (
                    <View
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        style={[styles.errorBox, { borderColor: colors.border }]}
                    >
                        <Ionicons name="alert-circle-outline" size={19} color={mode === "dark" ? "#FF8A8A" : "#D70015"} />
                        <Text style={[styles.errorText, { color: colors.textPrimary }]}>{error}</Text>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {isLoading ? (
                    <View
                        style={[styles.primaryButton, styles.loadingPrimaryButton, { backgroundColor: accent }]}
                    >
                        <BrandedLoader
                            size="button"
                            variant="auth"
                            accessibilityLabel="로그인 상태를 확인하고 있어요"
                        />
                    </View>
                ) : !invitationToken ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={returnFromInvitation}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: accent, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons name="close-circle-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.primaryButtonText}>링크 닫기</Text>
                    </Pressable>
                ) : !isAuthenticated ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => router.replace({
                            pathname: "/auth/login",
                            params: invitationToken ? { shareToken: invitationToken } : {},
                        })}
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
                        accessibilityRole="button"
                        onPress={openAcceptedResource}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: accent, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons name="calendar-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.primaryButtonText}>
                            {isCurationCompleted ? "캘린더에서 보기" : "캘린더 설정 계속"}
                        </Text>
                    </Pressable>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={accepting ? "공유 초대 수락 중" : "공유 초대 수락"}
                        accessibilityState={{ disabled: !invitationToken || accepting, busy: accepting }}
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
                            <BrandedLoader
                                size="button"
                                variant="share"
                                accessibilityLabel="초대를 수락하고 있어요"
                            />
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
    headerButtonDisabled: {
        opacity: 0.45,
    },
    body: {
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        paddingVertical: 24,
    },
    bodyScroll: {
        flex: 1,
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
        gap: 9,
        flexDirection: "row",
        alignItems: "center",
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
    loadingPrimaryButton: {
        opacity: 0.7,
    },
});

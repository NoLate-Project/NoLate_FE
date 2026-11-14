import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import Animated, { Keyframe, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { acceptShareInvitation, getShareInbox, type ScheduleShareInvitationAcceptResult } from "../../src/api/scheduleSharing";
import { ApiResponseError } from "../../src/api/response";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { recoverDepartureAlarmsAfterMutation } from "../../src/modules/notification/departureAlarmMutationRecovery";
import { getPostAuthRoute } from "../../src/modules/onboarding/curationRouting";
import { createLatestAsyncRequestGuard } from "../../src/modules/share/latestAsyncRequest";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";

const acceptanceIn = new Keyframe({
    0: { opacity: 0, transform: [{ perspective: 180 }, { rotateX: "-28deg" }, { scale: 0.88 }] },
    100: { opacity: 1, transform: [{ perspective: 180 }, { rotateX: "0deg" }, { scale: 1 }] },
}).duration(240).reduceMotion(ReduceMotion.System);

function getInvitationError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (/만료|폐기된|수락 가능 횟수|이미 수락이 완료|expired|revoked/i.test(message)
        || (error instanceof ApiResponseError && ["S007", "S009"].includes(error.errorCode ?? ""))) {
        return { terminal: true, message: "보낸 사람에게 새 초대 링크를 요청해 주세요." };
    }
    if (/403|forbidden/i.test(message)) {
        return { terminal: false, message: "이 초대 링크를 수락할 수 없어요." };
    }
    if (/network|timeout/i.test(message)) {
        return { terminal: false, message: "네트워크 상태를 확인한 뒤 다시 시도해 주세요." };
    }
    return { terminal: false, message: message || "초대를 수락하지 못했어요. 다시 시도해 주세요." };
}

function normalizeInvitationToken(value?: string): string | null {
    const normalized = value?.trim();
    return normalized && /^[A-Za-z0-9_-]{16,512}$/.test(normalized) ? normalized : null;
}

function getAcceptedCalendarId(
    result: ScheduleShareInvitationAcceptResult,
): string | null {
    const membershipCalendarId = result.calendarMembership?.calendarId;
    if (
        Number.isSafeInteger(membershipCalendarId)
        && (membershipCalendarId ?? 0) > 0
    ) {
        return String(membershipCalendarId);
    }

    const resourceId = result.invitation.resourceId.trim();
    if (!/^[1-9]\d*$/.test(resourceId)) return null;

    const numericResourceId = Number(resourceId);
    return Number.isSafeInteger(numericResourceId)
        ? String(numericResourceId)
        : null;
}

export default function ShareInvitationAcceptScreen() {
    const { token, autoAccept } = useLocalSearchParams<{
        token?: string | string[];
        autoAccept?: string | string[];
    }>();
    const invitationToken = normalizeInvitationToken(Array.isArray(token) ? token[0] : token);
    const shouldAutoAccept = (Array.isArray(autoAccept) ? autoAccept[0] : autoAccept) === "1";
    return <ShareInvitationContent key={invitationToken} invitationToken={invitationToken} shouldAutoAccept={shouldAutoAccept} />;
}

function ShareInvitationContent({ invitationToken, shouldAutoAccept }: {
    invitationToken: string | null;
    shouldAutoAccept: boolean;
}) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();
    const { colors, mode } = useTheme();
    const [accepting, setAccepting] = useState(false);
    const [accepted, setAccepted] = useState<ScheduleShareInvitationAcceptResult | null>(null);
    const [acceptedTitle, setAcceptedTitle] = useState<string | null>(null);
    const [animateAcceptance, setAnimateAcceptance] = useState(false);
    const [error, setError] = useState<ReturnType<typeof getInvitationError> | null>(null);
    const attemptedAutoAcceptRef = useRef(false);
    const acceptingRef = useRef(false);
    const requestGuardRef = useRef(createLatestAsyncRequestGuard<string | null>(invitationToken));
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";
    const actionColor = mode === "dark" ? "#AACBFF" : "#205CC6";
    const actionInk = mode === "dark" ? "#102644" : "#FFFFFF";
    const canShowAccepted = isAuthenticated && !isLoading;
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

    const acceptedResource = canShowAccepted ? accepted : null;
    const isCalendar = acceptedResource?.invitation.resourceType === "CALENDAR";
    const resourceLabel = isCalendar ? "공유 캘린더"
        : acceptedResource?.invitation.resourceType === "CATEGORY" ? "캘린더 카테고리" : "일정";
    const role = acceptedResource?.calendarMembership?.role
        ?? acceptedResource?.share?.permission ?? acceptedResource?.invitation.permission;
    const editor = role === "EDITOR" || role === "OWNER";
    const shareScope = acceptedResource?.share?.contentMode ?? acceptedResource?.invitation.contentMode;
    const acceptedAction = !isCurationCompleted ? "캘린더 설정 계속"
        : isCalendar ? editor ? "캘린더 설정 열기" : "캘린더 정보 보기"
        : acceptedResource?.invitation.resourceType === "SCHEDULE" ? "일정 상세 보기" : "캘린더에서 보기";

    const acceptInvitation = useCallback(async () => {
        if (!invitationToken || !canShowAccepted || acceptingRef.current) return;

        const ticket = requestGuardRef.current.begin(invitationToken);
        acceptingRef.current = true;
        setAccepting(true);
        setError(null);
        const startedAt = Date.now();
        try {
            const result = await acceptShareInvitation(invitationToken);
            await recoverDepartureAlarmsAfterMutation();
            if (!requestGuardRef.current.isCurrent(ticket)) return;
            const acceptedAt = Date.parse(result.invitation.acceptedAt ?? "");
            setAnimateAcceptance(!Number.isFinite(acceptedAt) || (
                result.invitation.acceptedMemberId === result.share.targetMemberId && acceptedAt >= startedAt - 1_000
            ));
            setAccepted(result);
        } catch (acceptError) {
            if (!requestGuardRef.current.isCurrent(ticket)) return;
            setError(getInvitationError(acceptError));
        } finally {
            if (requestGuardRef.current.isCurrent(ticket)) {
                acceptingRef.current = false;
                setAccepting(false);
            }
        }
    }, [canShowAccepted, invitationToken]);

    useEffect(() => {
        const requestGuard = requestGuardRef.current;
        if (!isAuthenticated) {
            requestGuard.invalidate();
            attemptedAutoAcceptRef.current = false;
            acceptingRef.current = false;
            setAccepting(false);
            setAccepted(null);
            setAcceptedTitle(null);
            setError(null);
        }
        return () => requestGuard.invalidate();
    }, [isAuthenticated]);

    useEffect(() => {
        if (!acceptedResource) return;
        let active = true;
        const { resourceType, resourceId } = acceptedResource.invitation;
        const calendarId = isCalendar ? getAcceptedCalendarId(acceptedResource) : null;
        getShareInbox().then(inbox => {
            const item = inbox.receivedShares.find(share =>
                share.resourceType === resourceType && share.resourceId === (calendarId ?? resourceId)
            );
            if (active) setAcceptedTitle(item?.title?.trim() || null);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [acceptedResource, isCalendar]);

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
            const calendarId = getAcceptedCalendarId(accepted);
            router.replace(calendarId ? {
                pathname: "/schedule/calendars",
                params: editor ? { id: calendarId } : { id: calendarId, view: "calendar" },
            } : "/schedule/calendars");
            return;
        }

        router.replace("/schedule/categories");
    }, [accepted, editor, isCurationCompleted, router]);

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
                    <Ionicons name="chevron-back-outline" size={23} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View
                    key={acceptedResource ? "accepted" : "invitation"}
                    entering={acceptedResource && animateAcceptance ? acceptanceIn : undefined}
                    style={[styles.iconCircle, { backgroundColor: `${accent}1F` },
                        acceptedResource && [styles.confirmedIcon, { backgroundColor: actionColor }]]}
                >
                    <Ionicons accessible={false} name={acceptedResource ? "checkmark-outline" : error?.terminal ? "alert-circle-outline" : "link-outline"}
                        size={32} color={acceptedResource ? actionInk : accent} />
                </Animated.View>

                {acceptedResource && (
                    <Text style={[styles.completion, { color: mode === "dark" ? accent : actionColor }]}>
                        {resourceLabel} 연결 완료
                    </Text>
                )}
                <Text accessibilityRole="header" accessibilityLiveRegion="polite"
                    style={[styles.title, { color: colors.textPrimary }]}>
                    {acceptedResource ? acceptedTitle ?? resourceLabel
                        : error?.terminal ? "사용할 수 없는 초대 링크예요"
                        : invitationToken ? "공유 초대 링크" : "유효하지 않은 초대 링크예요"}
                </Text>

                {acceptedResource ? (
                    <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        {[
                            ["권한", editor ? "편집 가능" : "보기 전용"],
                            ["공유 범위", shareScope === "SCHEDULE_AND_TRAVEL" ? "일정 + 각자 경로"
                                : shareScope === "SCHEDULE_ONLY" ? "일정만" : null],
                        ].map(([label, value], index) => value && (
                            <View key={label} style={[styles.summaryRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}>
                                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{label}</Text>
                                <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>{value}</Text>
                            </View>
                        ))}
                    </View>
                ) : (
                    <Text style={[styles.description, { color: colors.textSecondary }]}>
                        {error?.terminal ? error.message : invitationToken
                            ? "초대를 수락하면 로그인한 계정에 공유 권한이 연결돼요."
                            : "초대 링크 전체를 다시 열어 주세요."}
                    </Text>
                )}

                {!!error && !error.terminal && (
                    <View accessibilityRole="alert" accessibilityLiveRegion="polite"
                        style={[styles.errorBox, { borderColor: colors.border }]}>
                        <Ionicons accessible={false} name="alert-circle-outline" size={19} color={mode === "dark" ? "#FF8A8A" : "#D70015"} />
                        <Text style={[styles.errorText, { color: colors.textPrimary }]}>{error.message}</Text>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {isLoading ? (
                    <View
                        style={[styles.primaryButton, styles.loadingPrimaryButton, { backgroundColor: actionColor }]}
                    >
                        <BrandedLoader
                            size="button"
                            variant="auth"
                            accessibilityLabel="로그인 상태를 확인하고 있어요"
                        />
                    </View>
                ) : !invitationToken || error?.terminal ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={returnFromInvitation}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: actionColor, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons name="close-circle-outline" size={20} color={actionInk} />
                        <Text style={[styles.primaryButtonText, { color: actionInk }]}>{error?.terminal && isAuthenticated ? "캘린더로 돌아가기" : "링크 닫기"}</Text>
                    </Pressable>
                ) : !isAuthenticated ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="로그인하고 수락"
                        onPress={() => router.replace({
                            pathname: "/auth/login",
                            params: invitationToken ? { shareToken: invitationToken } : {},
                        })}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: actionColor, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons accessible={false} importantForAccessibility="no" name="log-in-outline" size={20} color={actionInk} />
                        <Text style={[styles.primaryButtonText, { color: actionInk }]}>로그인하고 수락</Text>
                    </Pressable>
                ) : acceptedResource ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={acceptedAction}
                        onPress={openAcceptedResource}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: actionColor, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons accessible={false}
                            name={isCalendar && isCurationCompleted ? editor ? "settings-outline" : "information-circle-outline" : "calendar-outline"}
                            size={20} color={actionInk} />
                        <Text style={[styles.primaryButtonText, { color: actionInk }]}>
                            {acceptedAction}
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
                                backgroundColor: actionColor,
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
                                <Ionicons name="checkmark-circle-outline" size={20} color={actionInk} />
                                <Text style={[styles.primaryButtonText, { color: actionInk }]}>{error ? "다시 시도" : "초대 수락"}</Text>
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
        borderRadius: 22,
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
    confirmedIcon: {
        borderBottomWidth: 5,
        borderBottomColor: "#164586",
    },
    completion: {
        fontSize: 13,
        fontWeight: "700",
        textAlign: "center",
    },
    summaryCard: {
        width: "100%",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
    },
    summaryRow: {
        minHeight: 46,
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 6,
    },
    summaryLabel: { fontSize: 14, fontWeight: "500" },
    summaryValue: { fontSize: 14, fontWeight: "700" },
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
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    loadingPrimaryButton: {
        opacity: 0.7,
    },
});

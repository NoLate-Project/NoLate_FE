import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
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

const calendarAcceptanceIn = new Keyframe({
    0: { transform: [{ perspective: 360 }, { rotateX: "32deg" }, { translateY: 4 }, { scale: 0.9 }] },
    72: { transform: [{ perspective: 360 }, { rotateX: "-6deg" }, { translateY: -1 }, { scale: 1.015 }] },
    100: { transform: [{ perspective: 360 }, { rotateX: "0deg" }, { translateY: 0 }, { scale: 1 }] },
}).duration(240).reduceMotion(ReduceMotion.System);

const acceptanceIn = new Keyframe({
    0: { transform: [{ scale: 0.91 }] },
    100: { transform: [{ scale: 1 }] },
}).duration(180).reduceMotion(ReduceMotion.System);

const invitationStatusIn = new Keyframe({
    0: { opacity: 0.62, transform: [{ translateY: 5 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }] },
}).duration(200).reduceMotion(ReduceMotion.System);

const replacementMessage = "보낸 사람에게 새 초대 링크를 요청해 주세요.";

function getInvitationError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const errorCode = error instanceof ApiResponseError ? error.errorCode : undefined;
    if (errorCode === "S011") {
        return {
            terminal: true,
            title: "이 초대 링크를 수락할 수 없어요",
            message: "차단 관계에 있는 사용자와는 공유할 수 없어요.",
        };
    }
    if (/초대 링크가 만료|(?:invit(?:e|ation)|link).*expired|expired.*(?:invit(?:e|ation)|link)/i.test(message)) {
        return { terminal: true, title: "초대 링크가 만료됐어요", message: replacementMessage };
    }
    if (/폐기된 초대 링크|(?:invit(?:e|ation)|link).*revoked|revoked.*(?:invit(?:e|ation)|link)/i.test(message)) {
        return { terminal: true, title: "초대 링크가 비활성화됐어요", message: replacementMessage };
    }
    if (errorCode === "S007" || /일정 공유 초대가 존재하지 않/i.test(message)) {
        return { terminal: true, title: "유효하지 않은 초대 링크예요", message: replacementMessage };
    }
    if (/수락 가능 횟수|이미 수락이 완료/i.test(message) || errorCode === "S009") {
        return { terminal: true, message: replacementMessage };
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
    const largeText = useWindowDimensions().fontScale > 1.35;
    const headingRef = useRef<React.ElementRef<typeof Text>>(null);
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
    const unavailable = !invitationToken || Boolean(error?.terminal);
    const returnLabel = !isAuthenticated ? "링크 닫기"
        : isCurationCompleted ? "캘린더로 돌아가기" : "캘린더 설정 계속";

    const returnFromInvitation = useCallback(() => {
        if (isLoading) return;
        if (isAuthenticated) {
            if (authenticatedHomeRoute === "/schedule") {
                router.dismissTo(authenticatedHomeRoute);
            } else {
                router.replace(authenticatedHomeRoute);
            }
            return;
        }
        router.replace("/auth/login");
    }, [authenticatedHomeRoute, isAuthenticated, isLoading, router]);

    const acceptedResource = canShowAccepted ? accepted : null;
    const retryNotice = !largeText && !!error && !error.terminal;
    const status = acceptedResource ? "accepted" : unavailable ? "unavailable" : retryNotice ? "retry" : "invitation";
    const heading = acceptedResource
        ? null
        : error?.terminal ? error.title ?? "사용할 수 없는 초대 링크예요"
            : retryNotice ? "초대를 수락하지 못했어요"
                : invitationToken ? "공유 초대 링크" : "유효하지 않은 초대 링크예요";
    const description = error?.terminal ? error.message
        : retryNotice ? "같은 화면에서 다시 시도할 수 있어요."
            : invitationToken ? "초대를 수락하면 로그인한 계정에 공유 권한이 연결돼요." : replacementMessage;
    const resourceTitle = acceptedResource?.scheduleTitle?.trim() || acceptedResource?.calendarTitle?.trim();
    const isCalendar = acceptedResource?.invitation.resourceType === "CALENDAR";
    const resourceLabel = isCalendar ? "공유 캘린더"
        : acceptedResource?.invitation.resourceType === "CATEGORY" ? "캘린더 카테고리" : "일정";
    const role = acceptedResource?.calendarMembership?.role
        ?? acceptedResource?.share?.permission ?? acceptedResource?.invitation.permission;
    const editor = role === "EDITOR" || role === "OWNER";
    const shareScope = acceptedResource?.share?.contentMode ?? acceptedResource?.invitation.contentMode;
    const acceptedAction = !isCurationCompleted ? "캘린더 설정 계속"
        : isCalendar ? editor ? "캘린더 설정 열기" : "캘린더 정보 보기"
        : acceptedResource?.invitation.resourceType === "SCHEDULE" ? "받은 일정 열기" : "캘린더에서 보기";
    const checkmarkIn = acceptedResource && animateAcceptance
        ? isCalendar ? calendarAcceptanceIn : acceptanceIn
        : undefined;
    const acceptButtonLabel = accepting ? "공유 초대 수락 중" : error ? "다시 시도" : "공유 초대 수락";

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
        if (!acceptedResource || resourceTitle) return;
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
    }, [acceptedResource, resourceTitle, isCalendar]);

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

    useEffect(() => {
        if (largeText || (!acceptedResource && !error)) return;
        const frame = requestAnimationFrame(() => {
            if (headingRef.current) {
                AccessibilityInfo.sendAccessibilityEvent?.(headingRef.current, "focus");
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [acceptedResource, error, largeText]);

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
                params: { id: calendarId, view: editor ? "settings" : "calendar" },
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
                        : isAuthenticated ? "뒤로 가기" : "로그인 화면으로 돌아가기"}
                    style={[styles.headerButton, isLoading && styles.headerButtonDisabled]}
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
                    key={status}
                    entering={!largeText && (error?.terminal || retryNotice) ? invitationStatusIn : undefined}
                    style={styles.bodyStatus}
                >
                    <Animated.View
                        entering={largeText && error?.terminal ? invitationStatusIn : checkmarkIn}
                        style={[styles.iconCircle, { backgroundColor: `${accent}1F` },
                            acceptedResource && { backgroundColor: actionColor },
                            isCalendar && styles.calendarConfirmedIcon]}
                    >
                        {isCalendar && <View pointerEvents="none" style={styles.calendarConfirmedFace} />}
                        <Ionicons accessible={false} name={acceptedResource ? "checkmark-outline" : unavailable || retryNotice ? "alert-circle-outline" : "link-outline"}
                            size={30} color={isCalendar ? "#FFFFFF" : acceptedResource ? actionInk : accent} />
                    </Animated.View>

                    {acceptedResource && (
                        <Text style={[styles.completion, { color: mode === "dark" ? accent : actionColor }]}>
                            {resourceLabel} 연결 완료
                        </Text>
                    )}
                    <Text ref={headingRef} accessibilityRole="header" accessibilityLiveRegion="polite"
                        style={[styles.title, { color: colors.textPrimary }]}>
                        {acceptedResource ? resourceTitle || acceptedTitle || resourceLabel : heading}
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
                        <Text
                            accessibilityRole={retryNotice ? "alert" : undefined}
                            accessibilityLiveRegion={retryNotice ? "polite" : undefined}
                            style={[styles.description, { color: colors.textSecondary }]}
                        >
                            {description}
                        </Text>
                    )}

                    {!!error && !error.terminal && !retryNotice && (
                        <View accessibilityRole="alert" accessibilityLiveRegion="polite"
                            style={[styles.errorBox, { borderColor: colors.border }]}>
                            <Ionicons accessible={false} name="alert-circle-outline" size={19} color={mode === "dark" ? "#FF8A8A" : "#D70015"} />
                            <Text style={[styles.errorText, { color: colors.textPrimary }]}>{error.message}</Text>
                        </View>
                    )}
                </Animated.View>
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
                ) : unavailable ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={returnLabel}
                        onPress={returnFromInvitation}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { backgroundColor: actionColor, opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Ionicons
                            accessible={false}
                            name={isAuthenticated ? "chevron-back-outline" : "close-circle-outline"}
                            size={20}
                            color={actionInk}
                        />
                        <Text style={[styles.primaryButtonText, { color: actionInk }]}>{returnLabel}</Text>
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
                    <>
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
                        {isCurationCompleted && acceptedResource.invitation.resourceType === "SCHEDULE" && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="공유함에서 보기"
                                onPress={() => router.replace({
                                    pathname: "/share/inbox",
                                    params: { tab: "schedule", focusScheduleId: acceptedResource.invitation.resourceId },
                                })}
                                style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.65 }]}
                            >
                                <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>공유함에서 보기</Text>
                            </Pressable>
                        )}
                    </>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={acceptButtonLabel}
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
                                <Ionicons accessible={false} name={error ? "refresh-outline" : "checkmark-circle-outline"} size={20} color={actionInk} />
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
        paddingVertical: 24,
    },
    bodyStatus: { width: "100%", alignItems: "center", gap: 14 },
    bodyScroll: {
        flex: 1,
    },
    iconCircle: {
        width: 66,
        height: 66,
        borderRadius: 20,
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
    calendarConfirmedIcon: {
        backgroundColor: "#164586",
        paddingBottom: 4,
        shadowColor: "#205CC6",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 9,
    },
    calendarConfirmedFace: {
        ...StyleSheet.absoluteFillObject,
        bottom: 4,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.24)",
        backgroundColor: "#2363D3",
        experimental_backgroundImage: "linear-gradient(155deg, #4F8BFA 0%, #2363D3 65%, #164DA7 100%)",
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
        borderRadius: 12,
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
    secondaryButton: {
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
    },
    secondaryButtonText: {
        fontSize: 13,
        fontWeight: "600",
        textAlign: "center",
    },
    loadingPrimaryButton: {
        opacity: 0.7,
    },
});

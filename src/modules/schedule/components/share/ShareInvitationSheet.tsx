import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Easing,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
    type LayoutChangeEvent,
} from "react-native";
import Reanimated, {
    LinearTransition,
    ReduceMotion,
    useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createCategoryShare,
    createCategoryShareInvitation,
    createCalendarShare,
    createCalendarShareInvitation,
    createScheduleShare,
    createScheduleShareInvitation,
    getCategoryShareInvitations,
    getCalendarShareInvitations,
    getScheduleShareInvitations,
    revokeCategoryShareInvitation,
    revokeCalendarShareInvitation,
    revokeScheduleShareInvitation,
    type CreateDirectSharePayload,
    type CreateShareInvitationPayload,
    type ScheduleShareInvitation,
} from "../../../../api/scheduleSharing";
import type { ScheduleShareContentMode } from "../../../../api/scheduleCalendars";
import type { ScheduleSharePermission } from "../../types";
import { isCurrentScheduleShareRequest } from "../../shareRequestGuard";
import { createDirectShareTarget } from "../../../share/directShareTarget";
import { useTheme } from "../../../theme/ThemeContext";
import BrandedLoader from "../../../../ui/BrandedLoader";

type ShareInvitationSheetProps = {
    visible: boolean;
    resourceType: "schedule" | "category" | "calendar";
    resourceId?: string | null;
    title: string;
    subtitle?: string;
    initialContentMode?: ScheduleShareContentMode;
    onCalendarContentModeChange?: (mode: ScheduleShareContentMode) => Promise<void>;
    onClose: () => void;
};

type ShareMode = "direct" | "link";

const PERMISSION_OPTIONS: Array<{
    value: Exclude<ScheduleSharePermission, "OWNER">;
    label: string;
    description: string;
}> = [
    { value: "VIEWER", label: "보기", description: "일정과 카테고리 내용을 확인" },
    { value: "EDITOR", label: "편집", description: "공유 대상 수정까지 허용" },
];

const TTL_OPTIONS = [
    { value: 24, label: "24시간" },
    { value: 72, label: "3일" },
    { value: 168, label: "7일" },
];

const ACCEPT_COUNT_OPTIONS = [
    { value: 1, label: "1명" },
    { value: 5, label: "5명" },
    { value: 10, label: "10명" },
];

const MODE_TRANSITION_DURATION_MS = 240;
const PRODUCTION_SHARE_LINK_ORIGIN = "https://nolate.jinuk.dev";
const MODE_CONTENT_TRAVEL = 14;
const SHEET_LAYOUT_TRANSITION = LinearTransition
    .springify()
    .damping(20)
    .stiffness(180)
    .mass(0.75)
    .overshootClamping(1)
    .reduceMotion(ReduceMotion.System);

function getErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

    if (/403|forbidden|status code/i.test(message)) {
        return "공유 권한을 확인할 수 없어요.";
    }

    if (/network|timeout/i.test(message)) {
        return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    }

    return message;
}

function formatExpiresAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}.${day} ${hour}:${minute}`;
}

function statusLabel(status: ScheduleShareInvitation["status"]) {
    switch (status) {
        case "PENDING":
            return "활성";
        case "ACCEPTED":
            return "수락됨";
        case "EXPIRED":
            return "만료";
        case "REVOKED":
            return "해제";
        default:
            return status;
    }
}

function permissionLabel(permission: ScheduleSharePermission) {
    return PERMISSION_OPTIONS.find((option) => option.value === permission)?.label ?? permission;
}

export function createShareInviteUrl(token: string) {
    if (__DEV__) return Linking.createURL(`/share/${encodeURIComponent(token)}`);

    return `${PRODUCTION_SHARE_LINK_ORIGIN}/share/${encodeURIComponent(token)}`;
}

export default function ShareInvitationSheet({
    visible,
    resourceType,
    resourceId,
    title,
    subtitle,
    initialContentMode = "SCHEDULE_ONLY",
    onCalendarContentModeChange,
    onClose,
}: ShareInvitationSheetProps) {
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const reduceMotionEnabled = useReducedMotion();
    const [shareMode, setShareMode] = useState<ShareMode>("direct");
    const [modeSegmentWidth, setModeSegmentWidth] = useState(0);
    const [permission, setPermission] = useState<Exclude<ScheduleSharePermission, "OWNER">>("VIEWER");
    const [contentMode, setContentMode] = useState<ScheduleShareContentMode>(initialContentMode);
    const [targetQuery, setTargetQuery] = useState("");
    const [sharingDirect, setSharingDirect] = useState(false);
    const [lastDirectShareLabel, setLastDirectShareLabel] = useState<string | null>(null);
    const [ttlHours, setTtlHours] = useState(72);
    const [maxAcceptCount, setMaxAcceptCount] = useState(1);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [invitations, setInvitations] = useState<ScheduleShareInvitation[]>([]);
    const [generatedLink, setGeneratedLink] = useState<string | null>(null);
    const [directError, setDirectError] = useState<string | null>(null);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
    const invitationLoadSequenceRef = useRef(0);
    const directShareSequenceRef = useRef(0);
    const invitationCreateSequenceRef = useRef(0);
    const invitationRevokeSequenceRef = useRef(0);
    const modePosition = useRef(new Animated.Value(0)).current;
    const modeContentEntrance = useRef(new Animated.Value(1)).current;
    const modeTransitionDirection = useRef<1 | -1>(1);
    const isDark = mode === "dark";
    // 카테고리 색은 일정 구분에만 사용하고, 공유 행동은 앱의 브랜드 파랑으로 통일한다.
    const highlight = isDark ? "#8BB7FF" : "#2F80FF";

    const resourceLabel = resourceType === "schedule"
        ? "일정"
        : resourceType === "calendar" ? "공유 캘린더" : "카테고리";
    const canRequest = Boolean(resourceId);
    const resourceRequestKey = visible && resourceId
        ? `${resourceType}:${resourceId}`
        : null;
    const activeResourceKeyRef = useRef<string | null>(resourceRequestKey);
    activeResourceKeyRef.current = resourceRequestKey;
    const latestInvitation = useMemo(
        () => invitations.find((invitation) => invitation.status === "PENDING") ?? invitations[0],
        [invitations]
    );

    const loadInvitations = useCallback(async () => {
        const requestKey = resourceRequestKey;
        if (!requestKey || !resourceId) return;
        const requestSequence = invitationLoadSequenceRef.current + 1;
        invitationLoadSequenceRef.current = requestSequence;

        setLoading(true);
        setLinkError(null);
        try {
            const nextInvitations = resourceType === "schedule"
                ? await getScheduleShareInvitations(resourceId)
                : resourceType === "calendar"
                    ? await getCalendarShareInvitations(resourceId)
                    : await getCategoryShareInvitations(resourceId);
            if (!isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                invitationLoadSequenceRef.current,
                requestSequence,
            )) return;
            setInvitations(nextInvitations);
        } catch (loadError) {
            if (!isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                invitationLoadSequenceRef.current,
                requestSequence,
            )) return;
            setLinkError(getErrorMessage(loadError));
        } finally {
            if (isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                invitationLoadSequenceRef.current,
                requestSequence,
            )) {
                setLoading(false);
            }
        }
    }, [resourceId, resourceRequestKey, resourceType]);

    useEffect(() => {
        invitationLoadSequenceRef.current += 1;
        directShareSequenceRef.current += 1;
        invitationCreateSequenceRef.current += 1;
        invitationRevokeSequenceRef.current += 1;
        setLoading(false);
        setSharingDirect(false);
        setCreating(false);
        setRevokingInvitationId(null);
        setInvitations([]);
        setGeneratedLink(null);
        setTargetQuery("");
        setLastDirectShareLabel(null);
        setDirectError(null);
        setLinkError(null);
        setContentMode(initialContentMode);

        if (resourceRequestKey) {
            loadInvitations().catch(() => undefined);
        }

        return () => {
            invitationLoadSequenceRef.current += 1;
            directShareSequenceRef.current += 1;
            invitationCreateSequenceRef.current += 1;
            invitationRevokeSequenceRef.current += 1;
            if (activeResourceKeyRef.current === resourceRequestKey) {
                activeResourceKeyRef.current = null;
            }
        };
    }, [initialContentMode, loadInvitations, resourceRequestKey]);

    const shareGeneratedLink = useCallback(async (link: string) => {
        await Share.share({
            title: `${title} 공유 초대`,
            message: `${title} ${resourceLabel} 공유 초대\n${link}`,
            url: link,
        });
    }, [resourceLabel, title]);

    const createInvitation = useCallback(async () => {
        const requestKey = resourceRequestKey;
        if (!requestKey || !resourceId || creating) return;
        const requestSequence = invitationCreateSequenceRef.current + 1;
        invitationCreateSequenceRef.current = requestSequence;

        const payload: CreateShareInvitationPayload = {
            permission,
            contentMode,
            ttlHours,
            maxAcceptCount,
        };

        setCreating(true);
        setLinkError(null);
        try {
            if (resourceType === "calendar" && onCalendarContentModeChange) {
                await onCalendarContentModeChange(contentMode);
            }
            const invitation = resourceType === "schedule"
                ? await createScheduleShareInvitation(resourceId, payload)
                : resourceType === "calendar"
                    ? await createCalendarShareInvitation(resourceId, payload)
                    : await createCategoryShareInvitation(resourceId, payload);
            if (!isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                invitationCreateSequenceRef.current,
                requestSequence,
            )) return;

            setInvitations((current) => [invitation, ...current.filter((item) => item.id !== invitation.id)]);

            if (!invitation.token) {
                setGeneratedLink(null);
                Alert.alert("초대 링크를 만들지 못했어요", "잠시 후 다시 시도해 주세요.");
                return;
            }

            const link = createShareInviteUrl(invitation.token);
            setGeneratedLink(link);
            await shareGeneratedLink(link);
        } catch (createError) {
            if (!isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                invitationCreateSequenceRef.current,
                requestSequence,
            )) return;
            setLinkError(getErrorMessage(createError));
        } finally {
            if (isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                invitationCreateSequenceRef.current,
                requestSequence,
            )) {
                setCreating(false);
            }
        }
    }, [contentMode, creating, maxAcceptCount, onCalendarContentModeChange, permission, resourceId, resourceRequestKey, resourceType, shareGeneratedLink, ttlHours]);

    const createDirectShare = useCallback(async () => {
        const requestKey = resourceRequestKey;
        if (!requestKey || !resourceId || sharingDirect) return;
        const requestSequence = directShareSequenceRef.current + 1;
        directShareSequenceRef.current = requestSequence;

        let target: Pick<CreateDirectSharePayload, "targetEmail" | "targetAppId">;
        try {
            target = createDirectShareTarget(targetQuery);
        } catch (validationError) {
            setDirectError(getErrorMessage(validationError));
            return;
        }

        setSharingDirect(true);
        setDirectError(null);
        try {
            const payload: CreateDirectSharePayload = { ...target, permission, contentMode };
            if (resourceType === "calendar" && onCalendarContentModeChange) {
                await onCalendarContentModeChange(contentMode);
            }
            await (resourceType === "schedule"
                ? createScheduleShare(resourceId, payload)
                : resourceType === "calendar"
                    ? createCalendarShare(resourceId, payload)
                    : createCategoryShare(resourceId, payload));
            if (!isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                directShareSequenceRef.current,
                requestSequence,
            )) return;

            setLastDirectShareLabel(target.targetEmail ?? `회원 #${target.targetAppId}`);
            setTargetQuery("");
        } catch (shareError) {
            if (!isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                directShareSequenceRef.current,
                requestSequence,
            )) return;
            setDirectError(getErrorMessage(shareError));
        } finally {
            if (isCurrentScheduleShareRequest(
                activeResourceKeyRef.current,
                requestKey,
                directShareSequenceRef.current,
                requestSequence,
            )) {
                setSharingDirect(false);
            }
        }
    }, [contentMode, onCalendarContentModeChange, permission, resourceId, resourceRequestKey, resourceType, sharingDirect, targetQuery]);

    const revokeInvitation = useCallback((invitation: ScheduleShareInvitation) => {
        const requestKey = resourceRequestKey;
        if (!requestKey || !resourceId || revokingInvitationId) return;

        Alert.alert("공유 링크 해제", "이 링크는 더 이상 사용할 수 없게 됩니다.", [
            { text: "취소", style: "cancel" },
            {
                text: "링크 해제",
                style: "destructive",
                onPress: async () => {
                    if (activeResourceKeyRef.current !== requestKey) return;
                    const requestSequence = invitationRevokeSequenceRef.current + 1;
                    invitationRevokeSequenceRef.current = requestSequence;
                    setRevokingInvitationId(invitation.id);
                    setLinkError(null);
                    try {
                        await (resourceType === "schedule"
                            ? revokeScheduleShareInvitation(resourceId, invitation.id)
                            : resourceType === "calendar"
                                ? revokeCalendarShareInvitation(resourceId, invitation.id)
                                : revokeCategoryShareInvitation(resourceId, invitation.id));
                        if (!isCurrentScheduleShareRequest(
                            activeResourceKeyRef.current,
                            requestKey,
                            invitationRevokeSequenceRef.current,
                            requestSequence,
                        )) return;
                        setInvitations((current) => current.map((item) => (
                            item.id === invitation.id ? { ...item, status: "REVOKED" } : item
                        )));
                        setGeneratedLink(null);
                    } catch (error) {
                        if (!isCurrentScheduleShareRequest(
                            activeResourceKeyRef.current,
                            requestKey,
                            invitationRevokeSequenceRef.current,
                            requestSequence,
                        )) return;
                        setLinkError(getErrorMessage(error));
                    } finally {
                        if (isCurrentScheduleShareRequest(
                            activeResourceKeyRef.current,
                            requestKey,
                            invitationRevokeSequenceRef.current,
                            requestSequence,
                        )) {
                            setRevokingInvitationId(null);
                        }
                    }
                },
            },
        ]);
    }, [resourceId, resourceRequestKey, resourceType, revokingInvitationId]);

    const submitting = shareMode === "direct" ? sharingDirect : creating;
    const submitDisabled = !canRequest || submitting || (shareMode === "direct" && !targetQuery.trim());
    const modeIndicatorWidth = Math.max(0, (modeSegmentWidth - 9) / 2);
    const modeIndicatorTravel = Math.max(0, (modeSegmentWidth - 3) / 2);
    const modeIndicatorTranslateX = modePosition.interpolate({
        inputRange: [0, 1],
        outputRange: [0, modeIndicatorTravel],
    });
    const modeContentTranslateX = modeContentEntrance.interpolate({
        inputRange: [0, 1],
        outputRange: [modeTransitionDirection.current * MODE_CONTENT_TRAVEL, 0],
    });
    const modeContentAnimatedStyle = {
        opacity: modeContentEntrance,
        transform: [{ translateX: modeContentTranslateX }],
    };

    const handleModeSegmentLayout = useCallback((event: LayoutChangeEvent) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        setModeSegmentWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
    }, []);

    const switchShareMode = useCallback((nextMode: ShareMode) => {
        if (nextMode === shareMode) return;

        const nextPosition = nextMode === "link" ? 1 : 0;
        modeTransitionDirection.current = nextMode === "link" ? 1 : -1;
        modePosition.stopAnimation();
        modeContentEntrance.stopAnimation();

        if (nextMode === "direct") setDirectError(null);
        else setLinkError(null);

        if (reduceMotionEnabled) {
            modePosition.setValue(nextPosition);
            modeContentEntrance.setValue(1);
            setShareMode(nextMode);
            return;
        }

        modeContentEntrance.setValue(0);
        setShareMode(nextMode);
        Animated.parallel([
            Animated.timing(modePosition, {
                toValue: nextPosition,
                duration: MODE_TRANSITION_DURATION_MS,
                easing: Easing.bezier(0.22, 1, 0.36, 1),
                useNativeDriver: true,
            }),
            Animated.timing(modeContentEntrance, {
                toValue: 1,
                duration: MODE_TRANSITION_DURATION_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [modeContentEntrance, modePosition, reduceMotionEnabled, shareMode]);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View style={styles.backdrop}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 닫기"
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    pointerEvents="box-none"
                    style={styles.keyboardAvoidingView}
                >
                    <Reanimated.View
                        layout={SHEET_LAYOUT_TRANSITION}
                        style={[
                            styles.sheet,
                            {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                paddingBottom: Math.max(insets.bottom, 14) + 10,
                            },
                        ]}
                    >
                    <View style={styles.handleRow}>
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    </View>

                    <View style={styles.header}>
                        <View style={[styles.resourceIcon, { backgroundColor: `${highlight}22` }]}>
                            <Ionicons
                                name={resourceType === "schedule"
                                    ? "calendar-outline"
                                    : resourceType === "calendar" ? "people-outline" : "folder-open-outline"}
                                size={22}
                                color={highlight}
                            />
                        </View>
                        <View style={styles.headerText}>
                            <Text style={[styles.eyebrow, { color: highlight }]}>{resourceLabel} 공유</Text>
                            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
                                {title}
                            </Text>
                            {!!subtitle && (
                                <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                                    {subtitle}
                                </Text>
                            )}
                        </View>
                        <Pressable
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel="공유 닫기"
                            style={({ pressed }) => [
                                styles.closeButton,
                                { backgroundColor: colors.surface2, opacity: pressed ? 0.65 : 1 },
                            ]}
                        >
                            <Ionicons name="close" size={21} color={colors.textPrimary} />
                        </Pressable>
                    </View>

                    <View
                        onLayout={handleModeSegmentLayout}
                        style={[styles.modeSegment, { backgroundColor: colors.surface2 }]}
                    >
                        {modeIndicatorWidth > 0 ? (
                            <Animated.View
                                pointerEvents="none"
                                style={[
                                    styles.modeIndicator,
                                    {
                                        width: modeIndicatorWidth,
                                        backgroundColor: colors.surface,
                                        borderColor: colors.border,
                                        transform: [{ translateX: modeIndicatorTranslateX }],
                                    },
                                ]}
                            />
                        ) : null}
                        {([
                            { value: "direct" as const, label: "직접 공유", icon: "person-add-outline" as const },
                            { value: "link" as const, label: "링크 초대", icon: "link-outline" as const },
                        ]).map((option) => {
                            const selected = shareMode === option.value;
                            return (
                                <Pressable
                                    key={option.value}
                                    onPress={() => switchShareMode(option.value)}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected }}
                                    style={styles.modeOption}
                                >
                                    <Ionicons
                                        name={option.icon}
                                        size={17}
                                        color={selected ? colors.textPrimary : colors.textSecondary}
                                    />
                                    <Text style={[styles.modeOptionText, { color: selected ? colors.textPrimary : colors.textSecondary }]}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        style={styles.contentScroll}
                        contentContainerStyle={styles.content}
                    >
                        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>권한</Text>
                        <View style={styles.segmentRow}>
                            {PERMISSION_OPTIONS.map((option) => {
                                const selected = option.value === permission;
                                return (
                                    <Pressable
                                        key={option.value}
                                    onPress={() => setPermission(option.value)}
                                    accessibilityRole="radio"
                                    accessibilityLabel={`${option.label} 권한, ${option.description}`}
                                    accessibilityState={{ selected }}
                                        style={({ pressed }) => [
                                            styles.permissionOption,
                                            {
                                                backgroundColor: selected ? `${highlight}1E` : colors.surface2,
                                                borderColor: selected ? highlight : colors.border,
                                                opacity: pressed ? 0.68 : 1,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.permissionLabel,
                                                { color: selected ? highlight : colors.textPrimary },
                                            ]}
                                        >
                                            {option.label}
                                        </Text>
                                        <Text
                                            style={[styles.permissionDescription, { color: colors.textSecondary }]}
                                            numberOfLines={2}
                                        >
                                            {option.description}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {resourceType !== "category" ? (
                            <>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>공유 범위</Text>
                                <View style={styles.contentModeRow}>
                                    {([
                                        {
                                            value: "SCHEDULE_ONLY" as const,
                                            label: "일정만",
                                            icon: "calendar-outline" as const,
                                        },
                                        {
                                            value: "SCHEDULE_AND_TRAVEL" as const,
                                            label: "일정 + 각자 경로",
                                            icon: "navigate-outline" as const,
                                        },
                                    ]).map((option) => {
                                        const selected = contentMode === option.value;
                                        return (
                                            <Pressable
                                                key={option.value}
                                                accessibilityRole="radio"
                                                accessibilityLabel={option.label}
                                                accessibilityState={{ selected }}
                                                onPress={() => setContentMode(option.value)}
                                                style={({ pressed }) => [
                                                    styles.contentModeOption,
                                                    {
                                                        backgroundColor: selected ? `${highlight}1E` : colors.surface2,
                                                        borderColor: selected ? highlight : colors.border,
                                                        opacity: pressed ? 0.68 : 1,
                                                    },
                                                ]}
                                            >
                                                <Ionicons
                                                    name={option.icon}
                                                    size={18}
                                                    color={selected ? highlight : colors.textSecondary}
                                                />
                                                <Text
                                                    style={[
                                                        styles.contentModeLabel,
                                                        { color: selected ? highlight : colors.textPrimary },
                                                    ]}
                                                    numberOfLines={2}
                                                >
                                                    {option.label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </>
                        ) : null}

                        <Animated.View style={[styles.modeContent, modeContentAnimatedStyle]}>
                            {shareMode === "direct" ? (
                                <View style={styles.directTargetBlock}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>공유 대상</Text>
                                <View
                                    style={[
                                        styles.targetInputShell,
                                        {
                                            backgroundColor: colors.surface2,
                                            borderColor: directError ? "#FF453A" : colors.border,
                                        },
                                    ]}
                                >
                                    <Ionicons name="search-outline" size={19} color={colors.textSecondary} />
                                    <TextInput
                                        accessibilityLabel="공유 대상 회원 번호 또는 이메일"
                                        value={targetQuery}
                                        onChangeText={(value) => {
                                            setTargetQuery(value);
                                            setDirectError(null);
                                            setLastDirectShareLabel(null);
                                        }}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="email-address"
                                        placeholder="회원 #92 또는 name@example.com"
                                        placeholderTextColor={colors.textSecondary}
                                        returnKeyType="send"
                                        onSubmitEditing={() => {
                                            if (!submitDisabled) createDirectShare().catch(() => undefined);
                                        }}
                                        style={[styles.targetInput, { color: colors.textPrimary }]}
                                    />
                                    {!!targetQuery && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="공유 대상 입력 지우기"
                                            onPress={() => setTargetQuery("")}
                                            hitSlop={8}
                                        >
                                            <Ionicons name="close-circle" size={19} color={colors.textSecondary} />
                                        </Pressable>
                                    )}
                                </View>
                                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                    프로필의 회원 번호나 전체 이메일로 바로 공유합니다.
                                </Text>
                                {!!lastDirectShareLabel && (
                                    <View
                                        accessibilityLiveRegion="polite"
                                        style={[styles.directSuccess, { backgroundColor: `${highlight}18` }]}
                                    >
                                        <Ionicons name="checkmark-circle" size={19} color={highlight} />
                                        <Text style={[styles.directSuccessText, { color: colors.textPrimary }]} numberOfLines={1}>
                                            {lastDirectShareLabel}에게 공유했습니다
                                        </Text>
                                    </View>
                                )}
                                {!!directError && (
                                    <Text
                                        accessibilityLiveRegion="polite"
                                        style={[styles.errorText, { color: "#FF453A" }]}
                                    >
                                        {directError}
                                    </Text>
                                )}
                                </View>
                            ) : (
                                <>
                        <View style={styles.optionGrid}>
                            <View style={styles.optionBlock}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>만료</Text>
                                <View style={styles.chipRow}>
                                    {TTL_OPTIONS.map((option) => (
                                        <OptionChip
                                            key={option.value}
                                            label={option.label}
                                            selected={ttlHours === option.value}
                                            highlight={highlight}
                                            borderColor={colors.border}
                                            surfaceColor={colors.surface2}
                                            textColor={colors.textPrimary}
                                            onPress={() => setTtlHours(option.value)}
                                        />
                                    ))}
                                </View>
                            </View>

                            <View style={styles.optionBlock}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>수락 가능</Text>
                                <View style={styles.chipRow}>
                                    {ACCEPT_COUNT_OPTIONS.map((option) => (
                                        <OptionChip
                                            key={option.value}
                                            label={option.label}
                                            selected={maxAcceptCount === option.value}
                                            highlight={highlight}
                                            borderColor={colors.border}
                                            surfaceColor={colors.surface2}
                                            textColor={colors.textPrimary}
                                            onPress={() => setMaxAcceptCount(option.value)}
                                        />
                                    ))}
                                </View>
                            </View>
                        </View>

                        {!!generatedLink && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="생성한 공유 링크 다시 공유"
                                onPress={() => shareGeneratedLink(generatedLink).catch(() => undefined)}
                                style={({ pressed }) => [
                                    styles.generatedLink,
                                    {
                                        backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#F8FAFC",
                                        borderColor: colors.border,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                            >
                                <Ionicons name="link-outline" size={20} color={highlight} />
                                <Text style={[styles.generatedLinkText, { color: colors.textPrimary }]} numberOfLines={1}>
                                    {generatedLink}
                                </Text>
                                <Ionicons name="share-outline" size={19} color={colors.textSecondary} />
                            </Pressable>
                        )}

                        <View style={[styles.invitationPanel, { borderColor: colors.border }]}>
                            <View style={styles.invitationHeader}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>최근 초대</Text>
                                {loading ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="share"
                                        accessibilityLabel="최근 초대를 불러오고 있어요"
                                    />
                                ) : null}
                            </View>
                            {linkError ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`${linkError}. 최근 공유 초대 다시 불러오기`}
                                    accessibilityState={{ disabled: loading, busy: loading }}
                                    disabled={loading}
                                    onPress={() => loadInvitations().catch(() => undefined)}
                                    style={({ pressed }) => [
                                        styles.invitationRetry,
                                        { opacity: pressed ? 0.62 : 1 },
                                    ]}
                                >
                                    <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                        {linkError} · 다시 시도
                                    </Text>
                                </Pressable>
                            ) : latestInvitation ? (
                                <View style={styles.invitationSummary}>
                                    <View style={[styles.statusDot, { backgroundColor: highlight }]} />
                                    <View style={styles.invitationSummaryText}>
                                        <Text style={[styles.invitationTitle, { color: colors.textPrimary }]}>
                                            {statusLabel(latestInvitation.status)} · {permissionLabel(latestInvitation.permission)}
                                        </Text>
                                        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                            {latestInvitation.acceptedCount}/{latestInvitation.maxAcceptCount}명 수락 · {formatExpiresAt(latestInvitation.expiresAt)} 만료
                                        </Text>
                                    </View>
                                    {latestInvitation.status === "PENDING" ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="공유 링크 해제"
                                            disabled={Boolean(revokingInvitationId)}
                                            accessibilityState={{ disabled: Boolean(revokingInvitationId) }}
                                            onPress={() => revokeInvitation(latestInvitation)}
                                            style={({ pressed }) => [styles.revokeButton, { opacity: pressed ? 0.6 : 1 }]}
                                        >
                                            {revokingInvitationId === latestInvitation.id ? (
                                                <BrandedLoader size="button" variant="share" accessibilityLabel="공유 링크를 해제하고 있어요" />
                                            ) : (
                                                <Text style={styles.revokeButtonText}>링크 해제</Text>
                                            )}
                                        </Pressable>
                                    ) : null}
                                </View>
                            ) : (
                                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                    아직 생성한 공유 링크가 없어요.
                                </Text>
                            )}
                        </View>
                                </>
                            )}
                        </Animated.View>
                    </ScrollView>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={shareMode === "direct" ? "이 대상에게 공유" : "링크 만들고 공유"}
                        disabled={submitDisabled}
                        accessibilityState={{ disabled: submitDisabled, busy: submitting }}
                        onPress={shareMode === "direct" ? createDirectShare : createInvitation}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            {
                                backgroundColor: highlight,
                                opacity: submitDisabled ? 0.45 : pressed ? 0.78 : 1,
                            },
                        ]}
                    >
                        {submitting ? (
                            <BrandedLoader
                                size="button"
                                variant="share"
                                accessibilityLabel="공유를 준비하고 있어요"
                            />
                        ) : (
                            <>
                                <Ionicons
                                    name={shareMode === "direct" ? "paper-plane-outline" : "link-outline"}
                                    size={20}
                                    color="#FFFFFF"
                                />
                                <Text style={styles.primaryButtonText}>
                                    {shareMode === "direct" ? "이 대상에게 공유" : "링크 만들고 공유"}
                                </Text>
                            </>
                        )}
                    </Pressable>
                    </Reanimated.View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}

function OptionChip({
    label,
    selected,
    highlight,
    borderColor,
    surfaceColor,
    textColor,
    onPress,
}: {
    label: string;
    selected: boolean;
    highlight: string;
    borderColor: string;
    surfaceColor: string;
    textColor: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.chip,
                {
                    backgroundColor: selected ? `${highlight}1E` : surfaceColor,
                    borderColor: selected ? highlight : borderColor,
                    opacity: pressed ? 0.68 : 1,
                },
            ]}
        >
            <Text style={[styles.chipText, { color: selected ? highlight : textColor }]}>
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.34)",
    },
    keyboardAvoidingView: {
        flex: 1,
        justifyContent: "flex-end",
    },
    sheet: {
        maxHeight: "88%",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        paddingHorizontal: 18,
        shadowColor: "#000000",
        shadowOpacity: 0.16,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -10 },
        elevation: 20,
        overflow: "hidden",
    },
    handleRow: {
        height: 26,
        alignItems: "center",
        justifyContent: "center",
    },
    handle: {
        width: 42,
        height: 4,
        borderRadius: 2,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingBottom: 14,
    },
    modeSegment: {
        height: 42,
        borderRadius: 10,
        padding: 3,
        flexDirection: "row",
        gap: 3,
        marginBottom: 14,
    },
    modeIndicator: {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: 3,
        borderRadius: 8,
        borderWidth: 1,
    },
    modeOption: {
        flex: 1,
        minWidth: 0,
        zIndex: 1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    modeOptionText: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    resourceIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    eyebrow: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    title: {
        marginTop: 2,
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0,
    },
    subtitle: {
        marginTop: 3,
        fontSize: 13,
        fontWeight: "600",
        letterSpacing: 0,
    },
    closeButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
    },
    content: {
        gap: 14,
        paddingBottom: 14,
    },
    contentScroll: {
        flexShrink: 1,
        minHeight: 0,
    },
    modeContent: {
        gap: 14,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    segmentRow: {
        flexDirection: "row",
        gap: 8,
    },
    permissionOption: {
        flex: 1,
        minHeight: 86,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 11,
        justifyContent: "space-between",
    },
    permissionLabel: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    permissionDescription: {
        marginTop: 7,
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
        letterSpacing: 0,
    },
    contentModeRow: {
        flexDirection: "row",
        gap: 8,
    },
    contentModeOption: {
        flex: 1,
        minWidth: 0,
        minHeight: 52,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
    },
    contentModeLabel: {
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    optionGrid: {
        gap: 12,
    },
    directTargetBlock: {
        gap: 8,
        paddingBottom: 4,
    },
    targetInputShell: {
        height: 50,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    targetInput: {
        flex: 1,
        minWidth: 0,
        height: "100%",
        paddingVertical: 0,
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    directSuccess: {
        minHeight: 42,
        borderRadius: 8,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    directSuccessText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    errorText: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
        letterSpacing: 0,
    },
    optionBlock: {
        gap: 8,
    },
    chipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    chip: {
        minWidth: 72,
        height: 36,
        borderWidth: 1,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 12,
    },
    chipText: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    generatedLink: {
        minHeight: 48,
        borderWidth: 1,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 12,
    },
    generatedLinkText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    invitationPanel: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 13,
        gap: 10,
    },
    invitationHeader: {
        minHeight: 22,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    invitationRetry: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    invitationSummary: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    statusDot: {
        width: 9,
        height: 9,
        borderRadius: 5,
    },
    invitationSummaryText: {
        flex: 1,
        minWidth: 0,
    },
    revokeButton: {
        minHeight: 38,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    revokeButtonText: {
        color: "#DC2626",
        fontSize: 12,
        fontWeight: "900",
    },
    invitationTitle: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    helperText: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 17,
        letterSpacing: 0,
    },
    primaryButton: {
        height: 50,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    primaryButtonText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
});

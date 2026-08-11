import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Easing, Share, type LayoutChangeEvent } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ScheduleShareContentMode } from "../../../../api/scheduleCalendars";
import {
    createCategoryShare, createCategoryShareInvitation, createCalendarShare, createCalendarShareInvitation,
    createScheduleShare, createScheduleShareInvitation, getCategoryShareInvitations, getCalendarShareInvitations,
    getScheduleShareInvitations, revokeCategoryShareInvitation, revokeCalendarShareInvitation,
    revokeScheduleShareInvitation, type CreateDirectSharePayload, type CreateShareInvitationPayload,
    type ScheduleShareInvitation,
} from "../../../../api/scheduleSharing";
import { createDirectShareTarget } from "../../../share/directShareTarget";
import { useTheme } from "../../../theme/ThemeContext";
import { isCurrentScheduleShareRequest } from "../../shareRequestGuard";
import type { ScheduleSharePermission } from "../../types";
import { MODE_CONTENT_TRAVEL, MODE_TRANSITION_DURATION_MS, createShareInviteUrl, getErrorMessage,
    type ShareInvitationSheetProps, type ShareMode } from "./shareInvitationModel";

/** 공유 대상별 직접 공유·링크 초대 상태와 비동기 요청 세대를 관리합니다. */
export function useShareInvitationSheet({ visible, resourceType, resourceId, title,
    initialContentMode = "SCHEDULE_ONLY", onCalendarContentModeChange }: ShareInvitationSheetProps) {
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

    /** 현재 공유 대상의 초대 목록을 요청하고 요청 세대가 최신일 때만 결과를 반영합니다. */
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

    /** 생성된 초대 링크와 대상 제목을 운영체제 공유 시트로 전달합니다. */
    const shareGeneratedLink = useCallback(async (link: string) => {
        await Share.share({
            title: `${title} 공유 초대`,
            message: `${title} ${resourceLabel} 공유 초대\n${link}`,
            url: link,
        });
    }, [resourceLabel, title]);

    /** 권한·콘텐츠 범위·유효 기간을 적용해 링크 초대를 만들고 즉시 공유 시트를 엽니다. */
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

    /** 이메일 또는 회원 ID를 검증해 직접 공유하고 오래된 비동기 응답은 화면에 반영하지 않습니다. */
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

    /** 사용자 확인 후 링크를 해제하고 현재 대상의 최신 초대 목록 상태만 갱신합니다. */
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

    /** 공유 방식 세그먼트의 실제 너비를 측정해 선택 표시기의 이동 거리를 계산합니다. */
    const handleModeSegmentLayout = useCallback((event: LayoutChangeEvent) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        setModeSegmentWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
    }, []);

    /** 직접 공유와 링크 공유 사이를 접근성 모션 설정에 맞춰 전환합니다. */
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

    return {
        insets,
        colors,
        highlight,
        isDark,
        resourceLabel,
        shareMode,
        permission,
        setPermission,
        contentMode,
        setContentMode,
        targetQuery,
        setTargetQuery,
        sharingDirect,
        lastDirectShareLabel,
        setLastDirectShareLabel,
        ttlHours,
        setTtlHours,
        maxAcceptCount,
        setMaxAcceptCount,
        loading,
        creating,
        invitations,
        generatedLink,
        directError,
        setDirectError,
        linkError,
        revokingInvitationId,
        latestInvitation,
        loadInvitations,
        shareGeneratedLink,
        createInvitation,
        createDirectShare,
        revokeInvitation,
        submitting,
        submitDisabled,
        modeIndicatorWidth,
        modeIndicatorTranslateX,
        modeContentAnimatedStyle,
        handleModeSegmentLayout,
        switchShareMode,
    };
}

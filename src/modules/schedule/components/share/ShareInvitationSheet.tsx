import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    createCategoryShare,
    createCategoryShareInvitation,
    createScheduleShare,
    createScheduleShareInvitation,
    getCategoryShareInvitations,
    getScheduleShareInvitations,
    type CreateDirectSharePayload,
    type CreateShareInvitationPayload,
    type ScheduleShareInvitation,
} from "../../../../api/scheduleSharing";
import type { ScheduleSharePermission } from "../../types";
import { createDirectShareTarget } from "../../../share/directShareTarget";
import { useTheme } from "../../../theme/ThemeContext";

type ShareInvitationSheetProps = {
    visible: boolean;
    resourceType: "schedule" | "category";
    resourceId?: string | null;
    title: string;
    subtitle?: string;
    accentColor?: string;
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
    return Linking.createURL(`/share/${encodeURIComponent(token)}`);
}

export default function ShareInvitationSheet({
    visible,
    resourceType,
    resourceId,
    title,
    subtitle,
    accentColor,
    onClose,
}: ShareInvitationSheetProps) {
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const [shareMode, setShareMode] = useState<ShareMode>("direct");
    const [permission, setPermission] = useState<Exclude<ScheduleSharePermission, "OWNER">>("VIEWER");
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
    const highlight = accentColor ?? colors.selectedDayBg;
    const isDark = mode === "dark";

    const resourceLabel = resourceType === "schedule" ? "일정" : "카테고리";
    const canRequest = Boolean(resourceId);
    const latestInvitation = useMemo(
        () => invitations.find((invitation) => invitation.status === "PENDING") ?? invitations[0],
        [invitations]
    );

    const loadInvitations = useCallback(async () => {
        if (!visible || !resourceId) return;

        setLoading(true);
        setLinkError(null);
        try {
            const nextInvitations = resourceType === "schedule"
                ? await getScheduleShareInvitations(resourceId)
                : await getCategoryShareInvitations(resourceId);
            setInvitations(nextInvitations);
        } catch (loadError) {
            setLinkError(getErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [resourceId, resourceType, visible]);

    useEffect(() => {
        if (!visible) {
            setGeneratedLink(null);
            setTargetQuery("");
            setLastDirectShareLabel(null);
            setDirectError(null);
            setLinkError(null);
            return;
        }

        loadInvitations();
    }, [loadInvitations, visible]);

    const shareGeneratedLink = useCallback(async (link: string) => {
        await Share.share({
            title: `${title} 공유 초대`,
            message: `${title} ${resourceLabel} 공유 초대\n${link}`,
            url: link,
        });
    }, [resourceLabel, title]);

    const createInvitation = useCallback(async () => {
        if (!resourceId || creating) return;

        const payload: CreateShareInvitationPayload = {
            permission,
            ttlHours,
            maxAcceptCount,
        };

        setCreating(true);
        setLinkError(null);
        try {
            const invitation = resourceType === "schedule"
                ? await createScheduleShareInvitation(resourceId, payload)
                : await createCategoryShareInvitation(resourceId, payload);

            setInvitations((current) => [invitation, ...current.filter((item) => item.id !== invitation.id)]);

            if (!invitation.token) {
                setGeneratedLink(null);
                Alert.alert("초대 링크 생성", "초대는 생성됐지만 링크 토큰이 응답에 없습니다.");
                return;
            }

            const link = createShareInviteUrl(invitation.token);
            setGeneratedLink(link);
            await shareGeneratedLink(link);
        } catch (createError) {
            setLinkError(getErrorMessage(createError));
        } finally {
            setCreating(false);
        }
    }, [creating, maxAcceptCount, permission, resourceId, resourceType, shareGeneratedLink, ttlHours]);

    const createDirectShare = useCallback(async () => {
        if (!resourceId || sharingDirect) return;

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
            const payload: CreateDirectSharePayload = { ...target, permission };
            await (resourceType === "schedule"
                ? createScheduleShare(resourceId, payload)
                : createCategoryShare(resourceId, payload));

            setLastDirectShareLabel(target.targetEmail ?? `회원 #${target.targetAppId}`);
            setTargetQuery("");
        } catch (shareError) {
            setDirectError(getErrorMessage(shareError));
        } finally {
            setSharingDirect(false);
        }
    }, [permission, resourceId, resourceType, sharingDirect, targetQuery]);

    const submitting = shareMode === "direct" ? sharingDirect : creating;
    const submitDisabled = !canRequest || submitting || (shareMode === "direct" && !targetQuery.trim());

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View
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
                                name={resourceType === "schedule" ? "calendar-outline" : "folder-open-outline"}
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
                            accessibilityLabel="공유 닫기"
                            style={({ pressed }) => [
                                styles.closeButton,
                                { backgroundColor: colors.surface2, opacity: pressed ? 0.65 : 1 },
                            ]}
                        >
                            <Ionicons name="close" size={21} color={colors.textPrimary} />
                        </Pressable>
                    </View>

                    <View style={[styles.modeSegment, { backgroundColor: colors.surface2 }]}>
                        {([
                            { value: "direct" as const, label: "직접 공유", icon: "person-add-outline" as const },
                            { value: "link" as const, label: "링크 초대", icon: "link-outline" as const },
                        ]).map((option) => {
                            const selected = shareMode === option.value;
                            return (
                                <Pressable
                                    key={option.value}
                                    onPress={() => {
                                        setShareMode(option.value);
                                        if (option.value === "direct") setDirectError(null);
                                        else setLinkError(null);
                                    }}
                                    style={[
                                        styles.modeOption,
                                        selected && {
                                            backgroundColor: colors.surface,
                                            borderColor: colors.border,
                                        },
                                    ]}
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
                                            if (!submitDisabled) void createDirectShare();
                                        }}
                                        style={[styles.targetInput, { color: colors.textPrimary }]}
                                    />
                                    {!!targetQuery && (
                                        <Pressable
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
                                    <View style={[styles.directSuccess, { backgroundColor: `${highlight}18` }]}>
                                        <Ionicons name="checkmark-circle" size={19} color={highlight} />
                                        <Text style={[styles.directSuccessText, { color: colors.textPrimary }]} numberOfLines={1}>
                                            {lastDirectShareLabel}에게 공유했습니다
                                        </Text>
                                    </View>
                                )}
                                {!!directError && (
                                    <Text style={[styles.errorText, { color: "#FF453A" }]}>{directError}</Text>
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
                                {loading && <ActivityIndicator size="small" color={colors.textSecondary} />}
                            </View>
                            {linkError ? (
                                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                    {linkError}
                                </Text>
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
                                </View>
                            ) : (
                                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                    아직 생성한 공유 링크가 없어요.
                                </Text>
                            )}
                        </View>
                            </>
                        )}
                    </ScrollView>

                    <Pressable
                        disabled={submitDisabled}
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
                            <ActivityIndicator size="small" color="#FFFFFF" />
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
                </View>
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
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.34)",
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
    modeOption: {
        flex: 1,
        minWidth: 0,
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

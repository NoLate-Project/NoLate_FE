import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getShareInbox,
    getShareOutbox,
    revokeCategoryShare,
    revokeCategoryShareInvitation,
    revokeScheduleShare,
    revokeScheduleShareInvitation,
    type ShareInbox,
    type ShareInboxItem,
    type ShareInvitationSummary,
    type ShareOutbox,
    type ShareOutboxResource,
    type SharePendingInvitation,
    type ShareResourceType,
    type ScheduleShare,
} from "../../src/api/scheduleSharing";
import type { ScheduleSharePermission } from "../../src/modules/schedule/types";
import { createLatestAsyncRequestGuard } from "../../src/modules/share/latestAsyncRequest";
import {
    ShareInboxButton,
    ShareInboxDecoration,
} from "../../src/modules/share/ShareInboxAccessibility";
import { markShareInboxSeen } from "../../src/modules/share/shareAttention";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";

type ShareTab = "all" | "received" | "sent" | "links";

type ShareInboxViewData = {
    inbox: ShareInbox;
    outbox: ShareOutbox;
};

function normalizeTab(value?: string): ShareTab | null {
    if (value === "all" || value === "received" || value === "sent" || value === "links") return value;
    return null;
}

function getErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "공유함을 불러오지 못했습니다.";
    if (/403|forbidden|status code/i.test(message)) return "공유함을 불러올 권한을 확인할 수 없어요.";
    if (/network|timeout/i.test(message)) return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    return message;
}

function resourceLabel(type: ShareResourceType) {
    return type === "SCHEDULE" ? "일정" : "카테고리";
}

function permissionLabel(permission: ScheduleSharePermission) {
    switch (permission) {
        case "VIEWER":
            return "보기";
        case "COMMENTER":
            return "댓글";
        case "EDITOR":
            return "편집";
        case "OWNER":
            return "소유자";
        default:
            return permission;
    }
}

function formatDateLabel(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}.${day}`;
}

function formatExpirationBadge(value?: string | null) {
    const date = formatDateLabel(value);
    return date ? `${date}까지` : "만료일 확인";
}

export default function ShareInboxScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ tab?: string }>();
    const { colors, mode } = useTheme();
    const [selectedTab, setSelectedTab] = useState<ShareTab>(
        normalizeTab(params.tab) ?? "all"
    );
    const [data, setData] = useState<ShareInboxViewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
    const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const loadRequestGuardRef = useRef(createLatestAsyncRequestGuard("share-inbox"));
    const revokingInvitationRef = useRef<string | null>(null);
    const revokingShareRef = useRef<string | null>(null);
    const mountedRef = useRef(true);
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";
    const goBack = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace("/schedule");
    }, [router]);
    const openSharedResource = useCallback((type: ShareResourceType, id: string) => {
        if (type === "SCHEDULE") {
            router.push({ pathname: "/schedule/[id]", params: { id } });
        } else {
            router.push("/schedule/categories");
        }
    }, [router]);

    const loadShares = useCallback(async (loadMode: "initial" | "refresh" = "initial") => {
        if (!mountedRef.current) return;
        const ticket = loadRequestGuardRef.current.begin();
        if (loadMode === "refresh") {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        setError(null);
        try {
            const [inbox, outbox] = await Promise.all([
                getShareInbox(),
                getShareOutbox(),
            ]);
            if (!mountedRef.current || !loadRequestGuardRef.current.isCurrent(ticket)) return;
            setData({ inbox, outbox });
            markShareInboxSeen(inbox).catch(() => undefined);
        } catch (loadError) {
            if (!mountedRef.current || !loadRequestGuardRef.current.isCurrent(ticket)) return;
            setError(getErrorMessage(loadError));
        } finally {
            if (mountedRef.current && loadRequestGuardRef.current.isCurrent(ticket)) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        const loadRequestGuard = loadRequestGuardRef.current;
        mountedRef.current = true;
        loadShares();
        return () => {
            mountedRef.current = false;
            loadRequestGuard.invalidate();
        };
    }, [loadShares]);

    useEffect(() => {
        setSelectedTab(normalizeTab(params.tab) ?? "all");
    }, [params.tab]);

    const revokeInvitation = useCallback((invitation: ShareInvitationSummary) => {
        if (revokingInvitationId) return;

        Alert.alert(
            "공유 링크 비활성화",
            "이 링크로는 더 이상 공유를 수락할 수 없어요. 비활성화할까요?",
            [
                { text: "취소", style: "cancel" },
                {
                    text: "비활성화",
                    style: "destructive",
                    onPress: async () => {
                        if (revokingInvitationRef.current) return;
                        revokingInvitationRef.current = invitation.id;
                        setRevokingInvitationId(invitation.id);
                        setError(null);
                        try {
                            if (invitation.resourceType === "SCHEDULE") {
                                await revokeScheduleShareInvitation(invitation.resourceId, invitation.id);
                            } else {
                                await revokeCategoryShareInvitation(invitation.resourceId, invitation.id);
                            }
                            if (mountedRef.current) {
                                setData((current) => current ? {
                                    ...current,
                                    outbox: {
                                        ...current.outbox,
                                        activeInvitations: current.outbox.activeInvitations.filter(
                                            (item) => item.id !== invitation.id,
                                        ),
                                    },
                                } : current);
                            }
                            await loadShares("refresh");
                        } catch (revokeError) {
                            if (mountedRef.current) setError(getErrorMessage(revokeError));
                        } finally {
                            revokingInvitationRef.current = null;
                            if (mountedRef.current) setRevokingInvitationId(null);
                        }
                    },
                },
            ],
        );
    }, [loadShares, revokingInvitationId]);

    const revokeDirectShare = useCallback((resource: ShareOutboxResource, share: ScheduleShare) => {
        if (revokingShareId) return;

        const target = share.targetEmail?.trim() || `NoLate ID #${share.targetMemberId}`;
        Alert.alert(
            "공유 해제",
            `${target}님의 ${resourceLabel(resource.resourceType)} 공유를 해제할까요?`,
            [
                { text: "취소", style: "cancel" },
                {
                    text: "공유 해제",
                    style: "destructive",
                    onPress: async () => {
                        if (revokingShareRef.current) return;
                        revokingShareRef.current = share.id;
                        setRevokingShareId(share.id);
                        setError(null);
                        try {
                            if (resource.resourceType === "SCHEDULE") {
                                await revokeScheduleShare(resource.resourceId, share.id);
                            } else {
                                await revokeCategoryShare(resource.resourceId, share.id);
                            }
                            if (mountedRef.current) {
                                setData((current) => current ? {
                                    ...current,
                                    outbox: {
                                        ...current.outbox,
                                        sharedResources: current.outbox.sharedResources.map((item) => {
                                            if (
                                                item.resourceType !== resource.resourceType ||
                                                item.resourceId !== resource.resourceId
                                            ) return item;
                                            const shares = item.shares.filter((itemShare) => itemShare.id !== share.id);
                                            return { ...item, shares, shareCount: shares.length };
                                        }),
                                    },
                                } : current);
                            }
                            await loadShares("refresh");
                        } catch (revokeError) {
                            if (mountedRef.current) setError(getErrorMessage(revokeError));
                        } finally {
                            revokingShareRef.current = null;
                            if (mountedRef.current) setRevokingShareId(null);
                        }
                    },
                },
            ],
        );
    }, [loadShares, revokingShareId]);

    const summary = useMemo(() => ({
        pending: data?.inbox.pendingInvitations.length ?? 0,
        received: data?.inbox.receivedShares.length ?? 0,
        links: data?.outbox.activeInvitations.length ?? 0,
    }), [data]);

    return (
        <View
            style={[
                styles.root,
                {
                    backgroundColor: colors.background,
                    paddingTop: insets.top + 10,
                },
            ]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    onPress={goBack}
                    accessibilityLabel="뒤로 가기"
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>공유함</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                        disabled: loading || refreshing || Boolean(revokingInvitationId) || Boolean(revokingShareId),
                        busy: refreshing,
                    }}
                    disabled={loading || refreshing || Boolean(revokingInvitationId) || Boolean(revokingShareId)}
                    onPress={() => loadShares("refresh")}
                    accessibilityLabel="공유함 새로고침"
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    {refreshing ? (
                        <ActivityIndicator size="small" color={colors.textPrimary} />
                    ) : (
                        <Ionicons name="refresh" size={20} color={colors.textPrimary} />
                    )}
                </Pressable>
            </View>

            <View style={[styles.segmented, { backgroundColor: colors.surface2 }]}>
                <ShareTabButton
                    label="전체"
                    selected={selectedTab === "all"}
                    colors={colors}
                    onPress={() => setSelectedTab("all")}
                />
                <ShareTabButton
                    label="받은 공유"
                    selected={selectedTab === "received"}
                    colors={colors}
                    onPress={() => setSelectedTab("received")}
                />
                <ShareTabButton
                    label="내가 공유"
                    selected={selectedTab === "sent"}
                    colors={colors}
                    onPress={() => setSelectedTab("sent")}
                />
                <ShareTabButton
                    label="링크"
                    selected={selectedTab === "links"}
                    colors={colors}
                    onPress={() => setSelectedTab("links")}
                />
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadShares("refresh")}
                        tintColor={accent}
                    />
                }
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 18 },
                ]}
            >
                <View style={styles.summaryGrid}>
                    <SummaryTile label="대기 초대" value={summary.pending} colors={colors} />
                    <SummaryTile label="받은 항목" value={summary.received} colors={colors} />
                    <SummaryTile label="활성 링크" value={summary.links} colors={colors} />
                </View>

                {error && data ? (
                    <InlineErrorCard colors={colors} text={error} onRetry={() => loadShares("refresh")} />
                ) : null}

                {loading ? (
                    <StateCard colors={colors} text="공유함을 불러오는 중이에요" loading />
                ) : error && !data ? (
                    <StateCard colors={colors} text={error} onRetry={() => loadShares("refresh")} />
                ) : selectedTab === "all" ? (
                    <AllShareList
                        pendingInvitations={data?.inbox.pendingInvitations ?? []}
                        receivedShares={data?.inbox.receivedShares ?? []}
                        sentResources={data?.outbox.sharedResources ?? []}
                        colors={colors}
                        accent={accent}
                        revokingShareId={revokingShareId}
                        onOpenResource={openSharedResource}
                        onRevokeShare={revokeDirectShare}
                    />
                ) : selectedTab === "received" ? (
                    <ReceivedShareList
                        pendingInvitations={data?.inbox.pendingInvitations ?? []}
                        receivedShares={data?.inbox.receivedShares ?? []}
                        colors={colors}
                        accent={accent}
                        onOpenResource={openSharedResource}
                    />
                ) : selectedTab === "sent" ? (
                    <SentShareList
                        resources={data?.outbox.sharedResources ?? []}
                        colors={colors}
                        accent={accent}
                        revokingShareId={revokingShareId}
                        onOpenResource={openSharedResource}
                        onRevokeShare={revokeDirectShare}
                    />
                ) : (
                    <ActiveLinkList
                        invitations={data?.outbox.activeInvitations ?? []}
                        colors={colors}
                        accent={accent}
                        revokingInvitationId={revokingInvitationId}
                        onRevoke={revokeInvitation}
                    />
                )}
            </ScrollView>
        </View>
    );
}

function ShareTabButton({
    label,
    selected,
    colors,
    onPress,
}: {
    label: string;
    selected: boolean;
    colors: ReturnType<typeof useTheme>["colors"];
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={onPress}
            style={[
                styles.segment,
                selected && { backgroundColor: colors.surface },
            ]}
        >
            <Text style={[styles.segmentText, { color: selected ? colors.textPrimary : colors.textSecondary }]}>
                {label}
            </Text>
        </Pressable>
    );
}

function SummaryTile({
    label,
    value,
    colors,
}: {
    label: string;
    value: number;
    colors: ReturnType<typeof useTheme>["colors"];
}) {
    return (
        <View style={[styles.summaryTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>{value}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{label}</Text>
        </View>
    );
}

function AllShareList({
    pendingInvitations,
    receivedShares,
    sentResources,
    colors,
    accent,
    revokingShareId,
    onOpenResource,
    onRevokeShare,
}: {
    pendingInvitations: SharePendingInvitation[];
    receivedShares: ShareInboxItem[];
    sentResources: ShareOutboxResource[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    revokingShareId: string | null;
    onOpenResource: (type: ShareResourceType, id: string) => void;
    onRevokeShare: (resource: ShareOutboxResource, share: ScheduleShare) => void;
}) {
    const hasReceived = pendingInvitations.length > 0 || receivedShares.length > 0;
    const hasSent = sentResources.length > 0;

    if (!hasReceived && !hasSent) {
        return (
            <EmptyInlineCard
                colors={colors}
                icon="file-tray-outline"
                text="아직 받은 공유나 내가 공유 중인 항목이 없어요."
            />
        );
    }

    return (
        <View style={styles.sectionStack}>
            {hasReceived && (
                <>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>받은 공유</Text>
                    {pendingInvitations.map((invitation) => (
                        <PendingInvitationCard
                            key={invitation.id}
                            invitation={invitation}
                            colors={colors}
                            accent={accent}
                        />
                    ))}
                    {receivedShares.map((share) => (
                        <ReceivedShareCard
                            key={`${share.resourceType}-${share.shareId}`}
                            share={share}
                            colors={colors}
                            onPress={() => {
                                onOpenResource(share.resourceType, share.resourceId);
                            }}
                        />
                    ))}
                </>
            )}

            {hasSent && (
                <>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>내가 공유</Text>
                    {sentResources.map((resource) => (
                        <SentResourceCard
                            key={`${resource.resourceType}-${resource.resourceId}`}
                            resource={resource}
                            colors={colors}
                            accent={accent}
                            revokingShareId={revokingShareId}
                            onPress={() => {
                                onOpenResource(resource.resourceType, resource.resourceId);
                            }}
                            onRevokeShare={(share) => onRevokeShare(resource, share)}
                        />
                    ))}
                </>
            )}
        </View>
    );
}

function ReceivedShareList({
    pendingInvitations,
    receivedShares,
    colors,
    accent,
    onOpenResource,
}: {
    pendingInvitations: SharePendingInvitation[];
    receivedShares: ShareInboxItem[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    onOpenResource: (type: ShareResourceType, id: string) => void;
}) {
    return (
        <View style={styles.sectionStack}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>대기 중인 초대</Text>
            {pendingInvitations.length > 0 ? (
                pendingInvitations.map((invitation) => (
                    <PendingInvitationCard
                        key={invitation.id}
                        invitation={invitation}
                        colors={colors}
                        accent={accent}
                    />
                ))
            ) : (
                <EmptyInlineCard
                    colors={colors}
                    icon="link-outline"
                    text="링크 초대는 받은 사람이 링크를 열 때 수락돼요."
                />
            )}

            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>공유받은 항목</Text>
            {receivedShares.length > 0 ? (
                receivedShares.map((share) => (
                    <ReceivedShareCard
                        key={`${share.resourceType}-${share.shareId}`}
                        share={share}
                        colors={colors}
                        onPress={() => {
                            onOpenResource(share.resourceType, share.resourceId);
                        }}
                    />
                ))
            ) : (
                <EmptyInlineCard
                    colors={colors}
                    icon="people-outline"
                    text="아직 공유받은 일정이나 카테고리가 없어요."
                />
            )}
        </View>
    );
}

function SentShareList({
    resources,
    colors,
    accent,
    revokingShareId,
    onOpenResource,
    onRevokeShare,
}: {
    resources: ShareOutboxResource[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    revokingShareId: string | null;
    onOpenResource: (type: ShareResourceType, id: string) => void;
    onRevokeShare: (resource: ShareOutboxResource, share: ScheduleShare) => void;
}) {
    if (resources.length === 0) {
        return (
            <EmptyInlineCard
                colors={colors}
                icon="share-social-outline"
                text="내가 공유 중인 일정이나 카테고리가 없어요."
            />
        );
    }

    return (
        <View style={styles.sectionStack}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>공유 중인 항목</Text>
            {resources.map((resource) => (
                <SentResourceCard
                    key={`${resource.resourceType}-${resource.resourceId}`}
                    resource={resource}
                    colors={colors}
                    accent={accent}
                    revokingShareId={revokingShareId}
                    onPress={() => {
                        onOpenResource(resource.resourceType, resource.resourceId);
                    }}
                    onRevokeShare={(share) => onRevokeShare(resource, share)}
                />
            ))}
        </View>
    );
}

function ActiveLinkList({
    invitations,
    colors,
    accent,
    revokingInvitationId,
    onRevoke,
}: {
    invitations: ShareInvitationSummary[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    revokingInvitationId: string | null;
    onRevoke: (invitation: ShareInvitationSummary) => void;
}) {
    if (invitations.length === 0) {
        return (
            <EmptyInlineCard
                colors={colors}
                icon="link-outline"
                text="활성화된 공유 링크가 없어요."
            />
        );
    }

    return (
        <View style={styles.sectionStack}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>활성 링크</Text>
            {invitations.map((invitation) => (
                <LinkSummaryCard
                    key={invitation.id}
                    invitation={invitation}
                    colors={colors}
                    accent={accent}
                    revoking={revokingInvitationId === invitation.id}
                    disabled={Boolean(revokingInvitationId)}
                    onRevoke={() => onRevoke(invitation)}
                />
            ))}
        </View>
    );
}

function PendingInvitationCard({
    invitation,
    colors,
    accent,
}: {
    invitation: SharePendingInvitation;
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
}) {
    return (
        <View style={[styles.pendingCard, { backgroundColor: `${accent}14`, borderColor: `${accent}4D` }]}>
            <ShareResourceHeader
                type={invitation.resourceType}
                title={invitation.title}
                meta={`${invitation.ownerEmail ?? `ID ${invitation.ownerMemberId}`} · ${permissionLabel(invitation.permission)}`}
                color={invitation.color ?? accent}
                badge={formatExpirationBadge(invitation.expiresAt)}
                colors={colors}
            />
            <View style={styles.pendingHint}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.pendingHintText, { color: colors.textSecondary }]}>받은 초대 링크를 열어 수락할 수 있어요.</Text>
            </View>
        </View>
    );
}

function ReceivedShareCard({
    share,
    colors,
    onPress,
}: {
    share: ShareInboxItem;
    colors: ReturnType<typeof useTheme>["colors"];
    onPress: () => void;
}) {
    return (
        <ShareInboxButton
            accessibilityLabel={`${share.title}, ${resourceLabel(share.resourceType)}, ${permissionLabel(share.permission)} 권한, 열기`}
            onPress={onPress}
            style={({ pressed }) => [
                styles.rowCard,
                {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.72 : 1,
                },
            ]}
        >
            <ShareInboxDecoration>
                <ShareResourceHeader
                    type={share.resourceType}
                    title={share.title}
                    meta={`${resourceLabel(share.resourceType)} · ${share.ownerEmail ?? `ID ${share.ownerMemberId}`}`}
                    color={share.color ?? "#2F80FF"}
                    badge={permissionLabel(share.permission)}
                    colors={colors}
                />
            </ShareInboxDecoration>
        </ShareInboxButton>
    );
}

function SentResourceCard({
    resource,
    colors,
    accent,
    revokingShareId,
    onPress,
    onRevokeShare,
}: {
    resource: ShareOutboxResource;
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    revokingShareId: string | null;
    onPress: () => void;
    onRevokeShare: (share: ScheduleShare) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <View
            style={[
                styles.rowCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
        >
            <ShareInboxButton
                accessibilityLabel={`${resource.title} ${resourceLabel(resource.resourceType)} 열기`}
                onPress={onPress}
                style={({ pressed }) => [styles.resourceOpenButton, pressed && styles.pressed]}
            >
                <ShareInboxDecoration>
                    <ShareResourceHeader
                        type={resource.resourceType}
                        title={resource.title}
                        meta={`${resourceLabel(resource.resourceType)} · ${resource.shareCount}명 참여`}
                        color={resource.color ?? accent}
                        badge={`${resource.shareCount}명`}
                        colors={colors}
                    />
                </ShareInboxDecoration>
            </ShareInboxButton>

            {resource.shares.length > 0 ? (
                <>
                    <ShareInboxButton
                        accessibilityLabel={`${resource.title} 공유 대상 ${expanded ? "접기" : "관리"}`}
                        accessibilityState={{ expanded }}
                        onPress={() => setExpanded((current) => !current)}
                        style={({ pressed }) => [
                            styles.memberManageToggle,
                            { borderTopColor: colors.border, opacity: pressed ? 0.68 : 1 },
                        ]}
                    >
                        <ShareInboxDecoration style={styles.memberManageContent}>
                            <View style={styles.memberPreviewRow}>
                                {resource.shares.slice(0, 4).map((share, index) => (
                                    <View
                                        key={share.id}
                                        style={[
                                            styles.memberBubble,
                                            index > 0 && styles.memberBubbleOverlap,
                                            { backgroundColor: resource.color ?? accent },
                                        ]}
                                    >
                                        <Text style={styles.memberBubbleText}>
                                            {share.targetEmail?.slice(0, 1).toUpperCase() ?? String(share.targetMemberId).slice(-1)}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                            <Text style={[styles.memberManageText, { color: colors.textSecondary }]}>공유 대상 관리</Text>
                            <Ionicons
                                name={expanded ? "chevron-up" : "chevron-down"}
                                size={18}
                                color={colors.textSecondary}
                            />
                        </ShareInboxDecoration>
                    </ShareInboxButton>

                    {expanded ? (
                        <View style={[styles.participantList, { borderTopColor: colors.border }]}>
                            {resource.shares.map((share) => {
                                const target = share.targetEmail?.trim() || `NoLate ID #${share.targetMemberId}`;
                                const revoking = revokingShareId === share.id;
                                return (
                                    <View key={share.id} style={styles.participantRow}>
                                        <View
                                            style={[
                                                styles.participantAvatar,
                                                { backgroundColor: `${resource.color ?? accent}1F` },
                                            ]}
                                            importantForAccessibility="no-hide-descendants"
                                        >
                                            <Text style={[styles.participantAvatarText, { color: resource.color ?? accent }]}>
                                                {share.targetEmail?.slice(0, 1).toUpperCase() ?? String(share.targetMemberId).slice(-1)}
                                            </Text>
                                        </View>
                                        <View style={styles.participantCopy}>
                                            <Text style={[styles.participantName, { color: colors.textPrimary }]} numberOfLines={1}>
                                                {target}
                                            </Text>
                                            <Text style={[styles.participantPermission, { color: colors.textSecondary }]}>
                                                {permissionLabel(share.permission)} 권한
                                            </Text>
                                        </View>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`${target} 공유 해제`}
                                            accessibilityState={{ disabled: Boolean(revokingShareId), busy: revoking }}
                                            disabled={Boolean(revokingShareId)}
                                            onPress={() => onRevokeShare(share)}
                                            style={({ pressed }) => [
                                                styles.participantRevokeButton,
                                                {
                                                    borderColor: colors.border,
                                                    opacity: revokingShareId || pressed ? 0.58 : 1,
                                                },
                                            ]}
                                        >
                                            {revoking ? (
                                                <ActivityIndicator size="small" color={colors.textSecondary} />
                                            ) : (
                                                <Text style={[styles.participantRevokeText, { color: colors.textSecondary }]}>해제</Text>
                                            )}
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                    ) : null}
                </>
            ) : null}
        </View>
    );
}

function LinkSummaryCard({
    invitation,
    colors,
    accent,
    revoking,
    disabled,
    onRevoke,
}: {
    invitation: ShareInvitationSummary;
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    revoking: boolean;
    disabled: boolean;
    onRevoke: () => void;
}) {
    return (
        <View style={[styles.rowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ShareResourceHeader
                type={invitation.resourceType}
                title={invitation.title}
                meta={`${permissionLabel(invitation.permission)} · ${invitation.acceptedCount}/${invitation.maxAcceptCount}명 수락`}
                color={invitation.color ?? accent}
                badge={formatExpirationBadge(invitation.expiresAt)}
                colors={colors}
            />
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${invitation.title} 공유 링크 비활성화`}
                accessibilityState={{ disabled, busy: revoking }}
                disabled={disabled}
                onPress={onRevoke}
                style={({ pressed }) => [
                    styles.revokeButton,
                    { borderColor: colors.border, opacity: disabled || pressed ? 0.58 : 1 },
                ]}
            >
                {revoking ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                    <Ionicons name="link-outline" size={15} color={colors.textSecondary} />
                )}
                <Text
                    style={[styles.revokeButtonText, { color: colors.textSecondary }]}
                >
                    {revoking ? "비활성화 중" : "링크 비활성화"}
                </Text>
            </Pressable>
        </View>
    );
}

function InlineErrorCard({
    colors,
    text,
    onRetry,
}: {
    colors: ReturnType<typeof useTheme>["colors"];
    text: string;
    onRetry: () => void;
}) {
    return (
        <View
            accessibilityLiveRegion="polite"
            style={[styles.inlineErrorCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
            <Ionicons name="alert-circle-outline" size={18} color="#D97706" />
            <Text numberOfLines={2} style={[styles.inlineErrorText, { color: colors.textSecondary }]}>{text}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="공유함 다시 조회"
                onPress={onRetry}
                hitSlop={8}
            >
                <Text style={[styles.inlineErrorRetry, { color: colors.textPrimary }]}>다시 시도</Text>
            </Pressable>
        </View>
    );
}

function ShareResourceHeader({
    type,
    title,
    meta,
    color,
    badge,
    colors,
}: {
    type: ShareResourceType;
    title: string;
    meta: string;
    color: string;
    badge: string;
    colors: ReturnType<typeof useTheme>["colors"];
}) {
    return (
        <View style={styles.resourceHeader}>
            <View style={[styles.resourceIcon, { backgroundColor: `${color}1F` }]}>
                <Ionicons
                    name={type === "SCHEDULE" ? "calendar-outline" : "folder-open-outline"}
                    size={20}
                    color={color}
                />
            </View>
            <View style={styles.resourceText}>
                <Text style={[styles.resourceTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                    {title}
                </Text>
                <Text style={[styles.resourceMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {meta}
                </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{badge}</Text>
            </View>
        </View>
    );
}

function EmptyInlineCard({
    colors,
    icon,
    text,
}: {
    colors: ReturnType<typeof useTheme>["colors"];
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
}) {
    return (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ShareInboxDecoration>
                <Ionicons name={icon} size={20} color={colors.textSecondary} />
            </ShareInboxDecoration>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{text}</Text>
        </View>
    );
}

function StateCard({
    colors,
    text,
    loading = false,
    onRetry,
}: {
    colors: ReturnType<typeof useTheme>["colors"];
    text: string;
    loading?: boolean;
    onRetry?: () => void;
}) {
    if (loading) {
        return (
            <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={text}
                accessibilityLiveRegion="polite"
                style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
                <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.stateCardContent}
                >
                    <BrandedLoader
                        size="section"
                        variant="share"
                        accessibilityLabel={text}
                    />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{text}</Text>
                </View>
            </View>
        );
    }

    return (
        <View
            accessibilityLiveRegion="polite"
            style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{text}</Text>
            {!!onRetry && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유함 다시 조회"
                    onPress={onRetry}
                    style={[styles.retryButton, { borderColor: colors.border }]}
                >
                    <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 조회</Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        height: 58,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: "900",
        letterSpacing: 0,
    },
    segmented: {
        height: 44,
        marginHorizontal: 20,
        borderRadius: 22,
        padding: 4,
        flexDirection: "row",
        gap: 4,
    },
    segment: {
        flex: 1,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    segmentText: {
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
    content: {
        paddingHorizontal: 20,
        paddingTop: 16,
        gap: 14,
    },
    summaryGrid: {
        flexDirection: "row",
        gap: 8,
    },
    summaryTile: {
        flex: 1,
        minHeight: 74,
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
        justifyContent: "space-between",
    },
    summaryValue: {
        fontSize: 22,
        fontWeight: "900",
        letterSpacing: 0,
    },
    summaryLabel: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sectionStack: {
        gap: 10,
    },
    sectionTitle: {
        marginTop: 4,
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    pendingCard: {
        borderWidth: 1,
        borderRadius: 20,
        padding: 14,
        gap: 12,
    },
    pendingHint: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    pendingHintText: {
        flex: 1,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 17,
    },
    rowCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 13,
        gap: 10,
    },
    resourceOpenButton: {
        minHeight: 44,
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.68,
    },
    resourceHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    resourceIcon: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: "center",
        justifyContent: "center",
    },
    resourceText: {
        flex: 1,
        minWidth: 0,
    },
    resourceTitle: {
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
    resourceMeta: {
        marginTop: 3,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0,
    },
    badge: {
        minWidth: 44,
        height: 27,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
    },
    memberPreviewRow: {
        flexDirection: "row",
        alignItems: "center",
        minWidth: 32,
    },
    memberBubble: {
        width: 27,
        height: 27,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
    },
    memberBubbleText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0,
    },
    memberBubbleOverlap: {
        marginLeft: -7,
    },
    memberManageToggle: {
        minHeight: 44,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 10,
        justifyContent: "center",
    },
    memberManageContent: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    memberManageText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "800",
    },
    participantList: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 6,
    },
    participantRow: {
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    participantAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
    },
    participantAvatarText: {
        fontSize: 12,
        fontWeight: "900",
    },
    participantCopy: {
        flex: 1,
        minWidth: 0,
    },
    participantName: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "800",
    },
    participantPermission: {
        marginTop: 1,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
    },
    participantRevokeButton: {
        minWidth: 54,
        minHeight: 36,
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    participantRevokeText: {
        fontSize: 12,
        fontWeight: "900",
    },
    revokeButton: {
        alignSelf: "flex-end",
        minHeight: 36,
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    revokeButtonText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
    },
    inlineErrorCard: {
        minHeight: 56,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 13,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    inlineErrorText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    inlineErrorRetry: {
        fontSize: 12,
        fontWeight: "900",
    },
    emptyCard: {
        minHeight: 76,
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    emptyText: {
        flex: 1,
        fontSize: 14,
        fontWeight: "700",
        lineHeight: 20,
        letterSpacing: 0,
    },
    stateCard: {
        minHeight: 130,
        borderWidth: 1,
        borderRadius: 20,
        padding: 18,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
    },
    stateCardContent: {
        alignItems: "center",
        gap: 10,
    },
    retryButton: {
        height: 38,
        borderWidth: 1,
        borderRadius: 19,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    retryText: {
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
});

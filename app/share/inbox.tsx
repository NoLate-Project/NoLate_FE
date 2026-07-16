import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getShareInbox,
    getShareOutbox,
    type ShareInbox,
    type ShareInboxItem,
    type ShareInvitationSummary,
    type ShareOutbox,
    type ShareOutboxResource,
    type SharePendingInvitation,
    type ShareResourceType,
} from "../../src/api/scheduleSharing";
import type { ScheduleSharePermission } from "../../src/modules/schedule/types";
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
    const [error, setError] = useState<string | null>(null);
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";

    const loadShares = useCallback(async (mode: "initial" | "refresh" = "initial") => {
        if (mode === "refresh") {
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
            setData({ inbox, outbox });
            markShareInboxSeen(inbox).catch(() => undefined);
        } catch (loadError) {
            setError(getErrorMessage(loadError));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadShares();
    }, [loadShares]);

    useEffect(() => {
        setSelectedTab(normalizeTab(params.tab) ?? "all");
    }, [params.tab]);

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
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    accessibilityLabel="뒤로 가기"
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>공유함</Text>
                <Pressable
                    onPress={() => loadShares("refresh")}
                    accessibilityLabel="공유함 새로고침"
                    style={[styles.headerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons name="refresh" size={20} color={colors.textPrimary} />
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
                        onOpenSchedule={(id) => router.push({ pathname: "/schedule/[id]", params: { id } })}
                    />
                ) : selectedTab === "received" ? (
                    <ReceivedShareList
                        pendingInvitations={data?.inbox.pendingInvitations ?? []}
                        receivedShares={data?.inbox.receivedShares ?? []}
                        colors={colors}
                        accent={accent}
                        onOpenSchedule={(id) => router.push({ pathname: "/schedule/[id]", params: { id } })}
                    />
                ) : selectedTab === "sent" ? (
                    <SentShareList
                        resources={data?.outbox.sharedResources ?? []}
                        colors={colors}
                        accent={accent}
                        onOpenSchedule={(id) => router.push({ pathname: "/schedule/[id]", params: { id } })}
                    />
                ) : (
                    <ActiveLinkList
                        invitations={data?.outbox.activeInvitations ?? []}
                        colors={colors}
                        accent={accent}
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
    onOpenSchedule,
}: {
    pendingInvitations: SharePendingInvitation[];
    receivedShares: ShareInboxItem[];
    sentResources: ShareOutboxResource[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    onOpenSchedule: (id: string) => void;
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
                                if (share.resourceType === "SCHEDULE") onOpenSchedule(share.resourceId);
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
                            onPress={() => {
                                if (resource.resourceType === "SCHEDULE") onOpenSchedule(resource.resourceId);
                            }}
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
    onOpenSchedule,
}: {
    pendingInvitations: SharePendingInvitation[];
    receivedShares: ShareInboxItem[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    onOpenSchedule: (id: string) => void;
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
                            if (share.resourceType === "SCHEDULE") onOpenSchedule(share.resourceId);
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
    onOpenSchedule,
}: {
    resources: ShareOutboxResource[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    onOpenSchedule: (id: string) => void;
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
                    onPress={() => {
                        if (resource.resourceType === "SCHEDULE") onOpenSchedule(resource.resourceId);
                    }}
                />
            ))}
        </View>
    );
}

function ActiveLinkList({
    invitations,
    colors,
    accent,
}: {
    invitations: ShareInvitationSummary[];
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
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
                badge={`~${formatDateLabel(invitation.expiresAt)}`}
                colors={colors}
            />
            <View style={styles.pendingActions}>
                <View style={[styles.secondaryAction, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.secondaryActionText, { color: colors.textPrimary }]}>나중에</Text>
                </View>
                <View style={[styles.primaryAction, { backgroundColor: accent }]}>
                    <Text style={styles.primaryActionText}>링크 열기</Text>
                </View>
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
        <Pressable
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
            <ShareResourceHeader
                type={share.resourceType}
                title={share.title}
                meta={`${resourceLabel(share.resourceType)} · ${share.ownerEmail ?? `ID ${share.ownerMemberId}`}`}
                color={share.color ?? "#2F80FF"}
                badge={permissionLabel(share.permission)}
                colors={colors}
            />
        </Pressable>
    );
}

function SentResourceCard({
    resource,
    colors,
    accent,
    onPress,
}: {
    resource: ShareOutboxResource;
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
    onPress: () => void;
}) {
    return (
        <Pressable
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
            <ShareResourceHeader
                type={resource.resourceType}
                title={resource.title}
                meta={`${resourceLabel(resource.resourceType)} · ${resource.shareCount}명 참여`}
                color={resource.color ?? accent}
                badge={`${resource.shareCount}명`}
                colors={colors}
            />
            <View style={styles.memberPreviewRow}>
                {resource.shares.slice(0, 4).map((share, index) => (
                    <View
                        key={share.id}
                        style={[
                            styles.memberBubble,
                            {
                                backgroundColor: resource.color ?? accent,
                                marginLeft: index === 0 ? 0 : -7,
                            },
                        ]}
                    >
                        <Text style={styles.memberBubbleText}>
                            {share.targetEmail?.slice(0, 1).toUpperCase() ?? String(share.targetMemberId).slice(-1)}
                        </Text>
                    </View>
                ))}
            </View>
        </Pressable>
    );
}

function LinkSummaryCard({
    invitation,
    colors,
    accent,
}: {
    invitation: ShareInvitationSummary;
    colors: ReturnType<typeof useTheme>["colors"];
    accent: string;
}) {
    return (
        <View style={[styles.rowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ShareResourceHeader
                type={invitation.resourceType}
                title={invitation.title}
                meta={`${permissionLabel(invitation.permission)} · ${invitation.acceptedCount}/${invitation.maxAcceptCount}명 수락`}
                color={invitation.color ?? accent}
                badge={`~${formatDateLabel(invitation.expiresAt)}`}
                colors={colors}
            />
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
            <Ionicons name={icon} size={20} color={colors.textSecondary} />
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
    return (
        <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {loading ? (
                <BrandedLoader
                    size="section"
                    variant="share"
                    accessibilityLabel={text}
                />
            ) : null}
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{text}</Text>
            {!!onRetry && (
                <Pressable onPress={onRetry} style={[styles.retryButton, { borderColor: colors.border }]}>
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
    pendingActions: {
        flexDirection: "row",
        gap: 8,
    },
    primaryAction: {
        flex: 1,
        height: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    primaryActionText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "900",
        letterSpacing: 0,
    },
    secondaryAction: {
        flex: 1,
        height: 42,
        borderWidth: 1,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryActionText: {
        fontSize: 14,
        fontWeight: "900",
        letterSpacing: 0,
    },
    rowCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 13,
        gap: 10,
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
        paddingLeft: 53,
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

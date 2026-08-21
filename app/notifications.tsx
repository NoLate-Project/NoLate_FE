import styles from "./notifications.styles";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AppState,
    FlatList,
    Pressable,
    RefreshControl,
    StatusBar,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getAppNotificationInbox,
    markAllAppNotificationsRead,
    markAppNotificationRead,
    type AppNotification,
} from "../src/api/notification";
import {
    formatAppNotificationTime,
    getAppNotificationNavigationTarget,
    getAppNotificationVisual,
    type AppNotificationTone,
} from "../src/modules/notification/appNotificationPresentation";
import { createScheduleDetailRoute } from "../src/modules/notification/pushNavigation";
import {
    runAfterScreenTransition,
    type ScreenTransitionTask,
} from "../src/modules/performance/runAfterScreenTransition";
import {
    useTheme,
    type AppColors,
    type ColorMode,
} from "../src/modules/theme/ThemeContext";
import { BrandedLoadingState } from "../src/ui/BrandedLoader";

type InboxFilter = "all" | "unread";
type LoadMode = "initial" | "refresh";

const PAGE_SIZE = 30;

export default function AppNotificationScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const { colors, mode } = useTheme();
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [items, setItems] = useState<AppNotification[]>([]);
    const [nextCursor, setNextCursor] = useState<number | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [markingAllRead, setMarkingAllRead] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestSequenceRef = useRef(0);
    const mountedRef = useRef(true);
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";

    const goBack = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace("/schedule");
    }, [router]);

    const loadFirstPage = useCallback(async (loadMode: LoadMode = "initial") => {
        const requestSequence = ++requestSequenceRef.current;
        if (loadMode === "refresh") setRefreshing(true);
        else setLoading(true);
        setError(null);

        try {
            const page = await getAppNotificationInbox({
                limit: PAGE_SIZE,
                unreadOnly: filter === "unread",
            });
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            setItems(page.items);
            setNextCursor(page.nextCursor);
            setUnreadCount(page.unreadCount);
        } catch (loadError) {
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            setError(getInboxErrorMessage(loadError));
        } finally {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [filter]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestSequenceRef.current += 1;
        };
    }, []);

    useEffect(() => {
        if (!isFocused) return undefined;

        let interactionTask: ScreenTransitionTask | null = null;
        const scheduleLoad = (loadMode: LoadMode = "initial") => {
            interactionTask?.cancel();
            interactionTask = runAfterScreenTransition(() => {
                interactionTask = null;
                loadFirstPage(loadMode);
            });
        };

        scheduleLoad();
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") scheduleLoad("refresh");
        });
        return () => {
            interactionTask?.cancel();
            subscription.remove();
            requestSequenceRef.current += 1;
        };
    }, [isFocused, loadFirstPage]);

    const loadMore = useCallback(async () => {
        if (!nextCursor || loadingMore) return;

        const cursor = nextCursor;
        const requestSequence = ++requestSequenceRef.current;
        setLoadingMore(true);
        setError(null);
        try {
            const page = await getAppNotificationInbox({
                cursorId: cursor,
                limit: PAGE_SIZE,
                unreadOnly: filter === "unread",
            });
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            setItems((current) => {
                const existingIds = new Set(current.map((item) => item.id));
                return [...current, ...page.items.filter((item) => !existingIds.has(item.id))];
            });
            setNextCursor(page.nextCursor);
            setUnreadCount(page.unreadCount);
        } catch (loadError) {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setError(getInboxErrorMessage(loadError));
            }
        } finally {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setLoadingMore(false);
            }
        }
    }, [filter, loadingMore, nextCursor]);

    const markOneReadLocally = useCallback((notification: AppNotification) => {
        if (notification.read) return;
        setUnreadCount((current) => Math.max(0, current - 1));
        setItems((current) => filter === "unread"
            ? current.filter((item) => item.id !== notification.id)
            : current.map((item) => item.id === notification.id
                ? { ...item, read: true, readAt: new Date().toISOString() }
                : item));
    }, [filter]);

    const openNotification = useCallback((notification: AppNotification) => {
        markOneReadLocally(notification);
        if (!notification.read) {
            markAppNotificationRead(notification.id)
                .catch(() => {
                    if (mountedRef.current) loadFirstPage("refresh");
                });
        }

        const target = getAppNotificationNavigationTarget(notification);
        if (target?.kind === "scheduleDetail") {
            router.push(createScheduleDetailRoute(target.scheduleId));
        } else if (target?.kind === "shareInbox") {
            router.push("/share/inbox");
        }
    }, [loadFirstPage, markOneReadLocally, router]);

    const markAllRead = useCallback(async () => {
        if (unreadCount === 0 || markingAllRead) return;

        setMarkingAllRead(true);
        setError(null);
        try {
            await markAllAppNotificationsRead();
            if (!mountedRef.current) return;
            setUnreadCount(0);
            setItems((current) => filter === "unread"
                ? []
                : current.map((item) => ({
                    ...item,
                    read: true,
                    readAt: item.readAt ?? new Date().toISOString(),
                })));
        } catch (markError) {
            if (mountedRef.current) setError(getInboxErrorMessage(markError));
        } finally {
            if (mountedRef.current) setMarkingAllRead(false);
        }
    }, [filter, markingAllRead, unreadCount]);

    const renderItem = useCallback(({ item }: { item: AppNotification }) => (
        <NotificationRow
            notification={item}
            colors={colors}
            mode={mode}
            accent={accent}
            onPress={() => openNotification(item)}
        />
    ), [accent, colors, mode, openNotification]);

    const emptyTitle = filter === "unread" ? "읽지 않은 알림이 없어요" : "아직 도착한 알림이 없어요";
    const emptyCaption = filter === "unread"
        ? "새 알림이 오면 여기에 모아둘게요."
        : "일정 공유와 출발 소식을 놓치지 않게 모아둘게요.";

    return (
        <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="뒤로 가기"
                    hitSlop={10}
                    onPress={goBack}
                    style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
                >
                    <Ionicons name="chevron-back" size={27} color={colors.textPrimary} />
                </Pressable>
                <View style={styles.headerTitleGroup}>
                    <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>알림</Text>
                    {unreadCount > 0 ? (
                        <View style={[styles.headerCount, { backgroundColor: accent }]}>
                            <Text style={styles.headerCountText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                        </View>
                    ) : null}
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="알림 모두 읽음 처리"
                    accessibilityState={{ disabled: unreadCount === 0 || markingAllRead }}
                    disabled={unreadCount === 0 || markingAllRead}
                    hitSlop={8}
                    onPress={markAllRead}
                    style={({ pressed }) => [
                        styles.markAllButton,
                        { opacity: unreadCount === 0 ? 0.34 : pressed ? 0.62 : 1 },
                    ]}
                >
                    <Ionicons name="checkmark-done" size={21} color={accent} />
                    <Text style={[styles.markAllText, { color: accent }]}>모두 읽음</Text>
                </Pressable>
            </View>

            <View style={[styles.filterBar, { backgroundColor: colors.surface2 }]}>
                {(["all", "unread"] as const).map((value) => {
                    const selected = filter === value;
                    return (
                        <Pressable
                            key={value}
                            accessibilityRole="tab"
                            accessibilityState={{ selected }}
                            onPress={() => setFilter(value)}
                            style={[
                                styles.filterButton,
                                selected && {
                                    backgroundColor: colors.surface,
                                    borderColor: colors.border,
                                },
                            ]}
                        >
                            <Text style={[
                                styles.filterText,
                                { color: selected ? colors.textPrimary : colors.textSecondary },
                            ]}>
                                {value === "all" ? "전체" : "읽지 않음"}
                            </Text>
                            {value === "unread" && unreadCount > 0 ? (
                                <View style={[styles.filterDot, { backgroundColor: accent }]} />
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>

            {loading && items.length === 0 ? (
                <BrandedLoadingState
                    accessibilityLabel="알림 불러오는 중"
                    title="알림을 불러오고 있어요"
                    fill
                />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderItem}
                    contentContainerStyle={[
                        styles.listContent,
                        items.length === 0 && styles.emptyListContent,
                        { paddingBottom: Math.max(insets.bottom, 16) + 20 },
                    ]}
                    refreshControl={(
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => loadFirstPage("refresh")}
                            tintColor={accent}
                        />
                    )}
                    ListHeaderComponent={error ? (
                        <View
                            accessibilityRole="alert"
                            style={[styles.errorBanner, { backgroundColor: colors.surface2 }]}
                        >
                            <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
                            <Pressable accessibilityRole="button" onPress={() => loadFirstPage("refresh")}>
                                <Text style={[styles.retryText, { color: accent }]}>다시 시도</Text>
                            </Pressable>
                        </View>
                    ) : null}
                    ListEmptyComponent={(
                        <View style={styles.emptyState}>
                            <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
                                <Ionicons name="notifications-outline" size={29} color={colors.textSecondary} />
                            </View>
                            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{emptyTitle}</Text>
                            <Text style={[styles.emptyCaption, { color: colors.textSecondary }]}>{emptyCaption}</Text>
                        </View>
                    )}
                    ListFooterComponent={nextCursor ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="이전 알림 더 보기"
                            disabled={loadingMore}
                            onPress={loadMore}
                            style={({ pressed }) => [
                                styles.loadMoreButton,
                                { borderColor: colors.border, opacity: pressed ? 0.62 : 1 },
                            ]}
                        >
                            <Text style={[styles.loadMoreText, { color: colors.textPrimary }]}>
                                {loadingMore ? "불러오는 중" : "이전 알림 더 보기"}
                            </Text>
                            {!loadingMore ? (
                                <Ionicons name="chevron-down" size={17} color={colors.textSecondary} />
                            ) : null}
                        </Pressable>
                    ) : null}
                    showsVerticalScrollIndicator={false}
                />
            )}
        </View>
    );
}

function NotificationRow({
    notification,
    colors,
    mode,
    accent,
    onPress,
}: {
    notification: AppNotification;
    colors: AppColors;
    mode: ColorMode;
    accent: string;
    onPress: () => void;
}) {
    const visual = getAppNotificationVisual(notification.type);
    const tone = getToneColors(visual.tone, mode, colors);
    const time = formatAppNotificationTime(notification.createdAt);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${notification.read ? "" : "읽지 않은 알림, "}${notification.title}, ${notification.body}`}
            onPress={onPress}
            style={({ pressed }) => [
                styles.notificationRow,
                { borderBottomColor: colors.border },
                !notification.read && {
                    backgroundColor: mode === "dark"
                        ? "rgba(47,128,255,0.10)"
                        : "rgba(47,128,255,0.055)",
                },
                pressed && { backgroundColor: colors.surface2 },
            ]}
        >
            <View style={[styles.rowIcon, { backgroundColor: tone.background }]}>
                <Ionicons name={visual.icon} size={21} color={tone.foreground} />
            </View>
            <View style={styles.rowContent}>
                <View style={styles.rowTitleLine}>
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.rowTitle,
                            { color: colors.textPrimary },
                            !notification.read && styles.rowTitleUnread,
                        ]}
                    >
                        {notification.title}
                    </Text>
                    {time ? (
                        <Text style={[styles.rowTime, { color: colors.textSecondary }]}>{time}</Text>
                    ) : null}
                </View>
                <Text
                    numberOfLines={2}
                    style={[styles.rowBody, { color: colors.textSecondary }]}
                >
                    {notification.body}
                </Text>
            </View>
            {!notification.read ? (
                <View accessibilityElementsHidden style={[styles.unreadDot, { backgroundColor: accent }]} />
            ) : null}
        </Pressable>
    );
}

function getToneColors(tone: AppNotificationTone, mode: ColorMode, colors: AppColors) {
    if (tone === "blue") {
        return mode === "dark"
            ? { background: "rgba(87,151,255,0.18)", foreground: "#8BB7FF" }
            : { background: "#EAF2FF", foreground: "#2F80FF" };
    }
    if (tone === "green") {
        return mode === "dark"
            ? { background: "rgba(52,199,89,0.16)", foreground: "#54D978" }
            : { background: "#E8F7EF", foreground: "#168A4F" };
    }
    if (tone === "orange") {
        return mode === "dark"
            ? { background: "rgba(255,159,10,0.17)", foreground: "#FFB340" }
            : { background: "#FFF1E2", foreground: "#D66B16" };
    }
    return { background: colors.surface2, foreground: colors.textSecondary };
}

function getInboxErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "알림을 불러오지 못했어요.";
    if (/network|timeout/i.test(message)) return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    return message;
}

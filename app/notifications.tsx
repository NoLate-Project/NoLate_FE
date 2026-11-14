import styles from "../src/routeSupport/notifications.styles";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Animated,
    Easing,
    type View as NativeView,
    AppState,
    FlatList,
    Pressable,
    RefreshControl,
    StatusBar,
    Text,
    View,
    useWindowDimensions,
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
    getAppNotificationCopy,
    getAppNotificationNavigationTarget,
    getAppNotificationVisual,
    type AppNotificationTone,
} from "../src/modules/notification/appNotificationPresentation";
import { emitAppNotificationReceived } from "../src/modules/notification/appNotificationEvents";
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
import { useScreenFirstPaintPerformance } from "../src/modules/performance/useScreenFirstPaintPerformance";
import ScreenFirstPaintShell from "../src/modules/performance/ScreenFirstPaintShell";
import { useDeferredScreenContent } from "../src/modules/performance/useDeferredScreenContent";
import { useImmediateNavigationTransition } from "../src/modules/performance/ImmediateNavigationTransition";
import { useSystemReduceMotion } from "../src/modules/performance/useSystemReduceMotion";

type InboxFilter = "all" | "unread";
type LoadMode = "initial" | "refresh";

const PAGE_SIZE = 30;

export default function AppNotificationRoute() {
    useScreenFirstPaintPerformance('/notifications');
    const contentReady = useDeferredScreenContent();
    if (!contentReady) {
        return (
            <ScreenFirstPaintShell
                title="알림"
                backAccessibilityLabel="뒤로 가기"
                testID="notifications-first-paint-shell"
            />
        );
    }
    return <AppNotificationScreen />;
}

export function AppNotificationScreen() {
    const router = useRouter();
    const { runWithTransitionShell } = useImmediateNavigationTransition();
    const insets = useSafeAreaInsets();
    const isFocused = useIsFocused();
    const { colors, mode } = useTheme();
    const { fontScale } = useWindowDimensions();
    const largeText = fontScale > 1.35;
    const [filter, setFilter] = useState<InboxFilter>("all");
    const activeFilter = useRef<InboxFilter>("all");
    const loadedFilter = useRef<InboxFilter | null>(null);
    const [items, setItems] = useState<AppNotification[]>([]);
    const [nextCursor, setNextCursor] = useState<number | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [markingAllRead, setMarkingAllRead] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pageError, setPageError] = useState(false);
    const requestSequenceRef = useRef(0);
    const mountedRef = useRef(true);
    const filterOpacity = useRef(new Animated.Value(1)).current;
    const reduceMotion = useSystemReduceMotion();
    const unreadTab = useRef<NativeView>(null);
    const rowRefs = useRef(new Map<number, NativeView>());
    const pendingFocus = useRef<{ id?: number; filter: InboxFilter; waitsForBlur?: boolean } | null>(null);
    const pendingReads = useRef(new Map<number, Promise<void>>());
    const markingAllRef = useRef(false);
    const [readCompletion, setReadCompletion] = useState(0);
    const completedReadAnimation = useRef(0);
    const checkProgress = useRef(new Animated.Value(1)).current;
    const showCheck = filter === "unread" && !loading && !error && items.length === 0 && unreadCount === 0;

    useEffect(() => {
        if (reduceMotion) {
            filterOpacity.stopAnimation();
            filterOpacity.setValue(1);
        }
    }, [filterOpacity, reduceMotion]);

    useEffect(() => {
        if (!isFocused || !showCheck) return;
        const isNewCompletion = completedReadAnimation.current !== readCompletion;
        completedReadAnimation.current = readCompletion;
        if (reduceMotion || !isNewCompletion) {
            checkProgress.setValue(1);
            return;
        }
        checkProgress.setValue(0);
        const animation = Animated.timing(checkProgress, {
            toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [checkProgress, isFocused, readCompletion, reduceMotion, showCheck]);

    useEffect(() => {
        const pending = pendingFocus.current;
        if (!pending || pending.filter !== filter) return;
        if (!isFocused) {
            pending.waitsForBlur = false;
            return;
        }
        if (pending.waitsForBlur) return;
        const frame = requestAnimationFrame(() => {
            const node = (pending.id === undefined ? null : rowRefs.current.get(pending.id)) ?? unreadTab.current;
            pendingFocus.current = null;
            if (node) AccessibilityInfo.sendAccessibilityEvent?.(node, "focus");
        });
        return () => cancelAnimationFrame(frame);
    }, [filter, isFocused, items]);

    const accent = mode === "dark" ? "#8BB7FF" : "#1C5DB7";

    const goBack = useCallback(() => {
        runWithTransitionShell(
            { route: '/schedule', title: '일정', showBack: false },
            () => {
                if (router.canGoBack()) router.back();
                else router.replace("/schedule");
            },
        );
    }, [router, runWithTransitionShell]);

    const loadFirstPage = useCallback(async (loadMode: LoadMode = "initial") => {
        if (markingAllRef.current) return;
        const requestSequence = ++requestSequenceRef.current;
        setLoadingMore(false);
        setPageError(false);
        if (loadMode === "refresh") setRefreshing(true);
        else setLoading(true);
        setError(null);

        try {
            await Promise.all(pendingReads.current.values());
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            const page = await getAppNotificationInbox({
                limit: PAGE_SIZE,
                unreadOnly: filter === "unread",
            });
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
            loadedFilter.current = filter;
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

        if (loadedFilter.current !== filter) scheduleLoad();
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") scheduleLoad("refresh");
        });
        return () => {
            interactionTask?.cancel();
            subscription.remove();
        };
    }, [filter, isFocused, loadFirstPage]);

    const changeFilter = (next: InboxFilter) => {
        if (next === activeFilter.current || markingAllRef.current) return;
        pendingFocus.current = null;
        activeFilter.current = next;
        loadedFilter.current = null;
        requestSequenceRef.current += 1;
        setItems([]);
        setNextCursor(null);
        setLoading(true);
        setRefreshing(false);
        setLoadingMore(false);
        setError(null);
        setPageError(false);
        setFilter(next);
        if (!reduceMotion) {
            filterOpacity.setValue(0.7);
            Animated.timing(filterOpacity, {
                toValue: 1,
                duration: 140,
                useNativeDriver: true,
            }).start();
        }
    };

    const loadMore = useCallback(async () => {
        if (!nextCursor || loadingMore || refreshing || markingAllRef.current) return;

        const cursor = nextCursor;
        const requestSequence = ++requestSequenceRef.current;
        setLoadingMore(true);
        setPageError(false);
        try {
            await Promise.all(pendingReads.current.values());
            if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
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
        } catch {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setPageError(true);
            }
        } finally {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setLoadingMore(false);
            }
        }
    }, [filter, loadingMore, nextCursor, refreshing]);

    const openNotification = useCallback((notification: AppNotification) => {
        if (markingAllRef.current || pendingReads.current.has(notification.id)) return;
        const target = getAppNotificationNavigationTarget(notification);
        const index = items.findIndex(item => item.id === notification.id);
        const isUnreadResult = filter === "unread" && !notification.read;
        if (target || isUnreadResult) {
            pendingFocus.current = {
                filter,
                waitsForBlur: !!target,
                id: isUnreadResult ? items[index + 1]?.id ?? items[index - 1]?.id : notification.id,
            };
        }

        if (!notification.read) {
            const isLast = unreadCount === 1 && filter === "unread";
            requestSequenceRef.current += 1;
            setLoading(false);
            setRefreshing(false);
            setLoadingMore(false);
            setUnreadCount(count => Math.max(0, count - 1));

            setItems(current => filter === "unread"
                ? current.filter(item => item.id !== notification.id)
                : current.map(item => item.id === notification.id
                    ? { ...item, read: true, readAt: new Date().toISOString() }
                    : item));
            const read = markAppNotificationRead(notification.id)
                .then(() => {
                    emitAppNotificationReceived();
                    if (isLast && mountedRef.current && activeFilter.current === "unread") {
                        setReadCompletion(value => value + 1);
                    }
                })
                .catch(() => {
                    if (!mountedRef.current) return;
                    if (activeFilter.current !== filter) return;
                    setUnreadCount(count => count + 1);
                    setItems(current => filter === "unread"
                        ? [...current.filter(item => item.id !== notification.id), notification].sort((a, b) => b.id - a.id)
                        : current.map(item => item.id === notification.id ? notification : item));
                    setError("읽음 상태를 저장하지 못했어요. 알림을 다시 열어 주세요.");
                })
                .finally(() => pendingReads.current.delete(notification.id));
            pendingReads.current.set(notification.id, read);
        }

        if (target?.kind === "scheduleDetail") {
            const route = createScheduleDetailRoute(target.scheduleId);
            router.push({ ...route, params: { ...route.params, entrySource: "notification-inbox" } });
        } else if (target?.kind === "shareInbox") {
            router.push({ pathname: "/share/inbox", params: { tab: "calendar", from: "notifications" } });
        }
    }, [filter, items, router, unreadCount]);

    const markAllRead = useCallback(async () => {
        if (unreadCount === 0 || markingAllRef.current) return;
        markingAllRef.current = true;
        setMarkingAllRead(true);
        setError(null);
        requestSequenceRef.current += 1;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        try {
            await Promise.all(pendingReads.current.values());
            await markAllAppNotificationsRead();
            emitAppNotificationReceived();
            if (!mountedRef.current) return;
            if (filter === "unread") {
                pendingFocus.current = { filter };
                setReadCompletion(value => value + 1);
            }
            setUnreadCount(0);
            setItems(current => filter === "unread"
                ? []
                : current.map(item => ({
                    ...item,
                    read: true,
                    readAt: item.readAt ?? new Date().toISOString(),
                })));
        } catch (markError) {
            if (mountedRef.current) setError(getInboxErrorMessage(markError));
        } finally {
            markingAllRef.current = false;
            if (mountedRef.current) setMarkingAllRead(false);
        }
    }, [filter, unreadCount]);

    const renderItem = useCallback(({ item }: { item: AppNotification }) => (
        <NotificationRow
            notification={item}
            colors={colors}
            mode={mode}
            accent={accent}
            largeText={largeText}
            reduceMotion={reduceMotion}
            registerRow={node => {
                if (node) rowRefs.current.set(item.id, node);
                else rowRefs.current.delete(item.id);
            }}
            disabled={markingAllRead}
            onPress={() => openNotification(item)}
        />
    ), [accent, colors, largeText, markingAllRead, mode, openNotification, reduceMotion]);

    const hasOlderUnread = filter === "unread" && nextCursor !== null && unreadCount > 0;
    const emptyTitle = hasOlderUnread ? "이전 알림에 읽지 않은 항목이 있어요"
        : filter === "unread" ? "읽지 않은 알림이 없어요" : "아직 도착한 알림이 없어요";
    const emptyCaption = hasOlderUnread ? "아래에서 이전 알림을 불러올 수 있어요." : filter === "unread"
        ? "새 알림이 오면 여기에 모아둘게요."
        : "일정 공유와 출발 소식을 놓치지 않게 모아둘게요.";

    const markAllControl = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="알림 모두 읽음 처리"
            accessibilityState={{ disabled: unreadCount === 0 || markingAllRead }}
            disabled={unreadCount === 0 || markingAllRead}
            onPress={markAllRead}
            style={({ pressed }) => [
                styles.markAllButton,
                largeText && styles.markAllLarge,
                { opacity: unreadCount === 0 ? 0.42 : pressed ? 0.62 : 1 },
            ]}
        >
            <Ionicons name="checkmark-done-outline" size={21} color={accent} />
            <Text maxFontSizeMultiplier={2} style={[styles.markAllText, { color: accent }]}>모두 읽음</Text>
        </Pressable>
    );

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
                    <Ionicons name="chevron-back-outline" size={27} color={colors.textPrimary} />
                </Pressable>
                <View style={styles.headerTitleGroup}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.headerTitle, { color: colors.textPrimary }]}>알림</Text>
                </View>
                {largeText ? null : markAllControl}
            </View>
            {largeText ? markAllControl : null}

            <View style={[styles.filterBar, { backgroundColor: colors.surface2 }]}>
                {(["all", "unread"] as const).map((value) => {
                    const selected = filter === value;
                    return (
                        <Pressable
                            key={value}
                            ref={value === "unread" ? unreadTab : undefined}
                            accessibilityRole="tab"
                            accessibilityLabel={value === "all" ? "전체" : unreadCount > 0 ? `읽지 않음 ${unreadCount}개` : "읽지 않음"}
                            accessibilityState={{ selected, disabled: markingAllRead }}
                            onPress={() => changeFilter(value)}
                            disabled={markingAllRead}
                            style={[
                                styles.filterButton,
                                selected && {
                                    backgroundColor: colors.surface,
                                    borderColor: colors.border,
                                },
                            ]}
                        >
                            <Text maxFontSizeMultiplier={2} style={[
                                styles.filterText,
                                { color: selected ? colors.textPrimary : colors.textSecondary },
                            ]}>
                                {value === "all" ? "전체" : "읽지 않음"}
                            </Text>
                            {value === "unread" && unreadCount > 0 ? (
                                <Text maxFontSizeMultiplier={1.7} style={[styles.filterCount, { color: accent }]}>
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                </Text>
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>

            <Animated.View style={[styles.listPane, { opacity: filterOpacity }]}>
                {loading && items.length === 0 ? (
                    <BrandedLoadingState
                        accessibilityLabel="알림 불러오는 중"
                        title="알림을 불러오고 있어요"
                        fill
                    />
                ) : (
                    <FlatList
                        key={filter}
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
                                <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => loadFirstPage("refresh")}>
                                    <Text style={[styles.retryText, { color: accent }]}>다시 시도</Text>
                                </Pressable>
                            </View>
                        ) : null}
                        ListEmptyComponent={(
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIcon, { backgroundColor: showCheck ? `${accent}19` : colors.surface2 }]}>
                                    <Ionicons accessible={false} name="notifications-outline" size={27} color={showCheck ? accent : colors.textSecondary} />
                                    {showCheck && (
                                        <Animated.View accessible={false} style={[
                                            styles.readCheck,
                                            {
                                                backgroundColor: "#2463DB",
                                                borderColor: colors.background,
                                                opacity: checkProgress,
                                                transform: [
                                                    { perspective: 400 },
                                                    { rotateX: checkProgress.interpolate({ inputRange: [0, 1], outputRange: ["22deg", "0deg"] }) },
                                                    { scale: checkProgress.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] }) },
                                                ],
                                            },
                                        ]}>
                                            <Ionicons accessible={false} name="checkmark-outline" size={14} color="#FFF" />
                                        </Animated.View>
                                    )}
                                </View>
                                <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{emptyTitle}</Text>
                                <Text style={[styles.emptyCaption, { color: colors.textSecondary }]}>{emptyCaption}</Text>
                            </View>
                        )}
                        ListFooterComponent={nextCursor ? (
                            <View style={styles.loadMoreFooter}>
                                {pageError ? (
                                    <Text accessibilityRole="alert" maxFontSizeMultiplier={2} style={[styles.loadMoreError, { color: colors.textSecondary }]}>
                                        이전 알림을 불러오지 못했어요
                                    </Text>
                                ) : null}
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={pageError ? "이전 알림 다시 시도" : "이전 알림 더 보기"}
                                    accessibilityState={{ busy: loadingMore }}
                                    disabled={loadingMore || refreshing}
                                    onPress={loadMore}
                                    style={({ pressed }) => [
                                        styles.loadMoreButton,
                                        { borderColor: colors.border, opacity: pressed ? 0.62 : 1 },
                                    ]}
                                >
                                    <Text maxFontSizeMultiplier={2} style={[styles.loadMoreText, { color: colors.textPrimary }]}>
                                        {loadingMore ? "불러오는 중" : pageError ? "다시 시도" : "이전 알림 더 보기"}
                                    </Text>
                                    {!loadingMore && !pageError ? (
                                        <Ionicons accessible={false} name="chevron-down-outline" size={17} color={colors.textSecondary} />
                                    ) : null}
                                </Pressable>
                            </View>
                        ) : null}
                        maintainVisibleContentPosition={filter === "unread" ? { minIndexForVisible: 0 } : undefined}
                    />
                )}
            </Animated.View>
        </View>
    );
}

function NotificationRow({
    notification, colors, mode, accent, largeText, disabled, reduceMotion, registerRow, onPress,
}: {
    notification: AppNotification;
    colors: AppColors;
    mode: ColorMode;
    accent: string;
    largeText: boolean;
    disabled: boolean;
    reduceMotion: boolean;
    registerRow: (node: NativeView | null) => void;
    onPress: () => void;
}) {
    const visual = getAppNotificationVisual(notification.type);
    const tone = getToneColors(visual.tone, mode, colors);
    const time = formatAppNotificationTime(notification.createdAt);
    const copy = getAppNotificationCopy(notification);
    const target = getAppNotificationNavigationTarget(notification);
    const destination = target?.kind === "scheduleDetail" ? "일정 보기" : target?.kind === "shareInbox" ? "공유 캘린더 보기" : undefined;
    const unreadOpacity = useRef(new Animated.Value(notification.read ? 0 : 1)).current;

    useEffect(() => {
        const next = notification.read ? 0 : 1;
        if (reduceMotion) {
            unreadOpacity.setValue(next);
            return;
        }
        const animation = Animated.timing(unreadOpacity, { toValue: next, duration: 160, useNativeDriver: true });
        animation.start();
        return () => animation.stop();
    }, [notification.read, reduceMotion, unreadOpacity]);

    return (
        <Pressable
            ref={registerRow}
            accessibilityRole="button"
            accessibilityLabel={[notification.read ? "읽은 알림" : "읽지 않은 알림", copy.title, copy.description, time].filter(Boolean).join(", ")}
            accessibilityHint={destination}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.notificationRow,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.surface2 },
            ]}
        >
            <View style={[styles.rowIcon, { backgroundColor: colors.surface2 }]}>
                <Ionicons accessible={false} name={visual.icon} size={21} color={colors.textSecondary} />
                <Animated.View pointerEvents="none" style={[styles.coloredIcon, { backgroundColor: tone.background, opacity: unreadOpacity }]}>
                    <Ionicons accessible={false} name={visual.icon} size={21} color={tone.foreground} />
                </Animated.View>
            </View>
            <View style={styles.rowContent}>
                <Text numberOfLines={largeText ? undefined : 2} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word"
                    style={[styles.rowTitle, { color: colors.textPrimary }, !notification.read && styles.rowTitleUnread]}>
                    {copy.title}
                </Text>
                <Text numberOfLines={largeText ? undefined : 2} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word"
                    style={[styles.rowBody, { color: colors.textSecondary }]}>
                    {[copy.description, time].filter(Boolean).join(" · ")}
                </Text>
            </View>
            <View accessible={false} style={styles.rowIndicators}>
                {!notification.read && <View style={[styles.unreadDot, { backgroundColor: accent }]} />}
                {destination && <Ionicons accessible={false} name="chevron-forward-outline" size={16} color={colors.textSecondary} />}
            </View>
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

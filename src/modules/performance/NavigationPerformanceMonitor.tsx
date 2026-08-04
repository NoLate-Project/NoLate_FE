import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useNavigationContainerRef, usePathname } from "expo-router";

import { useTheme } from "../theme/ThemeContext";
import {
    beginNavigationMeasurement,
    clearNavigationPerformanceEntries,
    finishNavigationAfterFrames,
    getNavigationPerformanceSnapshot,
    markNavigationRouteReady,
    shouldMeasureNavigationAction,
    subscribeNavigationPerformance,
    type NavigationPerformanceEntry,
} from "./navigationPerformance";

export const NAVIGATION_PERFORMANCE_ENABLED =
    (typeof __DEV__ !== "undefined" && __DEV__) ||
    process.env.EXPO_PUBLIC_ENABLE_NAVIGATION_PERFORMANCE === "true";

function actionTarget(action: { payload?: unknown }) {
    if (!action.payload || typeof action.payload !== "object") return undefined;
    const payload = action.payload as { name?: unknown; path?: unknown };
    if (typeof payload.path === "string") return payload.path;
    if (typeof payload.name === "string" && payload.name !== "__root") return payload.name;
    return undefined;
}

function scheduleFrameCompletion(pendingId: number) {
    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
            finishNavigationAfterFrames(pendingId);
        });
    });
    return () => {
        cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
}

export function NavigationPerformanceTracker() {
    const pathname = usePathname();
    const navigationRef = useNavigationContainerRef();
    const pathnameRef = useRef(pathname);

    useEffect(() => {
        pathnameRef.current = pathname;
        const pendingId = markNavigationRouteReady(pathname);
        if (pendingId === undefined) return;
        return scheduleFrameCompletion(pendingId);
    }, [pathname]);

    useEffect(() => {
        const navigation = navigationRef.current;
        if (!navigation) return;

        return navigation.addListener("__unsafe_action__", ({ data }) => {
            const action = data.action;
            if (data.noop || !shouldMeasureNavigationAction(action.type)) return;
            beginNavigationMeasurement(
                action.type,
                pathnameRef.current,
                actionTarget(action),
            );
        });
    }, [navigationRef]);

    return null;
}

function routeLabel(route: string) {
    if (route === "/") return "시작 화면";
    if (route === "/auth/login") return "로그인";
    if (route === "/auth/signup") return "회원가입";
    if (route === "/onboarding/calendar-import") return "캘린더 가져오기";
    if (route === "/schedule") return "일정";
    if (route === "/schedule/calendars") return "캘린더 관리";
    if (route === "/schedule/categories") return "카테고리 관리";
    if (route === "/schedule/route-select") return "경로 선택";
    if (route === "/schedule/route-planner") return "경로 설정";
    if (/^\/schedule\/[^/]+$/.test(route)) return "일정 상세";
    if (route === "/profile") return "프로필";
    if (route === "/settings/places") return "장소 설정";
    if (route === "/notifications") return "알림";
    if (route === "/share/inbox") return "공유함";
    if (route === "/share/blocked") return "차단 목록";
    if (route === "/share/reports") return "신고 내역";
    if (route === "/legal/terms-of-service") return "이용약관";
    if (route === "/legal/privacy-policy") return "개인정보 처리방침";
    if (route === "/legal/privacy-collection-consent") return "개인정보 수집 동의";
    if (/^\/share\/[^/]+$/.test(route)) return "공유 초대";
    return route;
}

function actionLabel(action: string) {
    if (action === "PUSH") return "열기";
    if (action === "NAVIGATE") return "이동";
    if (action === "REPLACE") return "교체";
    if (action === "GO_BACK" || action === "POP") return "뒤로";
    if (action === "POP_TO_TOP") return "처음으로";
    if (action === "GESTURE") return "제스처";
    if (action === "RESET") return "초기화";
    return action.toLowerCase();
}

function durationColor(duration: number) {
    if (duration <= 300) return "#30D158";
    if (duration <= 600) return "#FF9F0A";
    return "#FF453A";
}

function EntryRow({ entry }: { entry: NavigationPerformanceEntry }) {
    const { colors } = useTheme();
    const transitionMs = Math.max(0, entry.totalMs - entry.routeReadyMs);
    const time = new Date(entry.startedAtEpochMs).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    return (
        <View
            accessible
            accessibilityLabel={`${routeLabel(entry.fromRoute)}에서 ${routeLabel(entry.toRoute)}까지 ${entry.totalMs}밀리초`}
            style={[styles.entry, { borderColor: colors.border }]}
        >
            <View style={styles.entryHeader}>
                <Text style={[styles.routeTitle, { color: colors.textPrimary }]}>
                    {routeLabel(entry.toRoute)}
                </Text>
                <Text style={[styles.totalDuration, { color: durationColor(entry.totalMs) }]}>
                    {entry.totalMs}ms
                </Text>
            </View>
            <Text style={[styles.routePath, { color: colors.textSecondary }]} numberOfLines={1}>
                {routeLabel(entry.fromRoute)} → {routeLabel(entry.toRoute)}
            </Text>
            <Text style={[styles.breakdown, { color: colors.textSecondary }]}>
                화면 표시 {entry.routeReadyMs}ms · 전환 정리 {transitionMs}ms
            </Text>
            <Text style={[styles.metadata, { color: colors.textDisabled }]}>
                {time} · {actionLabel(entry.action)}
            </Text>
        </View>
    );
}

export function NavigationPerformanceOverlay() {
    const { colors } = useTheme();
    const [visible, setVisible] = useState(false);
    const { entries } = useSyncExternalStore(
        subscribeNavigationPerformance,
        getNavigationPerformanceSnapshot,
        getNavigationPerformanceSnapshot,
    );
    const latest = entries[0];
    const summary = useMemo(() => {
        if (!entries.length) return undefined;
        const total = entries.reduce((sum, entry) => sum + entry.totalMs, 0);
        return {
            average: Math.round(total / entries.length),
            slowest: Math.max(...entries.map((entry) => entry.totalMs)),
        };
    }, [entries]);
    const close = useCallback(() => setVisible(false), []);

    return (
        <>
            <View pointerEvents="box-none" style={styles.floatingLayer}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="화면 전환 속도 기록 열기"
                    hitSlop={8}
                    onPress={() => setVisible(true)}
                    style={({ pressed }) => [
                        styles.floatingButton,
                        { backgroundColor: colors.textPrimary },
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={[styles.floatingText, { color: colors.background }]}>
                        {latest ? `전환 ${latest.totalMs}ms` : "전환 측정"}
                    </Text>
                </Pressable>
            </View>
            <Modal
                animationType="slide"
                onRequestClose={close}
                presentationStyle="pageSheet"
                visible={visible}
            >
                <View style={[styles.modal, { backgroundColor: colors.background }]}>
                    <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                        <View style={styles.headerCopy}>
                            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                                화면 전환 측정
                            </Text>
                            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                                {summary
                                    ? `${entries.length}회 · 평균 ${summary.average}ms · 최장 ${summary.slowest}ms`
                                    : "화면을 이동하면 기록이 여기에 표시됩니다"}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="화면 전환 측정 닫기"
                            hitSlop={10}
                            onPress={close}
                            style={({ pressed }) => pressed && styles.pressed}
                        >
                            <Text style={[styles.closeText, { color: colors.textPrimary }]}>완료</Text>
                        </Pressable>
                    </View>
                    <View style={[styles.legend, { backgroundColor: colors.surface2 }]}>
                        <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                            화면 표시는 새 경로가 렌더된 시간, 전체 시간은 전환 애니메이션이 끝난 시간입니다.
                        </Text>
                    </View>
                    <FlatList
                        contentContainerStyle={entries.length ? styles.list : styles.emptyList}
                        data={entries}
                        keyExtractor={(entry) => String(entry.id)}
                        renderItem={({ item }) => <EntryRow entry={item} />}
                        ListEmptyComponent={(
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                아직 측정된 화면 전환이 없습니다.
                            </Text>
                        )}
                    />
                    {entries.length ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="화면 전환 기록 지우기"
                            onPress={clearNavigationPerformanceEntries}
                            style={({ pressed }) => [
                                styles.clearButton,
                                { borderColor: colors.border },
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={[styles.clearText, { color: colors.textSecondary }]}>기록 지우기</Text>
                        </Pressable>
                    ) : null}
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    floatingLayer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "flex-end",
        justifyContent: "flex-end",
        paddingBottom: 88,
        paddingRight: 12,
        zIndex: 1000,
    },
    floatingButton: {
        borderRadius: 999,
        elevation: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    floatingText: {
        fontSize: 12,
        fontWeight: "800",
    },
    pressed: {
        opacity: 0.65,
    },
    modal: {
        flex: 1,
    },
    modalHeader: {
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        paddingHorizontal: 20,
        paddingBottom: 14,
        paddingTop: 20,
    },
    headerCopy: {
        flex: 1,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: "800",
    },
    modalSubtitle: {
        fontSize: 13,
        marginTop: 4,
    },
    closeText: {
        fontSize: 16,
        fontWeight: "700",
    },
    legend: {
        borderRadius: 12,
        marginHorizontal: 16,
        marginTop: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    legendText: {
        fontSize: 12,
        lineHeight: 17,
    },
    list: {
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    emptyList: {
        alignItems: "center",
        flexGrow: 1,
        justifyContent: "center",
        padding: 32,
    },
    emptyText: {
        fontSize: 14,
        textAlign: "center",
    },
    entry: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingVertical: 13,
    },
    entryHeader: {
        alignItems: "baseline",
        flexDirection: "row",
        gap: 12,
    },
    routeTitle: {
        flex: 1,
        fontSize: 17,
        fontWeight: "700",
    },
    totalDuration: {
        fontSize: 19,
        fontVariant: ["tabular-nums"],
        fontWeight: "800",
    },
    routePath: {
        fontSize: 13,
        marginTop: 5,
    },
    breakdown: {
        fontSize: 12,
        marginTop: 5,
    },
    metadata: {
        fontSize: 11,
        marginTop: 4,
    },
    clearButton: {
        alignItems: "center",
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    clearText: {
        fontSize: 14,
        fontWeight: "600",
    },
});

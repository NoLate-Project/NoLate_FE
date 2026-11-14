import styles from "../../src/routeSupport/schedule/calendars.styles";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Keyboard,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    Switch,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    archiveScheduleCalendar,
    createScheduleCalendar,
    getScheduleCalendarMembers,
    getScheduleCalendars,
    leaveScheduleCalendar,
    removeScheduleCalendarMember,
    transferScheduleCalendarOwnership,
    updateMyScheduleCalendarPreferences,
    updateScheduleCalendar,
    updateScheduleCalendarMember,
    type ScheduleCalendar,
    type ScheduleCalendarMember,
    type ScheduleShareContentMode,
} from "../../src/api/scheduleCalendars";
import { recoverDepartureAlarmsAfterMutation } from "../../src/modules/notification/departureAlarmMutationRecovery";
import { measurePerformanceInteraction } from "../../src/modules/performance/interactionPerformance";
import { runAfterScreenTransition } from "../../src/modules/performance/runAfterScreenTransition";
import { useScreenContentReadyPerformance } from "../../src/modules/performance/useScreenContentReadyPerformance";
import { getCachedScheduleCalendars } from "../../src/modules/schedule/scheduleCalendarMemoryCache";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";
import { useScreenFirstPaintPerformance } from "../../src/modules/performance/useScreenFirstPaintPerformance";
import { useImmediateNavigationTransition } from "../../src/modules/performance/ImmediateNavigationTransition";
import { usePreMountedSceneActivity } from "../../src/modules/performance/preMountedSceneActivity";
import { ColorPicker, ContentModeControl, MemberRow, roleLabel } from "../../src/routeSupport/schedule/CalendarsSettingsComponents";

const BRAND_BLUE = "#2F80FF";
const settingsEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const createFormEntry = FadeIn.duration(200).reduceMotion(ReduceMotion.System);
const calendarDetailEntry = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
/** API 오류를 사용자 안내 문구로 정규화하며 네트워크 오류에는 재시도 힌트를 덧붙입니다. */
function errorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
    if (/network|timeout/i.test(message)) return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    return message;
}

/** 공유 콘텐츠 모드를 초대 시트 부제에 사용할 한글 문구로 변환합니다. */
function contentModeLabel(mode: ScheduleShareContentMode) {
    return mode === "SCHEDULE_AND_TRAVEL" ? "일정 + 각자 경로" : "일정만";
}

/** 공유 캘린더 생성·선택·멤버 관리 흐름을 조율하는 설정 화면입니다. */
export default function ScheduleCalendarsScreen() {
    useScreenFirstPaintPerformance('/schedule/calendars');
    const { closeActiveScene, runWithTransitionShell } = useImmediateNavigationTransition();
    const router = useRouter();
    const navigationFocused = useIsFocused();
    const sceneActivity = usePreMountedSceneActivity();
    const isFocused = sceneActivity ?? navigationFocused;
    const focusedRef = useRef(isFocused);
    focusedRef.current = isFocused;
    const params = useLocalSearchParams<{ id?: string; from?: string; view?: string }>();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const largeText = useWindowDimensions().fontScale > 1.35;
    const [showCreateForm, setShowCreateForm] = useState(false);
    const requestedCalendarId = useMemo(() => {
        const requestedId = Number(params.id);
        return Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : null;
    }, [params.id]);
    const focusedCalendarView = params.view === "calendar" && requestedCalendarId !== null;
    const [calendars, setCalendars] = useState<ScheduleCalendar[]>(() =>
        getCachedScheduleCalendars() ?? []
    );
    // A route target is authoritative even when the memory cache predates a
    // newly accepted invitation. Selecting a cached fallback here would keep
    // that older calendar selected after the refreshed list arrives.
    const [selectedId, setSelectedId] = useState<number | null>(() =>
        requestedCalendarId ?? calendars[0]?.id ?? null
    );
    const [members, setMembers] = useState<ScheduleCalendarMember[]>([]);
    // Cached calendars may have been deleted while this screen was away.
    // Confirm the current list before fetching members or enabling detail actions.
    const [calendarListVerified, setCalendarListVerified] = useState(false);
    const calendarListVerifiedRef = useRef(false);
    const hasCalendarSnapshotRef = useRef(calendars.length > 0);
    const [loading, setLoading] = useState(!hasCalendarSnapshotRef.current);
    const [refreshing, setRefreshing] = useState(false);
    const [membersLoading, setMembersLoading] = useState(false);
    const [detailCalendarId, setDetailCalendarId] = useState<number | null>(null);
    const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [sharingCalendarId, setSharingCalendarId] = useState<number | null>(null);
    const [newTitle, setNewTitle] = useState("");
    const [newColor, setNewColor] = useState(BRAND_BLUE);
    const [newContentMode, setNewContentMode] = useState<ScheduleShareContentMode>("SCHEDULE_ONLY");
    const [titleDrafts, setTitleDrafts] = useState<Partial<Record<number, string>>>({});
    const selectedIdRef = useRef<number | null>(selectedId);
    const detailCalendarIdRef = useRef<number | null>(null);
    const calendarsRequestIdRef = useRef(0);
    const membersRequestIdRef = useRef(0);
    const pendingConfirmationRef = useRef<string | null>(null);

    const selected = useMemo(
        () => calendars.find((calendar) => calendar.id === selectedId) ?? null,
        [calendars, selectedId],
    );
    const isOwner = selected?.myRole === "OWNER";
    const editingTitle = selected ? titleDrafts[selected.id] : undefined;
    const canSaveTitle = editingTitle !== undefined && editingTitle.trim().length > 0
        && editingTitle.trim() !== selected?.title && !busy;
    const detailReady = isFocused && calendarListVerified && !!selected && detailCalendarId === selected.id;
    const accent = mode === "dark" ? "#8BB7FF" : BRAND_BLUE;
    const destructive = mode === "dark" ? "#FF6961" : "#D70015";
    const addButtonStateStyle = {
        backgroundColor: accent,
        opacity: !newTitle.trim() || busy ? 0.42 : 1,
    };
    const destructiveBorderStyle = { borderColor: destructive };
    const destructiveTextStyle = { color: destructive };

    useScreenContentReadyPerformance(
        "calendar.settings_content_ready",
        "/schedule/calendars",
        !loading,
    );

    const selectCalendar = useCallback((calendarId: number | null) => {
        if (selectedIdRef.current === calendarId) return;
        selectedIdRef.current = calendarId;
        detailCalendarIdRef.current = null;
        membersRequestIdRef.current += 1;
        setSelectedId(calendarId);
        setDetailCalendarId(null);
        setDetailLoadError(null);
        setMembers([]);
        setMembersLoading(calendarId !== null);
        setSharingCalendarId(null);
    }, []);

    const isCurrentDetailTarget = useCallback((calendarId: number) => (
        focusedRef.current
        && calendarListVerifiedRef.current
        && selectedIdRef.current === calendarId
        && detailCalendarIdRef.current === calendarId
    ), []);

    const loadCalendars = useCallback(async (refresh = false) => {
        if (!focusedRef.current) return;
        const requestId = ++calendarsRequestIdRef.current;
        calendarListVerifiedRef.current = false;
        setCalendarListVerified(false);
        if (refresh) setRefreshing(true);
        else if (!hasCalendarSnapshotRef.current) setLoading(true);
        try {
            const result = await measurePerformanceInteraction(
                "calendar.list_load",
                "/schedule/calendars",
                getScheduleCalendars,
                "NETWORK",
            );
            if (!focusedRef.current || requestId !== calendarsRequestIdRef.current) return;
            hasCalendarSnapshotRef.current = true;
            setCalendars(result);
            const current = selectedIdRef.current;
            let next = current && result.some((calendar) => calendar.id === current)
                ? current
                : null;
            if (
                next === null
                && requestedCalendarId !== null
                && result.some((calendar) => calendar.id === requestedCalendarId)
            ) {
                next = requestedCalendarId;
            }
            if (focusedCalendarView) {
                next = result.some(calendar => calendar.id === requestedCalendarId) ? requestedCalendarId : null;
            } else if (next === null) {
                next = result[0]?.id ?? null;
            }
            if (next !== current) selectCalendar(next);
            calendarListVerifiedRef.current = true;
            setCalendarListVerified(true);
        } catch (error) {
            if (!focusedRef.current || requestId !== calendarsRequestIdRef.current) return;
            Alert.alert("공유 캘린더", errorMessage(error));
        } finally {
            if (focusedRef.current && requestId === calendarsRequestIdRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [focusedCalendarView, requestedCalendarId, selectCalendar]);

    const loadMembers = useCallback(async (calendarId: number) => {
        if (
            !focusedRef.current
            || !calendarListVerifiedRef.current
            || selectedIdRef.current !== calendarId
        ) return;
        const requestId = ++membersRequestIdRef.current;
        setMembersLoading(true);
        setDetailLoadError(null);
        try {
            const result = await measurePerformanceInteraction(
                "calendar.members_load",
                "/schedule/calendars",
                () => getScheduleCalendarMembers(calendarId),
                "NETWORK",
            );
            if (
                !focusedRef.current
                || !calendarListVerifiedRef.current
                || requestId !== membersRequestIdRef.current
                || selectedIdRef.current !== calendarId
            ) return;
            setMembers(result);
            detailCalendarIdRef.current = calendarId;
            setDetailCalendarId(calendarId);
        } catch (error) {
            if (
                !focusedRef.current
                || !calendarListVerifiedRef.current
                || requestId !== membersRequestIdRef.current
                || selectedIdRef.current !== calendarId
            ) return;
            if (detailCalendarIdRef.current !== calendarId) {
                setDetailLoadError(errorMessage(error));
            }
            Alert.alert("멤버 조회 실패", errorMessage(error));
        } finally {
            if (focusedRef.current && requestId === membersRequestIdRef.current) {
                setMembersLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (requestedCalendarId !== null) {
            selectCalendar(requestedCalendarId);
        }
    }, [requestedCalendarId, selectCalendar]);

    useEffect(() => {
        if (!isFocused) {
            calendarListVerifiedRef.current = false;
            setCalendarListVerified(false);
            return;
        }
        const task = runAfterScreenTransition(() => {
            loadCalendars().catch(() => undefined);
        });
        return () => {
            task.cancel();
            // Cancelling the transition task cannot cancel an already running HTTP request.
            calendarsRequestIdRef.current += 1;
            calendarListVerifiedRef.current = false;
        };
    }, [isFocused, loadCalendars]);

    useEffect(() => {
        if (!isFocused || !calendarListVerified || selectedId === null) return;
        const task = runAfterScreenTransition(() => {
            loadMembers(selectedId).catch(() => undefined);
        });
        return () => {
            task.cancel();
            membersRequestIdRef.current += 1;
        };
    }, [calendarListVerified, isFocused, loadMembers, selectedId]);

    const closeTitleEditor = useCallback((calendarId: number) => {
        setTitleDrafts(current => {
            const { [calendarId]: removedDraft, ...remaining } = current;
            return removedDraft === undefined ? current : remaining;
        });
    }, []);

    const replaceCalendar = useCallback((next: ScheduleCalendar) => {
        setCalendars((current) => current.map((calendar) => calendar.id === next.id ? next : calendar));
    }, []);

    const createCalendar = useCallback(async () => {
        const title = newTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        try {
            const created = await createScheduleCalendar({
                title,
                color: newColor,
                defaultContentMode: newContentMode,
            });
            setCalendars((current) => [...current, created]);
            selectCalendar(created.id);
            setShowCreateForm(false);
            setNewTitle("");
        } catch (error) {
            Alert.alert("캘린더 생성 실패", errorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [busy, newColor, newContentMode, newTitle, selectCalendar]);

    const updateMode = useCallback(async (nextMode: ScheduleShareContentMode) => {
        if (
            !selected
            || selected.myRole !== "OWNER"
            || !isCurrentDetailTarget(selected.id)
            || selected.defaultContentMode === nextMode
        ) return;
        const targetId = selected.id;
        const updated = await updateScheduleCalendar(targetId, { defaultContentMode: nextMode });
        if (nextMode === "SCHEDULE_ONLY") {
            await recoverDepartureAlarmsAfterMutation();
        }
        if (!isCurrentDetailTarget(targetId)) return;
        replaceCalendar(updated);
    }, [isCurrentDetailTarget, replaceCalendar, selected]);

    const saveTitle = useCallback(async () => {
        if (!selected || !isOwner || !canSaveTitle || editingTitle === undefined || !isCurrentDetailTarget(selected.id)) return;
        const title = editingTitle.trim();
        const targetId = selected.id;
        setBusy(true);
        try {
            const updated = await updateScheduleCalendar(targetId, { title });
            replaceCalendar(updated);
            if (selectedIdRef.current === targetId) Keyboard.dismiss();
            closeTitleEditor(targetId);
        } catch (error) {
            Alert.alert("이름 변경 실패", errorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [canSaveTitle, closeTitleEditor, editingTitle, isCurrentDetailTarget, isOwner, replaceCalendar, selected]);

    const toggleMyReminder = useCallback(async (enabled: boolean) => {
        if (!selected || busy || !isCurrentDetailTarget(selected.id)) return;
        const targetId = selected.id;
        setBusy(true);
        try {
            await updateMyScheduleCalendarPreferences(targetId, enabled);
            if (isCurrentDetailTarget(targetId)) {
                replaceCalendar({ ...selected, routeReminderEnabled: enabled });
            }
        } catch (error) {
            Alert.alert("알림 설정 실패", errorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [busy, isCurrentDetailTarget, replaceCalendar, selected]);

    const changeMemberRole = useCallback(async (
        member: ScheduleCalendarMember,
        role: "VIEWER" | "EDITOR",
    ) => {
        if (
            !selected
            || busy
            || member.role === role
            || !isCurrentDetailTarget(selected.id)
        ) return;
        const targetId = selected.id;
        setBusy(true);
        try {
            const updated = await updateScheduleCalendarMember(targetId, member.memberId, { role });
            if (isCurrentDetailTarget(targetId)) {
                setMembers((current) => current.map((item) => item.id === updated.id ? updated : item));
            }
        } catch (error) {
            Alert.alert("권한 변경 실패", errorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [busy, isCurrentDetailTarget, selected]);

    const confirmRemoveMember = useCallback((member: ScheduleCalendarMember) => {
        if (
            !selected
            || busy
            || selected.myRole !== "OWNER"
            || !isCurrentDetailTarget(selected.id)
            || pendingConfirmationRef.current !== null
        ) return;
        const targetCalendar = selected;
        const targetId = selected.id;
        const confirmationKey = `remove:${targetId}:${member.id}`;
        const runningKey = `${confirmationKey}:running`;
        pendingConfirmationRef.current = confirmationKey;
        Alert.alert("멤버 제거", `${member.name || member.email || `회원 #${member.memberId}`}님을 제거할까요?`, [
            {
                text: "취소",
                style: "cancel",
                onPress: () => {
                    if (pendingConfirmationRef.current === confirmationKey) {
                        pendingConfirmationRef.current = null;
                    }
                },
            },
            {
                text: "제거",
                style: "destructive",
                onPress: async () => {
                    if (
                        pendingConfirmationRef.current !== confirmationKey
                        || !isCurrentDetailTarget(targetId)
                    ) {
                        if (pendingConfirmationRef.current === confirmationKey) {
                            pendingConfirmationRef.current = null;
                        }
                        return;
                    }
                    pendingConfirmationRef.current = runningKey;
                    setBusy(true);
                    try {
                        await removeScheduleCalendarMember(targetId, member.memberId);
                        if (isCurrentDetailTarget(targetId)) {
                            setMembers((current) => current.filter((item) => item.id !== member.id));
                            replaceCalendar({
                                ...targetCalendar,
                                memberCount: Math.max(1, targetCalendar.memberCount - 1),
                            });
                        }
                    } catch (error) {
                        Alert.alert("멤버 제거 실패", errorMessage(error));
                    } finally {
                        if (pendingConfirmationRef.current === runningKey) {
                            pendingConfirmationRef.current = null;
                        }
                        setBusy(false);
                    }
                },
            },
        ]);
    }, [busy, isCurrentDetailTarget, replaceCalendar, selected]);

    const confirmTransfer = useCallback((member: ScheduleCalendarMember) => {
        if (
            !selected
            || busy
            || selected.myRole !== "OWNER"
            || !isCurrentDetailTarget(selected.id)
            || pendingConfirmationRef.current !== null
        ) return;
        const targetId = selected.id;
        const confirmationKey = `transfer:${targetId}:${member.id}`;
        const runningKey = `${confirmationKey}:running`;
        pendingConfirmationRef.current = confirmationKey;
        Alert.alert("소유권 이전", `${member.name || member.email || `회원 #${member.memberId}`}님에게 이전할까요?`, [
            {
                text: "취소",
                style: "cancel",
                onPress: () => {
                    if (pendingConfirmationRef.current === confirmationKey) {
                        pendingConfirmationRef.current = null;
                    }
                },
            },
            {
                text: "이전",
                onPress: async () => {
                    if (
                        pendingConfirmationRef.current !== confirmationKey
                        || !isCurrentDetailTarget(targetId)
                    ) {
                        if (pendingConfirmationRef.current === confirmationKey) {
                            pendingConfirmationRef.current = null;
                        }
                        return;
                    }
                    pendingConfirmationRef.current = runningKey;
                    setBusy(true);
                    try {
                        const updated = await transferScheduleCalendarOwnership(targetId, member.memberId);
                        if (isCurrentDetailTarget(targetId)) {
                            replaceCalendar(updated);
                            await loadMembers(targetId);
                        }
                    } catch (error) {
                        Alert.alert("소유권 이전 실패", errorMessage(error));
                    } finally {
                        if (pendingConfirmationRef.current === runningKey) {
                            pendingConfirmationRef.current = null;
                        }
                        setBusy(false);
                    }
                },
            },
        ]);
    }, [busy, isCurrentDetailTarget, loadMembers, replaceCalendar, selected]);

    const confirmExit = useCallback(() => {
        if (
            !selected
            || busy
            || !isCurrentDetailTarget(selected.id)
            || pendingConfirmationRef.current !== null
        ) return;
        const targetId = selected.id;
        const ownerAction = selected.myRole === "OWNER";
        const confirmationKey = `${ownerAction ? "archive" : "leave"}:${targetId}`;
        const runningKey = `${confirmationKey}:running`;
        pendingConfirmationRef.current = confirmationKey;
        Alert.alert(
            ownerAction ? "캘린더 보관" : "캘린더 나가기",
            ownerAction ? "멤버의 접근과 대기 중인 초대 링크가 종료됩니다." : "이 캘린더에서 나갈까요?",
            [
                {
                    text: "취소",
                    style: "cancel",
                    onPress: () => {
                        if (pendingConfirmationRef.current === confirmationKey) {
                            pendingConfirmationRef.current = null;
                        }
                    },
                },
                {
                    text: ownerAction ? "보관" : "나가기",
                    style: "destructive",
                    onPress: async () => {
                        if (
                            pendingConfirmationRef.current !== confirmationKey
                            || !isCurrentDetailTarget(targetId)
                        ) {
                            if (pendingConfirmationRef.current === confirmationKey) {
                                pendingConfirmationRef.current = null;
                            }
                            return;
                        }
                        pendingConfirmationRef.current = runningKey;
                        setBusy(true);
                        try {
                            if (ownerAction) await archiveScheduleCalendar(targetId);
                            else await leaveScheduleCalendar(targetId);
                            await recoverDepartureAlarmsAfterMutation();
                            closeTitleEditor(targetId);
                            setCalendars((current) => current.filter((calendar) => calendar.id !== targetId));
                            if (isCurrentDetailTarget(targetId)) selectCalendar(null);
                        } catch (error) {
                            Alert.alert(ownerAction ? "보관 실패" : "나가기 실패", errorMessage(error));
                        } finally {
                            if (pendingConfirmationRef.current === runningKey) {
                                pendingConfirmationRef.current = null;
                            }
                            setBusy(false);
                        }
                    },
                },
            ],
        );
    }, [busy, closeTitleEditor, isCurrentDetailTarget, selectCalendar, selected]);

    const goBack = () => {
        if (closeActiveScene()) return;
        if ((params.from === "share-inbox" || params.from === "calendar-scope") && router.canGoBack()) {
            router.back();
            return;
        }
        runWithTransitionShell(
            { route: "/schedule", title: "일정", showBack: false },
            () => router.canGoBack() ? router.back() : router.replace("/schedule"),
        );
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="뒤로 가기"
                    onPress={goBack}
                    style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                    <Ionicons name="chevron-back-outline" size={23} color={colors.textPrimary} />
                </Pressable>
                <Text accessibilityRole="header" maxFontSizeMultiplier={1.65} style={[styles.headerTitle, { color: colors.textPrimary }]}>{focusedCalendarView ? "공유 캘린더" : "공유 캘린더 관리"}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 캘린더 새로고침"
                    onPress={() => loadCalendars(true)}
                    style={styles.iconButton}
                >
                    <Ionicons name="refresh-outline" size={21} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadCalendars(true)} />}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
            >
                {!focusedCalendarView && <>
                <View style={styles.section}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="새 캘린더 만들기"
                        accessibilityState={{ expanded: showCreateForm, disabled: busy }}
                        disabled={busy}
                        onPress={() => setShowCreateForm(open => !open)}
                        style={[styles.createDisclosure, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    >
                        <Ionicons accessible={false} name="add-circle-outline" size={20} color={accent} />
                        <Text maxFontSizeMultiplier={2} style={[styles.preferenceTitle, styles.rowText, { color: colors.textPrimary }]}>
                            새 캘린더 만들기
                        </Text>
                        <Ionicons accessible={false} name={showCreateForm ? "chevron-up-outline" : "chevron-down-outline"} size={18} color={colors.textSecondary} />
                    </Pressable>
                    {showCreateForm ? (
                        <Animated.View entering={createFormEntry} style={styles.section}>
                            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                                <TextInput
                                    accessibilityLabel="새 캘린더 이름"
                                    maxFontSizeMultiplier={1.8}
                                    value={newTitle}
                                    onChangeText={setNewTitle}
                                    placeholder="예: 가족 일정"
                                    placeholderTextColor={colors.inputPlaceholder}
                                    maxLength={80}
                                    returnKeyType="done"
                                    onSubmitEditing={createCalendar}
                                    style={[styles.input, { color: colors.textPrimary }]}
                                />
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="공유 캘린더 추가"
                                    disabled={!newTitle.trim() || busy}
                                    onPress={createCalendar}
                                    style={[styles.addButton, addButtonStateStyle]}
                                >
                                    {busy ? <BrandedLoader accessibilityLabel="캘린더 생성 중" size="button" variant="share" /> : <Ionicons name="add" size={22} color="#FFFFFF" />}
                                </Pressable>
                            </View>
                            <ColorPicker value={newColor} onChange={setNewColor} />
                            <ContentModeControl value={newContentMode} onChange={setNewContentMode} />
                        </Animated.View>
                    ) : null}
                </View>

                <View style={styles.section}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.sectionTitle, { color: colors.textPrimary }]}>내 캘린더</Text>
                    {loading ? (
                        <View style={styles.loadingRow}><BrandedLoader accessibilityLabel="캘린더 불러오는 중" variant="share" /><Text style={{ color: colors.textSecondary }}>불러오는 중</Text></View>
                    ) : calendars.length === 0 ? (
                        <View style={[styles.empty, { borderColor: colors.border }]}>
                            <Ionicons name="people-outline" size={24} color={colors.textSecondary} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>공유 캘린더가 없어요</Text>
                        </View>
                    ) : calendars.map((calendar) => {
                        const selectedRow = calendar.id === selectedId;
                        return (
                            <Pressable
                                key={calendar.id}
                                accessibilityRole="button"
                                accessibilityLabel={`${calendar.title}, ${roleLabel(calendar.myRole)}, ${calendar.memberCount}명, ${contentModeLabel(calendar.defaultContentMode)}`}
                                accessibilityState={{ selected: selectedRow }}
                                onPress={() => selectCalendar(calendar.id)}
                                style={[
                                    styles.calendarRow,
                                    {
                                        backgroundColor: colors.surface,
                                        borderColor: selectedRow ? accent : colors.border,
                                    },
                                ]}
                            >
                                <View style={[styles.calendarMark, { backgroundColor: calendar.color }]} />
                                <View style={styles.rowText}>
                                    <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word">{calendar.title}</Text>
                                    <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={1.8} lineBreakStrategyIOS="hangul-word">
                                        {roleLabel(calendar.myRole)} · {calendar.memberCount}명 · {contentModeLabel(calendar.defaultContentMode)}
                                    </Text>
                                </View>
                                <Ionicons accessible={false} name={selectedRow ? "checkmark-outline" : "chevron-forward-outline"} size={18} color={selectedRow ? accent : colors.textSecondary} />
                            </Pressable>
                        );
                    })}
                </View>

                </>}

                {focusedCalendarView && calendarListVerified && !selected ? (
                    <Text accessibilityRole="alert" style={[styles.emptyText, { color: colors.textSecondary }]}>
                        이 공유 캘린더를 열 수 없어요.
                    </Text>
                ) : null}
                {selected ? detailReady ? (
                    <Animated.View key={selected.id} entering={calendarDetailEntry} style={[styles.detailBand, { borderTopColor: colors.border }]}>
                        <View style={[styles.detailHeader, largeText && styles.detailHeaderStacked]}>
                            <View style={styles.rowText}>
                                <View style={styles.titleHeading}>
                                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word"
                                        style={[styles.sectionTitle, styles.rowText, { color: colors.textPrimary }]}>{focusedCalendarView ? selected.title : `${selected.title} 설정`}</Text>
                                    {isOwner && editingTitle === undefined ? (
                                        <Pressable accessibilityRole="button" accessibilityLabel="캘린더 이름 수정"
                                            disabled={busy} accessibilityState={{ disabled: busy }}
                                            onPress={() => setTitleDrafts(current => ({ ...current, [selected.id]: selected.title }))}
                                            style={styles.inlineIconButton}>
                                            <Ionicons name="pencil-outline" size={19} color={accent} />
                                        </Pressable>
                                    ) : null}
                                </View>
                                <Text maxFontSizeMultiplier={1.8} style={[styles.rowMeta, { color: colors.textSecondary }]}>{roleLabel(selected.myRole)} 권한</Text>
                            </View>
                            {isOwner ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`${selected.title} 공유하기`}
                                    onPress={() => {
                                        if (isCurrentDetailTarget(selected.id)) {
                                            setSharingCalendarId(selected.id);
                                        }
                                    }}
                                    style={[styles.shareButton, { backgroundColor: accent }]}
                                >
                                    <Ionicons name="share-social-outline" size={17} color={mode === "dark" ? "#08152B" : "#FFFFFF"} />
                                    <Text maxFontSizeMultiplier={1.8} style={[styles.shareButtonText, { color: mode === "dark" ? "#08152B" : "#FFFFFF" }]}>공유하기</Text>
                                </Pressable>
                            ) : null}
                        </View>

                        {selected.myRole !== "VIEWER" ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${selected.title} 카테고리 관리`}
                                onPress={() => {
                                    if (!isCurrentDetailTarget(selected.id)) return;
                                    router.push({
                                        pathname: "/schedule/categories",
                                        params: {
                                            calendarId: String(selected.id),
                                            calendarTitle: selected.title,
                                            returnTo: sceneActivity === undefined ? "calendar-stack" : "calendars",
                                        },
                                    });
                                }}
                                style={({ pressed }) => [
                                    styles.categoryManageButton,
                                    {
                                        borderColor: colors.border,
                                        backgroundColor: colors.surface,
                                        opacity: pressed ? 0.65 : 1,
                                    },
                                ]}
                            >
                                <Ionicons name="pricetags-outline" size={18} color={accent} />
                                <View style={styles.rowText}>
                                    <Text maxFontSizeMultiplier={1.8} style={[styles.preferenceTitle, { color: colors.textPrimary }]}>카테고리 관리</Text>
                                    <Text maxFontSizeMultiplier={1.8} style={[styles.rowMeta, { color: colors.textSecondary }]}>이 캘린더에서만 사용하는 카테고리</Text>
                                </View>
                                <Ionicons name="chevron-forward-outline" size={17} color={colors.textSecondary} />
                            </Pressable>
                        ) : null}

                        {isOwner && editingTitle !== undefined ? (
                            <Animated.View entering={settingsEntry} style={[styles.renameEditor, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                                <TextInput accessibilityLabel="캘린더 이름" maxFontSizeMultiplier={1.8} value={editingTitle}
                                    onChangeText={title => setTitleDrafts(current => ({ ...current, [selected.id]: title }))}
                                    maxLength={80} editable={!busy} returnKeyType="done" onSubmitEditing={saveTitle}
                                    style={[styles.input, { color: colors.textPrimary }]} />
                                <View style={styles.renameActions}>
                                    <Pressable accessibilityRole="button" accessibilityLabel="캘린더 이름 수정 취소"
                                        disabled={busy} accessibilityState={{ disabled: busy }}
                                        onPress={() => { Keyboard.dismiss(); closeTitleEditor(selected.id); }}
                                        style={styles.renameAction}>
                                        <Text style={{ color: colors.textSecondary }}>취소</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel="캘린더 이름 저장"
                                        disabled={!canSaveTitle} accessibilityState={{ disabled: !canSaveTitle }}
                                        onPress={saveTitle} style={[styles.renameAction, { opacity: canSaveTitle ? 1 : 0.45 }]}>
                                        <Text style={[styles.preferenceTitle, { color: accent }]}>저장</Text>
                                    </Pressable>
                                </View>
                            </Animated.View>
                        ) : null}

                        <Text maxFontSizeMultiplier={1.8} style={[styles.fieldLabel, { color: colors.textSecondary }]}>공유 범위</Text>
                        {isOwner ? (
                            <ContentModeControl
                                value={selected.defaultContentMode}
                                onChange={(value) => {
                                    if (!isOwner) return;
                                    updateMode(value).catch((error) => Alert.alert("공유 범위 변경 실패", errorMessage(error)));
                                }}
                                disabled={!isOwner}
                            />
                        ) : (
                            <Text maxFontSizeMultiplier={1.8} style={[styles.rowMeta, { color: colors.textPrimary }]}>
                                {contentModeLabel(selected.defaultContentMode)}
                            </Text>
                        )}

                        <View style={styles.preferenceRow}>
                            <View style={styles.rowText}>
                                <Text maxFontSizeMultiplier={1.8} style={[styles.preferenceTitle, { color: colors.textPrimary }]}>경로 미설정 알림</Text>
                                <Text maxFontSizeMultiplier={1.8} style={[styles.rowMeta, { color: colors.textSecondary }]}>일정 3일 전부터</Text>
                            </View>
                            <Switch
                                accessibilityLabel="경로 미설정 알림"
                                value={selected.routeReminderEnabled}
                                disabled={busy}
                                onValueChange={toggleMyReminder}
                                trackColor={{ false: colors.border, true: accent }}
                            />
                        </View>

                        <View style={styles.memberHeader}>
                            <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.sectionTitle, { color: colors.textPrimary }]}>멤버</Text>
                            <Text style={[styles.memberCount, { color: colors.textSecondary }]}>{members.length}명</Text>
                        </View>
                        {membersLoading ? (
                            <View style={styles.loadingRow}><BrandedLoader accessibilityLabel="캘린더 멤버 불러오는 중" variant="share" /></View>
                        ) : members.map((member) => (
                            <MemberRow
                                key={member.id}
                                member={member}
                                canManage={isOwner && member.role !== "OWNER"}
                                busy={busy}
                                onRoleChange={(role) => changeMemberRole(member, role)}
                                onRemove={() => confirmRemoveMember(member)}
                                onTransfer={() => confirmTransfer(member)}
                            />
                        ))}

                        <Pressable
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={confirmExit}
                            style={[styles.dangerButton, destructiveBorderStyle, busy && styles.disabledAction]}
                        >
                            <Ionicons name={isOwner ? "archive-outline" : "exit-outline"} size={18} color={destructive} />
                            <Text style={[styles.dangerText, destructiveTextStyle]}>
                                {isOwner ? "캘린더 보관" : "캘린더 나가기"}
                            </Text>
                        </Pressable>
                    </Animated.View>
                ) : (
                    <View
                        accessibilityLabel={`${selected.title} 설정 불러오는 중`}
                        style={[styles.detailLoading, { borderTopColor: colors.border }]}
                    >
                        {detailLoadError ? (
                            <>
                                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>설정을 불러오지 못했어요.</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`${selected.title} 설정 다시 불러오기`}
                                    onPress={() => loadMembers(selected.id)}
                                    style={[styles.retryButton, { borderColor: colors.border }]}
                                >
                                    <Ionicons name="refresh-outline" size={16} color={accent} />
                                    <Text style={[styles.retryText, { color: accent }]}>다시 시도</Text>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <BrandedLoader accessibilityLabel="캘린더 설정 불러오는 중" variant="share" />
                                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>선택한 캘린더 설정을 불러오는 중</Text>
                            </>
                        )}
                    </View>
                ) : null}
            </ScrollView>

            <ShareInvitationSheet
                visible={sharingCalendarId !== null && isCurrentDetailTarget(sharingCalendarId)}
                resourceType="calendar"
                resourceId={sharingCalendarId?.toString()}
                title={sharingCalendarId === selected?.id ? selected.title : "공유 캘린더"}
                subtitle={sharingCalendarId === selected?.id ? contentModeLabel(selected.defaultContentMode) : undefined}
                initialContentMode={sharingCalendarId === selected?.id ? selected.defaultContentMode : undefined}
                onCalendarContentModeChange={updateMode}
                onClose={() => {
                    const closedCalendarId = sharingCalendarId;
                    setSharingCalendarId(null);
                    if (closedCalendarId !== null && isCurrentDetailTarget(closedCalendarId)) {
                        loadMembers(closedCalendarId).catch(() => undefined);
                    }
                    loadCalendars(true).catch(() => undefined);
                }}
            />
        </View>
    );
}

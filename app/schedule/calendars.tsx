import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
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
    type ScheduleCalendarRole,
    type ScheduleShareContentMode,
} from "../../src/api/scheduleCalendars";
import { recoverDepartureAlarmsAfterMutation } from "../../src/modules/notification/departureAlarmMutationRecovery";
import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";

const BRAND_BLUE = "#2F80FF";
const CALENDAR_COLORS = ["#2F80FF", "#16A085", "#34C759", "#FF3B30", "#AF52DE", "#FF9500"];

function errorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
    if (/network|timeout/i.test(message)) return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    return message;
}

function roleLabel(role: ScheduleCalendarRole) {
    if (role === "OWNER") return "소유자";
    if (role === "EDITOR") return "편집";
    return "보기";
}

function contentModeLabel(mode: ScheduleShareContentMode) {
    return mode === "SCHEDULE_AND_TRAVEL" ? "일정 + 각자 경로" : "일정만";
}

export default function ScheduleCalendarsScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string }>();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const [calendars, setCalendars] = useState<ScheduleCalendar[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [members, setMembers] = useState<ScheduleCalendarMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [membersLoading, setMembersLoading] = useState(false);
    const [detailCalendarId, setDetailCalendarId] = useState<number | null>(null);
    const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [sharingCalendarId, setSharingCalendarId] = useState<number | null>(null);
    const [newTitle, setNewTitle] = useState("");
    const [newColor, setNewColor] = useState(BRAND_BLUE);
    const [newContentMode, setNewContentMode] = useState<ScheduleShareContentMode>("SCHEDULE_ONLY");
    const [editingTitle, setEditingTitle] = useState("");
    const selectedIdRef = useRef<number | null>(null);
    const detailCalendarIdRef = useRef<number | null>(null);
    const calendarsRequestIdRef = useRef(0);
    const membersRequestIdRef = useRef(0);
    const pendingConfirmationRef = useRef<string | null>(null);

    const selected = useMemo(
        () => calendars.find((calendar) => calendar.id === selectedId) ?? null,
        [calendars, selectedId],
    );
    const isOwner = selected?.myRole === "OWNER";
    const detailReady = !!selected && detailCalendarId === selected.id;
    const accent = mode === "dark" ? "#8BB7FF" : BRAND_BLUE;
    const destructive = mode === "dark" ? "#FF6961" : "#D70015";
    const addButtonStateStyle = {
        backgroundColor: accent,
        opacity: !newTitle.trim() || busy ? 0.42 : 1,
    };
    const destructiveBorderStyle = { borderColor: destructive };
    const destructiveTextStyle = { color: destructive };

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
        setEditingTitle("");
        setSharingCalendarId(null);
    }, []);

    const isCurrentDetailTarget = useCallback((calendarId: number) => (
        selectedIdRef.current === calendarId
        && detailCalendarIdRef.current === calendarId
    ), []);

    const loadCalendars = useCallback(async (refresh = false) => {
        const requestId = ++calendarsRequestIdRef.current;
        refresh ? setRefreshing(true) : setLoading(true);
        try {
            const result = await getScheduleCalendars();
            if (requestId !== calendarsRequestIdRef.current) return;
            setCalendars(result);
            const current = selectedIdRef.current;
            let next = current && result.some((calendar) => calendar.id === current)
                ? current
                : null;
            const requestedId = Number(params.id);
            if (
                next === null
                && Number.isFinite(requestedId)
                && result.some((calendar) => calendar.id === requestedId)
            ) {
                next = requestedId;
            }
            if (next === null) next = result[0]?.id ?? null;
            if (next !== current) selectCalendar(next);
        } catch (error) {
            if (requestId !== calendarsRequestIdRef.current) return;
            Alert.alert("공유 캘린더", errorMessage(error));
        } finally {
            if (requestId === calendarsRequestIdRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [params.id, selectCalendar]);

    const loadMembers = useCallback(async (calendarId: number) => {
        const requestId = ++membersRequestIdRef.current;
        setMembersLoading(true);
        setDetailLoadError(null);
        try {
            const result = await getScheduleCalendarMembers(calendarId);
            if (
                requestId !== membersRequestIdRef.current
                || selectedIdRef.current !== calendarId
            ) return;
            setMembers(result);
            detailCalendarIdRef.current = calendarId;
            setDetailCalendarId(calendarId);
        } catch (error) {
            if (
                requestId !== membersRequestIdRef.current
                || selectedIdRef.current !== calendarId
            ) return;
            if (detailCalendarIdRef.current !== calendarId) {
                setDetailLoadError(errorMessage(error));
            }
            Alert.alert("멤버 조회 실패", errorMessage(error));
        } finally {
            if (requestId === membersRequestIdRef.current) {
                setMembersLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        loadCalendars().catch(() => undefined);
    }, [loadCalendars]);

    useEffect(() => {
        if (selectedId === null) return;
        loadMembers(selectedId).catch(() => undefined);
    }, [loadMembers, selectedId]);

    useEffect(() => {
        if (!selected || selectedIdRef.current !== selected.id) {
            setEditingTitle("");
            return;
        }
        setEditingTitle(selected.title);
    }, [selected]);

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
        if (!selected || !isOwner || busy || !isCurrentDetailTarget(selected.id)) return;
        const title = editingTitle.trim();
        if (!title || title === selected.title) return;
        const targetId = selected.id;
        setBusy(true);
        try {
            const updated = await updateScheduleCalendar(targetId, { title });
            if (isCurrentDetailTarget(targetId)) replaceCalendar(updated);
        } catch (error) {
            Alert.alert("이름 변경 실패", errorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [busy, editingTitle, isCurrentDetailTarget, isOwner, replaceCalendar, selected]);

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
    }, [busy, isCurrentDetailTarget, selectCalendar, selected]);

    const goBack = () => router.canGoBack() ? router.back() : router.replace("/schedule");

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
                    <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>공유 캘린더</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 캘린더 새로고침"
                    onPress={() => loadCalendars(true)}
                    style={styles.iconButton}
                >
                    <Ionicons name="refresh" size={21} color={colors.textPrimary} />
                </Pressable>
            </View>

            <ScrollView
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadCalendars(true)} />}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
            >
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>새 캘린더</Text>
                    <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                        <TextInput
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
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>내 캘린더</Text>
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
                                    <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={1}>{calendar.title}</Text>
                                    <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                                        {roleLabel(calendar.myRole)} · {calendar.memberCount}명 · {contentModeLabel(calendar.defaultContentMode)}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={selectedRow ? accent : colors.textSecondary} />
                            </Pressable>
                        );
                    })}
                </View>

                {selected ? detailReady ? (
                    <View style={[styles.detailBand, { borderTopColor: colors.border }]}>
                        <View style={styles.detailHeader}>
                            <View style={styles.rowText}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>설정</Text>
                                <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{roleLabel(selected.myRole)} 권한</Text>
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
                                    <Ionicons name="share-social-outline" size={17} color="#FFFFFF" />
                                    <Text style={styles.shareButtonText}>공유하기</Text>
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
                                    <Text style={[styles.preferenceTitle, { color: colors.textPrimary }]}>카테고리 관리</Text>
                                    <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>이 캘린더에서만 사용하는 카테고리</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
                            </Pressable>
                        ) : null}

                        {isOwner ? (
                            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                                <TextInput value={editingTitle} onChangeText={setEditingTitle} maxLength={80} style={[styles.input, { color: colors.textPrimary }]} />
                                <Pressable accessibilityRole="button" accessibilityLabel="캘린더 이름 저장" onPress={saveTitle} style={styles.inlineIconButton}>
                                    <Ionicons name="checkmark" size={21} color={accent} />
                                </Pressable>
                            </View>
                        ) : null}

                        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>공유 범위</Text>
                        <ContentModeControl
                            value={selected.defaultContentMode}
                            onChange={(value) => {
                                if (!isOwner) return;
                                updateMode(value).catch((error) => Alert.alert("공유 범위 변경 실패", errorMessage(error)));
                            }}
                            disabled={!isOwner}
                        />

                        <View style={styles.preferenceRow}>
                            <View style={styles.rowText}>
                                <Text style={[styles.preferenceTitle, { color: colors.textPrimary }]}>경로 미설정 알림</Text>
                                <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>일정 3일 전부터</Text>
                            </View>
                            <Switch
                                value={selected.routeReminderEnabled}
                                disabled={busy}
                                onValueChange={toggleMyReminder}
                                trackColor={{ false: colors.border, true: accent }}
                            />
                        </View>

                        <View style={styles.memberHeader}>
                            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>멤버</Text>
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
                    </View>
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
                                    <Ionicons name="refresh" size={16} color={accent} />
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

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <View style={styles.colorRow}>
            {CALENDAR_COLORS.map((color) => (
                <Pressable
                    key={color}
                    accessibilityRole="radio"
                    accessibilityLabel={`${color} 색상`}
                    accessibilityState={{ selected: value === color }}
                    onPress={() => onChange(color)}
                    style={[styles.colorButton, value === color && styles.colorButtonSelected]}
                >
                    <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                </Pressable>
            ))}
        </View>
    );
}

function ContentModeControl({
    value,
    onChange,
    disabled = false,
}: {
    value: ScheduleShareContentMode;
    onChange: (value: ScheduleShareContentMode) => void;
    disabled?: boolean;
}) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#8BB7FF" : BRAND_BLUE;
    return (
        <View style={[styles.modeControl, { backgroundColor: colors.surface2 }]}>
            {([
                ["SCHEDULE_ONLY", "일정만", "calendar-outline"],
                ["SCHEDULE_AND_TRAVEL", "일정 + 각자 경로", "navigate-outline"],
            ] as const).map(([modeValue, label, icon]) => {
                const active = value === modeValue;
                return (
                    <Pressable
                        key={modeValue}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active, disabled }}
                        disabled={disabled}
                        onPress={() => onChange(modeValue)}
                        style={[styles.modeOption, active && { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                        <Ionicons name={icon} size={16} color={active ? accent : colors.textSecondary} />
                        <Text style={[styles.modeText, { color: active ? accent : colors.textSecondary }]} numberOfLines={2}>{label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

function MemberRow({
    member,
    canManage,
    busy,
    onRoleChange,
    onRemove,
    onTransfer,
}: {
    member: ScheduleCalendarMember;
    canManage: boolean;
    busy: boolean;
    onRoleChange: (role: "VIEWER" | "EDITOR") => void;
    onRemove: () => void;
    onTransfer: () => void;
}) {
    const { colors } = useTheme();
    return (
        <View style={[styles.memberRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
                <Ionicons name={member.role === "OWNER" ? "key-outline" : "person-outline"} size={17} color={colors.textSecondary} />
            </View>
            <View style={styles.rowText}>
                <Text style={[styles.memberName, { color: colors.textPrimary }]} numberOfLines={1}>
                    {member.name || member.email || `회원 #${member.memberId}`}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {member.email || `NoLate ID #${member.memberId}`}
                </Text>
            </View>
            {canManage ? (
                <View style={styles.memberActions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${roleLabel(member.role)} 권한 변경`}
                        disabled={busy}
                        onPress={() => onRoleChange(member.role === "EDITOR" ? "VIEWER" : "EDITOR")}
                        style={[styles.roleButton, { borderColor: colors.border }]}
                    >
                        <Text style={[styles.roleButtonText, { color: colors.textPrimary }]}>{roleLabel(member.role)}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="소유권 이전" onPress={onTransfer} disabled={busy} style={styles.smallIcon}>
                        <Ionicons name="key-outline" size={17} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="멤버 제거" onPress={onRemove} disabled={busy} style={styles.smallIcon}>
                        <Ionicons name="close" size={18} color="#D70015" />
                    </Pressable>
                </View>
            ) : (
                <Text style={[styles.roleStatic, { color: colors.textSecondary }]}>{roleLabel(member.role)}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { minHeight: 60, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerTitle: { fontSize: 18, fontWeight: "800", letterSpacing: 0 },
    iconButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
    content: { paddingHorizontal: 18, gap: 24 },
    section: { gap: 10 },
    sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: 0 },
    inputRow: { height: 48, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 13 },
    input: { flex: 1, minWidth: 0, height: "100%", paddingVertical: 0, fontSize: 15, fontWeight: "600", letterSpacing: 0 },
    addButton: { width: 42, height: 42, marginRight: 2, borderRadius: 7, alignItems: "center", justifyContent: "center" },
    inlineIconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
    colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    colorButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
    colorButtonSelected: { borderColor: "#2F80FF" },
    colorSwatch: { width: 24, height: 24, borderRadius: 12 },
    modeControl: { minHeight: 44, borderRadius: 8, padding: 3, flexDirection: "row", gap: 3 },
    modeOption: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: "transparent", borderRadius: 6, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    modeText: { flexShrink: 1, fontSize: 12, lineHeight: 15, fontWeight: "800", textAlign: "center", letterSpacing: 0 },
    loadingRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
    empty: { minHeight: 84, borderTopWidth: 1, borderBottomWidth: 1, alignItems: "center", justifyContent: "center", gap: 6 },
    emptyText: { fontSize: 13, fontWeight: "600", letterSpacing: 0 },
    calendarRow: { minHeight: 64, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 11 },
    calendarMark: { width: 8, height: 32, borderRadius: 4 },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 15, fontWeight: "800", letterSpacing: 0 },
    rowMeta: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0 },
    detailBand: { borderTopWidth: 1, paddingTop: 20, gap: 12 },
    detailLoading: { minHeight: 112, borderTopWidth: 1, paddingTop: 20, alignItems: "center", justifyContent: "center", gap: 10 },
    retryButton: { height: 36, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
    retryText: { fontSize: 12, fontWeight: "800", letterSpacing: 0 },
    detailHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
    shareButton: { minWidth: 92, height: 38, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    shareButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: 0 },
    fieldLabel: { marginTop: 2, fontSize: 12, fontWeight: "700", letterSpacing: 0 },
    preferenceRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12 },
    categoryManageButton: { minHeight: 58, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 11 },
    preferenceTitle: { fontSize: 14, fontWeight: "700", letterSpacing: 0 },
    memberHeader: { marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    memberCount: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
    memberRow: { minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 10 },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    memberName: { fontSize: 13, fontWeight: "700", letterSpacing: 0 },
    memberActions: { flexDirection: "row", alignItems: "center", gap: 2 },
    roleButton: { height: 32, minWidth: 48, borderWidth: 1, borderRadius: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
    roleButtonText: { fontSize: 11, fontWeight: "800", letterSpacing: 0 },
    smallIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    roleStatic: { fontSize: 11, fontWeight: "700", letterSpacing: 0 },
    dangerButton: { marginTop: 8, height: 44, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
    dangerText: { fontSize: 13, fontWeight: "800", letterSpacing: 0 },
    disabledAction: { opacity: 0.45 },
});

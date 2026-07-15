import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarGlassSurface from "../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { getMyProfile, tokenLoginMember, type MemberProfileDto } from "../src/api/member";
import { useAuth } from "../src/modules/auth/AuthContext";
import {
    getAuthMember,
    getRefreshToken,
    saveAuthMember,
    saveAuthTokens,
    type StoredAuthMember,
} from "../src/modules/auth/authStorage";
import {
    refreshCalendarConnectionSnapshotFromDevice,
    type CalendarConnectionSnapshot,
} from "../src/modules/onboarding/calendarConnectionStorage";
import { useTheme } from "../src/modules/theme/ThemeContext";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

function formatLoginType(loginType?: string) {
    switch (loginType) {
        case "NAVER":
            return "네이버";
        case "KAKAO":
            return "카카오";
        case "APPLE":
            return "Apple";
        case "GOOGLE":
            return "Google";
        case "COMMON":
            return "이메일";
        default:
            return "확인 중";
    }
}

function formatConnectionDate(value?: string) {
    if (!value) return "아직 없음";

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "확인 필요";

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}월 ${day}일 ${hour}:${minute}`;
}

function AccountInfoRow({
    label,
    value,
    colors,
    selectable = false,
    showDivider = true,
}: {
    label: string;
    value: string;
    colors: ReturnType<typeof useTheme>["colors"];
    selectable?: boolean;
    showDivider?: boolean;
}) {
    return (
        <View
            style={[
                styles.accountRow,
                showDivider ? styles.accountRowDivider : styles.accountRowLast,
                {
                    borderBottomColor: colors.border,
                },
            ]}
        >
            <Text style={[styles.accountLabel, { color: colors.textSecondary }]}>{label}</Text>
            <Text
                selectable={selectable}
                numberOfLines={2}
                style={[styles.accountValue, { color: colors.textPrimary }]}
            >
                {value}
            </Text>
        </View>
    );
}

function CalendarConnectionStat({ label, value }: { label: string; value: string }) {
    const { colors } = useTheme();

    return (
        <View style={styles.calendarStatItem}>
            <Text style={[styles.calendarStatValue, { color: colors.textPrimary }]}>{value}</Text>
            <Text style={[styles.calendarStatLabel, { color: colors.textSecondary }]}>{label}</Text>
        </View>
    );
}

export default function ProfileScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { signOut } = useAuth();
    const [profile, setProfile] = useState<MemberProfileDto | null>(null);
    const [account, setAccount] = useState<StoredAuthMember | null>(null);
    const [calendarConnection, setCalendarConnection] = useState<CalendarConnectionSnapshot | null>(null);
    const [signingOut, setSigningOut] = useState(false);

    const rawDisplayName = account?.name?.trim() ?? "";
    const displayAccountName = rawDisplayName || "이름 정보 없음";
    const displayEmail = account?.email || "이메일 정보 없음";
    const displayLoginType = formatLoginType(account?.loginType);
    const displayMemberId = profile?.memberId ?? account?.id;
    const profileSummary = displayMemberId
        ? `회원 #${displayMemberId} · ${displayLoginType}`
        : displayLoginType;
    const avatarInitial = rawDisplayName.trim().slice(0, 1) || "N";

    const loadAccount = useCallback(async () => {
        const stored = await getAuthMember();
        if (stored?.name || stored?.email) {
            setAccount(stored);
            return;
        }

        const refreshToken = await getRefreshToken();
        if (!refreshToken) return;

        const member = await tokenLoginMember({ refreshToken });
        await saveAuthTokens(member.accessToken, member.refreshToken);
        await saveAuthMember(member);
        setAccount(await getAuthMember());
    }, []);

    const loadProfile = useCallback(async () => {
        try {
            const [next, , nextCalendarConnection] = await Promise.all([
                getMyProfile(),
                loadAccount().catch((error) => {
                    console.warn("[profile] account info load failed", error);
                }),
                refreshCalendarConnectionSnapshotFromDevice().catch((error) => {
                    console.warn("[profile] calendar connection load failed", error);
                    return null;
                }),
            ]);
            setProfile(next);
            setCalendarConnection(nextCalendarConnection);
        } catch (error) {
            Alert.alert("프로필 조회 실패", getErrorMessage(error));
        }
    }, [loadAccount]);

    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    const handleSignOut = useCallback(() => {
        Alert.alert("로그아웃", "현재 계정에서 로그아웃할까요?", [
            { text: "취소", style: "cancel" },
            {
                text: "로그아웃",
                style: "destructive",
                onPress: async () => {
                    setSigningOut(true);
                    await signOut();
                    router.replace("/auth/login");
                },
            },
        ]);
    }, [router, signOut]);

    const goBackToSchedule = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace("/schedule");
    }, [router]);

    const openCalendarOnboarding = useCallback(() => {
        router.push("/onboarding/calendar-import");
    }, [router]);

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityLabel="일정 목록으로 돌아가기"
                        onPress={goBackToSchedule}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>프로필</Text>

                <View style={styles.headerSpacer} />
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 20 },
                ]}
            >
                <CalendarGlassSurface
                    variant="card"
                    tone="solidCard"
                    style={[
                        styles.profileCard,
                        { borderColor: colors.border },
                    ]}
                >
                    <View
                        style={[
                            styles.avatar,
                            mode === "dark" ? styles.avatarDark : styles.avatarLight,
                        ]}
                    >
                        <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            style={[
                                styles.avatarText,
                                mode === "dark" ? styles.avatarTextDark : styles.avatarTextLight,
                            ]}
                        >
                            {avatarInitial}
                        </Text>
                    </View>
                    <View style={styles.profileCardText}>
                        <Text
                            numberOfLines={1}
                            style={[styles.profileName, { color: colors.textPrimary }]}
                        >
                            {displayAccountName}
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={[styles.profileMeta, { color: colors.textSecondary }]}
                        >
                            {profileSummary}
                        </Text>
                    </View>
                </CalendarGlassSurface>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>계정 정보</Text>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[styles.accountCard, { borderColor: colors.border }]}
                    >
                        <AccountInfoRow
                            label="이름"
                            value={displayAccountName}
                            colors={colors}
                        />
                        <AccountInfoRow
                            label="이메일"
                            value={displayEmail}
                            colors={colors}
                            selectable
                        />
                        <AccountInfoRow
                            label="로그인"
                            value={displayLoginType}
                            colors={colors}
                            showDivider={false}
                        />
                    </CalendarGlassSurface>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>캘린더 연동</Text>
                    <CalendarGlassSurface
                        interactive={!calendarConnection}
                        variant="card"
                        tone="solidCard"
                        style={[styles.calendarConnectionCard, { borderColor: colors.border }]}
                    >
                        {calendarConnection ? (
                            <View style={styles.calendarConnectionContent}>
                                <View style={styles.calendarConnectionHeader}>
                                    <View style={[styles.calendarConnectionIcon, { backgroundColor: colors.selectedDayBg }]}>
                                        <Ionicons name="calendar-outline" size={21} color={colors.selectedDayText} />
                                    </View>
                                    <View style={styles.calendarConnectionTitleWrap}>
                                        <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                            {calendarConnection.providerLabel}
                                        </Text>
                                        <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                            선택한 캘린더에서 연동됨
                                        </Text>
                                    </View>
                                    <View style={styles.connectedBadge}>
                                        <Text style={styles.connectedBadgeText}>연동됨</Text>
                                    </View>
                                </View>
                                <View style={[styles.calendarStats, { borderTopColor: colors.border }]}>
                                    <CalendarConnectionStat
                                        label="캘린더"
                                        value={`${calendarConnection.calendarCount}개`}
                                    />
                                    <CalendarConnectionStat
                                        label="후보 일정"
                                        value={`${calendarConnection.eventCandidateCount}개`}
                                    />
                                    <CalendarConnectionStat
                                        label="가져온 일정"
                                        value={`${calendarConnection.importedCount}개`}
                                    />
                                </View>
                                {calendarConnection.calendarNames.length > 0 ? (
                                    <View style={styles.syncedCalendarList}>
                                        {calendarConnection.calendarNames.map((name) => (
                                            <View key={name} style={[styles.syncedCalendarPill, { borderColor: colors.border }]}>
                                                <Ionicons name="ellipse" size={7} color={colors.textSecondary} />
                                                <Text
                                                    numberOfLines={1}
                                                    style={[styles.syncedCalendarPillText, { color: colors.textPrimary }]}
                                                >
                                                    {name}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                ) : null}
                                <Text style={[styles.calendarConnectionFooter, { color: colors.textSecondary }]}>
                                    마지막 확인 {formatConnectionDate(calendarConnection.lastScannedAt)}
                                    {calendarConnection.lastImportedAt
                                        ? ` · 마지막 가져오기 ${formatConnectionDate(calendarConnection.lastImportedAt)}`
                                        : ""}
                                </Text>
                            </View>
                        ) : (
                            <Pressable
                                onPress={openCalendarOnboarding}
                                style={({ pressed }) => [
                                    styles.calendarEmptyButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={[styles.calendarConnectionIcon, { backgroundColor: colors.selectedDayBg }]}>
                                    <Ionicons name="calendar-outline" size={21} color={colors.selectedDayText} />
                                </View>
                                <View style={styles.calendarConnectionTitleWrap}>
                                    <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                        연동된 캘린더 없음
                                    </Text>
                                    <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                        기기 캘린더 또는 Google에서 일정을 가져올 수 있어요
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                            </Pressable>
                        )}
                    </CalendarGlassSurface>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>앱 설정</Text>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[styles.settingsCard, { borderColor: colors.border }]}
                    >
                        <View style={styles.settingTextWrap}>
                            <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>다크 모드</Text>
                            <Text style={[styles.settingHint, { color: colors.textSecondary }]}>기기 설정을 기본으로 사용</Text>
                        </View>
                        <View style={styles.settingSwitchWrap}>
                            <ThemeModeSwitch style={styles.settingSwitch} />
                        </View>
                    </CalendarGlassSurface>
                </View>

                <CalendarGlassSurface
                    interactive
                    variant="card"
                    tone="solidCard"
                    style={[styles.signOutGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        disabled={signingOut}
                        onPress={handleSignOut}
                        style={({ pressed }) => [
                            styles.signOutButton,
                            {
                                opacity: pressed || signingOut ? 0.58 : 1,
                            },
                        ]}
                    >
                        <Ionicons name="log-out-outline" size={19} color="#ef4444" />
                        <Text style={styles.signOutText}>
                            {signingOut ? "로그아웃 중" : "로그아웃"}
                        </Text>
                    </Pressable>
                </CalendarGlassSurface>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        minHeight: 64,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "900",
    },
    backGlass: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
    },
    backButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerSpacer: {
        width: 44,
        height: 44,
    },
    content: {
        paddingHorizontal: 18,
        paddingTop: 12,
        gap: 22,
    },
    profileCard: {
        minHeight: 118,
        borderWidth: 1,
        borderRadius: 22,
        paddingHorizontal: 22,
        flexDirection: "row",
        alignItems: "center",
        gap: 18,
    },
    avatar: {
        width: 74,
        height: 74,
        borderRadius: 37,
        alignItems: "center",
        justifyContent: "center",
    },
    avatarDark: {
        backgroundColor: "rgba(255,255,255,0.90)",
    },
    avatarLight: {
        backgroundColor: "rgba(0,0,0,0.88)",
    },
    avatarText: {
        fontSize: 28,
        fontWeight: "900",
    },
    avatarTextDark: {
        color: "#000000",
    },
    avatarTextLight: {
        color: "#ffffff",
    },
    profileCardText: {
        flex: 1,
        minWidth: 0,
        gap: 5,
    },
    profileName: {
        fontSize: 22,
        fontWeight: "900",
    },
    profileMeta: {
        fontSize: 13,
        fontWeight: "800",
    },
    section: {
        gap: 8,
    },
    sectionTitle: {
        paddingHorizontal: 2,
        fontSize: 12,
        fontWeight: "900",
    },
    accountCard: {
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 16,
    },
    accountRow: {
        minHeight: 58,
        paddingVertical: 11,
        justifyContent: "center",
    },
    accountRowDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    accountRowLast: {
        borderBottomWidth: 0,
    },
    accountLabel: {
        fontSize: 11,
        fontWeight: "800",
    },
    accountValue: {
        marginTop: 4,
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 20,
    },
    settingsCard: {
        borderWidth: 1,
        borderRadius: 18,
        minHeight: 72,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
    },
    calendarConnectionCard: {
        borderWidth: 1,
        borderRadius: 18,
        overflow: "hidden",
    },
    calendarConnectionContent: {
        padding: 16,
        gap: 13,
    },
    calendarConnectionHeader: {
        minHeight: 46,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    calendarConnectionIcon: {
        width: 38,
        height: 38,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111111",
    },
    calendarConnectionTitleWrap: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    calendarConnectionTitle: {
        fontSize: 15,
        fontWeight: "900",
    },
    calendarConnectionHint: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    connectedBadge: {
        borderRadius: 12,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: "rgba(34,197,94,0.14)",
    },
    connectedBadgeText: {
        color: "#22c55e",
        fontSize: 11,
        fontWeight: "900",
    },
    calendarStats: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 12,
        flexDirection: "row",
        gap: 10,
    },
    calendarStatItem: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    calendarStatValue: {
        fontSize: 15,
        fontWeight: "900",
    },
    calendarStatLabel: {
        fontSize: 11,
        fontWeight: "800",
    },
    syncedCalendarList: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 7,
    },
    syncedCalendarPill: {
        maxWidth: "100%",
        minHeight: 30,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    syncedCalendarPillText: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12,
        fontWeight: "800",
    },
    calendarConnectionFooter: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "700",
    },
    calendarEmptyButton: {
        minHeight: 78,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    settingTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: "900",
    },
    settingHint: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: "700",
    },
    settingSwitchWrap: {
        width: 64,
        height: 44,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    settingSwitch: {
        transform: [{ scale: 0.9 }],
    },
    signOutButton: {
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    signOutGlass: {
        borderWidth: 1,
        borderRadius: 18,
    },
    signOutText: {
        color: "#ef4444",
        fontSize: 15,
        fontWeight: "900",
    },
});

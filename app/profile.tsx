import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
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
import { useTheme } from "../src/modules/theme/ThemeContext";

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

export default function ProfileScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode, toggleMode } = useTheme();
    const { signOut } = useAuth();
    const [profile, setProfile] = useState<MemberProfileDto | null>(null);
    const [account, setAccount] = useState<StoredAuthMember | null>(null);
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
            const [next] = await Promise.all([
                getMyProfile(),
                loadAccount().catch((error) => {
                    console.warn("[profile] account info load failed", error);
                }),
            ]);
            setProfile(next);
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
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>앱 설정</Text>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[styles.settingsCard, { borderColor: colors.border }]}
                    >
                        <View style={styles.settingTextWrap}>
                            <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>다크 모드</Text>
                            <Text style={[styles.settingHint, { color: colors.textSecondary }]}>캘린더와 지도 화면 테마</Text>
                        </View>
                        <View style={styles.settingSwitchWrap}>
                            <Switch
                                value={mode === "dark"}
                                onValueChange={toggleMode}
                                trackColor={{ false: colors.border, true: colors.selectedDayBg }}
                                thumbColor="#ffffff"
                                style={styles.settingSwitch}
                            />
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

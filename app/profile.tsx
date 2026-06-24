import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarGlassSurface from "../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { getMyProfile, updateMyProfile, type MemberProfileDto } from "../src/api/member";
import { useAuth } from "../src/modules/auth/AuthContext";
import { useTheme } from "../src/modules/theme/ThemeContext";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ProfileScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode, toggleMode } = useTheme();
    const { signOut } = useAuth();
    const [profile, setProfile] = useState<MemberProfileDto | null>(null);
    const [nickname, setNickname] = useState("");
    const [intro, setIntro] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

    const isDirty = useMemo(() => {
        if (!profile) return false;
        return nickname.trim() !== (profile.nickname ?? "").trim() ||
            intro.trim() !== (profile.intro ?? "").trim();
    }, [intro, nickname, profile]);

    const loadProfile = useCallback(async () => {
        setLoading(true);
        try {
            const next = await getMyProfile();
            setProfile(next);
            setNickname(next.nickname ?? "");
            setIntro(next.intro ?? "");
        } catch (error) {
            Alert.alert("프로필 조회 실패", getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    const saveProfile = useCallback(async () => {
        if (!profile || saving) return;

        setSaving(true);
        try {
            const next = await updateMyProfile({
                nickname: nickname.trim() || null,
                intro: intro.trim() || null,
                imgId: profile.imgId ?? null,
            });
            setProfile(next);
            setNickname(next.nickname ?? "");
            setIntro(next.intro ?? "");
        } catch (error) {
            Alert.alert("프로필 저장 실패", getErrorMessage(error));
        } finally {
            setSaving(false);
        }
    }, [intro, nickname, profile, saving]);

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

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.root, { backgroundColor: colors.background }]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <CalendarGlassSurface
                    interactive
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityLabel="일정 목록으로 돌아가기"
                        onPress={() => router.replace("/schedule")}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>프로필</Text>

                <CalendarGlassSurface
                    interactive
                    style={[styles.saveGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        disabled={!isDirty || saving || loading}
                        onPress={saveProfile}
                        style={({ pressed }) => [
                            styles.saveButton,
                            { opacity: !isDirty || saving || loading ? 0.38 : pressed ? 0.65 : 1 },
                        ]}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color={colors.textPrimary} />
                        ) : (
                            <Text style={[styles.saveText, { color: colors.textPrimary }]}>저장</Text>
                        )}
                    </Pressable>
                </CalendarGlassSurface>
            </View>

            <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 20 },
                ]}
            >
                <CalendarGlassSurface style={[styles.profileCard, { borderColor: colors.border }]}>
                    <View style={[styles.avatar, { backgroundColor: colors.selectedDayBg }]}>
                        <Text style={[styles.avatarText, { color: colors.selectedDayText }]}>
                            {(nickname.trim() || "N").slice(0, 1).toUpperCase()}
                        </Text>
                    </View>

                    <View style={styles.profileMeta}>
                        <Text style={[styles.profileName, { color: colors.textPrimary }]} numberOfLines={1}>
                            {nickname.trim() || "이름 없는 사용자"}
                        </Text>
                        <Text style={[styles.profileSub, { color: colors.textSecondary }]}>
                            회원 #{profile?.memberId ?? "-"}
                        </Text>
                    </View>
                </CalendarGlassSurface>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>기본 정보</Text>
                    <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>닉네임</Text>
                        <TextInput
                            editable={!loading}
                            value={nickname}
                            onChangeText={setNickname}
                            placeholder="닉네임"
                            placeholderTextColor={colors.textDisabled}
                            style={[
                                styles.input,
                                {
                                    backgroundColor: colors.surface2,
                                    borderColor: colors.border,
                                    color: colors.textPrimary,
                                },
                            ]}
                        />

                        <Text style={[styles.label, { color: colors.textSecondary }]}>소개</Text>
                        <TextInput
                            editable={!loading}
                            value={intro}
                            onChangeText={setIntro}
                            placeholder="간단한 소개를 입력하세요"
                            placeholderTextColor={colors.textDisabled}
                            multiline
                            textAlignVertical="top"
                            style={[
                                styles.input,
                                styles.introInput,
                                {
                                    backgroundColor: colors.surface2,
                                    borderColor: colors.border,
                                    color: colors.textPrimary,
                                },
                            ]}
                        />
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>앱 설정</Text>
                    <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={styles.settingTextWrap}>
                            <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>다크 모드</Text>
                            <Text style={[styles.settingHint, { color: colors.textSecondary }]}>캘린더와 지도 화면 테마</Text>
                        </View>
                        <Switch
                            value={mode === "dark"}
                            onValueChange={toggleMode}
                            trackColor={{ false: colors.border, true: "#34c759" }}
                            thumbColor="#ffffff"
                        />
                    </View>
                </View>

                <Pressable
                    disabled={signingOut}
                    onPress={handleSignOut}
                    style={({ pressed }) => [
                        styles.signOutButton,
                        {
                            borderColor: colors.border,
                            backgroundColor: colors.surface,
                            opacity: pressed || signingOut ? 0.58 : 1,
                        },
                    ]}
                >
                    <Ionicons name="log-out-outline" size={19} color="#ef4444" />
                    <Text style={styles.signOutText}>
                        {signingOut ? "로그아웃 중" : "로그아웃"}
                    </Text>
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
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
    saveGlass: {
        minWidth: 62,
        height: 42,
        borderRadius: 21,
        borderWidth: 1,
    },
    saveButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    saveText: {
        fontSize: 14,
        fontWeight: "900",
    },
    content: {
        paddingHorizontal: 18,
        paddingTop: 12,
        gap: 22,
    },
    profileCard: {
        minHeight: 116,
        borderRadius: 24,
        borderWidth: 1,
        paddingHorizontal: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
    },
    avatar: {
        width: 68,
        height: 68,
        borderRadius: 34,
        alignItems: "center",
        justifyContent: "center",
    },
    avatarText: {
        fontSize: 28,
        fontWeight: "900",
    },
    profileMeta: {
        flex: 1,
    },
    profileName: {
        fontSize: 22,
        fontWeight: "900",
    },
    profileSub: {
        marginTop: 5,
        fontSize: 13,
        fontWeight: "700",
    },
    section: {
        gap: 8,
    },
    sectionTitle: {
        paddingHorizontal: 2,
        fontSize: 12,
        fontWeight: "900",
    },
    formCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
    },
    label: {
        marginBottom: 7,
        fontSize: 12,
        fontWeight: "800",
    },
    input: {
        minHeight: 48,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 14,
        fontSize: 16,
        fontWeight: "700",
        marginBottom: 14,
    },
    introInput: {
        minHeight: 108,
        paddingTop: 13,
        marginBottom: 0,
        lineHeight: 22,
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
    signOutButton: {
        minHeight: 52,
        borderRadius: 18,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    signOutText: {
        color: "#ef4444",
        fontSize: 15,
        fontWeight: "900",
    },
});

import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    AccessibilityInfo,
    Alert,
    Clipboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarGlassSurface from "../src/modules/schedule/components/calendar/CalendarGlassSurface";
import {
    changePassword,
    getMyProfile,
    tokenLoginMember,
    updateMyProfile,
    withdrawMember,
    type MemberProfileDto,
} from "../src/api/member";
import { useAuth } from "../src/modules/auth/AuthContext";
import {
    getAuthMember,
    getRefreshToken,
    saveAuthMember,
    saveAuthTokens,
    type StoredAuthMember,
} from "../src/modules/auth/authStorage";
import {
    getCalendarConnectionSnapshot,
    refreshCalendarConnectionSnapshotFromDevice,
    type CalendarConnectionSnapshot,
} from "../src/modules/onboarding/calendarConnectionStorage";
import {
    logoutFromKakaoSdk,
    logoutFromNaverSdk,
    unlinkKakaoSdk,
    unlinkNaverSdk,
} from "../src/modules/auth/socialLogin";
import { useTheme } from "../src/modules/theme/ThemeContext";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";
import ProfileRouteAccessibilityRoot from "../src/modules/profile/ProfileRouteAccessibilityRoot";
import BrandedLoader, { BrandedLoadingState } from "../src/ui/BrandedLoader";
import {
    runWithDepartureAlarmWithdrawalGuard,
} from "../src/modules/notification/departureAlarmSync";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])[a-zA-Z\d!@#$%^&*]{8,16}$/;

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
    onPress,
    actionLabel,
    actionIcon,
}: {
    label: string;
    value: string;
    colors: ReturnType<typeof useTheme>["colors"];
    selectable?: boolean;
    showDivider?: boolean;
    onPress?: () => void;
    actionLabel?: string;
    actionIcon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
    const content = (
        <>
            <View style={styles.accountRowMain}>
                <Text style={[styles.accountLabel, { color: colors.textSecondary }]}>{label}</Text>
                <Text
                    selectable={selectable}
                    numberOfLines={2}
                    style={[styles.accountValue, { color: colors.textPrimary }]}
                >
                    {value}
                </Text>
            </View>
            {actionLabel ? (
                <View style={styles.accountRowAction}>
                    <Text style={[styles.accountActionLabel, { color: colors.textSecondary }]}>{actionLabel}</Text>
                    {actionIcon ? <Ionicons name={actionIcon} size={16} color={colors.textSecondary} /> : null}
                </View>
            ) : null}
        </>
    );
    const rowStyle = [
        styles.accountRow,
        showDivider ? styles.accountRowDivider : styles.accountRowLast,
        { borderBottomColor: colors.border },
    ];

    if (onPress) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${value}${actionLabel ? `, ${actionLabel}` : ""}`}
                onPress={onPress}
                style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.58 : 1 }]}
            >
                {content}
            </Pressable>
        );
    }

    return (
        <View
            style={[
                rowStyle,
            ]}
        >
            {content}
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
    const [calendarConnectionError, setCalendarConnectionError] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [editingProfile, setEditingProfile] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [memberIdCopied, setMemberIdCopied] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [withdrawalModalOpen, setWithdrawalModalOpen] = useState(false);
    const [withdrawalPassword, setWithdrawalPassword] = useState("");
    const [passwordModalOpen, setPasswordModalOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [savingPassword, setSavingPassword] = useState(false);
    const profileLoadSequenceRef = React.useRef(0);
    const savingProfileRef = React.useRef(false);
    const savingPasswordRef = React.useRef(false);
    const signingOutRef = React.useRef(false);
    const withdrawingRef = React.useRef(false);
    const hasOpenModal = editingProfile || passwordModalOpen || withdrawalModalOpen;

    const rawDisplayName = account?.name?.trim() ?? "";
    const profileName = profile?.nickname?.trim() ?? "";
    const displayAccountName = profileName || rawDisplayName || "이름 정보 없음";
    const isNaverAccount = account?.loginType === "NAVER";
    const isKakaoAccount = account?.loginType === "KAKAO";
    const displayEmail = account?.email || (isNaverAccount ? "네이버에서 이메일 제공에 동의하지 않음" : "이메일 정보 없음");
    const displayLoginType = formatLoginType(account?.loginType);
    const displayMemberId = profile?.memberId ?? account?.id;
    const profileSummary = displayMemberId
        ? `NoLate ID #${displayMemberId} · ${displayLoginType}`
        : displayLoginType;
    const avatarInitial = displayAccountName.trim().slice(0, 1) || "N";

    const loadAccount = useCallback(async () => {
        const stored = await getAuthMember();
        // loginType controls password change and withdrawal verification. Treat
        // legacy/partial profile metadata as a cache miss instead of guessing a
        // social account and sending an invalid withdrawal request.
        if (stored?.id && stored.loginType) {
            setAccount(stored);
            return;
        }

        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
            throw new Error("로그인 계정 정보를 확인하지 못했어요. 다시 로그인해 주세요.");
        }

        const member = await tokenLoginMember({ refreshToken });
        await saveAuthTokens(member.accessToken, member.refreshToken);
        await saveAuthMember(member);
        setAccount(await getAuthMember());
    }, []);

    const loadProfile = useCallback(async () => {
        const sequence = profileLoadSequenceRef.current + 1;
        profileLoadSequenceRef.current = sequence;
        setLoadingProfile(true);
        setProfileError(null);
        setCalendarConnectionError(false);
        try {
            const [next, , cachedCalendarConnection] = await Promise.all([
                getMyProfile(),
                loadAccount(),
                getCalendarConnectionSnapshot(),
            ]);
            if (sequence !== profileLoadSequenceRef.current) return;
            setProfile(next);
            setCalendarConnection(cachedCalendarConnection);

            // 기기/Google 캘린더 재확인은 네트워크와 EventKit 조회 때문에 오래 걸릴 수
            // 있으므로 프로필 본문을 먼저 보여주고 연결 카드만 백그라운드에서 갱신한다.
            refreshCalendarConnectionSnapshotFromDevice()
                .then((nextCalendarConnection) => {
                    if (sequence === profileLoadSequenceRef.current) {
                        setCalendarConnection(nextCalendarConnection);
                    }
                })
                .catch((error) => {
                    if (sequence !== profileLoadSequenceRef.current) return;
                    console.warn("[profile] calendar connection load failed", error);
                    setCalendarConnectionError(true);
                });
        } catch (error) {
            if (sequence !== profileLoadSequenceRef.current) return;
            setProfileError(getErrorMessage(error));
        } finally {
            if (sequence === profileLoadSequenceRef.current) setLoadingProfile(false);
        }
    }, [loadAccount]);

    const openProfileEditor = useCallback(() => {
        setDraftName(displayAccountName === "이름 정보 없음" ? "" : displayAccountName);
        setEditingProfile(true);
    }, [displayAccountName]);

    const copyMemberId = useCallback(() => {
        if (!displayMemberId) return;
        Clipboard.setString(String(displayMemberId));
        setMemberIdCopied(true);
        AccessibilityInfo.announceForAccessibility("NoLate ID를 복사했어요");
    }, [displayMemberId]);

    const saveProfile = useCallback(async () => {
        if (savingProfileRef.current) return;
        const nickname = draftName.trim();
        if (!nickname) {
            Alert.alert("이름을 입력해 주세요", "프로필에 표시할 이름이 필요합니다.");
            return;
        }
        if (nickname.length > 20) {
            Alert.alert("이름이 너무 길어요", "이름은 20자 이하로 입력해 주세요.");
            return;
        }
        if (!profile?.memberId) {
            Alert.alert("저장 실패", "회원 정보를 확인한 뒤 다시 시도해 주세요.");
            return;
        }

        savingProfileRef.current = true;
        setSavingProfile(true);
        try {
            const updated = await updateMyProfile({
                nickname,
                imgId: profile.imgId,
                intro: profile.intro,
            });
            setProfile(updated);
            setEditingProfile(false);
        } catch (error) {
            Alert.alert("프로필 저장 실패", getErrorMessage(error));
        } finally {
            savingProfileRef.current = false;
            setSavingProfile(false);
        }
    }, [draftName, profile]);

    useEffect(() => {
        loadProfile();
        return () => {
            profileLoadSequenceRef.current += 1;
        };
    }, [loadProfile]);

    useEffect(() => {
        if (!memberIdCopied) return;
        const timer = setTimeout(() => setMemberIdCopied(false), 1600);
        return () => clearTimeout(timer);
    }, [memberIdCopied]);

    const handleSignOut = useCallback(() => {
        Alert.alert("로그아웃", "현재 계정에서 로그아웃할까요?", [
            { text: "취소", style: "cancel" },
            {
                text: "로그아웃",
                style: "destructive",
                onPress: async () => {
                    if (signingOutRef.current) return;
                    signingOutRef.current = true;
                    setSigningOut(true);
                    try {
                        if (isNaverAccount) {
                            await logoutFromNaverSdk().catch((error) => {
                                console.warn("[naver] sdk logout failed", error);
                            });
                        }
                        if (isKakaoAccount) {
                            await logoutFromKakaoSdk().catch((error) => {
                                console.warn("[kakao] sdk logout failed", error);
                            });
                        }
                        await signOut();
                    } finally {
                        signingOutRef.current = false;
                        setSigningOut(false);
                        router.replace("/auth/login");
                    }
                },
            },
        ]);
    }, [isKakaoAccount, isNaverAccount, router, signOut]);

    const handleWithdraw = useCallback(() => {
        if (!account?.loginType) {
            Alert.alert("계정 정보 확인 필요", "계정 정보를 다시 불러온 뒤 시도해 주세요.");
            return;
        }

        if (account?.loginType === "COMMON") {
            setWithdrawalPassword("");
            setWithdrawalModalOpen(true);
            return;
        }

        Alert.alert(
            "회원탈퇴",
            "NoLate 계정과 저장된 일정 정보가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.",
            [
                { text: "취소", style: "cancel" },
                {
                    text: "탈퇴하기",
                    style: "destructive",
                    onPress: async () => {
                        if (withdrawingRef.current) return;
                        withdrawingRef.current = true;
                        try {
                            setWithdrawing(true);
                            await runWithDepartureAlarmWithdrawalGuard(() => withdrawMember());
                            if (isNaverAccount) {
                                await unlinkNaverSdk().catch((error) => {
                                    console.warn("[naver] sdk unlink failed", error);
                                });
                            }
                            if (isKakaoAccount) {
                                await unlinkKakaoSdk().catch((error) => {
                                    console.warn("[kakao] sdk unlink failed", error);
                                });
                            }
                            await signOut();
                            router.replace("/auth/login");
                        } catch (error) {
                            Alert.alert("회원탈퇴 실패", getErrorMessage(error));
                            setWithdrawing(false);
                        } finally {
                            withdrawingRef.current = false;
                        }
                    },
                },
            ],
        );
    }, [account?.loginType, isKakaoAccount, isNaverAccount, router, signOut]);

    const confirmCommonWithdrawal = useCallback(async () => {
        if (withdrawingRef.current) return;
        if (!withdrawalPassword) {
            Alert.alert("비밀번호를 입력해 주세요", "본인 확인을 위해 현재 비밀번호가 필요합니다.");
            return;
        }

        try {
            withdrawingRef.current = true;
            setWithdrawing(true);
            await runWithDepartureAlarmWithdrawalGuard(
                () => withdrawMember({ password: withdrawalPassword }),
            );
            setWithdrawalModalOpen(false);
            await signOut();
            router.replace("/auth/login");
        } catch (error) {
            Alert.alert("회원탈퇴 실패", getErrorMessage(error));
        } finally {
            withdrawingRef.current = false;
            setWithdrawing(false);
        }
    }, [router, signOut, withdrawalPassword]);

    const openPasswordChange = useCallback(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordModalOpen(true);
    }, []);

    const savePasswordChange = useCallback(async () => {
        if (savingPasswordRef.current) return;
        if (!currentPassword || !newPassword) {
            Alert.alert("비밀번호 확인", "현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.");
            return;
        }
        if (!PASSWORD_PATTERN.test(newPassword)) {
            Alert.alert("비밀번호 확인", "새 비밀번호는 영문, 숫자, !@#$%^&*를 포함한 8~16자로 입력해 주세요.");
            return;
        }
        if (newPassword !== confirmPassword) {
            Alert.alert("비밀번호 확인", "새 비밀번호가 서로 일치하지 않습니다.");
            return;
        }
        if (currentPassword === newPassword) {
            Alert.alert("비밀번호 확인", "현재 비밀번호와 다른 비밀번호를 입력해 주세요.");
            return;
        }

        try {
            savingPasswordRef.current = true;
            setSavingPassword(true);
            await changePassword({ currentPassword, newPassword });
            setPasswordModalOpen(false);
            Alert.alert("비밀번호 변경 완료", "새 비밀번호로 변경했어요.");
        } catch (error) {
            Alert.alert("비밀번호 변경 실패", getErrorMessage(error));
        } finally {
            savingPasswordRef.current = false;
            setSavingPassword(false);
        }
    }, [confirmPassword, currentPassword, newPassword]);

    const goBackToSchedule = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace("/schedule");
    }, [router]);

    const openCalendarOnboarding = useCallback(() => {
        router.push({
            pathname: "/onboarding/calendar-import",
            params: { source: "profile" },
        });
    }, [router]);

    const openPlacesSettings = useCallback(() => {
        router.push("/settings/places");
    }, [router]);

    const openPrivacyPolicy = useCallback(() => {
        router.push("/legal/privacy-policy");
    }, [router]);

    const openTermsOfService = useCallback(() => {
        router.push("/legal/terms-of-service");
    }, [router]);

    if (loadingProfile) {
        return (
            <ProfileRouteAccessibilityRoot style={[styles.root, { backgroundColor: colors.background }]}>
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
                <BrandedLoadingState
                    fill
                    size="full"
                    variant="auth"
                    accessibilityLabel="내 프로필을 불러오고 있어요"
                    title="내 프로필을 불러오고 있어요"
                    caption="계정과 캘린더 연결 상태를 확인하고 있어요"
                />
            </ProfileRouteAccessibilityRoot>
        );
    }

    return (
        <ProfileRouteAccessibilityRoot style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View
                accessibilityElementsHidden={hasOpenModal}
                importantForAccessibility={hasOpenModal ? "no-hide-descendants" : "auto"}
                style={[styles.header, { paddingTop: insets.top + 8 }]}
            >
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 돌아가기"
                        onPress={goBackToSchedule}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>프로필</Text>

                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="표시 이름 수정"
                        accessibilityState={{ disabled: !profile?.memberId }}
                        disabled={!profile?.memberId}
                        onPress={openProfileEditor}
                        style={({ pressed }) => [
                            styles.backButton,
                            { opacity: !profile?.memberId ? 0.38 : pressed ? 0.55 : 1 },
                        ]}
                    >
                        <Ionicons name="pencil" size={19} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

            </View>

            <ScrollView
                accessibilityElementsHidden={hasOpenModal}
                importantForAccessibility={hasOpenModal ? "no-hide-descendants" : "auto"}
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
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
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

                {profileError ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="프로필 다시 불러오기"
                        onPress={loadProfile}
                        style={[styles.profileErrorCard, { borderColor: colors.border }]}
                    >
                        <Ionicons name="alert-circle-outline" size={19} color="#D97706" />
                        <View style={styles.profileErrorTextWrap}>
                            <Text style={[styles.profileErrorTitle, { color: colors.textPrimary }]}>일부 계정 정보를 불러오지 못했어요</Text>
                            <Text numberOfLines={2} style={[styles.profileErrorCaption, { color: colors.textSecondary }]}>{profileError}</Text>
                        </View>
                        <Text style={[styles.profileErrorRetry, { color: colors.textPrimary }]}>다시 시도</Text>
                    </Pressable>
                ) : null}

                <Modal
                    animationType="fade"
                    transparent
                    visible={editingProfile}
                    onRequestClose={() => !savingProfile && setEditingProfile(false)}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Pressable
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            disabled={savingProfile}
                            onPress={() => setEditingProfile(false)}
                            style={styles.modalBackdrop}
                        />
                        <ScrollView
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={styles.editSheetScrollContent}
                        >
                            <View style={styles.editSheetHeader}>
                                <View>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>표시 이름 수정</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>프로필에 표시할 이름을 변경합니다.</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={savingProfile}
                                    onPress={() => setEditingProfile(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>

                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>이름</Text>
                            <TextInput
                                accessibilityLabel="표시 이름"
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoFocus
                                editable={!savingProfile}
                                maxLength={20}
                                onChangeText={setDraftName}
                                onSubmitEditing={saveProfile}
                                placeholder="표시할 이름"
                                placeholderTextColor={colors.textSecondary}
                                returnKeyType="done"
                                selectionColor={colors.textPrimary}
                                style={[
                                    styles.nameInput,
                                    { color: colors.textPrimary, borderColor: colors.border },
                                ]}
                                value={draftName}
                            />
                            <Text style={[styles.inputCounter, { color: colors.textSecondary }]}>{draftName.length}/20</Text>

                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: savingProfile, busy: savingProfile }}
                                disabled={savingProfile}
                                onPress={saveProfile}
                                style={({ pressed }) => [
                                    styles.saveButton,
                                    { opacity: savingProfile || pressed ? 0.65 : 1 },
                                ]}
                            >
                                {savingProfile ? (
                                    <ActivityIndicator color="#ffffff" />
                                ) : (
                                    <Text style={styles.saveButtonText}>저장</Text>
                                )}
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <Modal
                    animationType="fade"
                    transparent
                    visible={passwordModalOpen}
                    onRequestClose={() => !savingPassword && setPasswordModalOpen(false)}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Pressable
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            disabled={savingPassword}
                            onPress={() => setPasswordModalOpen(false)}
                            style={styles.modalBackdrop}
                        />
                        <ScrollView
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={styles.editSheetScrollContent}
                        >
                            <View style={styles.editSheetHeader}>
                                <View>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>비밀번호 변경</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>영문, 숫자, 특수문자를 포함한 8~16자로 입력해 주세요.</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={savingPassword}
                                    onPress={() => setPasswordModalOpen(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>
                            {[
                                {
                                    label: "현재 비밀번호",
                                    value: currentPassword,
                                    setter: setCurrentPassword,
                                    autoComplete: "current-password" as const,
                                    textContentType: "password" as const,
                                },
                                {
                                    label: "새 비밀번호",
                                    value: newPassword,
                                    setter: setNewPassword,
                                    autoComplete: "new-password" as const,
                                    textContentType: "newPassword" as const,
                                },
                                {
                                    label: "새 비밀번호 확인",
                                    value: confirmPassword,
                                    setter: setConfirmPassword,
                                    autoComplete: "new-password" as const,
                                    textContentType: "newPassword" as const,
                                },
                            ].map((field) => (
                                <View key={field.label}>
                                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{field.label}</Text>
                                    <TextInput
                                        accessibilityLabel={field.label}
                                        autoCapitalize="none"
                                        autoComplete={field.autoComplete}
                                        autoCorrect={false}
                                        editable={!savingPassword}
                                        onChangeText={field.setter}
                                        secureTextEntry
                                        textContentType={field.textContentType}
                                        style={[styles.nameInput, { color: colors.textPrimary, borderColor: colors.border }]}
                                        value={field.value}
                                    />
                                </View>
                            ))}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: savingPassword, busy: savingPassword }}
                                disabled={savingPassword}
                                onPress={savePasswordChange}
                                style={({ pressed }) => [styles.saveButton, { opacity: savingPassword || pressed ? 0.65 : 1 }]}
                            >
                                {savingPassword ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>변경하기</Text>}
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <Modal
                    animationType="fade"
                    transparent
                    visible={withdrawalModalOpen}
                    onRequestClose={() => !withdrawing && setWithdrawalModalOpen(false)}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Pressable
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            disabled={withdrawing}
                            onPress={() => setWithdrawalModalOpen(false)}
                            style={styles.modalBackdrop}
                        />
                        <ScrollView
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={styles.editSheetScrollContent}
                        >
                            <View style={styles.editSheetHeader}>
                                <View style={styles.destructiveHeaderText}>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>회원탈퇴</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>계정과 저장된 일정이 삭제되며 되돌릴 수 없습니다.</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={withdrawing}
                                    onPress={() => setWithdrawalModalOpen(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>
                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>현재 비밀번호</Text>
                            <TextInput
                                accessibilityLabel="회원탈퇴 확인 비밀번호"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!withdrawing}
                                onChangeText={setWithdrawalPassword}
                                placeholder="비밀번호 입력"
                                placeholderTextColor={colors.textSecondary}
                                secureTextEntry
                                textContentType="password"
                                style={[styles.nameInput, { color: colors.textPrimary, borderColor: colors.border }]}
                                value={withdrawalPassword}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: withdrawing || !withdrawalPassword,
                                    busy: withdrawing,
                                }}
                                disabled={withdrawing || !withdrawalPassword}
                                onPress={confirmCommonWithdrawal}
                                style={({ pressed }) => [
                                    styles.destructiveButton,
                                    { opacity: withdrawing || !withdrawalPassword || pressed ? 0.55 : 1 },
                                ]}
                            >
                                {withdrawing ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>확인하고 탈퇴하기</Text>}
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>계정 정보</Text>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[styles.accountCard, { borderColor: colors.border }]}
                    >
                        <AccountInfoRow
                            label="표시 이름"
                            value={displayAccountName}
                            colors={colors}
                            onPress={openProfileEditor}
                            actionLabel="수정"
                            actionIcon="chevron-forward"
                        />
                        {displayMemberId ? (
                            <AccountInfoRow
                                label="NoLate ID"
                                value={`#${displayMemberId}`}
                                colors={colors}
                                onPress={copyMemberId}
                                actionLabel={memberIdCopied ? "복사됨" : "복사"}
                                actionIcon={memberIdCopied ? "checkmark" : "copy-outline"}
                            />
                        ) : null}
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
                            showDivider={account?.loginType !== "COMMON"}
                        />
                        {account?.loginType === "COMMON" ? (
                            <AccountInfoRow
                                label="비밀번호"
                                value="안전하게 변경"
                                colors={colors}
                                showDivider={false}
                                onPress={openPasswordChange}
                                actionLabel="변경"
                                actionIcon="chevron-forward"
                            />
                        ) : null}
                    </CalendarGlassSurface>
                </View>

                {isNaverAccount ? (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>네이버 제공정보 활용</Text>
                        <CalendarGlassSurface
                            variant="card"
                            tone="solidCard"
                            style={[styles.usageCard, { borderColor: colors.border }]}
                        >
                            <View style={styles.usageHeader}>
                                <View style={styles.naverBadge}>
                                    <Text style={styles.naverBadgeText}>N</Text>
                                </View>
                                <View style={styles.usageHeaderText}>
                                    <Text style={[styles.usageTitle, { color: colors.textPrimary }]}>네이버에서 받은 정보</Text>
                                    <Text style={[styles.usageHint, { color: colors.textSecondary }]}>현재 계정에서 실제 사용하는 항목입니다.</Text>
                                </View>
                            </View>
                            <View style={[styles.usageDivider, { backgroundColor: colors.border }]} />
                            <Text style={[styles.usageItemTitle, { color: colors.textPrimary }]}>회원이름 · {displayAccountName}</Text>
                            <Text style={[styles.usageItemBody, { color: colors.textSecondary }]}>프로필에서 회원 식별 및 이름 표시</Text>
                            <Text style={[styles.usageItemTitle, styles.usageItemSpacing, { color: colors.textPrimary }]}>이메일 · {displayEmail}</Text>
                            <Text style={[styles.usageItemBody, { color: colors.textSecondary }]}>계정 식별과 로그인 계정 확인</Text>
                        </CalendarGlassSurface>
                    </View>
                ) : null}

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
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="캘린더 연동 관리"
                                    accessibilityHint="연결할 캘린더를 다시 선택하거나 일정을 추가로 가져옵니다"
                                    onPress={openCalendarOnboarding}
                                    style={({ pressed }) => [
                                        styles.calendarManageButton,
                                        {
                                            borderColor: colors.border,
                                            backgroundColor: colors.inputBackground,
                                            opacity: pressed ? 0.62 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons name="settings-outline" size={17} color={colors.textPrimary} />
                                    <Text style={[styles.calendarManageButtonText, { color: colors.textPrimary }]}>연동 관리</Text>
                                    <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
                                </Pressable>
                            </View>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={calendarConnectionError
                                    ? "캘린더 연결 상태 다시 확인"
                                    : "캘린더 연결 설정"}
                                onPress={calendarConnectionError ? loadProfile : openCalendarOnboarding}
                                style={({ pressed }) => [
                                    styles.calendarEmptyButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={[styles.calendarConnectionIcon, { backgroundColor: colors.selectedDayBg }]}>
                                    <Ionicons
                                        name={calendarConnectionError ? "refresh-outline" : "calendar-outline"}
                                        size={21}
                                        color={colors.selectedDayText}
                                    />
                                </View>
                                <View style={styles.calendarConnectionTitleWrap}>
                                    <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                        {calendarConnectionError ? "연결 상태를 확인하지 못했어요" : "연동된 캘린더 없음"}
                                    </Text>
                                    <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                        {calendarConnectionError
                                            ? "탭해서 다시 확인해 주세요"
                                            : "기기 캘린더 또는 Google에서 일정을 가져올 수 있어요"}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                            </Pressable>
                        )}
                    </CalendarGlassSurface>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>앱 설정</Text>
                    <View style={styles.settingsList}>
                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="내 장소 관리"
                                accessibilityHint="기본주소와 즐겨찾기 카테고리를 관리합니다"
                                onPress={openPlacesSettings}
                                style={({ pressed }) => [
                                    styles.legalButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.appSettingRowContent}>
                                    <View style={[styles.appSettingIcon, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                                        <Ionicons name="location-outline" size={20} color="#2563EB" />
                                    </View>
                                    <View style={styles.settingTextWrap}>
                                        <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>내 장소</Text>
                                        <Text style={[styles.settingHint, { color: colors.textSecondary }]}>기본주소와 즐겨찾기 카테고리 관리</Text>
                                    </View>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                                </View>
                            </Pressable>
                        </CalendarGlassSurface>

                        <CalendarGlassSurface
                            variant="card"
                            tone="solidCard"
                            style={[styles.settingsCard, { borderColor: colors.border }]}
                        >
                            <View style={styles.settingTextWrap}>
                                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>화면 테마</Text>
                                <Text style={[styles.settingHint, { color: colors.textSecondary }]}>시스템 설정을 따르거나 밝기를 직접 선택하세요</Text>
                            </View>
                            <View style={styles.settingSwitchWrap}>
                                <ThemeModeSwitch style={styles.settingSwitch} />
                            </View>
                        </CalendarGlassSurface>

                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="link"
                                accessibilityLabel="개인정보처리방침"
                                accessibilityHint="캘린더, 위치, 알림 정보 처리 기준을 엽니다"
                                onPress={openPrivacyPolicy}
                                style={({ pressed }) => [
                                    styles.legalButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.settingTextWrap}>
                                    <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                                        개인정보처리방침
                                    </Text>
                                    <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
                                        캘린더, 위치, 알림 정보 처리 기준
                                    </Text>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                                </View>
                            </Pressable>
                        </CalendarGlassSurface>

                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="link"
                                accessibilityLabel="서비스 이용약관"
                                accessibilityHint="NoLate 서비스 이용 기준을 엽니다"
                                onPress={openTermsOfService}
                                style={({ pressed }) => [
                                    styles.legalButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.settingTextWrap}>
                                    <Text
                                        style={[styles.settingTitle, { color: colors.textPrimary }]}
                                    >
                                        서비스 이용약관
                                    </Text>
                                    <Text
                                        style={[styles.settingHint, { color: colors.textSecondary }]}
                                    >
                                        NoLate 서비스 이용 기준
                                    </Text>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                                </View>
                            </Pressable>
                        </CalendarGlassSurface>
                    </View>
                </View>

                <CalendarGlassSurface
                    interactive
                    variant="card"
                    tone="solidCard"
                    style={[styles.signOutGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={signingOut ? "로그아웃하고 있어요" : "로그아웃"}
                        accessibilityState={{ disabled: signingOut, busy: signingOut }}
                        disabled={signingOut}
                        onPress={handleSignOut}
                        style={({ pressed }) => [
                            styles.signOutButton,
                            {
                                opacity: pressed || signingOut ? 0.58 : 1,
                            },
                        ]}
                    >
                        {signingOut ? (
                            <BrandedLoader
                                size="button"
                                variant="auth"
                                accessibilityLabel="로그아웃하고 있어요"
                            />
                        ) : (
                            <Ionicons name="log-out-outline" size={19} color="#ef4444" />
                        )}
                        <Text style={styles.signOutText}>
                            {signingOut ? "로그아웃 중" : "로그아웃"}
                        </Text>
                    </Pressable>
                </CalendarGlassSurface>

                <CalendarGlassSurface
                    interactive
                    variant="card"
                    tone="solidCard"
                    style={[styles.withdrawGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={withdrawing ? "회원탈퇴를 처리하고 있어요" : "회원탈퇴"}
                        accessibilityState={{ disabled: withdrawing || signingOut || !account?.loginType }}
                        disabled={withdrawing || signingOut || !account?.loginType}
                        onPress={handleWithdraw}
                        style={({ pressed }) => [
                            styles.signOutButton,
                            { opacity: pressed || withdrawing || signingOut || !account?.loginType ? 0.58 : 1 },
                        ]}
                    >
                        {withdrawing ? (
                            <BrandedLoader size="button" variant="auth" accessibilityLabel="회원탈퇴를 처리하고 있어요" />
                        ) : (
                            <Ionicons name="person-remove-outline" size={19} color={colors.textSecondary} />
                        )}
                        <Text style={[styles.withdrawText, { color: colors.textSecondary }]}>
                            {withdrawing ? "회원탈퇴 처리 중" : "회원탈퇴"}
                        </Text>
                    </Pressable>
                </CalendarGlassSurface>
            </ScrollView>
        </ProfileRouteAccessibilityRoot>
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
        overflow: "visible",
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
    profileErrorCard: {
        minHeight: 68,
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 15,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    profileErrorTextWrap: { flex: 1, minWidth: 0 },
    profileErrorTitle: { fontSize: 13, fontWeight: "900" },
    profileErrorCaption: { marginTop: 3, fontSize: 11, fontWeight: "600", lineHeight: 16 },
    profileErrorRetry: { fontSize: 12, fontWeight: "900" },
    modalRoot: {
        flex: 1,
        justifyContent: "flex-end",
    },
    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.48)",
    },
    editSheetScroll: {
        maxHeight: "92%",
        borderTopWidth: 1,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
    },
    editSheetScrollContent: {
        paddingHorizontal: 22,
        paddingTop: 22,
        paddingBottom: 34,
    },
    editSheetHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
    },
    destructiveHeaderText: { flex: 1, minWidth: 0 },
    editSheetTitle: {
        fontSize: 21,
        fontWeight: "900",
    },
    editSheetCaption: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: "700",
    },
    modalCloseButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
    },
    inputLabel: {
        marginTop: 22,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: "900",
    },
    nameInput: {
        height: 52,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 15,
        fontSize: 16,
        fontWeight: "800",
    },
    inputCounter: {
        marginTop: 6,
        textAlign: "right",
        fontSize: 11,
        fontWeight: "700",
    },
    saveButton: {
        height: 52,
        marginTop: 18,
        borderRadius: 15,
        backgroundColor: "#2563eb",
        alignItems: "center",
        justifyContent: "center",
    },
    saveButtonText: {
        color: "#ffffff",
        fontSize: 16,
        fontWeight: "900",
    },
    destructiveButton: {
        height: 52,
        marginTop: 20,
        borderRadius: 15,
        backgroundColor: "#DC2626",
        alignItems: "center",
        justifyContent: "center",
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
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
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
    accountRowMain: {
        flex: 1,
        minWidth: 0,
    },
    accountRowAction: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    accountActionLabel: {
        fontSize: 12,
        fontWeight: "800",
    },
    usageCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
    },
    usageHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    naverBadge: {
        width: 34,
        height: 34,
        borderRadius: 8,
        backgroundColor: "#03A94D",
        alignItems: "center",
        justifyContent: "center",
    },
    naverBadgeText: {
        color: "#FFFFFF",
        fontSize: 18,
        fontWeight: "900",
    },
    usageHeaderText: {
        flex: 1,
        gap: 2,
    },
    usageTitle: {
        fontSize: 14,
        fontWeight: "900",
    },
    usageHint: {
        fontSize: 11,
        fontWeight: "700",
    },
    usageDivider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 14,
    },
    usageItemTitle: {
        fontSize: 14,
        fontWeight: "900",
    },
    usageItemBody: {
        marginTop: 3,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    usageItemSpacing: {
        marginTop: 13,
    },
    settingsCard: {
        borderWidth: 1,
        borderRadius: 18,
        minHeight: 72,
        paddingHorizontal: 16,
        paddingVertical: 14,
        alignItems: "stretch",
        gap: 12,
    },
    settingsList: {
        gap: 10,
    },
    legalCard: {
        borderWidth: 1,
        borderRadius: 18,
    },
    legalButton: {
        minHeight: 72,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
    },
    appSettingRowContent: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    appSettingIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
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
    calendarManageButton: {
        minHeight: 46,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    calendarManageButtonText: {
        flex: 1,
        fontSize: 14,
        fontWeight: "800",
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
        width: "100%",
        minHeight: 48,
        justifyContent: "center",
    },
    settingSwitch: {
        width: "100%",
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
    withdrawGlass: {
        borderWidth: 1,
        borderRadius: 18,
        marginTop: -12,
    },
    withdrawText: {
        fontSize: 14,
        fontWeight: "800",
    },
});

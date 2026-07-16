import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Clipboard,
    Modal,
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
    refreshCalendarConnectionSnapshotFromDevice,
    type CalendarConnectionSnapshot,
} from "../src/modules/onboarding/calendarConnectionStorage";
import { logoutFromNaverSdk, unlinkNaverSdk } from "../src/modules/auth/socialLogin";
import { useTheme } from "../src/modules/theme/ThemeContext";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";
import BrandedLoader, { BrandedLoadingState } from "../src/ui/BrandedLoader";

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
    const [signingOut, setSigningOut] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [editingProfile, setEditingProfile] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [memberIdCopied, setMemberIdCopied] = useState(false);

    const rawDisplayName = account?.name?.trim() ?? "";
    const profileName = profile?.nickname?.trim() ?? "";
    const displayAccountName = profileName || rawDisplayName || "이름 정보 없음";
    const isNaverAccount = account?.loginType === "NAVER";
    const displayEmail = account?.email || (isNaverAccount ? "네이버에서 이메일 제공에 동의하지 않음" : "이메일 정보 없음");
    const displayLoginType = formatLoginType(account?.loginType);
    const displayMemberId = profile?.memberId ?? account?.id;
    const profileSummary = displayMemberId
        ? `NoLate ID #${displayMemberId} · ${displayLoginType}`
        : displayLoginType;
    const avatarInitial = displayAccountName.trim().slice(0, 1) || "N";

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
        setLoadingProfile(true);
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
        } finally {
            setLoadingProfile(false);
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
    }, [displayMemberId]);

    const saveProfile = useCallback(async () => {
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
            setSavingProfile(false);
        }
    }, [draftName, profile]);

    useEffect(() => {
        loadProfile();
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
                    setSigningOut(true);
                    if (isNaverAccount) {
                        await logoutFromNaverSdk().catch((error) => {
                            console.warn("[naver] sdk logout failed", error);
                        });
                    }
                    await signOut();
                    router.replace("/auth/login");
                },
            },
        ]);
    }, [isNaverAccount, router, signOut]);

    const handleWithdraw = useCallback(() => {
        if (account?.loginType === "COMMON") {
            Alert.alert("회원탈퇴", "이메일 계정 탈퇴에는 비밀번호 확인이 필요합니다. 고객지원에 문의해 주세요.");
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
                        try {
                            setWithdrawing(true);
                            await withdrawMember();
                            if (isNaverAccount) {
                                await unlinkNaverSdk().catch((error) => {
                                    console.warn("[naver] sdk unlink failed", error);
                                });
                            }
                            await signOut();
                            router.replace("/auth/login");
                        } catch (error) {
                            Alert.alert("회원탈퇴 실패", getErrorMessage(error));
                            setWithdrawing(false);
                        }
                    },
                },
            ],
        );
    }, [account?.loginType, isNaverAccount, router, signOut]);

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

    const openPrivacyPolicy = useCallback(() => {
        router.push("/legal/privacy-policy");
    }, [router]);

    if (loadingProfile) {
        return (
            <View style={[styles.root, { backgroundColor: colors.background }]}>
                <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
                <BrandedLoadingState
                    fill
                    size="full"
                    variant="auth"
                    accessibilityLabel="내 프로필을 불러오고 있어요"
                    title="내 프로필을 불러오고 있어요"
                    caption="계정과 캘린더 연결 상태를 확인하고 있어요"
                />
            </View>
        );
    }

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

                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityLabel="표시 이름 수정"
                        onPress={openProfileEditor}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="pencil" size={19} color={colors.textPrimary} />
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

                <Modal
                    animationType="fade"
                    transparent
                    visible={editingProfile}
                    onRequestClose={() => !savingProfile && setEditingProfile(false)}
                >
                    <View style={styles.modalRoot}>
                        <Pressable
                            accessibilityLabel="프로필 수정 닫기"
                            disabled={savingProfile}
                            onPress={() => setEditingProfile(false)}
                            style={styles.modalBackdrop}
                        />
                        <View style={[styles.editSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <View style={styles.editSheetHeader}>
                                <View>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>표시 이름 수정</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>프로필에 표시할 이름을 변경합니다.</Text>
                                </View>
                                <Pressable
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
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!savingProfile}
                                maxLength={20}
                                onChangeText={setDraftName}
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
                        </View>
                    </View>
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
                            showDivider={false}
                        />
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
                    <View style={styles.settingsList}>
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

                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="link"
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
                                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
                        disabled={withdrawing || signingOut}
                        onPress={handleWithdraw}
                        style={({ pressed }) => [
                            styles.signOutButton,
                            { opacity: pressed || withdrawing || signingOut ? 0.58 : 1 },
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
    modalRoot: {
        flex: 1,
        justifyContent: "flex-end",
    },
    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.48)",
    },
    editSheet: {
        borderTopWidth: 1,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
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
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
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

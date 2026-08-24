import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Clipboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    changePassword,
    getMyProfile,
    tokenLoginMember,
    updateMyProfile,
    withdrawMember,
    type MemberProfileDto,
} from "../api/member";
import { useAuth } from "../modules/auth/AuthContext";
import {
    getAuthMember,
    getRefreshToken,
    saveAuthMember,
    saveAuthTokens,
    type StoredAuthMember,
} from "../modules/auth/authStorage";
import { logoutFromKakaoSdk, logoutFromNaverSdk, unlinkKakaoSdk, unlinkNaverSdk } from "../modules/auth/socialLogin";
import {
    getCalendarConnectionSnapshot,
    refreshCalendarConnectionSnapshotFromDevice,
    type CalendarConnectionSnapshot,
} from "../modules/onboarding/calendarConnectionStorage";
import { runWithDepartureAlarmWithdrawalGuard } from "../modules/notification/departureAlarmSync";
import { runAfterScreenTransition } from "../modules/performance/runAfterScreenTransition";
import { useTheme } from "../modules/theme/ThemeContext";
import { formatLoginType } from "./profilePresentation";

/** API 오류를 프로필 화면의 알림과 오류 카드에서 공통으로 사용할 문구로 변환합니다. */
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\\d)(?=.*[!@#$%^&*])[a-zA-Z\\d!@#$%^&*]{8,16}$/;

/** 프로필 화면의 조회·편집·로그아웃·탈퇴 상태와 사용자 작업을 한곳에서 관리합니다. */
export function useProfileScreen() {
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

    useEffect(() => {
        let active = true;
        getAuthMember()
            .then((stored) => {
                if (active && stored) setAccount(stored);
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    /** 저장된 인증 계정을 우선 사용하고, 필수 메타데이터가 없으면 리프레시 토큰으로 안전하게 복구합니다. */
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

    /** 프로필·인증 계정·캘린더 연결 캐시를 함께 불러오고 느린 기기 조회는 백그라운드에서 갱신합니다. */
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

    /** 현재 표시 이름을 편집 초깃값으로 복사한 뒤 프로필 수정 모달을 엽니다. */
    const openProfileEditor = useCallback(() => {
        setDraftName(displayAccountName === "이름 정보 없음" ? "" : displayAccountName);
        setEditingProfile(true);
    }, [displayAccountName]);

    /** NoLate 회원 ID를 클립보드에 복사하고 접근성 사용자에게 완료 상태를 알립니다. */
    const copyMemberId = useCallback(() => {
        if (!displayMemberId) return;
        Clipboard.setString(String(displayMemberId));
        setMemberIdCopied(true);
        AccessibilityInfo.announceForAccessibility("NoLate ID를 복사했어요");
    }, [displayMemberId]);

    /** 표시 이름의 필수값과 길이를 검증한 뒤 중복 제출 없이 프로필을 저장합니다. */
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
        const task = runAfterScreenTransition(() => {
            loadProfile();
        });
        return () => {
            task.cancel();
            profileLoadSequenceRef.current += 1;
        };
    }, [loadProfile]);

    useEffect(() => {
        if (!memberIdCopied) return;
        const timer = setTimeout(() => setMemberIdCopied(false), 1600);
        return () => clearTimeout(timer);
    }, [memberIdCopied]);

    /** 사용자 확인 후 소셜 SDK 세션과 앱 인증 세션을 순서대로 종료하고 로그인 화면으로 이동합니다. */
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

    /** 로그인 방식에 맞는 본인 확인 절차를 선택하고 소셜 계정 연결 해제까지 포함해 탈퇴를 처리합니다. */
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

    /** 일반 계정 비밀번호를 확인 정보로 전달해 회원 탈퇴를 수행하고 인증 세션을 종료합니다. */
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

    /** 비밀번호 입력값을 초기화해 이전 민감 정보가 남지 않은 상태로 변경 모달을 엽니다. */
    const openPasswordChange = useCallback(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordModalOpen(true);
    }, []);

    /** 현재·새 비밀번호의 조합과 정책을 검증한 뒤 중복 요청 없이 비밀번호를 변경합니다. */
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

    /** 이전 탐색 기록이 있으면 뒤로 이동하고, 없으면 일정 루트로 안전하게 대체 이동합니다. */
    const goBackToSchedule = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace("/schedule");
    }, [router]);

    /** 프로필에서 진입했음을 표시해 캘린더 연결·가져오기 화면을 엽니다. */
    const openCalendarOnboarding = useCallback(() => {
        router.push({
            pathname: "/onboarding/calendar-import",
            params: { source: "profile" },
        });
    }, [router]);

    /** 기본 주소와 즐겨찾기 장소를 관리하는 설정 화면으로 이동합니다. */
    const openPlacesSettings = useCallback(() => {
        router.push("/settings/places");
    }, [router]);

    /** 앱 내부 개인정보처리방침 화면으로 이동합니다. */
    const openPrivacyPolicy = useCallback(() => {
        router.push("/legal/privacy-policy");
    }, [router]);

    /** 앱 내부 서비스 이용약관 화면으로 이동합니다. */
    const openTermsOfService = useCallback(() => {
        router.push("/legal/terms-of-service");
    }, [router]);

    return {
        router,
        insets,
        colors,
        mode,
        profile,
        account,
        calendarConnection,
        calendarConnectionError,
        signingOut,
        withdrawing,
        loadingProfile,
        editingProfile,
        setEditingProfile,
        savingProfile,
        draftName,
        setDraftName,
        memberIdCopied,
        profileError,
        withdrawalModalOpen,
        setWithdrawalModalOpen,
        withdrawalPassword,
        setWithdrawalPassword,
        passwordModalOpen,
        setPasswordModalOpen,
        currentPassword,
        setCurrentPassword,
        newPassword,
        setNewPassword,
        confirmPassword,
        setConfirmPassword,
        savingPassword,
        hasOpenModal,
        displayAccountName,
        isNaverAccount,
        displayEmail,
        displayLoginType,
        displayMemberId,
        profileSummary,
        avatarInitial,
        loadProfile,
        openProfileEditor,
        copyMemberId,
        saveProfile,
        handleSignOut,
        handleWithdraw,
        confirmCommonWithdrawal,
        openPasswordChange,
        savePasswordChange,
        goBackToSchedule,
        openCalendarOnboarding,
        openPlacesSettings,
        openPrivacyPolicy,
        openTermsOfService,
    };
}

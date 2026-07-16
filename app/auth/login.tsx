import { useCallback, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { useRouter } from "expo-router";
import {
    Alert,
    Pressable,
    StyleProp,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
    getSnsRegistrationStatus,
    loginMember,
    snsLoginMember,
    snsSignUpMember,
    tokenLoginMember,
    type MemberDto,
    type SignupConsentsPayload,
} from "../../src/api/member";
import { AuthInput, AuthPrimaryButton, AuthScreen } from "../../src/modules/auth/components/AuthScreen";
import SignupAgreementPanel from "../../src/modules/auth/components/SignupAgreementPanel";
import { clearAuthTokens, getRefreshToken, saveAuthMember, saveAuthTokens } from "../../src/modules/auth/authStorage";
import { useAuth } from "../../src/modules/auth/AuthContext";
import {
    getAuthErrorPresentation,
    isAuthCancellation,
} from "../../src/modules/auth/authErrorMessage";
import {
    loginWithAppleSdk,
    loginWithKakaoSdk,
    loginWithNaverSdk,
    type SocialSdkLoginResult,
} from "../../src/modules/auth/socialLogin";
import { registerPushAfterLogin } from "../../src/modules/notification/pushRegistration";
import { getPostAuthRoute } from "../../src/modules/onboarding/curationRouting";
import { useTheme } from "../../src/modules/theme/ThemeContext";

type SocialProvider = "naver" | "kakao" | "apple";

type SocialButtonProps = {
    label: string;
    symbol?: string;
    symbolColor?: string;
    icon?: ComponentProps<typeof Ionicons>["name"];
    markStyle?: StyleProp<ViewStyle>;
    disabled: boolean;
    onPress: () => void;
};

export default function Login() {
    const router = useRouter();
    const { syncAuthentication } = useAuth();
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);
    const [id, setId] = useState("");
    const [pwd, setPwd] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [socialSubmitting, setSocialSubmitting] = useState(false);
    const [pendingSocialProfile, setPendingSocialProfile] = useState<SocialSdkLoginResult | null>(null);
    const [socialSignupSubmitting, setSocialSignupSubmitting] = useState(false);

    const finishAuthentication = useCallback(async (member: MemberDto) => {
        await saveAuthTokens(member.accessToken, member.refreshToken);
        await saveAuthMember(member);
        await syncAuthentication();
        await registerPushAfterLogin(member.id).catch((error) => {
            console.warn("[push] token registration failed", error);
        });
        router.replace(getPostAuthRoute(member.curationCompleted));
    }, [router, syncAuthentication]);

    useEffect(() => {
        let cancelled = false;

        const tryTokenLogin = async () => {
            const refreshToken = await getRefreshToken();
            if (!refreshToken || cancelled) return;

            try {
                const member = await tokenLoginMember({ refreshToken });
                if (cancelled) return;

                await finishAuthentication(member);
            } catch {
                if (cancelled) return;
                await clearAuthTokens();
                await syncAuthentication();
            }
        };

        tryTokenLogin();

        return () => {
            cancelled = true;
        };
    }, [finishAuthentication, syncAuthentication]);

    const onLogin = async () => {
        if (submitting) return;

        const email = id.trim();
        const password = pwd;

        if (!email || !password) {
            Alert.alert("로그인", "이메일과 비밀번호를 입력해 주세요.");
            return;
        }

        try {
            setSubmitting(true);
            const member = await loginMember({ email, password });
            await finishAuthentication(member);
        } catch (error) {
            const presentation = getAuthErrorPresentation(error, "login");
            await clearAuthTokens();
            await syncAuthentication();
            Alert.alert(presentation.title, presentation.message);
        } finally {
            setSubmitting(false);
        }
    };

    const onSocialLogin = async (provider: SocialProvider) => {
        if (socialSubmitting) return;

        try {
            setSocialSubmitting(true);

            const profile =
                provider === "kakao"
                    ? await loginWithKakaoSdk()
                    : provider === "naver"
                        ? await loginWithNaverSdk()
                        : await loginWithAppleSdk();

            const registration = await getSnsRegistrationStatus({
                loginType: profile.loginType,
                snsId: profile.snsId,
            });
            if (!registration.registered) {
                setPendingSocialProfile(profile);
                return;
            }

            const member = await snsLoginMember({
                loginType: profile.loginType,
                snsId: profile.snsId,
                email: profile.email,
                name: profile.name,
            });

            await finishAuthentication(member);
        } catch (error) {
            if (isAuthCancellation(error)) return;
            const presentation = getAuthErrorPresentation(
                error,
                "social-login",
                getSocialProviderLabel(provider),
            );
            Alert.alert(presentation.title, presentation.message);
        } finally {
            setSocialSubmitting(false);
        }
    };

    const onSocialSignUp = async (consents: SignupConsentsPayload) => {
        if (!pendingSocialProfile || socialSignupSubmitting) return;

        try {
            setSocialSignupSubmitting(true);
            const member = await snsSignUpMember({
                ...pendingSocialProfile,
                consents,
            });
            await finishAuthentication(member);
        } catch (error) {
            const presentation = getAuthErrorPresentation(error, "social-signup");
            Alert.alert(presentation.title, presentation.message);
        } finally {
            setSocialSignupSubmitting(false);
        }
    };

    if (pendingSocialProfile) {
        return (
            <AuthScreen
                title="가입 전 확인"
                subtitle={`${getProviderLabel(pendingSocialProfile.loginType)} 계정으로 NoLate를 시작하기 전에 필요한 항목입니다.`}
                density="compact"
                onBack={() => setPendingSocialProfile(null)}
            >
                <SignupAgreementPanel
                    submitting={socialSignupSubmitting}
                    onConfirm={onSocialSignUp}
                    onOpenTerms={() => router.push("/legal/terms-of-service")}
                    onOpenPrivacyCollection={() => router.push("/legal/privacy-collection-consent")}
                    onOpenPrivacyPolicy={() => router.push("/legal/privacy-policy")}
                />
            </AuthScreen>
        );
    }

    return (
        <AuthScreen
            subtitle="늦지 않게, 오늘의 이동을 준비하세요."
        >
            <AuthInput
                label="이메일"
                icon="mail-outline"
                value={id}
                onChangeText={setId}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
            />
            <AuthInput
                label="비밀번호"
                icon="lock-closed-outline"
                value={pwd}
                onChangeText={setPwd}
                placeholder="비밀번호"
                secureTextEntry
                autoComplete="password"
                textContentType="password"
            />

            <AuthPrimaryButton
                disabled={submitting}
                loading={submitting}
                onPress={onLogin}
                label={submitting ? "로그인 중" : "로그인"}
            />

            <View style={styles.dividerWrap}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>간편 로그인</Text>
                <View style={styles.divider} />
            </View>

            <View style={styles.socialRow}>
                <SocialButton
                    label="네이버"
                    symbol="N"
                    symbolColor="#FFFFFF"
                    markStyle={styles.naverMark}
                    disabled={socialSubmitting}
                    onPress={() => onSocialLogin("naver")}
                />
                <SocialButton
                    label="카카오"
                    symbol="K"
                    symbolColor="#191600"
                    markStyle={styles.kakaoMark}
                    disabled={socialSubmitting}
                    onPress={() => onSocialLogin("kakao")}
                />
                <SocialButton
                    label="Apple"
                    icon="logo-apple"
                    markStyle={styles.appleMark}
                    disabled={socialSubmitting}
                    onPress={() => onSocialLogin("apple")}
                />
            </View>

            <Pressable
                onPress={() => router.push("/auth/signup")}
                style={({ pressed }) => [
                    styles.signUpLink,
                    { opacity: pressed ? 0.62 : 1 },
                ]}
            >
                <Text style={styles.signUpHint}>처음이신가요?</Text>
                <Text style={styles.signUpText}>회원가입</Text>
            </Pressable>

            <View style={styles.legalLinks}>
                <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push("/legal/terms-of-service")}
                    hitSlop={8}
                >
                    <Text style={styles.legalLinkText}>이용약관</Text>
                </Pressable>
                <Text style={styles.legalSeparator}>·</Text>
                <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push("/legal/privacy-policy")}
                    hitSlop={8}
                >
                    <Text style={styles.legalLinkText}>개인정보처리방침</Text>
                </Pressable>
            </View>
        </AuthScreen>
    );
}

function getProviderLabel(loginType: SocialSdkLoginResult["loginType"]): string {
    if (loginType === "KAKAO") return "카카오";
    if (loginType === "NAVER") return "네이버";
    return "Apple";
}

function getSocialProviderLabel(provider: SocialProvider): string {
    if (provider === "kakao") return "카카오";
    if (provider === "naver") return "네이버";
    return "Apple";
}

function SocialButton({
    label,
    symbol,
    symbolColor,
    icon,
    markStyle,
    disabled,
    onPress,
}: SocialButtonProps) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.socialButton,
                {
                    backgroundColor: colors.surface2,
                    borderColor: colors.border,
                    opacity: disabled ? 0.55 : pressed ? 0.72 : 1,
                    transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
                },
            ]}
        >
            <View style={[styles.socialMark, markStyle]}>
                {icon ? (
                    <Ionicons name={icon} size={16} color={symbolColor ?? colors.textPrimary} />
                ) : (
                    <Text style={[styles.socialSymbol, { color: symbolColor }]}>{symbol}</Text>
                )}
            </View>
            <Text style={styles.socialLabel}>{label}</Text>
        </Pressable>
    );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"], mode: "dark" | "light") {
    return StyleSheet.create({
        dividerWrap: {
            marginTop: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        divider: {
            flex: 1,
            height: StyleSheet.hairlineWidth,
            backgroundColor: colors.border,
        },
        dividerText: {
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: "900",
        },
        socialRow: {
            flexDirection: "row",
            gap: 9,
        },
        socialButton: {
            flex: 1,
            minHeight: 72,
            borderRadius: 18,
            borderWidth: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
        },
        socialMark: {
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
        },
        naverMark: {
            backgroundColor: "#03C75A",
        },
        kakaoMark: {
            backgroundColor: "#FEE500",
        },
        appleMark: {
            backgroundColor: mode === "dark" ? "#1f1f22" : "#FFFFFF",
            borderWidth: 1,
            borderColor: colors.border,
        },
        socialSymbol: {
            fontSize: 14,
            fontWeight: "900",
        },
        socialLabel: {
            color: colors.textPrimary,
            fontSize: 12,
            fontWeight: "900",
        },
        signUpLink: {
            minHeight: 54,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            marginTop: 4,
        },
        signUpHint: {
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: "800",
        },
        signUpText: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: "900",
        },
        legalLinks: {
            minHeight: 32,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
        },
        legalLinkText: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "700",
            textDecorationLine: "underline",
        },
        legalSeparator: {
            color: colors.textSecondary,
            fontSize: 11,
            lineHeight: 16,
            fontWeight: "700",
        },
    });
}

import BrandedLoader from "../../src/ui/BrandedLoader";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    AccessibilityInfo,
    findNodeHandle,
    Alert,
    BackHandler,
    Keyboard,
    Linking,
    Pressable,
    Platform,
    StyleProp,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
    ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

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
import {
    clearAuthTokens,
    getAuthMember,
    getRefreshToken,
    saveAuthMember,
    saveAuthTokens,
} from "../../src/modules/auth/authStorage";
import { useAuthFormDrafts } from "../../src/modules/auth/AuthFormDrafts";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { requireAuthenticatedMember } from "../../src/modules/auth/authenticatedMember";
import {
    getAuthErrorPresentation,
    isAuthCancellation,
} from "../../src/modules/auth/authErrorMessage";
import { isDefinitiveAuthRejection } from "../../src/modules/auth/refreshPolicy";
import {
    isValidSignupEmail,
    MAX_EMAIL_LENGTH,
    normalizeSignupEmail,
} from "../../src/modules/auth/signupValidation";
import {
    loginWithAppleSdk,
    loginWithKakaoSdk,
    loginWithNaverOAuth,
    type SocialSdkLoginResult,
} from "../../src/modules/auth/socialLogin";
import { registerPushAfterLogin } from "../../src/modules/notification/pushRegistration";
import { getPostAuthRoute } from "../../src/modules/onboarding/curationRouting";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import {
    handleSignupAgreementHardwareBack,
    shouldHandleSignupAgreementHardwareBack,
} from "../../src/modules/auth/signupNavigation";

type SocialProvider = "naver" | "kakao" | "apple";
const ACCOUNT_SUPPORT_EMAIL = "support@nolate.jinuk.dev";
const loginFeedbackEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

type SocialButtonProps = {
    label: string;
    symbol?: string;
    symbolColor?: string;
    icon?: ComponentProps<typeof Ionicons>["name"];
    markStyle?: StyleProp<ViewStyle>;
    disabled: boolean;
    loading?: boolean;
    onPress: () => void;
};

export default function Login() {
    const router = useRouter();
    const isFocused = useIsFocused();
    const { shareToken } = useLocalSearchParams<{ shareToken?: string | string[] }>();
    const { syncAuthentication } = useAuth();
    const { colors, mode } = useTheme();
    const { fontScale } = useWindowDimensions();
    const standardLayout = fontScale <= 1.35;
    const styles = createStyles(colors, mode);
    const { login: { email: id, password: pwd }, setLogin, clear: clearDrafts } = useAuthFormDrafts();
    const [passwordHelpOpen, setPasswordHelpOpen] = useState(false);
    const emailInput = useRef<TextInput>(null);
    const passwordInput = useRef<TextInput>(null);
    const loginActionRef = useRef<View>(null);
    const [passwordFocused, setPasswordFocused] = useState(false);
    const errorMessageRef = useRef<Text>(null);
    const loginInFlight = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const [loginError, setLoginError] = useState<{ title: string; message: string }>();
    const [restoringSession, setRestoringSession] = useState(true);
    const [socialSubmittingProvider, setSocialSubmittingProvider] = useState<SocialProvider | null>(null);
    const [pendingSocialProfile, setPendingSocialProfile] = useState<SocialSdkLoginResult | null>(null);
    const [socialSignupSubmitting, setSocialSignupSubmitting] = useState(false);
    const pendingShareToken = normalizeShareToken(shareToken);
    const loginBusy = restoringSession || submitting || socialSubmittingProvider !== null;

    const finishAuthentication = useCallback(async (member: MemberDto) => {
        const authenticatedMember = requireAuthenticatedMember(member);
        await saveAuthTokens(authenticatedMember.accessToken, authenticatedMember.refreshToken);
        await saveAuthMember(authenticatedMember);
        const authenticated = await syncAuthentication({ confirmedFreshLogin: true });
        if (!authenticated) {
            throw new Error("로그인 상태를 저장하지 못했어요. 다시 시도해 주세요.");
        }
        // confirmedFreshLogin resolves only after the native account cleanup/bind boundary commits.
        registerPushAfterLogin(authenticatedMember.id).catch((error) => {
            console.warn("[push] token registration failed", error);
        });
        clearDrafts();
        if (pendingShareToken) {
            router.replace({
                pathname: "/share/[token]",
                params: { token: pendingShareToken, autoAccept: "1" },
            });
            return;
        }
        // syncAuthentication refreshes curation from the authoritative status
        // endpoint. Route from that stored result instead of a potentially stale
        // login-response flag, otherwise existing users can be sent to onboarding.
        const syncedMember = await getAuthMember();
        router.replace(getPostAuthRoute(syncedMember?.curationCompleted === true));
    }, [clearDrafts, pendingShareToken, router, syncAuthentication]);

    useEffect(() => {
        if (!shouldHandleSignupAgreementHardwareBack({
            platform: Platform.OS,
            isFocused,
            isAgreementStep: Boolean(pendingSocialProfile),
        })) return;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => (
            handleSignupAgreementHardwareBack({
                submitting: socialSignupSubmitting,
                returnToDetails: () => setPendingSocialProfile(null),
            })
        ));

        return () => subscription.remove();
    }, [isFocused, pendingSocialProfile, socialSignupSubmitting]);

    useEffect(() => {
        let cancelled = false;

        const tryTokenLogin = async () => {
            try {
                const refreshToken = await getRefreshToken();
                if (!refreshToken || cancelled) return;

                const member = await tokenLoginMember({ refreshToken });
                if (cancelled) return;

                await finishAuthentication(member);
            } catch (error) {
                if (cancelled) return;
                if (isDefinitiveAuthRejection(error)) {
                    await clearAuthTokens();
                    await syncAuthentication();
                }
            } finally {
                if (!cancelled) setRestoringSession(false);
            }
        };

        tryTokenLogin();

        return () => {
            cancelled = true;
        };
    }, [finishAuthentication, syncAuthentication]);

    const onLogin = async () => {
        if (loginInFlight.current || restoringSession || socialSubmittingProvider) return;

        setLoginError(undefined);
        const email = normalizeSignupEmail(id);
        const password = pwd;

        if (!email || !password) {
            setLoginError({ title: "입력 확인", message: "이메일과 비밀번호를 입력해 주세요." });
            (email ? passwordInput : emailInput).current?.focus();
            return;
        }

        if (!isValidSignupEmail(email)) {
            setLoginError({ title: "이메일 확인", message: "올바른 이메일 주소를 입력해 주세요." });
            emailInput.current?.focus();
            return;
        }

        try {
            loginInFlight.current = true;
            if (standardLayout) Keyboard.dismiss();
            setSubmitting(true);
            const member = await loginMember({ email, password });
            await finishAuthentication(member);
        } catch (error) {
            const presentation = getAuthErrorPresentation(error, "login");
            await clearAuthTokens();
            await syncAuthentication();
            setLoginError(presentation);
            requestAnimationFrame(() => {
                const target = findNodeHandle(errorMessageRef.current);
                if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
            });
        } finally {
            loginInFlight.current = false;
            setSubmitting(false);
        }
    };

    const onSocialLogin = async (provider: SocialProvider) => {
        if (socialSubmittingProvider || loginInFlight.current || restoringSession) return;

        try {
            setSocialSubmittingProvider(provider);

            const profile =
                provider === "kakao"
                    ? await loginWithKakaoSdk()
                    : provider === "naver"
                        ? await loginWithNaverOAuth()
                        : await loginWithAppleSdk();

            const registration = await getSnsRegistrationStatus({
                loginType: profile.loginType,
                providerToken: profile.providerToken,
                authorizationCode: profile.authorizationCode,
                nonce: profile.nonce,
            });
            if (!registration.registered) {
                setPendingSocialProfile(profile);
                return;
            }

            const member = await snsLoginMember({
                loginType: profile.loginType,
                providerToken: profile.providerToken,
                authorizationCode: profile.authorizationCode,
                nonce: profile.nonce,
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
            setSocialSubmittingProvider(null);
        }
    };

    const onSocialSignUp = async (consents: SignupConsentsPayload) => {
        if (!pendingSocialProfile || socialSignupSubmitting) return;

        let accountCreated = false;
        try {
            setSocialSignupSubmitting(true);
            const member = await snsSignUpMember({
                loginType: pendingSocialProfile.loginType,
                providerToken: pendingSocialProfile.providerToken,
                authorizationCode: pendingSocialProfile.authorizationCode,
                nonce: pendingSocialProfile.nonce,
                consents,
            });
            accountCreated = true;
            await finishAuthentication(member);
        } catch (error) {
            if (accountCreated) {
                await clearAuthTokens().catch(() => undefined);
                await syncAuthentication().catch(() => false);
                setPendingSocialProfile(null);
                Alert.alert(
                    "가입은 완료됐어요",
                    "자동 로그인만 완료하지 못했어요. 같은 간편 로그인 버튼을 다시 눌러 로그인해 주세요.",
                );
                return;
            }
            // Apple authorization codes are short-lived and single-use. A failed signup may have
            // consumed the code at the provider boundary, so never let the agreement screen retry
            // the same proof. Returning to login forces a fresh Apple authorization request.
            if (pendingSocialProfile.loginType === "APPLE") {
                setPendingSocialProfile(null);
            }
            const presentation = getAuthErrorPresentation(error, "social-signup");
            Alert.alert(presentation.title, presentation.message);
        } finally {
            setSocialSignupSubmitting(false);
        }
    };

    const openPasswordHelp = async () => {
        const subject = encodeURIComponent("NoLate 비밀번호 로그인 문의");
        const url = `mailto:${ACCOUNT_SUPPORT_EMAIL}?subject=${subject}`;

        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert(
                "로그인 문의",
                `메일 앱을 열 수 없어요. ${ACCOUNT_SUPPORT_EMAIL}로 문의해 주세요.`,
            );
        }
    };

    if (pendingSocialProfile) {
        return (
            <AuthScreen
                title="가입 전 확인"
                subtitle={`${getProviderLabel(pendingSocialProfile.loginType)} 계정으로 NoLate를 시작하기 전에 필요한 항목입니다.`}
                density="compact"
                onBack={() => setPendingSocialProfile(null)}
                backDisabled={socialSignupSubmitting}
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
            keyboardRevealRef={standardLayout && passwordFocused ? loginActionRef : undefined}
        >
            <AuthInput
                label="이메일"
                icon="mail-outline"
                value={id}
                inputRef={emailInput}
                onChangeText={value => { setLogin(current => ({ ...current, email: value })); setLoginError(undefined); }}
                maxLength={MAX_EMAIL_LENGTH}
                editable={!loginBusy}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
            />
            <AuthInput
                label="비밀번호"
                icon="lock-closed-outline"
                value={pwd}
                inputRef={passwordInput}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                onChangeText={value => { setLogin(current => ({ ...current, password: value })); setLoginError(undefined); }}
                editable={!loginBusy}
                placeholder="비밀번호"
                secureTextEntry
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                submitBehavior="submit"
                onSubmitEditing={onLogin}
            />

            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: passwordHelpOpen }}
                onPress={() => setPasswordHelpOpen(open => !open)}
                style={({ pressed }) => [styles.passwordHelp, { opacity: pressed ? 0.58 : 1 }]}
            >
                <Text style={styles.passwordHelpText}>비밀번호를 잊으셨나요?</Text>
            </Pressable>

            {passwordHelpOpen && (
                <View style={styles.passwordHelpPanel}>
                    <Text style={styles.passwordHelpCopy}>비밀번호 로그인에 도움이 필요하면 문의해 주세요.</Text>
                    <Pressable accessibilityRole="link" onPress={openPasswordHelp} style={styles.supportLink}>
                        <Text style={styles.passwordHelpText}>{ACCOUNT_SUPPORT_EMAIL}</Text>
                    </Pressable>
                </View>
            )}
            {loginError && (
                <Animated.View
                    entering={standardLayout ? loginFeedbackEntry : undefined}
                    style={[styles.loginError, standardLayout && styles.loginErrorInset]}
                >
                    {!standardLayout && <Text style={styles.loginErrorTitle}>{loginError.title}</Text>}
                    <Text
                        ref={errorMessageRef}
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        style={[standardLayout && styles.loginErrorMessage, { color: standardLayout ? styles.loginErrorTitle.color : colors.textSecondary }]}
                    >{loginError.message}</Text>
                </Animated.View>
            )}
            <AuthPrimaryButton
                buttonRef={loginActionRef}
                disabled={loginBusy}
                loading={submitting || restoringSession}
                onPress={onLogin}
                label={restoringSession ? "로그인 상태 확인 중" : submitting ? "로그인 중" : "로그인"}
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
                    disabled={loginBusy}
                    loading={socialSubmittingProvider === "naver"}
                    onPress={() => onSocialLogin("naver")}
                />
                <SocialButton
                    label="카카오"
                    symbol="K"
                    symbolColor="#191600"
                    markStyle={styles.kakaoMark}
                    disabled={loginBusy}
                    loading={socialSubmittingProvider === "kakao"}
                    onPress={() => onSocialLogin("kakao")}
                />
                {Platform.OS === "ios" ? (
                    <SocialButton
                        label="Apple"
                        icon="logo-apple"
                        markStyle={styles.appleMark}
                        disabled={loginBusy}
                        loading={socialSubmittingProvider === "apple"}
                        onPress={() => onSocialLogin("apple")}
                    />
                ) : null}
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="회원가입"
                accessibilityState={{ disabled: loginBusy }}
                disabled={loginBusy}
                onPress={() => {
                    if (loginBusy || loginInFlight.current) return;
                    router.push({
                        pathname: "/auth/signup",
                        params: pendingShareToken ? { shareToken: pendingShareToken } : {},
                    });
                }}
                style={({ pressed }) => [
                    styles.signUpLink,
                    { opacity: loginBusy || pressed ? 0.62 : 1 },
                ]}
            >
                <Text style={styles.signUpText}>회원가입</Text>
                {standardLayout && <Ionicons accessible={false} name="arrow-forward-outline" size={16} color={colors.textSecondary} />}
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

function normalizeShareToken(value?: string | string[]): string | null {
    const token = (Array.isArray(value) ? value[0] : value)?.trim();
    return token && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : null;
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
    loading = false,
    onPress,
}: SocialButtonProps) {
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}로 로그인`}
            accessibilityState={{ disabled, busy: loading }}
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
                {loading ? (
                    <BrandedLoader size="inline" accessibilityLabel="로그인 중" />
                ) : icon ? (
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
            marginTop: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
        },
        passwordHelp: {
            minHeight: 34,
            marginTop: -5,
            alignSelf: "flex-end",
            justifyContent: "center",
        },
        passwordHelpPanel: {
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.surface2,
        },
        passwordHelpCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
        supportLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
        passwordHelpText: {
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "800",
            textDecorationLine: "underline",
        },
        loginError: { gap: 4, paddingVertical: 4 },
        loginErrorInset: {
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: mode === "dark" ? "#934640" : "#D77771",
            backgroundColor: mode === "dark" ? "#2A1D22" : "#FDF2F2",
        },
        loginErrorTitle: { color: mode === "dark" ? "#FF9C96" : "#B42318", fontWeight: "700" },
        loginErrorMessage: { fontSize: 13, lineHeight: 19 },
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

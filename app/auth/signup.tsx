import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    Alert,
    BackHandler,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";

import { loginMember, signUpMember, type SignupConsentsPayload } from "../../src/api/member";
import { AuthInput, AuthPrimaryButton, AuthScreen } from "../../src/modules/auth/components/AuthScreen";
import SignupAgreementPanel from "../../src/modules/auth/components/SignupAgreementPanel";
import {
    clearAuthTokens,
    prepareExplicitAuthenticationRequest,
    saveAuthenticatedSession,
} from "../../src/modules/auth/authStorage";
import { useAuth } from "../../src/modules/auth/AuthContext";
import {
    isAuthSessionTransitionPendingError,
} from "../../src/modules/auth/authSessionEpoch";
import { requireAuthenticatedMember } from "../../src/modules/auth/authenticatedMember";
import { getAuthErrorPresentation } from "../../src/modules/auth/authErrorMessage";
import {
    isValidSignupEmail,
    isValidSignupName,
    MAX_EMAIL_LENGTH,
    MAX_SIGNUP_NAME_LENGTH,
    normalizeSignupEmail,
} from "../../src/modules/auth/signupValidation";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { registerPushAfterLogin } from "../../src/modules/notification/pushRegistration";
import {
    handleSignupAgreementHardwareBack,
    shouldHandleSignupAgreementHardwareBack,
} from "../../src/modules/auth/signupNavigation";

const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])[a-zA-Z\d!@#$%^&*]{8,16}$/;
type SignUpStep = "details" | "agreements";

export default function SignUp() {
    const router = useRouter();
    const isFocused = useIsFocused();
    const { shareToken } = useLocalSearchParams<{ shareToken?: string | string[] }>();
    const { syncAuthentication } = useAuth();
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [confirmPwd, setConfirmPwd] = useState("");
    const [step, setStep] = useState<SignUpStep>("details");
    const [submitting, setSubmitting] = useState(false);
    const pendingShareToken = normalizeShareToken(shareToken);
    const loginRoute = pendingShareToken
        ? { pathname: "/auth/login" as const, params: { shareToken: pendingShareToken } }
        : "/auth/login" as const;

    useEffect(() => {
        if (!shouldHandleSignupAgreementHardwareBack({
            platform: Platform.OS,
            isFocused,
            isAgreementStep: step === "agreements",
        })) return;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            // Keep the in-flight signup on the current step, but consume the
            // system back so it cannot pop the whole signup route.
            return handleSignupAgreementHardwareBack({
                submitting,
                returnToDetails: () => setStep("details"),
            });
        });

        return () => subscription.remove();
    }, [isFocused, step, submitting]);

    const validateDetails = () => {
        const normalizedName = name.trim();
        const normalizedEmail = normalizeSignupEmail(email);

        if (!normalizedName || !normalizedEmail || !pwd || !confirmPwd) {
            Alert.alert("입력 확인", "모든 항목을 입력해 주세요.");
            return false;
        }

        if (!isValidSignupName(normalizedName)) {
            Alert.alert("입력 확인", `이름은 ${MAX_SIGNUP_NAME_LENGTH}자 이하로 입력해 주세요.`);
            return false;
        }

        if (!isValidSignupEmail(normalizedEmail)) {
            Alert.alert("입력 확인", "올바른 이메일 주소를 입력해 주세요.");
            return false;
        }

        if (pwd !== confirmPwd) {
            Alert.alert("입력 확인", "비밀번호가 일치하지 않습니다.");
            return false;
        }

        if (!PASSWORD_PATTERN.test(pwd)) {
            Alert.alert("입력 확인", "비밀번호는 영문, 숫자, !@#$%^&* 조합으로 8~16자여야 합니다.");
            return false;
        }

        return true;
    };

    const onContinue = () => {
        if (validateDetails()) setStep("agreements");
    };

    const onSignUp = async (consents: SignupConsentsPayload) => {
        if (submitting || !validateDetails()) return;

        const normalizedName = name.trim();
        const normalizedEmail = normalizeSignupEmail(email);
        let accountCreated = false;

        try {
            setSubmitting(true);
            await prepareExplicitAuthenticationRequest();
            await signUpMember({
                name: normalizedName,
                email: normalizedEmail,
                password: pwd,
                consents,
            });
            accountCreated = true;

            const member = requireAuthenticatedMember(await loginMember({
                email: normalizedEmail,
                password: pwd,
            }));

            await saveAuthenticatedSession(member);
            const authenticated = await syncAuthentication();
            if (!authenticated) {
                throw new Error("로그인 상태를 저장하지 못했어요. 로그인 화면에서 다시 시도해 주세요.");
            }
            registerPushAfterLogin(member.id).catch((error) => {
                console.warn("[push] token registration failed", error);
            });
            if (pendingShareToken) {
                router.replace({
                    pathname: "/share/[token]",
                    params: { token: pendingShareToken, autoAccept: "1" },
                });
            } else {
                router.replace("/onboarding/calendar-import");
            }
        } catch (error) {
            if (isAuthSessionTransitionPendingError(error)) {
                Alert.alert("로그아웃 정리 중", error.message);
                return;
            }
            if (accountCreated) {
                // The account already exists at this point. Keeping the user on
                // the agreement step would make the next tap submit sign-up
                // again and incorrectly surface a duplicate-email error.
                await clearAuthTokens().catch(() => undefined);
                await syncAuthentication().catch(() => false);
                Alert.alert(
                    "가입은 완료됐어요",
                    "자동 로그인만 완료하지 못했어요. 로그인 화면에서 방금 만든 계정으로 다시 로그인해 주세요.",
                    [
                        {
                            text: "로그인 화면으로",
                            onPress: () => router.replace(loginRoute),
                        },
                    ],
                    { cancelable: false },
                );
                return;
            }

            const presentation = getAuthErrorPresentation(error, "signup");
            await clearAuthTokens();
            await syncAuthentication();
            Alert.alert(presentation.title, presentation.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (step === "agreements") {
        return (
            <AuthScreen
                title="가입 전 확인"
                subtitle="일반 계정을 만들기 전에 필요한 항목입니다."
                onBack={() => setStep("details")}
                backDisabled={submitting}
                density="compact"
            >
                <SignupAgreementPanel
                    submitting={submitting}
                    onConfirm={onSignUp}
                    onOpenTerms={() => router.push("/legal/terms-of-service")}
                    onOpenPrivacyCollection={() => router.push("/legal/privacy-collection-consent")}
                    onOpenPrivacyPolicy={() => router.push("/legal/privacy-policy")}
                />
            </AuthScreen>
        );
    }

    return (
        <AuthScreen
            subtitle="새 계정으로 오늘의 이동을 준비하세요."
            onBack={() => router.replace(loginRoute)}
            density="compact"
        >
            <AuthInput
                label="이름"
                icon="person-outline"
                value={name}
                onChangeText={setName}
                maxLength={MAX_SIGNUP_NAME_LENGTH}
                placeholder="홍길동"
                autoComplete="name"
                textContentType="name"
            />
            <AuthInput
                label="이메일"
                icon="mail-outline"
                value={email}
                onChangeText={setEmail}
                maxLength={MAX_EMAIL_LENGTH}
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
                placeholder="8~16자"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
            />
            <AuthInput
                label="비밀번호 확인"
                icon="checkmark-circle-outline"
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                placeholder="한 번 더 입력"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
            />

            <View style={styles.passwordRule}>
                <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} />
                </View>
                <Text style={styles.passwordRuleText}>
                    영문, 숫자, !@#$%^&* 조합으로 8~16자
                </Text>
            </View>

            <AuthPrimaryButton
                disabled={submitting}
                onPress={onContinue}
                label="다음"
            />

            <Pressable
                accessibilityRole="button"
                onPress={() => router.replace(loginRoute)}
                style={({ pressed }) => [
                    styles.loginLink,
                    {
                        backgroundColor: colors.surface2,
                        borderColor: colors.border,
                        opacity: pressed ? 0.62 : 1,
                    },
                ]}
            >
                <Text style={styles.loginHint}>이미 계정이 있나요?</Text>
                <Text style={styles.loginText}>로그인</Text>
            </Pressable>
        </AuthScreen>
    );
}

function normalizeShareToken(value?: string | string[]): string | null {
    const token = (Array.isArray(value) ? value[0] : value)?.trim();
    return token && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : null;
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"], mode: "dark" | "light") {
    return StyleSheet.create({
        passwordRule: {
            minHeight: 34,
            borderRadius: 14,
            paddingHorizontal: 11,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            backgroundColor: mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        },
        passwordRuleText: {
            flex: 1,
            minWidth: 0,
            color: colors.textSecondary,
            fontSize: 12,
            lineHeight: 17,
            fontWeight: "800",
        },
        loginLink: {
            minHeight: 50,
            borderRadius: 16,
            borderWidth: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            marginTop: 2,
        },
        loginHint: {
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: "800",
        },
        loginText: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: "900",
        },
    });
}

import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    Alert,
    BackHandler,
    Keyboard,
    Platform,
    StyleSheet,
    TextInput,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";

import { loginMember, signUpMember, type SignupConsentsPayload } from "../../src/api/member";
import { AuthInput, AuthPrimaryButton, AuthScreen } from "../../src/modules/auth/components/AuthScreen";
import SignupAgreementPanel from "../../src/modules/auth/components/SignupAgreementPanel";
import { clearAuthTokens, saveAuthMember, saveAuthTokens } from "../../src/modules/auth/authStorage";
import { useAuthFormDrafts } from "../../src/modules/auth/AuthFormDrafts";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { requireAuthenticatedMember } from "../../src/modules/auth/authenticatedMember";
import { getAuthErrorPresentation } from "../../src/modules/auth/authErrorMessage";
import {
    getSignupFieldErrors,
    MAX_EMAIL_LENGTH,
    MAX_SIGNUP_NAME_LENGTH,
    normalizeSignupEmail,
    SIGNUP_FIELDS,
    type SignupField,
    type SignupFieldErrors,
} from "../../src/modules/auth/signupValidation";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { registerPushAfterLogin } from "../../src/modules/notification/pushRegistration";
import {
    handleSignupAgreementHardwareBack,
    shouldHandleSignupAgreementHardwareBack,
} from "../../src/modules/auth/signupNavigation";

type SignUpStep = "details" | "agreements";

export default function SignUp() {
    const router = useRouter();
    const isFocused = useIsFocused();
    const { shareToken } = useLocalSearchParams<{ shareToken?: string | string[] }>();
    const { syncAuthentication } = useAuth();
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    const { signup: { name, email, password: pwd, confirmation: confirmPwd }, setSignup, clear: clearDrafts } = useAuthFormDrafts();
    const [step, setStep] = useState<SignUpStep>("details");
    const [submitting, setSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
    const [focusRequest, setFocusRequest] = useState<{ field: SignupField }>();
    const nameInput = useRef<TextInput>(null);
    const emailInput = useRef<TextInput>(null);
    const passwordInput = useRef<TextInput>(null);
    const confirmationInput = useRef<TextInput>(null);

    useEffect(() => {
        if (!focusRequest || step !== "details" || !isFocused) return;
        const fields = { name: nameInput, email: emailInput, password: passwordInput, confirmation: confirmationInput };
        fields[focusRequest.field].current?.focus();
        setFocusRequest(undefined);
    }, [focusRequest, isFocused, step]);
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
        const errors = getSignupFieldErrors({ name, email, password: pwd, confirmation: confirmPwd });
        const first = SIGNUP_FIELDS.find(field => Boolean(errors[field]));
        setFieldErrors(errors);
        if (!first) return true;
        setStep("details");
        setFocusRequest({ field: first });
        return false;
    };

    const updateField = (field: SignupField, value: string) => {
        setSignup(current => ({ ...current, [field]: value }));
        setFieldErrors(current => {
            if (!current[field] && !(field === "password" && current.confirmation)) return current;
            const next = { ...current };
            delete next[field];
            if (field === "password") delete next.confirmation;
            return next;
        });
    };

    const onContinue = () => {
        if (!validateDetails()) return;
        Keyboard.dismiss();
        setStep("agreements");
    };

    const onSignUp = async (consents: SignupConsentsPayload) => {
        if (submitting || !validateDetails()) return;

        const normalizedName = name.trim();
        const normalizedEmail = normalizeSignupEmail(email);
        let accountCreated = false;

        try {
            setSubmitting(true);
            await signUpMember({
                name: normalizedName,
                email: normalizedEmail,
                password: pwd,
                consents,
            });
            accountCreated = true;
            clearDrafts();

            const member = requireAuthenticatedMember(await loginMember({
                email: normalizedEmail,
                password: pwd,
            }));

            await saveAuthTokens(member.accessToken, member.refreshToken);
            await saveAuthMember(member);
            const authenticated = await syncAuthentication({ confirmedFreshLogin: true });
            if (!authenticated) {
                throw new Error("로그인 상태를 저장하지 못했어요. 로그인 화면에서 다시 시도해 주세요.");
            }
            // confirmedFreshLogin resolves only after the native account cleanup/bind boundary.
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
                subtitle="계정을 만들려면 아래 두 항목에 동의해 주세요."
                signupStep={2}
                onBack={() => setStep("details")}
                backLabel="가입 정보로 돌아가기"
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
            title="계정을 만들어요"
            subtitle="기본 정보와 비밀번호를 설정해 주세요."
            signupStep={1}
            backLabel="로그인으로 돌아가기"
            onBack={() => {
                Keyboard.dismiss();
                router.dismissTo(loginRoute);
            }}
            density="compact"
        >
            <AuthInput
                label="이름"
                icon="person-outline"
                value={name}
                inputRef={nameInput}
                errorMessage={fieldErrors.name}
                onChangeText={value => updateField("name", value)}
                maxLength={MAX_SIGNUP_NAME_LENGTH}
                placeholder="홍길동"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailInput.current?.focus()}
            />
            <AuthInput
                label="이메일"
                icon="mail-outline"
                value={email}
                inputRef={emailInput}
                errorMessage={fieldErrors.email}
                onChangeText={value => updateField("email", value)}
                maxLength={MAX_EMAIL_LENGTH}
                placeholder="you@example.com"
                autoCapitalize="none"
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
                errorMessage={fieldErrors.password}
                onChangeText={value => updateField("password", value)}
                placeholder="8~16자"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => confirmationInput.current?.focus()}
            />
            {!fieldErrors.password ? (
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
            ) : null}
            <AuthInput
                label="비밀번호 확인"
                icon="checkmark-circle-outline"
                value={confirmPwd}
                inputRef={confirmationInput}
                errorMessage={fieldErrors.confirmation}
                onChangeText={value => updateField("confirmation", value)}
                placeholder="한 번 더 입력"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={onContinue}
            />

            <AuthPrimaryButton
                disabled={submitting}
                onPress={onContinue}
                label="다음"
            />

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
            lineHeight: 18,
            fontWeight: "400",
        },
    });
}

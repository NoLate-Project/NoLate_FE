import { useState } from "react";
import { useRouter } from "expo-router";
import {
    Alert,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { loginMember, signUpMember, type SignupConsentsPayload } from "../../src/api/member";
import { AuthInput, AuthPrimaryButton, AuthScreen } from "../../src/modules/auth/components/AuthScreen";
import SignupAgreementPanel from "../../src/modules/auth/components/SignupAgreementPanel";
import { clearAuthTokens, saveAuthMember, saveAuthTokens } from "../../src/modules/auth/authStorage";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { getAuthErrorPresentation } from "../../src/modules/auth/authErrorMessage";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { registerPushAfterLogin } from "../../src/modules/notification/pushRegistration";

const PASSWORD_PATTERN = /^[a-zA-Z0-9!@#$%^&*]{8,16}$/;
type SignUpStep = "details" | "agreements";

export default function SignUp() {
    const router = useRouter();
    const { syncAuthentication } = useAuth();
    const { colors, mode } = useTheme();
    const styles = createStyles(colors, mode);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [confirmPwd, setConfirmPwd] = useState("");
    const [step, setStep] = useState<SignUpStep>("details");
    const [submitting, setSubmitting] = useState(false);

    const validateDetails = () => {
        const normalizedName = name.trim();
        const normalizedEmail = email.trim();

        if (!normalizedName || !normalizedEmail || !pwd || !confirmPwd) {
            Alert.alert("입력 확인", "모든 항목을 입력해 주세요.");
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
        const normalizedEmail = email.trim();

        try {
            setSubmitting(true);
            await signUpMember({
                name: normalizedName,
                email: normalizedEmail,
                password: pwd,
                consents,
            });

            const member = await loginMember({
                email: normalizedEmail,
                password: pwd,
            });

            await saveAuthTokens(member.accessToken, member.refreshToken);
            await saveAuthMember(member);
            await syncAuthentication();
            await registerPushAfterLogin(member.id).catch((error) => {
                console.warn("[push] token registration failed", error);
            });
            router.replace("/onboarding/calendar-import");
        } catch (error) {
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
            onBack={() => router.replace("/auth/login")}
            density="compact"
        >
            <AuthInput
                label="이름"
                icon="person-outline"
                value={name}
                onChangeText={setName}
                placeholder="홍길동"
                autoComplete="name"
                textContentType="name"
            />
            <AuthInput
                label="이메일"
                icon="mail-outline"
                value={email}
                onChangeText={setEmail}
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
                <Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} />
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
                onPress={() => router.replace("/auth/login")}
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

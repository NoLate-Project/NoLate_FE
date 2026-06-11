import { useState } from "react";
import { useRouter } from "expo-router";
import {
    Alert,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { loginMember, signUpMember } from "../../src/api/member";
import { clearAuthTokens, saveAuthTokens } from "../../src/modules/auth/authStorage";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { registerPushAfterLogin } from "../../src/modules/notification/pushRegistration";

const PASSWORD_PATTERN = /^[a-zA-Z0-9!@#$%^&*]{8,16}$/;

export default function SignUp() {
    const router = useRouter();
    const { mode, colors } = useTheme();
    const styles = createStyles(colors);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [confirmPwd, setConfirmPwd] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const onSignUp = async () => {
        const normalizedName = name.trim();
        const normalizedEmail = email.trim();

        if (!normalizedName || !normalizedEmail || !pwd || !confirmPwd) {
            Alert.alert("입력 확인", "모든 항목을 입력해 주세요.");
            return;
        }

        if (pwd !== confirmPwd) {
            Alert.alert("입력 확인", "비밀번호가 일치하지 않습니다.");
            return;
        }

        if (!PASSWORD_PATTERN.test(pwd)) {
            Alert.alert("입력 확인", "비밀번호는 영문, 숫자, !@#$%^&* 조합으로 8~16자여야 합니다.");
            return;
        }

        try {
            setSubmitting(true);
            await signUpMember({
                name: normalizedName,
                email: normalizedEmail,
                password: pwd,
            });

            const member = await loginMember({
                email: normalizedEmail,
                password: pwd,
            });

            await saveAuthTokens(member.accessToken, member.refreshToken);
            await registerPushAfterLogin(member.id).catch((error) => {
                console.warn("[push] token registration failed", error);
            });
            router.replace("/schedule");
        } catch (error) {
            const message = error instanceof Error ? error.message : "회원가입에 실패했습니다.";
            await clearAuthTokens();
            Alert.alert("회원가입 실패", message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <View style={styles.screen}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={styles.card}>
                <Text style={styles.title}>회원가입</Text>
                <Text style={styles.subtitle}>NoLate 계정을 생성해 시작하세요</Text>

                <View style={styles.form}>
                    <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="이름"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.input}
                    />
                    <TextInput
                        value={email}
                        onChangeText={setEmail}
                        placeholder="이메일"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.input}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />
                    <TextInput
                        value={pwd}
                        onChangeText={setPwd}
                        placeholder="비밀번호"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.input}
                        secureTextEntry
                    />
                    <TextInput
                        value={confirmPwd}
                        onChangeText={setConfirmPwd}
                        placeholder="비밀번호 확인"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.input}
                        secureTextEntry
                    />
                </View>

                <Pressable
                    disabled={submitting}
                    onPress={onSignUp}
                    style={({ pressed }) => [styles.signUpButton, pressed && styles.pressed, submitting && styles.disabled]}
                >
                    <Text style={styles.signUpText}>{submitting ? "가입 처리 중..." : "회원가입"}</Text>
                </Pressable>

                <Pressable onPress={() => router.replace("/auth/login")} style={({ pressed }) => [styles.loginLink, pressed && styles.pressed]}>
                    <Text style={styles.loginLinkText}>이미 계정이 있나요? 로그인</Text>
                </Pressable>
            </View>
        </View>
    );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
    return StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
            paddingHorizontal: 20,
            justifyContent: "center",
        },
        card: {
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            paddingHorizontal: 16,
            paddingVertical: 20,
            gap: 14,
        },
        title: {
            color: colors.textPrimary,
            fontSize: 26,
            fontWeight: "800",
        },
        subtitle: {
            color: colors.textSecondary,
            fontSize: 14,
            fontWeight: "500",
        },
        form: {
            gap: 10,
            marginTop: 4,
        },
        input: {
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
            color: colors.textPrimary,
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 10,
            fontSize: 15,
        },
        signUpButton: {
            backgroundColor: colors.selectedDayBg,
            borderRadius: 10,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
        },
        signUpText: {
            color: colors.selectedDayText,
            fontSize: 15,
            fontWeight: "700",
        },
        loginLink: {
            alignItems: "center",
            justifyContent: "center",
            minHeight: 32,
        },
        loginLinkText: {
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: "600",
        },
        pressed: {
            opacity: 0.84,
        },
        disabled: {
            opacity: 0.65,
        },
    });
}

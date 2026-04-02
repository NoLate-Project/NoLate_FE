import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
    Alert,
    Animated,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { loginMember, snsLoginMember, tokenLoginMember } from "../../src/api/member";
import { clearAuthTokens, getAccessToken, getRefreshToken, saveAuthTokens } from "../../src/modules/auth/authStorage";
import { loginWithKakaoSdk, loginWithNaverSdk } from "../../src/modules/auth/socialLogin";
import { useTheme } from "../../src/modules/theme/ThemeContext";

type SocialProvider = "naver" | "kakao" | "apple";

export default function Login() {
    const router = useRouter();
    const { mode, colors, toggleMode } = useTheme();
    const styles = createStyles(colors);
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const btnScale = useRef(new Animated.Value(1)).current;

    const [id, setId] = useState("");
    const [pwd, setPwd] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [socialSubmitting, setSocialSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const tryTokenLogin = async () => {
            const accessToken = await getAccessToken();
            const refreshToken = await getRefreshToken();
            if (!accessToken || !refreshToken || cancelled) return;

            try {
                const member = await tokenLoginMember({ refreshToken });
                if (cancelled) return;

                await saveAuthTokens(member.accessToken, member.refreshToken);
                router.replace("/schedule");
            } catch {
                if (cancelled) return;
                await clearAuthTokens();
            }
        };

        tryTokenLogin();

        return () => {
            cancelled = true;
        };
    }, [router]);

    const onLogin = async () => {
        if (!id || !pwd) {
            Alert.alert("입력 확인", "이메일과 비밀번호를 입력해 주세요.");
            return;
        }

        try {
            setSubmitting(true);
            const member = await loginMember({
                email: id.trim(),
                password: pwd,
            });

            await saveAuthTokens(member.accessToken, member.refreshToken);
            router.replace("/schedule");
        } catch (error) {
            const message = error instanceof Error ? error.message : "로그인에 실패했습니다.";
            Alert.alert("로그인 실패", message);
        } finally {
            setSubmitting(false);
        }
    };

    const onSocialLogin = async (provider: SocialProvider) => {
        if (socialSubmitting) return;

        if (provider === "apple") {
            Alert.alert("준비 중", "Apple 로그인은 아직 준비 중입니다.");
            return;
        }

        try {
            setSocialSubmitting(true);

            const profile = provider === "kakao" ? await loginWithKakaoSdk() : await loginWithNaverSdk();

            const member = await snsLoginMember({
                loginType: profile.loginType,
                snsId: profile.snsId,
                email: profile.email,
                name: profile.name,
            });

            await saveAuthTokens(member.accessToken, member.refreshToken);
            router.replace("/schedule");
        } catch (error) {
            const message = error instanceof Error ? error.message : "SNS 로그인에 실패했습니다.";
            Alert.alert("SNS 로그인 실패", message);
        } finally {
            setSocialSubmitting(false);
        }
    };

    const handleToggleMode = () => {
        Animated.sequence([
            Animated.timing(btnScale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
            Animated.spring(btnScale, { toValue: 1, friction: 4, useNativeDriver: true }),
        ]).start();

        Animated.timing(fadeAnim, {
            toValue: 0.08,
            duration: 140,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                toggleMode();
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 280,
                    useNativeDriver: true,
                }).start();
            }
        });
    };

    return (
        <Animated.View style={[styles.screen, { opacity: fadeAnim }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={styles.card}>
                <View style={styles.topRow}>
                    <View>
                        <Text style={styles.logo}>NoLate</Text>
                        <Text style={styles.subtitle}>일정을 놓치지 않도록 로그인해 주세요</Text>
                    </View>
                    <Animated.View style={{ transform: [{ scale: btnScale }] }}>
                        <Pressable onPress={handleToggleMode} style={({ pressed }) => [styles.modeToggle, pressed && styles.pressed]}>
                            <Text style={styles.modeIcon}>{mode === "dark" ? "☀️" : "🌙"}</Text>
                            <Text style={styles.modeText}>{mode === "dark" ? "라이트" : "다크"}</Text>
                        </Pressable>
                    </Animated.View>
                </View>

                <View style={styles.form}>
                    <TextInput
                        value={id}
                        onChangeText={setId}
                        placeholder="Email"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.input}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />
                    <TextInput
                        value={pwd}
                        onChangeText={setPwd}
                        placeholder="Password"
                        placeholderTextColor={colors.textSecondary}
                        secureTextEntry
                        style={styles.input}
                    />
                </View>

                <Pressable
                    disabled={submitting}
                    onPress={onLogin}
                    style={({ pressed }) => [styles.loginButton, pressed && styles.pressed, submitting && styles.disabled]}
                >
                    <Text style={styles.loginButtonText}>{submitting ? "로그인 중..." : "로그인"}</Text>
                </Pressable>

                <View style={styles.dividerWrap}>
                    <View style={styles.divider} />
                    <Text style={styles.dividerText}>또는 SNS 로그인</Text>
                    <View style={styles.divider} />
                </View>

                <View style={styles.socialGroup}>
                    <Pressable
                        disabled={socialSubmitting}
                        onPress={() => onSocialLogin("naver")}
                        style={({ pressed }) => [styles.socialItem, pressed && styles.pressed, socialSubmitting && styles.disabled]}
                    >
                        <View style={[styles.socialCircle, styles.naverButton]}>
                            <Text style={styles.naverSymbol}>N</Text>
                        </View>
                        <Text style={styles.socialLabel}>네이버</Text>
                    </Pressable>
                    <Pressable
                        disabled={socialSubmitting}
                        onPress={() => onSocialLogin("kakao")}
                        style={({ pressed }) => [styles.socialItem, pressed && styles.pressed, socialSubmitting && styles.disabled]}
                    >
                        <View style={[styles.socialCircle, styles.kakaoButton]}>
                            <Text style={styles.kakaoSymbol}>K</Text>
                        </View>
                        <Text style={styles.socialLabel}>카카오</Text>
                    </Pressable>
                    <Pressable
                        disabled={socialSubmitting}
                        onPress={() => onSocialLogin("apple")}
                        style={({ pressed }) => [styles.socialItem, pressed && styles.pressed, socialSubmitting && styles.disabled]}
                    >
                        <View style={[styles.socialCircle, styles.appleButton]}>
                            <Text style={styles.appleSymbol}></Text>
                        </View>
                        <Text style={styles.socialLabel}>Apple</Text>
                    </Pressable>
                </View>

                <Pressable onPress={() => router.push("/auth/signup")} style={({ pressed }) => [styles.signUpLinkWrap, pressed && styles.pressed]}>
                    <Text style={styles.signUpLink}>회원가입 하기</Text>
                </Pressable>
            </View>
        </Animated.View>
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
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 18,
            paddingHorizontal: 16,
            paddingVertical: 20,
            gap: 14,
        },
        logo: {
            color: colors.textPrimary,
            fontSize: 28,
            fontWeight: "800",
            letterSpacing: 0.3,
        },
        topRow: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
        },
        subtitle: {
            color: colors.textSecondary,
            fontSize: 14,
            fontWeight: "500",
        },
        modeToggle: {
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
        },
        modeIcon: {
            fontSize: 14,
        },
        modeText: {
            color: colors.textPrimary,
            fontSize: 12,
            fontWeight: "700",
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
        loginButton: {
            backgroundColor: colors.selectedDayBg,
            borderRadius: 10,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
        },
        loginButtonText: {
            color: colors.selectedDayText,
            fontSize: 15,
            fontWeight: "700",
        },
        dividerWrap: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 2,
        },
        divider: {
            flex: 1,
            height: 1,
            backgroundColor: colors.border,
        },
        dividerText: {
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: "600",
        },
        socialGroup: {
            flexDirection: "row",
            justifyContent: "space-evenly",
            marginTop: 2,
        },
        socialItem: {
            alignItems: "center",
            gap: 8,
        },
        socialCircle: {
            width: 62,
            height: 62,
            borderRadius: 31,
            alignItems: "center",
            justifyContent: "center",
        },
        naverButton: {
            backgroundColor: "#03C75A",
        },
        kakaoButton: {
            backgroundColor: "#FEE500",
        },
        appleButton: {
            backgroundColor: modeAwareApple(colors.background),
            borderWidth: 1,
            borderColor: colors.border,
        },
        naverSymbol: {
            color: "#FFFFFF",
            fontSize: 24,
            fontWeight: "900",
        },
        kakaoSymbol: {
            color: "#191600",
            fontSize: 24,
            fontWeight: "900",
        },
        appleSymbol: {
            color: colors.textPrimary,
            fontSize: 26,
            fontWeight: "700",
        },
        socialLabel: {
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: "700",
        },
        signUpLinkWrap: {
            marginTop: 4,
            alignItems: "center",
            justifyContent: "center",
            minHeight: 32,
        },
        signUpLink: {
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: "700",
            textDecorationLine: "underline",
        },
        pressed: {
            opacity: 0.84,
        },
        disabled: {
            opacity: 0.65,
        },
    });
}

function modeAwareApple(backgroundColor: string) {
    return backgroundColor === "#000" ? "#1A1A1A" : "#FFFFFF";
}

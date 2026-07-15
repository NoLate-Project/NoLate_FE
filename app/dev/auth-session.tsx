import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { loginMember } from "../../src/api/member";
import { saveAuthMember, saveAuthTokens } from "../../src/modules/auth/authStorage";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { useTheme } from "../../src/modules/theme/ThemeContext";

function firstParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

export default function DevAuthSession() {
    const router = useRouter();
    const { syncAuthentication } = useAuth();
    const { colors } = useTheme();
    const params = useLocalSearchParams<{
        email?: string | string[];
        password?: string | string[];
        redirect?: string | string[];
    }>();
    const [message, setMessage] = useState("테스트 세션을 준비하는 중이에요.");

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            const email = firstParam(params.email)?.trim();
            const password = firstParam(params.password);
            const redirect = firstParam(params.redirect) ?? "/schedule";

            if (!email || !password) {
                setMessage("email/password 파라미터가 필요해요.");
                return;
            }

            try {
                setMessage(`${email} 계정으로 로그인 중이에요.`);
                const member = await loginMember({ email, password });
                if (cancelled) return;

                await saveAuthTokens(member.accessToken, member.refreshToken);
                await saveAuthMember(member);
                await syncAuthentication();
                if (cancelled) return;

                router.replace(redirect as never);
            } catch (error) {
                if (cancelled) return;
                const errorMessage = error instanceof Error ? error.message : "로그인에 실패했습니다.";
                setMessage(errorMessage);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [params.email, params.password, params.redirect, router, syncAuthentication]);

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.textPrimary} />
            <Text style={[styles.text, { color: colors.textSecondary }]}>
                {message}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        paddingHorizontal: 28,
    },
    text: {
        textAlign: "center",
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 20,
        letterSpacing: 0,
    },
});

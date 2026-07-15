import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ShareInvitationSheet from "../../src/modules/schedule/components/share/ShareInvitationSheet";
import { useTheme } from "../../src/modules/theme/ThemeContext";

export default function SharePreviewScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { kind } = useLocalSearchParams<{ kind?: string }>();
    const { colors } = useTheme();
    const resourceType = kind === "schedule" ? "schedule" : "category";
    const accentColor = resourceType === "schedule" ? "#2F80FF" : "#34C759";

    return (
        <View
            style={[
                styles.root,
                {
                    backgroundColor: colors.background,
                    paddingTop: insets.top + 24,
                },
            ]}
        >
            <View style={[styles.previewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.previewIcon, { backgroundColor: `${accentColor}20` }]}>
                    <Ionicons
                        name={resourceType === "schedule" ? "calendar-outline" : "folder-open-outline"}
                        size={24}
                        color={accentColor}
                    />
                </View>
                <Text style={[styles.previewTitle, { color: colors.textPrimary }]}>
                    공유 시트 미리보기
                </Text>
                <Text style={[styles.previewText, { color: colors.textSecondary }]}>
                    실제 일정/카테고리 공유 컴포넌트를 DEV 환경에서 바로 띄운 화면입니다.
                </Text>
            </View>

            <ShareInvitationSheet
                visible
                resourceType={resourceType}
                resourceId="1"
                title={resourceType === "schedule" ? "오전 팀 싱크" : "업무"}
                subtitle={resourceType === "schedule"
                    ? "07.11 · 10:00-11:00"
                    : "이 카테고리에 포함된 일정을 함께 볼 수 있어요"}
                accentColor={accentColor}
                onClose={() => router.replace("/schedule")}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        paddingHorizontal: 22,
    },
    previewCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 18,
        alignItems: "center",
        gap: 10,
    },
    previewIcon: {
        width: 50,
        height: 50,
        borderRadius: 25,
        alignItems: "center",
        justifyContent: "center",
    },
    previewTitle: {
        fontSize: 20,
        fontWeight: "900",
        letterSpacing: 0,
    },
    previewText: {
        fontSize: 14,
        fontWeight: "600",
        lineHeight: 20,
        textAlign: "center",
        letterSpacing: 0,
    },
});

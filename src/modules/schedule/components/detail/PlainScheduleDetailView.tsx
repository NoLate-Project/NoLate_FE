import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

import { useTheme } from "../../../theme/ThemeContext";
import {
    buildPlainScheduleDetailPresentation,
    type PlainScheduleDetailPresentation,
} from "../../plainScheduleDetailPresentation";
import type { ScheduleItem } from "../../types";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    item: ScheduleItem;
    contentTopInset: number;
    contentBottomInset: number;
    travelPlan?: {
        statusLabel: string;
        actionLabel: string;
        pending: boolean;
        onPress: () => void;
        participantContent?: React.ReactNode;
    };
};

type ReadOnlyFieldProps = {
    label: string;
    value: string;
    muted?: boolean;
};

function ReadOnlyField({ label, value, muted = false }: ReadOnlyFieldProps) {
    const { colors } = useTheme();

    return (
        <View style={styles.column}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
            <View
                accessible
                accessibilityLabel={`${label} ${value}`}
                style={[
                    styles.field,
                    {
                        borderColor: colors.inputBorder,
                        backgroundColor: colors.inputBackground,
                    },
                ]}
            >
                <Text
                    numberOfLines={1}
                    style={[styles.fieldText, { color: muted ? colors.textSecondary : colors.textPrimary }]}
                >
                    {value}
                </Text>
            </View>
        </View>
    );
}

function SettingSummaryRow({
    title,
    hint,
    value,
    highlighted,
}: {
    title: string;
    hint: string;
    value: string;
    highlighted: boolean;
}) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";

    return (
        <View
            accessible
            accessibilityLabel={`${title} ${value}`}
            style={[
                styles.settingRow,
                {
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.inputBackground,
                },
            ]}
        >
            <View style={styles.settingCopy}>
                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>{title}</Text>
                <Text style={[styles.settingHint, { color: colors.textSecondary }]}>{hint}</Text>
            </View>
            <View
                style={[
                    styles.settingValue,
                    { backgroundColor: highlighted ? accent : colors.border },
                ]}
            >
                <Text
                    style={[
                        styles.settingValueText,
                        highlighted
                            ? styles.settingValueTextHighlighted
                            : mode === "dark"
                                ? styles.settingValueTextMutedDark
                                : styles.settingValueTextMutedLight,
                    ]}
                >
                    {value}
                </Text>
            </View>
        </View>
    );
}

function DateFields({ presentation }: { presentation: PlainScheduleDetailPresentation }) {
    return (
        <>
            <View style={styles.twoColumnRow}>
                <ReadOnlyField label="시작 날짜" value={presentation.startDate} />
                <ReadOnlyField
                    label={presentation.allDay ? "마지막 날" : "시작 시간"}
                    value={presentation.allDay ? presentation.endDate! : presentation.startTime!}
                />
            </View>

            {!presentation.allDay ? (
                <SettingSummaryRow
                    title="종료 시각 설정"
                    hint={presentation.hasEndTime
                        ? "종료 시각까지 표시하는 일정이에요."
                        : "시작 시각만 표시하는 일정이에요."}
                    value={presentation.hasEndTime ? "설정" : "미설정"}
                    highlighted={presentation.hasEndTime}
                />
            ) : null}

            {presentation.hasEndTime ? (
                <View style={styles.twoColumnRow}>
                    <ReadOnlyField label="종료 날짜" value={presentation.endDate!} />
                    <ReadOnlyField label="종료 시간" value={presentation.endTime!} />
                </View>
            ) : null}
        </>
    );
}

export default function PlainScheduleDetailView({
    item,
    contentTopInset,
    contentBottomInset,
    travelPlan,
}: Props) {
    const { colors, mode } = useTheme();
    const presentation = useMemo(
        () => buildPlainScheduleDetailPresentation(item),
        [item]
    );
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";

    return (
        <ScrollView
            testID="plain-schedule-detail"
            style={[styles.root, { backgroundColor: colors.background }]}
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: contentTopInset,
                    paddingBottom: contentBottomInset,
                },
            ]}
            showsVerticalScrollIndicator={false}
        >
            <View testID="plain-schedule-detail-page" style={styles.pageContent}>
                <View style={styles.headerRow}>
                    <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>일정 정보</Text>
                </View>

                <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
                <View
                    accessible
                    accessibilityLabel={`제목 ${presentation.title}, 카테고리 ${presentation.categoryTitle}`}
                    style={[
                        styles.titleField,
                        {
                            borderColor: colors.inputBorder,
                            backgroundColor: colors.inputBackground,
                        },
                    ]}
                >
                    <Text numberOfLines={2} style={[styles.titleText, { color: colors.textPrimary }]}>
                        {presentation.title}
                    </Text>
                    <View style={[styles.categoryChip, { borderColor: colors.border }]}>
                        <View style={[styles.categoryDot, { backgroundColor: presentation.categoryColor }]} />
                        <Text numberOfLines={1} style={[styles.categoryText, { color: colors.textPrimary }]}>
                            {presentation.categoryTitle}
                        </Text>
                    </View>
                </View>

                <Text style={[styles.label, { color: colors.textSecondary }]}>장소</Text>
                <View
                    accessible
                    accessibilityLabel={`장소 ${presentation.location ?? "등록된 장소 없음"}`}
                    style={[
                        styles.locationField,
                        {
                            borderColor: colors.inputBorder,
                            backgroundColor: colors.inputBackground,
                        },
                    ]}
                >
                    <Ionicons name="location-outline" size={18} color={accent} />
                    <Text
                        numberOfLines={2}
                        style={[
                            styles.locationText,
                            { color: presentation.location ? colors.textPrimary : colors.textSecondary },
                        ]}
                    >
                        {presentation.location ?? "등록된 장소 없음"}
                    </Text>
                </View>

                {travelPlan ? (
                    <View style={styles.travelPlanSection}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>이동 계획</Text>
                        <View
                            style={[
                                styles.travelPlanRow,
                                {
                                    borderColor: colors.inputBorder,
                                    backgroundColor: colors.inputBackground,
                                },
                            ]}
                        >
                            <View style={[styles.travelPlanIcon, { backgroundColor: `${accent}1F` }]}>
                                <Ionicons name="navigate-outline" size={18} color={accent} />
                            </View>
                            <View style={styles.travelPlanCopy}>
                                <Text style={[styles.travelPlanTitle, { color: colors.textPrimary }]}>내 이동 경로</Text>
                                <Text
                                    numberOfLines={1}
                                    style={[styles.travelPlanStatus, { color: colors.textSecondary }]}
                                >
                                    {travelPlan.statusLabel}
                                </Text>
                            </View>
                            <Pressable
                                onPress={travelPlan.onPress}
                                disabled={travelPlan.pending}
                                accessibilityRole="button"
                                accessibilityLabel={`내 이동 경로 ${travelPlan.actionLabel}`}
                                accessibilityState={{ busy: travelPlan.pending, disabled: travelPlan.pending }}
                                style={({ pressed }) => [
                                    styles.travelPlanButton,
                                    {
                                        backgroundColor: accent,
                                        opacity: pressed || travelPlan.pending ? 0.62 : 1,
                                    },
                                ]}
                            >
                                {travelPlan.pending ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Ionicons name="map-outline" size={16} color="#FFFFFF" />
                                )}
                                <Text style={styles.travelPlanButtonText}>{travelPlan.actionLabel}</Text>
                            </Pressable>
                        </View>
                        {travelPlan.participantContent}
                    </View>
                ) : null}

                <SettingSummaryRow
                    title="종일"
                    hint={presentation.allDay
                        ? "시간 없이 날짜로만 표시하는 일정이에요."
                        : "시작과 종료 시간이 지정된 일정이에요."}
                    value={presentation.allDay ? "종일" : "시간 일정"}
                    highlighted={presentation.allDay}
                />

                <DateFields presentation={presentation} />

                <Text style={[styles.label, { color: colors.textSecondary }]}>메모</Text>
                <View
                    accessible
                    accessibilityLabel={`메모 ${presentation.notes ?? "등록된 메모 없음"}`}
                    style={[
                        styles.notesField,
                        {
                            borderColor: colors.inputBorder,
                            backgroundColor: colors.inputBackground,
                        },
                    ]}
                >
                    <Text
                        style={[
                            styles.notesText,
                            { color: presentation.notes ? colors.textPrimary : colors.textSecondary },
                        ]}
                    >
                        {presentation.notes ?? "등록된 메모 없음"}
                    </Text>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 20,
    },
    pageContent: {
        width: "100%",
        maxWidth: 560,
        alignSelf: "center",
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
    },
    headerTitle: {
        fontSize: 26,
        lineHeight: 34,
        fontWeight: "900",
    },
    label: {
        marginBottom: 6,
        fontSize: 13,
    },
    titleField: {
        minHeight: 52,
        borderWidth: 1,
        borderRadius: 16,
        paddingLeft: 12,
        paddingRight: 8,
        paddingVertical: 7,
        marginBottom: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleText: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "700",
    },
    categoryChip: {
        maxWidth: 116,
        minHeight: 30,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    categoryDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    categoryText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: "800",
    },
    locationField: {
        minHeight: 50,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    locationText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
    },
    travelPlanSection: {
        marginBottom: 14,
    },
    travelPlanRow: {
        minHeight: 64,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    travelPlanIcon: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    travelPlanCopy: {
        flex: 1,
        minWidth: 0,
    },
    travelPlanTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
    travelPlanStatus: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    travelPlanButton: {
        minWidth: 76,
        height: 38,
        borderRadius: 8,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    travelPlanButtonText: {
        color: "#FFFFFF",
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
    settingRow: {
        minHeight: 58,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 13,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    settingCopy: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 9,
    },
    settingTitle: {
        fontSize: 13,
        fontWeight: "800",
    },
    settingHint: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: "600",
    },
    settingValue: {
        minWidth: 50,
        minHeight: 28,
        borderRadius: 999,
        paddingHorizontal: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    settingValueText: {
        fontSize: 11,
        fontWeight: "800",
    },
    settingValueTextHighlighted: {
        color: "#FFFFFF",
    },
    settingValueTextMutedDark: {
        color: "#8E8E93",
    },
    settingValueTextMutedLight: {
        color: "#6E6E73",
    },
    twoColumnRow: {
        flexDirection: "row",
        gap: 10,
        marginBottom: 14,
    },
    column: {
        flex: 1,
        minWidth: 0,
    },
    field: {
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 12,
        justifyContent: "center",
    },
    fieldText: {
        fontSize: 13,
        fontWeight: "700",
    },
    notesField: {
        minHeight: 88,
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
    },
    notesText: {
        fontSize: 13,
        lineHeight: 20,
        fontWeight: "600",
    },
});

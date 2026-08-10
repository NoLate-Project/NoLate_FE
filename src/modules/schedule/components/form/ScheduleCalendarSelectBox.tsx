import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ScheduleCalendar } from "../../../../api/scheduleCalendars";
import { useTheme } from "../../../theme/ThemeContext";

type Props = {
    calendars: ScheduleCalendar[];
    value: number | null;
    loading?: boolean;
    error?: string | null;
    locked?: boolean;
    onChange: (calendarId: number | null) => void;
    onRetry?: () => void;
    onManageCalendars?: () => void;
};

function contentModeLabel(calendar: ScheduleCalendar) {
    return calendar.defaultContentMode === "SCHEDULE_AND_TRAVEL"
        ? "멤버별 경로"
        : "일정만 공유";
}

/**
 * 새 일정의 소속을 개인 영역 또는 쓰기 가능한 공유 캘린더 중에서 고른다.
 * 개인 영역을 항상 첫 항목으로 유지해 네트워크 오류가 나도 일정 생성 자체는 막지 않는다.
 */
export default function ScheduleCalendarSelectBox({
    calendars,
    value,
    loading = false,
    error,
    locked = false,
    onChange,
    onRetry,
    onManageCalendars,
}: Props) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#8BB7FF" : "#2F80FF";
    const selectedCalendar = calendars.find((calendar) => calendar.id === value);
    const lockedTitle = value === null
        ? "개인 일정"
        : selectedCalendar?.title ?? "현재 공유 캘린더";
    const lockedColor = selectedCalendar?.color ?? colors.textSecondary;

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>캘린더</Text>
                {onManageCalendars ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="공유 캘린더 관리"
                        hitSlop={8}
                        onPress={onManageCalendars}
                        style={({ pressed }) => [styles.manageButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="settings-outline" size={16} color={colors.textSecondary} />
                    </Pressable>
                ) : null}
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.optionRow}
                keyboardShouldPersistTaps="handled"
            >
                {locked ? (
                    <CalendarOption
                        title={lockedTitle}
                        color={lockedColor}
                        selected
                        accent={accent}
                        disabled
                        onPress={() => undefined}
                    />
                ) : (
                    <>
                        <CalendarOption
                            title="개인 일정"
                            color={colors.textSecondary}
                            selected={value === null}
                            accent={accent}
                            onPress={() => onChange(null)}
                        />
                        {calendars.map((calendar) => (
                            <CalendarOption
                                key={calendar.id}
                                title={calendar.title}
                                color={calendar.color}
                                selected={calendar.id === value}
                                accent={accent}
                                onPress={() => onChange(calendar.id)}
                            />
                        ))}
                    </>
                )}
            </ScrollView>

            {locked ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>일정 작성자만 캘린더를 변경할 수 있어요.</Text>
            ) : loading ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>공유 캘린더를 불러오는 중...</Text>
            ) : error ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 캘린더 다시 불러오기"
                    onPress={onRetry}
                    disabled={!onRetry}
                    style={styles.retryRow}
                >
                    <Text style={[styles.hint, { color: colors.textSecondary }]}>{error}</Text>
                    {onRetry ? <Text style={[styles.retryText, { color: accent }]}>다시 시도</Text> : null}
                </Pressable>
            ) : selectedCalendar ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>이 캘린더는 {contentModeLabel(selectedCalendar)}로 공유돼요.</Text>
            ) : (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>나만 볼 수 있는 일정으로 저장해요.</Text>
            )}
        </View>
    );
}

function CalendarOption({
    title,
    color,
    selected,
    accent,
    disabled = false,
    onPress,
}: {
    title: string;
    color: string;
    selected: boolean;
    accent: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const { colors } = useTheme();

    return (
        <Pressable
            testID={disabled ? "schedule-calendar-assignment-locked" : undefined}
            accessibilityRole="radio"
            accessibilityLabel={disabled
                ? `${title}, 일정 작성자만 캘린더 변경 가능`
                : `${title} 캘린더 선택`}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.option,
                {
                    borderColor: selected ? accent : colors.border,
                    backgroundColor: selected ? `${accent}14` : colors.surface2,
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
        >
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text numberOfLines={1} style={[styles.optionText, { color: colors.textPrimary }]}>{title}</Text>
            {selected ? <Ionicons name="checkmark" size={15} color={accent} /> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: {
        marginBottom: 10,
    },
    header: {
        minHeight: 24,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    label: {
        fontSize: 12,
        fontWeight: "700",
    },
    manageButton: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    optionRow: {
        gap: 7,
        paddingVertical: 2,
        paddingRight: 6,
    },
    option: {
        height: 38,
        maxWidth: 176,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    optionText: {
        maxWidth: 124,
        fontSize: 12,
        fontWeight: "700",
    },
    hint: {
        marginTop: 4,
        fontSize: 11,
        fontWeight: "600",
    },
    retryRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    retryText: {
        marginTop: 4,
        fontSize: 11,
        fontWeight: "700",
    },
});

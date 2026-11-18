import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";

import type {
    ScheduleCalendarMember,
    ScheduleCalendarRole,
    ScheduleShareContentMode,
} from "../../api/scheduleCalendars";
import { useTheme } from "../../modules/theme/ThemeContext";
import styles from "./calendars.styles";

const BRAND_BLUE = "#2F80FF";
const CALENDAR_COLORS = [
    { color: BRAND_BLUE, name: "파랑" },
    { color: "#16A085", name: "청록" },
    { color: "#34C759", name: "초록" },
    { color: "#FF3B30", name: "빨강" },
    { color: "#AF52DE", name: "보라" },
    { color: "#FF9500", name: "주황" },
];
const SINGLE_COLOR_ROW_WIDTH = 304;

/** 캘린더 권한 코드를 멤버 목록에 표시할 짧은 한글 레이블로 변환합니다. */
export function roleLabel(role: ScheduleCalendarRole) {
    if (role === "OWNER") return "소유자";
    if (role === "EDITOR") return "편집";
    return "보기";
}

/** 미리 정의된 캘린더 색상을 단일 선택 라디오 목록으로 렌더링합니다. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const { colors, mode } = useTheme();
    const { width, fontScale } = useWindowDimensions();
    const [measuredWidth, setMeasuredWidth] = React.useState(0);
    const standardLayout = fontScale <= 1.35;
    const availableWidth = measuredWidth || width - 36;
    const groups = standardLayout && availableWidth < SINGLE_COLOR_ROW_WIDTH
        ? [CALENDAR_COLORS.slice(0, 3), CALENDAR_COLORS.slice(3)]
        : [CALENDAR_COLORS];
    const selectedName = CALENDAR_COLORS.find(option => option.color === value)?.name;
    return (
        <View
            style={standardLayout && styles.colorPicker}
            onLayout={standardLayout ? event => setMeasuredWidth(event.nativeEvent.layout.width) : undefined}
        >
            {standardLayout && <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                {selectedName ? `색상 · ${selectedName}` : "색상"}
            </Text>}
            {groups.map(group => (
                <View key={group[0].color} style={[styles.colorRow, standardLayout && styles.colorRowStandard]}>
                    {group.map(({ color, name }) => {
                        const selected = value === color;
                        return (
                            <Pressable
                                key={color}
                                accessibilityRole="radio"
                                accessibilityLabel={`${standardLayout ? name : color} 색상`}
                                accessibilityState={{ selected }}
                                onPress={() => onChange(color)}
                                style={[
                                    styles.colorButton,
                                    selected && styles.colorButtonSelected,
                                    selected && standardLayout && mode === "dark" && styles.colorButtonSelectedDark,
                                ]}
                            >
                                <View style={[styles.colorSwatch, { backgroundColor: color }]}>
                                    {selected && standardLayout && <Ionicons accessible={false} name="checkmark-outline" size={17} color="#111827" />}
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

/** 공유 캘린더에 일정만 포함할지 개인별 이동 경로까지 포함할지 선택하게 합니다. */
export function ContentModeControl({
    value,
    onChange,
    disabled = false,
    busy = false,
}: {
    value: ScheduleShareContentMode;
    onChange: (value: ScheduleShareContentMode) => void;
    disabled?: boolean;
    busy?: boolean;
}) {
    const { colors, mode } = useTheme();
    const largeText = useWindowDimensions().fontScale > 1.35;
    const accent = mode === "dark" ? "#8BB7FF" : BRAND_BLUE;
    return (
        <View style={[styles.modeControl, largeText && styles.modeControlStacked, { backgroundColor: colors.surface2 }]}>
            {([
                ["SCHEDULE_ONLY", "일정만", "calendar-outline"],
                ["SCHEDULE_AND_TRAVEL", "일정 + 각자 경로", "navigate-outline"],
            ] as const).map(([modeValue, label, icon]) => {
                const active = value === modeValue;
                return (
                    <Pressable
                        key={modeValue}
                        accessibilityRole="radio"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: active, disabled, busy }}
                        disabled={disabled}
                        onPress={() => onChange(modeValue)}
                        style={[styles.modeOption, largeText && styles.modeOptionStacked, active && { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                        <Ionicons accessible={false} name={icon} size={16} color={active ? accent : colors.textSecondary} />
                        <Text style={[styles.modeText, { color: active ? accent : colors.textSecondary }]} maxFontSizeMultiplier={1.8} lineBreakStrategyIOS="hangul-word">{label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/** 멤버 정보와 현재 사용자가 수행할 수 있는 권한 변경·이전·제거 작업을 한 행에 표시합니다. */
export function MemberRow({
    member,
    canManage,
    busy,
    onRoleChange,
    onRemove,
    onTransfer,
}: {
    member: ScheduleCalendarMember;
    canManage: boolean;
    busy: boolean;
    onRoleChange: (role: "VIEWER" | "EDITOR") => void;
    onRemove: () => void;
    onTransfer: () => void;
}) {
    const { colors } = useTheme();
    const largeText = useWindowDimensions().fontScale > 1.35;
    return (
        <View style={[styles.memberRow, largeText && styles.memberRowWrap, { borderBottomColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
                <Ionicons name={member.role === "OWNER" ? "key-outline" : "person-outline"} size={17} color={colors.textSecondary} />
            </View>
            <View style={styles.rowText}>
                <Text style={[styles.memberName, { color: colors.textPrimary }]} numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={1.8}>
                    {member.name || member.email || `회원 #${member.memberId}`}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={largeText ? undefined : 1} maxFontSizeMultiplier={1.8}>
                    {member.email || `NoLate ID #${member.memberId}`}
                </Text>
            </View>
            {canManage ? (
                <View style={[styles.memberActions, largeText && styles.memberActionsWrap]}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${roleLabel(member.role)} 권한 변경`}
                        disabled={busy}
                        onPress={() => onRoleChange(member.role === "EDITOR" ? "VIEWER" : "EDITOR")}
                        style={[styles.roleButton, { borderColor: colors.border }]}
                    >
                        <Text style={[styles.roleButtonText, { color: colors.textPrimary }]}>{roleLabel(member.role)}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="소유권 이전" onPress={onTransfer} disabled={busy} style={styles.smallIcon}>
                        <Ionicons name="key-outline" size={17} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="멤버 제거" onPress={onRemove} disabled={busy} style={styles.smallIcon}>
                        <Ionicons name="close-outline" size={18} color="#D70015" />
                    </Pressable>
                </View>
            ) : (
                <Text style={[styles.roleStatic, { color: colors.textSecondary }]}>{roleLabel(member.role)}</Text>
            )}
        </View>
    );
}

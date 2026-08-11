import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

import type {
    ScheduleCalendarMember,
    ScheduleCalendarRole,
    ScheduleShareContentMode,
} from "../../src/api/scheduleCalendars";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import styles from "./calendars.styles";

const BRAND_BLUE = "#2F80FF";
const CALENDAR_COLORS = ["#2F80FF", "#16A085", "#34C759", "#FF3B30", "#AF52DE", "#FF9500"];

/** 캘린더 권한 코드를 멤버 목록에 표시할 짧은 한글 레이블로 변환합니다. */
export function roleLabel(role: ScheduleCalendarRole) {
    if (role === "OWNER") return "소유자";
    if (role === "EDITOR") return "편집";
    return "보기";
}

/** 미리 정의된 캘린더 색상을 단일 선택 라디오 목록으로 렌더링합니다. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <View style={styles.colorRow}>
            {CALENDAR_COLORS.map((color) => (
                <Pressable
                    key={color}
                    accessibilityRole="radio"
                    accessibilityLabel={`${color} 색상`}
                    accessibilityState={{ selected: value === color }}
                    onPress={() => onChange(color)}
                    style={[styles.colorButton, value === color && styles.colorButtonSelected]}
                >
                    <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                </Pressable>
            ))}
        </View>
    );
}

/** 공유 캘린더에 일정만 포함할지 개인별 이동 경로까지 포함할지 선택하게 합니다. */
export function ContentModeControl({
    value,
    onChange,
    disabled = false,
}: {
    value: ScheduleShareContentMode;
    onChange: (value: ScheduleShareContentMode) => void;
    disabled?: boolean;
}) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#8BB7FF" : BRAND_BLUE;
    return (
        <View style={[styles.modeControl, { backgroundColor: colors.surface2 }]}>
            {([
                ["SCHEDULE_ONLY", "일정만", "calendar-outline"],
                ["SCHEDULE_AND_TRAVEL", "일정 + 각자 경로", "navigate-outline"],
            ] as const).map(([modeValue, label, icon]) => {
                const active = value === modeValue;
                return (
                    <Pressable
                        key={modeValue}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active, disabled }}
                        disabled={disabled}
                        onPress={() => onChange(modeValue)}
                        style={[styles.modeOption, active && { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                        <Ionicons name={icon} size={16} color={active ? accent : colors.textSecondary} />
                        <Text style={[styles.modeText, { color: active ? accent : colors.textSecondary }]} numberOfLines={2}>{label}</Text>
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
    return (
        <View style={[styles.memberRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
                <Ionicons name={member.role === "OWNER" ? "key-outline" : "person-outline"} size={17} color={colors.textSecondary} />
            </View>
            <View style={styles.rowText}>
                <Text style={[styles.memberName, { color: colors.textPrimary }]} numberOfLines={1}>
                    {member.name || member.email || `회원 #${member.memberId}`}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {member.email || `NoLate ID #${member.memberId}`}
                </Text>
            </View>
            {canManage ? (
                <View style={styles.memberActions}>
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
                        <Ionicons name="close" size={18} color="#D70015" />
                    </Pressable>
                </View>
            ) : (
                <Text style={[styles.roleStatic, { color: colors.textSecondary }]}>{roleLabel(member.role)}</Text>
            )}
        </View>
    );
}

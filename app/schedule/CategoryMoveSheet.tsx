import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ScheduleCalendar } from "../../src/api/scheduleCalendars";
import type {
    ScheduleCategoryItem,
    ScheduleCategoryMovePreview,
} from "../../src/api/scheduleCategories";
import {
    CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE,
    CATEGORY_MOVE_VISIBILITY_NOTICE,
    getCategoryMoveSummary,
} from "../../src/modules/schedule/categoryMove";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";

type Props = {
    visible: boolean;
    category: ScheduleCategoryItem | null;
    calendars: ScheduleCalendar[];
    selectedCalendarId: number | null;
    preview: ScheduleCategoryMovePreview | null;
    loadingCalendars: boolean;
    calendarError: string | null;
    loadingPreview: boolean;
    previewError: string | null;
    moving: boolean;
    mergeIntoExisting: boolean;
    onClose: () => void;
    onSelectCalendar: (calendarId: number) => void;
    onRetryCalendars: () => void;
    onRetryPreview: () => void;
    onChangeMerge: (merge: boolean) => void;
    onConfirm: () => void;
    onManageCalendars: () => void;
};

export default function CategoryMoveSheet({
    visible,
    category,
    calendars,
    selectedCalendarId,
    preview,
    loadingCalendars,
    calendarError,
    loadingPreview,
    previewError,
    moving,
    mergeIntoExisting,
    onClose,
    onSelectCalendar,
    onRetryCalendars,
    onRetryPreview,
    onChangeMerge,
    onConfirm,
    onManageCalendars,
}: Props) {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const accent = colors.selectedDayBg;
    const selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId);
    const mergeTarget = preview?.mergeTargetCategory;
    const busy = loadingPreview || moving;
    const canConfirm = Boolean(
        category
        && selectedCalendar
        && preview
        && !previewError
        && !busy
        && (!mergeTarget || mergeIntoExisting),
    );
    const summary = category && selectedCalendar && preview
        ? getCategoryMoveSummary({
            categoryTitle: category.title,
            calendarTitle: selectedCalendar.title,
            scheduleCount: preview.scheduleCount,
            mergeTargetTitle: mergeIntoExisting ? mergeTarget?.title : undefined,
        })
        : null;
    const travelVisibilityNotice = selectedCalendar?.defaultContentMode === "SCHEDULE_AND_TRAVEL"
        ? CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE
        : null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            presentationStyle="overFullScreen"
            onRequestClose={() => {
                if (!moving) onClose();
            }}
        >
            <View style={sheetStyles.overlay}>
                <Pressable
                    accessible={false}
                    disabled={moving}
                    onPress={onClose}
                    style={StyleSheet.absoluteFill}
                />
                <View
                    accessibilityViewIsModal
                    style={[
                        sheetStyles.sheet,
                        {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                        },
                    ]}
                >
                    <View style={sheetStyles.handle} />
                    <View style={sheetStyles.header}>
                        <View style={sheetStyles.headerCopy}>
                            <Text style={[sheetStyles.title, { color: colors.textPrimary }]}>다른 캘린더로 이동</Text>
                            <Text style={[sheetStyles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                                {category ? `“${category.title}” 카테고리의 이동 위치를 선택해 주세요.` : "이동 위치를 선택해 주세요."}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="카테고리 이동 닫기"
                            accessibilityState={{ disabled: moving }}
                            disabled={moving}
                            onPress={onClose}
                            style={({ pressed }) => [
                                sheetStyles.closeButton,
                                { backgroundColor: colors.surface2, opacity: moving ? 0.35 : pressed ? 0.6 : 1 },
                            ]}
                        >
                            <Ionicons accessible={false} name="close" size={22} color={colors.textPrimary} />
                        </Pressable>
                    </View>

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={sheetStyles.content}
                    >
                        <Text style={[sheetStyles.sectionLabel, { color: colors.textSecondary }]}>이동할 공유 캘린더</Text>
                        {loadingCalendars ? (
                            <View style={[sheetStyles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                                <BrandedLoader
                                    size="button"
                                    variant="schedule"
                                    accessibilityLabel="이동할 공유 캘린더를 불러오고 있어요"
                                />
                                <Text style={[sheetStyles.stateText, { color: colors.textSecondary }]}>공유 캘린더를 불러오고 있어요.</Text>
                            </View>
                        ) : calendarError ? (
                            <View
                                accessibilityRole="alert"
                                style={[sheetStyles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                            >
                                <Text style={[sheetStyles.stateText, { color: colors.textSecondary }]}>{calendarError}</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="이동할 공유 캘린더 다시 불러오기"
                                    onPress={onRetryCalendars}
                                    style={sheetStyles.inlineButton}
                                >
                                    <Text style={[sheetStyles.inlineButtonText, { color: accent }]}>다시 시도</Text>
                                </Pressable>
                            </View>
                        ) : calendars.length === 0 ? (
                            <View style={[sheetStyles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                                <Ionicons accessible={false} name="people-outline" size={25} color={colors.textSecondary} />
                                <Text style={[sheetStyles.stateTitle, { color: colors.textPrimary }]}>이동할 수 있는 공유 캘린더가 없어요</Text>
                                <Text style={[sheetStyles.stateText, { color: colors.textSecondary }]}>소유자 또는 편집자로 참여한 공유 캘린더가 필요합니다.</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="공유 캘린더 관리로 이동"
                                    onPress={onManageCalendars}
                                    style={[sheetStyles.manageButton, { borderColor: colors.border }]}
                                >
                                    <Text style={[sheetStyles.manageButtonText, { color: colors.textPrimary }]}>공유 캘린더 관리</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <View style={sheetStyles.optionList}>
                                {calendars.map((calendar) => {
                                    const selected = calendar.id === selectedCalendarId;
                                    return (
                                        <Pressable
                                            key={calendar.id}
                                            accessibilityRole="radio"
                                            accessibilityLabel={`${calendar.title} 공유 캘린더 선택`}
                                            accessibilityState={{ selected, disabled: busy }}
                                            disabled={busy}
                                            onPress={() => onSelectCalendar(calendar.id)}
                                            style={({ pressed }) => [
                                                sheetStyles.calendarOption,
                                                {
                                                    backgroundColor: selected ? `${accent}14` : colors.surface,
                                                    borderColor: selected ? accent : colors.border,
                                                    opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                                                },
                                            ]}
                                        >
                                            <View style={[sheetStyles.calendarDot, { backgroundColor: calendar.color }]} />
                                            <View style={sheetStyles.calendarCopy}>
                                                <Text style={[sheetStyles.calendarTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                                                    {calendar.title}
                                                </Text>
                                                <Text style={[sheetStyles.calendarMeta, { color: colors.textSecondary }]}>
                                                    {calendar.myRole === "OWNER" ? "내가 소유한 캘린더" : "편집 가능한 캘린더"}
                                                </Text>
                                            </View>
                                            {selected ? <Ionicons accessible={false} name="checkmark-circle" size={22} color={accent} /> : null}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        )}

                        {selectedCalendar ? (
                            <View style={sheetStyles.previewSection}>
                                <Text style={[sheetStyles.sectionLabel, { color: colors.textSecondary }]}>이동 내용</Text>
                                {loadingPreview ? (
                                    <View style={[sheetStyles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                                        <BrandedLoader
                                            size="button"
                                            variant="schedule"
                                            accessibilityLabel="카테고리 이동 내용을 확인하고 있어요"
                                        />
                                        <Text style={[sheetStyles.stateText, { color: colors.textSecondary }]}>포함된 일정을 확인하고 있어요.</Text>
                                    </View>
                                ) : previewError ? (
                                    <View
                                        accessibilityRole="alert"
                                        style={[sheetStyles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                                    >
                                        <Text style={[sheetStyles.stateText, { color: colors.textSecondary }]}>{previewError}</Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="카테고리 이동 내용 다시 확인하기"
                                            onPress={onRetryPreview}
                                            style={sheetStyles.inlineButton}
                                        >
                                            <Text style={[sheetStyles.inlineButtonText, { color: accent }]}>다시 시도</Text>
                                        </Pressable>
                                    </View>
                                ) : preview && summary ? (
                                    <View
                                        accessibilityLabel={`${summary} ${CATEGORY_MOVE_VISIBILITY_NOTICE}${travelVisibilityNotice ? ` ${travelVisibilityNotice}` : ""}`}
                                        style={[sheetStyles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                                    >
                                        <View style={sheetStyles.confirmTitleRow}>
                                            <Ionicons accessible={false} name="calendar-outline" size={21} color={accent} />
                                            <Text style={[sheetStyles.confirmTitle, { color: colors.textPrimary }]}>이동 내용을 확인해 주세요</Text>
                                        </View>
                                        <Text style={[sheetStyles.confirmText, { color: colors.textPrimary }]}>{summary}</Text>
                                        <View style={[sheetStyles.visibilityNotice, { backgroundColor: `${accent}10` }]}>
                                            <Ionicons accessible={false} name="people-outline" size={18} color={accent} />
                                            <Text style={[sheetStyles.visibilityText, { color: colors.textSecondary }]}>
                                                {CATEGORY_MOVE_VISIBILITY_NOTICE}
                                            </Text>
                                        </View>
                                        {travelVisibilityNotice ? (
                                            <View style={[sheetStyles.visibilityNotice, { backgroundColor: `${accent}10` }]}>
                                                <Ionicons accessible={false} name="navigate-outline" size={18} color={accent} />
                                                <Text style={[sheetStyles.visibilityText, { color: colors.textSecondary }]}>
                                                    {travelVisibilityNotice}
                                                </Text>
                                            </View>
                                        ) : null}

                                        {mergeTarget ? (
                                            <View style={sheetStyles.mergeOptions}>
                                                <Text style={[sheetStyles.mergeHeading, { color: colors.textPrimary }]}>같은 이름의 카테고리가 있어요</Text>
                                                <MergeOption
                                                    label={`기존 “${mergeTarget.title}”에 합치기`}
                                                    caption="같은 이름을 중복해서 만들 수 없어 기존 카테고리에 포함된 일정을 합칩니다."
                                                    selected={mergeIntoExisting}
                                                    disabled={busy}
                                                    accent={accent}
                                                    onPress={() => onChangeMerge(true)}
                                                />
                                            </View>
                                        ) : null}
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
                    </ScrollView>

                    {calendars.length > 0 ? (
                        <View
                            style={[
                                sheetStyles.footer,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: colors.background,
                                    paddingBottom: Math.max(insets.bottom, 22),
                                },
                            ]}
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="카테고리를 공유 캘린더로 이동"
                                accessibilityState={{ disabled: !canConfirm, busy: moving }}
                                disabled={!canConfirm}
                                onPress={onConfirm}
                                style={({ pressed }) => [
                                    sheetStyles.confirmButton,
                                    {
                                        backgroundColor: accent,
                                        opacity: !canConfirm ? 0.38 : pressed ? 0.76 : 1,
                                    },
                                ]}
                            >
                                {moving ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="schedule"
                                        accessibilityLabel="카테고리를 이동하고 있어요"
                                    />
                                ) : (
                                    <>
                                        <Text style={[sheetStyles.confirmButtonText, { color: colors.selectedDayText }]}>공유 캘린더로 이동</Text>
                                        <Ionicons accessible={false} name="arrow-forward" size={19} color={colors.selectedDayText} />
                                    </>
                                )}
                            </Pressable>
                        </View>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

function MergeOption({
    label,
    caption,
    selected,
    disabled,
    accent,
    onPress,
}: {
    label: string;
    caption: string;
    selected: boolean;
    disabled: boolean;
    accent: string;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                sheetStyles.mergeOption,
                {
                    borderColor: selected ? accent : colors.border,
                    backgroundColor: selected ? `${accent}10` : colors.surface2,
                    opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
                },
            ]}
        >
            <Ionicons
                accessible={false}
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={selected ? accent : colors.textSecondary}
            />
            <View style={sheetStyles.mergeCopy}>
                <Text style={[sheetStyles.mergeLabel, { color: colors.textPrimary }]}>{label}</Text>
                <Text style={[sheetStyles.mergeCaption, { color: colors.textSecondary }]}>{caption}</Text>
            </View>
        </Pressable>
    );
}

const sheetStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.48)",
    },
    sheet: {
        maxHeight: "88%",
        minHeight: 430,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        borderWidth: 1,
        overflow: "hidden",
    },
    handle: {
        width: 42,
        height: 5,
        borderRadius: 3,
        backgroundColor: "rgba(142,142,147,0.5)",
        alignSelf: "center",
        marginTop: 9,
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 13,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 14,
    },
    headerCopy: {
        flex: 1,
        gap: 5,
    },
    title: {
        fontSize: 21,
        fontWeight: "800",
    },
    subtitle: {
        fontSize: 13,
        lineHeight: 19,
        fontWeight: "600",
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    content: {
        paddingHorizontal: 20,
        paddingBottom: 20,
        gap: 10,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: "800",
        marginTop: 2,
    },
    optionList: {
        gap: 8,
    },
    calendarOption: {
        minHeight: 62,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    calendarDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    calendarCopy: {
        flex: 1,
        gap: 3,
    },
    calendarTitle: {
        fontSize: 15,
        fontWeight: "800",
    },
    calendarMeta: {
        fontSize: 11,
        fontWeight: "600",
    },
    previewSection: {
        gap: 9,
        marginTop: 8,
    },
    stateCard: {
        minHeight: 86,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
    },
    stateTitle: {
        fontSize: 15,
        fontWeight: "800",
        textAlign: "center",
    },
    stateText: {
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "600",
        textAlign: "center",
    },
    inlineButton: {
        minHeight: 34,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineButtonText: {
        fontSize: 13,
        fontWeight: "800",
    },
    manageButton: {
        minHeight: 40,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    manageButtonText: {
        fontSize: 13,
        fontWeight: "800",
    },
    confirmCard: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 15,
        gap: 12,
    },
    confirmTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    confirmTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: "800",
    },
    confirmText: {
        fontSize: 14,
        lineHeight: 21,
        fontWeight: "700",
    },
    visibilityNotice: {
        borderRadius: 11,
        padding: 11,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    visibilityText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "700",
    },
    mergeOptions: {
        gap: 7,
    },
    mergeHeading: {
        fontSize: 13,
        fontWeight: "800",
        marginBottom: 2,
    },
    mergeOption: {
        minHeight: 58,
        borderWidth: 1,
        borderRadius: 12,
        padding: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    mergeCopy: {
        flex: 1,
        gap: 2,
    },
    mergeLabel: {
        fontSize: 13,
        fontWeight: "800",
    },
    mergeCaption: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    footer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 22,
    },
    confirmButton: {
        height: 50,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    confirmButtonText: {
        fontSize: 15,
        fontWeight: "800",
    },
});

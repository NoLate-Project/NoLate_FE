import { Ionicons } from "@expo/vector-icons";
import React, { useRef } from "react";
import {
    AccessibilityInfo,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Animated, { Easing as ReanimatedEasing, FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ScheduleCalendar } from "../../api/scheduleCalendars";
import type {
    ScheduleCategoryItem,
    ScheduleCategoryMovePreview,
} from "../../api/scheduleCategories";
import { CATEGORY_MOVE_CALENDAR_AUDIENCE_NOTICE, CATEGORY_MOVE_SAME_NAME_NOTICE } from "../../modules/schedule/categoryMove";
import { contentModeLabel } from "../share/shareInboxModel";
import { useTheme } from "../../modules/theme/ThemeContext";
import BrandedLoader from "../../ui/BrandedLoader";
import { useSystemReduceMotion } from "../../modules/performance/useSystemReduceMotion";

const confirmationIn = FadeInDown.duration(160).easing(ReanimatedEasing.out(ReanimatedEasing.cubic)).withInitialValues({
    opacity: 0.62, transform: [{ translateY: 4 }],
}).reduceMotion(ReduceMotion.System);

type Props = {
    visible: boolean;
    category: ScheduleCategoryItem | null;
    sourceTitle: string;
    calendars: ScheduleCalendar[];
    selectedDestinationId: CategoryMoveDestinationId | null;
    preview: ScheduleCategoryMovePreview | null;
    loadingCalendars: boolean;
    calendarError: string | null;
    loadingPreview: boolean;
    previewError: string | null;
    moving: boolean;
    moveError: string | null;
    onDismiss: () => void;
    onClose: () => void;
    onSelectDestination: (destinationId: CategoryMoveDestinationId) => void;
    onRetryCalendars: () => void;
    onRetryPreview: () => void;
    onConfirm: () => void;
    onManageCalendars: () => void;
};

export type CategoryMoveDestinationId = number;

export default function CategoryMoveSheet({
    visible,
    category,
    sourceTitle,
    calendars,
    selectedDestinationId,
    preview,
    loadingCalendars,
    calendarError,
    loadingPreview,
    previewError,
    moving,
    moveError,
    onDismiss,
    onClose,
    onSelectDestination,
    onRetryCalendars,
    onRetryPreview,
    onConfirm,
    onManageCalendars,
}: Props) {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const reduceMotion = useSystemReduceMotion();
    const { fontScale } = useWindowDimensions();
    const largeText = fontScale > 1.35;
    const titleRef = useRef<Text>(null);
    const scrollRef = useRef<ScrollView>(null);
    const scrollContent = useRef<View>(null);
    const selectedGroup = useRef<View>(null);
    const scrollOffset = useRef(0);
    const viewportHeight = useRef(0);
    const pendingReveal = useRef<CategoryMoveDestinationId | null>(null);
    const isDark = mode === "dark";
    const accent = isDark ? "#8CB7FF" : "#2463DB";
    const neutral = isDark ? colors.surface2 : "#F1F5FA";
    const selectedCalendar = calendars.find(calendar => calendar.id === selectedDestinationId);
    const busy = loadingPreview || moving;
    const canConfirm = !!category && !!selectedCalendar && !!preview && !previewError && !busy;
    const categoryTitle = category?.title.trim();
    const confirmationLabel = categoryTitle && selectedCalendar
        ? `${categoryTitle}${categoryTitle.endsWith("카테고리") ? "" : " 카테고리"} 이동`
        : "이 캘린더로 이동";
    const destinationMemberCount = preview?.destinationCalendarMemberCount ?? selectedCalendar?.memberCount;
    const {
        retainedDirectShareCount, retainedDirectScheduleShareCount, sourceCalendarMemberCount,
        gainedAccessMemberCount, lostAccessMemberCount,
    } = preview ?? {};
    const audienceTotals = [
        category?.calendarId != null && sourceCalendarMemberCount !== undefined && `현재 ${sourceCalendarMemberCount}명`,
        destinationMemberCount !== undefined && `대상 캘린더 멤버 ${destinationMemberCount}명`,
    ].filter(Boolean).join(" · ");
    const accessDelta = [
        gainedAccessMemberCount ? `새로 보는 사람 ${gainedAccessMemberCount}명` : null,
        lostAccessMemberCount ? `접근이 끝나는 사람 ${lostAccessMemberCount}명` : null,
    ].filter(Boolean).join(" · ");
    const exactDeltaAvailable = gainedAccessMemberCount !== undefined && lostAccessMemberCount !== undefined;
    const showAudienceNotice = !exactDeltaAvailable && sourceCalendarMemberCount !== undefined && destinationMemberCount !== undefined;

    const revealReview = () => {
        const destinationId = selectedDestinationId;
        if (largeText || destinationId === null || pendingReveal.current !== destinationId) return;
        requestAnimationFrame(() => {
            const group = selectedGroup.current;
            const content = scrollContent.current;
            if (!group || !content) return;
            group.measureLayout(content, (_x, y, _width, groupHeight) => {
                const height = viewportHeight.current;
                if (pendingReveal.current !== destinationId || height <= 0) return;
                pendingReveal.current = null;
                const offset = scrollOffset.current;
                const margin = 8;
                const bottom = y + groupHeight;
                if (y >= offset && bottom <= offset + height) return;
                const target = y < offset
                    ? y - margin
                    : Math.min(y - margin, bottom + margin - height);
                scrollRef.current?.scrollTo({ y: Math.max(0, target), animated: !reduceMotion });
            });
        });
    };

    const confirmation = selectedCalendar ? (
        <View key={loadingPreview ? "loading" : selectedDestinationId}
            style={sheetStyles.previewSection}
            onLayout={loadingPreview ? undefined : revealReview}
        >
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
                        onPress={() => {
                            pendingReveal.current = selectedDestinationId;
                            onRetryPreview();
                        }}
                        style={sheetStyles.inlineButton}
                    >
                        <Text style={[sheetStyles.inlineButtonText, { color: accent }]}>다시 시도</Text>
                    </Pressable>
                </View>
            ) : preview ? (
                <Animated.View entering={confirmationIn} key={selectedDestinationId}
                    style={[sheetStyles.confirmCard, { backgroundColor: neutral, borderColor: colors.border }]}
                >
                    <Text accessibilityRole="header" style={[sheetStyles.confirmTitle, { color: colors.textPrimary }]}>이동 전 확인</Text>
                    <ImpactRow label="함께 이동할 일정" value={`${preview.scheduleCount}개`} />
                    <ImpactRow label="이동 후 공유 범위" value={contentModeLabel(selectedCalendar.defaultContentMode)}
                        detail={[audienceTotals, accessDelta].filter(Boolean).join("\n")} />
                    <ImpactRow label="기존 직접 공유"
                        value={retainedDirectScheduleShareCount
                            ? `일정 직접 공유 ${retainedDirectScheduleShareCount}건 유지`
                            : "기존 보기·편집 권한 유지"}
                        detail={retainedDirectShareCount === undefined ? undefined : `카테고리 직접 공유 ${retainedDirectShareCount}명`} />
                    {showAudienceNotice && (
                        <Text style={[sheetStyles.mergeCaption, { color: colors.textSecondary }]}>{CATEGORY_MOVE_CALENDAR_AUDIENCE_NOTICE}</Text>
                    )}
                    {preview.sameNameCategory && (
                        <Text style={[sheetStyles.mergeCaption, { color: colors.textSecondary }]}>{CATEGORY_MOVE_SAME_NAME_NOTICE}</Text>
                    )}
                </Animated.View>
            ) : null}
        </View>
    ) : null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType={reduceMotion ? "none" : "slide"}
            presentationStyle="overFullScreen"
            onDismiss={onDismiss}
            onShow={() => {
                scrollOffset.current = 0;
                pendingReveal.current = null;
                if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent?.(titleRef.current, "focus");
            }}
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
                    onAccessibilityEscape={onClose}
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
                        <Text ref={titleRef} accessible accessibilityRole="header" style={[sheetStyles.title, { color: colors.textPrimary }]}>
                            카테고리 이동
                        </Text>
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
                            <Ionicons accessible={false} name="close-outline" size={22} color={colors.textPrimary} />
                        </Pressable>
                    </View>

                    <ScrollView
                        ref={scrollRef}
                        innerViewRef={scrollContent as React.RefObject<View>}
                        style={sheetStyles.scroll}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={sheetStyles.content}
                        onLayout={event => { viewportHeight.current = event.nativeEvent.layout.height; }}
                        onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
                        onScrollBeginDrag={() => { pendingReveal.current = null; }}
                        scrollEventThrottle={16}
                    >
                        {category && (
                            <View style={[sheetStyles.source, { borderColor: colors.border }]}>
                                <Text style={[sheetStyles.sectionLabel, { color: colors.textSecondary }]}>이동할 카테고리</Text>
                                <View style={sheetStyles.sourceRow}>
                                    <View style={[sheetStyles.calendarDot, { backgroundColor: category.color }]} />
                                    <Text style={[sheetStyles.sourceTitle, { color: colors.textPrimary }]}>{category.title}</Text>
                                    <Text style={[sheetStyles.calendarMeta, { color: colors.textSecondary }]}>{sourceTitle}</Text>
                                </View>
                            </View>
                        )}
                        {(loadingCalendars || calendarError || calendars.length > 0) && (
                            <Text style={[sheetStyles.sectionLabel, { color: colors.textSecondary }]}>이동할 캘린더</Text>
                        )}
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
                                <Text style={[sheetStyles.stateTitle, { color: colors.textPrimary }]}>이동할 수 있는 캘린더가 없어요</Text>
                                <Text style={[sheetStyles.stateText, { color: colors.textSecondary }]}>다른 공유 캘린더의 소유자이거나 편집 권한이 있어야 해요.</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="공유 캘린더 관리로 이동"
                                    onPress={onManageCalendars}
                                    style={[sheetStyles.manageButton, { backgroundColor: neutral, borderColor: colors.border }]}
                                >
                                    <Text style={[sheetStyles.manageButtonText, { color: colors.textPrimary }]}>공유 캘린더 관리</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <View style={sheetStyles.optionList}>
                                {calendars.map((calendar) => {
                                    const selected = calendar.id === selectedDestinationId;
                                    const showInlineReview = selected && !largeText;
                                    const role = calendar.myRole === "OWNER" ? "내가 소유한 캘린더" : "편집 가능한 캘린더";
                                    return (
                                        <View
                                            key={calendar.id}
                                            ref={showInlineReview ? selectedGroup : undefined}
                                            collapsable={showInlineReview ? false : undefined}
                                        >
                                            <Pressable
                                                accessibilityRole="radio"
                                                accessibilityLabel={`${calendar.title}, ${role}`}
                                                accessibilityState={{ checked: selected, disabled: moving }}
                                                disabled={moving}
                                                onPress={() => {
                                                    if (!selected) pendingReveal.current = calendar.id;
                                                    onSelectDestination(calendar.id);
                                                }}
                                                style={({ pressed }) => [
                                                    sheetStyles.calendarOption,
                                                    {
                                                        backgroundColor: selected ? `${accent}14` : colors.surface,
                                                        borderColor: selected ? accent : colors.border,
                                                        opacity: pressed || moving ? 0.65 : 1,
                                                    },
                                                ]}
                                            >
                                                <View style={[sheetStyles.calendarDot, { backgroundColor: calendar.color }]} />
                                                <View style={sheetStyles.calendarCopy}>
                                                    <Text style={[sheetStyles.calendarTitle, { color: colors.textPrimary }]}>
                                                        {calendar.title}
                                                    </Text>
                                                    <Text style={[sheetStyles.calendarMeta, { color: colors.textSecondary }]}>
                                                        {role}
                                                    </Text>
                                                </View>
                                                {selected ? <Ionicons accessible={false} name="checkmark-circle-outline" size={22} color={accent} /> : null}
                                            </Pressable>
                                            {showInlineReview && confirmation}
                                        </View>
                                    );
                                })}
                            </View>
                        )}

                        {largeText && confirmation}
                    </ScrollView>

                    {!loadingCalendars && !calendarError && calendars.length > 0 ? (
                        <View
                            style={[
                                sheetStyles.footer,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: colors.background,
                                    paddingBottom: Math.max(insets.bottom - 16, 4),
                                },
                            ]}
                        >
                            {moveError && (
                                <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                                    style={[sheetStyles.actionError, { color: isDark ? "#FF9C96" : "#B42318" }]}>{moveError}</Text>
                            )}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={confirmationLabel}
                                accessibilityState={{ disabled: !canConfirm, busy: moving }}
                                disabled={!canConfirm}
                                onPress={onConfirm}
                                style={({ pressed }) => [
                                    sheetStyles.confirmButton,
                                    {
                                        backgroundColor: canConfirm || moving ? "#2463DB" : neutral,
                                        opacity: pressed ? 0.76 : 1,
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
                                        <Text style={[sheetStyles.confirmButtonText, { color: canConfirm ? "#FFF" : colors.textSecondary }]}>
                                            {confirmationLabel}
                                        </Text>
                                        {canConfirm && <Ionicons accessible={false} name="arrow-forward-outline" size={18} color="#FFF" />}
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

function ImpactRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
    const { colors } = useTheme();
    return (
        <View style={[sheetStyles.impactRow, { borderColor: colors.border }]}>
            <Text style={[sheetStyles.impactLabel, { color: colors.textSecondary }]}>{label}</Text>
            <View style={sheetStyles.impactValueColumn}>
                <Text style={[sheetStyles.impactValue, { color: colors.textPrimary }]}>{value}</Text>
                {!!detail && <Text style={[sheetStyles.mergeCaption, { color: colors.textSecondary }]}>{detail}</Text>}
            </View>
        </View>
    );
}

const sheetStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(15,23,42,0.38)",
    },
    sheet: {
        maxHeight: "90%",
        paddingBottom: 16,
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
        alignItems: "center",
        gap: 14,
    },
    title: {
        flex: 1,
        fontSize: 21,
        fontWeight: "800",
    },
    closeButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    scroll: { flexGrow: 0, flexShrink: 1 },
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
    source: { paddingBottom: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
    sourceRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    sourceTitle: { flexGrow: 1, flexShrink: 1, fontSize: 16, fontWeight: "800" },
    optionList: {
        gap: 8,
    },
    calendarOption: {
        minHeight: 62,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 9,
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
        minHeight: 44,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineButtonText: {
        fontSize: 13,
        fontWeight: "800",
    },
    manageButton: {
        minHeight: 44,
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
    confirmCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
    confirmTitle: { fontSize: 15, fontWeight: "800", marginBottom: 5 },
    impactRow: {
        flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 5,
        borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 7,
    },
    impactLabel: { flexBasis: "40%", flexGrow: 1, fontSize: 13, fontWeight: "700" },
    impactValueColumn: { flexBasis: "53%", flexGrow: 1, gap: 3 },
    impactValue: { fontSize: 13, fontWeight: "800" },
    mergeCaption: { fontSize: 12, fontWeight: "500" },
    actionError: { fontSize: 13, marginBottom: 8 },
    footer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 22,
    },
    confirmButton: {
        minHeight: 50,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    confirmButtonText: {
        flexShrink: 1,
        textAlign: "center",
        fontSize: 15,
        fontWeight: "800",
    },
});

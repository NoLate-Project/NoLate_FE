import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Calendar } from "react-native-calendars";
import { useReducedMotion } from "react-native-reanimated";
import "../components/calendar/calendarKoreanLocale";

import { BrandedLoadingState } from "../../../ui/BrandedLoader";
import CategoryLoadErrorBanner from "../components/form/CategoryLoadErrorBanner";
import CategoryPickerRow from "../components/form/CategorySelectBox";
import LocationInputRow from "../components/form/LocationInputRow";
import NotificationSettingsCard from "../components/form/NotificationSettingsCard";
import { ScheduleRouteDraftNotice } from "../components/form/ScheduleRouteDraftNotice";
import { getScheduleRouteCardScrollOffset } from "../components/form/scheduleRouteCardPosition";
import { scheduleFormCategoryManagerRoute, useCategoryManagementReturn } from "../components/form/useCategoryManagementReturn";
import ScheduleCalendarSelectBox from "../components/form/ScheduleCalendarSelectBox";
import { getWritableScheduleCategories } from "../categoryPermissions";
import { formatScheduleFormDate, startOfLocalScheduleDay } from "../scheduleFormDate";
import styles from "./ScheduleEditScreen.styles";
import { editDateText, hhmmText, mergeDateTime,
    type ScheduleEditScreenProps } from "./scheduleEditPresentation";
import { useScheduleEditScreen } from "./useScheduleEditScreen";

export { SCHEDULE_EDIT_DARK_PAGE_BACKGROUND } from "./scheduleEditPresentation";

/** 일정의 기본 정보·시간·경로·알림을 편집하는 화면을 렌더링합니다. */
export default function ScheduleEdit(props: ScheduleEditScreenProps) {
    const screen = useScheduleEditScreen(props);
    const { fontScale, height, width } = useWindowDimensions();
    const largeText = fontScale > 1.35;
    const reduceMotion = useReducedMotion();
    const categoryTriggerRef = useRef<View>(null);
    const openCategoryManagement = useCategoryManagementReturn(categoryTriggerRef, !screen.unavailable);
    const formOffsetRef = useRef(0);
    const routeButtonRef = useRef<React.ComponentRef<typeof Pressable>>(null);
    const routeSectionRef = useRef<View>(null);
    const handledRouteReturn = useRef<string | undefined>(undefined);
    const routeHighlight = useRef(new Animated.Value(0)).current;
    const routeReturn = screen.unavailable ? undefined : screen.routeReturn;
    const routeScrollRef = screen.unavailable ? undefined : screen.editScrollRef;
    const usesMultilineTitle = Platform.OS === "ios" && largeText;
    const [multilineTitleMounted, setMultilineTitleMounted] = useState(false);
    const titleFieldReady = !usesMultilineTitle || multilineTitleMounted;

    useEffect(() => {
        if (!usesMultilineTitle) setMultilineTitleMounted(false);
    }, [usesMultilineTitle]);

    useEffect(() => {
        if (!routeReturn || handledRouteReturn.current === routeReturn.sessionId) return;
        handledRouteReturn.current = routeReturn.sessionId;
        if (routeReturn.changed && !reduceMotion) {
            routeHighlight.setValue(0.65);
            Animated.timing(routeHighlight, { toValue: 0, duration: 160, useNativeDriver: true, isInteraction: false }).start();
        }
        let active = true;
        const frame = requestAnimationFrame(() => {
            const button = routeButtonRef.current;
            if (!button) return;
            const focus = () => {
                if (active && routeButtonRef.current === button) AccessibilityInfo.sendAccessibilityEvent?.(button, "focus");
            };
            const scroll = routeScrollRef?.current;
            const viewport = scroll?.getNativeScrollRef();
            const section = routeSectionRef.current;
            if (!routeReturn.changed || !scroll || !viewport || !section) {
                focus();
                return;
            }
            viewport.measureInWindow((_x, top, _w, viewportHeight) => {
                section.measureInWindow((_left, y, _width, sectionHeight) => {
                    if (!active || routeButtonRef.current !== button) return;
                    const current = formOffsetRef.current;
                    const target = getScheduleRouteCardScrollOffset(current, top, viewportHeight, y, sectionHeight);
                    if (target !== current) {
                        formOffsetRef.current = target;
                        scroll.scrollTo({ y: target, animated: false });
                        requestAnimationFrame(focus);
                    } else {
                        focus();
                    }
                });
            });
        });
        return () => {
            active = false;
            cancelAnimationFrame(frame);
            routeHighlight.stopAnimation();
            routeHighlight.setValue(0);
        };
    }, [reduceMotion, routeHighlight, routeReturn, routeScrollRef]);
    if (screen.unavailable) {
        const { loading, error, backgroundStyle, topInset, colors, requestClose, retry } = screen.unavailable;
        if (loading) {
            return (
                <View style={[styles.editLoadingRoot, backgroundStyle]}>
                    <BrandedLoadingState fill size="full" variant="schedule"
                        accessibilityLabel="수정할 일정을 불러오고 있어요" title="일정을 불러오고 있어요" />
                </View>
            );
        }
        return (
            <View style={[styles.editErrorRoot, backgroundStyle, { paddingTop: topInset + 16 }]}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary }}>
                    {error ?? "일정을 찾을 수 없어요."}
                </Text>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 16 }}>
                    <Pressable accessibilityRole="button" onPress={requestClose}>
                        <Text style={{ color: colors.textPrimary, fontWeight: "800" }}>돌아가기</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={retry}>
                        <Text style={{ color: colors.selectedDayBg, fontWeight: "800" }}>다시 시도</Text>
                    </Pressable>
                </View>
            </View>
        );
    }
    const { colors, mode, state, initialScrollToEnd, id, title, setTitle, notes, setNotes, titleFocused, setTitleFocused, notesFocused, setNotesFocused, categoryId, setCategoryId, categoryPickerOpen, categoryPickerClosing, originText, destinationText, travelMode, travelMinutes, allDay, hasEndTime, notificationEnabled, setNotificationEnabled, alertMode, setAlertMode, notificationLeadMinutes, setNotificationLeadMinutes, notificationIntervalMinutes, setNotificationIntervalMinutes, detailLoading, mutationPending, categoryLoading, categoryError, calendarId, setCalendarId, calendars, calendarLoading, calendarError, setCalendarRetryKey, startDay, endDay, startTime, endTime, picker, displayPicker, router, insets, fieldAccent, inactiveSwitchTrack, formPlaceholderColor, editPageBackgroundStyle, developmentPreview, canDeleteSchedule, canChangeCalendar, editScrollRef, initialScrollAppliedRef, markFormDirty, setCategoryPickerExpanded, closeCategoryPicker, toggleCategoryPicker, categoryPickerMarginBottom, categoryChevronRotation, requestCloseEditScreen, categoryOptions, writableCalendars, category, routeInfo, routeReady, retryCategoryLoad, handleEndTimeEnabledChange, handleAllDayChange, togglePicker, heightAnim, outerOpacity, contentFade, openRoutePlanner, clearRoute, onDayPress, onTimeChange, save, remove, calendarTheme, isDisplayDate, isDisplayTime, calendarSelected } = screen;
    const toggleCategoriesInForm = () => {
        toggleCategoryPicker();
        if (!largeText || categoryPickerOpen) return;
        categoryTriggerRef.current?.measureInWindow((_x, y, _width, triggerHeight) => {
            const roomForChoices = Math.min(250, Math.round(height * 0.33));
            const offset = y + triggerHeight + roomForChoices + insets.bottom - height;
            if (offset > 0) {
                editScrollRef.current?.scrollTo({ y: formOffsetRef.current + offset, animated: !reduceMotion });
            }
        });
    };
    const endTimeSwitch = (
        <Switch
            accessibilityLabel="종료 시간"
            accessibilityHint="켜면 종료 날짜와 시간을 설정합니다"
            value={hasEndTime}
            onValueChange={handleEndTimeEnabledChange}
            trackColor={{ false: inactiveSwitchTrack, true: fieldAccent }}
            thumbColor="#FFFFFF"
            style={styles.toggleSwitch}
        />
    );
    const endDateLabel = !largeText && allDay ? "마지막 날" : "종료 날짜";
    const dateFieldBackground = largeText ? "transparent" : colors.surface2;
    const selectedDateFieldBackground = mode === "dark" ? "rgba(75,157,255,0.12)" : "rgba(41,121,255,0.07)";
    return (
        <View
            testID="schedule-edit-root"
            style={[styles.editRoot, editPageBackgroundStyle]}
        >
        <View
            testID="schedule-edit-header"
            style={[
                styles.topHeader,
                editPageBackgroundStyle,
                {
                    borderBottomColor: colors.border,
                    paddingTop: insets.top + 6,
                },
            ]}
        >
            <View style={styles.pageContent}>
                <View testID="schedule-edit-navigation" style={styles.navigationHeader}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 수정 닫기"
                        onPress={requestCloseEditScreen}
                        style={({ pressed }) => [
                            styles.navigationBackButton,
                            {
                                backgroundColor: pressed
                                    ? mode === "dark"
                                        ? "rgba(255,255,255,0.08)"
                                        : "rgba(15,23,42,0.05)"
                                    : "transparent",
                                opacity: pressed ? 0.58 : 1,
                            },
                        ]}
                    >
                        <Ionicons accessible={false} name="chevron-back-outline" size={22} color={colors.textPrimary} />
                    </Pressable>
                    <Text
                        accessibilityRole="header"
                        maxFontSizeMultiplier={largeText ? 2.25 : undefined}
                        numberOfLines={largeText ? 1 : undefined}
                        style={[styles.navigationTitle, largeText && styles.navigationTitleLarge, { color: colors.textPrimary }]}
                    >일정 수정</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 수정 저장"
                        accessibilityState={{
                            disabled: detailLoading || mutationPending || !title.trim() || !category,
                            busy: mutationPending,
                        }}
                        disabled={detailLoading || mutationPending || !title.trim() || !category}
                        onPress={save}
                        style={({ pressed }) => [
                            styles.navigationSaveButton,
                            largeText && styles.navigationSaveButtonLarge,
                            {
                                opacity: detailLoading || mutationPending || !title.trim() || !category
                                    ? 0.34
                                    : pressed
                                        ? 0.55
                                        : 1,
                            },
                        ]}
                    >
                        <Text maxFontSizeMultiplier={largeText ? 2.5 : undefined} style={[styles.navigationSaveText, largeText && styles.navigationSaveTextLarge, { color: mode === "dark" ? "#4B9DFF" : "#2979FF" }]}>
                            {mutationPending ? "저장 중" : "저장"}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
        <ScrollView
            ref={editScrollRef}
            style={styles.editBody}
            contentContainerStyle={[
                styles.scrollContent,
                {
                    paddingBottom: Math.max(36, insets.bottom + 24),
                },
            ]}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios" && !largeText}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onScroll={({ nativeEvent }) => { formOffsetRef.current = nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
                if (!developmentPreview || !initialScrollToEnd || initialScrollAppliedRef.current) return;
                initialScrollAppliedRef.current = true;
                requestAnimationFrame(() => editScrollRef.current?.scrollToEnd({ animated: false }));
            }}
        >
            <View testID="schedule-edit-page" style={[styles.pageContent, styles.formPageContent]}>

            {categoryError ? (
                <CategoryLoadErrorBanner
                    retrying={categoryLoading}
                    onRetry={retryCategoryLoad}
                />
            ) : null}

            <ScheduleCalendarSelectBox
                calendars={writableCalendars}
                value={calendarId}
                loading={calendarLoading}
                error={calendarError}
                locked={!canChangeCalendar}
                optionWidth={largeText ? Math.max(160, width - 64) : undefined}
                onRetry={() => setCalendarRetryKey((value) => value + 1)}
                onChange={(nextCalendarId) => {
                    if (!canChangeCalendar || nextCalendarId === calendarId) return;
                    markFormDirty();
                    closeCategoryPicker();
                    setCalendarId(nextCalendarId);
                    const nextCategories = getWritableScheduleCategories(state.categories).filter((candidate) => (
                        (candidate.calendarId ?? null) === nextCalendarId
                    ));
                    setCategoryId(nextCategories[0]?.id ?? "");
                }}
                onManageCalendars={() => router.push("/schedule/calendars")}
            />

            {categoryPickerOpen || categoryPickerClosing ? (
                <Pressable
                    testID="schedule-edit-category-dismiss-layer"
                    accessible={categoryPickerOpen}
                    accessibilityRole="button"
                    accessibilityLabel="카테고리 선택 닫기"
                    onPress={closeCategoryPicker}
                    style={styles.categoryDismissLayer}
                />
            ) : null}

            <View style={styles.categorySection}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
                <View
                    testID="schedule-edit-title-field"
                    style={[
                        styles.titleInputWrap,
                        largeText && styles.titleInputWrapLarge,
                        {
                            borderWidth: largeText ? 0 : titleFocused ? 1 : StyleSheet.hairlineWidth,
                            borderColor: titleFocused ? fieldAccent : colors.border,
                            backgroundColor: largeText ? "transparent" : titleFocused ? colors.surface : colors.surface2,
                        },
                    ]}
                >
                    <TextInput
                        // iOS can drop these props when it replaces the native title field with a text view.
                        onLayout={titleFieldReady ? undefined : () => setMultilineTitleMounted(true)}
                        testID={titleFieldReady ? "schedule-edit-title-input" : undefined}
                        value={title}
                        onPressIn={closeCategoryPicker}
                        onFocus={() => setTitleFocused(true)}
                        onBlur={() => setTitleFocused(false)}
                        onChangeText={(value) => {
                            markFormDirty();
                            setTitle(value);
                        }}
                        accessibilityLabel={titleFieldReady ? "일정 제목" : undefined}
                        maxLength={120}
                        multiline={largeText}
                        lineBreakStrategyIOS="hangul-word"
                        submitBehavior="blurAndSubmit"
                        placeholder="예) 회의"
                        placeholderTextColor={formPlaceholderColor}
                        style={[
                            styles.titleInput,
                            largeText && styles.titleInputLarge,
                            largeText && {
                                borderWidth: titleFocused ? 1 : StyleSheet.hairlineWidth,
                                borderColor: titleFocused ? fieldAccent : colors.border,
                                backgroundColor: titleFocused ? colors.surface : colors.surface2,
                            },
                            { color: colors.textPrimary },
                        ]}
                    />
                    <Pressable
                        ref={categoryTriggerRef}
                        accessibilityRole="button"
                        accessibilityLabel={`카테고리 선택, 현재 ${category?.title ?? "없음"}`}
                        accessibilityState={{ expanded: categoryPickerOpen }}
                        onPress={toggleCategoriesInForm}
                        hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
                        style={({ pressed }) => [
                            styles.categoryInlineChip,
                            largeText && styles.categoryInlineChipLarge,
                            {
                                borderColor: categoryPickerOpen ? fieldAccent : colors.border,
                                opacity: pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        <View style={[styles.categoryInlineDot, { backgroundColor: category?.color ?? "#8E8E93" }]} />
                        <Text numberOfLines={largeText ? undefined : 1} style={[styles.categoryInlineText, { color: colors.textPrimary }]}>
                            {largeText && category ? `카테고리 · ${category.title}` : category?.title ?? "카테고리"}
                        </Text>
                        <Animated.View
                            testID="schedule-edit-category-chevron"
                            style={[
                                styles.categoryInlineChevron,
                                { transform: [{ rotate: categoryChevronRotation }] },
                            ]}
                        >
                            <Ionicons
                                accessible={false}
                                name="chevron-down-outline"
                                size={13}
                                color={categoryPickerOpen ? fieldAccent : colors.textSecondary}
                            />
                        </Animated.View>
                    </Pressable>
                </View>

                <Animated.View
                    testID="schedule-edit-category-picker-slot"
                    style={{ marginBottom: categoryPickerMarginBottom }}
                >
                    <CategoryPickerRow
                        categories={categoryOptions}
                        value={categoryId}
                        expanded={categoryPickerOpen}
                        hideTrigger
                        onExpandedChange={setCategoryPickerExpanded}
                        onChange={(nextCategoryId) => {
                            markFormDirty();
                            setCategoryId(nextCategoryId);
                            closeCategoryPicker();
                        }}
                        onManageCategories={() => openCategoryManagement(() => {
                            const selectedCalendar = calendars.find((candidate) => candidate.id === calendarId);
                            router.push(scheduleFormCategoryManagerRoute(calendarId, selectedCalendar?.title));
                        })}
                    />
                </Animated.View>
            </View>

            <Text style={[styles.label, { color: colors.textSecondary }]}>일시</Text>
            <View
                testID="schedule-edit-datetime-card"
                style={[
                    styles.dateTimeCard,
                    {
                        borderColor: colors.border,
                        backgroundColor: largeText ? colors.surface2 : colors.surface,
                    },
                ]}
            >
                <View style={styles.dateTimeToggleRow}>
                    <Text style={[styles.dateTimeRowTitle, { color: colors.textPrimary }]}>종일</Text>
                    <Switch
                        accessibilityLabel="종일 일정"
                        accessibilityHint="켜면 시간 없이 날짜만 설정합니다"
                        value={allDay}
                        onValueChange={handleAllDayChange}
                        trackColor={{ false: inactiveSwitchTrack, true: fieldAccent }}
                        thumbColor="#FFFFFF"
                        style={styles.toggleSwitch}
                    />
                </View>

                <View style={[styles.dateTimeDivider, { backgroundColor: colors.border }]} />

                <View testID="schedule-edit-start-row" style={[styles.dateTimeValueRow, largeText ? !allDay && styles.dateTimeValueRowLarge : styles.dateTimeFieldRow]}>
                    {!largeText && !allDay && (
                        <Text style={[styles.dateTimeRowTitle, styles.dateTimeFieldLabel, { color: colors.textPrimary }]}>시작</Text>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`시작 날짜 ${formatScheduleFormDate(startDay)}`}
                        accessibilityState={{ expanded: picker === "startDate" }}
                        onPress={() => togglePicker("startDate")}
                        style={({ pressed }) => [
                            styles.dateTimeDateAction,
                            largeText ? !allDay && styles.dateTimeDateActionLarge : styles.dateTimeDateActionInline,
                            !largeText && styles.dateTimeField,
                            {
                                backgroundColor: picker === "startDate" ? selectedDateFieldBackground : dateFieldBackground,
                                opacity: pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        {(largeText || allDay) && <Text style={[styles.dateTimeRowTitle, { color: colors.textPrimary }]}>시작</Text>}
                        <Text
                            lineBreakStrategyIOS="hangul-word"
                            style={[
                                largeText ? styles.dateTimeDateText : styles.dateTimeDateTextInline,
                                !largeText && styles.dateTimeFieldValue,
                                { color: largeText ? colors.textSecondary : colors.textPrimary },
                            ]}
                        >
                            {largeText ? editDateText(startDay) : formatScheduleFormDate(startDay)}
                        </Text>
                        {!largeText && <Ionicons accessible={false} name="calendar-outline" size={16} color={picker === "startDate" ? fieldAccent : colors.textSecondary} />}
                    </Pressable>
                    {!allDay ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`시작 시간 ${hhmmText(startTime)}`}
                            accessibilityState={{ expanded: picker === "startTime" }}
                            onPress={() => togglePicker("startTime")}
                            style={({ pressed }) => [
                                styles.dateTimeClockAction,
                                largeText ? styles.dateTimeClockActionLarge : styles.dateTimeClockField,
                                !largeText && styles.dateTimeField,
                                {
                                    backgroundColor: picker === "startTime" ? selectedDateFieldBackground : dateFieldBackground,
                                    opacity: pressed ? 0.62 : 1,
                                },
                            ]}
                        >
                            <Text style={[styles.dateTimeClockText, !largeText && styles.dateTimeClockFieldText, { color: colors.textPrimary }]}>{hhmmText(startTime)}</Text>
                            <Ionicons accessible={false} name={largeText ? "chevron-forward-outline" : "time-outline"} size={16} color={picker === "startTime" ? fieldAccent : colors.textSecondary} />
                        </Pressable>
                    ) : largeText ? (
                        <Ionicons accessible={false} name="chevron-forward-outline" size={16} color={colors.textSecondary} />
                    ) : null}
                </View>

                <View style={[styles.dateTimeDivider, { backgroundColor: colors.border }]} />

                {!largeText && !allDay && (
                    <View testID="schedule-edit-end-toggle-row" style={styles.dateTimeToggleRow}>
                        <Text style={[styles.dateTimeRowTitle, { color: colors.textPrimary }]}>종료 일시</Text>
                        {endTimeSwitch}
                    </View>
                )}
                {!largeText && !allDay && hasEndTime && <View style={[styles.dateTimeDivider, { backgroundColor: colors.border }]} />}

                {(largeText || allDay || hasEndTime) && <View testID="schedule-edit-end-row" style={[styles.dateTimeValueRow, largeText ? !allDay && styles.dateTimeValueRowLarge : styles.dateTimeFieldRow]}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${endDateLabel} ${formatScheduleFormDate(endDay)}`}
                        accessibilityState={{
                            disabled: !allDay && !hasEndTime,
                            expanded: picker === "endDate",
                        }}
                        disabled={!allDay && !hasEndTime}
                        onPress={() => togglePicker("endDate")}
                        style={({ pressed }) => [
                            styles.dateTimeDateAction,
                            largeText ? !allDay && styles.dateTimeDateActionLarge : styles.dateTimeDateActionInline,
                            !largeText && styles.dateTimeField,
                            {
                                backgroundColor: picker === "endDate" ? selectedDateFieldBackground : dateFieldBackground,
                                opacity: !allDay && !hasEndTime ? 0.55 : pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        {(!hasEndTime || allDay || largeText) && (
                            <Text style={[styles.dateTimeRowTitle, { color: colors.textPrimary }]}>
                                {!largeText && allDay ? "마지막 날" : "종료"}
                            </Text>
                        )}
                        <Text
                            lineBreakStrategyIOS="hangul-word"
                            style={[
                                largeText ? styles.dateTimeDateText : styles.dateTimeDateTextInline,
                                !largeText && styles.dateTimeFieldValue,
                                { color: largeText ? colors.textSecondary : colors.textPrimary },
                            ]}
                        >
                            {!allDay && !hasEndTime ? "설정 안 함" : largeText ? editDateText(endDay) : formatScheduleFormDate(endDay)}
                        </Text>
                        {!largeText && (allDay || hasEndTime) && (
                            <Ionicons accessible={false} name="calendar-outline" size={16} color={picker === "endDate" ? fieldAccent : colors.textSecondary} />
                        )}
                    </Pressable>
                    {allDay ? (
                        largeText && <Ionicons accessible={false} name="chevron-forward-outline" size={16} color={colors.textSecondary} />
                    ) : (
                        <View style={[styles.dateTimeEndControls, largeText ? styles.dateTimeEndControlsLarge : styles.dateTimeClockField]}>
                            {hasEndTime ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`종료 시간 ${hhmmText(endTime)}`}
                                    accessibilityState={{ expanded: picker === "endTime" }}
                                    onPress={() => togglePicker("endTime")}
                                    style={({ pressed }) => [
                                        styles.dateTimeClockAction,
                                        largeText && styles.dateTimeEndClockAction,
                                        largeText && styles.dateTimeClockActionLarge,
                                        !largeText && styles.dateTimeField,
                                        !largeText && styles.dateTimeFieldValue,
                                        {
                                            backgroundColor: picker === "endTime" ? selectedDateFieldBackground : dateFieldBackground,
                                            opacity: pressed ? 0.62 : 1,
                                        },
                                    ]}
                                >
                                    <Text style={[styles.dateTimeClockText, !largeText && styles.dateTimeClockFieldText, { color: colors.textPrimary }]}>{hhmmText(endTime)}</Text>
                                    <Ionicons
                                        accessible={false}
                                        name={largeText ? "chevron-forward-outline" : "time-outline"}
                                        size={16}
                                        color={picker === "endTime" ? fieldAccent : colors.textSecondary}
                                    />
                                </Pressable>
                            ) : null}
                            {largeText && endTimeSwitch}
                        </View>
                    )}
                </View>}
            </View>

            <Animated.View style={[styles.pickerContainer, {
                borderColor:  colors.border,
                backgroundColor: colors.surface2,
                maxHeight:    heightAnim,
                opacity:      outerOpacity,
                marginBottom: outerOpacity.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }),
            }]}>
                <Animated.View style={{ opacity: contentFade }}>
                    {isDisplayDate && (
                        <Calendar
                            key={`${mode}-${displayPicker}`}
                            testID="schedule-edit-date-picker"
                            current={calendarSelected}
                            renderHeader={month => (
                                <Text accessibilityRole="header" style={[styles.pickerMonthTitle, { color: colors.textPrimary }]}>
                                    {month?.toString("yyyy년 M월")}
                                </Text>
                            )}
                            onDayPress={onDayPress}
                            markedDates={{
                                [calendarSelected]: {
                                    selected: true,
                                    selectedColor:     colors.selectedDayBg,
                                    selectedTextColor: colors.selectedDayText,
                                },
                            }}
                            theme={calendarTheme}
                        />
                    )}
                    {isDisplayTime && (
                        <DateTimePicker
                            value={displayPicker === "startTime" ? startTime : endTime}
                            mode="time"
                            display={Platform.OS === "ios" ? "spinner" : "default"}
                            themeVariant={mode === "dark" ? "dark" : "light"}
                            is24Hour
                            onChange={onTimeChange}
                        />
                    )}
                </Animated.View>
            </Animated.View>

            <View ref={routeSectionRef} collapsable={false}>
                <LocationInputRow
                    originValue={originText}
                    destinationValue={destinationText}
                    travelMode={travelMode}
                    travelMinutes={travelMinutes}
                    routeInfo={routeInfo}
                    onPress={openRoutePlanner}
                    routeButtonRef={routeButtonRef}
                    highlightOpacity={routeHighlight}
                    variant="edit"
                    onClear={routeInfo ? clearRoute : undefined}
                    wrapTitle={largeText}
                    footer={<ScheduleRouteDraftNotice change={screen.routeDraftChange} color={colors.textSecondary} />}
                />
            </View>

            {!!routeInfo && (
                <NotificationSettingsCard
                    variant="flat"
                    routeReady={routeReady}
                    enabled={notificationEnabled}
                    alertMode={alertMode}
                    scheduleId={id}
                    leadMinutes={notificationLeadMinutes}
                    intervalMinutes={notificationIntervalMinutes}
                    routeInfo={routeInfo}
                    routePlannedArrivalAt={screen.routePlannedArrivalAt}
                    startAt={allDay
                        ? startOfLocalScheduleDay(startDay)
                        : mergeDateTime(startDay, startTime)}

                    onEnabledChange={(value) => { markFormDirty(); setNotificationEnabled(value); }}
                    onAlertModeChange={(value) => { markFormDirty(); setAlertMode(value); }}
                    onLeadMinutesChange={(value) => { markFormDirty(); setNotificationLeadMinutes(value); }}
                    onIntervalMinutesChange={(value) => { markFormDirty(); setNotificationIntervalMinutes(value); }}
                />
            )}

            <Text style={[styles.label, { color: colors.textSecondary }]}>메모</Text>
            <TextInput
                value={notes}
                onFocus={() => setNotesFocused(true)}
                onBlur={() => setNotesFocused(false)}
                onChangeText={(value) => {
                    markFormDirty();
                    setNotes(value);
                }}
                accessibilityLabel="일정 메모"
                multiline
                maxLength={2000}
                placeholder="메모 추가"
                placeholderTextColor={formPlaceholderColor}
                style={[
                    styles.input,
                    styles.notesInput,
                    {
                        borderWidth: notesFocused ? 1 : StyleSheet.hairlineWidth,
                        borderColor: notesFocused ? fieldAccent : colors.border,
                        backgroundColor: notesFocused ? colors.surface : colors.surface2,
                        color: colors.textPrimary,
                    },
                ]}
            />

            {canDeleteSchedule ? (
                <Pressable
                    testID="schedule-edit-delete-action"
                    accessibilityRole="button"
                    accessibilityLabel="일정 삭제"
                    accessibilityState={{ disabled: detailLoading || mutationPending, busy: mutationPending }}
                    disabled={detailLoading || mutationPending}
                    onPress={remove}
                    style={({ pressed }) => [
                        styles.deleteAction,
                        { opacity: detailLoading || mutationPending ? 0.4 : pressed ? 0.55 : 1 },
                    ]}
                >
                    <Ionicons accessible={false} name="trash-outline" size={17} color="#D9393E" />
                    <Text style={styles.deleteActionText}>일정 삭제</Text>
                </Pressable>
            ) : null}
            </View>
        </ScrollView>
        </View>
    );
}

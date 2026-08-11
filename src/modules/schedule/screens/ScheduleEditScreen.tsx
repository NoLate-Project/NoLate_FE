import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Calendar } from "react-native-calendars";

import { BrandedLoadingState } from "../../../ui/BrandedLoader";
import CategoryLoadErrorBanner from "../components/form/CategoryLoadErrorBanner";
import CategoryPickerRow from "../components/form/CategorySelectBox";
import LocationInputRow from "../components/form/LocationInputRow";
import NotificationSettingsCard from "../components/form/NotificationSettingsCard";
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
    const { colors, mode, state, initialScrollToEnd, id, title, setTitle, notes, setNotes, titleFocused, setTitleFocused, notesFocused, setNotesFocused, categoryId, setCategoryId, categoryPickerOpen, categoryPickerClosing, originText, destinationText, travelMode, travelMinutes, allDay, hasEndTime, notificationEnabled, setNotificationEnabled, alertMode, setAlertMode, notificationLeadMinutes, setNotificationLeadMinutes, notificationIntervalMinutes, setNotificationIntervalMinutes, subscriptionPolicy, detailLoading, mutationPending, categoryLoading, categoryError, calendarId, setCalendarId, calendars, calendarLoading, calendarError, setCalendarRetryKey, startDay, endDay, startTime, endTime, picker, displayPicker, router, insets, fieldAccent, inactiveSwitchTrack, formPlaceholderColor, editPageBackgroundStyle, developmentPreview, canDeleteSchedule, canChangeCalendar, editScrollRef, initialScrollAppliedRef, markFormDirty, setCategoryPickerExpanded, closeCategoryPicker, toggleCategoryPicker, categoryPickerMarginBottom, categoryChevronRotation, requestCloseEditScreen, categoryOptions, writableCalendars, category, routeInfo, routeReady, retryCategoryLoad, handleEndTimeEnabledChange, handleAllDayChange, togglePicker, heightAnim, outerOpacity, contentFade, openRoutePlanner, clearRoute, onDayPress, onTimeChange, save, remove, calendarTheme, isDisplayDate, isDisplayTime, calendarSelected } = screen;
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
                        <Ionicons accessible={false} name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                    <Text accessibilityRole="header" style={[styles.navigationTitle, { color: colors.textPrimary }]}>일정 수정</Text>
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
                            {
                                opacity: detailLoading || mutationPending || !title.trim() || !category
                                    ? 0.34
                                    : pressed
                                        ? 0.55
                                        : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.navigationSaveText, { color: mode === "dark" ? "#4B9DFF" : "#2979FF" }]}>
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
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
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
                        {
                            borderWidth: titleFocused ? 1 : StyleSheet.hairlineWidth,
                            borderColor: titleFocused ? fieldAccent : colors.border,
                            backgroundColor: titleFocused ? colors.surface : colors.surface2,
                        },
                    ]}
                >
                    <TextInput
                        value={title}
                        onPressIn={closeCategoryPicker}
                        onFocus={() => setTitleFocused(true)}
                        onBlur={() => setTitleFocused(false)}
                        onChangeText={(value) => {
                            markFormDirty();
                            setTitle(value);
                        }}
                        accessibilityLabel="일정 제목"
                        maxLength={120}
                        placeholder="예) 회의"
                        placeholderTextColor={formPlaceholderColor}
                        style={[styles.titleInput, { color: colors.textPrimary }]}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`카테고리 선택, 현재 ${category?.title ?? "없음"}`}
                        accessibilityState={{ expanded: categoryPickerOpen, disabled: categoryOptions.length === 0 }}
                        onPress={toggleCategoryPicker}
                        disabled={categoryOptions.length === 0}
                        hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
                        style={({ pressed }) => [
                            styles.categoryInlineChip,
                            {
                                borderColor: categoryPickerOpen ? fieldAccent : colors.border,
                                opacity: pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        <View style={[styles.categoryInlineDot, { backgroundColor: category?.color ?? "#8E8E93" }]} />
                        <Text numberOfLines={1} style={[styles.categoryInlineText, { color: colors.textPrimary }]}>
                            {category?.title ?? "카테고리"}
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
                                name="chevron-down"
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
                        onManageCategories={() => {
                            const selectedCalendar = calendars.find((candidate) => candidate.id === calendarId);
                            router.push(selectedCalendar ? {
                                pathname: "/schedule/categories",
                                params: {
                                    calendarId: String(selectedCalendar.id),
                                    calendarTitle: selectedCalendar.title,
                                },
                            } : "/schedule/categories");
                        }}
                    />
                </Animated.View>
            </View>

            <LocationInputRow
                originValue={originText}
                destinationValue={destinationText}
                travelMode={travelMode}
                travelMinutes={travelMinutes}
                routeInfo={routeInfo}
                onPress={openRoutePlanner}
                onClear={routeInfo ? clearRoute : undefined}
            />

            <Text style={[styles.label, { color: colors.textSecondary }]}>일시</Text>
            <View
                testID="schedule-edit-datetime-card"
                style={[
                    styles.dateTimeCard,
                    {
                        borderColor: colors.border,
                        backgroundColor: colors.surface2,
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

                <View testID="schedule-edit-start-row" style={styles.dateTimeValueRow}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`시작 날짜 ${formatScheduleFormDate(startDay)}`}
                        accessibilityState={{ expanded: picker === "startDate" }}
                        onPress={() => togglePicker("startDate")}
                        style={({ pressed }) => [
                            styles.dateTimeDateAction,
                            {
                                backgroundColor: picker === "startDate"
                                    ? mode === "dark" ? "rgba(75,157,255,0.12)" : "rgba(41,121,255,0.07)"
                                    : "transparent",
                                opacity: pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.dateTimeRowTitle, { color: colors.textPrimary }]}>시작</Text>
                        <Text style={[styles.dateTimeDateText, { color: colors.textSecondary }]}>
                            {editDateText(startDay)}
                        </Text>
                    </Pressable>
                    {!allDay ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`시작 시간 ${hhmmText(startTime)}`}
                            accessibilityState={{ expanded: picker === "startTime" }}
                            onPress={() => togglePicker("startTime")}
                            style={({ pressed }) => [
                                styles.dateTimeClockAction,
                                {
                                    backgroundColor: picker === "startTime"
                                        ? mode === "dark" ? "rgba(75,157,255,0.12)" : "rgba(41,121,255,0.07)"
                                        : "transparent",
                                    opacity: pressed ? 0.62 : 1,
                                },
                            ]}
                        >
                            <Text style={[styles.dateTimeClockText, { color: colors.textPrimary }]}>{hhmmText(startTime)}</Text>
                            <Ionicons accessible={false} name="chevron-forward" size={16} color={colors.textSecondary} />
                        </Pressable>
                    ) : (
                        <Ionicons accessible={false} name="chevron-forward" size={16} color={colors.textSecondary} />
                    )}
                </View>

                <View style={[styles.dateTimeDivider, { backgroundColor: colors.border }]} />

                <View testID="schedule-edit-end-row" style={styles.dateTimeValueRow}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`종료 날짜 ${formatScheduleFormDate(endDay)}`}
                        accessibilityState={{
                            disabled: !allDay && !hasEndTime,
                            expanded: picker === "endDate",
                        }}
                        disabled={!allDay && !hasEndTime}
                        onPress={() => togglePicker("endDate")}
                        style={({ pressed }) => [
                            styles.dateTimeDateAction,
                            {
                                backgroundColor: picker === "endDate"
                                    ? mode === "dark" ? "rgba(75,157,255,0.12)" : "rgba(41,121,255,0.07)"
                                    : "transparent",
                                opacity: !allDay && !hasEndTime ? 0.55 : pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.dateTimeRowTitle, { color: colors.textPrimary }]}>종료</Text>
                        <Text style={[styles.dateTimeDateText, { color: colors.textSecondary }]}>
                            {!allDay && !hasEndTime ? "설정 안 함" : editDateText(endDay)}
                        </Text>
                    </Pressable>
                    {allDay ? (
                        <Ionicons accessible={false} name="chevron-forward" size={16} color={colors.textSecondary} />
                    ) : (
                        <View style={styles.dateTimeEndControls}>
                            {hasEndTime ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`종료 시간 ${hhmmText(endTime)}`}
                                    accessibilityState={{ expanded: picker === "endTime" }}
                                    onPress={() => togglePicker("endTime")}
                                    style={({ pressed }) => [
                                        styles.dateTimeClockAction,
                                        styles.dateTimeEndClockAction,
                                        {
                                            backgroundColor: picker === "endTime"
                                                ? mode === "dark" ? "rgba(75,157,255,0.12)" : "rgba(41,121,255,0.07)"
                                                : "transparent",
                                            opacity: pressed ? 0.62 : 1,
                                        },
                                    ]}
                                >
                                    <Text style={[styles.dateTimeClockText, { color: colors.textPrimary }]}>{hhmmText(endTime)}</Text>
                                    <Ionicons
                                        accessible={false}
                                        name="chevron-forward"
                                        size={16}
                                        color={colors.textSecondary}
                                    />
                                </Pressable>
                            ) : null}
                            <Switch
                                accessibilityLabel="종료 시간"
                                accessibilityHint="켜면 종료 날짜와 시간을 설정합니다"
                                value={hasEndTime}
                                onValueChange={handleEndTimeEnabledChange}
                                trackColor={{ false: inactiveSwitchTrack, true: fieldAccent }}
                                thumbColor="#FFFFFF"
                                style={styles.toggleSwitch}
                            />
                        </View>
                    )}
                </View>
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
                            key={mode}
                            current={calendarSelected}
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
                    startAt={allDay
                        ? startOfLocalScheduleDay(startDay)
                        : mergeDateTime(startDay, startTime)}
                    policy={subscriptionPolicy}
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

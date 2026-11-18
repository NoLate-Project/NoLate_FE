import { Ionicons } from "@expo/vector-icons";
import React, { type Dispatch, type SetStateAction } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";

import { formatRouteClock, formatRouteDuration, isOdsayTimetableRouteInfo, roundRouteArrivalMinute } from "../../routeInfo";
import { SCHEDULE_ALERT_MODE_PRESENTATION } from "../../scheduleAlertMode";
import type { ScheduleAlertMode } from "../../types";
import { getQuickSchedulePreviewRouteInfo, hasQuickScheduleLocationChanged, type QuickSchedulePreviewDraft as PreviewDraft, type QuickSchedulePreviewField as PreviewField } from "../../quickScheduleDraft";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import AlarmSoundSettings from "./AlarmSoundSettings";
import { ScheduleRouteDraftNotice, type ScheduleRouteDraftChange } from "./ScheduleRouteDraftNotice";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  FIELD_LABEL,
  NOTIFICATION_OPTIONS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
  dateFromDraftTime,
  dateFromYmd,
  formatKoreanTime,
  toHm,
  toYmd,
  type TimeEditMode,
} from "./quickScheduleModalModel";

type EditColors = {
  border: string;
  inputPlaceholder: string;
  textPrimary: string;
  textSecondary: string;
};

type QuickScheduleEditStepProps = {
  colors: EditColors;
  editingAlertMode: ScheduleAlertMode;
  editingField: PreviewField;
  editingValue: string;
  inputBackground: string;
  mode: string;
  notificationRouteReady: boolean;
  routeDraftChange?: ScheduleRouteDraftChange;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenRoutePlanner: () => void;
  previewChevronColor: string;
  previewDividerColor: string;
  previewDraft: PreviewDraft;
  selectedModeBackground: string;
  setEditingAlertMode: Dispatch<SetStateAction<ScheduleAlertMode>>;
  setEditingValue: Dispatch<SetStateAction<string>>;
  setTimeEditMode: Dispatch<SetStateAction<TimeEditMode>>;
  timeEditMode: TimeEditMode;
  warningBackground: string;
  warningTextColor: string;
};

const notificationOptionsEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

function formatNotificationRouteClock(value: string | undefined, scheduleDay: string) {
  const clock = formatRouteClock(value);
  if (!value || !clock) return "시간 미정";
  const time = new Date(value);
  return toYmd(time) === scheduleDay ? clock : `${time.getMonth() + 1}월 ${time.getDate()}일 ${clock}`;
}

/** 미리보기에서 선택한 필드의 날짜·시간·장소·알림 편집 UI와 확인 동작을 표시한다. */
export function QuickScheduleEditStep({
  colors,
  editingAlertMode,
  editingField,
  editingValue,
  inputBackground,
  mode,
  notificationRouteReady,
  routeDraftChange,
  onCancel,
  onConfirm,
  onOpenRoutePlanner,
  previewChevronColor,
  previewDividerColor,
  previewDraft,
  selectedModeBackground,
  setEditingAlertMode,
  setEditingValue,
  setTimeEditMode,
  timeEditMode,
  warningBackground,
  warningTextColor,
}: QuickScheduleEditStepProps) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const isTextEdit = editingField === "title" || editingField === "memo";
  const isLocationEdit = editingField === "location";
  const clearsRoute = isLocationEdit && notificationRouteReady && hasQuickScheduleLocationChanged(previewDraft.location, editingValue);
  const locationRouteAction = notificationRouteReady && !clearsRoute ? "경로 변경" : "경로 찾기";
  const isNotificationEdit = editingField === "notification";
  const notificationNeedsRoute = isNotificationEdit && !notificationRouteReady;
  const notificationEnabled = isNotificationEdit && editingValue !== "none";
  const notificationRouteInfo = isNotificationEdit ? getQuickSchedulePreviewRouteInfo(previewDraft) : undefined;
  const departure = notificationRouteInfo?.departureTime;
  const arrival = isOdsayTimetableRouteInfo(notificationRouteInfo)
    ? roundRouteArrivalMinute(notificationRouteInfo?.arrivalTime)?.toISOString()
    : notificationRouteInfo?.arrivalTime;
  const scheduleStart = dateFromDraftTime(previewDraft.date, previewDraft.time);
  const arrivalMs = arrival ? new Date(arrival).getTime() : NaN;
  const hasDifferentArrival = Number.isFinite(arrivalMs)
    && Math.floor(arrivalMs / 60_000) !== Math.floor(scheduleStart.getTime() / 60_000);
  const routeTimeRows = [
    { label: "일정 시작", value: formatKoreanTime(previewDraft.time) },
    ...(hasDifferentArrival ? [{ label: "예상 도착", value: formatNotificationRouteClock(arrival, previewDraft.date) }] : []),
  ];
  const pickerDateValue = editingField === "date"
    ? dateFromYmd(editingValue || previewDraft.date)
    : dateFromDraftTime(previewDraft.date, editingValue || previewDraft.time);

  /** 네이티브 날짜·시간 선택 결과를 현재 필드 형식의 문자열로 변환한다. */
  const handlePickerChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) return;
    setEditingValue(editingField === "date" ? toYmd(selectedDate) : toHm(selectedDate));
  };

  return (
    <View style={styles.editStep}>
      {isTextEdit && (
        <TextInput
          value={editingValue}
          onChangeText={setEditingValue}
          multiline={editingField === "memo"}
          autoFocus
          placeholder={`${FIELD_LABEL[editingField]} 입력`}
          placeholderTextColor={colors.inputPlaceholder}
          selectionColor={BLUE}
          style={[styles.editInput, editingField === "memo" && styles.editInputMemo, { color: colors.textPrimary, backgroundColor: inputBackground, borderColor: previewDividerColor }]}
        />
      )}
      {isLocationEdit && (
        <View style={styles.routeEditPanel}>
          <Text style={[styles.locationEditLabel, { color: colors.textSecondary }]}>도착지</Text>
          <TextInput
            accessibilityLabel="빠른 일정 목적지"
            value={editingValue === "장소 미정" ? "" : editingValue}
            onChangeText={setEditingValue}
            autoFocus
            placeholder="목적지 입력"
            placeholderTextColor={colors.inputPlaceholder}
            selectionColor={BLUE}
            style={[styles.editInput, styles.locationEditInput, { color: colors.textPrimary, backgroundColor: inputBackground, borderColor: previewDividerColor }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={locationRouteAction}
            onPress={onOpenRoutePlanner}
            style={({ pressed }) => [styles.locationRouteAction, { borderBottomColor: previewDividerColor, opacity: pressed ? 0.72 : 1 }]}
          >
            <Ionicons accessible={false} name="navigate-outline" size={18} color={BLUE} />
            <Text style={[styles.locationRouteActionText, { color: colors.textPrimary }]}>{locationRouteAction}</Text>
            <Ionicons accessible={false} name="chevron-forward-outline" size={14} color={previewChevronColor} />
          </Pressable>
          {clearsRoute && (
            <View style={styles.locationEditHint}>
              <Ionicons accessible={false} name="information-circle-outline" size={16} color={warningTextColor} />
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.locationEditHintText, { color: warningTextColor }]}>
                {previewDraft.notificationLeadMinutes === undefined
                  ? "기존 경로가 해제돼요."
                  : "기존 경로와 출발 알림이 해제돼요."}
              </Text>
            </View>
          )}
        </View>
      )}
      {editingField === "time" && (
        <View style={[styles.editSegmented, { backgroundColor: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.045)" }]}>
          {(["picker", "manual"] as const).map(item => {
            const selected = timeEditMode === item;
            return (
              <Pressable key={item} onPress={() => setTimeEditMode(item)} accessibilityRole="radio" accessibilityLabel={item === "picker" ? "시간 선택" : "직접 입력"} accessibilityState={{ selected }} style={[styles.editSegment, selected && { backgroundColor: mode === "dark" ? "rgba(255,255,255,0.14)" : "#FFFFFF" }]}>
                <Text style={[styles.editSegmentText, { color: selected ? BLUE : colors.textSecondary }]}>{item === "picker" ? "시간 선택" : "직접 입력"}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {(editingField === "date" || (editingField === "time" && timeEditMode === "picker")) && (
        <View style={[styles.pickerPanel, { backgroundColor: inputBackground, borderColor: previewDividerColor }]}>
          <DateTimePicker value={pickerDateValue} mode={editingField === "date" ? "date" : "time"} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={handlePickerChange} locale="ko-KR" style={styles.dateTimePicker} />
          {editingField === "time" && (
            <View style={[styles.aiHint, { backgroundColor: warningBackground }]}>
              <Ionicons accessible={false} name="information-circle-outline" size={15} color={warningTextColor} />
              <Text style={[styles.aiHintText, { color: warningTextColor }]}>현재 선택: {formatKoreanTime(previewDraft.time)}</Text>
            </View>
          )}
        </View>
      )}
      {editingField === "time" && timeEditMode === "manual" && (
        <TextInput
          value={editingValue}
          onChangeText={setEditingValue}
          autoFocus
          placeholder="예) 오후 7:00"
          placeholderTextColor={colors.inputPlaceholder}
          selectionColor={BLUE}
          style={[styles.editInput, { color: colors.textPrimary, backgroundColor: inputBackground, borderColor: previewDividerColor }]}
        />
      )}
      {notificationNeedsRoute && (
        <ScrollView
          testID="quick-notification-no-route"
          style={styles.notificationEditor}
          contentContainerStyle={styles.notificationRouteRequired}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.notificationRouteIcon, { backgroundColor: selectedModeBackground }]}>
            <Ionicons accessible={false} name="navigate-outline" size={23} color={BLUE} />
          </View>
          <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.notificationRouteTitle, { color: colors.textPrimary }]}>
            출발 알림을 받으려면 경로가 필요해요
          </Text>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.notificationRouteBody, { color: colors.textSecondary }]}>
            경로를 설정하면 교통 상황에 맞춰 출발 시각을 알려드려요.
          </Text>
          <Text lineBreakStrategyIOS="hangul-word" style={[styles.notificationRouteBody, { color: colors.textSecondary }]}>
            경로 없이도 일정을 저장할 수 있어요.
          </Text>
        </ScrollView>
      )}
      {isNotificationEdit && notificationRouteReady && (
        <ScrollView testID="quick-notification-scroll" style={styles.notificationEditor} contentContainerStyle={styles.notificationEditorContent} showsVerticalScrollIndicator={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="빠른 일정 경로 변경"
            onPress={onOpenRoutePlanner}
            style={({ pressed }) => [styles.routeEditNotice, {
              backgroundColor: inputBackground,
              borderColor: previewDividerColor,
              minHeight: 44,
              opacity: pressed ? 0.72 : 1,
            }]}
          >
            <Ionicons accessible={false} name="pencil-outline" size={17} color={BLUE} />
            <Text style={[styles.routeEditNoticeText, { color: colors.textPrimary }]}>이동 경로 변경</Text>
            <Ionicons accessible={false} name="chevron-forward-outline" size={14} color={previewChevronColor} />
          </Pressable>
          <ScheduleRouteDraftNotice change={routeDraftChange} color={colors.textSecondary} />
          <View testID="quick-notification-time-summary" style={[styles.notificationHero, { backgroundColor: selectedModeBackground, borderColor: previewDividerColor }]}>
            <Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>추천 출발</Text>
            <Text
              lineBreakStrategyIOS="hangul-word"
              style={[styles.notificationDepartureTime, largeText && styles.notificationDepartureTimeLarge, { color: colors.textPrimary }]}
            >
              {formatNotificationRouteClock(departure, previewDraft.date)}
            </Text>
            <Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>
              {formatRouteDuration(notificationRouteInfo?.totalDurationMinutes)} 이동
            </Text>
            <View style={[styles.notificationRouteSummary, { borderTopColor: previewDividerColor }]}>
              {routeTimeRows.map(({ label, value }) => (
                <View key={label} style={[styles.notificationRouteMetric, largeText && styles.notificationRouteMetricLarge]}>
                  <Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>{label}</Text>
                  <Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>{value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.notificationControlCard, { backgroundColor: inputBackground, borderColor: previewDividerColor }]}>
            <View style={styles.notificationToggleRow}>
              <Text lineBreakStrategyIOS="hangul-word" style={[styles.notificationToggleTitle, { color: colors.textPrimary }]}>출발 알림</Text>
              <Switch accessibilityLabel="출발 알림 받기" accessibilityHint="실시간 교통 기반 출발 알림을 켜거나 끕니다" value={notificationEnabled} onValueChange={enabled => setEditingValue(enabled ? String(previewDraft.notificationLeadMinutes ?? 60) : "none")} trackColor={{ false: colors.border, true: BLUE }} ios_backgroundColor={colors.border} thumbColor="#FFFFFF" />
            </View>
            {notificationEnabled ? (
              <Animated.View entering={notificationOptionsEntry}>
                <Text lineBreakStrategyIOS="hangul-word" style={[styles.notificationToggleBody, { color: colors.textSecondary }]}>
                  교통 상황에 맞춰 출발 시각을 알려드려요.
                </Text>
                <View style={[styles.notificationLeadSection, { borderTopColor: previewDividerColor }]}>
                  <View style={[styles.notificationLeadHeading, largeText && styles.notificationLeadHeadingLarge]}><Text style={[styles.notificationLeadTitle, { color: colors.textPrimary }]}>교통 확인 시작</Text><Text style={[styles.notificationLeadCaption, { color: colors.textSecondary }]}>추천 출발 시각 기준</Text></View>
                  <View accessibilityRole="radiogroup" accessibilityLabel="교통 확인 시작 시점" style={[styles.notificationOptions, largeText && styles.notificationOptionsLarge]}>
                    {NOTIFICATION_OPTIONS.map(option => {
                      const selected = editingValue === option.value;
                      return (
                        <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`출발 ${option.label} 전부터 교통 확인`} accessibilityState={{ checked: selected }} onPress={() => setEditingValue(option.value)} style={({ pressed }) => [styles.notificationChip, largeText && styles.notificationChipLarge, { backgroundColor: selected ? selectedModeBackground : "transparent", borderColor: selected ? BLUE : previewDividerColor, opacity: pressed ? 0.72 : 1 }]}>
                          {selected && <Ionicons accessible={false} name="checkmark-circle-outline" size={15} color={BLUE} />}
                          <Text style={[styles.notificationChipText, { color: selected ? BLUE : colors.textPrimary }]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={[styles.notificationModeSection, { borderTopColor: previewDividerColor }]}>
                    <Text style={[styles.notificationLeadTitle, { color: colors.textPrimary }]}>알림 방식</Text>
                    <View accessibilityRole="radiogroup" accessibilityLabel="출발 알림 방식" style={styles.notificationModeOptions}>
                      {([{ value: "STANDARD", icon: "notifications-outline" }, { value: "ALARM", icon: "alarm-outline" }] as const).map(option => {
                        const checked = editingAlertMode === option.value;
                        const presentation = SCHEDULE_ALERT_MODE_PRESENTATION[option.value];
                        return (
                          <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={presentation.accessibilityLabel} accessibilityHint={presentation.description} accessibilityState={{ checked }} onPress={() => setEditingAlertMode(option.value)} style={({ pressed }) => [styles.notificationModeButton, { backgroundColor: checked ? selectedModeBackground : "transparent", borderColor: checked ? BLUE : previewDividerColor, opacity: pressed ? 0.72 : 1 }]}>
                            <View style={[styles.notificationModeIcon, { backgroundColor: checked ? BLUE : previewDividerColor }]}><Ionicons accessible={false} name={option.icon} size={17} color={checked ? "#FFFFFF" : colors.textSecondary} /></View>
                            <View style={styles.notificationModeCopy}><Text style={[styles.notificationModeText, { color: checked ? BLUE : colors.textPrimary }]}>{presentation.label}</Text><Text style={[styles.notificationModeDescription, { color: colors.textSecondary }]}>{presentation.description}</Text></View>
                            <Ionicons accessible={false} name={checked ? "checkmark-circle-outline" : "ellipse-outline"} size={20} color={checked ? BLUE : previewChevronColor} />
                          </Pressable>
                        );
                      })}
                    </View>
                    {editingAlertMode === "ALARM" && (
                      <View accessible accessibilityLabel="교통 상황이 바뀌면 푸시로 알려드려요" style={styles.notificationModeNote}><Ionicons accessible={false} name="notifications-outline" size={16} color={BLUE} /><Text style={[styles.notificationModeNoteText, { color: colors.textSecondary }]}>교통 상황이 바뀌면 푸시로 알려드려요.</Text></View>
                    )}
                    {(Platform.OS === "ios" || Platform.OS === "android") && (
                      <AlarmSoundSettings available={editingAlertMode === "ALARM"} flat />
                    )}
                  </View>
                </View>
              </Animated.View>
            ) : (
              <View style={[styles.notificationOffState, { borderTopColor: previewDividerColor }]}><Ionicons accessible={false} name="notifications-off-outline" size={17} color={colors.textSecondary} /><Text style={[styles.notificationOffText, { color: colors.textSecondary }]}>일정은 저장하고 출발 알림만 사용하지 않아요.</Text></View>
            )}
          </View>
        </ScrollView>
      )}
      <View style={[styles.editButtons, isNotificationEdit && largeText && styles.previewButtonsLarge]}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryButton, styles.editSecondaryButton, isNotificationEdit && largeText && styles.previewButtonLarge, { backgroundColor: "transparent", borderColor: previewDividerColor, opacity: pressed ? 0.72 : 1 }]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>{notificationNeedsRoute ? "건너뛰기" : "취소"}</Text>
        </Pressable>
        <Pressable
          onPress={notificationNeedsRoute ? onOpenRoutePlanner : onConfirm}
          accessibilityRole="button"
          accessibilityLabel={notificationNeedsRoute ? "빠른 일정 경로 설정" : clearsRoute ? "장소만 적용" : "수정 확인"}
          style={({ pressed }) => [styles.primaryButton, styles.editPrimaryButton, isNotificationEdit && largeText && styles.previewButtonLarge, { opacity: pressed ? 0.78 : 1 }]}
        >
          <Text style={styles.primaryButtonText}>{notificationNeedsRoute ? "경로 설정" : clearsRoute ? "장소만 적용" : "적용"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = createQuickScheduleModalStyles({
  BLUE,
  EXPANDED_CARD_RADIUS,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
});

import { Ionicons } from "@expo/vector-icons";
import React, { type Dispatch, type SetStateAction } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";

import { formatRouteClock, formatRouteDuration } from "../../routeInfo";
import { SCHEDULE_ALERT_MODE_PRESENTATION } from "../../scheduleAlertMode";
import type { ScheduleAlertMode } from "../../types";
import { getQuickSchedulePreviewRouteInfo, type QuickSchedulePreviewDraft as PreviewDraft, type QuickSchedulePreviewField as PreviewField } from "../../quickScheduleDraft";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
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
  formatNotification,
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
  successColor: string;
  timeEditMode: TimeEditMode;
  warningBackground: string;
  warningTextColor: string;
};

/** 미리보기에서 선택한 필드의 날짜·시간·장소·알림 편집 UI와 확인 동작을 표시한다. */
export function QuickScheduleEditStep({
  colors,
  editingAlertMode,
  editingField,
  editingValue,
  inputBackground,
  mode,
  notificationRouteReady,
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
  successColor,
  timeEditMode,
  warningBackground,
  warningTextColor,
}: QuickScheduleEditStepProps) {
  const isTextEdit = editingField === "title" || editingField === "memo";
  const isLocationEdit = editingField === "location";
  const isNotificationEdit = editingField === "notification";
  const notificationNeedsRoute = isNotificationEdit && !notificationRouteReady;
  const notificationEnabled = isNotificationEdit && editingValue !== "none";
  const notificationRouteInfo = isNotificationEdit ? getQuickSchedulePreviewRouteInfo(previewDraft) : undefined;
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
          <View style={[styles.routeEditNotice, { backgroundColor: inputBackground, borderColor: previewDividerColor }]}>
            <Ionicons accessible={false} name="location-outline" size={17} color={BLUE} />
            <Text style={[styles.routeEditNoticeText, { color: colors.textSecondary }]}>목적지만 바꿀 수 있어요. 이동 경로와 출발 알림은 알림에서 설정해 주세요.</Text>
          </View>
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
        <View style={styles.notificationRouteRequired}>
          <View style={[styles.notificationRouteIcon, { backgroundColor: selectedModeBackground }]}><Ionicons accessible={false} name="navigate-outline" size={26} color={BLUE} /></View>
          <Text style={[styles.notificationRouteTitle, { color: colors.textPrimary }]}>경로를 설정하면 출발 시각을 알려드려요</Text>
          <Text style={[styles.notificationRouteBody, { color: colors.textSecondary }]}>실시간 교통 상황을 확인하려면 출발지와 이동 경로가 필요해요.</Text>
          <View style={[styles.notificationFeatureList, { backgroundColor: inputBackground, borderColor: previewDividerColor }]}>
            <View style={styles.notificationFeatureRow}><Ionicons accessible={false} name="pulse-outline" size={17} color={BLUE} /><Text style={[styles.notificationFeatureText, { color: colors.textPrimary }]}>교통 변화에 맞춰 추천 출발 시각 계산</Text></View>
            <View style={[styles.notificationFeatureDivider, { backgroundColor: previewDividerColor }]} />
            <View style={styles.notificationFeatureRow}><Ionicons accessible={false} name="notifications-outline" size={17} color={BLUE} /><Text style={[styles.notificationFeatureText, { color: colors.textPrimary }]}>출발 준비부터 지금 출발할 때까지 안내</Text></View>
          </View>
          <View style={styles.notificationOptionalNotice}><Ionicons accessible={false} name="checkmark-circle" size={16} color={successColor} /><Text style={[styles.notificationOptionalText, { color: colors.textSecondary }]}>일정은 경로 없이도 저장할 수 있어요</Text></View>
        </View>
      )}
      {isNotificationEdit && notificationRouteReady && (
        <ScrollView style={styles.notificationEditor} contentContainerStyle={styles.notificationEditorContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.notificationHero, { backgroundColor: selectedModeBackground, borderColor: "rgba(36,107,254,0.21)" }]}>
            <View style={styles.notificationHeroHeader}>
              <View style={[styles.notificationHeroIcon, { backgroundColor: mode === "dark" ? "rgba(36,107,254,0.22)" : "rgba(255,255,255,0.76)" }]}><Ionicons accessible={false} name="navigate" size={20} color={BLUE} /></View>
              <View style={styles.notificationHeroText}><Text style={[styles.notificationHeroTitle, { color: colors.textPrimary }]}>실시간 교통을 반영해요</Text><Text style={[styles.notificationHeroBody, { color: colors.textSecondary }]}>이동 시간이 바뀌면 출발 시각을 다시 계산해 알려드려요.</Text></View>
            </View>
            <View style={[styles.notificationRouteSummary, { borderTopColor: "rgba(36,107,254,0.16)" }]}>
              {[
                ["추천 출발", formatRouteClock(notificationRouteInfo?.departureTime)],
                ["도착 예정", formatRouteClock(notificationRouteInfo?.arrivalTime)],
                ["예상 이동", formatRouteDuration(notificationRouteInfo?.totalDurationMinutes)],
              ].map(([label, value], index) => (
                <React.Fragment key={label}>
                  {index > 0 && <View style={[styles.notificationRouteMetricDivider, { backgroundColor: "rgba(36,107,254,0.16)" }]} />}
                  <View style={styles.notificationRouteMetric}><Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>{label}</Text><Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>{value}</Text></View>
                </React.Fragment>
              ))}
            </View>
          </View>

          <View style={[styles.notificationControlCard, { backgroundColor: inputBackground, borderColor: previewDividerColor }]}>
            <View style={styles.notificationToggleRow}>
              <View style={styles.notificationToggleText}><Text style={[styles.notificationToggleTitle, { color: colors.textPrimary }]}>출발 알림 받기</Text><Text style={[styles.notificationToggleBody, { color: colors.textSecondary }]}>교통 확인과 출발 안내를 켭니다</Text></View>
              <Switch accessibilityLabel="출발 알림 받기" accessibilityHint="실시간 교통 기반 출발 알림을 켜거나 끕니다" value={notificationEnabled} onValueChange={enabled => setEditingValue(enabled ? String(previewDraft.notificationLeadMinutes ?? 60) : "none")} trackColor={{ false: colors.border, true: BLUE }} ios_backgroundColor={colors.border} thumbColor="#FFFFFF" />
            </View>
            {notificationEnabled ? (
              <View style={[styles.notificationLeadSection, { borderTopColor: previewDividerColor }]}>
                <View style={styles.notificationLeadHeading}><Text style={[styles.notificationLeadTitle, { color: colors.textPrimary }]}>교통 확인 시작</Text><Text style={[styles.notificationLeadCaption, { color: colors.textSecondary }]}>추천 출발 시각 기준</Text></View>
                <View accessibilityRole="radiogroup" accessibilityLabel="교통 확인 시작 시점" style={styles.notificationOptions}>
                  {NOTIFICATION_OPTIONS.map(option => {
                    const selected = editingValue === option.value;
                    return (
                      <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`출발 ${option.label} 전부터 교통 확인`} accessibilityState={{ checked: selected }} onPress={() => setEditingValue(option.value)} style={({ pressed }) => [styles.notificationChip, { backgroundColor: selected ? selectedModeBackground : "transparent", borderColor: selected ? BLUE : previewDividerColor, opacity: pressed ? 0.72 : 1 }]}>
                        {selected && <Ionicons accessible={false} name="checkmark-circle" size={15} color={BLUE} />}
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
                          <Ionicons accessible={false} name={checked ? "checkmark-circle" : "ellipse-outline"} size={20} color={checked ? BLUE : previewChevronColor} />
                        </Pressable>
                      );
                    })}
                  </View>
                  {editingAlertMode === "ALARM" && (
                    <View accessible accessibilityLabel="교통 상황이 바뀌면 푸시로 알려드려요" style={styles.notificationModeNote}><Ionicons accessible={false} name="notifications-outline" size={16} color={BLUE} /><Text style={[styles.notificationModeNoteText, { color: colors.textSecondary }]}>교통 상황이 바뀌면 푸시로 알려드려요.</Text></View>
                  )}
                </View>
              </View>
            ) : (
              <View style={[styles.notificationOffState, { borderTopColor: previewDividerColor }]}><Ionicons accessible={false} name="notifications-off-outline" size={17} color={colors.textSecondary} /><Text style={[styles.notificationOffText, { color: colors.textSecondary }]}>일정은 저장하고 출발 알림만 사용하지 않아요.</Text></View>
            )}
          </View>
          {notificationEnabled && (
            <View style={styles.notificationBehaviorNote}><Ionicons accessible={false} name="information-circle-outline" size={17} color={BLUE} /><Text style={[styles.notificationBehaviorText, { color: colors.textSecondary }]}><Text style={[styles.notificationBehaviorStrong, { color: colors.textPrimary }]}>{formatNotification(Number(editingValue))}부터 확인해요. </Text>교통이 느려지면 바로, 출발 시간이 가까워지면 준비 알림을 보내드려요.</Text></View>
          )}
        </ScrollView>
      )}
      <View style={styles.editButtons}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.secondaryButton, styles.editSecondaryButton, { backgroundColor: "transparent", borderColor: previewDividerColor, opacity: pressed ? 0.72 : 1 }]}><Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>{notificationNeedsRoute ? "지금은 안 함" : "취소"}</Text></Pressable>
        <Pressable onPress={notificationNeedsRoute ? onOpenRoutePlanner : onConfirm} accessibilityRole="button" accessibilityLabel={notificationNeedsRoute ? "빠른 일정 경로 설정" : "수정 확인"} style={({ pressed }) => [styles.primaryButton, styles.editPrimaryButton, { opacity: pressed ? 0.78 : 1 }]}><Text style={styles.primaryButtonText}>{notificationNeedsRoute ? "경로 설정하기" : "적용"}</Text></Pressable>
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

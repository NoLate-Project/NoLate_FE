import { Ionicons } from "@expo/vector-icons";
import React, { type Dispatch, type SetStateAction } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";

import type { ScheduleCategory } from "../../types";
import {
  confirmQuickScheduleGlobalReview,
  getQuickScheduleBlockingReviewField,
  isQuickScheduleRouteReady as canUseRouteNotification,
  type QuickSchedulePreviewDraft as PreviewDraft,
  type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import CategoryPickerRow from "./CategorySelectBox";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  FIELD_LABEL,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
  type FlowStep,
} from "./quickScheduleModalModel";

type PreviewColors = {
  surface2: string;
  textDisabled: string;
  textPrimary: string;
  textSecondary: string;
};

type QuickSchedulePreviewStepProps = {
  colors: PreviewColors;
  getPreviewValue: (draft: PreviewDraft, field: PreviewField) => string;
  mode: string;
  onOpenEditField: (field: PreviewField) => void;
  onSave: () => void;
  previewCategoryChevronRotation: Animated.AnimatedInterpolation<string>;
  previewCategoryPickerMarginBottom: Animated.AnimatedInterpolation<number>;
  previewCategoryPickerOpen: boolean;
  previewCategoryPickerPaddingTop: Animated.AnimatedInterpolation<number>;
  previewChevronColor: string;
  previewDividerColor: string;
  previewDraft: PreviewDraft;
  previewIconBackground: string;
  previewLabelColor: string;
  previewSourceText: string;
  selectedCategory?: ScheduleCategory;
  selectedCategoryId: string;
  setFlowStep: Dispatch<SetStateAction<FlowStep>>;
  setPreviewCategoryPickerOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewDraft: Dispatch<SetStateAction<PreviewDraft | null>>;
  setSelectedCategoryId: Dispatch<SetStateAction<string>>;
  submitting: boolean;
  warningBackground: string;
  warningTextColor: string;
  writableCategories: ScheduleCategory[];
};

/** 분석된 일정의 핵심 필드, 카테고리와 저장 전 검토 상태를 한 화면에 표시한다. */
export function QuickSchedulePreviewStep({
  colors,
  getPreviewValue,
  mode,
  onOpenEditField,
  onSave,
  previewCategoryChevronRotation,
  previewCategoryPickerMarginBottom,
  previewCategoryPickerOpen,
  previewCategoryPickerPaddingTop,
  previewChevronColor,
  previewDividerColor,
  previewDraft,
  previewIconBackground,
  previewLabelColor,
  previewSourceText,
  selectedCategory,
  selectedCategoryId,
  setFlowStep,
  setPreviewCategoryPickerOpen,
  setPreviewDraft,
  setSelectedCategoryId,
  submitting,
  warningBackground,
  warningTextColor,
  writableCategories,
}: QuickSchedulePreviewStepProps) {
  const blockingReviewField = getQuickScheduleBlockingReviewField(previewDraft);

  /** 전체 검토 확인을 초안에 기록해 다음 저장 시 경고가 다시 막지 않도록 한다. */
  const confirmGlobalReview = () => {
    setPreviewDraft(current =>
      current ? confirmQuickScheduleGlobalReview(current) : current,
    );
  };

  /** 알림 경로가 없을 때는 분석 배지보다 경로 설정 안내를 우선 표시한다. */
  const getPreviewBadge = (field: PreviewField) =>
    field === "notification" && !canUseRouteNotification(previewDraft)
      ? "경로 설정 필요"
      : previewDraft.badges[field];

  /** 보조기기가 읽을 필드 값과 검토 배지를 하나의 문장으로 결합한다. */
  const getPreviewAccessibilityValue = (field: PreviewField) =>
    [getPreviewValue(previewDraft, field), getPreviewBadge(field)]
      .filter(Boolean)
      .join(", ");

  /** 지정 필드에 검토 배지가 있으면 경고 색상의 작은 라벨을 반환한다. */
  const renderPreviewBadge = (field: PreviewField) => {
    const badge = getPreviewBadge(field);
    if (!badge) return null;
    return (
      <View style={[styles.warningBadge, { backgroundColor: warningBackground }]}>
        <Text style={[styles.warningBadgeText, { color: warningTextColor }]}>{badge}</Text>
      </View>
    );
  };

  const primaryActionLabel = blockingReviewField
    ? blockingReviewField === "review"
      ? "확인했어요"
      : `${FIELD_LABEL[blockingReviewField]} 확인하기`
    : "일정 저장";
  const displayedSourceText = previewSourceText || "입력한 내용";
  const stackedDateTimeHitSlop = previewDraft.hasExplicitEndTime
    ? { top: 6, bottom: 6, left: 4, right: 4 }
    : undefined;

  /** 카테고리 선택을 닫고 최초 입력 단계에서 원문을 다시 수정하게 한다. */
  const editSourceText = () => {
    setPreviewCategoryPickerOpen(false);
    setFlowStep("input");
  };

  return (
    <View style={styles.previewStep}>
      <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewScrollContent} showsVerticalScrollIndicator={false}>
        <View testID="quick-schedule-preview-source-summary" style={[styles.previewSourceStrip, { borderBottomColor: previewDividerColor }]}>
          <View style={styles.previewSourceCopy}>
            <Text style={[styles.previewSourceLabel, { color: previewLabelColor }]}>입력한 내용</Text>
            <Text numberOfLines={1} style={[styles.previewSourceValue, { color: colors.textSecondary }]}>{displayedSourceText}</Text>
          </View>
        </View>

        <View style={styles.previewTitleRow}>
          <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.previewTitleMetaRow}>
            <Text style={[styles.previewLabel, styles.previewTitleMetaLabel, { color: previewLabelColor }]}>제목</Text>
            {renderPreviewBadge("title")}
          </View>
          <View testID="quick-schedule-preview-title-category-line" style={styles.previewTitleControlRow}>
            <Pressable
              onPress={() => onOpenEditField("title")}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="제목 수정"
              accessibilityValue={{ text: getPreviewAccessibilityValue("title") }}
              accessibilityState={{ disabled: submitting }}
              style={({ pressed }) => [styles.previewTitleAction, { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
            >
              <View style={styles.previewTitleValueRow}>
                <Text numberOfLines={1} style={[styles.previewTitleValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, "title")}</Text>
              </View>
            </Pressable>
            <Pressable
              testID="quick-schedule-preview-category-trigger"
              accessibilityRole="button"
              accessibilityLabel={`카테고리 선택, 현재 ${selectedCategory?.title ?? "없음"}`}
              accessibilityState={{ expanded: previewCategoryPickerOpen, disabled: submitting || writableCategories.length === 0 }}
              disabled={submitting || writableCategories.length === 0}
              hitSlop={{ top: 5, right: 4, bottom: 5, left: 4 }}
              onPress={() => setPreviewCategoryPickerOpen(current => !current)}
              style={({ pressed }) => [styles.previewCategoryInlineChip, { borderColor: previewCategoryPickerOpen ? mode === "dark" ? "#4B9DFF" : "#2979FF" : previewDividerColor, backgroundColor: colors.surface2, opacity: pressed ? 0.68 : submitting ? 0.42 : 1 }]}
            >
              <View accessible={false} style={[styles.previewCategoryInlineDot, { backgroundColor: selectedCategory?.color ?? colors.textDisabled }]} />
              <Text numberOfLines={1} style={[styles.previewCategoryInlineText, { color: colors.textPrimary }]}>{selectedCategory?.title ?? "카테고리"}</Text>
              <Animated.View testID="quick-schedule-preview-category-chevron" style={[styles.previewCategoryInlineChevron, { transform: [{ rotate: previewCategoryChevronRotation }] }]}>
                <Ionicons accessible={false} name="chevron-down" size={13} color={previewCategoryPickerOpen ? mode === "dark" ? "#4B9DFF" : "#2979FF" : colors.textSecondary} />
              </Animated.View>
            </Pressable>
          </View>
          <Animated.View testID="quick-schedule-preview-category-picker-slot" style={{ marginBottom: previewCategoryPickerMarginBottom, paddingTop: previewCategoryPickerPaddingTop }}>
            <CategoryPickerRow
              categories={writableCategories}
              value={selectedCategoryId}
              expanded={previewCategoryPickerOpen}
              hideTrigger
              onExpandedChange={setPreviewCategoryPickerOpen}
              onChange={nextCategoryId => {
                setSelectedCategoryId(nextCategoryId);
                setPreviewCategoryPickerOpen(false);
              }}
            />
          </Animated.View>
        </View>

        <View style={styles.previewInfoRow}>
          <View style={[styles.previewInfoIcon, { backgroundColor: previewIconBackground }]}><Ionicons accessible={false} name="calendar-outline" size={16} color={BLUE} /></View>
          <View style={styles.previewInfoCopy}>
            <Text style={[styles.previewLabel, { color: previewLabelColor }]}>일시</Text>
            <View testID="quick-schedule-preview-date-time" style={[styles.previewDateTimeValue, previewDraft.hasExplicitEndTime && styles.previewDateTimeValueStacked]}>
              <Pressable
                onPress={() => onOpenEditField("date")}
                disabled={submitting}
                hitSlop={stackedDateTimeHitSlop}
                accessibilityRole="button"
                accessibilityLabel="날짜 수정"
                accessibilityValue={{ text: getPreviewAccessibilityValue("date") }}
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [styles.previewInlineField, previewDraft.hasExplicitEndTime && styles.previewInlineFieldStacked, { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
              >
                <View style={styles.previewInlineContent}><Text style={[styles.previewInlineValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, "date")}</Text>{renderPreviewBadge("date")}</View>
              </Pressable>
              {!previewDraft.hasExplicitEndTime && <Text accessible={false} style={[styles.previewDateTimeSeparator, { color: previewLabelColor }]}>·</Text>}
              <Pressable
                onPress={() => onOpenEditField("time")}
                disabled={submitting}
                hitSlop={stackedDateTimeHitSlop}
                accessibilityRole="button"
                accessibilityLabel="시간 수정"
                accessibilityValue={{ text: getPreviewAccessibilityValue("time") }}
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [styles.previewInlineField, previewDraft.hasExplicitEndTime && styles.previewInlineFieldStacked, { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
              >
                <View style={styles.previewInlineContent}><Text style={[styles.previewInlineValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, "time")}</Text>{renderPreviewBadge("time")}</View>
              </Pressable>
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => onOpenEditField("location")}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="장소 수정"
          accessibilityValue={{ text: getPreviewAccessibilityValue("location") }}
          accessibilityState={{ disabled: submitting }}
          style={({ pressed }) => [styles.previewInfoRow, styles.previewPlaceRow, { borderTopColor: previewDividerColor, opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
        >
          <View style={[styles.previewInfoIcon, { backgroundColor: previewIconBackground }]}><Ionicons accessible={false} name="location-outline" size={16} color={BLUE} /></View>
          <View style={styles.previewInfoCopy}>
            <Text style={[styles.previewLabel, { color: previewLabelColor }]}>장소</Text>
            <View style={styles.previewInfoValueRow}><Text numberOfLines={1} style={[styles.previewInfoValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, "location")}</Text>{renderPreviewBadge("location")}</View>
          </View>
          <Ionicons accessible={false} name="chevron-forward" size={15} color={previewChevronColor} />
        </Pressable>

        <View style={[styles.previewOptional, { borderTopColor: previewDividerColor }]}>
          {(["notification", "memo"] as const).map((field, index) => (
            <React.Fragment key={field}>
              {index > 0 && <View style={[styles.previewOptionalDivider, { backgroundColor: previewDividerColor }]} />}
              <Pressable
                onPress={() => onOpenEditField(field)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={`${FIELD_LABEL[field]} 수정`}
                accessibilityValue={{ text: getPreviewAccessibilityValue(field) }}
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [styles.previewOptionalItem, field === "memo" && styles.previewOptionalItemTrailing, { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
              >
                <View style={styles.previewOptionalCopy}>
                  <Text style={[styles.previewLabel, { color: previewLabelColor }]}>{FIELD_LABEL[field]}</Text>
                  <View style={styles.previewOptionalValueRow}><Text numberOfLines={field === "memo" ? 2 : 1} style={[styles.previewOptionalValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, field)}</Text>{renderPreviewBadge(field)}</View>
                </View>
                <Ionicons accessible={false} name="chevron-forward" size={14} color={previewChevronColor} />
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      </ScrollView>
      <View testID="quick-schedule-preview-actions" style={styles.previewButtons}>
        <Pressable
          testID="quick-schedule-preview-edit-button"
          onPress={editSourceText}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="입력 내용 수정"
          accessibilityValue={{ text: displayedSourceText }}
          accessibilityHint="처음 입력한 문장을 다시 수정합니다"
          accessibilityState={{ disabled: submitting }}
          style={({ pressed }) => [styles.secondaryButton, styles.previewSecondaryButton, { backgroundColor: "transparent", borderColor: previewDividerColor, opacity: pressed ? 0.72 : submitting ? 0.42 : 1 }]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>수정</Text>
        </Pressable>
        <Pressable
          testID="quick-schedule-preview-primary-button"
          onPress={blockingReviewField === "review" ? confirmGlobalReview : blockingReviewField ? () => onOpenEditField(blockingReviewField) : onSave}
          accessibilityRole="button"
          accessibilityLabel={primaryActionLabel}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          disabled={submitting}
          style={({ pressed }) => [styles.primaryButton, styles.previewPrimaryButton, { opacity: pressed ? 0.78 : 1 }]}
        >
          <Text style={[styles.primaryButtonText, styles.previewPrimaryButtonText]}>{primaryActionLabel}</Text>
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

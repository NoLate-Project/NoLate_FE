import { Ionicons } from "@expo/vector-icons";
import React, { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";

import type { ScheduleCategory } from "../../types";
import {
  confirmQuickScheduleGlobalReview,
  getQuickScheduleBlockingReviewField,
  isQuickScheduleRouteReady as canUseRouteNotification,
  type QuickSchedulePreviewDraft as PreviewDraft,
  type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import CategoryPickerRow from "./CategorySelectBox";
import { ScheduleRouteDraftNotice, type ScheduleRouteDraftChange } from "./ScheduleRouteDraftNotice";
import { createQuickScheduleModalStyles } from "./QuickScheduleModal.styles";
import {
  BLUE,
  EXPANDED_CARD_RADIUS,
  FIELD_LABEL,
  QUICK_ANALYSIS_MOTION,
  VOICE_SPECTRUM_INNER_RADIUS,
  VOICE_SPECTRUM_SIZE,
} from "./quickScheduleModalModel";

type PreviewColors = {
  surface2: string;
  textDisabled: string;
  textPrimary: string;
  textSecondary: string;
};

type QuickSchedulePreviewStepProps = {
  animateDestinationNotice: boolean;
  colors: PreviewColors;
  getPreviewValue: (draft: PreviewDraft, field: PreviewField) => string;
  initialScrollY: number;
  returnFocusField: PreviewField | null;
  mode: string;
  onEditSource: () => void;
  onOpenEditField: (field: PreviewField) => void;
  onOpenRoutePlanner: () => void;
  onSave: () => void;
  onScrollPositionChange: (y: number, atEnd: boolean) => void;
  onToggleSource: () => void;
  previewCategoryChevronRotation: Animated.AnimatedInterpolation<string>;
  previewCategoryPickerMarginBottom: Animated.AnimatedInterpolation<number>;
  previewCategoryPickerOpen: boolean;
  previewCategoryPickerPaddingTop: Animated.AnimatedInterpolation<number>;
  previewDividerColor: string;
  previewDraft: PreviewDraft;
  destinationChanged?: { hadAlert: boolean };
  routeDraftChange?: ScheduleRouteDraftChange;
  previewIconBackground: string;
  previewLabelColor: string;
  previewSourceExpanded: boolean;
  previewSourceText: string;
  restoreEndAfterSaveError: boolean;
  saveFailed: boolean;
  selectedCategory?: ScheduleCategory;
  selectedCategoryId: string;
  setPreviewCategoryPickerOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewDraft: Dispatch<SetStateAction<PreviewDraft | null>>;
  setSelectedCategoryId: Dispatch<SetStateAction<string>>;
  submitting: boolean;
  warningBackground: string;
  warningTextColor: string;
  writableCategories: ScheduleCategory[];
};

const previewDetailEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const SOURCE_PREVIEW_REVEAL_HEIGHT = 96;
const LARGE_TEXT_SOURCE_PREVIEW_REVEAL_HEIGHT = 58;
const SAVE_ERROR_MESSAGE = "일정을 저장하지 못했어요.";

/** 분석된 일정의 핵심 필드, 카테고리와 저장 전 검토 상태를 한 화면에 표시한다. */
export function QuickSchedulePreviewStep({
  animateDestinationNotice,
  colors,
  getPreviewValue,
  initialScrollY,
  returnFocusField,
  mode,
  onEditSource,
  onOpenEditField,
  onOpenRoutePlanner,
  onSave,
  onScrollPositionChange,
  onToggleSource,
  previewCategoryChevronRotation,
  previewCategoryPickerMarginBottom,
  previewCategoryPickerOpen,
  previewCategoryPickerPaddingTop,
  previewDividerColor,
  previewDraft,
  destinationChanged,
  routeDraftChange,
  previewIconBackground,
  previewLabelColor,
  previewSourceExpanded,
  previewSourceText,
  restoreEndAfterSaveError,
  saveFailed,
  selectedCategory,
  selectedCategoryId,
  setPreviewCategoryPickerOpen,
  setPreviewDraft,
  setSelectedCategoryId,
  submitting,
  warningBackground,
  warningTextColor,
  writableCategories,
}: QuickSchedulePreviewStepProps) {
  const initialContentOffset = useRef({ x: 0, y: initialScrollY }).current;
  const animateSourceReveal = useRef(false);
  const previewScroll = useRef<ScrollView>(null);
  const previewViewportHeight = useRef(0);
  const previewContentHeight = useRef(0);
  const pendingEndRestore = useRef(restoreEndAfterSaveError);
  const previewScrollOffset = useRef(initialScrollY);
  const sourceToggleHeight = useRef(44);
  const focusField = useRef(returnFocusField).current;
  const focusTarget = useRef<View>(null);
  const largeText = useWindowDimensions().fontScale > 1.35;
  const reduceMotion = useSystemReduceMotion();
  useEffect(() => {
    if (!focusField || largeText) return;
    const timer = setTimeout(() => {
      if (focusTarget.current) AccessibilityInfo.sendAccessibilityEvent?.(focusTarget.current, "focus");
    }, reduceMotion ? 0 : QUICK_ANALYSIS_MOTION.previewFadeMs);
    return () => clearTimeout(timer);
  }, [focusField, largeText, reduceMotion]);
  const blockingReviewField = getQuickScheduleBlockingReviewField(previewDraft);
  const editIcon = <Ionicons accessible={false} name="pencil-outline" size={14} color={colors.textSecondary} />;

  /** 전체 검토 확인을 초안에 기록해 다음 저장 시 경고가 다시 막지 않도록 한다. */
  const confirmGlobalReview = () => {
    setPreviewDraft(current =>
      current ? confirmQuickScheduleGlobalReview(current) : current,
    );
  };

  /** 알림 경로가 없을 때는 분석 배지보다 경로 설정 안내를 우선 표시한다. */
  const getPreviewBadge = (field: PreviewField) => {
    if (field !== "notification" || canUseRouteNotification(previewDraft)) return previewDraft.badges[field];
    if (destinationChanged) return undefined;
    const alertRequested = previewDraft.notificationLeadMinutes !== undefined || previewDraft.parsed?.notificationEnabled === true;
    return largeText || alertRequested ? "경로 설정 필요" : undefined;
  };

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
    : saveFailed ? "다시 저장" : "일정 저장";

  useEffect(() => {
    if (saveFailed) AccessibilityInfo.announceForAccessibility(SAVE_ERROR_MESSAGE);
  }, [saveFailed]);

  const restorePreviewEnd = () => {
    if (!pendingEndRestore.current || !previewViewportHeight.current || !previewContentHeight.current) return;
    pendingEndRestore.current = false;
    previewScroll.current?.scrollToEnd({ animated: false });
  };

  return (
    <View style={styles.previewStep}>
      <ScrollView
        ref={previewScroll}
        testID="quick-preview-scroll"
        style={styles.previewScroll}
        contentContainerStyle={styles.previewScrollContent}
        contentOffset={initialContentOffset}
        onLayout={({ nativeEvent }) => {
          previewViewportHeight.current = nativeEvent.layout.height;
          restorePreviewEnd();
        }}
        onContentSizeChange={(_width, height) => {
          previewContentHeight.current = height;
          restorePreviewEnd();
        }}
        onScroll={({ nativeEvent }) => {
          previewScrollOffset.current = Math.max(0, nativeEvent.contentOffset.y);
          const remaining = nativeEvent.contentSize?.height - nativeEvent.layoutMeasurement?.height - previewScrollOffset.current;
          onScrollPositionChange(previewScrollOffset.current, Number.isFinite(remaining) && remaining <= 16);
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.previewTitleRow}>
          {getPreviewBadge("title") && (
            <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.previewTitleMetaRow}>
              {renderPreviewBadge("title")}
            </View>
          )}
          <View testID="quick-schedule-preview-title-category-line" style={[styles.previewTitleControlRow, largeText && styles.previewTitleControlRowLarge]}>
            <Pressable
              ref={focusField === "title" ? focusTarget : undefined}
              onPress={() => onOpenEditField("title")}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="제목 수정"
              accessibilityValue={{ text: getPreviewAccessibilityValue("title") }}
              accessibilityState={{ disabled: submitting }}
              style={({ pressed }) => [styles.previewTitleAction, largeText && styles.previewTitleActionLarge, { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
            >
              <View style={styles.previewTitleValueRow}>
                <Text numberOfLines={largeText ? undefined : 2} lineBreakStrategyIOS="hangul-word" style={[styles.previewTitleValue, largeText && styles.previewTitleValueLarge, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, "title")}</Text>
                {editIcon}
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
              style={({ pressed }) => [styles.previewCategoryInlineChip, largeText && styles.previewCategoryInlineChipLarge, { borderColor: previewCategoryPickerOpen ? mode === "dark" ? "#4B9DFF" : "#2979FF" : previewDividerColor, backgroundColor: colors.surface2, opacity: pressed ? 0.68 : submitting ? 0.42 : 1 }]}
            >
              <View accessible={false} style={[styles.previewCategoryInlineDot, { backgroundColor: selectedCategory?.color ?? colors.textDisabled }]} />
              <Text numberOfLines={largeText ? undefined : 1} lineBreakStrategyIOS="hangul-word" style={[styles.previewCategoryInlineText, largeText && styles.previewCategoryInlineTextLarge, { color: colors.textPrimary }]}>{largeText && selectedCategory ? `카테고리 · ${selectedCategory.title}` : selectedCategory?.title ?? "카테고리"}</Text>
              <Animated.View testID="quick-schedule-preview-category-chevron" style={[styles.previewCategoryInlineChevron, { transform: [{ rotate: previewCategoryChevronRotation }] }]}>
                <Ionicons accessible={false} name="chevron-down-outline" size={13} color={previewCategoryPickerOpen ? mode === "dark" ? "#4B9DFF" : "#2979FF" : colors.textSecondary} />
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

        <View style={[!largeText && styles.previewInfoRow, styles.previewPlaceRow, { borderTopColor: previewDividerColor }]}>
          {!largeText && (
            <View style={[styles.previewInfoIcon, { backgroundColor: previewIconBackground }]}>
              <Ionicons accessible={false} name="calendar-outline" size={16} color={BLUE} />
            </View>
          )}
          <View style={!largeText && styles.previewInfoCopy}>
            {!largeText && <Text style={[styles.previewLabel, { color: previewLabelColor }]}>일시</Text>}
            <View testID="quick-schedule-preview-date-time" style={styles.previewDateTimeValue}>
              {(["date", "time"] as const).map(field => (
                <Pressable
                  key={field}
                  ref={focusField === field ? focusTarget : undefined}
                  onPress={() => onOpenEditField(field)}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel={`${FIELD_LABEL[field]} 수정`}
                  accessibilityValue={{ text: getPreviewAccessibilityValue(field) }}
                  accessibilityState={{ disabled: submitting }}
                  style={({ pressed }) => [
                    styles.previewInlineField,
                    largeText && field === "time" && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: previewDividerColor },
                    { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 },
                  ]}
                >
                  <View style={largeText ? styles.previewInfoCopy : styles.previewInlineCopy}>
                    {largeText && <Text style={[styles.previewLabel, { color: previewLabelColor }]}>{FIELD_LABEL[field]}</Text>}
                    <View style={styles.previewInlineContent}>
                      <Text lineBreakStrategyIOS="hangul-word" style={[styles.previewInlineValue, { color: colors.textPrimary }]}>
                        {getPreviewValue(previewDraft, field)}
                      </Text>
                      {renderPreviewBadge(field)}
                    </View>
                  </View>
                  {editIcon}
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <Pressable
          ref={focusField === "location" ? focusTarget : undefined}
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
            <View style={styles.previewInfoValueRow}><Text numberOfLines={largeText ? undefined : 1} lineBreakStrategyIOS="hangul-word" style={[styles.previewInfoValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, "location")}</Text>{renderPreviewBadge("location")}</View>
          </View>
          {editIcon}
        </Pressable>

        {destinationChanged && (
          <Reanimated.View entering={animateDestinationNotice ? previewDetailEntry : undefined} style={[styles.previewRouteReset, { backgroundColor: colors.surface2 }]}>
            <Text accessibilityLiveRegion="polite" lineBreakStrategyIOS="hangul-word" style={[styles.previewRouteResetText, { color: colors.textSecondary }]}>
              {destinationChanged.hadAlert
                ? "장소가 바뀌어 이전 경로와 출발 알림을 해제했어요."
                : "장소가 바뀌어 이전 경로를 해제했어요."}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="새 경로 설정"
              disabled={submitting}
              onPress={onOpenRoutePlanner}
              style={({ pressed }) => [styles.previewRouteResetAction, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={[styles.previewRouteResetActionText, { color: colors.textPrimary }]}>새 경로 설정</Text>
              <Ionicons accessible={false} name="chevron-forward-outline" size={15} color={colors.textSecondary} />
            </Pressable>
          </Reanimated.View>
        )}
        {canUseRouteNotification(previewDraft) && (
          <ScheduleRouteDraftNotice change={routeDraftChange} color={colors.textSecondary} />
        )}
        <View style={[styles.previewOptional, { borderTopColor: previewDividerColor }]}>
          {(["notification", "memo"] as const).map((field, index) => (
            <React.Fragment key={field}>
              {index > 0 && <View style={[styles.previewOptionalDivider, { backgroundColor: previewDividerColor }]} />}
              <Pressable
                ref={focusField === field ? focusTarget : undefined}
                onPress={() => onOpenEditField(field)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={`${FIELD_LABEL[field]} 수정`}
                accessibilityValue={{ text: getPreviewAccessibilityValue(field) }}
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [styles.previewOptionalItem, field === "memo" && styles.previewOptionalItemTrailing, { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 }]}
              >
                <View style={[styles.previewInfoIcon, { backgroundColor: previewIconBackground }]}>
                  <Ionicons accessible={false} name={field === "notification" ? "notifications-outline" : "document-text-outline"} size={16} color={BLUE} />
                </View>
                <View style={styles.previewOptionalCopy}>
                  <Text style={[styles.previewLabel, { color: previewLabelColor }]}>{field === "notification" ? "출발 알림" : FIELD_LABEL[field]}</Text>
                  <View style={styles.previewOptionalValueRow}><Text numberOfLines={field === "memo" ? 2 : 1} style={[styles.previewOptionalValue, { color: colors.textPrimary }]}>{getPreviewValue(previewDraft, field)}</Text>{renderPreviewBadge(field)}</View>
                </View>
                {editIcon}
              </Pressable>
            </React.Fragment>
          ))}
        </View>
        {!!previewSourceText.trim() && (
          <View
            testID="quick-schedule-preview-source-section"
            style={[styles.previewSourceSection, { borderTopColor: previewDividerColor }]}
            onLayout={({ nativeEvent }) => {
              if (!previewSourceExpanded || !animateSourceReveal.current || previewViewportHeight.current <= 0) return;
              animateSourceReveal.current = false;
              const { y, height } = nativeEvent.layout;
              const revealHeight = largeText ? LARGE_TEXT_SOURCE_PREVIEW_REVEAL_HEIGHT : SOURCE_PREVIEW_REVEAL_HEIGHT;
              const firstLinesBottom = y + Math.min(height, sourceToggleHeight.current + revealHeight);
              const target = firstLinesBottom + 4 - previewViewportHeight.current;
              if (target > previewScrollOffset.current) {
                previewScroll.current?.scrollTo({ y: target, animated: !reduceMotion });
              }
            }}
          >
            <Pressable
              onLayout={({ nativeEvent }) => { sourceToggleHeight.current = nativeEvent.layout.height; }}
              testID="quick-schedule-preview-source-summary"
              onPress={() => {
                animateSourceReveal.current = !previewSourceExpanded;
                onToggleSource();
              }}
              accessibilityRole="button"
              accessibilityLabel="입력한 내용"
              accessibilityState={{ expanded: previewSourceExpanded }}
              style={({ pressed }) => [styles.previewSourceToggle, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.previewSourceLabel, { color: colors.textSecondary }]}>입력한 내용</Text>
              <Ionicons
                accessible={false}
                name={previewSourceExpanded ? "chevron-up-outline" : "chevron-down-outline"}
                size={16}
                color={colors.textSecondary}
              />
            </Pressable>
            {previewSourceExpanded && (
              <Reanimated.View entering={animateSourceReveal.current ? previewDetailEntry : undefined} style={[styles.previewSourceBody, { backgroundColor: colors.surface2 }]}>
                <Text
                  testID="quick-schedule-preview-source-text"
                  lineBreakStrategyIOS="hangul-word"
                  style={[styles.previewSourceValue, { color: colors.textSecondary }]}
                >
                  {previewSourceText}
                </Text>
              </Reanimated.View>
            )}
          </View>
        )}
      </ScrollView>
      {saveFailed && (
        <Text
          testID="quick-schedule-save-error"
          accessibilityLiveRegion="polite"
          style={[styles.previewSaveError, { backgroundColor: warningBackground, color: warningTextColor }]}
        >
          {SAVE_ERROR_MESSAGE}
        </Text>
      )}
      <View testID="quick-schedule-preview-actions" style={[styles.previewButtons, largeText && styles.previewButtonsLarge]}>
        <Pressable
          testID="quick-schedule-preview-edit-button"
          onPress={onEditSource}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="입력 내용 수정"
          accessibilityState={{ disabled: submitting }}
          style={({ pressed }) => [styles.secondaryButton, styles.previewSecondaryButton, largeText && styles.previewButtonLarge, { backgroundColor: "transparent", borderColor: previewDividerColor, opacity: pressed ? 0.72 : submitting ? 0.42 : 1 }]}
        >
          <Text maxFontSizeMultiplier={largeText ? 2.35 : undefined} style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>입력 수정</Text>
        </Pressable>
        <Pressable
          testID="quick-schedule-preview-primary-button"
          onPress={blockingReviewField === "review" ? confirmGlobalReview : blockingReviewField ? () => onOpenEditField(blockingReviewField) : onSave}
          accessibilityRole="button"
          accessibilityLabel={primaryActionLabel}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          disabled={submitting}
          style={({ pressed }) => [styles.primaryButton, styles.previewPrimaryButton, largeText && styles.previewButtonLarge, { opacity: pressed ? 0.78 : 1 }]}
        >
          <Text maxFontSizeMultiplier={largeText ? 2.35 : undefined} style={[styles.primaryButtonText, styles.previewPrimaryButtonText]}>{primaryActionLabel}</Text>
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

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Reanimated, { useReducedMotion } from 'react-native-reanimated';
import styles from './ScheduleAddModal.styles';

import LoadingIndicator from '../../../../ui/LoadingIndicator';
import { startOfLocalScheduleDay } from '../../scheduleFormDate';
import CategoryLoadErrorBanner from './CategoryLoadErrorBanner';
import CategoryPickerRow from './CategorySelectBox';
import LocationInputRow from './LocationInputRow';
import NotificationSettingsCard from './NotificationSettingsCard';
import { ScheduleRouteDraftNotice } from './ScheduleRouteDraftNotice';
import ScheduleAddDateTimeSection from './ScheduleAddDateTimeSection';
import { getScheduleRouteCardScrollOffset } from './scheduleRouteCardPosition';

import {
  FORM_ACCENT,
  mergeDateTime,
  MORPH_CLOSE_TARGET_WIDTH,
  MORPH_SOURCE_HEIGHT,
  MORPH_SOURCE_WIDTH,
  type Props,
} from './scheduleAddModalModel';
import { useScheduleAddModalController } from './useScheduleAddModalController';
import { useCategoryManagementReturn } from './useCategoryManagementReturn';
export type { ScheduleAddMorphPresenter } from './scheduleAddModalModel';

/**
 * 새 일정 작성 시트의 외곽 모션, 입력 콘텐츠, 저장 동작을 조합합니다.
 *
 * 입력값과 애니메이션 생명주기는 `useScheduleAddModalController`가 관리하며, 이 컴포넌트는
 * 시트·모프 프레젠테이션에 맞춰 하위 기능 컴포넌트를 배치하는 역할만 담당합니다.
 */
export default function ScheduleNewModal({
  visible,
  prewarm = false,
  onClose,
  onSubmit,
  categories,
  defaultDay,
  initialValues,
  categoryError,
  categoryLoading = false,
  onRetryCategories,
  onManageCategories,
  onCloseStart,
  presentation = 'sheet',
  sourceTopOffset = 4,
  sourceWidth = MORPH_SOURCE_WIDTH,
  sourceHeight = MORPH_SOURCE_HEIGHT,
  sourceRightOffset = 16,
  closeTargetWidth = MORPH_CLOSE_TARGET_WIDTH,
  onMorphReady,
  morphPresenterRef,
}: Props) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const reduceMotion = useReducedMotion();
  const formScrollRef = useRef<ScrollView>(null);
  const formSurfaceRef = useRef<View>(null);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
  const categoryTriggerRef = useRef<View>(null);
  const openCategoryManagement = useCategoryManagementReturn(categoryTriggerRef, visible);
  const routeButtonRef = useRef<React.ComponentRef<typeof Pressable>>(null);
  const routeSectionRef = useRef<View>(null);
  const routeOffsetRef = useRef<number | null>(null);
  const restoredRouteSessionRef = useRef<string | undefined>(undefined);
  const routeReturnPending = useRef<string | undefined>(undefined);
  const routeHighlightOpacity = useRef(new Animated.Value(0)).current;
  const formOffsetRef = useRef(0);
  const formContentHeightRef = useRef(0);
  const headerHeightRef = useRef(0);
  const saveFooterHeightRef = useRef(0);
  const controller = useScheduleAddModalController({
    visible,
    prewarm,
    onClose,
    onSubmit,
    categories,
    defaultDay,
    initialValues,
    categoryError,
    categoryLoading,
    onRetryCategories,
    onManageCategories,
    onCloseStart,
    presentation,
    sourceTopOffset,
    sourceWidth,
    sourceHeight,
    sourceRightOffset,
    closeTargetWidth,
    onMorphReady,
    morphPresenterRef,
  });
  const { memoInputRef, routeReturn, shouldRender } = controller;
  const revealFocusedMemo = useCallback((keyboardTop: number | undefined) => {
    if (keyboardTop == null) return;
    const memo = memoInputRef.current;
    if (!memo?.isFocused()) return;
    memo.measureInWindow((_x, y, _width, height) => {
      if (!memo.isFocused() || height <= 0) return;
      const overlap = y + height + 12 - keyboardTop;
      if (overlap > 0) {
        formScrollRef.current?.scrollTo({
          y: Math.max(0, formOffsetRef.current) + overlap,
          animated: !reduceMotion,
        });
      }
    });
  }, [memoInputRef, reduceMotion]);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !visible || !shouldRender) {
      setKeyboardOverlap(0);
      return;
    }
    if (!largeText) setKeyboardOverlap(0);
    let active = true;
    const show = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => {
      if (!largeText) {
        revealFocusedMemo(endCoordinates.screenY);
        return;
      }
      formSurfaceRef.current?.measureInWindow((_x, y, _width, height) => {
        if (active && height > 0) {
          setKeyboardOverlap(Math.max(0, Math.ceil(y + height - endCoordinates.screenY)));
        }
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOverlap(0));
    return () => {
      active = false;
      show.remove();
      hide.remove();
    };
  }, [largeText, revealFocusedMemo, shouldRender, visible]);
  useEffect(() => {
    if (keyboardOverlap <= 0) return;
    const frame = requestAnimationFrame(() => {
      const keyboard = Keyboard.metrics();
      if (keyboard) revealFocusedMemo(keyboard.screenY - saveFooterHeightRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardOverlap, revealFocusedMemo]);
  useEffect(() => {
    if (reduceMotion || !visible) {
      routeHighlightOpacity.stopAnimation();
      routeHighlightOpacity.setValue(0);
    }
  }, [reduceMotion, routeHighlightOpacity, visible]);
  const restoreRoutePosition = useCallback(() => {
    const offset = routeOffsetRef.current;
    const scroll = formScrollRef.current;
    if (!visible || !shouldRender || !routeReturn || routeReturn.sessionId === restoredRouteSessionRef.current ||
        offset == null || !scroll || formContentHeightRef.current <= 0) return;

    const sessionId = routeReturn.sessionId;
    restoredRouteSessionRef.current = sessionId;
    routeReturnPending.current = sessionId;
    routeOffsetRef.current = null;
    formOffsetRef.current = offset;
    scroll.scrollTo({ y: offset, animated: false });
    if (routeReturn.applied && !reduceMotion) {
      routeHighlightOpacity.setValue(0.12);
      Animated.timing(routeHighlightOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
        isInteraction: false,
      }).start();
    }
    requestAnimationFrame(() => {
      const button = routeButtonRef.current;
      const section = routeSectionRef.current;
      const viewport = scroll.getNativeScrollRef();
      const isCurrent = () => formScrollRef.current === scroll && routeReturnPending.current === sessionId;
      if (!isCurrent() || !button) return;
      const restoreFocus = () => {
        if (isCurrent() && routeButtonRef.current === button) {
          AccessibilityInfo.sendAccessibilityEvent?.(button, 'focus');
        }
      };
      if (!routeReturn.applied || !section || !viewport) {
        restoreFocus();
        return;
      }

      viewport.measureInWindow((_x, top, _width, height) => {
        section.measureInWindow((_sectionX, y, _sectionWidth, sectionHeight) => {
          if (!isCurrent()) return;
          const target = getScheduleRouteCardScrollOffset(offset, top, height, y, sectionHeight);
          if (target !== offset) {
            formOffsetRef.current = target;
            scroll.scrollTo({ y: target, animated: false });
            requestAnimationFrame(restoreFocus);
            return;
          }
          restoreFocus();
        });
      });
    });
  }, [reduceMotion, routeHighlightOpacity, routeReturn, shouldRender, visible]);

  useEffect(() => {
    if (!visible) {
      routeReturnPending.current = undefined;
      routeOffsetRef.current = null;
      return;
    }
    if (!shouldRender) return;
    const frame = requestAnimationFrame(restoreRoutePosition);
    return () => cancelAnimationFrame(frame);
  }, [restoreRoutePosition, shouldRender, visible]);

  if (!shouldRender) return null;
  const {
    SheetContentView,
    SheetMotionView,
    SheetSurfaceView,
    alertMode,
    allDay,
    category,
    categoryChevronRotation,
    categoryPickerMarginBottom,
    categoryPickerOpen,
    clearRoute,
    colors,
    destinationText,
    formError,
    formPlaceholderColor,
    handleMorphContentSizeChange,
    handleMorphSeedLayout,
    isMorphPresentation,
    isPrewarmOnly,
    markFormDirty,
    memoExpanded,
    mode,
    morphContentMounted,
    morphContentRevealCurtainStyle,
    morphDenseCloseStyle,
    morphDimStyle,
    morphPresentationStyle,
    morphSheetRasterized,
    morphSurfaceRadiusStyle,
    notes,
    notificationEnabled,
    notificationIntervalMinutes,
    notificationLeadMinutes,
    openMemo,
    openRoutePlanner,
    originText,
    panResponder,
    pressedFieldColor,
    requestClose,
    routeInfo,
    routeReady,
    routeDraftChange,
    saveBackgroundColor,
    saveDisabled,
    saveTextColor,
    selectedCategoryId,
    selectedFieldColor,
    setAlertMode,
    setCategoryPickerOpen,
    setFormError,
    setNotes,
    setNotificationEnabled,
    setNotificationIntervalMinutes,
    setNotificationLeadMinutes,
    setSelectedCategoryId,
    setTitle,
    setTitleFocused,
    sheetMotionStyle,
    sheetSurfaceProps,
    startDay,
    startTime,
    submit,
    submitting,

    title,
    titleBorderColor,
    titleError,
    titleFocused,
    travelMinutes,
    travelMode,
    writableCategories,
  } = controller;
  const canOpenCategories = writableCategories.length > 0 || Boolean(onManageCategories);
  const reportFormHeight = (width: number, height: number) => {
    if (height <= 0) return;
    const fixedHeight = headerHeightRef.current + (largeText ? saveFooterHeightRef.current : 0);
    handleMorphContentSizeChange(width, height + fixedHeight);
  };
  const toggleCategory = () => {
    setCategoryPickerOpen(current => !current);
    if (!largeText || categoryPickerOpen) return;
    formScrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, viewportHeight) => {
      categoryTriggerRef.current?.measureInWindow((_left, y, _w, triggerHeight) => {
        const roomForChoices = Math.min(225, Math.round(viewportHeight * 0.38));
        const shift = y + triggerHeight + roomForChoices - (top + viewportHeight);
        if (shift > 0) {
          formScrollRef.current?.scrollTo({ y: formOffsetRef.current + shift, animated: !reduceMotion });
        }
      });
    });
  };
  const saveButton = (
    <Pressable
      testID="schedule-add-save"
      accessibilityRole="button"
      accessibilityLabel="일정 저장"
      accessibilityState={{ disabled: saveDisabled, busy: submitting }}
      disabled={saveDisabled}
      onPress={submit}
      style={({ pressed }) => [
        styles.saveBtn,
        largeText && styles.saveBtnLarge,
        {
          backgroundColor: saveBackgroundColor,
          borderColor: saveBackgroundColor,
          opacity: pressed && !saveDisabled ? 0.82 : 1,
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={largeText ? 2.4 : undefined}
        style={[styles.saveBtnText, { color: saveTextColor }]}
      >
        {submitting ? '저장 중' : '일정 저장'}
      </Text>
      {submitting && <LoadingIndicator tone="inverse" delayMs={150} />}
    </Pressable>
  );

  const header = (
    <View style={styles.headerRow}>
      <View style={styles.headerTitleGroup}>
        <Ionicons
          accessible={false}
          name="pencil-outline"
          size={20}
          color={colors.textPrimary}
        />
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={largeText ? 2.45 : undefined}
          style={[
            styles.headerTitle,
            { color: colors.textPrimary },
          ]}
        >
          새 일정
        </Text>
      </View>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="새 일정 닫기"
          accessibilityHint="작성 중인 내용이 있으면 확인합니다"
          hitSlop={6}
          onPress={() => requestClose()}
          style={({ pressed }) => [
            styles.closeBtn,
            largeText && styles.closeBtnLarge,
            {
              backgroundColor: pressed
                ? pressedFieldColor
                : 'transparent',
              borderColor: 'transparent',
              opacity: pressed ? 0.78 : 1,
            },
          ]}
        >
          <Ionicons
            accessible={false}
            name="close-outline"
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Reanimated.View
      accessibilityViewIsModal={!isPrewarmOnly}
      accessibilityElementsHidden={isPrewarmOnly}
      importantForAccessibility={isPrewarmOnly ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.wrapper,
        isMorphPresentation && styles.morphWrapper,
        isPrewarmOnly && !isMorphPresentation && styles.prewarmHidden,
        isMorphPresentation && morphPresentationStyle,
      ]}
      pointerEvents={isPrewarmOnly ? 'none' : 'box-none'}
    >
      <Reanimated.View
        testID="schedule-add-backdrop"
        pointerEvents="auto"
        style={[
          styles.dim,
          mode === 'dark' ? styles.dimDark : styles.dimLight,
          isMorphPresentation && morphDimStyle,
        ]}
      >
        <Pressable
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={() => requestClose()}
        />
      </Reanimated.View>

      <SheetMotionView
        testID="schedule-add-card-motion"
        collapsable={false}
        onLayout={({
          nativeEvent: { layout },
        }: {
          nativeEvent: { layout: { width: number; height: number } };
        }) => {
          handleMorphSeedLayout(layout.width, layout.height);
        }}
        style={sheetMotionStyle}
      >
        <SheetSurfaceView
          {...sheetSurfaceProps}
          collapsable={false}
          style={[
            styles.sheet,
            isMorphPresentation && styles.morphSheet,
            {
              borderColor: colors.border,
              backgroundColor: isMorphPresentation ? 'transparent' : undefined,
              borderWidth: isMorphPresentation ? 0 : 1,
            },
          ]}
        >
          <Reanimated.View
            ref={formSurfaceRef}
            collapsable={false}
            shouldRasterizeIOS={
              Platform.OS === 'ios' &&
              isMorphPresentation &&
              morphSheetRasterized
            }
            style={[
              isMorphPresentation && styles.morphDenseSurface,
              isMorphPresentation && morphDenseCloseStyle,
              isMorphPresentation && morphSurfaceRadiusStyle,
              isMorphPresentation && {
                backgroundColor: mode === 'dark' ? '#1C1C1E' : '#FFFFFF',
                borderColor: colors.border,
              },
            ]}
          >
            {(!isMorphPresentation || morphContentMounted) && (
              <SheetContentView
                style={[
                  isMorphPresentation
                    ? styles.morphInnerContent
                    : styles.sheetInnerContent,
                ]}
              >
                {!isMorphPresentation ? (
                  <View
                    testID="schedule-add-drag-handle"
                    {...panResponder.panHandlers}
                    style={styles.handleWrap}
                  >
                    <View
                      testID="schedule-add-handle"
                      style={[
                        styles.handle,
                        { backgroundColor: colors.textSecondary },
                      ]}
                    />
                  </View>
                ) : null}

                <View
                  style={[
                    styles.fixedHeader,
                    isMorphPresentation && styles.morphHeader,
                    largeText && styles.fixedHeaderLarge,
                  ]}
                  onLayout={({ nativeEvent: { layout } }) => {
                    headerHeightRef.current = layout.height;
                    reportFormHeight(layout.width, formContentHeightRef.current);
                  }}
                >
                  {header}
                </View>
                <ScrollView
                  ref={formScrollRef}
                  testID="schedule-add-scroll"
                  style={[styles.scrollView, largeText && styles.scrollViewLarge]}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : undefined}
                  automaticallyAdjustKeyboardInsets={Platform.OS === 'ios' && !largeText}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={[styles.scrollContent, largeText && styles.scrollContentLarge]}
                  onScroll={({ nativeEvent }) => { formOffsetRef.current = nativeEvent.contentOffset.y; }}
                  scrollEventThrottle={16}
                  onContentSizeChange={(width, height) => {
                    formContentHeightRef.current = height;
                    reportFormHeight(width, height);
                    if (height > 0) restoreRoutePosition();
                  }}
                >
                  {categoryError && onRetryCategories ? (
                    <CategoryLoadErrorBanner
                      compact
                      retrying={categoryLoading}
                      onRetry={onRetryCategories}
                    />
                  ) : null}

                  <View
                    style={[
                      isMorphPresentation && styles.morphBodyContent,
                      largeText && styles.formBodyLarge,
                    ]}
                  >
                    <Text
                      style={[styles.label, { color: colors.textSecondary }]}
                    >
                      제목
                    </Text>
                    <View
                      testID="schedule-add-title-field"
                      style={[
                        styles.titleInputWrap,
                        largeText && styles.titleInputWrapLarge,
                        !largeText && (titleFocused || titleError) &&
                          styles.titleInputWrapEmphasized,
                        {
                          borderColor: largeText ? 'transparent' : titleBorderColor,
                          backgroundColor: largeText ? 'transparent' : colors.surface2,
                        },
                      ]}
                    >
                      <TextInput
                        testID="schedule-add-title-input"
                        value={title}
                        onChangeText={value => {
                          markFormDirty();
                          setTitle(value);
                          if (value.trim()) setFormError(null);
                        }}
                        accessibilityLabel="일정 제목"
                        maxLength={120}
                        multiline={largeText}
                        submitBehavior="blurAndSubmit"
                        lineBreakStrategyIOS="hangul-word"
                        placeholder="일정 제목"
                        placeholderTextColor={formPlaceholderColor}
                        onFocus={() => setTitleFocused(true)}
                        onBlur={() => setTitleFocused(false)}
                        style={[
                          styles.titleInput,
                          largeText && styles.titleInputLarge,
                          largeText && {
                            borderWidth: titleFocused || titleError ? 1 : StyleSheet.hairlineWidth,
                            borderColor: titleBorderColor,
                            backgroundColor: colors.surface2,
                          },
                          { color: colors.textPrimary },
                        ]}
                      />
                      <Pressable
                        ref={categoryTriggerRef}
                        accessibilityRole="button"
                        accessibilityLabel={`카테고리 선택, 현재 ${
                          category?.title ?? '없음'
                        }`}
                        accessibilityState={{
                          expanded: categoryPickerOpen,
                          disabled: !canOpenCategories,
                        }}
                        onPress={toggleCategory}
                        disabled={!canOpenCategories}
                        hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
                        style={({ pressed }) => [
                          styles.categoryInlineChip,
                          largeText && styles.categoryInlineChipLarge,
                          {
                            borderColor: categoryPickerOpen
                              ? FORM_ACCENT
                              : colors.border,
                            backgroundColor: categoryPickerOpen
                              ? selectedFieldColor
                              : pressed
                              ? pressedFieldColor
                              : colors.surface,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.categoryInlineDot,
                            { backgroundColor: category?.color ?? '#8E8E93' },
                          ]}
                        />
                        <Text
                          numberOfLines={largeText ? undefined : 1}
                          lineBreakStrategyIOS="hangul-word"
                          style={[
                            styles.categoryInlineText,
                            largeText && styles.categoryInlineTextLarge,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {largeText && category ? `카테고리 · ${category.title}` : category?.title ?? '카테고리'}
                        </Text>
                        <Animated.View
                          testID="schedule-add-category-chevron"
                          style={[
                            styles.categoryInlineChevron,
                            {
                              transform: [{ rotate: categoryChevronRotation }],
                            },
                          ]}
                        >
                          <Ionicons
                            accessible={false}
                            name="chevron-down-outline"
                            size={13}
                            color={
                              categoryPickerOpen
                                ? FORM_ACCENT
                                : colors.textSecondary
                            }
                          />
                        </Animated.View>
                      </Pressable>
                    </View>

                    {formError ? (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[
                          styles.formError,
                          { color: mode === 'dark' ? '#FF453A' : '#D70015' },
                        ]}
                      >
                        {formError}
                      </Text>
                    ) : null}

                    <Animated.View
                      testID="schedule-add-category-picker-slot"
                      style={{ marginBottom: categoryPickerMarginBottom }}
                    >
                      <CategoryPickerRow
                        categories={writableCategories}
                        value={selectedCategoryId}
                        expanded={categoryPickerOpen}
                        hideTrigger
                        onExpandedChange={setCategoryPickerOpen}
                        onChange={nextCategoryId => {
                          markFormDirty();
                          setSelectedCategoryId(nextCategoryId);
                          setCategoryPickerOpen(false);
                        }}
                        onManageCategories={onManageCategories
                          ? () => openCategoryManagement(() => onManageCategories(category ? category.calendarId ?? null : undefined))
                          : undefined}
                      />
                    </Animated.View>

                    <ScheduleAddDateTimeSection controller={controller} largeText={largeText} />

                    <View ref={routeSectionRef} collapsable={false}>
                      <LocationInputRow
                        originValue={originText}
                        destinationValue={destinationText}
                        travelMode={travelMode}
                        travelMinutes={travelMinutes}
                        routeInfo={routeInfo}
                        routeButtonRef={routeButtonRef}
                        highlightOpacity={routeHighlightOpacity}
                        onPress={() => {
                          routeReturnPending.current = undefined;
                          routeOffsetRef.current = formOffsetRef.current;
                          openRoutePlanner();
                        }}
                        onClear={routeInfo ? clearRoute : undefined}
                        wrapTitle={largeText}
                        footer={<ScheduleRouteDraftNotice change={routeDraftChange} color={colors.textSecondary} />}
                      />
                    </View>

                    {!!routeInfo && (
                      <NotificationSettingsCard
                        routeReady={routeReady}
                        enabled={notificationEnabled}
                        alertMode={alertMode}
                        leadMinutes={notificationLeadMinutes}
                        intervalMinutes={notificationIntervalMinutes}
                        routeInfo={routeInfo}
                        routePlannedArrivalAt={controller.routePlannedArrivalAt}
                        startAt={
                          allDay
                            ? startOfLocalScheduleDay(startDay)
                            : mergeDateTime(startDay, startTime)
                        }

                        onEnabledChange={value => {
                          markFormDirty();
                          setNotificationEnabled(value);
                        }}
                        onAlertModeChange={value => {
                          markFormDirty();
                          setAlertMode(value);
                        }}
                        onLeadMinutesChange={value => {
                          markFormDirty();
                          setNotificationLeadMinutes(value);
                        }}
                        onIntervalMinutesChange={value => {
                          markFormDirty();
                          setNotificationIntervalMinutes(value);
                        }}
                      />
                    )}

                    <Text
                      style={[styles.label, { color: colors.textSecondary }]}
                    >
                      메모
                    </Text>
                    {memoExpanded ? (
                      <View
                        testID="schedule-add-memo-field"
                        style={[
                          styles.memoInputCard,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.surface2,
                          },
                        ]}
                      >
                        <TextInput
                          ref={memoInputRef}
                          onFocus={() => {
                            if (Platform.OS === 'ios') {
                              requestAnimationFrame(() => revealFocusedMemo(Keyboard.metrics()?.screenY));
                            }
                          }}
                          testID="schedule-add-memo-input"
                          value={notes}
                          onChangeText={value => {
                            markFormDirty();
                            setNotes(value);
                          }}
                          multiline
                          maxLength={2000}
                          accessibilityLabel="일정 메모"
                          placeholder="메모 추가"
                          placeholderTextColor={formPlaceholderColor}
                          style={[
                            styles.memoTextInput,
                            { color: colors.textPrimary },
                          ]}
                        />
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="메모 추가"
                        accessibilityHint="메모 입력란을 엽니다"
                        testID="schedule-add-memo-collapsed"
                        onPress={openMemo}
                        style={({ pressed }) => [
                          styles.memoCollapsedCard,
                          largeText && styles.memoCollapsedCardLarge,
                          {
                            borderColor: colors.border,
                            backgroundColor: pressed
                              ? colors.surface2
                              : colors.surface,
                            opacity: pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.memoCollapsedText,
                            { color: formPlaceholderColor },
                          ]}
                        >
                          메모 추가
                        </Text>
                        <Ionicons
                          accessible={false}
                          name="pencil-outline"
                          size={16}
                          color={formPlaceholderColor}
                        />
                      </Pressable>
                    )}

                    {!largeText && saveButton}
                  </View>
                </ScrollView>
                {largeText && (
                  <View
                    style={[
                      styles.saveFooter,
                      { borderTopColor: colors.border, backgroundColor: colors.surface, marginBottom: keyboardOverlap },
                    ]}
                    onLayout={({ nativeEvent: { layout } }) => {
                      saveFooterHeightRef.current = layout.height;
                      reportFormHeight(layout.width, formContentHeightRef.current);
                    }}
                  >
                    {saveButton}
                  </View>
                )}
              </SheetContentView>
            )}
          </Reanimated.View>
          {isMorphPresentation && (
            <Reanimated.View
              pointerEvents="none"
              style={[
                styles.morphContentRevealCurtain,
                morphContentRevealCurtainStyle,
                morphSurfaceRadiusStyle,
                { backgroundColor: mode === 'dark' ? '#1C1C1E' : '#FFFFFF' },
              ]}
            />
          )}
        </SheetSurfaceView>
      </SheetMotionView>
    </Reanimated.View>
  );
}

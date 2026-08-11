import { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { usePathname, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Animated, Platform, useWindowDimensions, View } from 'react-native';
import Reanimated, { cancelAnimation } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styles from './ScheduleAddModal.styles';

import { useTheme } from '../../../theme/ThemeContext';
import {
  buildRoutePlannerPlace,
  buildScheduleRoutePlannerInitial,
  consumeRoutePlannerResult,
  observeRoutePlannerReturn,
  setRoutePlannerInitial,
} from '../../routePlannerSession';
import { resolveScheduleAlertModePayload } from '../../scheduleAlertMode';
import {
  getScheduleCalendarDateKey,
  normalizeScheduleFormRange,
  startOfLocalScheduleDay,
} from '../../scheduleFormDate';
import {
  buildScheduleFormLocationName,
  buildScheduleFormPlace,
} from '../../scheduleFormPlace';
import {
  hasPersistableScheduleRoute,
  reconcileScheduleRouteTiming,
} from '../../scheduleRouteTiming';
import CalendarGlassSurface from '../calendar/CalendarGlassSurface';

import {
  FORM_ACCENT,
  mergeDateTime,
  MORPH_CLOSE_TARGET_WIDTH,
  MORPH_SOURCE_HEIGHT,
  MORPH_SOURCE_WIDTH,
  type PickerType,
  type Props,
  SHEET_HIDDEN_Y,
} from './scheduleAddModalModel';
import { useScheduleAddMorphStyles } from './useScheduleAddMorphStyles';
import { useScheduleAddPickerAnimation } from './useScheduleAddPickerAnimation';
import { useScheduleAddSheetLifecycle } from './useScheduleAddSheetLifecycle';
import { useScheduleAddSheetPanResponder } from './useScheduleAddSheetPanResponder';
import { useScheduleAddFormState } from './useScheduleAddFormState';
/** 일정 추가 폼의 입력 상태, 경로 연동, 저장, 시트·모프 애니메이션 생명주기를 통합 관리하고 표현 컴포넌트에 필요한 계약을 반환합니다. */
export function useScheduleAddModalController({
  visible,
  prewarm = false,
  onClose,
  onSubmit,
  categories,
  defaultDay,
  initialValues,
  categoryError: _categoryError,
  categoryLoading: _categoryLoading = false,
  onRetryCategories: _onRetryCategories,
  onManageCategories: _onManageCategories,
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
  const router = useRouter();
  const pathname = usePathname();
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isMorphPresentation = presentation === 'morph';
  const {
    writableCategories,
    title,
    setTitle,
    notes,
    setNotes,
    selectedCategoryId,
    setSelectedCategoryId,
    categoryPickerOpen,
    setCategoryPickerOpen,
    originText,
    setOriginText,
    destinationText,
    setDestinationText,
    originAddress,
    setOriginAddress,
    destinationAddress,
    setDestinationAddress,
    originLat,
    setOriginLat,
    originLng,
    setOriginLng,
    destinationLat,
    setDestinationLat,
    destinationLng,
    setDestinationLng,
    travelMode,
    setTravelMode,
    travelMinutes,
    setTravelMinutes,
    departAt,
    setDepartAt,
    route,
    setRoute,
    allDay,
    hasEndTime,
    setHasEndTime,
    notificationEnabled,
    setNotificationEnabled,
    alertMode,
    setAlertMode,
    notificationLeadMinutes,
    setNotificationLeadMinutes,
    notificationIntervalMinutes,
    setNotificationIntervalMinutes,
    subscriptionPolicy,
    routePlannerSessionId,
    setRoutePlannerSessionId,
    routePlannerAwayRef,
    routeTimingTargetArrivalRef,
    pendingRouteTimingTargetArrivalRef,
    submitting,
    setSubmitting,
    formError,
    setFormError,
    titleFocused,
    setTitleFocused,
    routePlannerHidden,
    setRoutePlannerHidden,
    memoExpanded,
    setMemoExpanded,
    rendered,
    setRendered,
    morphContentMounted,
    setMorphContentMounted,
    morphSheetRasterized,
    setMorphSheetRasterized,
    morphMeasuredContentHeight,
    setMorphMeasuredContentHeight,
    morphMeasuredContentHeightRef,
    memoInputRef,
    formDirtyRef,
    closePromptVisibleRef,
    submitInFlightRef,
    markFormDirty,
    categoryPickerMarginBottom,
    categoryChevronRotation,
    discardDraft,
    startDay,
    setStartDay,
    endDay,
    setEndDay,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    destinationResolutionSequenceRef,
    picker,
    setPicker,
    displayPicker,
    setDisplayPicker,
    handleEndTimeEnabledChange,
    handleAllDayChange,
    category,
    routeInfo,
    routeReady,
  } = useScheduleAddFormState({
    categories,
    defaultDay,
    initialValues,
    isMorphPresentation,
    prewarm,
    visible,
  });

  // 날짜/시간 필드를 열거나 같은 필드를 다시 눌러 닫는다.
  const togglePicker = useCallback(
    (type: PickerType) => {
      setPicker(prev => (prev === type ? null : type));
    },
    [setPicker],
  );

  const openMemo = useCallback(() => {
    setMemoExpanded(true);
    requestAnimationFrame(() => memoInputRef.current?.focus());
  }, [memoInputRef, setMemoExpanded]);

  const { contentFade, heightAnim, outerOpacity } =
    useScheduleAddPickerAnimation({ picker, setDisplayPicker });

  const {
    closeWithoutPrompt,
    closeSheet,
    handleMorphContentSizeChange,
    handleMorphSeedLayout,
    morphClosingPhase,
    morphClosingRef,
    morphPresentationStyle,
    morphProgress,
    morphWasPresentedRef,
    openSheet,
    posY,
    requestClose,
    resetCloseLifecycle,
  } = useScheduleAddSheetLifecycle({
    closePromptVisibleRef,
    discardDraft,
    formDirtyRef,
    isMorphPresentation,
    measuredContentHeight: morphMeasuredContentHeight,
    measuredContentHeightRef: morphMeasuredContentHeightRef,
    morphContentMounted,
    morphPresenterRef,
    onClose,
    onCloseStart,
    onMorphReady,
    prewarm,
    rendered,
    routePlannerHidden,
    setMeasuredContentHeight: setMorphMeasuredContentHeight,
    setMorphContentMounted,
    setMorphSheetRasterized,
    setRendered,
    submitInFlightRef,
    submitting,
    visible,
  });

  useEffect(() => {
    if (!visible || !routePlannerSessionId) return;
    const observation = observeRoutePlannerReturn(
      pathname,
      routePlannerAwayRef.current,
    );
    routePlannerAwayRef.current = observation.hasVisitedRouteFlow;
    if (!observation.shouldConsumeResult) return;

    const result = consumeRoutePlannerResult(routePlannerSessionId);
    const selectedTargetArrivalAt = pendingRouteTimingTargetArrivalRef.current;
    pendingRouteTimingTargetArrivalRef.current = undefined;
    setRoutePlannerSessionId(undefined);
    if (!result) {
      setRoutePlannerHidden(false);
      setRendered(true);
      if (isMorphPresentation) {
        resetCloseLifecycle();
        cancelAnimation(morphProgress);
        morphProgress.value = 1;
        setMorphContentMounted(true);
        setMorphSheetRasterized(true);
      } else {
        posY.setValue(SHEET_HIDDEN_Y);
        openSheet();
      }
      return;
    }

    setOriginText(result.origin?.name ?? '');
    setOriginAddress(result.origin?.address);
    setOriginLat(result.origin?.lat);
    setOriginLng(result.origin?.lng);
    setDestinationText(result.destination?.name ?? '');
    setDestinationAddress(result.destination?.address);
    setDestinationLat(result.destination?.lat);
    setDestinationLng(result.destination?.lng);
    setTravelMode(result.travelMode);
    setTravelMinutes(result.travelMinutes);
    setDepartAt(result.departureAt);
    setRoute(result.route);
    routeTimingTargetArrivalRef.current =
      selectedTargetArrivalAt ?? result.targetArrivalAt;
    markFormDirty();
    setRoutePlannerHidden(false);
    setRendered(true);
    if (isMorphPresentation) {
      resetCloseLifecycle();
      cancelAnimation(morphProgress);
      morphProgress.value = 1;
      setMorphContentMounted(true);
      setMorphSheetRasterized(true);
    } else {
      posY.setValue(SHEET_HIDDEN_Y);
      openSheet();
    }
  }, [
    isMorphPresentation,
    pendingRouteTimingTargetArrivalRef,
    morphProgress,
    openSheet,
    pathname,
    posY,
    resetCloseLifecycle,
    routePlannerAwayRef,
    routePlannerSessionId,
    routeTimingTargetArrivalRef,
    setDepartAt,
    setDestinationAddress,
    setDestinationLat,
    setDestinationLng,
    setDestinationText,
    setMorphContentMounted,
    setMorphSheetRasterized,
    setOriginAddress,
    setOriginLat,
    setOriginLng,
    setOriginText,
    setRendered,
    setRoute,
    setRoutePlannerHidden,
    setRoutePlannerSessionId,
    setTravelMinutes,
    setTravelMode,
    visible,
    markFormDirty,
  ]);

  // 현재 입력한 장소와 일정 시작 시각을 경로 선택 화면에 그대로 전달한다.
  const openRoutePlanner = useCallback(() => {
    if (submitInFlightRef.current) return;
    // 파서 목적지를 좌표로 보강하던 느린 응답이 사용자가 경로 화면에서
    // 직접 고른 장소를 뒤늦게 덮지 못하도록 먼저 무효화한다.
    destinationResolutionSequenceRef.current += 1;
    const nextOrigin = buildRoutePlannerPlace(
      {
        name: originText,
        address: originAddress,
        lat: originLat,
        lng: originLng,
      },
      '출발지',
    );
    const nextDestination = buildRoutePlannerPlace(
      {
        name: destinationText,
        address: destinationAddress,
        lat: destinationLat,
        lng: destinationLng,
      },
      '도착지',
    );
    const sessionId = `route-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    const targetArrivalAt = allDay
      ? startOfLocalScheduleDay(startDay)
      : mergeDateTime(startDay, startTime);
    pendingRouteTimingTargetArrivalRef.current = targetArrivalAt.toISOString();
    setRoutePlannerInitial(
      sessionId,
      buildScheduleRoutePlannerInitial({
        origin: nextOrigin,
        destination: nextDestination,
        travelMode,
        travelMinutes,
        departureAt: departAt,
        route,
        locationName:
          nextOrigin?.name && nextDestination?.name
            ? `${nextOrigin.name} → ${nextDestination.name}`
            : nextDestination?.name ?? nextOrigin?.name,
        targetArrivalAt,
      }),
    );

    setPicker(null);
    // 모달 state가 먼저 갱신돼도 경로 화면을 실제로 다녀오기 전에는 빈 결과를 소비하지 않는다.
    routePlannerAwayRef.current = false;
    setRoutePlannerSessionId(sessionId);
    setRoutePlannerHidden(true);
    closeSheet(undefined, { notifyCloseStart: false });
    router.push({ pathname: '/schedule/route-select', params: { sessionId } });
  }, [
    closeSheet,
    destinationResolutionSequenceRef,
    allDay,
    destinationAddress,
    destinationLat,
    destinationLng,
    destinationText,
    departAt,
    originAddress,
    originLat,
    originLng,
    originText,
    router,
    pendingRouteTimingTargetArrivalRef,
    routePlannerAwayRef,
    startDay,
    startTime,
    setPicker,
    setRoutePlannerHidden,
    setRoutePlannerSessionId,
    submitInFlightRef,
    travelMinutes,
    travelMode,
    route,
  ]);

  const clearRoute = useCallback(() => {
    destinationResolutionSequenceRef.current += 1;
    markFormDirty();
    setOriginText('');
    setDestinationText('');
    setOriginAddress(undefined);
    setDestinationAddress(undefined);
    setOriginLat(undefined);
    setOriginLng(undefined);
    setDestinationLat(undefined);
    setDestinationLng(undefined);
    setTravelMinutes(undefined);
    setDepartAt(undefined);
    setRoute(undefined);
    routeTimingTargetArrivalRef.current = undefined;
    pendingRouteTimingTargetArrivalRef.current = undefined;
    setNotificationEnabled(false);
  }, [
    destinationResolutionSequenceRef,
    markFormDirty,
    pendingRouteTimingTargetArrivalRef,
    routeTimingTargetArrivalRef,
    setDepartAt,
    setDestinationAddress,
    setDestinationLat,
    setDestinationLng,
    setDestinationText,
    setNotificationEnabled,
    setOriginAddress,
    setOriginLat,
    setOriginLng,
    setOriginText,
    setRoute,
    setTravelMinutes,
  ]);

  const panResponder = useScheduleAddSheetPanResponder({
    posY,
    requestClose,
  });

  // 입력값을 일정 저장 payload로 변환해 상위 화면에 전달한다.
  const submit = async () => {
    const t = title.trim();
    if (!t) {
      setFormError('제목을 입력해 주세요.');
      return;
    }
    if (!category) {
      setFormError('카테고리를 먼저 만들어 주세요.');
      return;
    }
    if (submitting || submitInFlightRef.current) return;

    const normalizedRange = normalizeScheduleFormRange({
      startDay,
      startTime,
      endDay,
      endTime,
      allDay,
      hasEndTime,
    });
    const nextOrigin = buildScheduleFormPlace({
      name: originText,
      address: originAddress,
      lat: originLat,
      lng: originLng,
    });
    const nextDestination = buildScheduleFormPlace({
      name: destinationText,
      address: destinationAddress,
      lat: destinationLat,
      lng: destinationLng,
    });
    const locationName = buildScheduleFormLocationName(
      nextOrigin,
      nextDestination,
    );
    const nextStartAt = normalizedRange.startAt.toISOString();
    const reconciledRouteTiming = reconcileScheduleRouteTiming({
      departAt,
      route,
      travelMinutes,
      plannedArrivalAt: routeTimingTargetArrivalRef.current,
      nextArrivalAt: nextStartAt,
    });
    const hasRoutePlan = hasPersistableScheduleRoute(
      reconciledRouteTiming.route,
      travelMinutes,
      nextOrigin,
      nextDestination,
    );

    try {
      submitInFlightRef.current = true;
      setSubmitting(true);
      setFormError(null);
      await onSubmit({
        title: t,
        startAt: nextStartAt,
        endAt: normalizedRange.endAt.toISOString(),
        hasEndTime: normalizedRange.hasEndTime,
        allDay: normalizedRange.allDay,
        category,
        // 일반 일정 등록은 항상 개인 일정으로 시작한다.
        // 공유는 저장 후 일정 상세의 공유 기능에서 명시적으로 선택한다.
        calendarId: null,
        calendarContentModeOverride: null,
        travelMode: hasRoutePlan ? travelMode : undefined,
        travelMinutes: hasRoutePlan ? travelMinutes : undefined,
        departAt: hasRoutePlan ? reconciledRouteTiming.departAt : undefined,
        route: hasRoutePlan ? reconciledRouteTiming.route : undefined,
        notificationEnabled: hasRoutePlan && notificationEnabled,
        notificationLeadMinutes:
          hasRoutePlan && notificationEnabled
            ? notificationLeadMinutes
            : undefined,
        notificationIntervalMinutes:
          hasRoutePlan && notificationEnabled
            ? notificationIntervalMinutes
            : undefined,
        alertMode: resolveScheduleAlertModePayload({
          hasRoutePlan,
          notificationEnabled,
          selectedMode: alertMode,
        }),
        locationName,
        origin: hasRoutePlan ? nextOrigin : undefined,
        destination: nextDestination,
        notes: notes.trim() || undefined,
      });
      closeWithoutPrompt();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : '일정을 저장하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
  const onDayPress = useCallback(
    (day: { dateString: string }) => {
      const selected = new Date(`${day.dateString}T00:00:00`);
      markFormDirty();
      if (picker === 'startDate') {
        setStartDay(selected);
        if (allDay && selected.getTime() > endDay.getTime())
          setEndDay(selected);
      } else if (picker === 'endDate') {
        if (!allDay) setHasEndTime(true);
        setEndDay(selected);
        if (selected.getTime() < startDay.getTime()) setStartDay(selected);
      }
    },
    [
      allDay,
      endDay,
      markFormDirty,
      picker,
      setEndDay,
      setHasEndTime,
      setStartDay,
      startDay,
    ],
  );

  // 시간 피커에서 선택한 시간을 시작/종료 시간에 반영한다.
  const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android' && event.type === 'dismissed') {
      setPicker(null);
      return;
    }
    if (!selected) return;
    markFormDirty();
    if (picker === 'startTime') setStartTime(selected);
    else if (picker === 'endTime') {
      setHasEndTime(true);
      setEndTime(selected);
    }
    if (Platform.OS === 'android') setPicker(null);
  };

  const calendarTheme = useMemo(
    () => ({
      calendarBackground: colors.surface,
      textSectionTitleColor: colors.textSecondary,
      selectedDayBackgroundColor: colors.selectedDayBg,
      selectedDayTextColor: colors.selectedDayText,
      todayTextColor: colors.todayBorderColor,
      dayTextColor: colors.textPrimary,
      textDisabledColor: colors.textDisabled,
      arrowColor: colors.arrowColor,
      monthTextColor: colors.monthTextColor,
      textDayFontWeight: '600' as const,
      textMonthFontWeight: '700' as const,
      textDayHeaderFontWeight: '500' as const,
    }),
    [colors],
  );

  const formPlaceholderColor =
    mode === 'dark' ? 'rgba(235,235,245,0.50)' : 'rgba(60,60,67,0.56)';
  const pressedFieldColor =
    mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.05)';
  const selectedFieldColor =
    mode === 'dark' ? 'rgba(36,107,254,0.16)' : 'rgba(36,107,254,0.08)';
  const titleError = formError === '제목을 입력해 주세요.';
  const titleBorderColor = titleError
    ? mode === 'dark'
      ? '#FF453A'
      : '#D70015'
    : titleFocused
    ? FORM_ACCENT
    : colors.border;
  const saveDisabled = submitting || !title.trim() || !category;
  const saveBackgroundColor = saveDisabled
    ? mode === 'dark'
      ? '#2C2C2E'
      : '#E9E9EE'
    : FORM_ACCENT;
  const saveTextColor = saveDisabled
    ? mode === 'dark'
      ? '#8E8E93'
      : '#7D7D82'
    : '#FFFFFF';

  const isDisplayDate =
    displayPicker === 'startDate' || displayPicker === 'endDate';
  const isDisplayTime =
    displayPicker === 'startTime' || displayPicker === 'endTime';
  const calendarSelected = isDisplayDate
    ? getScheduleCalendarDateKey(
        displayPicker === 'startDate' ? startDay : endDay,
      )
    : '';
  const {
    morphContentRevealCurtainStyle,
    morphDenseCloseStyle,
    morphDimStyle,
    morphSheetStyle,
    morphSurfaceRadiusStyle,
    sheetTargetHeight,
  } = useScheduleAddMorphStyles({
    closeTargetWidth,
    insetsBottom: insets.bottom,
    insetsTop: insets.top,
    isMorphPresentation,
    measuredContentHeight: morphMeasuredContentHeight,
    morphClosingPhase,
    morphProgress,
    screenHeight,
    screenWidth,
    sourceHeight,
    sourceRightOffset,
    sourceTopOffset,
    sourceWidth,
  });

  const shouldRender = rendered && !routePlannerHidden;

  const isPrewarmOnly =
    prewarm &&
    !visible &&
    !morphWasPresentedRef.current &&
    !morphClosingRef.current;

  const SheetMotionView = (
    isMorphPresentation ? Reanimated.View : Animated.View
  ) as React.ComponentType<any>;
  const SheetContentView = (
    isMorphPresentation ? Reanimated.View : Animated.View
  ) as React.ComponentType<any>;
  // Avoid re-rasterizing a native GlassView while its parent is scaled. The
  // regular bottom sheet still uses native glass; only the morph uses this
  // lightweight, visually matching surface.
  const SheetSurfaceView = (
    isMorphPresentation ? View : CalendarGlassSurface
  ) as React.ComponentType<any>;
  const sheetSurfaceProps = isMorphPresentation
    ? {}
    : {
        prominent: true,
        variant: 'sheet',
        tone: 'solidCard',
      };
  const sheetMotionStyle = isMorphPresentation
    ? [styles.morphSheetMotion, morphSheetStyle]
    : [
        styles.sheetMotion,
        { maxHeight: sheetTargetHeight, transform: [{ translateY: posY }] },
      ];

  return {
    SheetContentView,
    SheetMotionView,
    SheetSurfaceView,
    alertMode,
    allDay,
    calendarSelected,
    calendarTheme,
    category,
    categoryChevronRotation,
    categoryPickerMarginBottom,
    categoryPickerOpen,
    clearRoute,
    colors,
    contentFade,
    destinationText,
    displayPicker,
    endDay,
    endTime,
    formError,
    formPlaceholderColor,
    handleAllDayChange,
    handleEndTimeEnabledChange,
    handleMorphContentSizeChange,
    handleMorphSeedLayout,
    hasEndTime,
    heightAnim,
    isDisplayDate,
    isDisplayTime,
    isMorphPresentation,
    isPrewarmOnly,
    markFormDirty,
    memoExpanded,
    memoInputRef,
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
    onDayPress,
    onTimeChange,
    openMemo,
    openRoutePlanner,
    originText,
    outerOpacity,
    panResponder,
    picker,
    pressedFieldColor,
    requestClose,
    routeInfo,
    routeReady,
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
    shouldRender,
    startDay,
    startTime,
    submit,
    submitting,
    subscriptionPolicy,
    title,
    titleBorderColor,
    titleError,
    titleFocused,
    togglePicker,
    travelMinutes,
    travelMode,
    writableCategories,
  };
}

/** 일정 추가 화면의 표현 컴포넌트가 공유하는 상태와 이벤트 계약입니다. */
export type ScheduleAddModalController = ReturnType<
  typeof useScheduleAddModalController
>;

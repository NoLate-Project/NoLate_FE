import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, TextInput } from 'react-native';
import {
  FREE_SUBSCRIPTION_POLICY,
  getMySubscriptionPolicy,
  type SubscriptionPolicy,
} from '../../../../api/subscription';
import { searchAddressByKeyword } from '../../../map/tmapApi';
import { getWritableScheduleCategories } from '../../categoryPermissions';
import { getRouteInfoFromRoute } from '../../routeInfo';
import { normalizeScheduleAlertMode } from '../../scheduleAlertMode';
import {
  getDefaultScheduleFormStart,
  getDefaultScheduleStartTime,
} from '../../scheduleFormDate';
import type { ScheduleAlertMode, TravelMode } from '../../types';
import {
  CATEGORY_PICKER_MARGIN,
  cleanOptionalText,
  getDisplayPlaceText,
  hasPlaceCoords,
  mergeDateTime,
  type PickerType,
  type Props,
  setYmd,
  uniqueNonBlank,
} from './scheduleAddModalModel';

type Params = Pick<
  Props,
  'categories' | 'defaultDay' | 'initialValues' | 'visible'
> & {
  isMorphPresentation: boolean;
  prewarm: boolean;
};

/**
 * 일정 추가 폼의 입력값, 초기 데이터 복원, 장소 좌표 보강과 파생 경로 정보를 관리합니다.
 * 시트 애니메이션과 저장 동작은 다루지 않고 폼 상태 및 변경 명령만 반환합니다.
 */
export function useScheduleAddFormState({
  categories,
  defaultDay,
  initialValues,
  isMorphPresentation,
  prewarm,
  visible,
}: Params) {
  const writableCategories = useMemo(
    () => getWritableScheduleCategories(categories),
    [categories],
  );
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    writableCategories[0]?.id ?? '',
  );
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const categoryPickerSpacingAnim = useRef(new Animated.Value(0)).current;
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [originAddress, setOriginAddress] = useState<string | undefined>();
  const [destinationAddress, setDestinationAddress] = useState<
    string | undefined
  >();
  const [originLat, setOriginLat] = useState<number | undefined>();
  const [originLng, setOriginLng] = useState<number | undefined>();
  const [destinationLat, setDestinationLat] = useState<number | undefined>();
  const [destinationLng, setDestinationLng] = useState<number | undefined>();
  const [travelMode, setTravelMode] = useState<TravelMode>('CAR');
  const [travelMinutes, setTravelMinutes] = useState<number | undefined>();
  const [departAt, setDepartAt] = useState<string | undefined>();
  const [route, setRoute] = useState<unknown>();
  const [allDay, setAllDay] = useState(false);
  const [hasEndTime, setHasEndTime] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [alertMode, setAlertMode] = useState<ScheduleAlertMode>('STANDARD');
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(60);
  const [notificationIntervalMinutes, setNotificationIntervalMinutes] =
    useState(20);
  const [subscriptionPolicy, setSubscriptionPolicy] =
    useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
  const [routePlannerSessionId, setRoutePlannerSessionId] = useState<
    string | undefined
  >();
  const routePlannerAwayRef = useRef(false);
  const routeTimingTargetArrivalRef = useRef<string | undefined>(undefined);
  const pendingRouteTimingTargetArrivalRef = useRef<string | undefined>(
    undefined,
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [titleFocused, setTitleFocused] = useState(false);
  const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
  const [memoExpanded, setMemoExpanded] = useState(false);
  const [rendered, setRendered] = useState(visible || prewarm);
  const [morphContentMounted, setMorphContentMounted] = useState(
    !isMorphPresentation || visible || prewarm,
  );
  const [morphSheetRasterized, setMorphSheetRasterized] = useState(
    isMorphPresentation && (visible || prewarm),
  );
  const [morphMeasuredContentHeight, setMorphMeasuredContentHeight] = useState<
    number | null
  >(null);
  const morphMeasuredContentHeightRef = useRef<number | null>(null);
  const memoInputRef = useRef<TextInput>(null);
  const formDirtyRef = useRef(false);
  const closePromptVisibleRef = useRef(false);
  const submitInFlightRef = useRef(false);

  /** 사용자가 폼을 수정했음을 기록해 닫기 시 초안 폐기 확인을 활성화합니다. */
  const markFormDirty = useCallback(() => {
    formDirtyRef.current = true;
  }, []);

  useEffect(() => {
    const animation = categoryPickerOpen
      ? Animated.spring(categoryPickerSpacingAnim, {
          toValue: 1,
          useNativeDriver: false,
          damping: 18,
          stiffness: 160,
          mass: 0.8,
        })
      : Animated.timing(categoryPickerSpacingAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: false,
        });

    animation.start();
    return () => animation.stop();
  }, [categoryPickerOpen, categoryPickerSpacingAnim]);

  const categoryPickerMarginBottom = categoryPickerSpacingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-CATEGORY_PICKER_MARGIN, 0],
  });
  const categoryChevronRotation = categoryPickerSpacingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  /** 변경 및 닫기 확인 상태를 초기화해 현재 초안을 폐기된 상태로 표시합니다. */
  const discardDraft = useCallback(() => {
    formDirtyRef.current = false;
    closePromptVisibleRef.current = false;
  }, []);

  const [startDay, setStartDay] = useState(
    () => new Date(`${defaultDay}T00:00:00`),
  );
  const [endDay, setEndDay] = useState(
    () => new Date(`${defaultDay}T00:00:00`),
  );
  const [startTime, setStartTime] = useState(() =>
    getDefaultScheduleStartTime(),
  );
  const [endTime, setEndTime] = useState(() => getDefaultScheduleStartTime());
  const wasVisibleRef = useRef(false);
  const destinationResolutionSequenceRef = useRef(0);

  /** 새 일정 작성에 사용할 기본 날짜·카테고리·알림·경로 값을 일괄 초기화합니다. */
  const resetFormForNewSchedule = useCallback(() => {
    discardDraft();
    morphMeasuredContentHeightRef.current = null;
    setMorphMeasuredContentHeight(null);
    const defaultStart = getDefaultScheduleFormStart(defaultDay);
    setTitle('');
    setNotes('');
    setMemoExpanded(false);
    setSelectedCategoryId(writableCategories[0]?.id ?? '');
    setCategoryPickerOpen(false);
    setOriginText('');
    setDestinationText('');
    setOriginAddress(undefined);
    setDestinationAddress(undefined);
    setOriginLat(undefined);
    setOriginLng(undefined);
    setDestinationLat(undefined);
    setDestinationLng(undefined);
    setTravelMode('CAR');
    setTravelMinutes(undefined);
    setDepartAt(undefined);
    setRoute(undefined);
    routeTimingTargetArrivalRef.current = undefined;
    pendingRouteTimingTargetArrivalRef.current = undefined;
    setAllDay(false);
    setHasEndTime(false);
    setNotificationEnabled(false);
    setAlertMode('STANDARD');
    setNotificationLeadMinutes(60);
    setNotificationIntervalMinutes(30);
    setRoutePlannerSessionId(undefined);
    setSubmitting(false);
    setTitleFocused(false);
    submitInFlightRef.current = false;
    setFormError(null);
    setRoutePlannerHidden(false);
    setPicker(null);
    setDisplayPicker(null);
    setStartDay(defaultStart.startDay);
    setEndDay(new Date(defaultStart.startDay));
    setStartTime(defaultStart.startTime);
    setEndTime(new Date(defaultStart.startTime));
  }, [defaultDay, discardDraft, writableCategories]);

  // 실제 선택값과 화면 표시값을 분리해 피커 전환 애니메이션을 안정화한다.
  const [picker, setPicker] = useState<PickerType | null>(null);
  const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

  useEffect(() => {
    setStartDay(prev => setYmd(prev, defaultDay));
    setEndDay(prev => setYmd(prev, defaultDay));
  }, [defaultDay]);

  useEffect(() => {
    if (writableCategories.length === 0) return;
    setSelectedCategoryId(current =>
      writableCategories.some(categoryItem => categoryItem.id === current)
        ? current
        : writableCategories[0].id,
    );
  }, [writableCategories]);

  useEffect(() => {
    if (hasEndTime || allDay) return;
    setEndDay(new Date(startDay));
    setEndTime(new Date(startTime));
  }, [allDay, hasEndTime, startDay, startTime]);

  /** 종료 시각 사용 여부를 반영하고 활성화 시 시작 시각보다 한 시간 뒤를 기본값으로 지정합니다. */
  const handleEndTimeEnabledChange = useCallback(
    (enabled: boolean) => {
      markFormDirty();
      setHasEndTime(enabled);

      if (!enabled) {
        setPicker(current =>
          current === 'endDate' || current === 'endTime' ? null : current,
        );
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
        return;
      }

      const nextEnd = mergeDateTime(startDay, startTime);
      nextEnd.setMinutes(nextEnd.getMinutes() + 60);
      setEndDay(nextEnd);
      setEndTime(nextEnd);
    },
    [markFormDirty, startDay, startTime],
  );

  /** 종일 일정 여부를 반영하고 시간 피커와 명시적 종료 시각을 함께 정리합니다. */
  const handleAllDayChange = useCallback(
    (enabled: boolean) => {
      markFormDirty();
      setAllDay(enabled);
      setHasEndTime(false);
      setPicker(current =>
        current === 'startTime' || current === 'endTime' ? null : current,
      );
      setEndDay(new Date(startDay));
      setEndTime(new Date(startTime));
    },
    [markFormDirty, startDay, startTime],
  );

  useEffect(() => {
    const opening = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;

    if (!visible || (opening && !initialValues)) {
      resetFormForNewSchedule();
    }
  }, [initialValues, resetFormForNewSchedule, visible]);

  useEffect(() => {
    if (!visible) return;

    if (!initialValues) {
      return;
    }

    markFormDirty();
    setAllDay(false);
    setTitle(initialValues.title ?? '');
    setNotes(initialValues.notes ?? '');
    setMemoExpanded(Boolean(initialValues.notes?.trim()));

    const parsedOrigin = initialValues.origin;
    setOriginText(getDisplayPlaceText(parsedOrigin));
    setOriginAddress(parsedOrigin?.address);
    setOriginLat(parsedOrigin?.lat);
    setOriginLng(parsedOrigin?.lng);
    setDestinationText(getDisplayPlaceText(initialValues.destination));
    setDestinationAddress(initialValues.destination?.address);
    setDestinationLat(initialValues.destination?.lat);
    setDestinationLng(initialValues.destination?.lng);
    setTravelMinutes(initialValues.travelMinutes);
    setTravelMode(initialValues.travelMode ?? 'CAR');
    setDepartAt(undefined);
    setRoute(initialValues.route);
    setNotificationEnabled(Boolean(initialValues.notificationEnabled));
    setAlertMode(normalizeScheduleAlertMode(initialValues.alertMode));
    if (typeof initialValues.notificationLeadMinutes === 'number') {
      setNotificationLeadMinutes(initialValues.notificationLeadMinutes);
    }
    if (typeof initialValues.notificationIntervalMinutes === 'number') {
      setNotificationIntervalMinutes(initialValues.notificationIntervalMinutes);
    }

    const parsedStart = initialValues.startAt
      ? new Date(initialValues.startAt)
      : null;
    if (parsedStart && !Number.isNaN(parsedStart.getTime())) {
      setStartDay(parsedStart);
      setStartTime(parsedStart);
      routeTimingTargetArrivalRef.current = initialValues.route
        ? parsedStart.toISOString()
        : undefined;
    } else {
      routeTimingTargetArrivalRef.current = undefined;
    }
    pendingRouteTimingTargetArrivalRef.current = undefined;

    const parsedEnd = initialValues.endAt
      ? new Date(initialValues.endAt)
      : null;
    if (parsedEnd && !Number.isNaN(parsedEnd.getTime())) {
      setEndDay(parsedEnd);
      setEndTime(parsedEnd);
      // Parse API v1 generated endAt from the default duration even when the
      // user never entered an end. Missing explicit-end metadata is therefore
      // a backward-compatible false, not something inferred from timestamps.
      setHasEndTime(Boolean(initialValues.hasExplicitEndTime));
    } else {
      setHasEndTime(false);
    }
  }, [initialValues, markFormDirty, visible]);

  useEffect(() => {
    const resolutionSequence = destinationResolutionSequenceRef.current + 1;
    destinationResolutionSequenceRef.current = resolutionSequence;
    if (
      !visible ||
      !initialValues?.destination ||
      hasPlaceCoords(initialValues.destination)
    )
      return;

    const parsedDestinationName = cleanOptionalText(
      initialValues.destination.name,
    );
    const parsedDestinationAddress = cleanOptionalText(
      initialValues.destination.address,
    );
    const queries = uniqueNonBlank([
      parsedDestinationAddress,
      parsedDestinationName,
    ]);
    if (queries.length === 0) return;

    let cancelled = false;
    const resolveDestination = async () => {
      for (const query of queries) {
        const items = await searchAddressByKeyword(query).catch(() => []);
        if (
          cancelled ||
          destinationResolutionSequenceRef.current !== resolutionSequence
        )
          return;

        const match = items[0];
        if (!match) continue;

        setDestinationText(
          current =>
            current.trim() ||
            parsedDestinationName ||
            match.name ||
            parsedDestinationAddress ||
            '',
        );
        setDestinationAddress(parsedDestinationAddress || match.address);
        setDestinationLat(match.lat);
        setDestinationLng(match.lng);
        return;
      }
    };

    resolveDestination();

    return () => {
      cancelled = true;
      if (destinationResolutionSequenceRef.current === resolutionSequence) {
        destinationResolutionSequenceRef.current += 1;
      }
    };
  }, [
    initialValues?.destination,
    initialValues?.destination?.address,
    initialValues?.destination?.lat,
    initialValues?.destination?.lng,
    initialValues?.destination?.name,
    visible,
  ]);

  useEffect(() => {
    let cancelled = false;
    getMySubscriptionPolicy()
      .then(policy => {
        if (cancelled) return;
        setSubscriptionPolicy(policy);
        setNotificationLeadMinutes(current =>
          Math.min(current, policy.maxNotificationLeadMinutes),
        );
        setNotificationIntervalMinutes(current =>
          Math.max(current, policy.minEtaRefreshIntervalMinutes),
        );
      })
      .catch(() => {
        if (!cancelled) setSubscriptionPolicy(FREE_SUBSCRIPTION_POLICY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const category = useMemo(
    () =>
      writableCategories.find(c => c.id === selectedCategoryId) ??
      writableCategories[0],
    [selectedCategoryId, writableCategories],
  );
  const routeInfo = useMemo(
    () =>
      getRouteInfoFromRoute(route, {
        origin:
          originText.trim() || originAddress || typeof originLat === 'number'
            ? {
                name: originText.trim() || originAddress || '출발지',
                address: originAddress,
                lat: originLat,
                lng: originLng,
              }
            : undefined,
        destination:
          destinationText.trim() ||
          destinationAddress ||
          typeof destinationLat === 'number'
            ? {
                name: destinationText.trim() || destinationAddress || '도착지',
                address: destinationAddress,
                lat: destinationLat,
                lng: destinationLng,
              }
            : undefined,
        travelMode,
        travelMinutes,
      }),
    [
      destinationAddress,
      destinationLat,
      destinationLng,
      destinationText,
      originAddress,
      originLat,
      originLng,
      originText,
      route,
      travelMinutes,
      travelMode,
    ],
  );
  const routeReady = !!routeInfo;
  return {
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
  };
}

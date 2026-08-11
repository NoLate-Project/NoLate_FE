import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    Alert,
    Platform,
    ScrollView,
} from "react-native";
import type { DateTimePickerEvent } from "@react-native-community/datetimepicker";

import {
    useNavigation,
    usePreventRemove,
} from "@react-navigation/native";
import {
    useLocalSearchParams,
    usePathname,
    useRouter,
} from "expo-router";
import {
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
    useScheduleStore,
} from "../store";
import {
    useTheme,
} from "../../theme/ThemeContext";
import {
    fromISO,
} from "../../../../lib/util/data";
import type {
    ScheduleAlertMode,
    ScheduleCategory,
    TravelMode,
} from "../types";
import {
    canWriteScheduleCategory,
    getWritableScheduleCategories,
    resolveWritableScheduleCategoryId,
} from "../categoryPermissions";

import {
    getRouteInfoFromRoute,
} from "../routeInfo";

import {
    type ScheduleCalendar,
} from "../../../api/scheduleCalendars";
import {
    getWritableScheduleCalendars,
} from "../calendarPermissions";
import {
    isCategoryInCalendarScope,
} from "../calendarScope";
import {
    FREE_SUBSCRIPTION_POLICY,
    type SubscriptionPolicy,
} from "../../../api/subscription";

import {
    getScheduleAllDayFormEndDay,
    getScheduleCalendarDateKey,
    startOfLocalScheduleDay,
} from "../scheduleFormDate";
import {
    getScheduleAddCloseAction,
} from "../scheduleAddCloseGuard";

import {
    normalizeScheduleAlertMode,
} from "../scheduleAlertMode";
import {
    canChangePresentedScheduleCalendar,
    canDeletePresentedSchedule,
} from "../schedulePermissions";

import {
    getUserVisibleScheduleNotes,
} from "../calendarImportNotes";
import {
    getAuthMember,
} from "../../auth/authStorage";

import {
    SCHEDULE_EDIT_DARK_PAGE_BACKGROUND,
    mergeDateTime,
    type ScheduleEditScreenProps,
} from "./scheduleEditPresentation";
import {
    createScheduleEditMutations,
} from "./scheduleEditMutations";
import {
    useScheduleEditRemoteData,
} from "./useScheduleEditRemoteData";
import {
    useScheduleEditRoutePlanner,
} from "./useScheduleEditRoutePlanner";
import {
    useCategoryPickerAnimation,
    useScheduleDateTimePickerAnimation,
} from "./useScheduleEditPickerAnimations";

/** 일정 편집 화면의 로딩·폼·경로·저장·삭제 상태와 탐색 차단을 관리합니다. */
export function useScheduleEditScreen({ initialScrollToEnd = false, initialCategoryPickerOpen = false }: ScheduleEditScreenProps) {
    const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
    const pathname = usePathname();
    const router     = useRouter();
    const navigation = useNavigation();
    const insets     = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const fieldAccent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const inactiveSwitchTrack = mode === "dark" ? "#3A3A3C" : "#D1D1D6";
    const formPlaceholderColor = mode === "dark"
        ? "rgba(235,235,245,0.50)"
        : "rgba(60,60,67,0.56)";
    const editPageBackground = mode === "dark"
        ? SCHEDULE_EDIT_DARK_PAGE_BACKGROUND
        : colors.background;
    const editPageBackgroundStyle = { backgroundColor: editPageBackground };

    const item = id ? state.itemsById[id] : undefined;
    const developmentPreview = __DEV__ && preview === "1";
    const [currentMemberId, setCurrentMemberId] = useState<number | null>(null);
    const canDeleteSchedule = canDeletePresentedSchedule(item, currentMemberId);
    const canChangeCalendar = canChangePresentedScheduleCalendar(item, currentMemberId);

    const [title,           setTitle]           = useState(item?.title ?? "");
    const [notes,           setNotes]           = useState(getUserVisibleScheduleNotes(item?.notes) ?? "");
    const [titleFocused, setTitleFocused] = useState(false);
    const [notesFocused, setNotesFocused] = useState(false);
    const [categoryId,      setCategoryId]      = useState(
        resolveWritableScheduleCategoryId(item?.category, state.categories)
    );
    const {
        categoryPickerOpen,
        categoryPickerClosing,
        setCategoryPickerExpanded,
        closeCategoryPicker,
        toggleCategoryPicker,
        categoryPickerMarginBottom,
        categoryChevronRotation,
    } = useCategoryPickerAnimation(initialCategoryPickerOpen);
    const [originText,      setOriginText]      = useState(item?.origin?.name ?? "");
    const [destinationText, setDestinationText] = useState(item?.destination?.name ?? "");
    const [originAddress, setOriginAddress]     = useState(item?.origin?.address);
    const [destinationAddress, setDestinationAddress] = useState(item?.destination?.address);
    const [originLat, setOriginLat]             = useState<number | undefined>(item?.origin?.lat);
    const [originLng, setOriginLng]             = useState<number | undefined>(item?.origin?.lng);
    const [destinationLat, setDestinationLat]   = useState<number | undefined>(item?.destination?.lat);
    const [destinationLng, setDestinationLng]   = useState<number | undefined>(item?.destination?.lng);
    const [travelMode, setTravelMode]           = useState<TravelMode>(item?.travelMode ?? "CAR");
    const [travelMinutes, setTravelMinutes]     = useState<number | undefined>(item?.travelMinutes);
    const [departAt, setDepartAt]               = useState<string | undefined>(item?.departAt);
    const [route, setRoute]                     = useState<unknown>(item?.route);
    const [allDay, setAllDay]                   = useState(item?.allDay ?? false);
    const [hasEndTime, setHasEndTime]           = useState(item?.hasEndTime ?? true);
    const [notificationEnabled, setNotificationEnabled] = useState(item?.notificationEnabled ?? false);
    const [alertMode, setAlertMode] = useState<ScheduleAlertMode>(
        normalizeScheduleAlertMode(item?.alertMode),
    );
    const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(item?.notificationLeadMinutes ?? 60);
    const [notificationIntervalMinutes, setNotificationIntervalMinutes] = useState(item?.notificationIntervalMinutes ?? 20);
    const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const routePlannerAwayRef = useRef(false);
    const routeTimingTargetArrivalRef = useRef<string | undefined>(item?.startAt);
    const pendingRouteTimingTargetArrivalRef = useRef<string | undefined>(undefined);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutationPending, setMutationPending] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [categoryLoading, setCategoryLoading] = useState(false);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [categoryRetryKey, setCategoryRetryKey] = useState(0);
    const [calendarId, setCalendarId] = useState<number | null>(item?.calendarId ?? null);
    const [calendars, setCalendars] = useState<ScheduleCalendar[]>([]);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [calendarError, setCalendarError] = useState<string | null>(null);
    const [calendarRetryKey, setCalendarRetryKey] = useState(0);
    const [formDirty, setFormDirty] = useState(false);
    const formDirtyRef = useRef(false);
    const editScrollRef = useRef<ScrollView>(null);
    const initialScrollAppliedRef = useRef(false);
    const allowNavigationRef = useRef(false);
    const mutationPendingRef = useRef(false);
    /** 입력 변경 사실을 상태와 즉시 참조 가능한 ref에 함께 기록합니다. */
    const markFormDirty = useCallback(() => {
        formDirtyRef.current = true;
        setFormDirty(true);
    }, []);

    useEffect(() => {
        if (developmentPreview) return undefined;
        let cancelled = false;

        getAuthMember()
            .then((member) => {
                if (!cancelled) setCurrentMemberId(member?.id ?? null);
            })
            .catch(() => {
                if (!cancelled) setCurrentMemberId(null);
            });

        return () => {
            cancelled = true;
        };
    }, [developmentPreview]);

    /** 저장되지 않은 변경 표시를 초기화해 화면 이탈을 허용합니다. */
    const discardChanges = useCallback(() => {
        formDirtyRef.current = false;
        setFormDirty(false);
    }, []);

    /** 현재 편집 세션을 정리하고 이전 화면 또는 일정 목록으로 이동합니다. */
    const closeEditScreen = useCallback(() => {
        discardChanges();
        router.setParams({ mode: undefined });
    }, [discardChanges, router]);

    /** 변경 내용이 있으면 확인을 요청하고 그렇지 않으면 즉시 편집 화면을 닫습니다. */
    const requestCloseEditScreen = useCallback(() => {
        const action = getScheduleAddCloseAction({
            dirty: formDirtyRef.current,
            submitting: mutationPending || mutationPendingRef.current,
        });
        if (action === "ignore") {
            Alert.alert("처리 중이에요", "일정 저장 또는 삭제가 끝날 때까지 기다려 주세요.");
            return;
        }
        if (action === "close") {
            closeEditScreen();
            return;
        }

        Alert.alert("저장하지 않고 나갈까요?", "수정한 내용이 저장되지 않아요.", [
            { text: "계속 수정", style: "cancel" },
            { text: "나가기", style: "destructive", onPress: closeEditScreen },
        ]);
    }, [closeEditScreen, mutationPending]);

    usePreventRemove(formDirty || mutationPending, ({ data }) => {
        if (allowNavigationRef.current) {
            navigation.dispatch(data.action);
            return;
        }
        if (mutationPending || mutationPendingRef.current) {
            Alert.alert("처리 중이에요", "일정 저장 또는 삭제가 끝날 때까지 기다려 주세요.");
            return;
        }
        if (!formDirtyRef.current) {
            navigation.dispatch(data.action);
            return;
        }

        Alert.alert("저장하지 않고 나갈까요?", "수정한 내용이 저장되지 않아요.", [
            { text: "계속 수정", style: "cancel" },
            {
                text: "나가기",
                style: "destructive",
                onPress: () => {
                    discardChanges();
                    navigation.dispatch(data.action);
                },
            },
        ]);
    });

    const [startDay,  setStartDay]  = useState(() =>
        item ? startOfLocalScheduleDay(fromISO(item.startAt)) : startOfLocalScheduleDay(new Date())
    );
    const [endDay,    setEndDay]    = useState(() =>
        item
            ? item.allDay
                ? getScheduleAllDayFormEndDay(fromISO(item.startAt), fromISO(item.endAt))
                : startOfLocalScheduleDay(fromISO(item.endAt))
            : startOfLocalScheduleDay(new Date())
    );
    const [startTime, setStartTime] = useState(() => item ? fromISO(item.startAt) : new Date());
    const [endTime,   setEndTime]   = useState(() => item ? fromISO(item.endAt)   : new Date());

    const {
        picker,
        setPicker,
        displayPicker,
        togglePicker,
        heightAnim,
        outerOpacity,
        contentFade,
    } = useScheduleDateTimePickerAnimation();

    const categoryOptions = useMemo(() => {
        const writableCategories = getWritableScheduleCategories(state.categories)
            .filter((candidate) => isCategoryInCalendarScope(
                candidate,
                calendarId === null ? "personal" : calendarId,
            ));
        const currentCategory = item?.category
            ? { ...item.category, calendarId: item.calendarId ?? null }
            : undefined;
        if (
            !currentCategory
            || currentCategory.calendarId !== calendarId
            || !canWriteScheduleCategory(currentCategory)
            || writableCategories.some((categoryItem) => categoryItem.id === currentCategory.id)
        ) {
            return writableCategories;
        }
        return [currentCategory, ...writableCategories];
    }, [calendarId, item?.calendarId, item?.category, state.categories]);
    const writableCalendars = useMemo(
        () => getWritableScheduleCalendars(calendars),
        [calendars],
    );

    const category = useMemo<ScheduleCategory | undefined>(
        () => categoryOptions.find((c) => c.id === categoryId) ?? categoryOptions[0],
        [categoryOptions, categoryId]
    );
    const routeInfo = useMemo(() => getRouteInfoFromRoute(route, {
        origin: originText.trim() || originAddress || typeof originLat === "number"
            ? { name: originText.trim() || originAddress || "출발지", address: originAddress, lat: originLat, lng: originLng }
            : undefined,
        destination: destinationText.trim() || destinationAddress || typeof destinationLat === "number"
            ? { name: destinationText.trim() || destinationAddress || "도착지", address: destinationAddress, lat: destinationLat, lng: destinationLng }
            : undefined,
        travelMode,
        travelMinutes,
    }), [
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
    ]);
    const routeReady = !!routeInfo;

    const { retryCategoryLoad } = useScheduleEditRemoteData({
        developmentPreview,
        id,
        retryKey,
        routePlannerSessionId,
        formDirtyRef,
        dispatch,
        setDetailLoading,
        setDetailError,
        categoryRetryKey,
        setCategoryRetryKey,
        setCategoryLoading,
        setCategoryError,
        calendarRetryKey,
        setCalendarLoading,
        setCalendarError,
        setCalendars,
        itemNotificationEnabled: item?.notificationEnabled,
        setSubscriptionPolicy,
        setNotificationLeadMinutes,
        setNotificationIntervalMinutes,
    });

    useEffect(() => {
        if (!item) return;
        if (formDirtyRef.current) return;

        setTitle(item.title);
        setNotes(getUserVisibleScheduleNotes(item.notes) ?? "");
        const nextCalendarId = item.calendarId ?? null;
        setCalendarId(nextCalendarId);
        const scopedCategories = state.categories.filter((candidate) => (
            (candidate.calendarId ?? null) === nextCalendarId
        ));
        setCategoryId(resolveWritableScheduleCategoryId(item.category, scopedCategories));
        setOriginText(item.origin?.name ?? "");
        setDestinationText(item.destination?.name ?? "");
        setOriginAddress(item.origin?.address);
        setDestinationAddress(item.destination?.address);
        setOriginLat(item.origin?.lat);
        setOriginLng(item.origin?.lng);
        setDestinationLat(item.destination?.lat);
        setDestinationLng(item.destination?.lng);
        setTravelMode(item.travelMode ?? "CAR");
        setTravelMinutes(item.travelMinutes);
        setDepartAt(item.departAt);
        setRoute(item.route);
        routeTimingTargetArrivalRef.current = item.startAt;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setAllDay(item.allDay ?? false);
        setHasEndTime(item.hasEndTime ?? fromISO(item.endAt).getTime() > fromISO(item.startAt).getTime());
        setNotificationEnabled(item.notificationEnabled ?? false);
        setAlertMode(normalizeScheduleAlertMode(item.alertMode));
        setNotificationLeadMinutes(item.notificationLeadMinutes ?? 60);
        setNotificationIntervalMinutes(item.notificationIntervalMinutes ?? 20);
        setStartDay(startOfLocalScheduleDay(fromISO(item.startAt)));
        setEndDay(item.allDay
            ? getScheduleAllDayFormEndDay(fromISO(item.startAt), fromISO(item.endAt))
            : startOfLocalScheduleDay(fromISO(item.endAt)));
        setStartTime(fromISO(item.startAt));
        setEndTime(fromISO(item.endAt));
    }, [item, state.categories]);

    useEffect(() => {
        if (hasEndTime || allDay) return;
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [allDay, hasEndTime, startDay, startTime]);

    /** 종료 시각 사용 여부를 바꾸고 유효한 일정 범위를 유지합니다. */
    const handleEndTimeEnabledChange = useCallback((enabled: boolean) => {
        markFormDirty();
        setHasEndTime(enabled);

        if (!enabled) {
            setPicker((current) => (
                current === "endDate" || current === "endTime" ? null : current
            ));
            setEndDay(new Date(startDay));
            setEndTime(new Date(startTime));
            return;
        }

        const nextEnd = mergeDateTime(startDay, startTime);
        nextEnd.setMinutes(nextEnd.getMinutes() + 60);
        setEndDay(nextEnd);
        setEndTime(nextEnd);
    }, [markFormDirty, setPicker, startDay, startTime]);

    /** 종일 일정 전환 시 날짜·시간 범위를 일관된 값으로 정규화합니다. */
    const handleAllDayChange = useCallback((enabled: boolean) => {
        markFormDirty();
        setAllDay(enabled);
        setHasEndTime(false);
        setPicker((current) => (
            current === "startTime" || current === "endTime" ? null : current
        ));

        if (enabled) {
            if (endDay.getTime() < startDay.getTime()) setEndDay(new Date(startDay));
            return;
        }

        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [endDay, markFormDirty, setPicker, startDay, startTime]);

    const { openRoutePlanner, clearRoute } = useScheduleEditRoutePlanner({
        pathname,
        router,
        routePlannerSessionId,
        setRoutePlannerSessionId,
        routePlannerAwayRef,
        routeTimingTargetArrivalRef,
        pendingRouteTimingTargetArrivalRef,
        markFormDirty,
        originText,
        originAddress,
        originLat,
        originLng,
        destinationText,
        destinationAddress,
        destinationLat,
        destinationLng,
        travelMode,
        travelMinutes,
        departAt,
        route,
        allDay,
        startDay,
        startTime,
        setOriginText,
        setOriginAddress,
        setOriginLat,
        setOriginLng,
        setDestinationText,
        setDestinationAddress,
        setDestinationLat,
        setDestinationLng,
        setTravelMode,
        setTravelMinutes,
        setDepartAt,
        setRoute,
        setNotificationEnabled,
    });

    if (!item) {
        return {
            unavailable: {
                loading: detailLoading,
                error: detailError,
                backgroundStyle: editPageBackgroundStyle,
                topInset: insets.top,
                colors,
                requestClose: requestCloseEditScreen,
                retry: () => setRetryKey((value) => value + 1),
            },
        } as const;
    }

    // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
    /** 캘린더에서 선택한 날짜를 시작일 또는 종료일에 반영하고 범위 역전을 보정합니다. */
    const onDayPress = (day: { dateString: string }) => {
        markFormDirty();
        const selected = new Date(`${day.dateString}T00:00:00`);
        if (picker === "startDate") {
            setStartDay(selected);
            if (selected.getTime() > endDay.getTime()) setEndDay(selected);
        } else if (picker === "endDate") {
            if (!allDay) setHasEndTime(true);
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    };

    // 시간 피커에서 선택한 시간을 시작/종료 시간에 반영한다.
    /** 플랫폼 시간 피커 결과를 시작·종료 시각에 반영하고 취소 이벤트를 처리합니다. */
    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android" && event.type === "dismissed") { setPicker(null); return; }
        if (!selected) return;
        markFormDirty();
        if (picker === "startTime") setStartTime(selected);
        else if (picker === "endTime") {
            setHasEndTime(true);
            setEndTime(selected);
        }
        if (Platform.OS === "android") setPicker(null);
    };

    const { save, remove } = createScheduleEditMutations({
        title,
        category,
        mutationPending,
        mutationPendingRef,
        startDay,
        startTime,
        endDay,
        endTime,
        allDay,
        hasEndTime,
        originText,
        originAddress,
        originLat,
        originLng,
        destinationText,
        destinationAddress,
        destinationLat,
        destinationLng,
        departAt,
        route,
        travelMinutes,
        routeTimingTargetArrivalRef,
        notificationEnabled,
        notificationLeadMinutes,
        notificationIntervalMinutes,
        alertMode,
        item,
        travelMode,
        canChangeCalendar,
        calendarId,
        notes,
        dispatch,
        markFormDirty,
        closeEditScreen,
        setMutationPending,
        discardChanges,
        allowNavigationRef,
        router,
    });

    const calendarTheme = {
        calendarBackground:         colors.surface,
        textSectionTitleColor:      colors.textSecondary,
        selectedDayBackgroundColor: colors.selectedDayBg,
        selectedDayTextColor:       colors.selectedDayText,
        todayTextColor:             colors.todayBorderColor,
        dayTextColor:               colors.textPrimary,
        textDisabledColor:          colors.textDisabled,
        arrowColor:                 colors.arrowColor,
        monthTextColor:             colors.monthTextColor,
        textDayFontWeight:          "600" as const,
        textMonthFontWeight:        "700" as const,
        textDayHeaderFontWeight:    "500" as const,
    };

    const isDisplayDate = displayPicker === "startDate" || displayPicker === "endDate";
    const isDisplayTime = displayPicker === "startTime" || displayPicker === "endTime";
    const calendarSelected = isDisplayDate
        ? getScheduleCalendarDateKey(displayPicker === "startDate" ? startDay : endDay)
        : "";
    return {
        unavailable: null as null,
        colors,
        mode,
        state,
        initialScrollToEnd,
        id,
        title,
        setTitle,
        notes,
        setNotes,
        titleFocused,
        setTitleFocused,
        notesFocused,
        setNotesFocused,
        categoryId,
        setCategoryId,
        categoryPickerOpen,
        categoryPickerClosing,
        originText,
        destinationText,
        travelMode,
        travelMinutes,
        allDay,
        hasEndTime,
        notificationEnabled,
        setNotificationEnabled,
        alertMode,
        setAlertMode,
        notificationLeadMinutes,
        setNotificationLeadMinutes,
        notificationIntervalMinutes,
        setNotificationIntervalMinutes,
        subscriptionPolicy,
        detailLoading,
        mutationPending,
        categoryLoading,
        categoryError,
        calendarId,
        setCalendarId,
        calendars,
        calendarLoading,
        calendarError,
        setCalendarRetryKey,
        startDay,
        endDay,
        startTime,
        endTime,
        picker,
        displayPicker,
        pathname,
        router,
        navigation,
        insets,
        fieldAccent,
        inactiveSwitchTrack,
        formPlaceholderColor,
        editPageBackgroundStyle,
        developmentPreview,
        canDeleteSchedule,
        canChangeCalendar,
        editScrollRef,
        initialScrollAppliedRef,
        markFormDirty,
        setCategoryPickerExpanded,
        closeCategoryPicker,
        toggleCategoryPicker,
        categoryPickerMarginBottom,
        categoryChevronRotation,
        requestCloseEditScreen,
        categoryOptions,
        writableCalendars,
        category,
        routeInfo,
        routeReady,
        retryCategoryLoad,
        handleEndTimeEnabledChange,
        handleAllDayChange,
        togglePicker,
        heightAnim,
        outerOpacity,
        contentFade,
        openRoutePlanner,
        clearRoute,
        onDayPress,
        onTimeChange,
        save,
        remove,
        calendarTheme,
        isDisplayDate,
        isDisplayTime,
        calendarSelected,
    };
}

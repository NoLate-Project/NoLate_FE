import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable, Text, TextInput, View,
    Alert, Platform, ScrollView, StyleSheet, Animated, Switch,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Calendar } from "react-native-calendars";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScheduleStore } from "../store";
import { useTheme } from "../../theme/ThemeContext";
import { fromISO } from "../../../../lib/util/data";
import type { ScheduleCategory, TravelMode } from "../types";
import {
    canWriteScheduleCategory,
    getWritableScheduleCategories,
    resolveWritableScheduleCategoryId,
} from "../categoryPermissions";
import {
    buildRoutePlannerPlace,
    buildScheduleRoutePlannerInitial,
    consumeRoutePlannerResult,
    observeRoutePlannerReturn,
    setRoutePlannerInitial,
} from "../routePlannerSession";
import { getRouteInfoFromRoute } from "../routeInfo";
import {
    hasPersistableScheduleRoute,
    reconcileScheduleRouteTiming,
} from "../scheduleRouteTiming";
import CategoryPickerRow from "../components/form/CategorySelectBox";
import ScheduleCalendarSelectBox from "../components/form/ScheduleCalendarSelectBox";
import LocationInputRow from "../components/form/LocationInputRow";
import NotificationSettingsCard from "../components/form/NotificationSettingsCard";
import CategoryLoadErrorBanner from "../components/form/CategoryLoadErrorBanner";
import CalendarGlassSurface from "../components/calendar/CalendarGlassSurface";
import { deleteSchedule, getSchedule, updateSchedule } from "../../../api/schedule";
import { getScheduleCategoriesFromApi } from "../../../api/scheduleCategories";
import {
    FREE_SUBSCRIPTION_POLICY,
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../../api/subscription";
import { BrandedLoadingState } from "../../../ui/BrandedLoader";
import {
    formatScheduleFormDate,
    getScheduleAllDayFormEndDay,
    getScheduleCalendarDateKey,
    normalizeScheduleFormRange,
    startOfLocalScheduleDay,
} from "../scheduleFormDate";
import { getScheduleAddCloseAction } from "../scheduleAddCloseGuard";
import {
    buildScheduleFormLocationName,
    buildScheduleFormPlace,
} from "../scheduleFormPlace";
import {
    getScheduleCalendars,
    type ScheduleCalendar,
} from "../../../api/scheduleCalendars";
import { getWritableScheduleCalendars } from "../calendarPermissions";
import { canDeletePresentedSchedule } from "../schedulePermissions";
import { isScheduleSharingEnabled } from "../../share/scheduleSharingPolicy";

const pad2    = (n: number) => String(n).padStart(2, "0");
const hhmmText = (d: Date)  => `${d.getHours() < 12 ? "오전" : "오후"} ${d.getHours() % 12 || 12}:${pad2(d.getMinutes())}`;

// 날짜 객체와 시간 객체를 하나의 일정 시각으로 합친다.
function mergeDateTime(datePart: Date, timePart: Date) {
    const d = new Date(datePart);
    d.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
    return d;
}

const DATE_H = 312;
const TIME_H = 216;

type PickerType = "startDate" | "endDate" | "startTime" | "endTime";

const isDateType    = (t: PickerType | null): boolean => t === "startDate" || t === "endDate";
const pickerTargetH = (t: PickerType | null): number  => t !== null && isDateType(t) ? DATE_H : TIME_H;

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleEdit() {
    const { id }     = useLocalSearchParams<{ id: string }>();
    const pathname = usePathname();
    const router     = useRouter();
    const navigation = useNavigation();
    const insets     = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const scheduleSharingEnabled = isScheduleSharingEnabled();

    const item = id ? state.itemsById[id] : undefined;
    const canDeleteSchedule = canDeletePresentedSchedule(item);

    const [title,           setTitle]           = useState(item?.title ?? "");
    const [notes,           setNotes]           = useState(item?.notes ?? "");
    const [categoryId,      setCategoryId]      = useState(
        resolveWritableScheduleCategoryId(item?.category, state.categories)
    );
    const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
    const [calendars, setCalendars] = useState<ScheduleCalendar[]>([]);
    const [calendarId, setCalendarId] = useState<number | null>(item?.calendarId ?? null);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [calendarError, setCalendarError] = useState<string | null>(null);
    const [calendarRetryKey, setCalendarRetryKey] = useState(0);
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
    const [formDirty, setFormDirty] = useState(false);
    const formDirtyRef = useRef(false);
    const allowNavigationRef = useRef(false);
    const mutationPendingRef = useRef(false);
    const markFormDirty = useCallback(() => {
        formDirtyRef.current = true;
        setFormDirty(true);
    }, []);

    const discardChanges = useCallback(() => {
        formDirtyRef.current = false;
        setFormDirty(false);
    }, []);

    const closeEditScreen = useCallback(() => {
        discardChanges();
        router.setParams({ mode: undefined });
    }, [discardChanges, router]);

    const requestCloseEditScreen = useCallback(() => {
        const action = getScheduleAddCloseAction({
            dirty: formDirtyRef.current,
            submitting: mutationPending || mutationPendingRef.current,
        });
        if (action === "ignore") {
            Alert.alert("처리 중이에요", "일정 저장 또는 삭제가 끝난 뒤 다시 시도해 주세요.");
            return;
        }
        if (action === "close") {
            closeEditScreen();
            return;
        }

        Alert.alert("변경사항을 버릴까요?", "저장하지 않은 일정 수정 내용이 사라집니다.", [
            { text: "계속 수정", style: "cancel" },
            { text: "버리기", style: "destructive", onPress: closeEditScreen },
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

        Alert.alert("변경사항을 버릴까요?", "저장하지 않은 일정 수정 내용이 사라집니다.", [
            { text: "계속 수정", style: "cancel" },
            {
                text: "버리기",
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

    // 실제 선택값과 화면 표시값을 분리해 피커 전환 애니메이션을 안정화한다.
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    const categoryOptions = useMemo(() => {
        const writableCategories = getWritableScheduleCategories(state.categories);
        if (
            !item?.category
            || !canWriteScheduleCategory(item.category)
            || writableCategories.some((categoryItem) => categoryItem.id === item.category.id)
        ) {
            return writableCategories;
        }
        return [item.category, ...writableCategories];
    }, [item?.category, state.categories]);

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

    useEffect(() => {
        if (!id) return;
        // 경로 선택 화면을 오가는 동안에는 이미 불러온 일정과 로컬 경로 초안을 유지한다.
        // 복귀 직후 재조회가 시작되면 detailLoading 때문에 실제 변경사항이 있어도 저장 버튼이
        // 잠시 비활성화되고, 느린 응답이 새 경로와 경쟁할 수 있다.
        if (routePlannerSessionId || formDirtyRef.current) {
            setDetailLoading(false);
            return;
        }
        let cancelled = false;
        setDetailLoading(true);
        setDetailError(null);

        getSchedule(id)
            .then((detail) => {
                if (cancelled) return;
                dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                if (cancelled) return;
                setDetailError(getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch, id, retryKey, routePlannerSessionId]);

    useEffect(() => {
        let cancelled = false;
        setCategoryLoading(true);

        getScheduleCategoriesFromApi()
            .then((categories) => {
                if (cancelled) return;
                dispatch({ type: "SET_CATEGORIES", categories });
                setCategoryError(null);
            })
            .catch(() => {
                if (!cancelled) setCategoryError("카테고리를 불러오지 못했어요.");
            })
            .finally(() => {
                if (!cancelled) setCategoryLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [categoryRetryKey, dispatch]);

    const retryCategoryLoad = useCallback(() => {
        setCategoryRetryKey((value) => value + 1);
    }, []);

    useEffect(() => {
        if (!scheduleSharingEnabled) {
            setCalendars([]);
            setCalendarLoading(false);
            setCalendarError(null);
            return;
        }

        let cancelled = false;
        setCalendarLoading(true);
        setCalendarError(null);

        getScheduleCalendars()
            .then((result) => {
                if (cancelled) return;
                setCalendars(getWritableScheduleCalendars(result));
            })
            .catch(() => {
                if (!cancelled) setCalendarError("공유 캘린더를 불러오지 못했어요.");
            })
            .finally(() => {
                if (!cancelled) setCalendarLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [calendarRetryKey, scheduleSharingEnabled]);

    useEffect(() => {
        let cancelled = false;
        getMySubscriptionPolicy()
            .then((policy) => {
                if (cancelled) return;
                setSubscriptionPolicy(policy);
                if (!item?.notificationEnabled) {
                    setNotificationLeadMinutes((current) =>
                        Math.min(current, policy.maxNotificationLeadMinutes)
                    );
                    setNotificationIntervalMinutes((current) =>
                        Math.max(current, policy.minEtaRefreshIntervalMinutes)
                    );
                }
            })
            .catch(() => {
                if (!cancelled) setSubscriptionPolicy(FREE_SUBSCRIPTION_POLICY);
            });
        return () => {
            cancelled = true;
        };
    }, [item?.notificationEnabled]);

    useEffect(() => {
        if (!item) return;
        if (formDirtyRef.current) return;

        setTitle(item.title);
        setNotes(item.notes ?? "");
        setCategoryId(resolveWritableScheduleCategoryId(item.category, state.categories));
        setCalendarId(item.calendarId ?? null);
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
    }, [markFormDirty, startDay, startTime]);

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
    }, [endDay, markFormDirty, startDay, startTime]);

    // 날짜/시간 필드를 열거나 같은 필드를 다시 눌러 닫는다.
    const togglePicker = useCallback((type: PickerType) => {
        setPicker((prev) => (prev === type ? null : type));
    }, []);

    // 날짜/시간 피커의 높이와 투명도 전환을 관리한다.
    const heightAnim   = useRef(new Animated.Value(0)).current;
    const outerOpacity = useRef(new Animated.Value(0)).current;
    const contentFade  = useRef(new Animated.Value(1)).current;
    const prevPickerRef = useRef<PickerType | null>(null);

    useEffect(() => {
        const prev = prevPickerRef.current;
        prevPickerRef.current = picker;

        if (picker !== null && prev === null) {
            // 피커를 처음 열 때 높이와 투명도를 함께 올린다.
            setDisplayPicker(picker);
            Animated.parallel([
                Animated.spring(heightAnim, {
                    toValue: pickerTargetH(picker),
                    useNativeDriver: false,
                    damping: 18, stiffness: 160, mass: 0.8,
                }),
                Animated.timing(outerOpacity, {
                    toValue: 1, duration: 200, useNativeDriver: false,
                }),
            ]).start();

        } else if (picker === null && prev !== null) {
            // 피커를 닫을 때 컨테이너 높이를 접는다.
            Animated.parallel([
                Animated.timing(heightAnim,   { toValue: 0, duration: 220, useNativeDriver: false }),
                Animated.timing(outerOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
            ]).start(({ finished }) => {
                if (finished) setDisplayPicker(null);
            });

        } else if (picker !== null && prev !== null) {
            if (isDateType(picker) !== isDateType(prev)) {
                // 날짜 피커와 시간 피커가 바뀔 때 콘텐츠를 페이드 전환한다.
                Animated.timing(contentFade, {
                    toValue: 0, duration: 120, useNativeDriver: false,
                }).start(({ finished }) => {
                    if (!finished) return;
                    setDisplayPicker(picker);
                    Animated.parallel([
                        Animated.spring(heightAnim, {
                            toValue: pickerTargetH(picker),
                            useNativeDriver: false,
                            damping: 18, stiffness: 160, mass: 0.8,
                        }),
                        Animated.timing(contentFade, {
                            toValue: 1, duration: 220, useNativeDriver: false,
                        }),
                    ]).start();
                });
            } else {
                // 시작/종료처럼 같은 타입끼리는 내용만 교체한다.
                setDisplayPicker(picker);
            }
        }
    }, [picker, contentFade, heightAnim, outerOpacity]);

    // 현재 입력한 장소와 일정 시작 시각을 경로 선택 화면에 그대로 전달한다.
    const openRoutePlanner = useCallback(() => {
        const nextOrigin = buildRoutePlannerPlace({
            name: originText,
            address: originAddress,
            lat: originLat,
            lng: originLng,
        }, "출발지");
        const nextDestination = buildRoutePlannerPlace({
            name: destinationText,
            address: destinationAddress,
            lat: destinationLat,
            lng: destinationLng,
        }, "도착지");
        const sessionId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const targetArrivalAt = allDay
            ? startOfLocalScheduleDay(startDay)
            : mergeDateTime(startDay, startTime);
        pendingRouteTimingTargetArrivalRef.current = targetArrivalAt.toISOString();
        setRoutePlannerInitial(sessionId, buildScheduleRoutePlannerInitial({
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            departureAt: departAt,
            route,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name ?? nextOrigin?.name,
            targetArrivalAt,
        }));

        // setState가 실제 화면 전환보다 먼저 반영될 수 있다. 경로 화면 진입을 확인하기 전에는
        // 아직 비어 있는 세션 결과를 소비하지 않는다.
        routePlannerAwayRef.current = false;
        setRoutePlannerSessionId(sessionId);
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        departAt,
        allDay,
        originAddress,
        originLat,
        originLng,
        originText,
        router,
        startDay,
        startTime,
        travelMinutes,
        travelMode,
        route,
    ]);

    const clearRoute = useCallback(() => {
        markFormDirty();
        setOriginText("");
        setDestinationText("");
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
    }, [markFormDirty]);

    useEffect(() => {
        if (!routePlannerSessionId) return;
        const observation = observeRoutePlannerReturn(pathname, routePlannerAwayRef.current);
        routePlannerAwayRef.current = observation.hasVisitedRouteFlow;
        if (!observation.shouldConsumeResult) return;

        const result = consumeRoutePlannerResult(routePlannerSessionId);
        const selectedTargetArrivalAt = pendingRouteTimingTargetArrivalRef.current;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setRoutePlannerSessionId(undefined);
        if (!result) return;

        markFormDirty();
        setOriginText(result.origin?.name ?? "");
        setOriginAddress(result.origin?.address);
        setOriginLat(result.origin?.lat);
        setOriginLng(result.origin?.lng);
        setDestinationText(result.destination?.name ?? "");
        setDestinationAddress(result.destination?.address);
        setDestinationLat(result.destination?.lat);
        setDestinationLng(result.destination?.lng);
        setTravelMode(result.travelMode);
        setTravelMinutes(result.travelMinutes);
        setDepartAt(result.departureAt);
        setRoute(result.route);
        routeTimingTargetArrivalRef.current = selectedTargetArrivalAt ?? result.targetArrivalAt;
    }, [markFormDirty, pathname, routePlannerSessionId]);

    if (!item) {
        if (detailLoading) {
            return (
                <View style={{ flex: 1, backgroundColor: colors.background }}>
                    <BrandedLoadingState
                        fill
                        size="full"
                        variant="schedule"
                        accessibilityLabel="수정할 일정을 불러오고 있어요"
                        title="일정을 불러오고 있어요"
                        caption="수정할 일정 정보를 확인하고 있어요"
                    />
                </View>
            );
        }

        return (
            <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: insets.top + 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary }}>
                    {detailError ?? "일정을 찾을 수 없어요."}
                </Text>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 16 }}>
                    <Pressable accessibilityRole="button" onPress={requestCloseEditScreen}>
                        <Text style={{ color: colors.textPrimary, fontWeight: "800" }}>돌아가기</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setRetryKey((value) => value + 1)}>
                        <Text style={{ color: colors.selectedDayBg, fontWeight: "900" }}>다시 시도</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
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

    // 수정된 입력값을 백엔드에 저장한 뒤 일정 저장소에 반영한다.
    const save = async () => {
        const t = title.trim();
        if (!t || !category || mutationPending || mutationPendingRef.current) return;

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
        const locationName = buildScheduleFormLocationName(nextOrigin, nextDestination);
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
            nextDestination
        );

        try {
            mutationPendingRef.current = true;
            setMutationPending(true);
            const effectiveCalendarId = scheduleSharingEnabled
                ? calendarId
                : item.calendarId ?? null;
            const updated = await updateSchedule(item.id, {
                title: t,
                category,
                calendarId: effectiveCalendarId,
                calendarContentModeOverride: effectiveCalendarId === item.calendarId
                    ? item.calendarContentModeOverride
                    : null,
                startAt: nextStartAt,
                endAt: normalizedRange.endAt.toISOString(),
                hasEndTime: normalizedRange.hasEndTime,
                travelMode: hasRoutePlan ? travelMode : undefined,
                travelMinutes: hasRoutePlan ? travelMinutes : undefined,
                departAt: hasRoutePlan ? reconciledRouteTiming.departAt : undefined,
                locationName,
                destination: nextDestination,
                origin: hasRoutePlan ? nextOrigin : undefined,
                notes: notes.trim() || undefined,
                allDay: normalizedRange.allDay,
                route: hasRoutePlan ? reconciledRouteTiming.route : undefined,
                notificationEnabled: hasRoutePlan && notificationEnabled,
                notificationLeadMinutes: hasRoutePlan && notificationEnabled
                    ? notificationLeadMinutes
                    : undefined,
                notificationIntervalMinutes: hasRoutePlan && notificationEnabled
                    ? notificationIntervalMinutes
                    : undefined,
            });
            dispatch({ type: "UPDATE_ITEM", item: updated });
            closeEditScreen();
        } catch (error) {
            Alert.alert("일정 수정 실패", getErrorMessage(error));
        } finally {
            mutationPendingRef.current = false;
            setMutationPending(false);
        }
    };

    // 현재 일정을 삭제하고 이전 화면으로 돌아간다.
    const remove = () => {
        if (mutationPending || mutationPendingRef.current) return;
        Alert.alert("삭제", "이 일정을 삭제할까요?", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: async () => {
                    try {
                        if (mutationPendingRef.current) return;
                        mutationPendingRef.current = true;
                        setMutationPending(true);
                        await deleteSchedule(item.id);
                        discardChanges();
                        allowNavigationRef.current = true;
                        router.replace("/schedule");
                        setTimeout(() => {
                            dispatch({ type: "DELETE_ITEM", id: item.id });
                        }, 0);
                    } catch (error) {
                        Alert.alert("일정 삭제 실패", getErrorMessage(error));
                    } finally {
                        mutationPendingRef.current = false;
                        setMutationPending(false);
                    }
                },
            },
        ]);
    };

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
    const fieldStyle = (type: PickerType) => ({
        borderWidth: 1,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderColor:     picker === type ? colors.inputBorderFocused : colors.inputBorder,
        backgroundColor: colors.inputBackground,
    });

    return (
        <>
        <ScrollView
            style={[styles.editRoot, { backgroundColor: colors.background }]}
            contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
            keyboardShouldPersistTaps="handled"
        >
            <CalendarGlassSurface
                prominent
                variant="sheet"
                style={[styles.editSheet, { borderColor: colors.border }]}
            >
            <View style={styles.headerRow}>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>일정 수정</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="일정 수정 닫기"
                    onPress={requestCloseEditScreen}
                    style={[
                        styles.closeBtn,
                        {
                            backgroundColor: mode === "dark"
                                ? "rgba(255,255,255,0.08)"
                                : "rgba(118,118,128,0.12)",
                            borderColor: colors.border,
                        },
                    ]}
                >
                    <Text style={[styles.closeBtnText, { color: colors.textPrimary }]}>뒤로</Text>
                </Pressable>
            </View>

            {categoryError ? (
                <CategoryLoadErrorBanner
                    retrying={categoryLoading}
                    onRetry={retryCategoryLoad}
                />
            ) : null}

            <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
            <View
                style={[
                    styles.titleInputWrap,
                    {
                        borderColor: colors.inputBorder,
                        backgroundColor: colors.inputBackground,
                    },
                ]}
            >
                <TextInput
                    value={title}
                    onChangeText={(value) => {
                        markFormDirty();
                        setTitle(value);
                    }}
                    accessibilityLabel="일정 제목"
                    maxLength={120}
                    placeholder="예) 회의"
                    placeholderTextColor={colors.inputPlaceholder}
                    style={[styles.titleInput, { color: colors.textPrimary }]}
                />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`카테고리 선택, 현재 ${category?.title ?? "없음"}`}
                    accessibilityState={{ expanded: categoryPickerOpen, disabled: categoryOptions.length === 0 }}
                    onPress={() => setCategoryPickerOpen((current) => !current)}
                    disabled={categoryOptions.length === 0}
                    style={[styles.categoryInlineChip, { borderColor: colors.border }]}
                >
                    <View style={[styles.categoryInlineDot, { backgroundColor: category?.color ?? "#8E8E93" }]} />
                    <Text numberOfLines={1} style={[styles.categoryInlineText, { color: colors.textPrimary }]}>
                        {category?.title ?? "카테고리"}
                    </Text>
                </Pressable>
            </View>

            {categoryPickerOpen && (
                <CategoryPickerRow
                    categories={categoryOptions}
                    value={categoryId}
                    onChange={(nextCategoryId) => {
                        markFormDirty();
                        setCategoryId(nextCategoryId);
                        setCategoryPickerOpen(false);
                    }}
                    onManageCategories={() => router.push("/schedule/categories")}
                />
            )}

            <ScheduleCalendarSelectBox
                calendars={calendars}
                value={calendarId}
                loading={calendarLoading}
                error={calendarError}
                onChange={(nextCalendarId) => {
                    markFormDirty();
                    setCalendarId(nextCalendarId);
                }}
                onRetry={() => setCalendarRetryKey((current) => current + 1)}
                onManageCalendars={() => router.push("/schedule/calendars")}
            />

            <LocationInputRow
                originValue={originText}
                destinationValue={destinationText}
                travelMode={travelMode}
                travelMinutes={travelMinutes}
                routeInfo={routeInfo}
                onPress={openRoutePlanner}
                onClear={routeInfo ? clearRoute : undefined}
            />

            {!!routeInfo && (
                <NotificationSettingsCard
                    routeReady={routeReady}
                    enabled={notificationEnabled}
                    leadMinutes={notificationLeadMinutes}
                    intervalMinutes={notificationIntervalMinutes}
                    routeInfo={routeInfo}
                    startAt={allDay
                        ? startOfLocalScheduleDay(startDay)
                        : mergeDateTime(startDay, startTime)}
                    policy={subscriptionPolicy}
                    onEnabledChange={(value) => { markFormDirty(); setNotificationEnabled(value); }}
                    onLeadMinutesChange={(value) => { markFormDirty(); setNotificationLeadMinutes(value); }}
                    onIntervalMinutesChange={(value) => { markFormDirty(); setNotificationIntervalMinutes(value); }}
                />
            )}

            <View
                style={[
                    styles.endTimeToggleRow,
                    {
                        borderColor: colors.inputBorder,
                        backgroundColor: colors.inputBackground,
                    },
                ]}
            >
                <View style={styles.endTimeToggleCopy}>
                    <Text style={[styles.endTimeToggleTitle, { color: colors.textPrimary }]}>종일</Text>
                    <Text style={[styles.endTimeToggleHint, { color: colors.textSecondary }]}>시간 없이 날짜로만 일정을 표시해요.</Text>
                </View>
                <Switch
                    accessibilityLabel="종일 일정"
                    value={allDay}
                    onValueChange={handleAllDayChange}
                    trackColor={{ false: colors.border, true: mode === "dark" ? "#4B9DFF" : "#2979FF" }}
                    thumbColor="#FFFFFF"
                    style={styles.toggleSwitch}
                />
            </View>

            <View style={styles.twoColRow}>
                <View style={styles.col}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>시작 날짜</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`시작 날짜 ${formatScheduleFormDate(startDay)}`}
                        accessibilityState={{ expanded: picker === "startDate" }}
                        onPress={() => togglePicker("startDate")}
                        style={fieldStyle("startDate")}
                    >
                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{formatScheduleFormDate(startDay)}</Text>
                    </Pressable>
                </View>
                <View style={styles.col}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>
                        {allDay ? "마지막 날" : "시작 시간"}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={allDay
                            ? `마지막 날 ${formatScheduleFormDate(endDay)}`
                            : `시작 시간 ${hhmmText(startTime)}`}
                        accessibilityState={{ expanded: picker === (allDay ? "endDate" : "startTime") }}
                        onPress={() => togglePicker(allDay ? "endDate" : "startTime")}
                        style={fieldStyle(allDay ? "endDate" : "startTime")}
                    >
                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>
                            {allDay ? formatScheduleFormDate(endDay) : hhmmText(startTime)}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {!allDay ? (
                <View
                    style={[
                        styles.endTimeToggleRow,
                        {
                            borderColor: colors.inputBorder,
                            backgroundColor: colors.inputBackground,
                        },
                    ]}
                >
                    <View style={styles.endTimeToggleCopy}>
                        <Text style={[styles.endTimeToggleTitle, { color: colors.textPrimary }]}>종료 시각 설정</Text>
                        <Text style={[styles.endTimeToggleHint, { color: colors.textSecondary }]}>끄면 시작 시각만 일정에 표시돼요.</Text>
                    </View>
                    <Switch
                        accessibilityLabel="종료 시각 설정"
                        value={hasEndTime}
                        onValueChange={handleEndTimeEnabledChange}
                        trackColor={{ false: colors.border, true: mode === "dark" ? "#4B9DFF" : "#2979FF" }}
                        thumbColor="#FFFFFF"
                        style={styles.toggleSwitch}
                    />
                </View>
            ) : null}

            {!allDay && hasEndTime ? (
                <View style={styles.twoColRow}>
                    <View style={styles.col}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>종료 날짜</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`종료 날짜 ${formatScheduleFormDate(endDay)}`}
                            accessibilityState={{ expanded: picker === "endDate" }}
                            onPress={() => togglePicker("endDate")}
                            style={fieldStyle("endDate")}
                        >
                            <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{formatScheduleFormDate(endDay)}</Text>
                        </Pressable>
                    </View>
                    <View style={styles.col}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>종료 시간</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`종료 시간 ${hhmmText(endTime)}`}
                            accessibilityState={{ expanded: picker === "endTime" }}
                            onPress={() => togglePicker("endTime")}
                            style={fieldStyle("endTime")}
                        >
                            <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{hhmmText(endTime)}</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}

            <Animated.View style={[styles.pickerContainer, {
                borderColor:  colors.inputBorder,
                backgroundColor: colors.inputBackground,
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

            <Text style={[styles.label, { color: colors.textSecondary }]}>메모</Text>
            <TextInput
                value={notes}
                onChangeText={(value) => {
                    markFormDirty();
                    setNotes(value);
                }}
                accessibilityLabel="일정 메모"
                multiline
                maxLength={2000}
                placeholder="추가로 기억할 내용을 입력하세요"
                placeholderTextColor={colors.inputPlaceholder}
                style={[
                    styles.input,
                    styles.notesInput,
                    {
                        borderColor: colors.inputBorder,
                        backgroundColor: colors.inputBackground,
                        color: colors.textPrimary,
                    },
                ]}
            />

            <View style={styles.composerActionRow}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="일정 수정 저장"
                    accessibilityState={{ disabled: detailLoading || mutationPending || !title.trim() || !category, busy: mutationPending }}
                    disabled={detailLoading || mutationPending || !title.trim() || !category}
                    onPress={save}
                    style={[
                            styles.saveBtn,
                            {
                                backgroundColor: mode === "dark"
                                    ? "#1E68FF"
                                    : "#2979FF",
                                borderColor: mode === "dark" ? "#4B9DFF" : "#1E68FF",
                                opacity: detailLoading || mutationPending || !title.trim() || !category ? 0.45 : 1,
                            },
                        ]}
                    >
                    <Text style={[styles.saveBtnText, { color: "#FFFFFF" }]}>
                        {mutationPending ? "저장 중" : "저장"}
                    </Text>
                </Pressable>

                {canDeleteSchedule ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 삭제"
                        accessibilityState={{ disabled: detailLoading || mutationPending, busy: mutationPending }}
                        disabled={detailLoading || mutationPending}
                        onPress={remove}
                        style={[
                            styles.deleteBtn,
                            {
                                backgroundColor: mode === "dark"
                                    ? "rgba(239,68,68,0.12)"
                                    : "rgba(239,68,68,0.08)",
                                borderColor: "rgba(239,68,68,0.34)",
                            },
                        ]}
                    >
                        <Text style={styles.deleteBtnText}>삭제</Text>
                    </Pressable>
                ) : null}
            </View>
            </CalendarGlassSurface>
        </ScrollView>
        </>
    );
}

const styles = StyleSheet.create({
    editRoot: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 18,
        paddingBottom: 36,
    },
    editSheet: {
        borderWidth: 1,
        borderRadius: 30,
        padding: 18,
    },
    headerRow: {
        flexDirection: "row", alignItems: "center",
        justifyContent: "space-between", marginBottom: 20,
    },
    headerTitle:  { fontSize: 22, fontWeight: "900" },
    closeBtn:     { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 },
    closeBtnText: { fontWeight: "600", fontSize: 13 },
    previewCard: {
        borderWidth: 1,
        borderRadius: 18,
        minHeight: 116,
        marginBottom: 18,
        padding: 14,
        flexDirection: "row",
        gap: 12,
    },
    previewColorBar: {
        width: 5,
        borderRadius: 999,
        alignSelf: "stretch",
    },
    previewBody: {
        flex: 1,
        minWidth: 0,
    },
    previewTitle: {
        fontSize: 20,
        fontWeight: "900",
        letterSpacing: 0,
    },
    previewMeta: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: "800",
    },
    previewChipRow: {
        marginTop: 10,
        flexDirection: "row",
        gap: 7,
    },
    previewChip: {
        minWidth: 0,
        maxWidth: "50%",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: "rgba(255,255,255,0.055)",
    },
    previewChipText: {
        fontSize: 11,
        fontWeight: "800",
    },
    previewSub: {
        marginTop: 10,
        fontSize: 12,
        fontWeight: "700",
    },
    label:        { marginBottom: 6, fontSize: 13 },
    endTimeToggleRow: {
        minHeight: 58,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 13,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    endTimeToggleCopy: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 9,
    },
    endTimeToggleTitle: {
        fontSize: 13,
        fontWeight: "800",
    },
    endTimeToggleHint: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: "600",
    },
    toggleSwitch: {
        alignSelf: "center",
    },
    input: {
        borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14,
    },
    notesInput: {
        minHeight: 88,
        textAlignVertical: "top",
    },
    titleInputWrap: {
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 16,
        paddingLeft: 12,
        paddingRight: 8,
        marginBottom: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleInput: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 11,
        fontSize: 14,
        fontWeight: "700",
    },
    categoryInlineChip: {
        maxWidth: 116,
        height: 30,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    categoryInlineDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    categoryInlineText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: "800",
    },
    twoColRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    col:       { flex: 1 },
    fieldText: { fontWeight: "700", fontSize: 13 },
    pickerContainer: {
        borderRadius: 16, borderWidth: 1, overflow: "hidden",
    },
    composerActionRow: {
        flexDirection: "row",
        gap: 10,
        marginTop: 8,
    },
    saveBtn: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 18,
        borderWidth: 1,
        alignItems: "center",
    },
    saveBtnText: { fontWeight: "700", fontSize: 15 },
    deleteBtn: {
        minWidth: 92,
        paddingVertical: 14,
        borderRadius: 18,
        alignItems: "center",
        borderWidth: 1,
    },
    deleteBtnText: { color: "#e74c3c", fontWeight: "700", fontSize: 15 },
});

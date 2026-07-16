import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable, Text, TextInput, View,
    Alert, Platform, ScrollView, StyleSheet, Animated,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Calendar } from "react-native-calendars";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScheduleStore } from "../store";
import { useTheme } from "../../theme/ThemeContext";
import { fromISO } from "../../../../lib/util/data";
import type { ScheduleCategory, TravelMode } from "../types";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../routePlannerSession";
import { getRouteInfoFromRoute } from "../routeInfo";
import CategoryPickerRow from "../components/form/CategorySelectBox";
import LocationInputRow from "../components/form/LocationInputRow";
import NotificationSettingsCard from "../components/form/NotificationSettingsCard";
import CalendarGlassSurface from "../components/calendar/CalendarGlassSurface";
import { deleteSchedule, getSchedule, updateSchedule } from "../../../api/schedule";
import { getScheduleCategoriesFromApi } from "../../../api/scheduleCategories";
import {
    FREE_SUBSCRIPTION_POLICY,
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../../api/subscription";
import { BrandedLoadingState } from "../../../ui/BrandedLoader";

const pad2    = (n: number) => String(n).padStart(2, "0");
const ymdText = (d: Date)   => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmmText = (d: Date)  => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

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
    const insets     = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();

    const item = id ? state.itemsById[id] : undefined;

    const [title,           setTitle]           = useState(item?.title ?? "");
    const [categoryId,      setCategoryId]      = useState(item?.category?.id ?? state.categories[0]?.id ?? "1");
    const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
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
    const [route, setRoute]                     = useState<unknown>(item?.route);
    const [hasEndTime, setHasEndTime]           = useState(item?.hasEndTime ?? true);
    const [notificationEnabled, setNotificationEnabled] = useState(item?.notificationEnabled ?? false);
    const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(item?.notificationLeadMinutes ?? 60);
    const [notificationIntervalMinutes, setNotificationIntervalMinutes] = useState(item?.notificationIntervalMinutes ?? 20);
    const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const [detailLoading, setDetailLoading] = useState(false);

    const [startDay,  setStartDay]  = useState(() =>
        item ? new Date(fromISO(item.startAt).toISOString().slice(0, 10) + "T00:00:00") : new Date()
    );
    const [endDay,    setEndDay]    = useState(() =>
        item ? new Date(fromISO(item.endAt).toISOString().slice(0, 10)   + "T00:00:00") : new Date()
    );
    const [startTime, setStartTime] = useState(() => item ? fromISO(item.startAt) : new Date());
    const [endTime,   setEndTime]   = useState(() => item ? fromISO(item.endAt)   : new Date());

    // 실제 선택값과 화면 표시값을 분리해 피커 전환 애니메이션을 안정화한다.
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    const categoryOptions = useMemo(() => {
        if (!item?.category || state.categories.some((categoryItem) => categoryItem.id === item.category.id)) {
            return state.categories;
        }
        return [item.category, ...state.categories];
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
        let cancelled = false;
        setDetailLoading(true);

        getSchedule(id)
            .then((detail) => {
                if (cancelled) return;
                dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                if (cancelled) return;
                const routeFlowActive = pathname === "/schedule/route-select" || pathname === "/schedule/route-planner";
                if (!routeFlowActive) Alert.alert("일정 조회 실패", getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch, id, pathname]);

    useEffect(() => {
        let cancelled = false;

        getScheduleCategoriesFromApi()
            .then((categories) => {
                if (!cancelled && categories.length > 0) {
                    dispatch({ type: "SET_CATEGORIES", categories });
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [dispatch]);

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

        setTitle(item.title);
        setCategoryId(item.category?.id ?? state.categories[0]?.id ?? "1");
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
        setRoute(item.route);
        setHasEndTime(item.hasEndTime ?? fromISO(item.endAt).getTime() > fromISO(item.startAt).getTime());
        setNotificationEnabled(item.notificationEnabled ?? false);
        setNotificationLeadMinutes(item.notificationLeadMinutes ?? 60);
        setNotificationIntervalMinutes(item.notificationIntervalMinutes ?? 20);
        setStartDay(new Date(fromISO(item.startAt).toISOString().slice(0, 10) + "T00:00:00"));
        setEndDay(new Date(fromISO(item.endAt).toISOString().slice(0, 10) + "T00:00:00"));
        setStartTime(fromISO(item.startAt));
        setEndTime(fromISO(item.endAt));
    }, [item, state.categories]);

    useEffect(() => {
        if (hasEndTime) return;
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [hasEndTime, startDay, startTime]);

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

    // 출발지는 경로 선택 화면에서 직접 고르게 두고, 도착지만 초기값으로 전달한다.
    const openRoutePlanner = useCallback(() => {
        const normalizedDestinationName = destinationText.trim();
        const sessionId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        setRoutePlannerInitial(sessionId, {
            origin: undefined,
            destination: normalizedDestinationName
                ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                : undefined,
            travelMode,
            travelMinutes,
            route,
            locationName: normalizedDestinationName || undefined,
        });

        setRoutePlannerSessionId(sessionId);
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });
    }, [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        router,
        travelMinutes,
        travelMode,
        route,
    ]);

    const clearRoute = useCallback(() => {
        setOriginText("");
        setDestinationText("");
        setOriginAddress(undefined);
        setDestinationAddress(undefined);
        setOriginLat(undefined);
        setOriginLng(undefined);
        setDestinationLat(undefined);
        setDestinationLng(undefined);
        setTravelMinutes(undefined);
        setRoute(undefined);
        setNotificationEnabled(false);
    }, []);

    useEffect(() => {
        if (
            !routePlannerSessionId ||
            pathname === "/schedule/route-select" ||
            pathname === "/schedule/route-planner"
        ) return;
        const result = consumeRoutePlannerResult(routePlannerSessionId);
        if (!result) return;

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
        setRoute(result.route);
        setRoutePlannerSessionId(undefined);
    }, [pathname, routePlannerSessionId]);

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
                    일정을 찾을 수 없어요.
                </Text>
            </View>
        );
    }

    // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
    const onDayPress = (day: { dateString: string }) => {
        const selected = new Date(`${day.dateString}T00:00:00`);
        if (picker === "startDate") {
            setStartDay(selected);
        } else if (picker === "endDate") {
            setHasEndTime(true);
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    };

    // 시간 피커에서 선택한 시간을 시작/종료 시간에 반영한다.
    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android" && event.type === "dismissed") { setPicker(null); return; }
        if (!selected) return;
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
        if (!t || !category) return;

        const s = mergeDateTime(startDay, startTime);
        let e = hasEndTime ? mergeDateTime(endDay, endTime) : new Date(s);
        if (hasEndTime && e.getTime() < s.getTime()) {
            e = new Date(s);
            e.setMinutes(e.getMinutes() + 30);
        }
        const hasDistinctEndTime = e.getTime() !== s.getTime();
        const normalizedOriginName = originText.trim();
        const normalizedDestinationName = destinationText.trim();
        const locationName = normalizedOriginName && normalizedDestinationName
            ? `${normalizedOriginName} → ${normalizedDestinationName}`
            : normalizedDestinationName || normalizedOriginName || undefined;

        try {
            setDetailLoading(true);
            const updated = await updateSchedule(item.id, {
                title: t,
                category,
                startAt: s.toISOString(),
                endAt: e.toISOString(),
                hasEndTime: hasDistinctEndTime,
                travelMode,
                travelMinutes,
                locationName,
                destination: normalizedDestinationName
                    ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                    : undefined,
                origin: normalizedOriginName
                    ? { name: normalizedOriginName, address: originAddress, lat: originLat, lng: originLng }
                    : undefined,
                notes: item.notes,
                allDay: item.allDay,
                route,
                notificationEnabled,
                notificationLeadMinutes: notificationEnabled ? notificationLeadMinutes : undefined,
                notificationIntervalMinutes: notificationEnabled ? notificationIntervalMinutes : undefined,
            });
            dispatch({ type: "UPDATE_ITEM", item: updated });
            router.setParams({ mode: undefined });
        } catch (error) {
            Alert.alert("일정 수정 실패", getErrorMessage(error));
        } finally {
            setDetailLoading(false);
        }
    };

    // 현재 일정을 삭제하고 이전 화면으로 돌아간다.
    const remove = () => {
        Alert.alert("삭제", "이 일정을 삭제할까요?", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: async () => {
                    try {
                        setDetailLoading(true);
                        await deleteSchedule(item.id);
                        router.replace("/schedule");
                        setTimeout(() => {
                            dispatch({ type: "DELETE_ITEM", id: item.id });
                        }, 0);
                    } catch (error) {
                        Alert.alert("일정 삭제 실패", getErrorMessage(error));
                    } finally {
                        setDetailLoading(false);
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
        ? ymdText(displayPicker === "startDate" ? startDay : endDay) : "";
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
                    onPress={() => router.setParams({ mode: undefined })}
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
                    onChangeText={setTitle}
                    placeholder="예) 회의"
                    placeholderTextColor={colors.inputPlaceholder}
                    style={[styles.titleInput, { color: colors.textPrimary }]}
                />
                <Pressable
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
                        setCategoryId(nextCategoryId);
                        setCategoryPickerOpen(false);
                    }}
                    onManageCategories={() => router.push("/schedule/categories")}
                />
            )}

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
                    startAt={mergeDateTime(startDay, startTime)}
                    policy={subscriptionPolicy}
                    onEnabledChange={setNotificationEnabled}
                    onLeadMinutesChange={setNotificationLeadMinutes}
                    onIntervalMinutesChange={setNotificationIntervalMinutes}
                />
            )}

            <View style={styles.twoColRow}>
                <View style={styles.col}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>시작 날짜</Text>
                    <Pressable onPress={() => togglePicker("startDate")} style={fieldStyle("startDate")}>
                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{ymdText(startDay)}</Text>
                    </Pressable>
                </View>
                <View style={styles.col}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>시작 시간</Text>
                    <Pressable onPress={() => togglePicker("startTime")} style={fieldStyle("startTime")}>
                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{hhmmText(startTime)}</Text>
                    </Pressable>
                </View>
            </View>

            <View style={styles.twoColRow}>
                <View style={styles.col}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>종료 날짜</Text>
                    <Pressable onPress={() => togglePicker("endDate")} style={fieldStyle("endDate")}>
                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{ymdText(endDay)}</Text>
                    </Pressable>
                </View>
                <View style={styles.col}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>종료 시간</Text>
                    <Pressable onPress={() => togglePicker("endTime")} style={fieldStyle("endTime")}>
                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{hhmmText(endTime)}</Text>
                    </Pressable>
                </View>
            </View>

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

            <View style={styles.composerActionRow}>
                <Pressable
                    disabled={detailLoading}
                    onPress={save}
                    style={[
                            styles.saveBtn,
                            {
                                backgroundColor: mode === "dark"
                                    ? "#1E68FF"
                                    : "#2979FF",
                                borderColor: mode === "dark" ? "#4B9DFF" : "#1E68FF",
                                opacity: detailLoading ? 0.6 : 1,
                            },
                        ]}
                    >
                    <Text style={[styles.saveBtnText, { color: "#FFFFFF" }]}>
                        {detailLoading ? "저장 중" : "저장"}
                    </Text>
                </Pressable>

                <Pressable
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
    input: {
        borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14,
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

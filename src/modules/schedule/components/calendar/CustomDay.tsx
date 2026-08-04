import React from "react";
import {
    View,
    Text,
    Pressable,
    StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Reanimated, {
    useAnimatedStyle,
    type SharedValue,
} from "react-native-reanimated";
import { useTheme } from "../../../theme/ThemeContext";
import {
    formatLunarCalendarDay,
    type CalendarDayMetadata,
} from "../../calendarMetadata";
import type { TravelMode } from "../../types";
import { CALENDAR_DAY_HEIGHTS, type CalendarViewMode } from "./viewMode";
import type {
    StackDayPresentation,
    StackEventPresentation,
} from "./stackCalendarLayout";

type Period = {
    startingDay?: boolean;
    endingDay?: boolean;
    color: string;
};

type Dot = {
    color: string;
    travelMode?: TravelMode;
};

type MarkedEvent = {
    id: string;
    title: string;
    color: string;
    startAt: string;
    allDay?: boolean;
    travelMode?: TravelMode;
};

type Marking = {
    periods?: Period[];
    dots?: Dot[];
    selected?: boolean;
    marked?: boolean;
    events?: MarkedEvent[];
};

type CalendarDate = {
    day: number;
    month: number;
    year: number;
    dateString: string;
    timestamp: number;
};

type Props = {
    date?: CalendarDate;
    state?: string;
    marking?: Marking;
    dayMetadata?: CalendarDayMetadata;
    isSelectedDay?: boolean;
    onPress?: (date: CalendarDate) => void;
    allowDisabledPress?: boolean;
    viewMode: CalendarViewMode;
    animatedCellHeight?: SharedValue<number>;
    animatedSelectedDayKey?: SharedValue<number>;
    detailPagerMonthOrdinal?: number;
    detailCellHeight?: number;
    stackPresentation?: StackDayPresentation;
    stackEventTop?: number;
    hideStackEventLabels?: boolean;
};

const DETAIL_EVENT_MARKER_LIMIT = 3;

function travelIconName(mode: TravelMode): keyof typeof Ionicons.glyphMap {
    if (mode === "TRANSIT") return "bus-outline";
    if (mode === "CAR") return "car-outline";
    if (mode === "WALK") return "walk-outline";
    if (mode === "BIKE") return "bicycle-outline";
    return "navigate-outline";
}

function colorWithOpacity(color: string, opacity: number) {
    const normalized = color.replace("#", "");
    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
        const [red, green, blue] = normalized
            .split("")
            .map((value) => Number.parseInt(value + value, 16));
        return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const red = Number.parseInt(normalized.slice(0, 2), 16);
        const green = Number.parseInt(normalized.slice(2, 4), 16);
        const blue = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
    }
    return color;
}

// 캘린더의 하루 셀을 선택 상태와 일정 마커에 맞춰 렌더링한다.
function CustomDay({
    date,
    state,
    marking,
    dayMetadata,
    isSelectedDay,
    onPress,
    allowDisabledPress = false,
    viewMode,
    animatedCellHeight,
    animatedSelectedDayKey,
    detailPagerMonthOrdinal,
    detailCellHeight,
    stackPresentation,
    stackEventTop,
    hideStackEventLabels = false,
}: Props) {
    const { colors, mode } = useTheme();
    const cellHeight = CALENDAR_DAY_HEIGHTS[viewMode];
    const usesResponsiveDetailGeometry = viewMode === "detail"
        && (
            Boolean(animatedCellHeight)
            || Number.isFinite(detailCellHeight)
        );
    const hasResponsiveHoliday = (dayMetadata?.holidays?.length ?? 0) > 0;
    const [pressedSelection, setPressedSelection] = React.useState(false);
    const isDisabled = state === "disabled";
    const isPressDisabled = isDisabled && !allowDisabledPress;
    const isToday = state === "today";
    const isSelected = pressedSelection || (isSelectedDay ?? marking?.selected);
    const dateKey = date
        ? date.year * 10_000 + date.month * 100 + date.day
        : 0;
    const usesAnimatedDetailSelection = viewMode === "detail"
        && Boolean(animatedSelectedDayKey)
        && dateKey > 0;
    const resolveAnimatedSelectionKey = (selectedKey: number) => {
        "worklet";

        if (detailPagerMonthOrdinal === undefined) return selectedKey;
        const selectedDate = selectedKey % 100;
        const targetYear = Math.floor(detailPagerMonthOrdinal / 12);
        const targetMonth = detailPagerMonthOrdinal - targetYear * 12 + 1;
        const isLeapYear = targetYear % 4 === 0
            && (targetYear % 100 !== 0 || targetYear % 400 === 0);
        const lastDate = targetMonth === 2
            ? isLeapYear ? 29 : 28
            : targetMonth === 4
                || targetMonth === 6
                || targetMonth === 9
                || targetMonth === 11
                ? 30
                : 31;
        return targetYear * 10_000
            + targetMonth * 100
            + Math.min(selectedDate, lastDate);
    };
    const weekday = date
        ? new Date(`${date.dateString}T00:00:00`).getDay()
        : -1;
    const isSunday = weekday === 0;
    const isWeekend = weekday === 0 || weekday === 6;
    const hasHoliday = (dayMetadata?.holidays?.length ?? 0) > 0;
    const weekendDateColor = mode === "dark"
        ? "rgba(235,235,245,0.52)"
        : "rgba(60,60,67,0.52)";
    const todayAccent = mode === "dark" ? "#ff453a" : "#ff3b30";
    const holidayAccent = mode === "dark" ? "#ff6961" : "#d92d20";
    const selectedCircleColor = isToday ? todayAccent : colors.selectedDayBg;
    const selectedTextColor = isToday ? "#ffffff" : colors.selectedDayText;
    const showsFilledCircle = isToday || isSelected;
    const defaultTextColor = isDisabled
        ? colors.textPrimary
        : isToday
        ? todayAccent
        : hasHoliday || isSunday
        ? holidayAccent
        : isWeekend
        ? weekendDateColor
        : colors.textPrimary;
    const animatedCellStyle = useAnimatedStyle(() => ({
        height: viewMode === "detail" && Number.isFinite(detailCellHeight)
            ? Math.max(32, detailCellHeight ?? cellHeight)
            : animatedCellHeight
                ? viewMode === "detail"
                    ? Math.max(32, animatedCellHeight.value)
                    : animatedCellHeight.value
                : cellHeight,
    }), [animatedCellHeight, cellHeight, detailCellHeight, viewMode]);
    const animatedDayCircleStyle = useAnimatedStyle(() => {
        const selectedKey = resolveAnimatedSelectionKey(
            animatedSelectedDayKey?.value ?? 0
        );
        const selectionStyle = usesAnimatedDetailSelection && !isToday
            ? {
                backgroundColor:
                    selectedKey === dateKey
                        ? selectedCircleColor
                        : "transparent",
            }
            : {};
        if (!usesResponsiveDetailGeometry) return selectionStyle;

        const height = Math.max(
            32,
            Math.min(
                cellHeight,
                detailCellHeight ?? animatedCellHeight?.value ?? cellHeight
            )
        );
        const progress = Math.max(0, Math.min(1, (height - 32) / (cellHeight - 32)));
        const size = 16 + 24 * progress;
        return {
            ...selectionStyle,
            width: size,
            height: size,
            borderRadius: size / 2,
            marginTop: 1 + 7 * progress,
        };
    }, [
        animatedCellHeight,
        animatedSelectedDayKey,
        cellHeight,
        dateKey,
        detailCellHeight,
        isToday,
        selectedCircleColor,
        usesAnimatedDetailSelection,
        detailPagerMonthOrdinal,
        usesResponsiveDetailGeometry,
    ]);
    const animatedDayTextStyle = useAnimatedStyle(() => {
        const visuallySelected = resolveAnimatedSelectionKey(
            animatedSelectedDayKey?.value ?? 0
        ) === dateKey;
        const selectionStyle = usesAnimatedDetailSelection && !isToday
            ? {
                color: visuallySelected
                    ? selectedTextColor
                    : defaultTextColor,
                fontWeight: visuallySelected
                    ? ("700" as const)
                    : ("600" as const),
            }
            : {};
        if (!usesResponsiveDetailGeometry) return selectionStyle;

        const height = Math.max(
            32,
            Math.min(
                cellHeight,
                detailCellHeight ?? animatedCellHeight?.value ?? cellHeight
            )
        );
        const progress = Math.max(0, Math.min(1, (height - 32) / (cellHeight - 32)));
        return {
            ...selectionStyle,
            fontSize: 10 + 8 * progress,
            lineHeight: 10 + 10 * progress,
        };
    }, [
        animatedCellHeight,
        animatedSelectedDayKey,
        cellHeight,
        dateKey,
        defaultTextColor,
        detailCellHeight,
        isToday,
        selectedTextColor,
        usesAnimatedDetailSelection,
        detailPagerMonthOrdinal,
        usesResponsiveDetailGeometry,
    ]);
    const animatedLunarTextStyle = useAnimatedStyle(() => {
        const selectedKey = resolveAnimatedSelectionKey(
            animatedSelectedDayKey?.value ?? 0
        );
        const selectionStyle = usesAnimatedDetailSelection && !isToday
            ? {
                color: selectedKey === dateKey
                    ? selectedTextColor
                    : hasHoliday || isSunday
                    ? holidayAccent
                    : colors.textSecondary,
            }
            : {};
        if (!usesResponsiveDetailGeometry) return selectionStyle;

        const height = Math.max(
            32,
            Math.min(
                cellHeight,
                detailCellHeight ?? animatedCellHeight?.value ?? cellHeight
            )
        );
        const progress = Math.max(0, Math.min(1, (height - 32) / (cellHeight - 32)));
        return {
            ...selectionStyle,
            maxWidth: 14 + 24 * progress,
            fontSize: 4.5 + 3.5 * progress,
            lineHeight: 5 + 4 * progress,
        };
    }, [
        animatedCellHeight,
        animatedSelectedDayKey,
        cellHeight,
        colors.textSecondary,
        dateKey,
        detailCellHeight,
        hasHoliday,
        holidayAccent,
        isSunday,
        isToday,
        selectedTextColor,
        usesAnimatedDetailSelection,
        detailPagerMonthOrdinal,
        usesResponsiveDetailGeometry,
    ]);
    const animatedHolidayStyle = useAnimatedStyle(() => {
        if (!usesResponsiveDetailGeometry) return {};

        const height = Math.max(
            32,
            Math.min(
                cellHeight,
                detailCellHeight ?? animatedCellHeight?.value ?? cellHeight
            )
        );
        const progress = Math.max(0, Math.min(1, (height - 32) / (cellHeight - 32)));
        const circleTop = 1 + 7 * progress;
        const circleSize = 16 + 24 * progress;
        return {
            top: circleTop + circleSize + 1,
            fontSize: 5.5 + 3 * progress,
            lineHeight: 6 + 4 * progress,
        };
    }, [
        animatedCellHeight,
        cellHeight,
        detailCellHeight,
        usesResponsiveDetailGeometry,
    ]);
    const animatedDetailMarkersStyle = useAnimatedStyle(() => {
        if (!usesResponsiveDetailGeometry) return {};

        const height = Math.max(
            32,
            Math.min(
                cellHeight,
                detailCellHeight ?? animatedCellHeight?.value ?? cellHeight
            )
        );
        const progress = Math.max(0, Math.min(1, (height - 32) / (cellHeight - 32)));
        const circleTop = 1 + 7 * progress;
        const circleSize = 16 + 24 * progress;
        const holidayLineHeight = 5 + 5 * progress;
        const desiredTop = circleTop
            + circleSize
            + (hasResponsiveHoliday ? holidayLineHeight + 2 : 3);
        return {
            top: Math.min(height - 8, desiredTop),
        };
    }, [
        animatedCellHeight,
        cellHeight,
        detailCellHeight,
        hasResponsiveHoliday,
        usesResponsiveDetailGeometry,
    ]);

    React.useEffect(() => {
        if (!pressedSelection) return;
        if (isSelectedDay) {
            setPressedSelection(false);
            return;
        }

        const resetTimer = setTimeout(() => setPressedSelection(false), 700);
        return () => clearTimeout(resetTimer);
    }, [isSelectedDay, pressedSelection]);

    if (!date) {
        return (
            <Reanimated.View style={[styles.animatedCell, animatedCellStyle]}>
                <View style={[styles.cell, { height: cellHeight }]} />
            </Reanimated.View>
        );
    }

    const lunarText = formatLunarCalendarDay(dayMetadata);
    const holidayNames = (dayMetadata?.holidays ?? []).map((holiday) => holiday.name);
    const holidayText = holidayNames.join(" · ");

    const hasPeriods = !!(marking?.periods && marking.periods.length > 0);
    const hasDots = !!(marking?.dots && marking.dots.length > 0);
    const events = marking?.events ?? [];
    const detailMarkerEvents = events.slice(0, DETAIL_EVENT_MARKER_LIMIT);
    const detailOverflowCount = Math.max(
        0,
        events.length - DETAIL_EVENT_MARKER_LIMIT
    );
    const fallbackStackPresentation: StackDayPresentation = {
        lanes: events.slice(0, 2).map((event, lane): StackEventPresentation => ({
            ...event,
            lane,
            position: "single",
            connectsBefore: false,
            connectsAfter: false,
            showsLabel: true,
        })),
        overflowCount: Math.max(0, events.length - 2),
    };
    const resolvedStackPresentation = stackPresentation ?? fallbackStackPresentation;
    const hasStackPresentation = resolvedStackPresentation.lanes.some(Boolean)
        || resolvedStackPresentation.overflowCount > 0;
    const showDots = viewMode === "week" || viewMode === "list";
    const markerTop = (
        viewMode === "list" ? 47 : viewMode === "week" ? 54 : 53
    ) + (hasHoliday ? 10 : 0);
    const selectedBorderColor = "transparent";
    const triggerPress = () => {
        if (isPressDisabled) return;
        setPressedSelection(true);
        onPress?.(date);
    };
    const accessibilityLabel = [
        `${date.year}년 ${date.month}월 ${date.day}일`,
        isToday ? "오늘" : undefined,
        isSelected ? "선택됨" : undefined,
        lunarText ?? undefined,
        hasHoliday ? `공휴일 ${holidayNames.join(", ")}` : undefined,
        events.length > 0 ? `${events.length}개의 일정` : "일정 없음",
    ].filter(Boolean).join(", ");

    return (
        <Reanimated.View style={[styles.animatedCell, animatedCellStyle]}>
            <Pressable
                testID={`calendar-day-${date.dateString}`}
                onPress={triggerPress}
                disabled={isPressDisabled}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{
                    selected: Boolean(isSelected),
                    disabled: isPressDisabled,
                }}
                style={({ pressed }) => [
                    styles.cell,
                    {
                        height: cellHeight,
                        paddingTop: usesResponsiveDetailGeometry ? 0 : 8,
                    },
                    { opacity: pressed ? 0.55 : 1 },
                ]}
            >
            <Reanimated.View
                testID="calendar-day-circle"
                style={[
                    styles.dayCircle,
                    {
                        backgroundColor: showsFilledCircle ? selectedCircleColor : "transparent",
                        borderColor: selectedBorderColor,
                    },
                    animatedDayCircleStyle,
                ]}
            >
                <Reanimated.Text
                    style={[
                        styles.dayText,
                        {
                            fontWeight: isToday || isSelected ? "700" : "600",
                            color: showsFilledCircle
                                ? selectedTextColor
                                : defaultTextColor,
                            opacity: isDisabled ? 0.28 : 1,
                        },
                        animatedDayTextStyle,
                    ]}
                >
                    {date.day}
                </Reanimated.Text>
                {lunarText && (
                    <Reanimated.Text
                        testID="calendar-lunar-date"
                        numberOfLines={1}
                        style={[
                            styles.lunarText,
                            {
                                color: showsFilledCircle
                                    ? selectedTextColor
                                    : hasHoliday || isSunday
                                    ? holidayAccent
                                    : colors.textSecondary,
                                opacity: isDisabled ? 0.28 : 0.88,
                            },
                            animatedLunarTextStyle,
                        ]}
                    >
                        {lunarText}
                    </Reanimated.Text>
                )}
            </Reanimated.View>

            {hasHoliday && (
                <Reanimated.Text
                    testID="calendar-holiday-name"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[
                        styles.holidayText,
                        {
                            color: holidayAccent,
                            opacity: isDisabled ? 0.28 : 1,
                        },
                        animatedHolidayStyle,
                    ]}
                >
                    {holidayText}
                </Reanimated.Text>
            )}

            {viewMode === "stack" && hasStackPresentation && (
                <View
                    testID="stack-event-chips"
                    style={[
                        styles.stackEventChips,
                        {
                            top: stackEventTop
                                ?? (hasHoliday ? 62 : 52),
                        },
                    ]}
                >
                    {resolvedStackPresentation.lanes.map((event, lane) => event ? (
                        <View
                            key={event.id}
                            testID={`stack-event-chip-${event.id}`}
                            style={[
                                styles.stackEventChip,
                                {
                                    top: lane * 18,
                                    left: event.connectsBefore ? 0 : 2,
                                    right: event.connectsAfter ? 0 : 2,
                                    borderTopLeftRadius: event.connectsBefore ? 0 : 5,
                                    borderBottomLeftRadius: event.connectsBefore ? 0 : 5,
                                    borderTopRightRadius: event.connectsAfter ? 0 : 5,
                                    borderBottomRightRadius: event.connectsAfter ? 0 : 5,
                                    backgroundColor: colorWithOpacity(
                                        event.color,
                                        mode === "dark" ? 0.30 : 0.14
                                    ),
                                },
                            ]}
                        >
                            {!hideStackEventLabels && event.showsLabel && event.travelMode ? (
                                <Ionicons
                                    accessible={false}
                                    name={travelIconName(event.travelMode)}
                                    size={9}
                                    color={event.color}
                                    style={styles.stackEventIcon}
                                />
                            ) : null}
                            {!hideStackEventLabels && event.showsLabel ? (
                                <Text
                                    testID="stack-event-title"
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                    style={[styles.stackEventTitle, { color: event.color }]}
                                >
                                    {event.title}
                                </Text>
                            ) : null}
                        </View>
                    ) : null)}
                    {resolvedStackPresentation.overflowCount > 0 && (
                        <Text
                            testID="stack-event-overflow"
                            numberOfLines={1}
                            style={[styles.stackEventMore, { color: colors.textSecondary }]}
                        >
                            +{resolvedStackPresentation.overflowCount}개
                        </Text>
                    )}
                </View>
            )}

            {viewMode === "detail" && events.length > 0 && (
                <Reanimated.View
                    testID="detail-event-markers"
                    style={[
                        styles.detailMarkers,
                        hasHoliday && styles.detailMarkersWithHoliday,
                        animatedDetailMarkersStyle,
                    ]}
                >
                    {detailMarkerEvents.map((event) => (
                        event.travelMode ? (
                            <Ionicons
                                accessible={false}
                                key={event.id}
                                name={travelIconName(event.travelMode)}
                                size={8}
                                color={event.color}
                                style={styles.detailTravelMarker}
                            />
                        ) : (
                            <View
                                key={event.id}
                                style={[styles.detailDot, { backgroundColor: event.color }]}
                            />
                        )
                    ))}
                    {detailOverflowCount > 0 ? (
                        <Text
                            accessible={false}
                            testID="detail-event-overflow"
                            numberOfLines={1}
                            style={[
                                styles.detailEventMore,
                                { color: colors.textSecondary },
                            ]}
                        >
                            +{detailOverflowCount}개
                        </Text>
                    ) : null}
                </Reanimated.View>
            )}

            {viewMode !== "stack" && viewMode !== "detail" && hasPeriods && (
                <View
                    testID="calendar-period-markers"
                    style={[
                        styles.periods,
                        hasHoliday && styles.periodsWithHoliday,
                    ]}
                >
                    {marking!.periods!.slice(0, 2).map((period, index) => (
                        <View
                            key={index}
                            style={{
                                height: 3,
                                backgroundColor: period.color,
                                marginBottom: 1,
                                borderTopLeftRadius: period.startingDay ? 2 : 0,
                                borderBottomLeftRadius: period.startingDay ? 2 : 0,
                                borderTopRightRadius: period.endingDay ? 2 : 0,
                                borderBottomRightRadius: period.endingDay ? 2 : 0,
                                marginLeft: period.startingDay ? 4 : 0,
                                marginRight: period.endingDay ? 4 : 0,
                            }}
                        />
                    ))}
                </View>
            )}

            {showDots && hasDots && (
                <View
                    testID="calendar-dot-markers"
                    style={[styles.dots, { top: markerTop + 3 }]}
                >
                    {marking!.dots!.slice(0, 3).map((dot, index) => (
                        <View
                            key={index}
                            style={{
                                width: 5,
                                height: 5,
                                borderRadius: 3,
                                backgroundColor: dot.color,
                            }}
                        />
                    ))}
                </View>
            )}

            </Pressable>
        </Reanimated.View>
    );
}

function areCustomDayPropsEqual(previous: Props, next: Props): boolean {
    return (
        previous.date?.dateString === next.date?.dateString
        && previous.state === next.state
        && previous.marking === next.marking
        && previous.dayMetadata === next.dayMetadata
        && previous.isSelectedDay === next.isSelectedDay
        && previous.onPress === next.onPress
        && previous.allowDisabledPress === next.allowDisabledPress
        && previous.viewMode === next.viewMode
        && previous.animatedCellHeight === next.animatedCellHeight
        && previous.animatedSelectedDayKey === next.animatedSelectedDayKey
        && previous.detailCellHeight === next.detailCellHeight
        && previous.stackPresentation === next.stackPresentation
        && previous.stackEventTop === next.stackEventTop
        && previous.hideStackEventLabels === next.hideStackEventLabels
    );
}

export default React.memo(CustomDay, areCustomDayPropsEqual);

const styles = StyleSheet.create({
    animatedCell: {
        alignSelf: "stretch",
        overflow: "hidden",
    },
    cell: {
        alignSelf: "stretch",
        height: 58,
        paddingTop: 8,
        alignItems: "center",
    },
    dayCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 18,
        lineHeight: 20,
        letterSpacing: 0,
        fontWeight: "600",
    },
    lunarText: {
        maxWidth: 38,
        fontSize: 8,
        lineHeight: 9,
        fontWeight: "700",
        letterSpacing: -0.35,
        textAlign: "center",
    },
    holidayText: {
        position: "absolute",
        top: 49,
        left: 2,
        right: 2,
        fontSize: 8.5,
        lineHeight: 10,
        fontWeight: "800",
        letterSpacing: -0.25,
        textAlign: "center",
    },
    periods: {
        alignSelf: "stretch",
        marginTop: 6,
    },
    periodsWithHoliday: {
        marginTop: 11,
    },
    dots: {
        position: "absolute",
        flexDirection: "row",
        justifyContent: "center",
        gap: 3,
    },
    stackEventChips: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 49,
        overflow: "hidden",
    },
    stackEventChip: {
        position: "absolute",
        minWidth: 0,
        height: 16,
        paddingHorizontal: 3,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    stackEventIcon: {
        width: 10,
        marginRight: 1,
    },
    stackEventTitle: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "700",
        letterSpacing: -0.1,
    },
    stackEventMore: {
        position: "absolute",
        top: 36,
        left: 2,
        right: 2,
        height: 13,
        paddingHorizontal: 3,
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "700",
    },
    detailMarkers: {
        position: "absolute",
        top: 51,
        left: 2,
        right: 2,
        minHeight: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    detailMarkersWithHoliday: {
        top: 61,
    },
    detailDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    detailTravelMarker: {
        width: 8,
        height: 8,
    },
    detailEventMore: {
        flexShrink: 0,
        fontSize: 7,
        lineHeight: 8,
        fontWeight: "800",
        letterSpacing: -0.3,
    },
});

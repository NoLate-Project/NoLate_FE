import styles from "./CalendarYearOverviewModal.styles";
import React, { useRef } from "react";
import {
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import { getYearTodayScrollOffset } from "../../calendarNavigation";
import type { ScheduleItem } from "../../types";
import { getFloatingActionBarClearance } from "../shared/floatingActionBarLayout";
import {
    buildCalendarYearScheduleCounts,
    getCalendarYearScheduleDensityPresentation,
    type CalendarYearScheduleCounts,
} from "./calendarYearScheduleDensity";
import { getCalendarTodayAccent } from "./calendarTodayAccent";

type Props = {
    year: number;
    selectedDay: string;
    firstDay: 0 | 1;
    topInset?: number;
    presentationRequest?: number;
    todayRequest?: number;
    reduceMotionEnabled?: boolean;
    items?: ScheduleItem[];
    onSelectMonth: (year: number, month: number) => void;
    onVisibleYearChange?: (year: number) => void;
};

const YEAR_OVERVIEW_CHROME_CLEARANCE = 63;
const YEAR_OVERVIEW_MIN_TOP_CLEARANCE = 103;

export function getYearOverviewTopClearance(
    topInset: number,
    safeAreaTopInset: number
): number {
    const resolvedTopInset = Math.max(
        Number.isFinite(topInset) ? topInset : 0,
        Number.isFinite(safeAreaTopInset) ? safeAreaTopInset : 0
    );

    return Math.max(
        resolvedTopInset + YEAR_OVERVIEW_CHROME_CLEARANCE,
        YEAR_OVERVIEW_MIN_TOP_CLEARANCE
    );
}

function getMonthCells(year: number, month: number, firstDay: 0 | 1) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthFirstDay = new Date(year, month - 1, 1).getDay();
    const leadingCount = (monthFirstDay - firstDay + 7) % 7;

    return Array.from({ length: 42 }, (_, index) => {
        const day = index - leadingCount + 1;
        return day > 0 && day <= daysInMonth ? day : null;
    });
}

type YearMonthPreviewProps = {
    year: number;
    month: number;
    firstDay: 0 | 1;
    selectedDay: number | null;
    todayDay: number | null;
    calendarAccentColor: string;
    todayAccentColor: string;
    textPrimary: string;
    selectedDayBg: string;
    selectedDayText: string;
    mode: "light" | "dark";
    scheduleCountsByDate: CalendarYearScheduleCounts;
    onSelectMonth: (year: number, month: number) => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    testID?: string;
};

const YearMonthPreview = React.memo(function YearMonthPreview({
    year,
    month,
    firstDay,
    selectedDay,
    todayDay,
    calendarAccentColor,
    todayAccentColor,
    textPrimary,
    selectedDayBg,
    selectedDayText,
    mode,
    scheduleCountsByDate,
    onSelectMonth,
    onLayout,
    testID,
}: YearMonthPreviewProps) {
    const cells = React.useMemo(
        () => getMonthCells(year, month, firstDay),
        [firstDay, month, year]
    );
    const isSelectedMonth = selectedDay !== null;
    const isCurrentMonth = todayDay !== null;
    const monthKeyPrefix = `${year}-${String(month).padStart(2, "0")}-`;
    const getScheduleCount = (day: number | null) => day === null
        ? 0
        : scheduleCountsByDate[
            `${monthKeyPrefix}${String(day).padStart(2, "0")}`
        ] ?? 0;
    const scheduleSummary = cells.reduce(
        (summary, day) => {
            const count = getScheduleCount(day);
            return {
                dayCount: summary.dayCount + (count > 0 ? 1 : 0),
                maxCount: Math.max(summary.maxCount, count),
            };
        },
        { dayCount: 0, maxCount: 0 }
    );
    const todayScheduleCount = getScheduleCount(todayDay);
    const selectedScheduleCount = getScheduleCount(selectedDay);
    const selectedDayIsToday = selectedDay !== null
        && todayDay !== null
        && selectedDay === todayDay;

    return (
        <Pressable
            testID={testID}
            onPress={() => onSelectMonth(year, month)}
            onLayout={onLayout}
            accessibilityRole="button"
            accessibilityLabel={[
                `${year}년 ${month}월 보기`,
                scheduleSummary.dayCount > 0
                    ? `일정 있는 날 ${scheduleSummary.dayCount}일`
                    : undefined,
                scheduleSummary.maxCount > 0
                    ? `하루 최대 ${scheduleSummary.maxCount}개`
                    : undefined,
                todayScheduleCount > 0
                    ? `오늘 ${todayDay}일 일정 ${todayScheduleCount}개`
                    : undefined,
                !selectedDayIsToday && selectedScheduleCount > 0
                    ? `선택한 ${selectedDay}일 일정 ${selectedScheduleCount}개`
                    : undefined,
            ].filter(Boolean).join(", ")}
            style={({ pressed }) => [
                styles.monthPreview,
                { opacity: pressed ? 0.55 : 1 },
            ]}
        >
            <Text
                style={[
                    styles.monthTitle,
                    {
                        color: isCurrentMonth
                            ? calendarAccentColor
                            : isSelectedMonth
                                ? selectedDayBg
                                : textPrimary,
                    },
                ]}
            >
                {month}월
            </Text>

            <View style={styles.daysGrid}>
                {cells.map((day, cellIndex) => {
                    const isSelectedDay = day !== null && day === selectedDay;
                    const isToday = day !== null && day === todayDay;
                    const dateKey = day === null
                        ? null
                        : `${monthKeyPrefix}${String(day).padStart(2, "0")}`;
                    const scheduleCount = dateKey
                        ? scheduleCountsByDate[dateKey] ?? 0
                        : 0;
                    const density = getCalendarYearScheduleDensityPresentation(
                        scheduleCount,
                        mode
                    );
                    const showDensity = density !== null && !isSelectedDay && !isToday;
                    const badgeFill = isToday
                        ? todayAccentColor
                        : isSelectedDay
                            ? selectedDayBg
                            : showDensity
                                ? density.backgroundColor
                                : "transparent";
                    const badgeTextColor = isToday
                        ? "#ffffff"
                        : isSelectedDay
                            ? selectedDayText
                            : showDensity
                                ? density.textColor
                                : textPrimary;

                    return (
                        <View key={cellIndex} style={styles.dayCell}>
                            {day !== null && (
                                <View
                                    testID={density
                                        ? `calendar-year-schedule-density-${dateKey}`
                                        : undefined}
                                    style={[
                                        styles.dayBadge,
                                        showDensity && styles.scheduleDensityBadge,
                                        (showDensity || isSelectedDay || isToday) && {
                                            backgroundColor: badgeFill,
                                            borderColor: "transparent",
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.dayText,
                                            showDensity
                                            && density.level >= 2
                                            && styles.scheduleDensityTextStrong,
                                            { color: badgeTextColor },
                                        ]}
                                    >
                                        {day}
                                    </Text>
                                </View>
                            )}
                        </View>
                    );
                })}
            </View>
        </Pressable>
    );
});

function CalendarYearOverviewModal({
    year,
    selectedDay,
    firstDay,
    topInset = 0,
    presentationRequest = 0,
    todayRequest = 0,
    reduceMotionEnabled = false,
    items = [],
    onSelectMonth,
    onVisibleYearChange,
}: Props) {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const selectedDate = new Date(`${selectedDay}T00:00:00`);
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const todayDate = today.getDate();
    const currentYear = todayYear;
    const calendarAccentColor = mode === "dark" ? "#ff453a" : "#ff3b30";
    const todayAccentColor = getCalendarTodayAccent(mode);
    const visibleYears = React.useMemo(() => Array.from(new Set([
        currentYear - 2,
        currentYear - 1,
        currentYear,
        currentYear + 1,
        currentYear + 2,
        year - 1,
        year,
        year + 1,
    ])).sort((left, right) => left - right), [currentYear, year]);
    const scrollRef = useRef<ScrollView>(null);
    const yearOffsetsRef = useRef<Record<number, number>>({});
    const todayMonthGridOffsetRef = useRef<{ year: number; offset: number } | null>(null);
    const todayMonthOffsetRef = useRef<{ key: string; offset: number } | null>(null);
    const pendingInitialYearScrollRef = useRef(true);
    const initialYearScrollFrameRef = useRef<number | null>(null);
    const handledPresentationRef = useRef(`${year}:${presentationRequest}`);
    const visibleYearsLayoutKeyRef = useRef(visibleYears.join(","));
    const pendingTodayScrollRef = useRef(false);
    const todayScrollFrameRef = useRef<number | null>(null);
    const handledTodayRequestRef = useRef(todayRequest);
    const topClearance = getYearOverviewTopClearance(topInset, insets.top);
    const todayMonthKey = `${todayYear}-${todayMonth}`;
    const visibleYearsLayoutKey = visibleYears.join(",");
    const scheduleCountsByDate = React.useMemo(
        () => buildCalendarYearScheduleCounts(items),
        [items]
    );

    if (visibleYearsLayoutKeyRef.current !== visibleYearsLayoutKey) {
        visibleYearsLayoutKeyRef.current = visibleYearsLayoutKey;
        yearOffsetsRef.current = {};
        todayMonthGridOffsetRef.current = null;
        todayMonthOffsetRef.current = null;
        pendingInitialYearScrollRef.current = true;
    }

    const tryScrollToInitialYear = React.useCallback(() => {
        if (!pendingInitialYearScrollRef.current || !scrollRef.current) return;

        const sectionOffset = yearOffsetsRef.current[year];
        if (!Number.isFinite(sectionOffset)) return;

        pendingInitialYearScrollRef.current = false;
        scrollRef.current.scrollTo({
            y: Math.max(0, sectionOffset),
            animated: false,
        });
    }, [year]);

    const scheduleInitialYearScroll = React.useCallback(() => {
        if (
            !pendingInitialYearScrollRef.current ||
            initialYearScrollFrameRef.current !== null
        ) return;

        initialYearScrollFrameRef.current = requestAnimationFrame(() => {
            initialYearScrollFrameRef.current = null;
            tryScrollToInitialYear();
        });
    }, [tryScrollToInitialYear]);

    const tryScrollToToday = React.useCallback(() => {
        if (!pendingTodayScrollRef.current) return;

        const yearOffset = yearOffsetsRef.current[todayYear];
        const monthGridLayout = todayMonthGridOffsetRef.current;
        const monthLayout = todayMonthOffsetRef.current;
        const targetOffset = getYearTodayScrollOffset(
            yearOffset,
            monthGridLayout?.year === todayYear ? monthGridLayout.offset : Number.NaN,
            monthLayout?.key === todayMonthKey ? monthLayout.offset : Number.NaN,
            0
        );

        if (targetOffset === null || !scrollRef.current) return;

        // Today 요청은 새 연도 화면의 기본 포커스보다 우선한다. 두 RAF가 같은
        // 프레임에 준비되더라도 초기 연도 복귀가 Today 위치를 다시 덮지 않게 한다.
        pendingInitialYearScrollRef.current = false;
        if (initialYearScrollFrameRef.current !== null) {
            cancelAnimationFrame(initialYearScrollFrameRef.current);
            initialYearScrollFrameRef.current = null;
        }
        pendingTodayScrollRef.current = false;
        scrollRef.current.scrollTo({
            y: targetOffset,
            animated: !reduceMotionEnabled,
        });
    }, [reduceMotionEnabled, todayMonthKey, todayYear]);

    const scheduleTodayScroll = React.useCallback(() => {
        if (!pendingTodayScrollRef.current || todayScrollFrameRef.current !== null) return;

        todayScrollFrameRef.current = requestAnimationFrame(() => {
            todayScrollFrameRef.current = null;
            tryScrollToToday();
        });
    }, [tryScrollToToday]);

    const handleTodayMonthGridLayout = React.useCallback((event: LayoutChangeEvent) => {
        todayMonthGridOffsetRef.current = {
            year: todayYear,
            offset: event.nativeEvent.layout.y,
        };
        scheduleTodayScroll();
    }, [scheduleTodayScroll, todayYear]);

    const handleTodayMonthLayout = React.useCallback((event: LayoutChangeEvent) => {
        todayMonthOffsetRef.current = {
            key: todayMonthKey,
            offset: event.nativeEvent.layout.y,
        };
        scheduleTodayScroll();
    }, [scheduleTodayScroll, todayMonthKey]);

    const lastNotifiedVisibleYearRef = useRef<number | null>(null);
    const handleYearScroll = React.useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        if (!onVisibleYearChange) return;

        const focusY = event.nativeEvent.contentOffset.y
            + event.nativeEvent.layoutMeasurement.height * 0.28;
        let nextVisibleYear: number | null = null;
        let nextVisibleYearOffset = Number.NEGATIVE_INFINITY;

        visibleYears.forEach((sectionYear) => {
            const sectionOffset = yearOffsetsRef.current[sectionYear];
            if (
                Number.isFinite(sectionOffset)
                && sectionOffset <= focusY
                && sectionOffset > nextVisibleYearOffset
            ) {
                nextVisibleYear = sectionYear;
                nextVisibleYearOffset = sectionOffset;
            }
        });

        if (
            nextVisibleYear === null
            || lastNotifiedVisibleYearRef.current === nextVisibleYear
        ) return;

        lastNotifiedVisibleYearRef.current = nextVisibleYear;
        onVisibleYearChange(nextVisibleYear);
    }, [onVisibleYearChange, visibleYears]);

    React.useEffect(() => {
        lastNotifiedVisibleYearRef.current = null;
    }, [presentationRequest, year]);

    React.useEffect(() => {
        const presentationKey = `${year}:${presentationRequest}`;
        if (handledPresentationRef.current === presentationKey) return;

        handledPresentationRef.current = presentationKey;
        pendingInitialYearScrollRef.current = true;
        scheduleInitialYearScroll();
    }, [presentationRequest, scheduleInitialYearScroll, year]);

    React.useEffect(() => {
        if (handledTodayRequestRef.current === todayRequest) return;
        handledTodayRequestRef.current = todayRequest;
        pendingTodayScrollRef.current = true;
        scheduleTodayScroll();
    }, [scheduleTodayScroll, todayRequest]);

    React.useEffect(() => () => {
        if (initialYearScrollFrameRef.current !== null) {
            cancelAnimationFrame(initialYearScrollFrameRef.current);
        }
        if (todayScrollFrameRef.current !== null) {
            cancelAnimationFrame(todayScrollFrameRef.current);
        }
    }, []);

    return (
        <View
            testID="calendar-year-overview-safe-area"
            style={[
                styles.safeArea,
                {
                    backgroundColor: colors.calendarBackground,
                    paddingTop: topClearance,
                },
            ]}
        >
            <ScrollView
                ref={scrollRef}
                testID="calendar-year-overview-scroll"
                style={[
                    styles.scrollView,
                    { marginBottom: getFloatingActionBarClearance(insets.bottom) },
                ]}
                contentInsetAdjustmentBehavior="never"
                showsVerticalScrollIndicator={false}
                onScroll={handleYearScroll}
                scrollEventThrottle={80}
                onContentSizeChange={() => {
                    scheduleInitialYearScroll();
                    scheduleTodayScroll();
                }}
                contentContainerStyle={[
                    styles.content,
                    styles.floatingBarContentEnd,
                ]}
            >
                {visibleYears.map((sectionYear) => {
                    const sectionYearColor = sectionYear === currentYear
                        ? calendarAccentColor
                        : colors.textPrimary;

                    return (
                        <View
                            key={sectionYear}
                            testID={sectionYear === todayYear
                                ? "calendar-year-today-section"
                                : undefined}
                            style={styles.yearSection}
                            onLayout={(event) => {
                                const sectionOffset = event.nativeEvent.layout.y;
                                yearOffsetsRef.current[sectionYear] = sectionOffset;
                                if (sectionYear === year) scheduleInitialYearScroll();
                                if (sectionYear === todayYear) scheduleTodayScroll();
                            }}
                        >
                            <View style={[styles.yearHeader, { borderBottomColor: colors.border }]}>
                                <Text style={[styles.yearTitle, { color: sectionYearColor }]}>
                                    {sectionYear}년
                                </Text>
                            </View>

                            <View
                                testID={sectionYear === todayYear
                                    ? "calendar-year-today-month-grid"
                                    : undefined}
                                style={styles.monthGrid}
                                onLayout={sectionYear === todayYear
                                    ? handleTodayMonthGridLayout
                                    : undefined}
                            >
                                {Array.from({ length: 12 }, (_, index) => {
                                    const month = index + 1;
                                    const monthKey = `${sectionYear}-${month}`;
                                    const isSelectedMonth =
                                        selectedDate.getFullYear() === sectionYear &&
                                        selectedDate.getMonth() + 1 === month;
                                    const isCurrentMonth =
                                        todayYear === sectionYear &&
                                        todayMonth === month;

                                    return (
                                        <YearMonthPreview
                                            key={monthKey}
                                            year={sectionYear}
                                            month={month}
                                            firstDay={firstDay}
                                            selectedDay={isSelectedMonth ? selectedDate.getDate() : null}
                                            todayDay={isCurrentMonth ? todayDate : null}
                                            calendarAccentColor={calendarAccentColor}
                                            todayAccentColor={todayAccentColor}
                                            textPrimary={colors.textPrimary}
                                            selectedDayBg={colors.selectedDayBg}
                                            selectedDayText={colors.selectedDayText}
                                            mode={mode}
                                            scheduleCountsByDate={scheduleCountsByDate}
                                            onSelectMonth={onSelectMonth}
                                            onLayout={isCurrentMonth ? handleTodayMonthLayout : undefined}
                                            testID={isCurrentMonth
                                                ? "calendar-year-today-month"
                                                : undefined}
                                        />
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}

export default React.memo(CalendarYearOverviewModal);

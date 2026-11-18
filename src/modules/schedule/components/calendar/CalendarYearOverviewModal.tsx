import styles from "./CalendarYearOverviewModal.styles";
import React, { useRef } from "react";
import {
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Pressable,
    ScrollView,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import { getYearMonthSelection, getYearTodayScrollOffset } from "../../calendarNavigation";
import { CALENDAR_YEAR_MOTION } from "../../calendarMotion";
import type { ScheduleItem } from "../../types";
import { getFloatingActionBarClearance } from "../shared/floatingActionBarLayout";
import {
    buildCalendarYearScheduleCounts,
    getCalendarYearScheduleDensityPresentation,
    type CalendarYearScheduleCounts,
} from "./calendarYearScheduleDensity";
import { getCalendarTodayAccent } from "./calendarTodayAccent";
import type { CalendarDatePoint } from "./CalendarYearDateHandoff";

type Props = {
    year: number;
    selectedDay: string;
    firstDay: 0 | 1;
    topInset?: number;
    presentationRequest?: number;
    todayRequest?: number;
    reduceMotionEnabled?: boolean;
    visible?: boolean;
    items?: ScheduleItem[];
    onSelectMonth: (year: number, month: number, from?: CalendarDatePoint) => void;
    onVisibleYearChange?: (year: number) => void;
};

const YEAR_OVERVIEW_CHROME_CLEARANCE = 63;
const YEAR_OVERVIEW_MIN_TOP_CLEARANCE = 103;
const selectedMarkerEntry = FadeIn.duration(CALENDAR_YEAR_MOTION.selectedDayMarkerMs).reduceMotion(ReduceMotion.System);

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
    twoColumns: boolean;
    standard: boolean;
    dayFontScale: number;
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
    borderColor: string;
    markerAnimationKey?: number;
    mode: "light" | "dark";
    scheduleCountsByDate: CalendarYearScheduleCounts;
    handoffDay?: number;
    onSelectMonth: (year: number, month: number, from?: CalendarDatePoint) => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    testID?: string;
};

const YearMonthPreview = React.memo(function YearMonthPreview({
    twoColumns,
    standard,
    dayFontScale,
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
    borderColor,
    markerAnimationKey,
    mode,
    scheduleCountsByDate,
    handoffDay,
    onSelectMonth,
    onLayout,
    testID,
}: YearMonthPreviewProps) {
    const handoffSource = useRef<View>(null);
    const selectMonth = () => {
        const source = handoffSource.current;
        if (!source) {
            onSelectMonth(year, month);
            return;
        }
        let measured = false;
        const fallback = setTimeout(() => {
            if (measured) return;
            measured = true;
            onSelectMonth(year, month);
        }, 48);
        source.measureInWindow((x, y, width, height) => {
            if (measured) return;
            measured = true;
            clearTimeout(fallback);
            onSelectMonth(year, month, width > 0 && height > 0 ? { x: x + width / 2, y: y + height / 2 } : undefined);
        });
    };
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
    const selectedMonthTint = standard
        ? (mode === "dark" ? "#263B5C" : "#EEF4FF")
        : (mode === "dark" ? "#9ABEFF20" : "#286AFF12");

    return (
        <Pressable
            testID={testID}
            onPress={selectMonth}
            onLayout={onLayout}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelectedMonth }}
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
                twoColumns ? styles.monthPreviewWide : styles.monthPreviewThreeColumns,
                standard && styles.standardMonth,
                isSelectedMonth && (standard ? styles.standardSelectedMonth : styles.selectedMonth),
                {
                    opacity: pressed ? 0.55 : 1,
                    backgroundColor: isSelectedMonth ? selectedMonthTint : undefined,
                    borderColor: standard && isSelectedMonth ? borderColor : "transparent",
                    borderBottomColor: !standard && isSelectedMonth ? "transparent" : borderColor,
                },
            ]}
        >
            <Text
                maxFontSizeMultiplier={twoColumns ? 1.3 : 1.15}
                style={[
                    styles.monthTitle,
                    !twoColumns && styles.monthTitleThreeColumns,
                    {
                        color: standard ? textPrimary : isCurrentMonth
                            ? calendarAccentColor
                            : isSelectedMonth
                                ? todayAccentColor
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
                        mode,
                        standard
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
                        <View key={cellIndex} style={[styles.dayCell, twoColumns && styles.dayCellWide]}>
                            {day !== null && (
                                <View
                                    ref={day === handoffDay ? handoffSource : undefined}
                                    collapsable={day !== handoffDay}
                                    testID={density
                                        ? `calendar-year-schedule-density-${dateKey}`
                                        : undefined}
                                    style={[
                                        styles.dayBadge,
                                        twoColumns && styles.dayBadgeWide,
                                        showDensity && styles.scheduleDensityBadge,
                                        standard && styles.standardDayBadge,
                                        (showDensity || isSelectedDay || isToday) && {
                                            backgroundColor: isSelectedDay && markerAnimationKey !== undefined ? undefined : badgeFill,
                                            borderColor: "transparent",
                                        },
                                        !standard && selectedDayIsToday && isSelectedDay && { borderColor: selectedDayBg },
                                    ]}
                                >
                                    {isSelectedDay && markerAnimationKey !== undefined && (
                                        <Animated.View key={markerAnimationKey} entering={selectedMarkerEntry}
                                            style={[styles.selectedMarkerFill, standard && styles.standardDayBadge, { backgroundColor: badgeFill }]} />
                                    )}
                                    {standard && isToday && isSelectedDay && (
                                        <View pointerEvents="none"
                                            style={[styles.standardTodaySelectedOutline, { borderColor: selectedDayBg }]} />
                                    )}
                                    <Text
                                        maxFontSizeMultiplier={dayFontScale}
                                        style={[
                                            styles.dayText,
                                            standard && styles.standardDayText,
                                            showDensity
                                            && !standard && density.level >= 2
                                            && styles.scheduleDensityTextStrong,
                                            standard && (isToday || isSelectedDay) && styles.standardMarkedDayText,
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
    visible = true,
    items = [],
    onSelectMonth,
    onVisibleYearChange,
}: Props) {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const { width, fontScale } = useWindowDimensions();
    const standard = fontScale <= 1.25;
    const twoColumns = !standard || width <= 360;
    const dayFontScale = twoColumns ? (width >= 360 ? 1.6 : 1.35) : 1.05;
    const selectedDate = new Date(`${selectedDay}T00:00:00`);
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const todayDate = today.getDate();
    const currentYear = todayYear;
    const calendarAccentColor = !standard
        ? (mode === "dark" ? "#ff453a" : "#ff3b30")
        : (mode === "dark" ? "#ff9ca4" : "#aa3a3d");
    const todayAccentColor = standard ? "#205DD1" : getCalendarTodayAccent(mode);
    const dateInk = standard ? (mode === "dark" ? "#EEF3FC" : "#172131") : colors.textPrimary;
    const dateSurface = standard ? (mode === "dark" ? "#1A222F" : "#FFFFFF") : colors.selectedDayText;
    const gridBorder = standard ? (mode === "dark" ? "#374458" : "#E8EBEF") : colors.border;
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
    const yearSectionsRef = useRef<Partial<Record<number, { y: number; height: number }>>>({});
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
        yearSectionsRef.current = {};
        todayMonthGridOffsetRef.current = null;
        todayMonthOffsetRef.current = null;
        pendingInitialYearScrollRef.current = true;
    }

    const tryScrollToInitialYear = React.useCallback(() => {
        if (!pendingInitialYearScrollRef.current || !scrollRef.current) return;

        const sectionOffset = yearSectionsRef.current[year]?.y;
        if (sectionOffset === undefined) return;

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

        const yearOffset = yearSectionsRef.current[todayYear]?.y ?? Number.NaN;
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

    const lastVisibleYearsRef = useRef(new Set<number>());
    const handleYearScroll = React.useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        if (!visible || !onVisibleYearChange) return;

        const { contentOffset, layoutMeasurement } = event.nativeEvent;
        const viewportTop = contentOffset.y;
        const viewportBottom = viewportTop + layoutMeasurement.height;
        const yearsInViewport = visibleYears.filter((sectionYear) => {
            const section = yearSectionsRef.current[sectionYear];
            return section && section.y < viewportBottom && section.y + section.height > viewportTop;
        });
        const previousYears = lastVisibleYearsRef.current;
        lastVisibleYearsRef.current = new Set(yearsInViewport);
        yearsInViewport.forEach((sectionYear) => {
            if (!previousYears.has(sectionYear)) onVisibleYearChange(sectionYear);
        });
    }, [onVisibleYearChange, visible, visibleYears]);

    React.useEffect(() => {
        lastVisibleYearsRef.current.clear();
    }, [presentationRequest, visible, year]);

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
                    !twoColumns && styles.contentThreeColumns,
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
                            style={[styles.yearSection, !twoColumns && styles.yearSectionThreeColumns]}
                            onLayout={(event) => {
                                const { y, height } = event.nativeEvent.layout;
                                yearSectionsRef.current[sectionYear] = { y, height };
                                if (sectionYear === year) scheduleInitialYearScroll();
                                if (sectionYear === todayYear) scheduleTodayScroll();
                            }}
                        >
                            <View style={[styles.yearHeader, { borderBottomColor: colors.border }]}>
                                <Text
                                    maxFontSizeMultiplier={1.45}
                                    style={[
                                        styles.yearTitle,
                                        !twoColumns && styles.yearTitleThreeColumns,
                                        { color: sectionYearColor },
                                    ]}
                                >
                                    {sectionYear}년
                                </Text>
                            </View>

                            <View
                                testID={sectionYear === todayYear
                                    ? "calendar-year-today-month-grid"
                                    : undefined}
                                style={[styles.monthGrid, !twoColumns && styles.monthGridThreeColumns]}
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
                                            twoColumns={twoColumns}
                                            standard={standard}
                                            dayFontScale={dayFontScale}
                                            year={sectionYear}
                                            month={month}
                                            firstDay={firstDay}
                                            selectedDay={isSelectedMonth ? selectedDate.getDate() : null}
                                            todayDay={isCurrentMonth ? todayDate : null}
                                            calendarAccentColor={calendarAccentColor}
                                            todayAccentColor={todayAccentColor}
                                            textPrimary={dateInk}
                                            selectedDayBg={standard ? dateInk : colors.selectedDayBg}
                                            selectedDayText={dateSurface}
                                            borderColor={gridBorder}
                                            markerAnimationKey={visible && !reduceMotionEnabled && isSelectedMonth ? presentationRequest : undefined}
                                            mode={mode}
                                            scheduleCountsByDate={scheduleCountsByDate}
                                            handoffDay={standard && visible && !reduceMotionEnabled
                                                ? Number(getYearMonthSelection(sectionYear, month, selectedDay).slice(8))
                                                : undefined}
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

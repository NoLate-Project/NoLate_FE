import React, { useRef } from "react";
import {
    type LayoutChangeEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import { getYearTodayScrollOffset } from "../../calendarNavigation";

type Props = {
    year: number;
    selectedDay: string;
    firstDay: 0 | 1;
    topInset?: number;
    presentationRequest?: number;
    todayRequest?: number;
    reduceMotionEnabled?: boolean;
    onSelectMonth: (year: number, month: number) => void;
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
    accentColor: string;
    textPrimary: string;
    selectedDayBg: string;
    selectedDayText: string;
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
    accentColor,
    textPrimary,
    selectedDayBg,
    selectedDayText,
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

    return (
        <Pressable
            testID={testID}
            onPress={() => onSelectMonth(year, month)}
            onLayout={onLayout}
            accessibilityRole="button"
            accessibilityLabel={`${year}년 ${month}월 보기`}
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
                            ? accentColor
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
                    const badgeFill = isToday
                        ? accentColor
                        : isSelectedDay
                            ? selectedDayBg
                            : "transparent";
                    const badgeTextColor = isToday
                        ? "#ffffff"
                        : isSelectedDay
                            ? selectedDayText
                            : textPrimary;

                    return (
                        <View key={cellIndex} style={styles.dayCell}>
                            {day !== null && (
                                <View
                                    style={[
                                        styles.dayBadge,
                                        (isSelectedDay || isToday) && {
                                            backgroundColor: badgeFill,
                                            borderColor: "transparent",
                                        },
                                    ]}
                                >
                                    <Text style={[styles.dayText, { color: badgeTextColor }]}>
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
    onSelectMonth,
}: Props) {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const selectedDate = new Date(`${selectedDay}T00:00:00`);
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const todayDate = today.getDate();
    const currentYear = todayYear;
    const accentColor = mode === "dark" ? "#ff453a" : "#ff3b30";
    const visibleYears = Array.from(new Set([
        currentYear - 2,
        currentYear - 1,
        currentYear,
        currentYear + 1,
        currentYear + 2,
        year - 1,
        year,
        year + 1,
    ]))
        .sort((left, right) => left - right);
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
                style={styles.scrollView}
                contentInsetAdjustmentBehavior="never"
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => {
                    scheduleInitialYearScroll();
                    scheduleTodayScroll();
                }}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingBottom: Math.max(insets.bottom + 118, 148),
                    },
                ]}
            >
                {visibleYears.map((sectionYear) => {
                    const sectionYearColor = sectionYear === currentYear
                        ? accentColor
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
                                            accentColor={accentColor}
                                            textPrimary={colors.textPrimary}
                                            selectedDayBg={colors.selectedDayBg}
                                            selectedDayText={colors.selectedDayText}
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

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 24,
    },
    yearSection: {
        marginBottom: 44,
    },
    yearHeader: {
        marginBottom: 13,
        paddingBottom: 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
    },
    yearTitle: {
        fontSize: 34,
        lineHeight: 40,
        fontWeight: "700",
        letterSpacing: 0,
    },
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 20,
    },
    monthPreview: {
        width: "31%",
        minHeight: 130,
    },
    monthTitle: {
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 1,
        letterSpacing: 0,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 17.3333,
        alignItems: "center",
        justifyContent: "center",
    },
    dayBadge: {
        minWidth: 15,
        height: 15,
        borderRadius: 7.5,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 10,
        fontWeight: "600",
    },
});

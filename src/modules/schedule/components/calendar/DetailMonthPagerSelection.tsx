import { Ionicons } from "@expo/vector-icons";
import React, { useLayoutEffect } from "react";
import { TextInput } from "react-native";
import { Calendar, type DateData } from "react-native-calendars";
import Reanimated, {
    type SharedValue,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";

import type { CalendarDayMetadata } from "../../calendarMetadata";
import type { DetailMonthSwipeDirection } from "../../calendarMotion";
import {
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
    getCalendarMonthOrdinal,
    getDetailMonthPagerVerticalOffset,
    getMonthWeekCount,
    toDateString,
    type CalendarMarkedEvent,
} from "./scheduleCalendarModel";
import { CALENDAR_DAY_HEIGHTS } from "./viewMode";
import { createScheduleCalendarStyles } from "./ScheduleCalendar.styles";

const DetailMonthAnimatedTextInput =
    Reanimated.createAnimatedComponent(TextInput);

export const DETAIL_MONTH_GRID_COLUMN_COUNT = 7;
export const DETAIL_MONTH_GRID_ROW_COUNT = 6;
export const DETAIL_MONTH_GRID_CELL_COUNT =
    DETAIL_MONTH_GRID_COLUMN_COUNT * DETAIL_MONTH_GRID_ROW_COUNT;
export const DETAIL_MONTH_EVENT_MARKER_LIMIT = 3;
export const DETAIL_MONTH_PAGE_MODEL_CACHE_LIMIT = 128;

export type DetailMonthPageModel = {
    monthKey: string;
    monthOrdinal: number;
    leadingDayCount: number;
    weekCount: number;
    dates: DateData[];
};

export type DetailMonthPagerGridProps = {
    day: string;
    firstDay: 0 | 1;
    markedDates: React.ComponentProps<typeof Calendar>["markedDates"];
    calendarDaysByDate: Readonly<Record<string, CalendarDayMetadata>>;
    detailCellHeight?: number;
    todayDateString: string;
    textPrimary: string;
    textSecondary: string;
    colorMode: "dark" | "light";
    onPress: (day: DateData) => void;
    onShift: (direction: DetailMonthSwipeDirection) => void;
};

export type DetailMonthCellGeometry = {
    circleSize: number;
    circleTop: number;
    dayFontSize: number;
    dayLineHeight: number;
    lunarMaxWidth: number;
    lunarFontSize: number;
    lunarLineHeight: number;
    holidayFontSize: number;
    holidayLineHeight: number;
};

export const detailMonthPageModelCache = new Map<string, DetailMonthPageModel>();

/** 상세 월 격자에 필요한 42개 날짜와 주 수를 생성한다. 최근 월 결과는 제한된 캐시에 보관해 빠른 스와이프 중 재계산을 줄인다. */
export function getDetailMonthPageModel(
    day: string,
    firstDay: 0 | 1
): DetailMonthPageModel {
    const monthKey = day.slice(0, 7);
    const cacheKey = `${firstDay}:${monthKey}`;
    const cached = detailMonthPageModelCache.get(cacheKey);
    if (cached) {
        detailMonthPageModelCache.delete(cacheKey);
        detailMonthPageModelCache.set(cacheKey, cached);
        return cached;
    }

    const [year, month] = monthKey.split("-").map(Number);
    const monthIndex = month - 1;
    const leadingDayCount = (
        new Date(year, monthIndex, 1).getDay() - firstDay + 7
    ) % 7;
    const firstVisibleDay = new Date(year, monthIndex, 1 - leadingDayCount);
    const dates = Array.from(
        { length: DETAIL_MONTH_GRID_CELL_COUNT },
        (_, index): DateData => {
            const date = new Date(firstVisibleDay);
            date.setDate(firstVisibleDay.getDate() + index);
            const dateYear = date.getFullYear();
            const dateMonth = date.getMonth() + 1;
            const dateOfMonth = date.getDate();
            return {
                year: dateYear,
                month: dateMonth,
                day: dateOfMonth,
                dateString: toDateString(
                    dateYear,
                    dateMonth,
                    dateOfMonth
                ),
                timestamp: date.getTime(),
            };
        }
    );
    const model = {
        monthKey,
        monthOrdinal: getCalendarMonthOrdinal(monthKey),
        leadingDayCount,
        weekCount: getMonthWeekCount(monthKey, firstDay),
        dates,
    };
    if (detailMonthPageModelCache.size >= DETAIL_MONTH_PAGE_MODEL_CACHE_LIMIT) {
        const oldestKey = detailMonthPageModelCache.keys().next().value;
        if (oldestKey !== undefined) {
            detailMonthPageModelCache.delete(oldestKey);
        }
    }
    detailMonthPageModelCache.set(cacheKey, model);
    return model;
}

/** 선택한 일자를 대상 월의 마지막 날짜 범위에 맞춰 보정한 숫자 키를 UI 스레드에서 계산한다. */
export function resolveDetailMonthSelectionKeyOnUI(
    selectedKey: number,
    monthOrdinal: number
): number {
    "worklet";

    const selectedDate = selectedKey % 100;
    if (selectedDate < 1) return 0;
    const targetYear = Math.floor(monthOrdinal / 12);
    const targetMonth = monthOrdinal - targetYear * 12 + 1;
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
}

/** 가변 셀 높이에 맞춰 선택 원, 양력·음력 글자와 공휴일 라벨의 크기를 연속적으로 보간한다. */
export function getDetailMonthCellGeometry(
    detailCellHeight: number
): DetailMonthCellGeometry {
    "worklet";

    const height = Math.max(
        32,
        Math.min(CALENDAR_DAY_HEIGHTS.detail, detailCellHeight)
    );
    const progress = Math.max(
        0,
        Math.min(
            1,
            (height - 32) / (CALENDAR_DAY_HEIGHTS.detail - 32)
        )
    );
    return {
        circleSize: 16 + 24 * progress,
        circleTop: 1 + 7 * progress,
        dayFontSize: 10 + 8 * progress,
        dayLineHeight: 10 + 10 * progress,
        lunarMaxWidth: 14 + 24 * progress,
        lunarFontSize: 4.5 + 3.5 * progress,
        lunarLineHeight: 5 + 4 * progress,
        holidayFontSize: 5.5 + 3 * progress,
        holidayLineHeight: 6 + 4 * progress,
    };
}

/** 일정의 이동 수단을 날짜 셀에 표시할 아이콘 이름으로 변환한다. */
export function getDetailMonthTravelIconName(
    mode: CalendarMarkedEvent["travelMode"]
): keyof typeof Ionicons.glyphMap {
    if (mode === "TRANSIT") return "bus-outline";
    if (mode === "CAR") return "car-outline";
    if (mode === "WALK") return "walk-outline";
    if (mode === "BIKE") return "bicycle-outline";
    return "navigate-outline";
}

export type DetailMonthPagerSelectionPosition = -1 | 0 | 1;

export type DetailMonthPagerSelectionLayerProps = {
    children: React.ReactNode;
    pageWidth: number;
    firstDay: 0 | 1;
    todayKey: number;
    animatedSelectedDayKey: SharedValue<number>;
    visualMonthOrdinal: SharedValue<number>;
    windowStartOrdinal: SharedValue<number>;
    slotPageHeights: SharedValue<number[]>;
    slotDayHeights: SharedValue<number[]>;
    axis: SharedValue<0 | 1 | 2>;
    selectedDayBackground: string;
    selectedDayText: string;
    lunarTextByDayKey: Readonly<Record<number, string>>;
    initialSelectedDayKey: number;
    initialVisualMonthOrdinal: number;
};

export type DetailMonthPagerSelectionGlyphOptions = Pick<
    DetailMonthPagerSelectionLayerProps,
    | "pageWidth"
    | "firstDay"
    | "todayKey"
    | "animatedSelectedDayKey"
    | "visualMonthOrdinal"
    | "windowStartOrdinal"
    | "slotPageHeights"
    | "slotDayHeights"
    | "axis"
> & {
    position: DetailMonthPagerSelectionPosition;
    animatedLunarTextByDayKey: SharedValue<
        Readonly<Record<number, string>>
    >;
};

export const DETAIL_MONTH_GREGORIAN_OFFSETS = [
    0,
    3,
    2,
    5,
    0,
    3,
    5,
    1,
    4,
    6,
    2,
    4,
] as const;

/** 대상 월 첫날 앞에 필요한 빈 셀 수를 UI 스레드에서 계산한다. */
export function getDetailMonthLeadingDayCountOnUI(
    monthOrdinal: number,
    firstDay: 0 | 1
): number {
    "worklet";

    const year = Math.floor(monthOrdinal / 12);
    const month = monthOrdinal - year * 12 + 1;
    const weekdayYear = month < 3 ? year - 1 : year;
    const weekday = (
        weekdayYear
        + Math.floor(weekdayYear / 4)
        - Math.floor(weekdayYear / 100)
        + Math.floor(weekdayYear / 400)
        + DETAIL_MONTH_GREGORIAN_OFFSETS[month - 1]
        + 1
    ) % 7;
    return (weekday - firstDay + 7) % 7;
}

/** 월 이동 중 선택 표시가 현재·이전·다음 페이지를 자연스럽게 따라가도록 위치와 텍스트 애니메이션을 만든다. */
export function useDetailMonthPagerSelectionGlyph({
    position,
    pageWidth,
    firstDay,
    todayKey,
    animatedSelectedDayKey,
    visualMonthOrdinal,
    windowStartOrdinal,
    slotPageHeights,
    slotDayHeights,
    axis,
    animatedLunarTextByDayKey,
}: DetailMonthPagerSelectionGlyphOptions) {
    const animatedContainerStyle = useAnimatedStyle(() => {
        const targetOrdinal = visualMonthOrdinal.value + position;
        const slotId = targetOrdinal - windowStartOrdinal.value;
        const pageHeights = slotPageHeights.value;
        const dayHeights = slotDayHeights.value;
        const isInWindow = slotId >= 0
            && slotId < pageHeights.length
            && slotId < dayHeights.length;
        const selectedKey = resolveDetailMonthSelectionKeyOnUI(
            animatedSelectedDayKey.value,
            targetOrdinal
        );
        const selectedDate = selectedKey % 100;
        const leadingDayCount = getDetailMonthLeadingDayCountOnUI(
            targetOrdinal,
            firstDay
        );
        const cellIndex = leadingDayCount + selectedDate - 1;
        const column = cellIndex % DETAIL_MONTH_GRID_COLUMN_COUNT;
        const row = Math.floor(cellIndex / DETAIL_MONTH_GRID_COLUMN_COUNT);
        const cellHeight = Math.max(
            32,
            isInWindow
                ? dayHeights[slotId]
                : CALENDAR_DAY_HEIGHTS.detail
        );
        const geometry = getDetailMonthCellGeometry(cellHeight);
        const cellWidth = Math.max(
            1,
            pageWidth - DETAIL_MONTH_GRID_HORIZONTAL_PADDING * 2
        ) / DETAIL_MONTH_GRID_COLUMN_COUNT;
        const isVertical = axis.value === 2;
        const pageTranslateX = isVertical ? 0 : position * pageWidth;
        const pageTranslateY = isVertical
            ? getDetailMonthPagerVerticalOffset(
                targetOrdinal,
                visualMonthOrdinal.value,
                windowStartOrdinal.value,
                pageHeights
            )
            : 0;
        return {
            opacity: isInWindow
                && selectedKey > 0
                && selectedKey !== todayKey
                ? 1
                : 0,
            width: geometry.circleSize,
            height: geometry.circleSize,
            borderRadius: geometry.circleSize / 2,
            transform: [
                {
                    translateX:
                        pageTranslateX
                        + DETAIL_MONTH_GRID_HORIZONTAL_PADDING
                        + column * cellWidth
                        + (cellWidth - geometry.circleSize) / 2,
                },
                {
                    translateY:
                        pageTranslateY
                        + row * cellHeight
                        + geometry.circleTop,
                },
            ],
        };
    }, [firstDay, pageWidth, position, todayKey]);
    const animatedDayStyle = useAnimatedStyle(() => {
        const targetOrdinal = visualMonthOrdinal.value + position;
        const slotId = targetOrdinal - windowStartOrdinal.value;
        const dayHeights = slotDayHeights.value;
        const isInWindow = slotId >= 0 && slotId < dayHeights.length;
        const cellHeight = Math.max(
            32,
            isInWindow
                ? dayHeights[slotId]
                : CALENDAR_DAY_HEIGHTS.detail
        );
        const geometry = getDetailMonthCellGeometry(cellHeight);
        return {
            width: geometry.circleSize,
            height: geometry.dayLineHeight,
            fontSize: geometry.dayFontSize,
            lineHeight: geometry.dayLineHeight,
        };
    }, [position]);
    const animatedLunarStyle = useAnimatedStyle(() => {
        const targetOrdinal = visualMonthOrdinal.value + position;
        const slotId = targetOrdinal - windowStartOrdinal.value;
        const dayHeights = slotDayHeights.value;
        const isInWindow = slotId >= 0 && slotId < dayHeights.length;
        const selectedKey = resolveDetailMonthSelectionKeyOnUI(
            animatedSelectedDayKey.value,
            targetOrdinal
        );
        const lunarText = isInWindow
            ? animatedLunarTextByDayKey.value[selectedKey] ?? ""
            : "";
        const cellHeight = Math.max(
            32,
            isInWindow
                ? dayHeights[slotId]
                : CALENDAR_DAY_HEIGHTS.detail
        );
        const geometry = getDetailMonthCellGeometry(cellHeight);
        return {
            opacity: lunarText ? 1 : 0,
            width: geometry.lunarMaxWidth,
            height: lunarText ? geometry.lunarLineHeight : 0,
            fontSize: geometry.lunarFontSize,
            lineHeight: geometry.lunarLineHeight,
        };
    }, [position]);
    const animatedDayProps = useAnimatedProps(() => {
        const targetOrdinal = visualMonthOrdinal.value + position;
        const slotId = targetOrdinal - windowStartOrdinal.value;
        const isInWindow = slotId >= 0
            && slotId < slotPageHeights.value.length
            && slotId < slotDayHeights.value.length;
        const selectedKey = resolveDetailMonthSelectionKeyOnUI(
            animatedSelectedDayKey.value,
            targetOrdinal
        );
        const selectedDate = selectedKey % 100;
        const text = isInWindow && selectedDate > 0
            ? String(selectedDate)
            : "";
        const isAccessibleSelection = position === 0
            && isInWindow
            && selectedKey > 0;
        const selectedYear = Math.floor(selectedKey / 10_000);
        const selectedMonth = Math.floor((selectedKey % 10_000) / 100);
        const lunarText = isInWindow
            ? animatedLunarTextByDayKey.value[selectedKey] ?? ""
            : "";
        const accessibilityLabel = isAccessibleSelection
            ? `${selectedYear}년 ${selectedMonth}월 ${selectedDate}일, 선택됨${
                selectedKey === todayKey ? ", 오늘" : ""
            }${lunarText ? `, ${lunarText}` : ""}`
            : "";
        return {
            text,
            defaultValue: text,
            accessibilityLabel,
            accessible: isAccessibleSelection,
            accessibilityElementsHidden: !isAccessibleSelection,
            importantForAccessibility: isAccessibleSelection
                ? "yes"
                : "no-hide-descendants",
        };
    }, [position, todayKey]);
    const animatedLunarProps = useAnimatedProps(() => {
        const targetOrdinal = visualMonthOrdinal.value + position;
        const slotId = targetOrdinal - windowStartOrdinal.value;
        const isInWindow = slotId >= 0
            && slotId < slotPageHeights.value.length
            && slotId < slotDayHeights.value.length;
        const selectedKey = resolveDetailMonthSelectionKeyOnUI(
            animatedSelectedDayKey.value,
            targetOrdinal
        );
        const text = isInWindow
            ? animatedLunarTextByDayKey.value[selectedKey] ?? ""
            : "";
        return {
            text,
            defaultValue: text,
        };
    }, [position]);

    return {
        animatedContainerStyle,
        animatedDayStyle,
        animatedLunarStyle,
        animatedDayProps,
        animatedLunarProps,
    };
}

/** 세 페이저 위치의 선택 표시를 격자 위에 합성하고 현재 선택만 접근성 대상으로 노출한다. */
export function DetailMonthPagerSelectionLayer({
    children,
    pageWidth,
    firstDay,
    todayKey,
    animatedSelectedDayKey,
    visualMonthOrdinal,
    windowStartOrdinal,
    slotPageHeights,
    slotDayHeights,
    axis,
    selectedDayBackground,
    selectedDayText,
    lunarTextByDayKey,
    initialSelectedDayKey,
    initialVisualMonthOrdinal,
}: DetailMonthPagerSelectionLayerProps) {
    const animatedLunarTextByDayKey = useSharedValue(lunarTextByDayKey);
    useLayoutEffect(() => {
        animatedLunarTextByDayKey.value = lunarTextByDayKey;
    }, [animatedLunarTextByDayKey, lunarTextByDayKey]);
    const sharedGlyphOptions = {
        pageWidth,
        firstDay,
        todayKey,
        animatedSelectedDayKey,
        visualMonthOrdinal,
        windowStartOrdinal,
        slotPageHeights,
        slotDayHeights,
        axis,
        animatedLunarTextByDayKey,
    };
    const previous = useDetailMonthPagerSelectionGlyph({
        ...sharedGlyphOptions,
        position: -1,
    });
    const current = useDetailMonthPagerSelectionGlyph({
        ...sharedGlyphOptions,
        position: 0,
    });
    const next = useDetailMonthPagerSelectionGlyph({
        ...sharedGlyphOptions,
        position: 1,
    });
    const glyphs = [
        { key: "previous", position: -1, ...previous },
        { key: "current", position: 0, ...current },
        { key: "next", position: 1, ...next },
    ] as const;

    return (
        <>
            {children}
            {glyphs.map((glyph) => {
                const initialKey = resolveDetailMonthSelectionKeyOnUI(
                    initialSelectedDayKey,
                    initialVisualMonthOrdinal + glyph.position
                );
                const initialLunarText = lunarTextByDayKey[initialKey] ?? "";
                return (
                    <Reanimated.View
                        key={`selection-glyph-${glyph.key}`}
                        testID={`detail-month-selection-${glyph.key}`}
                        pointerEvents="none"
                        accessible={false}
                        importantForAccessibility="no"
                        style={[
                            styles.detailMonthSelectionGlyph,
                            { backgroundColor: selectedDayBackground },
                            glyph.animatedContainerStyle,
                        ]}
                    >
                        <DetailMonthAnimatedTextInput
                            testID={`detail-month-selection-day-${glyph.key}`}
                            editable={false}
                            caretHidden
                            pointerEvents="none"
                            accessibilityState={glyph.position === 0
                                ? { selected: true }
                                : undefined}
                            defaultValue={String(initialKey % 100)}
                            animatedProps={glyph.animatedDayProps as never}
                            underlineColorAndroid="transparent"
                            style={[
                                styles.detailMonthSelectionDayText,
                                { color: selectedDayText },
                                glyph.animatedDayStyle,
                            ]}
                        />
                        <DetailMonthAnimatedTextInput
                            testID={`detail-month-selection-lunar-${glyph.key}`}
                            editable={false}
                            caretHidden
                            pointerEvents="none"
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            defaultValue={initialLunarText}
                            animatedProps={glyph.animatedLunarProps as never}
                            underlineColorAndroid="transparent"
                            style={[
                                styles.detailMonthSelectionLunarText,
                                { color: selectedDayText },
                                glyph.animatedLunarStyle,
                            ]}
                        />
                    </Reanimated.View>
                );
            })}
        </>
    );
}


const styles = createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
});

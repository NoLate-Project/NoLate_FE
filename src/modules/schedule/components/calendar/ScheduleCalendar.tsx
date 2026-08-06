import React, {
    startTransition,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Animated,
    Easing,
    FlatList,
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Calendar, DateData } from "react-native-calendars";
import Reanimated, {
    cancelAnimation as cancelReanimatedAnimation,
    Easing as ReanimatedEasing,
    runOnJS,
    runOnUI,
    type SharedValue,
    useAnimatedProps,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import type { ScheduleItem } from "../../types";
import {
    formatLunarCalendarDay,
    type CalendarDayMetadata,
} from "../../calendarMetadata";
import { useTheme } from "../../../theme/ThemeContext";
import {
    CALENDAR_INTERACTION_BUDGET_MS,
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
    getDetailMonthSwipeOffsets,
    getDetailMonthSwipeSettleDuration,
    type DetailMonthSwipeDirection,
} from "../../calendarMotion";
import { shiftCalendarMonth } from "../../calendarNavigation";
import CustomDay from "./CustomDay";
import { getCalendarTodayAccent } from "./calendarTodayAccent";
import StackWeekEventLabels from "./StackWeekEventLabels";
import {
    createStackCalendarLayout,
    enumerateStackScheduleDays,
} from "./stackCalendarLayout";
import {
    CALENDAR_DAY_HEIGHTS,
    isContinuousMonthViewMode,
    type CalendarViewMode,
} from "./viewMode";

type Props = {
    selectedDay: string;
    focusedMonth?: string;
    items: ScheduleItem[];
    calendarDaysByDate?: Readonly<Record<string, CalendarDayMetadata>>;
    onSelectDay: (day: string) => void;
    onOpenDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    onVisibleMonthChange: (month: string) => void;
    headerOffset?: number;
    transitionMonthKey?: string;
    transitionActive?: boolean;
    transitionContext?: "idle" | "yearToMonth" | "monthToDay" | "dayToMonth";
    reduceMotionEnabled?: boolean;
    todayFocusTarget?: TodayFocusTarget | null;
    onTodayFocusReady?: (day: string) => void;
    onRegisterDetailMonthMotionCancel?: (
        cancel: (() => void) | null
    ) => void;
    onRegisterDetailMonthMotionShift?: (
        shift: ((direction: DetailMonthSwipeDirection) => void) | null
    ) => void;
    onDetailMonthPreview?: (day: string) => void;
    onCommitDetailMonth?: (day: string) => void;
    onDetailMonthMotionActiveChange?: (active: boolean) => void;
    detailMonthMotionActive?: SharedValue<boolean>;
    animatedCalendarHeight?: SharedValue<number>;
    animatedDayHeight?: SharedValue<number>;
    detailMonthPageLayouts?: DetailMonthPageLayouts;
    bottomContentInset?: number;
};

export type DetailMonthPageLayout = {
    month?: string;
    calendarHeight: number;
    dayHeight: number;
};

export type DetailMonthWeekCount = 4 | 5 | 6;

export type DetailMonthPageLayouts = {
    byWeekCount?: Readonly<Partial<Record<
        DetailMonthWeekCount,
        DetailMonthPageLayout
    >>>;
    beforePrevious?: DetailMonthPageLayout;
    previous: DetailMonthPageLayout;
    current: DetailMonthPageLayout;
    next: DetailMonthPageLayout;
    afterNext?: DetailMonthPageLayout;
};

export type TodayFocusTarget = {
    day: string;
    requiresMonthChange: boolean;
};

type CalendarDayComponentProps = {
    date?: DateData;
    state?: string;
    marking?: React.ComponentProps<typeof CustomDay>["marking"];
};

type CalendarMarkedEvent = NonNullable<
    NonNullable<CalendarDayComponentProps["marking"]>["events"]
>[number];

const DetailMonthAnimatedTextInput =
    Reanimated.createAnimatedComponent(TextInput);

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const STACK_MONTH_RANGE = 60;
const WEEKDAY_HEADER_HEIGHT = 42;
const STACK_MONTH_HEADER_HEIGHT = 52;
const STACK_MONTH_DIVIDER_HEIGHT = StyleSheet.hairlineWidth;
const CALENDAR_HEADER_TOP_MARGIN = 14;
const CALENDAR_HEADER_BOTTOM_MARGIN = 8;
const CALENDAR_HEADER_SPACING =
    CALENDAR_HEADER_TOP_MARGIN + CALENDAR_HEADER_BOTTOM_MARGIN;
const CALENDAR_CONTENT_BOTTOM_PADDING = 4;
const TRANSITION_MONTH_PREFIX = "month-";
const DETAIL_MONTH_SWIPE_EASING = Easing.bezier(
    ...DETAIL_MONTH_SWIPE_MOTION.bezier
);
const DETAIL_MONTH_SWIPE_REANIMATED_EASING = ReanimatedEasing.bezier(
    ...DETAIL_MONTH_SWIPE_MOTION.bezier
);
const DETAIL_MONTH_SWIPE_SETTLE_REANIMATED_EASING =
    ReanimatedEasing.bezier(
        ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
    );
const DETAIL_MONTH_SWIPE_QUEUE_LIMIT = 6;
// Keep a whole rapid-swipe session mounted. Moving between these pages is a
// UI-thread ordinal change; React only rebuilds the window after the user has
// stopped near one of its guards. The 24-month regression burst therefore has
// no Calendar mount/recycle work in its input path.
const DETAIL_MONTH_PAGER_RADIUS = 26;
const DETAIL_MONTH_PAGER_GUARD = 3;
const DETAIL_MONTH_PAGER_POSITIONS = Array.from(
    { length: DETAIL_MONTH_PAGER_RADIUS * 2 + 1 },
    (_, index) => index - DETAIL_MONTH_PAGER_RADIUS
);
const EMPTY_CALENDAR_DAYS_BY_DATE: Readonly<Record<string, CalendarDayMetadata>> = {};

function getCalendarDaySelectionKey(day: string): number {
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    const date = Number(day.slice(8, 10));
    if (![year, month, date].every(Number.isFinite)) return 0;
    return year * 10_000 + month * 100 + date;
}

function getCalendarDayFromSelectionKey(dayKey: number): string | null {
    const year = Math.floor(dayKey / 10_000);
    const month = Math.floor((dayKey % 10_000) / 100);
    const date = dayKey % 100;
    if (
        year <= 0
        || month < 1
        || month > 12
        || date < 1
        || date > 31
    ) return null;

    return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function shiftCalendarDaySelectionKeyOnUI(
    dayKey: number,
    direction: -1 | 1
): number {
    "worklet";

    const year = Math.floor(dayKey / 10_000);
    const month = Math.floor((dayKey % 10_000) / 100);
    const date = dayKey % 100;
    if (year <= 0 || month < 1 || month > 12 || date < 1) return dayKey;

    const targetMonthIndex = year * 12 + month - 1 + direction;
    const targetYear = Math.floor(targetMonthIndex / 12);
    const targetMonth = targetMonthIndex - targetYear * 12 + 1;
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
        + Math.min(date, lastDate);
}

type DetailMonthPagerSlot = {
    id: number;
    day: string;
    monthOrdinal: number;
};

function getCalendarMonthOrdinal(day: string): number {
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month)) return 0;
    return year * 12 + month - 1;
}

function createDetailMonthPagerSlots(anchorDay: string): DetailMonthPagerSlot[] {
    return DETAIL_MONTH_PAGER_POSITIONS.map((offset, id) => {
        const day = shiftCalendarMonth(anchorDay, offset);
        return {
            id,
            day,
            monthOrdinal: getCalendarMonthOrdinal(day),
        };
    });
}

function resolveDetailMonthPagerLayout(
    day: string,
    layouts: DetailMonthPageLayouts | undefined,
    initialMonthKey: string,
    firstDay: 0 | 1
) {
    if (!layouts) return undefined;

    const month = day.slice(0, 7);
    const targetWeekCount = getMonthWeekCount(
        month,
        firstDay
    ) as DetailMonthWeekCount;
    const weekCountLayout = layouts.byWeekCount?.[targetWeekCount];
    if (weekCountLayout) return weekCountLayout;

    const exactLayout = [
        layouts.beforePrevious,
        layouts.previous,
        layouts.current,
        layouts.next,
        layouts.afterNext,
    ].find((layout) => layout?.month === month);
    if (exactLayout) return exactLayout;

    const initialDay = `${initialMonthKey}-01`;
    const relativeLayouts = [
        [-2, layouts.beforePrevious],
        [-1, layouts.previous],
        [0, layouts.current],
        [1, layouts.next],
        [2, layouts.afterNext],
    ] as const;
    const relativeLayout = relativeLayouts.find(([offset, layout]) => (
        layout
        && shiftCalendarMonth(initialDay, offset).slice(0, 7) === month
    ));
    if (relativeLayout?.[1]) return relativeLayout[1];

    // During a long burst the visual ring can move beyond the parent's
    // controlled ±2-month layout window. Reuse geometry from a prefetched
    // month with the same number of week rows instead of falling back to the
    // stale centre page and changing height when React catches up.
    return [
        layouts.beforePrevious,
        layouts.previous,
        layouts.current,
        layouts.next,
        layouts.afterNext,
    ].find((layout) => (
        layout?.month
        && getMonthWeekCount(layout.month, firstDay) === targetWeekCount
    )) ?? layouts.current;
}

function getDetailMonthPagerVerticalOffset(
    pageOrdinal: number,
    visualOrdinal: number,
    windowStartOrdinal: number,
    calendarHeights: readonly number[]
) {
    "worklet";

    const position = pageOrdinal - visualOrdinal;
    if (position === 0) return 0;

    const visualSlotId = visualOrdinal - windowStartOrdinal;
    let offset = 0;
    if (position > 0) {
        for (
            let index = visualSlotId;
            index < visualSlotId + position;
            index += 1
        ) {
            offset += Math.max(1, calendarHeights[index] ?? 1);
        }
    } else {
        for (
            let index = visualSlotId - 1;
            index >= visualSlotId + position;
            index -= 1
        ) {
            offset -= Math.max(1, calendarHeights[index] ?? 1);
        }
    }
    return offset;
}

type DetailMonthAnimationPhase =
    | "idle"
    | "exit"
    | "settling"
    | "awaitingCommit"
    | "finalizing"
    | "enter";

type DetailMonthAnimationOptions = {
    gestureOffset?: number;
    gestureVelocity?: number;
    gestureAxis?: "horizontal" | "vertical";
    gestureAlreadySettled?: boolean;
    gestureSettleOwnedByUI?: boolean;
    targetDay?: string;
};

type DetailMonthPendingCommand = {
    direction: DetailMonthSwipeDirection;
    axis: "horizontal" | "vertical";
};

type FixedCalendarHeightOptions = {
    viewMode: CalendarViewMode;
    month: string;
    firstDay: 0 | 1;
    headerOffset: number;
};

type StackMonth = {
    key: string;
    year: number;
    month: number;
    dateString: string;
    days: Array<DateData | null>;
    dayHeight: number;
    headerHeight: number;
    height: number;
};

function getMonthWeekCount(month: string, firstDay: 0 | 1): number {
    const [yearText, monthText] = month.slice(0, 7).split("-");
    const year = Number(yearText);
    const monthNumber = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return 6;

    const monthIndex = monthNumber - 1;
    const leadingBlankCount = (
        new Date(year, monthIndex, 1).getDay() - firstDay + 7
    ) % 7;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    return Math.ceil((leadingBlankCount + dayCount) / 7);
}

/** 패널형 월간 달력의 높이를 실제 Calendar 레이아웃과 동일하게 계산한다. */
export function getFixedScheduleCalendarHeight({
    viewMode,
    month,
    firstDay,
    headerOffset,
}: FixedCalendarHeightOptions): number | null {
    if (viewMode !== "detail" && viewMode !== "list" && viewMode !== "week") {
        return null;
    }

    if (viewMode === "week") {
        return 58 + WEEKDAY_HEADER_HEIGHT + CALENDAR_DAY_HEIGHTS.week;
    }

    return headerOffset
        + CALENDAR_HEADER_SPACING
        + getMonthWeekCount(month, firstDay) * CALENDAR_DAY_HEIGHTS[viewMode]
        + CALENDAR_CONTENT_BOTTOM_PADDING;
}

function normalizeMonthCandidate(value: string | null | undefined): string | null {
    if (!value) return null;

    const trimmed = value.startsWith(TRANSITION_MONTH_PREFIX)
        ? value.slice(TRANSITION_MONTH_PREFIX.length)
        : value;
    const candidate = trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;

    return /^\d{4}-\d{2}$/.test(candidate) ? candidate : null;
}

function getMonthDistance(from: Date, toMonth: string): number {
    const [yearText, monthText] = toMonth.split("-");
    const toYear = Number(yearText);
    const toMonthIndex = Number(monthText) - 1;

    return (toYear - from.getFullYear()) * 12
        + toMonthIndex
        - from.getMonth();
}

function resolveDetailMonthAnchor(selectedDay: string, visibleMonth: string): string {
    if (selectedDay.startsWith(`${visibleMonth}-`)) return selectedDay;
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(selectedDay)
        || !/^\d{4}-\d{2}$/.test(visibleMonth)
    ) return `${visibleMonth}-01`;

    const selectedOrdinal = getCalendarMonthOrdinal(selectedDay);
    const visibleOrdinal = getCalendarMonthOrdinal(`${visibleMonth}-01`);
    return shiftCalendarMonth(
        selectedDay,
        visibleOrdinal - selectedOrdinal
    );
}

function toDateString(year: number, month: number, day = 1) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function createStackMonth(
    date: Date,
    firstDay: 0 | 1,
    dayHeight: number,
    headerHeight: number
): StackMonth {
    const year = date.getFullYear();
    const monthIndex = date.getMonth();
    const month = monthIndex + 1;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const leadingBlankCount = (
        new Date(year, monthIndex, 1).getDay() - firstDay + 7
    ) % 7;
    const weekCount = Math.ceil((leadingBlankCount + dayCount) / 7);
    const totalCellCount = weekCount * 7;
    const days = Array.from(
        { length: totalCellCount },
        (_, index): DateData | null => {
            const day = index - leadingBlankCount + 1;
            if (day < 1 || day > dayCount) return null;

            const current = new Date(year, monthIndex, day);
            return {
                year,
                month,
                day,
                dateString: toDateString(year, month, day),
                timestamp: current.getTime(),
            };
        }
    );
    return {
        key: `${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
        dateString: toDateString(year, month),
        days,
        dayHeight,
        headerHeight,
        height:
            headerHeight
            + weekCount * dayHeight
            + STACK_MONTH_DIVIDER_HEIGHT,
    };
}

function getTodayDateString() {
    const today = new Date();
    return toDateString(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function moveDay(day: string, amount: number) {
    const next = new Date(`${day}T00:00:00`);
    next.setDate(next.getDate() + amount);
    return toDateString(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

function compareMarkedEvents(left: CalendarMarkedEvent, right: CalendarMarkedEvent) {
    if (Boolean(left.allDay) !== Boolean(right.allDay)) {
        return left.allDay ? -1 : 1;
    }

    const leftStart = new Date(left.startAt).getTime();
    const rightStart = new Date(right.startAt).getTime();
    if (Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart !== rightStart) {
        return leftStart - rightStart;
    }

    return left.title.localeCompare(right.title, "ko");
}

function createWeekDays(day: string, firstDay: 0 | 1) {
    const selected = new Date(`${day}T00:00:00`);
    const diff = (selected.getDay() - firstDay + 7) % 7;
    const start = new Date(selected);
    start.setDate(selected.getDate() - diff);

    return Array.from({ length: 7 }, (_, index): DateData => {
        const current = new Date(start);
        current.setDate(start.getDate() + index);
        return {
            year: current.getFullYear(),
            month: current.getMonth() + 1,
            day: current.getDate(),
            dateString: toDateString(
                current.getFullYear(),
                current.getMonth() + 1,
                current.getDate()
            ),
            timestamp: current.getTime(),
        };
    });
}

function formatWeekTitle(days: DateData[]) {
    const first = days[0];
    const last = days[days.length - 1];

    if (first.month === last.month) {
        return `${first.month}월 ${first.day}-${last.day}일`;
    }
    return `${first.month}월 ${first.day}일-${last.month}월 ${last.day}일`;
}

type DetailMonthPagerPageFrameProps = {
    pageOrdinal: number;
    current: boolean;
    pageWidth: number;
    axis: SharedValue<0 | 1 | 2>;
    visualMonthOrdinal: SharedValue<number>;
    windowStartOrdinal: SharedValue<number>;
    slotPageHeights: SharedValue<number[]>;
    pageTestID: string;
    children: React.ReactNode;
};

function DetailMonthPagerPageFrame({
    pageOrdinal,
    current,
    pageWidth,
    axis,
    visualMonthOrdinal,
    windowStartOrdinal,
    slotPageHeights,
    pageTestID,
    children,
}: DetailMonthPagerPageFrameProps) {
    const animatedCurrentProps = useAnimatedProps(() => {
        const isVisualCurrent =
            pageOrdinal === visualMonthOrdinal.value;
        return {
            pointerEvents: isVisualCurrent
                ? ("box-only" as const)
                : ("none" as const),
            accessibilityElementsHidden: !isVisualCurrent,
            "aria-hidden": !isVisualCurrent,
            importantForAccessibility: isVisualCurrent
                ? ("auto" as const)
                : ("no-hide-descendants" as const),
        };
    }, [pageOrdinal]);
    const animatedPositionStyle = useAnimatedStyle(() => {
        const position = pageOrdinal - visualMonthOrdinal.value;
        if (axis.value === 2) {
            return {
                opacity: 1,
                transform: [
                    { translateX: 0 },
                    {
                        translateY: getDetailMonthPagerVerticalOffset(
                            pageOrdinal,
                            visualMonthOrdinal.value,
                            windowStartOrdinal.value,
                            slotPageHeights.value
                        ),
                    },
                ],
            };
        }
        return {
            opacity: 1,
            transform: [
                { translateX: position * pageWidth },
                { translateY: 0 },
            ],
        };
    }, [pageOrdinal, pageWidth]);

    return (
        <Reanimated.View
            testID={pageTestID}
            collapsable={false}
            animatedProps={animatedCurrentProps}
            pointerEvents={current ? "box-only" : "none"}
            accessibilityElementsHidden={!current}
            aria-hidden={!current}
            importantForAccessibility={
                current ? "auto" : "no-hide-descendants"
            }
            style={[
                styles.detailMonthPagerPage,
                styles.detailMonthPagerPageAbsolute,
                animatedPositionStyle,
            ]}
        >
            {children}
        </Reanimated.View>
    );
}

const DETAIL_MONTH_GRID_COLUMN_COUNT = 7;
const DETAIL_MONTH_GRID_ROW_COUNT = 6;
const DETAIL_MONTH_GRID_CELL_COUNT =
    DETAIL_MONTH_GRID_COLUMN_COUNT * DETAIL_MONTH_GRID_ROW_COUNT;
const DETAIL_MONTH_GRID_HORIZONTAL_PADDING = 12;
const DETAIL_MONTH_EVENT_MARKER_LIMIT = 3;
const DETAIL_MONTH_PAGE_MODEL_CACHE_LIMIT = 128;

type DetailMonthPageModel = {
    monthKey: string;
    monthOrdinal: number;
    leadingDayCount: number;
    weekCount: number;
    dates: DateData[];
};

type DetailMonthPagerGridProps = {
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

type DetailMonthCellGeometry = {
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

const detailMonthPageModelCache = new Map<string, DetailMonthPageModel>();

function getDetailMonthPageModel(
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

function resolveDetailMonthSelectionKeyOnUI(
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

function getDetailMonthCellGeometry(
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

function getDetailMonthTravelIconName(
    mode: CalendarMarkedEvent["travelMode"]
): keyof typeof Ionicons.glyphMap {
    if (mode === "TRANSIT") return "bus-outline";
    if (mode === "CAR") return "car-outline";
    if (mode === "WALK") return "walk-outline";
    if (mode === "BIKE") return "bicycle-outline";
    return "navigate-outline";
}

type DetailMonthPagerSelectionPosition = -1 | 0 | 1;

type DetailMonthPagerSelectionLayerProps = {
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

type DetailMonthPagerSelectionGlyphOptions = Pick<
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

const DETAIL_MONTH_GREGORIAN_OFFSETS = [
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

function getDetailMonthLeadingDayCountOnUI(
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

function useDetailMonthPagerSelectionGlyph({
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

function DetailMonthPagerSelectionLayer({
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

type DetailMonthGridCellProps = {
    model: DetailMonthPageModel;
    date: DateData;
    cellHeight: number;
    geometry: DetailMonthCellGeometry;
    marking?: CalendarDayComponentProps["marking"];
    metadata?: CalendarDayMetadata;
    todayDateString: string;
    textPrimary: string;
    textSecondary: string;
    colorMode: "dark" | "light";
    onPress: (day: DateData) => void;
};

function DetailMonthGridCell({
    model,
    date,
    cellHeight,
    geometry,
    marking,
    metadata,
    todayDateString,
    textPrimary,
    textSecondary,
    colorMode,
    onPress,
}: DetailMonthGridCellProps) {
    const isDisabled = date.dateString.slice(0, 7) !== model.monthKey;
    const isToday = date.dateString === todayDateString;
    const weekday = new Date(
        date.year,
        date.month - 1,
        date.day
    ).getDay();
    const isSunday = weekday === 0;
    const isWeekend = isSunday || weekday === 6;
    const holidayNames = (metadata?.holidays ?? []).map(
        (holiday) => holiday.name
    );
    const hasHoliday = holidayNames.length > 0;
    const lunarText = formatLunarCalendarDay(metadata);
    const events = marking?.events ?? [];
    const markerEvents = events.slice(0, DETAIL_MONTH_EVENT_MARKER_LIMIT);
    const overflowCount = Math.max(
        0,
        events.length - DETAIL_MONTH_EVENT_MARKER_LIMIT
    );
    const todayAccent = getCalendarTodayAccent(colorMode);
    const holidayAccent = colorMode === "dark" ? "#ff6961" : "#d92d20";
    const weekendDateColor = colorMode === "dark"
        ? "rgba(235,235,245,0.52)"
        : "rgba(60,60,67,0.52)";
    const dateTextColor = isToday
        ? "#ffffff"
        : hasHoliday || isSunday
            ? holidayAccent
            : isWeekend
                ? weekendDateColor
                : textPrimary;
    const holidayTop = geometry.circleTop + geometry.circleSize + 1;
    const markerTop = Math.min(
        cellHeight - 8,
        geometry.circleTop
            + geometry.circleSize
            + (hasHoliday ? geometry.holidayLineHeight + 2 : 3)
    );
    const accessibilityLabel = [
        `${date.year}년 ${date.month}월 ${date.day}일`,
        isToday ? "오늘" : undefined,
        lunarText ?? undefined,
        hasHoliday ? `공휴일 ${holidayNames.join(", ")}` : undefined,
        events.length > 0 ? `${events.length}개의 일정` : "일정 없음",
    ].filter(Boolean).join(", ");

    return (
        <Pressable
            testID={`detail-month-cell-${model.monthKey}-${date.dateString}`}
            onPress={() => onPress(date)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{
                disabled: false,
            }}
            style={({ pressed }) => [
                styles.detailMonthGridCell,
                styles.detailMonthGridDay,
                { height: cellHeight, opacity: pressed ? 0.55 : 1 },
            ]}
        >
                <View
                    testID="calendar-day-circle"
                    style={[
                        styles.detailMonthGridDayCircle,
                        {
                            width: geometry.circleSize,
                            height: geometry.circleSize,
                            borderRadius: geometry.circleSize / 2,
                            marginTop: geometry.circleTop,
                            backgroundColor: isToday
                                ? todayAccent
                                : "transparent",
                        },
                    ]}
                >
                    <Text
                        style={[
                            styles.detailMonthGridDayText,
                            {
                                color: dateTextColor,
                                fontSize: geometry.dayFontSize,
                                lineHeight: geometry.dayLineHeight,
                                fontWeight: isToday ? "700" : "600",
                                opacity: isDisabled ? 0.28 : 1,
                            },
                        ]}
                    >
                        {date.day}
                    </Text>
                    {lunarText ? (
                        <Text
                            testID="calendar-lunar-date"
                            numberOfLines={1}
                            style={[
                                styles.detailMonthGridLunarText,
                                {
                                    color: hasHoliday || isSunday
                                        ? isToday ? "#ffffff" : holidayAccent
                                        : isToday ? "#ffffff" : textSecondary,
                                    maxWidth: geometry.lunarMaxWidth,
                                    fontSize: geometry.lunarFontSize,
                                    lineHeight: geometry.lunarLineHeight,
                                    opacity: isDisabled ? 0.28 : 0.88,
                                },
                            ]}
                        >
                            {lunarText}
                        </Text>
                    ) : null}
                </View>

                {hasHoliday ? (
                    <Text
                        testID="calendar-holiday-name"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[
                            styles.detailMonthGridHolidayText,
                            {
                                top: holidayTop,
                                color: holidayAccent,
                                fontSize: geometry.holidayFontSize,
                                lineHeight: geometry.holidayLineHeight,
                                opacity: isDisabled ? 0.28 : 1,
                            },
                        ]}
                    >
                        {holidayNames.join(" · ")}
                    </Text>
                ) : null}

                {events.length > 0 ? (
                    <View
                        testID="detail-event-markers"
                        style={[
                            styles.detailMonthGridMarkers,
                            { top: markerTop },
                        ]}
                    >
                        {markerEvents.map((event) => event.travelMode ? (
                            <Ionicons
                                accessible={false}
                                key={event.id}
                                name={getDetailMonthTravelIconName(
                                    event.travelMode
                                )}
                                size={8}
                                color={event.color}
                                style={styles.detailMonthGridTravelMarker}
                            />
                        ) : (
                            <View
                                key={event.id}
                                style={[
                                    styles.detailMonthGridDot,
                                    { backgroundColor: event.color },
                                ]}
                            />
                        ))}
                        {overflowCount > 0 ? (
                            <Text
                                accessible={false}
                                testID="detail-event-overflow"
                                numberOfLines={1}
                                style={[
                                    styles.detailMonthGridEventMore,
                                    { color: textSecondary },
                                ]}
                            >
                                +{overflowCount}개
                            </Text>
                        ) : null}
                    </View>
                ) : null}
        </Pressable>
    );
}

function areDetailMonthPagerGridPropsEqual(
    previous: DetailMonthPagerGridProps,
    next: DetailMonthPagerGridProps
): boolean {
    if (
        previous.day !== next.day
        || previous.firstDay !== next.firstDay
        || previous.detailCellHeight !== next.detailCellHeight
        || previous.todayDateString !== next.todayDateString
        || previous.textPrimary !== next.textPrimary
        || previous.textSecondary !== next.textSecondary
        || previous.colorMode !== next.colorMode
        || previous.onPress !== next.onPress
        || previous.onShift !== next.onShift
    ) return false;

    if (
        previous.markedDates === next.markedDates
        && previous.calendarDaysByDate === next.calendarDaysByDate
    ) return true;

    return getDetailMonthPageModel(next.day, next.firstDay).dates.every(
        ({ dateString }) => (
            previous.markedDates?.[dateString]
                === next.markedDates?.[dateString]
            && previous.calendarDaysByDate[dateString]
                === next.calendarDaysByDate[dateString]
        )
    );
}

const DetailMonthPagerGrid = React.memo(
    function DetailMonthPagerGrid({
        day,
        firstDay,
        markedDates,
        calendarDaysByDate,
        detailCellHeight,
        todayDateString,
        textPrimary,
        textSecondary,
        colorMode,
        onPress,
        onShift,
    }: DetailMonthPagerGridProps) {
        const model = getDetailMonthPageModel(day, firstDay);
        const cellHeight = Math.max(
            32,
            detailCellHeight ?? CALENDAR_DAY_HEIGHTS.detail
        );
        const geometry = getDetailMonthCellGeometry(cellHeight);
        return (
            <View
                testID={`detail-month-grid-${model.monthKey}`}
                accessible={false}
                style={styles.detailMonthGrid}
            >
                {Array.from(
                    { length: DETAIL_MONTH_GRID_ROW_COUNT },
                    (_, rowIndex) => (
                        <View
                            key={`${model.monthKey}-row-${rowIndex}`}
                            testID={`detail-month-grid-row-${model.monthKey}-${rowIndex}`}
                            accessibilityElementsHidden={
                                rowIndex >= model.weekCount
                            }
                            aria-hidden={rowIndex >= model.weekCount}
                            importantForAccessibility={
                                rowIndex >= model.weekCount
                                    ? "no-hide-descendants"
                                    : "auto"
                            }
                            pointerEvents={
                                rowIndex >= model.weekCount ? "none" : "auto"
                            }
                            style={[
                                styles.detailMonthGridRow,
                                { height: cellHeight },
                                rowIndex >= model.weekCount
                                    ? styles.detailMonthGridHiddenRow
                                    : undefined,
                            ]}
                        >
                            {model.dates.slice(
                                rowIndex * DETAIL_MONTH_GRID_COLUMN_COUNT,
                                (rowIndex + 1)
                                    * DETAIL_MONTH_GRID_COLUMN_COUNT
                            ).map((date) => (
                                <DetailMonthGridCell
                                    key={`${model.monthKey}-${date.dateString}`}
                                    model={model}
                                    date={date}
                                    cellHeight={cellHeight}
                                    geometry={geometry}
                                    marking={markedDates?.[date.dateString]}
                                    metadata={
                                        calendarDaysByDate[date.dateString]
                                    }
                                    todayDateString={todayDateString}
                                    textPrimary={textPrimary}
                                    textSecondary={textSecondary}
                                    colorMode={colorMode}
                                    onPress={onPress}
                                />
                            ))}
                        </View>
                    )
                )}
                <View
                    testID={`detail-month-adjuster-${model.monthKey}`}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={`${model.monthKey} 월 이동`}
                    accessibilityActions={[
                        { name: "decrement", label: "이전 달" },
                        { name: "increment", label: "다음 달" },
                    ]}
                    onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === "decrement") {
                            onShift(-1);
                        } else if (
                            event.nativeEvent.actionName === "increment"
                        ) {
                            onShift(1);
                        }
                    }}
                    style={styles.detailMonthAccessibilityAdjuster}
                />
            </View>
        );
    },
    areDetailMonthPagerGridPropsEqual
);

// 스택형은 월이 위아래로 이어지는 목록을, 패널형은 고정 Calendar를 사용한다.
export default function ScheduleCalendar({
    selectedDay,
    focusedMonth,
    items,
    calendarDaysByDate = EMPTY_CALENDAR_DAYS_BY_DATE,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    headerOffset = 0,
    transitionMonthKey,
    transitionActive = false,
    reduceMotionEnabled = false,
    todayFocusTarget,
    onTodayFocusReady,
    onRegisterDetailMonthMotionCancel,
    onRegisterDetailMonthMotionShift,
    onDetailMonthPreview,
    onCommitDetailMonth,
    onDetailMonthMotionActiveChange,
    detailMonthMotionActive,
    animatedCalendarHeight,
    animatedDayHeight,
    detailMonthPageLayouts,
    bottomContentInset = 0,
}: Props) {
    const { colors, mode } = useTheme();
    // 상위 화면은 분 단위로 다시 렌더링된다. 값을 mount 시점에 고정하면
    // 자정을 지난 뒤 주간 보기의 '오늘' 표시가 전날에 남는다.
    const todayDateString = getTodayDateString();
    const detailMonthSelectionLunarTextByDayKey = useMemo(() => {
        const lunarTextByDayKey: Record<number, string> = {};
        Object.entries(calendarDaysByDate).forEach(([day, metadata]) => {
            const lunarText = formatLunarCalendarDay(metadata);
            if (!lunarText) return;

            const dayKey = getCalendarDaySelectionKey(day);
            if (dayKey > 0) lunarTextByDayKey[dayKey] = lunarText;
        });
        return lunarTextByDayKey;
    }, [calendarDaysByDate]);
    const visibleMonth = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const stackTargetMonthKey = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const initialDate = resolveDetailMonthAnchor(selectedDay, visibleMonth);
    const initialMonthKey = initialDate.slice(0, 7);
    const [detailMonthPagerAnchorDay, setDetailMonthPagerAnchorDay] = useState(
        initialDate
    );
    const [detailMonthPagerHandoffDay, setDetailMonthPagerHandoffDay] = useState<
        string | null
    >(null);
    const [detailMonthPagerSlots, setDetailMonthPagerSlots] = useState(
        () => createDetailMonthPagerSlots(initialDate)
    );
    const detailMonthPagerSlotsRef = useRef(detailMonthPagerSlots);
    const detailMonthVisualAnchorDayRef = useRef(initialDate);
    const detailMonthSettledAnchorDayRef = useRef(initialDate);
    const detailMonthContinuousSettleCountRef = useRef(0);
    const detailMonthPendingControlledDayRef = useRef<string | null>(null);
    const detailMonthContinuousCommitTimerRef = useRef<
        ReturnType<typeof setTimeout> | null
    >(null);
    const detailMonthContinuousCommitTimerTokenRef = useRef<object | null>(
        null
    );
    const stackListRef = useRef<FlatList<StackMonth>>(null);
    const handledStackScrollRequestRef = useRef(scrollRequest);
    const internallyReportedStackMonthRef = useRef<string | null>(null);
    const positionedStackListSessionRef = useRef<string | null>(null);
    const positionedStackTargetMonthRef = useRef<string | null>(null);
    const stackListBaseKey = isContinuousMonthViewMode(viewMode)
        ? `${mode}-${viewMode}-${firstDay}`
        : null;
    const stackListSessionRef = useRef({
        key: stackListBaseKey,
        anchorMonth: new Date(`${visibleMonth}-01T00:00:00`),
    });
    const stackTargetOutsideRange = stackListBaseKey !== null
        && Math.abs(getMonthDistance(
            stackListSessionRef.current.anchorMonth,
            stackTargetMonthKey
        )) > STACK_MONTH_RANGE;
    if (
        stackListSessionRef.current.key !== stackListBaseKey
        || stackTargetOutsideRange
    ) {
        // The stack list is rebuilt when its presentation changes. Anchor the
        // new list to the month currently on screen, not the month that was
        // visible when ScheduleCalendar first mounted in another mode. Also
        // rebase when an explicit jump falls outside the finite list window.
        stackListSessionRef.current = {
            key: stackListBaseKey,
            anchorMonth: new Date(`${stackTargetMonthKey}-01T00:00:00`),
        };
    }
    const stackListAnchorMonth = stackListSessionRef.current.anchorMonth;
    const stackListAnchorKey = `${stackListAnchorMonth.getFullYear()}-${String(
        stackListAnchorMonth.getMonth() + 1
    ).padStart(2, "0")}`;
    const stackListSessionKey = stackListBaseKey === null
        ? null
        : `${stackListBaseKey}-${stackListAnchorKey}`;
    const activeStackMonthRef = useRef(visibleMonth);
    const { width: windowWidth } = useWindowDimensions();
    const [detailMonthViewportWidth, setDetailMonthViewportWidth] = useState(
        windowWidth
    );
    const [
        detailMonthViewportLayoutHeight,
        setDetailMonthViewportLayoutHeight,
    ] = useState<number>(DETAIL_MONTH_SWIPE_MOTION.travel);
    const detailMonthPageWidth = detailMonthViewportWidth > 0
        ? detailMonthViewportWidth
        : windowWidth;
    const detailMonthViewportHeight = useSharedValue<number>(
        DETAIL_MONTH_SWIPE_MOTION.travel
    );
    const detailMonthGesturePageHeight = useSharedValue<number>(
        DETAIL_MONTH_SWIPE_MOTION.travel
    );
    const detailMonthGesturePreviousPageHeight = useSharedValue<number>(
        DETAIL_MONTH_SWIPE_MOTION.travel
    );
    const detailMonthGestureSourceCalendarHeight = useSharedValue(0);
    const detailMonthGestureSourceDayHeight = useSharedValue(0);
    const detailMonthTranslateX = useRef(new Animated.Value(0)).current;
    const detailMonthTranslateY = useRef(new Animated.Value(0)).current;
    const detailMonthOpacity = useRef(new Animated.Value(1)).current;
    const detailMonthGestureTranslateX = useSharedValue(0);
    const detailMonthGestureTranslateY = useSharedValue(0);
    const detailMonthGestureBaseTranslateX = useSharedValue(0);
    const detailMonthGestureBaseTranslateY = useSharedValue(0);
    const detailMonthGestureOpacity = useSharedValue(1);
    const detailMonthGestureAxis = useSharedValue<0 | 1 | 2>(0);
    const detailMonthGestureCommitted = useSharedValue(false);
    const detailMonthGestureBlocked = useSharedValue(false);
    const detailMonthGestureRejected = useSharedValue(false);
    const detailMonthGestureStartedBlocked = useSharedValue(false);
    const detailMonthGestureAdoptionReady = useSharedValue(false);
    const detailMonthGestureAdoptedPresentation = useSharedValue(false);
    const detailMonthGestureSettleGeneration = useSharedValue(0);
    const detailMonthGestureActiveSettleDirection =
        useSharedValue<-1 | 0 | 1>(0);
    const detailMonthGestureActiveSettleAxis =
        useSharedValue<0 | 1 | 2>(0);
    const detailMonthGestureActiveSettleTargetOffset = useSharedValue(0);
    const detailMonthGestureQueuedDirection = useSharedValue<-1 | 0 | 1>(0);
    const detailMonthGestureQueuedAxis = useSharedValue<0 | 1 | 2>(0);
    const detailMonthVisualMonthOrdinal = useSharedValue(
        getCalendarMonthOrdinal(initialDate)
    );
    const detailMonthPagerWindowStartOrdinal = useSharedValue(
        getCalendarMonthOrdinal(initialDate) - DETAIL_MONTH_PAGER_RADIUS
    );
    const detailMonthPagerSlotCalendarHeights = useSharedValue<number[]>(
        DETAIL_MONTH_PAGER_POSITIONS.map(
            () => DETAIL_MONTH_SWIPE_MOTION.travel
        )
    );
    const detailMonthPagerSlotPageHeights = useSharedValue<number[]>(
        DETAIL_MONTH_PAGER_POSITIONS.map(
            () => DETAIL_MONTH_SWIPE_MOTION.travel
        )
    );
    const detailMonthPagerSlotDayHeights = useSharedValue<number[]>(
        DETAIL_MONTH_PAGER_POSITIONS.map(
            () => CALENDAR_DAY_HEIGHTS.detail
        )
    );
    const detailMonthVisualSelectedDayKey = useSharedValue(
        getCalendarDaySelectionKey(initialDate)
    );
    const detailMonthContinuousCommitPending = useSharedValue(false);
    const detailMonthContinuousCommitGeneration = useSharedValue(0);
    const detailMonthGestureAnimatedStyle = useAnimatedStyle(() => ({
        opacity: detailMonthGestureOpacity.value,
        transform: [
            { translateX: detailMonthGestureTranslateX.value },
            { translateY: detailMonthGestureTranslateY.value },
        ],
    }));
    const detailMonthAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const detailMonthAnimationFrameRef = useRef<number | null>(null);
    const detailMonthPagerHandoffFrameRef = useRef<number | null>(null);
    const detailMonthPagerRebaseFrameRef = useRef<number | null>(null);
    const detailMonthPagerRebasePendingRef = useRef<string | null>(null);
    const detailMonthCommitWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detailMonthDeadlineWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detailMonthAnimationActiveRef = useRef(false);
    const detailMonthAnimationPhaseRef = useRef<DetailMonthAnimationPhase>("idle");
    const detailMonthAnimationGenerationRef = useRef(0);
    const detailMonthAnimationSourceDayRef = useRef<string | null>(null);
    const detailMonthAnimationExpectedDayRef = useRef<string | null>(null);
    const detailMonthPreviewedDayRef = useRef<string | null>(null);
    const detailMonthSuppressedCommitRef = useRef<string | null>(null);
    const detailMonthAnimationPendingCommandsRef = useRef<
        DetailMonthPendingCommand[]
    >([]);
    const detailMonthAnimationEnterDurationRef = useRef(0);
    const detailMonthAnimationStartedAtRef = useRef(0);
    const detailMonthAnimationReduceMotionRef = useRef(reduceMotionEnabled);
    const detailMonthAnimationUsesPagerRef = useRef(false);
    const detailMonthAnimationUsesGestureLayerRef = useRef(false);
    const detailMonthAnimationAxisRef = useRef<"horizontal" | "vertical">(
        "horizontal"
    );
    const detailMonthGestureResetAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const detailMonthLatestSelectedDayRef = useRef(selectedDay);
    const detailMonthLatestVisibleMonthRef = useRef(visibleMonth);
    const detailMonthLatestViewModeRef = useRef(viewMode);
    const detailMonthLatestReduceMotionRef = useRef(reduceMotionEnabled);
    const detailMonthLatestTransitionActiveRef = useRef(transitionActive);
    const todayFocusTargetRef = useRef(todayFocusTarget);
    const acknowledgedTodayFocusTargetRef = useRef<TodayFocusTarget | null>(null);
    const onTodayFocusReadyRef = useRef(onTodayFocusReady);
    const startDetailMonthAnimationRef = useRef<(
        direction: DetailMonthSwipeDirection,
        options?: DetailMonthAnimationOptions
    ) => void>(() => undefined);
    const onSelectDayRef = useRef(onSelectDay);
    const onOpenDayRef = useRef(onOpenDay);
    const onVisibleMonthChangeRef = useRef(onVisibleMonthChange);
    const onDetailMonthPreviewRef = useRef(onDetailMonthPreview);
    const onCommitDetailMonthRef = useRef(onCommitDetailMonth);
    const onDetailMonthMotionActiveChangeRef = useRef(
        onDetailMonthMotionActiveChange
    );
    const detailMonthMotionOwnershipActiveRef = useRef(false);
    const detailMonthPageLayoutsRef = useRef(detailMonthPageLayouts);

    detailMonthLatestSelectedDayRef.current = selectedDay;
    detailMonthLatestVisibleMonthRef.current = visibleMonth;
    detailMonthLatestViewModeRef.current = viewMode;
    detailMonthLatestReduceMotionRef.current = reduceMotionEnabled;
    detailMonthLatestTransitionActiveRef.current = transitionActive;
    todayFocusTargetRef.current = todayFocusTarget;
    onTodayFocusReadyRef.current = onTodayFocusReady;
    onSelectDayRef.current = onSelectDay;
    onOpenDayRef.current = onOpenDay;
    onVisibleMonthChangeRef.current = onVisibleMonthChange;
    onDetailMonthPreviewRef.current = onDetailMonthPreview;
    onCommitDetailMonthRef.current = onCommitDetailMonth;
    onDetailMonthMotionActiveChangeRef.current =
        onDetailMonthMotionActiveChange;
    detailMonthPageLayoutsRef.current = detailMonthPageLayouts;

    useLayoutEffect(() => {
        const pendingDay = detailMonthPendingControlledDayRef.current;
        if (pendingDay !== null) {
            const pendingMonth = pendingDay.slice(0, 7);
            const acknowledged =
                selectedDay === pendingDay
                && visibleMonth === pendingMonth;
            if (!acknowledged) return;

            // The visual pager can be one gesture ahead of React while a
            // controlled transition is pending. Keep that protection until
            // both controlled props acknowledge this exact target; an older
            // month ACK must never reset a newer UI-thread pager position.
            detailMonthPendingControlledDayRef.current = null;
        }
        if (detailMonthContinuousSettleCountRef.current > 0) return;

        const controlledAnchor = resolveDetailMonthAnchor(
            selectedDay,
            visibleMonth
        );
        if (
            detailMonthVisualAnchorDayRef.current.slice(0, 7)
            === controlledAnchor.slice(0, 7)
        ) {
            // A same-month controlled selection can come from Today, quick
            // schedule creation or another parent action rather than this
            // calendar's own day press. Keep the next month shift anchored to
            // that newly selected day instead of the older pager day.
            detailMonthVisualAnchorDayRef.current = controlledAnchor;
            detailMonthSettledAnchorDayRef.current = controlledAnchor;
        }
        detailMonthVisualSelectedDayKey.value =
            getCalendarDaySelectionKey(controlledAnchor);
    }, [
        detailMonthVisualSelectedDayKey,
        selectedDay,
        visibleMonth,
    ]);

    useLayoutEffect(() => {
        const currentCalendarHeight =
            detailMonthPageLayouts?.current.calendarHeight;
        if (
            currentCalendarHeight !== undefined
            && Number.isFinite(currentCalendarHeight)
            && currentCalendarHeight > 0
        ) {
            // The parent height includes the sticky toolbar/weekday inset,
            // while these pager pages begin below that inset. Using the full
            // panel height here leaves a blank header-sized gap between
            // vertically adjacent months.
            detailMonthViewportHeight.value = Math.max(
                1,
                currentCalendarHeight - Math.max(0, headerOffset)
            );
        }
        const slotLayouts = detailMonthPagerSlots.map((slot) => (
            resolveDetailMonthPagerLayout(
                slot.day,
                detailMonthPageLayouts,
                initialMonthKey,
                firstDay
            )
        ));
        detailMonthPagerSlotPageHeights.value = slotLayouts.map(
            (layout) => Math.max(
                1,
                layout
                    ? layout.calendarHeight - Math.max(0, headerOffset)
                    : detailMonthViewportHeight.value
            )
        );
        detailMonthPagerSlotCalendarHeights.value = slotLayouts.map(
            (layout) => Math.max(
                1,
                layout?.calendarHeight
                    ?? (
                        detailMonthViewportHeight.value
                        + Math.max(0, headerOffset)
                    )
            )
        );
        detailMonthPagerSlotDayHeights.value = slotLayouts.map(
            (layout) => Math.max(
                1,
                layout?.dayHeight ?? CALENDAR_DAY_HEIGHTS.detail
            )
        );
    }, [
        detailMonthPageLayouts,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotDayHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPagerSlots,
        detailMonthViewportHeight,
        firstDay,
        headerOffset,
        initialMonthKey,
    ]);

    const setDetailMonthMotionOwnershipActive = useCallback((
        active: boolean
    ) => {
        if (detailMonthMotionOwnershipActiveRef.current === active) return;

        detailMonthMotionOwnershipActiveRef.current = active;
        onDetailMonthMotionActiveChangeRef.current?.(active);
    }, []);

    const emitDetailMonthPreview = useCallback((
        day: string,
        updateSelection = true
    ) => {
        if (updateSelection) {
            detailMonthVisualSelectedDayKey.value =
                getCalendarDaySelectionKey(day);
        }
        try {
            onDetailMonthPreviewRef.current?.(day);
        } catch {
            // Preview is a visual fast path. Native chrome must never be able
            // to interrupt the authoritative calendar/store commit.
        }
    }, [detailMonthVisualSelectedDayKey]);

    const commitDetailMonthControlledState = useCallback((day: string) => {
        const commit = onCommitDetailMonthRef.current;
        if (commit) {
            commit(day);
            return;
        }

        onVisibleMonthChangeRef.current(day);
        onSelectDayRef.current(day);
    }, []);

    const rebaseDetailMonthPagerWindowIfNeeded = useCallback((day: string) => {
        const slots = detailMonthPagerSlotsRef.current;
        const firstOrdinal = slots[0]?.monthOrdinal;
        const lastOrdinal = slots.at(-1)?.monthOrdinal;
        const visualOrdinal = getCalendarMonthOrdinal(day);
        if (
            firstOrdinal !== undefined
            && lastOrdinal !== undefined
            && visualOrdinal - firstOrdinal > DETAIL_MONTH_PAGER_GUARD
            && lastOrdinal - visualOrdinal > DETAIL_MONTH_PAGER_GUARD
        ) return;

        const rebasedSlots = createDetailMonthPagerSlots(day);
        detailMonthPagerSlotsRef.current = rebasedSlots;
        detailMonthPagerWindowStartOrdinal.value =
            rebasedSlots[0]?.monthOrdinal
            ?? visualOrdinal - DETAIL_MONTH_PAGER_RADIUS;
        setDetailMonthPagerSlots(rebasedSlots);
    }, [detailMonthPagerWindowStartOrdinal]);

    const holdDetailMonthContinuousCommit = useCallback(() => {
        // The UI worklets advance the shared generation before crossing to
        // JS. Keep JS cancellation on the timer token: SharedValue writes
        // made from JS are asynchronous on-device, so using them as a JS
        // counter can make a valid idle callback compare against a newer UI
        // value and discard its own commit.
        const pendingTimer = detailMonthContinuousCommitTimerRef.current;
        detailMonthContinuousCommitTimerTokenRef.current = null;
        if (pendingTimer === null) return;

        clearTimeout(pendingTimer);
        detailMonthContinuousCommitTimerRef.current = null;
    }, []);

    const flushDetailMonthContinuousCommit = useCallback((
        expectedGeneration: number,
        expectedTimerToken: object
    ) => {
        if (
            expectedGeneration
            !== detailMonthContinuousCommitGeneration.value
            || detailMonthContinuousCommitTimerTokenRef.current
                !== expectedTimerToken
        ) return;
        // A cancelled timer can already be queued on the JS event loop. Only
        // the callback that still owns the current reservation may consume
        // it; an older callback must never clear a newer idle commit.
        detailMonthContinuousCommitTimerRef.current = null;
        detailMonthContinuousCommitTimerTokenRef.current = null;
        if (detailMonthContinuousSettleCountRef.current > 0) return;

        const pendingDay = detailMonthPendingControlledDayRef.current;
        detailMonthContinuousCommitPending.value = false;
        if (pendingDay) {
            startTransition(() => {
                setDetailMonthPagerAnchorDay(pendingDay);
                rebaseDetailMonthPagerWindowIfNeeded(pendingDay);
                commitDetailMonthControlledState(pendingDay);
            });
        }
        setDetailMonthMotionOwnershipActive(false);
    }, [
        commitDetailMonthControlledState,
        detailMonthContinuousCommitGeneration,
        detailMonthContinuousCommitPending,
        rebaseDetailMonthPagerWindowIfNeeded,
        setDetailMonthMotionOwnershipActive,
    ]);

    const scheduleDetailMonthContinuousCommit = useCallback(() => {
        holdDetailMonthContinuousCommit();
        if (detailMonthContinuousSettleCountRef.current > 0) return;

        if (!detailMonthPendingControlledDayRef.current) {
            detailMonthContinuousCommitPending.value = false;
            setDetailMonthMotionOwnershipActive(false);
            return;
        }
        // Snapshot the UI touch epoch; do not mutate it from JS. The token
        // provides JS timer identity while this shared value only detects a
        // touch that landed before runOnJS cancellation reached this thread.
        const scheduledGeneration =
            detailMonthContinuousCommitGeneration.value;
        const scheduledTimerToken = {};
        detailMonthContinuousCommitTimerTokenRef.current =
            scheduledTimerToken;
        detailMonthContinuousCommitTimerRef.current = setTimeout(
            () => flushDetailMonthContinuousCommit(
                scheduledGeneration,
                scheduledTimerToken
            ),
            DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
        );
    }, [
        detailMonthContinuousCommitGeneration,
        detailMonthContinuousCommitPending,
        flushDetailMonthContinuousCommit,
        holdDetailMonthContinuousCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    const discardDetailMonthContinuousCommit = useCallback(() => {
        holdDetailMonthContinuousCommit();
        detailMonthPendingControlledDayRef.current = null;
        detailMonthContinuousSettleCountRef.current = 0;
        detailMonthContinuousCommitPending.value = false;
        detailMonthVisualSelectedDayKey.value = getCalendarDaySelectionKey(
            resolveDetailMonthAnchor(
                detailMonthLatestSelectedDayRef.current,
                detailMonthLatestVisibleMonthRef.current
            )
        );
        setDetailMonthMotionOwnershipActive(false);
    }, [
        detailMonthContinuousCommitPending,
        detailMonthVisualSelectedDayKey,
        holdDetailMonthContinuousCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    useEffect(() => () => {
        const pendingTimer = detailMonthContinuousCommitTimerRef.current;
        if (pendingTimer !== null) clearTimeout(pendingTimer);
        detailMonthContinuousCommitTimerRef.current = null;
        detailMonthContinuousCommitTimerTokenRef.current = null;
    }, []);

    const acknowledgeTodayFocusTarget = useCallback((day: string) => {
        const target = todayFocusTargetRef.current;
        if (
            !target ||
            target.day !== day ||
            acknowledgedTodayFocusTargetRef.current === target
        ) return;

        acknowledgedTodayFocusTargetRef.current = target;
        onTodayFocusReadyRef.current?.(target.day);
    }, []);

    const invalidateDetailMonthAnimation = useCallback((
        clearPending = true,
        keepGestureBlocked = false,
        keepMotionOwnershipActive = false
    ) => {
        detailMonthAnimationGenerationRef.current += 1;
        const activeAnimation = detailMonthAnimationRef.current;
        const activeGestureResetAnimation = detailMonthGestureResetAnimationRef.current;
        const activeFrame = detailMonthAnimationFrameRef.current;
        const activeHandoffFrame = detailMonthPagerHandoffFrameRef.current;
        const activeRebaseFrame = detailMonthPagerRebaseFrameRef.current;
        const activeWatchdog = detailMonthCommitWatchdogRef.current;
        const activeDeadlineWatchdog = detailMonthDeadlineWatchdogRef.current;
        const expectedMonth = detailMonthAnimationExpectedDayRef.current?.slice(0, 7);
        if (expectedMonth) detailMonthSuppressedCommitRef.current = expectedMonth;
        detailMonthAnimationRef.current = null;
        detailMonthAnimationFrameRef.current = null;
        detailMonthPagerHandoffFrameRef.current = null;
        detailMonthPagerRebaseFrameRef.current = null;
        detailMonthPagerRebasePendingRef.current = null;
        detailMonthCommitWatchdogRef.current = null;
        detailMonthDeadlineWatchdogRef.current = null;
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthAnimationPhaseRef.current = "idle";
        detailMonthAnimationSourceDayRef.current = null;
        detailMonthAnimationExpectedDayRef.current = null;
        detailMonthAnimationActiveRef.current = false;
        detailMonthAnimationUsesPagerRef.current = false;
        detailMonthAnimationUsesGestureLayerRef.current = false;
        const controlledAnchor = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        detailMonthVisualSelectedDayKey.value =
            getCalendarDaySelectionKey(controlledAnchor);
        const previewedDay = detailMonthPreviewedDayRef.current;
        detailMonthPreviewedDayRef.current = null;
        if (
            previewedDay
            && previewedDay.slice(0, 7) !== controlledAnchor.slice(0, 7)
        ) {
            emitDetailMonthPreview(controlledAnchor);
        }
        setDetailMonthPagerAnchorDay((current) => (
            current === controlledAnchor ? current : controlledAnchor
        ));
        setDetailMonthPagerHandoffDay((current) => (
            current === null ? current : null
        ));
        detailMonthAnimationAxisRef.current = "horizontal";
        detailMonthAnimationStartedAtRef.current = 0;
        if (clearPending) {
            detailMonthAnimationPendingCommandsRef.current = [];
        }
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureAdoptionReady.value = false;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthGestureQueuedDirection.value = 0;
        detailMonthGestureQueuedAxis.value = 0;
        detailMonthGestureBlocked.value = keepGestureBlocked;
        detailMonthGestureRejected.value = false;
        detailMonthGestureAxis.value = 0;
        detailMonthGestureCommitted.value = false;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;

        if (activeFrame !== null) cancelAnimationFrame(activeFrame);
        if (activeHandoffFrame !== null) {
            cancelAnimationFrame(activeHandoffFrame);
        }
        if (activeRebaseFrame !== null) {
            cancelAnimationFrame(activeRebaseFrame);
        }
        if (activeWatchdog !== null) clearTimeout(activeWatchdog);
        if (activeDeadlineWatchdog !== null) clearTimeout(activeDeadlineWatchdog);
        activeAnimation?.stop();
        activeGestureResetAnimation?.stop();
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        if (detailMonthLatestViewModeRef.current === "detail") {
            const currentLayout = detailMonthPageLayoutsRef.current?.current;
            if (currentLayout && animatedCalendarHeight) {
                cancelReanimatedAnimation(animatedCalendarHeight);
                animatedCalendarHeight.value = currentLayout.calendarHeight;
            }
            if (currentLayout && animatedDayHeight) {
                cancelReanimatedAnimation(animatedDayHeight);
                animatedDayHeight.value = currentLayout.dayHeight;
            }
        }
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureOpacity.value = 1;
        detailMonthTranslateX.stopAnimation();
        detailMonthTranslateY.stopAnimation();
        detailMonthOpacity.stopAnimation();
        detailMonthTranslateX.setValue(0);
        detailMonthTranslateY.setValue(0);
        detailMonthOpacity.setValue(1);
        if (!keepMotionOwnershipActive) {
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            setDetailMonthMotionOwnershipActive(false);
        }
    }, [
        animatedCalendarHeight,
        animatedDayHeight,
        detailMonthOpacity,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureBlocked,
        detailMonthGestureCommitted,
        detailMonthGestureQueuedAxis,
        detailMonthGestureQueuedDirection,
        detailMonthGestureRejected,
        detailMonthGestureSettleGeneration,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthMotionActive,
        detailMonthVisualSelectedDayKey,
        emitDetailMonthPreview,
        setDetailMonthMotionOwnershipActive,
    ]);

    const cancelDetailMonthMotion = useCallback(() => {
        discardDetailMonthContinuousCommit();
        invalidateDetailMonthAnimation(true);
    }, [
        discardDetailMonthContinuousCommit,
        invalidateDetailMonthAnimation,
    ]);

    const resetDetailMonthGesture = useCallback((
        durationMs: number = DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs
    ) => {
        detailMonthGestureResetAnimationRef.current?.stop();
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureAdoptionReady.value = false;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthGestureQueuedDirection.value = 0;
        detailMonthGestureQueuedAxis.value = 0;
        detailMonthGestureBlocked.value = false;
        detailMonthGestureRejected.value = false;
        detailMonthGestureAxis.value = 0;
        detailMonthGestureCommitted.value = false;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        const safeDurationMs = Number.isFinite(durationMs)
            ? Math.max(0, durationMs)
            : 0;
        const layoutResetDurationMs =
            detailMonthLatestReduceMotionRef.current ? 0 : safeDurationMs;
        const currentLayout = detailMonthPageLayoutsRef.current?.current;
        if (currentLayout && animatedCalendarHeight) {
            cancelReanimatedAnimation(animatedCalendarHeight);
            animatedCalendarHeight.value = layoutResetDurationMs > 0
                ? withTiming(currentLayout.calendarHeight, {
                    duration: layoutResetDurationMs,
                    easing: ReanimatedEasing.bezier(
                        ...DETAIL_MONTH_SWIPE_MOTION.bezier
                    ),
                })
                : currentLayout.calendarHeight;
        }
        if (currentLayout && animatedDayHeight) {
            cancelReanimatedAnimation(animatedDayHeight);
            animatedDayHeight.value = layoutResetDurationMs > 0
                ? withTiming(currentLayout.dayHeight, {
                    duration: layoutResetDurationMs,
                    easing: ReanimatedEasing.bezier(
                        ...DETAIL_MONTH_SWIPE_MOTION.bezier
                    ),
                })
                : currentLayout.dayHeight;
        }

        if (
            detailMonthLatestReduceMotionRef.current
            || safeDurationMs === 0
        ) {
            detailMonthGestureTranslateX.value = 0;
            detailMonthGestureTranslateY.value = 0;
            detailMonthGestureOpacity.value = 1;
            detailMonthTranslateX.setValue(0);
            detailMonthTranslateY.setValue(0);
            detailMonthOpacity.setValue(1);
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            setDetailMonthMotionOwnershipActive(false);
            return;
        }

        detailMonthGestureTranslateX.value = withTiming(0, {
            duration: safeDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });
        detailMonthGestureTranslateY.value = withTiming(0, {
            duration: safeDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });
        detailMonthGestureOpacity.value = withTiming(1, {
            duration: safeDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });

        const resetAnimation = Animated.parallel([
            Animated.timing(detailMonthTranslateX, {
                toValue: 0,
                duration: safeDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthTranslateY, {
                toValue: 0,
                duration: safeDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthOpacity, {
                toValue: 1,
                duration: safeDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        detailMonthGestureResetAnimationRef.current = resetAnimation;
        resetAnimation.start(() => {
            if (detailMonthGestureResetAnimationRef.current === resetAnimation) {
                detailMonthGestureResetAnimationRef.current = null;
            }
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            setDetailMonthMotionOwnershipActive(false);
        });
    }, [
        animatedCalendarHeight,
        animatedDayHeight,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureBlocked,
        detailMonthGestureCommitted,
        detailMonthGestureQueuedAxis,
        detailMonthGestureQueuedDirection,
        detailMonthGestureRejected,
        detailMonthGestureSettleGeneration,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthMotionActive,
        setDetailMonthMotionOwnershipActive,
    ]);

    useLayoutEffect(() => {
        if (!onRegisterDetailMonthMotionCancel) return undefined;

        onRegisterDetailMonthMotionCancel(cancelDetailMonthMotion);
        return () => onRegisterDetailMonthMotionCancel(null);
    }, [cancelDetailMonthMotion, onRegisterDetailMonthMotionCancel]);

    useEffect(() => {
        if (!todayFocusTarget) acknowledgedTodayFocusTargetRef.current = null;
    }, [todayFocusTarget]);

    useEffect(() => (
        () => invalidateDetailMonthAnimation(true)
    ), [invalidateDetailMonthAnimation]);

    const completeDetailMonthAnimation = useCallback((
        generation: number,
        allowGestureAdoption = false
    ) => {
        if (generation !== detailMonthAnimationGenerationRef.current) return;

        const [pendingCommand, ...remainingCommands] =
            detailMonthAnimationPendingCommandsRef.current;
        detailMonthAnimationPendingCommandsRef.current = remainingCommands;
        const shouldStartPending = Boolean(
            pendingCommand
            && detailMonthLatestViewModeRef.current === "detail"
        );
        const shouldAdoptHeldGesture = Boolean(
            allowGestureAdoption
            && !shouldStartPending
            && detailMonthGestureStartedBlocked.value
        );
        invalidateDetailMonthAnimation(
            false,
            shouldStartPending,
            shouldAdoptHeldGesture
        );
        if (allowGestureAdoption && !shouldStartPending) {
            detailMonthGestureBlocked.value = false;
            detailMonthGestureAdoptionReady.value = true;
        }
        if (
            !pendingCommand ||
            detailMonthLatestViewModeRef.current !== "detail"
        ) {
            if (detailMonthLatestViewModeRef.current !== "detail") {
                detailMonthAnimationPendingCommandsRef.current = [];
            }
            return;
        }

        startDetailMonthAnimationRef.current(pendingCommand.direction, {
            gestureAxis: pendingCommand.axis,
        });
    }, [
        detailMonthGestureAdoptionReady,
        detailMonthGestureBlocked,
        detailMonthGestureStartedBlocked,
        invalidateDetailMonthAnimation,
    ]);

    const finishDetailMonthGestureLayerEnter = useCallback((
        generation: number,
        finished: boolean
    ) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "enter"
            || !detailMonthAnimationUsesGestureLayerRef.current
        ) return;

        if (finished) {
            completeDetailMonthAnimation(generation);
            return;
        }
        invalidateDetailMonthAnimation(true);
    }, [completeDetailMonthAnimation, invalidateDetailMonthAnimation]);

    const startDetailMonthEnterAnimation = useCallback((generation: number) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current ||
            detailMonthAnimationPhaseRef.current !== "awaitingCommit"
        ) return;

        if (detailMonthCommitWatchdogRef.current !== null) {
            clearTimeout(detailMonthCommitWatchdogRef.current);
            detailMonthCommitWatchdogRef.current = null;
        }
        detailMonthAnimationPhaseRef.current = "enter";
        detailMonthAnimationFrameRef.current = requestAnimationFrame(() => {
            detailMonthAnimationFrameRef.current = null;
            if (
                generation !== detailMonthAnimationGenerationRef.current ||
                detailMonthAnimationPhaseRef.current !== "enter"
            ) return;

            const elapsedMs = Math.max(
                0,
                Date.now() - detailMonthAnimationStartedAtRef.current
            );
            const remainingBudgetMs = Math.max(
                0,
                CALENDAR_INTERACTION_BUDGET_MS - elapsedMs
                    - DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs / 2
            );
            const enterDurationMs = Math.min(
                detailMonthAnimationEnterDurationRef.current,
                remainingBudgetMs
            );
            if (detailMonthAnimationUsesGestureLayerRef.current) {
                detailMonthGestureTranslateX.value = 0;
                if (enterDurationMs === 0) {
                    detailMonthGestureTranslateY.value = 0;
                    detailMonthGestureOpacity.value = 1;
                    completeDetailMonthAnimation(generation);
                    return;
                }

                const enterConfig = {
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_REANIMATED_EASING,
                };
                detailMonthGestureOpacity.value = withTiming(1, enterConfig);
                detailMonthGestureTranslateY.value = withTiming(
                    0,
                    enterConfig,
                    (finished) => {
                        runOnJS(finishDetailMonthGestureLayerEnter)(
                            generation,
                            Boolean(finished)
                        );
                    }
                );
                return;
            }

            const detailMonthActiveTranslation =
                detailMonthAnimationAxisRef.current === "vertical"
                    ? detailMonthTranslateY
                    : detailMonthTranslateX;
            if (enterDurationMs === 0) {
                detailMonthTranslateX.setValue(0);
                detailMonthTranslateY.setValue(0);
                detailMonthOpacity.setValue(1);
                completeDetailMonthAnimation(generation);
                return;
            }

            const enterAnimation = Animated.parallel([
                Animated.timing(detailMonthActiveTranslation, {
                    toValue: 0,
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_EASING,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
                Animated.timing(detailMonthOpacity, {
                    toValue: 1,
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_EASING,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
            ]);
            detailMonthAnimationRef.current = enterAnimation;
            enterAnimation.start(({ finished }) => {
                if (detailMonthAnimationRef.current === enterAnimation) {
                    detailMonthAnimationRef.current = null;
                }
                if (generation !== detailMonthAnimationGenerationRef.current) return;
                if (!finished) {
                    invalidateDetailMonthAnimation(true);
                    return;
                }
                completeDetailMonthAnimation(generation);
            });
        });
    }, [
        completeDetailMonthAnimation,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
        finishDetailMonthGestureLayerEnter,
        invalidateDetailMonthAnimation,
    ]);

    const handleDetailMonthChange = useCallback((month: DateData) => {
        const incomingMonth = month.dateString.slice(0, 7);
        const todayTarget = todayFocusTargetRef.current;
        if (
            todayTarget?.requiresMonthChange &&
            incomingMonth === todayTarget.day.slice(0, 7)
        ) {
            // The parent has already committed the exact today key. Consume
            // react-native-calendars' month ACK so its preserved day-of-month
            // (for example Aug 29 -> Jul 29) cannot overwrite today (Jul 27).
            detailMonthSuppressedCommitRef.current = null;
            acknowledgeTodayFocusTarget(todayTarget.day);
            return;
        }
        const suppressedCommit = detailMonthSuppressedCommitRef.current;
        if (suppressedCommit) {
            detailMonthSuppressedCommitRef.current = null;
            if (incomingMonth === suppressedCommit) return;
        }
        if (detailMonthAnimationActiveRef.current) {
            const phase = detailMonthAnimationPhaseRef.current;
            const sourceMonth = detailMonthAnimationSourceDayRef.current?.slice(0, 7);
            const expectedMonth = detailMonthAnimationExpectedDayRef.current?.slice(0, 7);

            if (phase === "awaitingCommit" && incomingMonth === expectedMonth) {
                // The controlled props/layout ACK owns a pager rebase. A
                // react-native-calendars callback can arrive during the single
                // paint frame before that rebase; letting it start the legacy
                // enter animation would cancel the deferred handoff.
                if (detailMonthAnimationUsesPagerRef.current) return;
                startDetailMonthEnterAnimation(
                    detailMonthAnimationGenerationRef.current
                );
                return;
            }

            // The controlled initialDate update can emit the source month once
            // more while the target commit is pending. Neither source nor the
            // expected target should be forwarded back to the parent twice.
            if (incomingMonth === sourceMonth || incomingMonth === expectedMonth) {
                return;
            }

            invalidateDetailMonthAnimation(true);
        }

        commitDetailMonthControlledState(month.dateString);
    }, [
        acknowledgeTodayFocusTarget,
        commitDetailMonthControlledState,
        invalidateDetailMonthAnimation,
        startDetailMonthEnterAnimation,
    ]);

    const commitDetailMonthPagerSwipe = useCallback((
        generation: number,
        targetDay: string,
        emitControlledState = true
    ) => {
        const phase = detailMonthAnimationPhaseRef.current;
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || (phase !== "exit" && phase !== "settling")
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        detailMonthAnimationPhaseRef.current = "awaitingCommit";
        detailMonthAnimationExpectedDayRef.current = targetDay;
        const controlledAnchor = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        if (phase === "exit" || controlledAnchor !== targetDay) {
            detailMonthCommitWatchdogRef.current = setTimeout(() => {
                detailMonthCommitWatchdogRef.current = null;
                if (
                    generation !== detailMonthAnimationGenerationRef.current
                    || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                    || detailMonthAnimationExpectedDayRef.current !== targetDay
                    || !detailMonthAnimationUsesPagerRef.current
                ) return;

                // The target is already visible at the pager endpoint. A slow
                // controlled React/Fabric ACK must never reset that translation
                // onto the source month. Pin every structural slot to target
                // and let the normal ACK path perform the safe rebase.
                setDetailMonthPagerAnchorDay(targetDay);
                setDetailMonthPagerHandoffDay(targetDay);
            }, DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
        }
        if (emitControlledState) {
            commitDetailMonthControlledState(targetDay);
        }
    }, [commitDetailMonthControlledState]);

    const scheduleDetailMonthPagerHandoff = useCallback((
        generation: number,
        expectedDay: string
    ) => {
        const pendingFrame = detailMonthPagerHandoffFrameRef.current;
        if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
        if (detailMonthCommitWatchdogRef.current !== null) {
            clearTimeout(detailMonthCommitWatchdogRef.current);
            detailMonthCommitWatchdogRef.current = null;
        }

        const frame = requestAnimationFrame(() => {
            if (detailMonthPagerHandoffFrameRef.current === frame) {
                detailMonthPagerHandoffFrameRef.current = null;
            }
            if (
                generation !== detailMonthAnimationGenerationRef.current
                || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                || detailMonthAnimationExpectedDayRef.current !== expectedDay
                || !detailMonthAnimationUsesPagerRef.current
            ) return;

            // Promote the structural anchor in the same React batch that
            // mounts the target-only handoff. Doing these as two consecutive
            // layout commits makes Fabric build the calendar grid twice and
            // keeps the next gesture blocked long after the visible page has
            // reached its endpoint.
            setDetailMonthPagerAnchorDay(expectedDay);
            setDetailMonthPagerHandoffDay(expectedDay);
        });
        detailMonthPagerHandoffFrameRef.current = frame;
    }, []);

    const scheduleDetailMonthPagerCommit = useCallback((
        generation: number,
        targetDay: string
    ) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "exit"
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        detailMonthAnimationFrameRef.current = requestAnimationFrame(() => {
            detailMonthAnimationFrameRef.current = null;
            commitDetailMonthPagerSwipe(generation, targetDay);
        });
    }, [commitDetailMonthPagerSwipe]);

    const animateDetailMonthChange = useCallback((
        direction: DetailMonthSwipeDirection,
        options: DetailMonthAnimationOptions = {}
    ) => {
        if (
            detailMonthLatestViewModeRef.current !== "detail" ||
            detailMonthLatestTransitionActiveRef.current
        ) {
            resetDetailMonthGesture();
            return;
        }
        const normalizedDirection: DetailMonthSwipeDirection = direction < 0 ? -1 : 1;
        if (detailMonthAnimationActiveRef.current) {
            const pendingCommands =
                detailMonthAnimationPendingCommandsRef.current;
            if (pendingCommands.length < DETAIL_MONTH_SWIPE_QUEUE_LIMIT) {
                pendingCommands.push({
                    direction: normalizedDirection,
                    axis: options.gestureAxis ?? "horizontal",
                });
            }
            return;
        }

        const sourceDay = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        const targetDay = options.targetDay
            ?? shiftCalendarMonth(sourceDay, normalizedDirection);
        const reduceMotion = detailMonthLatestReduceMotionRef.current;
        const generation = detailMonthAnimationGenerationRef.current + 1;
        detailMonthGestureResetAnimationRef.current?.stop();
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthAnimationGenerationRef.current = generation;
        detailMonthAnimationActiveRef.current = true;
        if (detailMonthMotionActive) {
            detailMonthMotionActive.value = true;
        }
        setDetailMonthMotionOwnershipActive(true);
        detailMonthAnimationUsesPagerRef.current = false;
        detailMonthAnimationUsesGestureLayerRef.current = false;
        const gestureAxis = options.gestureAxis ?? "horizontal";
        detailMonthAnimationAxisRef.current = gestureAxis;
        detailMonthGestureAxis.value = gestureAxis === "horizontal" ? 1 : 2;
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthAnimationPhaseRef.current = "exit";
        detailMonthAnimationSourceDayRef.current = sourceDay;
        detailMonthAnimationExpectedDayRef.current = null;
        detailMonthAnimationReduceMotionRef.current = reduceMotion;
        detailMonthAnimationStartedAtRef.current = Date.now();
        detailMonthGestureAdoptionReady.value = false;
        detailMonthGestureBlocked.value = true;
        const isGestureTransition = options.gestureOffset !== undefined;
        const travel = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionTravel
            : DETAIL_MONTH_SWIPE_MOTION.travel;
        const measuredVerticalPageDistance = Math.max(
            1,
            isGestureTransition
                ? detailMonthGesturePageHeight.value
                : detailMonthViewportHeight.value
        );
        const currentLayout = detailMonthPageLayoutsRef.current?.current;
        const previousLayout = detailMonthPageLayoutsRef.current?.previous;
        const measuredPreviousVerticalPageDistance = isGestureTransition
            ? detailMonthGesturePreviousPageHeight.value
            : Math.max(
                1,
                measuredVerticalPageDistance
                    + (
                        (previousLayout?.calendarHeight
                            ?? currentLayout?.calendarHeight
                            ?? measuredVerticalPageDistance)
                        - (
                            currentLayout?.calendarHeight
                            ?? measuredVerticalPageDistance
                        )
                    )
            );
        if (gestureAxis === "vertical" && !isGestureTransition) {
            detailMonthGesturePageHeight.value = measuredVerticalPageDistance;
            detailMonthGesturePreviousPageHeight.value =
                measuredPreviousVerticalPageDistance;
        }
        const pagerDistance = gestureAxis === "horizontal"
            ? detailMonthPageWidth
            : normalizedDirection < 0
                ? measuredPreviousVerticalPageDistance
                : measuredVerticalPageDistance;
        // Both axes use pre-rendered adjacent months and their measured page
        // dimensions. The vertical distance is frozen when the gesture starts,
        // so a concurrent 5/6-week height interpolation cannot move the target.
        const isPagerTransition = pagerDistance > 0;
        let exitDuration = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionExitDurationMs
            : DETAIL_MONTH_SWIPE_MOTION.exitDurationMs;
        detailMonthAnimationEnterDurationRef.current = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionEnterDurationMs
            : DETAIL_MONTH_SWIPE_MOTION.enterDurationMs;
        const offsets = getDetailMonthSwipeOffsets(normalizedDirection, travel);

        if (isPagerTransition && !reduceMotion) {
            detailMonthAnimationUsesPagerRef.current = true;
            // The adjacent page already moves on the UI thread. Update the
            // lightweight month chrome before the controlled selection/store
            // commit starts its heavier Fabric reconciliation.
            detailMonthPreviewedDayRef.current = targetDay;
            emitDetailMonthPreview(targetDay);
            detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
                detailMonthDeadlineWatchdogRef.current = null;
                if (generation !== detailMonthAnimationGenerationRef.current) return;
                let expectedDay =
                    detailMonthAnimationExpectedDayRef.current;
                let recoveryPhase =
                    detailMonthAnimationPhaseRef.current;
                if (
                    detailMonthAnimationUsesPagerRef.current
                    && recoveryPhase === "exit"
                    && expectedDay === null
                ) {
                    // The native pager has had enough time to reach its
                    // endpoint, but its completion callback may have been
                    // delayed or lost. Promote through the ordinary commit
                    // path; a stale completion callback will fail its phase
                    // guard and cannot emit the target twice.
                    commitDetailMonthPagerSwipe(generation, targetDay);
                    expectedDay =
                        detailMonthAnimationExpectedDayRef.current;
                    recoveryPhase =
                        detailMonthAnimationPhaseRef.current;
                }
                if (
                    detailMonthAnimationUsesPagerRef.current
                    && expectedDay === targetDay
                    && (
                        recoveryPhase === "settling"
                        || recoveryPhase === "awaitingCommit"
                        || recoveryPhase === "finalizing"
                    )
                ) {
                    // Recover through the same target-only topology as the
                    // normal handoff. Completing immediately would reset the
                    // shared translation while the structural anchor could
                    // still be the source month, recreating the source flash.
                    // Preserve already-guarded handoff/rebase frames. React
                    // can coalesce the idempotent target updates below; if the
                    // pending frame were cancelled there might be no render
                    // left to schedule a replacement, leaving input locked
                    // until the terminal watchdog.
                    detailMonthAnimationPhaseRef.current =
                        recoveryPhase === "finalizing"
                            ? "finalizing"
                            : "awaitingCommit";
                    setDetailMonthPagerAnchorDay(targetDay);
                    setDetailMonthPagerHandoffDay(
                        recoveryPhase === "finalizing"
                            ? null
                            : targetDay
                    );

                    // A longer bounded watchdog only handles a parent that
                    // never acknowledges the target. The short watchdog above
                    // has already requested target-only topology, so a delayed
                    // but valid controlled commit remains visually pinned.
                    detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
                        detailMonthDeadlineWatchdogRef.current = null;
                        if (
                            generation
                                !== detailMonthAnimationGenerationRef.current
                            || (
                                detailMonthAnimationPhaseRef.current
                                    !== "awaitingCommit"
                                && detailMonthAnimationPhaseRef.current
                                    !== "finalizing"
                            )
                            || detailMonthAnimationExpectedDayRef.current
                                !== targetDay
                            || !detailMonthAnimationUsesPagerRef.current
                        ) return;
                        const terminalControlledAnchor =
                            resolveDetailMonthAnchor(
                                detailMonthLatestSelectedDayRef.current,
                                detailMonthLatestVisibleMonthRef.current
                            );
                        if (terminalControlledAnchor === targetDay) {
                            completeDetailMonthAnimation(generation, true);
                            return;
                        }
                        invalidateDetailMonthAnimation(true);
                    }, DETAIL_MONTH_SWIPE_MOTION.pagerAckWatchdogMs);
                    return;
                }
                invalidateDetailMonthAnimation(true);
            }, (
                options.gestureSettleOwnedByUI
                    ? DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs
                    : CALENDAR_INTERACTION_BUDGET_MS
            )
                + DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
                + DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
            if (options.gestureSettleOwnedByUI) {
                // The release worklet already owns the active withTiming.
                // runOnJS arrives asynchronously on device, so touching the
                // shared translations here would cancel that freshly-started
                // settle and visibly snap the source grid back into view.
                detailMonthAnimationPhaseRef.current = "settling";
                detailMonthAnimationExpectedDayRef.current = targetDay;
                // A committed release is authoritative. Emit the controlled
                // month now so the pill, selected day and agenda update while
                // the UI-thread pager is settling instead of hundreds of
                // milliseconds after the target grid has arrived.
                commitDetailMonthControlledState(targetDay);
                return;
            }
            cancelReanimatedAnimation(detailMonthGestureTranslateX);
            cancelReanimatedAnimation(detailMonthGestureTranslateY);
            cancelReanimatedAnimation(detailMonthGestureOpacity);
            detailMonthGestureOpacity.value = 1;
            if (!isGestureTransition) {
                const activeGestureTranslation =
                    gestureAxis === "horizontal"
                        ? detailMonthGestureTranslateX
                        : detailMonthGestureTranslateY;
                const inactiveGestureTranslation =
                    gestureAxis === "horizontal"
                        ? detailMonthGestureTranslateY
                        : detailMonthGestureTranslateX;
                const targetLayout = normalizedDirection < 0
                    ? detailMonthPageLayoutsRef.current?.previous
                    : detailMonthPageLayoutsRef.current?.next;
                detailMonthTranslateX.setValue(0);
                detailMonthTranslateY.setValue(0);
                detailMonthOpacity.setValue(1);
                inactiveGestureTranslation.value = 0;
                activeGestureTranslation.value = 0;
                if (targetLayout && animatedCalendarHeight) {
                    cancelReanimatedAnimation(animatedCalendarHeight);
                    animatedCalendarHeight.value = withTiming(
                        targetLayout.calendarHeight,
                        {
                            duration: CALENDAR_INTERACTION_BUDGET_MS,
                            easing: ReanimatedEasing.bezier(
                                ...DETAIL_MONTH_SWIPE_MOTION.bezier
                            ),
                        }
                    );
                }
                if (targetLayout && animatedDayHeight) {
                    cancelReanimatedAnimation(animatedDayHeight);
                    animatedDayHeight.value = withTiming(
                        targetLayout.dayHeight,
                        {
                            duration: CALENDAR_INTERACTION_BUDGET_MS,
                            easing: ReanimatedEasing.bezier(
                                ...DETAIL_MONTH_SWIPE_MOTION.bezier
                            ),
                        }
                    );
                }
                activeGestureTranslation.value = withTiming(
                    -normalizedDirection * pagerDistance,
                    {
                        duration: CALENDAR_INTERACTION_BUDGET_MS,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.bezier
                        ),
                    },
                    (finished) => {
                        if (finished) {
                            runOnJS(scheduleDetailMonthPagerCommit)(
                                generation,
                                targetDay
                            );
                        }
                    }
                );
                return;
            }
            const activeGestureTranslation = gestureAxis === "horizontal"
                ? detailMonthGestureTranslateX
                : detailMonthGestureTranslateY;
            const inactiveGestureTranslation = gestureAxis === "horizontal"
                ? detailMonthGestureTranslateY
                : detailMonthGestureTranslateX;
            inactiveGestureTranslation.value = 0;
            const targetOffset = -normalizedDirection * pagerDistance;
            if (options.gestureAlreadySettled) {
                // The successful pan already completed this motion on the UI
                // thread. Keep the incoming page at its final position while JS
                // commits the controlled month; restarting withTiming here would
                // reintroduce a release-time JS stall.
                activeGestureTranslation.value = targetOffset;
                const targetLayout = normalizedDirection < 0
                    ? detailMonthPageLayoutsRef.current?.previous
                    : detailMonthPageLayoutsRef.current?.next;
                if (targetLayout && animatedCalendarHeight) {
                    cancelReanimatedAnimation(animatedCalendarHeight);
                    animatedCalendarHeight.value = targetLayout.calendarHeight;
                }
                if (targetLayout && animatedDayHeight) {
                    cancelReanimatedAnimation(animatedDayHeight);
                    animatedDayHeight.value = targetLayout.dayHeight;
                }
                commitDetailMonthPagerSwipe(generation, targetDay);
                return;
            }
            const gestureOffset = options.gestureOffset ?? 0;
            const targetDirection = Math.sign(targetOffset - gestureOffset);
            const velocityTowardTarget = Math.max(
                0,
                (options.gestureVelocity ?? 0) * targetDirection
            );
            const settleDurationMs = getDetailMonthSwipeSettleDuration(
                Math.abs(targetOffset - gestureOffset),
                velocityTowardTarget,
                pagerDistance
            );
            const targetLayout = normalizedDirection < 0
                ? detailMonthPageLayoutsRef.current?.previous
                : detailMonthPageLayoutsRef.current?.next;
            if (targetLayout && animatedCalendarHeight) {
                cancelReanimatedAnimation(animatedCalendarHeight);
                animatedCalendarHeight.value = withTiming(
                    targetLayout.calendarHeight,
                    {
                        duration: settleDurationMs,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
                        ),
                    }
                );
            }
            if (targetLayout && animatedDayHeight) {
                cancelReanimatedAnimation(animatedDayHeight);
                animatedDayHeight.value = withTiming(
                    targetLayout.dayHeight,
                    {
                        duration: settleDurationMs,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
                        ),
                    }
                );
            }
            activeGestureTranslation.value = withTiming(
                targetOffset,
                {
                    duration: settleDurationMs,
                    easing: ReanimatedEasing.bezier(
                        ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
                    ),
                },
                (finished) => {
                    if (finished) {
                        runOnJS(commitDetailMonthPagerSwipe)(generation, targetDay);
                    }
                }
            );
            return;
        }

        const detailMonthActiveTranslation = gestureAxis === "vertical"
            ? detailMonthTranslateY
            : detailMonthTranslateX;
        const detailMonthInactiveTranslation = gestureAxis === "vertical"
            ? detailMonthTranslateX
            : detailMonthTranslateY;
        const gestureOffset = options.gestureOffset ?? 0;
        const gestureFollowProgress = (
            gestureAxis === "vertical"
            && isGestureTransition
            && travel > 0
        )
            ? Math.min(1, Math.abs(gestureOffset) / travel)
            : 0;
        const gestureFollowOpacity = 1
            - gestureFollowProgress
                * (1 - DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor);
        if (isGestureTransition && !reduceMotion) {
            const exitRemainingDistance = Math.abs(
                offsets.outgoing - gestureOffset
            );
            const enterDistance = Math.abs(offsets.incoming);
            const totalRemainingDistance =
                exitRemainingDistance + enterDistance;
            const totalReferenceDistance =
                Math.abs(offsets.outgoing) + enterDistance;
            const exitDirection = Math.sign(
                offsets.outgoing - gestureOffset
            ) || Math.sign(offsets.outgoing);
            const velocityTowardTarget = Math.max(
                0,
                (options.gestureVelocity ?? 0) * exitDirection
            );
            const totalSettleDurationMs = getDetailMonthSwipeSettleDuration(
                totalRemainingDistance,
                velocityTowardTarget,
                totalReferenceDistance
            );
            const exitShare = totalRemainingDistance > 0
                ? exitRemainingDistance / totalRemainingDistance
                : 0;
            exitDuration = totalSettleDurationMs * exitShare;
            detailMonthAnimationEnterDurationRef.current =
                totalSettleDurationMs - exitDuration;
        }
        detailMonthActiveTranslation.setValue(gestureOffset);
        detailMonthInactiveTranslation.setValue(0);
        detailMonthOpacity.setValue(gestureFollowOpacity);
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureOpacity.value = 1;
        detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
            detailMonthDeadlineWatchdogRef.current = null;
            if (generation !== detailMonthAnimationGenerationRef.current) return;
            invalidateDetailMonthAnimation(true);
        }, DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs
            + DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
            + DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
        const exitAnimation = Animated.parallel([
            Animated.timing(detailMonthActiveTranslation, {
                toValue: offsets.outgoing,
                duration: exitDuration,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthOpacity, {
                toValue: DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor,
                duration: exitDuration,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        detailMonthAnimationRef.current = exitAnimation;
        exitAnimation.start(({ finished }) => {
            if (detailMonthAnimationRef.current === exitAnimation) {
                detailMonthAnimationRef.current = null;
            }
            if (generation !== detailMonthAnimationGenerationRef.current) return;
            if (!finished) {
                invalidateDetailMonthAnimation(true);
                return;
            }

            const currentAnchor = resolveDetailMonthAnchor(
                detailMonthLatestSelectedDayRef.current,
                detailMonthLatestVisibleMonthRef.current
            );
            if (
                detailMonthLatestViewModeRef.current !== "detail" ||
                detailMonthLatestReduceMotionRef.current !== reduceMotion ||
                currentAnchor !== sourceDay
            ) {
                invalidateDetailMonthAnimation(true);
                return;
            }

            detailMonthAnimationPhaseRef.current = "awaitingCommit";
            detailMonthAnimationExpectedDayRef.current = targetDay;
            detailMonthActiveTranslation.setValue(offsets.incoming);
            detailMonthOpacity.setValue(
                DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor
            );
            detailMonthCommitWatchdogRef.current = setTimeout(() => {
                detailMonthCommitWatchdogRef.current = null;
                if (
                    generation !== detailMonthAnimationGenerationRef.current ||
                    detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                ) return;
                invalidateDetailMonthAnimation(true);
            }, DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
            commitDetailMonthControlledState(targetDay);
        });
    }, [
        detailMonthOpacity,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthGestureBlocked,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureSettleGeneration,
        detailMonthViewportHeight,
        detailMonthMotionActive,
        detailMonthPageWidth,
        animatedCalendarHeight,
        animatedDayHeight,
        commitDetailMonthControlledState,
        completeDetailMonthAnimation,
        commitDetailMonthPagerSwipe,
        emitDetailMonthPreview,
        invalidateDetailMonthAnimation,
        resetDetailMonthGesture,
        scheduleDetailMonthPagerCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    startDetailMonthAnimationRef.current = animateDetailMonthChange;

    const handleDetailMonthViewportLayout = useCallback((
        event: LayoutChangeEvent
    ) => {
        const { width, height } = event.nativeEvent.layout;
        if (Number.isFinite(height) && height > 0) {
            detailMonthViewportHeight.value = height;
            setDetailMonthViewportLayoutHeight((current) => (
                Math.abs(current - height) < 0.5 ? current : height
            ));
            if (!detailMonthPageLayoutsRef.current) {
                detailMonthPagerSlotPageHeights.value =
                    detailMonthPagerSlotPageHeights.value.map(
                        () => height
                    );
                detailMonthPagerSlotCalendarHeights.value =
                    detailMonthPagerSlotCalendarHeights.value.map(
                        () => height + Math.max(0, headerOffset)
                    );
            }
        }
        if (
            !Number.isFinite(width)
            || width <= 0
        ) return;

        setDetailMonthViewportWidth((current) => (
            Math.abs(current - width) < 0.5
                ? current
                : width
        ));
    }, [
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthViewportHeight,
        headerOffset,
    ]);

    const beginDetailMonthGestureSettle = useCallback((
        direction: number,
        _gestureOffset: number,
        _gestureVelocity: number,
        _axis: 1 | 2,
        uiTargetDayKey?: number
    ) => {
        const normalizedDirection: DetailMonthSwipeDirection =
            direction < 0 ? -1 : 1;
        const uiTargetDay = uiTargetDayKey === undefined
            ? null
            : getCalendarDayFromSelectionKey(uiTargetDayKey);
        const targetDay = uiTargetDay ?? shiftCalendarMonth(
            detailMonthVisualAnchorDayRef.current,
            normalizedDirection
        );
        detailMonthVisualAnchorDayRef.current = targetDay;
        detailMonthContinuousSettleCountRef.current += 1;
        detailMonthPreviewedDayRef.current = targetDay;
        detailMonthSuppressedCommitRef.current = targetDay.slice(0, 7);
        // A physical pan has already advanced the selection on the UI thread.
        // Its exact shifted key is authoritative; writing the older JS anchor
        // back here can turn Jul 31 into Aug 1 while React is one frame behind.
        emitDetailMonthPreview(targetDay, uiTargetDay === null);
        setDetailMonthMotionOwnershipActive(true);
        if (onCommitDetailMonthRef.current) {
            detailMonthPendingControlledDayRef.current = targetDay;
            detailMonthContinuousCommitPending.value = true;
            holdDetailMonthContinuousCommit();
        } else {
            // Preserve the standalone component's synchronous fallback. The
            // schedule screen supplies onCommitDetailMonth and therefore uses
            // the burst-coalesced path above.
            detailMonthContinuousCommitPending.value = false;
            commitDetailMonthControlledState(targetDay);
        }
    }, [
        commitDetailMonthControlledState,
        detailMonthContinuousCommitPending,
        emitDetailMonthPreview,
        holdDetailMonthContinuousCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    const completeDetailMonthGestureSettle = useCallback((
        direction: number,
        _axis: 1 | 2,
        heldGesture = false
    ) => {
        const normalizedDirection: DetailMonthSwipeDirection =
            direction < 0 ? -1 : 1;
        const settledAnchorDay = shiftCalendarMonth(
            detailMonthSettledAnchorDayRef.current,
            normalizedDirection
        );
        detailMonthSettledAnchorDayRef.current = settledAnchorDay;
        detailMonthContinuousSettleCountRef.current = Math.max(
            0,
            detailMonthContinuousSettleCountRef.current - 1
        );
        if (
            detailMonthContinuousSettleCountRef.current === 0
            && !heldGesture
        ) {
            scheduleDetailMonthContinuousCommit();
        }
    }, [scheduleDetailMonthContinuousCommit]);

    const shiftContinuousDetailMonthPager = useCallback((
        direction: DetailMonthSwipeDirection
    ) => {
        const normalizedDirection: DetailMonthSwipeDirection =
            direction < 0 ? -1 : 1;
        const targetOrdinal = detailMonthVisualMonthOrdinal.value
            + normalizedDirection;
        const windowStartOrdinal =
            detailMonthPagerWindowStartOrdinal.value;
        const windowEndOrdinal = windowStartOrdinal
            + DETAIL_MONTH_PAGER_POSITIONS.length - 1;
        if (
            targetOrdinal < windowStartOrdinal
            || targetOrdinal > windowEndOrdinal
        ) return;
        beginDetailMonthGestureSettle(normalizedDirection, 0, 0, 1);
        detailMonthVisualMonthOrdinal.value = targetOrdinal;
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        completeDetailMonthGestureSettle(
            normalizedDirection,
            1,
            false
        );
    }, [
        beginDetailMonthGestureSettle,
        completeDetailMonthGestureSettle,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureSettleGeneration,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthPagerWindowStartOrdinal,
        detailMonthVisualMonthOrdinal,
    ]);

    useLayoutEffect(() => {
        if (!onRegisterDetailMonthMotionShift) return undefined;

        onRegisterDetailMonthMotionShift(shiftContinuousDetailMonthPager);
        return () => onRegisterDetailMonthMotionShift(null);
    }, [
        onRegisterDetailMonthMotionShift,
        shiftContinuousDetailMonthPager,
    ]);

    const detailMonthPanGesture = useMemo(() => {
        const resolveSwipeDirection = (
            translation: number,
            velocity: number
        ) => {
            "worklet";

            if (
                Math.abs(translation)
                    >= DETAIL_MONTH_SWIPE_GESTURE.distanceThreshold
            ) {
                return translation > 0 ? -1 : 1;
            }
            if (
                Math.abs(velocity)
                    >= DETAIL_MONTH_SWIPE_GESTURE.velocityThreshold
            ) {
                return velocity > 0 ? -1 : 1;
            }

            const projectedDistance = translation
                + velocity * DETAIL_MONTH_SWIPE_GESTURE.velocityProjection;
            if (
                Math.abs(projectedDistance)
                    >= DETAIL_MONTH_SWIPE_GESTURE.distanceThreshold
            ) {
                return projectedDistance > 0 ? -1 : 1;
            }
            return 0;
        };

        const resolveAdoptedSwipeDirection = (
            presentationOffset: number,
            velocity: number,
            previousPageDistance: number,
            nextPageDistance: number
        ) => {
            "worklet";

            if (
                Math.abs(velocity)
                    >= DETAIL_MONTH_SWIPE_GESTURE.velocityThreshold
            ) {
                return velocity > 0 ? -1 : 1;
            }

            const projectedOffset = presentationOffset
                + velocity * DETAIL_MONTH_SWIPE_GESTURE.velocityProjection;
            const originDistance = Math.abs(projectedOffset);
            const previousDistance = Math.abs(
                projectedOffset - previousPageDistance
            );
            const nextDistance = Math.abs(
                projectedOffset + nextPageDistance
            );
            if (
                previousDistance < originDistance
                && previousDistance <= nextDistance
            ) {
                return -1;
            }
            if (
                nextDistance < originDistance
                && nextDistance < previousDistance
            ) {
                return 1;
            }
            return 0;
        };

        const resetGestureOnUI = (velocityTowardOrigin = 0) => {
            "worklet";

            const axis = detailMonthGestureAxis.value;
            const offset = axis === 1
                ? detailMonthGestureTranslateX.value
                : detailMonthGestureTranslateY.value;
            const pageDistance = axis === 1
                ? detailMonthPageWidth
                : offset > 0
                    ? detailMonthGesturePreviousPageHeight.value
                    : detailMonthGesturePageHeight.value;
            const maximumDuration =
                DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs;
            const baselineVelocity = pageDistance > 0
                ? pageDistance / maximumDuration
                : 0;
            const effectiveVelocity = Math.max(
                baselineVelocity,
                Math.max(0, velocityTowardOrigin)
            );
            const duration = (
                pageDistance > 0
                && effectiveVelocity > 0
                && Math.abs(offset) > 0
            )
                ? Math.min(
                    maximumDuration,
                    Math.abs(offset) / effectiveVelocity
                )
                : 0;

            const resetConfig = {
                duration,
                easing: DETAIL_MONTH_SWIPE_REANIMATED_EASING,
            };
            const finishReset = (finished?: boolean) => {
                "worklet";

                if (!finished || detailMonthGestureBlocked.value) return;

                detailMonthGestureBaseTranslateX.value = 0;
                detailMonthGestureBaseTranslateY.value = 0;
                detailMonthGestureAdoptedPresentation.value = false;
                detailMonthGestureAxis.value = 0;
                if (detailMonthContinuousCommitPending.value) {
                    runOnJS(scheduleDetailMonthContinuousCommit)();
                    return;
                }
                if (detailMonthMotionActive) {
                    detailMonthMotionActive.value = false;
                }
                runOnJS(setDetailMonthMotionOwnershipActive)(false);
            };
            detailMonthGestureTranslateX.value = withTiming(
                0,
                resetConfig,
                axis === 2 ? undefined : finishReset
            );
            detailMonthGestureTranslateY.value = withTiming(
                0,
                resetConfig,
                axis === 2 ? finishReset : undefined
            );
            detailMonthGestureOpacity.value = withTiming(1, {
                duration,
                easing: DETAIL_MONTH_SWIPE_REANIMATED_EASING,
            });
            if (
                animatedCalendarHeight
                && detailMonthGestureSourceCalendarHeight.value > 0
            ) {
                animatedCalendarHeight.value = withTiming(
                    detailMonthGestureSourceCalendarHeight.value,
                    resetConfig
                );
            }
            if (
                animatedDayHeight
                && detailMonthGestureSourceDayHeight.value > 0
            ) {
                animatedDayHeight.value = withTiming(
                    detailMonthGestureSourceDayHeight.value,
                    resetConfig
                );
            }
        };

        const prepareGestureOnUI = (
            preservePresentation = false
        ) => {
            "worklet";

            detailMonthGestureRejected.value = false;
            detailMonthGestureCommitted.value = false;
            const presentationX = detailMonthGestureTranslateX.value;
            const presentationY = detailMonthGestureTranslateY.value;
            const previousAxis = detailMonthGestureAxis.value;
            const hasPresentation = preservePresentation
                || Math.abs(presentationX) > 0.5
                || Math.abs(presentationY) > 0.5;
            if (hasPresentation) {
                const lockedAxis = previousAxis !== 0
                    ? previousAxis
                    : Math.abs(presentationX) >= Math.abs(presentationY)
                        ? 1
                        : 2;
                detailMonthGestureAxis.value = lockedAxis;
                detailMonthGestureBaseTranslateX.value =
                    lockedAxis === 1 ? presentationX : 0;
                detailMonthGestureBaseTranslateY.value =
                    lockedAxis === 2 ? presentationY : 0;
                detailMonthGestureAdoptedPresentation.value = true;
            } else {
                detailMonthGestureAxis.value = 0;
                detailMonthGestureBaseTranslateX.value = 0;
                detailMonthGestureBaseTranslateY.value = 0;
                detailMonthGestureAdoptedPresentation.value = false;
            }
            const slotPageHeights =
                detailMonthPagerSlotPageHeights.value;
            const slotCalendarHeights =
                detailMonthPagerSlotCalendarHeights.value;
            const slotDayHeights = detailMonthPagerSlotDayHeights.value;
            const currentSlotId = detailMonthVisualMonthOrdinal.value
                - detailMonthPagerWindowStartOrdinal.value;
            const previousSlotId = currentSlotId - 1;
            const currentPageHeight = Math.max(
                1,
                currentSlotId >= 0
                    ? slotPageHeights[currentSlotId]
                    : detailMonthViewportHeight.value
            );
            detailMonthGesturePageHeight.value = currentPageHeight;
            detailMonthGesturePreviousPageHeight.value = Math.max(
                1,
                previousSlotId >= 0
                    ? slotPageHeights[previousSlotId]
                    : currentPageHeight
            );
            detailMonthGestureSourceCalendarHeight.value = Math.max(
                1,
                currentSlotId >= 0
                    ? slotCalendarHeights[currentSlotId]
                    : animatedCalendarHeight?.value
                        ?? currentPageHeight + Math.max(0, headerOffset)
            );
            detailMonthGestureSourceDayHeight.value = Math.max(
                1,
                currentSlotId >= 0
                    ? slotDayHeights[currentSlotId]
                    : animatedDayHeight?.value
                        ?? CALENDAR_DAY_HEIGHTS.detail
            );
            cancelReanimatedAnimation(detailMonthGestureTranslateX);
            cancelReanimatedAnimation(detailMonthGestureTranslateY);
            cancelReanimatedAnimation(detailMonthGestureOpacity);
        };

        const updateGestureOnUI = (
            translationX: number,
            translationY: number
        ) => {
            "worklet";

            if (detailMonthGestureAxis.value === 0) {
                const horizontalDistance = Math.abs(translationX);
                const verticalDistance = Math.abs(translationY);
                if (
                    horizontalDistance
                        >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                    && horizontalDistance
                        >= verticalDistance
                            * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
                ) {
                    detailMonthGestureAxis.value = 1;
                    detailMonthContinuousCommitGeneration.value += 1;
                    runOnJS(holdDetailMonthContinuousCommit)();
                    if (detailMonthMotionActive) {
                        detailMonthMotionActive.value = true;
                    }
                    runOnJS(setDetailMonthMotionOwnershipActive)(true);
                } else if (
                    verticalDistance
                        >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                    && verticalDistance
                        >= horizontalDistance
                            * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
                ) {
                    detailMonthGestureAxis.value = 2;
                    detailMonthContinuousCommitGeneration.value += 1;
                    runOnJS(holdDetailMonthContinuousCommit)();
                    if (detailMonthMotionActive) {
                        detailMonthMotionActive.value = true;
                    }
                    runOnJS(setDetailMonthMotionOwnershipActive)(true);
                } else {
                    return;
                }
            }

            const axis = detailMonthGestureAxis.value;
            const translation = axis === 1
                ? detailMonthGestureBaseTranslateX.value + translationX
                : detailMonthGestureBaseTranslateY.value + translationY;
            const previousPageDistance = axis === 1
                ? detailMonthPageWidth
                : detailMonthGesturePreviousPageHeight.value;
            const nextPageDistance = axis === 1
                ? detailMonthPageWidth
                : detailMonthGesturePageHeight.value;
            if (
                previousPageDistance <= 0
                || nextPageDistance <= 0
            ) return;

            const offset = reduceMotionEnabled
                ? 0
                : Math.max(
                    -nextPageDistance,
                    Math.min(previousPageDistance, translation)
                );
            detailMonthGestureTranslateX.value = axis === 1 ? offset : 0;
            detailMonthGestureTranslateY.value = axis === 2 ? offset : 0;
            detailMonthGestureOpacity.value = 1;
            const targetPosition = offset < 0 ? 1 : -1;
            const pageDistance = offset < 0
                ? nextPageDistance
                : previousPageDistance;
            const targetSlotId = detailMonthVisualMonthOrdinal.value
                - detailMonthPagerWindowStartOrdinal.value
                + targetPosition;
            if (
                targetSlotId >= 0
                && targetSlotId
                    < detailMonthPagerSlotCalendarHeights.value.length
                && pageDistance > 0
            ) {
                const progress = Math.min(
                    1,
                    Math.abs(offset) / pageDistance
                );
                const sourceCalendarHeight =
                    detailMonthGestureSourceCalendarHeight.value;
                const sourceDayHeight =
                    detailMonthGestureSourceDayHeight.value;
                if (
                    animatedCalendarHeight
                    && sourceCalendarHeight > 0
                ) {
                    animatedCalendarHeight.value = sourceCalendarHeight
                        + (
                            detailMonthPagerSlotCalendarHeights.value[
                                targetSlotId
                            ]
                            - sourceCalendarHeight
                        ) * progress;
                }
                if (animatedDayHeight && sourceDayHeight > 0) {
                    animatedDayHeight.value = sourceDayHeight
                        + (
                            detailMonthPagerSlotDayHeights.value[targetSlotId]
                            - sourceDayHeight
                        ) * progress;
                }
            }
        };

        function startPagerSettleOnUI(
            direction: -1 | 1,
            axis: 1 | 2,
            gestureOffset: number,
            velocity: number
        ) {
            "worklet";

            const settleGeneration =
                detailMonthGestureSettleGeneration.value + 1;
            const targetOrdinal = detailMonthVisualMonthOrdinal.value
                + direction;
            const windowStartOrdinal =
                detailMonthPagerWindowStartOrdinal.value;
            const targetSlotId = targetOrdinal - windowStartOrdinal;
            if (
                targetSlotId < 0
                || targetSlotId
                    >= detailMonthPagerSlotPageHeights.value.length
            ) {
                resetGestureOnUI();
                return;
            }
            detailMonthGestureSettleGeneration.value = settleGeneration;
            detailMonthGestureBlocked.value = true;
            detailMonthGestureAxis.value = axis;
            detailMonthGestureBaseTranslateX.value = 0;
            detailMonthGestureBaseTranslateY.value = 0;
            detailMonthGestureAdoptedPresentation.value = false;
            detailMonthContinuousCommitPending.value = true;
            const targetSelectedDayKey =
                shiftCalendarDaySelectionKeyOnUI(
                    detailMonthVisualSelectedDayKey.value,
                    direction
                );
            detailMonthVisualSelectedDayKey.value = targetSelectedDayKey;
            runOnJS(beginDetailMonthGestureSettle)(
                direction,
                gestureOffset,
                velocity,
                axis,
                targetSelectedDayKey
            );

            const visualSlotId = detailMonthVisualMonthOrdinal.value
                - windowStartOrdinal;
            const distanceSlotId = visualSlotId
                + (direction < 0 ? -1 : 0);
            const pageDistance = axis === 1
                ? detailMonthPageWidth
                : Math.max(
                    1,
                    distanceSlotId >= 0
                        ? detailMonthPagerSlotPageHeights.value[
                            distanceSlotId
                        ]
                        : direction < 0
                            ? detailMonthGesturePreviousPageHeight.value
                            : detailMonthGesturePageHeight.value
                );
            const activeGestureTranslation = axis === 1
                ? detailMonthGestureTranslateX
                : detailMonthGestureTranslateY;
            const inactiveGestureTranslation = axis === 1
                ? detailMonthGestureTranslateY
                : detailMonthGestureTranslateX;
            const targetOffset = -direction * pageDistance;
            detailMonthGestureActiveSettleDirection.value = direction;
            detailMonthGestureActiveSettleAxis.value = axis;
            detailMonthGestureActiveSettleTargetOffset.value = targetOffset;
            const targetDirection = Math.sign(
                targetOffset - gestureOffset
            );
            const velocityTowardTarget = Math.max(
                0,
                velocity * targetDirection
            );
            const remainingDistance = Math.min(
                pageDistance,
                Math.max(0, Math.abs(targetOffset - gestureOffset))
            );
            const maximumDuration =
                DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs;
            const baselineVelocity = pageDistance / maximumDuration;
            const effectiveVelocity = Math.max(
                baselineVelocity,
                velocityTowardTarget
            );
            const settleDurationMs = reduceMotionEnabled
                ? 0
                : remainingDistance > 0
                    ? Math.min(
                        maximumDuration,
                        remainingDistance / effectiveVelocity
                    )
                    : 0;
            const targetCalendarHeight = targetSlotId >= 0
                ? detailMonthPagerSlotCalendarHeights.value[targetSlotId]
                : 0;
            const targetDayHeight = targetSlotId >= 0
                ? detailMonthPagerSlotDayHeights.value[targetSlotId]
                : 0;
            const settleConfig = {
                duration: settleDurationMs,
                easing: DETAIL_MONTH_SWIPE_SETTLE_REANIMATED_EASING,
            };
            if (targetCalendarHeight > 0 && animatedCalendarHeight) {
                animatedCalendarHeight.value = withTiming(
                    targetCalendarHeight,
                    settleConfig
                );
            }
            if (targetDayHeight > 0 && animatedDayHeight) {
                animatedDayHeight.value = withTiming(
                    targetDayHeight,
                    settleConfig
                );
            }
            inactiveGestureTranslation.value = 0;
            activeGestureTranslation.value = withTiming(
                targetOffset,
                settleConfig,
                (finished) => {
                    if (
                        detailMonthGestureSettleGeneration.value
                        !== settleGeneration
                    ) return;
                    detailMonthGestureActiveSettleDirection.value = 0;
                    detailMonthGestureActiveSettleAxis.value = 0;
                    detailMonthGestureActiveSettleTargetOffset.value = 0;
                    if (!finished && !detailMonthGestureBlocked.value) return;
                    const interruptedOffset =
                        activeGestureTranslation.value;
                    const queuedDirection =
                        detailMonthGestureQueuedDirection.value;
                    const queuedAxis = detailMonthGestureQueuedAxis.value;
                    const heldGesture = (
                        !finished
                        && queuedDirection === 0
                        && detailMonthGestureStartedBlocked.value
                    );
                    if (!finished && !heldGesture) {
                        inactiveGestureTranslation.value = 0;
                        activeGestureTranslation.value = targetOffset;
                        if (
                            targetCalendarHeight > 0
                            && animatedCalendarHeight
                        ) {
                            animatedCalendarHeight.value =
                                targetCalendarHeight;
                        }
                        if (targetDayHeight > 0 && animatedDayHeight) {
                            animatedDayHeight.value = targetDayHeight;
                        }
                    }

                    detailMonthVisualMonthOrdinal.value += direction;
                    inactiveGestureTranslation.value = 0;
                    if (heldGesture) {
                        const residualOffset =
                            interruptedOffset - targetOffset;
                        activeGestureTranslation.value = residualOffset;
                        detailMonthGestureBaseTranslateX.value =
                            axis === 1 ? residualOffset : 0;
                        detailMonthGestureBaseTranslateY.value =
                            axis === 2 ? residualOffset : 0;
                        detailMonthGestureAdoptedPresentation.value = true;
                    } else {
                        activeGestureTranslation.value = 0;
                        detailMonthGestureBaseTranslateX.value = 0;
                        detailMonthGestureBaseTranslateY.value = 0;
                        detailMonthGestureAdoptedPresentation.value = false;
                    }
                    detailMonthGestureSettleGeneration.value =
                        settleGeneration + 1;

                    const keepMotionActive =
                        queuedDirection !== 0 || heldGesture;
                    runOnJS(completeDetailMonthGestureSettle)(
                        direction,
                        axis,
                        keepMotionActive
                    );

                    if (queuedDirection !== 0 && queuedAxis !== 0) {
                        detailMonthGestureQueuedDirection.value = 0;
                        detailMonthGestureQueuedAxis.value = 0;
                        detailMonthGestureStartedBlocked.value = false;
                        detailMonthGestureAdoptionReady.value = false;
                        detailMonthGestureAdoptedPresentation.value = false;
                        startPagerSettleOnUI(
                            queuedDirection,
                            queuedAxis,
                            0,
                            0
                        );
                        return;
                    }

                    detailMonthGestureBlocked.value = false;
                    detailMonthGestureAdoptionReady.value = heldGesture;
                    if (!heldGesture) {
                        detailMonthGestureAxis.value = 0;
                        if (
                            detailMonthMotionActive
                            && !detailMonthContinuousCommitPending.value
                        ) {
                            detailMonthMotionActive.value = false;
                        }
                    }
                }
            );
        }

        function promoteInterruptedSettleOnUI() {
            "worklet";

            const direction =
                detailMonthGestureActiveSettleDirection.value;
            const axis = detailMonthGestureActiveSettleAxis.value;
            const targetOffset =
                detailMonthGestureActiveSettleTargetOffset.value;
            if (
                direction === 0
                || (axis !== 1 && axis !== 2)
                || !Number.isFinite(targetOffset)
            ) return false;

            const activeGestureTranslation = axis === 1
                ? detailMonthGestureTranslateX
                : detailMonthGestureTranslateY;
            const inactiveGestureTranslation = axis === 1
                ? detailMonthGestureTranslateY
                : detailMonthGestureTranslateX;
            const interruptedOffset = activeGestureTranslation.value;

            // Invalidate first: cancelAnimation may synchronously invoke the
            // old timing callback on the UI runtime. That callback must not
            // promote or complete the same page a second time.
            detailMonthGestureSettleGeneration.value += 1;
            detailMonthGestureActiveSettleDirection.value = 0;
            detailMonthGestureActiveSettleAxis.value = 0;
            detailMonthGestureActiveSettleTargetOffset.value = 0;
            detailMonthGestureQueuedDirection.value = 0;
            detailMonthGestureQueuedAxis.value = 0;
            cancelReanimatedAnimation(detailMonthGestureTranslateX);
            cancelReanimatedAnimation(detailMonthGestureTranslateY);
            cancelReanimatedAnimation(detailMonthGestureOpacity);
            if (animatedCalendarHeight) {
                cancelReanimatedAnimation(animatedCalendarHeight);
            }
            if (animatedDayHeight) {
                cancelReanimatedAnimation(animatedDayHeight);
            }

            // Promote the target page immediately while preserving its exact
            // presentation offset. The same finger can now take ownership on
            // its first update instead of waiting for a cancelled callback.
            detailMonthVisualMonthOrdinal.value += direction;
            const residualOffset = interruptedOffset - targetOffset;
            inactiveGestureTranslation.value = 0;
            activeGestureTranslation.value = residualOffset;
            detailMonthGestureBaseTranslateX.value =
                axis === 1 ? residualOffset : 0;
            detailMonthGestureBaseTranslateY.value =
                axis === 2 ? residualOffset : 0;
            detailMonthGestureAxis.value = axis;
            detailMonthGestureAdoptedPresentation.value = true;
            detailMonthGestureCommitted.value = false;
            detailMonthGestureBlocked.value = false;
            detailMonthGestureAdoptionReady.value = true;
            runOnJS(completeDetailMonthGestureSettle)(
                direction,
                axis,
                true
            );
            return true;
        }

        return Gesture.Pan()
            .enabled(
                viewMode === "detail"
                && !transitionActive
                && !todayFocusTarget
                && detailMonthPageWidth > 0
            )
            .minDistance(DETAIL_MONTH_SWIPE_GESTURE.activationDistance)
            .maxPointers(1)
            .cancelsTouchesInView(true)
            .withTestId("detail-month-pan-gesture")
            .onTouchesDown((event, stateManager) => {
                if (detailMonthContinuousCommitPending.value) {
                    // A finger already on the calendar owns the next frame.
                    // Do not let the idle controlled commit and its Fabric
                    // work land in the middle of a slowly-started drag.
                    detailMonthContinuousCommitGeneration.value += 1;
                    runOnJS(holdDetailMonthContinuousCommit)();
                }
                if (event.numberOfTouches > 1) {
                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureRejected.value = true;
                    detailMonthGestureStartedBlocked.value = false;
                    stateManager.fail();
                    return;
                }
                if (detailMonthGestureBlocked.value) {
                    detailMonthGestureStartedBlocked.value = true;
                    if (promoteInterruptedSettleOnUI()) return;
                    // Legacy JS-driven transitions have no UI settle metadata.
                    // Keep their existing cancellation callback handoff.
                    cancelReanimatedAnimation(
                        detailMonthGestureTranslateX
                    );
                    cancelReanimatedAnimation(
                        detailMonthGestureTranslateY
                    );
                    if (animatedCalendarHeight) {
                        cancelReanimatedAnimation(animatedCalendarHeight);
                    }
                    if (animatedDayHeight) {
                        cancelReanimatedAnimation(animatedDayHeight);
                    }
                    return;
                }
                detailMonthGestureAdoptionReady.value = false;
                detailMonthGestureRejected.value = false;
                detailMonthGestureStartedBlocked.value = false;
            })
            .onBegin(() => {
                if (detailMonthGestureStartedBlocked.value) return;
                if (detailMonthGestureBlocked.value) {
                    detailMonthGestureStartedBlocked.value = true;
                    return;
                }
                prepareGestureOnUI();
            })
            .onUpdate((event) => {
                if (detailMonthGestureRejected.value) return;
                if (detailMonthGestureStartedBlocked.value) {
                    if (
                        detailMonthGestureBlocked.value
                        || !detailMonthGestureAdoptionReady.value
                    ) return;

                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureStartedBlocked.value = false;
                    prepareGestureOnUI(true);
                }
                if (detailMonthGestureBlocked.value) return;

                updateGestureOnUI(
                    event.translationX,
                    event.translationY
                );
            })
            .onEnd((event) => {
                if (
                    detailMonthGestureStartedBlocked.value
                    && !detailMonthGestureBlocked.value
                    && detailMonthGestureAdoptionReady.value
                ) {
                    // The prior transition unlocked between the final update
                    // and release. Seed the pager from the finger endpoint so
                    // this edge case still settles from the visible drag
                    // distance instead of restarting at zero.
                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureStartedBlocked.value = false;
                    prepareGestureOnUI(true);
                    updateGestureOnUI(
                        event.translationX,
                        event.translationY
                    );
                }
                if (detailMonthGestureStartedBlocked.value) {
                    const horizontalDistance = Math.abs(event.translationX);
                    const verticalDistance = Math.abs(event.translationY);
                    let queuedAxis: 0 | 1 | 2 = 0;
                    if (
                        horizontalDistance
                            >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                        && horizontalDistance
                            >= verticalDistance
                                * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
                    ) {
                        queuedAxis = 1;
                    } else if (
                        verticalDistance
                            >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                        && verticalDistance
                            >= horizontalDistance
                                * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
                    ) {
                        queuedAxis = 2;
                    }
                    if (queuedAxis === 0) return;

                    const queuedTranslation = queuedAxis === 1
                        ? event.translationX
                        : event.translationY;
                    const queuedVelocity = (
                        queuedAxis === 1 ? event.velocityX : event.velocityY
                    ) / 1_000;
                    const queuedDirection = resolveSwipeDirection(
                        queuedTranslation,
                        queuedVelocity
                    );
                    if (queuedDirection !== 0) {
                        detailMonthGestureQueuedDirection.value =
                            queuedDirection < 0 ? -1 : 1;
                        detailMonthGestureQueuedAxis.value = queuedAxis;
                    }
                    return;
                }
                if (detailMonthGestureBlocked.value) return;

                if (detailMonthGestureAxis.value === 0) {
                    // A short, fast flick can reach onEnd before RNGH emits an
                    // onUpdate frame. Classify that endpoint here so it still
                    // participates in the pager instead of falling through as
                    // a tap on an overflow date.
                    updateGestureOnUI(
                        event.translationX,
                        event.translationY
                    );
                }
                const axis = detailMonthGestureAxis.value;
                if (axis === 0) return;
                detailMonthGestureCommitted.value = true;

                // Gesture Handler reports points/second while the calendar
                // motion contract uses points/millisecond.
                const velocity = (
                    axis === 1 ? event.velocityX : event.velocityY
                ) / 1_000;
                const gestureOffset = axis === 1
                    ? detailMonthGestureTranslateX.value
                    : detailMonthGestureTranslateY.value;
                const previousPageDistance = axis === 1
                    ? detailMonthPageWidth
                    : detailMonthGesturePreviousPageHeight.value;
                const nextPageDistance = axis === 1
                    ? detailMonthPageWidth
                    : detailMonthGesturePageHeight.value;
                const direction =
                    detailMonthGestureAdoptedPresentation.value
                        ? resolveAdoptedSwipeDirection(
                            gestureOffset,
                            velocity,
                            previousPageDistance,
                            nextPageDistance
                        )
                        : resolveSwipeDirection(
                            gestureOffset,
                            velocity
                        );

                const pageDistance = axis === 1
                    ? detailMonthPageWidth
                    : direction < 0
                        ? detailMonthGesturePreviousPageHeight.value
                        : detailMonthGesturePageHeight.value;
                if (direction === 0 || pageDistance <= 0) {
                    const velocityTowardOrigin = Math.max(
                        0,
                        -Math.sign(gestureOffset) * velocity
                    );
                    resetGestureOnUI(velocityTowardOrigin);
                    return;
                }

                startPagerSettleOnUI(
                    direction < 0 ? -1 : 1,
                    axis,
                    gestureOffset,
                    velocity
                );
            })
            .onFinalize(() => {
                const adoptionReady =
                    detailMonthGestureAdoptionReady.value;
                detailMonthGestureAdoptionReady.value = false;
                if (detailMonthGestureStartedBlocked.value) {
                    detailMonthGestureStartedBlocked.value = false;
                    if (!detailMonthGestureBlocked.value) {
                        if (adoptionReady) {
                            prepareGestureOnUI(true);
                        }
                        resetGestureOnUI();
                    }
                    return;
                }
                if (detailMonthGestureRejected.value) {
                    detailMonthGestureRejected.value = false;
                    if (!detailMonthGestureCommitted.value) {
                        resetGestureOnUI();
                    }
                    detailMonthGestureCommitted.value = false;
                    return;
                }
                if (!detailMonthGestureCommitted.value) {
                    resetGestureOnUI();
                }
                detailMonthGestureCommitted.value = false;
            });
    }, [
        beginDetailMonthGestureSettle,
        animatedCalendarHeight,
        animatedDayHeight,
        completeDetailMonthGestureSettle,
        detailMonthContinuousCommitPending,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureAxis,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureBlocked,
        detailMonthGestureCommitted,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureOpacity,
        detailMonthGestureQueuedAxis,
        detailMonthGestureQueuedDirection,
        detailMonthGestureRejected,
        detailMonthGestureSettleGeneration,
        detailMonthGestureStartedBlocked,
        detailMonthGestureSourceCalendarHeight,
        detailMonthGestureSourceDayHeight,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthPageWidth,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotDayHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPagerWindowStartOrdinal,
        detailMonthViewportHeight,
        detailMonthMotionActive,
        detailMonthContinuousCommitGeneration,
        detailMonthVisualMonthOrdinal,
        detailMonthVisualSelectedDayKey,
        headerOffset,
        holdDetailMonthContinuousCommit,
        reduceMotionEnabled,
        scheduleDetailMonthContinuousCommit,
        todayFocusTarget,
        transitionActive,
        viewMode,
        setDetailMonthMotionOwnershipActive,
    ]);

    const finishDetailMonthPagerTranslationReset = useCallback((
        generation: number,
        expectedDay: string
    ) => {
        const rebaseKey = `${generation}:${expectedDay}`;
        if (detailMonthPagerRebasePendingRef.current === rebaseKey) {
            detailMonthPagerRebasePendingRef.current = null;
        }
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
            || detailMonthAnimationExpectedDayRef.current !== expectedDay
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        // The UI thread has already reset the target-only canvas to its
        // origin. Removing the duplicate handoff now exposes the canonical
        // previous/current/next pages without an intermediate source frame.
        detailMonthVisualAnchorDayRef.current = expectedDay;
        detailMonthSettledAnchorDayRef.current = expectedDay;
        detailMonthAnimationPhaseRef.current = "finalizing";
        setDetailMonthPagerHandoffDay(null);
    }, []);

    const scheduleDetailMonthPagerRebaseCompletion = useCallback((
        generation: number,
        expectedDay: string
    ) => {
        const rebaseKey = `${generation}:${expectedDay}`;
        if (detailMonthPagerRebasePendingRef.current === rebaseKey) return;
        const isCurrentRebase = (
            generation === detailMonthAnimationGenerationRef.current
            && detailMonthAnimationPhaseRef.current === "awaitingCommit"
            && detailMonthAnimationExpectedDayRef.current === expectedDay
            && detailMonthAnimationUsesPagerRef.current
        );
        if (!isCurrentRebase) return;

        detailMonthPagerRebasePendingRef.current = rebaseKey;
        const frame = requestAnimationFrame(() => {
            if (detailMonthPagerRebaseFrameRef.current === frame) {
                detailMonthPagerRebaseFrameRef.current = null;
            }
            if (
                generation !== detailMonthAnimationGenerationRef.current
                || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                || detailMonthAnimationExpectedDayRef.current !== expectedDay
                || !detailMonthAnimationUsesPagerRef.current
            ) return;

            const targetOrdinal = getCalendarMonthOrdinal(expectedDay);
            const vertical =
                detailMonthAnimationAxisRef.current === "vertical";
            // The wide pager no longer renders the old target-only handoff.
            // Promote the actual page ordinal and reset its translation in a
            // single UI worklet so the source page can never reappear between
            // those two writes.
            runOnUI(() => {
                "worklet";

                cancelReanimatedAnimation(detailMonthGestureTranslateX);
                cancelReanimatedAnimation(detailMonthGestureTranslateY);
                cancelReanimatedAnimation(detailMonthGestureOpacity);
                const activeTranslation = vertical
                    ? detailMonthGestureTranslateY
                    : detailMonthGestureTranslateX;
                const inactiveTranslation = vertical
                    ? detailMonthGestureTranslateX
                    : detailMonthGestureTranslateY;
                detailMonthVisualMonthOrdinal.value = targetOrdinal;
                inactiveTranslation.value = 0;
                detailMonthGestureOpacity.value = 1;
                activeTranslation.value = withTiming(
                    0,
                    { duration: 0 },
                    () => {
                        runOnJS(finishDetailMonthPagerTranslationReset)(
                            generation,
                            expectedDay
                        );
                    }
                );
            })();
        });
        detailMonthPagerRebaseFrameRef.current = frame;
    }, [
        finishDetailMonthPagerTranslationReset,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthVisualMonthOrdinal,
    ]);

    useLayoutEffect(() => {
        if (!detailMonthAnimationActiveRef.current) return;

        const phase = detailMonthAnimationPhaseRef.current;
        const sourceDay = detailMonthAnimationSourceDayRef.current;
        const expectedDay = detailMonthAnimationExpectedDayRef.current;
        const currentAnchor = resolveDetailMonthAnchor(selectedDay, visibleMonth);
        const matchesControlledTransition = phase === "exit"
            ? currentAnchor === sourceDay
            : phase === "settling" || phase === "awaitingCommit"
                ? currentAnchor === sourceDay || currentAnchor === expectedDay
                : phase === "finalizing"
                    ? currentAnchor === expectedDay
                : phase === "enter"
                    ? currentAnchor === expectedDay
                    : false;

        if (
            transitionActive ||
            viewMode !== "detail" ||
            detailMonthAnimationReduceMotionRef.current !== reduceMotionEnabled ||
            !matchesControlledTransition
        ) {
            invalidateDetailMonthAnimation(true);
            return;
        }

        if (phase === "finalizing" && currentAnchor === expectedDay) {
            if (
                detailMonthPagerAnchorDay === expectedDay
                && detailMonthPagerHandoffDay === null
            ) {
                // The canonical previous/current/next topology is now in the
                // committed native tree. Unlock immediately so a touch held
                // during the handoff is adopted on its next update.
                completeDetailMonthAnimation(
                    detailMonthAnimationGenerationRef.current,
                    true
                );
            }
            return;
        }

        // The controlled props are the authoritative commit ACK. Starting the
        // enter phase here avoids waiting on react-native-calendars' later
        // onMonthChange effect and keeps the release-to-settle path under 200ms.
        if (phase === "awaitingCommit" && currentAnchor === expectedDay) {
            if (detailMonthAnimationUsesPagerRef.current) {
                // Keep the target month rendered at both the incoming page and
                // the centre page until the structural anchor is also target.
                if (detailMonthPagerHandoffDay !== expectedDay) {
                    // Let the controlled ACK (including the month pill and
                    // agenda title) paint before mounting the duplicate centre
                    // calendar used for the pager rebase. Doing both Fabric
                    // commits in one layout phase delayed visible chrome by
                    // roughly 300 ms on the simulator.
                    scheduleDetailMonthPagerHandoff(
                        detailMonthAnimationGenerationRef.current,
                        expectedDay
                    );
                    return;
                }

                if (detailMonthPagerAnchorDay !== expectedDay) {
                    // Keep the duplicate handoff mounted while promoting the
                    // structural pager anchor. This render makes the current,
                    // previous and next slots all resolve to the target month;
                    // only then is it safe to reset the UI-thread translation.
                    setDetailMonthPagerAnchorDay(expectedDay);
                    return;
                }

                scheduleDetailMonthPagerRebaseCompletion(
                    detailMonthAnimationGenerationRef.current,
                    expectedDay
                );
                return;
            }
            startDetailMonthEnterAnimation(
                detailMonthAnimationGenerationRef.current
            );
        }
    }, [
        detailMonthPagerAnchorDay,
        detailMonthPagerHandoffDay,
        completeDetailMonthAnimation,
        invalidateDetailMonthAnimation,
        reduceMotionEnabled,
        scheduleDetailMonthPagerRebaseCompletion,
        selectedDay,
        scheduleDetailMonthPagerHandoff,
        startDetailMonthEnterAnimation,
        transitionActive,
        viewMode,
        visibleMonth,
    ]);

    useLayoutEffect(() => {
        if (detailMonthAnimationUsesPagerRef.current) return;
        if (detailMonthPendingControlledDayRef.current !== null) return;
        if (
            transitionActive
            && normalizeMonthCandidate(transitionMonthKey)
        ) return;
        setDetailMonthPagerHandoffDay((current) => (
            current === null ? current : null
        ));
        setDetailMonthPagerAnchorDay((current) => (
            current.slice(0, 7) === initialMonthKey
                ? current
                : initialDate
        ));
        const initialOrdinal = getCalendarMonthOrdinal(initialDate);
        if (
            detailMonthContinuousSettleCountRef.current > 0
            || (
                detailMonthVisualAnchorDayRef.current.slice(0, 7)
                    === initialMonthKey
                && detailMonthVisualMonthOrdinal.value === initialOrdinal
            )
        ) return;

        const resetSlots = createDetailMonthPagerSlots(initialDate);
        detailMonthVisualAnchorDayRef.current = initialDate;
        detailMonthSettledAnchorDayRef.current = initialDate;
        detailMonthPagerSlotsRef.current = resetSlots;
        detailMonthVisualMonthOrdinal.value =
            initialOrdinal;
        detailMonthPagerWindowStartOrdinal.value =
            resetSlots[0]?.monthOrdinal
            ?? getCalendarMonthOrdinal(initialDate)
                - DETAIL_MONTH_PAGER_RADIUS;
        setDetailMonthPagerSlots(resetSlots);
    }, [
        detailMonthPagerHandoffDay,
        detailMonthPagerWindowStartOrdinal,
        detailMonthVisualMonthOrdinal,
        initialDate,
        initialMonthKey,
        transitionActive,
        transitionMonthKey,
    ]);

    useEffect(() => {
        const target = todayFocusTarget;
        if (!target || selectedDay !== target.day) return undefined;

        const targetMonth = target.day.slice(0, 7);
        const isCommittedWeek = viewMode === "week";
        const isCommittedCalendar = (
            viewMode === "detail"
                ? visibleMonth === targetMonth
                : viewMode === "list"
                    && !target.requiresMonthChange
                    && visibleMonth === targetMonth
        );
        if (!isCommittedWeek && !isCommittedCalendar) return undefined;

        const readyFrame = requestAnimationFrame(() => {
            acknowledgeTodayFocusTarget(target.day);
        });
        return () => cancelAnimationFrame(readyFrame);
    }, [
        acknowledgeTodayFocusTarget,
        selectedDay,
        todayFocusTarget,
        viewMode,
        visibleMonth,
    ]);

    const calendarEventMarkings = useMemo(() => {
        const dateMap: Record<string, any> = {};
        const dateSingleDay: Record<string, ScheduleItem[]> = {};
        const dateMultiDay: Record<string, any[]> = {};

        items.forEach((item) => {
            const dates = enumerateStackScheduleDays(item);
            const isMultiDay = dates.length > 1;

            dates.forEach((date) => {
                if (!dateMap[date]) dateMap[date] = {};
                if (!dateMap[date].events) dateMap[date].events = [];
                dateMap[date].events.push({
                    id: item.id,
                    title: item.title,
                    color: item.category.color,
                    startAt: item.startAt,
                    allDay: item.allDay,
                    travelMode: item.travelMode
                        ?? (item.travelMinutes || item.departAt || item.route ? "ETC" : undefined),
                });
            });

            if (isMultiDay) {
                dates.forEach((date, index) => {
                    if (!dateMultiDay[date]) dateMultiDay[date] = [];
                    dateMultiDay[date].push({
                        startingDay: index === 0,
                        endingDay: index === dates.length - 1,
                        color: item.category.color,
                    });
                });
            } else {
                const date = dates[0];
                if (!date) return;
                if (!dateSingleDay[date]) dateSingleDay[date] = [];
                dateSingleDay[date].push(item);
            }
        });

        Object.keys(dateMultiDay).forEach((date) => {
            dateMap[date] = { ...dateMap[date], periods: dateMultiDay[date] };
            if (dateSingleDay[date]) {
                dateMap[date].dots = dateSingleDay[date].map((item) => ({
                    color: item.category.color,
                    travelMode: item.travelMode,
                }));
                dateMap[date].marked = true;
                delete dateSingleDay[date];
            }
        });

        Object.keys(dateSingleDay).forEach((date) => {
            dateMap[date] = {
                ...dateMap[date],
                marked: true,
                dots: dateSingleDay[date].map((item) => ({
                    color: item.category.color,
                    travelMode: item.travelMode,
                })),
            };
        });

        Object.values(dateMap).forEach((marking) => {
            marking.events?.sort(compareMarkedEvents);
        });

        return dateMap;
    }, [items]);
    const markedDates = useMemo(() => ({
        ...calendarEventMarkings,
        [selectedDay]: {
            ...(calendarEventMarkings[selectedDay] ?? {}),
            selected: true,
        },
    }), [calendarEventMarkings, selectedDay]);
    const stackCalendarLayout = useMemo(
        () => createStackCalendarLayout(items, firstDay),
        [firstDay, items]
    );

    const handleCalendarDayPress = useCallback((day: {
        dateString: string;
    }) => {
        if (detailMonthAnimationActiveRef.current) return;
        if (detailMonthLatestViewModeRef.current === "detail") {
            const latestSelectedDay =
                detailMonthLatestSelectedDayRef.current;
            const visualAnchorDay =
                detailMonthVisualAnchorDayRef.current;
            const visualMonth = visualAnchorDay.slice(0, 7);
            const targetMonth = day.dateString.slice(0, 7);
            if (
                day.dateString === latestSelectedDay
                && targetMonth === visualMonth
                && detailMonthPendingControlledDayRef.current === null
            ) {
                onOpenDayRef.current(day.dateString);
                return;
            }
            // A tap supersedes a burst-idle month commit. Otherwise that old
            // timer can commit after this press and move the selection back.
            discardDetailMonthContinuousCommit();
            detailMonthVisualSelectedDayKey.value =
                getCalendarDaySelectionKey(day.dateString);
            if (targetMonth !== visualMonth) {
                // The visual pager can be ahead of controlled props during
                // the idle window. Seed the adjacent-day transition from the
                // page the user actually touched, not the older store month.
                detailMonthLatestSelectedDayRef.current = visualAnchorDay;
                detailMonthLatestVisibleMonthRef.current = visualMonth;
                startDetailMonthAnimationRef.current(
                    targetMonth < visualMonth ? -1 : 1,
                    {
                        targetDay: day.dateString,
                        gestureAxis: "vertical",
                    }
                );
                return;
            }
            detailMonthVisualAnchorDayRef.current = day.dateString;
            detailMonthSettledAnchorDayRef.current = day.dateString;
            detailMonthLatestSelectedDayRef.current = day.dateString;
            detailMonthLatestVisibleMonthRef.current = targetMonth;
            commitDetailMonthControlledState(day.dateString);
            return;
        }
        onOpenDayRef.current(day.dateString);
    }, [
        commitDetailMonthControlledState,
        detailMonthVisualSelectedDayKey,
        discardDetailMonthContinuousCommit,
    ]);
    const handleDetailMonthTapCell = useCallback((
        monthOrdinal: number,
        cellIndex: number
    ) => {
        if (
            !Number.isInteger(monthOrdinal)
            || !Number.isInteger(cellIndex)
            || cellIndex < 0
            || cellIndex >= DETAIL_MONTH_GRID_CELL_COUNT
        ) return;

        const year = Math.floor(monthOrdinal / 12);
        const month = monthOrdinal - year * 12 + 1;
        const monthDay = `${year}-${String(month).padStart(2, "0")}-01`;
        const model = getDetailMonthPageModel(monthDay, firstDay);
        // Four- and five-week months keep hidden rows mounted for stable
        // geometry. Coordinates in those rows are not calendar taps.
        if (cellIndex >= model.weekCount * DETAIL_MONTH_GRID_COLUMN_COUNT) {
            return;
        }
        const date = model.dates[cellIndex];
        if (date) handleCalendarDayPress(date);
    }, [firstDay, handleCalendarDayPress]);
    const detailMonthTapGesture = useMemo(() => Gesture.Tap()
        .enabled(
            viewMode === "detail"
            && !transitionActive
            && !todayFocusTarget
            && detailMonthPageWidth > 0
        )
        .maxDistance(DETAIL_MONTH_SWIPE_GESTURE.activationDistance)
        .withTestId("detail-month-tap-gesture")
        .onEnd((event, success) => {
            "worklet";

            if (!success || detailMonthGestureBlocked.value) return;
            const slotId = detailMonthVisualMonthOrdinal.value
                - detailMonthPagerWindowStartOrdinal.value;
            const slotDayHeights = detailMonthPagerSlotDayHeights.value;
            if (slotId < 0 || slotId >= slotDayHeights.length) return;

            const cellHeight = Math.max(32, slotDayHeights[slotId]);
            const contentWidth = detailMonthPageWidth
                - DETAIL_MONTH_GRID_HORIZONTAL_PADDING * 2;
            const contentX = event.x
                - DETAIL_MONTH_GRID_HORIZONTAL_PADDING;
            const contentY = event.y - CALENDAR_HEADER_SPACING;
            if (
                contentWidth <= 0
                || contentX < 0
                || contentX >= contentWidth
                || contentY < 0
                || contentY
                    >= cellHeight * DETAIL_MONTH_GRID_ROW_COUNT
            ) return;

            const column = Math.floor(
                contentX / (
                    contentWidth / DETAIL_MONTH_GRID_COLUMN_COUNT
                )
            );
            const row = Math.floor(contentY / cellHeight);
            runOnJS(handleDetailMonthTapCell)(
                detailMonthVisualMonthOrdinal.value,
                row * DETAIL_MONTH_GRID_COLUMN_COUNT + column
            );
        }), [
        detailMonthGestureBlocked,
        detailMonthPageWidth,
        detailMonthPagerSlotDayHeights,
        detailMonthPagerWindowStartOrdinal,
        detailMonthVisualMonthOrdinal,
        handleDetailMonthTapCell,
        todayFocusTarget,
        transitionActive,
        viewMode,
    ]);
    const detailMonthInputGesture = useMemo(
        () => Gesture.Exclusive(
            detailMonthPanGesture,
            detailMonthTapGesture
        ),
        [detailMonthPanGesture, detailMonthTapGesture]
    );
    const renderDay = useCallback((
        { date, state, marking }: CalendarDayComponentProps,
        detailCellHeight?: number,
        dayMetadata?: CalendarDayMetadata,
        detailPagerMonthOrdinal?: number
    ) => (
        <CustomDay
            date={date}
            state={state}
            marking={marking}
            dayMetadata={dayMetadata}
            viewMode={viewMode}
            animatedCellHeight={animatedDayHeight}
            animatedSelectedDayKey={
                viewMode === "detail"
                    ? detailMonthVisualSelectedDayKey
                    : undefined
            }
            detailPagerMonthOrdinal={detailPagerMonthOrdinal}
            detailCellHeight={detailCellHeight}
            isSelectedDay={Boolean(marking?.selected)}
            allowDisabledPress={
                viewMode === "detail"
            }
            onPress={handleCalendarDayPress}
        />
    ), [
        animatedDayHeight,
        detailMonthVisualSelectedDayKey,
        handleCalendarDayPress,
        viewMode,
    ]);
    const renderControlledDay = useCallback((
        props: CalendarDayComponentProps,
        detailCellHeight?: number
    ) => renderDay(
        props,
        detailCellHeight,
        props.date
            ? calendarDaysByDate[props.date.dateString]
            : undefined
    ), [calendarDaysByDate, renderDay]);

    const calendarTheme = useMemo(() => ({
        weekVerticalMargin: 0,
        backgroundColor: colors.calendarBackground,
        calendarBackground: colors.calendarBackground,
        textSectionTitleColor: colors.dayHeaderColor,
        arrowColor: colors.arrowColor,
        monthTextColor: colors.monthTextColor,
        textMonthFontWeight: "800",
        textMonthFontSize: 22,
        textDayHeaderFontWeight: "600",
        textDayHeaderFontSize: 13,
        "stylesheet.calendar.header": {
            header: {
                flexDirection: "row",
                justifyContent: "flex-start",
                alignItems: "center",
                paddingHorizontal: 16,
                marginTop: CALENDAR_HEADER_TOP_MARGIN,
                marginBottom: CALENDAR_HEADER_BOTTOM_MARGIN,
            },
        },
    } as React.ComponentProps<typeof Calendar>["theme"] & Record<string, unknown>), [
        colors.arrowColor,
        colors.calendarBackground,
        colors.dayHeaderColor,
        colors.monthTextColor,
    ]);

    const weekdayLabels = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => WEEKDAYS[(firstDay + index) % 7])
    ), [firstDay]);
    const weekdayHeader = useMemo(() => (
        <View
            style={[
                styles.weekdayHeader,
                {
                    backgroundColor: "transparent",
                    borderBottomColor: colors.border,
                },
            ]}
        >
            {weekdayLabels.map((label, index) => (
                <Text
                    key={`${label}-${index}`}
                    style={[styles.weekdayText, { color: colors.dayHeaderColor }]}
                >
                    {label}
                </Text>
            ))}
        </View>
    ), [colors.border, colors.dayHeaderColor, weekdayLabels]);

    const stackMonths = useMemo(() => {
        const initialMonth = stackListAnchorMonth;
        const initialMonthKey = `${initialMonth.getFullYear()}-${String(
            initialMonth.getMonth() + 1
        ).padStart(2, "0")}`;

        return Array.from(
            { length: STACK_MONTH_RANGE * 2 + 1 },
            (_, index) => {
                const monthDate = new Date(
                    initialMonth.getFullYear(),
                    initialMonth.getMonth() + index - STACK_MONTH_RANGE,
                    1
                );
                const monthKey = `${monthDate.getFullYear()}-${String(
                    monthDate.getMonth() + 1
                ).padStart(2, "0")}`;

                return createStackMonth(
                    monthDate,
                    firstDay,
                    CALENDAR_DAY_HEIGHTS[viewMode],
                    monthKey === initialMonthKey ? 0 : STACK_MONTH_HEADER_HEIGHT
                );
            }
        );
    }, [firstDay, stackListAnchorMonth, viewMode]);
    const stackMonthLayouts = useMemo(() => {
        let offset = 0;
        return stackMonths.map((month, index) => {
            const layout = { length: month.height, offset, index };
            offset += month.height;
            return layout;
        });
    }, [stackMonths]);
    const stackTargetMonthIndex = useMemo(
        () => stackMonths.findIndex((month) => month.key === stackTargetMonthKey),
        [stackMonths, stackTargetMonthKey]
    );
    const visibleMonthChangeRef = useRef(onVisibleMonthChange);
    visibleMonthChangeRef.current = onVisibleMonthChange;

    const updateActiveStackMonth = useCallback((
        month: StackMonth,
        notifyParent = true
    ) => {
        if (activeStackMonthRef.current === month.key) return;

        activeStackMonthRef.current = month.key;
        if (notifyParent) {
            // focusedMonth is controlled by the parent. Tag this update so the
            // echoed prop is not mistaken for a new programmatic navigation.
            internallyReportedStackMonthRef.current = month.key;
            visibleMonthChangeRef.current(month.dateString);
        }
    }, []);

    useEffect(() => {
        if (!isContinuousMonthViewMode(viewMode) || stackTargetMonthIndex < 0) {
            positionedStackListSessionRef.current = null;
            positionedStackTargetMonthRef.current = null;
            internallyReportedStackMonthRef.current = null;
            return;
        }

        const targetMonth = stackMonths[stackTargetMonthIndex];
        const isNewListSession =
            positionedStackListSessionRef.current !== stackListSessionKey;
        const hasExplicitScrollRequest =
            handledStackScrollRequestRef.current !== scrollRequest;
        const hasNewTargetMonth =
            positionedStackTargetMonthRef.current !== targetMonth.key;
        const hasTransitionTarget = Boolean(
            normalizeMonthCandidate(transitionMonthKey)
        );
        const isControlledScrollEcho =
            internallyReportedStackMonthRef.current === targetMonth.key
            && !isNewListSession
            && !hasExplicitScrollRequest
            && !hasTransitionTarget
            && !todayFocusTarget;

        positionedStackListSessionRef.current = stackListSessionKey;
        handledStackScrollRequestRef.current = scrollRequest;

        if (isControlledScrollEcho) {
            // Natural scrolling already put the list at the correct offset.
            // Re-scrolling here created the visible month-boundary snap.
            internallyReportedStackMonthRef.current = null;
            positionedStackTargetMonthRef.current = targetMonth.key;
            return;
        }

        if (
            !isNewListSession
            && !hasExplicitScrollRequest
            && !hasTransitionTarget
            && !todayFocusTarget
            && !hasNewTargetMonth
        ) {
            // Schedule refreshes can change dynamic week/month heights. Let
            // FlatList preserve its visible anchor instead of snapping the
            // user back to the beginning of the active month.
            return;
        }

        internallyReportedStackMonthRef.current = null;
        positionedStackTargetMonthRef.current = targetMonth.key;
        updateActiveStackMonth(
            targetMonth,
            !transitionActive && !normalizeMonthCandidate(transitionMonthKey)
        );

        const scrollFrame = requestAnimationFrame(() => {
            const stackList = stackListRef.current;
            if (!stackList) return;

            stackList.scrollToOffset({
                // The sticky header already names the target month. Skip the
                // inline section title for programmatic jumps so it is not
                // duplicated directly beneath the sticky title.
                offset: Math.max(
                    0,
                    stackMonthLayouts[stackTargetMonthIndex].offset
                        + targetMonth.headerHeight
                ),
                animated: false,
            });
            if (todayFocusTarget?.day.slice(0, 7) === targetMonth.key) {
                acknowledgeTodayFocusTarget(todayFocusTarget.day);
            }
        });

        return () => cancelAnimationFrame(scrollFrame);
    }, [
        acknowledgeTodayFocusTarget,
        scrollRequest,
        stackMonthLayouts,
        stackMonths,
        stackListSessionKey,
        stackTargetMonthIndex,
        transitionActive,
        transitionMonthKey,
        todayFocusTarget,
        updateActiveStackMonth,
        viewMode,
    ]);

    const handleStackScroll = useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        const viewportHeight = event.nativeEvent.layoutMeasurement.height;
        const contentOffsetY = event.nativeEvent.contentOffset.y;
        if (
            !Number.isFinite(viewportHeight)
            || viewportHeight <= 0
            || !Number.isFinite(contentOffsetY)
        ) {
            // FlatList can emit an initial scroll event before its viewport is
            // measured. At a month boundary its fractional offset may then sit
            // just before the target item, incorrectly reporting the prior month.
            return;
        }

        const monthSwitchLine = contentOffsetY + viewportHeight * 0.32;
        let activeIndex = 0;

        for (let index = 1; index < stackMonthLayouts.length; index += 1) {
            if (stackMonthLayouts[index].offset > monthSwitchLine) break;
            activeIndex = index;
        }

        const nextActiveMonth = stackMonths[activeIndex];
        if (nextActiveMonth) {
            updateActiveStackMonth(nextActiveMonth, !transitionActive);
        }
    }, [
        stackMonthLayouts,
        stackMonths,
        transitionActive,
        updateActiveStackMonth,
    ]);

    const renderStackMonth = useCallback(({ item }: { item: StackMonth }) => (
        <View
            style={[
                styles.stackMonth,
                {
                    height: item.height,
                    backgroundColor: colors.calendarBackground,
                    borderBottomColor: colors.border,
                },
            ]}
        >
            {item.headerHeight > 0 && (
                <View style={[styles.stackMonthHeader, { height: item.headerHeight }]}>
                    <Text style={[styles.stackMonthTitle, { color: colors.monthTextColor }]}>
                        {item.month}월
                    </Text>
                </View>
            )}
            <View style={styles.stackMonthGrid}>
                {Array.from(
                    { length: Math.ceil(item.days.length / 7) },
                    (_, weekIndex) => {
                        const weekDays = item.days.slice(
                            weekIndex * 7,
                            weekIndex * 7 + 7
                        );
                        const stackEventTop = weekDays.some((weekDate) => (
                            weekDate
                            && (calendarDaysByDate[weekDate.dateString]
                                ?.holidays?.length ?? 0) > 0
                        )) ? 62 : 52;

                        return (
                            <View
                                key={`${item.key}-week-${weekIndex}`}
                                style={[
                                    styles.stackWeekRow,
                                    {
                                        height: item.dayHeight,
                                        borderTopColor: colors.border,
                                    },
                                ]}
                            >
                                {weekDays.map((date, dayIndex) => (
                                    <View
                                        key={date?.dateString
                                            ?? `${item.key}-blank-${weekIndex}-${dayIndex}`}
                                        style={[
                                            styles.stackDayCell,
                                            { height: item.dayHeight },
                                        ]}
                                    >
                                        <CustomDay
                                            date={date ?? undefined}
                                            state={date?.dateString === todayDateString
                                                ? "today"
                                                : undefined}
                                            marking={date
                                                ? markedDates[date.dateString]
                                                : undefined}
                                            dayMetadata={date
                                                ? calendarDaysByDate[date.dateString]
                                                : undefined}
                                            viewMode="stack"
                                            stackPresentation={date
                                                ? stackCalendarLayout.byDate[date.dateString]
                                                : undefined}
                                            stackEventTop={stackEventTop}
                                            hideStackEventLabels
                                            isSelectedDay={date?.dateString === selectedDay}
                                            onPress={(day) => onOpenDay(day.dateString)}
                                        />
                                    </View>
                                ))}
                                <StackWeekEventLabels
                                    days={weekDays.map((date) => date?.dateString ?? null)}
                                    layout={stackCalendarLayout}
                                    eventTop={stackEventTop}
                                />
                            </View>
                        );
                    }
                )}
            </View>
        </View>
    ), [
        colors.border,
        colors.calendarBackground,
        colors.monthTextColor,
        calendarDaysByDate,
        markedDates,
        onOpenDay,
        selectedDay,
        stackCalendarLayout,
        todayDateString,
    ]);

    const selectedWeekDays = useMemo(
        () => createWeekDays(selectedDay, firstDay),
        [firstDay, selectedDay]
    );
    const resolveDetailMonthPagerPageLayout = useCallback((day: string) => {
        return resolveDetailMonthPagerLayout(
            day,
            detailMonthPageLayouts,
            initialMonthKey,
            firstDay
        );
    }, [detailMonthPageLayouts, firstDay, initialMonthKey]);
    const detailMonthPagerPages = useMemo(() => {
        const accessibleOrdinal = getCalendarMonthOrdinal(
            detailMonthPagerAnchorDay
        );
        const pages = detailMonthPagerSlots.map((slot) => {
            const layout = resolveDetailMonthPagerPageLayout(slot.day);
            const accessiblePosition = slot.monthOrdinal - accessibleOrdinal;
            const positionName = accessiblePosition === 0
                ? "current"
                : accessiblePosition === -1
                    ? "previous"
                    : accessiblePosition === 1
                        ? "next"
                        : accessiblePosition === -2
                            ? "before-previous"
                            : "after-next";
            return {
                ...slot,
                key: `month-${slot.day.slice(0, 7)}`,
                layout,
                current: accessiblePosition === 0,
                accessiblePosition,
                positionName,
            };
        });

        // Preserve the historical centre-five render order used by the
        // transition/test harness while mounting the wider cold window first.
        return pages.sort((left, right) => {
            const leftIsNear = Math.abs(left.accessiblePosition) <= 2;
            const rightIsNear = Math.abs(right.accessiblePosition) <= 2;
            if (leftIsNear !== rightIsNear) return leftIsNear ? 1 : -1;
            return left.monthOrdinal - right.monthOrdinal;
        });
    }, [
        detailMonthPagerAnchorDay,
        detailMonthPagerSlots,
        resolveDetailMonthPagerPageLayout,
    ]);
    const detailMonthPagerCanvasHeight = useMemo(() => Math.max(
        1,
        detailMonthViewportLayoutHeight,
        ...detailMonthPagerPages.map((page) => (
            page.layout
                ? page.layout.calendarHeight - Math.max(0, headerOffset)
                : 0
        ))
    ), [
        detailMonthPagerPages,
        detailMonthViewportLayoutHeight,
        headerOffset,
    ]);
    const selectedWeekTitle = useMemo(
        () => formatWeekTitle(selectedWeekDays),
        [selectedWeekDays]
    );

    if (isContinuousMonthViewMode(viewMode)) {
        return (
            <View
                style={[
                    styles.stackList,
                    {
                        paddingBottom: Math.max(0, bottomContentInset),
                        paddingTop: Math.max(headerOffset, 0),
                        backgroundColor: colors.calendarBackground,
                    },
                ]}
            >
                <FlatList
                    ref={stackListRef}
                    key={stackListSessionKey ?? `${mode}-${viewMode}-${firstDay}`}
                    data={stackMonths}
                    renderItem={renderStackMonth}
                    keyExtractor={(item) => item.key}
                    initialScrollIndex={
                        stackTargetMonthIndex >= 0
                            ? stackTargetMonthIndex
                            : STACK_MONTH_RANGE
                    }
                    getItemLayout={(_, index) => stackMonthLayouts[index]}
                    onScroll={handleStackScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={false}
                    maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                    style={styles.stackList}
                    contentContainerStyle={styles.stackListContent}
                    initialNumToRender={3}
                    maxToRenderPerBatch={4}
                    windowSize={7}
                />
            </View>
        );
    }

    if (viewMode === "week") {
        return (
            <View style={[styles.weekContainer, { backgroundColor: colors.calendarBackground }]}>
                <View style={styles.listMonthHeader}>
                    <Pressable
                        onPress={() => {
                            const nextDay = moveDay(selectedDay, -7);
                            onSelectDay(nextDay);
                            onVisibleMonthChange(nextDay);
                        }}
                        accessibilityLabel="이전 주"
                        accessibilityRole="button"
                        style={styles.monthArrow}
                    >
                        <Ionicons accessible={false} name="chevron-back" size={27} color={colors.arrowColor} />
                    </Pressable>
                    <Text style={[styles.listMonthTitle, { color: colors.monthTextColor }]}>
                        {selectedWeekTitle}
                    </Text>
                    <Pressable
                        onPress={() => {
                            const nextDay = moveDay(selectedDay, 7);
                            onSelectDay(nextDay);
                            onVisibleMonthChange(nextDay);
                        }}
                        accessibilityLabel="다음 주"
                        accessibilityRole="button"
                        style={styles.monthArrow}
                    >
                        <Ionicons accessible={false} name="chevron-forward" size={27} color={colors.arrowColor} />
                    </Pressable>
                </View>
                {weekdayHeader}
                <View style={[styles.weekGrid, { borderBottomColor: colors.border }]}>
                    {selectedWeekDays.map((date) => (
                        <View
                            key={date.dateString}
                            style={[styles.weekDayCell, { height: CALENDAR_DAY_HEIGHTS.week }]}
                        >
                            <CustomDay
                                date={date}
                                state={date.dateString === todayDateString ? "today" : undefined}
                                marking={markedDates[date.dateString]}
                                dayMetadata={calendarDaysByDate[date.dateString]}
                                viewMode={viewMode}
                                animatedCellHeight={animatedDayHeight}
                                isSelectedDay={date.dateString === selectedDay}
                                onPress={(day) => {
                                    onVisibleMonthChange(day.dateString);
                                    onOpenDay(day.dateString);
                                }}
                            />
                        </View>
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View
            style={[
                styles.monthCalendarContainer,
                {
                    backgroundColor: colors.calendarBackground,
                    paddingTop: Math.max(headerOffset, 0),
                },
            ]}
        >
            <View
                testID="detail-month-swipe-handler"
                style={[
                    styles.detailMonthPagerViewport,
                    { height: detailMonthPagerCanvasHeight },
                ]}
                onLayout={handleDetailMonthViewportLayout}
            >
                <GestureDetector gesture={detailMonthInputGesture}>
                    <Animated.View
                        testID="detail-month-animated-layer"
                        style={[
                            styles.detailMonthPagerViewport,
                            {
                                height: detailMonthPagerCanvasHeight,
                                opacity: detailMonthOpacity,
                                transform: [
                                    { translateX: detailMonthTranslateX },
                                    { translateY: detailMonthTranslateY },
                                ],
                            },
                        ]}
                    >
                        {viewMode === "detail" && !transitionActive ? (
                            <Reanimated.View
                                testID="detail-month-gesture-layer"
                                style={[
                                    styles.detailMonthPagerCanvas,
                                    detailMonthGestureAnimatedStyle,
                                    {
                                        height: detailMonthPagerCanvasHeight,
                                        backgroundColor:
                                            colors.calendarBackground,
                                    },
                                ]}
                            >
                                <DetailMonthPagerSelectionLayer
                                    pageWidth={detailMonthPageWidth}
                                    firstDay={firstDay}
                                    todayKey={getCalendarDaySelectionKey(
                                        todayDateString
                                    )}
                                    animatedSelectedDayKey={
                                        detailMonthVisualSelectedDayKey
                                    }
                                    visualMonthOrdinal={
                                        detailMonthVisualMonthOrdinal
                                    }
                                    windowStartOrdinal={
                                        detailMonthPagerWindowStartOrdinal
                                    }
                                    slotPageHeights={
                                        detailMonthPagerSlotPageHeights
                                    }
                                    slotDayHeights={
                                        detailMonthPagerSlotDayHeights
                                    }
                                    axis={detailMonthGestureAxis}
                                    selectedDayBackground={
                                        colors.selectedDayBg
                                    }
                                    selectedDayText={colors.selectedDayText}
                                    lunarTextByDayKey={
                                        detailMonthSelectionLunarTextByDayKey
                                    }
                                    initialSelectedDayKey={
                                        getCalendarDaySelectionKey(initialDate)
                                    }
                                    initialVisualMonthOrdinal={
                                        getCalendarMonthOrdinal(
                                            detailMonthPagerAnchorDay
                                        )
                                    }
                                >
                                    {detailMonthPagerPages.map((page) => (
                                        <DetailMonthPagerPageFrame
                                            key={`${page.key}-${mode}-${firstDay}`}
                                            pageOrdinal={page.monthOrdinal}
                                            current={page.current}
                                            pageWidth={detailMonthPageWidth}
                                            axis={detailMonthGestureAxis}
                                            visualMonthOrdinal={
                                                detailMonthVisualMonthOrdinal
                                            }
                                            windowStartOrdinal={
                                                detailMonthPagerWindowStartOrdinal
                                            }
                                            slotPageHeights={
                                                detailMonthPagerSlotPageHeights
                                            }
                                            pageTestID={`detail-month-page-${page.positionName}-${page.day.slice(0, 7)}`}
                                        >
                                            <DetailMonthPagerGrid
                                                day={page.day}
                                                firstDay={firstDay}
                                                markedDates={
                                                    calendarEventMarkings
                                                }
                                                calendarDaysByDate={
                                                    calendarDaysByDate
                                                }
                                                detailCellHeight={
                                                    page.layout?.dayHeight
                                                }
                                                todayDateString={
                                                    todayDateString
                                                }
                                                textPrimary={
                                                    colors.textPrimary
                                                }
                                                textSecondary={
                                                    colors.textSecondary
                                                }
                                                colorMode={mode}
                                                onPress={
                                                    handleCalendarDayPress
                                                }
                                                onShift={
                                                    shiftContinuousDetailMonthPager
                                                }
                                            />
                                        </DetailMonthPagerPageFrame>
                                    ))}
                                </DetailMonthPagerSelectionLayer>
                            </Reanimated.View>
                        ) : (
                            <Calendar
                                key={viewMode === "detail"
                                    ? `detail-transition-${initialDate.slice(0, 7)}-${mode}-${firstDay}`
                                    : `${mode}-${firstDay}`}
                                testID={viewMode === "detail"
                                    ? "detail-month-transition-calendar"
                                    : undefined}
                                initialDate={initialDate}
                                firstDay={firstDay}
                                enableSwipeMonths={viewMode !== "detail"}
                                hideArrows
                                hideDayNames
                                hideExtraDays={false}
                                onPressArrowLeft={viewMode === "detail"
                                    ? () => undefined
                                    : (subtractMonth) => subtractMonth()}
                                onPressArrowRight={viewMode === "detail"
                                    ? () => undefined
                                    : (addMonth) => addMonth()}
                                onMonthChange={viewMode === "detail"
                                    ? undefined
                                    : handleDetailMonthChange}
                                markedDates={markedDates}
                                dayComponent={renderControlledDay}
                                renderHeader={() => null}
                                style={[
                                    styles.calendar,
                                    { backgroundColor: colors.calendarBackground },
                                ]}
                                theme={calendarTheme}
                            />
                        )}
                    </Animated.View>
                </GestureDetector>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    stackList: {
        flex: 1,
    },
    stackListContent: {
        paddingBottom: 24,
    },
    stackMonth: {
        borderBottomWidth: 0,
    },
    stackMonthHeader: {
        paddingHorizontal: 28,
        justifyContent: "center",
    },
    stackMonthTitle: {
        fontSize: 25,
        fontWeight: "900",
        letterSpacing: 0,
    },
    stackMonthGrid: {
        alignSelf: "stretch",
    },
    stackWeekRow: {
        position: "relative",
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    stackDayCell: {
        width: "14.2857%",
    },
    calendar: {
        paddingHorizontal: 12,
        paddingBottom: CALENDAR_CONTENT_BOTTOM_PADDING,
    },
    detailMonthGrid: {
        position: "relative",
        alignSelf: "stretch",
        paddingTop: CALENDAR_HEADER_SPACING,
        paddingHorizontal: DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
        paddingBottom: CALENDAR_CONTENT_BOTTOM_PADDING,
    },
    detailMonthGridRow: {
        position: "relative",
        zIndex: 1,
        flexDirection: "row",
    },
    detailMonthGridHiddenRow: {
        display: "none",
    },
    detailMonthGridCell: {
        width: "14.2857%",
        overflow: "hidden",
    },
    detailMonthGridDay: {
        alignItems: "center",
    },
    detailMonthGridDayCircle: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    detailMonthGridDayText: {
        letterSpacing: 0,
        textAlign: "center",
    },
    detailMonthGridLunarText: {
        fontWeight: "700",
        letterSpacing: -0.35,
        textAlign: "center",
    },
    detailMonthGridHolidayText: {
        position: "absolute",
        left: 2,
        right: 2,
        fontWeight: "800",
        letterSpacing: -0.25,
        textAlign: "center",
    },
    detailMonthGridMarkers: {
        position: "absolute",
        left: 2,
        right: 2,
        minHeight: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    detailMonthGridDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    detailMonthGridTravelMarker: {
        width: 8,
        height: 8,
    },
    detailMonthGridEventMore: {
        flexShrink: 0,
        fontSize: 7,
        lineHeight: 8,
        fontWeight: "800",
    },
    detailMonthAccessibilityAdjuster: {
        position: "absolute",
        top: 0,
        left: 0,
        width: 1,
        height: 1,
        zIndex: 3,
    },
    detailMonthSelectionGlyph: {
        position: "absolute",
        top: CALENDAR_HEADER_SPACING,
        left: 0,
        zIndex: 2,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    detailMonthSelectionDayText: {
        padding: 0,
        margin: 0,
        borderWidth: 0,
        textAlign: "center",
        fontWeight: "700",
        backgroundColor: "transparent",
    },
    detailMonthSelectionLunarText: {
        padding: 0,
        margin: 0,
        borderWidth: 0,
        textAlign: "center",
        fontWeight: "700",
        letterSpacing: -0.35,
        backgroundColor: "transparent",
    },
    detailMonthPagerViewport: {
        overflow: "hidden",
        width: "100%",
    },
    detailMonthPagerCanvas: {
        position: "relative",
        width: "100%",
    },
    detailMonthPagerPage: {
        width: "100%",
        zIndex: 1,
    },
    detailMonthPagerPageAbsolute: {
        position: "absolute",
        top: 0,
        left: 0,
        transform: [
            { translateX: 0 },
            { translateY: 0 },
        ],
    },
    monthCalendarContainer: {
        flexShrink: 0,
        overflow: "hidden",
    },
    weekdayHeader: {
        height: WEEKDAY_HEADER_HEIGHT,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    weekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 13,
        fontWeight: "600",
        opacity: 0.92,
    },
    listMonthHeader: {
        height: 58,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    listMonthTitle: {
        fontSize: 24,
        fontWeight: "800",
        letterSpacing: 0,
    },
    monthArrow: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    weekContainer: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekGrid: {
        flexDirection: "row",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekDayCell: {
        width: "14.2857%",
    },
});

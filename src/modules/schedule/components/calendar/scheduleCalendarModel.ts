import React from "react";
import { Easing, StyleSheet } from "react-native";
import { type DateData } from "react-native-calendars";
import { Easing as ReanimatedEasing } from "react-native-reanimated";

import type { CalendarDayMetadata } from "../../calendarMetadata";
import {
    DETAIL_MONTH_SWIPE_MOTION,
    type DetailMonthSwipeDirection,
} from "../../calendarMotion";
import { shiftCalendarMonth } from "../../calendarNavigation";
import CustomDay from "./CustomDay";
import {
    CALENDAR_DAY_HEIGHTS,
    type CalendarViewMode,
} from "./viewMode";

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

export type CalendarDayComponentProps = {
    date?: DateData;
    state?: string;
    marking?: React.ComponentProps<typeof CustomDay>["marking"];
};

export type CalendarMarkedEvent = NonNullable<
    NonNullable<CalendarDayComponentProps["marking"]>["events"]
>[number];
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const STACK_MONTH_RANGE = 60;
export const WEEKDAY_HEADER_HEIGHT = 42;
export const STACK_MONTH_HEADER_HEIGHT = 52;
export const STACK_MONTH_DIVIDER_HEIGHT = StyleSheet.hairlineWidth;
export const CALENDAR_HEADER_TOP_MARGIN = 14;
export const CALENDAR_HEADER_BOTTOM_MARGIN = 8;
export const CALENDAR_HEADER_SPACING =
    CALENDAR_HEADER_TOP_MARGIN + CALENDAR_HEADER_BOTTOM_MARGIN;
export const CALENDAR_CONTENT_BOTTOM_PADDING = 4;
/** 상세 월 격자의 좌우 여백으로 모든 캘린더 하위 뷰가 같은 값을 공유한다. */
export const DETAIL_MONTH_GRID_HORIZONTAL_PADDING = 12;
export const TRANSITION_MONTH_PREFIX = "month-";
export const DETAIL_MONTH_SWIPE_EASING = Easing.bezier(
    ...DETAIL_MONTH_SWIPE_MOTION.bezier
);
export const DETAIL_MONTH_SWIPE_REANIMATED_EASING = ReanimatedEasing.bezier(
    ...DETAIL_MONTH_SWIPE_MOTION.bezier
);
export const DETAIL_MONTH_SWIPE_SETTLE_REANIMATED_EASING =
    ReanimatedEasing.bezier(
        ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
    );
export const DETAIL_MONTH_SWIPE_QUEUE_LIMIT = 6;
// Keep a whole rapid-swipe session mounted. Moving between these pages is a
// UI-thread ordinal change; React only rebuilds the window after the user has
// stopped near one of its guards. The 24-month regression burst therefore has
// no Calendar mount/recycle work in its input path.
export const DETAIL_MONTH_PAGER_RADIUS = 26;
export const DETAIL_MONTH_PAGER_GUARD = 3;
export const DETAIL_MONTH_PAGER_POSITIONS = Array.from(
    { length: DETAIL_MONTH_PAGER_RADIUS * 2 + 1 },
    (_, index) => index - DETAIL_MONTH_PAGER_RADIUS
);
export const EMPTY_CALENDAR_DAYS_BY_DATE: Readonly<Record<string, CalendarDayMetadata>> = {};

/** 날짜 문자열을 UI 스레드에서 비교하기 쉬운 숫자 키로 변환한다. 잘못된 입력은 선택 없음으로 취급한다. */
export function getCalendarDaySelectionKey(day: string): number {
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    const date = Number(day.slice(8, 10));
    if (![year, month, date].every(Number.isFinite)) return 0;
    return year * 10_000 + month * 100 + date;
}

/** 숫자형 날짜 키를 YYYY-MM-DD 문자열로 복원한다. 범위를 벗어난 키는 null을 반환해 잘못된 선택 전파를 막는다. */
export function getCalendarDayFromSelectionKey(dayKey: number): string | null {
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

/** 현재 일자를 유지하면서 이전·다음 달의 유효한 날짜 키를 계산한다. Reanimated 작업에서 호출되므로 worklet 제약을 지킨다. */
export function shiftCalendarDaySelectionKeyOnUI(
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

export type DetailMonthPagerSlot = {
    id: number;
    day: string;
    monthOrdinal: number;
};

/** 연월 문자열을 월 단위 순번으로 바꿔 페이저 페이지 간 거리를 일정한 정수로 표현한다. */
export function getCalendarMonthOrdinal(day: string): number {
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month)) return 0;
    return year * 12 + month - 1;
}

/** 기준 날짜를 중심으로 상세 월 페이저가 미리 유지할 월 슬롯 목록을 만든다. */
export function createDetailMonthPagerSlots(anchorDay: string): DetailMonthPagerSlot[] {
    return DETAIL_MONTH_PAGER_POSITIONS.map((offset, id) => {
        const day = shiftCalendarMonth(anchorDay, offset);
        return {
            id,
            day,
            monthOrdinal: getCalendarMonthOrdinal(day),
        };
    });
}

/** 월과 주 수에 맞는 캘린더·일정 영역 높이를 선택하고 누락된 레이아웃은 인접 값으로 안전하게 보완한다. */
export function resolveDetailMonthPagerLayout(
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

/** 세로 월 전환에서 각 페이지가 차지할 누적 높이를 계산해 현재 페이지 기준 오프셋을 반환한다. */
export function getDetailMonthPagerVerticalOffset(
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

export type DetailMonthAnimationPhase =
    | "idle"
    | "exit"
    | "settling"
    | "awaitingCommit"
    | "finalizing"
    | "enter";

export type DetailMonthAnimationOptions = {
    gestureOffset?: number;
    gestureVelocity?: number;
    gestureAxis?: "horizontal" | "vertical";
    gestureAlreadySettled?: boolean;
    gestureSettleOwnedByUI?: boolean;
    targetDay?: string;
};

export type DetailMonthPendingCommand = {
    direction: DetailMonthSwipeDirection;
    axis: "horizontal" | "vertical";
};

export type FixedCalendarHeightOptions = {
    viewMode: CalendarViewMode;
    month: string;
    firstDay: 0 | 1;
    headerOffset: number;
};

export type StackMonth = {
    key: string;
    year: number;
    month: number;
    dateString: string;
    days: Array<DateData | null>;
    dayHeight: number;
    headerHeight: number;
    height: number;
};

/** 월의 시작 요일과 마지막 날짜를 기준으로 화면에 필요한 주 행 수를 4~6주 범위에서 계산한다. */
export function getMonthWeekCount(month: string, firstDay: 0 | 1): number {
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
/** 보기 모드와 헤더·하단 여백을 합산해 캘린더 영역의 고정 높이를 계산한다. */
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

/** 외부에서 받은 날짜 후보를 YYYY-MM 형식으로 정규화하고 유효하지 않은 값은 거부한다. */
export function normalizeMonthCandidate(value: string | null | undefined): string | null {
    if (!value) return null;

    const trimmed = value.startsWith(TRANSITION_MONTH_PREFIX)
        ? value.slice(TRANSITION_MONTH_PREFIX.length)
        : value;
    const candidate = trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;

    return /^\d{4}-\d{2}$/.test(candidate) ? candidate : null;
}

/** 기준 날짜와 대상 연월 사이의 차이를 월 단위 정수로 계산한다. */
export function getMonthDistance(from: Date, toMonth: string): number {
    const [yearText, monthText] = toMonth.split("-");
    const toYear = Number(yearText);
    const toMonthIndex = Number(monthText) - 1;

    return (toYear - from.getFullYear()) * 12
        + toMonthIndex
        - from.getMonth();
}

/** 선택일과 현재 보이는 달을 조합해 상세 월 페이저가 사용할 유효한 기준 날짜를 결정한다. */
export function resolveDetailMonthAnchor(selectedDay: string, visibleMonth: string): string {
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

/** 연·월·일 숫자를 캘린더가 사용하는 YYYY-MM-DD 문자열로 직렬화한다. */
export function toDateString(year: number, month: number, day = 1) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 연속 월 목록 한 항목에 필요한 날짜·주차·일정 배치 정보를 한 번에 구성한다. */
export function createStackMonth(
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

/** 로컬 시간대의 오늘 날짜를 캘린더용 YYYY-MM-DD 문자열로 반환한다. */
export function getTodayDateString() {
    const today = new Date();
    return toDateString(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

/** 주간 탐색에서 사용할 수 있도록 날짜 문자열을 지정한 일수만큼 이동한다. */
export function moveDay(day: string, amount: number) {
    const next = new Date(`${day}T00:00:00`);
    next.setDate(next.getDate() + amount);
    return toDateString(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

/** 같은 날짜의 일정 표식을 시작 시각과 제목 순서로 안정적으로 정렬한다. */
export function compareMarkedEvents(left: CalendarMarkedEvent, right: CalendarMarkedEvent) {
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

/** 선택일이 포함된 한 주의 날짜 데이터를 첫 요일 설정에 맞춰 생성한다. */
export function createWeekDays(day: string, firstDay: 0 | 1) {
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

/** 주간 보기의 시작일과 종료일을 사용자가 읽기 쉬운 제목으로 만든다. */
export function formatWeekTitle(days: DateData[]) {
    const first = days[0];
    const last = days[days.length - 1];

    if (first.month === last.month) {
        return `${first.month}월 ${first.day}-${last.day}일`;
    }
    return `${first.month}월 ${first.day}일-${last.month}월 ${last.day}일`;
}

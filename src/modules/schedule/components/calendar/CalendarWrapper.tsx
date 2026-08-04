import React from "react";
import { StyleSheet, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import ScheduleCalendar, {
    type DetailMonthPageLayouts,
} from "./ScheduleCalendar";
import type { ScheduleItem } from "../../types";
import type { CalendarDayMetadata } from "../../calendarMetadata";
import type { CalendarViewMode } from "./viewMode";

export type DayTransitionContext = "idle" | "yearToMonth" | "monthToDay" | "dayToMonth";
export type TodayFocusTarget = {
    day: string;
    requiresMonthChange: boolean;
};

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
    reduceMotionEnabled?: boolean;
    todayFocusTarget?: TodayFocusTarget | null;
    onTodayFocusReady?: (day: string) => void;
    onRegisterDetailMonthMotionCancel?: (
        cancel: (() => void) | null
    ) => void;
    onRegisterDetailMonthMotionShift?: (
        shift: ((direction: -1 | 1) => void) | null
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

// 일정 캘린더에 선택 날짜와 일정 목록을 연결한다.
function CalendarWrapper({
    selectedDay,
    focusedMonth,
    items,
    calendarDaysByDate,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    headerOffset,
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
    bottomContentInset,
}: Props) {
    const shouldUseCompactHeight =
        viewMode === "detail" || viewMode === "list" || viewMode === "week";

    return (
        <View style={shouldUseCompactHeight ? styles.compact : styles.full}>
            <ScheduleCalendar
                selectedDay={selectedDay}
                focusedMonth={focusedMonth}
                items={items}
                calendarDaysByDate={calendarDaysByDate}
                onSelectDay={onSelectDay}
                onOpenDay={onOpenDay}
                viewMode={viewMode}
                firstDay={firstDay}
                scrollRequest={scrollRequest}
                onVisibleMonthChange={onVisibleMonthChange}
                headerOffset={headerOffset}
                transitionMonthKey={transitionMonthKey}
                transitionActive={transitionActive}
                reduceMotionEnabled={reduceMotionEnabled}
                todayFocusTarget={todayFocusTarget}
                onTodayFocusReady={onTodayFocusReady}
                onRegisterDetailMonthMotionCancel={onRegisterDetailMonthMotionCancel}
                onRegisterDetailMonthMotionShift={onRegisterDetailMonthMotionShift}
                onDetailMonthPreview={onDetailMonthPreview}
                onCommitDetailMonth={onCommitDetailMonth}
                onDetailMonthMotionActiveChange={onDetailMonthMotionActiveChange}
                detailMonthMotionActive={detailMonthMotionActive}
                animatedCalendarHeight={animatedCalendarHeight}
                animatedDayHeight={animatedDayHeight}
                detailMonthPageLayouts={detailMonthPageLayouts}
                bottomContentInset={bottomContentInset}
            />
        </View>
    );
}

export default React.memo(CalendarWrapper);

const styles = StyleSheet.create({
    full: {
        flex: 1,
    },
    compact: {
        flexShrink: 0,
    },
});

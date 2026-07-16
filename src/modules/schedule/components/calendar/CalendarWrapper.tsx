import React from "react";
import { StyleSheet, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import ScheduleCalendar from "./ScheduleCalendar";
import type { ScheduleItem } from "../../types";
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
    animatedDayHeight?: SharedValue<number>;
};

// 일정 캘린더에 선택 날짜와 일정 목록을 연결한다.
function CalendarWrapper({
    selectedDay,
    focusedMonth,
    items,
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
    animatedDayHeight,
}: Props) {
    const shouldUseCompactHeight =
        viewMode === "detail" || viewMode === "list" || viewMode === "week";

    return (
        <View style={shouldUseCompactHeight ? styles.compact : styles.full}>
            <ScheduleCalendar
                selectedDay={selectedDay}
                focusedMonth={focusedMonth}
                items={items}
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
                animatedDayHeight={animatedDayHeight}
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

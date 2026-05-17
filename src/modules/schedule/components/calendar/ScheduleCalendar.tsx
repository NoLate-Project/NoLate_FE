import React, { useCallback, useMemo } from "react";
import { Calendar, DateData } from "react-native-calendars";
import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import { enumerateDaysBetween } from "../../../../../lib/util/data";
import CustomDay from "./CustomDay";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
};

type CalendarDayComponentProps = {
    date?: DateData;
    state?: string;
    marking?: React.ComponentProps<typeof CustomDay>["marking"];
};

// 일정 목록을 월간 캘린더 UI로 표시한다.
export default function ScheduleCalendar({ selectedDay, items, onSelectDay }: Props) {
    const { colors, mode } = useTheme();

    // 일정 목록을 캘린더 마킹 데이터로 변환한다.
    const markedDates = useMemo(() => {
        const dateMap: Record<string, any> = {};
        const dateSingleDay: Record<string, ScheduleItem[]> = {};
        const dateMultiDay: Record<string, any[]> = {};

        items.forEach((item) => {
            const dates = enumerateDaysBetween(item.startAt, item.endAt);
            const isMultiDay = dates.length > 1;

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
                if (!dateSingleDay[date]) dateSingleDay[date] = [];
                dateSingleDay[date].push(item);
            }
        });

        Object.keys(dateMultiDay).forEach((date) => {
            dateMap[date] = { periods: dateMultiDay[date] };
            if (dateSingleDay[date]) {
                dateMap[date].dots = dateSingleDay[date].map((item) => ({
                    color: item.category.color,
                }));
                dateMap[date].marked = true;
                delete dateSingleDay[date];
            }
        });

        Object.keys(dateSingleDay).forEach((date) => {
            dateMap[date] = {
                marked: true,
                dots: dateSingleDay[date].map((item) => ({ color: item.category.color })),
            };
        });

        if (dateMap[selectedDay]) {
            dateMap[selectedDay].selected = true;
        } else {
            dateMap[selectedDay] = { selected: true };
        }

        return dateMap;
    }, [items, selectedDay]);

    // 캘린더 라이브러리가 넘겨준 날짜 정보를 앱 전용 날짜 셀로 렌더링한다.
    const renderDay = useCallback(({ date, state, marking }: CalendarDayComponentProps) => (
        <CustomDay
            date={date}
            state={state}
            marking={marking}
            isSelectedDay={date?.dateString === selectedDay}
            onPress={(d) => onSelectDay(d.dateString)}
        />
    ), [onSelectDay, selectedDay]);

    return (
        <Calendar
            key={mode}
            current={selectedDay}
            onDayPress={(day: DateData) => onSelectDay(day.dateString)}
            markedDates={markedDates}
            dayComponent={renderDay}
            theme={{
                backgroundColor: colors.calendarBackground,
                calendarBackground: colors.calendarBackground,
                textSectionTitleColor: colors.dayHeaderColor,
                arrowColor: colors.arrowColor,
                monthTextColor: colors.monthTextColor,
                textMonthFontWeight: "700",
                textMonthFontSize: 17,
                textDayHeaderFontWeight: "600",
                textDayHeaderFontSize: 12,
            }}
        />
    );
}

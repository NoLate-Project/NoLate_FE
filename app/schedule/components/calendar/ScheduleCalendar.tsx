import React, { useMemo } from "react";
import { Calendar, DateData } from "react-native-calendars";
import type { ScheduleItem } from "../../../../src/modules/schedule/types";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";
import { enumerateDaysBetween } from "../../../../lib/util/data";
import CustomDay from "./CustomDay";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
};

export default function ScheduleCalendar({ selectedDay, items, onSelectDay }: Props) {
    const { colors, mode } = useTheme();

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

    return (
        <Calendar
            key={mode}
            current={selectedDay}
            onDayPress={(day: DateData) => onSelectDay(day.dateString)}
            markedDates={markedDates}
            dayComponent={({ date, state, marking }) => (
                <CustomDay
                    date={date}
                    state={state}
                    marking={marking}
                    isSelectedDay={date?.dateString === selectedDay}
                    onPress={(d) => onSelectDay(d.dateString)}
                />
            )}
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

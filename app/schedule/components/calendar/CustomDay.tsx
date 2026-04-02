import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";

type Period = {
    startingDay: boolean;
    endingDay: boolean;
    color: string;
};

type Dot = {
    color: string;
};

type Marking = {
    periods?: Period[];
    dots?: Dot[];
    selected?: boolean;
    marked?: boolean;
};

type Props = {
    date?: {
        day: number;
        month: number;
        year: number;
        dateString: string;
        timestamp: number;
    };
    state?: "disabled" | "today" | "";
    marking?: Marking;
    isSelectedDay?: boolean;
    onPress?: (date: any) => void;
};

export default function CustomDay({ date, state, marking, isSelectedDay, onPress }: Props) {
    const { colors } = useTheme();

    if (!date) {
        return <View style={{ height: 56 }} />;
    }

    const isDisabled = state === "disabled";
    const isToday = state === "today";
    const isSelected = isSelectedDay ?? marking?.selected;

    const hasPeriods = !!(marking?.periods && marking.periods.length > 0);
    const hasDots = !!(marking?.dots && marking.dots.length > 0);

    return (
        <TouchableOpacity
            onPress={() => !isDisabled && onPress?.(date)}
            disabled={isDisabled}
            style={{
                alignSelf: "stretch",
                height: 56,
                paddingTop: 4,
                alignItems: "center",
            }}
            activeOpacity={0.7}
        >
            {/* 날짜 숫자 */}
            <View
                style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isSelected ? colors.selectedDayBg : "transparent",
                    borderWidth: isToday && !isSelected ? 1.5 : 0,
                    borderColor: colors.todayBorderColor,
                }}
            >
                <Text
                    style={{
                        fontSize: 14,
                        fontWeight: isToday ? "700" : "400",
                        color: isSelected
                            ? colors.selectedDayText
                            : isDisabled
                            ? colors.textDisabled
                            : colors.textPrimary,
                    }}
                >
                    {date.day}
                </Text>
            </View>

            {/* 연속 일정 바 - 날짜 아래 */}
            {hasPeriods && (
                <View style={{ alignSelf: "stretch", marginTop: 3 }}>
                    {marking!.periods!.slice(0, 2).map((period, index) => (
                        <View
                            key={index}
                            style={{
                                height: 3,
                                backgroundColor: period.color,
                                marginBottom: 1,
                                borderTopLeftRadius: period.startingDay ? 2 : 0,
                                borderBottomLeftRadius: period.startingDay ? 2 : 0,
                                borderTopRightRadius: period.endingDay ? 2 : 0,
                                borderBottomRightRadius: period.endingDay ? 2 : 0,
                                marginLeft: period.startingDay ? 3 : 0,
                                marginRight: period.endingDay ? 3 : 0,
                            }}
                        />
                    ))}
                </View>
            )}

            {/* 하루 일정 점 - 하단 고정 */}
            {hasDots && (
                <View
                    style={{
                        position: "absolute",
                        bottom: 4,
                        flexDirection: "row",
                        justifyContent: "center",
                        gap: 3,
                    }}
                >
                    {marking!.dots!.slice(0, 3).map((dot, index) => (
                        <View
                            key={index}
                            style={{
                                width: 4,
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: dot.color,
                            }}
                        />
                    ))}
                </View>
            )}
        </TouchableOpacity>
    );
}

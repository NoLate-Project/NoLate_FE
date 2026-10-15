import React from "react";
import { StyleSheet, Text, View } from "react-native";
import ScheduleIcon, { SCHEDULE_TRAVEL_ICONS } from "../shared/ScheduleIcon";
import { useTheme } from "../../../theme/ThemeContext";
import { STACK_CALENDAR_GEOMETRY } from "./stackCalendarAppearance";

import {
    STACK_EVENT_LANE_COUNT,
    type StackCalendarLayout,
    type StackEventPresentation,
} from "./stackCalendarLayout";

type StackWeekLabelSegment = {
    event: StackEventPresentation;
    lane: number;
    startIndex: number;
    endIndex: number;
    connectsBefore: boolean;
    connectsAfter: boolean;
};

type Props = {
    days: ReadonlyArray<string | null>;
    layout: StackCalendarLayout;
    eventTop: number;
};

/** 한 주 안에서 같은 lane으로 이어지는 날짜 조각을 하나의 제목 영역으로 묶는다. */
export function createStackWeekLabelSegments(
    days: ReadonlyArray<string | null>,
    layout: StackCalendarLayout
): StackWeekLabelSegment[] {
    const segments: StackWeekLabelSegment[] = [];

    for (let lane = 0; lane < STACK_EVENT_LANE_COUNT; lane += 1) {
        let startIndex = 0;
        while (startIndex < days.length) {
            const startDay = days[startIndex];
            const startEvent = startDay
                ? layout.byDate[startDay]?.lanes[lane]
                : null;
            if (!startEvent) {
                startIndex += 1;
                continue;
            }

            let endIndex = startIndex;
            while (endIndex + 1 < days.length) {
                const nextDay = days[endIndex + 1];
                const nextEvent = nextDay
                    ? layout.byDate[nextDay]?.lanes[lane]
                    : null;
                if (nextEvent?.id !== startEvent.id) break;
                endIndex += 1;
            }

            const endDay = days[endIndex];
            const endEvent = endDay
                ? layout.byDate[endDay]?.lanes[lane]
                : null;
            segments.push({
                event: startEvent,
                lane,
                startIndex,
                endIndex,
                connectsBefore: startEvent.connectsBefore,
                connectsAfter: Boolean(endEvent?.connectsAfter),
            });
            startIndex = endIndex + 1;
        }
    }

    return segments;
}

export default function StackWeekEventLabels({ days, layout, eventTop }: Props) {
    const { colors } = useTheme();
    const segments = createStackWeekLabelSegments(days, layout);

    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.layer}
        >
            {segments.map((segment) => {
                const left = `${segment.startIndex * 100 / 7}%` as `${number}%`;
                const right = `${(6 - segment.endIndex) * 100 / 7}%` as `${number}%`;

                return (
                    <View
                        key={`${segment.event.id}-${segment.lane}-${segment.startIndex}`}
                        testID={`stack-week-event-label-${segment.event.id}`}
                        style={[
                            styles.label,
                            {
                                top: eventTop + segment.lane * STACK_CALENDAR_GEOMETRY.laneStride,
                                left,
                                right,
                                marginLeft: segment.connectsBefore ? 0 : 2,
                                marginRight: segment.connectsAfter ? 0 : 2,
                            },
                        ]}
                    >
                        {segment.event.travelMode ? (
                            <ScheduleIcon
                                name={SCHEDULE_TRAVEL_ICONS[segment.event.travelMode]}
                                role="calendarMarker"
                                color={colors.textSecondary}
                                style={styles.icon}
                            />
                        ) : null}
                        <Text
                            testID="stack-week-event-title"
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={[styles.title, { color: colors.textPrimary }]}
                        >
                            {segment.event.title}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    layer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2,
    },
    label: {
        position: "absolute",
        height: STACK_CALENDAR_GEOMETRY.eventHeight,
        minWidth: 0,
        paddingHorizontal: 5,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    icon: {
        width: 10,
        marginRight: 1,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "600",
        letterSpacing: -0.1,
    },
});

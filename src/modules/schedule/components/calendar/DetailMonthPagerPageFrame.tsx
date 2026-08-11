import React from "react";
import type { SharedValue } from "react-native-reanimated";
import Reanimated, {
    useAnimatedProps,
    useAnimatedStyle,
} from "react-native-reanimated";

import {
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
    getDetailMonthPagerVerticalOffset,
} from "./scheduleCalendarModel";
import { createScheduleCalendarStyles } from "./ScheduleCalendar.styles";

/**
 * 상세 월 페이저의 한 페이지를 현재 시각 월 위치에 맞춰 배치한다.
 * 가로·세로 제스처 축에 따라 오프셋을 계산하고 비활성 페이지를 접근성 트리에서 제외한다.
 */
export type DetailMonthPagerPageFrameProps = {
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

/**
 * 상세 월 페이저의 한 페이지를 현재 시각 월 위치에 맞춰 배치한다.
 * 가로·세로 제스처 축에 따라 오프셋을 계산하고 비활성 페이지를 접근성 트리에서 제외한다.
 */
export function DetailMonthPagerPageFrame({
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

const styles = createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
});

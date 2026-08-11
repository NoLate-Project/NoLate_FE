import { createShellStyles } from "./indexStyles/shell";
import { createToolbarStyles } from "./indexStyles/toolbar";
import { createMonthStyles } from "./indexStyles/month";
import { createDayHeaderStyles } from "./indexStyles/dayHeader";
import { createTimelineStyles } from "./indexStyles/timeline";
import { createControlsStyles } from "./indexStyles/controls";

export type ScheduleIndexStylesOptions = {
    CALENDAR_CONTEXT_HEIGHT: number;
    DAY_MINUTES: number;
    DAY_TIMELINE_END_PADDING: number;
    DAY_TIMELINE_GUTTER: number;
    DAY_TIMELINE_HOUR_HEIGHT: number;
    DAY_WEEK_STRIP_HEIGHT: number;
    DAY_WEEK_STRIP_HORIZONTAL_PADDING: number;
    LIQUID_TOOLBAR_ACTIONS_WIDTH: number;
    LIQUID_TOOLBAR_BUTTON_SIZE: number;
    LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT: number;
    LIQUID_TOOLBAR_SEARCH_HEIGHT: number;
    LIQUID_TOOLBAR_SLOT_WIDTH: number;
    LIQUID_YEAR_PILL_WIDTH: number;
    STICKY_CALENDAR_HEADER_HEIGHT: number;
    STICKY_MONTH_HEADER_HEIGHT: number;
    STICKY_WEEKDAY_HEADER_HEIGHT: number;
};

/** 기능 영역별 스타일을 결합해 화면에서 사용하는 단일 registry를 생성합니다. */
export function createScheduleIndexStyles(options: ScheduleIndexStylesOptions) {
    return {
        ...createShellStyles(options),
        ...createToolbarStyles(options),
        ...createMonthStyles(options),
        ...createDayHeaderStyles(options),
        ...createTimelineStyles(options),
        ...createControlsStyles(options),
    };
}

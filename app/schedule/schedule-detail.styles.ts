import { createFallbackStyles } from "./scheduleDetailStyles/fallback";
import { createHeaderStyles } from "./scheduleDetailStyles/header";
import { createSheetBaseStyles } from "./scheduleDetailStyles/sheetBase";
import { createImprovedStyles } from "./scheduleDetailStyles/improved";
import { createStatusStyles } from "./scheduleDetailStyles/status";
import { createRouteStyles } from "./scheduleDetailStyles/route";

export type ScheduleDetailStylesOptions = {
    APP_ACCENT_BLUE: string;
    IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT: number;
    SHEET_HANDLE_HEIGHT: number;
};

/** 기능 영역별 스타일을 결합해 화면에서 사용하는 단일 registry를 생성합니다. */
export function createScheduleDetailStyles(options: ScheduleDetailStylesOptions) {
    return {
        ...createFallbackStyles(options),
        ...createHeaderStyles(options),
        ...createSheetBaseStyles(options),
        ...createImprovedStyles(options),
        ...createStatusStyles(options),
        ...createRouteStyles(options),
    };
}

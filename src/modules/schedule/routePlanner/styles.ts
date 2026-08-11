import { StyleSheet } from "react-native";

import {
    BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT,
    TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
    TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING,
    TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
    TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT,
    TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT,
} from "./bottomSheetLayout";
import { createReferenceStyles } from "./styleGroups/reference";
import { createMapSearchStyles } from "./styleGroups/mapSearch";
import { createSelectionStyles } from "./styleGroups/selection";
import { createBottomPanelStyles } from "./styleGroups/bottomPanel";
import { createRouteSummaryStyles } from "./styleGroups/routeSummary";
import { createTransitDetailStyles } from "./styleGroups/transitDetail";

/** 출발지 pin과 관련 안내 UI가 공유하는 의미 색상입니다. */
export const ORIGIN_COLOR = "#12A150";
/** 도착지 pin과 관련 안내 UI가 공유하는 의미 색상입니다. */
export const DESTINATION_COLOR = "#F04452";

export type RoutePlannerStyleOptions = {
    BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT: number;
    TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT: number;
    TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING: number;
    TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT: number;
    TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT: number;
    TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT: number;
    ORIGIN_COLOR: string;
    DESTINATION_COLOR: string;
};

const options: RoutePlannerStyleOptions = {
    BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT,
    TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
    TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING,
    TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
    TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT,
    TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT,
    ORIGIN_COLOR,
    DESTINATION_COLOR,
};

/** 기능 영역별 스타일을 경로 계획 화면이 사용하는 단일 registry로 결합합니다. */
const styles = StyleSheet.create({
    ...createReferenceStyles(options),
    ...createMapSearchStyles(options),
    ...createSelectionStyles(options),
    ...createBottomPanelStyles(options),
    ...createRouteSummaryStyles(options),
    ...createTransitDetailStyles(options),
});

export default styles;

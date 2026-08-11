import { formatScheduleFormDate } from "../scheduleFormDate";

export const DATE_H = 312;
export const TIME_H = 216;
export const CATEGORY_PICKER_MARGIN = 12;
export const SCHEDULE_EDIT_DARK_PAGE_BACKGROUND = "#101217";
export type PickerType = "startDate" | "endDate" | "startTime" | "endTime";
export type ScheduleEditScreenProps = { initialScrollToEnd?: boolean; initialCategoryPickerOpen?: boolean };

/** 숫자를 일정 시간 표시에 필요한 두 자리 문자열로 채웁니다. */
export const pad2 = (value: number) => String(value).padStart(2, "0");
/** 날짜를 오전·오후가 포함된 12시간제 시각 문구로 변환합니다. */
export const hhmmText = (date: Date) => `${date.getHours() < 12 ? "오전" : "오후"} ${date.getHours() % 12 || 12}:${pad2(date.getMinutes())}`;
/** 날짜를 일정 편집 필드의 연월일·요일 문구로 변환합니다. */
export const editDateText = (date: Date) => {
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    return `${formatScheduleFormDate(date)} (${weekday})`;
};
/** 날짜 부분과 시간 부분을 초·밀리초가 제거된 하나의 로컬 일정 시각으로 합칩니다. */
export function mergeDateTime(datePart: Date, timePart: Date) {
    const date = new Date(datePart);
    date.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
    return date;
}
/** 현재 피커 종류가 날짜 선택인지 판별합니다. */
export const isDateType = (type: PickerType | null): boolean => type === "startDate" || type === "endDate";
/** 피커 종류에 따라 애니메이션 컨테이너의 목표 높이를 반환합니다. */
export const pickerTargetH = (type: PickerType | null): number => type !== null && isDateType(type) ? DATE_H : TIME_H;
/** 알 수 없는 API 오류를 일정 편집 화면의 기본 실패 문구로 변환합니다. */
export const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
/** 개인 이동 계획 저장에 필요한 위도와 경도가 모두 유한한 값인지 확인합니다. */
export const hasCompletePersonalTravelPlanCoordinates = (place: { lat?: number; lng?: number } | undefined) =>
    Number.isFinite(place?.lat) && Number.isFinite(place?.lng);

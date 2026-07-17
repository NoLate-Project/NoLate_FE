export type ScheduleAddCloseAction = "close" | "confirm" | "ignore";

/** 저장 중 여부와 초안 변경 여부에 따라 일정 생성 화면의 닫기 동작을 결정한다. */
export function getScheduleAddCloseAction({
    dirty,
    submitting,
}: {
    dirty: boolean;
    submitting: boolean;
}): ScheduleAddCloseAction {
    if (submitting) return "ignore";
    return dirty ? "confirm" : "close";
}

type ScheduleDetailBackRouter = {
    canGoBack: () => boolean;
    back: () => void;
    replace: (href: "/schedule") => void;
};

/**
 * 공유함·알림함·검색처럼 상세 화면을 연 실제 진입점을 우선 보존한다.
 * 딥링크나 복원된 단독 화면처럼 이전 stack이 없을 때만 일정 목록을 안전한 fallback으로 쓴다.
 */
export function goBackFromScheduleDetail(router: ScheduleDetailBackRouter): void {
    if (router.canGoBack()) {
        router.back();
        return;
    }
    router.replace("/schedule");
}

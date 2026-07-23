export type PostAuthRoute = "/onboarding/calendar-import" | "/schedule";

export function getPostAuthRoute(curationCompleted: boolean | null | undefined): PostAuthRoute {
    // 구버전 앱 저장값처럼 상태가 없는 경우도 미완료로 간주한다. 완료가 명시적으로
    // 확인된 회원만 일정 화면으로 보내야 큐레이션 누락을 막을 수 있다.
    return curationCompleted === true ? "/schedule" : "/onboarding/calendar-import";
}

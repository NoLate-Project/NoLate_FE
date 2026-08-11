/** 로그인 공급자 코드를 계정 카드에 표시할 친숙한 이름으로 변환합니다. */
export function formatLoginType(loginType?: string) {
    switch (loginType) {
        case "NAVER": return "네이버";
        case "KAKAO": return "카카오";
        case "APPLE": return "Apple";
        case "GOOGLE": return "Google";
        case "COMMON": return "이메일";
        default: return "확인 중";
    }
}

/** ISO 시각을 캘린더 연결 카드에서 사용하는 월·일·시·분 문구로 변환합니다. */
export function formatConnectionDate(value?: string) {
    if (!value) return "아직 없음";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "확인 필요";
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}월 ${day}일 ${hour}:${minute}`;
}

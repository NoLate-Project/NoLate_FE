import type { TimetableStatus } from "../../api/intercityTimetable";

export function koreaServiceDate(date: Date): string {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function isServiceDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+09:00`))
        && koreaServiceDate(new Date(`${value}T00:00:00+09:00`)) === value;
}
/** API times carry a Korea offset; use their explicit wall time, independent of device timezone. */
export function serviceTime(value: string): string { return value.slice(11, 16); }
export function timetableStatusMessage(status: TimetableStatus, message?: string | null): string {
    if (message) return message;
    switch (status) {
        case "NO_SERVICES": return "제공된 운행편이 없습니다. 실제 운행 여부는 예매처에서 확인해 주세요.";
        case "DATE_UNSUPPORTED": return "이 날짜의 시간표는 제공되지 않습니다.";
        case "KEY_MISSING":
        case "ACCESS_DENIED": return "시간표 서비스에 연결할 수 없습니다. 잠시 후 다시 확인해 주세요.";
        case "RATE_LIMITED": return "시간표 조회 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.";
        case "PROVIDER_UNAVAILABLE": return "시간표를 불러오지 못했습니다. 다시 시도해 주세요.";
        default: return "";
    }
}

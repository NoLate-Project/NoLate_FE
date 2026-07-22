import { apiGet } from "./api";
import { type ApiEnvelope, unwrapApiResponse } from "./response";
import type {
    CalendarDayMetadata,
    CalendarHoliday,
} from "../modules/schedule/calendarMetadata";

type CalendarHolidayDto = {
    name?: string | null;
    type?: string | null;
};

type CalendarDayDto = {
    date?: string | null;
    lunarYear?: number | null;
    lunarMonth?: number | null;
    lunarDay?: number | null;
    leapMonth?: boolean | null;
    holidays?: CalendarHolidayDto[] | null;
};

// 최초 조회는 백엔드가 KASI 월별 데이터를 채운 뒤 응답할 수 있다. 일정 API의
// 공통 10초 제한과 분리해, 콜드 캐시에서도 정상 응답을 기다릴 여유를 둔다.
export const CALENDAR_METADATA_REQUEST_TIMEOUT_MS = 30_000;

function normalizeOptionalInteger(value: number | null | undefined): number | undefined {
    return Number.isInteger(value) ? value ?? undefined : undefined;
}

function normalizeHoliday(dto: CalendarHolidayDto): CalendarHoliday | null {
    const name = dto.name?.trim();
    if (!name) return null;

    return {
        name,
        type: dto.type?.trim() || "PUBLIC_HOLIDAY",
    };
}

function normalizeCalendarDay(dto: CalendarDayDto): CalendarDayMetadata | null {
    const date = dto.date?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

    return {
        date,
        lunarYear: normalizeOptionalInteger(dto.lunarYear),
        lunarMonth: normalizeOptionalInteger(dto.lunarMonth),
        lunarDay: normalizeOptionalInteger(dto.lunarDay),
        leapMonth: typeof dto.leapMonth === "boolean" ? dto.leapMonth : undefined,
        holidays: (dto.holidays ?? [])
            .map(normalizeHoliday)
            .filter((holiday): holiday is CalendarHoliday => holiday !== null),
    };
}

export async function getCalendarDays(
    startDate: string,
    endDate: string
): Promise<CalendarDayMetadata[]> {
    const response = await apiGet<ApiEnvelope<CalendarDayDto[]>>("/api/calendar/days", {
        params: { startDate, endDate },
        timeout: CALENDAR_METADATA_REQUEST_TIMEOUT_MS,
    });

    return unwrapApiResponse(response)
        .map(normalizeCalendarDay)
        .filter((day): day is CalendarDayMetadata => day !== null);
}

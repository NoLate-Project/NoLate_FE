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
    metadataComplete?: boolean | null;
};

// 서버는 현재 snapshot을 즉시 반환하고 외부 KASI refresh는 비동기로 수행한다.
// 보조 metadata 요청이 네트워크 장애로 주 화면 작업을 오래 점유하지 않게 제한한다.
export const CALENDAR_METADATA_REQUEST_TIMEOUT_MS = 10_000;

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
        metadataComplete: dto.metadataComplete === true,
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

type DateInput = string | number | Date;

const pad2 = (value: number): string => String(value).padStart(2, "0");

export function fromISO(value: DateInput): Date {
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return new Date();
    }
    return parsed;
}

export function toYmd(value: DateInput): string {
    const date = fromISO(value);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatHHmm(value: DateInput): string {
    const date = fromISO(value);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function startOfDay(ymd: string): Date {
    const [year, month, day] = ymd.split("-").map(Number);
    if (![year, month, day].every((value) => Number.isFinite(value))) {
        return new Date();
    }

    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function enumerateDaysBetween(startAt: DateInput, endAt: DateInput): string[] {
    const start = fromISO(startAt);
    const end = fromISO(endAt);

    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    if (endDay.getTime() < startDay.getTime()) {
        return [toYmd(startDay)];
    }

    const days: string[] = [];
    const cursor = new Date(startDay);

    while (cursor.getTime() <= endDay.getTime()) {
        days.push(toYmd(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return days;
}

export function isOverlappingDay(startAt: DateInput, endAt: DateInput, ymd: string): boolean {
    const [year, month, day] = ymd.split("-").map(Number);
    if (![year, month, day].every((value) => Number.isFinite(value))) {
        return false;
    }

    const start = new Date(startAt).getTime();
    if (!Number.isFinite(start)) return false;

    const parsedEnd = new Date(endAt).getTime();
    // 종료 시각을 사용하지 않는 일정은 startAt === endAt으로 저장된다.
    // 특히 자정 일정은 기존 `end > dayStart` 비교에서 사라졌으므로,
    // 유효하지 않거나 0 이하인 구간도 시작 시각의 1ms 이벤트로 취급한다.
    const end = Number.isFinite(parsedEnd) && parsedEnd > start
        ? parsedEnd
        : start + 1;

    const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
    const dayEnd = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

    return start < dayEnd.getTime() && end > dayStart.getTime();
}

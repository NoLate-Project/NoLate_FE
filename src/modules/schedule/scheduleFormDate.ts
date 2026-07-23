const pad2 = (value: number) => String(value).padStart(2, "0");

/** 캘린더 라이브러리가 요구하는 로컬 날짜 키(YYYY-MM-DD)를 만든다. */
export function getScheduleCalendarDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 폼 필드에 표시할 한국어 친화적인 날짜 문자열을 만든다. */
export function formatScheduleFormDate(date: Date): string {
    return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** ISO 시각의 로컬 연월일을 보존한 자정 Date를 만든다. */
export function startOfLocalScheduleDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 새 일정 폼을 여는 시점에서 30분 뒤를 기본 시작 시각으로 만든다. */
export function getDefaultScheduleStartTime(now = new Date()): Date {
    const result = new Date(now);
    result.setSeconds(0, 0);
    result.setMinutes(result.getMinutes() + 30);
    return result;
}

/**
 * 선택일과 현재 시각으로 새 일정 폼의 기본 날짜·시각을 만든다.
 * 오늘 23시대에 30분 뒤가 다음 날이 되면 날짜도 함께 넘기되,
 * 사용자가 오늘이 아닌 날짜를 명시적으로 선택한 경우에는 그 날짜를 보존한다.
 */
export function getDefaultScheduleFormStart(
    defaultDay: string,
    now = new Date()
): { startDay: Date; startTime: Date } {
    const startTime = getDefaultScheduleStartTime(now);
    const parsedDefaultDay = new Date(`${defaultDay}T00:00:00`);
    const safeDefaultDay = Number.isNaN(parsedDefaultDay.getTime())
        ? startOfLocalScheduleDay(now)
        : parsedDefaultDay;
    const startDay = getScheduleCalendarDateKey(safeDefaultDay) === getScheduleCalendarDateKey(now)
        ? startOfLocalScheduleDay(startTime)
        : startOfLocalScheduleDay(safeDefaultDay);

    return { startDay, startTime };
}

type NormalizeScheduleFormRangeInput = {
    startDay: Date;
    startTime: Date;
    endDay: Date;
    endTime: Date;
    allDay: boolean;
    hasEndTime: boolean;
};

type NormalizedScheduleFormRange = {
    startAt: Date;
    endAt: Date;
    hasEndTime: boolean;
    allDay: boolean;
};

function mergeScheduleDateTime(datePart: Date, timePart: Date): Date {
    const result = new Date(datePart);
    result.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
    return result;
}

/**
 * 폼의 날짜 범위를 API의 end-exclusive 규칙에 맞춘다.
 * 종일 일정의 endDay는 사용자가 고른 마지막 날(포함)이며 API 종료값은 그 다음 날 자정이다.
 */
export function normalizeScheduleFormRange(
    input: NormalizeScheduleFormRangeInput
): NormalizedScheduleFormRange {
    if (input.allDay) {
        const startAt = startOfLocalScheduleDay(input.startDay);
        const inclusiveEndDay = startOfLocalScheduleDay(input.endDay);
        const endAt = inclusiveEndDay.getTime() < startAt.getTime()
            ? new Date(startAt)
            : new Date(inclusiveEndDay);
        endAt.setDate(endAt.getDate() + 1);
        return { startAt, endAt, hasEndTime: false, allDay: true };
    }

    const startAt = mergeScheduleDateTime(input.startDay, input.startTime);
    if (!input.hasEndTime) {
        return { startAt, endAt: new Date(startAt), hasEndTime: false, allDay: false };
    }

    let endAt = mergeScheduleDateTime(input.endDay, input.endTime);
    if (endAt.getTime() < startAt.getTime()) {
        endAt = new Date(startAt);
        endAt.setMinutes(endAt.getMinutes() + 30);
    }
    return {
        startAt,
        endAt,
        hasEndTime: endAt.getTime() !== startAt.getTime(),
        allDay: false,
    };
}

/** 저장된 end-exclusive 종일 종료값을 폼의 마지막 날(포함)로 변환한다. */
export function getScheduleAllDayFormEndDay(startAt: Date, endAt: Date): Date {
    const startDay = startOfLocalScheduleDay(startAt);
    const exclusiveEndDay = startOfLocalScheduleDay(endAt);
    if (exclusiveEndDay.getTime() <= startDay.getTime()) return startDay;

    const inclusiveEndDay = new Date(exclusiveEndDay);
    inclusiveEndDay.setDate(inclusiveEndDay.getDate() - 1);
    return inclusiveEndDay.getTime() < startDay.getTime() ? startDay : inclusiveEndDay;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export const toYmd = (date: Date) => {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
};

export const fromISO = (iso: string) => new Date(iso);

export const formatHHmm = (iso: string) => {
    const d = fromISO(iso);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const startOfDay = (ymd: string) => new Date(`${ymd}T00:00:00`);

export const endOfDay = (ymd: string) => new Date(`${ymd}T23:59:59.999`);

export const isOverlappingDay = (itemStartISO: string, itemEndISO: string, ymd: string) => {
    const s = new Date(itemStartISO).getTime();
    const e = new Date(itemEndISO).getTime();
    const ds = startOfDay(ymd).getTime();
    const de = endOfDay(ymd).getTime();
    // 겹치면 true
    return s <= de && e >= ds;
};

// ✅ markedDays 계산용: 이벤트가 포함하는 날짜 집합(간단 버전: 하루 단위)
export const enumerateDaysBetween = (startISO: string, endISO: string) => {
    const res: string[] = [];
    const s = new Date(startISO);
    const e = new Date(endISO);

    const cur = new Date(s);
    cur.setHours(0, 0, 0, 0);

    const end = new Date(e);
    end.setHours(0, 0, 0, 0);

    while (cur.getTime() <= end.getTime()) {
        res.push(toYmd(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return res;
};
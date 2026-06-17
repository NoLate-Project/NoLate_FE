export function getMonthRange(ymd: string) {
    const [year, month] = ymd.split("-").map(Number);
    const now = new Date();
    const safeYear = Number.isFinite(year) ? year : now.getFullYear();
    const safeMonth = Number.isFinite(month) ? month - 1 : now.getMonth();
    const start = new Date(safeYear, safeMonth, 1, 0, 0, 0, 0);
    const end = new Date(safeYear, safeMonth + 1, 1, 0, 0, 0, 0);
    end.setMilliseconds(end.getMilliseconds() - 1);

    return {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
    };
}

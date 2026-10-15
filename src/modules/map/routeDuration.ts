/** 전체 소요시간은 양수이며 출발 시각에 더해도 JavaScript Date 범위 안이어야 한다. */
export function validTotalDurationSeconds(
    value: unknown,
    departureTimeMs = Date.now()
): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
    return Number.isFinite(new Date(departureTimeMs + value * 1000).getTime())
        ? value
        : undefined;
}

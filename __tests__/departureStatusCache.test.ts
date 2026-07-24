import type { ScheduleDepartureStatus } from "../src/api/schedule";
import {
    clearScheduleDepartureStatusCache,
    getCachedScheduleDepartureStatus,
    removeCachedDepartureStatusForAccessFailure,
    setCachedScheduleDepartureStatus,
} from "../src/modules/schedule/departureStatusCache";

const status: ScheduleDepartureStatus = {
    scheduleId: "42",
    travelMinutes: 30,
    recommendedDepartureAt: "2026-07-24T09:30:00+09:00",
    evaluatedAt: null,
    liveFetchedAt: null,
    source: "SAVED_FALLBACK",
    stale: true,
    confidence: "LOW",
    failureReason: null,
    lastTrafficChangeMinutes: null,
    lastChangedAt: null,
    nextCheckAt: null,
    preparationMinutes: null,
    preparationStartAt: null,
    safetyBufferMinutes: null,
    timeZone: "Asia/Seoul",
};

describe("account-scoped departure status cache", () => {
    afterEach(clearScheduleDepartureStatusCache);

    test("A와 B가 같은 공유 일정이고 B fetch가 실패해도 A ETA를 표시하지 않는다", async () => {
        setCachedScheduleDepartureStatus("member:A", status);
        const fetchForB = jest.fn().mockRejectedValue(
            Object.assign(new Error("forbidden"), { status: 403 }),
        );

        expect(getCachedScheduleDepartureStatus("member:A", "42")).toBe(status);
        expect(getCachedScheduleDepartureStatus("member:B", "42")).toBeUndefined();
        await expect(fetchForB()).rejects.toMatchObject({ status: 403 });
        expect(getCachedScheduleDepartureStatus("member:B", "42")).toBeUndefined();
    });

    test("account cleanup 경계에서 모든 사용자 ETA를 폐기한다", () => {
        setCachedScheduleDepartureStatus("member:A", status);
        setCachedScheduleDepartureStatus("member:B", { ...status, travelMinutes: 45 });

        clearScheduleDepartureStatusCache();

        expect(getCachedScheduleDepartureStatus("member:A", "42")).toBeUndefined();
        expect(getCachedScheduleDepartureStatus("member:B", "42")).toBeUndefined();
    });

    test.each(["unavailable", "legacy"] as const)(
        "status %s(403/404) 뒤 offline retry는 이전 ETA를 선표시하지 않는다",
        (failureMode) => {
            setCachedScheduleDepartureStatus("member:A", status);
            expect(removeCachedDepartureStatusForAccessFailure(
                "member:A",
                "42",
                failureMode,
            )).toBe(true);
            expect(getCachedScheduleDepartureStatus("member:A", "42")).toBeUndefined();
        },
    );
});

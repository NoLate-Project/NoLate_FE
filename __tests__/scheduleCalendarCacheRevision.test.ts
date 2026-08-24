type ScheduleApiModule = typeof import("../src/api/schedule");

function loadScheduleApi() {
    jest.resetModules();
    jest.doMock("../src/api/api", () => ({
        apiDelete: jest.fn(),
        apiGet: jest.fn(),
        apiPost: jest.fn(),
        apiPut: jest.fn(),
    }));
    jest.doMock("../src/modules/schedule/calendarScheduleCache", () => {
        let revision: number | null = null;
        return {
            clearCalendarScheduleCache: jest.fn(),
            getActiveCalendarScheduleCacheMemberId: jest.fn(() => 7),
            getCalendarScheduleCacheServerRevision: jest.fn(() => revision),
            removeCalendarScheduleCacheItem: jest.fn(),
            setCalendarScheduleCacheServerRevision: jest.fn((nextRevision: number) => {
                revision = nextRevision;
            }),
            upsertCalendarScheduleCacheItem: jest.fn(),
        };
    });

    const { apiGet } = require("../src/api/api") as { apiGet: jest.Mock };
    const { clearCalendarScheduleCache } = require(
        "../src/modules/schedule/calendarScheduleCache"
    ) as { clearCalendarScheduleCache: jest.Mock };
    const scheduleApi = require("../src/api/schedule") as ScheduleApiModule;

    return {
        apiGet,
        clearCalendarScheduleCache,
        synchronize: scheduleApi.synchronizeCalendarScheduleCacheRevision,
    };
}

describe("calendar schedule cache revision synchronization", () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.dontMock("../src/api/api");
        jest.dontMock("../src/modules/schedule/calendarScheduleCache");
    });

    test("동시에 시작한 revision 확인은 하나의 요청과 결과를 공유한다", async () => {
        const { apiGet, synchronize } = loadScheduleApi();
        let resolveRevision: ((value: unknown) => void) | undefined;
        apiGet.mockReturnValue(new Promise((resolve) => {
            resolveRevision = resolve;
        }));

        const first = synchronize();
        const second = synchronize();

        expect(second).toBe(first);
        expect(apiGet).toHaveBeenCalledTimes(1);

        resolveRevision?.({ success: true, data: { revision: 7 } });
        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(false);
    });

    test("성공 후 60초 동안 재호출을 생략하고 경계가 지나면 원격 변경을 감지한다", async () => {
        let now = Date.parse("2026-08-01T00:00:00Z");
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const { apiGet, clearCalendarScheduleCache, synchronize } = loadScheduleApi();
        apiGet
            .mockResolvedValueOnce({ success: true, data: { revision: 7 } })
            .mockResolvedValueOnce({ success: true, data: { revision: 8 } });

        await expect(synchronize()).resolves.toBe(false);

        now += 59_999;
        await expect(synchronize()).resolves.toBe(false);
        expect(apiGet).toHaveBeenCalledTimes(1);
        expect(clearCalendarScheduleCache).not.toHaveBeenCalled();

        now += 1;
        await expect(synchronize()).resolves.toBe(true);
        expect(apiGet).toHaveBeenCalledTimes(2);
        expect(clearCalendarScheduleCache).toHaveBeenCalledTimes(1);
    });

    test("실패한 확인에는 cooldown을 적용하지 않아 다음 호출에서 복구한다", async () => {
        const { apiGet, synchronize } = loadScheduleApi();
        apiGet
            .mockRejectedValueOnce(new Error("network unavailable"))
            .mockResolvedValueOnce({ success: true, data: { revision: 9 } });

        await expect(synchronize()).rejects.toThrow("network unavailable");
        await expect(synchronize()).resolves.toBe(false);
        expect(apiGet).toHaveBeenCalledTimes(2);
    });
});

import {
    createNotificationActionDedupe,
    executeNotificationActionOnce,
} from "../src/modules/notification/notificationActionDedupe";

describe("notification action dedupe", () => {
    test("A→B→A 재전달도 TTL 안에는 각 key를 한 번만 실행한다", () => {
        const dedupe = createNotificationActionDedupe({ ttlMs: 1_000, maxSize: 10 });

        dedupe.begin("A", 0)?.commit(0);
        dedupe.begin("B", 1)?.commit(1);

        expect(dedupe.begin("A", 2)).toBeUndefined();
        expect(dedupe.begin("B", 2)).toBeUndefined();
        expect(dedupe.begin("A", 1_001)).toBeDefined();
    });

    test("동시 중복은 차단하고 transient failure는 key를 소비하지 않아 재시도된다", async () => {
        const dedupe = createNotificationActionDedupe();
        let rejectFirst!: (error: Error) => void;
        const pending = new Promise((_resolve, reject) => {
            rejectFirst = reject;
        });
        const action = jest.fn()
            .mockImplementationOnce(() => pending)
            .mockResolvedValueOnce(undefined);
        const refresh = jest.fn();

        const first = executeNotificationActionOnce(dedupe, "depart:A", action, refresh);
        await expect(executeNotificationActionOnce(
            dedupe,
            "depart:A",
            action,
            refresh,
        )).resolves.toBe(false);
        rejectFirst(new Error("offline"));
        await expect(first).rejects.toThrow("offline");

        await expect(executeNotificationActionOnce(
            dedupe,
            "depart:A",
            action,
            refresh,
        )).resolves.toBe(true);
        expect(action).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("성공 후에만 mounted cache/status refresh 신호를 보낸다", async () => {
        const dedupe = createNotificationActionDedupe();
        const refresh = jest.fn();

        await expect(executeNotificationActionOnce(
            dedupe,
            "snooze:A",
            jest.fn().mockResolvedValue(undefined),
            refresh,
        )).resolves.toBe(true);
        await expect(executeNotificationActionOnce(
            dedupe,
            "snooze:A",
            jest.fn().mockResolvedValue(undefined),
            refresh,
        )).resolves.toBe(false);

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("용량을 넘기면 가장 오래된 성공 key부터 제거한다", () => {
        const dedupe = createNotificationActionDedupe({ ttlMs: 60_000, maxSize: 2 });
        dedupe.begin("A", 0)?.commit(0);
        dedupe.begin("B", 1)?.commit(1);
        dedupe.begin("C", 2)?.commit(2);

        expect(dedupe.begin("A", 3)).toBeDefined();
        expect(dedupe.begin("B", 3)).toBeUndefined();
        expect(dedupe.begin("C", 3)).toBeUndefined();
    });

    test("auth session cleanup은 이전 계정의 committed/in-flight key를 폐기한다", () => {
        const dedupe = createNotificationActionDedupe();
        dedupe.begin("departNow:logical:event:shared")?.commit();
        const aLease = dedupe.begin("snooze:logical:event:pending");
        expect(aLease).toBeDefined();

        dedupe.clear();

        expect(dedupe.begin("departNow:logical:event:shared")).toBeDefined();
        const bLease = dedupe.begin("snooze:logical:event:pending");
        expect(bLease).toBeDefined();
        aLease?.rollback();
        expect(dedupe.begin("snooze:logical:event:pending")).toBeUndefined();
        bLease?.rollback();
        expect(dedupe.begin("snooze:logical:event:pending")).toBeDefined();
    });
});

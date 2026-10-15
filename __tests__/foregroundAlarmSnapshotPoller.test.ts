import { createForegroundAlarmSnapshotPoller } from "../src/modules/notification/foregroundAlarmSnapshotPoller";

describe("foreground alarm snapshot recovery", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());
    test("only polls an authenticated foreground account and stops on background/logout", async () => {
        const sync = jest.fn().mockResolvedValue(undefined);
        const poller = createForegroundAlarmSnapshotPoller(sync);
        poller.setActive(true);
        await jest.advanceTimersByTimeAsync(15_000);
        expect(sync).not.toHaveBeenCalled();
        poller.setMember(296);
        await jest.advanceTimersByTimeAsync(15_000);
        expect(sync).toHaveBeenCalledWith(296);
        poller.setActive(false);
        await jest.advanceTimersByTimeAsync(120_000);
        expect(sync).toHaveBeenCalledTimes(1);
        poller.setActive(true);
        poller.setMember(undefined);
        await jest.advanceTimersByTimeAsync(15_000);
        expect(sync).toHaveBeenCalledTimes(1);
        poller.dispose();
    });
    test("does not overlap slow requests; retries transient failure without a tight loop", async () => {
        let resolve!: () => void;
        const sync = jest.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }))
            .mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
        const poller = createForegroundAlarmSnapshotPoller(sync);
        poller.setMember(296); poller.setActive(true);
        await jest.advanceTimersByTimeAsync(180_000);
        expect(sync).toHaveBeenCalledTimes(1);
        resolve(); await Promise.resolve();
        await jest.advanceTimersByTimeAsync(30_000);
        expect(sync).toHaveBeenCalledTimes(3);
        poller.dispose();
        await jest.advanceTimersByTimeAsync(120_000);
        expect(sync).toHaveBeenCalledTimes(3);
    });
    test("account replacement and disposal cannot schedule further old-account reads", async () => {
        const sync = jest.fn().mockResolvedValue(undefined);
        const poller = createForegroundAlarmSnapshotPoller(sync);
        poller.setMember(296); poller.setActive(true);
        poller.setMember(297);
        await jest.advanceTimersByTimeAsync(15_000);
        expect(sync).toHaveBeenCalledWith(297);
        expect(sync).not.toHaveBeenCalledWith(296);
        poller.dispose();
        await jest.advanceTimersByTimeAsync(120_000);
        expect(sync).toHaveBeenCalledTimes(1);
    });
    test("observes an advanced departure before the old one-minute polling deadline", async () => {
        let serverGeneration = 0;
        const observed: number[] = [];
        const poller = createForegroundAlarmSnapshotPoller(async () => { observed.push(serverGeneration); });
        poller.setMember(296); poller.setActive(true);
        await jest.advanceTimersByTimeAsync(16_000);
        expect(observed).toEqual([0]);
        // Real failure: accepted ETA has only 44 seconds of remaining lead.
        // The normal foreground path must see it without a diagnostic replay.
        serverGeneration = 1;
        await jest.advanceTimersByTimeAsync(15_000);
        expect(observed).toEqual([0, 1]);
        poller.dispose();
    });
});

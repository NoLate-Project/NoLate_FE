import {
    ScheduleSessionRequestFence,
} from "../src/modules/schedule/sessionRequestFence";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe("ScheduleSessionRequestFence", () => {
    test("session rejection aborts schedule and search work and blocks stale commits", () => {
        const fence = new ScheduleSessionRequestFence();
        const schedule = fence.begin("schedule");
        const search = fence.begin("search");

        expect(schedule).not.toBeNull();
        expect(search).not.toBeNull();
        expect(fence.isCurrent(schedule!)).toBe(true);
        expect(fence.isCurrent(search!)).toBe(true);

        fence.rejectSession();

        expect(schedule!.signal.aborted).toBe(true);
        expect(search!.signal.aborted).toBe(true);
        expect(fence.isCurrent(schedule!)).toBe(false);
        expect(fence.isCurrent(search!)).toBe(false);
        expect(fence.begin("schedule")).toBeNull();
        expect(fence.begin("search")).toBeNull();
    });

    test("only a verified session reopens loads and old-session results stay fenced", () => {
        const fence = new ScheduleSessionRequestFence();
        const oldSchedule = fence.begin("schedule")!;
        fence.rejectSession();

        expect(fence.acceptVerifiedSession()).toBe(true);
        const nextSchedule = fence.begin("schedule");

        expect(nextSchedule).not.toBeNull();
        expect(fence.isCurrent(nextSchedule!)).toBe(true);
        expect(fence.isCurrent(oldSchedule)).toBe(false);
        expect(fence.acceptVerifiedSession()).toBe(false);
    });

    test("a newer request aborts and supersedes the older request in its channel", () => {
        const fence = new ScheduleSessionRequestFence();
        const older = fence.begin("search")!;
        const newer = fence.begin("search")!;

        expect(older.signal.aborted).toBe(true);
        expect(fence.isCurrent(older)).toBe(false);
        expect(fence.isCurrent(newer)).toBe(true);

        fence.finish(newer);
        expect(fence.isCurrent(newer)).toBe(false);
    });

    test.each([
        "detail access denial",
        "authoritative full-list omission",
    ])("%s aborts pending search/load and an old search result cannot recommit", async () => {
        const fence = new ScheduleSessionRequestFence();
        const pendingSearch = deferred<string[]>();
        const search = fence.begin("search")!;
        const schedule = fence.begin("schedule")!;
        let searchResults = ["private-title"];
        const searchCommit = pendingSearch.promise.then((items) => {
            if (fence.isCurrent(search)) searchResults = items;
        });

        fence.invalidateItemPurge();
        searchResults = [];
        pendingSearch.resolve(["private-title"]);
        await searchCommit;

        expect(search.signal.aborted).toBe(true);
        expect(schedule.signal.aborted).toBe(true);
        expect(fence.isCurrent(search)).toBe(false);
        expect(fence.isCurrent(schedule)).toBe(false);
        expect(searchResults).toEqual([]);
    });
});

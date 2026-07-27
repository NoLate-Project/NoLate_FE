import {
    collectScheduleIdsMissingFromFullList,
    filterScheduleItemsBySecurityFence,
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

    test("full-list reconciliation includes IDs that exist only in current search results", () => {
        const missing = collectScheduleIdsMissingFromFullList(
            new Set(["verified"]),
            [],
            [],
            ["verified", "search-only-private"]
        );

        expect([...missing]).toEqual(["search-only-private"]);
    });

    test("new search responses obey redaction and deletion fences until a verified regrant", () => {
        const staleSearchItems = [
            { id: "visible" },
            { id: "access-redacted" },
            { id: "explicit-deleted" },
        ];
        const removed = new Set(["explicit-deleted"]);
        const redacted = new Set(["access-redacted"]);
        const currentFullList = new Set([
            "visible",
            "access-redacted",
            "explicit-deleted",
        ]);

        expect(filterScheduleItemsBySecurityFence(
            [...staleSearchItems, { id: "search-only-omitted" }],
            removed,
            redacted,
            currentFullList
        )).toEqual([{ id: "visible" }]);

        // A current full-list + detail verification can release only the
        // access fence. Explicit user deletion remains durable against lag.
        redacted.delete("access-redacted");
        expect(filterScheduleItemsBySecurityFence(
            staleSearchItems,
            removed,
            redacted,
            currentFullList
        )).toEqual([
            { id: "visible" },
            { id: "access-redacted" },
        ]);
    });

    test("item purge settles both loading channels while fencing their late responses", () => {
        const fence = new ScheduleSessionRequestFence();
        const search = fence.begin("search")!;
        const schedule = fence.begin("schedule")!;
        let searchLoading = true;
        let calendarLoading = true;
        let searchError: string | null = "old search error";
        let calendarError: string | null = "old calendar error";

        const settled = fence.invalidateItemPurge();
        searchLoading = settled.searchLoading;
        calendarLoading = settled.scheduleLoading;
        searchError = settled.searchError;
        calendarError = settled.scheduleError;

        expect(search.signal.aborted).toBe(true);
        expect(schedule.signal.aborted).toBe(true);
        expect({
            searchLoading,
            calendarLoading,
            searchError,
            calendarError,
        }).toEqual({
            searchLoading: false,
            calendarLoading: false,
            searchError: null,
            calendarError: null,
        });
    });
});

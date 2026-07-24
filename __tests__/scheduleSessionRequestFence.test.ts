import {
    ScheduleSessionRequestFence,
} from "../src/modules/schedule/sessionRequestFence";

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
});

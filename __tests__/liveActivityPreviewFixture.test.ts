import {
    buildLiveActivityPreviewIdentity,
} from "../src/modules/notification/liveActivityPreviewFixture";

describe("Live Activity development preview identity", () => {
    test("keeps immutable generation attributes fixed across content updates", () => {
        const started = buildLiveActivityPreviewIdentity(1);
        const updated = buildLiveActivityPreviewIdentity(2);

        expect(updated.revision).toBeGreaterThan(started.revision);
        expect(updated.generation).toBe(started.generation);
        expect(updated.actionEventKey).toBe(started.actionEventKey);
    });
});

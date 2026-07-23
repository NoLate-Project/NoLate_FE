import { createLatestAsyncRequestGuard } from "../src/modules/share/latestAsyncRequest";

describe("latest async request guard", () => {
    test("새 요청이 시작되면 먼저 시작한 응답을 무효화한다", () => {
        const guard = createLatestAsyncRequestGuard("inbox");
        const first = guard.begin();
        const second = guard.begin();

        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
    });

    test("화면 대상이 바뀌면 이전 대상의 응답을 무효화한다", () => {
        const guard = createLatestAsyncRequestGuard<string | null>("first-token");
        const first = guard.begin();

        guard.setKey("second-token");
        const second = guard.begin();

        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
        guard.invalidate();
        expect(guard.isCurrent(second)).toBe(false);
    });
});

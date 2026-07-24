import {
    processForegroundPushForSession,
    type ForegroundPushMessage,
} from "../src/modules/notification/foregroundPushSession";

const LOGICAL_EVENT_KEY = `key:${"a".repeat(64)}`;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function createHarness(options: {
    message?: ForegroundPushMessage;
    memberId?: number;
    getCurrentMemberId?: () => Promise<number | undefined>;
}) {
    let authEpoch = 4;
    const emitReceived = jest.fn();
    const refreshCaches = jest.fn();
    const present = jest.fn(async () => undefined);
    const message = options.message ?? {
        messageId: "provider-transport-id",
        notification: {
            title: "A의 비공개 일정",
            body: "강남역에서 8시 출발",
        },
        data: {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
            recipientMemberId: String(options.memberId ?? 2),
            logicalEventKey: LOGICAL_EVENT_KEY,
        },
    };

    return {
        emitReceived,
        refreshCaches,
        present,
        advanceEpoch: () => {
            authEpoch += 1;
        },
        run: () => processForegroundPushForSession({
            message,
            getAuthEpoch: () => authEpoch,
            isAuthEpochCurrent: (candidate) => candidate === authEpoch,
            getCurrentMemberId:
                options.getCurrentMemberId ??
                (async () => options.memberId ?? 2),
            emitReceived,
            refreshCaches,
            present,
        }),
    };
}

function expectNoForegroundSideEffects(
    harness: ReturnType<typeof createHarness>,
): void {
    expect(harness.present).not.toHaveBeenCalled();
    expect(harness.refreshCaches).not.toHaveBeenCalled();
    expect(harness.emitReceived).not.toHaveBeenCalled();
}

describe("foreground push account session binding", () => {
    test("member 조회 중 A에서 B로 바뀐 push는 제목 표시와 cache 갱신을 모두 폐기한다", async () => {
        const currentMember = deferred<number | undefined>();
        const harness = createHarness({
            memberId: 1,
            getCurrentMemberId: () => currentMember.promise,
        });

        const pending = harness.run();
        harness.advanceEpoch();
        currentMember.resolve(2);

        await expect(pending).resolves.toBe(false);
        expectNoForegroundSideEffects(harness);
    });

    test("현재 member와 recipient가 다르면 private payload를 표시하지 않는다", async () => {
        const harness = createHarness({
            memberId: 2,
            message: {
                notification: {
                    title: "A의 병원 일정",
                    body: "주소와 출발 시각",
                },
                data: {
                    recipientMemberId: "1",
                    logicalEventKey: LOGICAL_EVENT_KEY,
                },
            },
        });

        await expect(harness.run()).resolves.toBe(false);
        expectNoForegroundSideEffects(harness);
    });

    test.each([
        {
            name: "logicalEventKey 누락",
            data: { recipientMemberId: "2" },
        },
        {
            name: "recipientMemberId 누락",
            data: { logicalEventKey: LOGICAL_EVENT_KEY },
        },
    ])("$name payload는 fail-closed 처리한다", async ({ data }) => {
        const harness = createHarness({
            memberId: 2,
            message: {
                notification: {
                    title: "노출되면 안 되는 제목",
                    body: "노출되면 안 되는 본문",
                },
                data,
            },
        });

        await expect(harness.run()).resolves.toBe(false);
        expectNoForegroundSideEffects(harness);
    });

    test("유효한 B payload만 원문 title/body를 한 번 표시하고 cache를 갱신한다", async () => {
        const harness = createHarness({ memberId: 2 });

        await expect(harness.run()).resolves.toBe(true);

        expect(harness.emitReceived).toHaveBeenCalledTimes(1);
        expect(harness.refreshCaches).toHaveBeenCalledTimes(1);
        expect(harness.refreshCaches).toHaveBeenCalledWith(expect.objectContaining({
            recipientMemberId: "2",
            logicalEventKey: LOGICAL_EVENT_KEY,
        }));
        expect(harness.present).toHaveBeenCalledTimes(1);
        expect(harness.present).toHaveBeenCalledWith(expect.objectContaining({
            title: "A의 비공개 일정",
            body: "강남역에서 8시 출발",
            data: expect.objectContaining({
                recipientMemberId: "2",
                logicalEventKey: LOGICAL_EVENT_KEY,
            }),
        }), expect.any(Number));
    });
});

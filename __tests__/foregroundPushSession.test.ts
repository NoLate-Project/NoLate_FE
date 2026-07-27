import {
    processForegroundPushForSession,
    type ForegroundPushMessage,
} from "../src/modules/notification/foregroundPushSession";
import * as env from "../src/api/env";

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
    let sessionActive = true;
    const emitReceived = jest.fn();
    const refreshCaches = jest.fn();
    const present = jest.fn(async () => undefined);
    const getCurrentMemberId =
        options.getCurrentMemberId ??
        jest.fn(async () => options.memberId ?? 2);
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
        getCurrentMemberId,
        advanceEpoch: () => {
            authEpoch += 1;
        },
        beginLogout: () => {
            authEpoch += 1;
            sessionActive = false;
        },
        login: (memberId: number) => {
            authEpoch += 1;
            sessionActive = true;
            options.memberId = memberId;
        },
        run: () => processForegroundPushForSession({
            message,
            getAuthEpoch: () => authEpoch,
            isAuthSessionActive: (candidate) =>
                sessionActive && candidate === authEpoch,
            getCurrentMemberId,
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
    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        "SCHEDULE_SHARE_RECEIVED",
        "CATEGORY_SHARE_RECEIVED",
        "CALENDAR_SHARE_RECEIVED",
        "SCHEDULE_PARTICIPANT_DEPARTED",
        "SCHEDULE_DEPARTURE_NUDGE",
        "SCHEDULE_CACHE_INVALIDATED",
    ])("공유 off에서 %s는 계정 조회 전 표시/cache/event를 모두 거부한다", async (type) => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        const harness = createHarness({
            memberId: 2,
            message: {
                notification: {
                    title: "공유된 비공개 일정",
                    body: "노출되면 안 되는 출발 정보",
                },
                data: {
                    type,
                    scheduleId: "42",
                    recipientMemberId: "2",
                    logicalEventKey: LOGICAL_EVENT_KEY,
                },
            },
        });

        await expect(harness.run()).resolves.toBe(false);
        expect(harness.getCurrentMemberId).not.toHaveBeenCalled();
        expectNoForegroundSideEffects(harness);
    });

    test("공유 off에서 unknown cross-user type도 fail-closed로 표시하지 않는다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        const harness = createHarness({
            memberId: 2,
            message: {
                notification: {
                    title: "신규 공유 타입의 비공개 제목",
                    body: "노출되면 안 되는 본문",
                },
                data: {
                    type: "SCHEDULE_SHARE_RECEIVED_V2",
                    scheduleId: "42",
                    ownerMemberId: "1",
                    recipientMemberId: "2",
                    logicalEventKey: LOGICAL_EVENT_KEY,
                },
            },
        });

        await expect(harness.run()).resolves.toBe(false);
        expect(harness.getCurrentMemberId).not.toHaveBeenCalled();
        expectNoForegroundSideEffects(harness);
    });

    test("공유 off에서도 owner proof가 있는 일반 traffic 알림은 정상 처리한다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        const harness = createHarness({
            memberId: 2,
            message: {
                notification: {
                    title: "내 일정 교통 변화",
                    body: "예상 시간이 5분 늘었어요.",
                },
                data: {
                    type: "SCHEDULE_TRAFFIC",
                    scheduleId: "42",
                    ownerMemberId: "2",
                    recipientMemberId: "2",
                    logicalEventKey: LOGICAL_EVENT_KEY,
                },
            },
        });

        await expect(harness.run()).resolves.toBe(true);
        expect(harness.getCurrentMemberId).toHaveBeenCalledTimes(1);
        expect(harness.present).toHaveBeenCalledTimes(1);
        expect(harness.refreshCaches).toHaveBeenCalledTimes(1);
        expect(harness.emitReceived).toHaveBeenCalledTimes(1);
    });

    test("공유 off의 owner proof 없는 old traffic은 표시/cache/event를 만들지 않는다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        const harness = createHarness({
            memberId: 2,
            message: {
                notification: {
                    title: "소유권을 증명하지 못한 일정",
                    body: "old payload",
                },
                data: {
                    type: "SCHEDULE_TRAFFIC",
                    scheduleId: "42",
                    recipientMemberId: "2",
                    logicalEventKey: LOGICAL_EVENT_KEY,
                },
            },
        });

        await expect(harness.run()).resolves.toBe(false);
        expectNoForegroundSideEffects(harness);
    });

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

    test("logout intent 직후 새 A foreground push도 title/cache/event를 모두 차단한다", async () => {
        const harness = createHarness({ memberId: 1 });
        harness.beginLogout();

        await expect(harness.run()).resolves.toBe(false);
        expectNoForegroundSideEffects(harness);
    });

    test("logout 중 지연된 A member lookup은 이후 B login 뒤에도 B tray/cache를 건드리지 않는다", async () => {
        const currentMember = deferred<number | undefined>();
        const harness = createHarness({
            memberId: 1,
            getCurrentMemberId: () => currentMember.promise,
        });

        const lateA = harness.run();
        harness.beginLogout();
        harness.login(2);
        currentMember.resolve(1);

        await expect(lateA).resolves.toBe(false);
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

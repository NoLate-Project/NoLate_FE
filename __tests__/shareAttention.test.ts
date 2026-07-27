import type { ShareInbox } from "../src/api/scheduleSharing";
import {
    buildShareAttentionSummary,
    getShareAttentionKeys,
    markShareInboxSeen,
    readSeenShareAttentionKeys,
    startScheduleShareAttentionPolling,
} from "../src/modules/share/shareAttention";
import * as env from "../src/api/env";

jest.mock("expo-secure-store", () => {
    const values = new Map<string, string>();

    return {
        getItemAsync: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
        setItemAsync: jest.fn((key: string, value: string) => {
            values.set(key, value);
            return Promise.resolve();
        }),
        deleteItemAsync: jest.fn((key: string) => {
            values.delete(key);
            return Promise.resolve();
        }),
        __clear: () => values.clear(),
        __get: (key: string) => values.get(key),
    };
});

const secureStoreMock = jest.requireMock("expo-secure-store") as {
    __clear: () => void;
    setItemAsync: jest.Mock;
    deleteItemAsync: jest.Mock;
};

const inbox: ShareInbox = {
    pendingInvitations: [
        {
            id: "inv-1",
            resourceType: "CATEGORY",
            resourceId: "12",
            title: "업무",
            color: "#34C759",
            ownerMemberId: 1,
            ownerEmail: "owner@nolate.test",
            permission: "VIEWER",
            expiresAt: "2026-07-13T00:00:00Z",
        },
    ],
    receivedShares: [
        {
            shareId: "share-1",
            resourceType: "SCHEDULE",
            resourceId: "10",
            title: "오전 팀 싱크",
            color: "#2F80FF",
            ownerMemberId: 1,
            ownerEmail: "owner@nolate.test",
            permission: "COMMENTER",
            sharedAt: "2026-07-11T00:30:00Z",
        },
        {
            shareId: "share-2",
            resourceType: "SCHEDULE",
            resourceId: "11",
            title: "점심 미팅",
            color: "#FF9F0A",
            ownerMemberId: 2,
            ownerEmail: "team@nolate.test",
            permission: "VIEWER",
            sharedAt: "2026-07-10T03:00:00Z",
        },
    ],
};

describe("share attention summary", () => {
    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
        secureStoreMock.__clear();
        secureStoreMock.setItemAsync.mockClear();
        secureStoreMock.deleteItemAsync.mockClear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("공유 off bootstrap/read는 durable attention을 삭제하고 새 seen 값을 쓰지 않는다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        await secureStoreMock.setItemAsync(
            "nolate.shareAttention.seenKeys.v1",
            JSON.stringify(["share:old"]),
        );
        secureStoreMock.setItemAsync.mockClear();

        await expect(readSeenShareAttentionKeys()).resolves.toEqual([]);
        await markShareInboxSeen(inbox);

        expect(secureStoreMock.deleteItemAsync).toHaveBeenCalled();
        expect(secureStoreMock.setItemAsync).not.toHaveBeenCalled();
        expect(buildShareAttentionSummary(inbox).totalCount).toBe(0);
    });

    test("공유 초대와 받은 공유를 앱 배지용 미확인 개수로 계산한다", () => {
        const summary = buildShareAttentionSummary(inbox, ["share:share-2"]);

        expect(summary.pendingInvitationCount).toBe(1);
        expect(summary.receivedShareCount).toBe(2);
        expect(summary.totalCount).toBe(3);
        expect(summary.unseenCount).toBe(2);
        expect(summary.latest?.key).toBe("share:share-1");
        expect(summary.latestUnseen?.key).toBe("share:share-1");
    });

    test("공유함에서 본 항목 키를 저장해 다음 조회부터 확인된 항목으로 다룬다", async () => {
        await markShareInboxSeen(inbox);

        const seenKeys = await readSeenShareAttentionKeys();

        expect(seenKeys).toEqual(getShareAttentionKeys(inbox));
        expect(buildShareAttentionSummary(inbox, seenKeys).unseenCount).toBe(0);
    });

    test("전역 off에서는 최초 조회와 polling timer를 모두 만들지 않는다", () => {
        const load = jest.fn();
        const onSummary = jest.fn();
        const setIntervalFn = jest.fn();
        const clearIntervalFn = jest.fn();

        const cleanup = startScheduleShareAttentionPolling({
            enabled: false,
            intervalMs: 45_000,
            load,
            onSummary,
            setIntervalFn: setIntervalFn as unknown as typeof setInterval,
            clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
        });
        cleanup();

        expect(load).not.toHaveBeenCalled();
        expect(onSummary).not.toHaveBeenCalled();
        expect(setIntervalFn).not.toHaveBeenCalled();
        expect(clearIntervalFn).not.toHaveBeenCalled();
    });

    test("명시적 on에서는 즉시 조회하고 timer cleanup까지 기존 동작을 유지한다", async () => {
        const summary = buildShareAttentionSummary(inbox);
        const load = jest.fn().mockResolvedValue(summary);
        const onSummary = jest.fn();
        let intervalCallback: (() => void) | undefined;
        const timer = { id: "share-attention" };
        const setIntervalFn = jest.fn((callback: () => void) => {
            intervalCallback = callback;
            return timer;
        });
        const clearIntervalFn = jest.fn();

        const cleanup = startScheduleShareAttentionPolling({
            enabled: true,
            intervalMs: 45_000,
            load,
            onSummary,
            setIntervalFn: setIntervalFn as unknown as typeof setInterval,
            clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
        });
        await Promise.resolve();

        expect(load).toHaveBeenCalledTimes(1);
        expect(onSummary).toHaveBeenCalledWith(summary);

        intervalCallback?.();
        await Promise.resolve();
        expect(load).toHaveBeenCalledTimes(2);

        cleanup();
        expect(clearIntervalFn).toHaveBeenCalledWith(timer);
    });
});

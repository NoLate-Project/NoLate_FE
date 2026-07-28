import type { ShareInbox } from "../src/api/scheduleSharing";
import {
    buildShareAttentionSummary,
    getShareAttentionKeys,
    markShareInboxSeen,
    readSeenShareAttentionKeys,
} from "../src/modules/share/shareAttention";

jest.mock("expo-secure-store", () => {
    const values = new Map<string, string>();

    return {
        getItemAsync: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
        setItemAsync: jest.fn((key: string, value: string) => {
            values.set(key, value);
            return Promise.resolve();
        }),
        __clear: () => values.clear(),
        __get: (key: string) => values.get(key),
    };
});

const secureStoreMock = jest.requireMock("expo-secure-store") as {
    __clear: () => void;
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
        secureStoreMock.__clear();
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
});

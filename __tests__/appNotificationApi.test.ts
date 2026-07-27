import { apiGet, apiPatch } from "../src/api/api";
import {
    getAppNotificationInbox,
    getAppNotificationUnreadCount,
    markAllAppNotificationsRead,
    markAppNotificationRead,
} from "../src/api/notification";
import * as env from "../src/api/env";

jest.mock("../src/api/api", () => ({
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
}));

const mockedApiGet = jest.mocked(apiGet);
const mockedApiPatch = jest.mocked(apiPatch);

describe("app notification api", () => {
    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test("공유 off inbox/count는 기존 공유 title을 제거하고 owner 알림만 센다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        const shared = {
            id: 1,
            type: "SCHEDULE_SHARE_RECEIVED",
            scheduleId: 55,
            categoryId: null,
            title: "받은 비공개 일정",
            body: "받은 일정 위치",
            data: { type: "SCHEDULE_SHARE_RECEIVED", scheduleId: "55" },
            read: false,
            readAt: null,
            createdAt: "2026-07-22T01:00:00Z",
        };
        const ownerTraffic = {
            ...shared,
            id: 2,
            type: "SCHEDULE_TRAFFIC",
            title: "내 일정 교통 변화",
            data: {
                type: "SCHEDULE_TRAFFIC",
                scheduleId: "7",
                ownerMemberId: "7",
                recipientMemberId: "7",
            },
        };
        mockedApiGet
            .mockResolvedValueOnce({
                success: true,
                data: {
                    items: [shared, ownerTraffic],
                    nextCursor: null,
                    unreadCount: 2,
                },
            })
            .mockResolvedValueOnce({
                success: true,
                data: {
                    items: Array.from({ length: 30 }, (_, index) => ({
                        ...shared,
                        id: 100 + index,
                    })),
                    nextCursor: 30,
                    unreadCount: 31,
                },
            })
            .mockResolvedValueOnce({
                success: true,
                data: {
                    items: [ownerTraffic],
                    nextCursor: null,
                    unreadCount: 31,
                },
            });

        await expect(getAppNotificationInbox()).resolves.toEqual({
            items: [ownerTraffic],
            nextCursor: null,
            unreadCount: 1,
        });
        await expect(getAppNotificationUnreadCount()).resolves.toBe(1);

        expect(mockedApiGet).toHaveBeenNthCalledWith(
            2,
            "/api/notifications/inbox",
            { params: { limit: 100, unreadOnly: true } },
        );
        expect(mockedApiGet).toHaveBeenNthCalledWith(
            3,
            "/api/notifications/inbox",
            {
                params: {
                    cursorId: 30,
                    limit: 100,
                    unreadOnly: true,
                },
            },
        );
    });

    test("loads a cursor page with an unread filter", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: {
                items: [],
                nextCursor: 18,
                unreadCount: 4,
            },
        });

        await expect(getAppNotificationInbox({
            cursorId: 30,
            limit: 20,
            unreadOnly: true,
        })).resolves.toEqual({
            items: [],
            nextCursor: 18,
            unreadCount: 4,
        });

        expect(mockedApiGet).toHaveBeenCalledWith("/api/notifications/inbox", {
            params: {
                cursorId: 30,
                limit: 20,
                unreadOnly: true,
            },
        });
    });

    test("uses stable defaults for the first inbox page", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: { items: [], nextCursor: null, unreadCount: 0 },
        });

        await getAppNotificationInbox();

        expect(mockedApiGet).toHaveBeenCalledWith("/api/notifications/inbox", {
            params: { limit: 30, unreadOnly: false },
        });
    });

    test("reads count and marks one or every notification", async () => {
        const notification = {
            id: 12,
            type: "SCHEDULE_SHARE_RECEIVED",
            scheduleId: 55,
            categoryId: null,
            title: "새 일정 공유",
            body: "일정이 공유됐어요.",
            data: { type: "SCHEDULE_SHARE_RECEIVED", scheduleId: "55" },
            read: true,
            readAt: "2026-07-22T02:00:00Z",
            createdAt: "2026-07-22T01:00:00Z",
        };
        mockedApiGet.mockResolvedValue({ success: true, data: { unreadCount: 3 } });
        mockedApiPatch
            .mockResolvedValueOnce({ success: true, data: notification })
            .mockResolvedValueOnce({ success: true, data: { updatedCount: 2 } });

        await expect(getAppNotificationUnreadCount()).resolves.toBe(3);
        await expect(markAppNotificationRead(12)).resolves.toEqual(notification);
        await expect(markAllAppNotificationsRead()).resolves.toBe(2);

        expect(mockedApiGet).toHaveBeenCalledWith("/api/notifications/unread-count");
        expect(mockedApiPatch).toHaveBeenNthCalledWith(1, "/api/notifications/12/read");
        expect(mockedApiPatch).toHaveBeenNthCalledWith(2, "/api/notifications/read-all");
    });

    test("rejects an unsuccessful envelope", async () => {
        mockedApiGet.mockResolvedValue({
            success: false,
            errorCode: "N001",
            errorMessage: "알림을 찾을 수 없습니다.",
        });

        await expect(getAppNotificationUnreadCount()).rejects.toThrow("알림을 찾을 수 없습니다.");
    });
});

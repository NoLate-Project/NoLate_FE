import { apiGet, apiPatch } from "../src/api/api";
import {
    getAppNotificationInbox,
    getAppNotificationUnreadCount,
    markAllAppNotificationsRead,
    markAppNotificationRead,
} from "../src/api/notification";

jest.mock("../src/api/api", () => ({
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
}));

const mockedApiGet = jest.mocked(apiGet);
const mockedApiPatch = jest.mocked(apiPatch);

describe("app notification api", () => {
    afterEach(() => {
        jest.clearAllMocks();
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

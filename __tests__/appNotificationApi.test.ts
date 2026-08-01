import { apiGet, apiPatch, apiPost } from "../src/api/api";
import {
    getAppNotificationInbox,
    getAppNotificationUnreadCount,
    getDepartureAlarmSnapshotCommands,
    markAllAppNotificationsRead,
    markAppNotificationRead,
    postDepartureAlarmFiredEvent,
    postDepartureAlarmScheduleReceipt,
    registerPushToken,
} from "../src/api/notification";

jest.mock("../src/api/api", () => ({
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
}));

const mockedApiGet = jest.mocked(apiGet);
const mockedApiPatch = jest.mocked(apiPatch);
const mockedApiPost = jest.mocked(apiPost);

describe("app notification api", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("registers an installation with an explicit delivery ACK capability", async () => {
        mockedApiPost.mockResolvedValue({ success: true, data: null });
        const payload = {
            memberId: 7,
            deviceId: "ios-installation-7",
            platform: "IOS" as const,
            token: "fcm-token",
            deliveryAckCapabilityVersion: 1 as const,
        };

        await registerPushToken(payload);

        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/notifications/token",
            payload,
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

    test("loads the departure alarm desired-state command list", async () => {
        const commands = [{ type: "DEPARTURE_ALARM_SYNC" }];
        mockedApiGet.mockResolvedValue({
            success: true,
            data: { commands },
        });

        await expect(getDepartureAlarmSnapshotCommands()).resolves.toBe(commands);
        expect(mockedApiGet).toHaveBeenCalledWith(
            "/api/notifications/departure-alarms/snapshot",
        );
    });

    test("rejects a malformed departure alarm snapshot without clearing state", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: { commands: null },
        });

        await expect(getDepartureAlarmSnapshotCommands()).rejects.toThrow(
            "Departure alarm snapshot commands must be an array.",
        );
    });

    test("posts snapshot-origin native fire evidence to the dedicated endpoint", async () => {
        mockedApiPost.mockResolvedValue({ success: true, data: null });
        const payload = {
            eventId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
            alarmId: "schedule:41:member:7",
            scheduleId: 41,
            generation: 3,
            recipientMemberId: 7,
            scheduledFor: "2026-08-01T01:00:00.000Z",
            sourceTriggerAt: "2026-08-01T00:55:00.000Z",
            occurredAt: "2026-08-01T01:00:02.000Z",
            timingBasis: "OBSERVED_ALERTING" as const,
            deviceId: "device-stable-7",
        };

        await postDepartureAlarmFiredEvent(payload);

        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/notifications/departure-alarm-fired-events",
            payload,
        );
    });

    test("posts native alarm schedule receipts to the denominator endpoint", async () => {
        mockedApiPost.mockResolvedValue({ success: true, data: null });
        const payload = {
            receiptId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
            alarmId: "schedule:41:member:7",
            scheduleId: 41,
            generation: 3,
            recipientMemberId: 7,
            operation: "UPSERT" as const,
            triggerAt: "2026-08-01T02:00:00.000Z",
            outcome: "SCHEDULED" as const,
            applied: true,
            scheduled: true,
            platform: "IOS" as const,
            deliveryMode: "IOS_ALARM_KIT" as const,
            source: "PUSH" as const,
            occurredAt: "2026-08-01T01:00:00.000Z",
            deviceId: "device-stable-7",
        };

        await postDepartureAlarmScheduleReceipt(payload);

        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/notifications/departure-alarm-schedule-receipts",
            payload,
        );
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

import { apiPost } from "../src/api/api";
import {
    postNotificationDeliveryAck,
    type NotificationDeliveryAckPayload,
} from "../src/api/notification";

jest.mock("../src/api/api", () => ({
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
}));

const mockedApiPost = jest.mocked(apiPost);

describe("notification delivery ACK API", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("posts the stable event and installation identity contract", async () => {
        const payload: NotificationDeliveryAckPayload = {
            logicalEventKey: "event:3b91c0ea-68dc-4f13-87d7-b5d0a4ac40df",
            deviceId: "ios-installation-7",
            stage: "ALARM_SCHEDULED",
            occurredAt: "2026-07-31T01:02:03.000Z",
            providerMessageId: "projects/nolate/messages/provider-1",
            alarmId: "schedule:41:member:7",
        };
        mockedApiPost.mockResolvedValue({ success: true });

        await expect(postNotificationDeliveryAck(payload)).resolves.toBeUndefined();

        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/notifications/delivery-acks",
            payload,
        );
    });

    it("rejects an unsuccessful ACK envelope", async () => {
        mockedApiPost.mockResolvedValue({
            success: false,
            errorCode: "PUSH_ACK_REJECTED",
            errorMessage: "delivery not found",
        });

        await expect(postNotificationDeliveryAck({
            logicalEventKey: "event:missing",
            deviceId: "android-installation-1",
            stage: "RECEIVED",
            occurredAt: "2026-07-31T01:02:03.000Z",
        })).rejects.toThrow("delivery not found");
    });
});

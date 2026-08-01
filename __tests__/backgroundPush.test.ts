import { handleDepartureAlarmSyncData } from "../src/modules/notification/departureAlarmSync";
import { handleBackgroundPushMessage } from "../src/modules/notification/backgroundPush";
import { acknowledgePushDelivery } from "../src/modules/notification/pushDeliveryAck";

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    handleDepartureAlarmSyncData: jest.fn(),
}));

jest.mock("../src/modules/notification/pushDeliveryAck", () => ({
    acknowledgePushDelivery: jest.fn(),
}));

const mockedHandleAlarmSync = jest.mocked(handleDepartureAlarmSyncData);
const mockedAcknowledgePushDelivery = jest.mocked(acknowledgePushDelivery);

describe("background push handler", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedHandleAlarmSync.mockResolvedValue(true);
        mockedAcknowledgePushDelivery.mockResolvedValue(true);
    });

    it("ACKs receipt and applies data-only alarm sync in the same headless task", async () => {
        const data = {
            type: "DEPARTURE_ALARM_SYNC",
            logicalEventKey: "event:background-alarm-41",
        };

        await handleBackgroundPushMessage({
            data,
            messageId: "provider-background-41",
        } as unknown as Parameters<typeof handleBackgroundPushMessage>[0]);

        expect(mockedAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "RECEIVED",
            { providerMessageId: "provider-background-41" },
        );
        expect(mockedHandleAlarmSync).toHaveBeenCalledWith(data);
    });

    it("does not fail notification handling when a best-effort ACK is skipped", async () => {
        mockedAcknowledgePushDelivery.mockResolvedValue(false);
        mockedHandleAlarmSync.mockResolvedValue(false);

        await expect(handleBackgroundPushMessage({
            data: { type: "SCHEDULE_TRAFFIC" },
        } as unknown as Parameters<typeof handleBackgroundPushMessage>[0]))
            .resolves.toBeUndefined();
    });
});

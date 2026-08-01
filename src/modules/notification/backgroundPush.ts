import type { FirebaseMessagingTypes } from "@react-native-firebase/messaging";

import { handleDepartureAlarmSyncData } from "./departureAlarmSync";
import { acknowledgePushDelivery } from "./pushDeliveryAck";

/**
 * Headless/background entry point. Standard visible notifications remain
 * OS-owned; data-only alarm commands are applied while receipt telemetry runs
 * alongside them so an unavailable ACK endpoint never delays scheduling.
 */
export async function handleBackgroundPushMessage(
    message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
    await Promise.all([
        acknowledgePushDelivery(message.data, "RECEIVED", {
            providerMessageId: message.messageId,
        }),
        handleDepartureAlarmSyncData(message.data),
    ]);
}

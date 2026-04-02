import { apiPost } from "./api";
import { assertApiSuccess, type ApiEnvelope } from "./response";

export type PushPlatform = "IOS" | "ANDROID" | "WEB";

type RegisterPushTokenPayload = {
    memberId: number;
    deviceId?: string;
    platform: PushPlatform;
    token: string;
};

export async function registerPushToken(payload: RegisterPushTokenPayload): Promise<void> {
    const response = await apiPost<ApiEnvelope<null>, RegisterPushTokenPayload>("/api/notifications/token", payload);
    assertApiSuccess(response);
}

import { apiGet } from "./api";
import { type ApiEnvelope, unwrapApiResponse } from "./response";

export type SubscriptionPlan = "FREE" | "PREMIUM";

export type SubscriptionPolicy = {
    plan: SubscriptionPlan;
    maxSmartSchedulesPerMonth: number;
    usedSmartSchedulesThisMonth: number;
    maxNotificationLeadMinutes: number;
    minNotificationIntervalMinutes: number;
    minEtaRefreshIntervalMinutes: number;
};

export const FREE_SUBSCRIPTION_POLICY: SubscriptionPolicy = {
    plan: "FREE",
    maxSmartSchedulesPerMonth: 5,
    usedSmartSchedulesThisMonth: 0,
    maxNotificationLeadMinutes: 60,
    minNotificationIntervalMinutes: 30,
    minEtaRefreshIntervalMinutes: 20,
};

export async function getMySubscriptionPolicy(): Promise<SubscriptionPolicy> {
    const response = await apiGet<ApiEnvelope<SubscriptionPolicy>>("/api/subscriptions/me");
    return unwrapApiResponse(response);
}

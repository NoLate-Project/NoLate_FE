import { apiGet } from "./api";
import { type ApiEnvelope, unwrapApiResponse } from "./response";

export type SubscriptionPlan = "FREE" | "PREMIUM";

export type SubscriptionPolicy = {
    plan: SubscriptionPlan;
    /** Backend-controlled effective ad decision. Defaults off when policy loading fails. */
    adsEnabled: boolean;
};

export const FREE_SUBSCRIPTION_POLICY: SubscriptionPolicy = {
    plan: "FREE",
    adsEnabled: false,
};

export async function getMySubscriptionPolicy(): Promise<SubscriptionPolicy> {
    const response = await apiGet<ApiEnvelope<SubscriptionPolicy>>("/api/subscriptions/me");
    return unwrapApiResponse(response);
}

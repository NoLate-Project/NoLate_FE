import { ApiResponseError } from "../../api/response";

export type ScheduleDetailUnavailableReason = "revoked" | "notFound";

export function getScheduleDetailUnavailableReason(
    error: unknown,
): ScheduleDetailUnavailableReason | undefined {
    if (!(error instanceof ApiResponseError)) return undefined;
    if (error.status === 403) return "revoked";
    if (error.status === 404) return "notFound";
    return undefined;
}

export function getDepartureStatusFailureMode(
    error: unknown,
    mainDetailAuthorized: boolean,
): "unavailable" | "legacy" | "error" {
    if (!mainDetailAuthorized || !(error instanceof ApiResponseError)) return "error";
    if (error.status === 403) return "unavailable";
    if (error.status === 404 || error.status === 405 || error.status === 501) {
        return "legacy";
    }
    return "error";
}

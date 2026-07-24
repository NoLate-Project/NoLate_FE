import { ApiResponseError } from "../src/api/response";
import {
    getDepartureStatusFailureMode,
    getScheduleDetailUnavailableReason,
} from "../src/modules/schedule/scheduleDetailAccess";
import { handleDepartureStatusAppStateChange } from "../src/modules/schedule/departureStatusRefresh";

test("AppState 복귀 main GET의 403/404를 access revoked/not found로 분류한다", () => {
    const reload = jest.fn();
    handleDepartureStatusAppStateChange("background", "active", reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getScheduleDetailUnavailableReason(
        new ApiResponseError("forbidden", { status: 403 }),
    )).toBe("revoked");
    expect(getScheduleDetailUnavailableReason(
        new ApiResponseError("missing", { status: 404 }),
    )).toBe("notFound");
    expect(getScheduleDetailUnavailableReason(
        new ApiResponseError("offline"),
    )).toBeUndefined();
});

test("authorized main detail에서 status 403은 unavailable, 404는 rollout legacy다", () => {
    expect(getDepartureStatusFailureMode(
        new ApiResponseError("private", { status: 403 }),
        true,
    )).toBe("unavailable");
    expect(getDepartureStatusFailureMode(
        new ApiResponseError("not deployed", { status: 404 }),
        true,
    )).toBe("legacy");
    expect(getDepartureStatusFailureMode(
        new ApiResponseError("main not confirmed", { status: 404 }),
        false,
    )).toBe("error");
});

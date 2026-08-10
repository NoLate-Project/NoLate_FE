import { apiDelete, apiPut } from "../src/api/api";
import {
    LIVE_ACTIVITY_SCHEMA_VERSION,
    LIVE_ACTIVITY_TYPE,
    registerLiveActivityStartToken,
    registerLiveActivityUpdateToken,
    retireLiveActivity,
    retireLiveActivityStartToken,
} from "../src/api/notification";

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPatch: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

const mockedApiPut = jest.mocked(apiPut);
const mockedApiDelete = jest.mocked(apiDelete);

describe("Live Activity API", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedApiPut.mockResolvedValue({ success: true, data: null });
        mockedApiDelete.mockResolvedValue({ success: true, data: null });
    });

    test("registers and retires the installation push-to-start token", async () => {
        const payload = {
            deviceId: "ios-installation-7",
            activityType: LIVE_ACTIVITY_TYPE,
            pushToStartToken: "ab".repeat(32),
            appearance: "light" as const,
            schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
        };

        await registerLiveActivityStartToken(payload);
        await retireLiveActivityStartToken(payload.deviceId);

        expect(mockedApiPut).toHaveBeenCalledWith(
            "/api/notifications/live-activities/start-token",
            payload,
        );
        expect(mockedApiDelete).toHaveBeenCalledWith(
            "/api/notifications/live-activities/start-token",
            {
                params: {
                    deviceId: payload.deviceId,
                    activityType: LIVE_ACTIVITY_TYPE,
                },
            },
        );
    });

    test("uses an encoded ActivityKit id and an explicit schedule/device fence", async () => {
        const activityId = "activity/id 41";
        const payload = {
            deviceId: "ios-installation-7",
            scheduleId: 41,
            generation: 3,
            updateToken: "cd".repeat(32),
            schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
        };

        await registerLiveActivityUpdateToken(activityId, payload);
        await retireLiveActivity(activityId, {
            deviceId: payload.deviceId,
            scheduleId: payload.scheduleId,
        });

        expect(mockedApiPut).toHaveBeenCalledWith(
            "/api/notifications/live-activities/activity%2Fid%2041/update-token",
            payload,
        );
        expect(mockedApiDelete).toHaveBeenCalledWith(
            "/api/notifications/live-activities/activity%2Fid%2041",
            {
                params: {
                    deviceId: payload.deviceId,
                    scheduleId: payload.scheduleId,
                },
            },
        );
    });
});

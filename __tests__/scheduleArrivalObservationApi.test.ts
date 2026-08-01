import { apiPost } from "../src/api/api";
import {
    recordScheduleArrivalObservation,
    recordScheduleEtaObservationEngagement,
    type ScheduleEtaArrivalObservation,
} from "../src/api/schedule";

jest.mock("../src/api/api", () => ({
    apiDelete: jest.fn(),
    apiGet: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

jest.mock("../src/modules/schedule/calendarScheduleCache", () => ({
    clearCalendarScheduleCache: jest.fn(),
    removeCalendarScheduleCacheItem: jest.fn(),
    upsertCalendarScheduleCacheItem: jest.fn(),
}));

const mockedApiPost = jest.mocked(apiPost);

describe("schedule arrival observation API", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("records opt-in arrival with the client callback timestamp and no location", async () => {
        const observation: ScheduleEtaArrivalObservation = {
            scheduleId: 41,
            pushJobId: 17,
            departedAt: "2026-07-31T00:30:00Z",
            predictionEvaluatedAt: "2026-07-31T00:29:00Z",
            recommendedDepartureAt: "2026-07-31T00:30:00Z",
            targetArrivalAt: "2026-07-31T01:00:00Z",
            predictedArrivalAt: "2026-07-31T01:00:00Z",
            actualArrivalAt: "2026-07-31T01:04:00Z",
            observationSource: "USER_NOW",
            observationVerification: "UNVERIFIED_CLIENT",
            precisionSeconds: 30,
            adjustmentSeconds: null,
            clientAppVersion: "1.2.0",
            clientBuildVersion: "42",
            backendCohortVersion: "api-2026.08.01",
            eligibilityPolicyVersion: "SELF_REPORT_DIAGNOSTIC_V2",
            recordedAt: "2026-07-31T01:04:02Z",
            etaSource: "ODSAY_REALTIME",
            etaStale: false,
            travelMinutes: 30,
            travelMode: "TRANSIT",
            predictionBasis: "PROVIDER_ABSOLUTE",
            providerId: "ODSAY_TRANSIT",
            algorithmVersion: "TRANSIT_REALTIME_V2",
            providerFetchedAt: "2026-07-31T00:29:00Z",
            predictedOnTime: true,
            actualOnTime: false,
            onTimeOutcome: "PREDICTED_ON_TIME_ACTUAL_LATE",
            departureOffsetSeconds: 0,
            actualTravelSeconds: 2_040,
            reportDelaySeconds: 2,
            accuracyEligible: false,
            accuracyEligibilityReason: "UNVERIFIED_USER_NOW",
            signedErrorSeconds: 240,
            absoluteErrorSeconds: 240,
        };
        mockedApiPost.mockResolvedValue({ success: true, data: observation });

        await expect(recordScheduleArrivalObservation(
            "41",
            {
                arrivedAt: "2026-07-31T01:04:00Z",
                observationSource: "USER_NOW",
                precisionSeconds: 30,
                clientAppVersion: "1.2.0",
                clientBuildVersion: "42",
            },
        )).resolves.toBe(observation);

        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/schedules/41/eta-observations/arrival",
            {
                arrivedAt: "2026-07-31T01:04:00Z",
                observationSource: "USER_NOW",
                precisionSeconds: 30,
                clientAppVersion: "1.2.0",
                clientBuildVersion: "42",
            },
        );
    });

    it("records bounded, location-free observation funnel engagement", async () => {
        const engagement = {
            scheduleId: 41,
            exposedAt: "2026-07-31T01:00:00Z",
            promptedAt: null,
            respondedAt: null,
        };
        mockedApiPost.mockResolvedValue({ success: true, data: engagement });

        await expect(recordScheduleEtaObservationEngagement("41", {
            event: "EXPOSED",
            clientAppVersion: "1.2.0",
            clientBuildVersion: "42",
            uxVariant: "arrival-card-v1",
        }))
            .resolves.toBe(engagement);
        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/schedules/41/eta-observations/engagement",
            {
                event: "EXPOSED",
                clientAppVersion: "1.2.0",
                clientBuildVersion: "42",
                uxVariant: "arrival-card-v1",
            },
        );
    });

    it("surfaces a rejected observation response", async () => {
        mockedApiPost.mockResolvedValue({
            success: false,
            errorCode: "INVALID_STATE",
            errorMessage: "출발 완료 후 도착을 기록할 수 있습니다.",
        });

        await expect(recordScheduleArrivalObservation(
            "41",
            {
                arrivedAt: "2026-07-31T01:04:00Z",
                observationSource: "USER_NOW",
                precisionSeconds: 30,
            },
        )).rejects.toThrow(
            "출발 완료 후 도착을 기록할 수 있습니다.",
        );
    });
});

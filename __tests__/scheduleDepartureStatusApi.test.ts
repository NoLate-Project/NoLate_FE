import { apiGet } from "../src/api/api";
import {
    getScheduleDepartureStatus,
    type ScheduleDepartureStatus,
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

const mockedApiGet = jest.mocked(apiGet);

describe("schedule departure status API", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("reads the effective transit route snapshot without reshaping it", async () => {
        const status: ScheduleDepartureStatus = {
            scheduleId: 41,
            travelMinutes: 58,
            recommendedDepartureAt: "2026-08-10T00:10:00Z",
            evaluatedAt: "2026-08-10T00:00:00Z",
            liveFetchedAt: "2026-08-10T00:00:00Z",
            source: "LIVE_PROVIDER",
            stale: false,
            confidence: "HIGH",
            failureReason: null,
            lastTrafficChangeMinutes: 7,
            lastChangedAt: "2026-08-10T00:00:00Z",
            nextCheckAt: "2026-08-10T00:05:00Z",
            preparationMinutes: null,
            preparationStartAt: null,
            safetyBufferMinutes: null,
            timeZone: "Asia/Seoul",
            transitRouteProvenance: "ODSAY_ALTERNATIVE_ROUTE",
            transitTimingBasis: "FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE",
            firstBoardingWaitMinutes: 6,
            routeChanged: true,
            effectiveTransitRoute: {
                provider: "odsay",
                identity: "route-2",
                departureAt: "2026-08-10T00:10:00Z",
                arrivalAt: "2026-08-10T01:08:00Z",
                totalMinutes: 58,
                segments: [{
                    sequence: 0,
                    kind: "SUBWAY",
                    durationMinutes: 35,
                    waitingMinutes: 6,
                    lineName: "2호선",
                    fromName: "강남역",
                    toName: "시청역",
                    directionName: "외선순환",
                }],
            },
        };
        mockedApiGet.mockResolvedValue({ success: true, data: status });

        await expect(getScheduleDepartureStatus("41")).resolves.toBe(status);
        expect(mockedApiGet).toHaveBeenCalledWith("/api/schedules/41/departure-status");
    });
});

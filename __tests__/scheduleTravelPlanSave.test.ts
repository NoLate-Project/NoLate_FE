const mockRecoverDepartureAlarmsAfterMutation = jest.fn();

jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));

import { saveScheduleRouteAsMyTravelPlan } from "../src/modules/schedule/scheduleTravelPlanSave";
import type { ScheduleRouteUpdatePayload } from "../src/modules/schedule/routePlannerSession";
import type { ScheduleItem, ScheduleTravelPlan } from "../src/modules/schedule/types";

const ownerItem: ScheduleItem = {
    id: "147",
    ownerMemberId: 2,
    title: "공유 일정",
    startAt: "2026-07-23T03:00:00Z",
    endAt: "2026-07-23T04:00:00Z",
    origin: { name: "오너 출발지 V1" },
    destination: { name: "공용 목적지" },
    travelMode: "CAR",
    travelMinutes: 40,
    route: { id: "owner-route-v1" },
    category: { id: "5", title: "업무", color: "#f44336" },
};

const routeUpdate: ScheduleRouteUpdatePayload = {
    ownerMemberId: 2,
    title: ownerItem.title,
    startAt: ownerItem.startAt,
    endAt: ownerItem.endAt,
    origin: { name: "오너 출발지 V2" },
    destination: ownerItem.destination,
    travelMode: "TRANSIT",
    travelMinutes: 31,
    route: {
        id: "owner-route-v2",
        provider: "odsay",
        transitLegs: [{
            kind: "SUBWAY",
            lineName: "수도권 9호선(급행)",
            serviceClass: "EXPRESS",
        }],
    },
    category: ownerItem.category,
};

const savedPlan: ScheduleTravelPlan = {
    scheduleId: 147,
    memberId: 2,
    status: "READY",
    origin: routeUpdate.origin,
    destination: routeUpdate.destination,
    travelMode: routeUpdate.travelMode,
    travelMinutes: routeUpdate.travelMinutes,
    route: routeUpdate.route,
};

describe("schedule travel plan save policy", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
    });

    it("saves an owners route through the personal travel plan API", async () => {
        const upsertMyTravelPlan = jest.fn().mockResolvedValue(savedPlan);
        const reloaded = {
            ...ownerItem,
            origin: routeUpdate.origin,
            travelMode: routeUpdate.travelMode,
            travelMinutes: routeUpdate.travelMinutes,
            route: routeUpdate.route,
            myTravelPlan: savedPlan,
        };
        const reloadSchedule = jest.fn().mockResolvedValue(reloaded);

        const result = await saveScheduleRouteAsMyTravelPlan(ownerItem, routeUpdate, {
            upsertMyTravelPlan,
            reloadSchedule,
        });

        expect(upsertMyTravelPlan).toHaveBeenCalledWith("147", expect.objectContaining({
            origin: { name: "오너 출발지 V2" },
            travelMode: "TRANSIT",
            travelMinutes: 31,
            route: routeUpdate.route,
        }));
        expect(upsertMyTravelPlan.mock.calls[0][1].route).toEqual(
            expect.objectContaining({
                transitLegs: [expect.objectContaining({ serviceClass: "EXPRESS" })],
            })
        );
        expect(reloadSchedule).toHaveBeenCalledWith("147");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(upsertMyTravelPlan.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
        expect(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0])
            .toBeLessThan(reloadSchedule.mock.invocationCallOrder[0]);
        expect(result).toBe(reloaded);
    });

    it("keeps the saved personal route when only the detail reload fails", async () => {
        const upsertMyTravelPlan = jest.fn().mockResolvedValue(savedPlan);
        const reloadSchedule = jest.fn().mockRejectedValue(new Error("temporary reload failure"));

        const result = await saveScheduleRouteAsMyTravelPlan(ownerItem, routeUpdate, {
            upsertMyTravelPlan,
            reloadSchedule,
        });

        expect(result.route).toEqual(routeUpdate.route);
        expect(result.origin?.name).toBe("오너 출발지 V2");
        expect(result.myTravelPlan).toBe(savedPlan);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    it("does not recover when the personal travel-plan mutation fails", async () => {
        const upsertMyTravelPlan = jest.fn().mockRejectedValue(
            new Error("travel-plan mutation failed"),
        );
        const reloadSchedule = jest.fn();

        await expect(saveScheduleRouteAsMyTravelPlan(ownerItem, routeUpdate, {
            upsertMyTravelPlan,
            reloadSchedule,
        })).rejects.toThrow("travel-plan mutation failed");

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        expect(reloadSchedule).not.toHaveBeenCalled();
    });
});

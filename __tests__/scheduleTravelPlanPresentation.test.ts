import {
    applyTravelPlanToScheduleItem,
    buildTravelPlanPayload,
    canOpenParticipantTravelPlan,
    travelPlanStatusLabel,
} from "../src/modules/schedule/travelPlanPresentation";
import type { ScheduleItem, ScheduleTravelPlan } from "../src/modules/schedule/types";

const item: ScheduleItem = {
    id: "10",
    ownerMemberId: 1,
    title: "공유 미팅",
    startAt: "2026-07-20T01:00:00Z",
    endAt: "2026-07-20T02:00:00Z",
    origin: { name: "오너 집" },
    destination: { name: "강남역" },
    category: { id: "1", title: "공유", color: "#2979FF" },
};

describe("schedule travel plan presentation", () => {
    it("projects only the current users plan onto the schedule screen model", () => {
        const plan: ScheduleTravelPlan = {
            scheduleId: 10,
            memberId: 2,
            status: "READY",
            origin: { name: "참여자 회사" },
            destination: { name: "강남역" },
            travelMode: "TRANSIT",
            travelMinutes: 31,
            route: { id: "participant-route" },
            notificationEnabled: true,
        };

        const result = applyTravelPlanToScheduleItem(item, plan);

        expect(result.origin?.name).toBe("참여자 회사");
        expect(result.destination?.name).toBe("강남역");
        expect(result.route).toEqual({ id: "participant-route" });
        expect(result.routeSetupRequired).toBe(false);
        expect(result.myTravelPlan?.memberId).toBe(2);
    });

    it("builds a personal payload without shared schedule fields", () => {
        const result = buildTravelPlanPayload({
            ...item,
            origin: { name: "내 출발지" },
            destination: {
                name: "강남역",
                lat: 37.4979,
                lng: 127.0276,
            },
            travelMode: "CAR",
            travelMinutes: 25,
            route: { id: "mine" },
        });

        expect(result).toEqual(expect.objectContaining({
            origin: { name: "내 출발지" },
            destination: {
                name: "강남역",
                lat: 37.4979,
                lng: 127.0276,
            },
            travelMode: "CAR",
            travelMinutes: 25,
            route: { id: "mine" },
        }));
        expect(result).not.toHaveProperty("title");
        expect(result).not.toHaveProperty("category");
    });

    it("opens configured plans only when detail permission is present", () => {
        expect(canOpenParticipantTravelPlan({
            memberId: 2,
            role: "SHARED",
            status: "READY",
            canViewDetails: true,
        }, 1)).toBe(true);
        expect(canOpenParticipantTravelPlan({
            memberId: 2,
            role: "SHARED",
            status: "READY",
            canViewDetails: false,
        }, 1)).toBe(false);
        expect(travelPlanStatusLabel("STALE")).toBe("경로 재설정 필요");
    });
});

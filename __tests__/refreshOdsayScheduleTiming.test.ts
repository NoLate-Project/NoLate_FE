import apiClient from "../src/api/api";
import type { RouteAlternativeOption, TransitLegDetail } from "../src/modules/map/tmapApiCore";
import { refreshOdsayScheduleTiming } from "../src/modules/schedule/refreshOdsayScheduleTiming";
import { getRouteInfoFromRoute } from "../src/modules/schedule/routeInfo";

jest.mock("../src/api/api", () => ({ __esModule: true, default: { post: jest.fn() } }));

const origin = { name: "노원역", lat: 37.65636195, lng: 127.06342739 };
const destination = { name: "신림역", lat: 37.48426844, lng: 126.92977778 };
const requestedTarget = "2026-11-22T10:44:00Z";
const originalTarget = "2026-11-22T10:50:00Z";
const originalDeparture = "2026-11-22T09:40:00Z";
const refreshedDeparture = "2026-11-22T09:37:00Z";

function subwayLeg(line: string, from: string, next: string, to: string, startID: string, endID: string): TransitLegDetail {
    return {
        kind: "SUBWAY", label: `${line}호선`, startName: from, endName: to,
        navigationEvidence: {
            version: 1,
            provider: "odsay",
            subwayIdentifiers: { startID, endID, lanes: [{ sourceIndex: 0, subwayCityCode: "1000", subwayCode: line }] },
            stopOccurrences: [from, next, to].map((name, index) => ({
                name, sourceIndex: index, providerSequence: index,
                routingStationID: [startID, `${startID}-next`, endID][index],
            })),
        },
    };
}

const candidate: RouteAlternativeOption = {
    id: "nowon-sillim", mode: "TRANSIT", minutes: 60, provider: "odsay", source: "api",
    transitLegs: [
        { kind: "WALK", label: "접근", durationSeconds: 60 },
        subwayLeg("4", "노원", "창동", "사당", "411", "433"),
        { kind: "WALK", label: "환승", durationSeconds: 157 },
        subwayLeg("2", "사당", "낙성대", "신림", "226", "230"),
        { kind: "WALK", label: "도착", durationSeconds: 60 },
    ],
};
const route = {
    ...candidate,
    routeInfo: {
        id: candidate.id, provider: "odsay", originName: origin.name, destinationName: destination.name,
        timeBasis: "provider_schedule", providerTimeBasis: "timetable",
        departureTime: originalDeparture, arrivalTime: "2026-11-22T10:46:30Z",
        totalDurationMinutes: 67, totalDurationSeconds: 3990, steps: [],
    },
};
const input = {
    route, origin, destination, departAt: originalDeparture, travelMinutes: 67,
    plannedArrivalAt: originalTarget, nextArrivalAt: requestedTarget,
};

describe("refreshOdsayScheduleTiming", () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2026-11-15T10:30:00Z"));
        jest.mocked(apiClient.post).mockReset();
    });
    afterEach(() => jest.useRealTimers());

    test("새 마감으로 원래 순서의 정차역을 조회해 열차편과 예약 시각을 갱신한다", async () => {
        const preview = {
            departureAt: refreshedDeparture, arrivalAt: "2026-11-22T10:41:00Z",
            rides: [
                { boardingAt: "2026-11-22T09:39:00Z", arrivalAt: "2026-11-22T10:27:00Z" },
                { boardingAt: "2026-11-22T10:32:30Z", arrivalAt: "2026-11-22T10:40:00Z" },
            ],
            transferTimings: [{ previousArrivalAt: "2026-11-22T10:27:00Z", boardingAt: "2026-11-22T10:32:30Z",
                walkingSeconds: 157, requiredMarginSeconds: 60 }],
        };
        jest.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { preview } } });

        const saved = await refreshOdsayScheduleTiming(input);

        expect(apiClient.post).toHaveBeenCalledTimes(1);
        expect(apiClient.post).toHaveBeenCalledWith("/api/routes/transit/timetable-preview", expect.objectContaining({
            targetArrivalAt: "2026-11-22T10:44:00.000Z",
            orderedStops: [["노원", "창동", "사당"], ["사당", "낙성대", "신림"]],
        }), expect.anything());
        expect(saved.departAt).toBe("2026-11-22T09:37:00.000Z");
        expect(saved.travelMinutes).toBe(64);
        expect(getRouteInfoFromRoute(saved.route)).toMatchObject({ timeBasis: "provider_schedule",
            departureTime: saved.departAt, arrivalTime: "2026-11-22T10:41:00.000Z" });
    });

    test("외부 실패가 나면 예전 열차를 저장하지 않고 경로 추정값을 유지한다", async () => {
        jest.mocked(apiClient.post).mockRejectedValue(new Error("fixture unavailable"));
        const saved = await refreshOdsayScheduleTiming(input);
        expect(saved.departAt).toBe("2026-11-22T09:37:30.000Z");
        expect(getRouteInfoFromRoute(saved.route)).toMatchObject({ timeBasis: "estimated", providerTimeBasis: "route_estimate" });
    });

    test("일정이 같은 시각이면 이미 선택한 경로를 그대로 사용한다", async () => {
        const saved = await refreshOdsayScheduleTiming({ ...input, nextArrivalAt: originalTarget });
        expect(saved.route).toBe(route);
        expect(apiClient.post).not.toHaveBeenCalled();
    });

    const liveBusRoute = {
        id: "gangnam-yeoksam", mode: "TRANSIT", minutes: 15, provider: "odsay", source: "api",
        transitLegs: [
            { kind: "WALK", label: "접근 도보", durationMinutes: 3 },
            { kind: "BUS", label: "360", lineName: "360", providerRouteId: "1440",
                startID: "160678", endID: "106478", durationMinutes: 6 },
            { kind: "WALK", label: "도착 도보", durationMinutes: 6 },
        ],
        routeInfo: {
            id: "gangnam-yeoksam", provider: "odsay", originName: "강남", destinationName: "역삼",
            timeBasis: "estimated", providerTimeBasis: "route_estimate",
            departureTime: "2026-11-15T10:21:00Z", arrivalTime: "2026-11-15T10:32:03Z",
            totalDurationMinutes: 12, totalDurationSeconds: 663,
            busPreviewObservation: { sourceUpdatedAt: "2026-11-15T10:19:54Z", targetArrivalAt: "2026-11-15T10:35:00Z" },
            steps: [],
        },
    };
    const liveBusInput = {
        ...input, route: liveBusRoute, travelMinutes: 12, departAt: liveBusRoute.routeInfo.departureTime,
        plannedArrivalAt: liveBusRoute.routeInfo.busPreviewObservation.targetArrivalAt,
    };

    test("미래 날짜로 바꾸면 이전 차량의 소요시간 대신 원래 ODsay 경로 추정을 복원한다", async () => {
        const saved = await refreshOdsayScheduleTiming({ ...liveBusInput, nextArrivalAt: "2026-11-16T10:44:00Z" });
        expect(apiClient.post).not.toHaveBeenCalled();
        expect(saved.departAt).toBe("2026-11-16T10:29:00.000Z");
        expect(saved.travelMinutes).toBe(15);
        const info = getRouteInfoFromRoute(saved.route)!;
        expect(info.busPreviewObservation).toBeUndefined();
        expect(info.steps.find(step => step.type === "BUS")?.durationMinutes).toBe(6);
    });

    test("가까운 시각으로 바꾸면 새 차량 예측으로 정밀한 출발·도착을 저장한다", async () => {
        const preview = {
            departureAt: "2026-11-15T10:39:20Z", boardingAt: "2026-11-15T10:42:57Z",
            alightingAt: "2026-11-15T10:44:22Z", arrivalAt: "2026-11-15T10:50:22Z",
            sourceUpdatedAt: "2026-11-15T10:29:51Z", accessSeconds: 157, egressSeconds: 360, providerRouteId: "1440",
        };
        jest.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { preview } } });
        const saved = await refreshOdsayScheduleTiming({ ...liveBusInput, nextArrivalAt: "2026-11-15T10:53:00Z" });
        expect(apiClient.post).toHaveBeenCalledWith("/api/routes/transit/bus-preview",
            expect.objectContaining({ targetArrivalAt: "2026-11-15T10:53:00.000Z" }), expect.anything());
        expect(saved.departAt).toBe("2026-11-15T10:39:20.000Z");
        expect(getRouteInfoFromRoute(saved.route)).toMatchObject({
            arrivalTime: "2026-11-15T10:50:22.000Z", totalDurationSeconds: 662,
            busPreviewObservation: { targetArrivalAt: "2026-11-15T10:53:00.000Z" },
        });
        expect(saved.route).toHaveProperty("odsayBusPreview", undefined);
    });

    test("버스 환승 미리보기는 두 번째 승차와 환승 여유가 맞을 때 두 구간을 저장한다", async () => {
        const secondBus = { kind: "BUS", label: "340", lineName: "340", providerRouteId: "1026",
            startID: "106709", endID: "108687", durationMinutes: 6 };
        const route = { ...liveBusRoute, transitLegs: [
            ...liveBusRoute.transitLegs.slice(0, 2), { kind: "WALK", label: "환승", durationMinutes: 2 },
            secondBus, liveBusRoute.transitLegs[2],
        ] };
        const preview = {
            departureAt: "2026-11-15T10:32:00Z", boardingAt: "2026-11-15T10:36:00Z",
            alightingAt: "2026-11-15T10:46:00Z", arrivalAt: "2026-11-15T10:52:00Z",
            sourceUpdatedAt: "2026-11-15T10:29:51Z", accessSeconds: 180, egressSeconds: 360, providerRouteId: "1440",
            transfer: { firstAlightingAt: "2026-11-15T10:40:00Z", secondBoardingAt: "2026-11-15T10:43:00Z",
                secondProviderRouteId: "1026", walkingSeconds: 120, requiredMarginSeconds: 60 },
        };
        jest.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { preview } } });
        const next = { ...liveBusInput, route, nextArrivalAt: "2026-11-15T10:53:00Z" };
        const saved = await refreshOdsayScheduleTiming(next);
        expect(saved.travelMinutes).toBe(20);
        expect(getRouteInfoFromRoute(saved.route)?.steps.slice(1, -1).map(s => s.durationSeconds)).toEqual([180, 300, 120, 240, 360]);

        jest.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { preview: {
            ...preview, transfer: { ...preview.transfer, secondBoardingAt: "2026-11-15T10:42:59Z" },
        } } } });
        const fallback = await refreshOdsayScheduleTiming(next);
        expect(getRouteInfoFromRoute(fallback.route)?.busPreviewObservation).toBeUndefined();
        expect(fallback.travelMinutes).toBe(15);
    });
});

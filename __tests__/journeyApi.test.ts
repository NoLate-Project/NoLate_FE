import { apiGet, apiPost, apiPut } from "../src/api/api";
import {
    finishJourneySession,
    getJourneySession,
    journeyProgressRequest,
    startJourneySession,
    updateJourneyProgress,
    type JourneySession,
} from "../src/api/journey";

jest.mock("../src/api/api", () => ({
    apiGet: jest.fn(),
    apiPost: jest.fn(),
    apiPut: jest.fn(),
}));

const mockedApiGet = jest.mocked(apiGet);
const mockedApiPost = jest.mocked(apiPost);
const mockedApiPut = jest.mocked(apiPut);

function session(overrides: Partial<JourneySession> = {}): JourneySession {
    return {
        sessionId: "11111111-1111-4111-8111-111111111111",
        scheduleId: "42",
        generation: 1,
        routeRevision: 2,
        sequence: 1,
        phase: "WAITING",
        activeLegIndex: 0,
        currentStopIndex: null,
        remainingStops: null,
        legProgress: 0,
        overallProgress: 0,
        nextInstruction: "42번 버스를 기다리세요.",
        observedAt: "2026-10-03T01:00:00.000Z",
        source: "MANUAL",
        startedAt: "2026-10-03T01:00:00.000Z",
        expiresAt: "2026-10-03T03:00:00.000Z",
        routeSnapshot: {
            transitLegs: [{ kind: "BUS", label: "42번 버스" }],
        },
        routeLegs: [{
            kind: "BUS",
            label: "42번 버스",
            lineName: "42",
            startName: "시청 정류장",
            endName: "서울역 정류장",
            startCoord: { lat: 37.1, lng: 127.1 },
            endCoord: { lat: 37.2, lng: 127.2 },
            passStops: [{ name: "중간 정류장", sequence: 1, coord: { lat: 37.15, lng: 127.15 } }],
            pathCoords: [{ lat: 37.1, lng: 127.1 }, { lat: 37.2, lng: 127.2 }],
        }],
        ...overrides,
    };
}

describe("journey API", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("현재 세션 GET의 성공 envelope와 null을 구분한다", async () => {
        const active = session();
        mockedApiGet
            .mockResolvedValueOnce({ success: true, data: active })
            .mockResolvedValueOnce({ success: true, data: null });

        await expect(getJourneySession("42")).resolves.toEqual(active);
        await expect(getJourneySession("42")).resolves.toBeNull();

        expect(mockedApiGet).toHaveBeenNthCalledWith(1, "/api/schedules/42/journey");
        expect(mockedApiGet).toHaveBeenNthCalledWith(2, "/api/schedules/42/journey");
    });

    it("start endpoint에 stable requestId와 선택 deviceId만 보낸다", async () => {
        const active = session();
        mockedApiPost.mockResolvedValue({ success: true, data: active });

        await expect(startJourneySession("42", "request-1", "device-1")).resolves.toEqual(active);
        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/schedules/42/journey/start",
            { requestId: "request-1", deviceId: "device-1" },
        );

        mockedApiPost.mockClear();
        await startJourneySession("42", "request-2");
        expect(mockedApiPost).toHaveBeenCalledWith(
            "/api/schedules/42/journey/start",
            { requestId: "request-2" },
        );
    });

    it("progress endpoint에 sessionId와 허용 필드만 PUT한다", async () => {
        const active = session();
        mockedApiPut.mockResolvedValue({ success: true, data: active });
        const request = journeyProgressRequest(active);

        await expect(updateJourneyProgress("42", active.sessionId, request)).resolves.toEqual(active);

        expect(mockedApiPut).toHaveBeenCalledWith(
            "/api/schedules/42/journey/11111111-1111-4111-8111-111111111111/progress",
            request,
        );
        expect(request).toEqual({
            generation: 1,
            routeRevision: 2,
            sequence: 1,
            phase: "WAITING",
            activeLegIndex: 0,
            currentStopIndex: null,
            remainingStops: null,
            legProgress: 0,
            observedAt: "2026-10-03T01:00:00.000Z",
            source: "MANUAL",
        });
        expect(request).not.toHaveProperty("routeSnapshot");
        expect(request).not.toHaveProperty("routeLegs");
        expect(request).not.toHaveProperty("nextInstruction");
        expect(request).not.toHaveProperty("overallProgress");
    });

    it.each(["arrive", "stop"] as const)("%s terminal endpoint와 payload를 정확히 보낸다", async (operation) => {
        const terminal = session({ phase: operation === "arrive" ? "ARRIVED" : "STOPPED" });
        mockedApiPost.mockResolvedValue({ success: true, data: terminal });
        const request = {
            generation: 1,
            routeRevision: 2,
            sequence: 4,
            observedAt: "2026-10-03T01:10:00.000Z",
        };

        await expect(finishJourneySession(
            "42",
            terminal.sessionId,
            operation,
            request,
        )).resolves.toEqual(terminal);

        expect(mockedApiPost).toHaveBeenCalledWith(
            `/api/schedules/42/journey/11111111-1111-4111-8111-111111111111/${operation}`,
            request,
        );
    });

    it("잘못된 scheduleId는 네트워크 호출 전에 거부한다", async () => {
        await expect(getJourneySession("0")).rejects.toThrow("올바른 일정을 선택해 주세요.");
        await expect(startJourneySession("not-a-number", "request-1")).rejects.toThrow(
            "올바른 일정을 선택해 주세요.",
        );
        expect(mockedApiGet).not.toHaveBeenCalled();
        expect(mockedApiPost).not.toHaveBeenCalled();
    });

    it("success envelope 안의 불완전한 세션 DTO를 거부한다", async () => {
        mockedApiGet.mockResolvedValue({
            success: true,
            data: { sessionId: "partial-session", scheduleId: "42" },
        });

        await expect(getJourneySession("42")).rejects.toThrow();
    });

    it("실패 envelope의 서버 메시지를 보존한다", async () => {
        mockedApiPost.mockResolvedValue({
            success: false,
            errorCode: "JOURNEY_DISABLED",
            errorMessage: "길안내 기능이 비활성화되어 있습니다.",
        });

        await expect(startJourneySession("42", "request-1")).rejects.toThrow(
            "길안내 기능이 비활성화되어 있습니다.",
        );
    });
});

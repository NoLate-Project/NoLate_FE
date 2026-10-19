import type { JourneySession } from "../src/api/journey";
import {
    createJourneySessionController,
    type JourneySessionDependencies,
    type JourneySessionViewState,
} from "../src/modules/journey/journeySessionController";

jest.mock("../src/api/journey", () => ({
    journeyProgressRequest: jest.fn((progress: Record<string, unknown>) => ({
        generation: progress.generation,
        routeRevision: progress.routeRevision,
        sequence: progress.sequence,
        phase: progress.phase,
        activeLegIndex: progress.activeLegIndex,
        currentStopIndex: progress.currentStopIndex,
        remainingStops: progress.remainingStops,
        legProgress: progress.legProgress,
        observedAt: progress.observedAt,
        source: "MANUAL",
    })),
}));

const NOW = Date.parse("2026-10-03T01:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function session(overrides: Partial<JourneySession> = {}): JourneySession {
    return {
        sessionId: REQUEST_ID,
        scheduleId: "42",
        generation: 1,
        routeRevision: 1,
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
        }],
        ...overrides,
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function dependencies(
    overrides: Partial<JourneySessionDependencies> = {},
): JourneySessionDependencies {
    return {
        load: jest.fn(async () => null),
        start: jest.fn(async () => session()),
        update: jest.fn(async () => session({ sequence: 2, phase: "RIDING" })),
        finish: jest.fn(async () => session({ sequence: 2, phase: "STOPPED" })),
        deviceId: jest.fn(async () => "ios-device-1"),
        makeRequestId: jest.fn(() => REQUEST_ID),
        now: jest.fn(() => NOW),
        onStarted: jest.fn(),
        onFinished: jest.fn(),
        ...overrides,
    };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("createJourneySessionController", () => {
    it("동시 start를 singleflight로 합치고 서버 ACK 뒤 한 번만 시작 callback을 보낸다", async () => {
        const startResult = deferred<JourneySession>();
        const deps = dependencies({
            start: jest.fn(() => startResult.promise),
        });
        const changes: JourneySessionViewState[] = [];
        const controller = createJourneySessionController(deps, (state) => changes.push(state));
        await controller.refresh();

        const first = controller.start();
        const second = controller.start();
        await flushPromises();

        expect(deps.makeRequestId).toHaveBeenCalledTimes(1);
        expect(deps.start).toHaveBeenCalledTimes(1);
        expect(deps.start).toHaveBeenCalledWith(REQUEST_ID, "ios-device-1");
        expect(controller.getState().pending).toBe(true);
        expect(controller.getState().session).toBeNull();

        const acknowledged = session();
        startResult.resolve(acknowledged);
        await Promise.all([first, second]);

        expect(controller.getState()).toMatchObject({
            session: acknowledged,
            pending: false,
            error: null,
        });
        expect(deps.onStarted).toHaveBeenCalledTimes(1);
        expect(changes
            .filter((state) => state.session !== null)
            .every((state) => state.session === acknowledged)).toBe(true);
    });

    it("실패한 start 재시도에도 같은 requestId를 유지한다", async () => {
        const deps = dependencies({
            load: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null),
            start: jest.fn()
                .mockRejectedValueOnce(new Error("network timeout"))
                .mockResolvedValueOnce(session()),
        });
        const controller = createJourneySessionController(deps, () => undefined);
        await controller.refresh();

        await controller.start();
        expect(controller.getState().error).toBe("network timeout");
        await controller.start();

        expect(deps.makeRequestId).toHaveBeenCalledTimes(1);
        expect(deps.start).toHaveBeenNthCalledWith(1, REQUEST_ID, "ios-device-1");
        expect(deps.start).toHaveBeenNthCalledWith(2, REQUEST_ID, "ios-device-1");
    });

    it("겹친 refresh에서 늦게 도착한 과거 응답을 버린다", async () => {
        const older = deferred<JourneySession | null>();
        const newer = deferred<JourneySession | null>();
        const deps = dependencies({
            load: jest.fn()
                .mockImplementationOnce(() => older.promise)
                .mockImplementationOnce(() => newer.promise),
        });
        const controller = createJourneySessionController(deps, () => undefined);

        const firstRefresh = controller.refresh();
        const secondRefresh = controller.refresh();
        newer.resolve(session({ sequence: 3, phase: "ALIGHTING" }));
        await secondRefresh;
        older.resolve(session({ sequence: 1, phase: "WAITING" }));
        await firstRefresh;

        expect(controller.getState().session).toMatchObject({
            sequence: 3,
            phase: "ALIGHTING",
        });
    });

    it("advance를 낙관적으로 렌더링하지 않고 서버 ACK 뒤에만 반영한다", async () => {
        const active = session();
        const updateResult = deferred<JourneySession>();
        const deps = dependencies({
            load: jest.fn(async () => active),
            update: jest.fn(() => updateResult.promise),
        });
        const changes: JourneySessionViewState[] = [];
        const controller = createJourneySessionController(deps, (state) => changes.push(state));
        await controller.refresh();
        changes.length = 0;

        const pendingAdvance = controller.advance();
        expect(controller.getState()).toMatchObject({ pending: true, session: active });
        expect(changes.every((state) => state.session?.sequence === 1)).toBe(true);

        const acknowledged = session({ sequence: 2, phase: "RIDING" });
        updateResult.resolve(acknowledged);
        await pendingAdvance;

        expect(controller.getState()).toMatchObject({
            pending: false,
            session: acknowledged,
        });
    });

    it("dispose 이후 도착한 start 결과는 상태와 callback을 건드리지 않는다", async () => {
        const startResult = deferred<JourneySession>();
        const deps = dependencies({ start: jest.fn(() => startResult.promise) });
        const changes: JourneySessionViewState[] = [];
        const controller = createJourneySessionController(deps, (state) => changes.push(state));
        await controller.refresh();

        const pendingStart = controller.start();
        await flushPromises();
        const changeCountAtDispose = changes.length;
        controller.dispose();
        startResult.resolve(session());
        await pendingStart;

        expect(changes).toHaveLength(changeCountAtDispose);
        expect(deps.onStarted).not.toHaveBeenCalled();
        expect(deps.onFinished).not.toHaveBeenCalled();
    });

    it("start timeout 뒤 authoritative load가 commit을 확인하면 성공으로 조정한다", async () => {
        const committed = session();
        const deps = dependencies({
            load: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(committed),
            start: jest.fn(async () => { throw new Error("network timeout"); }),
        });
        const controller = createJourneySessionController(deps, () => undefined);
        await controller.refresh();

        await controller.start();

        expect(controller.getState()).toMatchObject({
            session: committed,
            pending: false,
            error: null,
        });
        expect(deps.onStarted).toHaveBeenCalledWith(committed);
    });

    it("start 경합에서 이미 존재하던 다른 active session을 읽어도 성공으로 복구한다", async () => {
        const activeExisting = session({
            sessionId: "22222222-2222-4222-8222-222222222222",
            generation: 4,
            sequence: 6,
            phase: "RIDING",
        });
        const deps = dependencies({
            load: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(activeExisting),
            start: jest.fn(async () => { throw new Error("network timeout"); }),
        });
        const controller = createJourneySessionController(deps, () => undefined);
        await controller.refresh();

        await controller.start();

        expect(controller.getState()).toMatchObject({
            session: activeExisting,
            pending: false,
            error: null,
        });
        expect(deps.onStarted).toHaveBeenCalledWith(activeExisting);
    });

    it("terminal finish timeout 뒤 authoritative terminal을 읽으면 완료 callback을 보낸다", async () => {
        const alighting = session({ sequence: 3, phase: "ALIGHTING" });
        const arrived = session({
            sequence: 4,
            phase: "ARRIVED",
            legProgress: 1,
            overallProgress: 1,
            nextInstruction: "목적지에 도착했습니다.",
        });
        const deps = dependencies({
            load: jest.fn()
                .mockResolvedValueOnce(alighting)
                .mockResolvedValueOnce(arrived),
            finish: jest.fn(async () => { throw new Error("network timeout"); }),
        });
        const controller = createJourneySessionController(deps, () => undefined);
        await controller.refresh();

        await controller.advance();

        expect(deps.finish).toHaveBeenCalledWith(
            alighting.sessionId,
            "arrive",
            expect.objectContaining({ sequence: 4 }),
        );
        expect(controller.getState()).toMatchObject({
            session: arrived,
            pending: false,
            error: null,
        });
        expect(deps.onFinished).toHaveBeenCalledWith(arrived);
    });

    it.each(["ARRIVED", "STOPPED"] as const)(
        "%s 세션은 start, advance, stop으로 바뀌지 않는다",
        async (phase) => {
            const terminal = session({
                phase,
                sequence: 9,
                legProgress: phase === "ARRIVED" ? 1 : 0,
            });
            const deps = dependencies({ load: jest.fn(async () => terminal) });
            const controller = createJourneySessionController(deps, () => undefined);
            await controller.refresh();

            await controller.start();
            await controller.advance();
            await controller.stop();

            expect(deps.start).not.toHaveBeenCalled();
            expect(deps.update).not.toHaveBeenCalled();
            expect(deps.finish).not.toHaveBeenCalled();
            expect(controller.getState().session).toBe(terminal);
        },
    );
});

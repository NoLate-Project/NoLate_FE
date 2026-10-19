import type { TransitLegDetail } from "../src/modules/map/routingService";
import { normalizeJourneyRoute } from "../src/modules/journey/journeyRoute";
import {
    createInitialJourneyProgress,
    transitionJourney,
} from "../src/modules/journey/journeyStateMachine";
import type {
    JourneyIdentity,
    JourneyManualAction,
    JourneyProgress,
    NormalizedJourneyRoute,
} from "../src/modules/journey/types";

const IDENTITY: JourneyIdentity = {
    sessionId: "journey-session-1",
    generation: 3,
    routeRevision: 7,
};

const BASE_TIME = Date.parse("2026-10-03T01:00:00.000Z");

function at(second: number): string {
    return new Date(BASE_TIME + second * 1_000).toISOString();
}

function action(
    progress: JourneyProgress,
    type: JourneyManualAction["type"] = "ADVANCE",
    overrides: Partial<JourneyManualAction> = {},
): JourneyManualAction {
    return {
        type,
        sessionId: progress.sessionId,
        generation: progress.generation,
        routeRevision: progress.routeRevision,
        sequence: progress.sequence + 1,
        observedAt: at(progress.sequence + 1),
        source: "MANUAL",
        ...overrides,
    };
}

function advance(progress: JourneyProgress, route: NormalizedJourneyRoute): JourneyProgress {
    return transitionJourney(progress, route, action(progress));
}

function walk(label: string): TransitLegDetail {
    return { kind: "WALK", label, startName: `${label} 시작`, endName: `${label} 끝` };
}

function ride(kind: "BUS" | "SUBWAY", label: string): TransitLegDetail {
    return {
        kind,
        label,
        lineName: label,
        startName: `${label} 승차`,
        endName: `${label} 하차`,
        stationCount: 5,
        passStops: [
            { name: `${label} 중간 1`, sequence: 1 },
            { name: `${label} 중간 2`, sequence: 2 },
        ],
    };
}

describe("journeyStateMachine", () => {
    it("initial walk, transfer walk, final walk의 실제 leg를 차례로 진행한다", () => {
        const route = normalizeJourneyRoute([
            walk("첫 도보"),
            ride("BUS", "31번"),
            walk("환승 도보"),
            ride("SUBWAY", "신분당선"),
            walk("마지막 도보"),
        ]);
        let progress = createInitialJourneyProgress(IDENTITY, route, at(0));

        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([0, "READY", 0]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([1, "WALKING_TO_STOP", 0]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([2, "WAITING", 1]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([3, "RIDING", 1]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([4, "ALIGHTING", 1]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([5, "TRANSFERRING", 2]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([6, "WAITING", 3]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([7, "RIDING", 3]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([8, "ALIGHTING", 3]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([9, "FINAL_WALK", 4]);
        progress = advance(progress, route);
        expect([progress.sequence, progress.phase, progress.activeLegIndex]).toEqual([10, "ARRIVED", 4]);
        expect(progress.legProgress).toBe(1);
        expect(progress.overallProgress).toBe(1);
    });

    it("initial/final walk가 없는 단일 ride를 WAITING부터 ARRIVED까지 진행한다", () => {
        const route = normalizeJourneyRoute([ride("BUS", "402번")]);
        let progress = createInitialJourneyProgress(IDENTITY, route, at(0));

        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["WAITING", 0]);
        progress = advance(progress, route);
        expect(progress.phase).toBe("RIDING");
        progress = advance(progress, route);
        expect(progress.phase).toBe("ALIGHTING");
        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["ARRIVED", 0]);
    });

    it("연속 ride 사이에 synthetic TRANSFERRING leg를 만들지 않는다", () => {
        const route = normalizeJourneyRoute([
            ride("BUS", "버스"),
            ride("SUBWAY", "지하철"),
        ]);
        let progress = createInitialJourneyProgress(IDENTITY, route, at(0));

        progress = advance(progress, route); // WAITING bus
        progress = advance(progress, route); // RIDING bus
        progress = advance(progress, route); // ALIGHTING bus
        progress = advance(progress, route); // WAITING subway

        expect([progress.phase, progress.activeLegIndex]).toEqual(["WAITING", 1]);
    });

    it("여러 initial/final walk leg를 건너뛰지 않는다", () => {
        const route = normalizeJourneyRoute([
            walk("접근 1"),
            walk("접근 2"),
            ride("BUS", "버스"),
            walk("도착 1"),
            walk("도착 2"),
        ]);
        let progress = createInitialJourneyProgress(IDENTITY, route, at(0));

        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["WALKING_TO_STOP", 0]);
        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["WALKING_TO_STOP", 1]);
        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["WAITING", 2]);
        progress = advance(progress, route);
        progress = advance(progress, route);
        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["FINAL_WALK", 3]);
        progress = advance(progress, route);
        expect([progress.phase, progress.activeLegIndex]).toEqual(["FINAL_WALK", 4]);
        progress = advance(progress, route);
        expect(progress.phase).toBe("ARRIVED");
    });

    it("duplicate, sequence gap, 과거 관측과 다른 session/generation/revision을 무시한다", () => {
        const route = normalizeJourneyRoute([ride("BUS", "버스")]);
        const initial = createInitialJourneyProgress(IDENTITY, route, at(0));
        const firstAction = action(initial);
        const waiting = transitionJourney(initial, route, firstAction);

        expect(transitionJourney(waiting, route, firstAction)).toBe(waiting);
        expect(transitionJourney(waiting, route, action(waiting, "ADVANCE", {
            sequence: waiting.sequence + 2,
        }))).toBe(waiting);
        expect(transitionJourney(waiting, route, action(waiting, "ADVANCE", {
            observedAt: at(0),
        }))).toBe(waiting);
        expect(transitionJourney(waiting, route, action(waiting, "ADVANCE", {
            sessionId: "another-session",
        }))).toBe(waiting);
        expect(transitionJourney(waiting, route, action(waiting, "ADVANCE", {
            generation: waiting.generation + 1,
        }))).toBe(waiting);
        expect(transitionJourney(waiting, route, action(waiting, "ADVANCE", {
            routeRevision: waiting.routeRevision + 1,
        }))).toBe(waiting);
    });

    it("동일 millisecond 관측은 sequence가 정확히 다음이면 허용한다", () => {
        const route = normalizeJourneyRoute([ride("BUS", "버스")]);
        const initial = createInitialJourneyProgress(IDENTITY, route, at(0));
        const waiting = transitionJourney(initial, route, action(initial, "ADVANCE", {
            observedAt: initial.observedAt,
        }));

        expect(waiting.sequence).toBe(1);
        expect(waiting.phase).toBe("WAITING");
    });

    it("ARRIVED와 STOPPED는 늦은 action으로 되살아나지 않는다", () => {
        const route = normalizeJourneyRoute([ride("BUS", "버스")]);
        let arrived = createInitialJourneyProgress(IDENTITY, route, at(0));
        arrived = advance(arrived, route);
        arrived = advance(arrived, route);
        arrived = advance(arrived, route);
        arrived = advance(arrived, route);
        expect(arrived.phase).toBe("ARRIVED");
        expect(transitionJourney(arrived, route, action(arrived))).toBe(arrived);
        expect(transitionJourney(arrived, route, action(arrived, "STOP"))).toBe(arrived);

        const ready = createInitialJourneyProgress(
            { ...IDENTITY, sessionId: "stopped-session" },
            route,
            at(0),
        );
        const stopped = transitionJourney(ready, route, action(ready, "STOP"));
        expect(stopped.phase).toBe("STOPPED");
        expect(transitionJourney(stopped, route, action(stopped))).toBe(stopped);
    });

    it("manual source는 정거장 진행을 추정하지 않고 sequence만 단조 증가시킨다", () => {
        const route = normalizeJourneyRoute([ride("BUS", "버스")]);
        let progress = createInitialJourneyProgress(IDENTITY, route, at(0));

        for (const expectedSequence of [1, 2, 3]) {
            progress = advance(progress, route);
            expect(progress.sequence).toBe(expectedSequence);
            expect(progress.source).toBe("MANUAL");
            expect(progress.currentStopIndex).toBeNull();
            expect(progress.remainingStops).toBeNull();
            expect(progress.legProgress).toBe(0);
        }
    });

    it("초기 identity와 observedAt을 검증한다", () => {
        const route = normalizeJourneyRoute([ride("BUS", "버스")]);

        expect(() => createInitialJourneyProgress(
            { ...IDENTITY, sessionId: " " }, route, at(0),
        )).toThrow(/sessionId/u);
        expect(() => createInitialJourneyProgress(
            { ...IDENTITY, generation: -1 }, route, at(0),
        )).toThrow(/generation/u);
        expect(() => createInitialJourneyProgress(
            IDENTITY, route, "not-a-date",
        )).toThrow(/observedAt/u);
    });
});

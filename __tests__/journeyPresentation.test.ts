import type { TransitLegDetail } from "../src/modules/map/routingService";
import { normalizeJourneyRoute } from "../src/modules/journey/journeyRoute";
import {
    getNextManualActionLabel,
} from "../src/modules/journey/journeyPresentation";
import {
    createInitialJourneyProgress,
    transitionJourney,
} from "../src/modules/journey/journeyStateMachine";
import type { JourneyProgress } from "../src/modules/journey/types";

const observedAt = "2026-10-03T01:00:00.000Z";

function next(progress: JourneyProgress, route: ReturnType<typeof normalizeJourneyRoute>): JourneyProgress {
    return transitionJourney(progress, route, {
        type: "ADVANCE",
        sessionId: progress.sessionId,
        generation: progress.generation,
        routeRevision: progress.routeRevision,
        sequence: progress.sequence + 1,
        observedAt: new Date(Date.parse(observedAt) + progress.sequence * 1_000).toISOString(),
        source: "MANUAL",
    });
}

describe("journeyPresentation", () => {
    it("원본 노선·방면·승강장·환승 위치로 결정론적 안내 문구를 만든다", () => {
        const legs: TransitLegDetail[] = [
            {
                kind: "BUS",
                label: "버스",
                lineName: "31번",
                directionName: "판교역 방면",
                startName: "푸른마을 정류장",
                endName: "판교역 정류장",
                boardingPlatform: "2번 승강장",
                recommendedTransferPosition: "앞문",
            },
        ];
        const route = normalizeJourneyRoute(legs);
        let progress = createInitialJourneyProgress(
            { sessionId: "presentation", generation: 1, routeRevision: 1 },
            route,
            observedAt,
        );

        expect(getNextManualActionLabel(progress, route)).toBe("길안내 시작");
        progress = next(progress, route);
        expect(progress.nextInstruction).toContain("푸른마을 정류장 2번 승강장에서");
        expect(progress.nextInstruction).toContain("31번 판교역 방면");
        expect(getNextManualActionLabel(progress, route)).toBe("탑승했어요");
        progress = next(progress, route);
        expect(progress.nextInstruction).toBe("판교역 정류장에서 하차할 준비를 하세요.");
        expect(getNextManualActionLabel(progress, route)).toBe("하차 준비");
        progress = next(progress, route);
        expect(progress.nextInstruction).toBe("판교역 정류장 앞문 위치에서 하차하세요.");
        expect(getNextManualActionLabel(progress, route)).toBe("하차했어요");
        progress = next(progress, route);
        expect(progress.nextInstruction).toBe("목적지에 도착했습니다.");
        expect(getNextManualActionLabel(progress, route)).toBeNull();
    });

    it("환승과 최종 도보의 action label을 실제 다음 leg에 맞춘다", () => {
        const route = normalizeJourneyRoute([
            { kind: "BUS", label: "버스", startName: "A", endName: "B" },
            { kind: "WALK", label: "환승 도보", startName: "B", endName: "C" },
            { kind: "SUBWAY", label: "지하철", startName: "C", endName: "D" },
            { kind: "WALK", label: "최종 도보", startName: "D", endName: "목적지" },
        ]);
        let progress = createInitialJourneyProgress(
            { sessionId: "labels", generation: 1, routeRevision: 1 },
            route,
            observedAt,
        );

        progress = next(progress, route); // WAITING
        progress = next(progress, route); // RIDING
        progress = next(progress, route); // ALIGHTING
        progress = next(progress, route); // TRANSFERRING
        expect(progress.activeLegIndex).toBe(1);
        expect(progress.nextInstruction).toBe("C까지 환승 이동하세요.");
        expect(getNextManualActionLabel(progress, route)).toBe("환승 지점 도착");

        progress = next(progress, route); // WAITING subway
        progress = next(progress, route); // RIDING subway
        progress = next(progress, route); // ALIGHTING subway
        progress = next(progress, route); // FINAL_WALK
        expect(progress.activeLegIndex).toBe(3);
        expect(progress.nextInstruction).toBe("목적지까지 걸어가세요.");
        expect(getNextManualActionLabel(progress, route)).toBe("목적지 도착");
    });
});

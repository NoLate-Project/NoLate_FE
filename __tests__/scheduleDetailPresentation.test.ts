import {
    buildDepartureParticipantPresentations,
    getDepartureOverview,
    getScheduleCountdownPresentation,
    getScheduleDetailSheetHeights,
} from "../src/modules/schedule/detailPresentation";
import { createQaScheduleItem } from "../src/modules/schedule/qaSamples";

const participants = [
    { memberId: 101, email: "owner@nolate.test", role: "OWNER" as const, departed: false },
    { memberId: 102, email: "yuna@nolate.test", role: "SHARED" as const, departed: true },
    { memberId: 103, email: "minsu@nolate.test", role: "SHARED" as const, departed: false },
    { memberId: 104, email: null, role: "SHARED" as const, departed: false },
];

describe("schedule detail presentation", () => {
    it("builds compact participant labels and marks the current member", () => {
        expect(buildDepartureParticipantPresentations(participants, 101)).toEqual([
            expect.objectContaining({ memberId: 101, label: "나", avatarLabel: "나", isMe: true }),
            expect.objectContaining({ memberId: 102, label: "yuna", avatarLabel: "Y", isMe: false }),
            expect.objectContaining({ memberId: 103, label: "minsu", avatarLabel: "M", isMe: false }),
            expect.objectContaining({ memberId: 104, label: "참여자 3", avatarLabel: "참", isMe: false }),
        ]);
    });

    it("summarizes the first departed participant for the collapsed sheet", () => {
        expect(getDepartureOverview(participants, 101)).toEqual({
            departedCount: 1,
            totalCount: 4,
            movingLabel: "yuna 이동 중",
        });
    });

    it("uses stable compact, middle, and expanded sheet heights", () => {
        expect(getScheduleDetailSheetHeights(874)).toEqual({
            minHeight: 127,
            midHeight: 367,
            maxHeight: 629,
        });
    });

    it("presents a live schedule countdown before and during an event", () => {
        const nowMs = new Date("2026-07-15T09:00:00+09:00").getTime();
        const startAtMs = nowMs + (((5 * 60 * 60) + (7 * 60) + 9) * 1000);
        const endAtMs = startAtMs + (45 * 60 * 1000);

        expect(getScheduleCountdownPresentation(startAtMs, endAtMs, nowMs)).toEqual({
            phase: "upcoming",
            label: "일정까지",
            compactValue: "05:07:09",
            detailValue: "5시간 7분 09초",
        });
        expect(getScheduleCountdownPresentation(startAtMs, endAtMs, startAtMs + (10 * 60 * 1000))).toEqual({
            phase: "active",
            label: "종료까지",
            compactValue: "00:35:00",
            detailValue: "35분 00초",
        });
        expect(getScheduleCountdownPresentation(startAtMs, endAtMs, endAtMs)).toEqual({
            phase: "ended",
            label: "일정 상태",
            compactValue: "종료",
            detailValue: "종료된 일정이에요",
        });
    });

    it("keeps the shared-schedule QA route in the same shape as a persisted route", () => {
        const item = createQaScheduleItem(new Date("2026-07-13T00:00:00+09:00"));
        const route = item.route as {
            mode?: string;
            minutes?: number;
            transitLegs?: unknown[];
            routeInfo?: { steps?: unknown[] };
        };

        expect(route).toEqual(expect.objectContaining({
            mode: "TRANSIT",
            minutes: 32,
            transitLegs: expect.any(Array),
            routeInfo: expect.objectContaining({ steps: expect.any(Array) }),
        }));
        expect(route.transitLegs).toHaveLength(4);
        expect(route.routeInfo?.steps).toHaveLength(6);
    });

    it("keeps the QA schedule upcoming after today's sample event has ended", () => {
        const now = new Date("2026-07-13T23:00:00+09:00");
        const item = createQaScheduleItem(now);

        expect(new Date(item.startAt).getTime()).toBeGreaterThan(now.getTime());
        expect(new Date(item.endAt).getTime() - new Date(item.startAt).getTime()).toBe(45 * 60 * 1000);
    });
});

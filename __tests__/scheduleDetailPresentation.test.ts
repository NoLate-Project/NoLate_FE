import {
    buildDepartureParticipantPresentations,
    getDepartureOverview,
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
            minHeight: 140,
            midHeight: 367,
            maxHeight: 629,
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
});

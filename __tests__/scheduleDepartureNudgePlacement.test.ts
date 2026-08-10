const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const inboxSource = readFileSync("app/share/inbox.tsx", "utf8");
const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");

describe("schedule departure nudge placement", () => {
    test("sharing membership management does not expose a departure nudge action", () => {
        expect(inboxSource).not.toContain("sendScheduleDepartureNudge");
        expect(inboxSource).not.toContain("에게 출발 알림 보내기");
    });

    test("waiting participant profile owns the nudge interaction with a compact bell badge", () => {
        const start = detailSource.indexOf("const renderDepartureParticipantChips");
        const end = detailSource.indexOf("const renderTravelPlanRows", start);
        const participantProfiles = detailSource.slice(start, end);

        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expect(participantProfiles).toContain("onPress={() => confirmDepartureNudge(participant.memberId, participant.label)}");
        expect(participantProfiles).toContain('name="notifications"');
        expect(participantProfiles).toContain("프로필을 누르면 해당 참가자의 기기로 출발 확인 푸시를 보냅니다.");
    });

    test("shared people line uses the compact schedule mockup wording", () => {
        expect(detailSource).toContain("함께하는 사람 {departureParticipants.length}");
        expect(detailSource).toContain("{departureCountLabel} 출발");
        expect(detailSource).not.toContain("{departureOverview.movingLabel} · {departureCountLabel} 출발");
    });
});

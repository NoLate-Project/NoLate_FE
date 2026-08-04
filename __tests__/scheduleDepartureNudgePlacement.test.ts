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

    test("waiting participant profile owns the nudge interaction without a bell button", () => {
        const start = detailSource.indexOf("const renderDepartureParticipantChips");
        const end = detailSource.indexOf("const renderTravelPlanRows", start);
        const participantProfiles = detailSource.slice(start, end);

        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expect(participantProfiles).toContain("대기 중인 참여자 프로필을 눌러 출발 확인을 요청하세요.");
        expect(participantProfiles).toContain("onPress={() => confirmDepartureNudge(participant.memberId, participant.label)}");
        expect(participantProfiles).not.toContain('name="notifications-outline"');
    });
});

import type { ScheduleDepartureParticipant } from "./types";

export type DepartureParticipantPresentation = ScheduleDepartureParticipant & {
    avatarLabel: string;
    isMe: boolean;
    label: string;
};

export function buildDepartureParticipantPresentations(
    participants: ScheduleDepartureParticipant[],
    currentMemberId: number | null
): DepartureParticipantPresentation[] {
    const sharedParticipantNumbers = new Map(
        participants
            .filter((participant) => participant.role === "SHARED")
            .map((participant, index) => [participant.memberId, index + 1])
    );

    return participants.map((participant) => {
        const isMe = participant.memberId === currentMemberId;
        const accountLabel = participant.email?.split("@")[0]?.trim();
        const label = isMe
            ? "나"
            : accountLabel
                || (participant.role === "OWNER"
                    ? "오너"
                    : `참여자 ${sharedParticipantNumbers.get(participant.memberId) ?? ""}`.trim());

        return {
            ...participant,
            isMe,
            label,
            avatarLabel: isMe ? "나" : label.slice(0, 1).toUpperCase(),
        };
    });
}

export function getDepartureOverview(
    participants: ScheduleDepartureParticipant[],
    currentMemberId: number | null
) {
    const presentations = buildDepartureParticipantPresentations(participants, currentMemberId);
    const departed = presentations.filter((participant) => participant.departed);
    const movingParticipant = departed.find((participant) => !participant.isMe) ?? departed[0];

    return {
        departedCount: departed.length,
        totalCount: participants.length,
        movingLabel: movingParticipant ? `${movingParticipant.label} 이동 중` : "아직 출발 전",
    };
}

export function getScheduleDetailSheetHeights(windowHeight: number) {
    const minHeight = Math.max(138, Math.round(windowHeight * 0.16));
    const midHeight = Math.max(340, Math.round(windowHeight * 0.42));
    const maxHeight = Math.max(midHeight, Math.round(windowHeight * 0.72));

    return { minHeight, midHeight, maxHeight };
}

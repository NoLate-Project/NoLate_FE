import type { ScheduleDepartureParticipant } from "./types";

const SCHEDULE_DETAIL_COMPACT_BOTTOM_GUTTER = 20;
const SCHEDULE_DETAIL_COMPACT_HEIGHT_SCALE = 1.15;

export type DepartureParticipantPresentation = ScheduleDepartureParticipant & {
    avatarLabel: string;
    isMe: boolean;
    label: string;
};

export type ScheduleCountdownPresentation = {
    phase: "upcoming" | "active" | "ended";
    label: string;
    compactValue: string;
    detailValue: string;
};

export function resolveScheduleCountdownEndAt(options: {
    startAtMs: number;
    endAtMs?: number;
    hasEndTime: boolean;
    allDay?: boolean;
}): number | undefined {
    const { startAtMs, endAtMs, hasEndTime, allDay } = options;
    if (!allDay) return hasEndTime ? endAtMs : undefined;
    if (typeof endAtMs === "number" && endAtMs > startAtMs) return endAtMs;

    const nextDay = new Date(startAtMs);
    nextDay.setHours(0, 0, 0, 0);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.getTime();
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function formatCountdownValues(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86_400);
    const totalHours = Math.floor(totalSeconds / 3_600);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    const compactValue = days > 0
        ? `${days}일 ${pad2(hours)}:${pad2(minutes)}`
        : `${pad2(totalHours)}:${pad2(minutes)}:${pad2(seconds)}`;
    const detailParts = [
        days > 0 ? `${days}일` : undefined,
        (days > 0 || hours > 0) ? `${hours}시간` : undefined,
        `${minutes}분`,
        `${pad2(seconds)}초`,
    ].filter(Boolean);

    return { compactValue, detailValue: detailParts.join(" ") };
}

export function getScheduleCountdownPresentation(
    startAtMs: number,
    endAtMs: number | undefined,
    nowMs: number
): ScheduleCountdownPresentation {
    if (nowMs < startAtMs) {
        return {
            phase: "upcoming",
            label: "일정까지",
            ...formatCountdownValues(startAtMs - nowMs),
        };
    }

    if (typeof endAtMs === "number" && endAtMs > startAtMs && nowMs < endAtMs) {
        return {
            phase: "active",
            label: "종료까지",
            ...formatCountdownValues(endAtMs - nowMs),
        };
    }

    return {
        phase: "ended",
        label: "일정 상태",
        compactValue: "종료",
        detailValue: "종료된 일정이에요",
    };
}

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

/**
 * 출발 확인 푸시는 일정 오너가 아직 출발하지 않은 다른 공유 참가자에게만 보낼 수 있다.
 * 서버 권한 검증이 최종 방어선이지만, 화면에서도 같은 정책을 사용해 실행 불가능한 버튼이
 * 잠깐 보이거나 오너 정보가 아직 로드되지 않은 상태에서 요청되는 일을 막는다.
 */
export function canSendDepartureNudge(
    participant: ScheduleDepartureParticipant,
    currentMemberId: number | null,
    ownerMemberId?: number
): boolean {
    if (typeof ownerMemberId !== "number" || currentMemberId !== ownerMemberId) return false;

    return participant.role === "SHARED"
        && participant.memberId !== currentMemberId
        && !participant.departed;
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
    const compactBaseHeight = Math.max(124, Math.round(windowHeight * 0.145));
    const midHeight = Math.max(340, Math.round(windowHeight * 0.42));
    const contentFitMaxHeight = Math.min(
        680,
        Math.max(460, Math.round(windowHeight * 0.72))
    );
    const maxHeight = Math.max(midHeight, contentFitMaxHeight);
    // Keep the compact summary anchored to the bottom while lifting its top
    // edge by 15%. The existing 20pt gutter remains part of the visible bar.
    const minHeight = Math.min(
        maxHeight - 1,
        Math.round(
            (compactBaseHeight + SCHEDULE_DETAIL_COMPACT_BOTTOM_GUTTER)
                * SCHEDULE_DETAIL_COMPACT_HEIGHT_SCALE
        )
    );

    return { minHeight, midHeight, maxHeight };
}

import type { MemberDto } from "../../api/member";

export type AuthenticatedMember = MemberDto & {
    id: number;
    accessToken: string;
    refreshToken: string;
};

export function requireAuthenticatedMember(member: MemberDto): AuthenticatedMember {
    if (
        !Number.isSafeInteger(member.id) ||
        (member.id ?? 0) <= 0 ||
        !member.accessToken?.trim() ||
        !member.refreshToken?.trim()
    ) {
        throw new Error("로그인 정보를 안전하게 확인하지 못했어요. 다시 시도해 주세요.");
    }

    return member as AuthenticatedMember;
}

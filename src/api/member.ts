import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";

const CURATION_STATUS_BOOTSTRAP_TIMEOUT_MS = 3_500;

export type LoginType = "COMMON" | "KAKAO" | "GOOGLE" | "APPLE" | "NAVER";
export type SocialLoginType = "KAKAO" | "APPLE" | "NAVER";

export type MemberDto = {
    id?: number;
    name?: string;
    email?: string;
    loginType?: LoginType;
    snsId?: string;
    accessToken?: string;
    refreshToken?: string;
    isNewMember?: boolean;
    curationCompleted?: boolean;
};

export type CurationStatusDto = {
    curationCompleted: boolean;
};

export type SignupConsentsPayload = {
    termsVersion: string;
    privacyCollectionVersion: string;
    termsAgreed: boolean;
    privacyCollectionAgreed: boolean;
};

type SignUpPayload = {
    email: string;
    password: string;
    name: string;
    consents: SignupConsentsPayload;
};

type LoginPayload = {
    email: string;
    password: string;
};

export type SnsLoginPayload = {
    loginType: SocialLoginType;
    providerToken: string;
    authorizationCode?: string;
    nonce?: string;
};

type SnsRegistrationPayload = SnsLoginPayload;

type SnsRegistrationStatusDto = {
    registered: boolean;
};

type SnsSignUpPayload = SnsLoginPayload & {
    consents: SignupConsentsPayload;
};

type TokenLoginPayload = {
    refreshToken: string;
};

export type MemberProfileDto = {
    id?: number | null;
    memberId: number;
    nickname?: string | null;
    imgId?: number | null;
    intro?: string | null;
};

export type UpdateProfilePayload = {
    nickname?: string | null;
    imgId?: number | null;
    intro?: string | null;
};

export type ChangePasswordPayload = {
    currentPassword: string;
    newPassword: string;
};

export type WithdrawPayload = {
    password?: string | null;
};

export async function signUpMember(payload: SignUpPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, SignUpPayload>("/api/member/auth/sign-up", payload);
    return unwrapApiResponse(response);
}

export async function loginMember(payload: LoginPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, LoginPayload>("/api/member/auth/login", payload);
    return unwrapApiResponse(response);
}

export async function snsLoginMember(payload: SnsLoginPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, SnsLoginPayload>("/api/member/auth/sns-login", payload);
    return unwrapApiResponse(response);
}

export async function getSnsRegistrationStatus(
    payload: SnsRegistrationPayload
): Promise<SnsRegistrationStatusDto> {
    const response = await apiPost<ApiEnvelope<SnsRegistrationStatusDto>, SnsRegistrationPayload>(
        "/api/member/auth/sns-registration",
        payload
    );
    return unwrapApiResponse(response);
}

export async function snsSignUpMember(payload: SnsSignUpPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, SnsSignUpPayload>(
        "/api/member/auth/sns-sign-up",
        payload
    );
    return unwrapApiResponse(response);
}


export async function tokenLoginMember(payload: TokenLoginPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, TokenLoginPayload>("/api/member/auth/token-login", payload);
    return unwrapApiResponse(response);
}

export async function refreshMemberToken(payload: TokenLoginPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, TokenLoginPayload>("/api/member/auth/refresh", payload);
    return unwrapApiResponse(response);
}

export async function logoutMember(payload: TokenLoginPayload): Promise<void> {
    const response = await apiPost<ApiEnvelope<unknown>, TokenLoginPayload>("/api/member/auth/logout", payload);
    assertApiSuccess(response);
}

export async function getMemberCurationStatus(): Promise<CurationStatusDto> {
    const response = await apiGet<ApiEnvelope<CurationStatusDto>>("/api/member/curation", {
        timeout: CURATION_STATUS_BOOTSTRAP_TIMEOUT_MS,
    });
    return unwrapApiResponse(response);
}

export async function completeMemberCuration(): Promise<CurationStatusDto> {
    const response = await apiPatch<ApiEnvelope<CurationStatusDto>>("/api/member/curation/complete");
    return unwrapApiResponse(response);
}

export async function getMyProfile(): Promise<MemberProfileDto> {
    const response = await apiGet<ApiEnvelope<MemberProfileDto>>("/api/member/profile");
    return unwrapApiResponse(response);
}

export async function updateMyProfile(payload: UpdateProfilePayload): Promise<MemberProfileDto> {
    const response = await apiPut<ApiEnvelope<MemberProfileDto>, UpdateProfilePayload>("/api/member/profile", payload);
    return unwrapApiResponse(response);
}

export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
    const response = await apiPatch<ApiEnvelope<unknown>, ChangePasswordPayload>("/api/member/password", payload);
    assertApiSuccess(response);
}

export async function withdrawMember(
    payload: WithdrawPayload | undefined,
    accountExit: { accessToken: string | null },
): Promise<void> {
    const accessToken = accountExit.accessToken?.trim();
    if (!accessToken) {
        throw new Error("회원탈퇴 요청의 인증 snapshot을 확인하지 못했습니다.");
    }
    const response = await apiDelete<ApiEnvelope<unknown>>("/api/member/withdraw", {
        data: payload ?? {},
        _allowDuringAccountExit: true,
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    assertApiSuccess(response);
}

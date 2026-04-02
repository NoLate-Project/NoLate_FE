import { apiPost } from "./api";
import { type ApiEnvelope, unwrapApiResponse } from "./response";

export type LoginType = "COMMON" | "KAKAO" | "GOOGLE" | "APPLE" | "NAVER";

export type MemberDto = {
    id?: number;
    name?: string;
    email?: string;
    loginType?: LoginType;
    snsId?: string;
    accessToken?: string;
    refreshToken?: string;
};

type SignUpPayload = {
    email: string;
    password: string;
    name: string;
};

type LoginPayload = {
    email: string;
    password: string;
};

type SnsLoginPayload = {
    loginType: Exclude<LoginType, "COMMON">;
    snsId: string;
    email?: string;
    name: string;
};

type TokenLoginPayload = {
    refreshToken: string;
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


export async function tokenLoginMember(payload: TokenLoginPayload): Promise<MemberDto> {
    const response = await apiPost<ApiEnvelope<MemberDto>, TokenLoginPayload>("/api/member/auth/token-login", payload);
    return unwrapApiResponse(response);
}

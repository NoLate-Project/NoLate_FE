import { requireAuthenticatedMember } from "../src/modules/auth/authenticatedMember";

describe("authenticated member contract", () => {
    test("회원 식별자와 두 인증 토큰이 모두 있어야 로그인 완료로 처리한다", () => {
        expect(requireAuthenticatedMember({
            id: 7,
            accessToken: "access",
            refreshToken: "refresh",
        })).toMatchObject({ id: 7 });

        expect(() => requireAuthenticatedMember({ id: 7, refreshToken: "refresh" })).toThrow();
        expect(() => requireAuthenticatedMember({ id: 7, accessToken: "access" })).toThrow();
        expect(() => requireAuthenticatedMember({ accessToken: "access", refreshToken: "refresh" })).toThrow();
    });
});

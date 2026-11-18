import {
    getSignupFieldErrors,
    isValidSignupEmail,
    isValidSignupName,
    normalizeSignupEmail,
} from "../src/modules/auth/signupValidation";

describe("signup validation", () => {
    test("returns the errors for all invalid fields in one pass", () => {
        expect(getSignupFieldErrors({ name: "", email: "wrong", password: "short", confirmation: "" })).toEqual({
            name: "이름을 입력해 주세요.",
            email: "올바른 이메일 주소를 입력해 주세요.",
            password: "영문, 숫자, !@#$%^&* 조합으로 8~16자를 입력해 주세요.",
            confirmation: "비밀번호를 한 번 더 입력해 주세요.",
        });
        expect(getSignupFieldErrors({
            name: "홍길동", email: "  USER@Example.COM ", password: "Example!1", confirmation: "Example!1",
        })).toEqual({});
    });

    test("normalizes email casing and surrounding whitespace", () => {
        expect(normalizeSignupEmail("  USER@Example.COM ")).toBe("user@example.com");
    });

    test.each([
        "user@example.com",
        "person.name+calendar@sub.example.co.kr",
    ])("accepts a usable email address: %s", (email) => {
        expect(isValidSignupEmail(email)).toBe(true);
    });

    test.each([
        "",
        "user",
        "user@",
        "@example.com",
        "user @example.com",
    ])("rejects an incomplete email address: %s", (email) => {
        expect(isValidSignupEmail(email)).toBe(false);
    });

    test("rejects empty, overlong, or control-character names", () => {
        expect(isValidSignupName("홍길동")).toBe(true);
        expect(isValidSignupName("   ")).toBe(false);
        expect(isValidSignupName("가".repeat(21))).toBe(false);
        expect(isValidSignupName("홍\n길동")).toBe(false);
    });
});

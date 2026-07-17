import {
    isValidSignupEmail,
    isValidSignupName,
    normalizeSignupEmail,
} from "../src/modules/auth/signupValidation";

describe("signup validation", () => {
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

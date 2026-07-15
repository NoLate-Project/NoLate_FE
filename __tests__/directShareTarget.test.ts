import { createDirectShareTarget } from "../src/modules/share/directShareTarget";

describe("direct share target", () => {
    test.each([
        ["92", { targetAppId: 92 }],
        ["#92", { targetAppId: 92 }],
        ["회원 #92", { targetAppId: 92 }],
    ])("프로필 회원 번호를 앱 ID payload로 바꾼다: %s", (input, expected) => {
        expect(createDirectShareTarget(input)).toEqual(expected);
    });

    test("이메일은 공백과 대소문자를 정규화한다", () => {
        expect(createDirectShareTarget(" Friend@Example.com ")).toEqual({
            targetEmail: "friend@example.com",
        });
    });

    test.each(["", "회원", "#0", "friend@invalid", "12.5"])("모호한 대상을 거절한다: %s", (input) => {
        expect(() => createDirectShareTarget(input)).toThrow();
    });
});

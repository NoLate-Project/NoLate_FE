import {
    getAppleRevocationNotice,
} from "../src/modules/auth/appleRevocationNotice";

describe("Apple revocation notice", () => {
    test("Apple revoke를 서버가 보장하지 못한 경우에만 signed-out 안내를 만든다", () => {
        expect(getAppleRevocationNotice(
            "APPLE",
            { manualAppleRevocationRequired: true },
        )).toEqual({
            title: "Apple 연결 해제 안내",
            message: expect.stringContaining("Apple로 로그인"),
        });
    });

    test.each([
        ["APPLE", false],
        ["COMMON", true],
        ["KAKAO", true],
        ["NAVER", true],
    ] as const)(
        "%s 계정과 manual=%s 조합은 불필요한 Apple 안내를 만들지 않는다",
        (loginType, manualAppleRevocationRequired) => {
            expect(getAppleRevocationNotice(
                loginType,
                { manualAppleRevocationRequired },
            )).toBeUndefined();
        },
    );
});

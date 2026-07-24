const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

describe("iOS share extension auth invalidation contract", () => {
    const source = readFileSync(
        "ios/NoLateShareExtension/ShareViewController.swift",
        "utf8",
    );

    test("durable invalid-session marker blocks stored session and requests", () => {
        expect(source).toContain(
            'private let invalidSessionKey = "nolate_auth_invalid_session"',
        );
        expect(source).toMatch(
            /var isLoggedIn: Bool \{\s+guard !isSessionInvalidated else \{ return false \}/,
        );
        expect(source).toMatch(
            /async throws -> Value \{\s+guard !isSessionInvalidated else \{/,
        );
    });

    test("refresh response cannot overwrite a newer account token", () => {
        expect(source).toContain(
            "normalizedCredential(readKeychain(refreshTokenKey)) == refreshToken",
        );
        expect(source).toContain(
            "accessToken = normalizedCredential(readKeychain(accessTokenKey))",
        );
    });
});

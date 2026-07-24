const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

describe("iOS share extension auth invalidation contract", () => {
    const source = readFileSync(
        "ios/NoLateShareExtension/ShareViewController.swift",
        "utf8",
    );
    const nativeAuthSource = readFileSync(
        "ios/NoLateFE/NoLateShareAuthModule.m",
        "utf8",
    );

    test("Keychain과 독립 App Group 상태를 모두 확인해야 workflow를 시작한다", () => {
        expect(source).toContain(
            'private let invalidSessionKey = "nolate_auth_invalid_session"',
        );
        expect(source).toContain(
            'private let appGroupSessionStateKey = "nolate_auth_session_state"',
        );
        expect(source).toContain(
            'private let noLateSharedAppGroup = "group.com.anonymous.nolatefe.shared"',
        );
        expect(source).toMatch(/func captureWorkflowSession\(\) -> ShareWorkflowSession\?/);
        expect(source).toContain("readAppGroupSessionStateStrict()");
        expect(source).toContain("readKeychainStrict(invalidSessionKey)");
    });

    test("workflow generation을 매 요청·응답·최종 저장 전에 재검증한다", () => {
        expect(source.match(/isWorkflowCurrent\(workflow\)/g)?.length)
            .toBeGreaterThanOrEqual(7);
        expect(source).toContain(
            "guard let workflow = api.captureWorkflowSession()",
        );
        expect(source).toContain("workflow: workflow");
    });

    test("workflow access JWT를 고정하고 signed sg generation을 Authorization으로 전송한다", () => {
        expect(source).toContain("let accessToken: String");
        expect(source).toContain("accessToken: accessToken");
        expect(source).toContain(
            '"Bearer \\(workflow.accessToken)"',
        );
        expect(source).toContain(
            'forHTTPHeaderField: "Authorization"',
        );
        expect(source).toContain(
            "server-signed access JWT `sg` generation",
        );
        expect(source).not.toContain(
            "let token = normalizedCredential(storedAccessToken)",
        );
    });

    test("rotating refresh token을 소비하거나 갱신 자격을 저장하지 않는다", () => {
        expect(source).not.toContain("ShareTokenRefreshCoordinator");
        expect(source).not.toContain("refreshTokens(");
        expect(source).not.toContain("api/member/auth/refresh");
        expect(source).not.toContain("retrying:");
        expect(source).not.toMatch(/writeKeychain\(|SecItemUpdate\(|SecItemAdd\(/);
    });

    test("access 401은 재시도·후속 저장 없이 앱 재로그인 안내로 종료한다", () => {
        expect(source).toMatch(
            /if http\.statusCode == 401 \{[\s\S]*?throw ShareAPIError\.loginRequired\s+\}/,
        );
        expect(source).not.toMatch(
            /if http\.statusCode == 401 \{[\s\S]*?(?:self\.)?request\(/,
        );
        expect(source).toContain("NoLate 앱에서 다시 로그인해 주세요");
        expect(source).toContain("앱을 연 뒤 로그인하고 다시 공유해 주세요.");
        expect(source).toMatch(
            /let \(parsed, categories\) = try await \(parsedValue, categoryValues\)[\s\S]*?let _: SavedSchedule = try await api\.post/,
        );
    });

    test("Keychain absent와 read/invalid-data failure를 구분해 failure를 차단한다", () => {
        expect(source).toContain("private enum StrictStoredValue");
        expect(source).toContain("if status == errSecItemNotFound { continue }");
        expect(source).toMatch(
            /guard status == errSecSuccess,[\s\S]*?else \{\s+return \.failure/,
        );
        expect(source).toContain("guard let value = raw as? String else { return .failure }");
    });

    test("Expo와 native writer가 같은 신규 Keychain row를 경쟁해도 duplicate Add를 Update로 수렴한다", () => {
        expect(nativeAuthSource).toMatch(
            /status = SecItemAdd\([\s\S]*?if \(status == errSecDuplicateItem\) \{[\s\S]*?status = SecItemUpdate\(/,
        );
        expect(nativeAuthSource).toContain(
            "NSMutableDictionary *addQuery = [query mutableCopy]",
        );
    });

    test("App Group active 공개는 sync CAS이며 실패하면 invalidated rollback을 시도한다", () => {
        expect(nativeAuthSource).toContain(
            "RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(setAppGroupSessionStateSync:",
        );
        expect(nativeAuthSource).toContain(
            "RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(beginAppGroupSessionTransitionSync:",
        );
        expect(nativeAuthSource).toContain(
            "RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(compareAndSetAppGroupSessionStateSync:",
        );
        expect(nativeAuthSource).toMatch(
            /compareAndSetAppGroupSessionStateSync:[\s\S]*?if \(!\[\(NSString \*\)currentValue isEqualToString:expectedValue\]\)[\s\S]*?writeAppGroupSessionStateSynchronously:value[\s\S]*?writeAppGroupSessionStateSynchronously:@"invalidated"/,
        );
        expect(nativeAuthSource).toContain('@"status": @"mismatch"');
        expect(nativeAuthSource).toContain('@"status": @"partial"');
        expect(nativeAuthSource).toContain('@"status": @"failure"');
        expect(nativeAuthSource).toContain(
            'hasPrefix:@"publishing:"',
        );
        const mismatchBranch = nativeAuthSource.match(
            /if \(!\[\(NSString \*\)currentValue isEqualToString:expectedValue\]\) \{([\s\S]*?)\n {2}\}/,
        )?.[1];
        expect(mismatchBranch).toContain('@"status": @"mismatch"');
        expect(mismatchBranch).not.toContain(
            "writeAppGroupSessionStateSynchronously",
        );
    });
});

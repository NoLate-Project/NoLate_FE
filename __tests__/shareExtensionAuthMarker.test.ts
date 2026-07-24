const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

describe("iOS share extension auth invalidation contract", () => {
    const source = readFileSync(
        "ios/NoLateShareExtension/ShareViewController.swift",
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

    test("refresh는 generation+refresh identity로 dedupe하고 Keychain에 쓰지 않는다", () => {
        expect(source).toContain(
            '"\\(workflow.generation):\\(sessionIdentity(workflow.refreshToken))"',
        );
        expect(source).toContain("refreshCoordinator.refresh(key: refreshKey");
        expect(source).toContain("refreshCoordinator.cachedTokens");
        expect(source).not.toMatch(/writeKeychain\(|SecItemUpdate\(|SecItemAdd\(/);
    });

    test("Keychain absent와 read/invalid-data failure를 구분해 failure를 차단한다", () => {
        expect(source).toContain("private enum StrictStoredValue");
        expect(source).toContain("if status == errSecItemNotFound { continue }");
        expect(source).toMatch(
            /guard status == errSecSuccess,[\s\S]*?else \{\s+return \.failure/,
        );
        expect(source).toContain("guard let value = raw as? String else { return .failure }");
    });
});

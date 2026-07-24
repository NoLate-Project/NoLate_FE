const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};
const {
    buildSettingsFor,
    verifyIosTargetConfigurationPolicy,
} = require("../scripts/lib/pbx-target-config.cjs") as {
    buildSettingsFor: (
        source: string,
        target: string,
        configuration: string,
    ) => Record<string, string>;
    verifyIosTargetConfigurationPolicy: (
        source: string,
        buildNumber: string,
    ) => unknown;
};

export {};

describe("iOS target/configuration release policy", () => {
    const project = readFileSync(
        "ios/NoLateFE.xcodeproj/project.pbxproj",
        "utf8",
    );

    test("app config 45를 main·extension·test Debug/Release 정책에 적용한다", () => {
        expect(() =>
            verifyIosTargetConfigurationPolicy(project, "45")
        ).not.toThrow();
        expect(buildSettingsFor(project, "NoLateFE", "Release"))
            .toMatchObject({
                CURRENT_PROJECT_VERSION: "45",
                CODE_SIGN_ENTITLEMENTS:
                    "NoLateFE/NoLateFE.entitlements",
            });
        expect(buildSettingsFor(
            project,
            "NoLateShareExtension",
            "Release",
        )).toMatchObject({
            CURRENT_PROJECT_VERSION: "45",
            CODE_SIGN_ENTITLEMENTS:
                "NoLateShareExtension/NoLateShareExtension.entitlements",
        });
        expect(buildSettingsFor(project, "NoLateFETests", "Release"))
            .not.toHaveProperty("CODE_SIGN_ENTITLEMENTS");
    });

    test("다른 target의 45 decoy가 extension Release 불일치를 숨기지 못한다", () => {
        const mismatched = project.replace(
            /(E10000000000000000000032 \/\* Release \*\/ = \{[\s\S]*?CURRENT_PROJECT_VERSION = )45;/,
            "$142;",
        ) + "\n/* decoy */ CURRENT_PROJECT_VERSION = 45;\n".repeat(8);

        expect(() =>
            verifyIosTargetConfigurationPolicy(mismatched, "45")
        ).toThrow(
            "NoLateShareExtension/Release CURRENT_PROJECT_VERSION must be 45, got 42",
        );
    });

    test("다른 config의 entitlement 문자열이 main Release 오연결을 숨기지 못한다", () => {
        const mismatched = project.replace(
            /(13B07F951A680F5B00A75B9A \/\* Release \*\/ = \{[\s\S]*?CODE_SIGN_ENTITLEMENTS = )NoLateFE\/NoLateFE\.entitlements;/,
            "$1NoLateShareExtension/NoLateShareExtension.entitlements;",
        );

        expect(() =>
            verifyIosTargetConfigurationPolicy(mismatched, "45")
        ).toThrow(
            "NoLateFE/Release CODE_SIGN_ENTITLEMENTS must be NoLateFE/NoLateFE.entitlements",
        );
    });
});

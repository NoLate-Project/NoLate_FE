type LiveActivityPluginInternals = {
    liveActivityBundleIdentifier(config: { ios?: { bundleIdentifier?: string } }): string;
    appendingSwiftCompilationCondition(existing: unknown, condition: string): string;
};

const plugin = require("../plugins/withNoLateLiveActivity") as {
    __internal: LiveActivityPluginInternals;
};

describe("Live Activity config plugin policy", () => {
    test("derives the extension bundle identifier from the configured app identifier", () => {
        expect(plugin.__internal.liveActivityBundleIdentifier({
            ios: { bundleIdentifier: "dev.jinuk.nolate" },
        })).toBe("dev.jinuk.nolate.live-activity");
        expect(() => plugin.__internal.liveActivityBundleIdentifier({ ios: {} }))
            .toThrow("bundleIdentifier");
    });

    test("adds the app condition without deleting Debug or inherited conditions", () => {
        expect(plugin.__internal.appendingSwiftCompilationCondition(
            '"$(inherited) DEBUG CUSTOM_FLAG"',
            "NOLATE_LIVE_ACTIVITY_APP",
        )).toBe('"$(inherited) DEBUG CUSTOM_FLAG NOLATE_LIVE_ACTIVITY_APP"');
        expect(plugin.__internal.appendingSwiftCompilationCondition(
            '"$(inherited) DEBUG NOLATE_LIVE_ACTIVITY_APP"',
            "NOLATE_LIVE_ACTIVITY_APP",
        )).toBe('"$(inherited) DEBUG NOLATE_LIVE_ACTIVITY_APP"');
    });
});

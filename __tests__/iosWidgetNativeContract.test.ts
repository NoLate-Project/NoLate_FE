export {};

const fs = jest.requireActual("fs") as {
    readFileSync(filePath: string, encoding: string): string;
};

const read = (relativePath: string) => fs.readFileSync(relativePath, "utf8");

describe("iOS NoLate home widget native contract", () => {
    const appGroup = "group.com.anonymous.nolatefe";
    const snapshotKey = "nolate.widget.snapshot.v1";
    const widgetKind = "NoLateScheduleWidget";

    const appConfig = JSON.parse(read("app.json")) as {
        ios: { entitlements: Record<string, string[]> };
    };
    const appEntitlements = read("ios/NoLateFE/NoLateFE.entitlements");
    const widgetEntitlements = read("ios/NoLateWidget/NoLateWidget.entitlements");
    const widgetBundle = read("ios/NoLateWidget/NoLateWidgetBundle.swift");
    const widgetUI = read("ios/NoLateWidget/NoLateWidget.swift");
    const widgetSnapshot = read("ios/NoLateWidget/NoLateWidgetSnapshot.swift");
    const nativeBridge = read("ios/NoLateFE/NoLateWidgetModule.swift");
    const nativeBridgeExport = read("ios/NoLateFE/NoLateWidgetModule.m");
    const widgetInfo = read("ios/NoLateWidget/Info.plist");
    const privacyManifest = read("ios/NoLateWidget/PrivacyInfo.xcprivacy");
    const xcodeProject = read("ios/NoLateFE.xcodeproj/project.pbxproj");
    const widgetScheme = read(
        "ios/NoLateFE.xcodeproj/xcshareddata/xcschemes/NoLateWidget.xcscheme",
    );

    it("shares one versioned App Group snapshot contract between app and widget", () => {
        expect(
            appConfig.ios.entitlements["com.apple.security.application-groups"],
        ).toContain(appGroup);
        expect(appEntitlements).toContain(appGroup);
        expect(widgetEntitlements).toContain(appGroup);
        expect(widgetSnapshot).toContain(`appGroupIdentifier = "${appGroup}"`);
        expect(nativeBridge).toContain(`appGroupIdentifier = "${appGroup}"`);
        expect(widgetSnapshot).toContain(`snapshotKey = "${snapshotKey}"`);
        expect(nativeBridge).toContain(`snapshotKey = "${snapshotKey}"`);
        expect(widgetSnapshot).toContain("snapshot.version == 1");
        expect(nativeBridge).toContain("version.intValue == 1");
    });

    it("registers, embeds and reloads the WidgetKit extension", () => {
        expect(widgetBundle).toContain("@main");
        expect(widgetBundle).toContain(widgetKind);
        expect(widgetInfo).toContain("com.apple.widgetkit-extension");
        expect(xcodeProject).toContain("NoLateWidget.appex in Embed App Extensions");
        expect(xcodeProject).toContain("NoLateWidgetSnapshot.swift in Sources");
        expect(xcodeProject).toContain("NoLateWidgetModule.swift in Sources");
        expect(nativeBridge).toContain(`widgetKind = "${widgetKind}"`);
        expect(nativeBridge).toContain("WidgetCenter.shared.reloadTimelines");
        expect(nativeBridgeExport).toContain("RCT_EXTERN_MODULE(NoLateWidget, NSObject)");
        expect(nativeBridgeExport).toContain("writeSnapshot:");
        expect(nativeBridgeExport).toContain("clearSnapshot:");
    });

    it("runs the extension through SpringBoard for WidgetKit simulator debugging", () => {
        expect(widgetScheme).toContain("<RemoteRunnable");
        expect(widgetScheme).toContain('BundleIdentifier = "com.apple.springboard"');
        expect(widgetScheme).toContain('key = "_XCWidgetKind"');
        expect(widgetScheme).toContain(`value = "${widgetKind}"`);
        expect(widgetScheme).toContain('key = "_XCWidgetFamily"');
    });

    it("supports all designed families and opens the selected schedule", () => {
        expect(widgetUI).toContain(".systemSmall");
        expect(widgetUI).toContain(".systemMedium");
        expect(widgetUI).toContain(".systemLarge");
        expect(widgetSnapshot).toContain('components.scheme = "nolate"');
        expect(widgetSnapshot).toContain('components.host = "schedule"');
        expect(widgetSnapshot).toContain('components.path = "/\\(id)"');
    });

    it("uses inline dates and keeps the next schedule action at the bottom", () => {
        const largeWidget = widgetUI.slice(
            widgetUI.indexOf("private struct NoLateLargeWidget"),
            widgetUI.indexOf("private struct NoLateNextScheduleCard"),
        );
        const nextScheduleCard = widgetUI.slice(
            widgetUI.indexOf("private struct NoLateNextScheduleCard"),
            widgetUI.indexOf("private struct NoLateWidgetHeader"),
        );

        expect(widgetUI).not.toContain("NoLateDateBadge");
        expect(widgetUI).toContain("NoLateWidgetFormatting.eventDateTime");
        expect(largeWidget.indexOf("NoLateNextScheduleCard(schedule: nextSchedule")).toBeGreaterThan(
            largeWidget.indexOf("ForEach(Array(entry.schedules.prefix(3).enumerated())"),
        );
        expect(nextScheduleCard.match(/Text\("다음 일정"\)/g)).toHaveLength(1);
        expect(nextScheduleCard).toContain("Link(destination: deepLink) { cardContent }");
        expect(nextScheduleCard.indexOf('Text("다음 일정")')).toBeGreaterThan(
            nextScheduleCard.indexOf("NoLateDepartureLabel(schedule: schedule"),
        );
        expect(widgetUI).toContain('return "\\(dayLabel) · \\(timeLabel)"');
        expect(widgetUI).toContain("shortened: true");
        expect(widgetUI).toContain('return "\\(remainingMinutes)분 뒤 출발"');
    });

    it("declares the required-reason API used for the shared UserDefaults store", () => {
        expect(privacyManifest).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
        expect(privacyManifest).toContain("1C8F.1");
    });
});

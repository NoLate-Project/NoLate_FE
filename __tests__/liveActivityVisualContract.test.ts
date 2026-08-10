export {};

const fs = jest.requireActual("fs") as {
    readFileSync(filePath: string, encoding: string): string;
};

const read = (relativePath: string) => fs.readFileSync(relativePath, "utf8");

describe("iOS Live Activity visual contract", () => {
    const activity = read(
        "modules/nolate-live-activity/ios/Extension/NoLateDepartureLiveActivity.swift",
    );
    const routeBar = read(
        "modules/nolate-live-activity/ios/Extension/NoLateRouteBarView.swift",
    );
    const models = read(
        "modules/nolate-live-activity/ios/NoLateLiveActivityModels.swift",
    );
    const appConfig = JSON.parse(read("app.json")) as {
        userInterfaceStyle?: string;
    };
    const markAsset = read(
        "modules/nolate-live-activity/ios/Extension/Assets.xcassets/NoLateMark.imageset/Contents.json",
    );

    it("follows system light, dark, and reduced-luminance appearance", () => {
        expect(appConfig.userInterfaceStyle).toBe("automatic");
        expect(activity).toContain("@Environment(\\.colorScheme)");
        expect(activity).toContain("@Environment(\\.isLuminanceReduced)");
        expect(activity).toContain(
            "context.state.appearance.map { $0 == .dark } ?? (colorScheme == .dark)",
        );
        expect(activity).not.toContain("NoLateSystemAppearance");
        expect(activity).not.toContain("CFPreferences");
        expect(activity).not.toContain("uikitservices.userInterfaceStyleMode");
        expect(activity).toContain(".activityBackgroundTint(.clear)");
        expect(activity).toContain(".activitySystemActionForegroundColor(palette.primaryText)");
        expect(activity).toContain("if !isLuminanceReduced");
        expect(activity).not.toContain(".preferredColorScheme(");
        expect(activity).not.toContain('activityBackgroundTint(Color(hex: "#E7F2FF"))');
        expect(activity).not.toContain("Color.white.opacity(0.74)");
        expect(models).toContain("public static let light");
        expect(models).toContain("public static let dark");
        expect(models).toContain("public enum NoLateLiveActivityAppearance");
        expect(models).toContain("public let appearance: NoLateLiveActivityAppearance?");
        expect(models).toContain('surfaceStart: "#F7FBFF"');
        expect(models).toContain('surfaceStart: "#0B1324"');
        expect(models).toContain("systemDark ? .dark : .light");
        expect(routeBar).toContain('Image("NoLateMark", bundle: .main)');
        expect(markAsset).toContain('"filename" : "NoLateMark@2x.png"');
        expect(markAsset).toContain('"filename" : "NoLateMark@3x.png"');
    });

    it("uses one route bar in both the lock card and expanded Dynamic Island", () => {
        expect(activity.match(/NoLateRouteBarView\(/g))
            .toHaveLength(2);
        expect(activity).toContain("DynamicIslandExpandedRegion(.bottom)");
        expect(activity).not.toContain("DynamicIslandExpandedRegion(.center)");
        expect(activity).not.toContain("DynamicIslandExpandedRegion(.trailing)");
        expect(routeBar).toContain("struct NoLateRouteBarView: View");
        expect(routeBar).toContain('case .walk: return "도보"');
        expect(routeBar).toContain('case .bus: return "버스"');
        expect(routeBar).toContain('case .subway: return "지하철"');
        expect(routeBar).toContain('case .destination: return "도착지"');
        expect(routeBar).toContain("NoLateDestinationPinShape()");
        expect(routeBar).not.toContain('Image(systemName: "mappin")');
        expect(activity).toContain("usesDarkSurface: true");
        expect(activity).toContain("themeOverride: palette.tokens");
        expect(routeBar).toContain("if let themeOverride { return themeOverride }");
        expect(routeBar).toContain("theme.neutralRoute");
        expect(routeBar).toContain("frame(minWidth: compact ? 8 : 10, maxWidth: .infinity)");
        expect(routeBar).not.toContain("connector.frame(width: 42)");
    });

    it("keeps the compact island and primary action aligned with the approved mock", () => {
        const compactStatusStart = activity.indexOf("private struct NoLateCompactStatusView");
        const lockScreenStart = activity.indexOf("private struct NoLateLockScreenView");
        const compactStatus = activity.slice(compactStatusStart, lockScreenStart);

        expect(compactStatusStart).toBeGreaterThanOrEqual(0);
        expect(lockScreenStart).toBeGreaterThan(compactStatusStart);
        expect(compactStatus).toContain("NoLateDepartureCountdownValueView(state: state)");
        expect(compactStatus).toContain("NoLateLiveActivityPresentation.compactLabel(");
        expect(compactStatus).toContain(".foregroundStyle(.white)");
        expect(compactStatus).toContain(".monospacedDigit()");
        expect(activity).toContain('Text("출발까지 ")');
        expect(activity).toContain('Text(" 남았어요")');
        expect(activity).toContain("countingDownIn: now..<departure");
        expect(activity).toContain("maxPrecision: .seconds(60)");
        expect(activity).toContain('Text("일정 확인")');
        expect(activity).toContain('Text("출발 완료")');
        expect(activity).toContain("theme.callToActionStart");
        expect(activity).toContain("theme.callToActionEnd");
        expect(activity).toContain("NoLateCompactStatusView(");
        expect(activity).not.toContain('Text(context.state.status.badgeText)');
        expect(activity).not.toContain('return "출발 준비"');
        expect(activity).not.toContain('return "출발 시간이 가까워졌어요"');
        expect(activity).not.toContain('Text("경로 보기")');
        expect(activity).not.toContain("firstWaitMinutes > 0");
        expect(activity).not.toContain("대기시간 포함");
        expect(activity).toContain("NoLateLiveActivityLayoutMetrics.horizontalPadding");
        expect(activity).toContain("NoLateLiveActivityLayoutMetrics.verticalPadding");
        expect(activity).toContain("NoLateLiveActivityLayoutMetrics.actionsTopSpacing");
        expect(activity).toContain(".fixedSize(horizontal: true, vertical: false)");
        expect(models).toContain("public enum NoLateLiveActivityLayoutMetrics");
        expect(activity).toContain("minWidth: 0,\n      maxWidth: .infinity,");
        expect(activity).toContain(
            "minHeight: CGFloat(NoLateLiveActivityLayoutMetrics.maximumLockScreenHeight)",
        );
        expect(activity).toContain(
            "maxHeight: CGFloat(NoLateLiveActivityLayoutMetrics.maximumLockScreenHeight)",
        );
        expect(models).not.toContain("approvedMockAspectRatio");
        expect(models).not.toContain("cardWidth");
        expect(models).toContain("public static let horizontalPadding = 14.0");
        expect(models).toContain("public static let verticalPadding = 11.0");
        expect(models).toContain("public static let summaryHeight = 28.0");
        expect(models).toContain("public static let actionVisualHeight = 26.0");
        expect(models).toContain("public static let actionHitHeight = 44.0");
        expect(models).toContain("public static let actionWidth = 96.0");
        expect(models).toContain("public static let estimatedLockScreenHeight");
        expect(models).toContain('return "출발까지 \\(minutes)분 남았어요"');
        expect(activity).not.toContain("RoundedRectangle(cornerRadius: 24");
        expect(routeBar).toContain("compact ? 14 : 16");
    });
});

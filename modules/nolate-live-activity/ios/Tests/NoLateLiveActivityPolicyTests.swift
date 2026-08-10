import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateLiveActivityPolicyTests: XCTestCase {
  func testThemeTokensFollowSystemAppearance() {
    XCTAssertEqual(
      NoLateLiveActivityThemeTokens.resolved(systemDark: false),
      .light
    )
    XCTAssertEqual(
      NoLateLiveActivityThemeTokens.resolved(systemDark: true),
      .dark
    )
    XCTAssertNotEqual(NoLateLiveActivityThemeTokens.light, .dark)
  }

  func testAppearanceIsBackwardCompatibleAndSurvivesStatusReplacement() throws {
    let legacyJSON = """
    {
      "revision": 1,
      "travelMinutes": 36,
      "firstWaitMinutes": 6,
      "predictedArrivalEpochSeconds": 2000,
      "recommendedDepartureEpochSeconds": 1000,
      "updatedAtEpochSeconds": 900,
      "actionExpiresAtEpochSeconds": 3000,
      "status": "preparing",
      "routeSegments": []
    }
    """
    let legacy = try JSONDecoder().decode(
      NoLateDepartureContentState.self,
      from: Data(legacyJSON.utf8)
    )
    XCTAssertNil(legacy.appearance)

    let explicit = NoLateDepartureContentState(
      revision: 2,
      travelMinutes: 36,
      firstWaitMinutes: 6,
      predictedArrivalEpochSeconds: 2_000,
      recommendedDepartureEpochSeconds: 1_000,
      updatedAtEpochSeconds: 900,
      actionExpiresAtEpochSeconds: 3_000,
      status: .preparing,
      routeSegments: [],
      appearance: .dark
    )
    XCTAssertEqual(explicit.appearance, .dark)
    XCTAssertEqual(
      explicit.replacingStatus(
        .leaveNow,
        revision: 3,
        updatedAtEpochSeconds: 1_001
      ).appearance,
      .dark
    )
    XCTAssertTrue(
      String(decoding: try JSONEncoder().encode(explicit), as: UTF8.self)
        .contains("\"appearance\":\"dark\"")
    )
  }

  func testThemeTokensKeepTextControlsAndRouteContrastLegible() {
    let light = NoLateLiveActivityThemeTokens.light
    let dark = NoLateLiveActivityThemeTokens.dark

    XCTAssertGreaterThan(relativeLuminance(light.surfaceMiddle), 0.65)
    XCTAssertLessThan(relativeLuminance(dark.surfaceMiddle), 0.18)

    for theme in [light, dark] {
      XCTAssertGreaterThanOrEqual(
        contrastRatio(theme.primaryText, theme.surfaceMiddle),
        4.5
      )
      XCTAssertGreaterThanOrEqual(
        contrastRatio(theme.secondaryText, theme.surfaceMiddle),
        4.5
      )
      XCTAssertGreaterThanOrEqual(
        contrastRatio(theme.accent, theme.surfaceMiddle),
        3.0
      )
      XCTAssertGreaterThanOrEqual(
        contrastRatio(theme.neutralRoute, theme.surfaceMiddle),
        3.0
      )
      XCTAssertGreaterThanOrEqual(
        contrastRatio("#FFFFFF", theme.callToActionStart),
        4.5
      )
      XCTAssertGreaterThanOrEqual(
        contrastRatio("#FFFFFF", theme.callToActionEnd),
        4.5
      )
    }
  }

  func testLockScreenSpacingBudgetStaysWithinActivityKitLimit() {
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.horizontalPadding, 14)
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.verticalPadding, 11)
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.headerHeight, 24)
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.summaryHeight, 28)
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.actionVisualHeight, 26)
    XCTAssertGreaterThanOrEqual(NoLateLiveActivityLayoutMetrics.actionHitHeight, 44)
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.actionWidth, 96)
    XCTAssertEqual(NoLateLiveActivityLayoutMetrics.estimatedLockScreenHeight, 160)
    XCTAssertLessThanOrEqual(
      NoLateLiveActivityLayoutMetrics.estimatedLockScreenHeight,
      NoLateLiveActivityLayoutMetrics.maximumLockScreenHeight
    )
  }

  func testDepartureCountdownUsesRecommendedDepartureAndRoundsUp() {
    XCTAssertEqual(
      NoLateLiveActivityPresentation.remainingDepartureMinutes(
        recommendedDepartureEpochSeconds: 1_240,
        nowEpochSeconds: 1_000
      ),
      4
    )
    XCTAssertEqual(
      NoLateLiveActivityPresentation.remainingDepartureMinutes(
        recommendedDepartureEpochSeconds: 1_181,
        nowEpochSeconds: 1_000
      ),
      4
    )
    XCTAssertEqual(
      NoLateLiveActivityPresentation.headline(
        status: .preparing,
        recommendedDepartureEpochSeconds: 1_240,
        nowEpochSeconds: 1_000
      ),
      "출발까지 4분 남았어요"
    )
  }

  func testDepartureCountdownTransitionsSafelyWhenZeroOrStale() {
    XCTAssertNil(NoLateLiveActivityPresentation.remainingDepartureMinutes(
      recommendedDepartureEpochSeconds: 1_000,
      nowEpochSeconds: 1_000
    ))
    XCTAssertEqual(
      NoLateLiveActivityPresentation.headline(
        status: .preparing,
        recommendedDepartureEpochSeconds: 999,
        nowEpochSeconds: 1_000
      ),
      "지금 출발할 시간이에요"
    )
    XCTAssertEqual(
      NoLateLiveActivityPresentation.compactLabel(
        status: .delayed,
        recommendedDepartureEpochSeconds: 1_240,
        nowEpochSeconds: 1_000
      ),
      "확인"
    )
  }

  func testDoorToDoorEtaDoesNotAddFirstTransitWaitTwice() throws {
    let command = try NoLateLiveActivityPolicy.validate(
      makeCommand(travelMinutes: 60, firstWaitMinutes: 20)
    )

    XCTAssertEqual(command.contentState.displayedTravelMinutes, 60)
    XCTAssertEqual(command.contentState.firstWaitMinutes, 20)
  }

  func testEtaAndWaitBoundsRejectInvalidPayloads() {
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validate(
      makeCommand(travelMinutes: 0, firstWaitMinutes: 0)
    ))
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validate(
      makeCommand(travelMinutes: 1_441, firstWaitMinutes: 0)
    ))
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validate(
      makeCommand(travelMinutes: 40, firstWaitMinutes: 41)
    ))
  }

  func testRouteProjectionIsBoundedAndAlwaysEndsAtRedDestination() throws {
    let incoming = [
      segment(.destination, "잘못 들어온 목적지", "#000000"),
      segment(.walk, "도보", "#AAAAAA"),
      segment(.bus, "버스", "#00aa00"),
      segment(.subway, "지하철", "invalid"),
      segment(.transfer, "환승", "#BBBBBB"),
      segment(.drive, "택시", "#CCCCCC"),
      segment(.bike, "자전거", "#DDDDDD"),
      segment(.origin, "출발", "#EEEEEE")
    ]

    let validated = try NoLateLiveActivityPolicy.validate(makeCommand(routeSegments: incoming))
    let route = validated.contentState.routeSegments

    XCTAssertEqual(route.count, NoLateLiveActivityPolicy.maximumRouteSegments)
    XCTAssertEqual(route.filter { $0.kind == .destination }.count, 1)
    XCTAssertEqual(route.last?.kind, .destination)
    XCTAssertEqual(route.last?.label, "도착")
    XCTAssertEqual(route.last?.colorHex, "#FF4444")
    XCTAssertEqual(route[1].colorHex, "#00AA00")
    XCTAssertEqual(route[2].colorHex, "#2979FF")
  }

  func testUppercaseJsKindsNormalizeToLowercaseApnsRawValues() {
    XCTAssertEqual(NoLateLiveActivityPolicy.normalizedRouteSegmentKind(" WALK "), .walk)
    XCTAssertEqual(NoLateLiveActivityPolicy.normalizedRouteSegmentKind("BUS"), .bus)
    XCTAssertEqual(NoLateLiveActivityPolicy.normalizedRouteSegmentKind("SUBWAY"), .subway)
    XCTAssertNil(NoLateLiveActivityPolicy.normalizedRouteSegmentKind("AIRPLANE"))
  }

  func testEncodedContentStateUsesStableCamelCaseAndLowercaseEnums() throws {
    let validated = try NoLateLiveActivityPolicy.validate(makeCommand(
      status: .leaveNow,
      routeSegments: [segment(.bus, "버스", "#2979FF")]
    ))
    let data = try JSONEncoder().encode(validated.contentState)
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    let encodedRoute = try XCTUnwrap(object["routeSegments"] as? [[String: Any]])

    XCTAssertEqual(object["status"] as? String, "leaveNow")
    XCTAssertNotNil(object["travelMinutes"])
    XCTAssertNotNil(object["actionExpiresAtEpochSeconds"])
    XCTAssertNil(object["travel_minutes"])
    XCTAssertEqual(encodedRoute.first?["kind"] as? String, "bus")
    XCTAssertEqual(encodedRoute.last?["kind"] as? String, "destination")
  }

  func testDepartureActionFenceRejectsExpiredOrSupersededActivity() {
    let key = "key:" + String(repeating: "a", count: 64)
    let valid = NoLateLiveActivityPolicy.mayRecordDepartureAction(
      requestedScheduleId: "41",
      requestedRecipientMemberId: 7,
      requestedGeneration: 5,
      requestedActionEventKey: key,
      activityScheduleId: "41",
      activityRecipientMemberId: 7,
      activityGeneration: 5,
      activityActionEventKey: key,
      nowEpochSeconds: 1_000,
      actionExpiresAtEpochSeconds: 1_001
    )
    XCTAssertTrue(valid)

    XCTAssertFalse(NoLateLiveActivityPolicy.mayRecordDepartureAction(
      requestedScheduleId: "41",
      requestedRecipientMemberId: 7,
      requestedGeneration: 4,
      requestedActionEventKey: key,
      activityScheduleId: "41",
      activityRecipientMemberId: 7,
      activityGeneration: 5,
      activityActionEventKey: key,
      nowEpochSeconds: 1_000,
      actionExpiresAtEpochSeconds: 1_001
    ))
    XCTAssertFalse(NoLateLiveActivityPolicy.mayRecordDepartureAction(
      requestedScheduleId: "41",
      requestedRecipientMemberId: 7,
      requestedGeneration: 5,
      requestedActionEventKey: key,
      activityScheduleId: "41",
      activityRecipientMemberId: 7,
      activityGeneration: 5,
      activityActionEventKey: key,
      nowEpochSeconds: 1_001,
      actionExpiresAtEpochSeconds: 1_001
    ))
  }

  func testOneActivityPerMemberSchedulePrefersGenerationThenRevisionThenIdentifier() {
    let candidates = [
      NoLateActiveActivityIdentity(activityId: "z-last", generation: 5, revision: 10),
      NoLateActiveActivityIdentity(activityId: "b-tie", generation: 5, revision: 12),
      NoLateActiveActivityIdentity(activityId: "a-tie", generation: 5, revision: 12),
      NoLateActiveActivityIdentity(activityId: "old-generation", generation: 4, revision: 99)
    ]

    XCTAssertEqual(
      NoLateLiveActivityPolicy.preferredActivityID(in: candidates),
      "a-tie"
    )
    XCTAssertEqual(
      NoLateLiveActivityPolicy.preferredActivityID(in: Array(candidates.reversed())),
      "a-tie"
    )
  }

  func testCommittedActionIdentityAlsoMatchesExpiredDuplicateForTerminalPurge() {
    let key = "key:" + String(repeating: "a", count: 64)

    XCTAssertTrue(NoLateLiveActivityPolicy.hasDepartureActionIdentity(
      requestedScheduleId: "41",
      requestedRecipientMemberId: 7,
      requestedGeneration: 5,
      requestedActionEventKey: key,
      activityScheduleId: "41",
      activityRecipientMemberId: 7,
      activityGeneration: 5,
      activityActionEventKey: key
    ))
    XCTAssertFalse(NoLateLiveActivityPolicy.hasDepartureActionIdentity(
      requestedScheduleId: "41",
      requestedRecipientMemberId: 7,
      requestedGeneration: 5,
      requestedActionEventKey: key,
      activityScheduleId: "41",
      activityRecipientMemberId: 7,
      activityGeneration: 6,
      activityActionEventKey: key
    ))
  }

  func testDepartureButtonRequiresActionableStateAndUnexpiredFence() {
    for status in [
      NoLateLiveActivityStatus.preparing,
      .leaveNow,
      .delayed
    ] {
      XCTAssertTrue(NoLateLiveActivityPolicy.isDepartureActionAvailable(
        status: status,
        nowEpochSeconds: 1_000,
        actionExpiresAtEpochSeconds: 1_001
      ))
    }
    for status in [
      NoLateLiveActivityStatus.inTransit,
      .arrived,
      .cancelled
    ] {
      XCTAssertFalse(NoLateLiveActivityPolicy.isDepartureActionAvailable(
        status: status,
        nowEpochSeconds: 1_000,
        actionExpiresAtEpochSeconds: 1_001
      ))
    }
    XCTAssertFalse(NoLateLiveActivityPolicy.isDepartureActionAvailable(
      status: .leaveNow,
      nowEpochSeconds: 1_001,
      actionExpiresAtEpochSeconds: 1_001
    ))
  }

  func testScheduleStartAndActionIdentityAreStrictlyValidated() {
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validate(
      makeCommand(scheduleStartAt: "2026-08-06T10:00:00")
    ))
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validate(
      makeCommand(actionEventKey: "not-a-canonical-key")
    ))
  }

  private func makeCommand(
    travelMinutes: Int = 40,
    firstWaitMinutes: Int? = 8,
    scheduleStartAt: String = "2026-08-06T10:00:00+09:00",
    actionEventKey: String = "key:" + String(repeating: "a", count: 64),
    status: NoLateLiveActivityStatus = .preparing,
    routeSegments: [NoLateRouteSegment]? = nil
  ) -> NoLateDepartureStartOrUpdateCommand {
    NoLateDepartureStartOrUpdateCommand(
      scheduleId: "41",
      recipientMemberId: 7,
      generation: 5,
      scheduleTitle: "강남역 약속",
      destinationName: "강남역",
      scheduleStartAt: scheduleStartAt,
      actionEventKey: actionEventKey,
      logicalEventKey: "schedule:41:member:7",
      staleAtEpochSeconds: 1_800,
      contentState: NoLateDepartureContentState(
        revision: 9,
        travelMinutes: travelMinutes,
        firstWaitMinutes: firstWaitMinutes,
        predictedArrivalEpochSeconds: 3_400,
        recommendedDepartureEpochSeconds: 1_000,
        updatedAtEpochSeconds: 900,
        actionExpiresAtEpochSeconds: 5_000,
        status: status,
        routeSegments: routeSegments ?? [
          NoLateRouteSegment(kind: .walk, label: "도보", colorHex: "#9CA3AF")
        ]
      )
    )
  }

  private func contrastRatio(_ first: String, _ second: String) -> Double {
    let firstLuminance = relativeLuminance(first)
    let secondLuminance = relativeLuminance(second)
    return (max(firstLuminance, secondLuminance) + 0.05) /
      (min(firstLuminance, secondLuminance) + 0.05)
  }

  private func relativeLuminance(_ hex: String) -> Double {
    let raw = String(hex.dropFirst())
    guard raw.count == 6, let value = UInt64(raw, radix: 16) else {
      XCTFail("Expected a six-digit RGB color, got \(hex)")
      return 0
    }
    let channels = [
      Double((value >> 16) & 0xff) / 255,
      Double((value >> 8) & 0xff) / 255,
      Double(value & 0xff) / 255
    ].map { channel -> Double in
      channel <= 0.04045
        ? channel / 12.92
        : pow((channel + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }

  private func segment(
    _ kind: NoLateRouteSegmentKind,
    _ label: String,
    _ colorHex: String
  ) -> NoLateRouteSegment {
    NoLateRouteSegment(kind: kind, label: label, colorHex: colorHex)
  }
}

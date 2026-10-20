import ExpoModulesCore
import Foundation

private struct NoLateRouteSegmentRecord: Record {
  @Field
  var kind: String = ""

  @Field
  var label: String = ""

  @Field
  var colorHex: String = ""

  @Field
  var legIndex: Int?
}

private struct NoLateJourneyProgressRecord: Record {
  @Field var sessionId: String = ""
  @Field var generation: Double = -1
  @Field var routeRevision: Double = -1
  @Field var sequence: Double = -1
  @Field var phase: String = ""
  @Field var activeLegIndex: Int = -1
  @Field var currentStopIndex: Int?
  @Field var remainingStops: Int?
  @Field var legProgress: Double = -1
  @Field var nextInstruction: String = ""
  @Field var observedAtEpochSeconds: Double = -1
  @Field var overallProgress: Double?
}

private struct NoLateStartOrUpdateRecord: Record {
  @Field
  var scheduleId: String = ""

  @Field
  var recipientMemberId: Double = -1

  @Field
  var generation: Double = -1

  @Field
  var scheduleTitle: String = ""

  @Field
  var destinationName: String = ""

  @Field
  var scheduleStartAt: String = ""

  @Field
  var actionEventKey: String = ""

  @Field
  var logicalEventKey: String?

  @Field
  var revision: Double = -1

  @Field
  var travelMinutes: Int = -1

  @Field
  var firstWaitMinutes: Int?

  @Field
  var predictedArrivalAt: String?

  @Field
  var recommendedDepartureAt: String = ""

  @Field
  var updatedAt: String = ""

  @Field
  var actionExpiresAt: String = ""

  @Field
  var staleAt: String?

  @Field
  var status: String = ""

  @Field
  var appearance: String?

  @Field
  var routeSegments: [NoLateRouteSegmentRecord] = []

  @Field
  var journey: NoLateJourneyProgressRecord?
}

private struct NoLateEndRecord: Record {
  @Field
  var scheduleId: String = ""

  @Field
  var recipientMemberId: Double = -1

  @Field
  var status: String?

  @Field
  var revision: Double?

  @Field
  var updatedAt: String?

  @Field
  var dismissalPolicy: String?

  @Field
  var dismissAt: String?
}

public final class NoLateLiveActivityModule: Module {
  private let journeyEventOwner = UUID()

  public func definition() -> ModuleDefinition {
    Name("NoLateLiveActivity")

    Events("onLiveActivityPushToken", "onLiveActivityStateChange", "onJourneyEngineStateChange", "onAutomaticJourneyStateChange")

    OnCreate { [weak self] in
      if let owner = self?.journeyEventOwner {
        Task { @MainActor [weak self] in
          #if DEBUG
          NoLateJourneyRuntime.shared.setEventSink(owner: owner) { [weak self] body in
            self?.sendEvent("onJourneyEngineStateChange", body)
          }
          #endif
          NoLateJourneyAutomaticRuntime.shared.setEventSink(owner: owner) { [weak self] body in
            self?.sendEvent("onAutomaticJourneyStateChange", body)
          }
        }
      }
      guard #available(iOS 16.1, *) else { return }
      Task {
        await NoLateLiveActivityCoordinator.shared.setEventSink { [weak self] name, body in
          Task { @MainActor in
            self?.sendEvent(name, body)
          }
        }
        await NoLateLiveActivityCoordinator.shared.restoreAndObserve()
      }
    }

    OnDestroy { [weak self] in
      if let owner = self?.journeyEventOwner {
        Task { @MainActor in
          // JS/module teardown only detaches observation, not the native journey lifetime.
          #if DEBUG
          NoLateJourneyRuntime.shared.removeEventSink(owner: owner)
          #endif
          NoLateJourneyAutomaticRuntime.shared.removeEventSink(owner: owner)
        }
      }
      #if DEBUG
      Task { @MainActor in
        _ = NoLateJourneyDiagnostics.shared.stopProbe()
      }
      #endif
      guard #available(iOS 16.1, *) else { return }
      Task {
        await NoLateLiveActivityCoordinator.shared.stopObserving()
      }
    }

    AsyncFunction("getJourneyDiagnostics") {
      #if DEBUG
      return await NoLateJourneyDiagnostics.shared.snapshot()
      #else
      return ["enabled": false, "reason": "DEBUG_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("refreshAutomaticJourneyCredentials") { (apiOrigin: String, refreshToken: String) in
      return await NoLateSavedGuidanceArrivalTransport.refreshRequest(apiOrigin: apiOrigin, refreshToken: refreshToken)
    }
    AsyncFunction("configureAutomaticJourneyPushPilot") { (fcmToken: String) in
      return await NoLateJourneyAutomaticRuntime.shared.configurePushPilot(fcmToken: fcmToken)
    }
    AsyncFunction("configureAutomaticJourneyNoticeMode") { (mode: String) in
      return await NoLateJourneyAutomaticRuntime.shared.configureNoticeMode(mode)
    }
    AsyncFunction("postAuthenticatedAutomaticJourney") { (authJSON: String, path: String, bodyJSON: String) in
      return await NoLateSavedGuidanceArrivalTransport.authenticatedRequest(authJSON: authJSON, path: path, bodyJSON: bodyJSON)
    }
    AsyncFunction("configureAutomaticJourneyAuthentication") { (authJSON: String) in
      return await NoLateJourneyAutomaticRuntime.shared.configureAuthentication(authJSON)
    }
    AsyncFunction("updateAutomaticJourneyAuthentication") { (authJSON: String, bindingJSON: String, previousAccessToken: String) in
      return await NoLateJourneyAutomaticRuntime.shared.updateAuthentication(authJSON, bindingJSON: bindingJSON, previousAccessToken: previousAccessToken)
    }
    AsyncFunction("armAutomaticJourney") { (routeJSON: String, bindingJSON: String) in
      return await NoLateJourneyAutomaticRuntime.shared.arm(routeJSON: routeJSON, bindingJSON: bindingJSON)
    }
    AsyncFunction("getAutomaticJourneySnapshot") {
      return await NoLateJourneyAutomaticRuntime.shared.snapshot()
    }
    AsyncFunction("stopAutomaticJourney") {
      return await NoLateJourneyAutomaticRuntime.shared.stop()
    }
    AsyncFunction("restoreAutomaticJourney") { (routeJSON: String, bindingJSON: String) in
      return await NoLateJourneyAutomaticRuntime.shared.restore(routeJSON: routeJSON, bindingJSON: bindingJSON)
    }
    AsyncFunction("reconcileAutomaticJourneyTerminal") { (bindingJSON: String) in
      return await NoLateJourneyAutomaticRuntime.shared.reconcileTerminal(bindingJSON: bindingJSON)
    }
    AsyncFunction("getAutomaticJourneyDeparture") {
      return await NoLateJourneyAutomaticRuntime.shared.departure()
    }
    AsyncFunction("acknowledgeAutomaticJourneyDeparture") { (eventKey: String, bindingJSON: String) in
      return await NoLateJourneyAutomaticRuntime.shared.acknowledge(eventKey: eventKey, bindingJSON: bindingJSON)
    }

    AsyncFunction("getJourneyEngineSnapshot") {
      #if DEBUG
      return await NoLateJourneyRuntime.shared.snapshot()
      #else
      return ["enabled": false, "reason": "DEVELOPMENT_SIMULATOR_ONLY"] as [String: Any?]
      #endif
    }

    // Pure, bounded route assessment. Never calls the journey/location runtime or ActivityKit.
    AsyncFunction("assessJourneyRouteInput") { (json: String) in
      guard Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyProductEnabled") as? Bool == true ||
        Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDiagnosticsEnabled") as? Bool == true else {
        return ["available": false, "reason": "JOURNEY_BUILD_REQUIRED"] as [String: Any]
      }
      do {
        return ["available": true, "summaryJSON": try NoLateJourneyRouteNormalizer.summaryJSON(json: json)] as [String: Any]
      } catch {
        return ["available": false, "reason": "INVALID_ROUTE_INPUT"] as [String: Any]
      }
    }

    AsyncFunction("armJourneyEngine") { (mode: String) in
      #if DEBUG
      return await NoLateJourneyRuntime.shared.arm(mode: mode)
      #else
      return ["enabled": false, "reason": "DEVELOPMENT_SIMULATOR_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("stopJourneyEngine") {
      #if DEBUG
      return await NoLateJourneyRuntime.shared.stop()
      #else
      return ["enabled": false, "reason": "DEVELOPMENT_SIMULATOR_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("restoreJourneyEngine") {
      #if DEBUG
      return await NoLateJourneyRuntime.shared.restore()
      #else
      return ["enabled": false, "reason": "DEVELOPMENT_SIMULATOR_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("startJourneyLocationProbe") {
      #if DEBUG
      return await NoLateJourneyDiagnostics.shared.startLocationProbe()
      #else
      return ["enabled": false, "reason": "DEBUG_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("stopJourneyLocationProbe") {
      #if DEBUG
      return await NoLateJourneyDiagnostics.shared.stopProbe()
      #else
      return ["enabled": false, "reason": "DEBUG_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("speakJourneyProbe") { (mode: String) in
      #if DEBUG
      return await NoLateJourneyDiagnostics.shared.speakProbe(mode: mode)
      #else
      return ["enabled": false, "reason": "DEBUG_ONLY"] as [String: Any?]
      #endif
    }

    AsyncFunction("getCapabilities") {
      guard #available(iOS 16.1, *) else {
        return [
          "supported": false,
          "platform": "ios",
          "enabled": false,
          "canDisplay": false,
          "canUpdate": false,
          "canStartLocally": false,
          "canStartRemotely": false,
          "pushToStartSupported": false,
          "reason": "IOS_VERSION_UNSUPPORTED"
        ] as [String: Any?]
      }
      return await NoLateLiveActivityCoordinator.shared.getCapabilities()
    }

    AsyncFunction("startOrUpdate") { (record: NoLateStartOrUpdateRecord) in
      guard #available(iOS 16.1, *) else {
        return NoLateLiveActivityMutationResult(
          supported: false,
          applied: false,
          operation: "ignored",
          reason: "IOS_VERSION_UNSUPPORTED"
        ).bridgeMap()
      }
      do {
        let command = try Self.command(from: record)
        return try await NoLateLiveActivityCoordinator.shared
          .startOrUpdate(command)
          .bridgeMap()
      } catch {
        return NoLateLiveActivityMutationResult(
          applied: false,
          operation: "ignored",
          reason: "INVALID_COMMAND:\(error.localizedDescription)"
        ).bridgeMap()
      }
    }

    AsyncFunction("end") { (record: NoLateEndRecord) in
      guard #available(iOS 16.1, *) else {
        return NoLateLiveActivityMutationResult(
          supported: false,
          applied: false,
          operation: "ignored",
          reason: "IOS_VERSION_UNSUPPORTED"
        ).bridgeMap()
      }
      do {
        let command = try Self.endCommand(from: record)
        return try await NoLateLiveActivityCoordinator.shared
          .end(command)
          .bridgeMap()
      } catch {
        return NoLateLiveActivityMutationResult(
          applied: false,
          operation: "ignored",
          reason: "INVALID_COMMAND:\(error.localizedDescription)"
        ).bridgeMap()
      }
    }

    AsyncFunction("endAll") {
      guard #available(iOS 16.1, *) else {
        return NoLateLiveActivityMutationResult(
          supported: false,
          applied: false,
          operation: "ignored",
          reason: "IOS_VERSION_UNSUPPORTED",
          endedCount: 0
        ).bridgeMap()
      }
      return await NoLateLiveActivityCoordinator.shared.endAll().bridgeMap()
    }

    AsyncFunction("getActiveActivities") {
      guard #available(iOS 16.1, *) else { return [] as [[String: Any?]] }
      return await NoLateLiveActivityCoordinator.shared.getActiveActivities()
    }

    AsyncFunction("debugSimulate") {
      guard #available(iOS 16.1, *) else {
        return NoLateLiveActivityMutationResult(
          supported: false,
          applied: false,
          operation: "ignored",
          reason: "IOS_VERSION_UNSUPPORTED",
          simulation: true
        ).bridgeMap()
      }
      do {
        return try await NoLateLiveActivityCoordinator.shared.debugSimulate().bridgeMap()
      } catch {
        return NoLateLiveActivityMutationResult(
          applied: false,
          operation: "ignored",
          reason: "SIMULATION_ERROR:\(error.localizedDescription)",
          simulation: true
        ).bridgeMap()
      }
    }
  }

  private static func command(
    from record: NoLateStartOrUpdateRecord
  ) throws -> NoLateDepartureStartOrUpdateCommand {
    let routeSegments = try record.routeSegments.map { segment in
      guard let kind = NoLateLiveActivityPolicy.normalizedRouteSegmentKind(segment.kind) else {
        throw NoLateLiveActivityValidationError.invalid(
          "Unknown route segment kind: \(segment.kind)"
        )
      }
      return NoLateRouteSegment(
        kind: kind,
        label: segment.label,
        colorHex: segment.colorHex,
        legIndex: segment.legIndex
      )
    }
    guard let status = NoLateLiveActivityStatus(rawValue: record.status) else {
      throw NoLateLiveActivityValidationError.invalid("status is invalid.")
    }
    let appearance = try record.appearance.map { rawValue in
      guard let value = NoLateLiveActivityAppearance(rawValue: rawValue) else {
        throw NoLateLiveActivityValidationError.invalid("appearance is invalid.")
      }
      return value
    }
    return NoLateDepartureStartOrUpdateCommand(
      scheduleId: record.scheduleId,
      recipientMemberId: try safeInteger(record.recipientMemberId, field: "recipientMemberId"),
      generation: try safeInteger(record.generation, field: "generation"),
      scheduleTitle: record.scheduleTitle,
      destinationName: record.destinationName,
      scheduleStartAt: record.scheduleStartAt,
      actionEventKey: record.actionEventKey,
      logicalEventKey: record.logicalEventKey,
      staleAtEpochSeconds: try optionalEpochSeconds(record.staleAt, field: "staleAt"),
      contentState: NoLateDepartureContentState(
        revision: try safeInteger(record.revision, field: "revision"),
        travelMinutes: record.travelMinutes,
        firstWaitMinutes: record.firstWaitMinutes,
        predictedArrivalEpochSeconds: try optionalEpochSeconds(
          record.predictedArrivalAt,
          field: "predictedArrivalAt"
        ),
        recommendedDepartureEpochSeconds: try epochSeconds(
          record.recommendedDepartureAt,
          field: "recommendedDepartureAt"
        ),
        updatedAtEpochSeconds: try epochSeconds(record.updatedAt, field: "updatedAt"),
        actionExpiresAtEpochSeconds: try epochSeconds(
          record.actionExpiresAt,
          field: "actionExpiresAt"
        ),
        status: status,
        routeSegments: routeSegments,
        appearance: appearance,
        journey: try record.journey.map { try journeyProgress(from: $0) }
      )
    )
  }

  private static func journeyProgress(
    from record: NoLateJourneyProgressRecord
  ) throws -> NoLateJourneyProgress {
    guard let phase = NoLateJourneyPhase(rawValue: record.phase) else {
      throw NoLateLiveActivityValidationError.invalid("journey.phase is invalid.")
    }
    return NoLateJourneyProgress(
      sessionId: record.sessionId,
      generation: try safeInteger(record.generation, field: "journey.generation"),
      routeRevision: try safeInteger(record.routeRevision, field: "journey.routeRevision"),
      sequence: try safeInteger(record.sequence, field: "journey.sequence"),
      phase: phase,
      activeLegIndex: record.activeLegIndex,
      currentStopIndex: record.currentStopIndex,
      remainingStops: record.remainingStops,
      legProgress: record.legProgress,
      nextInstruction: record.nextInstruction,
      observedAtEpochSeconds: try safeInteger(record.observedAtEpochSeconds, field: "journey.observedAtEpochSeconds"),
      overallProgress: record.overallProgress
    )
  }

  private static func endCommand(
    from record: NoLateEndRecord
  ) throws -> NoLateDepartureEndCommand {
    let statusValue = record.status ?? NoLateLiveActivityStatus.cancelled.rawValue
    guard let status = NoLateLiveActivityStatus(rawValue: statusValue) else {
      throw NoLateLiveActivityValidationError.invalid("status is invalid.")
    }
    let policyValue = record.dismissalPolicy ?? NoLateLiveActivityDismissalPolicy.default.rawValue
    guard let policy = NoLateLiveActivityDismissalPolicy(rawValue: policyValue) else {
      throw NoLateLiveActivityValidationError.invalid("dismissalPolicy is invalid.")
    }
    let now = Int64(Date().timeIntervalSince1970.rounded())
    return NoLateDepartureEndCommand(
      scheduleId: record.scheduleId,
      recipientMemberId: try safeInteger(record.recipientMemberId, field: "recipientMemberId"),
      status: status,
      revision: try record.revision.map { try safeInteger($0, field: "revision") },
      updatedAtEpochSeconds: try record.updatedAt.map {
        try epochSeconds($0, field: "updatedAt")
      } ?? now,
      dismissalPolicy: policy,
      dismissAtEpochSeconds: try optionalEpochSeconds(record.dismissAt, field: "dismissAt")
    )
  }

  private static func safeInteger(_ value: Double, field: String) throws -> Int64 {
    guard
      value.isFinite,
      value.rounded() == value,
      abs(value) <= Double(noLateLiveActivityMaximumSafeInteger)
    else {
      throw NoLateLiveActivityValidationError.invalid("\(field) must be a safe integer.")
    }
    return Int64(value)
  }

  private static func epochSeconds(_ value: String, field: String) throws -> Int64 {
    guard let date = NoLateLiveActivityPolicy.iso8601Date(value) else {
      throw NoLateLiveActivityValidationError.invalid("\(field) must be ISO-8601.")
    }
    let seconds = date.timeIntervalSince1970.rounded()
    guard seconds >= 0, seconds <= Double(noLateLiveActivityMaximumSafeInteger) else {
      throw NoLateLiveActivityValidationError.invalid("\(field) is out of range.")
    }
    return Int64(seconds)
  }

  private static func optionalEpochSeconds(
    _ value: String?,
    field: String
  ) throws -> Int64? {
    guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return nil
    }
    return try epochSeconds(value, field: field)
  }
}

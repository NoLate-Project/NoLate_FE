#if DEBUG
import Foundation

/// Opt-in, memory-only remote UPDATE pilot. No production token repository or automatic fallback.
@MainActor final class NoLateGuidancePushPilot {
  private var fcmToken: String?
  private var updateToken: String?
  private var activityId: String?
  private var policy = NoLateGuidancePublicationPolicy()
  private var task: Task<Void, Never>?
  private var epoch = UUID()
  private(set) var requested = false
  private(set) var state = "OFF"
  private(set) var tokenAvailable = false
  private(set) var providerAcceptedCount = 0

  func configure(fcmToken: String) -> Bool {
    #if !targetEnvironment(simulator)
    return false
    #else
    guard Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAPNsPilotEnabled") as? Bool == true,
      Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAuthenticatedEnabled") as? Bool == true,
      fcmToken.utf8.count <= 4096, !fcmToken.contains(where: { $0.isWhitespace || $0.isNewline }) else { return false }
    reset(); requested = true; self.fcmToken = fcmToken.isEmpty ? nil : fcmToken
    state = "TOKEN_WAITING"
    return true
    #endif
  }
  func token(_ value: Data, activityId: String) {
    guard requested, !value.isEmpty, value.count <= 2048 else { return }
    if self.activityId != activityId || updateToken != value.map({ String(format: "%02x", $0) }).joined() {
      epoch = UUID(); task?.cancel(); task = nil; policy = .init()
    }
    self.activityId = activityId; updateToken = value.map { String(format: "%02x", $0) }.joined()
    tokenAvailable = true
    state = fcmToken == nil ? "TOKEN_READY_PROVIDER_NOT_CONFIGURED" : "TOKEN_READY"
  }
  func publish(_ content: NoLateGuidanceContent, binding: NoLateJourneyAutomaticSession.Binding?, auth: NoLateJourneyAuthentication?) {
    let now = Date().timeIntervalSince1970
    guard requested, let fcmToken, let updateToken, let activityId, task == nil,
      let binding, let auth, auth.matches(binding, now: now), binding.syncScope == "AUTHENTICATED",
      binding.sessionId == content.sessionId, binding.guidanceEnabled == true,
      let timestamp = policy.next(content, now: now) else { return }
    let captured = epoch
    state = "SENDING"
    task = Task { @MainActor [weak self] in
      var result = "PROVIDER_UNAVAILABLE"
      do {
        let body: [String: Any] = ["generation": binding.generation, "routeRevision": binding.routeRevision,
          "clientOwnerId": binding.clientOwnerId, "routeInputDigest": binding.routeInputDigest,
          "activityId": activityId, "fcmRegistrationToken": fcmToken, "liveActivityToken": updateToken,
          "timestamp": timestamp, "contentState": try JSONSerialization.jsonObject(with: JSONEncoder().encode(content))]
        let reply = await NoLateSavedGuidanceArrivalTransport.authenticatedRequest(
          authJSON: String(decoding: try JSONSerialization.data(withJSONObject: ["accessToken": auth.accessToken,
            "apiOrigin": auth.apiOrigin, "authMemberId": auth.authMemberId, "loginGeneration": auth.loginGeneration,
            "expiresAtEpochSeconds": auth.expiresAtEpochSeconds]), as: UTF8.self),
          path: "/api/schedules/\(binding.scheduleId)/automatic-journey/\(binding.sessionId)/live-activity",
          bodyJSON: String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self))
        if reply["accepted"] as? Bool == true, let json = reply["responseJSON"] as? String,
          let response = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
          response["success"] as? Bool == true, let data = response["data"] as? [String: Any],
          data["timestamp"] as? Int64 == timestamp, data["sessionId"] as? String == binding.sessionId {
          result = data["providerAccepted"] as? Bool == true ? "PROVIDER_ACCEPTED_NOT_DEVICE_VERIFIED" : "FIXTURE_ACCEPTED_NOT_DELIVERED"
        } else if reply["errorCode"] as? String == "AUTOMATIC_SERVER_REJECTED" { result = "PROVIDER_REJECTED" }
      } catch { /* Never log body, auth, tokens or provider exceptions. */ }
      guard let self, !Task.isCancelled, self.epoch == captured else { return }
      self.task = nil; self.state = result
      if result == "PROVIDER_ACCEPTED_NOT_DEVICE_VERIFIED" { self.providerAcceptedCount += 1 }
      // A confirmed HTTP rejection cannot be repaired by new GPS progress or a fresh timestamp.
      // A new explicitly configured trial/token epoch is required; never hammer an invalid route.
      if result == "PROVIDER_REJECTED" { self.policy.rejectTransport() }
    }
  }
  func reset() {
    epoch = UUID(); task?.cancel(); task = nil
    fcmToken = nil; updateToken = nil; activityId = nil; policy = .init()
    requested = false; tokenAvailable = false; providerAcceptedCount = 0; state = "OFF"
  }
}
#endif

import Security
import UIKit
import UniformTypeIdentifiers

private let noLateSharedKeychainAccessGroup = "457QQLB6H6.com.anonymous.nolatefe"

private struct APIEnvelope<Value: Decodable>: Decodable {
  let success: Bool
  let data: Value?
  let errorMessage: String?
}

private struct SharedPlace: Codable {
  let name: String?
  let address: String?
  let lat: Double?
  let lng: Double?
}

private struct ParseResult: Decodable {
  let title: String?
  let notes: String?
  let startAt: String?
  let endAt: String?
  let hasExplicitEndTime: Bool?
  let destination: SharedPlace?
}

private struct ScheduleCategory: Decodable {
  let id: String
  let title: String
  let color: String
  let shared: Bool?
  let sharePermission: String?

  private enum CodingKeys: String, CodingKey { case id, title, color, shared, sharePermission }

  var canWrite: Bool {
    shared != true || ["EDITOR", "OWNER"].contains(sharePermission?.uppercased() ?? "")
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let value = try? container.decode(String.self, forKey: .id) {
      id = value
    } else if let value = try? container.decode(Int.self, forKey: .id) {
      id = String(value)
    } else {
      throw DecodingError.dataCorruptedError(
        forKey: .id,
        in: container,
        debugDescription: "카테고리 id가 없습니다."
      )
    }
    title = (try? container.decode(String.self, forKey: .title)) ?? "카테고리"
    color = (try? container.decode(String.self, forKey: .color)) ?? "#5A96FF"
    shared = try? container.decode(Bool.self, forKey: .shared)
    sharePermission = try? container.decode(String.self, forKey: .sharePermission)
  }
}

private struct AuthTokens: Decodable, Sendable {
  let accessToken: String
  let refreshToken: String
}

private struct SavedSchedule: Decodable {
  let id: String

  private enum CodingKeys: String, CodingKey { case id }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let value = try? container.decode(String.self, forKey: .id) {
      id = value
    } else {
      id = String(try container.decode(Int.self, forKey: .id))
    }
  }
}

private enum ShareAPIError: LocalizedError {
  case loginRequired
  case invalidResponse
  case server(String)

  var errorDescription: String? {
    switch self {
    case .loginRequired:
      return "NoLate 앱에서 먼저 로그인해 주세요."
    case .invalidResponse:
      return "서버 응답을 확인할 수 없습니다."
    case .server(let message):
      return message
    }
  }
}

private actor ShareTokenRefreshCoordinator {
  private var refreshTask: Task<AuthTokens?, Never>?

  func refresh(using operation: @escaping @Sendable () async -> AuthTokens?) async -> AuthTokens? {
    if let refreshTask { return await refreshTask.value }
    let task = Task { await operation() }
    refreshTask = task
    let tokens = await task.value
    refreshTask = nil
    return tokens
  }
}

private final class ShareAPIClient {
  private let session: URLSession
  private var baseURL: URL
  private var accessToken: String?
  private let refreshCoordinator = ShareTokenRefreshCoordinator()
  private let accessTokenKey = "nolte_access_token"
  private let refreshTokenKey = "nolte_refresh_token"
  private let apiBaseURLKey = "nolate_auth_api_base_url"
  private let invalidSessionKey = "nolate_auth_invalid_session"
  private let invalidSessionValue = "invalidated"

  init() {
    let configured = Bundle.main.object(forInfoDictionaryKey: "NoLateAPIBaseURL") as? String
    baseURL = URL(string: configured ?? "https://nolate.jinuk.dev")!
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 25
    session = URLSession(configuration: configuration)
    if let sharedAPIBaseURL = readKeychain(apiBaseURLKey),
       let url = URL(string: sharedAPIBaseURL),
       isAllowedAPIBaseURL(url) {
      baseURL = url
    }
    accessToken = isSessionInvalidated
      ? nil
      : normalizedCredential(readKeychain(accessTokenKey))
  }

  private func isAllowedAPIBaseURL(_ url: URL) -> Bool {
    #if DEBUG
      return ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    #else
      return url.scheme?.lowercased() == "https"
    #endif
  }

  var isLoggedIn: Bool {
    guard !isSessionInvalidated else { return false }
    return normalizedCredential(readKeychain(accessTokenKey)) != nil
      || normalizedCredential(readKeychain(refreshTokenKey)) != nil
  }

  func get<Value: Decodable>(_ path: String) async throws -> Value {
    try await request(
      url: baseURL.appendingPathComponent(path),
      method: "GET",
      body: nil,
      retrying: true
    )
  }

  func post<Value: Decodable>(_ path: String, json: [String: Any]) async throws -> Value {
    let body = try JSONSerialization.data(withJSONObject: json)
    return try await request(
      url: baseURL.appendingPathComponent(path),
      method: "POST",
      body: body,
      retrying: true
    )
  }

  private func request<Value: Decodable>(
    url: URL,
    method: String,
    body: Data?,
    retrying: Bool
  ) async throws -> Value {
    guard !isSessionInvalidated else {
      accessToken = nil
      throw ShareAPIError.loginRequired
    }
    // The extension process may outlive an A logout and B login. Reload the
    // current shared credential instead of reusing an in-memory A access token.
    accessToken = normalizedCredential(readKeychain(accessTokenKey))
    guard let token = accessToken else {
      if retrying, await refreshTokens() {
        return try await request(url: url, method: method, body: body, retrying: false)
      }
      throw ShareAPIError.loginRequired
    }

    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw ShareAPIError.invalidResponse }

    if http.statusCode == 401 {
      if retrying, await refreshTokens() {
        return try await self.request(url: url, method: method, body: body, retrying: false)
      }
      throw ShareAPIError.loginRequired
    }

    guard (200..<300).contains(http.statusCode) else {
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      let message = object?["errorMessage"] as? String ?? object?["message"] as? String
      throw ShareAPIError.server(message ?? "요청에 실패했습니다. (\(http.statusCode))")
    }

    let envelope = try JSONDecoder().decode(APIEnvelope<Value>.self, from: data)
    guard envelope.success, let value = envelope.data else {
      throw ShareAPIError.server(envelope.errorMessage ?? "서버 요청을 처리하지 못했습니다.")
    }
    return value
  }

  private func refreshTokens() async -> Bool {
    guard !isSessionInvalidated else {
      accessToken = nil
      return false
    }
    guard let refreshToken = normalizedCredential(readKeychain(refreshTokenKey)) else { return false }
    let refreshURL = baseURL.appendingPathComponent("api/member/auth/refresh")
    let session = session
    guard let tokens = await refreshCoordinator.refresh(using: {
      var request = URLRequest(url: refreshURL)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: ["refreshToken": refreshToken])
      guard let (data, response) = try? await session.data(for: request),
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode),
            let envelope = try? JSONDecoder().decode(APIEnvelope<AuthTokens>.self, from: data),
            envelope.success else { return nil }
      return envelope.data
    }) else { return false }

    guard !isSessionInvalidated,
          normalizedCredential(readKeychain(refreshTokenKey)) == refreshToken,
          let accessToken = normalizedCredential(tokens.accessToken),
          let refreshToken = normalizedCredential(tokens.refreshToken) else { return false }
    let accessSaved = writeKeychain(accessToken, key: accessTokenKey)
    let refreshSaved = writeKeychain(refreshToken, key: refreshTokenKey)
    guard accessSaved, refreshSaved else {
      deleteKeychain(accessTokenKey, services: ["app:no-auth", "app"])
      deleteKeychain(refreshTokenKey, services: ["app:no-auth", "app"])
      self.accessToken = nil
      return false
    }
    // Once the new shared service has both credentials, remove values left by
    // older builds so a later logout cannot accidentally fall back to them.
    deleteKeychain(accessTokenKey, services: ["app"])
    deleteKeychain(refreshTokenKey, services: ["app"])
    self.accessToken = accessToken
    return true
  }

  private func normalizedCredential(_ value: String?) -> String? {
    guard let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !normalized.isEmpty else { return nil }
    return normalized
  }

  private var isSessionInvalidated: Bool {
    normalizedCredential(readKeychain(invalidSessionKey))
      == invalidSessionValue
  }

  private func keychainQuery(_ key: String, service: String) -> [String: Any] {
    let encoded = Data(key.utf8)
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrGeneric as String: encoded,
      kSecAttrAccount as String: encoded,
      kSecAttrAccessGroup as String: noLateSharedKeychainAccessGroup,
    ]
  }

  private func readKeychain(_ key: String) -> String? {
    for service in ["app:no-auth", "app"] {
      var query = keychainQuery(key, service: service)
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      query[kSecReturnData as String] = true
      var item: CFTypeRef?
      if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
         let data = item as? Data,
         let value = String(data: data, encoding: .utf8) {
        return value
      }
    }
    return nil
  }

  @discardableResult
  private func writeKeychain(_ value: String, key: String) -> Bool {
    var query = keychainQuery(key, service: "app:no-auth")
    let data = Data(value.utf8)
    let update = [kSecValueData as String: data]
    var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      query[kSecValueData as String] = data
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
      status = SecItemAdd(query as CFDictionary, nil)
    }
    return status == errSecSuccess
  }

  private func deleteKeychain(_ key: String, services: [String] = ["app:no-auth"]) {
    for service in services {
      SecItemDelete(keychainQuery(key, service: service) as CFDictionary)
    }
  }
}

final class ShareViewController: UIViewController {
  private static let brandColor = UIColor(
    red: 36.0 / 255.0,
    green: 107.0 / 255.0,
    blue: 254.0 / 255.0,
    alpha: 1
  )

  private let api = ShareAPIClient()
  private let iconView = UIImageView()
  private let titleLabel = UILabel()
  private let messageLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let primaryButton = UIButton(type: .system)
  private let closeButton = UIButton(type: .system)
  private var sharedText = ""
  private var saveTask: Task<Void, Never>?

  override func viewDidLoad() {
    super.viewDidLoad()
    configureUI()
    saveTask = Task { @MainActor [weak self] in
      await self?.saveSharedSchedule()
    }
  }

  private func configureUI() {
    view.backgroundColor = .systemGroupedBackground
    view.tintColor = Self.brandColor

    iconView.image = UIImage(systemName: "calendar.badge.plus")
    iconView.tintColor = Self.brandColor
    iconView.backgroundColor = Self.brandColor.withAlphaComponent(0.12)
    iconView.contentMode = .center
    iconView.layer.cornerRadius = 22
    iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 34, weight: .semibold)
    iconView.widthAnchor.constraint(equalToConstant: 88).isActive = true
    iconView.heightAnchor.constraint(equalToConstant: 88).isActive = true

    titleLabel.text = "일정을 저장하고 있어요"
    titleLabel.font = .preferredFont(forTextStyle: .title2)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 0

    messageLabel.text = "공유한 내용을 정리하는 중이에요.\n이동 경로는 앱에서 나중에 설정할 수 있어요."
    messageLabel.font = .preferredFont(forTextStyle: .body)
    messageLabel.adjustsFontForContentSizeCategory = true
    messageLabel.textColor = .secondaryLabel
    messageLabel.textAlignment = .center
    messageLabel.numberOfLines = 0

    spinner.color = Self.brandColor
    spinner.startAnimating()

    var primaryConfiguration = UIButton.Configuration.filled()
    primaryConfiguration.title = "NoLate 열기"
    primaryConfiguration.baseBackgroundColor = Self.brandColor
    primaryConfiguration.cornerStyle = .large
    primaryConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 15, leading: 24, bottom: 15, trailing: 24)
    primaryButton.configuration = primaryConfiguration
    primaryButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    primaryButton.addTarget(self, action: #selector(openNoLate), for: .touchUpInside)
    primaryButton.isHidden = true

    var closeConfiguration = UIButton.Configuration.plain()
    closeConfiguration.image = UIImage(systemName: "xmark.circle.fill")
    closeConfiguration.baseForegroundColor = .tertiaryLabel
    closeConfiguration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 24)
    closeButton.configuration = closeConfiguration
    closeButton.accessibilityLabel = "닫기"
    closeButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)
    closeButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(closeButton)

    let stack = UIStackView(arrangedSubviews: [iconView, titleLabel, messageLabel, spinner, primaryButton])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 18
    stack.setCustomSpacing(24, after: iconView)
    stack.setCustomSpacing(28, after: messageLabel)
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    NSLayoutConstraint.activate([
      closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 14),
      closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      closeButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      closeButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
      primaryButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
      primaryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 54),
    ])
  }

  @MainActor
  private func saveSharedSchedule() async {
    defer { saveTask = nil }
    do {
      try Task.checkCancellation()
      guard api.isLoggedIn else { throw ShareAPIError.loginRequired }
      sharedText = try await extractSharedText().trimmingCharacters(in: .whitespacesAndNewlines)
      try Task.checkCancellation()
      guard !sharedText.isEmpty else { throw ShareAPIError.server("공유된 텍스트가 없습니다.") }

      let referenceDateFormatter = DateFormatter()
      referenceDateFormatter.calendar = Calendar(identifier: .gregorian)
      referenceDateFormatter.locale = Locale(identifier: "en_US_POSIX")
      referenceDateFormatter.timeZone = TimeZone(identifier: "Asia/Seoul")
      referenceDateFormatter.dateFormat = "yyyy-MM-dd"

      async let parsedValue: ParseResult = api.post("api/schedules/parse", json: [
        "text": sharedText,
        "inputType": "SHARE_TEXT",
        "referenceDate": referenceDateFormatter.string(from: Date()),
        "defaultDurationMinutes": 60,
      ])
      async let categoryValues: [ScheduleCategory] = api.get("api/schedule-categories")
      let (parsed, categories) = try await (parsedValue, categoryValues)
      try Task.checkCancellation()
      guard let category = categories.first(where: \.canWrite) else {
        throw ShareAPIError.server("앱에서 일정을 저장할 수 있는 카테고리를 먼저 만들어 주세요.")
      }

      let formatter = ISO8601DateFormatter()
      let startAt = parseAPIDate(parsed.startAt) ?? Date()
      let explicitEndAt = parsed.hasExplicitEndTime == true
        ? parseAPIDate(parsed.endAt).flatMap { $0 > startAt ? $0 : nil }
        : nil
      let fallbackTitle = sharedText.split(whereSeparator: \.isNewline).first.map(String.init)
      let title = parsed.title?.trimmingCharacters(in: .whitespacesAndNewlines)
      let preferredTitle: String
      if let title, !title.isEmpty {
        preferredTitle = title
      } else {
        preferredTitle = fallbackTitle ?? "공유한 일정"
      }
      let scheduleTitle = String(preferredTitle.prefix(120))
      let destination = parsed.destination.flatMap { placeJSON($0) }

      let payload = compactJSON([
        "title": scheduleTitle,
        "startAt": formatter.string(from: startAt),
        "endAt": formatter.string(from: explicitEndAt ?? startAt),
        "hasEndTime": explicitEndAt != nil,
        "allDay": false,
        "destination": destination,
        "locationName": normalizedText(parsed.destination?.name) ?? normalizedText(parsed.destination?.address),
        "category": ["id": category.id, "title": category.title, "color": category.color],
        "notes": parsed.notes ?? sharedText,
        "notificationEnabled": false,
        "routeSetupRequired": true,
      ])
      try Task.checkCancellation()
      let _: SavedSchedule = try await api.post("api/schedules", json: payload)
      try Task.checkCancellation()
      showSaved()
    } catch is CancellationError {
      return
    } catch ShareAPIError.loginRequired {
      showFailure(title: "로그인이 필요해요", message: "NoLate 앱에서 로그인한 뒤 다시 공유해 주세요.")
    } catch {
      if Task.isCancelled { return }
      showFailure(title: "저장하지 못했어요", message: error.localizedDescription)
    }
  }

  private func parseAPIDate(_ value: String?) -> Date? {
    guard let value else { return nil }

    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) { return date }

    return ISO8601DateFormatter().date(from: value)
  }

  @MainActor
  private func showSaved() {
    spinner.stopAnimating()
    iconView.image = UIImage(systemName: "checkmark.circle.fill")
    iconView.tintColor = .systemGreen
    iconView.backgroundColor = UIColor.systemGreen.withAlphaComponent(0.12)
    titleLabel.text = "일정을 저장했어요"
    messageLabel.text = "경로가 필요한 일정으로 표시해 둘게요.\n앱에서 편한 때 이동 경로와 알림을 설정하세요."
    UIAccessibility.post(notification: .announcement, argument: "일정을 저장했어요")
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  @MainActor
  private func showFailure(title: String, message: String) {
    spinner.stopAnimating()
    iconView.image = UIImage(systemName: "exclamationmark.circle.fill")
    iconView.tintColor = .systemOrange
    iconView.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.12)
    titleLabel.text = title
    messageLabel.text = message
    var configuration = primaryButton.configuration
    configuration?.title = "NoLate 열기"
    primaryButton.configuration = configuration
    primaryButton.isEnabled = true
    primaryButton.isHidden = false
    UIAccessibility.post(notification: .announcement, argument: "\(title). \(message)")
  }

  private func extractSharedText() async throws -> String {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
      .flatMap { $0.attachments ?? [] } ?? []
    for provider in providers {
      for type in [UTType.plainText.identifier, UTType.text.identifier, UTType.url.identifier]
      where provider.hasItemConformingToTypeIdentifier(type) {
        do {
          let item = try await provider.loadItem(forTypeIdentifier: type)
          if let string = item as? String { return string }
          if let attributed = item as? NSAttributedString { return attributed.string }
          if let url = item as? URL { return url.absoluteString }
          if let data = item as? Data, let string = String(data: data, encoding: .utf8) { return string }
        } catch is CancellationError {
          throw CancellationError()
        } catch {
          // Some host apps advertise more than one representation and fail to
          // load the first one. Continue to the next representation/attachment.
          continue
        }
      }
    }
    throw ShareAPIError.server("텍스트 또는 링크를 찾지 못했어요.")
  }

  private func placeJSON(_ place: SharedPlace) -> [String: Any]? {
    let name = normalizedText(place.name)
    let address = normalizedText(place.address)
    let hasValidCoordinates = place.lat.map { (-90.0...90.0).contains($0) } == true &&
      place.lng.map { (-180.0...180.0).contains($0) } == true
    let result = compactJSON([
      "name": name,
      "address": address,
      "lat": hasValidCoordinates ? place.lat : nil,
      "lng": hasValidCoordinates ? place.lng : nil,
    ])
    return result.isEmpty ? nil : result
  }

  private func normalizedText(_ value: String?) -> String? {
    guard let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !normalized.isEmpty else { return nil }
    return normalized
  }

  private func compactJSON(_ values: [String: Any?]) -> [String: Any] {
    values.reduce(into: [:]) { result, pair in
      if let value = pair.value { result[pair.key] = value }
    }
  }

  @objc private func openNoLate() {
    guard let url = URL(string: "nolate://schedule"), let extensionContext else { return }
    primaryButton.isEnabled = false
    var configuration = primaryButton.configuration
    configuration?.title = "NoLate 여는 중"
    primaryButton.configuration = configuration
    extensionContext.open(url) { [weak self] opened in
      DispatchQueue.main.async {
        guard let self else { return }
        if opened {
          self.extensionContext?.completeRequest(returningItems: nil)
        } else {
          self.showFailure(
            title: "앱을 열 수 없어요",
            message: "NoLate가 설치되어 있는지 확인한 뒤 앱 아이콘에서 직접 열어 주세요."
          )
        }
      }
    }
  }

  @objc private func cancel() {
    saveTask?.cancel()
    saveTask = nil
    extensionContext?.cancelRequest(
      withError: NSError(domain: "NoLateShareExtension", code: NSUserCancelledError)
    )
  }
}

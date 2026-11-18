import PDFKit
import ImageIO
import Vision
import Security
import UIKit
import UniformTypeIdentifiers
import CoreText

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
    accessToken = normalizedCredential(readKeychain(accessTokenKey))
  }

  private func isAllowedAPIBaseURL(_ url: URL) -> Bool {
    #if DEBUG
      return ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    #else
      return url.scheme?.lowercased() == "https"
    #endif
  }

  var isLoggedIn: Bool {
    accessToken != nil || normalizedCredential(readKeychain(refreshTokenKey)) != nil
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

    guard let accessToken = normalizedCredential(tokens.accessToken),
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

enum ShareTicketColors {
  static let background = themed(light: 0xFFFFFF, dark: 0x17202D)
  static let text = themed(light: 0x172131, dark: 0xEDF4FF)
  static let detail = themed(light: 0x526174, dark: 0xB5C2D6)
  static let surface = themed(light: 0xF2F5F9, dark: 0x222F42)
  static let separator = themed(light: 0xE1E7EF, dark: 0x3B4B62)
  static let accent = themed(light: 0x205DD1, dark: 0xA5C9FF)
  static let action = color(0x205DD1)
  static let loading = themed(light: 0xEAF2FF, dark: 0x293F60)
  static let success = themed(light: 0x14754C, dark: 0xA2E6BF)
  static let successSurface = themed(light: 0xE5F6ED, dark: 0x1E3E35)
  static let warning = themed(light: 0x9B4C16, dark: 0xFFC291)
  static let warningSurface = themed(light: 0xFFF0E3, dark: 0x463127)
  static let error = themed(light: 0xAB2E32, dark: 0xFFB9BC)

  private static func themed(light: UInt32, dark: UInt32) -> UIColor {
    UIColor { color($0.userInterfaceStyle == .dark ? dark : light) }
  }

  private static func color(_ value: UInt32) -> UIColor {
    UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255,
            blue: CGFloat(value & 255) / 255, alpha: 1)
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
  private let iconContainer = UIView()
  private let iconView = UIImageView()
  private let titleLabel = UILabel()
  private let messageLabel = UILabel()
  private let savedNameLabel = UILabel()
  private let primaryButton = UIButton(type: .system)
  private let secondaryButton = UIButton(type: .system)
  private let statusActions = UIStackView()
  private let closeButton = UIButton(type: .system)
  private let statusScroll = UIScrollView()
  private var sharedText = ""
  private var saveTask: Task<Void, Never>?
  private enum PrimaryAction { case openApp, finish }
  private var primaryAction: PrimaryAction = .finish
  private enum StatusPhase { case reading, reviewing, saving, finished }
  private var statusPhase: StatusPhase = .reading
  private var playedSavingMotion = false
  private var savingMotionReady = false
  private var usesStandardLayout: Bool { !traitCollection.preferredContentSizeCategory.isAccessibilityCategory }

  private static let secondaryContent = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 161 / 255, green: 167 / 255, blue: 179 / 255, alpha: 1)
      : UIColor(red: 98 / 255, green: 105 / 255, blue: 119 / 255, alpha: 1)
  }

  private static let outlineFontName: String? = {
    guard let url = Bundle.main.url(forResource: "Ionicons", withExtension: "ttf"),
          let provider = CGDataProvider(url: url as CFURL),
          let font = CGFont(provider), let name = font.postScriptName else { return nil }
    CTFontManagerRegisterGraphicsFont(font, nil)
    return name as String
  }()

  static func outlineIcon(_ code: UInt32, size: CGFloat) -> UIImage? {
    guard let name = outlineFontName, let font = UIFont(name: name, size: size),
          let scalar = UnicodeScalar(code) else {
      assertionFailure("The bundled NoLate outline font is unavailable")
      return nil
    }
    let glyph = String(scalar) as NSString
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.black]
    let measured = glyph.size(withAttributes: attributes)
    return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
      glyph.draw(at: CGPoint(x: (size - measured.width) / 2, y: (size - measured.height) / 2), withAttributes: attributes)
    }.withRenderingMode(.alwaysTemplate)
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    configureUI()
    NotificationCenter.default.addObserver(self, selector: #selector(updateSavingMotion), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    saveTask = Task { @MainActor [weak self] in
      await self?.saveSharedSchedule()
    }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    updateSavingMotion()
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    iconContainer.layer.removeAnimation(forKey: "nolate.saving.depth")
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    iconContainer.layer.shadowPath = UIBezierPath(roundedRect: iconContainer.bounds, cornerRadius: 22).cgPath
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  @objc private func updateSavingMotion() {
    if UIAccessibility.isReduceMotionEnabled {
      iconContainer.layer.removeAnimation(forKey: "nolate.saving.depth")
    }
    guard statusPhase == .saving, savingMotionReady, !playedSavingMotion, view.window != nil else { return }
    playedSavingMotion = true
    playStatusMotion(duration: 0.36, saving: true)
  }

  private func playStatusMotion(duration: CFTimeInterval, saving: Bool) {
    guard !UIAccessibility.isReduceMotionEnabled else { return }
    let standard = usesStandardLayout
    func pose(_ scale: CGFloat, _ xAngle: CGFloat, _ yAngle: CGFloat, _ depth: CGFloat) -> CATransform3D {
      var transform = CATransform3DIdentity
      transform.m34 = -1 / 650
      if !standard { transform = CATransform3DScale(transform, scale, scale, 1) }
      transform = CATransform3DRotate(transform, xAngle, 1, 0, 0)
      transform = CATransform3DRotate(transform, yAngle, 0, 1, 0)
      transform = CATransform3DTranslate(transform, 0, 0, depth)
      return standard ? CATransform3DScale(transform, scale, scale, 1) : transform
    }
    let depth = CAKeyframeAnimation(keyPath: "transform")
    depth.values = [NSValue(caTransform3D: pose(0.92, saving ? 0.35 : 0, saving ? -0.42 : 0, standard && saving ? -16 : 0)),
                    NSValue(caTransform3D: pose(standard && !saving ? 1.03 : 1.02, saving ? -0.07 : 0, saving ? 0.09 : 0,
                                                standard && saving ? 3 : 0)),
                    NSValue(caTransform3D: CATransform3DIdentity)]
    depth.keyTimes = [0, 0.72, 1]
    depth.duration = duration
    let easing = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
    if standard {
      let fade = CAKeyframeAnimation(keyPath: "opacity")
      fade.values = [saving ? 0.65 : 0.6, 1, 1]
      fade.keyTimes = depth.keyTimes
      fade.duration = duration
      let motion = CAAnimationGroup()
      motion.animations = [depth, fade]
      motion.duration = duration
      motion.timingFunction = easing
      iconContainer.layer.add(motion, forKey: "nolate.saving.depth")
    } else {
      depth.timingFunction = easing
      iconContainer.layer.add(depth, forKey: "nolate.saving.depth")
    }
  }

  private func stopSavingMotion() {
    statusPhase = .finished
    iconContainer.layer.removeAnimation(forKey: "nolate.saving.depth")
    iconContainer.layer.shadowOpacity = 0
    iconView.contentMode = .center
  }

  private func configureUI() {
    let standard = usesStandardLayout
    let sceneSize: CGFloat = standard ? 82 : 88
    let logoSize: CGFloat = standard ? 74 : sceneSize
    view.backgroundColor = .systemGroupedBackground
    view.tintColor = Self.brandColor

    iconView.image = UIImage(named: "icon")
    iconView.tintColor = Self.brandColor
    iconContainer.backgroundColor = standard ? ShareTicketColors.loading : Self.brandColor.withAlphaComponent(0.12)
    iconContainer.layer.cornerRadius = 22
    iconView.contentMode = .scaleAspectFill
    iconView.layer.cornerRadius = standard ? 18 : 22
    iconView.clipsToBounds = true
    iconView.translatesAutoresizingMaskIntoConstraints = false
    iconContainer.addSubview(iconView)
    iconContainer.layer.shadowColor = UIColor.black.cgColor
    iconContainer.layer.shadowOffset = CGSize(width: 0, height: 6)
    iconContainer.layer.shadowRadius = 12
    NSLayoutConstraint.activate([
      iconContainer.widthAnchor.constraint(equalToConstant: sceneSize),
      iconContainer.heightAnchor.constraint(equalToConstant: sceneSize),
      iconView.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
      iconView.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
      iconView.widthAnchor.constraint(equalToConstant: logoSize),
      iconView.heightAnchor.constraint(equalToConstant: logoSize),
    ])

    titleLabel.text = "공유한 내용을 확인하고 있어요"
    titleLabel.font = UIFontMetrics(forTextStyle: .title2).scaledFont(for: .systemFont(ofSize: standard ? 24 : 22, weight: standard ? .bold : .semibold))
    titleLabel.textColor = standard ? ShareTicketColors.text : .label
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 0
    titleLabel.accessibilityTraits.insert(.header)

    messageLabel.isHidden = true
    messageLabel.font = .preferredFont(forTextStyle: standard ? .subheadline : .body)
    messageLabel.adjustsFontForContentSizeCategory = true
    messageLabel.textColor = standard ? ShareTicketColors.detail : Self.secondaryContent
    messageLabel.textAlignment = .center
    messageLabel.numberOfLines = 0

    let nameFont = UIFont.preferredFont(forTextStyle: .headline)
    savedNameLabel.font = nameFont
    savedNameLabel.textColor = standard ? ShareTicketColors.text : .label
    savedNameLabel.adjustsFontForContentSizeCategory = true
    savedNameLabel.textAlignment = .center
    savedNameLabel.numberOfLines = 0
    savedNameLabel.isHidden = true

    var primaryConfiguration = UIButton.Configuration.filled()
    primaryConfiguration.title = "NoLate 열기"
    primaryConfiguration.baseBackgroundColor = standard ? ShareTicketColors.action : Self.brandColor
    primaryConfiguration.baseForegroundColor = .white
    primaryConfiguration.cornerStyle = standard ? .fixed : .large
    if standard { primaryConfiguration.background.cornerRadius = 12 }
    primaryConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 15, leading: 24, bottom: 15, trailing: 24)
    primaryConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = .preferredFont(forTextStyle: .headline)
      return attributes
    }
    primaryButton.configuration = primaryConfiguration
    primaryButton.addTarget(self, action: #selector(performPrimaryAction), for: .touchUpInside)
    primaryButton.isHidden = true

    var secondaryConfiguration = UIButton.Configuration.plain()
    secondaryConfiguration.title = "닫기"
    secondaryConfiguration.baseForegroundColor = Self.secondaryContent
    secondaryButton.configuration = secondaryConfiguration
    secondaryButton.addTarget(self, action: #selector(closeStatus), for: .touchUpInside)
    secondaryButton.isHidden = true

    statusScroll.translatesAutoresizingMaskIntoConstraints = false
    statusScroll.contentInsetAdjustmentBehavior = .never
    statusScroll.accessibilityIdentifier = "share-status-scroll"
    let content = UIView()
    content.translatesAutoresizingMaskIntoConstraints = false
    statusScroll.addSubview(content)
    view.addSubview(statusScroll)

    var closeConfiguration = UIButton.Configuration.plain()
    // Ionicons close-circle-outline, from the same font used by the app.
    closeConfiguration.image = Self.outlineIcon(62028, size: 24)
    closeConfiguration.baseForegroundColor = Self.secondaryContent
    closeButton.configuration = closeConfiguration
    closeButton.accessibilityLabel = "공유 창 닫기"
    closeButton.addTarget(self, action: #selector(closeStatus), for: .touchUpInside)
    closeButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(closeButton)

    statusActions.addArrangedSubview(primaryButton)
    statusActions.addArrangedSubview(secondaryButton)
    statusActions.axis = .vertical
    statusActions.spacing = 4
    statusActions.isHidden = true
    let stack = UIStackView(arrangedSubviews: [iconContainer, titleLabel, savedNameLabel, messageLabel, statusActions])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = standard ? 12 : 18
    stack.setCustomSpacing(standard ? 18 : 24, after: iconContainer)
    stack.setCustomSpacing(standard ? 16 : 28, after: messageLabel)
    stack.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(stack)

    let fitViewport = content.heightAnchor.constraint(equalTo: statusScroll.frameLayoutGuide.heightAnchor)
    fitViewport.priority = .defaultLow
    let actionHeights = [(primaryButton, CGFloat(standard ? 46 : 54)), (secondaryButton, CGFloat(44))].map { button, height in
      let constraint = button.heightAnchor.constraint(greaterThanOrEqualToConstant: height)
      constraint.priority = .defaultHigh
      return constraint
    }
    let safeArea = view.safeAreaLayoutGuide
    // Reserve room for the fixed close button. The result stays centered when it fits.
    let statusPadding: CGFloat = 68
    let actionWidth = standard
      ? statusActions.widthAnchor.constraint(equalToConstant: 270)
      : statusActions.widthAnchor.constraint(equalTo: stack.widthAnchor)
    if standard { actionWidth.priority = .defaultHigh }

    NSLayoutConstraint.activate([
      statusScroll.topAnchor.constraint(equalTo: safeArea.topAnchor),
      statusScroll.bottomAnchor.constraint(equalTo: safeArea.bottomAnchor),
      statusScroll.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor),
      statusScroll.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor),
      content.topAnchor.constraint(equalTo: statusScroll.contentLayoutGuide.topAnchor),
      content.bottomAnchor.constraint(equalTo: statusScroll.contentLayoutGuide.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: statusScroll.contentLayoutGuide.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: statusScroll.contentLayoutGuide.trailingAnchor),
      content.widthAnchor.constraint(equalTo: statusScroll.frameLayoutGuide.widthAnchor),
      fitViewport,
      closeButton.topAnchor.constraint(equalTo: safeArea.topAnchor, constant: 14),
      closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      closeButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      closeButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
      stack.topAnchor.constraint(greaterThanOrEqualTo: content.topAnchor, constant: statusPadding),
      stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -statusPadding),
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
      statusActions.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor),
      actionWidth,
    ] + actionHeights)
  }

  @MainActor
  private func saveSharedSchedule() async {
    defer { saveTask = nil }
    do {
      try Task.checkCancellation()
      guard api.isLoggedIn else { throw ShareAPIError.loginRequired }
      let shared = try await extractSharedContent()
      sharedText = shared.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if ["IOS_SHARE_IMAGE", "IOS_SHARE_PDF"].contains(shared.source) || (TrainTicketDraft.isTicketText(sharedText) && URL(string: sharedText)?.host == nil) {
        try await importTrainTicket(text: sharedText, source: shared.source)
        return
      }
      if let url = URL(string: sharedText), let host = url.host, ["korail.com", "korail.go.kr", "letskorail.com", "srail.or.kr"].contains(where: { host == $0 || host.hasSuffix("." + $0) }) {
        throw ShareAPIError.server("링크만으로 승차권 내용을 확인할 수 없어요. 승차권 이미지 또는 상세 텍스트를 공유해 주세요.")
      }
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
      beginSaving()
      let _: SavedSchedule = try await api.post("api/schedules", json: payload)
      try Task.checkCancellation()
      showSaved(title: scheduleTitle)
    } catch is CancellationError {
      return
    } catch ShareAPIError.loginRequired {
      showFailure(title: "로그인이 필요해요", message: "NoLate에서 로그인한 뒤 원래 앱에서 다시 공유해 주세요.", canOpenApp: true)
    } catch {
      if Task.isCancelled { return }
      showFailure(title: "일정을 저장하지 못했어요", message: error.localizedDescription)
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
  private func beginSaving() {
    prepareSaving()
    revealSaving()
  }

  private func prepareSaving() {
    statusPhase = .saving
    savingMotionReady = false
    if usesStandardLayout { view.backgroundColor = ShareTicketColors.background }
    titleLabel.text = "일정을 저장하고 있어요"
    messageLabel.text = "완료되면 저장한 일정을 보여드릴게요."
    messageLabel.isHidden = false
    playedSavingMotion = false
  }

  private func revealSaving() {
    savingMotionReady = true
    updateSavingMotion()
    showStatusHeading()
  }

  @MainActor
  private func showSaved(title: String) {
    stopSavingMotion()
    view.backgroundColor = usesStandardLayout ? ShareTicketColors.background : .systemBackground
    closeButton.isHidden = true
    secondaryButton.isHidden = true
    // Ionicons checkmark-circle-outline.
    iconView.image = Self.outlineIcon(61983, size: usesStandardLayout ? 46 : 34)
    iconView.tintColor = usesStandardLayout ? ShareTicketColors.success : UIColor { traits in
      traits.userInterfaceStyle == .dark ? UIColor(red: 69 / 255, green: 212 / 255, blue: 131 / 255, alpha: 1) : UIColor(red: 23 / 255, green: 134 / 255, blue: 73 / 255, alpha: 1)
    }
    iconContainer.backgroundColor = usesStandardLayout ? ShareTicketColors.successSurface : UIColor.systemGreen.withAlphaComponent(0.12)
    titleLabel.text = "일정을 저장했어요"
    savedNameLabel.text = title
    savedNameLabel.isHidden = false
    messageLabel.text = "이동 경로와 알림은 NoLate에서 설정할 수 있어요."
    messageLabel.isHidden = false
    setPrimaryAction(.finish, title: "완료")
    playStatusMotion(duration: 0.18, saving: false)
    showStatusHeading()
  }

  @MainActor
  private func showFailure(title: String, message: String, canOpenApp: Bool = false, appOpenFailed: Bool = false) {
    stopSavingMotion()
    closeButton.isHidden = true
    secondaryButton.isHidden = !canOpenApp
    if appOpenFailed || usesStandardLayout { view.backgroundColor = usesStandardLayout ? ShareTicketColors.background : .systemBackground }
    // Ionicons close-outline and alert-circle-outline.
    iconView.image = Self.outlineIcon(usesStandardLayout || appOpenFailed ? 62030 : 61716, size: usesStandardLayout ? 46 : 34)
    iconView.tintColor = usesStandardLayout ? ShareTicketColors.warning : UIColor { traits in
      traits.userInterfaceStyle == .dark ? UIColor(red: 255 / 255, green: 181 / 255, blue: 101 / 255, alpha: 1) : UIColor(red: 143 / 255, green: 74 / 255, blue: 0, alpha: 1)
    }
    iconContainer.backgroundColor = usesStandardLayout ? ShareTicketColors.warningSurface : UIColor.systemOrange.withAlphaComponent(0.12)
    titleLabel.text = title
    messageLabel.text = message
    messageLabel.isHidden = false
    setPrimaryAction(canOpenApp ? .openApp : .finish, title: canOpenApp ? "NoLate 열기" : "닫기")
    showStatusHeading()
  }

  private func showStatusHeading() {
    view.layoutIfNeeded()
    statusScroll.setContentOffset(.zero, animated: false)
    UIAccessibility.post(notification: .screenChanged, argument: titleLabel)
  }

  @MainActor
  private func importTrainTicket(text: String, source: String) async throws {
    let categories: [ScheduleCategory] = try await api.get("api/schedule-categories")
    guard let category = categories.first(where: { $0.canWrite && $0.shared != true }) else {
      throw ShareAPIError.server("승차권 정보는 개인 카테고리에 저장합니다. 앱에서 개인 카테고리를 먼저 만들어 주세요.")
    }
    try Task.checkCancellation()
    statusPhase = .reviewing
    let preparesSavingDuringDismissal = usesStandardLayout
    let payload: [String: Any]? = await withCheckedContinuation { continuation in
      let review = TrainTicketReviewController(
        draft: TrainTicketDraft.parse(text), source: source, categoryName: category.title,
        willSave: preparesSavingDuringDismissal ? { [weak self] in self?.prepareSaving() } : nil
      ) {
        continuation.resume(returning: $0)
      }
      present(review, animated: !UIAccessibility.isReduceMotionEnabled)
    }
    try Task.checkCancellation()
    guard let ticket = payload else { extensionContext?.completeRequest(returningItems: nil); return }
    if preparesSavingDuringDismissal { revealSaving() }
    else { beginSaving() }
    let departure = ticket["departureName"] as? String ?? ""
    let arrival = ticket["arrivalName"] as? String ?? ""
    let arrivalAt = ticket["arrivalAt"] as? String ?? ""
    let kindLabel = ticket["kind"] as? String == "TRAIN" ? "기차" : (ticket["kind"] as? String == "EXPRESS_BUS" ? "고속버스" : "시외버스")
    let scheduleTitle = "\(kindLabel) \(departure) → \(arrival)"
    let notes = "승차권 입력 정보 · 사용자 확인 · 예매 상태 미검증\n\(departure) → \(arrival)\n출발 \(ticket["departureAt"] ?? "")\n도착 \(arrivalAt)\n\(kindLabel) \(ticket["grade"] ?? "") \(ticket["trainNumber"] ?? "")\n실제 승차권은 예매처에서 확인하세요."
    let _: SavedSchedule = try await api.post("api/schedules", json: [
      "title": scheduleTitle, "startAt": arrivalAt, "endAt": arrivalAt,
      "hasEndTime": false, "allDay": false, "travelMode": "TRANSIT",
      "origin": ["name": departure], "destination": ["name": arrival], "locationName": "\(departure) → \(arrival)",
      "category": ["id": category.id, "title": category.title, "color": category.color],
      "notes": notes, "notificationEnabled": false, "routeSetupRequired": true,
      "route": ["schemaVersion": 3, "importedTicket": ticket],
    ])
    try Task.checkCancellation()
    showSaved(title: scheduleTitle)
  }

  private func extractSharedContent() async throws -> (text: String, source: String) {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
    let pdfs = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) }
    guard pdfs.count <= 1, !(pdfs.count == 1 && providers.count > 1) else { throw ShareAPIError.server("승차권 파일 한 개만 공유해 주세요.") }
    if let provider = pdfs.first {
      let item = try await provider.loadItem(forTypeIdentifier: UTType.pdf.identifier)
      let data: Data
      if let value = item as? Data { data = value }
      else if let url = item as? URL, url.isFileURL {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 20 * 1024 * 1024 else { throw ShareAPIError.server("20MB 이하의 PDF를 공유해 주세요.") }
        data = try Data(contentsOf: url, options: .mappedIfSafe)
      } else { throw ShareAPIError.server("PDF를 읽을 수 없어요.") }
      guard data.count <= 20 * 1024 * 1024 else { throw ShareAPIError.server("20MB 이하의 PDF를 공유해 주세요.") }
      let text = try await Task.detached(priority: .userInitiated) {
        guard let document = PDFDocument(data: data), !document.isLocked, document.pageCount == 1, let page = document.page(at: 0) else {
          throw ShareAPIError.server("잠기지 않은 한 페이지 승차권 PDF만 공유해 주세요. 왕복·여러 표는 한 운행편씩 공유하세요.")
        }
        if let text = page.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          guard text.utf8.count <= 32000 else { throw ShareAPIError.server("PDF 내용이 너무 많아요. 한 운행편만 공유해 주세요.") }
          return text
        }
        let image = page.thumbnail(of: CGSize(width: 1600, height: 2000), for: .mediaBox)
        guard let cgImage = image.cgImage else { throw ShareAPIError.server("PDF 이미지를 읽을 수 없어요.") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate; request.recognitionLanguages = ["ko-KR", "en-US"]; request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
      }.value
      return (text, "IOS_SHARE_PDF")
    }
    let images = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
    guard images.count <= 1 else { throw ShareAPIError.server("한 번에 승차권 이미지 한 장만 공유해 주세요.") }
    if let provider = images.first {
      let imageType = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true } ?? UTType.image.identifier
      let item = try await provider.loadItem(forTypeIdentifier: imageType)
      let data: Data
      if let value = item as? Data { data = value }
      else if let image = item as? UIImage, let encoded = image.pngData() { data = encoded }
      else if let url = item as? URL, url.isFileURL {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 20 * 1024 * 1024 else { throw ShareAPIError.server("20MB 이하의 승차권 이미지를 공유해 주세요.") }
        data = try Data(contentsOf: url, options: .mappedIfSafe)
      } else { throw ShareAPIError.server("공유한 이미지 형식을 읽을 수 없어요.") }
      guard data.count <= 20 * 1024 * 1024 else { throw ShareAPIError.server("20MB 이하의 승차권 이미지를 공유해 주세요.") }
      // Downsample before recognition to fit the share extension memory budget.
      let text = try await Task.detached(priority: .userInitiated) {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048,
                kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: false,
              ] as CFDictionary) else { throw ShareAPIError.server("이미지를 읽을 수 없어요. 다른 승차권 이미지를 공유해 주세요.") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate; request.recognitionLanguages = ["ko-KR", "en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
      }.value
      return (text, "IOS_SHARE_IMAGE")
    }
    var texts: [String] = []
    for provider in providers {
      for type in [UTType.plainText.identifier, UTType.text.identifier, UTType.url.identifier]
      where provider.hasItemConformingToTypeIdentifier(type) {
        do {
          let item = try await provider.loadItem(forTypeIdentifier: type)
          let value: String?
          if let string = item as? String { value = string }
          else if let attributed = item as? NSAttributedString { value = attributed.string }
          else if let url = item as? URL, ["http", "https"].contains(url.scheme ?? "") { value = url.absoluteString }
          else if let data = item as? Data { value = String(data: data, encoding: .utf8) }
          else { value = nil }
          if let value { texts.append(value); break }
        } catch is CancellationError { throw CancellationError() }
        catch { continue }
      }
    }
    guard texts.count == 1, let text = texts.first, text.utf8.count <= 32000 else {
      throw ShareAPIError.server("승차권 텍스트 한 개 또는 이미지 한 장을 공유해 주세요.")
    }
    return (text, "IOS_SHARE_TEXT")
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

  private func setPrimaryAction(_ action: PrimaryAction, title: String) {
    primaryAction = action
    var configuration = primaryButton.configuration
    configuration?.title = title
    primaryButton.configuration = configuration
    primaryButton.isEnabled = true
    primaryButton.isHidden = false
    statusActions.isHidden = false
  }

  @objc private func performPrimaryAction() {
    switch primaryAction {
    case .openApp: openNoLate()
    case .finish: extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func openNoLate() {
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
            title: "NoLate를 열 수 없어요",
            message: "이 창을 닫고 홈 화면에서 NoLate를 직접 열어 주세요.",
            appOpenFailed: true
          )
        }
      }
    }
  }

  @objc private func closeStatus() {
    if statusPhase == .finished {
      extensionContext?.completeRequest(returningItems: nil)
      return
    }
    saveTask?.cancel()
    saveTask = nil
    extensionContext?.cancelRequest(
      withError: NSError(domain: "NoLateShareExtension", code: NSUserCancelledError)
    )
  }
}

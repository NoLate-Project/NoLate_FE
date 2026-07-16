import Security
import UIKit
import UniformTypeIdentifiers

private struct APIEnvelope<Value: Decodable>: Decodable {
  let success: Bool
  let data: Value?
  let errorMessage: String?
}

private struct SharedPlace: Codable {
  var name: String?
  var address: String?
  var lat: Double?
  var lng: Double?
  var provider: String?
  var providerPlaceId: String?
}

private struct ParseResult: Decodable {
  let title: String?
  let notes: String?
  let startAt: String?
  let endAt: String?
  let origin: SharedPlace?
  let destination: SharedPlace?
  let warnings: [String]
  let missingFields: [String]
}

private struct ScheduleCategory: Codable {
  let id: String
  let title: String
  let color: String

  private enum CodingKeys: String, CodingKey { case id, title, color }

  init(id: String, title: String, color: String) {
    self.id = id
    self.title = title
    self.color = color
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let stringID = try? container.decode(String.self, forKey: .id) {
      id = stringID
    } else if let numberID = try? container.decode(Int.self, forKey: .id) {
      id = String(numberID)
    } else {
      throw DecodingError.dataCorruptedError(forKey: .id, in: container, debugDescription: "카테고리 id가 없습니다.")
    }
    title = (try? container.decode(String.self, forKey: .title)) ?? "카테고리"
    color = (try? container.decode(String.self, forKey: .color)) ?? "#5A96FF"
  }
}

private struct RouteOption: Codable {
  let id: String
  let mode: String
  let minutes: Int
  let distanceMeters: Int?
  let transferCount: Int?
  let walkMeters: Int?
  let fareWon: Int?
  let summary: String
  let provider: String
  let providerRouteOption: String?
}

private struct AuthTokens: Decodable {
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
    case .loginRequired: return "NoLate 앱에서 먼저 로그인해 주세요."
    case .invalidResponse: return "서버 응답을 확인할 수 없습니다."
    case .server(let message): return message
    }
  }
}

private final class ShareAPIClient {
  private let session: URLSession
  private let baseURL: URL
  private var accessToken: String?
  private let accessTokenKey = "nolte_access_token"
  private let refreshTokenKey = "nolte_refresh_token"

  init() {
    let configured = Bundle.main.object(forInfoDictionaryKey: "NoLateAPIBaseURL") as? String
    baseURL = URL(string: configured ?? "https://nolate.jinuk.dev")!
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 25
    session = URLSession(configuration: configuration)
    accessToken = readKeychain(accessTokenKey)
  }

  var isLoggedIn: Bool { accessToken != nil || readKeychain(refreshTokenKey) != nil }

  func get<Value: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> Value {
    var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
    components.queryItems = query.isEmpty ? nil : query
    return try await request(url: components.url!, method: "GET", body: nil, retrying: true)
  }

  func post<Value: Decodable>(_ path: String, json: [String: Any]) async throws -> Value {
    let body = try JSONSerialization.data(withJSONObject: json)
    return try await request(url: baseURL.appendingPathComponent(path), method: "POST", body: body, retrying: true)
  }

  private func request<Value: Decodable>(url: URL, method: String, body: Data?, retrying: Bool) async throws -> Value {
    guard let token = accessToken else {
      if retrying, await refreshTokens() {
        return try await request(url: url, method: method, body: body, retrying: false)
      }
      throw ShareAPIError.loginRequired
    }
    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = method
    urlRequest.httpBody = body
    urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await session.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else { throw ShareAPIError.invalidResponse }
    if http.statusCode == 401, retrying, await refreshTokens() {
      return try await request(url: url, method: method, body: body, retrying: false)
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
    guard let refreshToken = readKeychain(refreshTokenKey) else { return false }
    var request = URLRequest(url: baseURL.appendingPathComponent("api/member/auth/refresh"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["refreshToken": refreshToken])
    guard let (data, response) = try? await session.data(for: request),
          let http = response as? HTTPURLResponse,
          (200..<300).contains(http.statusCode),
          let envelope = try? JSONDecoder().decode(APIEnvelope<AuthTokens>.self, from: data),
          envelope.success,
          let tokens = envelope.data else { return false }
    accessToken = tokens.accessToken
    writeKeychain(tokens.accessToken, key: accessTokenKey)
    writeKeychain(tokens.refreshToken, key: refreshTokenKey)
    return true
  }

  private func keychainQuery(_ key: String, service: String) -> [String: Any] {
    let encoded = Data(key.utf8)
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrGeneric as String: encoded,
      kSecAttrAccount as String: encoded,
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

  private func writeKeychain(_ value: String, key: String) {
    var query = keychainQuery(key, service: "app:no-auth")
    let data = Data(value.utf8)
    let update = [kSecValueData as String: data]
    if SecItemUpdate(query as CFDictionary, update as CFDictionary) == errSecItemNotFound {
      query[kSecValueData as String] = data
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
      SecItemAdd(query as CFDictionary, nil)
    }
  }
}

private final class PlaceInputView: UIStackView {
  let titleLabel = UILabel()
  let textField = UITextField()
  let searchButton = UIButton(type: .system)
  var place: SharedPlace? {
    didSet { textField.text = place?.name ?? place?.address }
  }

  init(title: String) {
    super.init(frame: .zero)
    axis = .vertical
    spacing = 8
    titleLabel.text = title
    titleLabel.font = .preferredFont(forTextStyle: .subheadline)
    titleLabel.textColor = .secondaryLabel
    let row = UIStackView(arrangedSubviews: [textField, searchButton])
    row.spacing = 0
    row.backgroundColor = .tertiarySystemFill
    row.layer.cornerRadius = 12
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 14, bottom: 0, trailing: 6)
    row.heightAnchor.constraint(equalToConstant: 48).isActive = true
    textField.borderStyle = .none
    textField.placeholder = "장소를 입력하세요"
    textField.clearButtonMode = .whileEditing
    textField.font = .preferredFont(forTextStyle: .body)
    textField.returnKeyType = .search
    var searchConfiguration = UIButton.Configuration.plain()
    searchConfiguration.image = UIImage(systemName: "magnifyingglass")
    searchConfiguration.baseForegroundColor = ShareViewController.brandColor
    searchConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    searchButton.configuration = searchConfiguration
    searchButton.accessibilityLabel = "\(title) 검색"
    searchButton.setContentHuggingPriority(.required, for: .horizontal)
    addArrangedSubview(titleLabel)
    addArrangedSubview(row)
  }

  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

final class ShareViewController: UIViewController {
  fileprivate static let brandColor = UIColor(red: 0.11, green: 0.43, blue: 1, alpha: 1)

  private let api = ShareAPIClient()
  private let scrollView = UIScrollView()
  private let contentStack = UIStackView()
  private let bottomBar = UIView()
  private let statusLabel = UILabel()
  private let titleField = UITextField()
  private let datePicker = UIDatePicker()
  private let originInput = PlaceInputView(title: "출발지")
  private let destinationInput = PlaceInputView(title: "도착지")
  private let categoryButton = UIButton(type: .system)
  private let modeControl = UISegmentedControl(items: ["자동차", "대중교통", "도보"])
  private let findRouteButton = UIButton(type: .system)
  private let routesStack = UIStackView()
  private let saveButton = UIButton(type: .system)
  private let spinner = UIActivityIndicatorView(style: .medium)
  private var sharedText = ""
  private var notes: String?
  private var parsedEndAt: Date?
  private var categories: [ScheduleCategory] = []
  private var selectedCategory: ScheduleCategory?
  private var routeOptions: [RouteOption] = []
  private var selectedRoute: RouteOption?

  override func viewDidLoad() {
    super.viewDidLoad()
    configureUI()
    Task { await loadSharedContent() }
  }

  private func configureUI() {
    view.backgroundColor = .systemGroupedBackground
    view.tintColor = Self.brandColor

    scrollView.translatesAutoresizingMaskIntoConstraints = false
    contentStack.translatesAutoresizingMaskIntoConstraints = false
    contentStack.axis = .vertical
    contentStack.spacing = 20
    bottomBar.translatesAutoresizingMaskIntoConstraints = false
    bottomBar.backgroundColor = .systemGroupedBackground
    bottomBar.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20)
    saveButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrollView)
    view.addSubview(bottomBar)
    scrollView.addSubview(contentStack)
    bottomBar.addSubview(saveButton)
    NSLayoutConstraint.activate([
      scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scrollView.bottomAnchor.constraint(equalTo: bottomBar.topAnchor),
      contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 20),
      contentStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 20),
      contentStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -20),
      contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -20),
      bottomBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bottomBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bottomBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      saveButton.topAnchor.constraint(equalTo: bottomBar.layoutMarginsGuide.topAnchor),
      saveButton.leadingAnchor.constraint(equalTo: bottomBar.layoutMarginsGuide.leadingAnchor),
      saveButton.trailingAnchor.constraint(equalTo: bottomBar.layoutMarginsGuide.trailingAnchor),
      saveButton.bottomAnchor.constraint(equalTo: bottomBar.layoutMarginsGuide.bottomAnchor),
      saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 54),
    ])

    let heroIcon = UIImageView(image: UIImage(systemName: "calendar.badge.plus"))
    heroIcon.tintColor = Self.brandColor
    heroIcon.contentMode = .scaleAspectFit
    heroIcon.backgroundColor = Self.brandColor.withAlphaComponent(0.12)
    heroIcon.layer.cornerRadius = 14
    heroIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 23, weight: .semibold)
    heroIcon.widthAnchor.constraint(equalToConstant: 52).isActive = true
    heroIcon.heightAnchor.constraint(equalToConstant: 52).isActive = true
    let header = UILabel()
    header.text = "일정으로 정리했어요"
    header.font = .preferredFont(forTextStyle: .title2)
    header.numberOfLines = 0
    let headerSubtitle = UILabel()
    headerSubtitle.text = "내용을 확인하고 이동 경로만 선택해 주세요."
    headerSubtitle.font = .preferredFont(forTextStyle: .subheadline)
    headerSubtitle.textColor = .secondaryLabel
    headerSubtitle.numberOfLines = 0
    let headerCopy = UIStackView(arrangedSubviews: [header, headerSubtitle])
    headerCopy.axis = .vertical
    headerCopy.spacing = 4
    let cancelButton = UIButton(type: .system)
    var cancelConfiguration = UIButton.Configuration.plain()
    cancelConfiguration.image = UIImage(systemName: "xmark.circle.fill")
    cancelConfiguration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 22)
    cancelConfiguration.baseForegroundColor = .tertiaryLabel
    cancelConfiguration.contentInsets = .zero
    cancelButton.configuration = cancelConfiguration
    cancelButton.accessibilityLabel = "취소"
    cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)
    cancelButton.setContentHuggingPriority(.required, for: .horizontal)
    let headerRow = UIStackView(arrangedSubviews: [heroIcon, headerCopy, cancelButton])
    headerRow.alignment = .center
    headerRow.spacing = 12
    statusLabel.font = .preferredFont(forTextStyle: .subheadline)
    statusLabel.textColor = .secondaryLabel
    statusLabel.numberOfLines = 0
    let statusIcon = UIImageView(image: UIImage(systemName: "sparkles"))
    statusIcon.tintColor = Self.brandColor
    statusIcon.setContentHuggingPriority(.required, for: .horizontal)
    let statusRow = UIStackView(arrangedSubviews: [statusIcon, statusLabel, spinner])
    statusRow.alignment = .center
    statusRow.spacing = 9
    statusRow.backgroundColor = Self.brandColor.withAlphaComponent(0.09)
    statusRow.layer.cornerRadius = 12
    statusRow.isLayoutMarginsRelativeArrangement = true
    statusRow.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 11, leading: 13, bottom: 11, trailing: 13)
    titleField.borderStyle = .none
    titleField.placeholder = "일정 제목"
    titleField.font = .preferredFont(forTextStyle: .body)
    styleField(titleField)
    datePicker.datePickerMode = .dateAndTime
    datePicker.preferredDatePickerStyle = .compact
    datePicker.locale = Locale(identifier: "ko_KR")
    datePicker.tintColor = Self.brandColor
    modeControl.selectedSegmentIndex = 1
    modeControl.selectedSegmentTintColor = Self.brandColor
    modeControl.setTitleTextAttributes([.foregroundColor: UIColor.white], for: .selected)
    modeControl.heightAnchor.constraint(equalToConstant: 42).isActive = true
    modeControl.addTarget(self, action: #selector(modeChanged), for: .valueChanged)
    originInput.searchButton.addTarget(self, action: #selector(searchOrigin), for: .touchUpInside)
    destinationInput.searchButton.addTarget(self, action: #selector(searchDestination), for: .touchUpInside)

    configurePrimaryButton(findRouteButton, title: "추천 경로 찾기", image: "arrow.triangle.turn.up.right.diamond.fill")
    findRouteButton.addTarget(self, action: #selector(findRoutes), for: .touchUpInside)
    routesStack.axis = .vertical
    routesStack.spacing = 8
    configurePrimaryButton(saveButton, title: "경로를 선택해 주세요", image: "checkmark")
    saveButton.addTarget(self, action: #selector(saveSchedule), for: .touchUpInside)
    saveButton.isEnabled = false

    configureCategoryButton()
    let scheduleCard = sectionCard(
      title: "일정 정보",
      icon: "calendar",
      views: [labeledField(title: "제목", field: titleField), labeledRow(title: "날짜 및 시간", view: datePicker), labeledRow(title: "카테고리", view: categoryButton)]
    )
    let routeCard = sectionCard(
      title: "이동 정보",
      icon: "location.fill",
      views: [originInput, destinationInput, labeledRow(title: "이동수단", view: modeControl), findRouteButton, routesStack]
    )
    [headerRow, statusRow, scheduleCard, routeCard].forEach(contentStack.addArrangedSubview)
    spinner.hidesWhenStopped = true
  }

  private func styleField(_ field: UITextField) {
    field.backgroundColor = .tertiarySystemFill
    field.layer.cornerRadius = 12
    field.heightAnchor.constraint(equalToConstant: 48).isActive = true
    let inset = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
    field.leftView = inset
    field.leftViewMode = .always
  }

  private func configureCategoryButton() {
    var configuration = UIButton.Configuration.gray()
    configuration.title = "카테고리 선택"
    configuration.image = UIImage(systemName: "chevron.down")
    configuration.imagePlacement = .trailing
    configuration.imagePadding = 8
    configuration.cornerStyle = .medium
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
    categoryButton.configuration = configuration
    categoryButton.contentHorizontalAlignment = .leading
    categoryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
  }

  private func sectionCard(title: String, icon: String, views: [UIView]) -> UIView {
    let iconView = UIImageView(image: UIImage(systemName: icon))
    iconView.tintColor = Self.brandColor
    iconView.setContentHuggingPriority(.required, for: .horizontal)
    let titleLabel = UILabel()
    titleLabel.text = title
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    let titleRow = UIStackView(arrangedSubviews: [iconView, titleLabel])
    titleRow.alignment = .center
    titleRow.spacing = 8

    let stack = UIStackView(arrangedSubviews: ([titleRow] as [UIView]) + views)
    stack.axis = .vertical
    stack.spacing = 16
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 18, leading: 16, bottom: 18, trailing: 16)
    stack.backgroundColor = .secondarySystemGroupedBackground
    stack.layer.cornerRadius = 18
    stack.layer.cornerCurve = .continuous
    return stack
  }

  private func labeledField(title: String, field: UIView) -> UIView { labeledRow(title: title, view: field) }

  private func labeledRow(title: String, view child: UIView) -> UIView {
    let label = UILabel()
    label.text = title
    label.font = .preferredFont(forTextStyle: .caption1)
    label.textColor = .secondaryLabel
    let stack = UIStackView(arrangedSubviews: [label, child])
    stack.axis = .vertical
    stack.spacing = 6
    return stack
  }

  private func configurePrimaryButton(_ button: UIButton, title: String, image: String? = nil) {
    var configuration = UIButton.Configuration.filled()
    configuration.title = title
    configuration.image = image.flatMap { UIImage(systemName: $0) }
    configuration.imagePadding = 8
    configuration.cornerStyle = .large
    configuration.baseBackgroundColor = Self.brandColor
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 16, bottom: 13, trailing: 16)
    button.configuration = configuration
  }

  @MainActor
  private func loadSharedContent() async {
    setBusy(true, message: "공유한 텍스트를 불러오는 중…")
    do {
      guard api.isLoggedIn else { throw ShareAPIError.loginRequired }
      sharedText = try await extractSharedText().trimmingCharacters(in: .whitespacesAndNewlines)
      guard !sharedText.isEmpty else { throw ShareAPIError.server("공유된 텍스트가 없습니다.") }
      if sharedText.count > 2000 { sharedText = String(sharedText.prefix(2000)) }
      let referenceDateFormatter = DateFormatter()
      referenceDateFormatter.calendar = Calendar(identifier: .gregorian)
      referenceDateFormatter.locale = Locale(identifier: "en_US_POSIX")
      referenceDateFormatter.timeZone = TimeZone(identifier: "Asia/Seoul")
      referenceDateFormatter.dateFormat = "yyyy-MM-dd"
      async let parsed: ParseResult = api.post("api/schedules/parse", json: [
        "text": sharedText,
        "inputType": "SHARE_TEXT",
        "referenceDate": referenceDateFormatter.string(from: Date()),
        "defaultDurationMinutes": 60,
      ])
      async let loadedCategories: [ScheduleCategory] = api.get("api/schedule-categories")
      let (result, categoryValues) = try await (parsed, loadedCategories)
      apply(result)
      categories = categoryValues
      selectedCategory = categories.first
      updateCategoryMenu()
      await resolveParsedPlaces()
      let warning = result.warnings.first
      statusLabel.text = warning ?? "내용을 확인하고 경로를 선택해 주세요."
      setBusy(false)
    } catch {
      setBusy(false, message: error.localizedDescription)
      findRouteButton.isEnabled = false
    }
  }

  @MainActor
  private func apply(_ result: ParseResult) {
    titleField.text = result.title ?? sharedText.split(separator: "\n").first.map(String.init)
    notes = result.notes
    let formatter = ISO8601DateFormatter()
    if let value = result.startAt, let date = formatter.date(from: value) { datePicker.date = date }
    if let value = result.endAt { parsedEndAt = formatter.date(from: value) }
    originInput.place = result.origin
    destinationInput.place = result.destination
  }

  @MainActor
  private func resolveParsedPlaces() async {
    if let name = originInput.place?.name, originInput.place?.lat == nil {
      originInput.place = try? await searchPlaces(name).first
    }
    if let name = destinationInput.place?.name, destinationInput.place?.lat == nil {
      destinationInput.place = try? await searchPlaces(name).first
    }
  }

  private func extractSharedText() async throws -> String {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
      .flatMap { $0.attachments ?? [] } ?? []
    for provider in providers {
      for type in [UTType.plainText.identifier, UTType.text.identifier, UTType.url.identifier] where provider.hasItemConformingToTypeIdentifier(type) {
        let item = try await provider.loadItem(forTypeIdentifier: type)
        if let string = item as? String { return string }
        if let attributed = item as? NSAttributedString { return attributed.string }
        if let url = item as? URL { return url.absoluteString }
        if let data = item as? Data, let string = String(data: data, encoding: .utf8) { return string }
      }
    }
    throw ShareAPIError.server("선택한 텍스트를 읽지 못했습니다.")
  }

  private func searchPlaces(_ query: String) async throws -> [SharedPlace] {
    try await api.get("api/routes/quick-share/places", query: [URLQueryItem(name: "query", value: query)])
  }

  @objc private func searchOrigin() { search(input: originInput) }
  @objc private func searchDestination() { search(input: destinationInput) }

  private func search(input: PlaceInputView) {
    let query = input.textField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !query.isEmpty else { showError("장소 이름을 입력해 주세요."); return }
    setBusy(true, message: "장소를 검색하는 중…")
    Task { @MainActor in
      do {
        let places = try await searchPlaces(query)
        setBusy(false)
        guard !places.isEmpty else { showError("검색 결과가 없습니다."); return }
        let sheet = UIAlertController(title: "장소 선택", message: nil, preferredStyle: .actionSheet)
        places.forEach { place in
          sheet.addAction(UIAlertAction(title: [place.name, place.address].compactMap { $0 }.joined(separator: " · "), style: .default) { _ in
            input.place = place
            self.clearRoutes()
          })
        }
        sheet.addAction(UIAlertAction(title: "취소", style: .cancel))
        present(sheet, animated: true)
      } catch {
        setBusy(false)
        showError(error.localizedDescription)
      }
    }
  }

  @objc private func modeChanged() { clearRoutes() }

  @objc private func findRoutes() {
    guard let origin = originInput.place, origin.lat != nil,
          let destination = destinationInput.place, destination.lat != nil else {
      showError("출발지와 도착지를 검색해 선택해 주세요.")
      return
    }
    let modes = ["CAR", "TRANSIT", "WALK"]
    let mode = modes[modeControl.selectedSegmentIndex]
    setBusy(true, message: "경로 후보를 찾는 중…")
    Task { @MainActor in
      do {
        let body: [String: Any] = [
          "origin": placeJSON(origin),
          "destination": placeJSON(destination),
          "mode": mode,
          "departureAt": ISO8601DateFormatter().string(from: datePicker.date),
        ]
        let options: [RouteOption] = try await api.post("api/routes/quick-share/options", json: body)
        routeOptions = options
        selectedRoute = options.first
        renderRoutes()
        setBusy(false, message: "경로를 선택한 뒤 저장해 주세요.")
      } catch {
        setBusy(false)
        showError(error.localizedDescription)
      }
    }
  }

  private func renderRoutes() {
    routesStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    for (index, option) in routeOptions.enumerated() {
      let button = UIButton(type: .system)
      let isSelected = selectedRoute?.id == option.id
      var configuration = isSelected ? UIButton.Configuration.tinted() : UIButton.Configuration.gray()
      configuration.title = "\(option.summary) · \(option.minutes)분"
      var details: [String] = []
      if let distance = option.distanceMeters { details.append(String(format: "%.1fkm", Double(distance) / 1000)) }
      if let fare = option.fareWon, fare > 0 { details.append("\(fare.formatted())원") }
      configuration.subtitle = details.joined(separator: " · ")
      configuration.image = UIImage(systemName: isSelected ? "checkmark.circle.fill" : "circle")
      configuration.imagePadding = 10
      configuration.imagePlacement = .leading
      configuration.cornerStyle = .medium
      configuration.baseForegroundColor = isSelected ? Self.brandColor : .label
      configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
      button.configuration = configuration
      button.tag = index
      button.addTarget(self, action: #selector(selectRoute(_:)), for: .touchUpInside)
      routesStack.addArrangedSubview(button)
    }
    updateSaveButtonState()
  }

  @objc private func selectRoute(_ sender: UIButton) {
    guard routeOptions.indices.contains(sender.tag) else { return }
    selectedRoute = routeOptions[sender.tag]
    renderRoutes()
  }

  private func clearRoutes() {
    routeOptions = []
    selectedRoute = nil
    renderRoutes()
  }

  @objc private func saveSchedule() {
    guard let title = titleField.text?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty,
          let category = selectedCategory,
          let origin = originInput.place,
          let destination = destinationInput.place,
          let route = selectedRoute else {
      showError("제목, 장소, 경로를 모두 확인해 주세요.")
      return
    }
    setBusy(true, message: "일정을 저장하는 중…")
    saveButton.isEnabled = false
    Task { @MainActor in
      do {
        let formatter = ISO8601DateFormatter()
        let startAt = datePicker.date
        let endAt = parsedEndAt.flatMap { $0 > startAt ? $0 : nil } ?? startAt.addingTimeInterval(3600)
        let routeJSON: [String: Any] = compactJSON([
          "id": route.id,
          "mode": route.mode,
          "minutes": route.minutes,
          "distanceMeters": route.distanceMeters,
          "transferCount": route.transferCount,
          "walkMeters": route.walkMeters,
          "fareWon": route.fareWon,
          "summary": route.summary,
          "provider": route.provider,
          "providerRouteOption": route.providerRouteOption,
          "source": "share-extension",
        ])
        let payload: [String: Any] = compactJSON([
          "title": title,
          "startAt": formatter.string(from: startAt),
          "endAt": formatter.string(from: endAt),
          "hasEndTime": true,
          "allDay": false,
          "travelMinutes": route.minutes,
          "travelMode": route.mode,
          "origin": placeJSON(origin),
          "destination": placeJSON(destination),
          "locationName": destination.name ?? destination.address,
          "category": ["id": category.id, "title": category.title, "color": category.color],
          "notes": notes ?? sharedText,
          "route": routeJSON,
          "notificationEnabled": true,
          "notificationLeadMinutes": 15,
          "notificationIntervalMinutes": 5,
        ])
        let _: SavedSchedule = try await api.post("api/schedules", json: payload)
        setBusy(false, message: "일정이 저장되었습니다.")
        let alert = UIAlertController(title: "저장 완료", message: "선택한 경로와 함께 NoLate에 저장했어요.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "완료", style: .default) { _ in
          self.extensionContext?.completeRequest(returningItems: nil)
        })
        present(alert, animated: true)
      } catch {
        setBusy(false)
        saveButton.isEnabled = true
        showError(error.localizedDescription)
      }
    }
  }

  private func updateCategoryMenu() {
    var configuration = categoryButton.configuration
    configuration?.title = selectedCategory?.title ?? "카테고리 선택"
    categoryButton.configuration = configuration
    categoryButton.showsMenuAsPrimaryAction = true
    categoryButton.menu = UIMenu(children: categories.map { category in
      UIAction(title: category.title, state: category.id == selectedCategory?.id ? .on : .off) { [weak self] _ in
        self?.selectedCategory = category
        self?.updateCategoryMenu()
        self?.updateSaveButtonState()
      }
    })
  }

  private func updateSaveButtonState() {
    let isReady = selectedRoute != nil && selectedCategory != nil
    saveButton.isEnabled = isReady
    var configuration = saveButton.configuration
    configuration?.title = isReady ? "이 일정 저장하기" : "경로를 선택해 주세요"
    configuration?.image = UIImage(systemName: isReady ? "checkmark.circle.fill" : "checkmark")
    saveButton.configuration = configuration
  }

  private func placeJSON(_ place: SharedPlace) -> [String: Any] {
    compactJSON([
      "name": place.name,
      "address": place.address,
      "lat": place.lat,
      "lng": place.lng,
    ])
  }

  private func compactJSON(_ source: [String: Any?]) -> [String: Any] {
    source.reduce(into: [:]) { result, pair in
      if let value = pair.value { result[pair.key] = value }
    }
  }

  private func setBusy(_ busy: Bool, message: String? = nil) {
    if busy { spinner.startAnimating() } else { spinner.stopAnimating() }
    if let message { statusLabel.text = message }
    findRouteButton.isEnabled = !busy
    view.isUserInteractionEnabled = !busy
    scrollView.alpha = busy ? 0.72 : 1
  }

  private func showError(_ message: String) {
    statusLabel.text = message
    let alert = UIAlertController(title: "확인해 주세요", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "확인", style: .default))
    present(alert, animated: true)
  }

  @objc private func cancel() {
    extensionContext?.cancelRequest(withError: NSError(domain: "NoLateShareExtension", code: NSUserCancelledError))
  }
}

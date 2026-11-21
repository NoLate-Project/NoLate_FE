import CoreGraphics
import Foundation

// Y increases upward for both normalized Vision boxes and converted WebKit boxes.
struct TicketImageRegion {
  let text: String
  let bounds: CGRect

  func sharesRow(with other: Self) -> Bool {
    let overlap = min(bounds.maxY, other.bounds.maxY) - max(bounds.minY, other.bounds.minY)
    return overlap > 0 && overlap >= min(bounds.height, other.bounds.height) * 0.5
  }
}

enum TicketBookingSource: Equatable {
  case railway, intercityBus, expressBus, tmoneyGo

  init?(host: String?) {
    guard var host = host?.lowercased() else { return nil }
    if host.hasSuffix(".") { host.removeLast() }
    func belongsTo(_ domain: String) -> Bool { host == domain || host.hasSuffix("." + domain) }
    if ["korail.com", "korail.go.kr", "letskorail.com", "srail.or.kr"].contains(where: belongsTo) { self = .railway }
    else if belongsTo("kobus.co.kr") { self = .expressBus }
    else if belongsTo("bustago.or.kr") || ["intercitybus.tmoney.co.kr", "intercitybuse.tmoney.co.kr",
      "intercitybusc.tmoney.co.kr", "intercitybusj.tmoney.co.kr", "txbus.t-money.co.kr"].contains(host) {
      self = .intercityBus
    } else { return nil }
  }

  init?(url: URL) {
    switch url.scheme?.lowercased() {
    case "korailtalk": self = .railway
    case "tmoneytia": self = .tmoneyGo
    case "http", "https": self.init(host: url.host)
    default: return nil
    }
  }

  var busKind: String? {
    switch self {
    case .railway, .tmoneyGo: return nil
    case .intercityBus: return "INTERCITY_BUS"
    case .expressBus: return "EXPRESS_BUS"
    }
  }
}

enum TrainTicketSharedWebPage {
  static func site(from result: [String: Any]) -> TicketBookingSource? {
    guard result["version"] as? Int == 1,
          let origin = result["origin"] as? String, let url = URL(string: origin),
          url.scheme?.lowercased() == "https", url.user == nil, url.password == nil, url.port == nil || url.port == 443,
          url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil else { return nil }
    return TicketBookingSource(host: url.host)
  }

  static func ticketText(from result: [String: Any]) throws -> String? {
    guard let site = site(from: result) else { return nil }
    guard result["tooLarge"] as? Bool != true else {
      throw TrainTicketDraft.ValidationError(field: nil, errorDescription: "페이지 내용이 너무 많아요. 승차권 한 편의 이미지 또는 상세 텍스트를 공유해 주세요.")
    }
    guard let text = result["text"] as? String else { return nil }
    guard text.utf8.count <= 32000 else {
      throw TrainTicketDraft.ValidationError(field: nil, errorDescription: "페이지 내용이 너무 많아요. 승차권 한 편의 이미지 또는 상세 텍스트를 공유해 주세요.")
    }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if site.busKind != nil {
      return trimmed.range(of: #"승차권|모바일\s*티켓|(?:예매|예약)\s*(?:내역|상세|번호)"#, options: .regularExpression) != nil ? trimmed : nil
    }
    return !trimmed.isEmpty && TrainTicketDraft.isTicketText(trimmed) ? trimmed : nil
  }

  static func draft(text: String, regions: Any?) -> TrainTicketDraft {
    var draft = TrainTicketDraft.parse(text)
    guard !draft.cancelled, draft.kind == "TRAIN", TrainTicketDraft.hasSmartTicketMarker(text),
          !draft.trainNumber.isEmpty else { return draft }
    // A labelled clock keeps its role even if the other clock is absent.
    let labelled = TrainTicketDraft.hasLabelledClock(in: text)
    if labelled, !draft.departureName.isEmpty, !draft.arrivalName.isEmpty { return draft }
    if !labelled { draft.departureTime = ""; draft.arrivalTime = "" }
    guard let boxes = regions as? [[Any]], (1...256).contains(boxes.count) else { return draft }
    var words: [TicketImageRegion] = []
    for box in boxes {
      guard box.count == 5, let word = box[0] as? String, !word.isEmpty, word.utf16.count <= 100 else { return draft }
      let coords = box.dropFirst().compactMap { $0 as? Double }
      guard coords.count == 4, coords.allSatisfy({ $0.isFinite && abs($0) < 10_000_000 }),
            coords[2] > 0, coords[3] > 0 else { return draft }
      // The selection policy may strip a displayed private railway URL.
      guard text.contains(word) else { continue }
      words.append(TicketImageRegion(text: word, bounds: CGRect(x: coords[0], y: -coords[1] - coords[3], width: coords[2], height: coords[3])))
    }
    // WebKit can render KTX and its number as separate spans on one line.
    // Keep separate word boxes for matching each station to the clock below it.
    var rows: [[TicketImageRegion]] = []
    for word in words.sorted(by: { $0.bounds.midY > $1.bounds.midY }) {
      if let first = rows.last?.first, first.sharesRow(with: word) { rows[rows.count - 1].append(word) }
      else { rows.append([word]) }
    }
    let lines = rows.map { row in
      TicketImageRegion(text: row.sorted { $0.bounds.minX < $1.bounds.minX }.map(\.text).joined(separator: " "),
                        bounds: row.reduce(CGRect.null) { $0.union($1.bounds) })
    }
    let visual = TrainTicketDraft.parseImage(lines: lines, words: words, requiresSmartTicketLayout: true)
    guard !visual.departureName.isEmpty, !visual.arrivalName.isEmpty,
          draft.trainNumber == visual.trainNumber, draft.grade == visual.grade,
          draft.departureName.isEmpty || draft.departureName == visual.departureName,
          draft.arrivalName.isEmpty || draft.arrivalName == visual.arrivalName else { return draft }
    draft.departureName = visual.departureName; draft.arrivalName = visual.arrivalName
    if !labelled { draft.departureTime = visual.departureTime; draft.arrivalTime = visual.arrivalTime }
    return draft
  }
}

enum TrainTicketShareText: Equatable {
  case schedule(String)
  case ticket(String)
  case webTicket(String)
  case busTicket(String, TicketBookingSource)
  case needsTicketContent

  private static let linkDetector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

  private static func bookingLinkKey(_ url: URL?) -> String? {
    guard let url, TicketBookingSource(url: url) != nil,
          var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    parts.host = parts.host?.lowercased()
    parts.scheme = parts.scheme?.lowercased()
    return parts.string ?? url.absoluteString
  }

  private static func isPreviewTitle(_ text: String) -> Bool {
    let compact = text.split(whereSeparator: \.isWhitespace).joined()
    return ["전달받은승차권", "받은승차권", "모바일승차권", "전자승차권"].contains(compact)
  }

  private static func hasTripDetail(_ draft: TrainTicketDraft, in text: String) -> Bool {
    let issued = text.range(of: #"스\s*마\s*트\s*티\s*켓|(?:전달받은|받은|모바일|전자)\s*승차권|승차권\s*번호|(?:예매|발권)\s*완료"#, options: .regularExpression) != nil
    let bookingForm = text.range(of: #"(?:출발역|도착역|인원|열차)\s*선택|열차\s*조회|승차권\s*예매(?!\s*(?:내역|상세|확인))"#, options: .regularExpression) != nil
    if bookingForm && !issued { return false }
    let placeholders = ["선택", "선택하세요", "조회", "검색", "역선택", "출발역", "도착역"]
    let hasStop = [draft.departureName, draft.arrivalName].contains { !$0.isEmpty && !placeholders.contains($0) }
    return hasStop || !draft.trainNumber.isEmpty ||
      (issued && TrainTicketDraft.hasLabelledClock(in: text) && (!draft.departureTime.isEmpty || !draft.arrivalTime.isEmpty))
  }

  // An item may offer both a link preview caption and its URL, either as
  // representations of one provider or via separate providers.
  static func select(providers: [[String]], page: String? = nil, pageSite: TicketBookingSource? = nil, captions: [String] = []) throws -> Self {
    let invalid = TrainTicketDraft.ValidationError(field: nil, errorDescription: "한 번에 승차권 한 편의 내용만 공유해 주세요.")
    let representations = providers.flatMap { $0 }
    var links = Set<String>()
    var details = Set<String>()
    var tripDetails = Set<String>()
    var hasPreview = false
    var hasOtherWebLink = false
    var hasTicketDetail = false
    var cleanedPage: String?
    let values = (page.map { [$0] } ?? []) + representations + captions
    for (index, value) in values.enumerated() {
      guard value.utf8.count <= 32000 else { throw invalid }
      let clean = NSMutableString(string: value)
      let matches = linkDetector.matches(in: value, range: NSRange(value.startIndex..., in: value))
      for match in matches.reversed() {
        if let key = bookingLinkKey(match.url) { links.insert(key) }
        else if ["http", "https"].contains(match.url?.scheme?.lowercased() ?? "") { hasOtherWebLink = true }
        else { continue }
        clean.replaceCharacters(in: match.range, with: " ")
      }
      // A typed URL is authoritative even if the local data detector skips it.
      let remaining = clean as String
      for token in remaining.split(whereSeparator: \.isWhitespace).reversed() {
        guard token.contains("://"),
              let key = bookingLinkKey(URL(string: String(token))) else { continue }
        links.insert(key)
        clean.replaceCharacters(in: NSRange(token.startIndex..<token.endIndex, in: remaining), with: " ")
      }
      let text = (clean as String).trimmingCharacters(in: .whitespacesAndNewlines)
      if page != nil && index == 0 { cleanedPage = text }
      if isPreviewTitle(text) || text.components(separatedBy: .newlines).contains(where: isPreviewTitle) { hasPreview = true }
      let parsed = TrainTicketDraft.parse(text)
      if hasTripDetail(parsed, in: text) {
        tripDetails.insert(text)
        if text.contains("승차권") || TrainTicketDraft.hasSmartTicketMarker(text) { hasTicketDetail = true }
      }
      if !parsed.trainNumber.isEmpty || !parsed.departureName.isEmpty || !parsed.arrivalName.isEmpty ||
          text.range(of: #"(?<![0-9])(?:[01]?[0-9]|2[0-3]):[0-5][0-9](?![0-9])"#, options: .regularExpression) != nil {
        details.insert(text)
      }
    }
    guard links.count <= 1 else { throw invalid }
    let linkSite = links.first.flatMap { URL(string: $0) }.flatMap(TicketBookingSource.init(url:))
    if let pageSite, let linkSite, pageSite != linkSite { throw invalid }
    if let source = pageSite ?? linkSite, source != .railway {
      // Previews and booking forms can include customer-service clocks. Only
      // actual trip fields qualify for review. TmoneyGO sells both bus kinds.
      var busDetail: Self?
      for text in details {
        let described = TrainTicketDraft.parse(text)
        var site = source
        if source == .tmoneyGo {
          switch described.kind {
          case "INTERCITY_BUS": site = .intercityBus
          case "EXPRESS_BUS": site = .expressBus
          default: continue
          }
        }
        guard described.trainNumber.isEmpty, described.kind == "TRAIN" || described.kind == site.busKind else { throw invalid }
        let parsed = described.kind == site.busKind ? described : TrainTicketDraft.parse(text, bookingSite: site)
        let placeholders = ["선택", "조회", "출발지", "도착지", "터미널", "터미널선택"]
        let hasStop = [parsed.departureName, parsed.arrivalName].contains { !$0.isEmpty && !placeholders.contains($0) }
        guard hasStop, !parsed.departureTime.isEmpty || !parsed.arrivalTime.isEmpty || !parsed.grade.isEmpty else { continue }
        guard busDetail == nil else { throw invalid }
        busDetail = .busTicket(text, site)
      }
      return busDetail ?? .needsTicketContent
    }
    // Some hosts share only a forwarding URL with a received-ticket title.
    // Keep it out of the ordinary schedule parser even when the host is unknown.
    if linkSite == .railway || pageSite == .railway || hasPreview || cleanedPage != nil || (hasOtherWebLink && hasTicketDetail) {
      guard tripDetails.count <= 1 else { throw invalid }
      guard let detail = tripDetails.first else { return .needsTicketContent }
      return detail == cleanedPage ? .webTicket(detail) : .ticket(detail)
    }
    let primary = providers.compactMap(\.first)
    guard primary.count == 1, let text = primary.first else { throw invalid }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if TrainTicketDraft.isTicketText(trimmed), URL(string: trimmed)?.host == nil { return .ticket(trimmed) }
    return .schedule(trimmed)
  }
}

struct TrainTicketDraft {
  struct ValidationError: LocalizedError {
    enum Field: Int { case departure, arrival, departureTime, arrivalTime, trainNumber, grade }
    let field: Field?
    let errorDescription: String?
  }

  var kind = "TRAIN"
  var cancelled = false
  var departureName = ""
  var arrivalName = ""
  var departureTime = ""
  var arrivalTime = ""
  var trainNumber = ""
  var grade = ""

  static func ticketTimeFormatter() -> DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
    formatter.isLenient = false
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return formatter
  }

  static func isTicketText(_ text: String) -> Bool {
    text.range(of: "승차권|코레일|KORAIL|KTX|ITX|무궁화|새마을|SRT|시외버스|고속버스|버스타고|티머니GO", options: [.regularExpression, .caseInsensitive]) != nil
  }

  private static let datePattern = #"(20[0-9]{2})[.년/-]\s*([0-9]{1,2})[.월/-]\s*([0-9]{1,2})(?![0-9])(?:일|\.)?"#
  private static let clockPattern = #"(?:(오전|오후)\s*)?([0-9]{1,2}):([0-9]{2})(?![0-9])"#
  // A printed field title identifies its role even if the value is missing.
  private static let labelledClock = #"(출발|도착)\s*(?:(?:시각|시간|일시)(?![가-힣])\s*[:：]?\s*|[:：]?\s*(?=(?:오[전후]\s*)?[0-9]{1,2}:|20[0-9]{2}[.년/-]))"# +
    "(?:" + datePattern + #"\s*(?:\([월화수목금토일]\)\s*)?)?(?:"# + clockPattern + ")?"

  static func hasLabelledClock(in text: String) -> Bool {
    text.range(of: labelledClock, options: .regularExpression) != nil
  }

  private static func clock(period: String, hour: String, minute: String) -> String? {
    guard var hour = Int(hour), let minute = Int(minute), (0...59).contains(minute) else { return nil }
    if period.isEmpty {
      guard (0...23).contains(hour) else { return nil }
    } else {
      guard (1...12).contains(hour) else { return nil }
      hour = hour % 12 + (period == "오후" ? 12 : 0)
    }
    return String(format: "%02d:%02d", hour, minute)
  }

  static func parse(_ text: String, bookingSite: TicketBookingSource? = nil) -> TrainTicketDraft {
    var result = TrainTicketDraft()
    result.cancelled = text.range(of: "취소\\s*완료|환불\\s*완료|예매\\s*상태\\s*[:：]\\s*취소(?:됨)?|승차권\\s*취소됨", options: .regularExpression) != nil
    func matches(_ pattern: String) -> [[String]] {
      guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
      return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
        (0..<match.numberOfRanges).map { Range(match.range(at: $0), in: text).map { String(text[$0]) } ?? "" }
      }
    }
    if let kind = bookingSite?.busKind { result.kind = kind }
    else if text.range(of: "고속버스", options: .caseInsensitive) != nil { result.kind = "EXPRESS_BUS" }
    else if text.range(of: "시외버스|버스타고", options: .regularExpression) != nil { result.kind = "INTERCITY_BUS" }
    // Ambiguous or missing fields stay blank. Never infer today's date or an overnight arrival.
    func date(_ year: String, _ month: String, _ day: String) -> String? {
      guard let year = Int(year), let month = Int(month), let day = Int(day),
            (1...12).contains(month), (1...31).contains(day) else { return nil }
      return String(format: "%04d-%02d-%02d", year, month, day)
    }
    let dates = Set(matches(datePattern).map { date($0[1], $0[2], $0[3]) })
    let sharedDate = dates.count == 1 ? dates.first.flatMap { $0 } : nil
    let labels = matches(labelledClock)
    var departure: String?
    var arrival: String?
    if labels.isEmpty {
      let times = matches(#"(?<![0-9])"# + clockPattern)
      let accessoryClock = #"(?:현재|결제|발권|예매)\s*(?:시각|시간|일시)?\s*[:：]?\s*"# + clockPattern
      if let sharedDate, times.count == 2, text.range(of: accessoryClock, options: .regularExpression) == nil {
        departure = clock(period: times[0][1], hour: times[0][2], minute: times[0][3]).map { sharedDate + " " + $0 }
        arrival = clock(period: times[1][1], hour: times[1][2], minute: times[1][3]).map { sharedDate + " " + $0 }
      }
    } else {
      func time(for role: String) -> String? {
        let fields = labels.filter { $0[1] == role }
        guard fields.count == 1, let field = fields.first,
              let day = field[2].isEmpty ? sharedDate : date(field[2], field[3], field[4]),
              let time = clock(period: field[5], hour: field[6], minute: field[7]) else { return nil }
        return day + " " + time
      }
      departure = time(for: "출발")
      arrival = time(for: "도착")
    }
    if let departure { result.departureTime = departure }
    if let arrival, departure.map({ arrival > $0 }) ?? true { result.arrivalTime = arrival }
    // Terminal names can include digits, but clock values must never become places.
    let place = "(?=[가-힣0-9]{0,59}[가-힣])[가-힣0-9]{1,60}"
    let routes = matches("(\(place))\\s*(?:→|->|⇒)\\s*(\(place))")
    if routes.count == 1 { result.departureName = routes[0][1]; result.arrivalName = routes[0][2] }
    func labelledPlace(_ role: String) -> String? {
      let headings = ["시간", "시각", "일시", "오전", "오후", "출발", "도착", "출발역", "도착역", "출발지", "도착지"]
      let names = matches("\(role)(?:역|지)?+\\s*[:：]?\\s*(\(place))").map { $0[1] }.filter { !headings.contains($0) }
      return names.count == 1 ? names.first : nil
    }
    if result.departureName.isEmpty { result.departureName = labelledPlace("출발") ?? "" }
    if result.arrivalName.isEmpty { result.arrivalName = labelledPlace("도착") ?? "" }
    let trains = matches("(?:열차(?:번호)?\\s*[:：]?\\s*|KTX(?:-산천|-이음)?\\s*|SRT\\s*|ITX(?:-새마을|-청춘|-마음)?\\s*)([0-9]{1,6})(?:\\s*호)?(?![0-9])")
    if trains.count == 1 { result.trainNumber = trains[0][1] }
    result.grade = matches("KTX(?:-산천|-이음)?|ITX(?:-새마을|-청춘|-마음)?|SRT|무궁화|새마을").first?[0] ?? ""
    if result.kind != "TRAIN" {
      result.trainNumber = ""
      result.grade = matches("심야프리미엄|심야우등|심야일반|프리미엄|우등|일반").first?[0] ?? ""
    }
    return result
  }

  static func hasSmartTicketMarker(_ text: String) -> Bool {
    text.range(of: #"스\s*마\s*트\s*티\s*켓"#, options: .regularExpression) != nil
  }

  private var hasItinerary: Bool {
    !departureName.isEmpty && !arrivalName.isEmpty && !departureTime.isEmpty && !arrivalTime.isEmpty &&
      (kind == "TRAIN" ? !trainNumber.isEmpty : !grade.isEmpty)
  }

  static func parsePDF(text: String, recognizePage: (Bool) throws -> TrainTicketDraft) rethrows -> TrainTicketDraft {
    let extracted = parse(text)
    if extracted.cancelled { return extracted }
    let smartTicket = hasSmartTicketMarker(text)
    if extracted.hasItinerary {
      // A flattened smart ticket can include the phone clock. Only explicitly
      // labelled times are independent of its two visual columns.
      if !smartTicket || hasLabelledClock(in: text) { return extracted }
    }
    let visual: TrainTicketDraft
    do { visual = try recognizePage(smartTicket) }
    catch where !text.isEmpty && !smartTicket && !(error is CancellationError) { return extracted }
    if visual.cancelled || text.isEmpty { return visual }
    if smartTicket {
      if hasLabelledClock(in: text), !extracted.departureName.isEmpty, !extracted.arrivalName.isEmpty { return extracted }
      return visual
    }
    // Some scanned tickets have a selectable footer. Prefer the complete
    // visual journey when the text layer provides no conflicting trip fields.
    let fields: [KeyPath<TrainTicketDraft, String>] = [
      \.departureName, \.arrivalName, \.departureTime, \.arrivalTime, \.trainNumber, \.grade,
    ]
    if visual.hasItinerary, fields.allSatisfy({
      extracted[keyPath: $0].isEmpty || extracted[keyPath: $0] == visual[keyPath: $0]
    }), extracted.kind == "TRAIN" || extracted.kind == visual.kind { return visual }
    return extracted
  }

  static func parseImage(lines: [TicketImageRegion], words: [TicketImageRegion], requiresSmartTicketLayout: Bool = false) -> TrainTicketDraft {
    let text = lines.map(\.text).joined(separator: "\n")
    var draft = parse(text)
    let markers = lines.filter { hasSmartTicketMarker($0.text) }
    if markers.isEmpty && !requiresSmartTicketLayout {
      // Vision can read a printed route arrow as one or two chevrons.
      guard !draft.grade.isEmpty, !draft.departureTime.isEmpty,
            text.contains("승차권"), text.contains(">") else { return draft }
      let rows = lines.map { $0.text.trimmingCharacters(in: .whitespaces) }
      let routeRow = #"^[가-힣0-9]{1,60}[ \t]+>{1,2}[ \t]+[가-힣0-9]{1,60}$"#
      if draft.kind == "TRAIN" {
        // A compact rail ticket prints the route between its date and service.
        let arrows = rows.indices.filter { rows[$0].range(of: routeRow, options: .regularExpression) != nil }
        guard !draft.cancelled, !draft.trainNumber.isEmpty, !draft.arrivalTime.isEmpty,
              arrows.count == 1,
              let index = arrows.first, index > 0, index + 1 < rows.count,
              rows[index - 1].range(of: "^" + datePattern + #"(?:\s*\([월화수목금토일]\))?$"#, options: .regularExpression) != nil,
              rows[index + 1].filter({ !$0.isWhitespace }).uppercased() == (draft.grade + draft.trainNumber).uppercased()
        else { return draft }
        let correctedRow = rows[index].replacingOccurrences(of: #">{1,2}"#, with: "→", options: .regularExpression)
        let route = parse(correctedRow)
        let controls = ["안내", "조회", "예매", "취소", "확인", "선택", "상세", "메뉴", "고객센터"]
        guard !route.departureName.isEmpty, !route.arrivalName.isEmpty, route.departureName != route.arrivalName,
              !controls.contains(route.departureName), !controls.contains(route.arrivalName) else { return draft }
        var normalized = rows
        normalized[index] = correctedRow
        let combined = parse(normalized.joined(separator: "\n"))
        let agrees = combined.departureName == route.departureName && combined.arrivalName == route.arrivalName &&
          (draft.departureName.isEmpty || draft.departureName == route.departureName) &&
          (draft.arrivalName.isEmpty || draft.arrivalName == route.arrivalName)
        draft.departureName = agrees ? route.departureName : ""
        draft.arrivalName = agrees ? route.arrivalName : ""
        return draft
      }
      let normalized = rows.map { route in
        guard route.contains(">>"), route.range(of: routeRow, options: .regularExpression) != nil,
              route.components(separatedBy: ">>").contains(where: { $0.trimmingCharacters(in: .whitespaces).hasSuffix("터미널") })
        else { return route }
        return route.replacingOccurrences(of: ">>", with: "→")
      }
      return parse(normalized.joined(separator: "\n"))
    }

    // In a Korail smart ticket the two clocks are identified by their columns.
    // A status-bar clock plus a single leg clock is also two matches in raw OCR.
    draft.departureName = ""; draft.arrivalName = ""
    draft.departureTime = ""; draft.arrivalTime = ""
    guard markers.count == 1, let marker = markers.first, draft.kind == "TRAIN" else { return draft }
    let header = lines.filter { $0.sharesRow(with: marker) }
      .sorted { $0.bounds.minX < $1.bounds.minX }.map(\.text).joined(separator: " ")
    guard header.range(of: #"스\s*마\s*트\s*티\s*켓\s*1\s*매(?![0-9])"#, options: .regularExpression) != nil,
          !draft.trainNumber.isEmpty else { return draft }
    let trainPattern = #"(?:KTX(?:-산천|-이음)?|SRT|ITX(?:-새마을|-청춘|-마음)?)\s*[0-9]{1,6}(?![0-9])"#
    let trainRows = lines.filter { $0.text.range(of: trainPattern, options: [.regularExpression, .caseInsensitive]) != nil }
    guard trainRows.count == 1, let train = trainRows.first, train.bounds.maxY < marker.bounds.minY else { return draft }
    let inJourneyRows: (TicketImageRegion) -> Bool = {
      $0.bounds.midY < marker.bounds.minY && $0.bounds.midY > train.bounds.maxY
    }
    let clockPattern = #"(?:[01]?[0-9]|2[0-3]):[0-5][0-9]"#
    let rows = lines.filter(inJourneyRows)
    let rowText = rows.map(\.text).joined(separator: "\n")
    let clockRegex = try! NSRegularExpression(pattern: #"(?<![0-9])"# + clockPattern + #"(?![0-9])"#)
    guard clockRegex.numberOfMatches(in: rowText, range: NSRange(rowText.startIndex..., in: rowText)) == 2 else { return draft }
    let fields = words.filter(inJourneyRows)
    let clocks = fields.filter { $0.text.range(of: #"^(?:오[전후]\s*)?"# + clockPattern + "$", options: .regularExpression) != nil }
      .sorted { $0.bounds.midX < $1.bounds.midX }
    guard clocks.count == 2, clocks[0].sharesRow(with: clocks[1]),
          clocks[0].bounds.maxX < clocks[1].bounds.minX else { return draft }
    // Vision can split "오후 6:43" into two boxes. A period must belong to a
    // specific clock before we convert it, including when a word box is lost.
    let periods = fields.filter { ["오전", "오후"].contains($0.text) }
    var clockTexts = clocks.map(\.text)
    for period in periods {
      let adjacent = clocks.indices.filter { index in
        let clock = clocks[index]
        let gap = clock.bounds.minX - period.bounds.maxX
        return period.sharesRow(with: clock) && gap >= -0.1 * clock.bounds.width && gap <= 0.6 * clock.bounds.width
      }
      guard adjacent.count == 1, let index = adjacent.first, !clockTexts[index].hasPrefix("오") else { return draft }
      clockTexts[index] = period.text + " " + clockTexts[index]
    }
    let periodRegex = try! NSRegularExpression(pattern: #"오[전후](?![가-힣])"#)
    let periodCount = periodRegex.numberOfMatches(in: rowText, range: NSRange(rowText.startIndex..., in: rowText))
    guard clockTexts.filter({ $0.hasPrefix("오") }).count == periodCount else { return draft }
    let scopedTimes = parse(([header] + clockTexts).joined(separator: "\n"))
    guard !scopedTimes.departureTime.isEmpty else { return draft }

    // Each station occupies the row directly above its clock. An additional
    // plausible name in either column makes that association ambiguous.
    func station(above clock: TicketImageRegion) -> TicketImageRegion? {
      let names = fields.filter { field in
        let gap = field.bounds.minY - clock.bounds.maxY
        return gap >= -clock.bounds.height * 0.15 && gap <= max(field.bounds.height, clock.bounds.height) * 2 &&
          abs(field.bounds.midX - clock.bounds.midX) <= clock.bounds.width * 0.60 &&
          field.text.range(of: #"^[가-힣]{1,15}$"#, options: .regularExpression) != nil
      }
      return names.count == 1 ? names.first : nil
    }
    guard let departure = station(above: clocks[0]), let arrival = station(above: clocks[1]),
          departure.sharesRow(with: arrival), departure.text != arrival.text else { return draft }
    draft.departureName = departure.text; draft.arrivalName = arrival.text
    draft.departureTime = scopedTimes.departureTime; draft.arrivalTime = scopedTimes.arrivalTime
    return draft
  }

  func confirmedPayload(source: String, now: Date = Date(), id: UUID = UUID()) throws -> [String: Any] {
    func fail(_ message: String, at field: ValidationError.Field? = nil) throws -> Never {
      throw ValidationError(field: field, errorDescription: message)
    }
    guard !cancelled else { try fail("취소·환불된 표는 이동 계획으로 가져올 수 없어요. 유효한 승차권을 공유해 주세요.") }
    let departure = departureName.trimmingCharacters(in: .whitespacesAndNewlines)
    let arrival = arrivalName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !departure.isEmpty, departure.count <= 60 else { try fail("출발지를 1~60자로 입력해 주세요.", at: .departure) }
    guard !arrival.isEmpty, arrival.count <= 60 else { try fail("도착지를 1~60자로 입력해 주세요.", at: .arrival) }
    guard departure != arrival else { try fail("출발지와 다른 도착지를 입력해 주세요.", at: .arrival) }
    guard ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"].contains(kind) else { try fail("교통수단을 선택해 주세요.") }
    if kind == "TRAIN" {
      guard trainNumber.range(of: "^[0-9]{1,6}$", options: .regularExpression) != nil else {
        try fail("열차번호를 숫자 1~6자리로 입력해 주세요.", at: .trainNumber)
      }
    } else {
      guard !grade.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, grade.count <= 40 else {
        try fail("승차권에 표시된 버스 등급을 입력해 주세요.", at: .grade)
      }
    }
    let formatter = Self.ticketTimeFormatter()
    guard let dep = formatter.date(from: departureTime), formatter.string(from: dep) == departureTime, dep > now else {
      try fail("현재보다 늦은 출발 날짜와 시각을 선택해 주세요.", at: .departureTime)
    }
    guard let arr = formatter.date(from: arrivalTime), formatter.string(from: arr) == arrivalTime,
          arr > dep, arr.timeIntervalSince(dep) <= 86400 else {
      try fail("도착은 출발 후 24시간 이내여야 해요. 자정을 넘기면 다음 날을 선택해 주세요.", at: .arrivalTime)
    }
    guard ["IOS_SHARE_TEXT", "IOS_SHARE_IMAGE", "IOS_SHARE_PDF"].contains(source) else { try fail("공유 형식을 확인해 주세요.") }
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
    var payload: [String: Any] = ["version": 1, "id": "ticket:\(id.uuidString.lowercased())", "kind": kind, "source": source,
      "verification": "USER_CONFIRMED", "bookingStatus": "UNVERIFIED", "departureName": departure, "arrivalName": arrival,
      "departureAt": formatter.string(from: dep), "arrivalAt": formatter.string(from: arr),
      "grade": String(grade.prefix(40)), "confirmedAt": ISO8601DateFormatter().string(from: now)]
    if kind == "TRAIN" { payload["trainNumber"] = trainNumber }
    return payload
  }
}

import Foundation

struct TrainTicketDraft {
  var kind = "TRAIN"
  var cancelled = false
  var departureName = ""
  var arrivalName = ""
  var departureTime = ""
  var arrivalTime = ""
  var trainNumber = ""
  var grade = ""

  static func isTicketText(_ text: String) -> Bool {
    text.range(of: "승차권|코레일|KORAIL|KTX|ITX|무궁화|새마을|SRT|시외버스|고속버스|버스타고|티머니GO", options: [.regularExpression, .caseInsensitive]) != nil
  }

  static func parse(_ text: String) -> TrainTicketDraft {
    var result = TrainTicketDraft()
    result.cancelled = text.range(of: "취소\\s*완료|환불\\s*완료|예매\\s*상태\\s*[:：]\\s*취소(?:됨)?|승차권\\s*취소됨", options: .regularExpression) != nil
    func matches(_ pattern: String) -> [[String]] {
      guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
      return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
        (0..<match.numberOfRanges).map { Range(match.range(at: $0), in: text).map { String(text[$0]) } ?? "" }
      }
    }
    if text.range(of: "고속버스", options: .caseInsensitive) != nil { result.kind = "EXPRESS_BUS" }
    else if text.range(of: "시외버스|버스타고", options: .regularExpression) != nil { result.kind = "INTERCITY_BUS" }
    // Ambiguous or missing fields stay blank. Never infer today's date or an overnight arrival.
    let dates = matches("(20[0-9]{2})[.년/-]\\s*([0-9]{1,2})[.월/-]\\s*([0-9]{1,2})일?")
      .map { String(format: "%04d-%02d-%02d", Int($0[1]) ?? 0, Int($0[2]) ?? 0, Int($0[3]) ?? 0) }
    let times = matches("(?<![0-9])([0-2]?[0-9]):([0-5][0-9])(?![0-9])")
      .map { String(format: "%02d:%02d", Int($0[1]) ?? 0, Int($0[2]) ?? 0) }
    if Set(dates).count == 1, let date = dates.first, times.count == 2 {
      result.departureTime = "\(date) \(times[0])"
      if times[1] > times[0] { result.arrivalTime = "\(date) \(times[1])" }
    }
    // Terminal names can include digits, but clock values must never become places.
    let place = "(?=[가-힣0-9]{0,59}[가-힣])[가-힣0-9]{1,60}"
    let routes = matches("(\(place))\\s*(?:→|->|⇒)\\s*(\(place))")
    if routes.count == 1 { result.departureName = routes[0][1]; result.arrivalName = routes[0][2] }
    let departures = matches("(?:출발역|출발(?!역))\\s*[:：]?\\s*(\(place))")
    let arrivals = matches("(?:도착역|도착(?!역))\\s*[:：]?\\s*(\(place))")
    if result.departureName.isEmpty, departures.count == 1 { result.departureName = departures[0][1] }
    if result.arrivalName.isEmpty, arrivals.count == 1 { result.arrivalName = arrivals[0][1] }
    let trains = matches("(?:열차(?:번호)?\\s*[:：]?\\s*|KTX(?:-산천|-이음)?\\s*|SRT\\s*|ITX(?:-새마을|-청춘|-마음)?\\s*)([0-9]{1,6})(?:\\s*호)?(?![0-9])")
    if trains.count == 1 { result.trainNumber = trains[0][1] }
    result.grade = matches("KTX(?:-산천|-이음)?|ITX(?:-새마을|-청춘|-마음)?|SRT|무궁화|새마을").first?[0] ?? ""
    if result.kind != "TRAIN" {
      result.trainNumber = ""
      result.grade = matches("심야프리미엄|심야우등|심야일반|프리미엄|우등|일반").first?[0] ?? ""
    }
    return result
  }

  func confirmedPayload(source: String, now: Date = Date(), id: UUID = UUID()) throws -> [String: Any] {
    func fail(_ message: String) throws -> Never {
      throw NSError(domain: "TrainTicketImport", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    guard !cancelled else { try fail("취소·환불된 표는 이동 계획으로 가져올 수 없어요. 유효한 승차권을 공유해 주세요.") }
    let departure = departureName.trimmingCharacters(in: .whitespacesAndNewlines)
    let arrival = arrivalName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !departure.isEmpty, !arrival.isEmpty, departure.count <= 60, arrival.count <= 60, departure != arrival else {
      try fail("서로 다른 출발지와 도착지을 입력해 주세요.")
    }
    guard ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"].contains(kind) else { try fail("교통수단을 선택해 주세요.") }
    if kind == "TRAIN" {
      guard trainNumber.range(of: "^[0-9]{1,6}$", options: .regularExpression) != nil else { try fail("열차번호를 숫자로 입력해 주세요.") }
    } else {
      guard !grade.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, grade.count <= 40 else { try fail("승차권에 표시된 버스 등급을 입력해 주세요.") }
    }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
    formatter.isLenient = false
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    guard let dep = formatter.date(from: departureTime), formatter.string(from: dep) == departureTime,
          let arr = formatter.date(from: arrivalTime), formatter.string(from: arr) == arrivalTime else {
      try fail("출발·도착 시각을 YYYY-MM-DD HH:mm 형식으로 확인해 주세요. 날짜가 바뀌면 도착 날짜도 수정하세요.")
    }
    guard dep > now, arr > dep, arr.timeIntervalSince(dep) <= 86400 else { try fail("미래 출발 시각과 24시간 이내의 도착 시각을 확인해 주세요.") }
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

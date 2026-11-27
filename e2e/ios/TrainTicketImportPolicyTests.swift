// Compile alongside ios/NoLateShareExtension/TrainTicketImport.swift, as main.swift.
import Foundation
let now = ISO8601DateFormatter().date(from: "2026-10-12T00:00:00Z")!
let text = "코레일 승차권\n2026-10-13\n서울 → 부산\nKTX 123\n11:00\n13:40"
let draft = TrainTicketDraft.parse(text)
precondition(draft.departureName == "서울" && draft.arrivalName == "부산")
precondition(draft.trainNumber == "123" && draft.departureTime == "2026-10-13 11:00")
let payload = try draft.confirmedPayload(source: "IOS_SHARE_TEXT", now: now)
precondition(payload["departureAt"] as? String == "2026-10-13T11:00:00+09:00")
precondition(payload["bookingStatus"] as? String == "UNVERIFIED")
precondition(!payload.keys.contains("rawText") && !payload.keys.contains("seat"))
var invalid = draft
invalid.arrivalTime = "2026-10-13 10:00"
precondition((try? invalid.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)) == nil)
invalid = draft; invalid.departureTime = "2026-02-30 11:00"
precondition((try? invalid.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)) == nil)
invalid = draft; invalid.trainNumber = ""
precondition((try? invalid.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)) == nil)
let ambiguous = TrainTicketDraft.parse(text + "\n결제 10:20")
precondition(ambiguous.departureTime.isEmpty && ambiguous.arrivalTime.isEmpty)
let overnight = TrainTicketDraft.parse("2026-10-13 서울 → 부산 KTX 123 23:20 01:12")
precondition(overnight.arrivalTime.isEmpty)
let noDate = TrainTicketDraft.parse("서울 → 부산 KTX 123 11:00 13:40")
precondition(noDate.departureTime.isEmpty)
print("Train ticket policy: 11 assertions passed")
for kind in ["시외버스", "고속버스"] {
  let bus = TrainTicketDraft.parse("\(kind) 승차권\n2026-10-13\n동서울 → 속초\n우등\n11:00\n13:40")
  precondition(bus.kind == (kind == "시외버스" ? "INTERCITY_BUS" : "EXPRESS_BUS"))
  let saved = try bus.confirmedPayload(source: "IOS_SHARE_PDF", now: now)
  precondition(saved["grade"] as? String == "우등" && saved["trainNumber"] == nil)
  var missingGrade = bus; missingGrade.grade = ""
  precondition((try? missingGrade.confirmedPayload(source: "IOS_SHARE_TEXT", now: now)) == nil)
}
let cancelled = TrainTicketDraft.parse(text + "\n취소 완료")
precondition((try? cancelled.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)) == nil)
let refundRules = TrainTicketDraft.parse(text + "\n취소수수료 안내")
precondition((try? refundRules.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)) != nil)
print("Bus/PDF/cancellation policy: 8 additional assertions passed")
let clocksOnly = TrainTicketDraft.parse("기차 승차권 2026-10-13 SRT 615 출발역 12:20 도착역 13:12")
precondition(clocksOnly.departureName.isEmpty && clocksOnly.arrivalName.isEmpty)
precondition(clocksOnly.departureTime == "2026-10-13 12:20" && clocksOnly.arrivalTime == "2026-10-13 13:12")
let numericTerminal = TrainTicketDraft.parse("시외버스 2026-10-13 인천공항2터미널 → 청주 우등 출발 12:20 도착 14:45")
precondition(numericTerminal.departureName == "인천공항2터미널" && numericTerminal.arrivalName == "청주")
print("Numeric terminal / clock ambiguity policy: 3 additional assertions passed")
precondition((try? TrainTicketDraft.parse(text + "\n예매 취소 안내: 취소수수료는 예매처에서 확인").confirmedPayload(source: "IOS_SHARE_PDF", now: now)) != nil)
precondition((try? TrainTicketDraft.parse(text + "\n예매 상태: 취소").confirmedPayload(source: "IOS_SHARE_PDF", now: now)) == nil)
print("Cancellation instructions / actual status policy: 2 additional assertions passed")

func assertInvalidField(_ draft: TrainTicketDraft, _ field: TrainTicketDraft.ValidationError.Field?) throws {
  do {
    _ = try draft.confirmedPayload(source: "IOS_SHARE_TEXT", now: now)
    preconditionFailure("Expected validation to fail")
  } catch let error as TrainTicketDraft.ValidationError {
    precondition(error.field == field)
  }
}

invalid = draft; invalid.departureName = ""
try assertInvalidField(invalid, .departure)
invalid = draft; invalid.arrivalName = invalid.departureName
try assertInvalidField(invalid, .arrival)
invalid = draft; invalid.departureTime = "2026-10-11 11:00"
try assertInvalidField(invalid, .departureTime)
invalid = draft; invalid.arrivalTime = "2026-10-14 13:40"
try assertInvalidField(invalid, .arrivalTime)
invalid = draft; invalid.trainNumber = ""
try assertInvalidField(invalid, .trainNumber)
invalid = draft; invalid.kind = "INTERCITY_BUS"; invalid.grade = ""
try assertInvalidField(invalid, .grade)
try assertInvalidField(cancelled, nil)
print("Validation field mapping: 7 assertions passed")

let sharedPage: [String: Any] = ["version": 1, "origin": "https://www.korail.com", "text": text]
let sharedPageText = try TrainTicketSharedWebPage.ticketText(from: sharedPage)
precondition(sharedPageText == text)
let pageDraft = TrainTicketDraft.parse(sharedPageText!)
let pagePayload = try pageDraft.confirmedPayload(source: "IOS_SHARE_TEXT", now: now)
precondition(pagePayload["departureName"] as? String == "서울")
precondition(!pagePayload.keys.contains("origin") && !pagePayload.keys.contains("text"))
for origin in ["http://korail.com", "https://korail.com.example.com", "https://fakekorail.com", "https://korail.com:8443", "https://user:secret@korail.com", "https://korail.com/ticket?code=synthetic-secret"] {
  var page = sharedPage; page["origin"] = origin
  let rejected = try TrainTicketSharedWebPage.ticketText(from: page)
  precondition(rejected == nil)
}
var page = sharedPage; page["text"] = "  "
let emptyPage = try TrainTicketSharedWebPage.ticketText(from: page)
precondition(emptyPage == nil)
page["text"] = "일반 웹페이지"
let unrelatedPage = try TrainTicketSharedWebPage.ticketText(from: page)
precondition(unrelatedPage == nil)
page = sharedPage; page["tooLarge"] = true
precondition((try? TrainTicketSharedWebPage.ticketText(from: page)) == nil)
page = sharedPage; page["text"] = String(repeating: "가", count: 11000)
precondition((try? TrainTicketSharedWebPage.ticketText(from: page)) == nil)
print("Safari ticket page policy: 13 assertions passed")

let ticketURL = "https://www.KORAIL.COM/ticket?key=synthetic-A"
let lowerTicketURL = "https://www.korail.com/ticket?key=synthetic-A"
let preview = "전달받은 승차권"
func assertShare(_ expected: TrainTicketShareText, _ providers: [[String]], page: String? = nil, captions: [String] = []) throws {
  let result = try TrainTicketShareText.select(providers: providers, page: page, captions: captions)
  precondition(result == expected)
}
try assertShare(.needsTicketContent, [[ticketURL]])
try assertShare(.needsTicketContent, [["\(preview)\n\(ticketURL)"]])
try assertShare(.needsTicketContent, [[preview, ticketURL]])
try assertShare(.needsTicketContent, [[preview], [ticketURL]])
try assertShare(.needsTicketContent, [[preview]])
try assertShare(.needsTicketContent, [["전달받은\n승차권"]])
try assertShare(.needsTicketContent, [], captions: [preview])
try assertShare(.needsTicketContent, [[preview], [preview]])
try assertShare(.needsTicketContent, [], page: preview)
try assertShare(.needsTicketContent, [[preview]], page: preview)
try assertShare(.ticket(text), [[preview]], captions: [text])
let partial = "\(preview)\n출발역 서울"
try assertShare(.ticket(partial), [[partial]])
try assertShare(.ticket(partial), [[partial], [ticketURL]])
try assertShare(.needsTicketContent, [[ticketURL], [lowerTicketURL]], captions: [preview])
try assertShare(.needsTicketContent, [["HTTP://WWW.KORAIL.COM/view?id=test"]])
try assertShare(.ticket(text), [["\(text)\n\(ticketURL)"]])
try assertShare(.ticket(text), [[text], [ticketURL]], captions: [preview])
try assertShare(.ticket(text), [[ticketURL]], captions: [text])
let forwardedURL = "https://share.example.invalid/forward?time=06:43"
try assertShare(.needsTicketContent, [[forwardedURL]], captions: [preview])
try assertShare(.needsTicketContent, [[preview + "\n" + forwardedURL]])
try assertShare(.needsTicketContent, [[preview], [forwardedURL]])
try assertShare(.ticket(text), [[forwardedURL]], captions: [preview, text])
try assertShare(.ticket(text), [[text], [forwardedURL]])
try assertShare(.ticket(text), [[text + "\nhttps://share.example.invalid/view/KTX456"]])
let ordinaryURLNote = "금요일 회의\n" + forwardedURL
try assertShare(.schedule(ordinaryURLNote), [[ordinaryURLNote]])
try assertShare(.schedule(forwardedURL), [[forwardedURL]], captions: ["금요일 회의"])
let bookingHome = "코레일 승차권 예매\n출발역 선택\n도착역 선택\n고객센터 09:00"
let railHomeBody = try TrainTicketShareText.select(providers: [], page: bookingHome, pageSite: .railway)
precondition(railHomeBody == .needsTicketContent)
try assertShare(.needsTicketContent, [[ticketURL]], page: bookingHome)
try assertShare(.needsTicketContent, [[ticketURL]], captions: ["고객센터 09:00"])
try assertShare(.ticket(text), [[ticketURL]], captions: ["고객센터 09:00", text])
try assertShare(.needsTicketContent, [[ticketURL]], page: "승차권 예매\n서울 → 부산\nKTX 123\n인원 선택\n열차 조회")
let receiptWithMenu = text + "\n승차권 번호\n승차권 예매"
try assertShare(.webTicket(receiptWithMenu), [[ticketURL]], page: receiptWithMenu)
for heading in ["승차권 예매 완료", "승차권 예매내역", "승차권 예매 확인서"] {
  let receipt = heading + "\n" + text
  try assertShare(.webTicket(receipt), [[ticketURL]], page: receipt)
}
try assertShare(.webTicket(text), [[ticketURL]], page: text)
try assertShare(.webTicket(text), [[preview]], page: "\(text)\n\(ticketURL)")
try assertShare(.ticket(text), [[ticketURL]], page: preview, captions: [text])
try assertShare(.ticket(text), [[text]])
try assertShare(.schedule("금요일 회의"), [["금요일 회의", "https://example.test/agenda"]])
try assertShare(.schedule("https://korail.com.example.test/agenda"), [["https://korail.com.example.test/agenda"]])
let otherTicket = "https://www.korail.com/ticket?key=synthetic-B"
precondition((try? TrainTicketShareText.select(providers: [[ticketURL, otherTicket]])) == nil)
precondition((try? TrainTicketShareText.select(providers: [[ticketURL], [otherTicket]], page: text)) == nil)
precondition((try? TrainTicketShareText.select(providers: [["\(ticketURL) \(otherTicket)"]])) == nil)
precondition((try? TrainTicketShareText.select(providers: [[ticketURL], [text], ["SRT 880 서울 → 대전"]])) == nil)
precondition((try? TrainTicketShareText.select(providers: [["첫 번째 일정"], ["다른 일정"]])) == nil)
print("Railway URL, caption, local review and multi-ticket routing policy passed")

// Dedicated bus-booking hosts carry transferable links. Route them locally even
// if Safari supplies just a URL, or a page provider without a URL attachment.
let genericBusText = "모바일 승차권\n2026-11-12\n동서울 → 속초\n우등\n출발 오후 6:43\n도착 오후 8:32"
for (host, site) in [("intercitybus.tmoney.co.kr", TicketBookingSource.intercityBus), ("txbus.t-money.co.kr", .intercityBus),
                     ("www.bustago.or.kr", .intercityBus), ("www.kobus.co.kr", .expressBus)] {
  let url = "https://\(host)/ticket?code=synthetic-private#pass"
  try assertShare(.needsTicketContent, [[url]])
  try assertShare(.needsTicketContent, [["모바일 승차권", url]], captions: ["고객센터 09:00"])
  try assertShare(.busTicket(genericBusText, site), [[genericBusText], [url]])
  try assertShare(.busTicket(genericBusText, site), [[genericBusText + "\n" + url]])
  try assertShare(.busTicket(genericBusText, site), [[url]], captions: [genericBusText])
  let pageText = try TrainTicketSharedWebPage.ticketText(from: ["version": 1, "origin": "https://" + host, "text": genericBusText])
  precondition(pageText == genericBusText)
  let bodyOnly = try TrainTicketShareText.select(providers: [], page: pageText, pageSite: site)
  precondition(bodyOnly == .busTicket(genericBusText, site))
  let parsed = TrainTicketDraft.parse(genericBusText, bookingSite: site)
  precondition(parsed.kind == site.busKind && parsed.grade == "우등" && parsed.trainNumber.isEmpty)
  precondition(parsed.departureTime == "2026-11-12 18:43" && parsed.arrivalTime == "2026-11-12 20:32")
  let home = try TrainTicketShareText.select(providers: [[url]], page: "승차권 예매·조회\n출발지 선택\n도착지 선택\n가는시간 04:00\n고객센터 09:00", pageSite: site)
  precondition(home == .needsTicketContent)
}
for host in ["www.tmoney.co.kr", "shop.tmoney.co.kr", "bustago.or.kr.example.test", "fakekobus.co.kr", "intercitybus.tmoney.co.kr.example.test"] {
  let url = "https://" + host + "/"
  try assertShare(.schedule(url), [[url]])
}
let intercityLink = "https://www.bustago.or.kr/ticket?code=synthetic"
precondition((try? TrainTicketShareText.select(providers: [[intercityLink], [ticketURL]])) == nil)
precondition((try? TrainTicketShareText.select(providers: [[intercityLink]], page: genericBusText, pageSite: .expressBus)) == nil)
precondition((try? TrainTicketShareText.select(providers: [[intercityLink], [text]])) == nil)
precondition((try? TrainTicketShareText.select(providers: [[intercityLink], [genericBusText.replacingOccurrences(of: "모바일 승차권", with: "고속버스 승차권")]])) == nil)
let appLink = "tmoneytia://main/home?code=synthetic-private"
try assertShare(.needsTicketContent, [[appLink]])
try assertShare(.needsTicketContent, [["모바일 승차권 (\(appLink))"]])
try assertShare(.needsTicketContent, [["모바일 승차권"]])
try assertShare(.needsTicketContent, [[appLink]], captions: [genericBusText])
for (label, type) in [("시외버스", TicketBookingSource.intercityBus), ("고속버스", .expressBus)] {
  let explicit = label + " " + genericBusText
  try assertShare(.busTicket(explicit, type), [[appLink]], captions: [explicit])
}
try assertShare(.needsTicketContent, [["korailtalk://gotoMainViewContoller?code=synthetic"]])
try assertShare(.schedule("otherapp://main/home"), [["otherapp://main/home"]])
print("Bus booking URL, origin, public schedule isolation and local trip review policy passed")

// Synthetic Vision regions reproduce the two-column smart-ticket layout, not
// a real passenger's image. Keep status and share-sheet clocks outside the card.
func region(_ text: String, _ x: Double, _ y: Double, _ width: Double = 0.12) -> TicketImageRegion {
  TicketImageRegion(text: text, bounds: CGRect(x: x, y: y, width: width, height: 0.025))
}
let screenshotRows = [
  region("4:07", 0.10, 0.96), region("2026년11월12일(목)", 0.08, 0.79, 0.35),
  region("스마트티켓 1매", 0.70, 0.79, 0.22), region("서울", 0.21, 0.71),
  region("동대구", 0.61, 0.71, 0.18), region("받은승차권", 0.84, 0.735),
  region("06:43", 0.20, 0.665, 0.15), region("08:32", 0.625, 0.665, 0.15),
  region("KTX 255", 0.12, 0.60, 0.17), region("메시지", 0.23, 0.23),
  region("09:00", 0.63, 0.23),
]
func screenshotDraft(_ lines: [TicketImageRegion]) -> TrainTicketDraft {
  TrainTicketDraft.parseImage(lines: lines, words: lines)
}
let photo = screenshotDraft(screenshotRows.reversed())
precondition(photo.departureName == "서울" && photo.arrivalName == "동대구")
precondition(photo.departureTime == "2026-11-12 06:43" && photo.arrivalTime == "2026-11-12 08:32")
precondition(photo.trainNumber == "255" && photo.grade == "KTX")
let photoPayload = try photo.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)
precondition(photoPayload["source"] as? String == "IOS_SHARE_IMAGE" && photoPayload["trainNumber"] as? String == "255")
precondition((try? photo.confirmedPayload(source: "IOS_SHARE_IMAGE", now: ISO8601DateFormatter().date(from: "2026-11-20T00:00:00Z")!)) == nil)
let sameDateElsewhere = screenshotRows.filter { !$0.text.contains("년") } + [region("2026년11월12일", 0.08, 0.90)]
let incompleteClockPair = screenshotRows.filter { !["08:32", "09:00"].contains($0.text) }
let secondTicket = screenshotRows + [region("스마트티켓 1매", 0.70, 0.31)]
let multipleCopies = screenshotRows.filter { !$0.text.contains("스마트") } + [region("스마트티켓 2매", 0.70, 0.79)]
let detachedStation = screenshotRows.filter { $0.text != "동대구" } + [region("동대구", 0.80, 0.71)]
let thirdClock = screenshotRows + [region("결제 06:00", 0.12, 0.74)]
let ambiguousName = screenshotRows + [region("다른역", 0.20, 0.71)]
let secondTrain = screenshotRows + [region("KTX 257", 0.12, 0.29)]
for uncertain in [sameDateElsewhere, incompleteClockPair, secondTicket, multipleCopies, detachedStation, thirdClock, ambiguousName, secondTrain] {
  let rejected = screenshotDraft(uncertain)
  precondition(rejected.departureName.isEmpty && rejected.arrivalName.isEmpty)
  precondition(rejected.departureTime.isEmpty && rejected.arrivalTime.isEmpty)
}
let cancelledPhoto = screenshotDraft(screenshotRows + [region("환불 완료", 0.18, 0.35)])
precondition(cancelledPhoto.cancelled && (try? cancelledPhoto.confirmedPayload(source: "IOS_SHARE_IMAGE", now: now)) == nil)
let overnightPhoto = screenshotDraft(screenshotRows.map { $0.text == "08:32" ? region("01:15", 0.625, 0.665, 0.15) : $0 })
precondition(!overnightPhoto.departureTime.isEmpty && overnightPhoto.arrivalTime.isEmpty)
let mergedRows = screenshotRows.filter { !["서울", "동대구", "06:43", "08:32"].contains($0.text) } +
  [region("동대구 서울", 0.21, 0.71, 0.58), region("08:32 06:43", 0.20, 0.665, 0.57)]
let mergedPhoto = TrainTicketDraft.parseImage(lines: mergedRows, words: screenshotRows.reversed())
precondition(mergedPhoto.departureName == "서울" && mergedPhoto.arrivalName == "동대구" &&
             mergedPhoto.departureTime == photo.departureTime && mergedPhoto.arrivalTime == photo.arrivalTime)
let afternoonRows = screenshotRows.map { field in
  ["06:43", "08:32"].contains(field.text) ? TicketImageRegion(text: "오후 " + field.text, bounds: field.bounds) : field
}
let afternoonImage = screenshotDraft(afternoonRows)
precondition(afternoonImage.departureTime == "2026-11-12 18:43" && afternoonImage.arrivalTime == "2026-11-12 20:32")
let splitPeriods = screenshotRows + [region("오후", 0.13, 0.665, 0.06), region("오후", 0.55, 0.665, 0.06)]
let splitImage = screenshotDraft(splitPeriods)
precondition(splitImage.departureTime == afternoonImage.departureTime && splitImage.arrivalTime == afternoonImage.arrivalTime)
let lostPeriod = TrainTicketDraft.parseImage(lines: afternoonRows, words: screenshotRows)
precondition(lostPeriod.departureTime.isEmpty && lostPeriod.arrivalTime.isEmpty)
let detachedPeriod = screenshotDraft(screenshotRows + [region("오후", 0.08, 0.75, 0.06)])
precondition(detachedPeriod.departureTime.isEmpty)
let labelledImage = screenshotDraft([region(text, 0.1, 0.2)])
precondition(labelledImage.departureName == draft.departureName && labelledImage.arrivalTime == draft.arrivalTime)
// A PDF text layer can identify the layout even when the raster OCR misses its header.
let missingMarker = screenshotRows.filter { !$0.text.contains("스마트") && !["08:32", "09:00"].contains($0.text) }
let uncertainPDF = TrainTicketDraft.parseImage(lines: missingMarker, words: missingMarker, requiresSmartTicketLayout: true)
precondition(uncertainPDF.departureTime.isEmpty && uncertainPDF.arrivalTime.isEmpty)
precondition(TrainTicketDraft.hasSmartTicketMarker("스마트\n티켓 1매"))
print("Smart-ticket screenshot geometry, ambiguity and review policy passed")

// WebKit boxes are CSS pixels with a top-left origin. The body text can list
// arrival before departure even when the left-hand station is the origin.
let webRegions: [[Any]] = screenshotRows.reversed().map { field in
  [field.text, Double(field.bounds.minX), Double(-field.bounds.maxY), Double(field.bounds.width), Double(field.bounds.height)]
}
let webText = screenshotRows.reversed().map(\.text).joined(separator: "\n")
let webDraft = TrainTicketSharedWebPage.draft(text: webText, regions: webRegions)
precondition(webDraft.departureName == photo.departureName && webDraft.arrivalName == photo.arrivalName)
precondition(webDraft.departureTime == photo.departureTime && webDraft.arrivalTime == photo.arrivalTime)
let refundedPage = TrainTicketSharedWebPage.draft(text: webText + "\n환불 완료", regions: webRegions)
precondition(refundedPage.cancelled)
let conflictingPage = TrainTicketSharedWebPage.draft(text: webText + "\n출발역 수서", regions: webRegions)
precondition(conflictingPage.departureName == "수서" && conflictingPage.arrivalName.isEmpty && conflictingPage.departureTime.isEmpty)
let labelledPage = TrainTicketSharedWebPage.draft(text: text.replacingOccurrences(of: "11:00\n13:40", with: "출발 11:00\n도착 13:40") + "\n스마트티켓 1매", regions: nil)
precondition(labelledPage.departureTime == draft.departureTime && labelledPage.arrivalTime == draft.arrivalTime)
let reversedLabels = TrainTicketSharedWebPage.draft(text: "스마트티켓 1매\n2026-11-12\n서울 → 동대구\nKTX 255\n도착 시각 8:32\n출발 시각 6:43\n현재 04:07", regions: nil)
precondition(reversedLabels.departureTime == photo.departureTime && reversedLabels.arrivalTime == photo.arrivalTime)
// Printed clock roles survive reordered text, status clocks and a change of date.
let labelledTrip = "스마트티켓 1매\n2026-11-21\n출발역 서울\n도착역 동대구\nKTX 255\n현재 04:07\n"
let afternoon = labelledTrip + "도착 시각 오후 8:32\n출발 시각 오후 6:43"
let afternoonDraft = TrainTicketDraft.parse(afternoon)
precondition(afternoonDraft.departureName == "서울" && afternoonDraft.arrivalName == "동대구")
for parsed in [afternoonDraft, TrainTicketSharedWebPage.draft(text: afternoon, regions: nil),
               TrainTicketDraft.parsePDF(text: afternoon) { _ in fatalError("Printed trip has explicit roles") }] {
  precondition(parsed.departureTime == "2026-11-21 18:43" && parsed.arrivalTime == "2026-11-21 20:32")
}
let missingDeparture = labelledTrip + "도착 시각 08:32"
for parsed in [TrainTicketDraft.parse(missingDeparture), TrainTicketSharedWebPage.draft(text: missingDeparture, regions: nil),
               TrainTicketDraft.parsePDF(text: missingDeparture) { _ in photo }] {
  precondition(parsed.departureTime.isEmpty && parsed.arrivalTime == "2026-11-21 08:32")
  precondition((try? parsed.confirmedPayload(source: "IOS_SHARE_TEXT", now: now)) == nil)
}
let missingNames = TrainTicketDraft.parse("2026-11-21 KTX 255\n도착 시각 08:32\n출발 시간 06:43")
precondition(missingNames.departureName.isEmpty && missingNames.arrivalName.isEmpty)
let unlabelledWithPayment = TrainTicketDraft.parse("승차권 2026-11-21 서울 → 동대구 KTX 255\n결제 시각 04:07\n08:32")
precondition(unlabelledWithPayment.departureTime.isEmpty && unlabelledWithPayment.arrivalTime.isEmpty)
let duplicates = TrainTicketDraft.parse(afternoon + "\n출발 시간 19:00")
precondition(duplicates.departureTime.isEmpty && duplicates.arrivalTime == "2026-11-21 20:32")
for invalidClock in ["25:30", "오후 00:30", "오전 13:00", "11:69", "미정"] {
  precondition(TrainTicketDraft.parse(labelledTrip + "출발 시각 " + invalidClock + "\n도착 시각 08:32").departureTime.isEmpty)
}
let busAtMidnight = TrainTicketDraft.parse("시외버스 승차권 우등\n출발지: 동서울\n도착지: 속초\n" +
  "도착 일시 2026. 11. 22. (일) 오전 12:30\n출발 일시 2026년11월21일(토) 오후 11:10")
precondition(busAtMidnight.departureName == "동서울" && busAtMidnight.arrivalName == "속초")
precondition(busAtMidnight.departureTime == "2026-11-21 23:10" && busAtMidnight.arrivalTime == "2026-11-22 00:30")
let overnightPayload = try busAtMidnight.confirmedPayload(source: "IOS_SHARE_PDF", now: now)
precondition(overnightPayload["arrivalAt"] as? String == "2026-11-22T00:30:00+09:00")
let ambiguousDate = TrainTicketDraft.parse(afternoon + "\n2026-11-20")
precondition(ambiguousDate.departureTime.isEmpty && ambiguousDate.arrivalTime.isEmpty)
let midday = TrainTicketDraft.parse(labelledTrip + "출발: 오전 12:10\n도착: 오후 12:35")
precondition(midday.departureTime == "2026-11-21 00:10" && midday.arrivalTime == "2026-11-21 12:35")
print("Labelled clocks, Korean AM/PM, field roles and explicitly dated overnight journeys passed")

for invalidBoxes: [[Any]] in [[], [["서울", Double.nan, 1, 2, 3]], [["서울", 1, 2, -3, 4]], Array(repeating: webRegions[0], count: 257)] {
  let incomplete = TrainTicketSharedWebPage.draft(text: webText, regions: invalidBoxes)
  precondition(incomplete.departureName.isEmpty && incomplete.departureTime.isEmpty)
}
let missingClock = TrainTicketSharedWebPage.draft(text: webText.replacingOccurrences(of: "08:32", with: ""), regions: webRegions)
precondition(missingClock.departureTime.isEmpty && missingClock.arrivalTime.isEmpty)
print("Rendered railway web page selection, geometry, cancellation and incomplete-field policy passed")

let hybridPDF = TrainTicketDraft.parsePDF(text: "전자문서 사본") { requiresLayout in
  precondition(!requiresLayout)
  return photo
}
precondition(hybridPDF.departureName == "서울" && hybridPDF.arrivalTime == "2026-11-12 08:32")
let originalPDF = TrainTicketDraft.parsePDF(text: text) { _ in fatalError("Complete text PDF must use selectable fields") }
precondition(originalPDF.departureTime == draft.departureTime)
let refundedPDF = TrainTicketDraft.parsePDF(text: "환불 완료") { _ in fatalError("The refund status must survive OCR") }
precondition(refundedPDF.cancelled)
let conflictingPDF = TrainTicketDraft.parsePDF(text: "도착역 부산") { _ in photo }
precondition(conflictingPDF.arrivalName == "부산" && conflictingPDF.departureTime.isEmpty)
let cancelledRaster = TrainTicketDraft.parsePDF(text: "전자문서 사본") { _ in cancelledPhoto }
precondition(cancelledRaster.cancelled)
let partialPDF = try TrainTicketDraft.parsePDF(text: "도착역 부산") { _ in
  throw TrainTicketDraft.ValidationError(field: nil, errorDescription: "Unreadable image")
}
precondition(partialPDF.arrivalName == "부산" && partialPDF.departureTime.isEmpty)
print("Mixed PDF text layer, rendering and cancellation policy passed")

// The iOS Vision transcript of the scanned intercity fixture used ">>" for its route arrow.
func scannedBus(_ routes: [String], heading: String = "시외버스 승차권") -> TrainTicketDraft {
  let lines = ([heading, "2026-11-21"] + routes + ["우등", "출발 12:20", "도착 14:45"])
    .map { region($0, 0.1, 0.2) }
  return TrainTicketDraft.parseImage(lines: lines, words: lines)
}
let scan = scannedBus(["인천공항2터미널 >> 청주"])
precondition(scan.departureName == "인천공항2터미널" && scan.arrivalName == "청주")
precondition(scannedBus(["청주 >> 인천공항2터미널"]).arrivalName == "인천공항2터미널")
for ambiguous in [
  scannedBus(["인천공항2터미널 >> 청주", "공주터미널 >> 서울"]),
  scannedBus(["인천공항2터미널 >> 청주", "공주 → 서울"]),
  scannedBus(["추가 안내: 인천공항2터미널 >> 청주"]), scannedBus(["안내 >> 확인"]),
  scannedBus(["인천공항2터미널 >> 청주"], heading: "KTX 승차권"),
] { precondition(ambiguous.departureName.isEmpty && ambiguous.arrivalName.isEmpty) }
precondition(TrainTicketDraft.parse("시외버스 승차권\n인천공항2터미널 >> 청주").departureName.isEmpty)
print("Scanned bus route-arrow recognition and ambiguity controls passed")

func scannedRail(_ rows: [String], heading: String = "기차 승차권 테스트") -> TrainTicketDraft {
  let lines = ([heading] + rows).map { region($0, 0.1, 0.2) }
  return TrainTicketDraft.parseImage(lines: lines, words: lines)
}
let railDay = "2026-11-21", railRoute = "수서 >> 공주", railService = "SRT 615"
let railClocks = ["출발 12:20", "도착 13:12"]
let compactScan = scannedRail([railDay, railRoute, railService] + railClocks)
precondition(compactScan.departureName == "수서" && compactScan.arrivalName == "공주")
let singleChevronScan = scannedRail([railDay, "수서 > 공주", railService] + railClocks)
precondition(singleChevronScan.departureName == "수서" && singleChevronScan.arrivalName == "공주")
precondition(compactScan.trainNumber == "615" && compactScan.departureTime == railDay + " 12:20" && compactScan.arrivalTime == railDay + " 13:12")
for incompleteRows in [
  [railDay, "안내 >> 확인", railService] + railClocks,
  [railDay, railRoute, railService, "서울 → 부산"] + railClocks,
  [railDay, railRoute, railService, "서울 >> 부산"] + railClocks,
  [railDay, railRoute, railService, "서울 > 부산"] + railClocks,
  [railDay, "안내", railRoute, railService] + railClocks,
  [railDay, railRoute, railService, "출발 12:20"],
  [railDay, railRoute, railService, "출발역 서울"] + railClocks,
] {
  let uncertain = scannedRail(incompleteRows)
  precondition(uncertain.departureName.isEmpty && uncertain.arrivalName.isEmpty)
}
precondition(TrainTicketDraft.parse(([railDay, railRoute, railService] + railClocks).joined(separator: "\n")).departureName.isEmpty)

// A ticket screen can hide its journey while still exposing the phone clock
// and a footer timestamp. Neither is a departure or arrival field.
for timestamp in ["2026-11-27 09:52:45", "2026-11-27 09:52:06"] {
  let protectedScreen = TrainTicketDraft.parse(
    "9:52\n승차권\n6일 전\n차내시설\n열차 위치\n승차권변경\n전달하기\n환불받기\n" + timestamp
  )
  precondition(protectedScreen.departureName.isEmpty && protectedScreen.arrivalName.isEmpty)
  precondition(protectedScreen.trainNumber.isEmpty)
  precondition(protectedScreen.departureTime.isEmpty && protectedScreen.arrivalTime.isEmpty)
}
let ticketWithFooterTimestamp = TrainTicketDraft.parse(
  "승차권\n2026-12-03\n서울 → 동대구\nKTX 255\n06:43\n08:32\n2026-12-03 05:52:45"
)
precondition(ticketWithFooterTimestamp.departureTime == "2026-12-03 06:43")
precondition(ticketWithFooterTimestamp.arrivalTime == "2026-12-03 08:32")
print("Screen footer timestamps stay separate from ticket departure and arrival")

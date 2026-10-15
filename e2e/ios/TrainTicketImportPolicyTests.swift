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

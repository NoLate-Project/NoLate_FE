import UIKit

@MainActor
final class TrainTicketReviewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  private let source: String
  private let initial: TrainTicketDraft
  private let categoryName: String
  private let completion: ([String: Any]?) -> Void
  private var fields: [UITextField] = []
  private let transport = UISegmentedControl(items: ["기차", "고속버스", "시외버스"])
  private let confirmButton = UIButton(type: .system)
  private let saveButton = UIButton(type: .system)
  private let errorLabel = UILabel()
  private var confirmed = false
  private var completed = false

  init(draft: TrainTicketDraft, source: String, categoryName: String, completion: @escaping ([String: Any]?) -> Void) {
    self.initial = draft; self.source = source; self.categoryName = categoryName; self.completion = completion
    super.init(nibName: nil, bundle: nil)
    isModalInPresentation = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let scroll = UIScrollView()
    scroll.keyboardDismissMode = .onDrag
    scroll.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)
    let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 10
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
      stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
    ])
    func label(_ text: String, heading: Bool = false) {
      let label = UILabel(); label.text = text; label.numberOfLines = 0
      label.font = .preferredFont(forTextStyle: heading ? .title2 : .subheadline)
      label.adjustsFontForContentSizeCategory = true
      stack.addArrangedSubview(label)
    }
    label(initial.kind == "TRAIN" ? "기차 승차권 확인" : "버스 승차권 확인", heading: true)
    transport.selectedSegmentIndex = ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"].firstIndex(of: initial.kind) ?? 0
    transport.accessibilityLabel = "승차권 교통수단"
    transport.addTarget(self, action: #selector(changed), for: .valueChanged)
    stack.addArrangedSubview(transport)
    label("인식한 내용을 원본과 비교해 수정하세요. 한 번에 한 운행편만 저장합니다. 이미지·QR·결제정보는 전송하지 않습니다.")
    let values = [initial.departureName, initial.arrivalName, initial.departureTime, initial.arrivalTime, initial.trainNumber, initial.grade]
    for (index, name) in ["출발역", "도착역", "출발 시각", "도착 시각", "열차번호", "열차종류·버스등급"].enumerated() {
      label(name)
      let field = UITextField(); field.clearButtonMode = .always; field.borderStyle = .roundedRect; field.text = values[index]
      field.accessibilityLabel = "승차권 \(name)"
      field.placeholder = (index == 2 || index == 3) ? "YYYY-MM-DD HH:mm (한국 시간)" : name
      field.autocorrectionType = .no; field.spellCheckingType = .no; field.textContentType = .none
      field.addTarget(self, action: #selector(changed), for: .editingChanged)
      field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      stack.addArrangedSubview(field); fields.append(field)
    }
    fields[4].isEnabled = initial.kind == "TRAIN"
    label("개인 카테고리 ‘\(categoryName)’에 도착 시각의 일정으로 저장합니다. 앞뒤 이동은 앱에서 경로를 설정하세요. 예매·좌석·탑승홈은 예매처에서 확인해야 하며, 이 화면은 탑승용 승차권이 아닙니다.")
    var confirmationStyle = UIButton.Configuration.tinted()
    confirmationStyle.baseForegroundColor = .label
    confirmationStyle.baseBackgroundColor = .secondarySystemFill
    confirmationStyle.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
    confirmButton.configuration = confirmationStyle
    confirmButton.setTitle("원본과 날짜·역·시각·열차번호가 같습니다", for: .normal)
    confirmButton.titleLabel?.numberOfLines = 0
    confirmButton.addTarget(self, action: #selector(toggleConfirmed), for: .touchUpInside)
    confirmButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
    stack.addArrangedSubview(confirmButton)
    errorLabel.numberOfLines = 0; errorLabel.textColor = .systemRed
    stack.addArrangedSubview(errorLabel)
    saveButton.configuration = .filled(); saveButton.setTitle("확인한 승차권 정보 저장", for: .normal)
    saveButton.isEnabled = false; saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50).isActive = true
    stack.addArrangedSubview(saveButton)
    let cancel = UIButton(type: .system); cancel.setTitle("승차권 가져오기 취소", for: .normal)
    cancel.addTarget(self, action: #selector(cancelImport), for: .touchUpInside)
    stack.addArrangedSubview(cancel)
    refreshConfirmation()
  }
  @objc private func changed() { fields[4].isEnabled = transport.selectedSegmentIndex == 0; confirmed = false; refreshConfirmation() }
  @objc private func toggleConfirmed() { view.endEditing(true); confirmed.toggle(); refreshConfirmation() }
  private func refreshConfirmation() {
    confirmButton.setTitle(confirmed ? "원본 승차권 정보 확인됨" : (transport.selectedSegmentIndex == 0 ? "원본과 날짜·역·시각·열차번호가 같습니다" : "원본과 수단·날짜·터미널·시각·등급이 같습니다"), for: .normal)
    confirmButton.accessibilityTraits = confirmed ? [.button, .selected] : [.button]
    saveButton.isEnabled = confirmed; errorLabel.text = nil
  }
  @objc private func save() {
    guard confirmed, !completed else { return }
    var draft = initial
    draft.kind = ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"][transport.selectedSegmentIndex]
    draft.departureName = fields[0].text ?? ""; draft.arrivalName = fields[1].text ?? ""
    draft.departureTime = fields[2].text ?? ""; draft.arrivalTime = fields[3].text ?? ""
    draft.trainNumber = fields[4].text ?? ""; draft.grade = fields[5].text ?? ""
    do { let payload = try draft.confirmedPayload(source: source); finish(payload) }
    catch { errorLabel.text = error.localizedDescription; UIAccessibility.post(notification: .announcement, argument: error.localizedDescription) }
  }
  private func finish(_ payload: [String: Any]?) {
    guard !completed else { return }; completed = true
    dismiss(animated: true) { self.completion(payload) }
  }
  @objc private func cancelImport() { finish(nil) }
}

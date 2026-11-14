import UIKit

@MainActor
final class TrainTicketReviewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  private let source: String
  private let initial: TrainTicketDraft
  private let categoryName: String
  private let completion: ([String: Any]?) -> Void
  private let scroll = UIScrollView()
  private var fields: [UITextField] = []
  private let transport = UISegmentedControl(items: ["기차", "고속버스", "시외버스"])
  private let confirmButton = UIButton(type: .system)
  private let saveButton = UIButton(type: .system)
  private let errorLabel = UILabel()
  private var fieldLabels: [UILabel] = []
  private var fieldGroups: [UIStackView] = []
  private var wideTimeConstraints: [NSLayoutConstraint] = []
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
    let secondaryContent = UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 161 / 255, green: 167 / 255, blue: 179 / 255, alpha: 1)
        : UIColor(red: 98 / 255, green: 105 / 255, blue: 119 / 255, alpha: 1)
    }
    let header = UIStackView()
    header.axis = .vertical
    header.spacing = 4
    let close = UIButton(type: .system)
    close.setImage(ShareViewController.outlineIcon(62030, size: 22), for: .normal)
    close.accessibilityLabel = "승차권 가져오기 취소"
    close.addTarget(self, action: #selector(cancelImport), for: .touchUpInside)
    close.widthAnchor.constraint(equalToConstant: 44).isActive = true
    close.heightAnchor.constraint(equalToConstant: 44).isActive = true
    let heading = makeLabel("승차권 확인", style: .title2, color: .label, bold: true)
    heading.accessibilityTraits = .header
    heading.accessibilityLabel = initial.kind == "TRAIN" ? "기차 승차권 확인" : "버스 승차권 확인"
    let headerRow = UIStackView(arrangedSubviews: [heading, close])
    headerRow.alignment = .center
    header.addArrangedSubview(headerRow)
    header.addArrangedSubview(makeLabel("공유한 원본을 보고 날짜와 시각을 확인해 주세요.", style: .subheadline, color: secondaryContent))

    scroll.keyboardDismissMode = .onDrag
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    let footer = UIStackView()
    footer.axis = .vertical
    footer.spacing = 6
    for region in [header, scroll, footer] {
      region.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(region)
    }
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
      header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
      scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 10),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scroll.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -8),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 4),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -8),
      stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 18),
      stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -18),
      footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
      footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
      footer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
    ])

    transport.selectedSegmentIndex = ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"].firstIndex(of: initial.kind) ?? 0
    transport.accessibilityLabel = "승차권 교통수단"
    transport.addTarget(self, action: #selector(changed), for: .valueChanged)
    transport.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    stack.addArrangedSubview(transport)

    let names = ["출발역", "도착역", "출발 시각", "도착 시각", "열차번호", "열차종류·버스등급"]
    let values = [initial.departureName, initial.arrivalName, initial.departureTime, initial.arrivalTime, initial.trainNumber, initial.grade]
    let rows = names.enumerated().map { index, name in
      let label = makeLabel(name, style: .footnote, color: secondaryContent, bold: true)
      label.isAccessibilityElement = false
      fieldLabels.append(label)
      let field = UITextField()
      field.clearButtonMode = .whileEditing
      field.text = values[index]
      field.font = .preferredFont(forTextStyle: .subheadline)
      field.adjustsFontForContentSizeCategory = true
      field.backgroundColor = .systemBackground
      field.layer.cornerRadius = 9
      field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 8, height: 1))
      field.leftViewMode = .always
      field.accessibilityLabel = "승차권 \(name)"
      field.placeholder = (index == 2 || index == 3) ? "YYYY-MM-DD HH:mm" : name
      field.autocorrectionType = .no
      field.spellCheckingType = .no
      field.textContentType = .none
      if index == 2 || index == 3 { field.keyboardType = .numbersAndPunctuation }
      if index == 4 { field.keyboardType = .numberPad }
      let keyboardBar = UIToolbar()
      keyboardBar.sizeToFit()
      let done = UIBarButtonItem(title: "완료", style: .done, target: self, action: #selector(closeKeyboard))
      done.accessibilityLabel = "키보드 닫기"
      keyboardBar.items = [UIBarButtonItem(systemItem: .flexibleSpace), done]
      field.inputAccessoryView = keyboardBar
      field.addTarget(self, action: #selector(changed), for: .editingChanged)
      field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      fields.append(field)
      let row = UIStackView(arrangedSubviews: [label, field])
      row.axis = .vertical
      row.spacing = 4
      return row
    }
    fieldGroups = [makeFieldGroup([rows[0], rows[2]]), makeFieldGroup([rows[1], rows[3]]),
                   makeFieldGroup([rows[4], rows[5]])]
    wideTimeConstraints = [
      rows[2].widthAnchor.constraint(equalTo: rows[0].widthAnchor, multiplier: 1.45),
      rows[3].widthAnchor.constraint(equalTo: rows[1].widthAnchor, multiplier: 1.45),
    ]
    stack.addArrangedSubview(makeStop("출발", icon: 61751, fields: fieldGroups[0]))
    stack.addArrangedSubview(makeStop("도착", icon: 61983, fields: fieldGroups[1]))
    let service = UIStackView(arrangedSubviews: [fieldGroups[2]])
    styleCard(service)
    stack.addArrangedSubview(service)
    errorLabel.numberOfLines = 0
    errorLabel.font = .preferredFont(forTextStyle: .subheadline)
    errorLabel.adjustsFontForContentSizeCategory = true
    errorLabel.textColor = .systemRed
    errorLabel.isHidden = true
    stack.addArrangedSubview(errorLabel)
    stack.addArrangedSubview(makeLabel("저장 위치 · 개인 카테고리 ‘\(categoryName)’", style: .subheadline, color: .label, bold: true))
    stack.addArrangedSubview(makeLabel("한국 시간 기준 도착 시각에 저장합니다. 예매·좌석·탑승홈은 예매처에서 확인해 주세요.", style: .footnote, color: secondaryContent))

    confirmButton.configuration = .plain()
    confirmButton.configuration?.contentInsets = .zero
    confirmButton.configuration?.imagePadding = 8
    confirmButton.contentHorizontalAlignment = .leading
    confirmButton.titleLabel?.numberOfLines = 0
    confirmButton.addTarget(self, action: #selector(toggleConfirmed), for: .touchUpInside)
    confirmButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    footer.addArrangedSubview(confirmButton)
    saveButton.configuration = .filled()
    saveButton.configuration?.cornerStyle = .medium
    saveButton.setTitle("일정에 저장", for: .normal)
    saveButton.accessibilityIdentifier = "ticket-review-save"
    saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
    footer.addArrangedSubview(saveButton)
    refreshConfirmation()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let narrow = view.bounds.width <= 365 || traitCollection.preferredContentSizeCategory.isAccessibilityCategory
    let axis: NSLayoutConstraint.Axis = narrow ? .vertical : .horizontal
    if narrow { NSLayoutConstraint.deactivate(wideTimeConstraints) }
    for group in fieldGroups where group.axis != axis { group.axis = axis }
    fieldGroups.last?.distribution = narrow ? .fill : .fillEqually
    if !narrow { NSLayoutConstraint.activate(wideTimeConstraints) }
  }

  private func makeLabel(_ text: String, style: UIFont.TextStyle, color: UIColor, bold: Bool = false) -> UILabel {
    let label = UILabel()
    let font = UIFont.preferredFont(forTextStyle: style)
    label.font = bold ? UIFont(descriptor: font.fontDescriptor.withSymbolicTraits(.traitBold) ?? font.fontDescriptor, size: 0) : font
    label.adjustsFontForContentSizeCategory = true
    label.text = text
    label.textColor = color
    label.numberOfLines = 0
    return label
  }

  private func makeFieldGroup(_ rows: [UIStackView]) -> UIStackView {
    let group = UIStackView(arrangedSubviews: rows)
    group.spacing = 8
    return group
  }

  private func styleCard(_ card: UIStackView) {
    card.axis = .vertical
    card.spacing = 8
    card.backgroundColor = .secondarySystemBackground
    card.layer.cornerRadius = 14
    card.isLayoutMarginsRelativeArrangement = true
    card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
  }

  private func makeStop(_ title: String, icon: UInt32, fields: UIStackView) -> UIStackView {
    let image = UIImageView(image: ShareViewController.outlineIcon(icon, size: 17))
    image.tintColor = .systemBlue
    image.contentMode = .center
    image.widthAnchor.constraint(equalToConstant: 17).isActive = true
    let label = makeLabel(title, style: .subheadline, color: .systemBlue, bold: true)
    label.accessibilityTraits = .header
    let row = UIStackView(arrangedSubviews: [image, label])
    row.spacing = 6
    let card = UIStackView(arrangedSubviews: [row, fields])
    styleCard(card)
    return card
  }
  @objc private func closeKeyboard() { view.endEditing(true) }
  @objc private func changed() {
    confirmed = false
    refreshConfirmation()
  }
  @objc private func toggleConfirmed() {
    view.endEditing(true)
    confirmed.toggle()
    refreshConfirmation()
  }
  private func refreshConfirmation() {
    let train = transport.selectedSegmentIndex == 0
    fieldLabels[0].text = train ? "출발역" : "출발 터미널"
    fieldLabels[1].text = train ? "도착역" : "도착 터미널"
    fieldLabels[5].text = train ? "열차 종류" : "버스 등급"
    for index in [0, 1, 5] { fields[index].accessibilityLabel = "승차권 \(fieldLabels[index].text ?? "")" }
    fieldGroups[2].arrangedSubviews[0].isHidden = !train
    var configuration = confirmButton.configuration
    configuration?.title = "원본 승차권과 대조했어요"
    configuration?.image = ShareViewController.outlineIcon(confirmed ? 61983 : 62867, size: 21)
    configuration?.baseForegroundColor = confirmed ? .systemBlue : .label
    confirmButton.configuration = configuration
    confirmButton.accessibilityLabel = "원본 승차권과 대조했어요"
    confirmButton.accessibilityIdentifier = "ticket-review-confirm"
    confirmButton.accessibilityTraits = confirmed ? [.button, .selected] : [.button]
    saveButton.isEnabled = confirmed
    errorLabel.text = nil
    errorLabel.isHidden = true
  }
  @objc private func save() {
    guard confirmed, !completed else { return }
    var draft = initial
    draft.kind = ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"][transport.selectedSegmentIndex]
    draft.departureName = fields[0].text ?? ""; draft.arrivalName = fields[1].text ?? ""
    draft.departureTime = fields[2].text ?? ""; draft.arrivalTime = fields[3].text ?? ""
    draft.trainNumber = fields[4].text ?? ""; draft.grade = fields[5].text ?? ""
    do { let payload = try draft.confirmedPayload(source: source); finish(payload) }
    catch {
      errorLabel.text = error.localizedDescription
      errorLabel.isHidden = false
      view.layoutIfNeeded()
      scroll.scrollRectToVisible(errorLabel.convert(errorLabel.bounds, to: scroll), animated: !UIAccessibility.isReduceMotionEnabled)
      UIAccessibility.post(notification: .announcement, argument: error.localizedDescription)
    }
  }
  private func finish(_ payload: [String: Any]?) {
    guard !completed else { return }; completed = true
    dismiss(animated: true) { self.completion(payload) }
  }
  @objc private func cancelImport() { finish(nil) }
}

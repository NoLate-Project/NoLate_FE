import UIKit

@MainActor
final class TrainTicketReviewController: UIViewController, UIAdaptivePresentationControllerDelegate {
  private static let actionBlue = UIColor(red: 25 / 255, green: 89 / 255, blue: 219 / 255, alpha: 1)
  private let source: String
  private let initial: TrainTicketDraft
  private let categoryName: String
  private let willSave: (() -> Void)?
  private let completion: ([String: Any]?) -> Void
  private let scroll = UIScrollView()
  private var fields: [UITextField] = []
  private let transport = UISegmentedControl(items: ["기차", "고속버스", "시외버스"])
  private let confirmButton = UIButton(type: .system)
  private let saveButton = UIButton(type: .system)
  private let errorLabel = UILabel()
  private var fieldLabels: [UILabel] = []
  private var fieldRows: [UIStackView] = []
  private var fieldInputs: [UIControl] = []
  private weak var formStack: UIStackView?
  private weak var invalidFieldRow: UIStackView?
  private weak var invalidFieldInput: UIControl?
  private weak var focusedTextField: UITextField?
  private var focusedFieldViewportHeight: CGFloat?
  private var fieldGroups: [UIStackView] = []
  private var wideTimeConstraints: [NSLayoutConstraint] = []
  private var ticketTimes: [String]
  private let ticketTimeFormatter = TrainTicketDraft.ticketTimeFormatter()
  private let displayTimeFormatter: DateFormatter = {
    let formatter = TrainTicketDraft.ticketTimeFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "yyyy. MM. dd. a h:mm"
    return formatter
  }()
  private var confirmed = false
  private var completed = false
  private var usesStandardLayout: Bool { !traitCollection.preferredContentSizeCategory.isAccessibilityCategory }

  init(draft: TrainTicketDraft, source: String, categoryName: String, willSave: (() -> Void)? = nil,
       completion: @escaping ([String: Any]?) -> Void) {
    self.initial = draft; self.source = source; self.categoryName = categoryName; self.completion = completion
    self.willSave = willSave
    ticketTimes = [draft.departureTime, draft.arrivalTime]
    super.init(nibName: nil, bundle: nil)
    isModalInPresentation = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    NotificationCenter.default.addObserver(
      self, selector: #selector(keyboardFrameDidChange),
      name: UIResponder.keyboardDidChangeFrameNotification, object: nil
    )
    let standard = usesStandardLayout
    let ink = standard ? ShareTicketColors.text : .label
    view.backgroundColor = standard ? ShareTicketColors.background : .systemBackground
    let secondaryContent = standard ? ShareTicketColors.detail : UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 161 / 255, green: 167 / 255, blue: 179 / 255, alpha: 1)
        : UIColor(red: 98 / 255, green: 105 / 255, blue: 119 / 255, alpha: 1)
    }
    let header = UIStackView()
    header.axis = .vertical
    header.spacing = 4
    let close = UIButton(type: .system)
    close.setImage(ShareViewController.outlineIcon(62030, size: 22), for: .normal)
    close.tintColor = secondaryContent
    close.accessibilityLabel = "승차권 가져오기 취소"
    close.addTarget(self, action: #selector(cancelImport), for: .touchUpInside)
    close.widthAnchor.constraint(equalToConstant: 44).isActive = true
    close.heightAnchor.constraint(equalToConstant: 44).isActive = true
    let heading = makeLabel("승차권 확인", style: .title2, color: ink, bold: true)
    heading.accessibilityTraits = .header
    heading.accessibilityLabel = initial.kind == "TRAIN" ? "기차 승차권 확인" : "버스 승차권 확인"
    let headerRow = UIStackView(arrangedSubviews: [heading, close])
    headerRow.alignment = .center
    header.addArrangedSubview(headerRow)
    header.addArrangedSubview(makeLabel("공유한 원본을 보고 날짜와 시각을 확인해 주세요.", style: .subheadline, color: secondaryContent))

    scroll.keyboardDismissMode = .onDrag
    let stack = UIStackView()
    formStack = stack
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    let footer = UIStackView()
    footer.axis = .vertical
    footer.spacing = 6
    let footerDivider = UIView()
    footerDivider.backgroundColor = standard ? ShareTicketColors.separator : .separator
    footerDivider.isAccessibilityElement = false
    for region in [header, scroll, footer, footerDivider] {
      region.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(region)
    }
    if standard {
      let headerDivider = UIView()
      headerDivider.backgroundColor = ShareTicketColors.separator
      headerDivider.isAccessibilityElement = false
      headerDivider.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(headerDivider)
      NSLayoutConstraint.activate([
        headerDivider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        headerDivider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        headerDivider.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 5),
        headerDivider.heightAnchor.constraint(equalToConstant: 1 / max(traitCollection.displayScale, 1)),
      ])
    }
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
      header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
      scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 10),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scroll.bottomAnchor.constraint(equalTo: footerDivider.topAnchor),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 4),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -8),
      stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 18),
      stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -18),
      footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
      footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
      footer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
      footerDivider.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -6),
      footerDivider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      footerDivider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      footerDivider.heightAnchor.constraint(equalToConstant: 1 / max(view.traitCollection.displayScale, 1)),
    ])

    transport.selectedSegmentIndex = ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"].firstIndex(of: initial.kind) ?? 0
    transport.accessibilityLabel = "승차권 교통수단"
    transport.addTarget(self, action: #selector(changed), for: .valueChanged)
    transport.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    if standard {
      transport.backgroundColor = ShareTicketColors.surface
      transport.selectedSegmentTintColor = ShareTicketColors.background
      transport.setTitleTextAttributes([.foregroundColor: secondaryContent], for: .normal)
      transport.setTitleTextAttributes([.foregroundColor: ShareTicketColors.accent], for: .selected)
    }
    stack.addArrangedSubview(transport)

    let names = ["출발역", "도착역", "출발 시각", "도착 시각", "열차번호", "열차종류·버스등급"]
    let values = [initial.departureName, initial.arrivalName, "", "", initial.trainNumber, initial.grade]
    let rows = names.enumerated().map { index, name in
      let label = makeLabel(name, style: .footnote, color: secondaryContent, bold: true)
      label.isAccessibilityElement = false
      fieldLabels.append(label)
      if (2...3).contains(index) {
        let button = makeTimeButton(label: name, index: index - 2)
        fieldInputs.append(button)
        let row = UIStackView(arrangedSubviews: [label, button])
        row.axis = .vertical
        row.spacing = 4
        return row
      }
      let field = UITextField()
      field.clearButtonMode = .whileEditing
      field.text = values[index]
      field.font = .preferredFont(forTextStyle: .subheadline)
      field.adjustsFontForContentSizeCategory = true
      field.backgroundColor = standard ? ShareTicketColors.background : .systemBackground
      field.textColor = ink
      field.layer.cornerRadius = 9
      field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 8, height: 1))
      field.leftViewMode = .always
      field.accessibilityLabel = "승차권 \(name)"
      field.placeholder = name
      field.autocorrectionType = .no
      field.spellCheckingType = .no
      field.textContentType = .none
      if index == 4 { field.keyboardType = .numberPad }
      let keyboardBar = UIToolbar()
      keyboardBar.sizeToFit()
      let done = UIBarButtonItem(title: "완료", style: .done, target: self, action: #selector(closeKeyboard))
      done.accessibilityLabel = "키보드 닫기"
      keyboardBar.items = [UIBarButtonItem(systemItem: .flexibleSpace), done]
      field.inputAccessoryView = keyboardBar
      field.addTarget(self, action: #selector(beganEditing(_:)), for: .editingDidBegin)
      field.addTarget(self, action: #selector(endedEditing(_:)), for: .editingDidEnd)
      field.addTarget(self, action: #selector(changed), for: .editingChanged)
      field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      if standard { styleInputBorder(field, invalid: false) }
      fields.append(field)
      fieldInputs.append(field)
      let row = UIStackView(arrangedSubviews: [label, field])
      row.axis = .vertical
      row.spacing = 4
      return row
    }
    fieldRows = rows
    fieldGroups = [makeFieldGroup([rows[0], rows[2]]), makeFieldGroup([rows[1], rows[3]]),
                   makeFieldGroup([rows[4], rows[5]])]
    let timeWidth: CGFloat = standard ? 1.57 : 1.45
    wideTimeConstraints = [
      rows[2].widthAnchor.constraint(equalTo: rows[0].widthAnchor, multiplier: timeWidth),
      rows[3].widthAnchor.constraint(equalTo: rows[1].widthAnchor, multiplier: timeWidth),
    ]
    stack.addArrangedSubview(makeStop("출발", icon: 61751, fields: fieldGroups[0]))
    stack.addArrangedSubview(makeStop("도착", icon: 61983, fields: fieldGroups[1]))
    if standard {
      stack.addArrangedSubview(fieldGroups[2])
    } else {
      let service = UIStackView(arrangedSubviews: [fieldGroups[2]])
      styleCard(service)
      stack.addArrangedSubview(service)
    }
    errorLabel.numberOfLines = 0
    errorLabel.font = .preferredFont(forTextStyle: .subheadline)
    errorLabel.adjustsFontForContentSizeCategory = true
    errorLabel.textColor = standard ? ShareTicketColors.error : .systemRed
    errorLabel.isHidden = true
    errorLabel.accessibilityIdentifier = "ticket-review-validation-error"
    stack.addArrangedSubview(makeLabel("저장 위치 · 개인 카테고리 ‘\(categoryName)’", style: .subheadline, color: ink, bold: true))
    stack.addArrangedSubview(makeLabel("한국 시간 기준 도착 시각에 저장합니다. 예매·좌석·탑승홈은 예매처에서 확인해 주세요.", style: .footnote, color: secondaryContent))

    confirmButton.configuration = .plain()
    confirmButton.configuration?.contentInsets = .zero
    confirmButton.configuration?.imagePadding = 8
    confirmButton.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = .preferredFont(forTextStyle: .headline)
      return attributes
    }
    confirmButton.contentHorizontalAlignment = .leading
    confirmButton.titleLabel?.numberOfLines = 0
    confirmButton.addTarget(self, action: #selector(toggleConfirmed), for: .touchUpInside)
    confirmButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    footer.addArrangedSubview(confirmButton)
    var saveConfiguration = standard ? UIButton.Configuration.plain() : UIButton.Configuration.filled()
    saveConfiguration.cornerStyle = standard ? .fixed : .medium
    saveConfiguration.title = "일정에 저장"
    saveConfiguration.titleTextAttributesTransformer = confirmButton.configuration?.titleTextAttributesTransformer
    saveButton.configuration = saveConfiguration
    saveButton.accessibilityIdentifier = "ticket-review-save"
    saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: standard ? 46 : 48).isActive = true
    footer.addArrangedSubview(saveButton)
    refreshConfirmation()
  }

  private func makeTimeButton(label: String, index: Int) -> UIButton {
    let button = UIButton(type: .system)
    button.tag = index
    button.accessibilityIdentifier = index == 0 ? "ticket-departure-time" : "ticket-arrival-time"
    button.accessibilityLabel = "승차권 \(label)"
    button.contentHorizontalAlignment = .leading
    button.titleLabel?.numberOfLines = 0
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    button.addTarget(self, action: #selector(editTime(_:)), for: .touchUpInside)
    setTimeButtonValue(button)
    return button
  }

  private func confirmedTime(_ index: Int) -> Date? {
    let text = ticketTimes[index]
    guard let date = ticketTimeFormatter.date(from: text), ticketTimeFormatter.string(from: date) == text else { return nil }
    return date
  }

  private func setTimeButtonValue(_ button: UIButton) {
    let date = confirmedTime(button.tag)
    let title = date.map { displayTimeFormatter.string(from: $0) } ?? "날짜와 시각 선택"
    var config = UIButton.Configuration.plain()
    config.title = title
    config.image = ShareViewController.outlineIcon(61910, size: 15)
    config.imagePlacement = .trailing
    config.imagePadding = 6
    config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
    config.background.backgroundColor = usesStandardLayout ? ShareTicketColors.background : .systemBackground
    config.background.cornerRadius = 9
    config.baseForegroundColor = usesStandardLayout
      ? (date == nil ? ShareTicketColors.detail : ShareTicketColors.text)
      : (date == nil ? .secondaryLabel : .label)
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var attributes = attributes
      attributes.font = .preferredFont(forTextStyle: .subheadline)
      return attributes
    }
    button.configuration = config
    if usesStandardLayout { styleInputBorder(button, invalid: invalidFieldInput === button) }
    button.accessibilityValue = title
  }

  @objc private func editTime(_ button: UIButton) {
    closeKeyboard()
    let index = button.tag
    let editor = UIViewController()
    editor.view.backgroundColor = .systemBackground
    editor.title = index == 0 ? "출발 시각" : "도착 시각"
    let picker = UIDatePicker()
    picker.datePickerMode = .dateAndTime
    picker.preferredDatePickerStyle = .wheels
    picker.locale = Locale(identifier: "ko_KR")
    picker.calendar = ticketTimeFormatter.calendar
    picker.timeZone = ticketTimeFormatter.timeZone
    picker.date = confirmedTime(index) ?? confirmedTime(1 - index) ?? Date()
    picker.accessibilityIdentifier = "ticket-time-picker"
    picker.translatesAutoresizingMaskIntoConstraints = false
    editor.view.addSubview(picker)
    NSLayoutConstraint.activate([
      picker.topAnchor.constraint(equalTo: editor.view.safeAreaLayoutGuide.topAnchor, constant: 8),
      picker.leadingAnchor.constraint(equalTo: editor.view.safeAreaLayoutGuide.leadingAnchor),
      picker.trailingAnchor.constraint(equalTo: editor.view.safeAreaLayoutGuide.trailingAnchor),
    ])
    editor.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak editor] _ in
      editor?.dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
    })
    editor.navigationItem.rightBarButtonItem = UIBarButtonItem(title: "적용", primaryAction: UIAction { [weak self, weak editor] _ in
      guard let self else { return }
      let newTime = ticketTimeFormatter.string(from: picker.date)
      if newTime != ticketTimes[index] {
        ticketTimes[index] = newTime
        setTimeButtonValue(button)
        changed()
      }
      editor?.dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
    })
    let navigation = UINavigationController(rootViewController: editor)
    navigation.sheetPresentationController?.detents = [.medium(), .large()]
    present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let narrow = view.bounds.width <= 365 || traitCollection.preferredContentSizeCategory.isAccessibilityCategory
    let axis: NSLayoutConstraint.Axis = narrow ? .vertical : .horizontal
    if narrow { NSLayoutConstraint.deactivate(wideTimeConstraints) }
    for group in fieldGroups where group.axis != axis { group.axis = axis }
    fieldGroups.last?.distribution = narrow ? .fill : .fillEqually
    if !narrow { NSLayoutConstraint.activate(wideTimeConstraints) }
    revealFocusedFieldAfterResize()
    revealInvalidField()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    guard usesStandardLayout, traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) else { return }
    for field in fields { styleInputBorder(field, invalid: invalidFieldInput === field) }
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
    card.backgroundColor = usesStandardLayout ? ShareTicketColors.surface : .secondarySystemBackground
    card.layer.cornerRadius = 14
    card.isLayoutMarginsRelativeArrangement = true
    card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
  }

  private func makeStop(_ title: String, icon: UInt32, fields: UIStackView) -> UIStackView {
    let image = UIImageView(image: ShareViewController.outlineIcon(icon, size: 17))
    let accent = usesStandardLayout ? ShareTicketColors.accent : .systemBlue
    image.tintColor = accent
    image.contentMode = .center
    image.widthAnchor.constraint(equalToConstant: 17).isActive = true
    let label = makeLabel(title, style: .subheadline, color: accent, bold: true)
    label.accessibilityTraits = .header
    let row = UIStackView(arrangedSubviews: [image, label])
    row.spacing = 6
    let card = UIStackView(arrangedSubviews: [row, fields])
    styleCard(card)
    return card
  }
  @objc private func closeKeyboard() { view.endEditing(true) }

  @objc private func beganEditing(_ field: UITextField) {
    focusedTextField = field
    focusedFieldViewportHeight = nil
    view.setNeedsLayout()
  }

  @objc private func endedEditing(_ field: UITextField) {
    guard focusedTextField === field else { return }
    focusedTextField = nil
    focusedFieldViewportHeight = nil
  }

  private func revealFocusedFieldAfterResize() {
    guard let field = focusedTextField,
          let index = fieldInputs.firstIndex(where: { $0 === field }) else { return }
    let height = scroll.bounds.height
    guard height > 0, focusedFieldViewportHeight != height else { return }
    focusedFieldViewportHeight = height
    revealFieldRow(fieldRows[index])
  }

  @objc private func keyboardFrameDidChange() {
    guard focusedTextField != nil else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, focusedTextField != nil else { return }
      view.layoutIfNeeded()
      focusedFieldViewportHeight = nil
      revealFocusedFieldAfterResize()
      revealInvalidField()
    }
  }

  @objc private func changed() {
    confirmed = false
    clearValidationError()
    refreshConfirmation()
  }
  @objc private func toggleConfirmed() {
    view.endEditing(true)
    confirmed.toggle()
    if !confirmed { clearValidationError() }
    refreshConfirmation()
  }
  private func refreshConfirmation() {
    let standard = usesStandardLayout
    let train = transport.selectedSegmentIndex == 0
    fieldLabels[0].text = train ? "출발역" : "출발 터미널"
    fieldLabels[1].text = train ? "도착역" : "도착 터미널"
    fieldLabels[5].text = train ? "열차 종류" : "버스 등급"
    for (fieldIndex, labelIndex) in [(0, 0), (1, 1), (3, 5)] {
      fields[fieldIndex].accessibilityLabel = "승차권 \(fieldLabels[labelIndex].text ?? "")"
    }
    fieldGroups[2].arrangedSubviews[0].isHidden = !train
    var configuration = confirmButton.configuration
    configuration?.title = "원본 승차권과 대조했어요"
    configuration?.image = ShareViewController.outlineIcon(confirmed ? 61979 : 62867, size: 21)
    configuration?.baseForegroundColor = standard
      ? (confirmed ? ShareTicketColors.accent : ShareTicketColors.text)
      : (confirmed ? .systemBlue : .label)
    confirmButton.configuration = configuration
    confirmButton.accessibilityLabel = "원본 승차권과 대조했어요"
    confirmButton.accessibilityIdentifier = "ticket-review-confirm"
    confirmButton.accessibilityTraits = confirmed ? [.button, .selected] : [.button]
    var saveConfiguration = saveButton.configuration
    if standard {
      let foreground: UIColor = confirmed ? .white : ShareTicketColors.detail
      saveConfiguration?.background.backgroundColor = confirmed ? ShareTicketColors.action : ShareTicketColors.surface
      saveConfiguration?.background.cornerRadius = 12
      saveConfiguration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var attributes = attributes
        attributes.font = .preferredFont(forTextStyle: .headline)
        attributes.foregroundColor = foreground
        return attributes
      }
    } else {
      saveConfiguration?.baseBackgroundColor = confirmed ? Self.actionBlue : .secondarySystemBackground
      saveConfiguration?.baseForegroundColor = confirmed ? .white : .secondaryLabel
    }
    saveButton.configuration = saveConfiguration
    saveButton.isEnabled = confirmed
  }
  private func clearValidationError() {
    errorLabel.removeFromSuperview()
    errorLabel.text = nil
    invalidFieldRow = nil
    if usesStandardLayout, let input = invalidFieldInput { styleInputBorder(input, invalid: false) }
    invalidFieldInput = nil
  }

  private func styleInputBorder(_ input: UIControl, invalid: Bool) {
    let color = invalid ? ShareTicketColors.error : ShareTicketColors.separator
    if let field = input as? UITextField {
      field.layer.borderColor = color.resolvedColor(with: traitCollection).cgColor
      field.layer.borderWidth = 1
    } else if let button = input as? UIButton {
      button.configuration?.background.strokeColor = color
      button.configuration?.background.strokeWidth = 1
    }
  }

  private func revealInvalidField() {
    guard let row = invalidFieldRow else { return }
    revealFieldRow(row)
  }

  private func revealFieldRow(_ row: UIStackView) {
    let rowBounds = row.convert(row.bounds, to: scroll).insetBy(dx: 0, dy: -4)
    let inset = scroll.adjustedContentInset
    let bottom = scroll.bounds.height - inset.bottom
    guard bottom > inset.top else { return }
    let current = scroll.contentOffset.y
    let target: CGFloat
    if rowBounds.maxY > current + bottom {
      target = rowBounds.maxY - bottom
    } else if rowBounds.minY < current + inset.top {
      target = rowBounds.minY - inset.top
    } else {
      return
    }
    let lastOffset = max(-inset.top, scroll.contentSize.height - bottom)
    scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(lastOffset, max(-inset.top, target))), animated: false)
  }

  private func showValidationError(_ error: Error) {
    clearValidationError()
    let field = (error as? TrainTicketDraft.ValidationError)?.field
    let row = field.map { fieldRows[$0.rawValue] }
    let input = field.map { fieldInputs[$0.rawValue] }
    guard let stack = row ?? formStack else { return }
    invalidFieldRow = row
    invalidFieldInput = input
    if usesStandardLayout, let input { styleInputBorder(input, invalid: true) }
    errorLabel.text = error.localizedDescription
    errorLabel.isHidden = false
    if row != nil { stack.addArrangedSubview(errorLabel) }
    else { stack.insertArrangedSubview(errorLabel, at: 0) }
    view.layoutIfNeeded()
    let target = row ?? errorLabel
    scroll.scrollRectToVisible(target.convert(target.bounds, to: scroll), animated: false)
    if UIAccessibility.isVoiceOverRunning {
      UIAccessibility.post(notification: .layoutChanged, argument: errorLabel)
    } else if let textInput = input as? UITextField {
      textInput.becomeFirstResponder()
      revealInvalidField()
    }
  }
  @objc private func save() {
    guard confirmed, !completed else { return }
    var draft = initial
    draft.kind = ["TRAIN", "EXPRESS_BUS", "INTERCITY_BUS"][transport.selectedSegmentIndex]
    draft.departureName = fields[0].text ?? ""; draft.arrivalName = fields[1].text ?? ""
    draft.departureTime = ticketTimes[0]; draft.arrivalTime = ticketTimes[1]
    draft.trainNumber = fields[2].text ?? ""; draft.grade = fields[3].text ?? ""
    do { let payload = try draft.confirmedPayload(source: source); finish(payload) }
    catch { showValidationError(error) }
  }
  private func finish(_ payload: [String: Any]?) {
    guard !completed else { return }; completed = true
    if payload != nil { willSave?() }
    dismiss(animated: !UIAccessibility.isReduceMotionEnabled) { self.completion(payload) }
  }
  @objc private func cancelImport() { finish(nil) }
}

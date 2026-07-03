import SwiftUI
import UIKit

private final class ViewModeGlassControlModel: ObservableObject {
  @Published var selectedMode: String
  @Published var disabled: Bool
  @Published var colorScheme: String
  @Published var viewModeVariant: String
  @Published var prototypeTapRequest = 0
  @Published var prototypeCloseRequest = 0
  @Published var prototypeAddMenuRequest = 0
  @Published var prototypeQuickAddRequest = 0
  @Published var prototypeManualAddRequest = 0
  @Published var searchExpandedWidth: CGFloat
  @Published var searchQuery: String

  let handleSelect: (String) -> Void
  let handleOpenChange: (Bool) -> Void
  let handleSearch: () -> Void
  let handleSearchTextChange: (String) -> Void
  let handleSearchClose: () -> Void
  let handleAdd: () -> Void
  let handleQuickAdd: () -> Void
  let handleManualAdd: () -> Void
  let handleManageCategories: () -> Void

  init(
    selectedMode: String,
    disabled: Bool,
    colorScheme: String,
    viewModeVariant: String = "calendar",
    searchExpandedWidth: CGFloat = 361,
    searchQuery: String = "",
    handleSelect: @escaping (String) -> Void,
    handleOpenChange: @escaping (Bool) -> Void,
    handleSearch: @escaping () -> Void = {},
    handleSearchTextChange: @escaping (String) -> Void = { _ in },
    handleSearchClose: @escaping () -> Void = {},
    handleAdd: @escaping () -> Void = {},
    handleQuickAdd: @escaping () -> Void = {},
    handleManualAdd: @escaping () -> Void = {},
    handleManageCategories: @escaping () -> Void = {}
  ) {
    self.selectedMode = selectedMode
    self.disabled = disabled
    self.colorScheme = colorScheme
    self.viewModeVariant = viewModeVariant
    self.searchExpandedWidth = searchExpandedWidth
    self.searchQuery = searchQuery
    self.handleSelect = handleSelect
    self.handleOpenChange = handleOpenChange
    self.handleSearch = handleSearch
    self.handleSearchTextChange = handleSearchTextChange
    self.handleSearchClose = handleSearchClose
    self.handleAdd = handleAdd
    self.handleQuickAdd = handleQuickAdd
    self.handleManualAdd = handleManualAdd
    self.handleManageCategories = handleManageCategories
  }
}

private final class LiquidGlassIconButtonModel: ObservableObject {
  @Published var symbolName: String
  @Published var label: String
  @Published var leadingSymbolName: String
  @Published var trailingSymbolName: String
  @Published var buttonWidth: CGFloat
  @Published var buttonHeight: CGFloat
  @Published var disabled: Bool
  @Published var colorScheme: String

  let handlePress: () -> Void

  init(
    symbolName: String,
    label: String = "",
    leadingSymbolName: String = "",
    trailingSymbolName: String = "",
    buttonWidth: CGFloat = 58,
    buttonHeight: CGFloat = 58,
    disabled: Bool,
    colorScheme: String,
    handlePress: @escaping () -> Void
  ) {
    self.symbolName = symbolName
    self.label = label
    self.leadingSymbolName = leadingSymbolName
    self.trailingSymbolName = trailingSymbolName
    self.buttonWidth = buttonWidth
    self.buttonHeight = buttonHeight
    self.disabled = disabled
    self.colorScheme = colorScheme
    self.handlePress = handlePress
  }
}

private final class LiquidGlassSegmentedPillModel: ObservableObject {
  @Published var symbolNames: [String]
  @Published var selectedIndex: Int
  @Published var buttonHeight: CGFloat
  @Published var slotWidth: CGFloat
  @Published var disabled: Bool
  @Published var colorScheme: String

  let handleSelect: (Int) -> Void

  init(
    symbolNames: [String],
    selectedIndex: Int,
    buttonHeight: CGFloat,
    slotWidth: CGFloat,
    disabled: Bool,
    colorScheme: String,
    handleSelect: @escaping (Int) -> Void
  ) {
    self.symbolNames = symbolNames
    self.selectedIndex = selectedIndex
    self.buttonHeight = buttonHeight
    self.slotWidth = slotWidth
    self.disabled = disabled
    self.colorScheme = colorScheme
    self.handleSelect = handleSelect
  }
}

@objc(ViewModeGlassControlView)
final class ViewModeGlassControlView: UIView {
  @objc var selectedMode: NSString = "stack" {
    didSet {
      model.selectedMode = selectedMode as String
    }
  }

  @objc var disabled: Bool = false {
    didSet {
      model.disabled = disabled
    }
  }

  @objc var colorScheme: NSString = "dark" {
    didSet {
      model.colorScheme = colorScheme as String
    }
  }

  @objc var onSelect: ((NSDictionary) -> Void)?
  @objc var onOpenChange: ((NSDictionary) -> Void)?

  private lazy var model = ViewModeGlassControlModel(
    selectedMode: selectedMode as String,
    disabled: disabled,
    colorScheme: colorScheme as String,
    handleSelect: { [weak self] mode in
      self?.onSelect?(["mode": mode] as NSDictionary)
    },
    handleOpenChange: { [weak self] open in
      self?.onOpenChange?(["open": open] as NSDictionary)
    }
  )

  private var hostingController: UIHostingController<ViewModeGlassControlRootView>?

  override init(frame: CGRect) {
    super.init(frame: frame)
    setupHostingView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupHostingView()
  }

  private func setupHostingView() {
    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = false

    let controller = UIHostingController(rootView: ViewModeGlassControlRootView(model: model))
    controller.view.backgroundColor = .clear
    controller.view.isOpaque = false
    controller.view.translatesAutoresizingMaskIntoConstraints = false

    addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    hostingController = controller
  }
}

@objc(LiquidCalendarMenuPrototypeView)
final class LiquidCalendarMenuPrototypeView: UIView {
  @objc var selectedMode: NSString = "stack" {
    didSet {
      model.selectedMode = selectedMode as String
    }
  }

  @objc var disabled: Bool = false {
    didSet {
      model.disabled = disabled
    }
  }

  @objc var colorScheme: NSString = "dark" {
    didSet {
      model.colorScheme = colorScheme as String
    }
  }

  @objc var viewModeVariant: NSString = "calendar" {
    didSet {
      model.viewModeVariant = viewModeVariant as String
    }
  }

  @objc var tapRequest: NSNumber = 0 {
    didSet {
      guard tapRequest.intValue != oldValue.intValue else { return }
      model.prototypeTapRequest += 1
    }
  }

  @objc var closeRequest: NSNumber = 0 {
    didSet {
      guard closeRequest.intValue != oldValue.intValue else { return }
      model.prototypeCloseRequest += 1
    }
  }

  @objc var addMenuRequest: NSNumber = 0 {
    didSet {
      guard addMenuRequest.intValue != oldValue.intValue else { return }
      model.prototypeAddMenuRequest += 1
    }
  }

  @objc var quickAddRequest: NSNumber = 0 {
    didSet {
      guard quickAddRequest.intValue != oldValue.intValue else { return }
      model.prototypeQuickAddRequest += 1
    }
  }

  @objc var manualAddRequest: NSNumber = 0 {
    didSet {
      guard manualAddRequest.intValue != oldValue.intValue else { return }
      model.prototypeManualAddRequest += 1
    }
  }

  @objc var searchExpandedWidth: NSNumber = 361 {
    didSet {
      model.searchExpandedWidth = CGFloat(truncating: searchExpandedWidth)
    }
  }

  @objc var searchQuery: NSString = "" {
    didSet {
      model.searchQuery = searchQuery as String
    }
  }

  @objc var onSelect: ((NSDictionary) -> Void)?
  @objc var onOpenChange: ((NSDictionary) -> Void)?
  @objc var onSearch: ((NSDictionary) -> Void)?
  @objc var onSearchTextChange: ((NSDictionary) -> Void)?
  @objc var onSearchClose: ((NSDictionary) -> Void)?
  @objc var onAdd: ((NSDictionary) -> Void)?
  @objc var onQuickAdd: ((NSDictionary) -> Void)?
  @objc var onManualAdd: ((NSDictionary) -> Void)?
  @objc var onManageCategories: ((NSDictionary) -> Void)?

  private lazy var model = ViewModeGlassControlModel(
    selectedMode: selectedMode as String,
    disabled: disabled,
    colorScheme: colorScheme as String,
    viewModeVariant: viewModeVariant as String,
    searchExpandedWidth: CGFloat(truncating: searchExpandedWidth),
    searchQuery: searchQuery as String,
    handleSelect: { [weak self] mode in
      self?.onSelect?(["mode": mode] as NSDictionary)
    },
    handleOpenChange: { [weak self] open in
      self?.prototypeMenuOpen = open
      self?.onOpenChange?(["open": open] as NSDictionary)
    },
    handleSearch: { [weak self] in
      self?.onSearch?([:] as NSDictionary)
    },
    handleSearchTextChange: { [weak self] text in
      self?.onSearchTextChange?(["text": text] as NSDictionary)
    },
    handleSearchClose: { [weak self] in
      self?.onSearchClose?([:] as NSDictionary)
    },
    handleAdd: { [weak self] in
      self?.onAdd?([:] as NSDictionary)
    },
    handleQuickAdd: { [weak self] in
      self?.onQuickAdd?([:] as NSDictionary)
    },
    handleManualAdd: { [weak self] in
      self?.onManualAdd?([:] as NSDictionary)
    },
    handleManageCategories: { [weak self] in
      self?.onManageCategories?([:] as NSDictionary)
    }
  )

  private var hostingController: UIHostingController<LiquidCalendarMenuPrototypeRootView>?
  private var prototypeMenuOpen = false
  private let collapsedHitSize = CGSize(width: 174, height: 58)
  private let collapsedHitPadding = UIEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)

  override init(frame: CGRect) {
    super.init(frame: frame)
    setupHostingView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupHostingView()
  }

  private func setupHostingView() {
    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = false

    let controller = UIHostingController(rootView: LiquidCalendarMenuPrototypeRootView(model: model))
    controller.view.backgroundColor = .clear
    controller.view.isOpaque = false
    controller.view.translatesAutoresizingMaskIntoConstraints = false

    addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    hostingController = controller
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    guard !model.disabled else { return false }

    if prototypeMenuOpen {
      return bounds.contains(point)
    }

    return collapsedHitRect.contains(point)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard !model.disabled else { return nil }

    if !prototypeMenuOpen, !collapsedHitRect.contains(point) {
      return nil
    }

    if !prototypeMenuOpen, collapsedHitRect.contains(point) {
      return super.hitTest(point, with: event) ?? self
    }

    return super.hitTest(point, with: event)
  }

  private var collapsedHitRect: CGRect {
    CGRect(
      x: bounds.maxX - collapsedHitSize.width - collapsedHitPadding.left,
      y: bounds.minY - collapsedHitPadding.top,
      width: collapsedHitSize.width + collapsedHitPadding.left + collapsedHitPadding.right,
      height: collapsedHitSize.height + collapsedHitPadding.top + collapsedHitPadding.bottom
    )
  }
}

@objc(LiquidGlassIconButtonView)
final class LiquidGlassIconButtonView: UIView {
  @objc var symbolName: NSString = "magnifyingglass" {
    didSet {
      model.symbolName = symbolName as String
    }
  }

  @objc var label: NSString = "" {
    didSet {
      model.label = label as String
    }
  }

  @objc var leadingSymbolName: NSString = "" {
    didSet {
      model.leadingSymbolName = leadingSymbolName as String
    }
  }

  @objc var trailingSymbolName: NSString = "" {
    didSet {
      model.trailingSymbolName = trailingSymbolName as String
    }
  }

  @objc var buttonWidth: NSNumber = 58 {
    didSet {
      model.buttonWidth = CGFloat(truncating: buttonWidth)
    }
  }

  @objc var buttonHeight: NSNumber = 58 {
    didSet {
      model.buttonHeight = CGFloat(truncating: buttonHeight)
    }
  }

  @objc var disabled: Bool = false {
    didSet {
      model.disabled = disabled
    }
  }

  @objc var colorScheme: NSString = "dark" {
    didSet {
      model.colorScheme = colorScheme as String
    }
  }

  @objc var onPress: ((NSDictionary) -> Void)?

  private lazy var model = LiquidGlassIconButtonModel(
    symbolName: symbolName as String,
    label: label as String,
    leadingSymbolName: leadingSymbolName as String,
    trailingSymbolName: trailingSymbolName as String,
    buttonWidth: CGFloat(truncating: buttonWidth),
    buttonHeight: CGFloat(truncating: buttonHeight),
    disabled: disabled,
    colorScheme: colorScheme as String,
    handlePress: { [weak self] in
      self?.onPress?([:] as NSDictionary)
    }
  )

  private var hostingController: UIHostingController<LiquidGlassIconButtonRootView>?

  override init(frame: CGRect) {
    super.init(frame: frame)
    setupHostingView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupHostingView()
  }

  private func setupHostingView() {
    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = false

    let controller = UIHostingController(rootView: LiquidGlassIconButtonRootView(model: model))
    controller.view.backgroundColor = .clear
    controller.view.isOpaque = false
    controller.view.translatesAutoresizingMaskIntoConstraints = false

    addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    hostingController = controller
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    guard !model.disabled else { return false }
    return bounds.contains(point)
  }
}

@objc(LiquidGlassSegmentedPillView)
final class LiquidGlassSegmentedPillView: UIView {
  @objc var symbolNames: NSArray = [] {
    didSet {
      model.symbolNames = symbolNames.compactMap { $0 as? String }
    }
  }

  @objc var selectedIndex: NSNumber = -1 {
    didSet {
      model.selectedIndex = selectedIndex.intValue
    }
  }

  @objc var buttonHeight: NSNumber = 44 {
    didSet {
      model.buttonHeight = CGFloat(truncating: buttonHeight)
    }
  }

  @objc var slotWidth: NSNumber = 44 {
    didSet {
      model.slotWidth = CGFloat(truncating: slotWidth)
    }
  }

  @objc var disabled: Bool = false {
    didSet {
      model.disabled = disabled
    }
  }

  @objc var colorScheme: NSString = "dark" {
    didSet {
      model.colorScheme = colorScheme as String
    }
  }

  @objc var onSelect: ((NSDictionary) -> Void)?

  private lazy var model = LiquidGlassSegmentedPillModel(
    symbolNames: symbolNames.compactMap { $0 as? String },
    selectedIndex: selectedIndex.intValue,
    buttonHeight: CGFloat(truncating: buttonHeight),
    slotWidth: CGFloat(truncating: slotWidth),
    disabled: disabled,
    colorScheme: colorScheme as String,
    handleSelect: { [weak self] index in
      self?.onSelect?(["index": index] as NSDictionary)
    }
  )

  private var hostingController: UIHostingController<LiquidGlassSegmentedPillRootView>?

  override init(frame: CGRect) {
    super.init(frame: frame)
    setupHostingView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupHostingView()
  }

  private func setupHostingView() {
    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = false

    let controller = UIHostingController(rootView: LiquidGlassSegmentedPillRootView(model: model))
    controller.view.backgroundColor = .clear
    controller.view.isOpaque = false
    controller.view.translatesAutoresizingMaskIntoConstraints = false

    addSubview(controller.view)
    NSLayoutConstraint.activate([
      controller.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      controller.view.trailingAnchor.constraint(equalTo: trailingAnchor),
      controller.view.topAnchor.constraint(equalTo: topAnchor),
      controller.view.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    hostingController = controller
  }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    guard !model.disabled else { return false }
    return bounds.contains(point)
  }
}

private struct LiquidGlassIconButtonRootView: View {
  @ObservedObject var model: LiquidGlassIconButtonModel

  var body: some View {
    Button {
      guard !model.disabled else { return }
      model.handlePress()
    } label: {
      ZStack {
        surface

        HStack(spacing: contentSpacing) {
          if let leadingSymbol {
            Image(systemName: leadingSymbol)
              .font(.system(size: iconSize(for: leadingSymbol), weight: .regular))
          }

          if !model.label.isEmpty {
            Text(model.label)
              .font(.system(size: 16, weight: .bold))
              .lineLimit(1)
              .minimumScaleFactor(0.78)
          }

          if !model.trailingSymbolName.isEmpty {
            Image(systemName: model.trailingSymbolName)
              .font(.system(size: iconSize(for: model.trailingSymbolName), weight: .regular))
          }
        }
        .foregroundStyle(glyphColor)
        .frame(width: model.buttonWidth, height: model.buttonHeight)
      }
      .frame(width: model.buttonWidth, height: model.buttonHeight)
    }
    .clipShape(RoundedRectangle(cornerRadius: model.buttonHeight / 2, style: .continuous))
    .shadow(color: Color.black.opacity(0.11), radius: 8, x: 0, y: 4)
    .buttonStyle(.plain)
    .disabled(model.disabled)
    .accessibilityLabel(accessibilityLabel)
  }

  @ViewBuilder
  private var surface: some View {
    SharedLiquidGlassPillSurface(
      width: model.buttonWidth,
      height: model.buttonHeight,
      colorScheme: model.colorScheme,
      disabled: model.disabled
    )
  }

  private var liquidHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(model.colorScheme == "dark" ? 0.22 : 0.54),
        Color.white.opacity(model.colorScheme == "dark" ? 0.08 : 0.20),
        Color.black.opacity(model.colorScheme == "dark" ? 0.05 : 0.015),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var buttonGlassFold: some View {
    ZStack {
      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(model.colorScheme == "dark" ? 0.22 : 0.52),
              Color.white.opacity(model.colorScheme == "dark" ? 0.06 : 0.16),
              Color.clear,
            ],
            startPoint: .leading,
            endPoint: .trailing
          )
        )
        .frame(width: max(66, model.buttonWidth * 0.72), height: max(12, model.buttonHeight * 0.28))
        .rotationEffect(.degrees(-10))
        .offset(x: -model.buttonWidth * 0.06, y: -model.buttonHeight * 0.18)
        .blur(radius: 4)
    }
  }

  private var leadingSymbol: String? {
    if !model.leadingSymbolName.isEmpty {
      return model.leadingSymbolName
    }

    if model.label.isEmpty {
      return model.symbolName
    }

    return nil
  }

  private var contentSpacing: CGFloat {
    model.label.isEmpty ? 0 : 8
  }

  private var glyphColor: Color {
    if model.colorScheme == "dark" {
      return Color.white.opacity(model.disabled ? 0.44 : 0.96)
    }

    return Color.black.opacity(model.disabled ? 0.34 : 0.88)
  }

  private var accessibilityLabel: String {
    if !model.label.isEmpty {
      return model.label
    }

    return model.symbolName == "plus" ? "일정 추가" : "일정 검색"
  }

  private func iconSize(for symbolName: String) -> CGFloat {
    switch symbolName {
    case "plus":
      return 22
    case "chevron.left":
      return 20
    default:
      return 22
    }
  }
}

private struct LiquidGlassSegmentedPillRootView: View {
  @ObservedObject var model: LiquidGlassSegmentedPillModel

  private var width: CGFloat {
    max(model.slotWidth, model.slotWidth * CGFloat(max(model.symbolNames.count, 1)))
  }

  var body: some View {
    ZStack {
      surface

      HStack(spacing: 0) {
        ForEach(Array(model.symbolNames.enumerated()), id: \.offset) { index, symbol in
          Button {
            guard !model.disabled else { return }
            model.handleSelect(index)
          } label: {
            Image(systemName: symbol)
              .font(.system(size: iconSize(for: symbol), weight: .regular))
              .foregroundStyle(glyphColor)
              .frame(width: model.slotWidth, height: model.buttonHeight)
              .background(selectedBackground(for: index))
          }
          .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
        }
      }
    }
    .frame(width: width, height: model.buttonHeight)
    .clipShape(RoundedRectangle(cornerRadius: model.buttonHeight / 2, style: .continuous))
    .shadow(color: Color.black.opacity(0.11), radius: 8, x: 0, y: 4)
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder
  private var surface: some View {
    SharedLiquidGlassPillSurface(
      width: width,
      height: model.buttonHeight,
      colorScheme: model.colorScheme,
      disabled: model.disabled
    )
  }

  private var liquidHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(model.colorScheme == "dark" ? 0.24 : 0.50),
        Color.white.opacity(model.colorScheme == "dark" ? 0.08 : 0.16),
        Color.black.opacity(model.colorScheme == "dark" ? 0.05 : 0.025),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var buttonGlassFold: some View {
    ZStack {
      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(model.colorScheme == "dark" ? 0.22 : 0.52),
              Color.white.opacity(model.colorScheme == "dark" ? 0.06 : 0.14),
              Color.clear,
            ],
            startPoint: .leading,
            endPoint: .trailing
          )
        )
        .frame(width: max(74, width * 0.72), height: max(12, model.buttonHeight * 0.28))
        .rotationEffect(.degrees(-10))
        .offset(x: -width * 0.06, y: -model.buttonHeight * 0.18)
        .blur(radius: 4)
    }
  }

  @ViewBuilder
  private func selectedBackground(for index: Int) -> some View {
    if index == model.selectedIndex {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .fill(model.colorScheme == "dark" ? Color.white.opacity(0.13) : Color.black.opacity(0.055))
        .padding(.vertical, 3)
        .padding(.horizontal, 2)
    }
  }

  private var glyphColor: Color {
    if model.colorScheme == "dark" {
      return Color.white.opacity(model.disabled ? 0.44 : 0.96)
    }

    return Color.black.opacity(model.disabled ? 0.34 : 0.88)
  }

  private func iconSize(for symbolName: String) -> CGFloat {
    switch symbolName {
    case "plus":
      return 22
    case "calendar":
      return 22
    default:
      return 21
    }
  }
}

private struct SharedLiquidGlassPillSurface: View {
  let width: CGFloat
  let height: CGFloat
  let colorScheme: String
  let disabled: Bool

  private var isDarkMode: Bool {
    colorScheme == "dark"
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: height / 2, style: .continuous)

    ZStack {
      if #available(iOS 26.0, *) {
        shape
          .fill(surfaceBaseFill)
          .frame(width: width, height: height)
          .glassEffect(
            .regular
              .tint(surfaceNativeTint)
              .interactive(!disabled),
            in: shape
          )
      } else {
        shape
          .fill(fallbackLiquidFill)
          .frame(width: width, height: height)
      }

      liquidHighlight
        .clipShape(shape)

      liquidCausticLayer
        .clipShape(shape)

      liquidRefractionLayer
        .opacity(isDarkMode ? 0.34 : 0.52)
        .clipShape(shape)

      shape
        .stroke(strokeColor, lineWidth: 1)
        .frame(width: width, height: height)
    }
    .frame(width: width, height: height)
    .clipShape(RoundedRectangle(cornerRadius: height / 2, style: .continuous))
  }

  private var surfaceBaseFill: Color {
    isDarkMode ? Color.white.opacity(0.022) : Color.white.opacity(0.063)
  }

  private var surfaceNativeTint: Color {
    isDarkMode ? Color.black.opacity(0.27) : Color.white.opacity(0.032)
  }

  private var strokeColor: Color {
    isDarkMode ? Color.white.opacity(0.108) : Color.white.opacity(0.56)
  }

  private var liquidHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(isDarkMode ? 0.065 : 0.49),
        Color.white.opacity(isDarkMode ? 0.022 : 0.18),
        Color.black.opacity(isDarkMode ? 0.108 : 0.014),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var liquidCausticLayer: some View {
    ZStack {
      LinearGradient(
        colors: [
          Color.white.opacity(isDarkMode ? 0.034 : 0.56),
          Color.white.opacity(isDarkMode ? 0.011 : 0.216),
          Color.clear,
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.077 : 0.68),
              Color.white.opacity(isDarkMode ? 0.022 : 0.27),
              Color.clear,
            ],
            startPoint: .leading,
            endPoint: .trailing
          )
        )
        .frame(width: max(90, width * 0.72), height: max(18, height * 0.12))
        .rotationEffect(.degrees(-10))
        .offset(x: -width * 0.08, y: -height * 0.27)
        .blur(radius: 5)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.clear,
              Color.black.opacity(isDarkMode ? 0.216 : 0.063),
              Color.white.opacity(isDarkMode ? 0.022 : 0.27),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: max(84, width * 0.58), height: max(16, height * 0.10))
        .rotationEffect(.degrees(-14))
        .offset(x: width * 0.18, y: height * 0.23)
        .blur(radius: 7)
    }
    .frame(width: width, height: height)
  }

  private var liquidRefractionLayer: some View {
    ZStack {
      RoundedRectangle(cornerRadius: height / 2, style: .continuous)
        .stroke(refractionStroke, lineWidth: 1.35)

      RoundedRectangle(cornerRadius: max(18, height / 2 - 8), style: .continuous)
        .stroke(Color.white.opacity(isDarkMode ? 0.05 : 0.38), lineWidth: 1.1)
        .padding(.horizontal, 7)
        .padding(.vertical, 7)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.065 : 0.52),
              Color.white.opacity(isDarkMode ? 0.022 : 0.20),
              Color.clear,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: max(72, width * 0.62), height: max(20, height * 0.13))
        .rotationEffect(.degrees(-8))
        .offset(x: -width * 0.14, y: -height * 0.31)
        .blur(radius: 6)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.clear,
              Color.black.opacity(isDarkMode ? 0.20 : 0.054),
              Color.white.opacity(isDarkMode ? 0.018 : 0.18),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: max(72, width * 0.52), height: max(20, height * 0.11))
        .rotationEffect(.degrees(-12))
        .offset(x: width * 0.18, y: height * 0.22)
        .blur(radius: 9)
    }
    .frame(width: width, height: height)
  }

  private var refractionStroke: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(isDarkMode ? 0.108 : 0.77),
        Color.white.opacity(isDarkMode ? 0.036 : 0.31),
        Color.black.opacity(isDarkMode ? 0.216 : 0.068),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var fallbackLiquidFill: LinearGradient {
    LinearGradient(
      colors: isDarkMode ? [
        Color.white.opacity(0.072),
        Color.black.opacity(0.72),
      ] : [
        Color.white.opacity(0.78),
        Color.white.opacity(0.52),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

private struct ViewModeGlassControlRootView: View {
  @ObservedObject var model: ViewModeGlassControlModel

  @Namespace private var glassNamespace
  @State private var isOpen = false
  @State private var contrastVisible = false
  @State private var contentVisible = false

  private let collapsedWidth: CGFloat = 86
  private let collapsedHeight: CGFloat = 58
  private let expandedWidth: CGFloat = 292
  private let expandedHeight: CGFloat = 296
  private let collapsedRadius: CGFloat = 29
  private let expandedRadius: CGFloat = 32
  private let surfaceID = "view-mode-glass-control-surface"

  private let options: [ViewModeGlassOption] = [
    ViewModeGlassOption(id: "compact", label: "축소형"),
    ViewModeGlassOption(id: "stack", label: "스택형"),
    ViewModeGlassOption(id: "detail", label: "상세형"),
    ViewModeGlassOption(id: "list", label: "목록형"),
  ]

  var body: some View {
    ZStack(alignment: .topTrailing) {
      if #available(iOS 26.0, *) {
        nativeGlassControl
      } else {
        fallbackGlassControl
      }
    }
    .frame(width: expandedWidth, height: expandedHeight, alignment: .topTrailing)
    .accessibilityElement(children: .contain)
  }

  @available(iOS 26.0, *)
  private var nativeGlassControl: some View {
    ZStack(alignment: .topTrailing) {
      GlassEffectContainer(spacing: 0) {
        if isOpen {
          expandedGlassSurface
            .glassEffectID(surfaceID, in: glassNamespace)
            .glassEffectTransition(.matchedGeometry)
            .matchedGeometryEffect(
              id: surfaceID,
              in: glassNamespace,
              properties: .frame,
              anchor: .topTrailing
            )
        } else {
          collapsedGlassSurface
            .glassEffectID(surfaceID, in: glassNamespace)
            .glassEffectTransition(.matchedGeometry)
            .matchedGeometryEffect(
              id: surfaceID,
              in: glassNamespace,
              properties: .frame,
              anchor: .topTrailing
            )
        }
      }
      .frame(width: expandedWidth, height: expandedHeight, alignment: .topTrailing)
      .allowsHitTesting(false)

      if isOpen {
        expandedReadabilityLayer
          .frame(width: expandedWidth, height: expandedHeight)
          .opacity(contrastVisible ? 1 : 0)
          .animation(.easeOut(duration: 0.18), value: contrastVisible)
          .allowsHitTesting(false)

        expandedContent
          .frame(width: expandedWidth, height: expandedHeight)
          .opacity(contentVisible ? 1 : 0)
          .offset(y: contentVisible ? 0 : -8)
          .scaleEffect(contentVisible ? 1 : 0.98, anchor: .topTrailing)
          .animation(.easeOut(duration: 0.22), value: contentVisible)
      } else {
        collapsedButtonContent
          .frame(width: collapsedWidth, height: collapsedHeight)
          .opacity(model.disabled ? 0.42 : 1)
          .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .topTrailing)))
      }
    }
    .frame(width: expandedWidth, height: expandedHeight, alignment: .topTrailing)
  }

  @available(iOS 26.0, *)
  private var collapsedGlassSurface: some View {
    RoundedRectangle(cornerRadius: collapsedRadius, style: .continuous)
      .fill(Color.white.opacity(0.08))
      .frame(width: collapsedWidth, height: collapsedHeight)
      .glassEffect(
        .regular
          .tint(Color.black.opacity(0.1))
          .interactive(!model.disabled),
        in: RoundedRectangle(cornerRadius: collapsedRadius, style: .continuous)
      )
      .overlay(
        RoundedRectangle(cornerRadius: collapsedRadius, style: .continuous)
          .fill(collapsedHighlight)
      )
      .overlay(
        RoundedRectangle(cornerRadius: collapsedRadius, style: .continuous)
          .stroke(Color.white.opacity(0.24), lineWidth: 1)
      )
      .shadow(color: Color.black.opacity(0.24), radius: 16, x: 0, y: 10)
  }

  @available(iOS 26.0, *)
  private var expandedGlassSurface: some View {
    RoundedRectangle(cornerRadius: expandedRadius, style: .continuous)
      .fill(Color.white.opacity(0.025))
      .frame(width: expandedWidth, height: expandedHeight)
      .glassEffect(
        .regular
          .tint(Color.black.opacity(0.08))
          .interactive(),
        in: RoundedRectangle(cornerRadius: expandedRadius, style: .continuous)
      )
      .overlay(
        RoundedRectangle(cornerRadius: expandedRadius, style: .continuous)
          .fill(expandedHighlight)
      )
      .overlay(
        RoundedRectangle(cornerRadius: expandedRadius, style: .continuous)
          .stroke(Color.white.opacity(0.16), lineWidth: 1)
      )
      .shadow(color: Color.black.opacity(0.12), radius: 18, x: 0, y: 12)
  }

  @available(iOS 26.0, *)
  private var expandedReadabilityLayer: some View {
    RoundedRectangle(cornerRadius: expandedRadius, style: .continuous)
      .fill(Color.black.opacity(0.26))
      .overlay(
        RoundedRectangle(cornerRadius: expandedRadius, style: .continuous)
          .fill(expandedContrastGradient)
      )
      .shadow(color: Color.black.opacity(0.26), radius: 24, x: 0, y: 18)
  }

  private var fallbackGlassControl: some View {
    ZStack(alignment: .topTrailing) {
      RoundedRectangle(cornerRadius: isOpen ? expandedRadius : collapsedRadius, style: .continuous)
        .fill(isOpen ? fallbackExpandedFill : fallbackCollapsedFill)
        .frame(
          width: isOpen ? expandedWidth : collapsedWidth,
          height: isOpen ? expandedHeight : collapsedHeight
        )
        .overlay(
          RoundedRectangle(cornerRadius: isOpen ? expandedRadius : collapsedRadius, style: .continuous)
            .stroke(Color.white.opacity(isOpen ? 0.22 : 0.24), lineWidth: 1)
        )
        .shadow(
          color: Color.black.opacity(isOpen ? 0.34 : 0.24),
          radius: isOpen ? 28 : 16,
          x: 0,
          y: isOpen ? 20 : 10
        )
        .animation(.spring(response: 0.42, dampingFraction: 0.88), value: isOpen)

      if isOpen {
        expandedContent
          .frame(width: expandedWidth, height: expandedHeight)
          .opacity(contentVisible ? 1 : 0)
          .offset(y: contentVisible ? 0 : -8)
          .animation(.easeOut(duration: 0.2), value: contentVisible)
      } else {
        collapsedButtonContent
          .frame(width: collapsedWidth, height: collapsedHeight)
          .opacity(model.disabled ? 0.42 : 1)
      }
    }
    .frame(width: expandedWidth, height: expandedHeight, alignment: .topTrailing)
  }

  private var collapsedButtonContent: some View {
    Button {
      guard !model.disabled else { return }
      openMenu()
    } label: {
      HStack(spacing: 0) {
        modeGlyph(for: model.selectedMode)
          .frame(width: 32, height: 32)
      }
      .frame(width: collapsedWidth, height: collapsedHeight)
      .contentShape(RoundedRectangle(cornerRadius: collapsedRadius, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("View mode")
    .accessibilityHint("Opens the view mode menu")
  }

  private var expandedContent: some View {
    VStack(spacing: 5) {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text("보기 방식")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.74))

          Text(selectedLabel)
            .font(.system(size: 18, weight: .bold))
            .foregroundStyle(Color.white)
        }

        Spacer()

        Button {
          closeMenu(notify: true)
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(Color.white.opacity(0.94))
            .frame(width: 34, height: 34)
            .background(Circle().fill(Color.white.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close view mode menu")
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 7)

      ForEach(options) { option in
        Button {
          selectMode(option.id)
        } label: {
          ViewModeGlassRow(
            label: option.label,
            selected: option.id == model.selectedMode
          )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }

  private var selectedLabel: String {
    options.first(where: { $0.id == model.selectedMode })?.label ?? "스택형"
  }

  private var collapsedHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(0.22),
        Color.white.opacity(0.08),
        Color.black.opacity(0.06),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var expandedHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(0.1),
        Color.white.opacity(0.035),
        Color.black.opacity(0.04),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var expandedContrastGradient: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(0.035),
        Color.black.opacity(0.06),
        Color.black.opacity(0.16),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var fallbackCollapsedFill: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(0.2),
        Color.black.opacity(0.54),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var fallbackExpandedFill: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(0.15),
        Color.black.opacity(0.78),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private func openMenu() {
    guard !isOpen else { return }
    contrastVisible = false
    contentVisible = false

    withAnimation(.spring(response: 0.44, dampingFraction: 0.88)) {
      isOpen = true
    }
    model.handleOpenChange(true)

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      guard isOpen else { return }
      withAnimation(.easeOut(duration: 0.18)) {
        contrastVisible = true
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.42) {
      guard isOpen else { return }
      withAnimation(.easeOut(duration: 0.22)) {
        contentVisible = true
      }
    }
  }

  private func closeMenu(notify: Bool) {
    guard isOpen else { return }

    withAnimation(.easeInOut(duration: 0.14)) {
      contentVisible = false
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
      withAnimation(.easeInOut(duration: 0.16)) {
        contrastVisible = false
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
      withAnimation(.spring(response: 0.34, dampingFraction: 0.9)) {
        isOpen = false
      }
      if notify {
        model.handleOpenChange(false)
      }
    }
  }

  private func selectMode(_ mode: String) {
    model.selectedMode = mode
    model.handleSelect(mode)
    closeMenu(notify: true)
  }

  @ViewBuilder
  private func modeGlyph(for mode: String) -> some View {
    switch mode {
    case "compact":
      VStack(spacing: 4) {
        Capsule().fill(Color.white.opacity(0.94)).frame(width: 24, height: 4)
        HStack(spacing: 4) {
          Capsule().fill(Color.white.opacity(0.94)).frame(width: 4, height: 12)
          Capsule().fill(Color.white.opacity(0.94)).frame(width: 4, height: 12)
          Capsule().fill(Color.white.opacity(0.94)).frame(width: 4, height: 12)
        }
      }
    case "detail":
      VStack(spacing: 5) {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(Color.white.opacity(0.94), lineWidth: 3)
          .frame(width: 25, height: 8)
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(Color.white.opacity(0.94), lineWidth: 3)
          .frame(width: 25, height: 8)
          .overlay(alignment: .center) {
            Capsule().fill(Color.white.opacity(0.94)).frame(width: 12, height: 2)
          }
      }
    case "list":
      VStack(alignment: .leading, spacing: 5) {
        glyphListRow(width: 24)
        glyphListRow(width: 24)
        glyphListRow(width: 18)
      }
    default:
      VStack(spacing: 5) {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(Color.white.opacity(0.94), lineWidth: 3)
          .frame(width: 26, height: 9)
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(Color.white.opacity(0.94), lineWidth: 3)
          .frame(width: 26, height: 9)
      }
    }
  }

  private func glyphListRow(width: CGFloat) -> some View {
    HStack(spacing: 4) {
      Circle().fill(Color.white.opacity(0.94)).frame(width: 4, height: 4)
      Capsule().fill(Color.white.opacity(0.94)).frame(width: width, height: 3)
    }
  }
}

private struct LiquidCalendarMenuPrototypeRootView: View {
  private enum Phase {
    case collapsed
    case expanding
    case expanded
    case closing
  }

  private enum MenuAction: Equatable {
    case view
    case search
    case add
  }

  @ObservedObject var model: ViewModeGlassControlModel

  @State private var phase: Phase = .collapsed
  @State private var activeAction: MenuAction = .view
  @State private var morphProgress: CGFloat = 0
  @State private var readabilityVisible = false
  @State private var contentVisible = false
  @State private var collapsedContentVisible = true
  @State private var addHandoffContentSuppressed = false
  @FocusState private var searchFocused: Bool

  private let collapsedWidth: CGFloat = 150
  private let collapsedHeight: CGFloat = 44
  private let collapsedSlotWidth: CGFloat = 50
  private let viewExpandedWidth: CGFloat = 238
  private let addExpandedWidth: CGFloat = 238
  private let addExpandedHeight: CGFloat = 164
  private let collapsedRadius: CGFloat = 22
  private let expandedRadius: CGFloat = 26

  private let calendarOptions: [ViewModeGlassOption] = [
    ViewModeGlassOption(id: "compact", label: "축소형"),
    ViewModeGlassOption(id: "stack", label: "스택형"),
    ViewModeGlassOption(id: "detail", label: "상세형"),
    ViewModeGlassOption(id: "list", label: "목록형"),
  ]
  private let timelineOptions: [ViewModeGlassOption] = [
    ViewModeGlassOption(id: "multi", label: "여러 날"),
    ViewModeGlassOption(id: "day", label: "하루"),
  ]

  var body: some View {
    ZStack(alignment: .topTrailing) {
      if #available(iOS 26.0, *) {
        nativeLiquidMenu
      } else {
        fallbackLiquidMenu
      }

      fixedCollapsedContentOverlay
    }
    .frame(width: rootWidth, height: rootHeight, alignment: .topTrailing)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
    .accessibilityElement(children: .contain)
    .onChange(of: model.prototypeTapRequest) { _ in
      guard phase == .collapsed else { return }
      openMenu(.view)
    }
    .onChange(of: model.prototypeCloseRequest) { _ in
      closeOrResetMenu()
    }
    .onChange(of: model.prototypeAddMenuRequest) { _ in
      guard phase == .collapsed else { return }
      openMenu(.add)
    }
    .onChange(of: model.prototypeQuickAddRequest) { _ in
      triggerRequestedAddAction(.quick)
    }
    .onChange(of: model.prototypeManualAddRequest) { _ in
      triggerRequestedAddAction(.manual)
    }
  }

  @available(iOS 26.0, *)
  private var nativeLiquidMenu: some View {
    ZStack(alignment: .topTrailing) {
      liquidMenuObject(nativeSurface: true)
    }
    .frame(width: rootWidth, height: rootHeight, alignment: .topTrailing)
  }

  private var fallbackLiquidMenu: some View {
    liquidMenuObject(nativeSurface: false)
      .frame(width: rootWidth, height: rootHeight, alignment: .topTrailing)
  }

  @ViewBuilder
  private func liquidMenuObject(nativeSurface: Bool) -> some View {
    ZStack(alignment: .topTrailing) {
      if nativeSurface {
        if #available(iOS 26.0, *) {
          nativeLiquidSurface
        } else {
          fallbackLiquidSurface
        }
      } else {
        fallbackLiquidSurface
      }

      readabilityLayer
        .opacity(readabilityVisible ? 1 : 0)
        .animation(.easeOut(duration: 0.16), value: readabilityVisible)
        .allowsHitTesting(false)

      liquidRefractionLayer
        .opacity(refractionOpacity)
        .animation(.easeOut(duration: 0.18), value: readabilityVisible)
        .allowsHitTesting(false)

      expandedContent
        .frame(width: surfaceWidth, height: surfaceHeight)
        .opacity(expandedContentOpacity)
        .offset(y: expandedContentOffsetY)
        .scaleEffect(expandedContentScale, anchor: .topTrailing)
        .animation(.easeOut(duration: 0.22), value: contentVisible)
        .animation(.easeOut(duration: 0.18), value: morphProgress)
        .allowsHitTesting(phase == .expanded)
    }
    .frame(width: surfaceWidth, height: surfaceHeight, alignment: .topTrailing)
    .clipShape(liquidShape)
    .contentShape(liquidShape)
    .shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowYOffset)
    .animation(.interactiveSpring(response: 0.5, dampingFraction: 0.94, blendDuration: 0.06), value: morphProgress)
    .accessibilityLabel(phase == .collapsed ? "View mode" : "View mode menu")
    .accessibilityHint(phase == .collapsed ? "Opens the view mode menu" : "Choose a view mode")
  }

  private var fixedCollapsedContentOverlay: some View {
      collapsedContent
        .frame(width: collapsedWidth, height: collapsedHeight)
        .opacity(collapsedContentOpacity)
        .blur(radius: collapsedContentBlur)
      .animation(.easeOut(duration: collapsedContentFadeDuration), value: collapsedContentVisible)
      .allowsHitTesting(phase == .collapsed)
      .frame(width: rootWidth, height: rootHeight, alignment: .topTrailing)
      .zIndex(10)
  }

  @available(iOS 26.0, *)
  private var nativeLiquidSurface: some View {
    liquidShape
      .fill(surfaceBaseFill)
      .frame(width: surfaceWidth, height: surfaceHeight)
      .glassEffect(
        .regular
          .tint(surfaceNativeTint)
          .interactive(!model.disabled),
        in: liquidShape
      )
      .overlay(liquidHighlight)
      .overlay(liquidCausticLayer)
      .overlay(liquidStroke)
  }

  private var fallbackLiquidSurface: some View {
    liquidShape
      .fill(fallbackLiquidFill)
      .frame(width: surfaceWidth, height: surfaceHeight)
      .overlay(liquidHighlight)
      .overlay(liquidCausticLayer)
      .overlay(liquidStroke)
  }

  private var readabilityLayer: some View {
    liquidShape
      .fill(readabilityFill)
      .overlay(
        LinearGradient(
          colors: readabilityGradientColors,
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .frame(width: surfaceWidth, height: surfaceHeight)
  }

  private var liquidRefractionLayer: some View {
    ZStack {
      liquidShape
        .stroke(refractionStroke, lineWidth: 1.35)

      RoundedRectangle(cornerRadius: max(18, surfaceRadius - 8), style: .continuous)
        .stroke(Color.white.opacity(isDarkMode ? 0.05 : 0.38), lineWidth: 1.1)
        .padding(.horizontal, 7)
        .padding(.vertical, 7)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.09 : 0.52),
              Color.white.opacity(isDarkMode ? 0.029 : 0.20),
              Color.clear,
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: max(72, surfaceWidth * 0.62), height: max(20, surfaceHeight * 0.13))
        .rotationEffect(.degrees(-8))
        .offset(x: -surfaceWidth * 0.14, y: -surfaceHeight * 0.31)
        .blur(radius: 6)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.clear,
              Color.black.opacity(isDarkMode ? 0.144 : 0.054),
              Color.white.opacity(isDarkMode ? 0.025 : 0.18),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: max(72, surfaceWidth * 0.52), height: max(20, surfaceHeight * 0.11))
        .rotationEffect(.degrees(-12))
        .offset(x: surfaceWidth * 0.18, y: surfaceHeight * 0.22)
        .blur(radius: 9)
    }
    .frame(width: surfaceWidth, height: surfaceHeight)
    .clipShape(liquidShape)
  }

  private var liquidCausticLayer: some View {
    ZStack {
      LinearGradient(
        colors: [
          Color.white.opacity(isDarkMode ? 0.034 : 0.56),
          Color.white.opacity(isDarkMode ? 0.011 : 0.216),
          Color.clear,
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.077 : 0.68),
              Color.white.opacity(isDarkMode ? 0.022 : 0.27),
              Color.clear,
            ],
            startPoint: .leading,
            endPoint: .trailing
          )
        )
        .frame(width: max(90, surfaceWidth * 0.72), height: max(18, surfaceHeight * 0.12))
        .rotationEffect(.degrees(-10))
        .offset(x: -surfaceWidth * 0.08, y: -surfaceHeight * 0.27)
        .blur(radius: 5)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.clear,
              Color.black.opacity(isDarkMode ? 0.216 : 0.063),
              Color.white.opacity(isDarkMode ? 0.022 : 0.27),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: max(84, surfaceWidth * 0.58), height: max(16, surfaceHeight * 0.10))
        .rotationEffect(.degrees(-14))
        .offset(x: surfaceWidth * 0.18, y: surfaceHeight * 0.23)
        .blur(radius: 7)
    }
    .opacity(activeAction == .search ? 0.74 : 1)
    .frame(width: surfaceWidth, height: surfaceHeight)
    .clipShape(liquidShape)
    .allowsHitTesting(false)
  }

  private var collapsedContent: some View {
    HStack(spacing: 0) {
      Button {
        openMenu(.view)
      } label: {
        prototypeModeGlyph(for: model.selectedMode, color: collapsedGlyphColor)
          .frame(width: 25, height: 25)
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
      }
      .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
      .accessibilityLabel("보기 방식")
      .accessibilityHint("보기 방식 메뉴 열기")

      Button {
        guard !model.disabled else { return }
        openMenu(.search)
      } label: {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 23, weight: .regular))
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
      }
      .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
      .accessibilityLabel("일정 검색")

      Button {
        openMenu(.add)
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 25, weight: .regular))
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
      }
      .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
      .accessibilityLabel("일정 추가")
    }
    .foregroundStyle(collapsedGlyphColor)
    .frame(width: collapsedWidth, height: collapsedHeight)
  }

  private var collapsedGlyphColor: Color {
    if isDarkMode {
      return Color.white.opacity(model.disabled ? 0.44 : 0.96)
    }

    return Color.black.opacity(model.disabled ? 0.34 : 0.88)
  }

  private var isDarkMode: Bool {
    model.colorScheme == "dark"
  }

  private var isTimelineVariant: Bool {
    model.viewModeVariant == "timeline"
  }

  private var options: [ViewModeGlassOption] {
    isTimelineVariant ? timelineOptions : calendarOptions
  }

  private var viewExpandedHeight: CGFloat {
    isTimelineVariant ? 116 : 212
  }

  private var expandedPrimaryColor: Color {
    isDarkMode ? Color.white.opacity(0.96) : Color.black.opacity(0.88)
  }

  private var expandedSecondaryColor: Color {
    isDarkMode ? Color.white.opacity(0.6) : Color.black.opacity(0.54)
  }

  private var expandedControlFill: Color {
    isDarkMode ? Color.white.opacity(0.12) : Color.black.opacity(0.055)
  }

  private var expandedRowFill: Color {
    isDarkMode ? Color.white.opacity(0.08) : Color.black.opacity(0.04)
  }

  private var expandedRowTint: Color {
    isDarkMode ? Color.white.opacity(0.14) : Color.white.opacity(0.22)
  }

  private var expandedRowStroke: Color {
    isDarkMode ? Color.white.opacity(0.16) : Color.black.opacity(0.055)
  }

  private var surfaceBaseFill: Color {
    if isDarkMode {
      return Color.white.opacity(Double(interpolate(from: 0.022, to: 0.016, amount: surfaceToneProgress)))
    }

    return Color.white.opacity(Double(interpolate(from: 0.063, to: 0.099, amount: surfaceToneProgress)))
  }

  private var surfaceNativeTint: Color {
    if isDarkMode {
      return Color.black.opacity(Double(interpolate(from: 0.27, to: 0.324, amount: surfaceToneProgress)))
    }

    return Color.white.opacity(Double(interpolate(from: 0.032, to: 0.072, amount: surfaceToneProgress)))
  }

  private var readabilityFill: Color {
    isDarkMode ? Color.black.opacity(0.144) : Color.white.opacity(0.041)
  }

  private var readabilityGradientColors: [Color] {
    if isDarkMode {
      return [
        Color.white.opacity(0.029),
        Color.black.opacity(0.032),
        Color.black.opacity(0.099),
      ]
    }

    return [
      Color.white.opacity(0.09),
      Color.white.opacity(0.032),
      Color.black.opacity(0.011),
    ]
  }

  private var refractionOpacity: Double {
    let base = isDarkMode ? 0.34 : 0.9
    let progress = activeAction == .search ? widthProgress : finalProgress
    return base * Double(0.58 + progress * 0.42)
  }

  private var refractionStroke: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(isDarkMode ? 0.108 : 0.77),
        Color.white.opacity(isDarkMode ? 0.036 : 0.31),
        Color.black.opacity(isDarkMode ? 0.216 : 0.068),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  @ViewBuilder
  private var expandedContent: some View {
    switch activeAction {
    case .view:
      viewModeExpandedContent
    case .search:
      searchExpandedContent
    case .add:
      addExpandedContent
    }
  }

  private var viewModeExpandedContent: some View {
    VStack(spacing: 4) {
      ForEach(options) { option in
        let selected = option.id == model.selectedMode

        Button {
          selectMode(option.id)
        } label: {
          ViewModeGlassRow(
            mode: option.id,
            label: option.label,
            selected: selected,
            foregroundColor: expandedPrimaryColor,
            selectedFill: expandedRowFill,
            selectedTint: expandedRowTint,
            selectedStroke: expandedRowStroke,
            showsSelectionIndicator: false
          )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }

  private var legacyViewModeExpandedContent: some View {
    VStack(spacing: 6) {
      ForEach(options) { option in
        Button {
          selectMode(option.id)
        } label: {
          ViewModeGlassRow(
            mode: option.id,
            label: option.label,
            selected: option.id == model.selectedMode,
            foregroundColor: expandedPrimaryColor,
            selectedFill: expandedRowFill,
            selectedTint: expandedRowTint,
            selectedStroke: expandedRowStroke,
            showsSelectionIndicator: false
          )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }

  private var iconOnlyViewModeExpandedContent: some View {
    VStack(spacing: 8) {
      HStack(spacing: 0) {
        Spacer()

        Button {
          closeMenu()
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(expandedPrimaryColor)
            .frame(width: 30, height: 30)
            .background(Circle().fill(expandedControlFill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("보기 방식 메뉴 닫기")
      }
      .padding(.horizontal, 8)
      .padding(.top, 4)

      HStack(spacing: 8) {
        ForEach(options) { option in
          let selected = option.id == model.selectedMode

          Button {
            selectMode(option.id)
          } label: {
            ViewModeIconChoice(
              mode: option.id,
              selected: selected,
              foregroundColor: expandedPrimaryColor,
              selectedFill: expandedRowFill,
              selectedTint: expandedRowTint,
              selectedStroke: expandedRowStroke
            )
          }
          .buttonStyle(.plain)
          .accessibilityLabel(option.label)
        }
      }
      .padding(.horizontal, 12)
      .padding(.bottom, 12)
    }
  }

  private var searchExpandedContent: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 18, weight: .bold))
        .foregroundStyle(collapsedGlyphColor.opacity(0.92))

      TextField(
        "검색",
        text: Binding(
          get: { model.searchQuery },
          set: { newValue in
            model.searchQuery = newValue
            model.handleSearchTextChange(newValue)
          }
        )
      )
      .focused($searchFocused)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled(true)
      .font(.system(size: 16, weight: .semibold))
      .foregroundStyle(collapsedGlyphColor)
      .tint(collapsedGlyphColor)

      if !model.searchQuery.isEmpty {
        Button {
          model.searchQuery = ""
          model.handleSearchTextChange("")
        } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 19, weight: .semibold))
            .foregroundStyle(collapsedGlyphColor.opacity(0.54))
            .frame(width: 30, height: 34)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("검색어 지우기")
      }

      Button {
        model.searchQuery = ""
        model.handleSearchTextChange("")
        model.handleSearchClose()
        closeMenu()
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 16, weight: .bold))
          .foregroundStyle(collapsedGlyphColor.opacity(0.92))
          .frame(width: 34, height: 34)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("검색 닫기")
    }
    .padding(.leading, 18)
    .padding(.trailing, 12)
    .frame(width: surfaceWidth, height: collapsedHeight)
  }

  private var addExpandedContent: some View {
    VStack(spacing: 4) {
      addActionRow(
        icon: "bolt",
        title: "빠른 생성",
        action: triggerQuickAddAction,
        closesAfterAction: false
      )

      addActionRow(
        icon: "square.and.pencil",
        title: "직접 입력",
        action: triggerManualAddAction,
        closesAfterAction: false
      )

      addActionRow(
        icon: "tag",
        title: "카테고리 관리",
        action: model.handleManageCategories
      )
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }

  private func addActionRow(
    icon: String,
    title: String,
    action: @escaping () -> Void,
    closesAfterAction: Bool = true
  ) -> some View {
    Button {
      if closesAfterAction {
        triggerAddAction(action)
      } else {
        action()
      }
    } label: {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .font(.system(size: 17, weight: .semibold))
          .frame(width: 26, height: 26)
          .frame(width: 32)

        Text(title)
          .font(.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity, alignment: .leading)

        Spacer()
      }
      .padding(.horizontal, 12)
      .foregroundStyle(expandedPrimaryColor)
      .frame(height: 43)
      .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }

  private var selectedLabel: String {
    options.first(where: { $0.id == model.selectedMode })?.label ?? "스택형"
  }

  private var surfaceWidth: CGFloat {
    collapsedWidth + (targetExpandedWidth - collapsedWidth) * widthProgress
  }

  private var surfaceHeight: CGFloat {
    collapsedHeight + (targetExpandedHeight - collapsedHeight) * heightProgress
  }

  private var surfaceRadius: CGFloat {
    let radiusProgress = smoothstep(edge0: 0.18, edge1: 0.88, x: morphProgress)
    return collapsedRadius + (expandedRadius - collapsedRadius) * radiusProgress
  }

  private var collapsedContentOpacity: Double {
    guard phase == .collapsed || phase == .expanding || phase == .closing else { return 0 }
    return (collapsedContentVisible ? 1 : 0) * (model.disabled ? 0.42 : 1)
  }

  private var collapsedContentBlur: CGFloat {
    0
  }

  private var collapsedContentFadeDuration: Double {
    activeAction == .search && phase == .expanding ? 0.1 : 0.16
  }

  private var expandedContentReveal: CGFloat {
    if activeAction == .add, addHandoffContentSuppressed {
      return 0
    }

    switch phase {
    case .collapsed:
      return 0
    case .closing:
      return contentVisible ? 1 : 0
    case .expanding, .expanded:
      return contentVisible ? 1 : 0
    }
  }

  private var expandedContentOpacity: Double {
    Double(expandedContentReveal)
  }

  private var expandedContentOffsetY: CGFloat {
    activeAction == .search ? 0 : -8 * (1 - expandedContentReveal)
  }

  private var expandedContentScale: CGFloat {
    0.985 + 0.015 * expandedContentReveal
  }

  private var shadowColor: Color {
    Color.black.opacity(0.11 + 0.09 * Double(finalProgress))
  }

  private var shadowRadius: CGFloat {
    8 + 16 * finalProgress
  }

  private var shadowYOffset: CGFloat {
    4 + 13 * finalProgress
  }

  private var surfaceToneProgress: CGFloat {
    smoothstep(edge0: 0.74, edge1: 1, x: morphProgress)
  }

  private var widthProgress: CGFloat {
    if activeAction == .search {
      return smoothstep(edge0: 0.0, edge1: 0.72, x: morphProgress)
    }

    let earlyStretch = smoothstep(edge0: 0.0, edge1: 0.52, x: morphProgress)
    let finalSettle = smoothstep(edge0: 0.52, edge1: 0.92, x: morphProgress)
    return min(1, earlyStretch * 0.82 + finalSettle * 0.18)
  }

  private var heightProgress: CGFloat {
    if activeAction == .search {
      return 0
    }

    let earlyLift = smoothstep(edge0: 0.1, edge1: 0.36, x: morphProgress)
    let bodyGrowth = smoothstep(edge0: 0.24, edge1: 0.88, x: morphProgress)
    return min(1, earlyLift * 0.2 + bodyGrowth * 0.8)
  }

  private var rootWidth: CGFloat {
    max(collapsedWidth, surfaceWidth)
  }

  private var rootHeight: CGFloat {
    max(addExpandedHeight, viewExpandedHeight)
  }

  private var targetExpandedWidth: CGFloat {
    switch activeAction {
    case .search:
      return max(collapsedWidth, model.searchExpandedWidth)
    case .view:
      return viewExpandedWidth
    case .add:
      return addExpandedWidth
    }
  }

  private var targetExpandedHeight: CGFloat {
    switch activeAction {
    case .search:
      return collapsedHeight
    case .view:
      return viewExpandedHeight
    case .add:
      return addExpandedHeight
    }
  }

  private var finalProgress: CGFloat {
    smoothstep(edge0: 0.78, edge1: 1, x: morphProgress)
  }

  private var liquidHighlight: LinearGradient {
    let colors = isDarkMode ? [
      Color.white.opacity(Double(interpolate(from: 0.065, to: 0.041, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.022, to: 0.016, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.108, to: 0.144, amount: surfaceToneProgress))),
    ] : [
      Color.white.opacity(Double(interpolate(from: 0.49, to: 0.40, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.18, to: 0.144, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.014, to: 0.022, amount: surfaceToneProgress))),
    ]

    return LinearGradient(
      colors: colors,
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var liquidStroke: some View {
    liquidShape
      .stroke(
        isDarkMode
          ? Color.white.opacity(Double(interpolate(from: 0.108, to: 0.072, amount: surfaceToneProgress)))
          : Color.white.opacity(Double(interpolate(from: 0.56, to: 0.49, amount: surfaceToneProgress))),
        lineWidth: 1
      )
  }

  private var liquidShape: LiquidCalendarMorphShape {
    LiquidCalendarMorphShape(
      cornerRadius: surfaceRadius
    )
  }

  private var fallbackLiquidFill: LinearGradient {
    let colors = isDarkMode ? [
      Color.white.opacity(Double(interpolate(from: 0.065, to: 0.045, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.65, to: 0.77, amount: surfaceToneProgress))),
    ] : [
      Color.white.opacity(Double(interpolate(from: 0.70, to: 0.81, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.47, to: 0.61, amount: surfaceToneProgress))),
    ]

    return LinearGradient(
      colors: colors,
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private func openMenu(_ action: MenuAction) {
    guard !model.disabled, phase == .collapsed else { return }

    activeAction = action
    addHandoffContentSuppressed = false
    if action == .search {
      model.searchQuery = ""
      model.handleSearchTextChange("")
      model.handleSearch()
    }
    readabilityVisible = false
    contentVisible = false
    searchFocused = false
    morphProgress = 0
    phase = .expanding

    model.handleOpenChange(true)

    withAnimation(.easeOut(duration: action == .search ? 0.08 : 0.16)) {
      collapsedContentVisible = false
    }

    if action == .search {
      withAnimation(.easeOut(duration: 0.24)) {
        morphProgress = 1
      }
    } else {
      DispatchQueue.main.asyncAfter(deadline: .now()) {
        guard activeAction == action, phase == .expanding, morphProgress == 0 else { return }
        withAnimation(.easeOut(duration: 0.14)) {
          morphProgress = 0.46
        }
      }

      DispatchQueue.main.asyncAfter(deadline: .now() + 0.11) {
        guard activeAction == action, phase == .expanding, morphProgress < 1 else { return }
        withAnimation(.interactiveSpring(response: 0.39, dampingFraction: 0.96, blendDuration: 0.04)) {
          morphProgress = 1
        }
      }
    }

    let readabilityDelay = action == .view ? 0.43 : 0.34
    let contentDelay = action == .search ? 0.46 : (action == .view ? 0.38 : 0.34)
    let readabilityThreshold: CGFloat = action == .view ? 0.82 : 0.72
    let contentThreshold: CGFloat = action == .search ? 0.96 : (action == .view ? 0.92 : 0.90)

    if action != .search {
      DispatchQueue.main.asyncAfter(deadline: .now() + readabilityDelay) {
        guard activeAction == action, morphProgress > readabilityThreshold, phase == .expanding else { return }
        withAnimation(.easeOut(duration: 0.14)) {
          readabilityVisible = true
        }
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + contentDelay) {
      guard activeAction == action, morphProgress > contentThreshold, phase == .expanding else { return }
      phase = .expanded
      withAnimation(.easeOut(duration: 0.2)) {
        contentVisible = true
      }
      if action == .search {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.07) {
          guard activeAction == .search, phase == .expanded else { return }
          searchFocused = true
        }
      }
    }
  }

  private func handOffTransientAction(_ action: MenuAction) {
    guard activeAction == action, phase == .expanded || phase == .expanding else { return }

    model.handleOpenChange(false)

    switch action {
    case .search:
      model.handleSearch()
    case .add:
      model.handleAdd()
    case .view:
      break
    }
  }

  private func closeMenu() {
    guard phase == .expanded || phase == .expanding else { return }
    addHandoffContentSuppressed = false

    withAnimation(.easeInOut(duration: 0.1)) {
      contentVisible = false
      phase = .closing
      searchFocused = false
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
      guard phase == .closing else { return }
      withAnimation(.easeInOut(duration: 0.1)) {
        readabilityVisible = false
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
      guard phase == .closing else { return }
      withAnimation(.easeInOut(duration: 0.13)) {
        morphProgress = 0.42
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.21) {
      guard phase == .closing else { return }
      withAnimation(.easeOut(duration: 0.16)) {
        collapsedContentVisible = true
      }
      withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.97, blendDuration: 0.04)) {
        morphProgress = 0
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) {
      guard phase == .closing else { return }
      phase = .collapsed
      model.handleOpenChange(false)
    }
  }

  private func closeOrResetMenu() {
    if phase == .closing {
      collapseMenuImmediately()
      return
    }

    closeMenu()
  }

  private func collapseMenuImmediately() {
    addHandoffContentSuppressed = false
    contentVisible = false
    readabilityVisible = false
    searchFocused = false
    phase = .collapsed
    morphProgress = 0

    withAnimation(.easeOut(duration: 0.08)) {
      collapsedContentVisible = true
    }

    model.handleOpenChange(false)
  }

  private func selectMode(_ mode: String) {
    model.selectedMode = mode
    model.handleSelect(mode)
    closeMenu()
  }

  private func triggerAddAction(_ action: () -> Void) {
    action()
    closeMenu()
  }

  private func triggerQuickAddAction() {
    triggerAddHandoffAction(model.handleQuickAdd)
  }

  private func triggerManualAddAction() {
    triggerAddHandoffAction(model.handleManualAdd)
  }

  private func triggerAddHandoffAction(_ action: @escaping () -> Void) {
    guard phase == .expanded || phase == .expanding else {
      action()
      return
    }

    addHandoffContentSuppressed = true
    withAnimation(.easeOut(duration: 0.06)) {
      contentVisible = false
    }

    action()

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.024) {
      prepareAddHandoff()
    }
  }

  private enum RequestedAddAction {
    case quick
    case manual
  }

  private func triggerRequestedAddAction(_ requestedAction: RequestedAddAction) {
    if activeAction == .add, phase == .expanded || phase == .expanding {
      switch requestedAction {
      case .quick:
        triggerQuickAddAction()
      case .manual:
        triggerManualAddAction()
      }
      return
    }

    guard phase == .collapsed else { return }
    openMenu(.add)

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
      guard activeAction == .add, phase == .expanded || phase == .expanding else { return }
      switch requestedAction {
      case .quick:
        triggerQuickAddAction()
      case .manual:
        triggerManualAddAction()
      }
    }
  }

  private func prepareAddHandoff() {
    guard phase == .expanded || phase == .expanding else { return }

    addHandoffContentSuppressed = true
    phase = .closing
    searchFocused = false
    model.handleOpenChange(false)

    withAnimation(.easeOut(duration: 0.08)) {
      contentVisible = false
      readabilityVisible = false
      collapsedContentVisible = false
    }
  }

  private func smoothstep(edge0: CGFloat, edge1: CGFloat, x: CGFloat) -> CGFloat {
    guard edge0 != edge1 else { return x >= edge1 ? 1 : 0 }
    let t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  private func interpolate(from start: CGFloat, to end: CGFloat, amount: CGFloat) -> CGFloat {
    start + (end - start) * amount
  }

  @ViewBuilder
	  private func prototypeModeGlyph(
	    for mode: String,
	    color: Color = Color.white.opacity(0.94)
	  ) -> some View {
	    switch mode {
	    case "day":
	      Image(systemName: "calendar")
	        .font(.system(size: 22, weight: .regular))
	        .foregroundStyle(color)
	    case "multi":
	      Image(systemName: "rectangle.stack")
	        .font(.system(size: 22, weight: .regular))
	        .foregroundStyle(color)
	    case "compact":
	      VStack(spacing: 3.5) {
        Capsule().fill(color).frame(width: 22, height: 2.9)
        HStack(spacing: 3.5) {
          Capsule().fill(color).frame(width: 2.9, height: 11)
          Capsule().fill(color).frame(width: 2.9, height: 11)
          Capsule().fill(color).frame(width: 2.9, height: 11)
        }
      }
    case "detail":
      VStack(spacing: 4.5) {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(color, lineWidth: 2.15)
          .frame(width: 23, height: 7)
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(color, lineWidth: 2.15)
          .frame(width: 23, height: 7)
          .overlay(alignment: .center) {
            Capsule().fill(color).frame(width: 11, height: 1.5)
          }
      }
    case "list":
      VStack(alignment: .leading, spacing: 4.5) {
        prototypeGlyphListRow(width: 22, color: color)
        prototypeGlyphListRow(width: 22, color: color)
        prototypeGlyphListRow(width: 16, color: color)
      }
    default:
      VStack(spacing: 4.5) {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 2.15)
          .frame(width: 24, height: 8)
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 2.15)
          .frame(width: 24, height: 8)
      }
    }
  }

  private func prototypeGlyphListRow(width: CGFloat, color: Color = Color.white.opacity(0.94)) -> some View {
    HStack(spacing: 4) {
      Circle().fill(color).frame(width: 3.15, height: 3.15)
      Capsule().fill(color).frame(width: width, height: 2.15)
    }
  }
}

private struct LiquidCalendarMorphShape: Shape {
  var cornerRadius: CGFloat

  var animatableData: CGFloat {
    get { cornerRadius }
    set { cornerRadius = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let radius = min(cornerRadius, min(rect.width, rect.height) / 2)
    return Path(roundedRect: rect, cornerRadius: radius)
  }
}

private struct LiquidToolbarIconButtonStyle: ButtonStyle {
  let disabled: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(disabled ? 0.44 : 1)
  }
}

private struct ViewModeIconChoice: View {
  let mode: String
  let selected: Bool
  let foregroundColor: Color
  let selectedFill: Color
  let selectedTint: Color
  let selectedStroke: Color

  var body: some View {
    ZStack {
      selectedBackground

      glyph
        .frame(width: 28, height: 28)
    }
    .foregroundStyle(foregroundColor)
    .frame(width: 40, height: 42)
    .contentShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
  }

	  @ViewBuilder
	  private var glyph: some View {
	    switch mode {
	    case "day":
	      Image(systemName: "calendar")
	        .font(.system(size: 23, weight: .regular))
	    case "multi":
	      Image(systemName: "rectangle.stack")
	        .font(.system(size: 23, weight: .regular))
	    case "compact":
	      VStack(spacing: 3.5) {
        Capsule().fill(foregroundColor).frame(width: 23, height: 3.2)
        HStack(spacing: 3.5) {
          Capsule().fill(foregroundColor).frame(width: 3.2, height: 12)
          Capsule().fill(foregroundColor).frame(width: 3.2, height: 12)
          Capsule().fill(foregroundColor).frame(width: 3.2, height: 12)
        }
      }
    case "detail":
      VStack(spacing: 4.5) {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(foregroundColor, lineWidth: 2.4)
          .frame(width: 24, height: 7.5)
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(foregroundColor, lineWidth: 2.4)
          .frame(width: 24, height: 7.5)
          .overlay {
            Capsule().fill(foregroundColor).frame(width: 11, height: 1.7)
          }
      }
    case "list":
      VStack(alignment: .leading, spacing: 4.5) {
        listRow(width: 23)
        listRow(width: 23)
        listRow(width: 17)
      }
    default:
      VStack(spacing: 4.5) {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(foregroundColor, lineWidth: 2.4)
          .frame(width: 25, height: 8)
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(foregroundColor, lineWidth: 2.4)
          .frame(width: 25, height: 8)
      }
    }
  }

  private func listRow(width: CGFloat) -> some View {
    HStack(spacing: 4) {
      Circle().fill(foregroundColor).frame(width: 3.5, height: 3.5)
      Capsule().fill(foregroundColor).frame(width: width, height: 2.4)
    }
  }

  @ViewBuilder
  private var selectedBackground: some View {
    if selected {
      if #available(iOS 26.0, *) {
        RoundedRectangle(cornerRadius: 17, style: .continuous)
          .fill(selectedFill)
          .glassEffect(
            .clear
              .tint(selectedTint)
              .interactive(false),
            in: RoundedRectangle(cornerRadius: 17, style: .continuous)
          )
          .overlay(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
              .stroke(selectedStroke, lineWidth: 1)
          )
      } else {
        RoundedRectangle(cornerRadius: 17, style: .continuous)
          .fill(selectedFill)
      }
    } else {
      Color.clear
    }
  }
}

private struct ViewModeGlyphMark: View {
  let mode: String
  let color: Color

  var body: some View {
    glyph
      .foregroundStyle(color)
  }

	  @ViewBuilder
	  private var glyph: some View {
	    switch mode {
	    case "day":
	      Image(systemName: "calendar")
	        .font(.system(size: 22, weight: .regular))
	    case "multi":
	      Image(systemName: "rectangle.stack")
	        .font(.system(size: 22, weight: .regular))
	    case "compact":
	      VStack(spacing: 3.5) {
        Capsule().fill(color).frame(width: 22, height: 3.1)
        HStack(spacing: 3.5) {
          Capsule().fill(color).frame(width: 3.1, height: 11)
          Capsule().fill(color).frame(width: 3.1, height: 11)
          Capsule().fill(color).frame(width: 3.1, height: 11)
        }
      }
    case "detail":
      VStack(spacing: 4.4) {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(color, lineWidth: 2.3)
          .frame(width: 23, height: 7)
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(color, lineWidth: 2.3)
          .frame(width: 23, height: 7)
          .overlay {
            Capsule().fill(color).frame(width: 10, height: 1.6)
          }
      }
    case "list":
      VStack(alignment: .leading, spacing: 4.5) {
        listRow(width: 22)
        listRow(width: 22)
        listRow(width: 16)
      }
    default:
      VStack(spacing: 4.5) {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 2.3)
          .frame(width: 24, height: 8)
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 2.3)
          .frame(width: 24, height: 8)
      }
    }
  }

  private func listRow(width: CGFloat) -> some View {
    HStack(spacing: 4) {
      Circle().fill(color).frame(width: 3.4, height: 3.4)
      Capsule().fill(color).frame(width: width, height: 2.3)
    }
  }
}

private struct ViewModeGlassRow: View {
  let mode: String?
  let label: String
  let selected: Bool
  let foregroundColor: Color
  let selectedFill: Color
  let selectedTint: Color
  let selectedStroke: Color
  let showsSelectionIndicator: Bool

  init(
    mode: String? = nil,
    label: String,
    selected: Bool,
    foregroundColor: Color = Color.white,
    selectedFill: Color = Color.white.opacity(0.08),
    selectedTint: Color = Color.white.opacity(0.14),
    selectedStroke: Color = Color.white.opacity(0.16),
    showsSelectionIndicator: Bool = true
  ) {
    self.mode = mode
    self.label = label
    self.selected = selected
    self.foregroundColor = foregroundColor
    self.selectedFill = selectedFill
    self.selectedTint = selectedTint
    self.selectedStroke = selectedStroke
    self.showsSelectionIndicator = showsSelectionIndicator
  }

  var body: some View {
    ZStack {
      selectedBackground

      HStack(spacing: 12) {
        if let mode {
          ViewModeGlyphMark(mode: mode, color: foregroundColor)
            .frame(width: 26, height: 26)
            .frame(width: 32)
        }

        if showsSelectionIndicator {
          Group {
            if selected {
              Image(systemName: "checkmark")
                .font(.system(size: 17, weight: .bold))
            } else {
              Color.clear
            }
          }
          .frame(width: 22)
        }

        Text(label)
          .font(.system(size: 16, weight: selected ? .bold : .semibold))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .foregroundStyle(foregroundColor)
      .padding(.horizontal, 12)
    }
    .frame(height: 43)
  }

  @ViewBuilder
  private var selectedBackground: some View {
    if selected {
      if #available(iOS 26.0, *) {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .fill(selectedFill)
          .glassEffect(
            .clear
              .tint(selectedTint)
              .interactive(false),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
          )
          .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
              .stroke(selectedStroke, lineWidth: 1)
          )
      } else {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .fill(selectedFill)
      }
    } else {
      Color.clear
    }
  }
}

private struct ViewModeGlassOption: Identifiable {
  let id: String
  let label: String
}

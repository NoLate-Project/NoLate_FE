import SwiftUI
import UIKit

private let calendarPillContentTravel: CGFloat = 9

private struct CalendarPillVerticalTransitionModifier: ViewModifier {
  let offsetY: CGFloat
  let opacity: Double

  func body(content: Content) -> some View {
    content
      .offset(y: offsetY)
      .opacity(opacity)
  }
}

private final class ViewModeGlassControlModel: ObservableObject {
  @Published var selectedMode: String
  @Published var disabled: Bool
  @Published var colorScheme: String
  @Published var viewModeVariant: String
  @Published var showsViewModeButton: Bool
  @Published var prototypeTapRequest = 0
  @Published var prototypeCloseRequest = 0
  @Published var prototypeAddMenuRequest = 0
  @Published var prototypeSearchRequest = 0
  @Published var prototypeQuickAddRequest = 0
  @Published var prototypeManualAddRequest = 0
  @Published var prototypeHostExpanded = false
  @Published var prototypeSearchHostReady = false
  var searchOpenGeneration = 0
  @Published var searchExpandedWidth: CGFloat
  @Published var searchQuery: String

  let handleSelect: (String) -> Void
  let handleOpenChange: (Bool) -> Void
  let handleSearch: (Int) -> Void
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
    showsViewModeButton: Bool = true,
    searchExpandedWidth: CGFloat = 361,
    searchQuery: String = "",
    handleSelect: @escaping (String) -> Void,
    handleOpenChange: @escaping (Bool) -> Void,
    handleSearch: @escaping (Int) -> Void = { _ in },
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
    self.showsViewModeButton = showsViewModeButton
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
  @Published var animatesContentChanges: Bool

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
    animatesContentChanges: Bool = true,
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
    self.animatesContentChanges = animatesContentChanges
    self.handlePress = handlePress
  }
}

@objc(LiquidCalendarMenuPrototypeView)
final class LiquidCalendarMenuPrototypeView: UIView {
  @objc var selectedMode: NSString = "detail" {
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

  @objc var showsViewModeButton: Bool = true {
    didSet {
      model.showsViewModeButton = showsViewModeButton
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

  @objc var searchRequest: NSNumber = 0 {
    didSet {
      guard searchRequest.intValue != oldValue.intValue else { return }
      model.prototypeSearchRequest += 1
    }
  }

  @objc var quickAddRequest: NSNumber = 0 {
    didSet {
      // QA drives this prop as a 0 -> 1 -> 0 pulse. Ignore the falling edge so
      // resetting the prop cannot replay a selection inside SwiftUI.
      guard oldValue.intValue == 0, quickAddRequest.intValue != 0 else { return }
      model.prototypeQuickAddRequest += 1
    }
  }

  @objc var manualAddRequest: NSNumber = 0 {
    didSet {
      guard oldValue.intValue == 0, manualAddRequest.intValue != 0 else { return }
      model.prototypeManualAddRequest += 1
    }
  }

  @objc var searchExpandedWidth: NSNumber = 361 {
    didSet {
      model.searchExpandedWidth = CGFloat(truncating: searchExpandedWidth)
      setNeedsLayout()
      updateHostReadiness()
    }
  }

  @objc var searchQuery: NSString = "" {
    didSet {
      model.searchQuery = searchQuery as String
    }
  }

  @objc var onSelect: (([AnyHashable: Any]) -> Void)?
  @objc var onOpenChange: (([AnyHashable: Any]) -> Void)?
  @objc var onSearch: (([AnyHashable: Any]) -> Void)?
  @objc var onSearchTextChange: (([AnyHashable: Any]) -> Void)?
  @objc var onSearchClose: (([AnyHashable: Any]) -> Void)?
  @objc var onAdd: (([AnyHashable: Any]) -> Void)?
  @objc var onQuickAdd: (([AnyHashable: Any]) -> Void)?
  @objc var onManualAdd: (([AnyHashable: Any]) -> Void)?
  @objc var onManageCategories: (([AnyHashable: Any]) -> Void)?

  private let searchSessionID = UUID().uuidString
  private var lastSearchOpenGeneration = 0

  private lazy var model = ViewModeGlassControlModel(
    selectedMode: selectedMode as String,
    disabled: disabled,
    colorScheme: colorScheme as String,
    viewModeVariant: viewModeVariant as String,
    showsViewModeButton: showsViewModeButton,
    searchExpandedWidth: CGFloat(truncating: searchExpandedWidth),
    searchQuery: searchQuery as String,
    handleSelect: { [weak self] mode in
      self?.onSelect?(["mode": mode])
    },
    handleOpenChange: { [weak self] open in
      let search = self?.prototypeSearchOpen ?? false
      let searchGeneration = self?.lastSearchOpenGeneration ?? 0
      self?.prototypeMenuOpen = open
      if !open {
        self?.prototypeSearchOpen = false
      }
      self?.onOpenChange?([
        "open": open,
        "search": search,
        "searchGeneration": searchGeneration,
        "searchSession": self?.searchSessionID ?? "",
      ])
    },
    handleSearch: { [weak self] generation in
      self?.lastSearchOpenGeneration = generation
      self?.prototypeSearchOpen = true
      self?.onSearch?([
        "action": "search",
        "generation": generation,
        "session": self?.searchSessionID ?? "",
      ])
    },
    handleSearchTextChange: { [weak self] text in
      self?.onSearchTextChange?(["text": text])
    },
    handleSearchClose: { [weak self] in
      self?.onSearchClose?(["action": "searchClose"])
    },
    handleAdd: { [weak self] in
      self?.onAdd?(["action": "add"])
    },
    handleQuickAdd: { [weak self] in
      self?.onQuickAdd?(["action": "quickAdd"])
    },
    handleManualAdd: { [weak self] in
      self?.onManualAdd?(["action": "manualAdd"])
    },
    handleManageCategories: { [weak self] in
      self?.onManageCategories?(["action": "manageCategories"])
    }
  )

  private var hostingController: UIHostingController<LiquidCalendarMenuPrototypeRootView>?
  private var prototypeMenuOpen = false
  private var prototypeSearchOpen = false
  private var collapsedHitSize: CGSize {
    CGSize(width: model.showsViewModeButton ? 150 : 100, height: 44)
  }
  private let searchExpandedHitHeight: CGFloat = 52
  private let collapsedHitPadding = UIEdgeInsets.zero
  private let expandedHitHeight: CGFloat = 180
  private let expandedHitPadding = UIEdgeInsets(top: 8, left: 0, bottom: 14, right: 0)

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
      return activeExpandedHitRect.contains(point)
    }

    return collapsedHitRect.contains(point)
  }

  override func layoutSubviews() {
    super.layoutSubviews()

    updateHostReadiness()
  }

  private func updateHostReadiness() {
    let hostExpanded = bounds.height >= expandedHitHeight - 1
    let searchHostReady =
      bounds.height >= searchExpandedHitHeight - 1
      && bounds.width >= model.searchExpandedWidth - 1
    if model.prototypeHostExpanded != hostExpanded {
      model.prototypeHostExpanded = hostExpanded
    }
    if model.prototypeSearchHostReady != searchHostReady {
      model.prototypeSearchHostReady = searchHostReady
    }
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard !model.disabled else { return nil }

    let activeHitRect = prototypeMenuOpen ? activeExpandedHitRect : collapsedHitRect

    if !activeHitRect.contains(point) {
      return nil
    }

    if !prototypeMenuOpen {
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

  private var expandedHitRect: CGRect {
    let height = min(
      bounds.height + expandedHitPadding.top + expandedHitPadding.bottom,
      expandedHitHeight + expandedHitPadding.top + expandedHitPadding.bottom
    )

    return CGRect(
      x: bounds.minX - expandedHitPadding.left,
      y: bounds.minY - expandedHitPadding.top,
      width: bounds.width + expandedHitPadding.left + expandedHitPadding.right,
      height: height
    )
  }

  private var searchExpandedHitRect: CGRect {
    let width = min(bounds.width, model.searchExpandedWidth)
    return CGRect(
      x: bounds.maxX - width,
      y: bounds.minY,
      width: width,
      height: min(bounds.height, searchExpandedHitHeight)
    )
  }

  private var activeExpandedHitRect: CGRect {
    prototypeSearchOpen ? searchExpandedHitRect : expandedHitRect
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

  @objc var animatesContentChanges: Bool = true {
    didSet {
      model.animatesContentChanges = animatesContentChanges
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
    animatesContentChanges: animatesContentChanges,
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

private struct LiquidGlassIconButtonRootView: View {
  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
  @ObservedObject var model: LiquidGlassIconButtonModel

  var body: some View {
    Button {
      guard !model.disabled else { return }
      model.handlePress()
    } label: {
      ZStack {
        surface

        ZStack {
          pillContent
            .id(model.animatesContentChanges ? contentIdentity : "static-content")
            .transition(
              model.animatesContentChanges ? pillContentTransition : .identity
            )
        }
        .frame(width: model.buttonWidth, height: model.buttonHeight)
        .clipped()
        .animation(
          model.animatesContentChanges ? depthPillAnimation : nil,
          value: contentIdentity
        )
      }
      .frame(width: model.buttonWidth, height: model.buttonHeight)
    }
    .clipShape(RoundedRectangle(cornerRadius: model.buttonHeight / 2, style: .continuous))
    .shadow(color: Color.black.opacity(0.11), radius: 8, x: 0, y: 4)
    .buttonStyle(.plain)
    .disabled(model.disabled)
    .accessibilityLabel(accessibilityLabel)
    .animation(depthPillAnimation, value: model.buttonWidth)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  private var contentIdentity: String {
    [leadingSymbol ?? "", model.label, model.trailingSymbolName].joined(separator: ":")
  }

  private var depthPillAnimation: Animation {
    accessibilityReduceMotion
      ? .easeOut(duration: 0.16)
      : .timingCurve(0.25, 0.1, 0.25, 1, duration: 0.16)
  }

  private var pillContentTransition: AnyTransition {
    guard !accessibilityReduceMotion else { return .opacity }
    return .asymmetric(
      insertion: .modifier(
        active: CalendarPillVerticalTransitionModifier(
          offsetY: calendarPillContentTravel,
          opacity: 0
        ),
        identity: CalendarPillVerticalTransitionModifier(offsetY: 0, opacity: 1)
      ),
      removal: .modifier(
        active: CalendarPillVerticalTransitionModifier(
          offsetY: -calendarPillContentTravel,
          opacity: 0
        ),
        identity: CalendarPillVerticalTransitionModifier(offsetY: 0, opacity: 1)
      )
    )
  }

  private var pillContent: some View {
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
        .opacity(isDarkMode ? 0.28 : 0.52)
        .clipShape(shape)

      shape
        .stroke(strokeColor, lineWidth: 1)
        .frame(width: width, height: height)
    }
    .frame(width: width, height: height)
    .clipShape(RoundedRectangle(cornerRadius: height / 2, style: .continuous))
  }

  private var surfaceBaseFill: Color {
    isDarkMode ? Color.white.opacity(0.028) : Color.white.opacity(0.063)
  }

  private var surfaceNativeTint: Color {
    isDarkMode ? Color.black.opacity(0.18) : Color.white.opacity(0.032)
  }

  private var strokeColor: Color {
    isDarkMode ? Color.white.opacity(0.108) : Color.white.opacity(0.56)
  }

  private var liquidHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(isDarkMode ? 0.065 : 0.49),
        Color.white.opacity(isDarkMode ? 0.022 : 0.18),
        Color.black.opacity(isDarkMode ? 0.07 : 0.014),
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
              Color.black.opacity(isDarkMode ? 0.13 : 0.063),
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
              Color.black.opacity(isDarkMode ? 0.11 : 0.054),
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
        Color.black.opacity(isDarkMode ? 0.12 : 0.068),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var fallbackLiquidFill: LinearGradient {
    LinearGradient(
      colors: isDarkMode ? [
        Color.white.opacity(0.072),
        Color.black.opacity(0.52),
      ] : [
        Color.white.opacity(0.78),
        Color.white.opacity(0.52),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

private struct LiquidCalendarMenuPrototypeRootView: View {
  private enum SearchOpenMotion {
    static let morphDuration = 0.14
    // Keep the compact glyphs visible until the search content can replace
    // them in one transaction. Independent fades leave a briefly empty pill
    // when rapid taps land while the liquid surface is still widening.
    static let contentHandoffDelay = 0.025
  }

  private enum SearchCloseMotion {
    // The close button shares its x-coordinate with the compact add button.
    // Protect only Add from the tail of the closing touch. Search and View
    // must be immediately reusable when the compact pill becomes visible.
    static let addInteractionSettleDelay = 0.18
  }

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

  private enum RequestedAddAction: Equatable {
    case quick
    case manual
  }

  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
  @ObservedObject var model: ViewModeGlassControlModel

  @State private var phase: Phase = .collapsed
  @State private var expansionPending = false
  @State private var activeAction: MenuAction = .view
  @State private var morphProgress: CGFloat = 0
  @State private var readabilityVisible = false
  @State private var contentVisible = false
  @State private var collapsedContentVisible = true
  @State private var compactAddInteractionLocked = false
  @State private var compactAddLockGeneration = 0
  @State private var addHandoffSelectionPending = false
  @State private var transitionGeneration = 0
  @FocusState private var searchFocused: Bool

  private var collapsedWidth: CGFloat {
    model.showsViewModeButton ? 150 : 100
  }
  private let collapsedHeight: CGFloat = 44
  private let searchExpandedHeight: CGFloat = 52
  private let collapsedSlotWidth: CGFloat = 50
  private let viewExpandedWidth: CGFloat = 251
  private let addExpandedWidth: CGFloat = 238
  private let addExpandedHeight: CGFloat = 164
  private let collapsedRadius: CGFloat = 22
  private let expandedRadius: CGFloat = 26
  private let calendarOptions: [ViewModeGlassOption] = [
    ViewModeGlassOption(id: "stack", label: "스택형"),
    ViewModeGlassOption(id: "detail", label: "상세형"),
    ViewModeGlassOption(id: "list", label: "목록형"),
  ]
  private let timelineOptions: [ViewModeGlassOption] = [
    ViewModeGlassOption(id: "day", label: "일간"),
    ViewModeGlassOption(id: "multi", label: "여러 날"),
  ]

  var body: some View {
    ZStack(alignment: .topTrailing) {
      if showsDismissBackdrop {
        dismissBackdrop
      }

      if #available(iOS 26.0, *) {
        nativeLiquidMenu
      } else {
        fallbackLiquidMenu
      }
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
    .onChange(of: model.prototypeSearchRequest) { _ in
      guard phase == .collapsed else { return }
      openMenu(.search)
    }
    .onChange(of: model.prototypeQuickAddRequest) { _ in
      triggerRequestedAddAction(.quick)
    }
    .onChange(of: model.prototypeManualAddRequest) { _ in
      triggerRequestedAddAction(.manual)
    }
    .onChange(of: model.prototypeHostExpanded) { hostExpanded in
      guard hostExpanded else { return }
      beginPendingExpansionIfReady()
    }
    .onChange(of: model.prototypeSearchHostReady) { searchHostReady in
      guard searchHostReady else { return }
      beginPendingExpansionIfReady()
    }
  }

  private var showsDismissBackdrop: Bool {
    phase == .expanding || phase == .expanded
  }

  private var dismissBackdrop: some View {
    Color.clear
      .contentShape(Rectangle())
      .onTapGesture {
        closeMenuFromOutsideTap()
      }
      .accessibilityHidden(true)
  }

  @available(iOS 26.0, *)
  private var nativeLiquidMenu: some View {
    liquidMenuObject(nativeSurface: true)
    .frame(width: rootWidth, height: rootHeight, alignment: .topTrailing)
  }

  private var fallbackLiquidMenu: some View {
    liquidMenuObject(nativeSurface: false)
      .frame(width: rootWidth, height: rootHeight, alignment: .topTrailing)
  }

  @ViewBuilder
  private func liquidMenuObject(nativeSurface: Bool) -> some View {
    ZStack(alignment: .topTrailing) {
      if activeAction == .search && phase != .collapsed {
        searchChromeOcclusionLayer
      }

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
        .opacity(readabilityOpacity)
        .allowsHitTesting(false)

      liquidRefractionLayer
        .opacity(refractionOpacity)
        .allowsHitTesting(false)

      expandedContent
        // Lay rows out once at their final size. Binding their layout height to
        // `surfaceHeight` compressed three 43pt add rows into the intermediate
        // 44–164pt pill and made labels/icons visibly stack over each other.
        // The morphing liquid shape is the mask; it reveals this stable layout.
        .frame(
          width: targetExpandedWidth,
          height: targetExpandedHeight,
          // Search content already tracks `surfaceWidth`. Pinning that child to
          // the same trailing edge as the morph mask keeps its icons visible
          // during the first narrow frames instead of revealing an empty pill.
          alignment: activeAction == .search ? .topTrailing : .top
        )
        .opacity(expandedContentOpacity)
        .offset(y: expandedContentOffsetY)
        .scaleEffect(expandedContentScale, anchor: .topTrailing)
        // Search becomes visible before the width morph completes. Give that
        // visible field ownership immediately so a rapid second tap cannot
        // fall through to the dismiss backdrop and reverse the transition.
        .allowsHitTesting(
          (
            phase == .expanded
              || (activeAction == .search && phase == .expanding)
          )
            && !addHandoffSelectionPending
        )

      if phase != .expanded {
        collapsedContent
          .frame(width: collapsedWidth, height: collapsedHeight)
          .opacity(collapsedContentOpacity)
          .offset(y: collapsedContentOffsetY)
          .allowsHitTesting(phase == .collapsed)
          .frame(width: surfaceWidth, height: surfaceHeight, alignment: .topTrailing)
      }
    }
    .frame(width: surfaceWidth, height: surfaceHeight, alignment: .topTrailing)
    .clipShape(liquidShape)
    .contentShape(liquidShape)
    .animation(depthPillAnimation, value: model.showsViewModeButton)
    .shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowYOffset)
  }

  private var searchChromeOcclusionLayer: some View {
    Rectangle()
      .fill(isDarkMode ? Color.black : Color.white)
      .frame(
        width: max(0, surfaceWidth - collapsedWidth),
        height: surfaceHeight
      )
      .frame(width: surfaceWidth, height: surfaceHeight, alignment: .leading)
      .clipShape(liquidShape)
      .allowsHitTesting(false)
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
      .overlay(liquidWaterDropLayer)
      .overlay(liquidStroke)
  }

  private var fallbackLiquidSurface: some View {
    liquidShape
      .fill(fallbackLiquidFill)
      .frame(width: surfaceWidth, height: surfaceHeight)
      .overlay(liquidHighlight)
      .overlay(liquidCausticLayer)
      .overlay(liquidWaterDropLayer)
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
              Color.black.opacity(isDarkMode ? 0.075 : 0.054),
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
          Color.white.opacity(isDarkMode ? 0.052 : 0.68),
          Color.white.opacity(isDarkMode ? 0.018 : 0.29),
          Color.clear,
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.11 : 0.78),
              Color.white.opacity(isDarkMode ? 0.034 : 0.36),
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
              Color.black.opacity(isDarkMode ? 0.14 : 0.082),
              Color.white.opacity(isDarkMode ? 0.032 : 0.32),
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

  private var liquidWaterDropLayer: some View {
    ZStack {
      RadialGradient(
        colors: [
          Color.white.opacity(isDarkMode ? 0.15 : 0.52),
          Color.white.opacity(isDarkMode ? 0.048 : 0.18),
          Color.clear,
        ],
        center: .topLeading,
        startRadius: 2,
        endRadius: max(74, surfaceWidth * 0.82)
      )

      RadialGradient(
        colors: [
          Color.clear,
          Color.black.opacity(isDarkMode ? 0.06 : 0.032),
          Color.black.opacity(isDarkMode ? 0.10 : 0.052),
        ],
        center: .bottomTrailing,
        startRadius: max(24, min(surfaceWidth, surfaceHeight) * 0.18),
        endRadius: max(92, surfaceWidth * 0.74)
      )
      .blendMode(.multiply)

      Capsule()
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.19 : 0.84),
              Color.white.opacity(isDarkMode ? 0.055 : 0.34),
              Color.clear,
            ],
            startPoint: .leading,
            endPoint: .trailing
          )
        )
        .frame(
          width: max(64, surfaceWidth * (activeAction == .search ? 0.46 : 0.58)),
          height: max(8, min(20, surfaceHeight * 0.16))
        )
        .rotationEffect(.degrees(-8))
        .offset(x: -surfaceWidth * 0.15, y: -surfaceHeight * 0.32)
        .blur(radius: 1.4)
        .opacity(0.9)

      liquidShape
        .stroke(
          LinearGradient(
            colors: [
              Color.white.opacity(isDarkMode ? 0.28 : 0.92),
              Color.white.opacity(isDarkMode ? 0.07 : 0.28),
              Color.black.opacity(isDarkMode ? 0.10 : 0.06),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          ),
          lineWidth: 1.15
        )
        .padding(1.2)

      liquidShape
        .stroke(Color.white.opacity(isDarkMode ? 0.055 : 0.28), lineWidth: 0.8)
        .padding(5)
    }
    .opacity(waterDropOpacity)
    .frame(width: surfaceWidth, height: surfaceHeight)
    .clipShape(liquidShape)
    .allowsHitTesting(false)
  }

  private var collapsedContent: some View {
    HStack(spacing: 0) {
      if model.showsViewModeButton {
        Button {
          openMenu(.view)
        } label: {
          ZStack {
            prototypeModeGlyph(
              for: model.selectedMode,
              color: collapsedGlyphColor
            )
              .id(model.selectedMode)
              .transition(pillButtonTransition)
          }
          .frame(width: 32, height: 25)
          .clipped()
          .animation(depthPillAnimation, value: model.selectedMode)
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
        }
        .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
        .disabled(model.disabled)
        .accessibilityLabel("보기 방식, 현재 \(selectedViewModeLabel)")
        .accessibilityHint("보기 방식 메뉴 열기")
        .transition(pillButtonTransition)
      }

      Button {
        guard !model.disabled else { return }
        openMenu(.search)
      } label: {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 23, weight: .regular))
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
      }
      .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
      .disabled(model.disabled)
      .accessibilityLabel("일정 검색")
      .accessibilityHint("일정 제목이나 장소를 검색합니다")

      Button {
        guard !compactAddInteractionLocked else { return }
        openMenu(.add)
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 25, weight: .regular))
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
      }
      .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
      .disabled(model.disabled || compactAddInteractionLocked)
      .accessibilityLabel("일정 추가")
      .accessibilityHint("빠른 일정 생성, 직접 입력 또는 카테고리 관리 메뉴를 엽니다")
    }
    .foregroundStyle(collapsedGlyphColor)
    .frame(width: collapsedWidth, height: collapsedHeight)
    .animation(depthPillAnimation, value: model.showsViewModeButton)
  }

  private var depthPillAnimation: Animation {
    accessibilityReduceMotion
      ? .easeOut(duration: 0.16)
      : .timingCurve(0.25, 0.1, 0.25, 1, duration: 0.16)
  }

  private var pillButtonTransition: AnyTransition {
    guard !accessibilityReduceMotion else { return .opacity }
    return .asymmetric(
      insertion: .modifier(
        active: CalendarPillVerticalTransitionModifier(
          offsetY: calendarPillContentTravel,
          opacity: 0
        ),
        identity: CalendarPillVerticalTransitionModifier(offsetY: 0, opacity: 1)
      ),
      removal: .modifier(
        active: CalendarPillVerticalTransitionModifier(
          offsetY: -calendarPillContentTravel,
          opacity: 0
        ),
        identity: CalendarPillVerticalTransitionModifier(offsetY: 0, opacity: 1)
      )
    )
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
    // Three rows, the list divider, spacing, and padding resolve to roughly
    // 169pt. Keep the same ~10pt layout headroom as the former four-row 220pt
    // menu; shrinking to the exact 170pt sum can strand collapsed controls over
    // the morphing menu, while 220pt leaves a visibly empty fourth-row space.
    isTimelineVariant ? 106 : 180
  }

  private var expandedPrimaryColor: Color {
    isDarkMode ? Color.white.opacity(0.96) : Color.black.opacity(0.88)
  }

  private var expandedSecondaryColor: Color {
    isDarkMode ? Color.white.opacity(0.6) : Color.black.opacity(0.54)
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
      return Color.white.opacity(Double(interpolate(from: 0.028, to: 0.022, amount: surfaceToneProgress)))
    }

    return Color.white.opacity(Double(interpolate(from: 0.063, to: 0.099, amount: surfaceToneProgress)))
  }

  private var surfaceNativeTint: Color {
    if isDarkMode {
      return Color.black.opacity(Double(interpolate(from: 0.18, to: 0.22, amount: surfaceToneProgress)))
    }

    return Color.white.opacity(Double(interpolate(from: 0.032, to: 0.072, amount: surfaceToneProgress)))
  }

  private var readabilityFill: Color {
    isDarkMode ? Color.black.opacity(0.074) : Color.white.opacity(0.12)
  }

  private var readabilityGradientColors: [Color] {
    if isDarkMode {
      return [
        Color.white.opacity(0.029),
        Color.black.opacity(0.018),
        Color.black.opacity(0.052),
      ]
    }

    return [
      Color.white.opacity(0.16),
      Color.white.opacity(0.06),
      Color.clear,
    ]
  }

  private var refractionOpacity: Double {
    let base = isDarkMode ? 0.28 : 0.55
    let progress = activeAction == .search ? widthProgress : finalProgress
    return base * Double(0.58 + progress * 0.42)
  }

  private var waterDropOpacity: Double {
    let progress = activeAction == .search ? widthProgress : smoothstep(edge0: 0.18, edge1: 0.86, x: morphProgress)
    let base = isDarkMode ? 0.62 : 0.55
    return base * Double(0.82 + progress * 0.18)
  }

  private var refractionStroke: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(isDarkMode ? 0.108 : 0.77),
        Color.white.opacity(isDarkMode ? 0.036 : 0.31),
        Color.black.opacity(isDarkMode ? 0.12 : 0.068),
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
    VStack(spacing: 2) {
      ForEach(options) { option in
        let selected = option.id == model.selectedMode

        if option.id == "list" {
          Divider()
            .overlay(expandedRowStroke)
            .padding(.horizontal, 8)
            .padding(.vertical, 9.5)
        }

        Button {
          selectMode(option.id)
        } label: {
          ViewModeGlassRow(
            mode: option.id,
            label: option.label,
            selected: selected,
            foregroundColor: selected ? expandedPrimaryColor : expandedSecondaryColor,
            selectedFill: expandedRowFill,
            selectedTint: expandedRowTint,
            selectedStroke: expandedRowStroke,
            showsSelectionIndicator: false
          )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }

  private var searchExpandedContent: some View {
    HStack(spacing: 11) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 20, weight: .bold))
        .foregroundStyle(collapsedGlyphColor.opacity(0.92))

      TextField(
        "검색",
        text: Binding(
          get: { model.searchQuery },
          set: { newValue in
            model.searchQuery = newValue
            model.handleSearchTextChange(newValue)
          }
        ),
        prompt: Text("검색")
          .foregroundColor(collapsedGlyphColor.opacity(0.46))
      )
      .focused($searchFocused)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled(true)
      .font(.system(size: 17, weight: .semibold))
      .foregroundStyle(collapsedGlyphColor)
      .tint(collapsedGlyphColor)
      .accessibilityLabel("일정 검색어")
      .accessibilityHint("검색할 일정 제목이나 장소를 입력하세요")

      if !model.searchQuery.isEmpty {
        Button {
          model.searchQuery = ""
          model.handleSearchTextChange("")
        } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 21, weight: .semibold))
            .foregroundStyle(collapsedGlyphColor.opacity(0.54))
            .frame(width: 36, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("검색어 지우기")
      }

      Button {
        closeSearchActionIfNeeded()
        closeMenu()
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 18, weight: .bold))
          .foregroundStyle(collapsedGlyphColor.opacity(0.92))
          .frame(width: 40, height: 44)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("검색 닫기")
    }
    .padding(.leading, 20)
    .padding(.trailing, 10)
    .frame(width: surfaceWidth, height: searchExpandedHeight)
  }

  private var addExpandedContent: some View {
    VStack(spacing: 4) {
      addActionRow(
        icon: "bolt",
        title: "빠른 일정 생성",
        accessibilityHint: "문장, 사진 또는 음성으로 일정을 빠르게 만듭니다",
        action: triggerQuickAddAction,
        closesAfterAction: false
      )

      addActionRow(
        icon: "square.and.pencil",
        title: "직접 입력",
        accessibilityHint: "일정 내용을 직접 입력합니다",
        action: triggerManualAddAction,
        closesAfterAction: false
      )

      addActionRow(
        icon: "tag",
        title: "카테고리 관리",
        accessibilityHint: "카테고리를 추가하거나 편집합니다",
        action: model.handleManageCategories
      )
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 12)
  }

  private func addActionRow(
    icon: String,
    title: String,
    accessibilityHint: String,
    action: @escaping () -> Void,
    closesAfterAction: Bool = true
  ) -> some View {
    return Button {
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
    .accessibilityHint(accessibilityHint)
  }

  private var selectedViewModeLabel: String {
    options.first(where: { $0.id == model.selectedMode })?.label ?? "미지정"
  }

  private var surfaceWidth: CGFloat {
    collapsedWidth + (targetExpandedWidth - collapsedWidth) * widthProgress
  }

  private var surfaceHeight: CGFloat {
    collapsedHeight + (targetExpandedHeight - collapsedHeight) * heightProgress
  }

  private var surfaceRadius: CGFloat {
    collapsedRadius + (expandedRadius - collapsedRadius) * morphProgress
  }

  private var collapsedContentOpacity: Double {
    guard phase == .collapsed || phase == .expanding || phase == .closing else { return 0 }

    if phase == .expanding, activeAction != .search {
      return Double(1 - collapsedExpansionBlend) * (model.disabled ? 0.42 : 1)
    }

    return (collapsedContentVisible ? 1 : 0) * (model.disabled ? 0.42 : 1)
  }

  private var collapsedContentOffsetY: CGFloat {
    guard phase == .expanding, activeAction != .search else { return 0 }
    return -44 * collapsedExpansionBlend
  }

  private var expandedContentReveal: CGFloat {
    switch phase {
    case .collapsed:
      return 0
    case .closing:
      return contentVisible ? 1 : 0
    case .expanding:
      return activeAction == .search
        ? (contentVisible ? 1 : 0)
        : expansionContentBlend
    case .expanded:
      return contentVisible ? 1 : 0
    }
  }

  private var expansionContentBlend: CGFloat {
    // The destination rows rise only after the compact controls have started
    // leaving. Their fixed final layout is revealed by the growing mask.
    smoothstep(edge0: 0.22, edge1: 0.62, x: morphProgress)
  }

  private var collapsedExpansionBlend: CGFloat {
    // Move the three compact buttons completely above the 44pt source pill.
    // A separate, earlier curve prevents them from crossing through the first
    // add row while both layers are partially visible.
    smoothstep(edge0: 0.08, edge1: 0.42, x: morphProgress)
  }

  private var readabilityOpacity: Double {
    if phase == .expanding, activeAction != .search {
      return Double(expansionContentBlend)
    }

    return readabilityVisible ? 1 : 0
  }

  private var expandedContentOpacity: Double {
    Double(expandedContentReveal)
  }

  private var expandedContentOffsetY: CGFloat {
    activeAction == .search ? 0 : 42 * (1 - expandedContentReveal)
  }

  private var expandedContentScale: CGFloat {
    0.99 + 0.01 * expandedContentReveal
  }

  private var shadowColor: Color {
    Color.black.opacity(0.08 + 0.07 * Double(finalProgress))
  }

  private var shadowRadius: CGFloat {
    8 + 12 * finalProgress
  }

  private var shadowYOffset: CGFloat {
    4 + 9 * finalProgress
  }

  private var surfaceToneProgress: CGFloat {
    morphProgress
  }

  private var widthProgress: CGFloat {
    morphProgress
  }

  private var heightProgress: CGFloat {
    return morphProgress
  }

  private var rootWidth: CGFloat {
    max(collapsedWidth, surfaceWidth)
  }

  private var rootHeight: CGFloat {
    guard phase != .collapsed else { return collapsedHeight }
    return activeAction == .search
      ? searchExpandedHeight
      : max(addExpandedHeight, viewExpandedHeight)
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
      return searchExpandedHeight
    case .view:
      return viewExpandedHeight
    case .add:
      return addExpandedHeight
    }
  }

  private var finalProgress: CGFloat {
    morphProgress
  }

  private var liquidHighlight: LinearGradient {
    let colors = isDarkMode ? [
      Color.white.opacity(Double(interpolate(from: 0.065, to: 0.041, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.022, to: 0.016, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.07, to: 0.095, amount: surfaceToneProgress))),
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
      Color.black.opacity(Double(interpolate(from: 0.46, to: 0.56, amount: surfaceToneProgress))),
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
    guard !model.disabled, phase == .collapsed, !expansionPending else { return }
    guard action != .add || !compactAddInteractionLocked else { return }

    resetAddHandoffSelection()
    activeAction = action
    if action == .search {
      model.searchOpenGeneration += 1
      model.searchQuery = ""
      model.handleSearchTextChange("")
      model.handleSearch(model.searchOpenGeneration)
    }
    readabilityVisible = false
    contentVisible = false
    searchFocused = false
    morphProgress = 0
    expansionPending = true

    // Search already owns a full-width native canvas while collapsed, so its
    // morph begins immediately on the UI thread. The expanding opaque leading
    // edge covers the React year pill and reveals it again on close; no JS
    // acknowledgement participates in the visual timeline.
    model.handleOpenChange(true)
    beginPendingExpansionIfReady()
  }

  private func beginPendingExpansionIfReady() {
    let hostReady = activeAction == .search
      ? model.prototypeSearchHostReady
      : model.prototypeHostExpanded
    guard expansionPending, phase == .collapsed, hostReady else { return }

    let action = activeAction
    let morphDuration = action == .search ? SearchOpenMotion.morphDuration : 0.20
    let completionDelay = morphDuration
    transitionGeneration += 1
    let generation = transitionGeneration

    expansionPending = false
    phase = .expanding

    withAnimation(morphAnimation(duration: morphDuration)) {
      morphProgress = 1
    }

    if action == .search {
      DispatchQueue.main.asyncAfter(deadline: .now() + SearchOpenMotion.contentHandoffDelay) {
        guard
          transitionGeneration == generation,
          activeAction == action,
          phase == .expanding
        else { return }

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
          collapsedContentVisible = false
          contentVisible = true
        }

        // Let the field and keyboard appear while the short search-only morph
        // is still settling instead of serializing focus after its completion.
        DispatchQueue.main.async {
          guard
            transitionGeneration == generation,
            activeAction == action,
            phase == .expanding
          else { return }
          searchFocused = true
        }
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + completionDelay) {
      guard
        transitionGeneration == generation,
        activeAction == action,
        phase == .expanding
      else { return }
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        if action != .search {
          readabilityVisible = true
        }
        contentVisible = true
        collapsedContentVisible = false
        phase = .expanded
      }
    }
  }

  private func closeMenu() {
    guard phase == .expanded || phase == .expanding else { return }
    let closeDuration = activeAction == .search ? 0.17 : 0.20
    let isSearchClose = activeAction == .search
    let isAddHandoffClose = activeAction == .add && addHandoffSelectionPending
    transitionGeneration += 1
    let generation = transitionGeneration
    resetAddHandoffSelection()
    if isSearchClose {
      lockCompactAddInteraction()
    }
    phase = .closing
    searchFocused = false

    if isAddHandoffClose {
      // RN keeps this host fully transparent until the final 118ms return
      // window. Prime the collapsed glyphs now, without their usual internal
      // fade, so the returning glass surface can never precede its icons.
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        collapsedContentVisible = true
      }
    }

    if isSearchClose {
      withAnimation(.easeOut(duration: 0.07)) {
        readabilityVisible = false
      }
    } else {
      withAnimation(.easeOut(duration: 0.07)) {
        contentVisible = false
        readabilityVisible = false
      }
    }

    withAnimation(morphAnimation(duration: closeDuration)) {
      morphProgress = 0
    }

    if !isSearchClose && !isAddHandoffClose {
      DispatchQueue.main.asyncAfter(deadline: .now() + closeDuration * 0.55) {
        guard transitionGeneration == generation, phase == .closing else { return }
        withAnimation(.easeOut(duration: 0.10)) {
          collapsedContentVisible = true
        }
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + closeDuration) {
      guard transitionGeneration == generation, phase == .closing else { return }

      guard isSearchClose else {
        phase = .collapsed
        model.handleOpenChange(false)
        return
      }

      // Swap to the compact glyphs on the exact frame the reverse morph
      // completes. If the glyphs appear before `phase` becomes collapsed,
      // users can see a search button that still rejects taps.
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        contentVisible = false
        collapsedContentVisible = true
        phase = .collapsed
      }
      model.handleOpenChange(false)
    }
  }

  private func lockCompactAddInteraction() {
    compactAddLockGeneration += 1
    let lockGeneration = compactAddLockGeneration
    compactAddInteractionLocked = true

    DispatchQueue.main.asyncAfter(
      deadline: .now()
        + 0.17
        + SearchCloseMotion.addInteractionSettleDelay
    ) {
      guard compactAddLockGeneration == lockGeneration else { return }
      compactAddInteractionLocked = false
    }
  }

  private func morphAnimation(duration: Double) -> Animation {
    .timingCurve(0.28, 0.28, 0.22, 1.0, duration: duration)
  }

  private func closeOrResetMenu() {
    if addHandoffSelectionPending {
      // RN already owns an exact copy of the add surface. Reset the hidden
      // SwiftUI tree in one transaction instead of running a second 200ms
      // glass morph underneath the RN animation.
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        transitionGeneration += 1
        expansionPending = false
        resetAddHandoffSelection()
        contentVisible = false
        readabilityVisible = false
        searchFocused = false
        collapsedContentVisible = true
        phase = .collapsed
        morphProgress = 0
      }
      model.handleOpenChange(false)
      return
    }

    if expansionPending {
      transitionGeneration += 1
      expansionPending = false
      resetAddHandoffSelection()
      model.handleOpenChange(false)
      return
    }

    // React may enqueue another close request before its disabled backdrop
    // state commits. The first reverse morph owns this transition; treating a
    // repeated request as an immediate reset makes the pill visibly snap.
    if phase == .closing {
      return
    }

    closeSearchActionIfNeeded()
    closeMenu()
  }

  private func closeMenuFromOutsideTap() {
    closeSearchActionIfNeeded()
    closeMenu()
  }

  private func closeSearchActionIfNeeded() {
    guard activeAction == .search, phase == .expanded || phase == .expanding else { return }

    if !model.searchQuery.isEmpty {
      model.searchQuery = ""
      model.handleSearchTextChange("")
    }

    model.handleSearchClose()
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
    guard activeAction == .add, phase == .expanded || phase == .expanding else { return }
    guard !addHandoffSelectionPending else { return }

    addHandoffSelectionPending = true

    // Keep the native menu static while RN takes over. Animating a selected
    // row here forced SwiftUI to redraw underneath the simultaneous RN scale
    // animation and caused repeatable dropped frames.
    action()
  }

  private func resetAddHandoffSelection() {
    addHandoffSelectionPending = false
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

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
      guard activeAction == .add, phase == .expanded || phase == .expanding else { return }
      switch requestedAction {
      case .quick:
        triggerQuickAddAction()
      case .manual:
        triggerManualAddAction()
      }
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
    ViewModeGlyphMark(mode: mode, color: color)
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
      // Compatibility only: compact is no longer exposed as a selectable
      // calendar mode, but a stale JS/native state must still render safely
      // while Fast Refresh or a persisted session settles on a valid mode.
      VStack(spacing: 4.4) {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 2.15)
          .frame(width: 24, height: 8)
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 2.15)
          .frame(width: 24, height: 8)
      }
	    case "stack":
	      Image(systemName: "rectangle.grid.1x2")
	        .font(.system(size: 22, weight: .regular))
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
      Image(systemName: "rectangle.grid.1x2")
        .font(.system(size: 22, weight: .regular))
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
    ZStack(alignment: .leading) {
      selectedBackground

      HStack(spacing: showsSelectionIndicator ? 3 : 12) {
        if let mode {
          ViewModeGlyphMark(mode: mode, color: foregroundColor)
            .frame(width: 26, height: 26)
            .frame(width: 32)
        }

        Text(label)
          .font(.system(size: 16, weight: selected ? .bold : .semibold))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .foregroundStyle(foregroundColor)
      .padding(.horizontal, showsSelectionIndicator ? 9 : 12)

      if showsSelectionIndicator && selected {
        Image(systemName: "checkmark")
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(foregroundColor)
          .frame(width: 22, height: 40)
        .offset(x: -9)
      }
    }
    .frame(height: 40)
  }

  @ViewBuilder
  private var selectedBackground: some View {
    if selected && !showsSelectionIndicator {
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

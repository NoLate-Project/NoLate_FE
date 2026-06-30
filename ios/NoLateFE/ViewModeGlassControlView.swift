import SwiftUI
import UIKit

private final class ViewModeGlassControlModel: ObservableObject {
  @Published var selectedMode: String
  @Published var disabled: Bool
  @Published var colorScheme: String
  @Published var prototypeTapRequest = 0
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

  @objc var tapRequest: NSNumber = 0 {
    didSet {
      guard tapRequest.intValue != oldValue.intValue else { return }
      model.prototypeTapRequest += 1
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
              .font(.system(size: iconSize(for: leadingSymbol), weight: .semibold))
          }

          if !model.label.isEmpty {
            Text(model.label)
              .font(.system(size: 20, weight: .heavy))
              .lineLimit(1)
              .minimumScaleFactor(0.78)
          }

          if !model.trailingSymbolName.isEmpty {
            Image(systemName: model.trailingSymbolName)
              .font(.system(size: iconSize(for: model.trailingSymbolName), weight: .semibold))
          }
        }
        .foregroundStyle(glyphColor)
        .frame(width: model.buttonWidth, height: model.buttonHeight)
      }
      .frame(width: model.buttonWidth, height: model.buttonHeight)
    }
    .buttonStyle(.plain)
    .disabled(model.disabled)
    .accessibilityLabel(accessibilityLabel)
  }

  @ViewBuilder
  private var surface: some View {
    let shape = RoundedRectangle(cornerRadius: model.buttonHeight / 2, style: .continuous)

    if #available(iOS 26.0, *) {
      shape
        .fill(Color.white.opacity(0.08))
        .glassEffect(
          .regular
            .tint(Color.black.opacity(0.04))
            .interactive(!model.disabled),
          in: shape
        )
        .overlay(liquidHighlight.clipShape(shape))
        .overlay(
          shape.stroke(Color.white.opacity(0.24), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.16), radius: 12, x: 0, y: 7)
    } else {
      shape
        .fill(
          LinearGradient(
            colors: [
              Color.white.opacity(0.2),
              Color.black.opacity(0.48),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .overlay(liquidHighlight.clipShape(shape))
        .overlay(
          shape.stroke(Color.white.opacity(0.24), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.16), radius: 12, x: 0, y: 7)
    }
  }

  private var liquidHighlight: LinearGradient {
    LinearGradient(
      colors: [
        Color.white.opacity(0.22),
        Color.white.opacity(0.08),
        Color.black.opacity(0.05),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
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
      return 27
    case "chevron.left":
      return 24
    default:
      return 25
    }
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
  @FocusState private var searchFocused: Bool

  private let collapsedWidth: CGFloat = 174
  private let collapsedHeight: CGFloat = 58
  private let collapsedSlotWidth: CGFloat = 58
  private let expandedWidth: CGFloat = 292
  private let expandedHeight: CGFloat = 296
  private let collapsedRadius: CGFloat = 29
  private let expandedRadius: CGFloat = 32

  private let options: [ViewModeGlassOption] = [
    ViewModeGlassOption(id: "compact", label: "축소형"),
    ViewModeGlassOption(id: "stack", label: "스택형"),
    ViewModeGlassOption(id: "detail", label: "상세형"),
    ViewModeGlassOption(id: "list", label: "목록형"),
  ]

  var body: some View {
    ZStack(alignment: .topTrailing) {
      if #available(iOS 26.0, *) {
        nativeLiquidMenu
      } else {
        fallbackLiquidMenu
      }
    }
    .frame(width: rootWidth, height: expandedHeight, alignment: .topTrailing)
    .accessibilityElement(children: .contain)
    .onChange(of: model.prototypeTapRequest) { _ in
      guard phase == .collapsed else { return }
      openMenu(.view)
    }
  }

  @available(iOS 26.0, *)
  private var nativeLiquidMenu: some View {
    ZStack(alignment: .topTrailing) {
      liquidMenuObject(nativeSurface: true)
    }
    .frame(width: rootWidth, height: expandedHeight, alignment: .topTrailing)
  }

  private var fallbackLiquidMenu: some View {
    liquidMenuObject(nativeSurface: false)
      .frame(width: rootWidth, height: expandedHeight, alignment: .topTrailing)
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

      collapsedContent
        .frame(width: collapsedWidth, height: collapsedHeight)
        .opacity(collapsedContentOpacity)
        .scaleEffect(collapsedContentScale, anchor: .topTrailing)
        .blur(radius: collapsedContentBlur)
        .animation(.easeOut(duration: 0.12), value: morphProgress)
        .allowsHitTesting(phase == .collapsed)

      expandedContent
        .frame(width: surfaceWidth, height: surfaceHeight)
        .opacity(contentVisible ? 1 : 0)
        .offset(y: contentVisible ? 0 : -10)
        .scaleEffect(contentVisible ? 1 : 0.985, anchor: .topTrailing)
        .animation(.easeOut(duration: 0.22), value: contentVisible)
        .allowsHitTesting(contentVisible)
    }
    .frame(width: surfaceWidth, height: surfaceHeight, alignment: .topTrailing)
    .clipShape(liquidShape)
    .contentShape(liquidShape)
    .shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowYOffset)
    .animation(.interactiveSpring(response: 0.5, dampingFraction: 0.94, blendDuration: 0.06), value: morphProgress)
    .accessibilityLabel(phase == .collapsed ? "View mode" : "View mode menu")
    .accessibilityHint(phase == .collapsed ? "Opens the view mode menu" : "Choose a view mode")
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
      .overlay(liquidStroke)
  }

  private var fallbackLiquidSurface: some View {
    liquidShape
      .fill(fallbackLiquidFill)
      .frame(width: surfaceWidth, height: surfaceHeight)
      .overlay(liquidHighlight)
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

  private var collapsedContent: some View {
    HStack(spacing: 0) {
      Button {
        openMenu(.view)
      } label: {
        prototypeModeGlyph(for: model.selectedMode, color: collapsedGlyphColor)
          .frame(width: 30, height: 30)
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
          .font(.system(size: 28, weight: .bold))
          .frame(width: collapsedSlotWidth, height: collapsedHeight)
      }
      .buttonStyle(LiquidToolbarIconButtonStyle(disabled: model.disabled))
      .accessibilityLabel("일정 검색")

      Button {
        openMenu(.add)
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 30, weight: .bold))
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
      return Color.white.opacity(Double(interpolate(from: 0.08, to: 0.035, amount: surfaceToneProgress)))
    }

    return Color.white.opacity(Double(interpolate(from: 0.12, to: 0.18, amount: surfaceToneProgress)))
  }

  private var surfaceNativeTint: Color {
    if isDarkMode {
      return Color.black.opacity(Double(interpolate(from: 0.04, to: 0.08, amount: surfaceToneProgress)))
    }

    return Color.white.opacity(Double(interpolate(from: 0.12, to: 0.18, amount: surfaceToneProgress)))
  }

  private var readabilityFill: Color {
    isDarkMode ? Color.black.opacity(0.18) : Color.white.opacity(0.13)
  }

  private var readabilityGradientColors: [Color] {
    if isDarkMode {
      return [
        Color.white.opacity(0.032),
        Color.black.opacity(0.035),
        Color.black.opacity(0.11),
      ]
    }

    return [
      Color.white.opacity(0.16),
      Color.white.opacity(0.07),
      Color.black.opacity(0.018),
    ]
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
    VStack(spacing: 6) {
      HStack {
        Spacer()

        Button {
          closeMenu()
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(expandedPrimaryColor)
            .frame(width: 34, height: 34)
            .background(Circle().fill(expandedControlFill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("보기 방식 메뉴 닫기")
      }
      .padding(.horizontal, 10)
      .padding(.bottom, 2)

      ForEach(options) { option in
        Button {
          selectMode(option.id)
        } label: {
          ViewModeGlassRow(
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
    VStack(alignment: .leading, spacing: 10) {
      actionHeader(title: "일정 등록")

      addActionRow(
        icon: "bolt.fill",
        title: "빠른 생성",
        subtitle: "문장으로 일정 만들기",
        action: model.handleQuickAdd
      )

      addActionRow(
        icon: "square.and.pencil",
        title: "직접 입력",
        subtitle: "날짜와 시간을 직접 설정",
        action: model.handleManualAdd
      )

      addActionRow(
        icon: "tag.fill",
        title: "카테고리 관리",
        subtitle: "분류와 색상 정리",
        action: model.handleManageCategories
      )

      Spacer()
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
  }

  private func actionHeader(title: String) -> some View {
    HStack(spacing: 10) {
      Text(title)
        .font(.system(size: 18, weight: .bold))
        .foregroundStyle(expandedPrimaryColor)

      Spacer()

      Button {
        closeMenu()
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(expandedPrimaryColor)
          .frame(width: 34, height: 34)
          .background(Circle().fill(expandedControlFill))
      }
      .buttonStyle(.plain)
      .accessibilityLabel("닫기")
    }
  }

  private func addActionRow(
    icon: String,
    title: String,
    subtitle: String,
    action: @escaping () -> Void
  ) -> some View {
    Button {
      triggerAddAction(action)
    } label: {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .font(.system(size: 18, weight: .bold))
          .foregroundStyle(expandedPrimaryColor.opacity(0.9))
          .frame(width: 34, height: 34)
          .background(Circle().fill(expandedControlFill))

        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(expandedPrimaryColor)

          Text(subtitle)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(expandedSecondaryColor)
        }

        Spacer()
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .background(
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .fill(expandedRowFill)
      )
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
    guard phase == .collapsed || phase == .expanding else { return 0 }
    return Double(1 - collapsedContentAbsorption) * (model.disabled ? 0.42 : 1)
  }

  private var collapsedContentScale: CGFloat {
    1 - collapsedContentAbsorption * 0.1
  }

  private var collapsedContentBlur: CGFloat {
    collapsedContentAbsorption * 4
  }

  private var collapsedContentAbsorption: CGFloat {
    guard phase == .collapsed || phase == .expanding else { return 1 }
    return smoothstep(edge0: 0.01, edge1: 0.12, x: morphProgress)
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
      return smoothstep(edge0: 0.02, edge1: 0.86, x: morphProgress)
    }

    let initialGrowth = smoothstep(edge0: 0.04, edge1: 0.34, x: morphProgress)
    let menuGrowth = smoothstep(edge0: 0.18, edge1: 0.92, x: morphProgress)
    return min(1, initialGrowth * 0.12 + menuGrowth * 0.88)
  }

  private var heightProgress: CGFloat {
    if activeAction == .search {
      return 0
    }

    let initialGrowth = smoothstep(edge0: 0.08, edge1: 0.38, x: morphProgress)
    let menuGrowth = smoothstep(edge0: 0.24, edge1: 0.94, x: morphProgress)
    return min(1, initialGrowth * 0.1 + menuGrowth * 0.9)
  }

  private var rootWidth: CGFloat {
    max(expandedWidth, model.searchExpandedWidth)
  }

  private var targetExpandedWidth: CGFloat {
    activeAction == .search ? max(collapsedWidth, model.searchExpandedWidth) : expandedWidth
  }

  private var targetExpandedHeight: CGFloat {
    activeAction == .search ? collapsedHeight : expandedHeight
  }

  private var finalProgress: CGFloat {
    smoothstep(edge0: 0.78, edge1: 1, x: morphProgress)
  }

  private var liquidHighlight: LinearGradient {
    let colors = isDarkMode ? [
      Color.white.opacity(Double(interpolate(from: 0.22, to: 0.11, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.08, to: 0.035, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.05, to: 0.07, amount: surfaceToneProgress))),
    ] : [
      Color.white.opacity(Double(interpolate(from: 0.34, to: 0.28, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.16, to: 0.12, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.018, to: 0.026, amount: surfaceToneProgress))),
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
          ? Color.white.opacity(Double(interpolate(from: 0.24, to: 0.16, amount: surfaceToneProgress)))
          : Color.white.opacity(Double(interpolate(from: 0.62, to: 0.54, amount: surfaceToneProgress))),
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
      Color.white.opacity(Double(interpolate(from: 0.2, to: 0.15, amount: surfaceToneProgress))),
      Color.black.opacity(Double(interpolate(from: 0.48, to: 0.74, amount: surfaceToneProgress))),
    ] : [
      Color.white.opacity(Double(interpolate(from: 0.78, to: 0.9, amount: surfaceToneProgress))),
      Color.white.opacity(Double(interpolate(from: 0.52, to: 0.68, amount: surfaceToneProgress))),
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
    if action == .search {
      model.searchQuery = ""
      model.handleSearchTextChange("")
      model.handleSearch()
    }
    readabilityVisible = false
    contentVisible = false
    searchFocused = false

    withAnimation(.easeOut(duration: 0.1)) {
      phase = .expanding
    }

    withAnimation(.interactiveSpring(response: 0.56, dampingFraction: 0.94, blendDuration: 0.06)) {
      morphProgress = 1
    }
    model.handleOpenChange(true)

    let readabilityDelay = action == .view ? 0.48 : 0.38
    let contentDelay = action == .search ? 0.2 : (action == .view ? 0.6 : 0.48)
    let readabilityThreshold: CGFloat = action == .view ? 0.82 : 0.72
    let contentThreshold: CGFloat = action == .search ? 0.48 : (action == .view ? 0.88 : 0.78)

    if action != .search {
      DispatchQueue.main.asyncAfter(deadline: .now() + readabilityDelay) {
        guard activeAction == action, morphProgress > readabilityThreshold, phase == .expanding else { return }
        withAnimation(.easeOut(duration: 0.16)) {
          readabilityVisible = true
        }
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + contentDelay) {
      guard activeAction == action, morphProgress > contentThreshold, phase == .expanding else { return }
      phase = .expanded
      withAnimation(.easeOut(duration: 0.22)) {
        contentVisible = true
      }
      if action == .search {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
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

    withAnimation(.easeInOut(duration: 0.14)) {
      contentVisible = false
      phase = .closing
      searchFocused = false
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
      guard phase == .closing else { return }
      withAnimation(.easeInOut(duration: 0.14)) {
        readabilityVisible = false
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) {
      guard phase == .closing else { return }
      withAnimation(.interactiveSpring(response: 0.46, dampingFraction: 0.96, blendDuration: 0.05)) {
        morphProgress = 0
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.76) {
      guard phase == .closing else { return }
      phase = .collapsed
      model.handleOpenChange(false)
    }
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
    case "compact":
      VStack(spacing: 4) {
        Capsule().fill(color).frame(width: 24, height: 4)
        HStack(spacing: 4) {
          Capsule().fill(color).frame(width: 4, height: 12)
          Capsule().fill(color).frame(width: 4, height: 12)
          Capsule().fill(color).frame(width: 4, height: 12)
        }
      }
    case "detail":
      VStack(spacing: 5) {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(color, lineWidth: 3)
          .frame(width: 25, height: 8)
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .stroke(color, lineWidth: 3)
          .frame(width: 25, height: 8)
          .overlay(alignment: .center) {
            Capsule().fill(color).frame(width: 12, height: 2)
          }
      }
    case "list":
      VStack(alignment: .leading, spacing: 5) {
        prototypeGlyphListRow(width: 24, color: color)
        prototypeGlyphListRow(width: 24, color: color)
        prototypeGlyphListRow(width: 18, color: color)
      }
    default:
      VStack(spacing: 5) {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 3)
          .frame(width: 26, height: 9)
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .stroke(color, lineWidth: 3)
          .frame(width: 26, height: 9)
      }
    }
  }

  private func prototypeGlyphListRow(width: CGFloat, color: Color = Color.white.opacity(0.94)) -> some View {
    HStack(spacing: 4) {
      Circle().fill(color).frame(width: 4, height: 4)
      Capsule().fill(color).frame(width: width, height: 3)
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
      .opacity(disabled ? 0.44 : (configuration.isPressed ? 0.68 : 1))
      .scaleEffect(configuration.isPressed ? 0.88 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

private struct ViewModeGlassRow: View {
  let label: String
  let selected: Bool
  let foregroundColor: Color
  let selectedFill: Color
  let selectedTint: Color
  let selectedStroke: Color
  let showsSelectionIndicator: Bool

  init(
    label: String,
    selected: Bool,
    foregroundColor: Color = Color.white,
    selectedFill: Color = Color.white.opacity(0.08),
    selectedTint: Color = Color.white.opacity(0.14),
    selectedStroke: Color = Color.white.opacity(0.16),
    showsSelectionIndicator: Bool = true
  ) {
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
          .font(.system(size: 17, weight: selected ? .bold : .semibold))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .foregroundStyle(foregroundColor)
      .padding(.horizontal, 14)
    }
    .frame(height: 48)
  }

  @ViewBuilder
  private var selectedBackground: some View {
    if selected && showsSelectionIndicator {
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

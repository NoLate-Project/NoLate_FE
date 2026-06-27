import SwiftUI
import UIKit

@objc(ViewModeLiquidDropdownView)
final class ViewModeLiquidDropdownView: UIView {
  @objc var visible: Bool = false {
    didSet {
      isHidden = !visible
      updateRootView()
    }
  }

  @objc var selectedMode: NSString = "compact" {
    didSet {
      updateRootView()
    }
  }

  @objc var onSelect: ((NSDictionary) -> Void)?
  @objc var onClose: ((NSDictionary) -> Void)?

  private var hostingController: UIHostingController<ViewModeLiquidDropdownRootView>?

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
    isHidden = !visible

    let controller = UIHostingController(rootView: makeRootView())
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

  private func updateRootView() {
    hostingController?.rootView = makeRootView()
  }

  private func makeRootView() -> ViewModeLiquidDropdownRootView {
    ViewModeLiquidDropdownRootView(
      visible: visible,
      selectedMode: selectedMode as String,
      onSelect: { [weak self] mode in
        self?.onSelect?(["mode": mode] as NSDictionary)
        self?.onClose?(["reason": "select"] as NSDictionary)
      },
      onClose: { [weak self] in
        self?.onClose?(["reason": "close"] as NSDictionary)
      }
    )
  }
}

private struct ViewModeLiquidDropdownRootView: View {
  let visible: Bool
  let selectedMode: String
  let onSelect: (String) -> Void
  let onClose: () -> Void

  private let options: [ViewModeLiquidOption] = [
    ViewModeLiquidOption(id: "compact", label: "축소형"),
    ViewModeLiquidOption(id: "stack", label: "스택형"),
    ViewModeLiquidOption(id: "detail", label: "상세형"),
    ViewModeLiquidOption(id: "list", label: "목록형"),
  ]

  var body: some View {
    Group {
      if visible {
        surface
      } else {
        Color.clear
      }
    }
  }

  @ViewBuilder
  private var surface: some View {
    if #available(iOS 26.0, *) {
      // Liquid Glass will be added in the next pass; keep this skeleton compile-safe.
      placeholderSurface
    } else {
      placeholderSurface
    }
  }

  private var placeholderSurface: some View {
    VStack(spacing: 4) {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Native ViewModeDropdown")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.78))

          Text("selectedMode: \(selectedMode)")
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Color.white)
        }

        Spacer()

        Button {
          onClose()
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(Color.white)
            .frame(width: 32, height: 32)
            .background(Circle().fill(Color.white.opacity(0.14)))
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 14)
      .padding(.bottom, 6)

      ForEach(options) { option in
        Button {
          onSelect(option.id)
        } label: {
          ViewModeLiquidDropdownRow(
            label: option.label,
            selected: option.id == selectedMode
          )
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.vertical, 10)
    .padding(.horizontal, 10)
    .background(
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .fill(Color.black.opacity(0.76))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .stroke(Color.white.opacity(0.16), lineWidth: 1)
    )
    .shadow(color: Color.black.opacity(0.28), radius: 22, x: 0, y: 14)
  }
}

private struct ViewModeLiquidDropdownRow: View {
  let label: String
  let selected: Bool

  var body: some View {
    HStack(spacing: 12) {
      Group {
        if selected {
          Image(systemName: "checkmark")
            .font(.system(size: 17, weight: .bold))
        } else {
          Color.clear
        }
      }
      .frame(width: 22)

      Text(label)
        .font(.system(size: 17, weight: .semibold))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .foregroundStyle(Color.white)
    .padding(.horizontal, 14)
    .frame(height: 48)
    .background(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .fill(selected ? Color.white.opacity(0.14) : Color.clear)
    )
  }
}

private struct ViewModeLiquidOption: Identifiable {
  let id: String
  let label: String
}

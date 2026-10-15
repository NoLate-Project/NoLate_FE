// Simulator-only host for the real iOS share sheet. Never embedded in NoLate.
import UIKit

@main
final class TicketShareFixtureApp: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Fixture", sessionRole: session.role)
    config.delegateClass = TicketShareFixtureScene.self
    return config
  }
}
final class TicketShareFixtureScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    window = UIWindow(windowScene: scene)
    window?.rootViewController = TicketShareFixtureController()
    window?.makeKeyAndVisible()
  }
}
final class TicketShareFixtureController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .systemBackground
    let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
    for label in ["기차 이미지 공유 테스트", "기차 텍스트 공유 테스트", "시외버스 이미지 공유 테스트", "시외버스 PDF 공유 테스트", "시외버스 스캔 PDF 공유 테스트"] {
      let button = UIButton(type: .system); button.setTitle(label, for: .normal)
      button.accessibilityIdentifier = label
      button.addAction(UIAction { [weak self] _ in self?.share(label) }, for: .touchUpInside)
      stack.addArrangedSubview(button)
    }
    view.addSubview(stack)
    NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
  }
  private var text: String {
    let f = DateFormatter(); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd"
    return "기차 승차권 테스트\n\(f.string(from: Date().addingTimeInterval(86400)))\n수서 → 공주\nSRT 615\n출발 12:20\n도착 13:12"
  }
  private func share(_ label: String) {
    let bus = label.contains("시외버스")
    let value = bus ? text.replacingOccurrences(of: "기차", with: "시외버스").replacingOccurrences(of: "수서 → 공주", with: "인천공항2터미널 → 청주").replacingOccurrences(of: "SRT 615", with: "우등").replacingOccurrences(of: "13:12", with: "14:45") + "\n예매 취소 안내: 취소수수료는 예매처에서 확인" : text
    let image = UIGraphicsImageRenderer(size: CGSize(width: 1000, height: 900)).image { context in
      UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1000, height: 900))
      (value as NSString).draw(in: CGRect(x: 70, y: 70, width: 860, height: 760), withAttributes: [.font: UIFont.systemFont(ofSize: 48), .foregroundColor: UIColor.black])
    }
    let item: Any
    if label.contains("PDF") {
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("SyntheticBusTicket.pdf")
      let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 1000, height: 900))
      try! renderer.writePDF(to: url) { context in
        context.beginPage()
        if label.contains("스캔") { image.draw(in: CGRect(x: 0, y: 0, width: 1000, height: 900)) }
        else { (value as NSString).draw(in: CGRect(x: 70, y: 70, width: 860, height: 760), withAttributes: [.font: UIFont.systemFont(ofSize: 48), .foregroundColor: UIColor.black]) }
      }
      item = url
    } else { item = label.contains("이미지") ? image : value }
    present(UIActivityViewController(activityItems: [item], applicationActivities: nil), animated: true)
  }
}

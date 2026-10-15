// Simulator-only URL handler. Never embedded in NoLate or presented as Korail.
import UIKit

@main
final class TrainBookingFixtureApp: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "SyntheticBooking", sessionRole: session.role)
    config.delegateClass = TrainBookingFixtureScene.self
    return config
  }
}

final class TrainBookingFixtureScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private let urlLabel = UILabel()

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let controller = UIViewController(); controller.view.backgroundColor = .systemBackground
    let notice = UILabel(); notice.text = "코레일 앱 연결 테스트용 · 실제 코레일 앱 아님"
    notice.numberOfLines = 0; notice.textAlignment = .center
    urlLabel.numberOfLines = 0; urlLabel.textAlignment = .center
    let stack = UIStackView(arrangedSubviews: [notice, urlLabel]); stack.axis = .vertical; stack.spacing = 24
    stack.translatesAutoresizingMaskIntoConstraints = false
    controller.view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -24),
    ])
    window = UIWindow(windowScene: scene); window?.rootViewController = controller; window?.makeKeyAndVisible()
    receive(options.urlContexts)
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) { receive(contexts) }

  private func receive(_ contexts: Set<UIOpenURLContext>) {
    let received = contexts.first?.url.absoluteString
    urlLabel.text = received == "korailtalk://gotoMainViewContoller" ? received : "Unexpected or missing main-screen URL"
  }
}

import Expo
import FirebaseCore
import kakao_login
import NaverThirdPartyLogin
import NoLateLiveActivity
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  private var initialLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)
    initialLaunchOptions = launchOptions

#if os(iOS) || os(tvOS)
// @generated begin @react-native-firebase/app-didFinishLaunchingWithOptions - expo prebuild (DO NOT MODIFY) sync-10e8520570672fd76b2403b7e1e27f5198a6349a
FirebaseApp.configure()
// @generated end @react-native-firebase/app-didFinishLaunchingWithOptions
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func connectWindow(to scene: UIWindowScene, options: UIScene.ConnectionOptions) -> UIWindow {
    if let window {
      window.windowScene = scene
      window.makeKeyAndVisible()
      return window
    }

    var launchOptions = initialLaunchOptions ?? [:]
    if let context = options.urlContexts.first {
      launchOptions[.url] = context.url
      launchOptions[.sourceApplication] = context.options.sourceApplication
      launchOptions[.annotation] = context.options.annotation
    }
    if let activity = options.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    if let response = options.notificationResponse {
      launchOptions[.remoteNotification] = response.notification.request.content.userInfo
    }

    let window = UIWindow(windowScene: scene)
    self.window = window
    reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)

#if DEBUG
    if ProcessInfo.processInfo.arguments.contains("-NoLateLiveActivityPreview") {
      NoLateLiveActivityDebugBridge.resetAndStartPreview()
    }
#endif
    initialLaunchOptions = nil
    return window
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if url.scheme == "kakao9586a8e3a28f3a6fbe3e23b9b34ec206" || kakao_login.RNKakaoLogins.isKakaoTalkLoginUrl(url) {
      return kakao_login.RNKakaoLogins.handleOpen(url)
    }
    if url.scheme == "nolate-naver" {
      return NaverThirdPartyLoginConnection.getSharedInstance().application(app, open: url, options: options)
    }
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

// SDK 54 does not yet supply ExpoAppSceneDelegate. Forward scene events to the
// existing Expo subscribers and social-login handlers until the SDK is upgraded.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    window = appDelegate?.connectWindow(to: windowScene, options: connectionOptions)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

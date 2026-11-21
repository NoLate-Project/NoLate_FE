// Simulator-only host for the real iOS share sheet. Never embedded in NoLate.
import UIKit
import UniformTypeIdentifiers
import WebKit

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
// A browser exposes a URL for activity matching, then adds preprocessing output
// after the user selects an extension. A property list offered up front does not
// reproduce that lifecycle in UIActivityItemsConfiguration.
final class TicketPageShareSource: NSObject, UIActivityItemSource {
  enum Content { case page([String: Any]), caption(String), linkTitle(String) }
  let content: Content
  private let url: URL
  init(_ content: Content, url: URL = URL(string: "https://WWW.KORAIL.COM/ticket?code=synthetic-secret")!) {
    self.content = content
    self.url = url
  }
  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { url }
  func activityViewController(_ activityViewController: UIActivityViewController, dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?) -> String { UTType.url.identifier }
  func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
    let item = NSExtensionItem()
    let additional: NSItemProvider
    switch content {
    case .linkTitle(let title):
      item.attributedTitle = NSAttributedString(string: title)
      item.attachments = [NSItemProvider(object: url as NSURL)]
      return item
    case .page(let result):
      let page: NSDictionary = [NSExtensionJavaScriptPreprocessingResultsKey: result]
      additional = NSItemProvider(item: page, typeIdentifier: UTType.propertyList.identifier)
    case .caption(let title):
      additional = NSItemProvider(object: title as NSString)
    }
    item.attachments = [NSItemProvider(object: url as NSURL), additional]
    return item
  }
}
final class TicketShareFixtureController: UIViewController, WKNavigationDelegate {
  private let pageShareButton = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .systemBackground
    if ProcessInfo.processInfo.arguments.contains("--webkit-smart-ticket") {
      showWebKitTicket()
      return
    }
    if ProcessInfo.processInfo.arguments.contains("--export-smart-ticket-photo") {
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      try? smartTicketScreenshot().jpegData(compressionQuality: 0.90)?.write(to: directory.appendingPathComponent("NoLateSmartTicketFixture.jpg"), options: .atomic)
    }
    let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
    let labels = ProcessInfo.processInfo.arguments.contains("--smart-ticket-pdf-fixtures")
      ? ["스마트티켓 텍스트 PDF 공유 테스트", "스마트티켓 스캔 PDF 공유 테스트",
         "스마트티켓 혼합 PDF 공유 테스트", "스마트티켓 환불 혼합 PDF 공유 테스트"]
      : ProcessInfo.processInfo.arguments.contains("--labelled-ticket-fixtures")
      ? ["시각 표시 텍스트", "시각 표시 PDF", "출발 시각 누락 텍스트", "심야 시외버스 PDF"]
      : ProcessInfo.processInfo.arguments.contains("--carrier-app-links")
      ? ["티머니GO 앱 링크 URL", "코레일톡 앱 링크 텍스트", "전달받은 승차권 링크 미리보기", "전달받은 승차권 링크 메시지", "승차권 상세와 전달 링크"]
      : ["기차 이미지 공유 테스트", "기차 텍스트 공유 테스트", "시외버스 이미지 공유 테스트", "시외버스 PDF 공유 테스트", "시외버스 스캔 PDF 공유 테스트", "취소된 기차 표 공유 테스트", "여러 페이지 PDF 공유 테스트", "기차 링크 공유 테스트", "기차 웹페이지 본문 공유 테스트", "스마트티켓 화면 공유 테스트", "제목과 승차권 링크 공유 테스트"]
    for label in labels {
      let button = UIButton(type: .system); button.setTitle(label, for: .normal)
      button.accessibilityIdentifier = label
      button.addAction(UIAction { [weak self] _ in self?.share(label) }, for: .touchUpInside)
      stack.addArrangedSubview(button)
    }
    view.addSubview(stack)
    NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
  }

  private func showWebKitTicket() {
    let args = ProcessInfo.processInfo.arguments
    let host: String
    if args.contains("--intercity-web-ticket") { host = "intercitybus.tmoney.co.kr" }
    else if args.contains("--express-web-ticket") { host = "www.kobus.co.kr" }
    else { host = "www.korail.com" }
    let pageURL = URL(string: "https://\(host)/ticket?code=synthetic-secret")!
    let web = WKWebView()
    web.navigationDelegate = self
    pageShareButton.setTitle("스마트티켓 웹페이지 공유 테스트", for: .normal)
    pageShareButton.isEnabled = false
    let script = try! String(contentsOf: Bundle.main.url(forResource: "TicketWebPage", withExtension: "js")!, encoding: .utf8)
    pageShareButton.addAction(UIAction { [weak self, weak web] _ in
      web?.callAsyncJavaScript(script + "\nreturn await new Promise(resolve => ExtensionPreprocessingJS.run({completionFunction: resolve}));",
                               arguments: [:], in: nil, in: .defaultClient) { result in
        guard case let .success(value) = result, let page = value as? [String: Any] else { return }
        self?.present(UIActivityViewController(activityItems: [TicketPageShareSource(.page(page), url: pageURL)], applicationActivities: nil), animated: true)
      }
    }, for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [web, pageShareButton])
    stack.axis = .vertical
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    let html = try! String(contentsOf: Bundle.main.url(forResource: "smart-ticket-print", withExtension: "html")!, encoding: .utf8)
    // The self-contained fixture loads from memory. CSP prohibits external resources.
    web.loadHTMLString(html, baseURL: pageURL)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let arguments = ProcessInfo.processInfo.arguments
    let setup: String
    if arguments.contains("--bus-booking-home") {
      setup = """
      document.querySelector('main').innerText = '시외버스 통합예매\\n승차권 예매·조회\\n출발지 선택\\n도착지 선택\\n가는시간 04:00\\n고객센터 09:00';
      """
    } else if arguments.contains("--intercity-web-ticket") || arguments.contains("--express-web-ticket") {
      setup = """
      const lines = ['모바일 승차권', '동서울 → 속초', '우등'];
      if (depDate && arrDate) lines.push('도착 일시 ' + arrDate + ' 오전 12:30', '출발 일시 ' + depDate + ' 오후 11:10');
      else lines.push('2026-11-12', '도착 오후 8:32', '출발 오후 6:43');
      document.querySelector('main').innerText = lines.join('\\n');
      """
    } else if arguments.contains("--reverse-web-ticket-dom") {
      // Keep the rendered trip identical while placing arrival first in innerText.
      setup = """
      const row = document.querySelector('section');
      row.dir = 'rtl';
      row.prepend(row.lastElementChild);
      document.querySelector('footer b').innerHTML = '<span>KTX</span> <span>255</span>';
      """
    } else if arguments.contains("--labelled-web-ticket") {
      setup = """
      document.querySelector('main p').textContent = '현재 04:07';
      document.querySelector('section').innerHTML = '<p>서울 → 동대구</p><div>도착 시각 8:32</div><div>출발 시각 6:43</div>';
      """
    } else if arguments.contains("--partial-web-ticket") {
      // A clock outside the card must not replace a missing arrival time.
      setup = """
      document.querySelector('section div:last-child time').remove();
      document.querySelector('main p').textContent = '04:07';
      """
    } else { setup = "" }
    let date = ProcessInfo.processInfo.environment["E2E_SMART_TICKET_DATE"] ?? ""
    webView.callAsyncJavaScript(setup + "\nif (date) document.querySelector('header span').textContent = date;",
                                arguments: ["date": date, "depDate": ProcessInfo.processInfo.environment["E2E_BUS_DEPARTURE_DATE"] ?? "",
                                            "arrDate": ProcessInfo.processInfo.environment["E2E_BUS_ARRIVAL_DATE"] ?? ""], in: nil, in: .defaultClient) { [weak self] result in
      if case .success = result { self?.pageShareButton.isEnabled = true }
    }
  }
  private var text: String {
    let f = DateFormatter(); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd"
    return "기차 승차권 테스트\n\(f.string(from: Date().addingTimeInterval(86400)))\n수서 → 공주\nSRT 615\n출발 12:20\n도착 13:12"
  }
  private func share(_ label: String) {
    if ProcessInfo.processInfo.arguments.contains("--carrier-app-links") {
      if label == "승차권 상세와 전달 링크" {
        let detail = "코레일 승차권\n2026-11-12\n서울 → 동대구\nKTX 255\n출발 06:43\n도착 08:32"
        let source = TicketPageShareSource(.caption(detail), url: URL(string: "https://share.example.invalid/view/KTX123")!)
        present(UIActivityViewController(activityItems: [source], applicationActivities: nil), animated: true)
        return
      }
      if label == "전달받은 승차권 링크 미리보기" {
        let source = TicketPageShareSource(.linkTitle("전달받은 승차권"), url: URL(string: "https://share.example.invalid/synthetic")!)
        present(UIActivityViewController(activityItems: [source], applicationActivities: nil), animated: true)
        return
      }
      if label == "전달받은 승차권 링크 메시지" {
        let message = "전달받은 승차권\nhttps://share.example.invalid/synthetic"
        present(UIActivityViewController(activityItems: [message], applicationActivities: nil), animated: true)
        return
      }
      let item: Any = label == "티머니GO 앱 링크 URL"
        ? URL(string: "tmoneytia://main/home")! as Any : "korailtalk://gotoMainViewContoller"
      present(UIActivityViewController(activityItems: [item], applicationActivities: nil), animated: true)
      return
    }
    if ProcessInfo.processInfo.arguments.contains("--labelled-ticket-fixtures") {
      let ticket: String
      if label == "심야 시외버스 PDF" {
        let environment = ProcessInfo.processInfo.environment
        let departure = environment["E2E_BUS_DEPARTURE_DATE"] ?? "2026-11-21"
        let arrival = environment["E2E_BUS_ARRIVAL_DATE"] ?? "2026-11-22"
        ticket = "시외버스 승차권\n출발지: 동서울\n도착지: 속초\n우등\n" +
          "도착 일시 \(arrival) 오전 12:30\n출발 일시 \(departure) 오후 11:10"
      } else {
        ticket = "코레일 승차권\n스마트티켓 1매\n2026-11-12\n서울 → 동대구\nKTX 255\n현재 04:07\n도착 시각 오후 8:32" +
          (label.contains("누락") ? "" : "\n출발 시각 오후 6:43")
      }
      let item: Any
      if label.contains("PDF") {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("LabelledTicket.pdf")
        let bounds = CGRect(x: 0, y: 0, width: 600, height: 720)
        try! UIGraphicsPDFRenderer(bounds: bounds).writePDF(to: url) { context in
          context.beginPage()
          (ticket as NSString).draw(in: bounds.insetBy(dx: 35, dy: 30), withAttributes: [.font: UIFont.systemFont(ofSize: 25)])
        }
        item = url
      } else { item = ticket }
      present(UIActivityViewController(activityItems: [item], applicationActivities: nil), animated: true)
      return
    }
    if label.hasPrefix("스마트티켓"), label.contains("PDF") {
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("SyntheticSmartTicket.pdf")
      let bounds = CGRect(origin: .zero, size: smartTicketSize)
      try! UIGraphicsPDFRenderer(bounds: bounds).writePDF(to: url) { context in
        context.beginPage()
        if label.contains("텍스트") { drawSmartTicket(in: context.cgContext) }
        else { smartTicketScreenshot().draw(in: bounds) }
        if label.contains("혼합") {
          let footer = label.contains("환불") ? "환불 완료" : "전자문서 사본"
          (footer as NSString).draw(at: CGPoint(x: 54, y: 1100), withAttributes: [.font: UIFont.systemFont(ofSize: 22)])
        }
      }
      present(UIActivityViewController(activityItems: [url], applicationActivities: nil), animated: true)
      return
    }
    if label == "스마트티켓 화면 공유 테스트" {
      present(UIActivityViewController(activityItems: [smartTicketScreenshot()], applicationActivities: nil), animated: true)
      return
    }
    if label.contains("웹페이지") {
      // Synthetic Safari preprocessing result, not a real Korail page. Include
      // the URL too so the test catches accidentally preferring it to the body.
      let result: [String: Any] = ["version": 1, "origin": "https://www.korail.com", "text": text]
      present(UIActivityViewController(activityItems: [TicketPageShareSource(.page(result))], applicationActivities: nil), animated: true)
      return
    }
    if label == "제목과 승차권 링크 공유 테스트" {
      present(UIActivityViewController(activityItems: [TicketPageShareSource(.caption("전달받은 승차권"))], applicationActivities: nil), animated: true)
      return
    }
    let bus = label.contains("시외버스")
    let value = bus ? text.replacingOccurrences(of: "기차", with: "시외버스").replacingOccurrences(of: "수서 → 공주", with: "인천공항2터미널 → 청주").replacingOccurrences(of: "SRT 615", with: "우등").replacingOccurrences(of: "13:12", with: "14:45") + "\n예매 취소 안내: 취소수수료는 예매처에서 확인" : text + (label.contains("취소된") ? "\n취소 완료" : "")
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
        if label.contains("여러 페이지") {
          context.beginPage()
          ("두 번째 합성 승차권" as NSString).draw(at: CGPoint(x: 70, y: 70), withAttributes: [.font: UIFont.systemFont(ofSize: 48)])
        }
      }
      item = url
    } else if label.contains("링크") { item = URL(string: "https://www.korail.com")! }
    else { item = label.contains("이미지") ? image : value }
    present(UIActivityViewController(activityItems: [item], applicationActivities: nil), animated: true)
  }

  // Two visual columns with an icon between them. Vision also sees a third
  // clock in the status bar. No passenger, reservation, QR or live URL is used.
  private let smartTicketSize = CGSize(width: 780, height: 1320)
  private func smartTicketScreenshot() -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: smartTicketSize, format: format).image { renderer in
      drawSmartTicket(in: renderer.cgContext)
    }
  }

  private func drawSmartTicket(in cg: CGContext) {
    func fill(_ rect: CGRect, _ color: UIColor) {
      cg.setFillColor(color.cgColor)
      cg.fill(rect)
    }
    func label(_ text: String, centerX: CGFloat, top: CGFloat, size: CGFloat, color: UIColor = .black) {
      let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size), .foregroundColor: color]
      let value = text as NSString
      value.draw(at: CGPoint(x: centerX - value.size(withAttributes: attributes).width / 2, y: top), withAttributes: attributes)
    }
    fill(CGRect(origin: .zero, size: smartTicketSize), .white)
    fill(CGRect(x: 0, y: 0, width: 780, height: 145), .black)
    label("4:07", centerX: 84, top: 14, size: 34, color: .white)
    label("www.korail.com", centerX: 390, top: 78, size: 30, color: .white)
    label("캡처한 승차권은 사용하실 수 없습니다.", centerX: 390, top: 176, size: 28)
    fill(CGRect(x: 40, y: 246, width: 700, height: 80), .systemBlue)
    let date = ProcessInfo.processInfo.environment["E2E_SMART_TICKET_DATE"] ?? "2026년11월12일(목)"
    label(date, centerX: 215, top: 264, size: 32, color: .white)
    label("스마트티켓 1매", centerX: 610, top: 264, size: 32, color: .white)
    label("서울", centerX: 202, top: 386, size: 58)
    label("동대구", centerX: 574, top: 386, size: 58)
    cg.setStrokeColor(UIColor.darkGray.cgColor)
    cg.setLineWidth(2)
    cg.strokeEllipse(in: CGRect(x: 365, y: 414, width: 50, height: 50))
    cg.move(to: CGPoint(x: 377, y: 439)); cg.addLine(to: CGPoint(x: 402, y: 439))
    cg.move(to: CGPoint(x: 393, y: 431)); cg.addLine(to: CGPoint(x: 402, y: 439))
    cg.addLine(to: CGPoint(x: 393, y: 447)); cg.strokePath()
    label("06:43", centerX: 202, top: 483, size: 42)
    label("08:32", centerX: 574, top: 483, size: 42)
    fill(CGRect(x: 54, y: 592, width: 672, height: 80), UIColor(white: 0.94, alpha: 1))
    label("KTX 255", centerX: 175, top: 609, size: 38)
    label("열차시각", centerX: 620, top: 612, size: 32)
  }
}

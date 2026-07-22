import CoreLocation
import ExpoModulesCore
import Foundation
import TMapSDK
import UIKit
import VSMSDK

private struct NoLateTMapCommand {
  let sequence: Int
  let type: String
  let payload: [String: Any]
}

private struct NoLateTMapCamera: Equatable {
  let latitude: Double
  let longitude: Double
  let zoom: Int?
}

public final class NoLateTMapView: ExpoView, TMapViewDelegate {
  let onMapReady = EventDispatcher()
  let onMapError = EventDispatcher()
  let onMapTap = EventDispatcher()
  let onMarkerPress = EventDispatcher()
  let onCameraChange = EventDispatcher()

  private let mapView: TMapView
  private var appKey = ""
  private var latestData: [String: Any]?
  private var pendingCommands: [NoLateTMapCommand] = []

  private var mapDidFinishLoading = false
  private var apiKeySucceeded = false
  private var apiKeyFailed = false
  private var didEmitReady = false
  private var applyScheduled = false
  private var highestAcceptedCommandSequence = 0

  private var markerSignature: String?
  private var routeSignature: String?
  private var themeSignature: Bool?
  private var appliedCamera: NoLateTMapCamera?
  private var lastEmittedCamera: NoLateTMapCamera?
  private var lastRouteOverlayScope: String?

  private var markersByID: [String: TMapMarker] = [:]
  private var markerConfigurationSignaturesByID: [String: String] = [:]
  private var polylines: [TMapPolyline] = []
  private var trafficLines: [TMapTrafficLine] = []
  private var cameraEventWorkItem: DispatchWorkItem?

  required public init(appContext: AppContext? = nil) {
    mapView = TMapView(frame: .zero)
    super.init(appContext: appContext)

    clipsToBounds = true
    mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    mapView.delegate = self
    mapView.set(minZoom: 6, maxZoom: 18)
    mapView.isPanningEnable = true
    mapView.isZoomEnable = true
    mapView.isRotationEnable = true
    mapView.isTiltEnable = true
    mapView.setTMapLogoPosition(.bottomLeft)
    addSubview(mapView)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    if mapView.frame != bounds {
      mapView.frame = bounds
    }
  }

  func setAppKey(_ rawAppKey: String) {
    let nextAppKey = rawAppKey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard nextAppKey != appKey else {
      return
    }

    appKey = nextAppKey
    apiKeySucceeded = false
    apiKeyFailed = false
    didEmitReady = false
    if nextAppKey.isEmpty {
      emitMapError(code: "TMAP_APP_KEY_EMPTY", message: "TMAP app key is empty.")
      return
    }
    mapView.setApiKey(nextAppKey)
  }

  func setData(_ data: [String: Any]) {
    latestData = data
    scheduleApply()
  }

  func setCommand(_ command: [String: Any]) {
    let incoming: [[String: Any]]
    if NoLateTMapValue.string(command["type"]) == "batch",
       let payload = NoLateTMapValue.dictionary(command["payload"]) {
      incoming = NoLateTMapValue.dictionaries(payload["commands"])
    } else {
      incoming = [command]
    }

    let freshCommands = incoming.compactMap(parseCommand)
      .filter { $0.sequence > highestAcceptedCommandSequence }
      .sorted { $0.sequence < $1.sequence }
    guard !freshCommands.isEmpty else {
      return
    }

    for command in freshCommands {
      highestAcceptedCommandSequence = max(highestAcceptedCommandSequence, command.sequence)
      pendingCommands.append(command)
    }
    if pendingCommands.count > 64 {
      pendingCommands.removeFirst(pendingCommands.count - 64)
    }
    scheduleApply()
  }

  private func parseCommand(_ command: [String: Any]) -> NoLateTMapCommand? {
    guard
      let sequence = NoLateTMapValue.int(command["sequence"]),
      sequence > 0,
      let type = NoLateTMapValue.string(command["type"])
    else {
      return nil
    }
    return NoLateTMapCommand(
      sequence: sequence,
      type: type,
      payload: NoLateTMapValue.dictionary(command["payload"]) ?? [:]
    )
  }

  private func scheduleApply() {
    guard !applyScheduled else {
      return
    }
    applyScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        return
      }
      self.applyScheduled = false
      self.flushPendingStateIfReady()
    }
  }

  private func flushPendingStateIfReady() {
    guard mapDidFinishLoading, apiKeySucceeded, !apiKeyFailed, !appKey.isEmpty else {
      return
    }

    if !didEmitReady {
      didEmitReady = true
      onMapReady([
        "sdk": "tmap-ios-vector",
        "sdkVersion": "3.7",
        "nativeDirectionSupported": true
      ])
    }

    if let latestData {
      applyData(latestData)
    }
    executePendingCommands()
    scheduleCameraEvent(delay: 0.08)
  }

  private func applyData(_ data: [String: Any]) {
    applyTheme(data)
    applyMarkers(data)
    applyRoutes(data)
    applyCamera(data["camera"])
  }

  private func applyTheme(_ data: [String: Any]) {
    let isNight = NoLateTMapValue.bool(data["nightModeEnabled"]) ?? false
    guard themeSignature != isNight else {
      return
    }
    themeSignature = isNight
    mapView.setMapType(isNight ? .Night : .Default)
  }

  private func applyMarkers(_ data: [String: Any]) {
    let markerItems = data["markers"] ?? []
    let nextSignature = NoLateTMapValue.stableSignature(markerItems)
    guard markerSignature != nextSignature else {
      return
    }
    markerSignature = nextSignature

    let sortedItems = NoLateTMapValue.dictionaries(markerItems).sorted { lhs, rhs in
      (NoLateTMapValue.double(lhs["zIndex"]) ?? 0) < (NoLateTMapValue.double(rhs["zIndex"]) ?? 0)
    }
    var activeMarkerIDs = Set<String>()
    for (index, item) in sortedItems.enumerated() {
      guard
        let id = NoLateTMapValue.string(item["id"]),
        !id.isEmpty,
        let coordinate = NoLateTMapValue.coordinate(item)
      else {
        continue
      }

      let configurationSignature = markerConfigurationSignature(item, fallbackZIndex: index)
      let existingMarker = markersByID[id]
      let configurationChanged = existingMarker == nil ||
        markerConfigurationSignaturesByID[id] != configurationSignature
      let marker = configurationChanged
        ? TMapMarker(position: coordinate)
        : existingMarker!

      if configurationChanged {
        let artwork = NoLateTMapMarkerRenderer.artwork(for: item)
        marker.position = coordinate
        marker.icon = artwork.image
        marker.isUseImage = true
        marker.offset = artwork.offset
        marker.name = id
        marker.title = NoLateTMapValue.string(item["caption"])
        marker.opacity = 1
        marker.showPriority = Float(NoLateTMapValue.double(item["zIndex"]) ?? Double(index))

        let interactionId = NoLateTMapValue.string(item["interactionId"])
        marker.setTapCallback { [weak self] _ in
          guard let self else {
            return
          }
          var payload: [String: Any] = ["id": id]
          if let interactionId, !interactionId.isEmpty {
            payload["interactionId"] = interactionId
          }
          self.onMarkerPress(payload)
        }

        // TMapMarker 3.7 only pushes iconAnchor/icon changes into the VSM marker
        // while attaching it to a map. Attach the fully configured replacement
        // first, then remove the old marker so a zoom LOD change has no blank frame.
        marker.map = mapView
        existingMarker?.map = nil
      } else {
        // Position is one of the few marker properties propagated in place.
        marker.position = coordinate
      }
      activeMarkerIDs.insert(id)
      markersByID[id] = marker
      markerConfigurationSignaturesByID[id] = configurationSignature
    }

    let staleMarkerIDs = Set(markersByID.keys).subtracting(activeMarkerIDs)
    for id in staleMarkerIDs {
      markersByID.removeValue(forKey: id)?.map = nil
      markerConfigurationSignaturesByID.removeValue(forKey: id)
    }
  }

  private func markerConfigurationSignature(
    _ item: [String: Any],
    fallbackZIndex: Int
  ) -> String {
    // Coordinate-only updates use TMapMarker.position and do not need a new VSM
    // marker. Every other value can affect artwork, anchor, priority or taps and
    // therefore participates in the replacement signature.
    let coordinateKeys: Set<String> = [
      "lat", "lng", "latitude", "longitude", "coord", "coordinate"
    ]
    var configuration = item.filter { !coordinateKeys.contains($0.key) }
    if configuration["zIndex"] == nil {
      configuration["zIndex"] = fallbackZIndex
    }
    return NoLateTMapValue.stableSignature(configuration)
  }

  private func applyRoutes(_ data: [String: Any]) {
    let explicitOverlays = data["pathOverlays"] is [Any] || data["pathOverlays"] is NSArray
    let hasFallbackPath = data["pathCoords"] != nil
    let hasRouteControl = data["clearRouteOverlays"] != nil || data["routeOverlayScope"] != nil
    guard explicitOverlays || hasFallbackPath || hasRouteControl else {
      // Camera/theme-only updates must not remove the route already attached to the map.
      return
    }

    // Keep this signature limited to values that change an iOS route shape.
    // Camera, markers and pathOverlayZoom are handled elsewhere, while the
    // bundled TMapTrafficLine indicator ignores the app-only direction color
    // and opacity hints.
    let routeKeys = [
      "pathCoords",
      "pathColor",
      "pathWidth",
      "pathOutlineColor",
      "pathOutlineWidth",
      "clearRouteOverlays",
      "routeOverlayScope"
    ]
    var routePayload: [String: Any] = [:]
    routeKeys.forEach { routePayload[$0] = data[$0] ?? NSNull() }
    if explicitOverlays {
      routePayload["pathOverlays"] = routeSignatureOverlays(data["pathOverlays"])
    } else {
      routePayload["pathOverlays"] = NSNull()
    }
    let nextSignature = NoLateTMapValue.stableSignature(routePayload)
    guard routeSignature != nextSignature else {
      return
    }
    routeSignature = nextSignature

    let scope = NoLateTMapValue.string(data["routeOverlayScope"]) ?? ""
    if !scope.isEmpty, scope != lastRouteOverlayScope {
      clearRoutes()
      lastRouteOverlayScope = scope
    } else {
      clearRoutes()
    }

    if NoLateTMapValue.bool(data["clearRouteOverlays"]) == true {
      return
    }

    let overlays = NoLateTMapValue.dictionaries(data["pathOverlays"])
    if !overlays.isEmpty {
      let sortedOverlays = overlays.sorted { lhs, rhs in
        (NoLateTMapValue.double(lhs["zIndex"]) ?? 0) < (NoLateTMapValue.double(rhs["zIndex"]) ?? 0)
      }
      for (index, overlay) in sortedOverlays.enumerated() {
        renderRoute(overlay, fallbackID: "native-overlay-\(index)")
      }
      return
    }

    let fallbackCoordinates = NoLateTMapValue.coordinates(data["pathCoords"])
    if fallbackCoordinates.count >= 2 {
      renderRoute([
        "id": "route-selected-fallback",
        "coords": data["pathCoords"] ?? [],
        "color": data["pathColor"] ?? "#1D72FF",
        "width": data["pathWidth"] ?? 10,
        "outlineColor": data["pathOutlineColor"] ?? "#FFFFFF",
        "outlineWidth": data["pathOutlineWidth"] ?? 3,
        "strokeStyle": "solid"
      ], fallbackID: "route-selected-fallback")
    }
  }

  private func routeSignatureOverlays(_ value: Any?) -> [[String: Any]] {
    let ignoredKeys: Set<String> = [
      "nativeDirectionColor",
      "nativeDirectionOpacity"
    ]
    return NoLateTMapValue.dictionaries(value).map { overlay in
      overlay.filter { !ignoredKeys.contains($0.key) }
    }
  }

  private func renderRoute(_ overlay: [String: Any], fallbackID: String) {
    // `renderMode=screen` is a WebView-only fallback used for very long dotted
    // walking paths. The native facade has no screen-space canvas, so preserve
    // that route with TMAP's native dot line.
    let isScreenDotFallback = NoLateTMapValue.string(overlay["renderMode"]) == "screen"
      && NoLateTMapValue.string(overlay["shape"]) == "dot"
    if NoLateTMapValue.bool(overlay["drawLine"]) == false && !isScreenDotFallback {
      return
    }
    let coordinates = NoLateTMapValue.coordinates(overlay["coords"])
    guard coordinates.count >= 2 else {
      return
    }

    let routeID = NoLateTMapValue.string(overlay["id"]) ?? fallbackID
    let width = Float(max(1, NoLateTMapValue.double(overlay["width"]) ?? 10))
    let outlineWidth = Float(max(0, NoLateTMapValue.double(overlay["outlineWidth"]) ?? 2.5))
    let color = UIColor.noLateMapColor(
      overlay["color"],
      fallback: UIColor(red: 0.11, green: 0.45, blue: 1, alpha: 1),
      opacity: overlay["opacity"]
    )
    let outlineColor = UIColor.noLateMapColor(
      overlay["outlineColor"],
      fallback: .white,
      opacity: overlay["outlineOpacity"]
    )
    let style = lineStyle(for: overlay)
    let zIndex = Float(NoLateTMapValue.double(overlay["zIndex"]) ?? 0)
    let useNativeDirection = NoLateTMapValue.bool(overlay["nativeDirection"]) == true && style == .solid

    if useNativeDirection {
      let segment = TrafficLine()
      segment.traffic = 0
      segment.vertices = coordinates.map {
        VSMMapPoint(longitude: $0.longitude, latitude: $0.latitude)
      }
      let trafficLine = TMapTrafficLine(trafficLine: [segment])
      trafficLine.name = routeID
      trafficLine.width = width
      trafficLine.outlineWidth = outlineWidth
      trafficLine.prevColor = color
      trafficLine.nextColor = color
      trafficLine.prevOutlineColor = outlineColor
      trafficLine.nextOutlineColor = outlineColor
      trafficLine.showTrafficInfo = false
      trafficLine.showDirectionIndicator = true
      trafficLine.map = mapView
      trafficLines.append(trafficLine)
      return
    }

    // TMAP iOS의 dot casing은 본선과 별도 polyline이라 폭에 따라 반복 위상이
    // 달라질 수 있다. 점선은 한 벌만 그려 흰 사다리/이중 점 현상을 막는다.
    if outlineWidth > 0 && style != .dot {
      let outline = TMapPolyline(coordinates: coordinates)
      outline.name = "\(routeID):outline"
      outline.strokeColor = outlineColor
      outline.strokeWidth = CGFloat(width + (outlineWidth * 2))
      outline.opacity = 1
      outline.lineStyle = outlineLineStyle(for: overlay)
      outline.showPriority = tmapShowPriority(forAppZIndex: zIndex, layerOffset: 1)
      outline.map = mapView
      polylines.append(outline)
    }

    let polyline = TMapPolyline(coordinates: coordinates)
    polyline.name = routeID
    polyline.strokeColor = color
    polyline.strokeWidth = CGFloat(width)
    polyline.opacity = 1
    polyline.lineStyle = style
    polyline.showPriority = tmapShowPriority(forAppZIndex: zIndex)
    polyline.map = mapView
    polylines.append(polyline)
  }

  private func tmapShowPriority(forAppZIndex zIndex: Float, layerOffset: Float = 0) -> Float {
    // The app follows the usual z-index convention (larger is foreground),
    // while TMAP showPriority renders smaller values in front. Negating keeps
    // overlay ordering intact; the positive offset places casing behind its
    // corresponding route stroke.
    -zIndex + layerOffset
  }

  private func lineStyle(for overlay: [String: Any]) -> LineStyle {
    if NoLateTMapValue.string(overlay["shape"]) == "dot" || usesNativeWalkDotPattern(overlay) {
      return .dot
    }
    switch NoLateTMapValue.string(overlay["strokeStyle"]) {
    case "dash":
      return .dash
    case "dot":
      return .dot
    case "solid":
      return .solid
    default:
      if let dashPattern = overlay["dashPattern"] as? [Any], !dashPattern.isEmpty {
        return .dash
      }
      return .solid
    }
  }

  private func outlineLineStyle(for overlay: [String: Any]) -> LineStyle {
    // A solid casing under a one-point dash becomes a white ladder at close
    // zoom. TMAP iOS cannot consume the custom [paint, gap] array, so render
    // both layers with its native dot style to keep their phase aligned.
    if usesNativeWalkDotPattern(overlay) {
      return .dot
    }
    switch NoLateTMapValue.string(overlay["outlineStrokeStyle"]) {
    case "dash":
      return .dash
    case "dot":
      return .dot
    default:
      return .solid
    }
  }

  private func usesNativeWalkDotPattern(_ overlay: [String: Any]) -> Bool {
    guard NoLateTMapValue.string(overlay["strokeStyle"]) == "dash" else {
      return false
    }
    guard let values = overlay["dashPattern"] as? [Any], values.count >= 2 else {
      return false
    }
    guard
      let paintedLength = NoLateTMapValue.double(values[0]),
      let gapLength = NoLateTMapValue.double(values[1])
    else {
      return false
    }
    return paintedLength > 0 && paintedLength <= 2 && gapLength >= 8
  }

  private func applyCamera(_ value: Any?) {
    guard
      let dictionary = NoLateTMapValue.dictionary(value),
      let coordinate = NoLateTMapValue.coordinate(dictionary)
    else {
      return
    }
    let zoom = NoLateTMapValue.int(dictionary["zoom"]).map { NoLateTMapValue.clamp($0, min: 6, max: 18) }
    let camera = NoLateTMapCamera(
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      zoom: zoom
    )
    guard camera != appliedCamera else {
      return
    }
    appliedCamera = camera
    mapView.setCenter(coordinate)
    if let zoom {
      mapView.setZoom(zoom)
    }
  }

  private func executePendingCommands() {
    guard !pendingCommands.isEmpty else {
      return
    }
    let commands = pendingCommands
    pendingCommands.removeAll(keepingCapacity: true)
    for command in commands {
      execute(command)
    }
  }

  private func execute(_ command: NoLateTMapCommand) {
    switch command.type {
    case "animateCamera":
      animateCamera(command.payload)
    case "fitBounds":
      fitBounds(command.payload)
    case "zoomBy":
      let delta = NoLateTMapValue.int(command.payload["delta"]) ?? 0
      guard delta != 0 else {
        return
      }
      let currentZoom = mapView.getZoom() ?? appliedCamera?.zoom ?? 15
      mapView.animateTo(zoom: NoLateTMapValue.clamp(currentZoom + delta, min: 6, max: 18))
    case "resize", "resizeMap":
      setNeedsLayout()
      layoutIfNeeded()
      mapView.setNeedsLayout()
      mapView.layoutIfNeeded()
    case "setData":
      latestData = command.payload
      applyData(command.payload)
    case "batch":
      NoLateTMapValue.dictionaries(command.payload["commands"])
        .compactMap(parseCommand)
        .sorted { $0.sequence < $1.sequence }
        .forEach(execute)
    default:
      return
    }
  }

  private func animateCamera(_ payload: [String: Any]) {
    guard let coordinate = NoLateTMapValue.coordinate(payload) else {
      return
    }
    // TMap exposes separate location/zoom animations. Starting both back-to-back can
    // replace the first animation, so apply zoom first and animate the location once.
    if let zoom = NoLateTMapValue.int(payload["zoom"]) {
      mapView.setZoom(NoLateTMapValue.clamp(zoom, min: 6, max: 18))
    }
    mapView.animateTo(location: coordinate)
  }

  private func fitBounds(_ payload: [String: Any]) {
    let coordinates = NoLateTMapValue.coordinates(payload["coords"])
    guard coordinates.count >= 2 else {
      return
    }
    let bounds = MapBounds()
    coordinates.forEach(bounds.extend)

    let fallbackPadding = CGFloat(max(0, NoLateTMapValue.double(payload["padding"]) ?? 48))
    if let edgePadding = NoLateTMapValue.dictionary(payload["edgePadding"]) {
      mapView.fitBounds(
        bounds,
        inset: UIEdgeInsets(
          top: CGFloat(max(0, NoLateTMapValue.double(edgePadding["top"]) ?? Double(fallbackPadding))),
          left: CGFloat(max(0, NoLateTMapValue.double(edgePadding["left"]) ?? Double(fallbackPadding))),
          bottom: CGFloat(max(0, NoLateTMapValue.double(edgePadding["bottom"]) ?? Double(fallbackPadding))),
          right: CGFloat(max(0, NoLateTMapValue.double(edgePadding["right"]) ?? Double(fallbackPadding)))
        )
      )
    } else {
      mapView.fitBounds(bounds, padding: fallbackPadding)
    }
  }

  private func clearMarkers() {
    markersByID.values.forEach { $0.map = nil }
    markersByID.removeAll(keepingCapacity: true)
    markerConfigurationSignaturesByID.removeAll(keepingCapacity: true)
  }

  private func clearRoutes() {
    polylines.forEach { $0.map = nil }
    trafficLines.forEach { $0.map = nil }
    polylines.removeAll(keepingCapacity: true)
    trafficLines.removeAll(keepingCapacity: true)
  }

  private func emitMapError(code: String, message: String, underlying: NSError? = nil) {
    var payload: [String: Any] = [
      "code": code,
      "message": message
    ]
    if let underlying {
      payload["nativeCode"] = underlying.code
      payload["domain"] = underlying.domain
    }
    onMapError(payload)
  }

  private func scheduleCameraEvent(delay: TimeInterval = 0.06) {
    cameraEventWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.emitCameraEvent()
    }
    cameraEventWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
  }

  private func emitCameraEvent() {
    guard
      didEmitReady,
      let center = mapView.getCenter(),
      CLLocationCoordinate2DIsValid(center),
      let zoom = mapView.getZoom()
    else {
      return
    }
    let camera = NoLateTMapCamera(
      latitude: center.latitude,
      longitude: center.longitude,
      zoom: zoom
    )
    if let lastEmittedCamera,
       abs(lastEmittedCamera.latitude - camera.latitude) < 0.0000001,
       abs(lastEmittedCamera.longitude - camera.longitude) < 0.0000001,
       lastEmittedCamera.zoom == camera.zoom {
      return
    }
    lastEmittedCamera = camera

    let convertedMetersPerPixel = mapView.convertPixelToMeter(1)
    let fallbackMetersPerPixel = 156_543.033_928
      * max(0.01, cos(center.latitude * .pi / 180))
      / pow(2, Double(zoom))
    let metersPerPixel = convertedMetersPerPixel.isFinite && convertedMetersPerPixel > 0
      ? convertedMetersPerPixel
      : fallbackMetersPerPixel
    onCameraChange([
      "latitude": center.latitude,
      "longitude": center.longitude,
      "zoom": zoom,
      "metersPerPixel": metersPerPixel
    ])
  }

  public func mapViewDidFinishLoadingMap() {
    mapDidFinishLoading = true
    flushPendingStateIfReady()
  }

  public func SKTMapApikeySucceed() {
    apiKeySucceeded = true
    apiKeyFailed = false
    if mapDidFinishLoading {
      flushPendingStateIfReady()
    }
  }

  public func SKTMapApikeyFailed(error: NSError?) {
    apiKeySucceeded = false
    apiKeyFailed = true
    didEmitReady = false
    emitMapError(
      code: "TMAP_APP_KEY_REJECTED",
      message: error?.localizedDescription ?? "TMAP rejected the app key.",
      underlying: error
    )
  }

  public func mapView(
    _ mapView: TMapView,
    singleTapOnMapWithoutTMapShape location: CLLocationCoordinate2D
  ) {
    guard CLLocationCoordinate2DIsValid(location) else {
      return
    }
    onMapTap([
      "latitude": location.latitude,
      "longitude": location.longitude
    ])
  }

  public func mapViewDidChangeBounds() {
    scheduleCameraEvent()
  }

  public func mapView(_ mapView: TMapView, viewLevelChanged zoom: Int) {
    scheduleCameraEvent()
  }

  deinit {
    cameraEventWorkItem?.cancel()
    markersByID.values.forEach { $0.map = nil }
    polylines.forEach { $0.map = nil }
    trafficLines.forEach { $0.map = nil }
    mapView.delegate = nil
  }
}

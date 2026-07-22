package expo.modules.nolatetmap

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Bundle
import android.os.Looper
import android.view.ViewGroup
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactContext
import com.skt.tmap.TMapBounds
import com.skt.tmap.TMapInsets
import com.skt.tmap.TMapPoint
import com.skt.tmap.TMapView
import com.skt.tmap.overlay.TMapMarkerItem
import com.skt.tmap.overlay.TMapPolyLine
import com.skt.tmap.overlay.TMapTrafficLine
import com.skt.tmap.poi.TMapPOIItem
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.ArrayList
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Native TMAP Vector Map SDK 3.7 view used by the React facade.
 *
 * The JS side sends one immutable `data` snapshot for map content and a sequenced
 * `command` object for imperative camera work. Route direction indicators are owned
 * entirely by [TMapTrafficLine]; this class never paints route arrows itself.
 */
@SuppressLint("ViewConstructor")
class NoLateTMapView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext), LifecycleEventListener {
  override val shouldUseAndroidLayout = true

  val onMapReady by EventDispatcher<Bundle>()
  val onMapError by EventDispatcher<Bundle>()
  val onMapTap by EventDispatcher<Bundle>()
  val onMarkerPress by EventDispatcher<Bundle>()
  val onCameraChange by EventDispatcher<Bundle>()

  private var mapView: TMapView? = null
  private var appKey: String? = null
  private var mapReady = false
  private var destroyed = false
  private var mapResumed = false
  private var pendingData: Map<String, Any?>? = null
  private val pendingCommands = ArrayList<Map<String, Any?>>()
  private val markerInteractionIds = HashMap<String, String?>()
  private var lastCommandSequence = Long.MIN_VALUE
  private var lastDataCamera: CameraSnapshot? = null
  private var lastNightMode: Boolean? = null
  private var markerSignature: String? = null
  private var routeSignature: RouteSignature? = null

  private val density = resources.displayMetrics.density.coerceAtLeast(1f)
  private val regularTypeface = Typeface.create("sans-serif", Typeface.NORMAL)
  private val boldTypeface = Typeface.create("sans-serif", Typeface.BOLD)

  init {
    orientation = VERTICAL
    clipChildren = false
    (appContext.reactContext as? ReactContext)?.addLifecycleEventListener(this)
  }

  fun setAppKey(value: String) = onUiThread {
    if (destroyed) return@onUiThread
    val normalized = value.trim()
    if (normalized.isEmpty()) {
      emitError("APP_KEY_EMPTY", "TMAP app key is empty.")
      return@onUiThread
    }
    if (normalized == appKey && mapView != null) return@onUiThread

    destroyMap()
    appKey = normalized
    createMap(normalized)
  }

  fun setData(value: ReadableMap) {
    val snapshot = value.toHashMap().toStringKeyMap()
    onUiThread {
      if (destroyed) return@onUiThread
      pendingData = snapshot
      if (mapReady) applyPendingData()
    }
  }

  fun setCommand(value: ReadableMap) {
    val snapshot = value.toHashMap().toStringKeyMap()
    onUiThread {
      if (destroyed) return@onUiThread
      if (!mapReady || mapView == null) {
        pendingCommands.add(snapshot)
      } else {
        dispatchCommand(snapshot)
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun createMap(key: String) {
    try {
      val nativeMap = TMapView(context)
      mapView = nativeMap
      registerMapListeners(nativeMap)
      nativeMap.setSKTMapApiKey(key)
      addView(
        nativeMap,
        LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      )
      if (isAttachedToWindow) resumeMap()
    } catch (error: Throwable) {
      mapView = null
      emitError("MAP_CREATION_FAILED", error.message ?: "Failed to create TMAP view.")
    }
  }

  private fun registerMapListeners(nativeMap: TMapView) {
    nativeMap.setOnApiKeyListenerCallback(object : TMapView.OnApiKeyListenerCallback {
      override fun onSKTMapApikeySucceed() = Unit

      override fun onSKTMapApikeyFailed(message: String?) {
        emitError("APP_KEY_AUTH_FAILED", message ?: "TMAP app key authentication failed.")
      }
    })

    nativeMap.setOnMapReadyListener {
      if (destroyed || nativeMap !== mapView) return@setOnMapReadyListener
      mapReady = true
      applyPendingData()
      flushPendingCommands()
      onMapReady(Bundle().apply { putString("sdkVersion", "3.7") })
      emitCameraChange()
    }

    nativeMap.setOnClickListenerCallback(object : TMapView.OnClickListenerCallback {
      override fun onPressDown(
        markerItems: ArrayList<TMapMarkerItem>?,
        poiItems: ArrayList<TMapPOIItem>?,
        point: TMapPoint?,
        screenPoint: PointF?
      ) = Unit

      override fun onPressUp(
        markerItems: ArrayList<TMapMarkerItem>?,
        poiItems: ArrayList<TMapPOIItem>?,
        point: TMapPoint?,
        screenPoint: PointF?
      ) {
        if (!markerItems.isNullOrEmpty()) {
          val marker = markerItems
            .filter { markerInteractionIds.containsKey(it.id) }
            .maxByOrNull { it.priority }
            ?: return
          val interactionId = markerInteractionIds[marker.id]
          onMarkerPress(Bundle().apply {
            putString("id", marker.id)
            if (!interactionId.isNullOrBlank()) putString("interactionId", interactionId)
          })
          return
        }

        point?.let {
          if (isValidCoordinate(it.latitude, it.longitude)) {
            onMapTap(Bundle().apply {
              putDouble("latitude", it.latitude)
              putDouble("longitude", it.longitude)
            })
          }
        }
      }
    })

    nativeMap.setOnPanChangedListener { emitCameraChange() }
    nativeMap.setOnZoomChangedListener { emitCameraChange() }
  }

  private fun applyPendingData() {
    val data = pendingData ?: return
    val nativeMap = mapView ?: return
    if (!mapReady) return
    pendingData = null

    try {
      applyTheme(nativeMap, data.boolean("nightModeEnabled") ?: false)
      applyDataCameraIfChanged(nativeMap, data.map("camera"))
      renderMarkers(nativeMap, data.list("markers"))
      renderPathsIfChanged(nativeMap, data)
    } catch (error: Throwable) {
      emitError("DATA_RENDER_FAILED", error.message ?: "Failed to render TMAP data.")
    }
  }

  private fun applyTheme(nativeMap: TMapView, nightModeEnabled: Boolean) {
    if (lastNightMode == nightModeEnabled) return
    nativeMap.setMapType(if (nightModeEnabled) TMapView.MapType.NIGHT else TMapView.MapType.DEFAULT)
    lastNightMode = nightModeEnabled
  }

  /**
   * Data snapshots are resent whenever markers or paths change. Applying an unchanged
   * camera here would undo an imperative pan/fit, so only a changed camera prop moves it.
   */
  private fun applyDataCameraIfChanged(nativeMap: TMapView, camera: Map<String, Any?>?) {
    camera ?: return
    val latitude = camera.double("latitude") ?: return
    val longitude = camera.double("longitude") ?: return
    if (!isValidCoordinate(latitude, longitude)) return
    val zoom = camera.double("zoom")?.roundToInt()?.let(::clampZoom)
    val snapshot = CameraSnapshot(latitude, longitude, zoom)
    if (snapshot == lastDataCamera) return
    lastDataCamera = snapshot

    zoom?.let(nativeMap::setZoomLevel)
    nativeMap.setCenterPoint(latitude, longitude, false)
  }

  private fun renderMarkers(nativeMap: TMapView, rawMarkers: List<Any?>?) {
    val markers = rawMarkers
      .orEmpty()
      .mapNotNull { it.asStringMap() }
      .sortedBy { it.double("zIndex") ?: 0.0 }
    val nextSignature = createMarkerSignature(markers)
    if (markerSignature == nextSignature) return

    nativeMap.removeAllTMapMarkerItem()
    markerInteractionIds.clear()

    markers.forEach { item ->
      val id = item.string("id")?.trim().orEmpty()
      val latitude = item.double("latitude")
      val longitude = item.double("longitude")
      if (id.isEmpty() || latitude == null || longitude == null) return@forEach
      if (!isValidCoordinate(latitude, longitude)) return@forEach

      val rendered = createMarkerBitmap(item)
      val marker = TMapMarkerItem().apply {
        setId(id)
        setName(item.string("caption") ?: "")
        setTMapPoint(latitude, longitude)
        setIcon(rendered.bitmap)
        setPosition(rendered.anchorX, rendered.anchorY)
        setCanShowCallout(false)
        setPriority((item.double("zIndex") ?: 0.0).toFloat())
      }
      markerInteractionIds[id] = item.string("interactionId")
      nativeMap.addTMapMarkerItem(marker)
    }
    markerSignature = nextSignature
  }

  /**
   * React can resend the same marker snapshot while only the camera or route path
   * changes. Canonicalizing nested marker values keeps HashMap iteration order from
   * causing a false change and avoids tearing down every SDK marker during zoom.
   */
  private fun createMarkerSignature(markers: List<Map<String, Any?>>): String {
    return canonicalMarkerValue(markers)
  }

  private fun canonicalMarkerValue(value: Any?): String {
    return when (value) {
      null -> "null"
      is Boolean -> if (value) "boolean:1" else "boolean:0"
      is Number -> "number:${java.lang.Double.doubleToLongBits(value.toDouble())}"
      is String -> "string:${value.length}:$value"
      is List<*> -> value.joinToString(prefix = "list:[", postfix = "]") {
        canonicalMarkerValue(it)
      }
      is Map<*, *> -> value.entries
        .mapNotNull { entry ->
          val key = entry.key as? String ?: return@mapNotNull null
          key to entry.value
        }
        .sortedBy { it.first }
        .joinToString(prefix = "map:{", postfix = "}") { (key, entryValue) ->
          "${key.length}:$key=${canonicalMarkerValue(entryValue)}"
        }
      else -> "object:${value.javaClass.name}:${value}"
    }
  }

  private fun renderPathsIfChanged(nativeMap: TMapView, data: Map<String, Any?>) {
    val hasRoutePayload = data["pathOverlays"] is List<*> ||
      data.containsKey("pathCoords") ||
      data.containsKey("clearRouteOverlays") ||
      data.containsKey("routeOverlayScope")
    if (!hasRoutePayload) return

    val nextSignature = createRouteSignature(data)
    if (routeSignature == nextSignature) return

    nativeMap.removeAllTMapPolyLine()
    nativeMap.removeAllTMapTrafficLine()
    if (!nextSignature.clearRouteOverlays) {
      renderPaths(nativeMap, resolveRouteOverlays(data))
    }
    routeSignature = nextSignature
  }

  /**
   * Keep this signature limited to values that affect an Android SDK route object.
   * Camera, markers and pathOverlayZoom are intentionally absent. The JS-only
   * nativeDirectionColor/nativeDirectionOpacity values are also absent because
   * TMapTrafficLine does not consume them.
   */
  private fun createRouteSignature(data: Map<String, Any?>): RouteSignature {
    val clearRouteOverlays = data.boolean("clearRouteOverlays") == true
    val overlays = if (clearRouteOverlays) {
      emptyList()
    } else {
      resolveRouteOverlays(data).mapIndexedNotNull(::createRouteOverlaySignature)
    }
    return RouteSignature(
      clearRouteOverlays = clearRouteOverlays,
      routeOverlayScope = data.string("routeOverlayScope") ?: "",
      overlays = overlays
    )
  }

  private fun resolveRouteOverlays(data: Map<String, Any?>): List<Map<String, Any?>> {
    val explicit = data.list("pathOverlays")
      .orEmpty()
      .mapNotNull { it.asStringMap() }
    if (explicit.isNotEmpty()) return explicit

    val fallbackCoords = data.list("pathCoords")
    if (fallbackCoords.isNullOrEmpty()) return emptyList()
    return listOf(
      mapOf(
        "id" to "fallback-route",
        "coords" to fallbackCoords,
        "color" to (data.string("pathColor") ?: "#1D72FF"),
        "width" to (data.double("pathWidth") ?: 10.0),
        "outlineColor" to (data.string("pathOutlineColor") ?: "#FFFFFF"),
        "outlineWidth" to (data.double("pathOutlineWidth") ?: 3.0),
        "strokeStyle" to "solid"
      )
    )
  }

  private fun createRouteOverlaySignature(
    index: Int,
    overlay: Map<String, Any?>
  ): RouteOverlaySignature? {
    if (!shouldRenderRouteOverlay(overlay)) return null
    val points = parsePoints(overlay.list("coords"))
    if (points.size < 2) return null

    val id = overlay.string("id")?.takeIf { it.isNotBlank() } ?: "route-$index"
    val dashPattern = overlay.numberList("dashPattern")
    val strokeStyle = resolveStrokeStyle(overlay, dashPattern)
    val useNativeDirection = strokeStyle == "solid" && overlay.boolean("nativeDirection") == true
    val coordinates = points.map { RouteCoordinateSignature(it.latitude, it.longitude) }

    if (useNativeDirection) {
      val lineColor = colorWithOpacity(
        parseCssColor(overlay.string("color"), Color.rgb(29, 114, 255)),
        overlay.double("opacity") ?: 1.0
      )
      val outlineColor = colorWithOpacity(
        parseCssColor(overlay.string("outlineColor"), Color.WHITE),
        overlay.double("outlineOpacity") ?: (overlay.double("opacity") ?: 1.0)
      )
      return RouteOverlaySignature(
        id = id,
        coordinates = coordinates,
        renderer = "traffic",
        lineColor = lineColor,
        lineAlpha = null,
        outlineColor = outlineColor,
        outlineAlpha = null,
        lineWidth = max(1, (overlay.double("width") ?: 10.0).roundToInt()).toFloat(),
        outlineWidth = max(0, (overlay.double("outlineWidth") ?: 0.0).roundToInt()).toFloat(),
        priority = null,
        lineEffect = emptyList(),
        outlineEffect = emptyList()
      )
    }

    val lineColor = parseCssColor(overlay.string("color"), Color.rgb(29, 114, 255))
    val outlineColor = parseCssColor(overlay.string("outlineColor"), Color.WHITE)
    val opacity = overlay.double("opacity") ?: 1.0
    val outlineOpacity = overlay.double("outlineOpacity") ?: opacity
    val width = max(1f, (overlay.double("width") ?: 10.0).toFloat())
    // iOS TMAP dot은 독립 casing의 위상을 보장하지 못하므로 양 플랫폼 모두
    // 도보 점을 한 벌로 렌더링한다.
    val outlineExtra = if (strokeStyle == "dot") {
      0f
    } else {
      max(0f, (overlay.double("outlineWidth") ?: 0.0).toFloat())
    }
    val lineEffect = when (strokeStyle) {
      "dot" -> dotPattern(dashPattern, width).toList()
      "dash" -> normalizedDash(dashPattern.ifEmpty { listOf(12, 8) }).toList()
      else -> emptyList()
    }
    val outlineEffect = when {
      isSparseDotDash(strokeStyle, dashPattern) -> lineEffect
      overlay.string("outlineStrokeStyle") == "dot" -> dotPattern(dashPattern, width).toList()
      overlay.string("outlineStrokeStyle") == "dash" ->
        normalizedDash(dashPattern.ifEmpty { listOf(12, 8) }).toList()
      else -> emptyList()
    }
    return RouteOverlaySignature(
      id = id,
      coordinates = coordinates,
      renderer = "polyline",
      lineColor = lineColor,
      lineAlpha = alphaFor(lineColor, opacity),
      outlineColor = outlineColor,
      outlineAlpha = alphaFor(outlineColor, outlineOpacity),
      lineWidth = width,
      outlineWidth = if (outlineExtra > 0f) width + (outlineExtra * 2f) else 0f,
      priority = (overlay.double("zIndex") ?: 0.0).toFloat(),
      lineEffect = lineEffect,
      outlineEffect = outlineEffect
    )
  }

  private fun renderPaths(nativeMap: TMapView, overlays: List<Map<String, Any?>>) {
    overlays.forEachIndexed { index, overlay ->
      if (!shouldRenderRouteOverlay(overlay)) return@forEachIndexed
      val points = parsePoints(overlay.list("coords"))
      if (points.size < 2) return@forEachIndexed

      val id = overlay.string("id")?.takeIf { it.isNotBlank() } ?: "route-$index"
      val dashPattern = overlay.numberList("dashPattern")
      val strokeStyle = resolveStrokeStyle(overlay, dashPattern)

      if (strokeStyle == "solid" && overlay.boolean("nativeDirection") == true) {
        addTrafficLine(nativeMap, id, points, overlay)
      } else {
        addPolyline(nativeMap, id, points, overlay, strokeStyle, dashPattern)
      }
    }
  }

  private fun shouldRenderRouteOverlay(overlay: Map<String, Any?>): Boolean {
    // `renderMode=screen` is a WebView-only fallback used for very long dotted
    // walking paths. The native facade has no screen-space canvas, so preserve
    // that route by letting the TMAP SDK render its native dot line instead.
    val isScreenDotFallback =
      overlay.string("renderMode") == "screen" && overlay.string("shape") == "dot"
    return overlay.boolean("drawLine") != false || isScreenDotFallback
  }

  private fun resolveStrokeStyle(overlay: Map<String, Any?>, dashPattern: List<Int>): String {
    val requestedStyle = overlay.string("strokeStyle")
    return when {
      overlay.string("shape") == "dot" -> "dot"
      requestedStyle in setOf("solid", "dash", "dot") -> requestedStyle!!
      dashPattern.isNotEmpty() -> "dash"
      else -> "solid"
    }
  }

  private fun isSparseDotDash(strokeStyle: String, dashPattern: List<Int>): Boolean {
    if (strokeStyle != "dash" || dashPattern.size < 2) return false
    val paintLength = max(1, dashPattern[0])
    val gapLength = max(1, dashPattern[1])
    return paintLength <= 2 && gapLength >= 8
  }

  /** Uses the TMAP SDK's bundled route_arrow through setShowIndicator(true). */
  private fun addTrafficLine(
    nativeMap: TMapView,
    id: String,
    points: ArrayList<TMapPoint>,
    overlay: Map<String, Any?>
  ) {
    val lineColor = colorWithOpacity(
      parseCssColor(overlay.string("color"), Color.rgb(29, 114, 255)),
      overlay.double("opacity") ?: 1.0
    )
    val outlineColor = colorWithOpacity(
      parseCssColor(overlay.string("outlineColor"), Color.WHITE),
      overlay.double("outlineOpacity") ?: (overlay.double("opacity") ?: 1.0)
    )
    val width = max(1, (overlay.double("width") ?: 10.0).roundToInt())
    val outlineWidth = max(0, (overlay.double("outlineWidth") ?: 0.0).roundToInt())

    val segment = TMapTrafficLine.TrafficLine(0, points)
    val trafficLine = TMapTrafficLine("nolate-traffic-$id", arrayListOf(segment)).apply {
      setShowTraffic(false)
      setPassedColor(lineColor)
      setBasicColor(lineColor)
      setPassedOutColor(outlineColor)
      setBasicOutColor(outlineColor)
      setLineWidth(width)
      setOutLineWidth(outlineWidth)
      setPassingPosition(0f)
      setShowIndicator(true)
    }
    nativeMap.addTrafficLine(trafficLine)
  }

  private fun addPolyline(
    nativeMap: TMapView,
    id: String,
    points: ArrayList<TMapPoint>,
    overlay: Map<String, Any?>,
    strokeStyle: String,
    dashPattern: List<Int>
  ) {
    val lineColor = parseCssColor(overlay.string("color"), Color.rgb(29, 114, 255))
    val outlineColor = parseCssColor(overlay.string("outlineColor"), Color.WHITE)
    val opacity = overlay.double("opacity") ?: 1.0
    val outlineOpacity = overlay.double("outlineOpacity") ?: opacity
    val width = max(1f, (overlay.double("width") ?: 10.0).toFloat())
    val outlineExtra = if (strokeStyle == "dot") {
      0f
    } else {
      max(0f, (overlay.double("outlineWidth") ?: 0.0).toFloat())
    }

    val polyline = TMapPolyLine("nolate-polyline-$id", points).apply {
      setLineColor(lineColor)
      setLineAlpha(alphaFor(lineColor, opacity))
      setLineWidth(width)
      setOutLineColor(outlineColor)
      setOutLineAlpha(alphaFor(outlineColor, outlineOpacity))
      setOutLineWidth(if (outlineExtra > 0f) width + (outlineExtra * 2f) else 0f)
      setPriority((overlay.double("zIndex") ?: 0.0).toFloat())
    }

    val lineEffect = when (strokeStyle) {
      "dot" -> dotPattern(dashPattern, width)
      "dash" -> normalizedDash(dashPattern.ifEmpty { listOf(12, 8) })
      else -> null
    }
    lineEffect?.let(polyline::setPathEffect)

    val outlineEffect = when {
      isSparseDotDash(strokeStyle, dashPattern) -> lineEffect
      overlay.string("outlineStrokeStyle") == "dot" ->
        dotPattern(dashPattern, width)
      overlay.string("outlineStrokeStyle") == "dash" ->
        normalizedDash(dashPattern.ifEmpty { listOf(12, 8) })
      else -> null
    }
    outlineEffect?.let(polyline::setOutLinePathEffect)
    nativeMap.addTMapPolyLine(polyline)
  }

  private fun normalizedDash(values: List<Int>): IntArray {
    val positive = values.map { max(1, it) }.ifEmpty { listOf(12, 8) }.toMutableList()
    if (positive.size == 1) positive.add(positive.first())
    if (positive.size % 2 != 0) positive.addAll(positive.toList())
    return positive.toIntArray()
  }

  private fun dotPattern(values: List<Int>, width: Float): IntArray {
    return if (values.size >= 2) {
      normalizedDash(values)
    } else {
      intArrayOf(1, max(4, width.roundToInt()))
    }
  }

  private fun flushPendingCommands() {
    if (!mapReady) return
    val queued = pendingCommands.toList()
    pendingCommands.clear()
    queued.forEach(::dispatchCommand)
  }

  private fun dispatchCommand(command: Map<String, Any?>) {
    val type = command.string("type") ?: return
    if (type == "batch") {
      dispatchBatch(command)
      return
    }

    val sequence = command.long("sequence")
    if (sequence != null && sequence <= lastCommandSequence) return
    executeCommand(type, command.map("payload") ?: emptyMap())
    if (sequence != null) lastCommandSequence = max(lastCommandSequence, sequence)
  }

  private fun dispatchBatch(batch: Map<String, Any?>) {
    val wrapperSequence = batch.long("sequence")
    val sequenceAtStart = lastCommandSequence
    val allowUnsequencedChildren = wrapperSequence == null || wrapperSequence > sequenceAtStart
    val commands = batch.map("payload")
      ?.list("commands")
      .orEmpty()
      .mapNotNull { it.asStringMap() }

    commands.forEach { child ->
      val childSequence = child.long("sequence")
      if (childSequence == null && !allowUnsequencedChildren) return@forEach
      dispatchCommand(child)
    }
    if (wrapperSequence != null && wrapperSequence > lastCommandSequence) {
      lastCommandSequence = wrapperSequence
    }
  }

  private fun executeCommand(type: String, payload: Map<String, Any?>) {
    val nativeMap = mapView ?: return
    try {
      when (type) {
        "animateCamera" -> animateCamera(nativeMap, payload)
        "animateRegion" -> animateRegion(nativeMap, payload)
        "fitBounds" -> fitBounds(nativeMap, payload)
        "zoomBy" -> {
          val delta = payload.double("delta") ?: 0.0
          nativeMap.setZoomLevel(clampZoom((nativeMap.zoomLevel + delta).roundToInt()))
        }
        "resize", "resizeMap" -> {
          requestLayout()
          post {
            if (!destroyed) {
              measureAndLayout()
              emitCameraChange()
            }
          }
        }
      }
    } catch (error: Throwable) {
      emitError("COMMAND_FAILED", "$type: ${error.message ?: "TMAP command failed."}")
    }
  }

  private fun animateCamera(nativeMap: TMapView, payload: Map<String, Any?>) {
    val latitude = payload.double("latitude") ?: return
    val longitude = payload.double("longitude") ?: return
    if (!isValidCoordinate(latitude, longitude)) return
    payload.double("zoom")?.roundToInt()?.let { nativeMap.setZoomLevel(clampZoom(it)) }
    nativeMap.setCenterPoint(latitude, longitude, true)
  }

  private fun animateRegion(nativeMap: TMapView, payload: Map<String, Any?>) {
    val latitude = payload.double("latitude") ?: return
    val longitude = payload.double("longitude") ?: return
    val latitudeDelta = payload.double("latitudeDelta") ?: return
    val longitudeDelta = payload.double("longitudeDelta") ?: return
    val points = arrayListOf(
      TMapPoint(latitude - latitudeDelta / 2.0, longitude - longitudeDelta / 2.0),
      TMapPoint(latitude + latitudeDelta / 2.0, longitude + longitudeDelta / 2.0)
    )
    nativeMap.getBoundsFromPoints(points)?.let { bounds ->
      nativeMap.fitBounds(bounds, TMapInsets.of(dpInt(32f), dpInt(32f), dpInt(32f), dpInt(32f)))
    }
  }

  private fun fitBounds(nativeMap: TMapView, payload: Map<String, Any?>) {
    val points = parsePoints(payload.list("coords"))
    if (points.isEmpty()) return
    if (points.size == 1) {
      nativeMap.setCenterPoint(points.first().latitude, points.first().longitude, true)
      return
    }
    val bounds: TMapBounds = nativeMap.getBoundsFromPoints(points) ?: return
    val commonPadding = payload.double("padding")?.toFloat() ?: 48f
    val edgePadding = payload.map("edgePadding")
    val left = edgePadding?.double("left")?.toFloat() ?: commonPadding
    val top = edgePadding?.double("top")?.toFloat() ?: commonPadding
    val right = edgePadding?.double("right")?.toFloat() ?: commonPadding
    val bottom = edgePadding?.double("bottom")?.toFloat() ?: commonPadding
    nativeMap.fitBounds(
      bounds,
      TMapInsets.of(dpInt(left), dpInt(top), dpInt(right), dpInt(bottom))
    )
  }

  private fun emitCameraChange() {
    val nativeMap = mapView ?: return
    if (!mapReady) return
    val center = nativeMap.centerPoint ?: return
    if (!isValidCoordinate(center.latitude, center.longitude)) return
    onCameraChange(Bundle().apply {
      putDouble("latitude", center.latitude)
      putDouble("longitude", center.longitude)
      putDouble("zoom", nativeMap.zoomLevel.toDouble())
    })
  }

  private fun emitError(code: String, message: String) {
    onMapError(Bundle().apply {
      putString("code", code)
      putString("message", message)
    })
  }

  private fun parsePoints(rawPoints: List<Any?>?): ArrayList<TMapPoint> {
    return ArrayList<TMapPoint>().apply {
      rawPoints.orEmpty().forEach { raw ->
        val point = raw.asStringMap() ?: return@forEach
        val latitude = point.double("latitude") ?: return@forEach
        val longitude = point.double("longitude") ?: return@forEach
        if (isValidCoordinate(latitude, longitude)) add(TMapPoint(latitude, longitude))
      }
    }
  }

  private fun createMarkerBitmap(item: Map<String, Any?>): MarkerBitmap {
    return when (item.string("displayType")) {
      "badge" -> createBadgeMarker(item)
      "dot" -> createDotMarker(item)
      "station" -> createStationMarker(item)
      "routeLabel" -> createRouteLabelMarker(item)
      else -> createPinMarker(item)
    }
  }

  private fun createPinMarker(item: Map<String, Any?>): MarkerBitmap {
    val label = item.string("pinLabel")?.trim().orEmpty().take(3)
    val scale = (item.double("markerScale") ?: 1.0).coerceIn(0.76, 1.0).toFloat()
    val widthDp = (if (label.isEmpty()) 42f else 58f) * scale
    val heightDp = (if (label.isEmpty()) 52f else 64f) * scale
    val width = dpInt(widthDp)
    val height = dpInt(heightDp)
    val sx = width / (if (label.isEmpty()) 42f else 58f)
    val sy = height / (if (label.isEmpty()) 52f else 64f)
    val fill = parseCssColor(item.string("tintColor"), Color.rgb(29, 114, 255))
    val bitmap = Bitmap.createBitmap(max(1, width), max(1, height), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val cx = width / 2f
    val top = 3f * sy
    val circleRadius = (if (label.isEmpty()) 17f else 19f) * min(sx, sy)
    val tipY = (if (label.isEmpty()) 44f else 54f) * sy

    val path = Path().apply {
      moveTo(cx, tipY)
      cubicTo(cx - 4f * sx, tipY - 4f * sy, cx - circleRadius, top + circleRadius, cx - circleRadius, top + circleRadius)
      cubicTo(cx - circleRadius, top + 7f * sy, cx - 8f * sx, top, cx, top)
      cubicTo(cx + 8f * sx, top, cx + circleRadius, top + 7f * sy, cx + circleRadius, top + circleRadius)
      cubicTo(cx + circleRadius, top + circleRadius, cx + 4f * sx, tipY - 4f * sy, cx, tipY)
      close()
    }
    canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = fill
      this.style = Paint.Style.FILL
      setShadowLayer(dp(1.6f), 0f, dp(1.2f), 0x550F172A)
    })
    canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = 0xE6FFFFFF.toInt()
      this.style = Paint.Style.STROKE
      strokeWidth = dp(1.6f)
    })

    if (label.isEmpty()) {
      canvas.drawCircle(cx, top + circleRadius, dp(6.2f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        this.style = Paint.Style.FILL
      })
    } else {
      drawCenteredText(canvas, label, cx, top + circleRadius + dp(0.5f), dp(if (label.length >= 3) 10.5f else 11.5f), Color.WHITE, true)
    }
    return MarkerBitmap(bitmap, 0.5f, tipY / height)
  }

  private fun createDotMarker(item: Map<String, Any?>): MarkerBitmap {
    val sizeDp = (item.double("dotSize") ?: 8.0).coerceIn(4.0, 14.0).toFloat()
    val size = dpInt(sizeDp)
    val bitmap = Bitmap.createBitmap(max(1, size), max(1, size), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val center = size / 2f
    val border = parseCssColor(item.string("badgeBorderColor"), Color.WHITE)
    val fill = parseCssColor(item.string("tintColor"), Color.rgb(29, 114, 255))
    if (Color.alpha(border) > 0) {
      canvas.drawCircle(center, center, center - dp(0.4f), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = border })
    }
    canvas.drawCircle(center, center, max(dp(1f), center - dp(1.2f)), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fill })
    return MarkerBitmap(bitmap, 0.5f, 0.5f)
  }

  private fun createStationMarker(item: Map<String, Any?>): MarkerBitmap {
    val compact = item.string("stationVariant") == "compact"
    val requested = item.double("dotSize")
    val sizeDp = if (compact) {
      (requested ?: 12.0).coerceIn(10.0, 16.0).toFloat()
    } else {
      (requested ?: 28.0).coerceIn(20.0, 36.0).toFloat()
    }
    val size = dpInt(sizeDp)
    val center = size / 2f
    val accent = parseCssColor(item.string("tintColor"), Color.rgb(47, 128, 255))
    val bitmap = Bitmap.createBitmap(max(1, size), max(1, size), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawCircle(center, center, center - dp(0.8f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      setShadowLayer(dp(1f), 0f, dp(0.7f), 0x440F172A)
    })

    if (compact) {
      canvas.drawCircle(center, center, max(dp(1.8f), center - dp(2.7f)), Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = accent
        this.style = Paint.Style.STROKE
        strokeWidth = max(dp(1.2f), size * 0.11f)
      })
    } else {
      canvas.drawCircle(center, center, center - dp(3.1f), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent })
      val glyph = when (item.string("markerStyle")) {
        "bus" -> "B"
        "walk" -> "W"
        else -> "M"
      }
      drawCenteredText(canvas, glyph, center, center, dp(11f), Color.WHITE, true)
    }
    return MarkerBitmap(bitmap, 0.5f, 0.5f)
  }

  private fun createBadgeMarker(item: Map<String, Any?>): MarkerBitmap {
    val label = (item.string("badgeLabel") ?: item.string("caption") ?: "구간").trim().ifEmpty { "구간" }
    val style = item.string("markerStyle") ?: "default"
    val routeVariant = item.string("badgeVariant") == "route"
    val sideLeft = item.string("badgeSide") == "left"
    val accent = parseCssColor(item.string("tintColor"), Color.rgb(47, 128, 255))
    val textColor = parseCssColor(item.string("badgeTextColor"), Color.rgb(31, 41, 55))
    val borderColor = parseCssColor(item.string("badgeBorderColor"), 0xB8_94A3B8.toInt())
    val textPaint = textPaint(dp(11f), if (routeVariant) Color.WHITE else textColor, true)
    val iconDp = if (style in setOf("bus", "subway", "walk")) 28f else 24f
    val labelWidth = (textPaint.measureText(label) / density + 18f).coerceIn(44f, if (routeVariant) 96f else 116f)
    val overlap = 4f
    val widthDp = iconDp + labelWidth - overlap
    val heightDp = max(32f, iconDp + 4f)
    val width = dpInt(widthDp)
    val height = dpInt(heightDp)
    val bitmap = Bitmap.createBitmap(max(1, width), max(1, height), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val centerY = height / 2f
    val iconSize = dp(iconDp)
    val labelWidthPx = dp(labelWidth)
    val overlapPx = dp(overlap)
    val labelX = if (sideLeft) 0f else iconSize - overlapPx
    val iconCenterX = if (sideLeft) labelWidthPx - overlapPx + iconSize / 2f else iconSize / 2f

    canvas.drawRoundRect(
      RectF(labelX + dp(0.75f), dp(2.5f), labelX + labelWidthPx - dp(0.75f), height - dp(4.5f)),
      dp(6f),
      dp(6f),
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = if (routeVariant) accent else Color.WHITE
        this.style = Paint.Style.FILL
        setShadowLayer(dp(1.4f), 0f, dp(1f), 0x440F172A)
      }
    )
    canvas.drawRoundRect(
      RectF(labelX + dp(0.75f), dp(2.5f), labelX + labelWidthPx - dp(0.75f), height - dp(4.5f)),
      dp(6f),
      dp(6f),
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = borderColor
        this.style = Paint.Style.STROKE
        strokeWidth = dp(1.1f)
      }
    )
    canvas.drawCircle(iconCenterX, centerY, iconSize / 2f - dp(1f), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent })
    canvas.drawCircle(iconCenterX, centerY, iconSize / 2f - dp(1f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      this.style = Paint.Style.STROKE
      strokeWidth = dp(2f)
    })

    val labelStart = labelX + dp(9f)
    val labelCenterY = centerY
    drawTextVerticallyCentered(canvas, label, labelStart, labelCenterY, textPaint)
    val glyph = item.string("badgeGlyph")?.take(2) ?: when (style) {
      "bus" -> "B"
      "subway" -> "M"
      "walk" -> "W"
      else -> ""
    }
    if (glyph.isNotEmpty()) drawCenteredText(canvas, glyph, iconCenterX, centerY, dp(10f), Color.WHITE, true)
    return MarkerBitmap(bitmap, iconCenterX / width, 0.5f)
  }

  private fun createRouteLabelMarker(item: Map<String, Any?>): MarkerBitmap {
    val label = (item.string("badgeLabel") ?: item.string("caption") ?: "노선").trim().ifEmpty { "노선" }
    val subLabel = item.string("badgeSubLabel")?.trim().orEmpty()
    val variant = item.string("badgeVariant") ?: "route"
    val contextCard = variant == "context"
    val stopCard = variant == "stop"
    val sideLeft = item.string("badgeSide") == "left"
    val accent = parseCssColor(item.string("tintColor"), Color.rgb(47, 128, 255))
    val primaryPaint = textPaint(dp(if (contextCard) 11.2f else 10.5f), if (contextCard || stopCard) Color.rgb(17, 24, 39) else Color.WHITE, true)
    val secondaryPaint = textPaint(dp(9.8f), Color.rgb(75, 85, 99), false)
    val measured = max(primaryPaint.measureText(label), if (subLabel.isEmpty()) 0f else secondaryPaint.measureText(subLabel)) / density
    val labelWidthDp = (measured + if (contextCard) 28f else 18f).coerceIn(
      if (contextCard) 92f else if (stopCard) 54f else 40f,
      if (contextCard) 158f else if (stopCard) 168f else 88f
    )
    val gapDp = if (contextCard) 12f else 11f
    val width = dpInt(labelWidthDp + gapDp)
    val height = dpInt(if (contextCard) 44f else if (stopCard) 28f else 30f)
    val labelWidth = dp(labelWidthDp)
    val gap = dp(gapDp)
    val boxX = if (sideLeft) 0f else gap
    val anchorX = if (sideLeft) width.toFloat() else 0f
    val edgeX = if (sideLeft) labelWidth else gap
    val centerY = height / 2f
    val bitmap = Bitmap.createBitmap(max(1, width), max(1, height), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val connector = parseCssColor(item.string("badgeConnectorColor"), accent)
    canvas.drawLine(anchorX, centerY, edgeX, centerY, Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = connector
      strokeWidth = dp(1.6f)
      strokeCap = Paint.Cap.ROUND
    })
    val boxTop = dp(if (contextCard || stopCard) 2.5f else 3.5f)
    val boxBottom = height - dp(if (contextCard) 2.5f else if (stopCard) 2.5f else 3.5f)
    canvas.drawRoundRect(RectF(boxX + dp(0.5f), boxTop, boxX + labelWidth - dp(0.5f), boxBottom), dp(6f), dp(6f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = if (contextCard || stopCard) Color.WHITE else accent
      setShadowLayer(dp(1.2f), 0f, dp(0.8f), 0x380F172A)
    })
    canvas.drawRoundRect(RectF(boxX + dp(0.5f), boxTop, boxX + labelWidth - dp(0.5f), boxBottom), dp(6f), dp(6f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = colorWithOpacity(accent, 0.72)
      this.style = Paint.Style.STROKE
      strokeWidth = dp(if (contextCard) 1.1f else 0.8f)
    })
    if (contextCard) {
      canvas.drawRoundRect(RectF(boxX + dp(1.5f), dp(4.5f), boxX + dp(5.5f), height - dp(4.5f)), dp(2f), dp(2f), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent })
      canvas.drawText(label, boxX + dp(13f), dp(17f) - primaryPaint.fontMetrics.ascent / 4f, primaryPaint)
      if (subLabel.isNotEmpty()) canvas.drawText(subLabel, boxX + dp(13f), dp(31.5f) - secondaryPaint.fontMetrics.ascent / 6f, secondaryPaint)
    } else {
      val textX = boxX + labelWidth / 2f
      drawCenteredText(canvas, label, textX, centerY, dp(if (stopCard) 10.2f else 10.5f), if (stopCard) Color.rgb(17, 24, 39) else Color.WHITE, true)
    }
    return MarkerBitmap(bitmap, anchorX / width, 0.5f)
  }

  private fun textPaint(sizePx: Float, color: Int, bold: Boolean): Paint {
    return Paint(Paint.ANTI_ALIAS_FLAG).apply {
      this.textSize = sizePx
      this.color = color
      typeface = if (bold) boldTypeface else regularTypeface
    }
  }

  private fun drawCenteredText(
    canvas: Canvas,
    text: String,
    centerX: Float,
    centerY: Float,
    sizePx: Float,
    color: Int,
    bold: Boolean
  ) {
    val paint = textPaint(sizePx, color, bold).apply { textAlign = Paint.Align.CENTER }
    val baseline = centerY - (paint.fontMetrics.ascent + paint.fontMetrics.descent) / 2f
    canvas.drawText(text, centerX, baseline, paint)
  }

  private fun drawTextVerticallyCentered(canvas: Canvas, text: String, x: Float, centerY: Float, paint: Paint) {
    val baseline = centerY - (paint.fontMetrics.ascent + paint.fontMetrics.descent) / 2f
    canvas.drawText(text, x, baseline, paint)
  }

  private fun parseCssColor(value: String?, fallback: Int): Int {
    val raw = value?.trim()?.lowercase() ?: return fallback
    if (raw == "transparent") return Color.TRANSPARENT
    CSS_RGBA.matchEntire(raw)?.let { match ->
      val red = match.groupValues[1].toDouble().roundToInt().coerceIn(0, 255)
      val green = match.groupValues[2].toDouble().roundToInt().coerceIn(0, 255)
      val blue = match.groupValues[3].toDouble().roundToInt().coerceIn(0, 255)
      val alpha = (match.groupValues[4].toDouble().coerceIn(0.0, 1.0) * 255).roundToInt()
      return Color.argb(alpha, red, green, blue)
    }
    CSS_RGB.matchEntire(raw)?.let { match ->
      return Color.rgb(
        match.groupValues[1].toDouble().roundToInt().coerceIn(0, 255),
        match.groupValues[2].toDouble().roundToInt().coerceIn(0, 255),
        match.groupValues[3].toDouble().roundToInt().coerceIn(0, 255)
      )
    }
    if (raw.startsWith("#") && raw.length == 9) {
      return try {
        val red = raw.substring(1, 3).toInt(16)
        val green = raw.substring(3, 5).toInt(16)
        val blue = raw.substring(5, 7).toInt(16)
        val alpha = raw.substring(7, 9).toInt(16)
        Color.argb(alpha, red, green, blue)
      } catch (_: IllegalArgumentException) {
        fallback
      }
    }
    return try {
      Color.parseColor(raw)
    } catch (_: IllegalArgumentException) {
      fallback
    }
  }

  private fun colorWithOpacity(color: Int, opacity: Double): Int {
    return Color.argb(alphaFor(color, opacity), Color.red(color), Color.green(color), Color.blue(color))
  }

  private fun alphaFor(color: Int, opacity: Double): Int {
    return (Color.alpha(color) * opacity.coerceIn(0.0, 1.0)).roundToInt().coerceIn(0, 255)
  }

  private fun clampZoom(value: Int): Int {
    val sdkMax = mapView?.maxZoomLevel?.takeIf { it >= MIN_ZOOM } ?: MAX_ZOOM
    return value.coerceIn(MIN_ZOOM, min(MAX_ZOOM, sdkMax))
  }

  private fun dp(value: Float): Float = value * density
  private fun dpInt(value: Float): Int = max(1, (value * density).roundToInt())

  private fun onUiThread(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else post(block)
  }

  private fun resumeMap() {
    if (destroyed || mapResumed) return
    mapView?.onResume()
    mapResumed = true
  }

  private fun pauseMap() {
    if (!mapResumed) return
    mapView?.onPause()
    mapResumed = false
  }

  private fun destroyMap() {
    markerSignature = null
    routeSignature = null
    val nativeMap = mapView ?: return
    if (mapResumed) nativeMap.onPause()
    mapResumed = false
    nativeMap.onDestroy()
    removeView(nativeMap)
    mapView = null
    mapReady = false
    lastDataCamera = null
    lastNightMode = null
    markerInteractionIds.clear()
  }

  fun onDestroy() = onUiThread {
    if (destroyed) return@onUiThread
    destroyed = true
    (appContext.reactContext as? ReactContext)?.removeLifecycleEventListener(this)
    destroyMap()
    pendingCommands.clear()
    pendingData = null
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    resumeMap()
  }

  override fun onDetachedFromWindow() {
    pauseMap()
    super.onDetachedFromWindow()
  }

  override fun onHostResume() = resumeMap()
  override fun onHostPause() = pauseMap()
  override fun onHostDestroy() = onDestroy()

  private data class CameraSnapshot(val latitude: Double, val longitude: Double, val zoom: Int?)
  private data class MarkerBitmap(val bitmap: Bitmap, val anchorX: Float, val anchorY: Float)
  private data class RouteCoordinateSignature(val latitude: Double, val longitude: Double)
  private data class RouteOverlaySignature(
    val id: String,
    val coordinates: List<RouteCoordinateSignature>,
    val renderer: String,
    val lineColor: Int,
    val lineAlpha: Int?,
    val outlineColor: Int,
    val outlineAlpha: Int?,
    val lineWidth: Float,
    val outlineWidth: Float,
    val priority: Float?,
    val lineEffect: List<Int>,
    val outlineEffect: List<Int>
  )
  private data class RouteSignature(
    val clearRouteOverlays: Boolean,
    val routeOverlayScope: String,
    val overlays: List<RouteOverlaySignature>
  )

  private companion object {
    const val MIN_ZOOM = 6
    const val MAX_ZOOM = 18
    val CSS_RGBA = Regex("rgba\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*\\)")
    val CSS_RGB = Regex("rgb\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*\\)")

    fun isValidCoordinate(latitude: Double, longitude: Double): Boolean {
      return latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0
    }
  }
}

private fun Map<*, *>.toStringKeyMap(): Map<String, Any?> {
  return entries.mapNotNull { (key, value) -> (key as? String)?.let { it to value } }.toMap()
}

private fun Any?.asStringMap(): Map<String, Any?>? = (this as? Map<*, *>)?.toStringKeyMap()

private fun Map<String, Any?>.map(key: String): Map<String, Any?>? = this[key].asStringMap()
private fun Map<String, Any?>.list(key: String): List<Any?>? = this[key] as? List<Any?>
private fun Map<String, Any?>.string(key: String): String? = this[key] as? String
private fun Map<String, Any?>.boolean(key: String): Boolean? = this[key] as? Boolean

private fun Map<String, Any?>.double(key: String): Double? {
  return when (val value = this[key]) {
    is Number -> value.toDouble().takeIf { it.isFinite() }
    is String -> value.toDoubleOrNull()?.takeIf { it.isFinite() }
    else -> null
  }
}

private fun Map<String, Any?>.long(key: String): Long? {
  return when (val value = this[key]) {
    is Number -> value.toLong()
    is String -> value.toLongOrNull()
    else -> null
  }
}

private fun Map<String, Any?>.numberList(key: String): List<Int> {
  return list(key).orEmpty().mapNotNull { value ->
    when (value) {
      is Number -> value.toDouble().takeIf { it.isFinite() }?.roundToInt()
      is String -> value.toDoubleOrNull()?.takeIf { it.isFinite() }?.roundToInt()
      else -> null
    }
  }
}

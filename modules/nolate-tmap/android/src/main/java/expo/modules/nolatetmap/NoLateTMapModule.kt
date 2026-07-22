package expo.modules.nolatetmap

import com.facebook.react.bridge.ReadableMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NoLateTMapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NoLateTMap")

    View(NoLateTMapView::class) {
      Events(
        "onMapReady",
        "onMapError",
        "onMapTap",
        "onMarkerPress",
        "onCameraChange"
      )

      Prop("appKey") { view: NoLateTMapView, appKey: String ->
        view.setAppKey(appKey)
      }

      Prop("data") { view: NoLateTMapView, data: ReadableMap ->
        view.setData(data)
      }

      Prop("command") { view: NoLateTMapView, command: ReadableMap ->
        view.setCommand(command)
      }

      OnViewDestroys<NoLateTMapView> { view ->
        view.onDestroy()
      }
    }
  }
}

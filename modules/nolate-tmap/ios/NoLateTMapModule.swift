import ExpoModulesCore

public final class NoLateTMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NoLateTMap")

    View(NoLateTMapView.self) {
      Events(
        "onMapReady",
        "onMapError",
        "onMapTap",
        "onMarkerPress",
        "onCameraChange"
      )

      Prop("appKey") { (view: NoLateTMapView, appKey: String) in
        view.setAppKey(appKey)
      }

      Prop("data") { (view: NoLateTMapView, data: [String: Any]) in
        view.setData(data)
      }

      Prop("command") { (view: NoLateTMapView, command: [String: Any]) in
        view.setCommand(command)
      }
    }
  }
}

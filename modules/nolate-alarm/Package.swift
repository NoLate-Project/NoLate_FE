// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "NoLateAlarmPolicy",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "NoLateAlarmPolicy", targets: ["NoLateAlarmPolicy"])
  ],
  targets: [
    .target(
      name: "NoLateAlarmPolicy",
      path: "ios",
      exclude: [
        "NoLateAlarm.podspec",
        "NoLateAlarmCoordinator.swift",
        "NoLateAlarmIntents.swift",
        "NoLateAlarmModule.swift",
        "Tests"
      ],
      sources: ["NoLateAlarmModels.swift", "NoLateAlarmStore.swift"]
    ),
    .testTarget(
      name: "NoLateAlarmPolicyTests",
      dependencies: ["NoLateAlarmPolicy"],
      path: "ios/Tests"
    )
  ]
)

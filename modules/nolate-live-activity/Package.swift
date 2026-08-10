// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "NoLateLiveActivityPolicy",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "NoLateLiveActivityPolicy", targets: ["NoLateLiveActivityPolicy"])
  ],
  targets: [
    .target(
      name: "NoLateLiveActivityPolicy",
      path: "ios",
      exclude: [
        "Extension",
        "NoLateLiveActivity.podspec",
        "NoLateLiveActivityCoordinator.swift",
        "NoLateLiveActivityModule.swift",
        "Shared",
        "Tests"
      ],
      sources: ["NoLateLiveActivityModels.swift"]
    ),
    .testTarget(
      name: "NoLateLiveActivityPolicyTests",
      dependencies: ["NoLateLiveActivityPolicy"],
      path: "ios/Tests"
    )
  ]
)
